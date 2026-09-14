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
-- HELD, NOT APPLIED ANYWHERE. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, and per this pass's own explicit instruction not to apply anything
-- to production. NOT rehearsed against a real database this pass -- this
-- build environment has no Supabase credentials of any kind (no .env.test
-- in this worktree, no SUPABASE_TEST_* vars in the shell). A real
-- dry-run/rehearsal against test-db, per CLAUDE.md §7's own standing
-- "every new migration gets a disposable dry-run" rule, is owed before
-- this is ever applied for real.
--
-- EXTERNAL REVIEW GATE: this trips CLAUDE.md §0's condition (a
-- generalization) -- a brand-new table with its own RLS policies and
-- grants from day one, per that document's own broadening clause ("a new
-- table with wrong RLS from day one... is at least as dangerous as a bad
-- change to an existing one"). Needs the full review package before it
-- applies, same as every other schema change in this project's recent
-- history (029, 031, 038, 039, ...). NOT reviewed yet.
--
-- NUMBER RESERVED 2026-09-13 in scripts/migration-number-reservations.json.
-- Confirmed against origin/main at reservation time: highest applied
-- migration is 042 (supabase/migrations/042_storage_bucket_setup.sql),
-- highest reservation is 042 -- 043 was free.
--
-- SHAPE: retention_class and expires_at are STAMPED AT INSERT TIME by the
-- media_ingest job handler (lib/media/ingest.ts), never recomputed later --
-- stage 6's retention job scans expires_at directly. photo_url is always a
-- Supabase Storage object path (this stage's own bucket, 'daily-log-photos',
-- stage 0), NEVER a Twilio URL. No table this migration creates references
-- storage.objects by foreign key -- Storage and Postgres are independent
-- systems here, linked only by the path convention stage 0 established
-- ({tenant_id}/{daily_log_id}/{photo_id}.{ext}), enforced by application
-- code, not a database constraint.
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
  daily_log_id    UUID         NOT NULL REFERENCES public.daily_logs(id) ON DELETE CASCADE,
  phase           TEXT         NOT NULL CHECK (phase IN ('morning', 'evening')),
  photo_url       TEXT,        -- Supabase Storage object path. NULL once tombstoned (item 9, stage 6).
  caption         TEXT,        -- item 12: the answer-parser's raw Body, if any accompanied the photo.
  retention_class TEXT         NOT NULL CHECK (retention_class IN ('attendance', 'evening_progress')),
  expires_at      TIMESTAMPTZ  NOT NULL,
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now()
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
  'directly. retention_class/expires_at are stamped at INSERT time, never '
  'recomputed later (stage 6''s own retention job depends on this). Tombstoned '
  '(photo_url set NULL), never hard-deleted, once expires_at passes (item 9).';

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

-- authenticated/anon: read-only via the policy above, nothing else.
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.daily_log_photos FROM authenticated;
REVOKE ALL ON public.daily_log_photos FROM anon;

-- service_role: needs SELECT (the ingest job reads back what it wrote in
-- some paths) INSERT (the ingest job's own write) and UPDATE (stage 6's
-- tombstone -- photo_url set NULL, row retained). Does NOT need DELETE or
-- TRUNCATE -- this table is tombstoned, never hard-deleted (item 9), so an
-- unrevoked DELETE grant here would be the EXACT gap already found twice on
-- this project (dpr_versions, migration 031 round 1) -- named explicitly by
-- CLAUDE.md's own standing rule ("a table-level revoke must name
-- service_role explicitly"), applied here from day one rather than found
-- later by an external reviewer.
REVOKE DELETE, TRUNCATE ON public.daily_log_photos FROM service_role;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- BEGIN;
--
-- DROP TABLE public.daily_log_photos;
-- ALTER TABLE public.daily_logs DROP COLUMN morning_photos_status;
-- ALTER TABLE public.daily_logs DROP COLUMN evening_photos_status;
--
-- COMMIT;
