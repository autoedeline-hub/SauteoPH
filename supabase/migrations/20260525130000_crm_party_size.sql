-- Promote party_size from free-text notes to a first-class column so the
-- InviteCreator can pre-fill it and the Contacts tab can show it directly.
--
-- The waitlist + pickup Airtable importers had been writing the bot-captured
-- party size into crm_contacts.notes ("Party size on waitlist: 4" /
-- "Requested meals: 4"). That's fine for human reading but means downstream
-- code had to regex-parse the field to recover the number, and the value
-- never made it to the InviteCreator's group_size input. Now it lives on
-- its own column.
--
-- This migration:
--   1. Adds crm_contacts.last_party_size INT (1..50 or NULL)
--   2. Backfills it from notes for existing rows
--   3. Extends sync_messenger_contact() to accept p_party_size and write it
--      (additive — existing callers that don't pass it continue working)
--   4. Recreates crm_contacts_with_stats so admin queries pick up the new
--      column (Postgres views snapshot their projection at creation time,
--      same reason we had to refresh the view when adding messenger_psid)

-- ---------------------------------------------------------------------------
-- 1. Column
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS last_party_size INT;

ALTER TABLE public.crm_contacts
  DROP CONSTRAINT IF EXISTS crm_contacts_last_party_size_range;
ALTER TABLE public.crm_contacts
  ADD  CONSTRAINT crm_contacts_last_party_size_range
    CHECK (last_party_size IS NULL OR (last_party_size BETWEEN 1 AND 50));

-- ---------------------------------------------------------------------------
-- 2. Backfill from notes — handles both waitlist and pickup phrasings.
-- ---------------------------------------------------------------------------
UPDATE public.crm_contacts
   SET last_party_size =
         (substring(notes from
            '(?:Party size on waitlist|Requested meals)[^:]*:\s*(\d+)'))::INT
 WHERE last_party_size IS NULL
   AND notes IS NOT NULL
   AND notes ~ '(?:Party size on waitlist|Requested meals)[^:]*:\s*\d+';

-- ---------------------------------------------------------------------------
-- 3. Replace sync_messenger_contact with a version that accepts party size.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_messenger_contact(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]
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
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[],
  -- Added so the Airtable sync can record what the bot captured. Optional;
  -- legacy callers that don't pass it leave the column untouched.
  p_party_size       INT  DEFAULT NULL
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
  v_party_clean  INT;
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

  -- Clamp party size into the table's CHECK range. Out-of-range or NULL
  -- input means "don't change this column."
  v_party_clean := CASE
    WHEN p_party_size IS NOT NULL AND p_party_size BETWEEN 1 AND 50
      THEN p_party_size
    ELSE NULL
  END;

  -- Dedup by airtable_record_id. If a contact for this Airtable row
  -- already exists, refresh its fields so edits in Airtable propagate.
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
      airtable_record_id,
      last_party_size
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
      NULLIF(p_airtable_id, ''),
      v_party_clean
    )
    RETURNING id INTO v_id;
  ELSE
    -- Update only the fields the Airtable sync owns; don't clobber
    -- existing values with NULLs.
    UPDATE public.crm_contacts
       SET full_name        = COALESCE(NULLIF(p_full_name, ''), full_name),
           email            = COALESCE(v_email_clean, email),
           phone            = COALESCE(NULLIF(p_phone, ''), phone),
           facebook_handle  = COALESCE(v_handle_clean, facebook_handle),
           instagram_handle = COALESCE(NULLIF(p_instagram_handle, ''), instagram_handle),
           messenger_psid   = COALESCE(v_psid_clean, messenger_psid),
           last_party_size  = COALESCE(v_party_clean, last_party_size),
           tags             = (
             SELECT array_agg(DISTINCT t ORDER BY t)
               FROM unnest(tags || COALESCE(p_tags, ARRAY[]::TEXT[])) AS t
              WHERE t IS NOT NULL AND t <> ''
           )
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL    ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. Recreate the stats view so .select("*") in the admin returns the new
--    column. Postgres views freeze their column list at creation time.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.crm_contacts_with_stats;

CREATE VIEW public.crm_contacts_with_stats
WITH (security_invoker = true) AS
SELECT
  c.*,
  COALESCE(b.total_bookings, 0)        AS total_bookings,
  COALESCE(b.confirmed_bookings, 0)    AS confirmed_bookings,
  COALESCE(b.lifetime_spend, 0)        AS lifetime_spend,
  b.last_visit_date,
  b.first_booking_at,
  COALESCE(b.channels, '{}'::text[])   AS channels
FROM public.crm_contacts c
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                      AS total_bookings,
    count(*) FILTER (WHERE bk.status = 'confirmed')              AS confirmed_bookings,
    COALESCE(sum(bk.total_amount) FILTER (WHERE bk.status = 'confirmed'), 0) AS lifetime_spend,
    max(ts.slot_date) FILTER (WHERE bk.status = 'confirmed')     AS last_visit_date,
    min(bk.created_at)                                            AS first_booking_at,
    COALESCE(array_agg(DISTINCT bk.source) FILTER (WHERE bk.source IS NOT NULL), '{}'::text[]) AS channels
  FROM public.bookings bk
  LEFT JOIN public.time_slots ts ON ts.id = bk.slot_id
  WHERE (
    (lower(bk.customer_email) = lower(c.email) AND c.email IS NOT NULL)
    OR (bk.customer_phone = c.phone AND c.phone IS NOT NULL AND c.phone <> '')
    OR (bk.facebook_handle = c.facebook_handle AND c.facebook_handle IS NOT NULL AND c.facebook_handle <> '')
  )
) b ON true;
