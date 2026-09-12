-- =============================================================================
-- 041_write_dpr_version_first_write_fix.sql
-- WRITTEN, NOT YET APPLIED, NOT YET REHEARSED AGAINST test-db AS OF THIS
-- COMMIT. Per CLAUDE.md's "a migration file enters supabase/migrations/ when
-- it is being applied, not when it is written" rule, this file lives in
-- docs/reviews/ until an apply is actually happening -- do not copy it into
-- supabase/migrations/ yet.
--
-- MIGRATION NUMBER: 041, reserved in scripts/migration-number-reservations.json
-- 2026-09-12, re-verified against `origin/main` at authoring time (fetched
-- fresh, not assumed) plus every sibling `.claude/worktrees/*/supabase/
-- migrations/` and `*/scripts/migration-number-reservations.json` (~30 active
-- worktrees checked) -- highest number anywhere was 040. See that reservation
-- entry for the full provenance note.
--
-- WHAT THIS FIXES, IN ONE LINE: write_dpr_version's very first call on any
-- row -- a row that has NEVER gone through this function before, with zero
-- dpr_versions rows -- currently lands at version 2, not version 1.
--
-- ORIGIN: found by Part A of docs/plans/dpr-owner-pass-regeneration.md
-- (PR #256, still draft, blocked on this landing -- its own SUCCESS test
-- asserts current_version = 1 on a brand-new row's first generation and gets
-- 2, reproduced identically both locally and in that PR's own CI run
-- 34701491184). NOT contamination -- traced deterministically through the
-- function body, confirmed by a clean full-suite re-run (32 failures down to
-- 2, this one surviving) and by CI reproducing the exact same failure on a
-- fresh runner.
--
-- WHY THIS IS DIFFERENT FROM 029'S OWN B3 FIX, NOT A REGRESSION OF IT: 029's
-- review (docs/reviews/029-dpr-versioning-review-package.md, finding B3)
-- already found "the first-ever write_dpr_version() call on any row jumps
-- current_version straight to 2" -- but the case it fixed was a row that
-- ALREADY HAD CONTENT from the pre-write_dpr_version raw-upsert path (029's
-- own migration-time backfill synthesized a version-1 dpr_versions row from
-- that existing content, so the row's real FIRST regeneration correctly
-- landed at 2, matching v1+v2). That backfill could only ever run once, at
-- 029's own apply time, for the one row that existed then. It never covered
-- -- because nothing called write_dpr_version on such a row until now -- a
-- row with NO content and NO history at all going through this function for
-- the first time. Both cases share one root cause (current_version's own
-- column DEFAULT of 1, plus the function's unconditional +1, together imply
-- a "version 0" state that has never actually existed) but need different
-- fixes: 029's was a one-time data backfill; this is the function's own
-- arithmetic, wrong for every row, forever, until fixed here.
--
-- SCOPE, DELIBERATELY NARROW:
--   * ONE function, ONE branch of logic inside it (how v_new_version is
--     computed). Nothing else in the function changes -- not the three
--     parameter-validation guards, not the B1 service_role-only guard, not
--     the B2 pm-role audience check, not the INSERT into dpr_versions, not
--     the UPDATE of dprs, not the RETURN value.
--   * Argument signature UNCHANGED: (uuid, text, jsonb, text, uuid),
--     confirmed against the LIVE definition captured this session (see
--     below), not assumed from the migration-029 file text. CREATE OR
--     REPLACE only -- no DROP FUNCTION, no re-grant dance, because nothing
--     about this migration trips CLAUDE.md's "CREATE OR REPLACE only
--     preserves grants when the signature is unchanged" hazard. The REVOKE/
--     GRANT statements below are re-asserted anyway, defensively, matching
--     this project's own established convention for every prior same-
--     signature CREATE OR REPLACE -- confirmed via has_function_privilege
--     this session that the live grant state already matches exactly what
--     these statements assert (anon: false, authenticated: true,
--     service_role: true), so re-issuing them is a no-op confirmation here,
--     not a change.
--   * write-version.ts's own phantom-v1 backfill (lib/dpr/write-version.ts)
--     is UNTOUCHED by this migration and remains necessary -- it handles a
--     genuinely different case (a row with real content from the OLD raw-
--     upsert path, predating this function's own use) that this fix does
--     not and cannot address at the RPC layer, since the RPC has no way to
--     know a row's content came from outside its own writes.
--
-- CLAUDE.md §0 GATING ASSESSMENT, condition by condition (§0's own text, not
-- paraphrased):
--   (a) "CREATES OR MODIFIES a live function's LOGIC." TRIPS. This changes
--       what write_dpr_version computes for v_new_version -- live logic in a
--       SECURITY DEFINER function with real write authority over report
--       content already delivered nightly. Full external review package
--       required.
--   (b) "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING
--       OBJECT." Does not trip on its own terms -- no grant, RLS policy, or
--       SECURITY DEFINER status changes; the REVOKE/GRANT restated below is
--       a no-op re-assertion of the already-live state, not a change to it.
--       (a) alone is sufficient to require the package regardless.
--   (c) "Touches auth or identity." No -- the auth.uid()-derived guards (B1,
--       B2) are completely unchanged, not touched by this migration at all.
--   (d) "Is destructive or irreversible." No in the schema sense -- no DROP,
--       no DELETE, purely a function-body replace. The DOWN below restores
--       the exact prior live behaviour, captured verbatim this session, not
--       reconstructed from the 029 file text (which could itself have
--       drifted from what's actually live, per 029's own U1 incident where
--       the file and the live grants briefly disagreed).
--   (e) "Moves money." No.
--   NET: (a) trips alone; full external review package required, same path
--   as 029's own two review rounds for this identical function.
--
-- LIVE STATE CAPTURED THIS SESSION, BEFORE ANY CHANGE (not from the 029 file
-- text -- from a real pg_get_functiondef probe against test-db,
-- `exfccwlrhoutkgrlikod`, `supabase db query --linked`, 2026-09-12
-- 15:26:31 UTC):
--   body_md5 (pre-041): c132d8f2e1897fbe7296824e1dc31a2d
--   Confirmed byte-for-byte identical in logic and comments to
--   029_dpr_versioning.sql's own CREATE OR REPLACE text (only pg_get_
--   functiondef's own re-serialization -- quoting style, no semantic
--   diff -- differs). Grepped every migration 001 through 040 for any OTHER
--   definition of write_dpr_version before trusting this as the sole
--   source: only 029_dpr_versioning.sql defines it; 038's own single
--   mention is a prose comment reference, not a redefinition. Also checked
--   docs/reviews/ for any held-but-unapplied .sql file touching this
--   function -- none exists beyond 029's own already-applied file and its
--   own review package (a documentation copy, not a definition site).
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 1 -- CREATE OR REPLACE, never DROP+CREATE -- signature byte-identical
-- to the live capture above. Body built from that live capture, with exactly
-- one logic change (marked FIX (migration 041) below) and the REVOKE/GRANT
-- re-asserted, unchanged, per this project's own convention.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.write_dpr_version(
  p_dpr_id UUID,
  p_content TEXT,
  p_structured JSONB,
  p_generated_by TEXT,
  p_generated_by_user UUID DEFAULT NULL
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_current_version INT;
  v_new_version INT;
  v_version_id UUID;
