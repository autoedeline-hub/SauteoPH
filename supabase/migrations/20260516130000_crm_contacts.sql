-- CRM contacts: one row per known guest. Backed by bookings (auto-upsert on
-- new/updated bookings) and seeded with whatever historical context we have.
-- A view layers in computed stats (lifetime spend, last visit, etc.) so the
-- base table stays narrow and editable.

CREATE TABLE IF NOT EXISTS public.crm_contacts (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name        TEXT NOT NULL,
  email            TEXT,
  phone            TEXT,
  facebook_handle  TEXT,
  instagram_handle TEXT,
  source           TEXT,
  tags             TEXT[] NOT NULL DEFAULT '{}',
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Email is the primary identifier when it looks valid. We use a partial
-- unique index so junk values (e.g. "Calamba Laguna" — a real waitlist
-- entry) don't collide.
CREATE UNIQUE INDEX IF NOT EXISTS crm_contacts_email_unique
  ON public.crm_contacts (lower(email))
  WHERE email IS NOT NULL AND email ~* '^[^@]+@[^@]+\.[^@]+$';

CREATE INDEX IF NOT EXISTS crm_contacts_phone_idx           ON public.crm_contacts (phone);
CREATE INDEX IF NOT EXISTS crm_contacts_facebook_handle_idx ON public.crm_contacts (facebook_handle);

-- RLS: admins only.
ALTER TABLE public.crm_contacts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "admins manage contacts" ON public.crm_contacts
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- Keep updated_at fresh.
CREATE OR REPLACE FUNCTION public.touch_crm_contacts_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS crm_contacts_touch ON public.crm_contacts;
CREATE TRIGGER crm_contacts_touch
  BEFORE UPDATE ON public.crm_contacts
  FOR EACH ROW EXECUTE FUNCTION public.touch_crm_contacts_updated_at();

-- Upsert helper called by both the trigger and backfill. Matches an existing
-- contact by valid email first, then by phone, then by FB handle. Never
-- overwrites a non-null field with a null one.
CREATE OR REPLACE FUNCTION public.upsert_crm_contact(
  p_full_name        TEXT,
  p_email            TEXT,
  p_phone            TEXT,
  p_facebook_handle  TEXT,
  p_instagram_handle TEXT,
  p_source           TEXT
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
    INSERT INTO public.crm_contacts (full_name, email, phone, facebook_handle, instagram_handle, source)
    VALUES (
      COALESCE(NULLIF(p_full_name, ''), 'Unknown guest'),
      CASE WHEN v_valid_email THEN p_email ELSE NULL END,
      NULLIF(p_phone, ''),
      NULLIF(p_facebook_handle, ''),
      NULLIF(p_instagram_handle, ''),
      p_source
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
      source           = COALESCE(source, p_source)
    WHERE id = v_id;
  END IF;

  RETURN v_id;
END $$;

-- Trigger: every booking insert/update synchronizes a contact.
CREATE OR REPLACE FUNCTION public.bookings_sync_contact()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  PERFORM public.upsert_crm_contact(
    NEW.customer_name,
    NEW.customer_email,
    NEW.customer_phone,
    NEW.facebook_handle,
    NEW.instagram_handle,
    NEW.source
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_sync_contact_trg ON public.bookings;
CREATE TRIGGER bookings_sync_contact_trg
  AFTER INSERT OR UPDATE OF customer_name, customer_email, customer_phone,
                            facebook_handle, instagram_handle, source
  ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.bookings_sync_contact();

-- Backfill from existing bookings.
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN SELECT * FROM public.bookings LOOP
    PERFORM public.upsert_crm_contact(
      r.customer_name, r.customer_email, r.customer_phone,
      r.facebook_handle, r.instagram_handle, r.source
    );
  END LOOP;
END $$;

-- Stats view. Group by contact_id, pulling visit/spend numbers from bookings.
CREATE OR REPLACE VIEW public.crm_contacts_with_stats
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
