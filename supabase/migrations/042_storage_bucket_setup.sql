-- =============================================================================
-- 042_storage_bucket_setup.sql
-- Stage 0 of the media capability (docs/plans/media-capture-design.md item
-- 20; full plan: docs/plans/stage0-storage-setup-plan.md). Creates ONE
-- private Storage bucket for all photo classes this project will write
-- (daily_log_photos, hindrance_photos -- both tables land in a LATER
-- migration, stage 1+; this file creates no table, no daily_log_photos row,
-- no ingestion).
--
-- HELD, NOT APPLIED ANYWHERE (2026-09-13). Per CLAUDE.md's own "a migration
-- file enters supabase/migrations/ when it is being applied, not when it is
-- written" rule, this file lives in docs/reviews/ until an apply is
-- genuinely happening. NOT rehearsed against a real database this pass --
-- this planning/build environment has no Supabase credentials of any kind
-- (confirmed: SUPABASE_TEST_URL/SUPABASE_TEST_SERVICE_ROLE_KEY unset, no
-- .env.test in this worktree). A real dry-run/rehearsal against test-db,
-- per CLAUDE.md §7's own standing "every new migration gets a disposable
-- dry-run" rule, is still owed before this is ever applied for real -- see
-- docs/plans/stage0-storage-setup-plan.md §9 for the exact open question
-- (whether the project's approved apply path even has sufficient privilege
-- to write storage.buckets, never independently confirmed).
--
-- NUMBER RESERVED 2026-09-13 in scripts/migration-number-reservations.json.
-- Confirmed against origin/main at reservation time: highest applied
-- migration is 041 (supabase/migrations/041_write_dpr_version_first_write_
-- fix.sql), highest reservation is 041 -- 042 was free. NOT independently
-- checked against every sibling worktree's own supabase/migrations/ or
-- reservations file (this project's own established discipline for a
-- reservation, per the 040/041 entries' own notes) -- named as a limit on
-- this reservation's own confidence, not skipped silently.
--
-- NO ROW LEVEL SECURITY POLICIES ARE CREATED BY THIS FILE, DELIBERATELY.
-- Aravind's decision, 2026-09-13, superseding this stage's own earlier
-- draft plan (which proposed Storage RLS on storage.objects): every read
-- and write goes through service_role application code
-- (lib/storage/photo-access.ts's getSignedPhotoUrl(), stage 4's email-
-- attachment job) -- the application-code membership check IS the access
-- control, not a database policy. See docs/plans/stage0-storage-setup-
-- plan.md §4 for the full reasoning, including the consequence recorded
-- there in full: there is no second, database-level barrier behind this
-- check, so the cross-tenant isolation test (test/storage-photo-access.
-- test.ts) is the actual verification that isolation exists at all, not a
-- confirmation of a second layer already believed sound.
--
-- BUCKET: private (public = false) -- photos are PM-only per the design
-- (media-capture-design.md item 14). A public bucket needs no policy at
-- all to be world-readable by design, per Supabase's own docs -- the
-- opposite of what this project has already decided about who may see
-- these photos.
--
-- PATH CONVENTION (documented here, NOT enforced by any database
-- constraint -- enforcement is entirely the responsibility of whichever
-- application code writes objects, starting with stage 1's media_ingest
-- job): {tenant_id}/{daily_log_id}/{photo_id}.{ext} for daily-log photos,
-- {tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext} for hindrance
-- photos (item 7's second per-parent class). One bucket for both, per
-- docs/plans/stage0-storage-setup-plan.md §3's own recommendation.
-- =============================================================================

BEGIN;

INSERT INTO storage.buckets (id, name, public)
VALUES ('daily-log-photos', 'daily-log-photos', false)
ON CONFLICT (id) DO NOTHING;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- Safe only while the bucket holds zero objects (true by construction at
-- this stage -- no ingestion code exists yet to have written anything into
-- it). storage.objects.bucket_id references storage.buckets.id; deleting a
-- bucket that still holds objects would need those objects removed first,
-- which is explicitly out of this file's own scope to ever need to do.
--
-- BEGIN;
--
-- DELETE FROM storage.buckets WHERE id = 'daily-log-photos';
--
-- COMMIT;
