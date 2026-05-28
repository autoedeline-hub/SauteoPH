-- Separate dine-in and pickup time slots.
--
-- Why:
--   Until now time_slots was channel-blind — a single row served both
--   dine-in and pickup, so capacity got eaten by whichever channel booked
--   first and admin couldn't tell at a glance which slots were for which
--   audience. Adding a `channel` column lets the admin manage two
--   independent slot sets and gives each its own per-row seat counter.
--
-- Migration shape:
--   1. New column `channel` with CHECK + NOT NULL DEFAULT 'dine_in', so
--      every existing row backfills as dine-in (the historical use case)
--      and pickup starts empty under the new admin section.
--   2. Partial index on (channel, slot_date, slot_time) WHERE is_open
--      to keep the customer-facing filters fast.
--
-- No edits to reserve_seats / create_booking / lookup_invite — they all
-- operate on a single slot_id and don't care about channel. Slot-locked
-- invites also stay channel-agnostic at the SQL level (the channel match
-- between invite + slot is enforced upstream by the admin Waitlist tab,
-- which only resolves dine-in invites against dine-in slots).

ALTER TABLE public.time_slots
  ADD COLUMN IF NOT EXISTS channel TEXT NOT NULL DEFAULT 'dine_in'
    CHECK (channel IN ('dine_in', 'pickup'));

CREATE INDEX IF NOT EXISTS time_slots_channel_date_idx
  ON public.time_slots (channel, slot_date, slot_time)
  WHERE is_open = true;
