-- docs/reviews/050-down-testdb.sql  -- DOWN artifact for migration 050, TEST-DB (exfccwlrhoutkgrlikod).
-- Plan docs/plans/pr-b-050-plan.md rev 6, section 9. NOT RUN on test-db by this block (only on a disposable
-- local scaffold). The restore text below is the LIVE pg_get_functiondef of test-db captured 18 Oct 2026,
-- verbatim: apply_morning_flow_turn md5 707c10fe09dfd5a7cd065f7826eacd46, apply_evening_flow_turn md5
-- d19d07507abccdaf7d54ee1d74419af7 (equal to probe 1). Prod gets its OWN artifact, docs/reviews/050-down-prod.sql,
-- built from the prod-captured bodies; never apply this file to prod, never the other way round.
--
-- Precondition: PR-C is rolled back and that rollback is LIVE (rollback order C, then B, then A).
-- Never run at 08:25-08:40 or 18:25-18:40 IST: while the DOWN waits for and holds EXCLUSIVE, new turns queue.
-- Named consequence (N2): a pending ack "1" arriving after the DOWN reaches idle and starts a hindrance report.

BEGIN;

SET LOCAL lock_timeout = '3s';
-- EXCLUSIVE, not SHARE ROW EXCLUSIVE: the latter does not conflict with the ROW SHARE lock of a turn's
-- SELECT ... FOR UPDATE and DEADLOCKS (review r2, proven on a stub); EXCLUSIVE waits for in-flight turns.
LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;

-- 1. Clear every 'invoice' session, SUBTRACT-ONLY: flow NULL, step 0, flow-owned keys and the N13 flag removed.
--    Never context := '{}' (that would drop morning_submitted / evening_submitted).
UPDATE public.whatsapp_sessions
   SET current_flow = NULL,
       current_step = 0,
       context      = COALESCE(context, '{}'::jsonb) - ARRAY['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask', 'invoice_reset_guard']
 WHERE current_flow = 'invoice';

-- 2. Strip the N13 flag and the flow-owned keys from EVERY row that still carries any of them.
UPDATE public.whatsapp_sessions
   SET context = context - ARRAY['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask', 'invoice_reset_guard']
 WHERE context ?| ARRAY['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask', 'invoice_reset_guard'];

