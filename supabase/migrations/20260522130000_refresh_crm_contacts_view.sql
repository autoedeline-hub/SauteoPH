-- Refresh crm_contacts_with_stats so it surfaces messenger_psid.
--
-- Postgres views snapshot their column list at creation time. Even though
-- 20260522120000_messenger_psid.sql added crm_contacts.messenger_psid,
-- the existing view still projects the pre-migration columns, so
-- `SELECT * FROM crm_contacts_with_stats` in the admin UI returns rows
-- without messenger_psid. Drop + recreate to pick up the new column.
--
-- CREATE OR REPLACE VIEW would fail here because the new column appears
-- in the middle of the projection (c.* expands before the LATERAL stats),
-- and OR REPLACE only allows appending to the existing column list.

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
