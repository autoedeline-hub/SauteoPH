-- Prevent duplicate open booking_invites rows per contact.
--
-- Bug: a guest who rejoins the dine-in waitlist over Messenger gets a Waiting
-- booking_invites row (token/used_at null) created by WF-DM-01. When staff then
-- generate an invite from the admin console, InviteCreator INSERTs a SEPARATE
-- row with a token instead of converting the Waiting one, leaving the guest with
-- two open (un-consumed) rows. After the invite later expires and WL-04 requeues
-- it, the guest holds two Waiting rows = a double queue position and a possible
-- double invite in the next WL-02 batch. Observed: Jenica Oficial, Michelle
-- Manimtim (2026-07-18).
--
-- Fix: whenever a row BECOMES an issued invite (token set) for a known contact,
-- delete that contact's leftover un-issued Waiting rows in the same transaction.
-- Runs for both the InviteCreator INSERT path and the WL-02 UPDATE path, so any
-- way an invite is issued collapses the contact down to one open row.
--
-- Why a trigger (not a frontend change): the invite sender fires on
-- `booking_invites AFTER INSERT WHEN token IS NOT NULL`, so converting a Waiting
-- row via UPDATE would not deliver the link. Keeping the INSERT (delivery works)
-- and cleaning the orphan in a SECURITY DEFINER trigger is race-safe, RLS-immune,
-- and covers every issue path with no client change. Only un-issued rows
-- (token null AND used_at null) are ever deleted -- never a live invite, never a
-- consumed one. Manual invites with no contact_id (contact_id null) are skipped.

CREATE OR REPLACE FUNCTION public.booking_invites_dedupe_waiting()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.token IS NOT NULL
     AND NEW.contact_id IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.token IS NULL) THEN
    DELETE FROM public.booking_invites
     WHERE contact_id = NEW.contact_id
       AND id <> NEW.id
       AND token IS NULL
       AND used_at IS NULL;
  END IF;
  RETURN NULL; -- AFTER trigger; return value is ignored
END;
$$;

DROP TRIGGER IF EXISTS booking_invites_dedupe_waiting_trg ON public.booking_invites;

CREATE TRIGGER booking_invites_dedupe_waiting_trg
AFTER INSERT OR UPDATE OF token ON public.booking_invites
FOR EACH ROW
EXECUTE FUNCTION public.booking_invites_dedupe_waiting();
