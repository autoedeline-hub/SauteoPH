-- Step 2: Lock down the payment-proofs storage bucket.
--
-- Before this migration:
--   * Bucket was public=true (anyone with a URL could read every screenshot)
--   * No size limit, no mime-type filter
--   * Storage INSERT policy: WITH CHECK (bucket_id = 'payment-proofs') -- wide open
--   * Storage SELECT policy: USING (bucket_id = 'payment-proofs')       -- wide open
--
-- After this migration:
--   * Bucket is private; reads go through signed URLs minted server-side
--   * 5MB max, only jpeg/png/webp
--   * Uploads must land under  bookings/<REFERENCE_CODE>/<filename>
--     and the reference must match a real pending booking created in the
--     last 30 minutes. This binds uploads to a customer's own booking.
--   * Only admins can read/update/delete objects directly.
--   * submit_payment_proof(_ref, _path) RPC lets the customer client
--     record the uploaded path against the payment row after the upload
--     succeeds — same SECURITY DEFINER pattern as create_booking.

-- ---------------------------------------------------------------------------
-- 1. Tighten the bucket itself: private + size + mime restrictions
-- ---------------------------------------------------------------------------
UPDATE storage.buckets
   SET public             = false,
       file_size_limit    = 5242880,  -- 5 MB
       allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp']
 WHERE id = 'payment-proofs';

-- ---------------------------------------------------------------------------
-- 2. Drop the wide-open storage policies
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "public upload payment proofs" ON storage.objects;
DROP POLICY IF EXISTS "public read payment proofs"   ON storage.objects;

-- ---------------------------------------------------------------------------
-- 3. Path-scoped INSERT: uploads must reference a real, recent, pending booking
--
-- Expected object name format:   bookings/<REFERENCE_CODE>/<filename>
--   storage.foldername(name) returns text[] of folder parts:
--     {'bookings', '<REFERENCE_CODE>'}
-- ---------------------------------------------------------------------------
CREATE POLICY "scoped upload payment proofs"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND array_length(storage.foldername(name), 1) >= 2
  AND (storage.foldername(name))[1] = 'bookings'
  AND EXISTS (
    SELECT 1
      FROM public.bookings b
     WHERE b.reference_code = (storage.foldername(name))[2]
       AND b.status         = 'pending'
       AND b.created_at     > now() - interval '30 minutes'
  )
);

-- ---------------------------------------------------------------------------
-- 4. Admins can read / update / delete payment proofs directly.
--    Customer reads should go through signed URLs (admin-minted) — there's
--    no policy that grants anon SELECT on these objects.
-- ---------------------------------------------------------------------------
CREATE POLICY "admins read payment proofs"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "admins update payment proofs"
ON storage.objects
FOR UPDATE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  bucket_id = 'payment-proofs'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "admins delete payment proofs"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'payment-proofs'
  AND public.has_role(auth.uid(), 'admin')
);

-- ---------------------------------------------------------------------------
-- 5. submit_payment_proof(_ref, _path)
--    Customer client calls this after a successful upload. It records the
--    storage path on the payment row, and verifies the path actually exists
--    in storage and is scoped to this booking. Status stays 'submitted' —
--    admins flip it to 'verified' in the dashboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_payment_proof(_ref text, _path text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ref          text := upper(trim(_ref));
  v_path         text := trim(_path);
  v_booking_id   uuid;
  v_expected_prefix text;
BEGIN
  IF v_ref IS NULL OR length(v_ref) = 0 THEN
    RAISE EXCEPTION 'reference is required' USING ERRCODE = '22023';
  END IF;
  IF v_path IS NULL OR length(v_path) = 0 OR length(v_path) > 512 THEN
    RAISE EXCEPTION 'path is required (max 512 chars)' USING ERRCODE = '22023';
  END IF;

  -- Path must be scoped to this booking's folder.
  v_expected_prefix := 'bookings/' || v_ref || '/';
  IF position(v_expected_prefix in v_path) <> 1 THEN
    RAISE EXCEPTION 'path must start with %', v_expected_prefix
      USING ERRCODE = '22023';
  END IF;

  -- Booking must exist, be pending, and recent.
  SELECT id INTO v_booking_id
    FROM public.bookings
   WHERE reference_code = v_ref
     AND status         = 'pending'
     AND created_at     > now() - interval '30 minutes';

  IF v_booking_id IS NULL THEN
    RAISE EXCEPTION 'booking not found, not pending, or expired'
      USING ERRCODE = 'P0002';
  END IF;

  -- The object must actually exist in the bucket (proves the upload succeeded
  -- and the path isn't fabricated).
  IF NOT EXISTS (
    SELECT 1 FROM storage.objects
     WHERE bucket_id = 'payment-proofs' AND name = v_path
  ) THEN
    RAISE EXCEPTION 'payment proof not found in storage'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.payments
     SET screenshot_url = v_path
   WHERE booking_id = v_booking_id;

  RETURN jsonb_build_object(
    'booking_id',     v_booking_id,
    'reference_code', v_ref,
    'screenshot_url', v_path
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_payment_proof(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_payment_proof(text, text) TO anon, authenticated;
