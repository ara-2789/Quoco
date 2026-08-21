-- =============================================================================
-- 026_dpr_generation_stale.sql
--
-- RELOCATED (2026-08-21, verified as of 2026-08-21 03:36:52 UTC): moved from
-- supabase/migrations/ to here. Never committed on any branch
-- (`git log --all --oneline -- supabase/migrations/026_dpr_generation_stale.sql`
-- returns empty). Absent from the migration ledger on both prod
-- (jvxwqignooseazzmwhvl) and test-db (exfccwlrhoutkgrlikod) -- checked
-- directly against supabase_migrations.schema_migrations on each, zero rows.
-- Column public.dprs.generation_claimed_at (the one structural change this
-- file makes) is absent from information_schema.columns on both prod and
-- test-db as of the same check. This is an unapplied draft, not an
-- applied-but-untracked migration.
-- ----------------------------------------------------------------------------
-- Closes the gap found while planning the dpr_generate job handler
-- (2026-08-11, Aravind's review): generation_status transitions to 'running'
-- before the Claude call and back to 'idle' on success or a thrown error —
-- but neither of those code paths runs if the PROCESS itself dies mid-call
-- (Vercel function timeout, a deploy landing mid-execution, an OOM). The row
-- then stays 'running' permanently. Not cosmetic: DPR-24's owner-send hold
-- (docs/bot-flows.md, not yet built) is specified to WAIT while
-- generation_status='running' — a row stuck in that state would block
-- delivery for that one project forever, silently, invisible until an owner
-- asks why the reports stopped.
--
-- generation_status's CHECK constraint (023) already names 'stale' as a
-- valid value; nothing in the codebase has ever set it, and 023's own header
-- doesn't say what's supposed to.
--
-- generation_claimed_at is the mechanism: set alongside generation_status=
-- 'running' at handler start (lib/dpr/dispatch.ts). A sweep added to the
-- EXISTING /api/jobs/tick poller (already running every 60s — no new cron
-- entry, consistent with this project's already-accepted NFR-16 deviation of
-- one poller rather than per-job-type cron entries at current scale) flips
-- any row 'running' longer than 3 minutes to 'stale'. 3 minutes is grounded
-- in observed reality, not a round number: every real Claude call this
-- session measured 6-11s; 3 minutes is ~20-30x that, ample headroom for a
-- genuinely slow attempt, while staying SHORTER than DPR-24's own 5-minute
-- hold window — so 'stale' becomes an independently useful signal before
-- that hold's force-send deadline, not a value that only ever flips at the
-- exact moment DPR-24 would have force-sent anyway.
--
-- NAMED, NOT FIXED HERE: the identical failure shape exists on
-- jobs.status='running' too — claimJobs' WHERE clause only ever picks up
-- 'pending'/'failed', never 'running', so a job whose worker died mid-
-- execution is invisible to retry forever, and jobs.status has no 'stale'-
-- equivalent value at all (pending/running/succeeded/failed). Same root
-- cause, a separate migration if it's ever built — not bundled into this one
-- since it wasn't in scope for the dpr_generate handler this migration
-- supports.
--
-- RISK CLASS: purely additive — one new nullable column, no data movement,
-- no RLS change (dprs' existing SELECT-only, project_members-scoped policy
-- from 023 already covers it; this column is never written by anything but
-- service_role, same as every other lifecycle column on this table).
-- =============================================================================

BEGIN;

ALTER TABLE public.dprs ADD COLUMN generation_claimed_at TIMESTAMPTZ;

COMMENT ON COLUMN public.dprs.generation_claimed_at IS
  'Set alongside generation_status=''running'' at dpr_generate handler start '
  '(lib/dpr/dispatch.ts). Read by the stale-reclaim sweep in '
  'app/api/jobs/tick/route.ts (added in the same PR as this migration) to '
  'detect a row whose generating PROCESS died mid-call without ever clearing '
  '''running'' — a timeout, a crashed deploy, an OOM. NULL whenever '
  'generation_status is not ''running''; not meant to be read for any other '
  'purpose.';

COMMIT;
