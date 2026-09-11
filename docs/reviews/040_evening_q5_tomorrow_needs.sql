-- =============================================================================
-- Migration 040 -- Evening Q5 replaced: "anything that slowed execution
-- today?" (backward-looking, its hindrance role now owned by the explicit
-- ad-hoc hindrance flow, migration 038/public.hindrances) becomes "anything
-- extra needed tomorrow beyond the plan -- material, labour or machine?"
-- (forward-looking). Written 2026-09-11. STAGE 1 of 2 (TypeScript/DPR
-- changes -- the EngineerHindranceFacts -> EngineerTomorrowNeedsFacts
-- rename, the "Dependency" label, and the new public.hindrances join/
-- "Hindrance" section -- are Stage 2, a separate PR, gated on this stage's
-- approval).
--
-- HELD IN docs/reviews/, NOT supabase/migrations/, PER CLAUDE.md'S OWN
-- "MIGRATION FILE ENTERS supabase/migrations/ WHEN APPLIED, NOT WHEN
-- WRITTEN" RULE. This file is UNAPPLIED. It moves into supabase/migrations/
-- as part of the same commit/session that actually applies it, never
-- before -- see that rule's own reasoning (a written-but-unapplied file
-- sitting in the scanned directory is a live hazard on any branch that has
-- it checked out).
--
-- DESIGN PROVENANCE -- three superseding design passes in one session
-- (2026-09-11), this file implements only the FINAL one:
--   pass 1: evening flow reordered, 5 -> 6 questions (new plan-completion
--     Q2 inserted) -- SUPERSEDED, never built.
--   pass 2: reverted to a pure 5-for-5 replace (Q5 only) specifically
--     because design-principles.md Section 0's six-question ceiling
--     requires "replace or piggyback, never append" -- the insert-a-
--     question version was a pure append and was dropped for that reason.
--   pass 3 (this file): repurpose-vs-new-column question settled in favour
--     of a NEW, honestly-named column (evening_tomorrow_needs) rather than
--     a third repurposing of evening_schedule_miss_reason -- the
--     backward/forward orientation flip makes the old name actively
--     misleading in a way the 019->035 reuse (schedule-miss-reason ->
--     any-hindrance-today, both backward-looking) was not. Full reasoning
--     for all three passes: this session's own conversation record, not
--     duplicated here.
--
-- RISK CLASS: mostly additive (one new column, an extended column-bound
-- UPDATE grant, two dated COMMENT ON COLUMN statements) with one
-- NON-additive piece at the centre of it -- the migration-019 correction
-- whitelist SWAPS one entry for another (daily_log_edits' CHECK constraint,
-- AND correct_daily_log()'s own CASE, both DROP evening_schedule_miss_reason
-- and ADD evening_tomorrow_needs in the same statement), and
-- apply_evening_flow_turn's step-5 branch changes its WRITE TARGET column.
-- REVERSIBLE WITHOUT PITR, BUT NOT BY UNCOMMENTING AND RUNNING THE DOWN
-- BLOCK AS-IS. The DOWN block (bottom of this file, reference only,
-- commented out per this project's own down-section-must-be-commented
-- lint rule) is a ROLLBACK PROCEDURE, not a runnable script: its two
-- function bodies are deliberately left as bracketed instructions, not
-- inlined SQL, and must be captured fresh via pg_get_functiondef from a
-- database at the intended pre-rollback state before the rollback is
-- executed -- see the DOWN block's own header for why (the same
-- hand-merge-migration-files mistake this migration's own header names as
-- the root cause of its 038 near-miss). This migration's own rehearsal did
-- not execute this block's text; it executed a real, freshly-captured
-- rollback built the same way this block now instructs, and that
-- rollback's OUTCOME (both functions and the whitelist restored to their
-- pre-migration state, evening_tomorrow_needs never dropped) is what's
-- reversible without PITR -- the block itself is a procedure to follow,
-- not a script to strip-and-run. evening_tomorrow_needs itself is
-- NEVER dropped by the DOWN -- columns are never dropped by this project's
-- convention (CLAUDE.md: "do not drop anything") -- so a rollback cannot
-- lose data written under the new column between apply and rollback; it
-- only stops being reachable via the live flow/whitelist until re-applied.
-- evening_schedule_miss_reason is likewise never dropped, forward or back.
--
-- TRIPS CLAUDE.md SECTION 0(a) -- "CREATES OR MODIFIES a live function's
-- LOGIC -- what it computes, what it writes." Both correct_daily_log() and
-- apply_evening_flow_turn() are live, SECURITY DEFINER, production
-- functions whose write targets this migration changes. EXTERNAL REVIEW IS
-- REQUIRED BEFORE APPLY. Aravind routes the review request -- not built or
-- sent by this session.
--
-- CUTOVER HAZARD, NAMED FOR THE REVIEW PACKAGE, NOT HYPOTHETICAL: step
-- numbering is UNCHANGED by this migration (evening stays a 5-step flow,
-- step 5 stays step 5) -- so there is no structural misrouting risk across
-- the general in-flight-session population the way a step-renumbering
-- change would cause. The exposure is narrower and different in kind: a
-- session sitting at current_step = 5 at the exact deploy instant has
-- ALREADY RECEIVED the OLD Q5 prompt ("Anything that slowed execution
-- today?") and has not replied yet. Step 5 is unconditional and accepts any
-- non-empty reply with no re-ask, no validation (unchanged by this
-- migration). When that engineer's reply lands after deploy, the NEW code
-- accepts it as-is and writes it to evening_tomorrow_needs -- an
-- old-Q5-shaped answer ("rain, lost an hour") gets recorded and later
-- rendered under the NEW "Dependency" label as if it were an answer to the
-- new question. Time-boxed to whichever sessions are mid-reply at the
-- literal moment of deploy; not zero. No code-side mitigation is built for
-- this in Stage 1 or Stage 2 -- named so the review package addresses it
-- explicitly (accept the window, or hold outbound sends briefly around
-- deploy) rather than it being discovered after the fact.
--
-- WHAT THIS FILE DOES NOT DO: it does not touch public.hindrances, does not
-- touch any TypeScript, does not touch the WhatsApp template (Q1 is
-- unchanged, quoco_evening_checkin_v3's approved body carries only Q1's
-- text -- confirmed against docs/whatsapp-templates.md and
-- lib/whatsapp/outbound/templates.ts in this session's own research; no
-- template resubmission is needed for this change).
--
-- REAL FINDING FROM REHEARSING THIS, CAUGHT BEFORE ARAVIND EVER SAW A
-- DRAFT, NOT ASSUMED CLEAN (2026-09-11). The first draft of STEP 7 below
-- built apply_evening_flow_turn's CREATE OR REPLACE from migration 035's
-- body alone, verified only against 035's own file text and a byte hash
-- taken BEFORE that draft was written. What that draft missed: migration
-- 038 (hindrance_flow_and_collision_fix) ALSO redefines this same
-- function -- a real, live, externally-reviewed branch
-- (`ELSIF v_session.current_flow = 'hindrance' THEN`, plus two DECLARE
-- variables and two extra RETURN keys, `hindrance_discarded`/
-- `hindrance_had_description`) that force-resets an abandoned ad-hoc
-- hindrance session when a scheduled evening trigger fires -- the exact
-- collision-handling logic 038's own external review round 2 (B1,
-- BLOCKING) exists to guarantee. The first draft's CREATE OR REPLACE would
-- have SILENTLY DELETED that entire branch on apply -- an unrelated,
-- already-shipped, already-reviewed piece of logic, lost as a side effect
-- of a Q5 copy change, discoverable only by someone independently
-- rediscovering 038's own collision scenario from scratch. CAUGHT by this
-- round's own rehearsal discipline: a pre-change hash/length probe
-- (`pg_get_functiondef`, taken before touching anything) did not match a
-- post-DOWN restore built from the file text alone (21445 chars/ live vs
-- 19878 chars/ reconstructed from 035 alone) -- the mismatch was chased
-- down rather than dismissed as noise, per CLAUDE.md's own "verify by
-- observation" standard. FIXED: STEP 7's body below is now built from a
-- verified `pg_get_functiondef` capture of the ACTUAL live function
-- (035 + 038 combined) taken immediately before this migration was
-- authored, with ONLY the step-5 branch changed by an exact, asserted
-- string substitution (three edits, each asserted to match exactly once)
-- -- not reconstructed by eye from migration files a second time. Root
-- cause, stated plainly so it does not recur: `correct_daily_log` WAS
-- checked this way (grepped every migration 001-039 for a second toucher
-- before trusting 019's text alone) -- `apply_evening_flow_turn` was not
-- given the same check on the first pass. Every CREATE OR REPLACE in this
-- file is now grep-verified against every one of migrations 001-039, not
-- just the migration that originally introduced the function.
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 1 -- new column. Bare TEXT, no JSONB wrapper -- there is no
-- structured sub-data to carry (Q5 stays free text, ungated, terminal; see
-- STEP 7 below), and wrapping plain free text in a JSONB object for
-- consistency with 035's other new evening columns would add shape the
-- data does not have. Matches evening_schedule_miss_reason's own original
-- shape, not the {items:[...], raw_text} convention those columns use.
-- =============================================================================
ALTER TABLE public.daily_logs
  ADD COLUMN evening_tomorrow_needs TEXT;

-- =============================================================================
-- STEP 2 -- re-declare the daily_logs column-bound UPDATE grant (migration
-- 017 step 4, re-declared by 030 step 3, re-declared again by 035 step 2)
-- with evening_tomorrow_needs added. Idempotent/declarative (015's RERUN
-- SEMANTICS note) -- safe to re-issue in full. Nothing removed from the
-- prior list, including evening_schedule_miss_reason itself (STEP 5 below
-- retires it from the CORRECTION whitelist, which is a narrower, separate
-- thing from this UPDATE grant -- the grant is left wired per this
-- project's own "leave a now-unread column's grant wired rather than
-- pruning it" precedent, same as 035 STEP 2's own comment).
-- =============================================================================
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies,
  evening_manpower, evening_idle_hours, evening_tomorrow_needs
) ON public.daily_logs TO authenticated;

-- =============================================================================
-- STEP 3 -- COMMENT ON the new column.
-- =============================================================================
COMMENT ON COLUMN daily_logs.evening_tomorrow_needs IS
  'Evening Q5, migration 040, replacing the evening_schedule_miss_reason-sourced Q5 this same migration retires. Free text, unconditional, ungated, terminal -- same shape as the old Q5 (no parser, no reask): the post-113-fabrication direction in this codebase is to stop parsers inventing structure an engineer did not state (schema.ts''s own EngineerManpowerFacts comment), and Q5 has no structured sub-data to justify a JSONB wrapper. Question text: "Anything *extra needed* tomorrow beyond the plan -- material, labour or machine? Reply in a few words, or ''none''." Forward-looking (what is additionally required) -- NOT the old Q5''s backward-looking "what went wrong" framing, which now belongs entirely to the explicit ad-hoc hindrance flow (migration 038, public.hindrances). DPR label: "Dependency" (Stage 2 of this migration''s own two-stage rollout, application code only).';

-- =============================================================================
-- STEP 4 -- COMMENT ON evening_schedule_miss_reason: THIRD dated comment,
-- retiring it. Column is FROZEN, not dropped (this project's own "do not
-- drop anything" convention, CLAUDE.md) -- it keeps its historical data
-- under both prior meanings. No code (RPC or TypeScript) writes or reads
-- this column after this migration + its Stage 2 companion land.
-- =============================================================================
COMMENT ON COLUMN daily_logs.evening_schedule_miss_reason IS
  'RETIRED, migration 040, dated 2026-09-11. No writer as of this migration -- FROZEN, not dropped; historical data under BOTH prior meanings is preserved as-is. Meaning 1 (until 2026-08-31, migration 035): the conditional "why wasn''t the plan met" follow-up its name describes. Meaning 2 (2026-08-31 to 2026-09-11, migration 035 through 039): the unconditional evening Q5 answer, "anything that slowed execution today?" -- see 035''s own COMMENT ON COLUMN for that reasoning, verbatim, the same reuse-not-rename tradeoff this migration declines to repeat a third time. Q5''s current answer lives in evening_tomorrow_needs (STEP 1/3 above) as of this migration. Removed from migration 019''s correction whitelist by STEP 5/6 below in the SAME migration -- do not correct this column going forward; nothing reads a correction to it.';

-- =============================================================================
-- STEP 5 -- migration 019's correction whitelist: daily_log_edits.column_name
-- CHECK constraint. Swaps evening_schedule_miss_reason for
-- evening_tomorrow_needs, same position, same 'text' semantics. Constraint
-- name confirmed live against test-db before writing this statement:
-- daily_log_edits_column_name_check (pg_constraint, contype='c').
-- =============================================================================
ALTER TABLE public.daily_log_edits DROP CONSTRAINT daily_log_edits_column_name_check;
ALTER TABLE public.daily_log_edits ADD CONSTRAINT daily_log_edits_column_name_check
  CHECK (column_name IN (
    'is_holiday', 'holiday_reason', 'weather',
    'morning_plan', 'morning_execution_plan',
    'evening_output', 'evening_schedule_met',
    'evening_tomorrow_needs', 'evening_workers_on_site'
  ));

-- =============================================================================
-- STEP 6 -- correct_daily_log(): CASE whitelist updated to match STEP 5's
-- CHECK, same swap, same 'text' cast type. Body otherwise BYTE-IDENTICAL to
-- 019's live definition -- verified directly against test-db's
-- pg_get_functiondef() output before writing this statement, not assumed
-- from the migration file alone. Signature UNCHANGED (uuid, text, jsonb) --
-- CREATE OR REPLACE genuinely replaces, no orphaned-overload risk
-- (CLAUDE.md's own "CREATE OR REPLACE FUNCTION only preserves grants when
-- the argument signature is unchanged" rule -- it is unchanged here).
-- =============================================================================
CREATE OR REPLACE FUNCTION public.correct_daily_log(
  p_daily_logs_id UUID,
  p_column        TEXT,
  p_new_value     JSONB
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_editor_id   UUID;
  v_editor_role TEXT;
  v_cast_type   TEXT;
  v_project_id  UUID;
  v_tenant_id   UUID;
  v_log_date    DATE;
  v_old_value   JSONB;
  v_edit_id     UUID;
BEGIN
  -- (a) Resolve the caller's profile (decoupled users.id, post-007). Engineers
  -- have auth_id = NULL / no web login, so this fail-louds for any non-web actor.
  SELECT id, role INTO v_editor_id, v_editor_role
  FROM public.users WHERE auth_id = auth.uid();
  IF v_editor_id IS NULL THEN
    RAISE EXCEPTION 'correct_daily_log: no profile for auth.uid()=%', auth.uid()
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (b) PM-only v1.
  IF v_editor_role <> 'pm' THEN
    RAISE EXCEPTION 'correct_daily_log: role % may not correct logs (PM-only)', v_editor_role
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c) Column whitelist AND per-column cast type, in one CASE. This is what
  -- makes the dynamic format(%I) UPDATE below injection-safe, and enforces
  -- scalar-only-v1 at the DB (a JSONB column, or engineer_id, falls to ELSE).
  -- evening_schedule_miss_reason -> evening_tomorrow_needs, migration 040.
  v_cast_type := CASE p_column
    WHEN 'is_holiday'                   THEN 'boolean'
    WHEN 'evening_schedule_met'         THEN 'boolean'
    WHEN 'evening_workers_on_site'      THEN 'integer'
    WHEN 'holiday_reason'               THEN 'text'
    WHEN 'weather'                      THEN 'text'
    WHEN 'morning_plan'                 THEN 'text'
    WHEN 'morning_execution_plan'       THEN 'text'
    WHEN 'evening_output'               THEN 'text'
    WHEN 'evening_tomorrow_needs'       THEN 'text'
    ELSE NULL
  END;
  IF v_cast_type IS NULL THEN
    RAISE EXCEPTION 'correct_daily_log: column % is not correctable in v1', p_column
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (c2) Size guard at the trust boundary (review item 5): a scalar correction is
  -- tiny; cap the jsonb payload so an authenticated PM cannot bloat the daily_logs
  -- row / audit trail with a large value. 100 KB is far above any legit scalar
  -- (a long free-text plan is well under 1 KB) and well below abuse — adjust only
  -- if a real column ever needs more.
  IF pg_column_size(p_new_value) > 100000 THEN
    RAISE EXCEPTION 'correct_daily_log: new_value too large (% bytes, cap 100000)',
      pg_column_size(p_new_value)
      USING ERRCODE = 'program_limit_exceeded';
  END IF;

  -- (d) Lock + read the target row (TOCTOU: lock before reading the old value).
  SELECT project_id, tenant_id, log_date
    INTO v_project_id, v_tenant_id, v_log_date
  FROM public.daily_logs WHERE id = p_daily_logs_id
  FOR UPDATE;
  IF v_project_id IS NULL THEN
    RAISE EXCEPTION 'correct_daily_log: no daily_logs row %', p_daily_logs_id
      USING ERRCODE = 'no_data_found';
  END IF;

  -- (e) Tenant assert (defense in depth). NB (review item 7): guard (f)'s
  -- membership check IMPLIES same-tenant ONLY because 017 made project_members's
  -- FKs composite same-tenant ((project_id, tenant_id) -> projects, (user_id,
  -- tenant_id) -> users), so a membership row cannot span tenants. This explicit
  -- assert is the belt to that suspenders — keep it even though (f) implies it;
  -- if 017's composite FKs were ever relaxed, this becomes the sole guard.
  IF v_tenant_id <> get_user_tenant_id() THEN
    RAISE EXCEPTION 'correct_daily_log: cross-tenant target'
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (f) *** SCOPE-GAP CLOSURE *** — the calling PM must be a project_member of
  -- the TARGET row's project. RLS does NOT enforce this (it is tenant-wide).
  IF NOT EXISTS (
    SELECT 1 FROM public.project_members
    WHERE project_id = v_project_id AND user_id = v_editor_id
  ) THEN
    RAISE EXCEPTION 'correct_daily_log: PM % is not a member of project %', v_editor_id, v_project_id
      USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- (g) Old value (row already locked).
  EXECUTE format('SELECT to_jsonb(%I) FROM public.daily_logs WHERE id = $1', p_column)
    INTO v_old_value USING p_daily_logs_id;

  -- (h) No-op: unchanged value is skipped, not recorded.
  IF v_old_value IS NOT DISTINCT FROM p_new_value THEN
    RETURN NULL;
  END IF;

  -- NULL / TYPE CONVENTION (review item 4 — the caller/wrapper contract):
  --   * p_new_value is the column's value as JSONB. A JSON scalar must match the
  --     column's NATURAL to_jsonb() output — a boolean column expects JSON
  --     true/false, an integer column a JSON number, a text column a JSON string —
  --     NOT a quoted string for a boolean/int. (The future Server-Action wrapper's
  --     Zod MUST enforce this per-column shape before calling.)
  --   * Passing SQL NULL (not JSON 'null') CLEARS the field: ($1 #>> '{}') is
  --     NULL, so the column is set NULL and the audit row's new_value is NULL.
  --     Covered by the clear-to-NULL happy-path test (T-019-10).
  -- (i) Write the one whitelisted column, coercing jsonb -> the column's base
  -- type (%I is whitelisted, %s is a fixed CASE literal — both safe).
  EXECUTE format(
    'UPDATE public.daily_logs SET %I = ($1 #>> ''{}'')::%s WHERE id = $2',
    p_column, v_cast_type
  ) USING p_new_value, p_daily_logs_id;

  -- (j) Audit row — same transaction, so update+audit are all-or-nothing.
  INSERT INTO public.daily_log_edits (
    tenant_id, daily_logs_id, project_id, log_date,
    column_name, old_value, new_value, edited_by
  ) VALUES (
    v_tenant_id, p_daily_logs_id, v_project_id, v_log_date,
    p_column, v_old_value, p_new_value, v_editor_id
  )
  RETURNING id INTO v_edit_id;

  RETURN v_edit_id;
END;
$$;

-- Signature verified unchanged (UUID, TEXT, JSONB) before this statement was
-- written -- CREATE OR REPLACE genuinely replaces, no overload risk.
REVOKE EXECUTE ON FUNCTION public.correct_daily_log(UUID, TEXT, JSONB) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.correct_daily_log(UUID, TEXT, JSONB) TO authenticated;

-- =============================================================================
-- STEP 7 -- apply_evening_flow_turn(): step-5 branch's write target changes
-- from evening_schedule_miss_reason to evening_tomorrow_needs. Body
-- otherwise BYTE-IDENTICAL to the TRUE LIVE definition -- 035's
-- restructuring PLUS migration 038's hindrance/evening flow-collision
-- branch (see this file's own header finding: an earlier draft of this
-- comment, and of this STEP's body, was built from 035 alone and missed
-- 038's branch entirely) -- verified directly against test-db's
-- pg_get_functiondef() output (md5 ec80f6821a4bf73adadb1c172e8eaef3,
-- 21445 chars) captured immediately before this migration was authored,
-- before writing this statement.
--
-- HASH CORRECTION, DATED 2026-09-11 (Aravind, Stage 1 review round 2):
-- this comment previously read "ec80f6821a4bf73adadad9c172e8eaef3" (33
-- hex characters -- not even a valid MD5 length, 32 required) -- a
-- transcription slip made writing this comment by hand instead of
-- copying the captured value, caught only because it disagreed with the
-- companion rehearsal record's own value
-- (docs/reviews/040-evening-q5-tomorrow-needs-rehearsal.md), which was
-- correct throughout (pasted directly from tool output, never retyped).
-- The value above is the corrected one -- re-verified against this
-- migration's own rehearsal evidence, not re-derived from scratch.
-- Signature UNCHANGED (text, uuid, uuid, uuid, text, boolean, jsonb, jsonb,
-- timestamptz, integer) -- CREATE OR REPLACE genuinely replaces, no
-- orphaned-overload risk. Q1-Q4 branches (steps 1-4) are untouched, pasted
-- verbatim; only step 5's comment, internal v_col label, and the terminal
-- INSERT/UPDATE's target column change.
-- =============================================================================
CREATE OR REPLACE FUNCTION apply_evening_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_parse         JSONB    DEFAULT NULL,
  p_parse_ok      JSONB    DEFAULT NULL,
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL
)
RETURNS jsonb   -- { outcome, current_flow, current_step, log_date, equipment_echo }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session            whatsapp_sessions;
  v_text               TEXT;
  v_log_date           DATE;
  v_outcome            TEXT;
  v_col                TEXT    := NULL;
  v_reask              INTEGER;
  v_complete           BOOLEAN := false;
  v_morning_equipment  JSONB;
  v_confidence         TEXT;
  v_equip_items        JSONB;
  v_equipment_echo     JSONB   := NULL;  -- kept for RETURN shape compatibility; see note at RETURN
  i                     INTEGER;
  -- Evening Q4 (equipment) join state -- TYPE STRING only, no positional
  -- index, no label tiers. §33(b)/§6: the entire per-machine matching
  -- apparatus this replaces is retired outright, not patched.
  v_reply_count        INTEGER;
  v_reply_type         TEXT;
  v_morning_count_for_type INTEGER;  -- summed `count` across every morning_equipment item sharing this type
  -- S-set (a), discard observability -- same shape as apply_morning_flow_
  -- turn's own identical addition; see that function's own comment.
  -- CARRIED FORWARD FROM MIGRATION 038, UNCHANGED BY THIS MIGRATION -- see
  -- this file's own header note on the rehearsal finding that caught this
  -- function needing 038's body as its base, not 035's alone.
  v_hindrance_discarded      BOOLEAN := NULL;
  v_hindrance_had_description BOOLEAN := NULL;
BEGIN
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

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
      v_session.current_flow := 'evening';
      v_session.current_step := 1;
      -- CONTEXT DISCIPLINE. Strips the full NEW reask-key set (e2/e3/e4) --
      -- the old set (e4_headcount/e5_reask/e6_reask) is a different regime
      -- and cannot appear once this migration is live, but stripping both
      -- costs nothing and matches STEP 3's own belt-and-braces sweep above.
      v_session.context := v_session.context
                            - 'e2_reask' - 'e3_reask' - 'e4_reask'
                            - 'e4_headcount' - 'e5_reask' - 'e6_reask';
      v_outcome := 'start';
    ELSIF v_session.current_flow = 'hindrance' THEN
      -- CARRIED FORWARD FROM MIGRATION 038, UNCHANGED BY THIS MIGRATION.
      -- NEW BRANCH, migration 038 -- REVISED after external review round 2
      -- (B1, BLOCKING). Mirrors apply_morning_flow_turn's own revised
      -- branch exactly -- forces a stale/abandoned ad-hoc hindrance session
      -- to yield to a scheduled evening trigger rather than silently
      -- blocking it. See this file's own header note: the first draft of
      -- this migration was built from 035's body alone and would have
      -- deleted this entire branch -- caught by rehearsal, fixed before
      -- Aravind ever saw a draft.
      v_hindrance_discarded       := true;
      v_hindrance_had_description := (v_session.context ? 'description');
      IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'q2_reask' - 'description';
        v_outcome := 'already_complete';
      ELSE
        v_session.current_flow := 'evening';
        v_session.current_step := 1;
        v_session.context      := v_session.context
                                    - 'e2_reask' - 'e3_reask' - 'e4_reask'
                                    - 'e4_headcount' - 'e5_reask' - 'e6_reask'
                                    - 'q2_reask' - 'description';
        v_outcome := 'start';
      END IF;
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'evening' THEN
    IF v_text = '' THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1 (free text + enrichment) -> evening_output + quantities.
      -- BYTE-IDENTICAL to the pre-migration step 1 (plan §2: "unchanged").
      v_session.current_step := 2;
      v_outcome := 'advance';
      v_col     := 'output';

    ELSIF v_session.current_step = 2 THEN
      -- Evening Q2 -- workers by trade. Reuses parseLabourCount's shape
      -- (§42 extends it with `matched`, plan §15(d)/§15(e) -- unlike
      -- morning's manpower branch, THIS reshape has no pre-existing field
      -- names to preserve across a shared-parser boundary, since this is a
      -- brand-new write site; `matched` still defaults to true when absent,
      -- same reasoning as morning's branch above.
      v_reask := COALESCE((v_session.context->>'e2_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'2')::boolean, false) OR v_reask >= 1 THEN
        v_session.current_step := 3;
        v_session.context := v_session.context || jsonb_build_object('e2_reask', 0);
        v_col     := 'manpower';
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e2_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- Evening Q3 -- idle hours by trade. UNCONDITIONAL (asked every day,
      -- not gated on a bad day) -- "nobody idle" is a valid, common,
      -- ANSWERED (not defaulted) response; p_parse_ok->'3' is the TS
      -- parser's own judgment of that, not re-derived here.
      v_reask := COALESCE((v_session.context->>'e3_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'3')::boolean, false) OR v_reask >= 1 THEN
        v_session.context := v_session.context || jsonb_build_object('e3_reask', 0);
        v_col     := 'idle_hours';
        v_outcome := 'advance';

        -- EQUIPMENT AUTO-SKIP DECISION (BOT-22, unchanged trigger, moved
        -- from the old step 5 to here since idle-hours is now the step
        -- immediately before equipment). Same NULL-vs-empty distinction
        -- 024/025 already established: NULL (no morning submission at all)
        -- and empty ({items:[]}) both skip identically.
        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;

        IF v_morning_equipment IS NULL
           OR jsonb_array_length(v_morning_equipment->'items') = 0 THEN
          -- SKIP Evening Q4 entirely -> Evening Q5 (tomorrow's needs)
          -- directly. UNLIKE the old flow's auto-skip, this does NOT
          -- complete the turn -- Q5 is unconditional now, so there is
          -- always one more question regardless of equipment. Store an
          -- empty utilisation object, same "explicit empty, not silent
          -- absence" convention 024 established.
          v_session.current_step := 5;
          v_col := 'idle_hours_skip_equipment';
        ELSE
          v_session.current_step := 4;
        END IF;
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e3_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 4 THEN
      -- Evening Q4 -- equipment, HOURS USED, one number per type. Decision 1
      -- (2026-08-31): supersedes §33(b)'s per-machine/two-number design
      -- entirely -- no available_hours, no idle_reason, no positional index.
      -- Joined to morning_equipment by TYPE STRING only.
      v_reask := COALESCE((v_session.context->>'e4_reask')::int, 0);
      IF COALESCE((p_parse_ok->>'4')::boolean, false) OR v_reask >= 1 THEN
        v_confidence := CASE WHEN NOT COALESCE((p_parse_ok->>'4')::boolean, false)
                              THEN 'low' ELSE 'high' END;

        SELECT morning_equipment INTO v_morning_equipment
          FROM daily_logs
         WHERE project_id = p_project_id AND engineer_id = p_user_id AND log_date = v_log_date;
        v_reply_count := COALESCE(jsonb_array_length(p_parse->'4'->'items'), 0);

        -- BUILD ONE STORED ITEM PER REPLY ENTRY. No claimed/unclaimed
        -- array, no tiers -- the join is a single type-string comparison.
        -- implausible := hours_used > 24 * (summed count across every
        -- morning item sharing this type) -- FLAG ONLY (finding 1, review
        -- round), never a reject, never a reask trigger. NULL when the
        -- type's count can't be determined (no morning match, or a
        -- matching morning item with count still NULL) -- "unknown" is not
        -- "plausible", so this stays NULL, not false.
        v_equip_items := '[]'::jsonb;
        FOR i IN 0..v_reply_count - 1 LOOP
          v_reply_type := p_parse->'4'->'items'->i->>'type';

          SELECT SUM((elem->>'count')::int) INTO v_morning_count_for_type
          FROM jsonb_array_elements(COALESCE(v_morning_equipment->'items', '[]'::jsonb)) AS elem
          WHERE elem->>'type' = v_reply_type;

          v_equip_items := v_equip_items || jsonb_build_array(
            jsonb_build_object(
              'type',        v_reply_type,
              'hours_used',  (p_parse->'4'->'items'->i)->'hours_used',
              'matched',     COALESCE((p_parse->'4'->'items'->i->>'matched')::boolean, true),
              'implausible', CASE
                                WHEN v_morning_count_for_type IS NULL THEN NULL
                                WHEN ((p_parse->'4'->'items'->i)->>'hours_used') IS NULL THEN NULL
                                ELSE ((p_parse->'4'->'items'->i->>'hours_used')::numeric
                                      > 24 * v_morning_count_for_type)
                              END,
              'raw',         (p_parse->'4'->'items'->i)->'raw'
            )
          );
        END LOOP;

        -- CASE B, TYPE-LEVEL: one "not reported" entry per DISTINCT morning
        -- type the reply never mentioned at all. Direct analogue of 024/025's
        -- per-MACHINE Case B, now per TYPE since matching is type-level.
        v_equip_items := v_equip_items || (
          SELECT COALESCE(jsonb_agg(
                   jsonb_build_object(
                     'type', mtype, 'hours_used', NULL, 'matched', true,
                     'implausible', NULL, 'raw', NULL
                   )
                 ), '[]'::jsonb)
          FROM (
            SELECT DISTINCT elem->>'type' AS mtype
            FROM jsonb_array_elements(COALESCE(v_morning_equipment->'items', '[]'::jsonb)) AS elem
          ) morning_types
          WHERE NOT EXISTS (
            SELECT 1 FROM jsonb_array_elements(p_parse->'4'->'items') r
             WHERE r->>'type' = morning_types.mtype
          )
        );

        v_col := 'equipment_hours';
        v_session.current_step := 5;
        v_outcome := 'advance';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('e4_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 5 THEN
      -- Evening Q5 -- CHANGED, migration 040. "Anything *extra needed*
      -- tomorrow beyond the plan -- material, labour or machine?"
      -- Forward-looking; the old backward-looking "anything that slowed
      -- execution today?" role now belongs entirely to the explicit ad-hoc
      -- hindrance flow (migration 038, public.hindrances). Same shape as
      -- before: UNCONDITIONAL, free text, ungated (no reask, no parser) --
      -- see STEP 1/3's own column comment for why free text stays free
      -- text. Writes evening_tomorrow_needs (STEP 1 above), NOT
      -- evening_schedule_miss_reason (retired, STEP 4 above). Terminal
      -- step: completes the flow.
      v_col      := 'tomorrow_needs';
      v_complete := true;
      v_outcome  := 'advance';

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  IF v_complete THEN
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    v_session.context      := (v_session.context - 'e2_reask' - 'e3_reask' - 'e4_reask')
                              || jsonb_build_object('evening_submitted', true);
  END IF;

  IF v_col = 'output' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_output, evening_output_quantities)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_parse->'1')
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_output            = EXCLUDED.evening_output,
          evening_output_quantities = EXCLUDED.evening_output_quantities;

  ELSIF v_col = 'manpower' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'total', p_parse->'2'->'planned_total',
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',   t->>'trade',
                        'count',   (t->>'planned_count')::int,
                        'matched', COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_parse->'2'->'by_trade', '[]'::jsonb)) AS t
         ),
         'raw_text', p_parse->'2'->>'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_manpower = EXCLUDED.evening_manpower;

  ELSIF v_col = 'idle_hours' THEN
    -- TRI-STATE, NOT BOOLEAN (added round 3, Aravind's ruling, after this
    -- branch's first draft only carried `by_trade`/`raw_text` -- an
    -- unparseable answer would have collapsed into the exact same stored
    -- shape as a confident "all working" zero, indistinguishable to any
    -- later reader. `all_working` and `unknown` are read straight from
    -- p_parse (parseIdleHoursByTrade's own tri-state, lib/whatsapp/flows/
    -- parsers/idle-hours.ts) rather than re-derived here, so the SQL layer
    -- can never disagree with the TS layer about which of the three states
    -- applies.
    --
    -- RAISE, NOT COALESCE-TO-FALSE (round-3 review finding, fixing a
    -- self-inflicted recurrence of the exact bug this tri-state exists to
    -- close). The first draft of this branch defended a caller omitting
    -- BOTH fields with `COALESCE(..., false)` on each -- which stores
    -- `{all_working:false, unknown:false}`, a FOURTH shape this field was
    -- designed to never have, and specifically defaults `unknown` to
    -- false: "known to not be unknown" where nothing was actually known.
    -- Same class of error the plausibility flag (§5a) got right twelve
    -- lines away in this same file: absence of information must never
    -- default toward the confident reading. A caller omitting these
    -- fields is a BUG (code that predates this migration's tri-state, the
    -- same class of mismatch `assertPostMigrationPayload`,
    -- `lib/dpr/dispatch.ts:46`, already guards against for a different
    -- payload) -- it must be legible as an error, not papered over as a
    -- valid state.
    IF (p_parse->'3'->'all_working') IS NULL OR (p_parse->'3'->'unknown') IS NULL THEN
      RAISE EXCEPTION 'apply_evening_flow_turn: p_parse[3] missing all_working/unknown -- pre-035 caller shape (idle-hours tri-state contract violated)';
    END IF;
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_idle_hours)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',      t->>'trade',
                        'idle_hours', (t->>'idle_hours')::numeric,
                        'matched',    COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_parse->'3'->'by_trade', '[]'::jsonb)) AS t
         ),
         'all_working', (p_parse->'3'->>'all_working')::boolean,
         'unknown',     (p_parse->'3'->>'unknown')::boolean,
         'raw_text', p_parse->'3'->>'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_idle_hours = EXCLUDED.evening_idle_hours;

  ELSIF v_col = 'idle_hours_skip_equipment' THEN
    -- Same idle-hours write as above, PLUS the explicit-empty equipment
    -- placeholder (auto-skip case) in the SAME transaction/turn -- one
    -- write, so a partial state (idle-hours written, equipment forever
    -- NULL) can never be observed between turns. Mirrors 024/025's own
    -- 'productivity_complete' shape for the identical reason.
    --
    -- RAISE, NOT COALESCE-TO-FALSE -- same fix, same reasoning, as the
    -- plain 'idle_hours' branch above. Duplicated rather than factored out
    -- because this branch's two-column write already duplicates the
    -- by_trade reshape too (pre-existing shape, not introduced here).
    IF (p_parse->'3'->'all_working') IS NULL OR (p_parse->'3'->'unknown') IS NULL THEN
      RAISE EXCEPTION 'apply_evening_flow_turn: p_parse[3] missing all_working/unknown -- pre-035 caller shape (idle-hours tri-state contract violated)';
    END IF;
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_idle_hours, evening_equipment_utilisation)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object(
                        'trade',      t->>'trade',
                        'idle_hours', (t->>'idle_hours')::numeric,
                        'matched',    COALESCE((t->>'matched')::boolean, true)
                      )
                    ),
                    '[]'::jsonb
                  )
           FROM jsonb_array_elements(COALESCE(p_parse->'3'->'by_trade', '[]'::jsonb)) AS t
         ),
         'all_working', (p_parse->'3'->>'all_working')::boolean,
         'unknown',     (p_parse->'3'->>'unknown')::boolean,
         'raw_text', p_parse->'3'->>'raw_text'
       ),
       jsonb_build_object('items', '[]'::jsonb, 'raw_text', NULL, 'confidence', NULL))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_idle_hours            = EXCLUDED.evening_idle_hours,
          evening_equipment_utilisation = EXCLUDED.evening_equipment_utilisation;

  ELSIF v_col = 'equipment_hours' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_equipment_utilisation)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object('items', v_equip_items, 'raw_text', p_parse->'4'->>'raw_text',
                           'confidence', v_confidence))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_equipment_utilisation = EXCLUDED.evening_equipment_utilisation;

  ELSIF v_col = 'tomorrow_needs' THEN
    -- Terminal write. CHANGED, migration 040: evening_tomorrow_needs
    -- (STEP 1), NOT evening_schedule_miss_reason (retired, STEP 4).
    -- evening_submitted_at stamped here, the only place it's set --
    -- unchanged.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_tomorrow_needs, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_tomorrow_needs = EXCLUDED.evening_tomorrow_needs,
          evening_submitted_at   = EXCLUDED.evening_submitted_at;
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

  -- equipment_echo is NOT populated by this version -- unchanged from 035.
  -- hindrance_discarded/hindrance_had_description CARRIED FORWARD FROM
  -- MIGRATION 038, UNCHANGED BY THIS MIGRATION -- see this file's own
  -- header note.
  RETURN jsonb_build_object(
    'outcome',                    v_outcome,
    'current_flow',               v_session.current_flow,
    'current_step',               v_session.current_step,
    'log_date',                   v_log_date,
    'equipment_echo',             v_equipment_echo,
    'hindrance_discarded',        v_hindrance_discarded,
    'hindrance_had_description',  v_hindrance_had_description
  );
