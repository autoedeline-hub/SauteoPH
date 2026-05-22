-- Per-Airtable-row CRM contacts. Drops the "merge by PSID" behavior.
--
-- Background: the n8n Airtable sync was merging crm_contacts whenever
-- the incoming row's PSID matched an existing contact. That collapses
-- legitimately distinct waitlist entries (multiple guests on a shared
-- household Messenger thread, or three test entries against the same
-- bot PSID) into one row, hiding bookings the host wants tracked.
--
-- New behavior:
--   - Each Airtable row gets its own crm_contacts row.
--   - The Airtable record_id (e.g. "rec1Llp2mZEXEjUlF") is the dedup
--     key, so re-runs of the sync don't pile up duplicates.
--   - Multiple crm_contacts can share a messenger_psid — that's fine,
--     the invite flow picks the specific contact_id, not the PSID.
--
-- Trade-offs documented inline.

-- ---------------------------------------------------------------------------
-- 1. Drop the partial unique index that previously forced PSIDs to be 1:1.
-- ---------------------------------------------------------------------------
DROP INDEX IF EXISTS public.crm_contacts_messenger_psid_uniq;

-- Keep an ordinary index for lookup speed (admin still queries "contacts
-- with this PSID" to show all linked guests in one view).
CREATE INDEX IF NOT EXISTS crm_contacts_messenger_psid_idx
  ON public.crm_contacts (messenger_psid)
  WHERE messenger_psid IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Add airtable_record_id — stable per Airtable row, scoped to one table.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS airtable_record_id TEXT;

-- Partial unique so legacy rows (no Airtable origin) coexist with sync-driven
-- rows. NULL values aren't constrained.
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_airtable_record_id_uniq
  ON public.crm_contacts (airtable_record_id)
  WHERE airtable_record_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. Replace sync_messenger_contact: insert-or-update by airtable_record_id.
-- ---------------------------------------------------------------------------
-- Drop the old 8-arg signature so PostgREST stops resolving it.
DROP FUNCTION IF EXISTS public.sync_messenger_contact(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
);

CREATE OR REPLACE FUNCTION public.sync_messenger_contact(
  p_airtable_id      TEXT,
  p_full_name        TEXT,
  p_email            TEXT,
  p_phone            TEXT,
  p_facebook_handle  TEXT,
  p_instagram_handle TEXT,
  p_psid             TEXT,
  p_source           TEXT,
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id           UUID;
  v_handle_clean TEXT;
  v_psid_clean   TEXT;
  v_email_clean  TEXT;
  v_psid_pattern CONSTANT TEXT := '^[0-9]{15,}$';
BEGIN
  -- Skip bot-harness rows so prod CRM stays clean.
  IF p_full_name ~* '^TEST_'
     OR p_facebook_handle ~* '^TEST_'
     OR p_psid ~* '^TEST_' THEN
    RETURN NULL;
  END IF;

  -- Route numeric "fb_handle" to messenger_psid.
  IF p_facebook_handle ~ v_psid_pattern THEN
    v_handle_clean := NULL;
    v_psid_clean   := COALESCE(p_psid, p_facebook_handle);
  ELSE
    v_handle_clean := NULLIF(p_facebook_handle, '');
    v_psid_clean   := p_psid;
  END IF;
  IF v_psid_clean IS NOT NULL AND v_psid_clean !~ v_psid_pattern THEN
    v_psid_clean := NULL;
  END IF;

  -- Validate email shape (matches the rest of the schema's email check).
  v_email_clean := CASE
    WHEN p_email IS NOT NULL AND p_email ~* '^[^@]+@[^@]+\.[^@]+$'
      THEN lower(p_email)
    ELSE NULL
  END;

  -- Dedup by airtable_record_id. If a contact for this Airtable row
  -- already exists, refresh its fields so edits in Airtable propagate.
  -- Otherwise insert fresh — even if another contact already holds this
  -- PSID. Two waitlist rows on the same Messenger thread become two
  -- distinct CRM contacts, which is the intended behavior here.
  IF p_airtable_id IS NOT NULL AND p_airtable_id <> '' THEN
    SELECT id INTO v_id
      FROM public.crm_contacts
     WHERE airtable_record_id = p_airtable_id
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.crm_contacts (
      full_name,
      email,
      phone,
      facebook_handle,
      instagram_handle,
      messenger_psid,
      source,
      tags,
      airtable_record_id
    )
    VALUES (
      COALESCE(NULLIF(p_full_name, ''), 'Messenger guest'),
      v_email_clean,
      NULLIF(p_phone, ''),
      v_handle_clean,
      NULLIF(p_instagram_handle, ''),
      v_psid_clean,
      COALESCE(p_source, 'messenger'),
      COALESCE(p_tags, ARRAY[]::TEXT[]),
      NULLIF(p_airtable_id, '')
    )
    RETURNING id INTO v_id;
  ELSE
    -- Update only the fields the Airtable sync owns. Don't clobber
    -- existing data with NULLs (in case admin enriched the contact
    -- manually after first import).
    UPDATE public.crm_contacts
       SET full_name        = COALESCE(NULLIF(p_full_name, ''), full_name),
           email            = COALESCE(v_email_clean, email),
           phone            = COALESCE(NULLIF(p_phone, ''), phone),
           facebook_handle  = COALESCE(v_handle_clean, facebook_handle),
           instagram_handle = COALESCE(NULLIF(p_instagram_handle, ''), instagram_handle),
           messenger_psid   = COALESCE(v_psid_clean, messenger_psid),
           tags             = (
             SELECT array_agg(DISTINCT t ORDER BY t)
               FROM unnest(tags || COALESCE(p_tags, ARRAY[]::TEXT[])) AS t
              WHERE t IS NOT NULL AND t <> ''
           )
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL    ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;
