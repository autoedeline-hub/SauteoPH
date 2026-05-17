-- One-time-use booking invites.
--
-- Pain point: the web booking link can be reshared, so customers bypass the
-- Messenger waitlist. Fix: each waitlisted customer gets a unique tokenized
-- invite that's atomically consumed when they confirm their booking. Reusing
-- or sharing the link fails fast with "already used".
--
-- Lifecycle:
--   1. Admin generates an invite for a waitlist customer (manual button now;
--      n8n automation later). Defaults: 72-hour expiry, channel chosen at
--      generation time.
--   2. Customer clicks /book/<token>, the page calls lookup_invite() to
--      validate + prefill the form (no DB writes here).
--   3. On submit, create_booking(payload) takes invite_token, locks the row
--      FOR UPDATE, validates state in the same txn, marks it used on success.
--      Concurrent double-submits lose the race and get 'invite_already_used'.

CREATE TABLE IF NOT EXISTS public.booking_invites (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token           TEXT NOT NULL UNIQUE,
  channel         TEXT NOT NULL,

  customer_name   TEXT NOT NULL,
  customer_email  TEXT,
  customer_phone  TEXT,
  group_size      INT,

  -- Where this customer originally came from (waitlist source). Mirrors the
  -- bookings.source enum so we can attribute revenue back to the channel.
  source          TEXT,
  platform_id     TEXT,
  notes           TEXT,

  expires_at      TIMESTAMPTZ NOT NULL,
  used_at         TIMESTAMPTZ,
  used_booking_id UUID REFERENCES public.bookings(id) ON DELETE SET NULL,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_by      UUID REFERENCES auth.users(id),

  CONSTRAINT booking_invites_channel_check
    CHECK (channel IN ('dine_in', 'pickup')),
  CONSTRAINT booking_invites_source_check
    CHECK (source IS NULL OR source IN ('web', 'messenger', 'instagram', 'manual')),
  -- A used invite must have a used_at; used_booking_id may be NULL if the
  -- booking row was later deleted (FK is ON DELETE SET NULL).
  CONSTRAINT booking_invites_used_consistency
    CHECK ((used_at IS NULL AND used_booking_id IS NULL)
        OR (used_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS booking_invites_token_idx
  ON public.booking_invites (token);

-- "Show me all unused invites for X channel that haven't expired" — admin UI.
CREATE INDEX IF NOT EXISTS booking_invites_unused_idx
  ON public.booking_invites (channel, expires_at)
  WHERE used_at IS NULL;

ALTER TABLE public.booking_invites ENABLE ROW LEVEL SECURITY;

-- Admins fully manage invites (list, create, delete). Anon never SELECTs
-- directly — they go through lookup_invite() which sanitizes the response
-- (no internal IDs, no created_by, etc.).
DROP POLICY IF EXISTS "admins manage invites" ON public.booking_invites;
CREATE POLICY "admins manage invites" ON public.booking_invites
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- ---------------------------------------------------------------------------
-- lookup_invite — public, read-only, sanitized.
-- ---------------------------------------------------------------------------
-- Returns one of:
--   { status: 'invalid' }   — token not found / malformed
--   { status: 'used' }      — already consumed
--   { status: 'expired' }   — past expires_at
--   { status: 'valid', channel, customer_name, customer_email,
--     customer_phone, group_size, expires_at }
-- Deliberately does NOT leak created_by, used_booking_id, or any audit info.

CREATE OR REPLACE FUNCTION public.lookup_invite(_token TEXT)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.booking_invites%ROWTYPE;
BEGIN
  IF _token IS NULL OR length(_token) < 16 OR length(_token) > 128 THEN
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

  RETURN jsonb_build_object(
    'status',         'valid',
    'channel',        v_invite.channel,
    'customer_name',  v_invite.customer_name,
    'customer_email', v_invite.customer_email,
    'customer_phone', v_invite.customer_phone,
    'group_size',     v_invite.group_size,
    'expires_at',     v_invite.expires_at
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.lookup_invite(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.lookup_invite(TEXT) TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- create_booking — replaced to validate + consume the invite atomically.
-- ---------------------------------------------------------------------------
-- New optional payload fields:
--   invite_token TEXT      — required for anon callers (admins exempt)
--   pickup_mode  TEXT      — 'dine_in' (default) | 'personal_pickup' | 'lalamove' | 'grab'
--   courier_address TEXT   — required when pickup_mode is courier-based
--   allergy_notes TEXT
--   source       TEXT      — 'web' default; admins may override
--
-- Errors raised (caller maps to UI):
--   'invite_required'        P0001
--   'invite_invalid'         P0002
--   'invite_already_used'    P0003
--   'invite_expired'         P0004
--   'invite_channel_mismatch'P0005

CREATE OR REPLACE FUNCTION public.create_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_slot_id          uuid;
  v_customer_name    text;
  v_customer_email   text;
  v_customer_phone   text;
  v_facebook_handle  text;
  v_instagram_handle text;
  v_group_size       int;
  v_notes            text;
  v_payment_method   text;
  v_payment_ref      text;
  v_items            jsonb;
  v_item             jsonb;
  v_menu_item_id     uuid;
  v_quantity         int;
  v_unit_price       numeric(10,2);
  v_item_name        text;
  v_total            numeric(10,2) := 0;
  v_booking_id       uuid;
  v_reference_code   text;

  -- New fields
  v_invite_token     text;
  v_invite           public.booking_invites%ROWTYPE;
  v_pickup_mode      text;
  v_courier_address  text;
  v_allergy_notes    text;
  v_source           text;
  v_is_admin         boolean;
BEGIN
  -- ---- Caller role (admins bypass invite requirement) --------------------
  v_is_admin := public.has_role(auth.uid(), 'admin');

  -- ---- Extract top-level fields ------------------------------------------
  v_slot_id          := nullif(payload->>'slot_id', '')::uuid;
  v_customer_name    := nullif(trim(payload->>'customer_name'), '');
  v_customer_email   := lower(nullif(trim(payload->>'customer_email'), ''));
  v_customer_phone   := nullif(trim(payload->>'customer_phone'), '');
  v_facebook_handle  := nullif(trim(payload->>'facebook_handle'), '');
  v_instagram_handle := nullif(trim(payload->>'instagram_handle'), '');
  v_group_size       := nullif(payload->>'group_size', '')::int;
  v_notes            := nullif(trim(payload->>'notes'), '');
  v_payment_method   := coalesce(nullif(trim(payload->>'payment_method'), ''), 'maya_instapay');
  v_payment_ref      := nullif(trim(payload->>'payment_reference'), '');
  v_items            := payload->'items';

  v_invite_token     := nullif(trim(payload->>'invite_token'), '');
  v_pickup_mode      := coalesce(nullif(trim(payload->>'pickup_mode'), ''), 'dine_in');
  v_courier_address  := nullif(trim(payload->>'courier_address'), '');
  v_allergy_notes    := nullif(trim(payload->>'allergy_notes'), '');
  v_source           := coalesce(nullif(trim(payload->>'source'), ''), 'web');

  -- ---- Invite gate (anon callers only) -----------------------------------
  -- Admins create manual bookings without an invite. Everyone else MUST
  -- provide a valid, unused, unexpired token.
  IF v_invite_token IS NULL AND NOT v_is_admin THEN
    RAISE EXCEPTION 'invite_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_invite_token IS NOT NULL THEN
    -- Lock the invite row so two concurrent submits can't both succeed.
    SELECT * INTO v_invite
    FROM public.booking_invites
    WHERE token = v_invite_token
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'invite_invalid' USING ERRCODE = 'P0002';
    END IF;
    IF v_invite.used_at IS NOT NULL THEN
      RAISE EXCEPTION 'invite_already_used' USING ERRCODE = 'P0003';
    END IF;
    IF v_invite.expires_at < now() THEN
      RAISE EXCEPTION 'invite_expired' USING ERRCODE = 'P0004';
    END IF;

    -- Channel must match what the admin issued the invite for. Stops a
    -- dine-in invite from being used to book a pickup (or vice versa).
    IF v_pickup_mode = 'dine_in' AND v_invite.channel <> 'dine_in' THEN
      RAISE EXCEPTION 'invite_channel_mismatch' USING ERRCODE = 'P0005';
    END IF;
    IF v_pickup_mode <> 'dine_in' AND v_invite.channel <> 'pickup' THEN
      RAISE EXCEPTION 'invite_channel_mismatch' USING ERRCODE = 'P0005';
    END IF;

    -- Pull source/platform_id from the invite if the client didn't pass them.
    -- This keeps the booking attributed to the original waitlist channel.
    v_source := coalesce(v_invite.source, v_source);
  END IF;

  -- ---- Validate ----------------------------------------------------------
  IF v_slot_id IS NULL THEN
    RAISE EXCEPTION 'slot_id is required' USING ERRCODE = '22023';
  END IF;
  IF v_customer_name IS NULL OR length(v_customer_name) > 120 THEN
    RAISE EXCEPTION 'customer_name must be 1-120 characters' USING ERRCODE = '22023';
  END IF;
  IF v_customer_email IS NULL
     OR v_customer_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$'
     OR length(v_customer_email) > 254 THEN
    RAISE EXCEPTION 'customer_email is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_customer_phone IS NULL OR length(v_customer_phone) < 7 OR length(v_customer_phone) > 32 THEN
    RAISE EXCEPTION 'customer_phone must be 7-32 characters' USING ERRCODE = '22023';
  END IF;
  IF v_facebook_handle IS NOT NULL AND length(v_facebook_handle) > 80 THEN
    RAISE EXCEPTION 'facebook_handle too long' USING ERRCODE = '22023';
  END IF;
  IF v_instagram_handle IS NOT NULL AND length(v_instagram_handle) > 80 THEN
    RAISE EXCEPTION 'instagram_handle too long' USING ERRCODE = '22023';
  END IF;
  IF v_group_size IS NULL OR v_group_size < 1 OR v_group_size > 50 THEN
    RAISE EXCEPTION 'group_size must be 1-50' USING ERRCODE = '22023';
  END IF;
  IF v_notes IS NOT NULL AND length(v_notes) > 500 THEN
    RAISE EXCEPTION 'notes must be 500 characters or fewer' USING ERRCODE = '22023';
  END IF;
  IF v_payment_method NOT IN ('maya_instapay','gcash','bank_transfer','cash') THEN
    RAISE EXCEPTION 'payment_method is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_payment_ref IS NOT NULL AND length(v_payment_ref) > 64 THEN
    RAISE EXCEPTION 'payment_reference too long' USING ERRCODE = '22023';
  END IF;
  IF v_items IS NULL
     OR jsonb_typeof(v_items) <> 'array'
     OR jsonb_array_length(v_items) = 0 THEN
    RAISE EXCEPTION 'items must be a non-empty array' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(v_items) > 100 THEN
    RAISE EXCEPTION 'too many line items (max 100)' USING ERRCODE = '22023';
  END IF;
  IF v_pickup_mode NOT IN ('dine_in', 'personal_pickup', 'lalamove', 'grab') THEN
    RAISE EXCEPTION 'pickup_mode is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_pickup_mode IN ('lalamove', 'grab') AND v_courier_address IS NULL THEN
    RAISE EXCEPTION 'courier_address required for courier pickup' USING ERRCODE = '22023';
  END IF;
  IF v_allergy_notes IS NOT NULL AND length(v_allergy_notes) > 500 THEN
    RAISE EXCEPTION 'allergy_notes too long' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('web', 'messenger', 'instagram', 'manual') THEN
    RAISE EXCEPTION 'source is invalid' USING ERRCODE = '22023';
  END IF;

  -- ---- Reserve seats atomically ------------------------------------------
  IF NOT public.reserve_seats(v_slot_id, v_group_size) THEN
    RAISE EXCEPTION 'time slot is full, closed, or does not exist'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---- Insert booking shell ----------------------------------------------
  INSERT INTO public.bookings (
    slot_id, customer_name, customer_email, customer_phone,
    facebook_handle, instagram_handle, group_size, notes,
    status, total_amount,
    pickup_mode, courier_address, allergy_notes, source
  )
  VALUES (
    v_slot_id, v_customer_name, v_customer_email, v_customer_phone,
    v_facebook_handle, v_instagram_handle, v_group_size, v_notes,
    'pending', 0,
    v_pickup_mode, v_courier_address, v_allergy_notes, v_source
  )
  RETURNING id, reference_code INTO v_booking_id, v_reference_code;

  -- ---- Insert items (server-side prices) ---------------------------------
  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items)
  LOOP
    v_menu_item_id := nullif(v_item->>'menu_item_id', '')::uuid;
    v_quantity     := nullif(v_item->>'quantity', '')::int;

    IF v_menu_item_id IS NULL THEN
      RAISE EXCEPTION 'item missing menu_item_id' USING ERRCODE = '22023';
    END IF;
    IF v_quantity IS NULL OR v_quantity < 1 OR v_quantity > 100 THEN
      RAISE EXCEPTION 'item quantity must be 1-100' USING ERRCODE = '22023';
    END IF;

    SELECT name, price
      INTO v_item_name, v_unit_price
    FROM public.menu_items
    WHERE id = v_menu_item_id AND active = true;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'menu item % is unavailable', v_menu_item_id
        USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.booking_items (
      booking_id, menu_item_id, item_name, unit_price, quantity
    )
    VALUES (
      v_booking_id, v_menu_item_id, v_item_name, v_unit_price, v_quantity
    );

    v_total := v_total + (v_unit_price * v_quantity);
  END LOOP;

  -- ---- Finalize totals + payment shell -----------------------------------
  UPDATE public.bookings
     SET total_amount = v_total
   WHERE id = v_booking_id;

  INSERT INTO public.payments (booking_id, method, reference_number, status)
  VALUES (v_booking_id, v_payment_method, v_payment_ref, 'submitted');

  -- ---- Consume the invite (atomic — same txn as everything above) --------
  IF v_invite_token IS NOT NULL THEN
    UPDATE public.booking_invites
       SET used_at = now(),
           used_booking_id = v_booking_id
     WHERE token = v_invite_token;
  END IF;

  RETURN jsonb_build_object(
    'booking_id',     v_booking_id,
    'reference_code', v_reference_code,
    'total_amount',   v_total
  );
END;
$$;

REVOKE ALL    ON FUNCTION public.create_booking(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_booking(jsonb) TO anon, authenticated;