-- 3. Restore both bodies from the captured text, verbatim.
CREATE OR REPLACE FUNCTION public.apply_morning_flow_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_manpower jsonb DEFAULT NULL::jsonb, p_manpower_ok boolean DEFAULT NULL::boolean, p_equipment jsonb DEFAULT NULL::jsonb, p_equipment_ok boolean DEFAULT NULL::boolean, p_now timestamp with time zone DEFAULT now(), p_test_sleep_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- S-set (a), discard observability (external review round 2): set only
  -- by the hindrance-collision branch below, NEVER elsewhere -- NULL (not
  -- false) on every other outcome, so the caller can tell "this branch
  -- didn't fire" from "it fired and found nothing to discard."
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
      v_session.current_flow := 'morning';
      v_session.current_step := 1;
      v_session.context      := v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask';
      v_outcome := 'start';
    ELSIF v_session.current_flow = 'hindrance' THEN
      -- NEW BRANCH, migration 038 -- REVISED after external review round 2
      -- (B1, BLOCKING): the original force-reset used a bare context wipe
      -- (context := '{}'::jsonb), which silently destroyed
      -- morning_submitted whenever an engineer completed morning, then
      -- started (and abandoned) a hindrance report the same day. A
      -- scheduled trigger firing into that live hindrance session would
      -- restart morning for an ALREADY-SUBMITTED engineer, and his next
      -- reply would overwrite the day's real attendance via the very same
      -- ON CONFLICT upsert that recorded it in the first place --
      -- reproduced exactly by Scenario 5 (docs/reviews/038-hindrance-flow-
      -- review-package.md), RED against the original branch, GREEN here.
      --
      -- TWO-CLAUSE FIX: check the flow's own submitted marker BEFORE
      -- choosing an outcome.
      --   Already submitted -> the scheduled trigger's job here is
      --   already done; morning is not "stale," it's complete. Clear the
      --   hindrance session (subtract-only -- q2_reask/description are
      --   hindrance's own leftover state, nothing left to do with them;
      --   morning_submitted and any other cross-flow marker survive by
      --   NOT being named, not because this branch specifically saved
      --   them) and return 'already_complete' -- the SAME outcome the
      --   idle branch already uses for this exact fact. Never re-run a
      --   completed flow.
      --   Genuinely unsubmitted -> scheduled triggers still win over a
      --   live ad-hoc flow, no age check, unchanged reasoning (see THE
      --   FIX in this file's own header for why "stale" overclaimed this).
      --   The wipe is now
      --   SUBTRACT-ONLY -- morning's own reask keys (matching the genuine
      --   fresh-start branch three lines above, same discipline) plus
      --   hindrance's own leftover keys -- never a bare replace, so any
      --   cross-flow marker survives by construction, not convention.
      v_hindrance_discarded       := true;
      v_hindrance_had_description := (v_session.context ? 'description');
      IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := v_session.context - 'q2_reask' - 'description';
        v_outcome := 'already_complete';
      ELSE
        v_session.current_flow := 'morning';
        v_session.current_step := 1;
        v_session.context      := v_session.context
                                    - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask'
                                    - 'q2_reask' - 'description';
        v_outcome := 'start';
      END IF;
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
    'outcome',                    v_outcome,
    'current_flow',               v_session.current_flow,
    'current_step',               v_session.current_step,
    'log_date',                   v_log_date,
    'attendance',                 v_attendance,
    'hindrance_discarded',        v_hindrance_discarded,
    'hindrance_had_description',  v_hindrance_had_description
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.apply_evening_flow_turn(p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_parse jsonb DEFAULT NULL::jsonb, p_parse_ok jsonb DEFAULT NULL::jsonb, p_now timestamp with time zone DEFAULT now(), p_test_sleep_ms integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

-- 4. Drop the seven new functions.
DROP FUNCTION public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamptz, integer);
DROP FUNCTION public.expire_stale_material_inward(text, timestamptz);
DROP FUNCTION public.pm_set_delivery_details(uuid, text, text, text, date);
DROP FUNCTION public.pm_approve_delivery(uuid);
DROP FUNCTION public.pm_reject_delivery(uuid, text);
DROP FUNCTION public.pm_link_invoice(uuid, uuid[]);
DROP FUNCTION public.pm_unlink_invoice(uuid);

-- 4b. [SQL review r1, per Aravind 18 Oct] S-2: remove the 050 ledger row in the SAME transaction (049's DOWN does the same for its
--     own row); otherwise migration list would show 050 applied with none of its objects.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '050';

-- 5. Post-condition assertion: the 050 ledger row is gone, the restored bodies equal the captured md5s, no session carries an 'invoice'
--    flow, the flag or a flow-owned key, the seven functions are gone, and the two restored functions keep the
--    live ACL (service_role only). Aborts the whole DOWN on any surprise.
DO $$
DECLARE
  v_bad text := '';
  v_m   text;
  v_e   text;
BEGIN
  SELECT md5(pg_get_functiondef('public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)'::regprocedure)) INTO v_m;
  SELECT md5(pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure)) INTO v_e;
  IF v_m <> '707c10fe09dfd5a7cd065f7826eacd46' THEN v_bad := v_bad || ' morning_md5=' || v_m; END IF;
  IF v_e <> 'd19d07507abccdaf7d54ee1d74419af7' THEN v_bad := v_bad || ' evening_md5=' || v_e; END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '050') THEN v_bad := v_bad || ' ledger_row_left'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_sessions WHERE current_flow = 'invoice') THEN v_bad := v_bad || ' invoice_rows'; END IF;
  IF EXISTS (SELECT 1 FROM public.whatsapp_sessions WHERE context ?| ARRAY['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask', 'invoice_reset_guard']) THEN v_bad := v_bad || ' keys_left'; END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
              AND p.proname IN ('apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details',
                                'pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice')) THEN
    v_bad := v_bad || ' functions_left';
  END IF;
  IF has_function_privilege('anon', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)', 'EXECUTE') THEN
    v_bad := v_bad || ' acl';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'DOWN_ASSERT_050:%', v_bad;
  END IF;
END;
$$;

COMMIT;
