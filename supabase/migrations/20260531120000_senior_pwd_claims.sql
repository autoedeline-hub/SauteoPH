-- Senior/PWD ID claims captured at booking time.
-- Each discounted cart line (one ID = one unit per RA 9994) produces one row.
-- The ID photo is stored in the private `senior-pwd-ids` bucket; this table
-- holds the path + OCR-derived fields so admins can verify without opening
-- the raw photo every time. Admins flip `verified` once they've checked the
-- physical ID against the photo.

-- ---------------------------------------------------------------------------
-- 1. Table
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.senior_pwd_claims (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_id       uuid        NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  reference_code   text        NOT NULL,
  kind             text        NOT NULL CHECK (kind IN ('senior', 'pwd')),
  full_name        text        NOT NULL DEFAULT '',
  id_number        text        NOT NULL DEFAULT '',
  date_of_birth    text        NOT NULL DEFAULT '',
  age              text        NOT NULL DEFAULT '',
  sex              text        NOT NULL DEFAULT '',
  date_of_issue    text        NOT NULL DEFAULT '',
  address          text        NOT NULL DEFAULT '',
  item_name        text        NOT NULL DEFAULT '',
  discount_amount  numeric(10,2) NOT NULL DEFAULT 0,
  id_photo_path    text,           -- NULL when photo upload failed or was skipped
  verified         boolean     NOT NULL DEFAULT false,
  verified_at      timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.senior_pwd_claims IS
  'One row per Senior/PWD discounted cart line. Linked to its booking; ID photo stored in senior-pwd-ids bucket.';

-- ---------------------------------------------------------------------------
-- 2. RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.senior_pwd_claims ENABLE ROW LEVEL SECURITY;

-- Anonymous customers can insert their own claim at booking time.
-- Guard: the booking must exist and have been created in the last 30 minutes
-- (same window as the payment-proofs upload policy) so the table can't be
-- bulk-spammed with fake claims.
CREATE POLICY "anon insert own claims"
ON public.senior_pwd_claims
FOR INSERT
TO anon, authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id          = booking_id
       AND b.created_at  > now() - interval '30 minutes'
  )
);

-- Only admins can read or update claims.
CREATE POLICY "admins read claims"
ON public.senior_pwd_claims
FOR SELECT
TO authenticated
USING ( public.has_role(auth.uid(), 'admin') );

CREATE POLICY "admins update claims"
ON public.senior_pwd_claims
FOR UPDATE
TO authenticated
USING  ( public.has_role(auth.uid(), 'admin') )
WITH CHECK ( public.has_role(auth.uid(), 'admin') );

-- ---------------------------------------------------------------------------
-- 3. Storage bucket for ID photos
-- ---------------------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'senior-pwd-ids',
  'senior-pwd-ids',
  false,           -- private: reads go through admin-minted signed URLs
  10485760,        -- 10 MB -- phone camera photos can be large
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif']
)
ON CONFLICT (id) DO UPDATE
  SET public             = false,
      file_size_limit    = 10485760,
      allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];

-- Anonymous customers can upload their ID photo immediately after the booking
-- is created (same 30-minute window). Path must be scoped to their booking:
--   senior-pwd-ids/bookings/<REFERENCE_CODE>/<filename>
CREATE POLICY "anon upload senior pwd ids"
ON storage.objects
FOR INSERT
TO anon, authenticated
WITH CHECK (
  bucket_id = 'senior-pwd-ids'
  AND array_length(storage.foldername(name), 1) >= 2
  AND (storage.foldername(name))[1] = 'bookings'
  AND EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.reference_code = (storage.foldername(name))[2]
       AND b.created_at     > now() - interval '30 minutes'
  )
);

-- Only admins can read stored ID photos (via signed URLs they mint).
CREATE POLICY "admins read senior pwd ids"
ON storage.objects
FOR SELECT
TO authenticated
USING (
  bucket_id = 'senior-pwd-ids'
  AND public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "admins delete senior pwd ids"
ON storage.objects
FOR DELETE
TO authenticated
USING (
  bucket_id = 'senior-pwd-ids'
  AND public.has_role(auth.uid(), 'admin')
);
