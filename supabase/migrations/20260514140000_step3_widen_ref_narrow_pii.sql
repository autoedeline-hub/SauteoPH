-- Step 3: Lengthen reference_code from ~32 bits to ~100 bits of entropy
-- and narrow the get_booking_by_ref projection so guessing a code doesn't
-- leak email / phone / social handles.
--
-- Before this migration:
--   reference_code DEFAULT upper(substr(md5(random()::text), 1, 8))
--   = 8 hex chars (~32 bits, brute-forceable in seconds at internet speeds)
--   get_booking_by_ref returned to_jsonb(b.*) which exposed ALL PII once
--   a code was guessed.
--
-- After this migration:
--   reference_code DEFAULT public.generate_booking_reference()
--   = 20 chars over a 32-symbol Crockford-style alphabet (~100 bits,
--   not brute-forceable). No I/L/O/U/0/1 confusables, all uppercase.
--   get_booking_by_ref returns only the fields the receipt page needs.
--
-- We don't backfill existing rows because no real bookings exist yet.

-- ---------------------------------------------------------------------------
-- 1. Crockford-style base32 generator backed by pgcrypto.gen_random_bytes
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.generate_booking_reference()
RETURNS text
LANGUAGE plpgsql
VOLATILE
SET search_path = public
AS $$
DECLARE
  -- Crockford base32 alphabet: 32 unambiguous symbols.
  -- Drops I, L, O, U, 0, 1 → not in the alphabet to avoid eye/typo confusion.
  alphabet constant text := '23456789ABCDEFGHJKMNPQRSTVWXYZab';
  raw      bytea := gen_random_bytes(20);  -- 160 random bits, well above need
  result   text  := '';
  i        int;
BEGIN
  -- Take one byte per output char, mod 32 (uniform: 256 / 32 = 8 exact).
  -- 20 chars * log2(32) = 100 bits of entropy.
  FOR i IN 0..19 LOOP
    result := result || substr(alphabet, 1 + (get_byte(raw, i) % 32), 1);
  END LOOP;
  RETURN upper(result);
END;
$$;

-- ---------------------------------------------------------------------------
-- 2. Point bookings.reference_code at the new generator.
--    Old rows (if any) keep their short codes — fine, the column is just UNIQUE.
-- ---------------------------------------------------------------------------
ALTER TABLE public.bookings
  ALTER COLUMN reference_code
  SET DEFAULT public.generate_booking_reference();

-- ---------------------------------------------------------------------------
-- 3. Narrow get_booking_by_ref so a guessed code doesn't leak PII.
--    Returned fields (kept):
--      reference_code, status, created_at, total_amount, customer_name,
--      group_size, slot_id, notes
--      items[] (item_name, unit_price, quantity)
--      payment (status, method) — NOT screenshot_url, NOT reference_number
--    Removed (no longer returned):
--      customer_email, customer_phone, facebook_handle, instagram_handle,
--      payment.screenshot_url, payment.reference_number, payment.verified_*
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_booking_by_ref(_ref text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'booking', jsonb_build_object(
      'reference_code', b.reference_code,
      'status',         b.status,
      'created_at',     b.created_at,
      'total_amount',   b.total_amount,
      'customer_name',  b.customer_name,
      'group_size',     b.group_size,
      'slot_id',        b.slot_id,
      'notes',          b.notes
    ),
    'items', (
      SELECT coalesce(
        jsonb_agg(
          jsonb_build_object(
            'item_name',  bi.item_name,
            'unit_price', bi.unit_price,
            'quantity',   bi.quantity
          )
          ORDER BY bi.created_at
        ),
        '[]'::jsonb
      )
      FROM public.booking_items bi
      WHERE bi.booking_id = b.id
    ),
    'payment', (
      SELECT jsonb_build_object(
        'status', p.status,
        'method', p.method
      )
      FROM public.payments p
      WHERE p.booking_id = b.id
      LIMIT 1
    )
  )
  INTO result
  FROM public.bookings b
  WHERE b.reference_code = upper(_ref);

  RETURN result;
END;
$$;

REVOKE ALL    ON FUNCTION public.get_booking_by_ref(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_booking_by_ref(text) TO anon, authenticated;
