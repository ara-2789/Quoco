-- =============================================================================
-- 037_hindrances_pm_notified_at.sql
-- WRITTEN, NOT YET REHEARSED, NOT YET APPLIED, per explicit instruction --
-- diff first. Per CLAUDE.md's "a migration file enters supabase/migrations/
-- when it is being applied, not when it is written" rule, this file lives
-- in docs/reviews/ until an apply is actually happening.
--
-- MIGRATION NUMBER: 037, verified against origin/main's supabase/migrations/
-- (035 is the highest applied number on both prod and test-db; 036 is held,
-- rehearsed, not yet applied -- docs/reviews/036_hindrance_timing_column.sql)
-- and against scripts/migration-number-reservations.json (no entry claims
-- 037 as of this write). Reservation entry added in the same commit as this
-- file.
--
-- SCOPE: one column. `hindrances.pm_notified_at TIMESTAMPTZ`, matching the
-- shape `safety_incidents.pm_notified_at` already has (migration 001) --
-- `hindrances` is the one item-1/item-2-adjacent table that never got the
-- equivalent column. Found while scoping ad-hoc menu item 1's own PM email
-- notification (docs/plans/adhoc-menu-spec.md §g.9): without this column, a
-- retried notification job has no way to know a hindrance was already
-- emailed to its PM, and a PM has no way to tell a retried duplicate email
-- from a genuine second report.
--
-- WHY ITS OWN FILE, NOT FOLDED INTO 036 (Aravind's own instruction,
-- 2026-09-03): 036 is already rehearsed twice and pinned at a certified
-- sha256 (`f878057d...`, PR #180). Growing it again would decertify that
-- pin a third time for an unrelated concern -- this column has nothing to
-- do with `timing`/`timing_raw`/`submitted_via`, the three things 036
-- actually touches. Two small, single-purpose migrations are cheaper to
-- reason about than one growing file that keeps re-invalidating its own
-- rehearsal history.
--
-- APPLY ORDER: 036 and 037 are independent and can be applied in EITHER
-- order, or interleaved with anything else -- checked directly, not
-- assumed. 037's own `ALTER TABLE` touches exactly one column
-- (`pm_notified_at`), with no FK, no CHECK, and no reference to any column
-- 036 adds or modifies (`timing`, `timing_raw`, `submitted_via`) or vice
-- versa. Neither file's own SQL body mentions the other's column names.
-- Applying 037 before 036, after 036, or 036 alone without 037 (or the
-- reverse) all leave a structurally valid, internally consistent
-- `hindrances` table each time.
--
-- SHAPE, MATCHING safety_incidents.pm_notified_at EXACTLY: nullable
-- TIMESTAMPTZ, no default. NULL is the send-once guard's own "not yet
-- notified" state -- a job checks `WHERE pm_notified_at IS NULL` before
-- sending, and sets it to `now()` immediately after a successful send, the
-- same pattern this project's own `STAGE_2_TERMINAL` classification
-- already uses for owner-DPR delivery (`lib/dpr/owner-deliver-
-- dispatch.ts`) -- a nullable timestamp as the terminal-state check, not a
-- separate status enum. No DEFAULT: a defaulted `now()` at row-creation
-- time would fabricate a notification that never happened, the identical
-- reasoning 036's own `timing`/`submitted_via` columns already argue
-- against fabricated values.
--
-- NOT A NOTIFICATION LEDGER -- NAMED SO THE LIMIT ISN'T ASSUMED AWAY: this
-- is one boolean-shaped timestamp, not `outbound_sends`' own event_key/
-- idempotency mechanism (031). It answers "has this row been notified at
-- all," not "which specific send attempt succeeded," and it cannot
-- accommodate more than one notification per row ever meaning something
-- different (e.g. a re-notify-on-update flow, if one is ever built, would
-- need its own design -- not assumed solved by this column). Sufficient
-- for item 1's phase-one shape (one notification, once, per hindrance);
-- not a general-purpose mechanism.
--
-- RISK CLASS: additive, one nullable column, no function/grant/RLS/auth/
-- money surface touched -- trips none of CLAUDE.md §0's external-review-
-- gate conditions: (a) no function logic; (b) no grant/RLS/SECURITY
-- DEFINER surface (hindrances' RLS stays table-level to `authenticated`,
-- unchanged); (c) no auth/identity surface; (d) fully reversible, DROP
-- COLUMN is the exact inverse, and the table has zero rows in production
-- (confirmed live, same session as 036's own rehearsal) so nothing is at
-- risk either way; (e) no money surface. Normal migration, no external
-- review package required.
--
-- REHEARSED: NOT YET, PER EXPLICIT INSTRUCTION -- diff first. NOT YET
-- APPLIED ANYWHERE.
-- =============================================================================

BEGIN;

ALTER TABLE hindrances
  ADD COLUMN pm_notified_at TIMESTAMPTZ;

COMMENT ON COLUMN hindrances.pm_notified_at IS
  'Send-once guard for the ad-hoc menu item 1 PM email notification (migration 037, 2026-09-03), matching safety_incidents.pm_notified_at''s own shape. NULL = not yet notified -- a notification job checks WHERE pm_notified_at IS NULL before sending. Set to now() immediately after a successful send; never defaulted, never backfilled -- a defaulted value would fabricate a notification that never happened.';

COMMIT;

-- =============================================================================
-- DOWN (exact inverse, not applied by this file):
--
--   ALTER TABLE hindrances DROP COLUMN pm_notified_at;
-- =============================================================================
