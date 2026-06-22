-- CLEANUP: Remove the accidental bulk booking_invites rows created for all
-- CRM contacts. These were waiting-state rows (token IS NULL, expires_at IS NULL)
-- that showed up in the Invites tab as "expired". The contacts are already
-- visible in the Waitlist tab (crm_contacts) — no booking_invites row is
-- needed for them to appear there.
--
-- Safe: only deletes rows where token IS NULL AND expires_at IS NULL AND
-- used_at IS NULL — i.e. never-sent "waiting" placeholders with no booking.

DELETE FROM public.booking_invites
WHERE token IS NULL
  AND expires_at IS NULL
  AND used_at IS NULL;

-- Verify: confirm Invites tab is clean.
SELECT COUNT(*) AS remaining_waiting
FROM public.booking_invites
WHERE token IS NULL AND expires_at IS NULL AND used_at IS NULL;
