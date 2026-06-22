-- Add back-of-ID photo path to senior_pwd_claims.
-- The front photo path already exists (id_photo_path); this column stores the
-- path to the back of the same ID card when the customer uploads it.

ALTER TABLE public.senior_pwd_claims
  ADD COLUMN IF NOT EXISTS id_back_photo_path text;

COMMENT ON COLUMN public.senior_pwd_claims.id_back_photo_path IS
  'Storage path of the back-of-ID photo in the senior-pwd-ids bucket. NULL when not uploaded.';
