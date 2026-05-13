-- Storage bucket for public menu item images + helpers for mapping uploads.
--
-- After this migration:
--   * menu-images is a PUBLIC bucket so anonymous customers can fetch photos.
--   * 5 MB / image-only mime types prevent abuse.
--   * RLS: anyone can SELECT, only admins can INSERT/UPDATE/DELETE.
--   * Two helpers (callable only by the postgres superuser / SQL Editor):
--       - menu_image_url(filename)            -> returns the public URL
--       - set_menu_item_image(item_name, fn)  -> updates the row's image_url
--
-- Workflow:
--   1. Apply this migration (paste-and-run in the SQL Editor, like the rest).
--   2. Upload images to the menu-images bucket via the Supabase dashboard
--      Storage UI (drag-and-drop). Use lowercase-kebab-case filenames.
--   3. From the SQL Editor, call set_menu_item_image() once per image.

-- ---------------------------------------------------------------------------
-- 1. Bucket: public read, with size + mime guardrails
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'menu-images',
  'menu-images',
  true,
  5242880,  -- 5 MB
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/avif']
)
ON CONFLICT (id) DO UPDATE
  SET public             = EXCLUDED.public,
      file_size_limit    = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- 2. RLS policies: public can read, only admins can write
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public read menu images"   ON storage.objects;
DROP POLICY IF EXISTS "admins write menu images"  ON storage.objects;
DROP POLICY IF EXISTS "admins update menu images" ON storage.objects;
DROP POLICY IF EXISTS "admins delete menu images" ON storage.objects;

CREATE POLICY "public read menu images"
ON storage.objects FOR SELECT
USING (bucket_id = 'menu-images');

CREATE POLICY "admins write menu images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'menu-images'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "admins update menu images"
ON storage.objects FOR UPDATE
TO authenticated
USING      (bucket_id = 'menu-images' AND public.has_role(auth.uid(), 'admin'))
WITH CHECK (bucket_id = 'menu-images' AND public.has_role(auth.uid(), 'admin'));

CREATE POLICY "admins delete menu images"
ON storage.objects FOR DELETE
TO authenticated
USING (bucket_id = 'menu-images' AND public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- 3. Helper: build a public URL from a filename
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.menu_image_url(_filename text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT 'https://abpxielbycwpgzmocven.supabase.co/storage/v1/object/public/menu-images/'
    || _filename;
$$;

-- ---------------------------------------------------------------------------
-- 4. Helper: set an item's image_url by exact name. Returns the affected row.
--    Locked to the postgres superuser (Supabase SQL Editor) — anon and
--    authenticated cannot call this to escalate menu changes.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_menu_item_image(_item_name text, _filename text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id  uuid;
  v_url text;
BEGIN
  v_url := public.menu_image_url(_filename);

  UPDATE public.menu_items
     SET image_url = v_url
   WHERE name = _item_name
   RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    RAISE EXCEPTION 'no menu item with name "%"', _item_name
      USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object(
    'id',        v_id,
    'name',      _item_name,
    'image_url', v_url
  );
END;
$$;

REVOKE ALL ON FUNCTION public.set_menu_item_image(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_menu_item_image(text, text) FROM anon, authenticated;
