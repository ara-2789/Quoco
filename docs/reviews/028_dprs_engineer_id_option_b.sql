-- 028_dprs_engineer_id_option_b.sql -- OPTION B (partial unique index, no DELETE)
-- DRAFT for external review -- NOT applied, NOT committed. Alternative to
-- 028_dprs_engineer_id_option_a.sql (Option A, DELETE-based). See the review
-- package's §2 for the full trade-off writeup; this file is Option B's
-- exact text, not a paraphrase.
--
-- No PITR step required for this option -- nothing destructive here.

BEGIN;

-- Step 1: nullable -- stays nullable permanently under this option.
ALTER TABLE public.dprs ADD COLUMN engineer_id UUID REFERENCES public.users(id);

-- Step 2: backfill the one real row. Identical to Option A's step 2, same
-- LIMIT 1 caveat -- correct today (confirmed single-engineer per project-day
-- by direct query), not a general-purpose pattern. Unconditionally correct
-- regardless of which option is chosen: an UPDATE, not a DELETE, and this
-- row deserves its real engineer_id either way.
UPDATE public.dprs d
SET engineer_id = (
  SELECT dl.engineer_id
  FROM public.daily_logs dl
  WHERE dl.project_id = d.project_id AND dl.log_date = d.log_date
  LIMIT 1
)
WHERE d.engineer_id IS NULL;

-- Step 3: 35a2f41c-64ec-41f5-a763-4afe05940ca5 is DELIBERATELY LEFT ALONE --
-- engineer_id stays NULL, permanently. It sits outside the partial index
-- below and is never touched again; the new pipeline never writes a NULL
-- engineer_id, so nothing collides with it.

-- Step 4: partial unique index -- protects every row that carries a real
-- engineer_id (i.e. every row the new pipeline ever writes) exactly as
-- fully as a full-table UNIQUE constraint would. No NOT NULL constraint on
-- the column itself under this option -- 35a2f41c would violate it.
CREATE UNIQUE INDEX dprs_project_engineer_date_key
  ON public.dprs (project_id, engineer_id, log_date)
  WHERE engineer_id IS NOT NULL;

-- Old (project_id, log_date) constraint from migration 023 is dropped --
-- confirm its real name via information_schema before running, same
-- caveat as Option A.
ALTER TABLE public.dprs DROP CONSTRAINT dprs_project_id_log_date_key;

COMMIT;

-- Fully reversible: no DELETE, no data loss, no §0 (d) trip. The permanent
-- cost is NOT a schema risk -- it's that dprs.engineer_id is nullable at
-- the type level forever, for a table that will never again have a null
-- row in practice, purely to accommodate this one 2026-08-12 test artifact.
