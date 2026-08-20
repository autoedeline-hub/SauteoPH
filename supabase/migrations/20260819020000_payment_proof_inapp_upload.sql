-- Enable in-app payment-proof upload on the booking receipt screen.
--
-- The storage bucket, the path-scoped policies and submit_payment_proof() have
-- existed since 20260514130000, but no guest-facing UI ever called them. Wiring
-- that UI up exposed two defects that would have made the feature actively
-- harmful, both fixed here:
--
-- 1. THE WINDOW WAS SHORTER THAN THE BOOKING'S LIFE.
--    Both the storage INSERT policy and the RPC required the booking to be
--    under 30 minutes old. WF08 (Expire Stale Pending Payments) does not expire
--    a pending booking until 60 minutes, sending only a reminder at 30. A guest
--    paying at minute 40 therefore had a live booking but was refused by both
--    the upload and the RPC ("booking not found, not pending, or expired").
--    Both are widened to 60 minutes so the upload window matches the booking.
--
-- 2. THE RPC DID NOT STAMP bookings.payment_proof_at.
--    It only wrote payments.screenshot_url. Two live mechanisms read
--    bookings.payment_proof_at instead:
--      * WF08 skips auto-cancellation for bookings that have it set, so an
--        in-app uploader would still have been auto-cancelled at 60 minutes
--        despite having paid.
--      * The admin Orders tab renders its "Proof received" pill from it
--        (SauteoPH 3460e8a), so an in-app upload would have been invisible to
--        staff in exactly the view they use to verify payments.
--    Stamping it makes the in-app path behave identically to the Messenger
--    path, which WF-DM-01 already stamps.
--
-- Idempotent and safe to re-run.

-- ---------------------------------------------------------------------------
-- 1. Widen the storage INSERT window to match WF08's 60-minute expiry
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "scoped upload payment proofs" ON storage.objects;

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
       AND b.created_at     > now() - interval '60 minutes'
  )
);

-- ---------------------------------------------------------------------------
-- 2. submit_payment_proof: 60-minute window + stamp bookings.payment_proof_at
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

  -- Booking must exist, be pending, and still be inside WF08's 60-minute life.
  SELECT id INTO v_booking_id
    FROM public.bookings
   WHERE reference_code = v_ref
     AND status         = 'pending'
     AND created_at     > now() - interval '60 minutes';

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

  -- Parity with the Messenger path (WF-DM-01 'Flag Payment Proof'): this is
  -- what stops WF08 auto-cancelling the guest and what lights the admin
  -- Orders "Proof received" pill. Only stamp the first proof received.
  UPDATE public.bookings
     SET payment_proof_at = now()
   WHERE id = v_booking_id
     AND payment_proof_at IS NULL;

  RETURN jsonb_build_object(
    'booking_id',     v_booking_id,
    'reference_code', v_ref,
    'screenshot_url', v_path
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.submit_payment_proof(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_payment_proof(text, text) TO anon, authenticated;
