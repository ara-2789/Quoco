-- 028_dprs_engineer_id_option_a.sql -- OPTION A (DELETE) -- DECIDED
--
-- PROCESS GAP, FOUND 2026-08-19 (while numbering new migrations for #67/#69's
-- package work), CORRECTED IN TWO PASSES -- STATED PLAINLY, NOT SMOOTHED
-- OVER. Pass 1 (2026-08-19): this file lived only at docs/reviews/
-- 028_dprs_engineer_id_option_a.sql, marked "DRAFT ... NOT applied, NOT
-- committed to supabase/migrations/" -- but the schema change it describes
-- IS live on both prod and test-db, verified by direct catalog observation
-- (dprs.engineer_id UUID NOT NULL, dprs_engineer_id_tenant_id_fkey composite
-- FK, UNIQUE(project_id, engineer_id, log_date) -- all three confirmed
-- present via pg_constraint / information_schema.columns, byte-for-byte
-- matching this file's own DDL). Copied into place as a FAITHFUL RECORD of
-- already-true state (CLAUDE.md §6: "EVERY numbered file currently present
-- in that directory is LIVE") -- this changed no schema, applied nothing.
--
-- Pass 1's OWN FRAMING WAS WRONG, corrected 2026-08-20 (H1/H2 follow-up):
-- copying the file INTO the scanned supabase/migrations/ directory while
-- schema_migrations still lacked a '028' row created a state MORE dangerous
-- than the one being fixed -- before, the orphaned file sat outside any
-- tool's scan path and the ledger gap was inert; after, a directory-scanning
-- apply (`supabase db push` or equivalent) would ATTEMPT TO RE-RUN this
-- file's ADD COLUMN / SET NOT NULL / constraint creation / DELETE against a
-- database that already has all of it -- not idempotent, fails at best,
-- partially executes at worst. Pass 1 also mis-named the fix as "a manual
-- INSERT INTO schema_migrations" -- WRONG. The sanctioned mechanism is
-- `supabase migration repair --status applied <version>`, which marks a
-- version applied WITHOUT executing it -- a standard tool operation this
-- project has already used (the final step of the 007 prod-apply sequence),
-- not hand-editing a system table.
--
-- THREE-WAY RECONCILIATION (2026-08-20, H2), raw output in the session
-- record, not restated in full here: PROD's ledger already carried a '028'
-- row (`dprs_engineer_id`) -- no repair needed there for this version, and
-- PROD was never touched by the fix below. TEST-DB's ledger was missing
-- FIVE versions whose schema+files both already existed: 023, 024, 025,
-- 027, AND 028 -- the same defect this header originally described as
-- isolated to 028 turned out to be broader on test-db specifically.
--
-- REPAIR'S OWN TRACK RECORD, CHECKED AGAINST CLAUDE.md RATHER THAN ASSUMED
-- (2026-08-20), THEN TESTED LIVE, NOT LEFT AS A GUESS: `supabase migration
-- repair --status applied` succeeded once, early (CLAUDE.md's own Week-1
-- note: used to repair 001-005 "before pushing 006"), then was documented
-- as 28P01-blocked on two later attempts (025, 027), both of which fell
-- back to a manual ledger INSERT for that reason. Given that history,
-- `023` alone was tried first, live, on test-db, per an explicit scoped
-- go-ahead (W1) -- NOT assumed working from the early success, and NOT
-- assumed broken from the two later failures. IT SUCCEEDED, no 28P01,
-- `statements` auto-populated correctly by the tool from the real
-- migration file (verified by reading the row back, not assumed from the
-- command's own exit status). The remaining four (024, 025, 027, 028) were
-- then repaired the same way, all four succeeding identically.
--
-- DONE (2026-08-20), test-db only, verified before/after
-- (`SELECT version, name FROM supabase_migrations.schema_migrations`):
-- 19 rows -> 24 rows, exactly the five expected added, nothing else
-- changed, zero schema/catalog impact (repair marks applied, never
-- executes). Re-ran the three-way reconciliation after: zero migrations
-- remain in files+catalog but not ledger, on test-db. PROD untouched
-- throughout, per the scoped go-ahead's own explicit boundary.
--
-- ORIGINAL HEADER BELOW, PRESERVED AS WRITTEN (struck framing corrected only
-- where this note above already supersedes it):
--
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
-- STEP 1.5b (added 2026-08-14, after the pinned-state-went-stale finding,
-- review package S21/S23) -- FINAL PRE-BEGIN TABLE-SHAPE PROBE, immediately
-- before BEGIN, same breath as the jobs probe above:
--   SELECT id, delivery_status FROM dprs ORDER BY created_at;
-- MUST return EXACTLY the three known rows below (two markers, one real),
-- in this order, nothing more, nothing less:
--   35a2f41c... | skipped_no_data
--   af7760e8... | pending
--   3c14243f... | skipped_no_data
-- A fourth row (a new marker written by a cron that fired since this file
-- was last edited) means the DELETE list below is ALREADY stale again --
-- STOP, do not proceed, re-derive the DELETE list and re-pin this header
-- before trying again. This is the mechanical reason the pin goes stale on
-- a nightly cadence (S21.4): the probe exists specifically to catch that
-- recurrence at the last possible moment, not to be reasoned past.
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
-- ABORT THRESHOLD -- RECODIFIED 2026-08-14, review package §24: the
-- invariant is "deploy confirmed live at least ONE HOUR before the NEXT
-- dpr_generate-producing event," not the literal clock time "19:00 IST."
-- 19:00 IST is what that invariant equals for a DAYTIME apply, before that
-- day's cron has fired -- it is not the invariant itself. For an apply run
-- AFTER that day's cron has already fired (as tonight, 2026-08-14), the
-- next producer event is tomorrow's 20:00 IST cron, so the threshold is
-- confirmed-live by tomorrow 19:00 IST, not tonight. See §24 for the full
-- reasoning (this recodification exists because a literal "it's past
-- 20:00 IST" reading would have blocked an apply that is actually SAFER
-- than a daytime one). If the deploy is not confirmed live within one hour
-- of the next producer event, treat it as a failed apply for that event:
-- either get the deploy live by other means before it fires, or, failing
-- that, this needs an emergency decision with Aravind before it fires, not
-- a silent hope the deploy finishes in time.
--
-- PRE-APPLY STATE -- RAW QUERY OUTPUT, PINNED VERBATIM, RE-PINNED 2026-08-14
-- (~14:55 UTC, review package S21/S23 -- SUPERSEDES the original round-2/S7
-- two-row pin below, which went stale when a second zero-data marker
-- (3c14243f) was written by the still-rolled-back OLD code's 20:00 IST cron
-- on 2026-08-14. This is not a hypothetical staleness risk -- it already
-- happened once. If this file is reused on a LATER date without re-running
-- this exact pin, assume it is stale again; re-probe before trusting it.)
-- `SELECT id, project_id, log_date, delivery_status, generation_status,
-- content IS NULL AS content_is_null, delivered_owner_at FROM dprs ORDER BY
-- created_at;`:
--   [{"id":"35a2f41c-64ec-41f5-a763-4afe05940ca5","project_id":"acef67fe-e775-439d-82b8-5b8526868d6d",
--     "log_date":"2026-08-12","delivery_status":"skipped_no_data","generation_status":"idle",
--     "content_is_null":true,"delivered_owner_at":null},
--    {"id":"af7760e8-2457-4c11-bc35-52929a0bbf54","project_id":"acef67fe-e775-439d-82b8-5b8526868d6d",
--     "log_date":"2026-08-13","delivery_status":"pending","generation_status":"idle",
--     "content_is_null":false,"delivered_owner_at":null},
--    {"id":"3c14243f-9395-4c8d-923b-fd3ea1925b96","project_id":"acef67fe-e775-439d-82b8-5b8526868d6d",
--     "log_date":"2026-08-14","delivery_status":"skipped_no_data","generation_status":"idle",
--     "content_is_null":true,"delivered_owner_at":null}]
-- af7760e8's one underlying daily_logs row: engineer_id
-- 3534756b-2a32-4b91-954b-0bab15c2dba1 (confirmed by direct query, PROCEED
-- if unchanged at apply time, STOP and re-derive the backfill value if not).
--
-- BOTH ZERO-DATA MARKERS -- THREE-FIELD PROOF, PINNED, RE-PROBED LIVE
-- 2026-08-14 (~14:55 UTC, S21.2/S23): `SELECT d.id, d.content IS NULL AS
-- content_is_null, d.delivered_owner_at IS NULL AS delivered_owner_at_is_null,
-- (SELECT count(*) FROM daily_logs dl WHERE dl.project_id = d.project_id AND
-- dl.log_date = d.log_date) AS underlying_daily_logs_count FROM dprs d WHERE
-- d.id IN ('35a2f41c-64ec-41f5-a763-4afe05940ca5',
-- '3c14243f-9395-4c8d-923b-fd3ea1925b96');`:
--   35a2f41c: content_is_null=true, delivered_owner_at_is_null=true, underlying_daily_logs_count=0
--   3c14243f: content_is_null=true, delivered_owner_at_is_null=true, underlying_daily_logs_count=0
-- Same verdict, same three fields, both rows -- neither assumed from the
-- other's proof.
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

-- Step 3: delete the project-level DPR-17 skip markers that have no
-- engineer behind them at all (zero daily_logs rows for that project-day).
-- The new design skips per ROSTER ENGINEER, never per project (see the
-- review package's §1) -- these rows' concept has no equivalent under the
-- new schema, and there is no engineer_id a backfill could honestly assign
-- to either. content IS NULL and delivered_owner_at IS NULL for both rows --
-- nothing was ever shown to anyone. TWO ids now, not one (S21/S23): a
-- second marker (3c14243f) was written by the still-un-migrated OLD code's
-- 20:00 IST cron on 2026-08-14, after 35a2f41c but before this apply --
-- proof this recurs nightly, not a one-time correction. Kept as an
-- EXTENSIONAL id list, deliberately NOT a predicate (S21.6's Option 1, not
-- Option 2) -- preserves the exact "verbatim-pinned id" property the
-- external reviewer's original sign-off was reasoned about, at the cost of
-- needing Step 1.5b's fresh table-shape probe to catch a THIRD marker
-- before this list goes stale again.
--
-- DESTRUCTIVE. THIS IS WHY §0 CONDITION (d) TRIPS FOR THIS MIGRATION --
-- see the review package, do not run this statement without the PITR
-- observation above having already happened, live, this session.
DELETE FROM public.dprs WHERE id IN (
  '35a2f41c-64ec-41f5-a763-4afe05940ca5',
  '3c14243f-9395-4c8d-923b-fd3ea1925b96'
);

-- Step 4: now safe -- every remaining row has a value.
--
-- BACKSTOP, deliberate (2026-08-14, S21/S23): any row whose engineer_id is
-- still NULL at this exact line aborts the whole transaction (NOT NULL
-- violation, 23502) -- this is not a bug to work around, it is the
-- mechanism that catches a STALE PIN. If Step 1.5b's probe above was
-- somehow skipped or raced, and a THIRD zero-data marker exists that this
-- file's DELETE list does not know about, this statement is what stops the
-- apply from completing silently on an incomplete backfill -- the
-- transaction rolls back in full (this file is one BEGIN...COMMIT block),
-- not a partial, half-migrated state.
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
