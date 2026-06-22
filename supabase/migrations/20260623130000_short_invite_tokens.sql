-- Switch invite tokens to short 6-character base36 format (A-Z + 0-9).
-- URLs change from /dine-in/Xx-Of5cdqpOWPWanQmYT3bYfv2n3DgEl (32 chars)
-- to /dine-in/AB3K9F (6 chars).
--
-- Two changes:
--   1. Purge unused old-format tokens (length > 7) — already expired or
--      never sent. Consumed tokens (used_at IS NOT NULL) are kept for the
--      booking audit trail.
--   2. Relax lookup_invite() minimum length check from 16 → 5 so the new
--      short tokens pass validation.

-- ---------------------------------------------------------------------------
-- 1. Clean up unused long-format tokens
-- ---------------------------------------------------------------------------
DELETE FROM public.booking_invites
WHERE used_at IS NULL
  AND length(token) > 7;

-- ---------------------------------------------------------------------------
-- 2. Update lookup_invite to accept tokens 5–128 chars
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_invite(_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite    public.booking_invites%ROWTYPE;
  v_slot_date DATE;
  v_slot_time TIME;
BEGIN
  IF _token IS NULL OR length(_token) < 5 OR length(_token) > 128 THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  SELECT * INTO v_invite
  FROM public.booking_invites
  WHERE token = _token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'invalid');
  END IF;

  IF v_invite.used_at IS NOT NULL THEN
    RETURN jsonb_build_object('status', 'used');
  END IF;

  IF v_invite.expires_at < now() THEN
    RETURN jsonb_build_object('status', 'expired');
  END IF;

  -- Locked slot, if any. NULL columns when the invite isn't slot-locked.
  IF v_invite.slot_id IS NOT NULL THEN
    SELECT ts.slot_date, ts.slot_time
      INTO v_slot_date, v_slot_time
      FROM public.time_slots ts
     WHERE ts.id = v_invite.slot_id;
  END IF;

  RETURN jsonb_build_object(
    'status',         'valid',
    'channel',        v_invite.channel,
    'customer_name',  v_invite.customer_name,
    'customer_email', v_invite.customer_email,
    'customer_phone', v_invite.customer_phone,
    'group_size',     v_invite.group_size,
    'expires_at',     v_invite.expires_at,
    'slot_id',        v_invite.slot_id,
    'slot_date',      v_slot_date,
    'slot_time',      v_slot_time
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.lookup_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_invite(TEXT) TO anon, authenticated;
