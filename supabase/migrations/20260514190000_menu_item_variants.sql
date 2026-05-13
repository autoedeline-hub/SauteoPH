-- Add an optional `variants` jsonb array to menu_items.
--
-- Schema:
--   variants = NULL          → item has no options, tapping a card adds it
--                              directly to the cart at item.price.
--   variants = jsonb_array   → tapping the card opens a selection modal.
--                              Each entry is { name: text, price: numeric }.
--                              The customer picks one variant before adding.
--
-- We don't normalize variants into their own table for two reasons:
--   1. They're tightly bound to the parent menu item — no cross-item reuse.
--   2. Cococart-style menus rarely have more than a handful of variants per
--      item, and they tend to be flavors/sizes rather than separate SKUs.
-- If variants grow legs (analytics, per-variant stock, etc.) we can
-- normalize later. For now jsonb is the right level of formality.

ALTER TABLE public.menu_items
  ADD COLUMN IF NOT EXISTS variants jsonb DEFAULT NULL;

-- Guardrail: if a value is supplied, it must be an array. Prevents accidental
-- '{}' object shape that the frontend wouldn't render.
ALTER TABLE public.menu_items
  DROP CONSTRAINT IF EXISTS menu_items_variants_is_array_check;
ALTER TABLE public.menu_items
  ADD CONSTRAINT menu_items_variants_is_array_check
    CHECK (variants IS NULL OR jsonb_typeof(variants) = 'array');