BEGIN
  IF p_generated_by NOT IN ('system', 'pm') THEN
    RAISE EXCEPTION 'write_dpr_version: p_generated_by must be system or pm, got %', p_generated_by
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_generated_by = 'pm' AND p_generated_by_user IS NULL THEN
    RAISE EXCEPTION 'write_dpr_version: p_generated_by_user is required when p_generated_by=pm'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  IF p_generated_by = 'system' AND p_generated_by_user IS NOT NULL THEN
    RAISE EXCEPTION 'write_dpr_version: p_generated_by_user must be NULL when p_generated_by=system'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- B1 (external review, blocking, 029): p_generated_by is caller-controlled,
  -- and this function is GRANTed to `authenticated`, not just `service_role`
  -- (the 'pm' branch below needs a real dashboard session to reach it).
  -- UNCHANGED by this migration.
  IF p_generated_by = 'system' AND auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION 'write_dpr_version: system-authored writes must come from service_role (no JWT) -- got an authenticated caller'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Lock the target row before reading current_version — a concurrent
  -- regeneration (two jobs racing, or a PM regenerating while the nightly
  -- job also fires) must not both compute the same "next version" number.
  -- CHANGED (migration 041): reads current_version alone now, not
  -- current_version + 1 -- the +1 arithmetic moves to the FIX block below,
  -- where it can be made conditional.
  SELECT tenant_id, current_version
    INTO v_tenant_id, v_current_version
  FROM public.dprs
  WHERE id = p_dpr_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'write_dpr_version: no dprs row for id=%', p_dpr_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- FIX (migration 041, the one substantive change this migration makes):
  -- a virgin row -- one that has NEVER gone through this function -- has no
  -- dpr_versions row at all, and its own current_version sits at the
  -- column's own untouched DEFAULT of 1 (029's ADD COLUMN). Unconditionally
  -- computing current_version + 1, as this function did before 041, treats
  -- that default as if it were a real, already-written "version 1" to
  -- increment past -- the first-ever call on any row landed at version 2,
  -- never version 1. 029's own B3 fix covered the adjacent case (a row that
  -- already had CONTENT from the pre-write_dpr_version raw-upsert path,
  -- backfilled once at 029's own apply time); it never covered a row with
  -- no content and no history at all, because nothing called this function
  -- on such a row until Part A's wiring PR exercised it for the first time.
  -- Still inside the row lock acquired above: two concurrent first-time
  -- calls on the SAME row cannot both observe "no history yet" and both
  -- try to write version 1 -- whichever acquires the lock first commits
  -- its version-1 row before the second is unblocked, so the second's own
  -- EXISTS check (run after it acquires the lock) correctly sees that row
  -- and writes version 2.
  IF EXISTS (SELECT 1 FROM public.dpr_versions WHERE dpr_id = p_dpr_id) THEN
    v_new_version := v_current_version + 1;
  ELSE
    v_new_version := v_current_version;
  END IF;

  -- When p_generated_by='pm', the caller's own users row must belong to the
  -- SAME tenant as the target dprs row. UNCHANGED by this migration (B2,
  -- external review, 029).
  IF p_generated_by = 'pm' THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.users u
      WHERE u.id = p_generated_by_user
        AND u.auth_id = auth.uid()
        AND u.tenant_id = v_tenant_id
        AND u.role = 'pm'
    ) THEN
      RAISE EXCEPTION 'write_dpr_version: p_generated_by_user does not match the calling PM''s own tenant-scoped identity'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  INSERT INTO public.dpr_versions (
    tenant_id, dpr_id, version, generated_by, generated_by_user,
    content, structured
  ) VALUES (
    v_tenant_id, p_dpr_id, v_new_version, p_generated_by, p_generated_by_user,
    p_content, p_structured
  )
  RETURNING id INTO v_version_id;

  UPDATE public.dprs
  SET content = p_content,
      structured = p_structured,
      current_version = v_new_version,
      generated_by = p_generated_by,
      generated_by_user = p_generated_by_user,
      last_regenerated_at = now()
  WHERE id = p_dpr_id;

  RETURN v_version_id;
