-- Auto-tag crm_contacts with lifecycle markers as their bookings progress.
--
-- Tags applied (additive — origin tags `waitlist` / `pickup` are never
-- removed because the admin Pipeline filters on them):
--
--   `customer` — added the moment a matching contact's booking status
--                first flips to 'confirmed'. Lets admin filter Contacts
--                for "anyone who has ever booked."
--   `served`   — added when a matching booking's completed_at is first
--                set (admin clicked Mark Complete). Differentiates from
--                contacts who confirmed but haven't shown up yet.
--
-- Contact matching mirrors the existing bookings_sync_contact trigger:
-- by email (case-insensitive) OR phone OR facebook_handle. Same heuristic
-- the Pipeline tab uses, so behavior stays consistent across surfaces.
--
-- No-removal policy: cancelling a booking does NOT remove the `customer`
-- tag. A history of having booked is permanent for filtering purposes.
-- The booking row itself stays the source of truth for current status.

CREATE OR REPLACE FUNCTION public.bookings_sync_lifecycle_tags()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_contact_id UUID;
  v_add_customer BOOLEAN := false;
  v_add_served   BOOLEAN := false;
BEGIN
  -- Decide which tags this row warrants applying.
  -- Fired by AFTER INSERT OR UPDATE OF status, completed_at — so this
  -- runs once per relevant state transition.
  IF NEW.status = 'confirmed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'confirmed') THEN
    v_add_customer := true;
  END IF;

  IF NEW.completed_at IS NOT NULL
     AND (TG_OP = 'INSERT' OR OLD.completed_at IS NULL) THEN
    v_add_served := true;
    -- A booking that goes straight to completed (rare but possible if
    -- admin uses a back-office tool) implies confirmed too.
    v_add_customer := true;
  END IF;

  IF NOT v_add_customer AND NOT v_add_served THEN
    RETURN NEW;
  END IF;

  -- Find the matching contact. Mirrors the Pipeline tab + the existing
  -- crm_contacts_with_stats view join logic.
  SELECT id INTO v_contact_id
    FROM public.crm_contacts c
   WHERE (
     (NEW.customer_email IS NOT NULL
        AND c.email IS NOT NULL
        AND lower(c.email) = lower(NEW.customer_email))
     OR (NEW.customer_phone IS NOT NULL AND NEW.customer_phone <> ''
        AND c.phone = NEW.customer_phone)
     OR (NEW.facebook_handle IS NOT NULL AND NEW.facebook_handle <> ''
        AND c.facebook_handle = NEW.facebook_handle)
   )
   LIMIT 1;

  IF v_contact_id IS NULL THEN
    -- No matching contact. The bookings_sync_contact trigger usually
    -- creates one — but if it raced or filtered out, just bail. The next
    -- update will retry.
    RETURN NEW;
  END IF;

  -- Apply tags additively + deduped. unnest + array_agg DISTINCT keeps the
  -- column stable for humans reading it.
  UPDATE public.crm_contacts
     SET tags = (
       SELECT array_agg(DISTINCT t ORDER BY t)
         FROM unnest(
           tags ||
           CASE WHEN v_add_customer THEN ARRAY['customer'] ELSE ARRAY[]::TEXT[] END ||
           CASE WHEN v_add_served   THEN ARRAY['served']   ELSE ARRAY[]::TEXT[] END
         ) AS t
        WHERE t IS NOT NULL AND t <> ''
     )
   WHERE id = v_contact_id;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS bookings_sync_lifecycle_tags_trg ON public.bookings;

CREATE TRIGGER bookings_sync_lifecycle_tags_trg
  AFTER INSERT OR UPDATE OF status, completed_at
  ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.bookings_sync_lifecycle_tags();

-- ---------------------------------------------------------------------------
-- Backfill: apply lifecycle tags to existing contacts based on historical
-- booking state. Idempotent — re-running just re-asserts the same tags.
-- ---------------------------------------------------------------------------
WITH matched AS (
  SELECT
    c.id AS contact_id,
    bool_or(b.status = 'confirmed')        AS has_confirmed,
    bool_or(b.completed_at IS NOT NULL)    AS has_completed
  FROM public.crm_contacts c
  JOIN public.bookings b ON (
       (b.customer_email IS NOT NULL
          AND c.email IS NOT NULL
          AND lower(c.email) = lower(b.customer_email))
    OR (b.customer_phone IS NOT NULL AND b.customer_phone <> ''
          AND c.phone = b.customer_phone)
    OR (b.facebook_handle IS NOT NULL AND b.facebook_handle <> ''
          AND c.facebook_handle = b.facebook_handle)
  )
  GROUP BY c.id
)
UPDATE public.crm_contacts c
   SET tags = (
     SELECT array_agg(DISTINCT t ORDER BY t)
       FROM unnest(
         c.tags ||
         CASE WHEN m.has_confirmed THEN ARRAY['customer'] ELSE ARRAY[]::TEXT[] END ||
         CASE WHEN m.has_completed THEN ARRAY['served']   ELSE ARRAY[]::TEXT[] END
       ) AS t
      WHERE t IS NOT NULL AND t <> ''
   )
  FROM matched m
 WHERE m.contact_id = c.id
   AND (m.has_confirmed OR m.has_completed);
