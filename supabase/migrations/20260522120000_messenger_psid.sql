-- Separate Messenger PSIDs from Facebook vanity handles.
--
-- Background: the Airtable → crm_contacts importer was putting Messenger
-- Page-Scoped IDs (e.g. "27444692298470908", numeric, 15-17 digits) into
-- crm_contacts.facebook_handle because that's where the bot stored them
-- in the source table under the field name "fb_handle". The column was
-- semantically meant for vanity handles like "edestar.go", and any code
-- that builds a m.me/<handle> link from facebook_handle would break on
-- those numeric values.
--
-- This migration:
--   1. Adds crm_contacts.messenger_psid for the Send-API recipient ID
--   2. Backfills it from facebook_handle where the value looks like a PSID
--   3. Clears those numeric values out of facebook_handle so it only holds
--      real vanity handles going forward
--   4. Adds a check constraint so messenger_psid is always numeric
--   5. Helper RPC link_messenger_psid() for importers to attach a PSID
--      to an existing contact without rewriting upsert_crm_contact()

ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS messenger_psid TEXT;

ALTER TABLE public.crm_contacts
  DROP CONSTRAINT IF EXISTS crm_contacts_messenger_psid_numeric;
ALTER TABLE public.crm_contacts
  ADD CONSTRAINT crm_contacts_messenger_psid_numeric
  CHECK (messenger_psid IS NULL OR messenger_psid ~ '^[0-9]{15,}$');

-- A given PSID maps to exactly one contact on a given Page. Partial unique
-- so the existing many-NULLs case is fine.
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_messenger_psid_uniq
  ON public.crm_contacts (messenger_psid)
  WHERE messenger_psid IS NOT NULL;

-- Backfill — anything in facebook_handle that's purely numeric and at least
-- 15 chars long is a PSID, not a handle. Lift it out.
UPDATE public.crm_contacts
   SET messenger_psid  = facebook_handle,
       facebook_handle = NULL
 WHERE messenger_psid IS NULL
   AND facebook_handle ~ '^[0-9]{15,}$';

-- Helper for importers (Airtable Conversations, Waitlist_Guests, etc).
-- The existing upsert_crm_contact() takes a fixed 6-arg signature we don't
-- want to thrash, so PSID attachment is a separate post-upsert call.
--
-- Behavior:
--   - If contact_id already has a different non-null PSID, keep the existing
--     one (PSIDs don't change; trust the first source that supplied it).
--   - If a DIFFERENT contact_id already owns this PSID, do nothing and
--     return false (caller should reconcile manually).
--   - Otherwise set the PSID on the contact.
CREATE OR REPLACE FUNCTION public.link_messenger_psid(
  p_contact_id UUID,
  p_psid       TEXT
) RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_existing_psid TEXT;
  v_owner_id      UUID;
BEGIN
  IF p_contact_id IS NULL OR p_psid IS NULL OR p_psid = '' THEN
    RETURN false;
  END IF;
  IF p_psid !~ '^[0-9]{15,}$' THEN
    RETURN false;
  END IF;

  SELECT messenger_psid INTO v_existing_psid
    FROM public.crm_contacts WHERE id = p_contact_id;
  IF v_existing_psid IS NOT NULL AND v_existing_psid <> '' THEN
    RETURN v_existing_psid = p_psid;
  END IF;

  SELECT id INTO v_owner_id
    FROM public.crm_contacts WHERE messenger_psid = p_psid LIMIT 1;
  IF v_owner_id IS NOT NULL AND v_owner_id <> p_contact_id THEN
    RETURN false;
  END IF;

  UPDATE public.crm_contacts
     SET messenger_psid = p_psid
   WHERE id = p_contact_id;
  RETURN true;
END $$;

REVOKE ALL    ON FUNCTION public.link_messenger_psid(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.link_messenger_psid(UUID, TEXT) TO authenticated;
