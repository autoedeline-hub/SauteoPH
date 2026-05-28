-- Waitlist: capture each guest's requested booking date+time, and let invites
-- lock a guest to an exact time slot.
--
-- Why:
--   The admin "Waitlist" tab groups waitlist guests by the date+time they want
--   to dine, then bulk-issues invites for a whole time slot at once. That needs
--   two things the schema didn't have:
--     1. A place to store the requested date/time per contact. The Messenger
--        bot / Airtable sync writes these via sync_messenger_contact (bot work
--        is out of scope here; this migration just adds the columns + params).
--     2. A slot_id on booking_invites so a bulk invite pins the guest to one
--        slot. The booking page then renders that slot read-only and
--        create_booking enforces it.
--
-- Objects recreated because Postgres freezes view projections / function
-- signatures (same pattern as 20260525130000_crm_party_size.sql):
--   - crm_contacts_with_stats view (SELECT c.* — must re-snapshot new columns)
--   - sync_messenger_contact (new params)
--   - lookup_invite (returns slot info)
--   - create_booking (enforces the slot lock)

-- ---------------------------------------------------------------------------
-- 1. crm_contacts: requested slot date/time (nullable → "Unscheduled" bucket).
--    requested_time is TIME so it serializes HH:MM:SS, matching
--    time_slots.slot_time for clean equality matching in the admin UI.
-- ---------------------------------------------------------------------------
ALTER TABLE public.crm_contacts
  ADD COLUMN IF NOT EXISTS requested_date DATE,
  ADD COLUMN IF NOT EXISTS requested_time TIME;

