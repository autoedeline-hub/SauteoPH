-- Dine-in: let a guest REDUCE party size at booking, capped at the invite.
--
-- Background: 20260706120000_dine_in_ceil_tables made the invite's group_size
-- authoritative for dine-in (v_group_size := coalesce(v_invite.group_size, ...)),
-- which silently discarded the party size the guest edits on the booking page.
-- The editable +/- stepper (added 2026-07-10 per Nikko) therefore had no effect
-- for invited guests: the backend always reserved ceil(invite.group_size / 2)
-- tables. A guest who lowered 8 pax to 6 still tried to grab 4 tables, so any
-- slot with fewer than 4 free tables rejected the booking as "time slot is full"
-- (observed: Michelle Manimtim, invite S7U4OB / booking MICHWJXC -- 8-pax invite,
-- reduced to 6, still booked as 8 pax / 4 tables).
--
-- Change vs 20260706120000_dine_in_ceil_tables.sql (ONE behavioral line):
--   - Invited dine-in party size = LEAST(payload, invite.group_size): the guest
--     may reduce below the vetted size (frees tables, honors the stepper) but can
--     never inflate beyond it. Falls back to the invite value when the payload
--     omits group_size, and to the payload alone when the invite has no size.
--   - Everything else (validation, ceil(party/2) table reservation, pickup flow)
--     is unchanged from 20260706120000.

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

  v_invite_token     text;
  v_invite           public.booking_invites%ROWTYPE;
  v_pickup_mode      text;
  v_courier_address  text;
  v_allergy_notes    text;
  v_source           text;
  v_is_admin         boolean;
  v_is_pickup_order  boolean;
  v_seats_to_reserve int;
BEGIN
  v_is_admin := public.has_role(auth.uid(), 'admin');

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
  v_is_pickup_order  := v_pickup_mode <> 'dine_in';

  -- ---- Invite gate -------------------------------------------------------
  IF v_invite_token IS NULL AND NOT v_is_admin AND v_pickup_mode = 'dine_in' THEN
    RAISE EXCEPTION 'invite_required' USING ERRCODE = 'P0001';
  END IF;

  IF v_invite_token IS NOT NULL THEN
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

    IF v_pickup_mode = 'dine_in' AND v_invite.channel <> 'dine_in' THEN
      RAISE EXCEPTION 'invite_channel_mismatch' USING ERRCODE = 'P0005';
    END IF;
    IF v_pickup_mode <> 'dine_in' AND v_invite.channel <> 'pickup' THEN
      RAISE EXCEPTION 'invite_channel_mismatch' USING ERRCODE = 'P0005';
    END IF;

    v_source := coalesce(v_invite.source, v_source);
  END IF;

  -- ---- Dine-in party size (guest may reduce, capped at the invite) --------
  -- Tables seat 2 chairs, so tables = ceil(party / 2). The guest may lower the
  -- party size on the booking page (the invite count is only an approximate
  -- figure captured on the Messenger waitlist), but never raise it above the
  -- size Sauteo vetted on the invite. Admin manual bookings (no invite) use the
  -- payload value directly.
  IF NOT v_is_pickup_order THEN
    IF v_invite_token IS NOT NULL AND v_invite.group_size IS NOT NULL THEN
      v_group_size := LEAST(coalesce(v_group_size, v_invite.group_size), v_invite.group_size);
    END IF;
    IF v_group_size IS NULL OR v_group_size < 1 OR v_group_size > 50 THEN
      RAISE EXCEPTION 'group_size must be 1-50' USING ERRCODE = '22023';
    END IF;
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
  -- Pickup group_size is the meal count; validated here (dine-in validated above).
  IF v_is_pickup_order AND (v_group_size IS NULL OR v_group_size < 1 OR v_group_size > 50) THEN
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
  IF v_pickup_mode NOT IN ('dine_in', 'personal_pickup', 'courier') THEN
    RAISE EXCEPTION 'pickup_mode is invalid' USING ERRCODE = '22023';
  END IF;
  IF v_allergy_notes IS NOT NULL AND length(v_allergy_notes) > 500 THEN
    RAISE EXCEPTION 'allergy_notes too long' USING ERRCODE = '22023';
  END IF;
  IF v_source NOT IN ('web', 'messenger', 'instagram', 'manual') THEN
    RAISE EXCEPTION 'source is invalid' USING ERRCODE = '22023';
  END IF;

  -- ---- Generate friendly reference code ----------------------------------
  v_reference_code := public.generate_booking_reference(v_customer_name);

  -- ---- Reserve capacity atomically ---------------------------------------
  -- Dine-in: ceil(party / 2) table units (capacity = 7 tables)
  -- Pickup:  group_size units (capacity = number of meals)
  v_seats_to_reserve := CASE
    WHEN v_is_pickup_order THEN v_group_size
    ELSE ceil(v_group_size::numeric / 2)::int
  END;

  IF NOT public.reserve_seats(v_slot_id, v_seats_to_reserve) THEN
    RAISE EXCEPTION 'time slot is full, closed, or does not exist'
      USING ERRCODE = 'P0001';
  END IF;

  -- ---- Insert booking shell ----------------------------------------------
  INSERT INTO public.bookings (
    slot_id, customer_name, customer_email, customer_phone,
    facebook_handle, instagram_handle, group_size, notes,
    status, total_amount,
    reference_code,
    pickup_mode, courier_address, allergy_notes, source
  )
  VALUES (
    v_slot_id, v_customer_name, v_customer_email, v_customer_phone,
    v_facebook_handle, v_instagram_handle, v_group_size, v_notes,
    'pending', 0,
    v_reference_code,
    v_pickup_mode, v_courier_address, v_allergy_notes, v_source
  )
  RETURNING id INTO v_booking_id;

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
    WHERE id = v_menu_item_id
      AND active = true
      AND (
        (v_is_pickup_order = false AND available_dine_in = true)
        OR (v_is_pickup_order = true AND available_pickup = true)
      );

    IF NOT FOUND THEN
      RAISE EXCEPTION 'menu item % is unavailable for this channel', v_menu_item_id
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

  UPDATE public.bookings
     SET total_amount = v_total
   WHERE id = v_booking_id;

  INSERT INTO public.payments (booking_id, method, reference_number, status)
  VALUES (v_booking_id, v_payment_method, v_payment_ref, 'submitted');

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
