-- supabase/migrations/018_morning_flow_parsers.sql
-- Morning check-in flow, Pass 2: extends apply_morning_flow_turn (migration 014)
-- from the two free-text questions (Q1/Q4) to the full four-step morning core by
-- adding the two PARSED questions:
--   Q2 "Workers planned by trade" -> daily_logs.morning_manpower_planned (step 2)
--   Q3 "Equipment on site + rate" -> daily_logs.morning_equipment        (step 3)
-- Step order becomes 1 -> 2 -> 3 -> 4 (was 1 -> 4). Q5/Q6 remain Pass 3.
--
-- NOT A SCHEMA CHANGE. No table/column DDL: morning_manpower_planned and
-- morning_equipment already exist (nullable JSONB, migration 001 / 016-era). The
-- only change is CREATE OR REPLACE of the function. types/database.ts regen after
-- apply changes only this function's Args block (no relational diff).
--
-- WHERE PARSING LIVES (read before editing). The Tamil/English-tolerant parsing
-- is done in TypeScript (lib/whatsapp/flows/parsers/{labour,equipment}.ts), which
-- is PURE and easy to unit-test. The webhook parses the inbound UNCONDITIONALLY
-- (both shapes, cheap) BEFORE calling this RPC and passes the results as
-- p_manpower / p_equipment (the parsed JSONB, raw text embedded) plus p_manpower_ok
-- / p_equipment_ok (whether the answer was acceptable). This function then SELECTS
-- the one matching the active step under its lock and stores it verbatim. That
-- keeps parsing testable in TS while THIS function stays the single authoritative
-- decision+write, exactly as in Pass 1.
--
-- Q3 STORAGE SHAPE (Pass 3 / evening-flow authors READ THIS). morning_equipment
-- is stored as an OBJECT { items:[...], none:boolean, raw_text:string } -- NOT the
-- bare array the spec illustrates -- so the raw answer survives even a "no
-- equipment" turn (none:true, items:[]). Anything that reads it (evening Q5's
-- BOT-22 morning-equipment echo, DPR, dashboard) MUST read `.items`, and treat
-- "empty equipment list" as `jsonb_array_length(morning_equipment->'items') = 0`,
-- not the top-level value. morning_manpower_planned is likewise an object
-- { planned_total, by_trade:[...], raw_text }. No reader exists yet (verified
-- 2026-07-15); this note is the contract for when one is built.
--
-- REASK BUDGET (Q2/Q3 only). Each parsed step allows ONE reask on an unparseable
-- answer (Q2: no number; Q3: garbled). After that one reask the raw parse is
-- STORED and the flow advances, so a field engineer is never trapped. The per-step
-- counters (q2_reask / q3_reask) live in whatsapp_sessions.context and are now
-- MERGED, not replaced -- this is the context replace->merge switch the 014 header
-- anticipated (Pass 2/3 accumulate in-flight state across steps). Empty/whitespace
-- answers still reask unlimited (Pass 1) and never consume the budget. The BOT-07
-- next-day reset (context := '{}') wipes the counters along with everything else.
--
-- LOCKING SEMANTICS UNCHANGED. Same single INSERT..ON CONFLICT upsert-lock, same
-- BOT-07 reset, same always-write session refresh as 014. The ONLY behavioural
-- change beyond the new steps is context merge vs replace on the parsed steps.
--
-- Mirrored (non-authoritative) in lib/whatsapp/flows/morning.ts (dispatchMorning
-- Flow + decideParsedStep). Applied to prod via the dashboard SQL Editor (CLI
-- blocked by IPv6-only host, see docs/schema.md 013 note); branch-verified first,
-- artifact-provenance-pinned per CLAUDE.md §0 (018 is post-017 -> pinning applies).
-- Feature-class, trivially reversible: no external-reviewer gate.

-- The Pass-2 signature adds four args; drop the Pass-1 signature explicitly so we
-- replace rather than create an overload (which would make .rpc() ambiguous).
DROP FUNCTION IF EXISTS apply_morning_flow_turn(
  TEXT, UUID, UUID, UUID, TEXT, BOOLEAN, TIMESTAMPTZ, INTEGER
);

