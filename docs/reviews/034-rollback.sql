-- docs/reviews/034-rollback.sql
-- Down-migration for 034_owner_email_delivery.sql -- NOT a numbered
-- migration file, same convention as 030-rollback.sql: this project's
-- supabase/migrations/ directory holds forward migrations only; a numbered
-- slot here would confuse migration-lint and `supabase migration list`'s
-- ledger correlation.
--
-- Written AND EXECUTED 2026-08-31, against the disposable local scaffold
-- built for this same migration's own §7 dry-run (034-owner-email-review-
-- package.md §13's pre-apply checklist, item (b)) -- same standard as
-- 031/033's own written-and-executed rollbacks, not merely asserted safe.
-- REVISED 2026-08-31, external review, blocking finding: the first
-- version's own "safe by construction" claim below was incomplete -- see
-- the PRECONDITION and STEP 2 GUARD sections for what was missing and why.
-- Execution evidence (pre-DROP state, the reversal, post-DROP verification,
-- both the clean path and the now-guarded blocking path, each with raw
-- psql output): review package's own §13.
--
-- Reverses 034 in the MIRROR ORDER of 034's own forward steps (last
-- forward step first) -- unlike 030's own rollback, this migration is
-- PURELY ADDITIVE (three ALTER TABLE ADD COLUMN, one CHECK widen, one
-- CREATE TABLE) with no renames and no data transform, so there is no
-- "restore data before renaming back" ordering hazard to mirror.
--
--   1. DROP TABLE owner_email_verifications -- reverses 034's §3 (CREATE
--      TABLE + its own index, RLS, grants, comment). PostgreSQL drops a
--      table's own indexes, constraints, and RLS policies automatically
--      when the table itself is dropped -- no separate DROP INDEX/DROP
--      POLICY needed.
--   2. GUARDED restore of dprs_delivery_status_check to its ORIGINAL 023
--      definition -- reverses 034's §2 (the widened CHECK). See STEP 2
--      GUARD below for why this is no longer a bare ALTER.
--   3. DROP the three users columns -- reverses 034's §1 (ADD COLUMN x3 +
--      COMMENT; the COMMENT drops implicitly with its column, same as a
--      column's CHECK constraint does).
--
-- PRECONDITION (external review, 2026-08-31, BLOCKING -- fixed before
-- rehearsal, not deferred to it): this file is executable ONLY while no
-- `dprs` row carries a post-034 `delivery_status` value (`pm_notified`,
-- `skipped_no_template`, `skipped_unverified`, `no_report_sent`,
-- `owner_send_failed`, `no_report_failed`). STEP 2's restored CHECK is
-- validated by Postgres against EVERY existing row the moment `ADD
-- CONSTRAINT` runs -- a row carrying one of the six new values fails that
-- validation with `23514` and aborts the whole transaction. **This is the
-- CORRECT failure** -- a rollback that silently stranded rows in a value
-- the restored, narrower constraint no longer recognises would be worse,
-- a data-integrity defect masquerading as a successful rollback. STEP 2's
-- own guard block (below) makes this failure a NAMED, DIAGNOSED one
-- instead of a bare constraint-violation error, but it does not, and is
-- not meant to, make this file runnable regardless of data state --
-- confirm the precondition holds (or resolve the offending rows) before
-- running this file for real, the same discipline this project's own
-- rehearsal rules already require for every other apply-affecting action.
--
-- STEP 2 GUARD, ARGUED: a named DO block over a remap table. Two shapes
-- were weighed:
--   REJECTED: a remap table (each of the six new values mapped to one of
--   the five old ones -- e.g. no_report_sent -> delivered, owner_send_
--   failed -> failed) would let STEP 2 always succeed, silently. Rejected
--   on two grounds, not one: (a) it PERMANENTLY LOSES real distinctions --
--   collapsing owner_send_failed (a real report never reached the owner)
--   and no_report_failed (a mere notice never reached the owner) into the
--   same `failed` value erases exactly the severity difference §12a's own
--   value-set argument exists to preserve, silently, at the moment a human
--   most needs the detail (an incident bad enough to warrant rolling this
--   migration back). (b) it is ACTIVELY MISLEADING going forward -- a row
--   remapped to `failed` reads, to any future reader, as an ordinary
--   pre-034 PM-notify failure (`failed`'s ORIGINAL, narrower meaning),
--   with nothing marking it as a remapped stand-in for something else.
--   CHOSEN: a DO block that COUNTS offending rows before STEP 2's ALTER
--   ever runs, and RAISEs a named exception listing (up to 20) offending
--   row ids if any exist. This is the SAME shape this project's own
--   ADDITIVE IDEMPOTENT convention already uses for a forward migration's
--   own pre-apply assertion (CLAUDE.md's "ONE-TIME MIGRATION STATEMENT"
--   rule: "an in-transaction structural assertion... converts any residual
--   surprise into a full-transaction abort instead of a silent gap") --
--   applied here to a rollback instead of a forward apply, same principle.
--   A human decides what happens to each named row (update it to a
--   pre-034 status by hand, or defer the rollback) with full information,
--   rather than the rollback deciding FOR them, silently, in a direction
--   that cannot be told apart from ordinary data later.
--
-- STEP 3 DATA LOSS, DOCUMENTED (external review, 2026-08-31 -- same
-- treatment as 030-rollback.sql's own STEP 6 for the attendance/
-- attendance_defaulted/attendance_raw drop): DROP COLUMN destroys
-- `notification_email_verified_at` and `whatsapp_declined_at` data BY
-- DESIGN, unconditionally, for every row -- there is no narrower operation
-- that reverses "these columns existed" without also reversing "whatever
-- was recorded in them." Since 034 has never applied to prod or test-db as
-- of this file's writing, this is a documented FUTURE-FACING risk (what
-- this step will destroy the day it is actually run against a database
-- that has real owner rows), not a claim that it has destroyed anything
-- yet -- verify the same way STEP 2's precondition is verified: check what
-- is actually in these columns before running this file for real, not
-- assumed empty because it was empty when this file was written.
--
-- STEP 1 DATA LOSS, NAMED BRIEFLY, SAME CATEGORY AS STEP 3, NOT TREATED AS
-- EQUALLY LIKELY: DROP TABLE destroys any real `owner_email_verifications`
-- rows (live confirmation tokens) unconditionally. No guard is proposed
-- for this step specifically -- unlike STEP 2, a DROP TABLE has no
-- "validate against existing data and fail" mechanism in Postgres to hang
-- a guard off; the only way to protect this data would be an archive-first
-- step, which is a heavier decision than this rollback's own scope (named
-- so the omission reads as considered, not missed).

