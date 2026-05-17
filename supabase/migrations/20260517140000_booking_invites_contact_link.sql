-- Link each invite back to the crm_contacts row it was issued for. Lets
-- the admin "Generate invite" button on a contact persist the connection,
-- which makes the Invites tab show "issued for <contact>" and (later)
-- prevents accidentally issuing two unused invites to the same person.
--
-- Nullable + ON DELETE SET NULL so:
--   * Manual one-off invites (someone not in contacts yet) still work
--   * Cleaning up a contact doesn't cascade-delete their invite history

ALTER TABLE public.booking_invites
  ADD COLUMN IF NOT EXISTS contact_id UUID
    REFERENCES public.crm_contacts(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS booking_invites_contact_id_idx
  ON public.booking_invites (contact_id)
  WHERE contact_id IS NOT NULL;
