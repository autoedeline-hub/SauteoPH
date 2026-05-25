-- Auto-fill bookings.platform_id from the matching CRM contact so the
-- n8n order-confirmation workflow has a recipient when the customer's
-- booking is verified.
--
-- Mirrors the equivalent trigger on booking_invites: at INSERT time, if
-- platform_id is left NULL by the caller, look up the matching contact
-- (by email / phone / facebook_handle — same heuristic the rest of the
-- admin uses) and copy that contact's messenger_psid onto the booking.
-- Manual platform_id overrides (e.g. admin entering a different PSID for
-- testing) are preserved because the trigger only fills NULLs.
--
-- No-removal: we don't strip platform_id on UPDATE. Once attached, the
-- PSID is a stable identifier for the conversation thread.

CREATE OR REPLACE FUNCTION public.bookings_set_platform_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.platform_id IS NULL THEN
    SELECT c.messenger_psid INTO NEW.platform_id
      FROM public.crm_contacts c
     WHERE c.messenger_psid IS NOT NULL
       AND (
            (NEW.customer_email IS NOT NULL
              AND c.email IS NOT NULL
              AND lower(c.email) = lower(NEW.customer_email))
         OR (NEW.customer_phone IS NOT NULL AND NEW.customer_phone <> ''
              AND c.phone = NEW.customer_phone)
         OR (NEW.facebook_handle IS NOT NULL AND NEW.facebook_handle <> ''
              AND c.facebook_handle = NEW.facebook_handle)
       )
     LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_set_platform_id_trg ON public.bookings;

CREATE TRIGGER bookings_set_platform_id_trg
  BEFORE INSERT ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_set_platform_id();

-- ---------------------------------------------------------------------------
-- Backfill: existing pending/confirmed bookings that don't have a PSID yet
-- get one if we can find a matching contact. Note: this is an UPDATE, so
-- the Supabase webhook will fire — but the n8n guard requires
-- status='confirmed' AND old_status!='confirmed', and this update doesn't
-- change status, so no stray confirmation messages will be sent.
-- ---------------------------------------------------------------------------
UPDATE public.bookings b
   SET platform_id = c.messenger_psid
  FROM public.crm_contacts c
 WHERE b.platform_id IS NULL
   AND c.messenger_psid IS NOT NULL
   AND (
        (b.customer_email IS NOT NULL
          AND c.email IS NOT NULL
          AND lower(c.email) = lower(b.customer_email))
     OR (b.customer_phone IS NOT NULL AND b.customer_phone <> ''
          AND c.phone = b.customer_phone)
     OR (b.facebook_handle IS NOT NULL AND b.facebook_handle <> ''
          AND c.facebook_handle = b.facebook_handle)
   );
