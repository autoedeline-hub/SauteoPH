-- Add 'courier' to the bookings.pickup_mode CHECK constraint.
-- The RPC already accepts 'courier' (20260624130000) but the table-level
-- constraint still only allowed dine_in / personal_pickup / lalamove / grab,
-- causing a constraint violation on every courier pickup booking.

ALTER TABLE public.bookings
  DROP CONSTRAINT IF EXISTS bookings_pickup_mode_check;

ALTER TABLE public.bookings
  ADD CONSTRAINT bookings_pickup_mode_check
    CHECK (pickup_mode IS NULL OR pickup_mode IN ('dine_in', 'personal_pickup', 'lalamove', 'grab', 'courier'))
    NOT VALID;
