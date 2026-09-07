-- =============================================================================
-- Migration 038 -- apply_hindrance_flow_turn + scheduled-trigger-wins fix
-- Ad-hoc menu PR 2, step 4 (docs/plans/adhoc-menu-spec.md).
--
-- STATUS: WRITTEN, NOT YET APPLIED, NOT YET EXTERNALLY REVIEWED. Lives in
-- docs/reviews/ per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied" rule -- this one is not
-- being applied by this commit.
--
-- WHY THIS TRIPS THE EXTERNAL REVIEW GATE (CLAUDE.md §0, condition (a)):
-- this migration CREATES OR REPLACES apply_morning_flow_turn and
-- apply_evening_flow_turn -- two live, already-externally-reviewed,
-- already-applied production functions -- adding a new branch to each.
-- That is a logic change to a live function, full stop; it does not matter
-- that the new branch is small. Unlike migration 036 (a column + CHECK,
-- no function logic touched) or step 3's resolveEngineerProject (pure
-- TypeScript, no SQL at all), this one needs the full review package
-- before it can be applied to any real database, including test-db.
--
-- WHAT THIS DOES, three parts:
--   1. apply_hindrance_flow_turn -- brand new RPC, same locked-turn
--      architecture as morning/evening (SELECT-then-lock via the
--      whatsapp_sessions upsert, quoco_same_ist_day reset run FIRST as its
--      own step -- confirmed this migration's own design pass that this is
--      NOT inherited for free from morning/evening's copies of the same
--      check; a brand-new RPC needs its own).
--   2. apply_morning_flow_turn -- CREATE OR REPLACE, SIGNATURE UNCHANGED
--      (12 args, byte-identical to 035's live one). The ONLY change: one
--      new ELSIF branch inside the p_start_flow decision, handling a stale
--      'hindrance' session. Every other line reproduced verbatim from
--      035's live body, confirmed by direct read of that file at authoring
--      time, not from memory.
--   3. apply_evening_flow_turn -- same treatment, SIGNATURE UNCHANGED
--      (10 args, byte-identical to 035's live one).
--
-- THE COLLISION THIS FIXES, traced against the real code before this file
-- was written (docs/plans/adhoc-menu-spec.md's own "Idle-inbound reply,
-- decided" section carries the full trace): an engineer abandons a
-- hindrance report after Q1, leaving the session at current_flow=
-- 'hindrance'. The evening (or morning) trigger cron's own startFlow:true
-- call, run against that same-day session, previously fell into the
-- generic non-null-flow ELSE branch and returned 'reask' -- the check-in
-- message still went out (send happens before the RPC call in trigger.ts),
-- but the session never transitioned, and the engineer's real check-in
-- answer was swallowed by the still-active hindrance flow instead. That is
-- a check-in genuinely lost, not merely delayed.
--
-- THE FIX, DECIDED (Aravind, 2026-09-07): scheduled triggers always win.
-- A stale 'hindrance' session is force-resettable by morning/evening's own
-- startFlow:true call -- unlike a genuine morning/evening collision, which
-- keeps its existing careful 'reask' handling untouched. Reasoning: the
-- daily check-in loop is the product; a two-question ad-hoc report is
-- secondary, and losing one is recoverable at zero cost (send "1" again).
-- The force-reset produces the SAME 'start' outcome and state a genuine
-- fresh flow start would -- no special-casing needed anywhere else, and
-- the engineer's next reply is read as a real check-in answer because the
-- session is now indistinguishable from one.
--
-- THE ABANDONED Q1 TEXT: DISCARDED, NOT WRITTEN, DELIBERATELY -- THE §42
-- BOUNDARY. context.description (if Q1 was answered) is wiped along with
-- everything else on a forced reset -- no hindrances row is ever written
-- for it. This was argued explicitly, not assumed: the pairing CHECK
-- (hindrances_timing_raw_pairing_check, migration 036) requires
-- timing_raw to be non-NULL whenever timing='unspecified'. An abandoned
-- Q2 has no such text -- the engineer never answered it at all, so there
-- is nothing to put in timing_raw without fabricating it. §42's own
-- principle ("capture what was said, don't drop it") does not apply here
-- in the direction that would argue for writing the row -- there is
-- nothing he said for Q2 to capture. Writing 'unspecified' would blur two
-- different facts (asked-and-unparseable vs. never-answered-at-all) that
-- the schema's own three-way split (036's own COMMENT ON COLUMN) exists to
-- keep distinct. A REJECTED ALTERNATIVE, named so it is not silently
-- reconsidered later: a resume prompt on the engineer's next inbound
-- message, offering to continue the abandoned report before anything
-- else runs. Rejected because it ambushes an engineer expecting his
-- ordinary 08:30 morning check-in with an unrelated, half-finished
-- question from the newest, least-tested flow in the product -- exactly
-- backwards from "the daily loop is the product."
--
-- WHAT THE ENGINEER IS TOLD: nothing, on either side of this fix. The
-- morning/evening trigger's own prompt goes out completely UNCHANGED --
-- no mention of a discarded hindrance. DECIDED, not merely simpler:
-- at the moment this collision can occur, the engineer was active with an
-- inbound message hours earlier, almost certainly still inside the 24-hour
-- WhatsApp session window (bot-flows.md's own free-form-is-primary rule),
-- so this send goes out free-form. A discard-aware variant would work in
-- that case but silently fall back to a template needing fresh Meta
-- approval the moment the window happened to be closed -- an
-- inconsistency with no clean fix. Leaving the prompt untouched avoids it
-- entirely, and keeps the one message that must stay simple simple.
--
-- WHAT THE ENGINEER RECEIVES ON RESOLVED / EXHAUSTED HINDRANCE TURNS
-- (Aravind, 2026-09-06/07, no "your PM will see it" until step 5 makes it
-- true -- there is no PM notification mechanism until then):
--   resolved:   "✅ Hindrance recorded."
--   exhausted:  "✅ Hindrance recorded. I couldn't tell if it's blocking
--                now or later, but your report is saved."
-- Both strings live in lib/whatsapp/flows/hindrance.ts, not in this file --
-- this migration only writes the row; the TypeScript layer owns the reply
-- text, same split as every other flow.
-- =============================================================================

BEGIN;

-- =============================================================================
-- STEP 1 -- apply_hindrance_flow_turn, brand new. SECURITY DEFINER,
-- explicit per-role REVOKE below (CLAUDE.md §0's "every new function
-- requires an explicit per-role revoke" rule -- Supabase's own default ACL
-- grants EXECUTE to anon/authenticated/service_role individually on every
-- new public-schema function, REVOKE FROM PUBLIC alone does not touch it).
-- =============================================================================
CREATE OR REPLACE FUNCTION apply_hindrance_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,
  p_project_id    UUID,
  p_message       TEXT,
  p_start_flow    BOOLEAN,
  p_timing        TEXT     DEFAULT NULL,  -- 'active'|'potential', TS-classified (classifyHindranceTiming)
  p_timing_ok     BOOLEAN  DEFAULT NULL,  -- whether Q2's answer classified cleanly this turn
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL
)
RETURNS jsonb  -- { outcome, current_flow, current_step }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session     whatsapp_sessions;
  v_text        TEXT;
  v_outcome     TEXT;
  v_col         TEXT    := NULL;
  v_reask       INTEGER;
  v_complete    BOOLEAN := false;
  v_description TEXT    := NULL;
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

  -- BOT-07 next-day reset -- NOT inherited from morning/evening's own
  -- copies of this check (confirmed explicitly during this migration's own
  -- design pass: an inbound message reaching a stale 'hindrance' session
  -- directly, via routeInboundMessage's currentFlow!==null short-circuit,
  -- never touches apply_morning_flow_turn or apply_evening_flow_turn at
  -- all -- this RPC needs its own copy, or a cross-day-stale hindrance
  -- session would swallow even a brand-new "1" the next day).
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
      v_session.context      := v_session.context - 'q2_reask' - 'description';
      v_outcome := 'start';
    ELSE
      -- An ad-hoc flow start is ALWAYS inbound-triggered (the router's own
      -- leading-"1" precedence), never cron-triggered -- there is no
      -- scheduled-trigger-wins case to handle on THIS side of the
      -- collision. Any already-active flow (morning, evening, or a second
      -- hindrance attempt) re-asks its own current question, unchanged.
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    v_outcome := 'idle';

  ELSIF v_session.current_flow = 'hindrance' THEN
    IF v_text = '' THEN
      -- Empty answer: reask unlimited, no write, no budget consumed --
      -- same convention as every other flow's empty-answer handling.
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1, free text, always accepted -- no classification, no reask,
      -- matches the spec's own "buildable without media, text-only"
      -- confirmation for item 1.
      v_session.current_step := 2;
      v_session.context      := v_session.context || jsonb_build_object('description', v_text);
      v_outcome := 'advance';

    ELSIF v_session.current_step = 2 THEN
      v_description := v_session.context->>'description';
      v_reask := COALESCE((v_session.context->>'q2_reask')::int, 0);
      IF COALESCE(p_timing_ok, false) THEN
        -- Resolved cleanly -- first attempt or after one reask, p_timing_ok
        -- (TS-computed) is all this branch needs to know.
        v_col      := 'hindrance_resolved';
        v_complete := true;
      ELSIF v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q2_reask', v_reask + 1);
        v_outcome := 'reask';
      ELSE
        -- EXHAUSTED (reask budget 1, same cap as every other classified
        -- question in this codebase). timing_raw = THIS turn's literal
        -- text -- the resolving turn's own answer, matching attendance_raw's
        -- established precedent (030_morning_flow_attendance.sql:
        -- "v_attendance_raw := v_text ... on the resolving turn, either
        -- way"), never the first, already-superseded attempt.
        v_col      := 'hindrance_unspecified';
        v_complete := true;
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- Should be unreachable in production -- current_flow can only be
    -- 'hindrance' or NULL by the time this RPC is called, since routing
    -- only ever delegates here for a 'hindrance' session. Kept explicit
    -- rather than omitted so this function is total over every SessionFlow
    -- value, matching morning/evening's own "wrong_flow" completeness
    -- discipline -- if this ever fires, dispatchInboundTurn's own retry
    -- logic (matching the morning/evening wrong_flow contract) is the
    -- right place to handle it, not a silent fallthrough here.
    v_outcome := 'wrong_flow';
  END IF;

  IF v_complete THEN
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    v_session.context      := v_session.context - 'q2_reask' - 'description';
    v_outcome := 'advance';
  END IF;

  IF v_col = 'hindrance_resolved' THEN
    INSERT INTO hindrances
      (tenant_id, project_id, reported_by, description, timing, timing_raw, submitted_via)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_description, p_timing, NULL, 'whatsapp_adhoc');

  ELSIF v_col = 'hindrance_unspecified' THEN
    INSERT INTO hindrances
      (tenant_id, project_id, reported_by, description, timing, timing_raw, submitted_via)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_description, 'unspecified', v_text, 'whatsapp_adhoc');
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
    'current_step', v_session.current_step
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.apply_hindrance_flow_turn(
  text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_hindrance_flow_turn(
  text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
) TO service_role;

-- =============================================================================
-- STEP 2 -- apply_morning_flow_turn (CREATE OR REPLACE -- never DROP+CREATE).
-- Signature BYTE-IDENTICAL to 035's live one (12 args). ONLY CHANGE: one new
-- ELSIF branch inside the p_start_flow decision (marked below). Every other
-- line reproduced verbatim from 035_evening_flow_restructuring.sql's live
-- body, confirmed by direct read of that file at authoring time.
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
    ELSIF v_session.current_flow = 'hindrance' THEN
      -- NEW BRANCH, migration 038. Scheduled triggers always win over a
      -- stale ad-hoc flow (Aravind, 2026-09-07) -- see 038's own file
      -- header for the full collision trace and reasoning. Force-reset and
      -- start cleanly: SAME 'start' outcome/state a genuine fresh start
      -- produces, so buildMorningReply needs no special-casing and his
      -- next reply is read as a real morning answer. context (including
      -- any Q1 description) is discarded, not written anywhere -- see the
      -- header's §42-boundary note for why this is deliberate, not a gap.
      v_session.current_flow := 'morning';
      v_session.current_step := 1;
      v_session.context      := '{}'::jsonb;
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

REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;

-- =============================================================================
-- STEP 3 -- apply_evening_flow_turn (CREATE OR REPLACE -- never DROP+CREATE).
-- Signature BYTE-IDENTICAL to 035's live one (10 args). ONLY CHANGE: one new
-- ELSIF branch inside the p_start_flow decision (marked below), mirroring
-- STEP 2's morning change exactly. Every other line reproduced verbatim from
-- 035_evening_flow_restructuring.sql's live body.
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
    ELSIF v_session.current_flow = 'hindrance' THEN
      -- NEW BRANCH, migration 038. Mirrors apply_morning_flow_turn's own
      -- new branch exactly -- see 038's own file header for the full
      -- collision trace and reasoning.
      v_session.current_flow := 'evening';
      v_session.current_step := 1;
      v_session.context      := '{}'::jsonb;
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

REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK -- exact inverse, not applied by this file. Written per
-- CLAUDE.md's own migration-runbook-template discipline.
--
-- apply_hindrance_flow_turn: DROP FUNCTION (brand new, nothing to restore).
-- apply_morning_flow_turn / apply_evening_flow_turn: CREATE OR REPLACE with
-- 035's exact live body (no 'hindrance' ELSIF branch) -- byte-identical to
-- the "STEP 2"/"STEP 3" bodies above MINUS the branch marked "NEW BRANCH,
-- migration 038" in each. Not spelled out a second time here to avoid a
-- THIRD copy of ~150 lines each drifting from the other two; the applier
-- reconstructs it by deleting exactly that one ELSIF block from each
-- function and re-running CREATE OR REPLACE -- confirmed as a real,
-- mechanical DOWN path, not hand-waved, but not restated verbatim.
--
-- CONSEQUENCE OF ROLLING BACK: any 'hindrance' session active at rollback
-- time reverts to being swallowed by the pre-038 'reask'/'wrong_flow'
-- collision behavior this migration exists to fix -- same as before this
-- file ever existed. No data loss on rollback itself (apply_hindrance_
-- flow_turn's own writes to `hindrances` are untouched by dropping the
-- function; only future calls stop working).
--
-- DROP FUNCTION IF EXISTS apply_hindrance_flow_turn(
--   text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz, integer
-- );
-- =============================================================================
