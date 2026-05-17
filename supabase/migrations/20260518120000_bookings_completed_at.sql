-- Adds `completed_at` to bookings so the admin Pipeline can show a final
-- "Picked up" (pickup channel) / "Visited" (dine-in channel) stage.
--
-- A confirmed booking that hasn't been completed sits in the "Confirmed"
-- pipeline column. Admin clicks "Mark complete" → completed_at is stamped
-- and the card slides to the final column.
--
-- We don't use a separate status enum value ('completed') because the
-- existing 'confirmed' status still applies (the reservation was honored);
-- completed_at is just a workflow timestamp. Keeps the status enum tight
-- and lets us derive "is this booking still upcoming?" cheaply with
-- (status = 'confirmed' AND completed_at IS NULL).

ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS bookings_completed_at_idx
  ON public.bookings (completed_at)
  WHERE completed_at IS NOT NULL;
