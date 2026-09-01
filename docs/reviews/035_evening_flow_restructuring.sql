-- =============================================================================
-- 035_evening_flow_restructuring.sql
-- WRITTEN, NOT YET APPLIED, NOT YET REHEARSED AGAINST test-db. Per CLAUDE.md's
-- "a migration file enters supabase/migrations/ when it is being applied, not
-- when it is written" rule, this file lives in docs/reviews/ until an apply is
-- actually happening -- do not copy it into supabase/migrations/ yet.
--
-- AMENDED AFTER REVIEWER APPROVAL (round 3, 2026-09-01) -- stated explicitly
-- so the approved version is never mistaken for the current one. The
-- reviewer approved this file with no findings against the SQL itself; the
-- SAME session then surfaced a real requirement the approved version did not
-- handle (an unparseable idle-hours answer would have been stored
-- indistinguishably from a confident "all working" zero). The `idle_hours`
-- and `idle_hours_skip_equipment` branches below now also write
-- `all_working`/`unknown` -- see each branch's own comment for why. The
-- byte-identical-signature proof (both RPCs' parameter lists) is UNAFFECTED
-- -- only two branches' internal JSONB construction changed, not either
-- function's signature. Re-review of this specific delta is owed before
-- this file is treated as re-approved wholesale.
--
-- Full design record: docs/plans/evening-flow-restructuring-scope.md (18
-- sections plus a reviewer SCOPE-APPROVED round folding in 8 findings). This
-- header summarises; it is not a substitute for that plan.
--
-- MIGRATION NUMBER: 035, re-verified against origin/main at authoring time
-- (2026-08-31), not assumed. The plan's own first draft said "034" and went
-- stale the same day -- 034 was taken by an unrelated owner-email migration,
-- proposed, reviewed, rehearsed, and applied to prod later in the same
-- session (docs/reviews/034-apply-record.md). Confirmed by reading
-- `origin/main`'s supabase/migrations/ + docs/reviews/ directly before this
-- number was chosen.
--
-- SCOPE, IN ONE LINE EACH:
--   1. apply_evening_flow_turn -- FULL REWRITE. 5 linear questions (down from
--      6, with the old flow's only branch -- "plan met?" -- deleted), one
--      remaining conditional edge (the pre-existing equipment auto-skip).
--   2. apply_morning_flow_turn -- ONE BRANCH EDITED (v_col = 'manpower'),
--      everything else byte-identical. Adds a `matched` field per §42.
--   3. Two new columns: evening_manpower, evening_idle_hours (JSONB).
--   4. evening_schedule_miss_reason REUSED for the new unconditional Q5
--      (hindrance) -- dated column comment records the name predates this.
--   5. evening_equipment_utilisation RESHAPED -- the entire per-machine
--      matching apparatus (morning_item_index, MATCH TIERS 1-3, the numbered
--      echo) is retired. Evening Q4 now asks ONE number per type ("hours
--      used"), joined to morning_equipment by TYPE STRING only.
--   6. A ONE-TIME session sweep, run as part of THIS migration's own apply
--      (not a new permanent function) -- closes any session mid-flow in
--      EITHER flow before the step renumbering makes its current_step mean
--      something else. Required for evening specifically (finding 3, review
--      round): 033's cutoff sweep only ever covered morning; evening has no
--      analog, and BOT-07's lazy next-IST-day wipe is not a deploy-time
--      guarantee.
--   7. Grants: both RPC signatures re-asserted BYTE-IDENTICAL (verified
--      below, not assumed -- the 030 first-draft overload incident is
--      exactly the failure this checks for). The daily_logs column-bound
--      UPDATE grant to `authenticated` (migration 017/030's list) is
--      re-declared with the two new columns added, nothing removed.
--
-- WHAT THIS FILE DOES NOT DO, NAMED SO IT ISN'T ASSUMED: no TypeScript
-- changes (parseLabourCount, a new idle-hours-by-trade parser, and a
-- redesigned equipment-hours parser all need companion changes -- this
-- migration's `p_parse` shapes below are written assuming those parsers
-- exist and produce the shapes documented at each step; they are NOT part of
-- this file). No PM-facing dashboard change for the two new columns beyond
-- the raw UPDATE grant (§16/§43's lexicon-teaching UI is explicitly out of
-- scope, per that section's own instruction). No `daily_hire_cost`/
-- `computeIdleCost` change beyond what §33(a) already decided (unwritten,
-- kept). Golden-set eval cases and the DPR consumer surface (assemble.ts,
-- schema.ts, narrative-context.ts -- plan §7) are NOT touched here; they
-- read the columns this migration reshapes and need their own pass.
--
-- P_PARSE SHAPES THIS FILE ASSUMES (TS-side prerequisite, not built here):
--   Evening step 2 (workers by trade) -- p_parse->'2':
--     {planned_total: int|null, by_trade: [{trade, planned_count, matched}],
--      raw_text}. SAME field names as morning's p_manpower (parseLabourCount
--      is the shared parser, per 030's own "rename stops at the write
--      boundary" precedent) -- matched: boolean added per §42, true when
--      canonicalTrade resolved the token, false when the raw token is
--      preserved unmatched (finding 5: as-heard, pre-normalisation, or the
--      normalisation applied must be named -- not solved by this SQL file,
--      which only reshapes whatever TS provides).
--     p_parse_ok->'2': whether a number was found (same gate as today).
--   Evening step 3 (idle hours by trade) -- p_parse->'3':
--     {by_trade: [{trade, idle_hours, matched}], all_working: boolean,
--      unknown: boolean, raw_text}. TRI-STATE, ADDED ROUND 3 (Aravind's
--     ruling, after this branch's first draft carried only by_trade/
--     raw_text): an unparseable answer must record UNKNOWN, never a
--     fabricated zero -- `all_working` is the CONFIDENT-zero state (an
--     explicit "all working"/"no idle" signal was recognised, by_trade
--     empty), `unknown` is the genuinely-unparseable state (nothing
--     recognisable at all, by_trade empty, all_working false). The two are
--     mutually exclusive by construction in parseIdleHoursByTrade
--     (lib/whatsapp/flows/parsers/idle-hours.ts) -- this SQL reads them
--     straight through rather than re-deriving either, so the two layers
--     can never disagree about which state applies.
--     p_parse_ok->'3': answered (a number found, OR all_working=true --
--     this question is now UNCONDITIONAL, so "nobody idle" must be a real,
--     common, valid answer, not treated as unanswered). unknown=true is the
--     ONLY state that gates a reask.
--   Evening step 4 (equipment, hours used) -- p_parse->'4':
--     {items: [{type, hours_used, matched, raw}], raw_text}. `type` is
--     canonicalEquipment's output when matched=true, the raw token when
--     matched=false (same convention morning's own equipment parser
--     already uses for an unrecognised keyword -- §15's own "already
--     survives via firstNameWord fallback" note). This parser does NOT see
--     morning_equipment (unchanged architectural principle,
--     equipment-hours.ts's own header) -- the RPC below does the type join
--     under its own lock, same reasoning as every MATCH TIERS predecessor.
--     p_parse_ok->'4': at least one item parsed.
--
-- PLAUSIBILITY FLAG (finding 1, review round): implausible := hours_used >
-- 24 * count-for-that-type-from-morning_equipment (only computed when that
-- count is known -- NULL count leaves implausible NULL, not false, since
-- "known to be plausible" and "nothing to check against" are different
-- claims). RULED: a FLAG, never a GATE -- captured, marked, rendered; NEVER
-- rejected, NEVER a reask trigger. Same shape as attendance_defaulted
-- (030:163,353,448,525,551-556): evidence captured at write, judgment
-- rendered to the reader, never enforced by the system.
--
-- KEY NAMES CHOSEN AT WRITE TIME, FLAGGED AS IMPLEMENTATION CHOICES, NOT
-- RE-LITIGATED DESIGN DECISIONS (the plan left exact JSONB key names
-- undecided on purpose -- "schema design out of scope for this record"):
--   evening_manpower:   {total, by_trade:[{trade,count,matched}], raw_text}
--   evening_idle_hours: {by_trade:[{trade,idle_hours,matched}],
--     all_working, unknown, raw_text} -- all_working/unknown added round 3
--   evening_equipment_utilisation:
--     {items:[{type,hours_used,matched,implausible,raw,confidence}],
--      raw_text, confidence}
--   Reask keys: e2_reask (workers by trade), e3_reask (idle hours by
--   trade), e4_reask (equipment). Steps 1 and 5 stay ungated, matching the
--   old flow's step 1 (output, ungated) and step 3 (miss reason, ungated)
--   precedent. e4_headcount (the old two-part Q4 handoff) is GONE --
--   collapsed into one single-step question, no cross-step context value
--   needed any more.
--
-- CARVE-OUT TO §30, GROUNDED (review round, finding 4): this migration
-- edits BOTH RPCs because §42 is a DEFECT-SYMMETRIC fix (the same
-- silently-dropped-token bug, in the same shared by-trade pattern, present
-- in both flows independently of anything else here) -- not a parallel
-- improvement spotted in one flow while working on the other, which §30(a)
-- still correctly keeps separate. Grounded in CLAUDE.md's own "grep for the
-- pattern before closing a structural fix" standing rule, not analogy.
--
-- REHEARSED: NOT YET. Disposable local-Postgres scaffold run recorded
-- separately (see the companion report); a real test-db rehearsal has not
-- happened. NOT YET APPLIED anywhere.
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 1 -- new columns. Both nullable JSONB, no historical data to backfill
-- (genuinely new, confirmed zero grep hits across supabase/migrations/*.sql,
-- types/database.ts, lib/, app/ at plan time -- plan §3).
-- =============================================================================
ALTER TABLE daily_logs
  ADD COLUMN evening_manpower JSONB,
  ADD COLUMN evening_idle_hours JSONB;

COMMENT ON COLUMN daily_logs.evening_manpower IS
  'Evening Q2 (workers by trade), migration 035. {total, by_trade:[{trade,count,matched}], raw_text}. matched=false entries are unmatched trade tokens captured per §42, not dropped.';
COMMENT ON COLUMN daily_logs.evening_idle_hours IS
  'Evening Q3 (idle hours by trade), migration 035, new. {by_trade:[{trade,idle_hours,matched}], raw_text}.';
COMMENT ON COLUMN daily_logs.evening_schedule_miss_reason IS
  'REUSED, migration 035, dated 2026-08-31: this column now stores the answer to the unconditional Evening Q5 ("anything that slowed execution today?"), NOT the old conditional "why wasn''t the plan met" follow-up its name describes. Reused deliberately rather than renamed, so migration 019''s existing CHECK/CASE correction entry for this column stays live and correct instead of becoming a third dead-but-wired whitelist entry (plan §4, review round finding 7).';

-- =============================================================================
-- STEP 2 -- re-declare the daily_logs column-bound UPDATE grant (migration
-- 017 step 4, re-declared again by 030 step 3) with the two new columns
-- added. Idempotent/declarative (015's RERUN SEMANTICS note) -- safe to
-- re-issue in full. Nothing removed from the prior list -- CLAUDE.md's
-- "do not drop anything" convention, and this project's own precedent of
-- leaving a now-unread column's grant wired (§28(p)) rather than pruning it.
-- =============================================================================
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies,
  evening_manpower, evening_idle_hours
) ON public.daily_logs TO authenticated;

-- =============================================================================
-- STEP 3 -- ONE-TIME session sweep, run as part of THIS apply (not a new
-- permanent function -- finding 3, review round). Closes any session
-- currently mid-flow in EITHER flow before the step renumbering below makes
-- its current_step mean something else. No daily_logs write attempted on
-- these sessions' behalf -- unlike migration 033's cron sweep (which
-- preserves whatever a well-understood, unchanging step meant), a session
-- caught mid-migration is sitting on a step number whose MEANING is what's
-- changing; there is no safe way to "complete" it on the engineer's behalf.
-- Simplest correct behaviour, matching 033's own step-1 precedent (attendance
-- unanswered -> no write, session just closes): reset to idle, strip every
-- known reask key (old AND new naming, both flows, since a key from either
-- regime could be sitting in context depending on exactly when this runs),
-- write nothing else. The engineer's next real inbound message starts a
-- fresh turn under the new code, same as any other idle session.
--
-- CHECKED LIVE, READ-ONLY, immediately before this file was written
-- (2026-08-31): zero sessions with current_flow IS NOT NULL, in either flow,
-- on prod. This statement is expected to affect zero rows when actually
-- applied -- it exists for correctness and for whatever time elapses between
-- this check and the real apply, not because a stuck session is known to
-- exist right now.
-- =============================================================================
UPDATE whatsapp_sessions
   SET current_flow = NULL,
       current_step = 0,
       context      = context
                       - 'q1_reask' - 'q2_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask'
                       - 'e2_reask' - 'e4_reask' - 'e4_headcount' - 'e5_reask' - 'e6_reask'
                       - 'e3_reask',
       updated_at   = now()
 WHERE current_flow IN ('morning', 'evening');

-- =============================================================================
-- STEP 4 -- apply_morning_flow_turn (CREATE OR REPLACE -- never DROP+CREATE).
-- Signature BYTE-IDENTICAL to 030's live one (12 args) -- ONLY the
-- `v_col = 'manpower'` branch's jsonb_build_object changes, adding `matched`.
-- Every other line is unchanged from 030's own live body, confirmed by
-- direct comparison against that file at authoring time, not from memory.
-- =============================================================================
CREATE OR REPLACE FUNCTION apply_morning_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_manpower      JSONB    DEFAULT NULL,
  p_manpower_ok   BOOLEAN  DEFAULT NULL,
  p_equipment     JSONB    DEFAULT NULL,
  p_equipment_ok  BOOLEAN  DEFAULT NULL,
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session    whatsapp_sessions;
  v_text       TEXT;
  v_log_date   DATE;
  v_outcome    TEXT;
  v_col        TEXT := NULL;
  v_reask      INTEGER;
  v_attendance TEXT := NULL;
  v_yesno      JSONB;
  v_attendance_defaulted BOOLEAN := NULL;
  v_attendance_raw        TEXT    := NULL;
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
      v_session.current_flow := 'morning';
      v_session.current_step := 1;
      v_session.context      := v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask';
      v_outcome := 'start';
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'morning' THEN
    IF v_text = '' THEN
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      v_yesno := quoco_classify_yes_no(p_message);
      v_reask := COALESCE((v_session.context->>'q1_reask')::int, 0);
      IF NOT COALESCE((v_yesno->>'ok')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q1_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSIF COALESCE((v_yesno->>'ok')::boolean, false) AND NOT (v_yesno->>'met')::boolean THEN
        v_session.current_step := 5;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_outcome := 'advance';
      ELSE
        v_session.current_step := 2;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_attendance := 'present';
        v_col        := 'attendance';
        v_attendance_defaulted := NOT COALESCE((v_yesno->>'ok')::boolean, false);
        v_attendance_raw       := v_text;
        v_outcome    := 'advance';
      END IF;

    ELSIF v_session.current_step = 2 THEN
      v_session.current_step := 3;
      v_outcome := 'advance';
      v_col     := 'plan';

    ELSIF v_session.current_step = 3 THEN
      v_reask := COALESCE((v_session.context->>'q3_reask')::int, 0);
      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
        v_session.current_step := 4;
        v_session.context := v_session.context || jsonb_build_object('q3_reask', 0);
        v_outcome := 'advance';
        v_col     := 'manpower';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q3_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 4 THEN
      v_reask := COALESCE((v_session.context->>'q4_reask')::int, 0);
      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_outcome := 'advance';
        v_col     := 'equipment';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q4_reask', v_reask + 1);
        v_outcome := 'reask';
      END IF;

    ELSIF v_session.current_step = 5 THEN
      v_yesno := quoco_classify_yes_no(p_message);
      v_reask := COALESCE((v_session.context->>'q5_reask')::int, 0);
      IF NOT COALESCE((v_yesno->>'ok')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q5_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        IF COALESCE((v_yesno->>'ok')::boolean, false) AND (v_yesno->>'met')::boolean THEN
          v_attendance := 'site_holiday';
        ELSE
          v_attendance := 'absent';
        END IF;
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_col     := 'attendance_complete';
        v_attendance_defaulted := NOT COALESCE((v_yesno->>'ok')::boolean, false);
        v_attendance_raw       := v_text;
        v_outcome := 'advance';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    v_outcome := 'wrong_flow';
  END IF;

  IF v_col = 'attendance' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, v_attendance_defaulted, v_attendance_raw)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
          attendance_defaulted = EXCLUDED.attendance_defaulted,
          attendance_raw       = EXCLUDED.attendance_raw;

  ELSIF v_col = 'attendance_complete' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw, is_holiday, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, v_attendance_defaulted, v_attendance_raw, (v_attendance = 'site_holiday'), p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
          attendance_defaulted = EXCLUDED.attendance_defaulted,
          attendance_raw       = EXCLUDED.attendance_raw,
          is_holiday           = EXCLUDED.is_holiday,
          morning_submitted_at = EXCLUDED.morning_submitted_at;

  ELSIF v_col = 'plan' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_plan)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_plan = EXCLUDED.morning_plan;

  ELSIF v_col = 'manpower' THEN
    -- ONLY CHANGED BRANCH IN THIS FUNCTION. §42: the by_trade reshape now
    -- also carries `matched` through from whatever the TS parser supplied
    -- (COALESCE to true when absent, so a p_manpower payload from a caller
    -- not yet updated to emit `matched` -- e.g. mid-deploy -- degrades to
    -- "assume matched" rather than crash on a missing key; TRUE, not FALSE,
    -- because every element this RPC has ever received up to this migration
    -- WAS a matched trade -- the old parser never pushed unmatched ones at
    -- all, so the honest default for pre-migration-shaped input is "yes,
    -- this was matched", not "unknown, assume worst").
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'total', p_manpower->'planned_total',
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
           FROM jsonb_array_elements(COALESCE(p_manpower->'by_trade', '[]'::jsonb)) AS t
         ),
         'raw_text', p_manpower->'raw_text'
       ))
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_manpower = EXCLUDED.morning_manpower;

  ELSIF v_col = 'equipment' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_equipment, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_equipment    = EXCLUDED.morning_equipment,
          morning_submitted_at = EXCLUDED.morning_submitted_at;
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
    'outcome',      v_outcome,
    'current_flow', v_session.current_flow,
    'current_step', v_session.current_step,
    'log_date',     v_log_date,
    'attendance',   v_attendance
  );
END;
$fn$;

-- Signature verified byte-identical to 030's live one before this statement
-- was written: text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer
-- (12 args) -- CREATE OR REPLACE genuinely replaces, no overload risk.
REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;

-- =============================================================================
-- STEP 5 -- apply_evening_flow_turn (CREATE OR REPLACE -- never DROP+CREATE).
-- Signature BYTE-IDENTICAL to 025's live one (10 args) -- FULL BODY REWRITE.
-- p_parse/p_parse_ok stay generic JSONB keyed by step id, exactly as before,
-- which is why this rewrite needs no signature change at all (plan §1: this
-- RPC was already shaped correctly for a question-set change).
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
          -- SKIP Evening Q4 entirely -> Evening Q5 (hindrance) directly.
          -- UNLIKE the old flow's auto-skip, this does NOT complete the
          -- turn -- hindrance is unconditional now, so there is always one
          -- more question regardless of equipment. Store an empty
          -- utilisation object, same "explicit empty, not silent absence"
          -- convention 024 established.
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
      -- Evening Q5 -- hindrance, UNCONDITIONAL, free text, ungated (same
      -- shape as the old flow's step-3 miss-reason: no reask, no parser).
      -- REUSES evening_schedule_miss_reason -- see the column comment
      -- added in STEP 1 above. Terminal step: completes the flow.
      v_col      := 'hindrance';
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
    -- applies. COALESCE(...,false) is defensive only -- this is a brand-new
    -- column with no live caller to be backward-compatible with, unlike
    -- manpower's matched COALESCE above.
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
         'all_working', COALESCE((p_parse->'3'->>'all_working')::boolean, false),
         'unknown',     COALESCE((p_parse->'3'->>'unknown')::boolean, false),
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
         -- TRI-STATE -- same addition, same reasoning, as the plain
         -- 'idle_hours' branch above. Duplicated rather than factored out
         -- because this branch's two-column write already duplicates the
         -- by_trade reshape too (pre-existing shape, not introduced here).
         'all_working', COALESCE((p_parse->'3'->>'all_working')::boolean, false),
         'unknown',     COALESCE((p_parse->'3'->>'unknown')::boolean, false),
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

  ELSIF v_col = 'hindrance' THEN
    -- Terminal write. evening_schedule_miss_reason REUSED (STEP 1 column
    -- comment); evening_submitted_at stamped here, the only place it's set.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date,
       evening_schedule_miss_reason, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_schedule_miss_reason = EXCLUDED.evening_schedule_miss_reason,
          evening_submitted_at         = EXCLUDED.evening_submitted_at;
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

  -- equipment_echo is NOT populated by this version -- Evening Q4's prompt
  -- is no longer built from a numbered per-machine echo (there is nothing
  -- to number any more), so the caller's own prompt-building code for step
  -- 4 needs its own, separate, non-SQL change (out of scope here, same as
  -- every other TS-side prerequisite named in this file's header). Kept in
  -- the RETURN shape, always NULL, so existing callers destructuring this
  -- key do not get a missing-key error mid-deploy.
  RETURN jsonb_build_object(
    'outcome',        v_outcome,
    'current_flow',   v_session.current_flow,
    'current_step',   v_session.current_step,
    'log_date',       v_log_date,
    'equipment_echo', v_equipment_echo
  );
END;
$fn$;

-- Signature verified byte-identical to 025's live one before this statement
-- was written: text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer
-- (10 args) -- CREATE OR REPLACE genuinely replaces, no overload risk.
REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK -- see the companion file docs/reviews/035-rollback.sql.
-- Written AND executed against the disposable scaffold before this migration
-- is considered done (CLAUDE.md's own dry-run discipline) -- results
-- reported separately from this file.
-- =============================================================================
