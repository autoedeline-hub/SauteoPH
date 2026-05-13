-- Step 3 fix-up: on Supabase, pgcrypto lives in the `extensions` schema,
-- not `public`. The previous CREATE FUNCTION pinned search_path = public,
-- so gen_random_bytes was unresolvable. Re-create the function with an
-- explicit `extensions.` qualifier so it works regardless of search_path.

CREATE OR REPLACE FUNCTION public.generate_booking_reference()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZab';
  raw      bytea := extensions.gen_random_bytes(20);
  result   text  := '';
  i        int;
BEGIN
  FOR i IN 0..19 LOOP
    result := result || substr(alphabet, 1 + (get_byte(raw, i) % 32), 1);
  END LOOP;
  RETURN upper(result);
END;
$$;
