-- =============================================================================
-- 044_hindrance_photos.sql
-- Stage 2 of the media capability (docs/plans/media-capture-design.md item
-- 20; full plan: docs/plans/stage2-hindrance-photos-plan.md). Creates
-- `hindrance_photos`, per item 7's per-parent shape, and adds the third
-- (photo) question to the hindrance flow via apply_hindrance_flow_turn.
--
-- DATED CORRECTION (2026-09-15): APPLIED TO PROD (jvxwqignooseazzmwhvl).
-- External review returned a fold-and-return round first (four findings,
-- S1-S4; principal finding S1: resolveMostRecentHindranceId -- the same
-- failure shape as the was_unspecified bug this migration already found
-- and fixed internally, one layer up -- resolved by carrying hindrance_id
-- through session context and deleting the resolver entirely, not
-- fencing it). Folded in, re-verified against test-db (full re-teardown/
-- re-apply cycle, both RPC transcripts re-run, DOWN block re-rehearsed),
-- PR #275 went CI-green (all 9 checks, including a real `Test (real
-- test-db)` run) and was merged. PITR confirmed live in the Supabase
-- dashboard before applying (restore window 08 Sep 2026 22:00:34 to 15
-- Sep 2026 00:03:53 IST, observed, not assumed). Pre-apply function hash
-- abdac08cd997bb2e3d8d73773d807a24 (038's own body, unchanged since).
-- `supabase db query --linked -f
-- supabase/migrations/044_hindrance_photos.sql` -- no error. Post-apply
-- readback confirmed by observation: table_exists=hindrance_photos,
-- status_col=1, rls_enabled=true, policy_count=1,
-- post_044_hash=09b4e083638dd359b6415a71f6146bec -- the hash pair
-- (abdac08c...->09b4e083...) is the record the RPC rewrite landed. The
-- generated `expires_at` expression re-confirmed via `pg_get_expr`. The
-- four-way negative grants matrix is PROD's own, the sole authoritative
-- record now that test-db's own matrix deliberately reads
-- service_role DELETE=true (scripts/test-db-only-grants.sql). Ledger
-- repaired: `supabase migration repair --status applied 044 --linked`
-- succeeded ("Repaired migration history: [044] => applied");
-- `supabase migration list --linked` shows Local and Remote matching
-- through 044, no gaps. Struck through below, not rewritten, per this
-- project's own correction discipline (migrations 036/039/042/043's own
-- precedent) -- the ORIGINAL not-yet-applied posture was true when
-- written and stays true as history; only the current-status claim is
-- superseded. Full apply sequence, the external review outcome, the
-- CI-never-actually-ran incident found on PR #275, the real-send size
-- gate, and the still-owed first-real-report closing artifact:
-- docs/reviews/044-apply-record.md.
--
-- ~~HELD, NOT APPLIED TO PROD.~~ Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, and per this pass's own explicit instruction: apply to TEST-DB
-- ONLY, ~~this file stays in docs/reviews/ until a real prod apply happens~~.
-- Full apply sequence + evidence: docs/reviews/044-review-package.md
-- (round 1/2), docs/reviews/044-apply-record.md (the prod apply itself).
--
-- EXTERNAL REVIEW GATE: trips CLAUDE.md §0's conditions (a) and (b) --
-- apply_hindrance_flow_turn's LOGIC changes (a new step, a new completion
-- point, a new return field) AND a brand-new table with its own RLS and
-- grants from day one (b). ~~Needs the full review package before it applies
-- anywhere beyond test-db~~ -- reviewed (fold-and-return, S1-S4 folded in)
-- and applied, same tier as 038/039/043.
--
-- SHAPE, DEVIATING FROM 043 (043_daily_log_photos.sql) WHERE STATED, PER
-- docs/plans/stage2-hindrance-photos-plan.md §3:
--   * No `phase` column -- hindrance photos have exactly one retention
--     class (`hindrance`, 60 days), unlike daily_log_photos' two classes
--     keyed on phase. `retention_class` is kept anyway (fixed, CHECK'd to
--     one value) so a future stage-6 retention scan can treat both tables
--     uniformly (iterate a fixed table list, `WHERE expires_at < now()`),
--     without a schema-shape special case for the single-class table.
--   * `expires_at`'s GENERATED expression is simpler: one interval, no
--     CASE, since there is only one retention class. Same UTC-pin
--     technique 043 had to adopt after Postgres rejected the bare
--     `timestamptz + interval` form as non-immutable (043's own comment
--     explains why -- STABLE, not IMMUTABLE, is the built-in volatility of
--     that operator; naming the zone explicitly removes the session-
--     TimeZone dependence that makes the bare form STABLE).
--   * RLS/FK join is one hop shorter -- `hindrances` already carries
--     `project_id` directly (unlike daily_log_photos, which has to join
--     through daily_logs.project_id because daily_log_photos itself has
--     no project column). `hindrance_photos -> hindrances.project_id ->
--     project_members(role='pm')` is two joins, not three.
--   * STORAGE BUCKET: REUSES `daily-log-photos` (stage 0's bucket) --
--     Aravind's decision, 2026-09-14: `lib/storage/photo-access.ts` is the
--     entire access barrier for that bucket (service_role only, no Storage
--     RLS at all), and a second bucket would duplicate that same risk
--     surface rather than share it. PATH CONVENTION, stated explicitly:
--     {tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext} -- FOUR
--     segments, the literal string "hindrance" as the second segment,
--     disambiguating from daily_log_photos' own THREE-segment
--     {tenant_id}/{daily_log_id}/{photo_id}.{ext} convention. Nothing in
--     this stage parses this path with photo-access.ts's
--     extractDailyLogId (a strict 3-segment parser) -- the email
--     attachment path (lib/hindrance/pm-notify.ts) fetches bytes directly
--     via service_role, never through getSignedPhotoUrl, and no PM-
--     dashboard signed-URL reader for hindrance photos exists yet (that is
--     stage 5). A future signed-URL reader for hindrance photos needs its
--     own path parser -- flagged here so that work doesn't assume
--     extractDailyLogId already covers it.
--   * hindrances.photo_url STAYS AS DEAD SCHEMA (item 8 of the design
--     doc) -- not dropped, not written to, by this migration or anything
--     built alongside it.
--
-- ACCESS CONTROL, TWO INDEPENDENT LAYERS, NOT TO BE CONFUSED (same
-- structure as 043's own header, restated for this table):
--   1. The Storage OBJECT itself has NO Storage RLS at all -- service_role
--      plus application-code membership checks are that boundary, entirely
--      separate from this table. No PM-dashboard signed-URL reader exists
--      yet for hindrance photos (stage 5); the email attachment job reads
--      bytes directly via service_role, never through a signed URL.
--   2. This TABLE gets real Postgres RLS below, per CLAUDE.md §4's
--      standing multi-tenancy rule.
-- =============================================================================
--
-- EXTERNAL REVIEW ROUND 2, FINDING S2 (fold-and-return, 2026-09-14) --
-- RECORDED, NOT FIXED BY EDITING 038. This migration introduces two new
-- `whatsapp_sessions.context` keys scoped to the hindrance flow --
-- 'hindrance_unspecified' and 'hindrance_id' (STEP 2 below). FOUR sites
-- across this project's history strip hindrance's own leftover context
-- keys and claim (by strip-list shape, not by explicit statement) to strip
-- ALL of them, but only ever named 'q2_reask'/'description' -- the two
-- keys that existed before this migration:
--   1. apply_morning_flow_turn's own force-reset branch, for a scheduled
--      trigger colliding with a live 'hindrance' session
--      (038_hindrance_flow_and_collision_fix.sql:508, :513-515).
--   2. apply_evening_flow_turn's own identical branch
--      (038_hindrance_flow_and_collision_fix.sql:813, :818-821).
--   3. 038's own DOWN block's bulk sweep, clearing every live 'hindrance'
--      session before dropping the function that could process it
--      (038_hindrance_flow_and_collision_fix.sql:1979-1983).
--   4. This migration's OWN start branch (STEP 2 below) -- FIXED directly,
--      since it is part of what this migration itself redefines; see that
--      branch's own comment.
-- Sites 1-3 are NOT fixed here -- 038 is a LIVE, APPLIED migration
-- (CLAUDE.md's own "every numbered file currently present in
-- supabase/migrations/ is LIVE -- do not edit any of them" rule) and
-- fixing them for real would mean redefining apply_morning_flow_turn/
-- apply_evening_flow_turn's own logic in a NEW migration, a materially
-- larger and differently-scoped change than a photo-capability fold-and-
-- return. Recorded here instead, with the argument for why the gap is
-- accepted rather than silently left unstated:
--   * A stale 'hindrance_unspecified'/'hindrance_id' surviving one of
--     these three sites can only ever be read back by THIS function's own
--     step-3 branch (or step 2's own overwrite of 'hindrance_unspecified'
--     before it's ever read) -- no other function in this codebase reads
--     either key, today or after this migration.
--   * Sites 1/2 force-reset a 'hindrance' session INTO 'morning'/'evening'
--     -- a residual 'hindrance_unspecified'/'hindrance_id' left in that
--     session's context becomes a dead key under morning/evening's own
--     step logic, which never reads either name. Write-before-read: if
--     that same phone number's session ever re-enters 'hindrance' later,
--     step 2 unconditionally OVERWRITES 'hindrance_unspecified' the
--     moment it next resolves (STEP 2 below, jsonb_build_object -- not a
--     merge that could preserve a stale value), and 'hindrance_id' is
--     never read at step 1 or 2 at all, only written at step 2 and read
--     at step 3 of the SAME pass through the flow.
--   * Site 3 (the DOWN sweep) clears `current_flow`/`current_step` to
--     NULL/0 in the same statement that leaves the residue -- by the time
--     any future code could read the context, the row is idle; nothing
--     downstream of an idle session ever consults these two keys.
-- This is the identical write-before-read argument this migration's own
-- STEP 2 already relies on for `hindrance_unspecified` surviving from Q2
-- to Q3 in the FIRST place -- the same reasoning, pointed at why residue
-- elsewhere is inert rather than why the intended carry-forward is safe.
-- If a fifth site is ever added that reads 'hindrance_id'/
-- 'hindrance_unspecified' from a context this project cannot guarantee
-- came from the SAME pass through the hindrance flow, this argument no
-- longer holds and sites 1-3 need a real migration, not a comment.
-- =============================================================================

BEGIN;

-- Media completion status for the hindrance flow's own (single) photo
-- question -- same shape and purpose as daily_logs.morning_photos_status/
-- evening_photos_status (043), one column since hindrance has exactly one
-- photo-capable phase, not two. NULL means "no photos sent for this
-- hindrance"; 'pending' is set the moment the first hindrance_media_ingest
-- job is enqueued; 'complete'/'failed' are set by the job handler (or its
-- dead-letter path) once it resolves. Read by
-- handleHindrancePmNotifyJob (lib/hindrance/pm-notify.ts) to decide
-- whether to wait (retry) before attaching photos -- see that function's
-- own header for the full race and Aravind's 2026-09-14 "send without
-- photos on exhaustion" decision. TEXT + CHECK, never an ENUM, per
-- CLAUDE.md §6.
ALTER TABLE public.hindrances
  ADD COLUMN photos_status TEXT CHECK (photos_status IN ('pending', 'complete', 'failed'));

CREATE TABLE public.hindrance_photos (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      TIMESTAMPTZ  DEFAULT now(),
  tenant_id       UUID         NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  -- ON DELETE RESTRICT, not CASCADE -- same reasoning as 043's own
  -- daily_log_id FK: nothing in this codebase deletes a hindrances row
  -- today (grepped, confirmed, docs/plans/adhoc-menu-spec.md §28(aa) point
  -- 5), so this is a free safety margin, not a behavior change. A cascade
  -- would silently orphan the only retention record/pointer this database
  -- holds to each photo's actual bytes in Storage, contradicting this
  -- table's own tombstone-never-delete philosophy (item 9 of the design
  -- doc: photo_url set NULL, row retained -- never a hard delete of the
  -- row itself, so certainly never an implicit one via a parent's delete).
  hindrance_id    UUID         NOT NULL REFERENCES public.hindrances(id) ON DELETE RESTRICT,
  photo_url       TEXT,        -- Supabase Storage object path in the daily-log-photos bucket. NULL once tombstoned (item 9, stage 6).
  caption         TEXT,        -- item 12 (reversed): the raw Body, if any accompanied the photo -- NEVER passed to the answer parser.
  -- Fixed to exactly one value -- see this file's own header for why the
  -- column is kept anyway (uniform stage-6 retention scan across both
  -- photo tables) rather than omitted as redundant.
  retention_class TEXT         NOT NULL DEFAULT 'hindrance' CHECK (retention_class = 'hindrance'),
  received_at     TIMESTAMPTZ  NOT NULL DEFAULT now(),
  -- GENERATED STORED, not job-supplied -- same reasoning as 043's own
  -- expires_at: a wrong stamp becomes impossible (Postgres refuses any
  -- INSERT/UPDATE that tries to supply this directly), and the retention
  -- duration lives in exactly ONE place. Simpler than 043's own CASE
  -- expression -- one interval, one class, nothing to branch on. Same
  -- UTC-pin technique 043 needed: `timestamptz + interval` is only STABLE
  -- in Postgres, not IMMUTABLE (naming the zone explicitly, via
  -- `timezone('UTC', ...)`, removes the session-TimeZone dependence that
  -- makes the bare form STABLE), so a bare form of this expression would
  -- be rejected by the same `42P17: generation expression is not
  -- immutable` error 043's own header records verifying directly against
  -- Postgres 17.6.
  --
  -- CONSEQUENCE FOR A FUTURE RETENTION-WINDOW CHANGE, same as 043's own
  -- warning: changing the interval below is a migration to THIS
  -- EXPRESSION (DROP/re-ADD, since Postgres has no in-place edit of a
  -- generated column's formula), which recomputes expires_at for EVERY
  -- EXISTING ROW, not just future ones -- the opposite of item 15's
  -- forward-only guarantee. A future author widening the 60-day window
  -- must explicitly re-decide whether that guarantee still matters.
  expires_at      TIMESTAMPTZ  GENERATED ALWAYS AS (
                    -- CHANGING THE INTERVAL BELOW RECOMPUTES expires_at
                    -- FOR EVERY EXISTING ROW, NOT JUST FUTURE ONES -- READ
                    -- THE COMMENT ABOVE THIS COLUMN BEFORE EDITING.
                    timezone('UTC', timezone('UTC', received_at) + INTERVAL '60 days')
                  ) STORED
);

CREATE INDEX idx_hindrance_photos_hindrance_id ON public.hindrance_photos(hindrance_id);
CREATE INDEX idx_hindrance_photos_tenant_id    ON public.hindrance_photos(tenant_id);
-- Stage 6's own retention scan needs this -- same reasoning as 043's
-- identical index: cheap to add now, expensive to discover missing once
-- the table has real rows.
CREATE INDEX idx_hindrance_photos_expires_at   ON public.hindrance_photos(expires_at);

COMMENT ON TABLE public.hindrance_photos IS
  'Photos captured during an active hindrance flow''s Q3 (item 7''s second '
  'per-parent class, alongside daily_log_photos). Written ONLY by the '
  'hindrance_media_ingest job handler (lib/media/hindrance-ingest.ts), via '
  'service_role -- no end-user client ever inserts directly. A photo sent '
  'BEFORE the parent hindrances row exists (Q1/Q2 open) is NOT stored at '
  'all -- Aravind''s 2026-09-14 decision, docs/plans/stage2-hindrance-'
  'photos-plan.md ''DECISIONS'' item 1 -- the engineer is told and the '
  'question re-asks; no buffering, no orphaned rows, no abandonable state. '
  'retention_class is fixed to ''hindrance'' (60 days) -- a single value, '
  'CHECK''d rather than assumed. The expires_at expression below does NOT '
  'reference this column at all (one class, one constant interval -- '
  'nothing to branch on) -- it is kept anyway, external review round 2''s '
  'own S3 finding confirmed, SOLELY so stage 6''s future retention scanner '
  'can query this table and daily_log_photos IDENTICALLY, by the same '
  '(retention_class, expires_at) shape, without a schema-level special '
  'case for the one table that happens to have a single class. A future '
  'reader must not remove this column as redundant on the strength of the '
  'generated expression alone not needing it. '
  'expires_at is a GENERATED STORED column (received_at + 60 '
  'days, via an explicit UTC pin -- see the column''s own comment for why '
  'a bare form is rejected by Postgres), never supplied by the job -- a '
  'wrong stamp is impossible, not merely uncaught. Tombstoned (photo_url '
  'set NULL), never hard-deleted, once expires_at passes (item 9). Storage '
  'path convention (this file''s own header, restated): '
  '{tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext}, in the SAME '
  '''daily-log-photos'' bucket daily_log_photos uses -- reused, not a '
  'second bucket, per Aravind''s 2026-09-14 decision. '
  'PINNED ARGUMENT, tenant_id/hindrance_id pairing (same shape and same '
  'expiry condition as 043''s own daily_log_id argument): this table has '
  'exactly ONE writer -- lib/media/hindrance-ingest.ts, via service_role '
  '-- and that writer derives tenant_id and hindrance_id TOGETHER from the '
  'same resolution, so a row pairing a tenant with a hindrance that does '
  'not belong to it is not reachable BY CONSTRUCTION, not merely '
  'unlikely. THIS ARGUMENT EXPIRES the moment a SECOND writer to this '
  'table is ever added -- at that point a composite FK against '
  'hindrances(id, tenant_id) (requiring a new UNIQUE(id, tenant_id) on '
  'hindrances itself) becomes REQUIRED, not optional. A future editor '
  'adding a second writer without also adding that FK is violating this '
  'table''s own documented safety argument, not merely skipping a '
  'nice-to-have.';

-- -----------------------------------------------------------------------------
-- RLS. SELECT only, PM-scoped to the project the hindrance belongs to --
-- one join shorter than daily_log_photos'' own policy (043), since
-- hindrances already carries project_id directly, unlike daily_log_photos
-- which has to reach it via daily_logs. No signed-URL reader exists yet
-- for this table (stage 5) -- this policy exists for schema completeness
-- and defense-in-depth from day one, matching this project''s "a new
-- table''s RLS ships correct from day one" posture, not because anything
-- calls it yet.
-- -----------------------------------------------------------------------------
ALTER TABLE public.hindrance_photos ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hindrance_photos_select" ON public.hindrance_photos
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1
      FROM public.hindrances h
      JOIN public.project_members pm ON pm.project_id = h.project_id
      WHERE h.id = hindrance_photos.hindrance_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
        AND pm.role = 'pm'
    )
  );

-- -----------------------------------------------------------------------------
-- GRANTS. REVOKE ALL first, then GRANT back exactly what each role needs --
-- same standard 043/031 adopted, so nothing is left to leak by omission
-- (REFERENCES/TRIGGER included in the REVOKE, not just the four privileges
-- an author naturally thinks of).
-- -----------------------------------------------------------------------------
REVOKE ALL ON public.hindrance_photos FROM authenticated, anon, service_role;

-- authenticated: read-only via the hindrance_photos_select policy above,
-- nothing else.
GRANT SELECT ON public.hindrance_photos TO authenticated;

-- anon: no grant at all -- REVOKE ALL above already removed everything
-- Supabase's default ACL had granted; no GRANT statement follows,
-- deliberately, matching every tenant-scoped table in this schema.

-- service_role: SELECT (the pm-notify job reads photo_url back to fetch
-- attachment bytes), INSERT (the ingest job's own write), UPDATE (stage
-- 6's future tombstone -- photo_url set NULL, row retained). Deliberately
-- NOT DELETE, TRUNCATE, REFERENCES, or TRIGGER -- this table is
-- tombstoned, never hard-deleted (item 9), so any of those four left live
-- would be the exact gap already found twice on this project
-- (dpr_versions, outbound_sends round 1), named explicitly by CLAUDE.md's
-- own standing rule ("a table-level revoke must name service_role
-- explicitly"). Closed here from day one via the REVOKE ALL / GRANT-back
-- pattern.
GRANT SELECT, INSERT, UPDATE ON public.hindrance_photos TO service_role;

-- =============================================================================
-- STEP 2 -- apply_hindrance_flow_turn (CREATE OR REPLACE -- never
-- DROP+CREATE). Signature BYTE-IDENTICAL to 038's live one (10 args) --
-- ONLY CHANGE is the body: Q2's resolution now advances to a new step 3
-- (the photo question) instead of completing the flow, and the return
-- value gains `hindrance_id` (populated at the turn the row is inserted,
-- AND at the turn the flow completes -- see the S1 finding below and the
-- RETURN block's own comment). Docs/plans/stage2-hindrance-photos-plan.md
-- §0/§1 has the full design reasoning; this is the mechanical diff against
-- 038's own body.
--
-- EXTERNAL REVIEW ROUND 2, FINDING S1 (fold-and-return, 2026-09-14) --
-- FOLDED IN. This round's own first draft resolved a Q3 photo's parent
-- hindrance via a "most recent report for this reporter" lookup
-- (resolveMostRecentHindranceId, lib/hindrance/pm-notify.ts), guarded by a
-- comment arguing safety from THIS flow's own single-writer property. The
-- reviewer's finding: that comment fenced only the writer that exists
-- TODAY. It said nothing about a future one, and one is already named in
-- this project's own artifacts -- DASH-10, the unbuilt hindrance-editing
-- dashboard surface, cited in 039's own grant commentary. The moment any
-- PM/dashboard path ever inserts a hindrance for the same reporter
-- mid-session, "most recent" silently attaches that session's photos to
-- the WRONG row -- no constraint fires, evidence photos cross-attributed
-- on an owner-visible record. Named explicitly as the SAME failure shape
-- as the `was_unspecified` bug this same migration already found and
-- fixed internally, one layer up: re-deriving from adjacent state a fact
-- this RPC already established, on an earlier turn, instead of carrying
-- it forward. FIX: `hindrance_id` is now stamped into `whatsapp_sessions.
-- context` at the exact turn it is inserted (moved up, see the INSERT's
-- own new position below), read back and cleared at step 3's own
-- completion -- the identical mechanism `hindrance_unspecified` already
-- used for the SAME class of gap. `resolveMostRecentHindranceId` is
-- DELETED, not fenced (lib/hindrance/pm-notify.ts) -- the heuristic class
-- is removed, not narrowed. The photo handler (lib/whatsapp/inbound-
-- start.ts) now reads `hindrance_id` off the SAME session row it already
-- selects for `current_step` -- one query, not two, and FEWER queries
-- than the version this replaces. The RETURN block's own `hindrance_id`
-- comment ("the caller already has the id from the earlier turn") was
-- true in intent when first written and is now true in fact, not merely
-- aspirational -- the context key is that earlier turn's own record.
--
-- REDEFINITION CAPTURE (scripts/lint-migrations.mjs Rule 10, per migration
-- 041's own external review round 1, item 3 -- a capture must be taken and
-- recorded before a redefinition, not hand-retyped from memory). Captured
-- LIVE against test-db (exfccwlrhoutkgrlikod), 2026-09-14, immediately
-- before this migration was written, via:
--   SELECT md5(pg_get_functiondef('public.apply_hindrance_flow_turn'::regproc)),
--          length(pg_get_functiondef('public.apply_hindrance_flow_turn'::regproc));
-- body_md5 (pre-044): abdac08cd997bb2e3d8d73773d807a24 (body_len: 6496) --
-- this is 038's own body, unmodified by any migration between 038 and 044
-- (039/040/041 do not touch apply_hindrance_flow_turn). The DOWN block's
-- own restored body, below, is a byte-for-byte paste of
-- 038_hindrance_flow_and_collision_fix.sql's live function text, not
-- reconstructed from memory -- see the review package for the DOWN
-- rehearsal that confirms this restores the pre-044 body exactly (matching
-- hash, re-captured post-DOWN).
--
-- A photo NEVER reaches this function, at any step -- exactly like
-- morning/evening (per item 23, live in inbound-start.ts today): the TS
-- wrapper (lib/whatsapp/flows/hindrance.ts) is never called for a
-- photo-only turn. A photo arriving at step 1/2 (row doesn't exist yet)
-- is rejected by the TS layer directly, with no RPC call at all
-- (docs/plans/stage2-hindrance-photos-plan.md "DECISIONS" item 1); a photo
-- arriving at step 3 is enqueued directly (hindrance_id already known)
-- and reasks without calling this RPC, same mechanism. This function's
-- own signature and grants are therefore unaffected by photo handling at
-- all -- it only ever sees genuine typed-text turns.
-- =============================================================================
CREATE OR REPLACE FUNCTION apply_hindrance_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_timing        TEXT     DEFAULT NULL,
  p_timing_ok     BOOLEAN  DEFAULT NULL,
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL
)
RETURNS jsonb  -- { outcome, current_flow, current_step, hindrance_id, was_unspecified }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session         whatsapp_sessions;
  v_text            TEXT;
  v_outcome         TEXT;
  v_col             TEXT    := NULL;
  v_reask           INTEGER;
  v_complete        BOOLEAN := false;
  v_description     TEXT    := NULL;
  v_hindrance_id    UUID    := NULL;
  -- NEW, this migration. The TS wrapper's own `wasExhausted` (whether Q2's
  -- timing resolved cleanly or was recorded 'unspecified') used to be
  -- computable client-side by re-classifying THIS turn's message, because
  -- completion and Q2's own resolution were the SAME turn under 038. They
  -- are no longer the same turn -- completion now happens on Q3's turn, a
  -- SEPARATE call to this function, whose message ("none" or anything
  -- else) is not a timing answer at all. Re-classifying it would silently
  -- misreport every completion as exhausted (a real bug caught while
  -- writing the TS wrapper for this migration, before it ever ran).
  -- Fixed by carrying the fact across the Q2->Q3 gap in session context,
  -- set at Q2's own resolution, read and cleared at Q3's completion.
  v_was_unspecified BOOLEAN := false;
BEGIN
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  -- BOT-07 next-day reset -- unchanged from 038.
  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'hindrance';
      v_session.current_step := 1;
      -- External review round 2, S2: 'hindrance_unspecified'/'hindrance_id'
      -- (both new, this migration) added here alongside the pre-existing
      -- q2_reask/description -- a genuinely fresh start subtracts every
      -- key this flow's own context can ever carry, not a subset of them.
      -- UNREACHABLE IN PRACTICE, stated not assumed: current_flow can only
      -- be NULL here via the v_complete block below (which already clears
      -- both new keys) or the BOT-07 day-reset above (which wipes context
      -- to '{}'::jsonb entirely) -- neither path can leave either key
      -- behind for this branch to ever see. Added anyway, for the same
      -- reason a subtract list should name what it removes rather than
      -- rely on an invariant elsewhere never breaking silently.
      v_session.context      := v_session.context - 'q2_reask' - 'description'
                                  - 'hindrance_unspecified' - 'hindrance_id';
      v_outcome := 'start';
    ELSE
      -- Unchanged from 038 -- any already-active flow re-asks its own
      -- current question.
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    v_outcome := 'idle';

  ELSIF v_session.current_flow = 'hindrance' THEN
    IF v_text = '' THEN
      -- Empty answer: reask unlimited, no write, no budget consumed.
      -- Covers step 3 (the new photo question) too -- a genuinely empty
      -- typed message at step 3 just re-asks, same as steps 1/2 always
      -- have. (A photo message never reaches this branch at all -- see
      -- this function's own header.)
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1, free text, always accepted -- unchanged from 038.
      v_session.current_step := 2;
      v_session.context      := v_session.context || jsonb_build_object('description', v_text);
      v_outcome := 'advance';

    ELSIF v_session.current_step = 2 THEN
      v_description := v_session.context->>'description';
      v_reask := COALESCE((v_session.context->>'q2_reask')::int, 0);
      IF COALESCE(p_timing_ok, false) THEN
        v_col := 'hindrance_resolved';
      ELSIF v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q2_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        v_col := 'hindrance_unspecified';
      END IF;

      -- MOVED UP from 038's own single later insert site (external review
      -- round 2, S1) -- the row must exist BEFORE context is stamped with
      -- its id below, so the id carried forward is the real one this turn
      -- just wrote, not something re-derived afterward. Text is otherwise
      -- byte-identical to 038's own two INSERTs; only WHEN they run moved.
      IF v_col = 'hindrance_resolved' THEN
        INSERT INTO hindrances
          (tenant_id, project_id, reported_by, description, timing, timing_raw, submitted_via)
        VALUES
          (p_tenant_id, p_project_id, p_user_id, v_description, p_timing, NULL, 'whatsapp_adhoc')
        RETURNING id INTO v_hindrance_id;

      ELSIF v_col = 'hindrance_unspecified' THEN
        INSERT INTO hindrances
          (tenant_id, project_id, reported_by, description, timing, timing_raw, submitted_via)
        VALUES
          (p_tenant_id, p_project_id, p_user_id, v_description, 'unspecified', v_text, 'whatsapp_adhoc')
        RETURNING id INTO v_hindrance_id;
      END IF;

      -- CHANGED FROM 038: Q2 resolving (either branch of v_col above) no
      -- longer completes the flow -- it advances to step 3 (the new photo
      -- question) instead. The hindrances row is inserted above, at this
      -- exact turn, exactly as it always was -- only the step transition
      -- and outcome differ; 038's own v_complete/current_step:=0 path is
      -- what used to fire here and now fires one step later, at step 3
      -- (see below).
      IF v_col IS NOT NULL THEN
        v_session.current_step := 3;
        -- 'hindrance_unspecified' carries whether THIS resolution was the
        -- unspecified/exhausted branch across the Q2->Q3 gap; 'hindrance_id'
        -- (external review round 2, S1) carries the row's real id the same
        -- way -- both read back and cleared at step 3's own completion,
        -- below. This is what lets the photo handler (lib/whatsapp/
        -- inbound-start.ts) read the id directly off the session row it
        -- already selects, instead of re-deriving it from adjacent state.
        v_session.context := (v_session.context - 'q2_reask' - 'description')
          || jsonb_build_object(
               'hindrance_unspecified', v_col = 'hindrance_unspecified',
               'hindrance_id', v_hindrance_id
             );
        v_outcome := 'advance';
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- NEW, this migration. Any non-empty text completes the flow --
      -- docs/plans/stage2-hindrance-photos-plan.md §1 point 2: there is
      -- nothing further to write at this step (the row is already fully
      -- written, above), so unlike Q2 there is no classification to fail
      -- -- "none" is the documented way to skip, but any other non-empty
      -- reply is accepted as "done" too, since nothing here validates its
      -- content.
      v_complete := true;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- Unreachable in production -- unchanged from 038.
    v_outcome := 'wrong_flow';
  END IF;

  IF v_complete THEN
    v_was_unspecified := COALESCE((v_session.context->>'hindrance_unspecified')::boolean, false);
    -- Read back from context, same as v_was_unspecified immediately above
    -- (external review round 2, S1) -- this is the COMPLETION turn, a
    -- separate call from the one that inserted the row, so v_hindrance_id
    -- (the plain local variable) was never set by THIS call's own INSERT.
    -- Without this line, the RETURN below would report hindrance_id=NULL
    -- at the exact turn a caller (enqueueHindrancePmNotify's own call
    -- site, lib/whatsapp/flows/hindrance.ts) most needs it -- the same
    -- "re-derive instead of carry forward" gap S1 already closed for the
    -- photo handler, closed here too rather than left for a second finding.
    v_hindrance_id          := (v_session.context->>'hindrance_id')::uuid;
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    -- 'hindrance_id' cleared alongside 'hindrance_unspecified' (external
    -- review round 2, S1) -- both are step-3-only carry-forward state with
    -- nothing left to read once the flow genuinely completes (the value is
    -- already captured into v_hindrance_id, above, for THIS call's own
    -- RETURN -- clearing context does not lose it).
    v_session.context      := v_session.context - 'hindrance_unspecified' - 'hindrance_id';
    v_outcome := 'advance';
  END IF;

  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = v_session.context,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN jsonb_build_object(
    'outcome',         v_outcome,
    'current_flow',    v_session.current_flow,
    'current_step',    v_session.current_step,
    -- NEW field. Non-null at the TWO turns this RPC has confirmed
    -- knowledge of which hindrance a session's report is about: the turn
    -- that inserts the row (Q2's resolution, either v_col branch -- set
    -- directly from the fresh INSERT) and the turn that completes the
    -- flow (Q3's own completion -- read back from context, same as
    -- v_was_unspecified immediately above). Null on every other outcome
    -- (start, reask at any step, idle, wrong_flow). "The caller already
    -- has the id from the earlier turn" is now literally true, not
    -- aspirational (external review round 2, S1): the Q2-resolution turn
    -- also stamps the same id into whatsapp_sessions.context, which is
    -- what the photo handler (lib/whatsapp/inbound-start.ts) reads for
    -- step 3, and what this RETURN value itself is re-read from at
    -- completion for enqueueHindrancePmNotify's own caller
    -- (lib/whatsapp/flows/hindrance.ts) -- one write, read two different
    -- ways by two different callers, never two independent sources of
    -- truth.
    'hindrance_id',    v_hindrance_id,
    -- NEW field. Only meaningful when outcome='advance' and
    -- current_step=0 (a genuine completion) -- see this function's own
    -- DECLARE block comment for why this can no longer be derived
    -- client-side from the current turn's message.
    'was_unspecified', v_was_unspecified
  );
END;
$fn$;

-- Re-asserted explicitly, even though CREATE OR REPLACE with an unchanged
-- argument list preserves existing grants -- defense against a future
-- editor assuming that persists automatically, same convention every
-- prior CREATE OR REPLACE in this project's history follows.
REVOKE EXECUTE ON FUNCTION public.apply_hindrance_flow_turn(
  text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hindrance_flow_turn(
  text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
) TO service_role;

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- WHAT THIS DESTROYS, NAMED EXPLICITLY (same discipline as 043's own DOWN
-- header). Every hindrance_photos row -- the ONLY retention record and the
-- ONLY pointer this database holds to each photo's actual bytes in the
-- daily-log-photos bucket -- plus hindrances.photos_status. SQL alone
-- cannot reach the Storage side of this: once this DOWN runs for real,
-- every Storage object this table's rows pointed to (via photo_url)
-- becomes ORPHANED. PROCEDURAL CLEANUP NOTE, since no SQL statement can do
-- this: SELECT photo_url for every non-null row first and keep that list
-- before running this DOWN for real -- it is the only record of which
-- Storage objects are about to be orphaned.
--
-- apply_hindrance_flow_turn REVERTS TO 038'S OWN BODY (two questions,
-- completes at Q2, no hindrance_id in the return value) -- pasted back
-- verbatim from 038_hindrance_flow_and_collision_fix.sql, not
-- reconstructed from memory. REHEARSED against a live in-flight session
-- (docs/reviews/044-review-package.md has the raw evidence): a session
-- sitting at hindrance step 3 when this DOWN runs is left with
-- current_step=3, a step value the reverted (038) function's own
-- IF/ELSIF chain does not recognize (038 only ever writes/expects steps 1
-- and 2) -- its trailing ELSE branch (`v_outcome := 'reask'`) is what
-- fires for such a session, which RE-ASKS INDEFINITELY rather than
-- calling a function that doesn't exist or crashing outright. This is
-- "safely reset" in the weaker sense CLAUDE.md's own DOWN-rehearsal rule
-- asks for (never left calling something that no longer exists) but NOT
-- "resets to idle" -- a session stuck at step 3 under the reverted
-- function stays stuck re-asking a step the reverted app code no longer
-- has copy for either, until BOT-07's own next-day reset clears it. Named
-- here, not silently treated as fully clean; see the review package for
-- the full rehearsal transcript.
--
-- BEGIN;
--
-- DROP TABLE public.hindrance_photos;
-- ALTER TABLE public.hindrances DROP COLUMN photos_status;
--
-- CREATE OR REPLACE FUNCTION apply_hindrance_flow_turn(
--   p_phone_number  TEXT,
--   p_tenant_id     UUID,
--   p_user_id       UUID,
--   p_project_id    UUID,
--   p_message       TEXT,
--   p_start_flow    BOOLEAN,
--   p_timing        TEXT     DEFAULT NULL,  -- 'active'|'potential', TS-classified (classifyHindranceTiming)
--   p_timing_ok     BOOLEAN  DEFAULT NULL,  -- whether Q2's answer classified cleanly this turn
--   p_now           TIMESTAMPTZ DEFAULT now(),
--   p_test_sleep_ms INTEGER     DEFAULT NULL
-- )
-- RETURNS jsonb  -- { outcome, current_flow, current_step }
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $fn$
-- DECLARE
--   v_session     whatsapp_sessions;
--   v_text        TEXT;
--   v_outcome     TEXT;
--   v_col         TEXT    := NULL;
--   v_reask       INTEGER;
--   v_complete    BOOLEAN := false;
--   v_description TEXT    := NULL;
-- BEGIN
--   INSERT INTO whatsapp_sessions AS s
--     (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
--   VALUES
--     (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
--   ON CONFLICT (phone_number) DO UPDATE
--     SET phone_number = s.phone_number
--   RETURNING * INTO v_session;
--
--   IF p_test_sleep_ms IS NOT NULL THEN
--     PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
--   END IF;
--
--   -- BOT-07 next-day reset -- NOT inherited from morning/evening's own
--   -- copies of this check (confirmed explicitly during this migration's own
--   -- design pass: an inbound message reaching a stale 'hindrance' session
--   -- directly, via routeInboundMessage's currentFlow!==null short-circuit,
--   -- never touches apply_morning_flow_turn or apply_evening_flow_turn at
--   -- all -- this RPC needs its own copy, or a cross-day-stale hindrance
--   -- session would swallow even a brand-new "1" the next day).
--   IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
--     v_session.current_flow  := NULL;
--     v_session.current_step  := 0;
--     v_session.context       := '{}'::jsonb;
--     v_session.pending_flows := '[]'::jsonb;
--   END IF;
--
--   v_session.context := COALESCE(v_session.context, '{}'::jsonb);
--   v_text := btrim(COALESCE(p_message, ''));
--
--   IF p_start_flow THEN
--     IF v_session.current_flow IS NULL THEN
--       v_session.current_flow := 'hindrance';
--       v_session.current_step := 1;
--       v_session.context      := v_session.context - 'q2_reask' - 'description';
--       v_outcome := 'start';
--     ELSE
--       -- An ad-hoc flow start is ALWAYS inbound-triggered (the router's own
--       -- leading-"1" precedence), never cron-triggered -- there is no
--       -- scheduled-trigger-wins case to handle on THIS side of the
--       -- collision. Any already-active flow (morning, evening, or a second
--       -- hindrance attempt) re-asks its own current question, unchanged.
--       v_outcome := 'reask';
--     END IF;
--
--   ELSIF v_session.current_flow IS NULL THEN
--     v_outcome := 'idle';
--
--   ELSIF v_session.current_flow = 'hindrance' THEN
--     IF v_text = '' THEN
--       -- Empty answer: reask unlimited, no write, no budget consumed --
--       -- same convention as every other flow's empty-answer handling.
--       v_outcome := 'reask';
--
--     ELSIF v_session.current_step = 1 THEN
--       -- Q1, free text, always accepted -- no classification, no reask,
--       -- matches the spec's own "buildable without media, text-only"
--       -- confirmation for item 1.
--       v_session.current_step := 2;
--       v_session.context      := v_session.context || jsonb_build_object('description', v_text);
--       v_outcome := 'advance';
--
--     ELSIF v_session.current_step = 2 THEN
--       v_description := v_session.context->>'description';
--       v_reask := COALESCE((v_session.context->>'q2_reask')::int, 0);
--       IF COALESCE(p_timing_ok, false) THEN
--         -- Resolved cleanly -- first attempt or after one reask, p_timing_ok
--         -- (TS-computed) is all this branch needs to know.
--         v_col      := 'hindrance_resolved';
--         v_complete := true;
--       ELSIF v_reask < 1 THEN
--         v_session.context := v_session.context || jsonb_build_object('q2_reask', v_reask + 1);
--         v_outcome := 'reask';
--       ELSE
--         -- EXHAUSTED (reask budget 1, same cap as every other classified
--         -- question in this codebase). timing_raw = THIS turn's literal
--         -- text -- the resolving turn's own answer, matching attendance_raw's
--         -- established precedent (030_morning_flow_attendance.sql:
--         -- "v_attendance_raw := v_text ... on the resolving turn, either
--         -- way"), never the first, already-superseded attempt.
--         v_col      := 'hindrance_unspecified';
--         v_complete := true;
--       END IF;
--
--     ELSE
--       v_outcome := 'reask';
--     END IF;
--
--   ELSE
--     -- Should be unreachable in production -- current_flow can only be
--     -- 'hindrance' or NULL by the time this RPC is called, since routing
--     -- only ever delegates here for a 'hindrance' session. Kept explicit
--     -- rather than omitted so this function is total over every SessionFlow
--     -- value, matching morning/evening's own "wrong_flow" completeness
--     -- discipline -- if this ever fires, dispatchInboundTurn's own retry
--     -- logic (matching the morning/evening wrong_flow contract) is the
--     -- right place to handle it, not a silent fallthrough here.
--     v_outcome := 'wrong_flow';
--   END IF;
--
--   IF v_complete THEN
--     v_session.current_flow := NULL;
--     v_session.current_step := 0;
--     v_session.context      := v_session.context - 'q2_reask' - 'description';
--     v_outcome := 'advance';
--   END IF;
--
--   IF v_col = 'hindrance_resolved' THEN
--     INSERT INTO hindrances
--       (tenant_id, project_id, reported_by, description, timing, timing_raw, submitted_via)
--     VALUES
--       (p_tenant_id, p_project_id, p_user_id, v_description, p_timing, NULL, 'whatsapp_adhoc');
--
--   ELSIF v_col = 'hindrance_unspecified' THEN
--     INSERT INTO hindrances
--       (tenant_id, project_id, reported_by, description, timing, timing_raw, submitted_via)
--     VALUES
--       (p_tenant_id, p_project_id, p_user_id, v_description, 'unspecified', v_text, 'whatsapp_adhoc');
--   END IF;
--
--   UPDATE whatsapp_sessions
--      SET current_flow  = v_session.current_flow,
--          current_step  = v_session.current_step,
--          context       = v_session.context,
--          pending_flows = v_session.pending_flows,
--          tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
--          user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
--          expires_at    = p_now + INTERVAL '30 minutes',
--          updated_at    = p_now
--    WHERE id = v_session.id
--   RETURNING * INTO v_session;
--
--   RETURN jsonb_build_object(
--     'outcome',      v_outcome,
--     'current_flow', v_session.current_flow,
--     'current_step', v_session.current_step
--   );
-- END;
-- $fn$;
--
-- REVOKE EXECUTE ON FUNCTION public.apply_hindrance_flow_turn(
--   text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
-- ) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.apply_hindrance_flow_turn(
--   text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
-- ) TO service_role;
--
-- COMMIT;
