-- 028_dprs_engineer_id_option_a.sql -- OPTION A (DELETE) -- DECIDED
-- DRAFT for external review -- NOT applied, NOT committed to supabase/migrations/.
-- Adds engineer_id to dprs for the per-engineer report reformat
-- (docs/dpr-engineer-report-spec.md). See the accompanying review package for
-- full context, the §0 gate evaluation, and the runbook this file's DELETE
-- step depends on. Option A is DECIDED (review round 2, 2026-08-14) -- Option
-- B is mechanically broken, not merely costlier; see the package's revision-7
-- correction for why, and why this decision does not wait on any of the
-- other revisions in that round.
--
-- PITR MUST BE OBSERVED, LIVE, BEFORE THIS FILE RUNS -- not a checklist
-- entry, an actual dashboard/API check (CLAUDE.md §0's standing rule).
-- Restore window pinned in the review package's runbook section, not here.
--
-- SEQUENCING (review round 2, B3; AMENDED round 3, B3-amend): the danger
-- window is NOT "avoid the 20:00 IST cron" -- /api/jobs/tick runs every
-- MINUTE (* * * * *, vercel.json), so ANY dpr_generate job sitting
-- pending/running/retry-scheduled at apply time gets claimed and executed
-- via tick within 60 seconds, hitting the dropped constraint through
-- dispatch's upserts regardless of time of day. The real safe zone is "the
-- dpr_generate queue is proven empty," not a clock window.
--
-- STEP 1.5 (mandatory, immediately pre-apply, before BEGIN below): probe the
-- jobs table and require ZERO rows before proceeding --
--   SELECT id, status, attempt_count, next_retry_at FROM jobs
--     WHERE type = 'dpr_generate' AND status != 'succeeded';
-- PROCEED only on zero rows, pasted raw in the applied runbook record, not
-- reused from an earlier reading -- re-probe live, immediately before BEGIN.
-- Any row found: STOP, resolve it (let it complete via tick, or intervene
-- manually) before re-probing.
--
-- The probe is only valid if the 20:00 cron is the sole producer of
-- dpr_generate jobs. IT IS NOT: scripts/generate-one-dpr.ts also writes
-- directly to dprs (its own onConflict:'project_id,log_date' upsert,
-- confirmed in the round-2 B2 inventory). THE MANUAL SCRIPT MUST NOT RUN
-- between Step 1.5's probe and the deploy landing -- solo operator, so:
-- Aravind does not run it, and Claude Code does not run it, for the
-- duration of this apply.
--
-- NO SCHEMA-VERSION MARKER NEEDED in the cron route -- Step 1.5's probe
-- makes the failure mode it would guard against structurally impossible;
-- adding one on top would be a redundant guard against a state Step 1.5
-- already rules out.
--
-- Vercel deploy of the corresponding app code follows IMMEDIATELY after
-- this file's COMMIT, same session -- see the review package's B3 section
-- for the full runbook. The gap between this apply and the deploy landing
-- is live breakage for the three existing dprs upserts (dispatch.ts:50,97;
-- route.ts:65), which still target the OLD onConflict key until the deploy
-- ships.
--
-- SAME-DAY DEADLINE (restored round 4 -- round 3's B3-amend struck this
-- wholesale along with the window it was replacing, but it guards a
-- DIFFERENT consumer than Step 1.5 and both are required together:
--   * Step 1.5 (above) guards the CONSUMER side -- jobs already queued,
--     executing via tick inside the apply->deploy gap.
--   * This deadline guards the PRODUCER side -- if the deploy stalls past
--     20:00 IST, the nightly cron itself runs on the OLD deployed code
--     against the NEW schema: a zero-data project hits the dropped
--     onConflict target directly (42P10 on route.ts:65's still-old-shape
--     upsert); a data-bearing project enqueues an old-shape payload with
--     no engineer_id, which tick then retries against the NEW dispatch
--     code once the deploy eventually lands -- a payload
--     handleDprGenerateJob must reject loudly (see the "pre-028 payload
--     shape" assertion in the implementation, not silently coerce).
-- ABORT THRESHOLD: deploy confirmed live by 19:00 IST -- a full hour of
-- margin before the 20:00 cron, not a just-in-time confirm. If the deploy
-- is not confirmed live by 19:00 IST, treat it as a failed apply for that
-- day: do not let the 20:00 cron fire against a half-migrated state:
-- either get the deploy live before 20:00 by other means, or, failing
-- that, this needs an emergency decision with Aravind before 20:00, not a
-- silent hope the deploy finishes in time.
--
-- PRE-APPLY STATE -- RAW QUERY OUTPUT, PINNED VERBATIM (2026-08-14, review
-- round 2, S7). `SELECT id, project_id, log_date, delivery_status,
-- generation_status, content IS NULL AS content_is_null, delivered_owner_at
-- FROM dprs ORDER BY created_at;`:
--   [{"id":"35a2f41c-64ec-41f5-a763-4afe05940ca5","project_id":"acef67fe-e775-439d-82b8-5b8526868d6d",
--     "log_date":"2026-08-12","delivery_status":"skipped_no_data","generation_status":"idle",
--     "content_is_null":true,"delivered_owner_at":null},
--    {"id":"af7760e8-2457-4c11-bc35-52929a0bbf54","project_id":"acef67fe-e775-439d-82b8-5b8526868d6d",
--     "log_date":"2026-08-13","delivery_status":"pending","generation_status":"idle",
--     "content_is_null":false,"delivered_owner_at":null}]
-- af7760e8's one underlying daily_logs row: engineer_id
-- 3534756b-2a32-4b91-954b-0bab15c2dba1 (confirmed by direct query, PROCEED
-- if unchanged at apply time, STOP and re-derive the backfill value if not).
--
-- MULTI-ENGINEER CHECK -- RAW OUTPUT, PINNED, WHOLE-TABLE NOT JUST THESE TWO
-- DATES (2026-08-14, S7). `SELECT project_id, log_date, count(DISTINCT
-- engineer_id) FROM daily_logs GROUP BY project_id, log_date HAVING
-- count(DISTINCT engineer_id) > 1;` -> zero rows, entire daily_logs table.
--
-- REAL CONSTRAINT NAME -- CONFIRMED FROM THE CATALOG, NOT ASSUMED (2026-08-14,
-- S7). `SELECT conname, contype, pg_get_constraintdef(oid) FROM pg_constraint
-- WHERE conrelid = 'public.dprs'::regclass;` includes:
--   dprs_project_id_log_date_key | u | UNIQUE (project_id, log_date)
--   dprs_project_id_fkey         | f | FOREIGN KEY (project_id) REFERENCES projects(id)
--   dprs_tenant_id_fkey          | f | FOREIGN KEY (tenant_id) REFERENCES tenants(id)
-- The dropped-constraint name below was an assumption in the prior draft;
-- confirmed correct by this probe, not blindly trusted.
--
-- NOTE, NOT FIXED HERE: dprs_project_id_fkey / dprs_tenant_id_fkey (023) are
-- PLAIN single-column FKs, not the composite same-tenant pattern this file's
-- own engineer_id FK below uses. 023's review package signed these off
-- without applying or discussing the 017 composite-FK pattern -- a latent,
-- pre-existing gap this migration does not compound (engineer_id below IS
-- composite) but also does not fix. Flagged so it is not later mistaken for
-- this migration's own oversight.

BEGIN;

-- Step 1: add the column nullable first -- cannot add NOT NULL directly
-- while af7760e8 has no value yet; backfilled in step 2, enforced NOT NULL
-- in step 4 once every remaining row has one.
--
-- COMPOSITE SAME-TENANT FK (review round 2, B1) -- REQUIRED, not optional,
-- and not the 019 plain-FK exception either. 017's precedent (docs/schema.md
-- ~L460-468) added composite (col, tenant_id) -> parent(id, tenant_id) FKs
-- specifically because the referencing column is CLIENT- or CALLER-WRITABLE
-- and could smuggle a cross-tenant id past a single-column FK; 027's
-- checkin_escalations (three days before this file was written) applies the
-- identical pattern to its own engineer_id. 019's daily_log_edits is the
-- ONE precedented exception, and it does NOT apply here: that table's
-- tenant_id/project_id are copied inside a SECURITY DEFINER RPC from an
-- already-verified row, never from caller input -- there is no app-layer
-- INSERT path at all. dprs.engineer_id has no equivalent guarantee: it
-- travels from the roster query (app/api/cron/dpr-generate/route.ts) into a
-- JSON job payload, through the jobs queue, and is read back out by
-- handleDprGenerateJob (lib/dpr/dispatch.ts) -- all in application code, no
-- DB-enforced copy-from-verified-row step anywhere in that path. A bug
-- anywhere in that chain could pair a mismatched engineer_id with the wrong
-- project_id/tenant_id; the composite FK is the DB-level backstop, exactly
-- what 017's pattern exists for. Parent index: users_id_tenant_id_key,
-- UNIQUE(id, tenant_id), added by migration 017.
--
-- ON DELETE RESTRICT, not CASCADE (unlike checkin_escalations' CASCADE):
-- dprs is an archival, owner-facing document, not operational tracking
-- state -- deleting a user should never silently cascade-delete a historical
-- report referencing them. In practice this is inert: users are never
-- hard-deleted (CLAUDE.md §10a), only status='deactivated'. RESTRICT states
-- that intent explicitly rather than leaving it implicit.
ALTER TABLE public.dprs ADD COLUMN engineer_id UUID;

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

-- Step 5: the composite FK (B1) -- added after backfill/NOT NULL so it
-- validates against real data, not an empty/nullable column.
ALTER TABLE public.dprs
  ADD CONSTRAINT dprs_engineer_id_tenant_id_fkey
  FOREIGN KEY (engineer_id, tenant_id) REFERENCES public.users (id, tenant_id)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

-- Step 6: widen the unique key. Constraint name confirmed against the live
-- catalog above (S7), not assumed.
ALTER TABLE public.dprs DROP CONSTRAINT dprs_project_id_log_date_key;
ALTER TABLE public.dprs ADD CONSTRAINT dprs_project_id_engineer_id_log_date_key
  UNIQUE (project_id, engineer_id, log_date);

COMMIT;

-- NOT reversible past this point without a real data decision, once the new
-- per-engineer pipeline produces its first genuine multi-engineer day --
-- see the review package §3 for why. The DELETE above is never reversible
-- by schema rollback at all, only by PITR restore.
