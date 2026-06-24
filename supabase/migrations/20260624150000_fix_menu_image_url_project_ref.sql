-- ---------------------------------------------------------------------------
-- Repoint menu_image_url() at the live Supabase project.
--
-- The original helper (20260514180000_menu_images_bucket.sql) hardcoded the
-- old project ref `abpxielbycwpgzmocven`, which is no longer used by this
-- project. The live project is `lejwrpnuqpmfndzntsch` (see supabase/config.toml
-- and the runtime VITE_SUPABASE_URL). This forward migration replaces the
-- function on the live DB so any future call to set_menu_item_image() builds
-- URLs against the correct storage bucket.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.menu_image_url(_filename text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'https://lejwrpnuqpmfndzntsch.supabase.co/storage/v1/object/public/menu-images/'
    || _filename;
$$;