END;
$$;

-- Re-asserted, unchanged -- confirmed via has_function_privilege this
-- session that the live grant state already matches this exactly (anon:
-- false, authenticated: true, service_role: true). No-op confirmation, not
-- a change; kept for the same reason every prior same-signature CREATE OR
-- REPLACE in this project restates its own grants explicitly rather than
-- relying on silence to mean "unchanged."
REVOKE ALL ON FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID) TO authenticated, service_role;

-- =============================================================================
-- STEP 2 -- COMMENT ON TABLE dpr_versions: dated supersession of 029's own
-- comment (B1, external review round 1, 2026-09-12). 029's own review
-- REQUIRED exactly this kind of note in the first place -- the reviewer
-- demanded the numbering semantics be written down so "history begins at
-- version 2" would be read as documented design, never rediscovered as a
-- bug. After 041, that statement is no longer true for a row created from
-- 041 onward -- left as-is, the catalog's own authoritative note would
-- contradict the live function. Superseded in place, dated, three eras kept
-- rather than overwritten -- migration 040's STEP 4 (retiring
-- evening_schedule_miss_reason) is the model for this shape, one column
-- comment over. The original 029 text is fully preserved inside era (2)
-- below, not deleted -- it correctly describes every row created between
-- 029's apply (2026-08-20) and 041's.
-- =============================================================================
COMMENT ON TABLE public.dpr_versions IS
  'Append-only DPR generation history. One row per regeneration (system or PM-'
  'triggered). dprs.content/structured/current_version stay a denormalized '
  '"latest" projection for fast reads; this table is the source of truth for '
  'history. "Which version was delivered to the owner" is answered by whichever '
  'row has delivered_to_owner_at set. Written ONLY via write_dpr_version() — '
  'never a direct INSERT from application code, EXCEPT migration 029''s own '
  'one-time backfill for rows that already carried real content before this '
  'table existed. '
  'THREE ERAS, dated, none silently overwritten: '
  '(1) BEFORE 2026-08-20 (pre-029): dpr_versions did not exist. dprs itself '
  'was the plain UPSERT target for regeneration — "silent replace, never a '
  'new version row per bot-flows.md" (023_dpr_reports.sql''s own original '
  'COMMENT ON TABLE dprs, quoted verbatim). Every regeneration destroyed the '
  'prior render with no history anywhere, for every row. '
  '(2) 2026-08-20 through 2026-09-12 (029, before 041): write_dpr_version() '
  'existed but was DESIGNED to be called only from a row''s SECOND '
  'generation onward. A genuinely new row''s version 1 was the initial '
  'system-generated report, written DIRECTLY by the generation job''s own '
  'upsert into dprs — never through this RPC, never recorded here. This '
  'table''s history for such a row began at version 2, on its first '
  'regeneration. 029''s own external review REQUIRED this stated '
  'explicitly, naming the alternative ("calling write_dpr_version() for the '
  'very first generation too") as "a separate, later change to the '
  'generation job itself, out of this migration''s scope" — deliberate, not '
  'a gap, for the scope 029 shipped. A row that ALREADY had real content '
  'when 029 applied got its own version 1 backfilled once, at apply time '
  '(029''s own section 2b) — those pre-existing rows never had this gap. '
  '(3) FROM 2026-09-12 (041 onward): 029''s own named alternative shipped. '
  'The generation job (Part A, docs/plans/dpr-owner-pass-regeneration.md, '
  'PR #256) now calls write_dpr_version() for EVERY generation, including '
  'the first. write_dpr_version() itself was fixed in this same migration '
  'to match: when no dpr_versions row exists yet for the target, the new '
  'version is current_version itself (1), not current_version + 1. A '
  'genuinely new row''s version 1 is now written THROUGH this function and '
  'IS recorded here, from its very first generation onward — era (2)''s gap '
  'does not apply to any row created from 041 onward.';

