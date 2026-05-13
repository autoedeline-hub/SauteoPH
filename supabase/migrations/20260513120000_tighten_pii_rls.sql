-- Tighten Row Level Security on PII-bearing tables.
-- The original migration shipped FOR SELECT USING (true) on bookings,
-- booking_items, and payments, which lets anyone with the anon key read every
-- customer's name, email, phone, social handles, and payment refs. This
-- migration closes that hole. Public reads of customer-owned data now go
-- through a SECURITY DEFINER RPC gated by the random reference_code.

DROP POLICY IF EXISTS "public read own by id"     ON public.bookings;
DROP POLICY IF EXISTS "public read booking items" ON public.booking_items;
DROP POLICY IF EXISTS "public read payments"      ON public.payments;

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
    'booking', to_jsonb(b.*),
    'items', (
      SELECT coalesce(jsonb_agg(to_jsonb(bi.*)), '[]'::jsonb)
      FROM public.booking_items bi
      WHERE bi.booking_id = b.id
    ),
    'payment', (
      SELECT to_jsonb(p.*)
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
