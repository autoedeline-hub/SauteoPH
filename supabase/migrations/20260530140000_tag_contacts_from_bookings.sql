-- Fix: pipeline shows 0 pickup guests
--
-- Root cause: upsert_crm_contact() (called by the bookings trigger) never
-- set tags. Pickup bookings created contacts with tags='{}', so the admin
-- pipeline filter `tags.includes("pickup")` never matched.
--
-- Fix:
--   1. Extend upsert_crm_contact to accept and merge tags.
--   2. Reroute bookings_sync_contact to pass the correct tag based on
--      pickup_mode (pickup = anything except null/'dine_in', else waitlist).
--   3. Backfill existing contacts from their linked bookings.

-- ---------------------------------------------------------------------------
-- 1. Extend upsert_crm_contact to accept p_tags
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.upsert_crm_contact(
  p_full_name        TEXT,
  p_email            TEXT,
  p_phone            TEXT,
  p_facebook_handle  TEXT,
  p_instagram_handle TEXT,
  p_source           TEXT,
  p_tags             TEXT[] DEFAULT ARRAY[]::TEXT[]
) RETURNS UUID
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_id UUID;
  v_valid_email BOOLEAN := p_email IS NOT NULL AND p_email ~* '^[^@]+@[^@]+\.[^@]+$';
BEGIN
  IF v_valid_email THEN
    SELECT id INTO v_id FROM public.crm_contacts WHERE lower(email) = lower(p_email) LIMIT 1;
  END IF;
  IF v_id IS NULL AND p_phone IS NOT NULL AND p_phone <> '' THEN
    SELECT id INTO v_id FROM public.crm_contacts WHERE phone = p_phone LIMIT 1;
  END IF;
  IF v_id IS NULL AND p_facebook_handle IS NOT NULL AND p_facebook_handle <> '' THEN
    SELECT id INTO v_id FROM public.crm_contacts WHERE facebook_handle = p_facebook_handle LIMIT 1;
  END IF;

  IF v_id IS NULL THEN
    INSERT INTO public.crm_contacts (full_name, email, phone, facebook_handle, instagram_handle, source, tags)
    VALUES (
      COALESCE(NULLIF(p_full_name, ''), 'Unknown guest'),
      CASE WHEN v_valid_email THEN p_email ELSE NULL END,
      NULLIF(p_phone, ''),
      NULLIF(p_facebook_handle, ''),
      NULLIF(p_instagram_handle, ''),
      p_source,
      COALESCE(p_tags, ARRAY[]::TEXT[])
    )
    RETURNING id INTO v_id;
  ELSE
    UPDATE public.crm_contacts SET
      full_name        = CASE
                            WHEN full_name IS NULL OR full_name = '' OR full_name = 'Unknown guest'
                              THEN COALESCE(NULLIF(p_full_name, ''), full_name)
                            ELSE full_name
                         END,
      email            = COALESCE(email, CASE WHEN v_valid_email THEN p_email END),
      phone            = COALESCE(phone, NULLIF(p_phone, '')),
      facebook_handle  = COALESCE(facebook_handle, NULLIF(p_facebook_handle, '')),
      instagram_handle = COALESCE(instagram_handle, NULLIF(p_instagram_handle, '')),
      source           = COALESCE(source, p_source),
      tags             = (
        SELECT array_agg(DISTINCT t ORDER BY t)
          FROM unnest(tags || COALESCE(p_tags, ARRAY[]::TEXT[])) AS t
         WHERE t IS NOT NULL AND t <> ''
      )
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Reroute bookings_sync_contact to pass the channel tag
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.bookings_sync_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_tag TEXT;
BEGIN
  -- pickup_mode is NULL or 'dine_in' for dine-in bookings; anything else
  -- (personal_pickup, lalamove, grab …) is a pickup order.
  v_tag := CASE
    WHEN NEW.pickup_mode IS NULL OR NEW.pickup_mode = 'dine_in' THEN 'waitlist'
    ELSE 'pickup'
  END;

  PERFORM public.upsert_crm_contact(
    NEW.customer_name,
    NEW.customer_email,
    NEW.customer_phone,
    NEW.facebook_handle,
    NEW.instagram_handle,
    NEW.source,
    ARRAY[v_tag]
  );
  RETURN NEW;
END $$;

-- Trigger already exists on the correct events — no DROP/CREATE needed.

-- ---------------------------------------------------------------------------
-- 3. Backfill existing contacts from their linked bookings
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  r RECORD;
  v_tag TEXT;
BEGIN
  FOR r IN SELECT * FROM public.bookings LOOP
    v_tag := CASE
      WHEN r.pickup_mode IS NULL OR r.pickup_mode = 'dine_in' THEN 'waitlist'
      ELSE 'pickup'
    END;
    PERFORM public.upsert_crm_contact(
      r.customer_name, r.customer_email, r.customer_phone,
      r.facebook_handle, r.instagram_handle, r.source,
      ARRAY[v_tag]
    );
  END LOOP;
END $$;