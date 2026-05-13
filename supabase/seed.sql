-- Seed initial menu data based on the Sautéo reference screenshots.
-- Idempotent: safe to paste & run more than once. Categories upsert by slug;
-- items only insert when a given category currently has zero rows.

BEGIN;

INSERT INTO public.menu_categories (name, slug, sort_order) VALUES
  ('À la carte Burger (NO SIDES)',                                  'a-la-carte-burger-no-sides',  10),
  ('Set Menu (WITH POTATO FRESH FRIES and DRINKS) (NO DESSERT)',    'set-menu-no-dessert',         20),
  ('À la carte Dessert',                                            'a-la-carte-dessert',          30),
  ('À la carte Drinks',                                             'a-la-carte-drinks',           40)
ON CONFLICT (slug) DO UPDATE
  SET name = EXCLUDED.name,
      sort_order = EXCLUDED.sort_order;

DO $$
DECLARE
  cat_dessert uuid;
  cat_setmenu uuid;
  cat_drinks  uuid;
  cat_burger  uuid;
BEGIN
  SELECT id INTO cat_dessert FROM public.menu_categories WHERE slug = 'a-la-carte-dessert';
  SELECT id INTO cat_setmenu FROM public.menu_categories WHERE slug = 'set-menu-no-dessert';
  SELECT id INTO cat_drinks  FROM public.menu_categories WHERE slug = 'a-la-carte-drinks';
  SELECT id INTO cat_burger  FROM public.menu_categories WHERE slug = 'a-la-carte-burger-no-sides';

  IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE category_id = cat_dessert) THEN
    INSERT INTO public.menu_items (category_id, name, description, price, image_url, active, sort_order) VALUES
      (cat_dessert, 'Merry Moo Artisan Ice Cream (100ml Cup)', NULL, 180, NULL, true, 10);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE category_id = cat_setmenu) THEN
    INSERT INTO public.menu_items (category_id, name, description, price, image_url, active, sort_order) VALUES
      (cat_setmenu,
        'BASIC SAUTÉO SET MENU',
        E'BASIC SAUTÉO HAMBURGER\nSAUTÉO FRESH FRIES WITH DIP\nBEVERAGE OF YOUR CHOICE\n(NO DESSERT)',
        850, NULL, true, 10),
      (cat_setmenu,
        'DOUBLE-CHEESE CHEESEBURGER SET MENU',
        E'DOUBLE CHEESE CHEESEBURGER\nSAUTÉO FRESH FRIES WITH DIP\nBEVERAGE OF YOUR CHOICE\n(NO DESSERT)',
        950, NULL, true, 20),
      (cat_setmenu,
        'DELUXE DOUBLE-CHEESE CHEESEBURGER SET MENU',
        E'DELUXE DOUBLE CHEESE CHEESEBURGER\nSAUTÉO FRESH FRIES WITH DIP\nBEVERAGE OF YOUR CHOICE\n(NO DESSERT)',
        1000, NULL, true, 30),
      (cat_setmenu,
        'HIROSHIMA HAMBURGER SET MENU',
        E'HIROSHIMA HAMBURGER\nSAUTÉO FRESH FRIES WITH DIP\nBEVERAGE OF YOUR CHOICE\n(NO DESSERT)',
        1000, NULL, true, 40),
      (cat_setmenu,
        'OTTO FORMAGGIO FUNGHI CHEESEBURGER SET MENU',
        E'OTTO FORMAGGIO FUNGHI CHEESEBURGER\nSAUTÉO FRESH FRIES WITH DIP\nBEVERAGE OF YOUR CHOICE\n(NO DESSERT)',
        1100, NULL, true, 50),
      (cat_setmenu,
        'CHEEZUROSHIMA CHEESEBURGER SET MENU',
        E'CHEEZUROSHIMA CHEESEBURGER\nSAUTÉO FRESH FRIES WITH DIP\nBEVERAGE OF YOUR CHOICE\n(NO DESSERT)',
        1100, NULL, true, 60);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE category_id = cat_drinks) THEN
    INSERT INTO public.menu_items (category_id, name, description, price, image_url, active, sort_order) VALUES
      (cat_drinks, 'Sautéo Signature Brewed Iced Tea', NULL, 200, NULL, true, 10),
      (cat_drinks, 'Coke',                              NULL, 100, NULL, true, 20);
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.menu_items WHERE category_id = cat_burger) THEN
    INSERT INTO public.menu_items (category_id, name, description, price, image_url, active, sort_order) VALUES
      (cat_burger, 'BASIC SAUTÉO BURGER',                NULL, 450, NULL, true, 10),
      (cat_burger, 'DOUBLE-CHEESE CHEESEBURGER',         NULL, 550, NULL, true, 20),
      (cat_burger, 'DELUXE DOUBLE-CHEESE CHEESEBURGER',  NULL, 600, NULL, true, 30),
      (cat_burger, 'HIROSHIMA BURGER',                   NULL, 600, NULL, true, 40),
      (cat_burger, 'OTTO FORMAGGIO FUNGHI CHEESEBURGER', NULL, 700, NULL, true, 50),
      (cat_burger, 'CHEEZUROSHIMA CHEESEBURGER',         NULL, 700, NULL, true, 60);
  END IF;
END $$;

COMMIT;
