-- Step 4: Fix the cascade chain that would crash on category deletion.
--
-- Before this migration:
--   menu_items.category_id    REFERENCES menu_categories(id) ON DELETE CASCADE
--   booking_items.menu_item_id REFERENCES menu_items(id)     -- no ON DELETE, NOT NULL
--
-- Problem: deleting a menu_category cascades to its menu_items, but
-- booking_items reference those menu_items with the default NO ACTION rule.
-- That throws a FK violation and rolls the whole delete back. Any category
-- that ever had a single order can never be deleted.
--
-- After this migration:
--   booking_items.menu_item_id REFERENCES menu_items(id) ON DELETE SET NULL
--   (column is also nullable so SET NULL can fire)
--
-- Order history is preserved because booking_items already snapshots
-- item_name, unit_price, and quantity at insert time. The only thing lost
-- on menu-item deletion is the live link back to the catalog.
--
-- For day-to-day "I don't want to sell this anymore", admins should still
-- prefer toggling menu_items.active = false rather than deleting. This
-- migration is a safety net for the cases where a real delete is needed.

-- 1. Allow NULLs so SET NULL has somewhere to go.
ALTER TABLE public.booking_items
  ALTER COLUMN menu_item_id DROP NOT NULL;

-- 2. Replace the FK with ON DELETE SET NULL.
ALTER TABLE public.booking_items
  DROP CONSTRAINT booking_items_menu_item_id_fkey;

ALTER TABLE public.booking_items
  ADD CONSTRAINT booking_items_menu_item_id_fkey
  FOREIGN KEY (menu_item_id)
  REFERENCES public.menu_items(id)
  ON DELETE SET NULL;
