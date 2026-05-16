-- Extends bookings with fields previously tracked in the Airtable Reservations
-- table: channel of origin, dine-in vs pickup logistics, allergy info, refund
-- accounting, and the confirmation timestamp.

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS source            TEXT,
  ADD COLUMN IF NOT EXISTS platform_id       TEXT,
  ADD COLUMN IF NOT EXISTS pickup_mode       TEXT,
  ADD COLUMN IF NOT EXISTS courier_address   TEXT,
  ADD COLUMN IF NOT EXISTS allergy_notes     TEXT,
  ADD COLUMN IF NOT EXISTS credit_remaining  NUMERIC(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS refund_status     TEXT,
  ADD COLUMN IF NOT EXISTS confirmed_at      TIMESTAMPTZ;

-- Existing bookings all came from the web app.
UPDATE public.bookings SET source = 'web' WHERE source IS NULL;

-- Constrain enums so a typo in the bot or admin UI fails fast.
ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_source_check,
  ADD  CONSTRAINT bookings_source_check
    CHECK (source IS NULL OR source IN ('web', 'messenger', 'instagram', 'manual'));

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_pickup_mode_check,
  ADD  CONSTRAINT bookings_pickup_mode_check
    CHECK (pickup_mode IS NULL OR pickup_mode IN ('dine_in', 'personal_pickup', 'lalamove', 'grab'));

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_refund_status_check,
  ADD  CONSTRAINT bookings_refund_status_check
    CHECK (refund_status IS NULL OR refund_status IN ('available', 'partially_redeemed', 'fully_redeemed', 'forfeited'));

-- Helpful indexes for the admin filter UI and the chatbot lookups.
CREATE INDEX IF NOT EXISTS bookings_source_idx       ON public.bookings (source);
CREATE INDEX IF NOT EXISTS bookings_platform_id_idx  ON public.bookings (platform_id) WHERE platform_id IS NOT NULL;
