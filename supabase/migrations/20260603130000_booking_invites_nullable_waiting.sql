-- booking_invites: make token + expires_at NULLABLE (waiting-state support).
--
-- ROOT CAUSE (found 2026-06-03): booking_invites does double duty as BOTH the
-- tokenized-invite table AND the dine-in waitlist queue. The waitlist
-- workflows treat a row as "waiting" (not yet invited) when token + expires_at
-- are NULL:
--   * WL Send Invites / "Query Top Waiting Guests":
--       ...?used_at=is.null&expires_at=is.null   <- waiting = NULL expires_at
--   * "Update Status: Invited"      sets token + expires_at (becomes invited)
--   * "Mark as Expired" (expiry chk) resets token + expires_at -> NULL (re-queue)
--   * "Declined -> Move to Back"      resets token + expires_at -> NULL (re-queue)
--
-- But the original schema (20260517) declared token TEXT NOT NULL UNIQUE and
-- expires_at TIMESTAMPTZ NOT NULL, so every "re-queue" PATCH failed the NOT
-- NULL constraint -> waiting guests could never be put back in the pool, and
-- expired invites were re-emailed daily. This migration makes both columns
-- nullable to match the design.
--
-- Safe because:
--   * token UNIQUE still holds: Postgres treats NULLs as distinct, so many
--     waiting rows may have NULL token simultaneously; only real tokens are
--     deduped.
--   * lookup_invite()/create_booking() only ever act on rows WITH a token
--     (the guest supplies it), so NULL-token waiting rows are never matched.
--   * booking_invites_used_consistency only governs used_at/used_booking_id.
--   * Indexes (token_idx, unused_idx on expires_at) are NULL-tolerant.
-- ---------------------------------------------------------------------------

ALTER TABLE public.booking_invites ALTER COLUMN token      DROP NOT NULL;
ALTER TABLE public.booking_invites ALTER COLUMN expires_at DROP NOT NULL;