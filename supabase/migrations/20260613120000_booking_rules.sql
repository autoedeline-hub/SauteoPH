-- Booking rules shown to guests on the dine-in and pickup booking pages.
-- Replaces the old `site_content` JSON-blob approach (which never had a
-- working `value` column) with a real table so admins can create, edit,
-- and delete individual rules — mirrors the `faq` table's shape/RLS.

CREATE TABLE IF NOT EXISTS public.booking_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  section     TEXT NOT NULL CHECK (section IN ('dinein','pickup')),
  group_label TEXT NOT NULL DEFAULT 'General',
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  sort_order  INT  NOT NULL DEFAULT 0,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS booking_rules_section_idx ON public.booking_rules (section, sort_order);

ALTER TABLE public.booking_rules ENABLE ROW LEVEL SECURITY;

-- Guests read rules via the anon key on the booking pages; admins manage.
CREATE POLICY "public read booking_rules" ON public.booking_rules
  FOR SELECT USING (true);
CREATE POLICY "admins manage booking_rules" ON public.booking_rules
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_booking_rules_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_rules_touch ON public.booking_rules;
CREATE TRIGGER booking_rules_touch
  BEFORE UPDATE ON public.booking_rules
  FOR EACH ROW EXECUTE FUNCTION public.touch_booking_rules_updated_at();

-- Seed with the rules previously hardcoded as defaults in src/lib/siteContent.ts
INSERT INTO public.booking_rules (section, group_label, title, body, sort_order)
SELECT * FROM (VALUES
  ('dinein', 'Reservation Rules', 'Available Wednesday – Sunday', 'Seatings are 1 PM, 3 PM, 5 PM, and 7 PM on Wed–Sun only. We are closed on Mondays and Tuesdays.', 0),
  ('dinein', 'Reservation Rules', 'Reservations are invite-only', 'Dine-in is waitlist-only. Message us to join the waitlist — we''ll send a personal, single-use booking link valid for 24 hours when a seat opens for you.', 1),
  ('dinein', 'Reservation Rules', 'Full payment secures your seat', '100% pre-payment via GCash or Maya is required. Send your payment screenshot after booking — your reservation is only confirmed once our team verifies it.', 2),
  ('dinein', 'Reservation Rules', 'No refunds — no-shows forfeit payment', 'All sales are final. Cancellations and no-shows forfeit your payment in full. A no-show is recorded 1 hour after your slot time. Please book only if you are sure.', 3),
  ('dinein', 'Dining Guidelines', 'Arrive on time — 15-minute grace', 'Please arrive on time; we recommend 15 minutes early as a courtesy to your party. Your table is held for 15 minutes past your slot before it is released.', 4),
  ('dinein', 'Dining Guidelines', 'Party size is fixed at booking', 'The group size you enter is the number of seats reserved. Additional guests on the day may not be accommodated. Please book accurately.', 5),
  ('dinein', 'Dining Guidelines', 'Intimate, shared dining experience', 'Sautéo PH is a small, curated dining venue. Guests share the ambiance — please be mindful of noise levels and observe a smart casual dress code.', 6),
  ('pickup', 'Order & Payment', 'Order confirmation', 'Your pickup order is confirmed once payment is verified. You will be notified via the contact details provided.', 0),
  ('pickup', 'Order & Payment', 'Payment required at checkout', 'Full payment via Maya/GCash is required to confirm your pickup order. Your reference number must be submitted in the booking form.', 1),
  ('pickup', 'Pickup Policy', 'Pickup time window', 'Please collect your order within 30 minutes of your selected slot. Unclaimed orders are forfeited after this window.', 2),
  ('pickup', 'Pickup Policy', 'No changes after confirmation', 'Order changes or cancellations are not accepted once your booking is confirmed and payment verified.', 3),
  ('pickup', 'Pickup Policy', 'Subject to availability', 'Menu items are subject to availability. Our team may contact you if a substitution is needed.', 4)
) AS seed(section, group_label, title, body, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM public.booking_rules);