COMMIT;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment, per scripts/lint-migrations.mjs's
-- down-section-must-be-commented rule).
--
-- CORRECTED DURING REHEARSAL, 2026-09-12: the first version of this DOWN
-- block (hand-retyped from an earlier read of the live capture, using the
-- SAME shortened summary comments as this file's own UP section -- "B1
-- (external review, blocking, 029): ... UNCHANGED by this migration" in
-- place of the real multi-paragraph B1/B2 comments, plus a hand-typed
-- signature) did NOT restore byte-identical. Rehearsed live: applying it
-- produced body_md5 b8f5c276ee326beb183eef2cb3e712c7, not the pre-041
-- baseline c132d8f2e1897fbe7296824e1dc31a2d -- caught by the same
-- before/after hash comparison this rule exists to require, exactly the
-- failure mode "capture BEFORE any change, build from that live capture,
-- not from file text or memory" is meant to catch, and did catch, before
-- this went anywhere near a real apply. The block below is the EXACT
-- literal text from that live capture (this session's own
-- pg_get_functiondef output, saved verbatim, diffed line-by-line against
-- the flawed first draft to find the divergence, never retyped from
-- memory a second time) -- re-verified this session: applying it restores
-- body_md5 c132d8f2e1897fbe7296824e1dc31a2d exactly, matches_pre_fix_
-- baseline = true, grants unchanged (anon: false, authenticated: true,
-- service_role: true).
--
--   SELECT md5(pg_get_functiondef(
--     'public.write_dpr_version(uuid,text,jsonb,text,uuid)'::regprocedure
--   ));
--
-- STALENESS, STATED EXPLICITLY (external review round 1, item 2,
-- 2026-09-12): this DOWN inlines a captured baseline body, which 040's own
-- DOWN deliberately did NOT do for the function it touched -- not a
-- contradiction, one rule with two cases. Inlining is safe HERE because the
-- embedded md5 (c132d8f2e1897fbe7296824e1dc31a2d) makes a stale DOWN fail
-- LOUDLY: if this file is ever run as a rollback after some LATER migration
-- has already touched write_dpr_version again, the restored body will not
-- match a NEWER expected baseline and the mismatch is immediately
-- detectable by the same hash check this rehearsal already used -- it does
-- not silently restore the wrong thing. This inlined block is valid ONLY
-- while 041 is the LATEST migration to have touched write_dpr_version. If
-- any later migration has modified this function, do not trust or run this
-- block -- recapture a fresh baseline instead, per 040's own DOWN procedure
-- (pg_get_functiondef against the then-current live state, not this file).
--
-- BEGIN;
-- CREATE OR REPLACE FUNCTION public.write_dpr_version(p_dpr_id uuid, p_content text, p_structured jsonb, p_generated_by text, p_generated_by_user uuid DEFAULT NULL::uuid)
--  RETURNS uuid
--  LANGUAGE plpgsql
--  SECURITY DEFINER
--  SET search_path TO 'public'
-- AS $function$
-- DECLARE
--   v_tenant_id UUID;
--   v_new_version INT;
--   v_version_id UUID;
-- BEGIN
--   IF p_generated_by NOT IN ('system', 'pm') THEN
--     RAISE EXCEPTION 'write_dpr_version: p_generated_by must be system or pm, got %', p_generated_by
--       USING ERRCODE = 'invalid_parameter_value';
--   END IF;

