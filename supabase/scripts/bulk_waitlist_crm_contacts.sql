-- Bulk-enqueue all CRM contacts into the dine-in waitlist.
--
-- Creates "waiting" rows (token IS NULL, expires_at IS NULL). The n8n
-- "WL Send Invites" workflow picks these up, generates the invite token,
-- sets expires_at, and sends the Messenger link to the customer.
--
-- Contacts that already have a live (unused) invite entry are skipped
-- so we don't create duplicate queue entries.
--
-- Run this once in the Supabase SQL Editor.

INSERT INTO public.booking_invites (
  channel,
  customer_name,
  customer_email,
  customer_phone,
  platform_id,      -- Messenger PSID (numeric) used by n8n to send the link
  source,
  group_size,
  contact_id
)
SELECT
  'dine_in',
  c.full_name,
  c.email,
  c.phone,
  c.messenger_psid,
  COALESCE(NULLIF(c.source, ''), 'messenger'),
  c.last_party_size,
  c.id
FROM public.crm_contacts c
WHERE NOT EXISTS (
  SELECT 1
  FROM public.booking_invites bi
  WHERE bi.contact_id = c.id
    AND bi.used_at IS NULL   -- skip contacts already in the waiting/invited queue
);

-- Verify: show how many were queued vs already had a pending invite.
SELECT
  COUNT(*) FILTER (WHERE bi.used_at IS NULL AND bi.expires_at IS NULL) AS waiting,
  COUNT(*) FILTER (WHERE bi.used_at IS NULL AND bi.expires_at IS NOT NULL) AS invited,
  COUNT(*) FILTER (WHERE bi.used_at IS NOT NULL) AS consumed
FROM public.booking_invites bi
WHERE bi.contact_id IS NOT NULL;