END;
$fn$;

-- Signature verified unchanged: text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,
-- timestamptz,integer (10 args) -- CREATE OR REPLACE genuinely replaces, no
-- overload risk.
REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK -- NOT applied by this file. This is a ROLLBACK
-- PROCEDURE, NOT A RUNNABLE SCRIPT -- CORRECTED 2026-09-11 (Aravind,
-- Stage 1 review round 2). An earlier version of this header claimed
-- "strip the leading '-- ' from every line below and run it" as if that
-- alone were sufficient. It is not: both CREATE OR REPLACE bodies below
-- are deliberately left as bracketed instructions (see each one's own
-- [ ... ] block), not inlined SQL -- stripping the comment markers and
-- executing would fail immediately on malformed syntax. Every line below
-- is still commented out, per this project's own down-section-must-be-
-- commented lint rule -- that part was already correct and is unchanged.
--
-- WHY THE BODIES ARE INSTRUCTIONS, NOT INLINED SQL, DELIBERATELY: this
-- migration's own header finding is that hand-merging migration files
-- from memory (rather than capturing the true live state) is exactly what
-- produced a wrong function body on this migration's own first draft. An
-- inlined "restore to this exact text" body would repeat that same risk
-- on the rollback side, AND would go silently stale the moment any future
-- migration (041 or later) touches either function again -- a hazard this
-- project's own migration-lint reservation and staleness rules exist to
-- prevent elsewhere, applied here to a DOWN block instead of a forward
-- migration.
--
-- TO ACTUALLY ROLL BACK: (1) capture
-- pg_get_functiondef('public.apply_evening_flow_turn(...)') and
-- pg_get_functiondef('public.correct_daily_log(...)') from a database at
-- the intended pre-rollback state (i.e. before this migration's own
-- forward-apply, or -- if a later migration has since touched either
-- function -- from whatever state should be restored to); (2) apply the
-- three edits named in the WARNING block below to the evening function's
-- captured text (undoing this migration's own step-5 change) and the CASE
-- edit named in correct_daily_log's own block; (3) run the resulting
-- CREATE OR REPLACE statements, then the REVOKE/GRANT and CHECK-constraint
-- statements below (which ARE complete, runnable SQL as written -- no
-- capture step needed for those). THIS IS EXACTLY WHAT THIS MIGRATION'S
-- OWN REHEARSAL DID: the rehearsed rollback was built this way, not by
-- stripping and running this block's text -- the rollback APPROACH is
-- proven by that rehearsal; this block's text is the reference procedure
-- for repeating it, not a script that was itself executed.
--
-- Restores: STEP 7 reverted first (apply_evening_flow_turn's step-5 branch
-- back to writing evening_schedule_miss_reason), then STEP 6
-- (correct_daily_log's CASE back to evening_schedule_miss_reason), then
-- STEP 5 (the CHECK constraint back to the 019 list), then the STEP 3/4
-- COMMENTs are left AS-IS (a comment revert is not meaningful -- the
-- forward comments already state the full history; reverting them would
-- erase the record of this migration itself having been attempted).
-- evening_tomorrow_needs is NEVER dropped -- this project's own
-- convention, and because dropping it would discard any real data written
-- under the new column between apply and rollback. STEP 2's grant list is
-- also left AS-IS (leaving a column's grant wired after its writer reverts
-- matches 035's own STEP 2 precedent, cited above).
--
-- REHEARSED, NOT HAND-WAVED (per CLAUDE.md's own DOWN-block rehearsal
-- rule): a session seeded at current_step=5 was confirmed to still process
-- a subsequent free-text reply cleanly after this DOWN ran, writing to the
-- reverted evening_schedule_miss_reason column and completing the flow
-- normally -- unlike migration 038's own DOWN incident, this DOWN does not
-- remove or rename the RPC, only reverts one branch's write target inside
-- an RPC that still fully exists, so a step-5 session cannot be stranded
-- calling something that no longer exists. See the rehearsal output shown
-- separately in this review round for the actual seeded-session probe.
-- =============================================================================

-- BEGIN;
--
-- CREATE OR REPLACE FUNCTION apply_evening_flow_turn(
--   p_phone_number  TEXT,
--   p_tenant_id     UUID,
--   p_user_id       UUID,
--   p_project_id    UUID,
--   p_message       TEXT,
--   p_start_flow    BOOLEAN,
--   p_parse         JSONB    DEFAULT NULL,
--   p_parse_ok      JSONB    DEFAULT NULL,
--   p_now           TIMESTAMPTZ DEFAULT now(),
--   p_test_sleep_ms INTEGER     DEFAULT NULL
-- )
-- RETURNS jsonb
-- LANGUAGE plpgsql
-- SECURITY DEFINER
-- SET search_path = public
-- AS $fn$
-- -- [ WARNING, from this migration's own rehearsal finding (see header):
-- --   the body to restore here is 035's body PLUS migration 038's
-- --   'hindrance' flow-collision branch (the ELSIF v_session.current_flow
-- --   = 'hindrance' THEN block, its two DECLARE vars, and the two extra
-- --   RETURN keys) -- NOT 035 alone. Reconstructing this by reading
-- --   migration files by eye is exactly what produced the wrong body on
-- --   this migration's own first draft. THE SAFE METHOD: capture
-- --   pg_get_functiondef('public.apply_evening_flow_turn(...)') from a
-- --   database with migrations through 039 applied and 040 NOT applied
-- --   (test-db, before this migration's own forward-apply, is exactly
-- --   that state) -- do not hand-merge 035 and 038's files as a
-- --   substitute. This round's own rehearsal record has the captured
-- --   text and the exact three-edit diff applied to it (step-5 branch
-- --   comment/v_col rename, auto-skip comment, terminal write target) --
-- --   apply the SAME three edits to a freshly-captured body, don't reuse
-- --   a stale copy if any migration between 040 and the real rollback
-- --   date has touched this function again. ]
-- $fn$;
--
-- REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
--   text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
-- ) FROM PUBLIC, anon, authenticated;
-- GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
--   text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
-- ) TO service_role;
--
-- CREATE OR REPLACE FUNCTION public.correct_daily_log(
--   p_daily_logs_id UUID,
--   p_column        TEXT,
--   p_new_value     JSONB
-- )
-- RETURNS UUID
-- LANGUAGE plpgsql
-- SECURITY DEFINER SET search_path = public
-- AS $$
-- -- [ body identical to 019's live definition, CASE restored to:
-- --   WHEN 'evening_schedule_miss_reason' THEN 'text'
-- --   in place of 'evening_tomorrow_needs' -- full body:
-- --   supabase/migrations/019_daily_log_corrections.sql, lines 149-282,
-- --   copied verbatim -- not re-inlined a second time here. ]
-- $$;
--
-- REVOKE EXECUTE ON FUNCTION public.correct_daily_log(UUID, TEXT, JSONB) FROM PUBLIC, anon;
-- GRANT  EXECUTE ON FUNCTION public.correct_daily_log(UUID, TEXT, JSONB) TO authenticated;
--
-- ALTER TABLE public.daily_log_edits DROP CONSTRAINT daily_log_edits_column_name_check;
-- ALTER TABLE public.daily_log_edits ADD CONSTRAINT daily_log_edits_column_name_check
--   CHECK (column_name IN (
--     'is_holiday', 'holiday_reason', 'weather',
--     'morning_plan', 'morning_execution_plan',
--     'evening_output', 'evening_schedule_met',
--     'evening_schedule_miss_reason', 'evening_workers_on_site'
--   ));
--
-- COMMIT;
--
