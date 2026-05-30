-- Per-category pickup visibility. Lets admins hide an entire category
-- (e.g. "Group Sets" or "Reservation-only") from the pickup booking flow
-- without having to toggle every item inside it. Dine-in is intentionally
-- not gated at the category level — dine-in shows every category, matching
-- the item-level rule where dine-in availability is always-on.
ALTER TABLE public.menu_categories
  ADD COLUMN IF NOT EXISTS available_pickup BOOLEAN NOT NULL DEFAULT TRUE;

COMMENT ON COLUMN public.menu_categories.available_pickup IS
  'When false, the category and all its items are hidden from the pickup booking menu. Dine-in is unaffected.';