--   IF p_generated_by = 'pm' AND p_generated_by_user IS NULL THEN
--     RAISE EXCEPTION 'write_dpr_version: p_generated_by_user is required when p_generated_by=pm'
--       USING ERRCODE = 'invalid_parameter_value';
--   END IF;

--   IF p_generated_by = 'system' AND p_generated_by_user IS NOT NULL THEN
--     RAISE EXCEPTION 'write_dpr_version: p_generated_by_user must be NULL when p_generated_by=system'
--       USING ERRCODE = 'invalid_parameter_value';
--   END IF;

--   -- B1 (external review, blocking): p_generated_by is caller-controlled, and
--   -- this function is GRANTed to `authenticated`, not just `service_role` (the
--   -- 'pm' branch below needs a real dashboard session to reach it). Before this
--   -- guard, ANY authenticated user, any tenant, any role, could call with
--   -- p_generated_by='system' and hit NO check at all below (the auth.uid()
--   -- derivation only runs on the 'pm' branch) -- a cross-tenant arbitrary
--   -- rewrite of owner-facing report content, RLS bypassed by construction
--   -- (SECURITY DEFINER). The legitimate 'system' caller is the nightly job via
--   -- service_role, which carries no JWT -- auth.uid() is NULL for it and
--   -- non-NULL for every real dashboard session. This is convention 4's exact
--   -- shape: a parameter-trusting path must be service_role-only; this function
--   -- previously carried the looser `authenticated` grant across BOTH its
--   -- parameter-trusting ('system') and auth.uid()-deriving ('pm') branches in
--   -- one body. VERIFIED (2026-08-2x, external review round): grepped app/,
--   -- lib/, scripts/ for any caller of write_dpr_version -- NONE exists yet
--   -- (dispatch.ts and generate-one-dpr.ts both still upsert dprs directly; the
--   -- RPC has no application-code caller until a separate wiring PR lands, not
--   -- part of this migration). This guard therefore cannot break any existing
--   -- legitimate caller today -- it is a forward constraint on that not-yet-
--   -- written wiring: it MUST invoke this RPC via service_role (no JWT), never
--   -- a route that forwards a user's session.
--   IF p_generated_by = 'system' AND auth.uid() IS NOT NULL THEN
--     RAISE EXCEPTION 'write_dpr_version: system-authored writes must come from service_role (no JWT) -- got an authenticated caller'
--       USING ERRCODE = 'insufficient_privilege';
--   END IF;

