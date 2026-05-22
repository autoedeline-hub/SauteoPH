-- sync_messenger_contact() — one-call CRM upsert for the n8n scheduled
-- Airtable → Supabase sync. Wraps upsert_crm_contact() and
-- link_messenger_psid() so the workflow doesn't need two round-trips per
-- row. Also handles a few quirks of the Airtable source data:
--
--   - "fb_handle" sometimes holds a numeric PSID instead of a vanity
--     handle. We detect that, route the value to messenger_psid, and
--     leave facebook_handle NULL so the column stays semantically clean.
--   - Test-harness rows (TEST_* prefix on either handle or psid) are
--     ignored so prod CRM isn't polluted with bot fixtures.
--   - Tags are appended (set union, never replaced) so re-running keeps
--     existing tags intact.
--
-- The function is invoked by an n8n HTTP Request node POSTing to
-- `${SUPABASE_URL}/rest/v1/rpc/sync_messenger_contact` with the
-- service_role key (RLS-bypassing) so the scheduled workflow can write
-- without authenticating as an admin user.

CREATE OR REPLACE FUNCTION public.sync_messenger_contact(
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
  v_psid_pattern CONSTANT TEXT := '^[0-9]{15,}$';
BEGIN
  -- Skip rows the bot harness left behind.
  IF p_full_name ~* '^TEST_'
     OR p_facebook_handle ~* '^TEST_'
     OR p_psid ~* '^TEST_' THEN
    RETURN NULL;
  END IF;

  -- A numeric "fb_handle" is actually a PSID — route it.
  IF p_facebook_handle ~ v_psid_pattern THEN
    v_handle_clean := NULL;
    v_psid_clean   := COALESCE(p_psid, p_facebook_handle);
  ELSE
    v_handle_clean := NULLIF(p_facebook_handle, '');
    v_psid_clean   := p_psid;
  END IF;

  -- A passed psid that doesn't look like a PSID is junk — drop it.
  IF v_psid_clean IS NOT NULL AND v_psid_clean !~ v_psid_pattern THEN
    v_psid_clean := NULL;
  END IF;

  -- If we ALREADY know a contact with this PSID, reuse it. This avoids
  -- creating a new "Messenger guest" stub when the waitlist sync runs
  -- after a conversation row already created the contact.
  IF v_psid_clean IS NOT NULL THEN
    SELECT id INTO v_id
      FROM public.crm_contacts
     WHERE messenger_psid = v_psid_clean
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    v_id := public.upsert_crm_contact(
      p_full_name,
      p_email,
      p_phone,
      v_handle_clean,
      p_instagram_handle,
      COALESCE(p_source, 'messenger')
    );
  END IF;

  -- Attach PSID (no-op if already attached; refuses to clobber a
  -- different contact's PSID — see link_messenger_psid for behavior).
  IF v_psid_clean IS NOT NULL THEN
    PERFORM public.link_messenger_psid(v_id, v_psid_clean);
  END IF;

  -- Tag union — add any tags that aren't already there. Using array
  -- aggregation over DISTINCT keeps order stable enough for humans
  -- reading the column.
  IF array_length(p_tags, 1) IS NOT NULL THEN
    UPDATE public.crm_contacts
       SET tags = (
         SELECT array_agg(DISTINCT t ORDER BY t)
           FROM unnest(tags || p_tags) AS t
          WHERE t IS NOT NULL AND t <> ''
       )
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL    ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[]) TO authenticated, service_role;
