-- create_booking - pass platform_id through to the bookings row.
--
-- ROOT CAUSE (smoke test #41 partial, 2026-06-03):
-- The pickup form was updated to send `payload.platform_id = ?pid` (the
-- Messenger PSID carried in the booking link), but create_booking never
-- read or inserted it. Every booking landed with platform_id = NULL and
-- relied entirely on the bookings_set_platform_id BEFORE-INSERT trigger to
-- recover the PSID by matching a CRM contact on email/phone/facebook_handle.
-- A brand-new Messenger guest who isn't yet a crm_contacts row (with a
-- messenger_psid) therefore got NULL platform_id -> WF-ORDER-CONFIRM-01 had
-- no DM recipient -> no confirmation DM. That is the #41 symptom.
--
-- This migration is identical to the create_booking defined in
-- 20260529120000_waitlist_requested_slot.sql EXCEPT for three additions,
-- each tagged `-- [platform_id]`:
--   1. declare v_platform_id
--   2. extract payload->>'platform_id'  (+ honour the invite fallback the
--      existing comment at the invite block already promised but never did)
--   3. include platform_id in the bookings INSERT
--
-- The bookings_set_platform_id trigger only fills NULLs, so a caller-supplied
-- platform_id is preserved and wins over the CRM-contact fallback.
--
-- ALSO FIXES a separate regression found the same session: the 20260529
-- waitlist migration reproduced create_booking but pasted an older invite
-- gate, dropping the `AND v_pickup_mode = 'dine_in'` qualifier added by
-- 20260524_open_pickup_bookings. That silently re-closed public pickup -
-- every anon /pick-up order had been failing with invite_required (P0001)
-- since 20260529. This migration restores the conditional gate so pickup is
-- public again while dine-in stays invite-only.
-- ---------------------------------------------------------------------------
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
  v_platform_id      text;        -- [platform_id] 1. declare
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
  v_platform_id      := nullif(trim(payload->>'platform_id'), '');  -- [platform_id] 2. extract

  -- ---- Invite gate -------------------------------------------------------
  -- Dine-in stays invite-only (admins exempt). Pickup is open to the
  -- public: callers may pass a token for prefill/attribution but it's
  -- no longer required. (Restores the 20260524 open-pickup rule that the
  -- 20260529 waitlist migration accidentally dropped - see header note.)
  IF v_invite_token IS NULL AND NOT v_is_admin AND v_pickup_mode = 'dine_in' THEN
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

    -- Slot lock. A slot-locked invite forces its slot: derive it when the
    -- client didn't send one, and reject a payload that points elsewhere.
    IF v_invite.slot_id IS NOT NULL THEN
      IF v_slot_id IS NULL THEN
        v_slot_id := v_invite.slot_id;
      ELSIF v_slot_id <> v_invite.slot_id THEN
        RAISE EXCEPTION 'invite_slot_mismatch' USING ERRCODE = 'P0006';
      END IF;
    END IF;

    -- Pull source/platform_id from the invite if the client didn't pass them.
    -- This keeps the booking attributed to the original waitlist channel.
    v_source      := coalesce(v_invite.source, v_source);
    v_platform_id := coalesce(v_platform_id, v_invite.platform_id);  -- [platform_id] 2b. invite fallback
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
    pickup_mode, courier_address, allergy_notes, source,
    platform_id                                            -- [platform_id] 3. insert column
  )
  VALUES (
    v_slot_id, v_customer_name, v_customer_email, v_customer_phone,
    v_facebook_handle, v_instagram_handle, v_group_size, v_notes,
    'pending', 0,
    v_pickup_mode, v_courier_address, v_allergy_notes, v_source,
    v_platform_id                                          -- [platform_id] 3. insert value
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

  -- ---- Consume the invite (atomic - same txn as everything above) --------
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