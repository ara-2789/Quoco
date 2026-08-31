-- docs/reviews/034-rollback.sql
-- Down-migration for 034_owner_email_delivery.sql -- NOT a numbered
-- migration file, same convention as 030-rollback.sql: this project's
-- supabase/migrations/ directory holds forward migrations only; a numbered
-- slot here would confuse migration-lint and `supabase migration list`'s
-- ledger correlation.
--
-- Written AND EXECUTED 2026-08-31, against the disposable local scaffold
-- built for this same migration's own §7 dry-run (034-owner-email-review-
-- package.md §12i's pre-apply checklist, item (b)) -- same standard as
-- 031/033's own written-and-executed rollbacks, not merely asserted safe.
-- Execution evidence (pre-DROP state, the reversal, post-DROP verification,
-- each with raw psql output): review package's own new §13.
--
-- Reverses 034 in the MIRROR ORDER of 034's own forward steps (last
-- forward step first) -- unlike 030's own rollback, this migration is
-- PURELY ADDITIVE (three ALTER TABLE ADD COLUMN, one CHECK widen, one
-- CREATE TABLE) with no renames and no data transform, so there is no
-- "restore data before renaming back" ordering hazard to mirror. Safe by
-- construction, not merely by care: 034 has NEVER applied to prod or
-- test-db, so no real row anywhere has ever written any of the new
-- delivery_status values or populated any of the three new users columns
-- -- reversing the CHECK to its narrower form cannot orphan a real row
-- into an now-illegal value, because no such row exists.
--
--   1. DROP TABLE owner_email_verifications -- reverses 034's §3 (CREATE
--      TABLE + its own index, RLS, grants, comment). PostgreSQL drops a
--      table's own indexes, constraints, and RLS policies automatically
--      when the table itself is dropped -- no separate DROP INDEX/DROP
--      POLICY needed.
--   2. Restore dprs_delivery_status_check to its ORIGINAL 023 definition
--      -- reverses 034's §2 (the widened CHECK). Byte-identical to
--      023_dpr_reports.sql's own CHECK, confirmed by reading that file
--      directly, not recalled.
--   3. DROP the three users columns -- reverses 034's §1 (ADD COLUMN x3 +
--      COMMENT; the COMMENT drops implicitly with its column, same as a
--      column's CHECK constraint does).
--
-- Verify BEFORE running: no application code path has EVER been deployed
-- that writes any of these columns or CHECK values (grepped as of
-- 2026-08-31: zero references to notification_email, no_report_sent,
-- owner_send_failed, no_report_failed, pm_notified, skipped_no_template,
-- skipped_unverified, or whatsapp_declined_at anywhere in lib/ or app/) --
-- this rollback's own "safe by construction" claim above depends on that
-- staying true at rollback time, not just at the moment this file was
-- written. Re-check before running against a database that has since had
-- real application code deployed against it.

BEGIN;

-- 1. Reverses 034 §3.
DROP TABLE public.owner_email_verifications;

-- 2. Reverses 034 §2 -- restore 023's original five-value CHECK exactly.
ALTER TABLE public.dprs DROP CONSTRAINT dprs_delivery_status_check;
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_delivery_status_check
    CHECK (delivery_status IN (
      'pending', 'delivered', 'paused', 'skipped_no_data', 'failed'
    ));

-- 3. Reverses 034 §1.
ALTER TABLE public.users
  DROP COLUMN notification_email,
  DROP COLUMN notification_email_verified_at,
  DROP COLUMN whatsapp_declined_at;

COMMIT;
