-- Auto-fill booking_invites.platform_id from crm_contacts.messenger_psid
-- whenever an invite is linked to a contact.
--
-- Why: the n8n invite-sender workflow reads platform_id off the new row
-- to know who to message. Relying on the admin frontend to copy the
-- contact's PSID onto the invite is fragile — anyone who inserts an
-- invite via SQL, an admin script, or a future tool would silently skip
-- auto-send. A BEFORE INSERT trigger guarantees the value is always
-- populated when a contact_id is present.
--
-- The trigger only fills platform_id when it's NULL on insert, so manual
-- overrides (e.g. test invites sent to a different PSID) still work.

CREATE OR REPLACE FUNCTION public.booking_invites_set_platform_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.platform_id IS NULL AND NEW.contact_id IS NOT NULL THEN
    SELECT messenger_psid
      INTO NEW.platform_id
      FROM public.crm_contacts
     WHERE id = NEW.contact_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_invites_set_platform_id_trg
  ON public.booking_invites;

CREATE TRIGGER booking_invites_set_platform_id_trg
  BEFORE INSERT ON public.booking_invites
  FOR EACH ROW
  EXECUTE FUNCTION public.booking_invites_set_platform_id();

-- Backfill: any existing invite that has a contact_id but no
-- platform_id should now get one. Note this is an UPDATE, so it will
-- NOT fire the n8n webhook (only INSERTs do). Delete + regenerate any
-- invite you actually want auto-sent — see the README.
UPDATE public.booking_invites bi
   SET platform_id = c.messenger_psid
  FROM public.crm_contacts c
 WHERE bi.contact_id    = c.id
   AND bi.platform_id   IS NULL
   AND c.messenger_psid IS NOT NULL;
