-- =============================================================================
-- 043_daily_log_photos.sql
-- Stage 1 of the media capability (docs/plans/media-capture-design.md item
-- 20; full plan: docs/plans/stage1-photo-intake-plan.md). Creates
-- `daily_log_photos`, per item 7's already-decided per-parent shape
-- (extends design-decisions-beta-feedback.md §6's own spec, which named
-- this table but never built it -- confirmed by grep before writing this
-- file: zero prior hits for `daily_log_photos` anywhere in
-- supabase/migrations/, lib/, or types/database.ts).
--
-- ADDENDUM (2026-09-14, external review round 1 -- STOP, fold-and-return,
-- five items plus one added test; see the review package's own "External
-- review round 1 -- verdict and fold-and-return" section). Both claims
-- struck through immediately below are now FALSE. §6 of the review package
-- shows this file applied to test-db, with a live post-apply readback
-- (structure, RLS, grants); and external review has now happened -- this
-- very file IS
-- the fold-and-return fix for that review. Struck through, not rewritten,
-- per this project's own correction discipline (migrations 029/030/040's
-- own precedent) -- the ORIGINAL environment-gap reasoning (no credentials
-- in the authoring pass) still holds as history, only the current-status
-- claim is superseded.
--
-- HELD, NOT APPLIED ANYWHERE. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, and per this pass's own explicit instruction not to apply anything
-- to production. ~~NOT rehearsed against a real database this pass -- this
-- build environment has no Supabase credentials of any kind (no .env.test
-- in this worktree, no SUPABASE_TEST_* vars in the shell). A real
-- dry-run/rehearsal against test-db, per CLAUDE.md §7's own standing
-- "every new migration gets a disposable dry-run" rule, is owed before
-- this is ever applied for real.~~
--
-- EXTERNAL REVIEW GATE: this trips CLAUDE.md §0's condition (a
-- generalization) -- a brand-new table with its own RLS policies and
-- grants from day one, per that document's own broadening clause ("a new
-- table with wrong RLS from day one... is at least as dangerous as a bad
-- change to an existing one"). Needs the full review package before it
-- applies, same as every other schema change in this project's recent
-- history (029, 031, 038, 039, ...). ~~NOT reviewed yet.~~ Still NOT
-- applied to PROD -- that half of the original posture is unchanged by
-- this addendum; only "not rehearsed" and "not reviewed" are superseded.
--
-- SHAPE: retention_class is STAMPED AT INSERT TIME by the media_ingest job
-- handler (lib/media/ingest.ts) -- stage 6's retention job scans expires_at
-- directly. expires_at itself is a GENERATED STORED column, not
-- job-supplied -- see the column definition's own comment below (external
-- review round 1, item 2) for why and what that changes. photo_url is
-- always a Supabase Storage object path (this stage's own bucket,
-- 'daily-log-photos', stage 0), NEVER a Twilio URL. No table this
-- migration creates references storage.objects by foreign key -- Storage
-- and Postgres are independent systems here, linked only by the path
-- convention stage 0 established ({tenant_id}/{daily_log_id}/{photo_id}.
-- {ext}), enforced by application code, not a database constraint.
--
-- ACCESS CONTROL, TWO INDEPENDENT LAYERS, NOT TO BE CONFUSED:
--   1. The Storage OBJECT itself (the actual image bytes) has NO Storage
--      RLS at all (Aravind's stage-0 decision) -- service_role plus
--      lib/storage/photo-access.ts's own membership check is that
--      boundary, entirely separate from this table.
--   2. This TABLE (ordinary Postgres rows: photo_url, caption, retention
--      metadata) DOES get real Postgres RLS below, per CLAUDE.md §4's
--      standing multi-tenancy rule ("every table has RLS... never rely on
--      app-layer filtering alone") -- unaffected by the storage-bucket
--      decision, which was scoped to storage.objects specifically, not to
--      this project's own public-schema tables.
--   These two boundaries are independently encoded (SQL RLS vs. a TS
--   function) and agree only by parallel construction, not by sharing a
--   predicate -- see test/photo-access-boundary-agreement.test.ts (external
--   review round 1, item 6), which runs a shared fixture matrix through
--   both and is the thing that would actually catch the two drifting apart.
-- =============================================================================

BEGIN;

-- Media completion status -- the async signal everything downstream (a
-- future PM dashboard, DPR generation) needs, per the design doc's own
-- item 4 intent ("a separate status... asynchronous... the thing
-- everything downstream needs to check"). Two independent columns, not
-- one, because morning and evening are independent completion events on
-- the same daily_logs row (item 7's shared-row precedent) -- evening's
-- photos finishing has nothing to do with morning's. NULL means "no
-- photos sent this phase" (the common case); 'pending' is set the moment
-- the first media_ingest job is enqueued for that phase; 'complete'/
-- 'failed' are set by the job handler (or its dead-letter path) once it
-- resolves. TEXT + CHECK, never an ENUM, per CLAUDE.md §6.
ALTER TABLE public.daily_logs
  ADD COLUMN morning_photos_status TEXT CHECK (morning_photos_status IN ('pending', 'complete', 'failed')),
  ADD COLUMN evening_photos_status TEXT CHECK (evening_photos_status IN ('pending', 'complete', 'failed'));

CREATE TABLE public.daily_log_photos (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ  DEFAULT now(),
  tenant_id       UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT, not CASCADE (external review round 1, item 3).
  -- Cascading a daily_log delete would silently delete every photo row
  -- pointing at it -- the ONLY retention record and the ONLY pointer this
  -- database holds to that photo's actual bytes in the daily-log-photos
  -- bucket. A cascade would leave those bucket objects orphaned with no
  -- retention scan (stage 6) ever able to reach them again, which directly
  -- contradicts this table's own tombstone-never-delete philosophy (item
  -- 9: photo_url set NULL, row retained -- never a hard delete of the row
  -- itself, so certainly never an implicit one via a PARENT's delete).
  -- Nothing in this codebase deletes a daily_logs row today, so this is a
  -- free safety margin now, not a behavior change to anything live.
  daily_log_id    UUID         NOT NULL REFERENCES public.daily_logs(id) ON DELETE RESTRICT,
  phase           TEXT         NOT NULL CHECK (phase IN ('morning', 'evening')),
  photo_url       TEXT,        -- Supabase Storage object path. NULL once tombstoned (item 9, stage 6).
  caption         TEXT,        -- item 12: the answer-parser's raw Body, if any accompanied the photo.
  retention_class TEXT         NOT NULL CHECK (retention_class IN ('attendance', 'evening_progress')),
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- GENERATED STORED, not job-supplied (external review round 1, item 2).
  -- Before this, lib/media/ingest.ts computed expires_at in TypeScript and
  -- wrote it directly -- a wrong stamp (a future edit to RETENTION_DAYS/
  -- RETENTION_CLASS going out of sync, a copy-paste bug in a later job) was
  -- merely UNCAUGHT, not impossible. Computing it here, from received_at
  -- and retention_class, makes a wrong stamp IMPOSSIBLE: Postgres refuses
  -- any INSERT/UPDATE that tries to supply expires_at directly (a hard
  -- error, not a silent overwrite), and the two durations (7d/60d) now live
  -- in exactly ONE place -- this expression -- instead of in ingest.ts plus
  -- a comment asking a future editor to keep the two in sync by hand.
  --
  -- NOT THE REVIEWER'S LITERAL SQL -- A REAL POSTGRES CONSTRAINT FORCED A
  -- REWRITE, FLAGGED HERE RATHER THAN SILENTLY SUBSTITUTED. The item-2
  -- proposal as written (`received_at + CASE retention_class WHEN
  -- 'attendance' THEN INTERVAL '7 days' ELSE INTERVAL '60 days' END`) was
  -- tried against real Postgres 17.6 on test-db and REJECTED: `ERROR:
  -- 42P17: generation expression is not immutable`. Confirmed by direct
  -- `pg_proc.provolatile` lookup, not just the error text: `timestamptz +
  -- interval` (timestamptz_pl_interval) is STABLE ('s'), not IMMUTABLE
  -- ('i') -- adding a days-unit interval to a timestamptz is timezone-
  -- sensitive in general (DST-correct calendar arithmetic), so Postgres
  -- refuses it in a STORED generated column's expression regardless of
  -- what the runtime interval value actually contains. `extract(epoch FROM
  -- timestamptz)` is ALSO merely STABLE, so an epoch-arithmetic rewrite
  -- fails identically. THE FIX BELOW pins the timezone explicitly rather
  -- than deferring to the session's: `timezone('UTC', received_at)`
  -- (timestamptz -> timestamp) and `timezone('UTC', <timestamp>)`
  -- (timestamp -> timestamptz) are BOTH confirmed IMMUTABLE
  -- (`pg_proc.provolatile = 'i'` for both signatures, checked directly),
  -- because naming the zone explicitly removes the session-TimeZone
  -- dependence that makes the bare operator STABLE; plain `timestamp +
  -- interval` (no zone at all) is IMMUTABLE too (`timestamp_pl_interval`,
  -- confirmed the same way). Live-verified end to end against a disposable
  -- TEMP TABLE on test-db before this file was re-applied: both retention
  -- classes produced exactly 7.0 and 60.0 elapsed days. Functionally
  -- identical to the reviewer's intent (received_at + a fixed 7d/60d
  -- interval, computed once, immutable, keyed on retention_class) --
  -- different SQL because the literal form does not compile on this
  -- project's own Postgres version. Reviewer/Aravind should re-confirm
  -- this substitution in the next round rather than treating it as
  -- pre-approved by the original item-2 text.
  --
  -- CONSEQUENCE FOR A FUTURE RETENTION-WINDOW CHANGE, recorded here because
  -- it inverts this table's original design intent: changing either
  -- duration below is a migration to THIS EXPRESSION (Postgres has no
  -- in-place edit of a generated column's formula -- it's a DROP/re-ADD,
  -- which rewrites the table). Because expires_at is COMPUTED, not
  -- stamped-once, such a migration recomputes it for EVERY EXISTING ROW as
  -- well as every future one -- the OPPOSITE of the forward-only guarantee
  -- item 15 originally specified ("rows already stamped under the old
  -- window must keep their original expiry"; review package §5). A future
  -- author widening or narrowing the retention window must explicitly
  -- re-decide whether that forward-only guarantee still matters -- it is
  -- no longer preserved by construction the way a plain stamped-at-insert
  -- column was.
  expires_at      TIMESTAMPTZ  GENERATED ALWAYS AS (
                    timezone('UTC',
                      timezone('UTC', received_at) + CASE retention_class
                        WHEN 'attendance' THEN INTERVAL '7 days'
                        ELSE INTERVAL '60 days'
                      END
                    )
                  ) STORED
);

-- phase <-> retention_class must agree -- morning is always attendance (7d),
-- evening is always evening_progress (60d). A CHECK, not left to application
-- code alone to keep consistent, per this project's general "the database
-- enforces its own invariants" posture.
ALTER TABLE public.daily_log_photos
  ADD CONSTRAINT daily_log_photos_phase_retention_check
  CHECK (
    (phase = 'morning' AND retention_class = 'attendance') OR
    (phase = 'evening' AND retention_class = 'evening_progress')
  );

CREATE INDEX idx_daily_log_photos_daily_log_id ON public.daily_log_photos(daily_log_id);
CREATE INDEX idx_daily_log_photos_tenant_id    ON public.daily_log_photos(tenant_id);
-- Stage 6's own retention scan needs this -- a scan for "past expiry" without
-- an index on the scanned column is exactly the kind of thing that's cheap to
-- add now and expensive to discover missing once the table has real rows.
CREATE INDEX idx_daily_log_photos_expires_at   ON public.daily_log_photos(expires_at);

COMMENT ON TABLE public.daily_log_photos IS
  'Photos captured during an active morning or evening check-in (item 7''s '
  'per-parent shape; the second per-parent class, hindrance_photos, lands in a '
  'later migration for stage 2). Written ONLY by the media_ingest job handler '
  '(lib/media/ingest.ts), via service_role -- no end-user client ever inserts '
  'directly. retention_class is stamped at INSERT time by that job; '
  'expires_at is a GENERATED STORED column (received_at + 7d/60d keyed on '
  'retention_class, via an explicit UTC pin -- see the column''s own '
  'comment for why: timestamptz + interval is only STABLE in Postgres, not '
  'IMMUTABLE, so a bare form of this expression is rejected), never '
  'supplied by the job -- a wrong stamp is now impossible, not merely '
  'uncaught (external review round 1, item 2). '
  'Tombstoned (photo_url set NULL), never hard-deleted, once expires_at '
  'passes (item 9). '
  'PINNED ARGUMENT, tenant_id/daily_log_id pairing (external review round 1, '
  'item 4, Aravind''s decision, argued rather than enforced by a composite '
  'FK): this table has exactly ONE writer -- lib/media/ingest.ts, via '
  'service_role -- and that writer derives tenant_id and daily_log_id '
  'TOGETHER from the same resolution (resolveOrCreateDailyLogId), so a row '
  'pairing a tenant with a daily_log that does not belong to it is not '
  'reachable BY CONSTRUCTION, not merely unlikely. A composite FK against '
  'daily_logs(id, tenant_id) would require a new UNIQUE(id, tenant_id) on '
  'daily_logs itself -- a live production table -- for a mismatch this '
  'single writer cannot produce. THIS ARGUMENT EXPIRES the moment a SECOND '
  'writer to this table is ever added: at that point the composite FK '
  'becomes REQUIRED, not optional, because the closed-writer-set premise '
  'this argument rests on no longer holds. A future editor adding a second '
  'writer without also adding that FK is violating this table''s own '
  'documented safety argument, not merely skipping a nice-to-have.';

-- -----------------------------------------------------------------------------
-- RLS. SELECT only, PM-scoped to the project the photo''s daily_log belongs
-- to -- same shape as daily_log_edits'' own policy (019_daily_log_corrections.sql),
-- adapted: that table joins through project_id directly; this one joins
-- through daily_log_id -> daily_logs.project_id first, since this table has
-- no denormalized project_id column of its own.
-- -----------------------------------------------------------------------------
ALTER TABLE public.daily_log_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "daily_log_photos_select" ON public.daily_log_photos
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.daily_logs dl
      JOIN public.project_members pm ON pm.project_id = dl.project_id
      WHERE dl.id = daily_log_photos.daily_log_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        AND pm.role = 'pm'
    )
  );

-- -----------------------------------------------------------------------------
-- GRANTS (external review round 1, item 1). REVOKE ALL first, then GRANT
-- back exactly what each role needs -- NOT the original subtractive form
-- (REVOKE INSERT, UPDATE, DELETE, TRUNCATE), which named only four of the
-- six non-SELECT/USAGE privileges a table actually carries under Supabase's
-- default ACL (which grants ALL to authenticated/anon/service_role on every
-- new public-schema table). REFERENCES and TRIGGER were never named by that
-- form, so they were never revoked -- left live on both authenticated and
-- service_role. The §6 post-apply probe only checked SELECT/INSERT/UPDATE/
-- DELETE/TRUNCATE, so it could not see the two missing privileges either;
-- this was caught only by the external reviewer naming them explicitly.
-- Standard adopted from migration 031's own round: REVOKE ALL so nothing is
-- left to leak by omission, then GRANT back the narrow, named set.
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.daily_log_photos FROM authenticated, anon, service_role;

-- authenticated: read-only via the daily_log_photos_select policy above,
-- nothing else -- no INSERT/UPDATE/DELETE/TRUNCATE/REFERENCES/TRIGGER.
GRANT SELECT ON public.daily_log_photos TO authenticated;

-- anon: no grant at all. REVOKE ALL above already removed everything
-- Supabase's default ACL had granted; no GRANT statement follows for anon,
-- deliberately -- matches the standing pattern for every tenant-scoped
-- table in this schema.

-- service_role: SELECT (the ingest job reads back what it wrote in some
-- paths), INSERT (the ingest job's own write), UPDATE (stage 6's tombstone
-- -- photo_url set NULL, row retained). Deliberately NOT DELETE, TRUNCATE,
-- REFERENCES, or TRIGGER -- this table is tombstoned, never hard-deleted
-- (item 9), so any of those four left live would be the EXACT gap already
-- found twice on this project (dpr_versions, migration 031 round 1) --
-- named explicitly by CLAUDE.md's own standing rule ("a table-level revoke
-- must name service_role explicitly"). Closed here from day one via the
-- REVOKE ALL / GRANT-back pattern, which cannot leak a privilege by
-- omission the way a subtractive REVOKE naming only some of them can.
GRANT SELECT, INSERT, UPDATE ON public.daily_log_photos TO service_role;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- WHAT THIS DESTROYS, NAMED EXPLICITLY (external review round 1, item 3).
-- Every daily_log_photos row -- the ONLY retention record and the ONLY
-- pointer this database holds to each photo's actual bytes in the
-- daily-log-photos bucket -- plus both daily_logs status columns
-- (morning_photos_status, evening_photos_status). SQL alone cannot reach
-- the Storage side of this: once this DOWN runs for real, every Storage
-- object this table's rows pointed to (via photo_url) becomes ORPHANED --
-- bytes still present in the bucket, with no database row left to name
-- them, and no retention scan (stage 6) able to find or reap them either,
-- since that scan itself depends on this table existing.
-- PROCEDURAL CLEANUP NOTE, since no SQL statement can do this: before
-- running this DOWN for real, SELECT photo_url for every non-null row
-- first and keep that list -- it is the only record of which Storage
-- objects are about to be orphaned. Deleting those objects afterward (via
-- the Storage API, using PHOTO_BUCKET from lib/storage/photo-access.ts) is
-- then a separate, manual step this migration cannot perform for you.
--
-- BEGIN;
--
-- DROP TABLE public.daily_log_photos;
-- ALTER TABLE public.daily_logs DROP COLUMN morning_photos_status;
-- ALTER TABLE public.daily_logs DROP COLUMN evening_photos_status;
--
-- COMMIT;
