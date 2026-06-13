-- site_content — editable guest-facing copy (booking/order agreements).
-- One row per page; `rules` is an ordered array of {id,title,body}. Icons,
-- sections, and order stay hardcoded in the page components and are matched
-- to this text by `id`. Mirrors the faq table's public-read / admin-write model.

CREATE TABLE IF NOT EXISTS public.site_content (
  key         TEXT PRIMARY KEY,
  rules       JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.site_content ENABLE ROW LEVEL SECURITY;

-- Public pages read via the anon key; admins manage.
CREATE POLICY "public read site content" ON public.site_content
  FOR SELECT USING (true);
CREATE POLICY "admins manage site content" ON public.site_content
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE OR REPLACE FUNCTION public.touch_site_content_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS site_content_touch ON public.site_content;
CREATE TRIGGER site_content_touch
  BEFORE UPDATE ON public.site_content
  FOR EACH ROW EXECUTE FUNCTION public.touch_site_content_updated_at();

-- Seed with the current hardcoded copy so nothing changes visually until edited.
INSERT INTO public.site_content (key, rules) VALUES
('dinein_rules', $json$[
  {"id":"available_days","title":"Available Wednesday – Sunday","body":"Seatings are 1 PM, 3 PM, 5 PM, and 7 PM on Wed–Sun only. We are closed on Mondays and Tuesdays."},
  {"id":"invite_only","title":"Reservations are invite-only","body":"Dine-in is waitlist-only. Message us to join the waitlist — we'll send a personal, single-use booking link valid for 24 hours when a seat opens for you."},
  {"id":"full_payment","title":"Full payment secures your seat","body":"100% pre-payment via GCash or Maya is required. Send your payment screenshot after booking — your reservation is only confirmed once our team verifies it."},
  {"id":"no_refunds","title":"No refunds — no-shows forfeit payment","body":"All sales are final. Cancellations and no-shows forfeit your payment in full. A no-show is recorded 1 hour after your slot time. Please book only if you are sure."},
  {"id":"arrive_on_time","title":"Arrive on time — 15-minute grace","body":"Please arrive on time; we recommend 15 minutes early as parking is limited. Your table is held for 15 minutes past your slot, then may be released to a waitlist or walk-in guest."},
  {"id":"party_size","title":"Book your exact party size","body":"Reserve only the seats you need and arrive with the exact party size booked. We can't seat extra guests beyond your reservation."},
  {"id":"intimate_setting","title":"An intimate setting — smart casual","body":"Sautéo is an intimate venue. Dress smart casual, keep voices low, and please bring no outside food or drinks — be considerate of fellow diners."}
]$json$::jsonb),
('pickup_rules', $json$[
  {"id":"cutoff","title":"Cut-off is 6 PM the day before","body":"Orders must be placed by 6:00 PM the day before your chosen pick-up date. Late orders will not be accepted."},
  {"id":"available_days","title":"Available Wednesday – Sunday","body":"Pick-up windows are 4 PM, 6 PM, and 8 PM on Wed–Sun only. No pick-up on Mondays and Tuesdays."},
  {"id":"full_payment","title":"Full payment secures your order","body":"Send your GCash or Maya payment screenshot after checkout. Your order is only confirmed once payment is verified by our team."},
  {"id":"no_refunds","title":"No refunds — no exceptions","body":"All pick-up orders are non-refundable. Cancellations forfeit your payment in full. Please order only if you are sure."},
  {"id":"be_on_time","title":"Be on time for pick-up","body":"Orders are prepared fresh for your slot. Please arrive on time. Unclaimed orders after 30 minutes may be forfeited."}
]$json$::jsonb)
ON CONFLICT (key) DO NOTHING;
