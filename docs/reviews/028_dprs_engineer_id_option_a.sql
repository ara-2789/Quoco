-- 028_dprs_engineer_id_option_a.sql -- OPTION A (DELETE)
-- DRAFT for external review — NOT applied, NOT committed to supabase/migrations/.
-- Adds engineer_id to dprs for the per-engineer report reformat
-- (docs/dpr-engineer-report-spec.md). See the accompanying review package for
-- full context, the §0 gate evaluation, and the runbook this file's DELETE
-- step depends on.
--
-- PITR MUST BE OBSERVED, LIVE, BEFORE THIS FILE RUNS -- not a checklist
-- entry, an actual dashboard/API check (CLAUDE.md §0's standing rule).
-- Restore window pinned in the review package's runbook section, not here.
--
-- PRE-APPLY STATE, CONFIRMED BY DIRECT QUERY (not assumed):
--   dprs currently has exactly TWO rows, both project acef67fe-e775-439d-
--   82b8-5b8526868d6d:
--     35a2f41c-64ec-41f5-a763-4afe05940ca5  log_date 2026-08-12
--       delivery_status='skipped_no_data', content IS NULL,
--       delivered_owner_at IS NULL, ZERO underlying daily_logs rows.
--     af7760e8-2457-4c11-bc35-52929a0bbf54  log_date 2026-08-13
--       ONE underlying daily_logs row, engineer_id
--       3534756b-2a32-4b91-954b-0bab15c2dba1.
--   No multi-engineer project-day exists in prod today -- confirmed by
--   GROUP BY (project_id, log_date) HAVING count(DISTINCT engineer_id) > 1,
--   zero rows returned.

BEGIN;

-- Step 1: add the column nullable first -- cannot add NOT NULL directly
-- while af7760e8 has no value yet; backfilled in step 2, enforced NOT NULL
-- in step 4 once every remaining row has one.
ALTER TABLE public.dprs ADD COLUMN engineer_id UUID REFERENCES public.users(id);

-- Step 2: backfill the one real row. Safe ONLY because today's data has at
-- most one engineer per (project_id, log_date) -- confirmed above by direct
-- query, not assumed. This LIMIT 1 is not a general-purpose backfill
-- pattern; it is correct for exactly the two rows that exist right now,
-- which is why this migration is being written now, before any real
-- multi-engineer day exists to make it ambiguous.
UPDATE public.dprs d
SET engineer_id = (
  SELECT dl.engineer_id
  FROM public.daily_logs dl
  WHERE dl.project_id = d.project_id AND dl.log_date = d.log_date
  LIMIT 1
)
WHERE d.engineer_id IS NULL;

-- Step 3: delete the one project-level DPR-17 skip marker that has no
-- engineer behind it at all (zero daily_logs rows for that project-day).
-- The new design skips per ROSTER ENGINEER, never per project (see the
-- review package's §1) -- this row's concept has no equivalent under the
-- new schema, and there is no engineer_id a backfill could honestly assign
-- to it. content IS NULL and delivered_owner_at IS NULL for this row --
-- nothing was ever shown to anyone.
--
-- DESTRUCTIVE. THIS IS WHY §0 CONDITION (d) TRIPS FOR THIS MIGRATION --
-- see the review package, do not run this statement without the PITR
-- observation above having already happened, live, this session.
DELETE FROM public.dprs WHERE id = '35a2f41c-64ec-41f5-a763-4afe05940ca5';

-- Step 4: now safe -- every remaining row has a value.
ALTER TABLE public.dprs ALTER COLUMN engineer_id SET NOT NULL;

-- Step 5: widen the unique key. Constraint name below assumes Postgres's
-- default auto-generated name for the inline UNIQUE(project_id, log_date)
-- in migration 023 -- CONFIRM THE REAL NAME via
-- information_schema.table_constraints before running this, do not trust
-- the assumed name blindly.
ALTER TABLE public.dprs DROP CONSTRAINT dprs_project_id_log_date_key;
ALTER TABLE public.dprs ADD CONSTRAINT dprs_project_id_engineer_id_log_date_key
  UNIQUE (project_id, engineer_id, log_date);

COMMIT;

-- NOT reversible past this point without a real data decision, once the new
-- per-engineer pipeline produces its first genuine multi-engineer day --
-- see the review package §3 for why. The DELETE above is never reversible
-- by schema rollback at all, only by PITR restore.
