-- =============================================================================
-- 046_hindrances_report_date.sql
-- Stage 4 of the media capability's DPR-matching work (docs/plans/
-- media-capture-design.md item 20). Adds hindrances.report_date, a
-- GENERATED STORED column computing the IST calendar date of created_at,
-- plus an index over (project_id, reported_by, report_date).
--
-- HELD, NOT APPLIED. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, this file stays in docs/reviews/ until the test-db apply this pass
-- performs actually happens -- see that step's own record for the apply
-- sequence and evidence. This pass's own explicit instruction: TEST-DB ONLY
-- (exfccwlrhoutkgrlikod), never prod.
--
-- PURPOSE. Stage 4 needs to match a DPR to the hindrance(s) reported on the
-- same project-day by the same engineer, so an owner's DPR email can carry
-- the hindrances that belong to it. The natural-looking join column,
-- hindrances.dpr_included, is NOT usable for this -- lib/dpr/schema.ts:663
-- confirms it unusable as the join: the column has had no DEFAULT since
-- migration 016 ("set by the DPR generation job, not defaulted at insert")
-- and nothing has ever written it. The real join today (lib/dpr/
-- assemble.ts:802-820,
-- fetchEngineerHindrances) is project_id + reported_by(engineer_id) +
-- created_at's IST calendar date compared to log_date -- computed
-- CLIENT-SIDE (istDateString(new Date(row.created_at)) === log_date) after
-- fetching every one of that engineer's hindrances on that project,
-- unfiltered by date, from Postgres. report_date makes that same
-- comparison possible directly in SQL (`WHERE report_date = $log_date`),
-- and the new index (project_id, reported_by, report_date) is shaped for
-- exactly that lookup -- the same three columns this file's own assembler
-- already filters/matches on today, just made indexable.
--
-- WHAT THIS DOES NOT DO -- A NAMED PRODUCT DECISION, NOT AN OVERSIGHT
-- (Aravind, 2026-09-16, decision (a)). A hindrance reported AFTER its day's
-- DPR has already been sent (the 20:30 IST owner-send cron has already run
-- for that project-day) will never appear in any DPR email -- there is no
-- "roll it into tomorrow's report" or "resend today's report" mechanism in
-- this migration or anywhere else in this codebase today. That gap is
-- accepted, not fixed here; a roll-forward mechanism for a late hindrance is
-- backlog, unscoped, and out of reach of this migration, which only adds a
-- column and an index -- no function, RLS, or trigger changes at all.
-- apply_hindrance_flow_turn is NOT touched by this file.
--
-- THE EXPRESSION IS A RECOMPUTE, NOT A BACKFILL. report_date is GENERATED
-- ALWAYS AS an expression of created_at -- Postgres computes it for every
-- existing row the moment this ALTER TABLE runs (there is no separate
-- UPDATE step, and none is needed), and would recompute EVERY row again if
-- this expression is ever changed in a future migration (e.g. a different
-- timezone, a different cutoff rule) -- the same full-table rewrite cost
-- 043's and 044's own expires_at columns already carry and document.
--
-- created_at IS NULLABLE (public.hindrances, migration 001: `created_at
-- TIMESTAMPTZ DEFAULT now()`, no NOT NULL) -- so report_date is NULL
-- wherever created_at is NULL. A generated column cannot be more
-- constrained than the column it is generated from; a hindrance row with a
-- NULL created_at (none exist on test-db as of this pass's own pre-probe,
-- but nothing here forbids one existing later) will carry a NULL
-- report_date, and the new index tolerates that the same way any ordinary
-- btree index tolerates a NULL key -- it simply does not help a query
-- keyed on report_date find that row, which is the same DPR-matching gap a
-- silently-unmatched hindrance would already represent.
--
-- =============================================================================

BEGIN;

ALTER TABLE public.hindrances
  ADD COLUMN report_date DATE GENERATED ALWAYS AS (
    (timezone('Asia/Kolkata', created_at))::date
  ) STORED;

CREATE INDEX idx_hindrances_project_reporter_report_date
  ON public.hindrances (project_id, reported_by, report_date);

COMMENT ON COLUMN public.hindrances.report_date IS
  'IST calendar date of created_at (migration 046, 2026-09-16). Generated '
  'STORED, not backfilled -- Postgres computes it for every existing row at '
  'ALTER time and recomputes every row if this expression is ever changed. '
  'Purpose: stage 4 DPR<->hindrance matching on project_id + reported_by + '
  'report_date (lib/dpr/assemble.ts:802-820''s own client-side IST-date '
  'filter, made indexable) -- dpr_included is NOT this join (lib/dpr/'
  'schema.ts:663: no DEFAULT since migration 016, nothing has ever '
  'written it). A hindrance reported after its day''s DPR has already been '
  'sent never appears in any DPR email -- no roll-forward mechanism exists '
  '(Aravind, 2026-09-16, decision (a); roll-forward is backlog). '
  'created_at is nullable, so report_date is NULL wherever created_at is '
  'NULL.';

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- BEGIN;
--
-- DROP INDEX IF EXISTS public.idx_hindrances_project_reporter_report_date;
--
-- ALTER TABLE public.hindrances DROP COLUMN report_date;
--
-- COMMIT;