CREATE OR REPLACE FUNCTION apply_morning_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,        -- engineer; also used as daily_logs.engineer_id
  p_project_id    UUID,        -- engineer's single active project (project_members)
  p_message       TEXT,        -- raw inbound; trimmed inside; ''/NULL tolerated
  p_start_flow    BOOLEAN,     -- TRUE only from the env-gated test trigger
  p_manpower      JSONB    DEFAULT NULL,  -- Q2 parse (labour); stored verbatim when step 2 advances
  p_manpower_ok   BOOLEAN  DEFAULT NULL,  -- Q2 parse acceptable? (a number was found)
  p_equipment     JSONB    DEFAULT NULL,  -- Q3 parse (equipment); stored verbatim when step 3 advances
  p_equipment_ok  BOOLEAN  DEFAULT NULL,  -- Q3 parse acceptable? (explicit none, or >=1 item)
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL  -- TEST-ONLY: pause after lock to force an interleave. NULL/no-op in prod.
)
RETURNS jsonb   -- { outcome, current_flow, current_step, log_date }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session  whatsapp_sessions;
  v_text     TEXT;
  v_log_date DATE;
  v_outcome  TEXT;
  v_col      TEXT := NULL;      -- which daily_logs column this turn writes (NULL = no write)
  v_reask    INTEGER;           -- current per-step reask counter (parsed steps)
BEGIN
  -- log_date in IST, same Asia/Kolkata discipline as quoco_same_ist_day.
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  -- (1) ATOMIC ACQUIRE. Insert-or-lock the row for this phone in one step.
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  -- (Test only) Hold the lock across an injected pause (concurrency test).
  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  -- (2) BOT-07 next-day reset. A previous-IST-day session (mid-flow OR completed)
  -- is wiped to idle: context := '{}' also drops any q2_reask/q3_reask counters.
  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  -- (3) DECIDE (mirrored in dispatchMorningFlow / decideParsedStep). -----------
  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
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
      -- Empty answer: reask unlimited, no write, no budget consumed.
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1 (free text) -> morning_plan, advance to Q2.
      v_session.current_step := 2;
      v_outcome := 'advance';
      v_col     := 'plan';

    ELSIF v_session.current_step = 2 THEN
      -- Q2 (parsed labour). Accept on a number; else reask once then accept raw.
      v_reask := COALESCE((v_session.context->>'q2_reask')::int, 0);
      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
        v_session.current_step := 3;
        v_session.context := v_session.context || jsonb_build_object('q2_reask', 0);
        v_outcome := 'advance';
        v_col     := 'manpower';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q2_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (2)
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- Q3 (parsed equipment). Accept on none/known item; else reask once.
      v_reask := COALESCE((v_session.context->>'q3_reask')::int, 0);
      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
        v_session.current_step := 4;
        v_session.context := v_session.context || jsonb_build_object('q3_reask', 0);
        v_outcome := 'advance';
        v_col     := 'equipment';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q3_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (3)
      END IF;

    ELSIF v_session.current_step = 4 THEN
      -- Q4 (free text) -> execution plan + submitted_at, COMPLETE. Full context
      -- replace here is intentional: completion drops all in-flight counters.
      v_session.current_flow := NULL;
      v_session.current_step := 0;
      v_session.context      := jsonb_build_object('morning_submitted', true);
      v_outcome := 'advance';
      v_col     := 'execution';

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- Non-morning flow active (evening/etc. -- not built here).
    v_outcome := 'idle';
  END IF;

  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Only when a column
  -- was resolved above. UNIQUE(project_id, engineer_id, log_date) backs the upsert.
  IF v_col = 'plan' THEN
    -- Q1: first answer of the day materialises the row.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_plan)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_plan = EXCLUDED.morning_plan;

  ELSIF v_col = 'manpower' THEN
    -- Q2: store the labour parse verbatim (raw text embedded inside p_manpower).
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_manpower_planned)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_manpower)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_manpower_planned = EXCLUDED.morning_manpower_planned;

  ELSIF v_col = 'equipment' THEN
    -- Q3: store the equipment parse verbatim (none -> {items:[],none:true,...}).
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_equipment)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_equipment = EXCLUDED.morning_equipment;

  ELSIF v_col = 'execution' THEN
    -- Q4: update the same row + stamp submission.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_execution_plan, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_execution_plan = EXCLUDED.morning_execution_plan,
          morning_submitted_at   = EXCLUDED.morning_submitted_at;
  END IF;

  -- (4b) SESSION WRITE -- ALWAYS. Refreshes TTL + updated_at and persists the
  -- (possibly merged) context, including reask counters on a reask turn.
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
    'log_date',     v_log_date
  );
END;
$fn$;
