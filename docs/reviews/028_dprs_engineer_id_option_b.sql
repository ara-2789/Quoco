-- 028_dprs_engineer_id_option_b.sql -- OPTION B (partial unique index, no DELETE)
-- REJECTED (review round 2, 2026-08-14) -- KEPT FOR THE RECORD, NOT A LIVE
-- CHOICE. Every dprs writer is a supabase-js .upsert() with
-- { onConflict: 'project_id,log_date' } (dispatch.ts:50, dispatch.ts:97,
-- route.ts:65). Postgres only infers a PARTIAL unique index (the one this
-- file creates at Step 4) as an ON CONFLICT arbiter when the conflict
-- clause itself carries a matching WHERE predicate -- PostgREST/supabase-js
-- has no way to express that predicate through .upsert()'s onConflict
-- option. Every one of those three upserts would throw 42P10
-- ("there is no unique or exclusion constraint matching the ON CONFLICT
-- specification") the first night this schema went live. This is not a
-- cost trade-off against Option A, as the prior draft of this file and the
-- review package both framed it -- it is mechanically broken as written.
-- Neither this file nor the package's original trade-off section knew this
-- when first drafted; recorded here explicitly rather than silently
-- switching to Option A without saying why.
--
-- DRAFT for external review -- NOT applied, NOT committed, NOT to be
-- applied. Alternative to 028_dprs_engineer_id_option_a.sql (Option A,
-- DECIDED). See the review package's §2 for the full correction.
--
-- No PITR step would have been required for this option -- nothing
-- destructive here, which was real but not sufficient to make it viable.

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