-- ---------------------------------------------------------------------------
-- 2. booking_invites.slot_id — pins a guest to one time slot. Nullable so
--    legacy/manual invites stay un-locked; ON DELETE SET NULL reverts an
--    invite to the normal slot picker if its slot is later deleted.
-- ---------------------------------------------------------------------------
ALTER TABLE public.booking_invites
  ADD COLUMN IF NOT EXISTS slot_id UUID
    REFERENCES public.time_slots(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS booking_invites_slot_id_idx
  ON public.booking_invites (slot_id) WHERE slot_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- 3. sync_messenger_contact — add requested_date + requested_time params.
--    Kept last + defaulted so existing n8n callers (10/11-arg) keep working.
--    p_requested_time is TEXT with a guarded ::time cast so the bot can send
--    a loose value; the expected format is "HH:MM" or "HH:MM:SS". Anything
--    that fails the cast is treated as "don't change this column".
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.sync_messenger_contact(
  TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INT
);

CREATE OR REPLACE FUNCTION public.sync_messenger_contact(
  p_airtable_id      TEXT,
  p_full_name        TEXT,
  p_email            TEXT,
  p_phone            TEXT,
  p_facebook_handle  TEXT,
  p_instagram_handle TEXT,
  p_psid             TEXT,
  p_source           TEXT,
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[],
  p_party_size       INT  DEFAULT NULL,
  -- Requested booking slot the bot captured on the waitlist. Optional;
  -- legacy callers that don't pass them leave the columns untouched.
  p_requested_date   DATE DEFAULT NULL,
  p_requested_time   TEXT DEFAULT NULL
) RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id           UUID;
  v_handle_clean TEXT;
  v_psid_clean   TEXT;
  v_email_clean  TEXT;
  v_party_clean  INT;
  v_time_clean   TIME;
  v_psid_pattern CONSTANT TEXT := '^[0-9]{15,}$';
BEGIN
  -- Skip bot-harness rows so prod CRM stays clean.
  IF p_full_name ~* '^TEST_'
     OR p_facebook_handle ~* '^TEST_'
     OR p_psid ~* '^TEST_' THEN
    RETURN NULL;
  END IF;

  -- Route numeric "fb_handle" to messenger_psid.
  IF p_facebook_handle ~ v_psid_pattern THEN
    v_handle_clean := NULL;
    v_psid_clean   := COALESCE(p_psid, p_facebook_handle);
  ELSE
    v_handle_clean := NULLIF(p_facebook_handle, '');
    v_psid_clean   := p_psid;
  END IF;
  IF v_psid_clean IS NOT NULL AND v_psid_clean !~ v_psid_pattern THEN
    v_psid_clean := NULL;
  END IF;

  -- Validate email shape (matches the rest of the schema's email check).
  v_email_clean := CASE
    WHEN p_email IS NOT NULL AND p_email ~* '^[^@]+@[^@]+\.[^@]+$'
      THEN lower(p_email)
    ELSE NULL
  END;

  -- Clamp party size into the table's CHECK range. Out-of-range or NULL
  -- input means "don't change this column."
  v_party_clean := CASE
    WHEN p_party_size IS NOT NULL AND p_party_size BETWEEN 1 AND 50
      THEN p_party_size
    ELSE NULL
  END;

  -- Parse requested_time loosely; a value that doesn't cast to TIME is
  -- treated as "don't change this column" rather than erroring the sync.
  BEGIN
    v_time_clean := NULLIF(trim(p_requested_time), '')::TIME;
  EXCEPTION WHEN others THEN
    v_time_clean := NULL;
  END;

  -- Dedup by airtable_record_id. If a contact for this Airtable row
  -- already exists, refresh its fields so edits in Airtable propagate.
  IF p_airtable_id IS NOT NULL AND p_airtable_id <> '' THEN
    SELECT id INTO v_id
      FROM public.crm_contacts
     WHERE airtable_record_id = p_airtable_id
     LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.crm_contacts (
      full_name,
      email,
      phone,
      facebook_handle,
      instagram_handle,
      messenger_psid,
      source,
      tags,
      airtable_record_id,
      last_party_size,
      requested_date,
      requested_time
    )
    VALUES (
      COALESCE(NULLIF(p_full_name, ''), 'Messenger guest'),
      v_email_clean,
      NULLIF(p_phone, ''),
      v_handle_clean,
      NULLIF(p_instagram_handle, ''),
      v_psid_clean,
      COALESCE(p_source, 'messenger'),
      COALESCE(p_tags, ARRAY[]::TEXT[]),
      NULLIF(p_airtable_id, ''),
      v_party_clean,
      p_requested_date,
      v_time_clean
    )
    RETURNING id INTO v_id;
  ELSE
    -- Update only the fields the Airtable sync owns; don't clobber
    -- existing values with NULLs.
    UPDATE public.crm_contacts
       SET full_name        = COALESCE(NULLIF(p_full_name, ''), full_name),
           email            = COALESCE(v_email_clean, email),
           phone            = COALESCE(NULLIF(p_phone, ''), phone),
           facebook_handle  = COALESCE(v_handle_clean, facebook_handle),
           instagram_handle = COALESCE(NULLIF(p_instagram_handle, ''), instagram_handle),
           messenger_psid   = COALESCE(v_psid_clean, messenger_psid),
           last_party_size  = COALESCE(v_party_clean, last_party_size),
           requested_date   = COALESCE(p_requested_date, requested_date),
           requested_time   = COALESCE(v_time_clean, requested_time),
           tags             = (
             SELECT array_agg(DISTINCT t ORDER BY t)
               FROM unnest(tags || COALESCE(p_tags, ARRAY[]::TEXT[])) AS t
              WHERE t IS NOT NULL AND t <> ''
           )
     WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL    ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INT, DATE, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.sync_messenger_contact(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT, TEXT[], INT, DATE, TEXT) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 4. lookup_invite — also return the locked slot (id/date/time) so the
--    booking page can render it read-only. Still sanitized: no created_by,
--    used_booking_id, or contact_id.
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

-- ---------------------------------------------------------------------------
-- 5. create_booking — enforce the invite's slot lock.
--    New error: 'invite_slot_mismatch' P0006 — payload slot_id differs from
--    the slot the invite was locked to.
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

-- ---------------------------------------------------------------------------
-- 6. Recreate crm_contacts_with_stats so .select("*") picks up the two new
--    columns. Body is unchanged from 20260525130000_crm_party_size.sql; the
--    SELECT c.* re-snapshots requested_date/requested_time.
-- ---------------------------------------------------------------------------
DROP VIEW IF EXISTS public.crm_contacts_with_stats;

CREATE VIEW public.crm_contacts_with_stats
WITH (security_invoker = true) AS
SELECT
  c.*,
  COALESCE(b.total_bookings, 0)        AS total_bookings,
  COALESCE(b.confirmed_bookings, 0)    AS confirmed_bookings,
  COALESCE(b.lifetime_spend, 0)        AS lifetime_spend,
  b.last_visit_date,
  b.first_booking_at,
  COALESCE(b.channels, '{}'::text[])   AS channels
FROM public.crm_contacts c
LEFT JOIN LATERAL (
  SELECT
    count(*)                                                      AS total_bookings,
    count(*) FILTER (WHERE bk.status = 'confirmed')              AS confirmed_bookings,
    COALESCE(sum(bk.total_amount) FILTER (WHERE bk.status = 'confirmed'), 0) AS lifetime_spend,
    max(ts.slot_date) FILTER (WHERE bk.status = 'confirmed')     AS last_visit_date,
    min(bk.created_at)                                            AS first_booking_at,
    COALESCE(array_agg(DISTINCT bk.source) FILTER (WHERE bk.source IS NOT NULL), '{}'::text[]) AS channels
  FROM public.bookings bk
  LEFT JOIN public.time_slots ts ON ts.id = bk.slot_id
  WHERE (
    (lower(bk.customer_email) = lower(c.email) AND c.email IS NOT NULL)
    OR (bk.customer_phone = c.phone AND c.phone IS NOT NULL AND c.phone <> '')
    OR (bk.facebook_handle = c.facebook_handle AND c.facebook_handle IS NOT NULL AND c.facebook_handle <> '')
  )
) b ON true;