BEGIN;

-- 1. Reverses 034 §3. DATA LOSS: destroys any real confirmation-token rows
--    -- see STEP 1 DATA LOSS note above.
DROP TABLE public.owner_email_verifications;

-- 2. Reverses 034 §2 -- GUARDED restore of 023's original five-value CHECK.
--    See STEP 2 GUARD above for the argument; see PRECONDITION above for
--    what this guard checks and why a bare ALTER was not sufficient.
DO $$
DECLARE
  offending_count INT;
  sample_ids TEXT;
BEGIN
  SELECT count(*) INTO offending_count
    FROM public.dprs
    WHERE delivery_status IN (
      'pm_notified', 'skipped_no_template', 'skipped_unverified',
      'no_report_sent', 'owner_send_failed', 'no_report_failed'
    );

  IF offending_count > 0 THEN
    SELECT string_agg(id::text, ', ') INTO sample_ids
      FROM (
        SELECT id FROM public.dprs
        WHERE delivery_status IN (
          'pm_notified', 'skipped_no_template', 'skipped_unverified',
          'no_report_sent', 'owner_send_failed', 'no_report_failed'
        )
        ORDER BY id
        LIMIT 20
      ) t;

    RAISE EXCEPTION
      'Rollback aborted: % dprs row(s) carry a delivery_status value the '
      'restored CHECK cannot accept (pm_notified / skipped_no_template / '
      'skipped_unverified / no_report_sent / owner_send_failed / '
      'no_report_failed). First % row id(s): %. Resolve each row -- update '
      'it to a pre-034 status by hand, or defer this rollback -- before '
      're-running this file. This is the correct failure: a silent restore '
      'would strand these rows in a value the live constraint no longer '
      'recognises.',
      offending_count, LEAST(offending_count, 20), sample_ids;
  END IF;
END $$;

ALTER TABLE public.dprs DROP CONSTRAINT dprs_delivery_status_check;
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_delivery_status_check
    CHECK (delivery_status IN (
      'pending', 'delivered', 'paused', 'skipped_no_data', 'failed'
    ));

-- 3. Reverses 034 §1. DATA LOSS: destroys notification_email_verified_at
--    and whatsapp_declined_at data unconditionally -- see STEP 3 DATA LOSS
--    note above.
ALTER TABLE public.users
  DROP COLUMN notification_email,
  DROP COLUMN notification_email_verified_at,
  DROP COLUMN whatsapp_declined_at;

COMMIT;