--   -- Lock the target row before reading current_version — a concurrent
--   -- regeneration (two jobs racing, or a PM regenerating while the nightly
--   -- job also fires) must not both compute the same "next version" number.
--   SELECT tenant_id, current_version + 1
--     INTO v_tenant_id, v_new_version
--   FROM public.dprs
--   WHERE id = p_dpr_id
--   FOR UPDATE;

--   IF NOT FOUND THEN
--     RAISE EXCEPTION 'write_dpr_version: no dprs row for id=%', p_dpr_id
--       USING ERRCODE = 'no_data_found';
--   END IF;

--   -- When p_generated_by='pm', the caller's own users row must belong to the
--   -- SAME tenant as the target dprs row — derived from auth.uid(), never
--   -- trusted from caller input (the 020-incident shape this project's own
--   -- SECURITY DEFINER discipline exists to avoid). A 'system' write (the
--   -- nightly job, service_role) has no auth.uid() session to check against.
--   --
--   -- B2 (external review, blocking): the same-tenant check alone bound WHO
--   -- but never WHAT ROLE -- any same-tenant authenticated user (a qs today,
--   -- anything that gets a login later) passed, rewriting the owner-facing
--   -- report attributed to themselves. Added `u.role = 'pm'`.
--   --
--   -- THE AUDIENCE TEST (027's discipline: every role decided explicitly on
--   -- this question, not by default), argued first -- 019's precedent below is
--   -- corroboration, not the whole case. Who legitimately authors an
--   -- owner-facing report? Per CLAUDE.md §1/§5: DPR generation and delivery is
--   -- explicitly PM-owned Spine work ("PM web dashboard: ... DPR archive";
--   -- pm's own role line: "projects, DPR review, engineer management"). No
--   -- other role has DPR review or authorship in its stated remit -- qs's
--   -- remit is invoice review/BOQ (Phase 2, unrelated content); engineer/owner
--   -- have no web login at all (auth_id NULL) and can never reach this branch
--   -- regardless. admin is the interesting exclusion, argued explicitly rather
--   -- than assumed obvious: admin is the MORE privileged role (tenant
--   -- creation, invites, billing, settings -- CLAUDE.md §5), but privilege
--   -- level is not the test here, JOB FUNCTION is -- admin's remit is tenant
--   -- administration, not site-progress judgment. An admin authoring or
--   -- correcting a DPR would be attributing operational, site-level content
--   -- (what actually happened on site, in the PM's own professional judgment)
--   -- to a role whose job is not to know that. The same reasoning is why
--   -- correct_daily_log (019) draws the identical line for the closest
--   -- existing analogue -- correcting the operational record daily_logs feeds
--   -- into every DPR (`v_editor_role <> 'pm'`, 019_daily_log_edits.sql:178,
--   -- strictly pm-only, rejecting even admin). Corroboration, not the primary
--   -- argument: this migration reaches the same audience answer as 019 because
--   -- both apply the same job-function test to the same class of content, not
--   -- merely because 019 sets a precedent to be copied.
--   IF p_generated_by = 'pm' THEN
--     IF NOT EXISTS (
--       SELECT 1 FROM public.users u
--       WHERE u.id = p_generated_by_user
--         AND u.auth_id = auth.uid()
--         AND u.tenant_id = v_tenant_id
--         AND u.role = 'pm'
--     ) THEN
--       RAISE EXCEPTION 'write_dpr_version: p_generated_by_user does not match the calling PM''s own tenant-scoped identity'
--         USING ERRCODE = 'insufficient_privilege';
--     END IF;
--   END IF;

--   INSERT INTO public.dpr_versions (
--     tenant_id, dpr_id, version, generated_by, generated_by_user,
--     content, structured
--   ) VALUES (
--     v_tenant_id, p_dpr_id, v_new_version, p_generated_by, p_generated_by_user,
--     p_content, p_structured
--   )
--   RETURNING id INTO v_version_id;

--   UPDATE public.dprs
--   SET content = p_content,
--       structured = p_structured,
--       current_version = v_new_version,
--       generated_by = p_generated_by,
--       generated_by_user = p_generated_by_user,
--       last_regenerated_at = now()
--   WHERE id = p_dpr_id;

--   RETURN v_version_id;
-- END;
-- $function$;
--
-- REVOKE ALL ON FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID) FROM PUBLIC, anon;
-- GRANT EXECUTE ON FUNCTION public.write_dpr_version(UUID, TEXT, JSONB, TEXT, UUID) TO authenticated, service_role;
--
-- -- Restores 029's own COMMENT ON TABLE verbatim, so a rollback of THIS
-- -- migration also undoes STEP 2's dated supersession, not just the
-- -- function -- per CLAUDE.md's own "a teardown verifies comments too"
-- -- rule, added after test-db was once found carrying a stale COMMENT
-- -- from a prior rehearsal round whose schema-level DOWN had otherwise run
-- -- correctly. Not added by external review round 1 -- added alongside it,
-- -- as the direct, same-shape consequence of STEP 2 existing at all.
-- COMMENT ON TABLE public.dpr_versions IS
--   'Append-only DPR generation history. One row per regeneration (system or PM-'
--   'triggered). dprs.content/structured/current_version stay a denormalized '
--   '"latest" projection for fast reads; this table is the source of truth for '
--   'history. "Which version was delivered to the owner" is answered by whichever '
--   'row has delivered_to_owner_at set. Written ONLY via write_dpr_version() — '
--   'never a direct INSERT from application code, EXCEPT this migration''s own '
--   'one-time backfill (section 3b, below) for rows that already carried real '
--   'content before this table existed. STATED DESIGN FACT (B3, external review): '
--   'for a genuinely NEW dprs row (created after this migration), version 1 is '
--   'the initial system-generated report, written directly by the generation '
--   'job''s upsert into dprs — NOT through write_dpr_version() and NOT recorded '
--   'here. This table''s history for such a row begins at version 2, on its '
--   'first regeneration. This is deliberate, not a gap: the alternative (calling '
--   'write_dpr_version() for the very first generation too) is a separate, '
--   'later change to the generation job itself, out of this migration''s scope. '
--   'For a row that ALREADY had content when this migration ran, its version 1 '
--   'IS recorded here (via the section 3b backfill) — those rows do not have '
--   'this gap.';
-- COMMIT;
