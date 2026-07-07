-- supabase/migrations/014_morning_flow_apply_turn.sql
-- Morning check-in flow, Pass 1 (SKELETON): the SINGLE transactional RPC that
-- applies one inbound turn of the morning flow. Proves the shape on the two
-- free-text questions only:
--   Q1 "Plan of action today"      -> daily_logs.morning_plan
--   Q4 "Execution method/sequence" -> daily_logs.morning_execution_plan
-- Q2/Q3 (structured parsing) and Q5/Q6 (multi-item + responsibility follow-up)
-- are Pass 2 / Pass 3 and will EXTEND this same function + step order later.
--
-- WHY THIS FUNCTION EXISTS / TRANSACTION DISCIPLINE (read before editing):
-- The Supabase JS client cannot hold one transaction open across multiple
-- PostgREST calls -- each .rpc()/.from() commits independently. So the decision
-- (which column to write, whether to advance/complete) AND both writes (session
-- + daily_logs) MUST happen inside ONE locked transaction, or the row is
-- unlocked between read and write and a second concurrent inbound can interleave
-- (the exact race migration 012 was built to remove).
--
-- This function therefore takes the row lock FIRST (same INSERT ... ON CONFLICT
-- (phone_number) DO UPDATE upsert-lock as acquire_and_transition_session) and
-- its OWN body computes the Q1/Q4 decision and performs the writes -- it does
-- NOT read state out to TypeScript and write back in a second call. On the
-- Pass-1 morning inbound path this function REPLACES acquire_and_transition_
-- session (which stays in the tree for the later multi-flow/cron dispatcher).
--
-- lib/whatsapp/flows/morning.ts has a PURE TypeScript mirror (dispatchMorning
-- Flow) of this decision logic for unit testing/documentation. That mirror is
-- NOT authoritative: production behaviour is entirely determined by THIS SQL
-- body. A passing dispatchMorningFlow unit test is not on its own proof of
-- production correctness -- the branch integration tests against this RPC are.
--
-- CONTEXT REPLACEMENT vs MERGE (Pass 2/3 note): Pass 1 fully REPLACES context
-- (no meaningful in-flight state accumulates across Q1/Q4). Pass 2/3's multi-
-- item Q5/Q6 capture will hold partial state in context across steps and MUST
-- switch the per-step context writes to a merge (context || jsonb_build_object)
-- so mid-flow accumulation is not clobbered. Completion may stay a full replace.
--
-- Applied to prod via the dashboard SQL Editor (CLI blocked by IPv6-only host,
-- see docs/schema.md migration 013 note); branch-verified first.

CREATE OR REPLACE FUNCTION apply_morning_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,        -- engineer; also used as daily_logs.engineer_id
  p_project_id    UUID,        -- engineer's single active project (project_members)
  p_message       TEXT,        -- raw inbound; trimmed inside; ''/NULL tolerated
  p_start_flow    BOOLEAN,     -- TRUE only from the env-gated test trigger
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
  v_write    BOOLEAN := false;   -- whether a daily_logs write is applied this turn
  v_complete BOOLEAN := false;   -- whether Q4 completed the flow this turn
BEGIN
  -- log_date is computed in IST here (never a naive server-local date), the same
  -- Asia/Kolkata discipline as quoco_same_ist_day. No p_log_date parameter.
  v_log_date := (p_now AT TIME ZONE 'Asia/Kolkata')::date;

  -- (1) ATOMIC ACQUIRE. Insert-or-lock the row for this phone in one step; the
  -- DO UPDATE is a no-op whose sole purpose is to lock the existing row and
  -- return its current values (same pattern as acquire_and_transition_session).
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number
  RETURNING * INTO v_session;

  -- (Test only) Hold the lock across an injected pause so a second concurrent
  -- inbound is forced to block on the acquire until we commit (concurrency test).
  IF p_test_sleep_ms IS NOT NULL THEN
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  -- (2) BOT-07 next-day reset -- IMPLEMENTED INDEPENDENTLY here, because this
  -- function replaces acquire_and_transition_session on the morning path and
  -- must not silently lose 012's next-day behaviour. A previous-IST-day session
  -- (mid-flow OR completed) is wiped to idle, so context.morning_submitted can
  -- never leak across IST days. Runs BEFORE any decision. Note the reset sets
  -- current_flow := NULL (idle), NOT a requested flow: the Pass-1 inbound path
  -- is advance-only; a fresh flow starts only via p_start_flow, evaluated below.
  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  -- Trim + collapse the inbound to a single string (parsing tolerance for the
  -- free-text Q1/Q4). Empty/whitespace-only counts as no answer.
  v_text := btrim(COALESCE(p_message, ''));

  -- (3) DECIDE (mirrored in dispatchMorningFlow). ------------------------------
  IF p_start_flow THEN
    -- Env-gated test trigger. Start a fresh morning flow only when idle; if a
    -- morning flow is already active, do not restart it -- re-ask its question.
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'morning';
      v_session.current_step := 1;
      v_session.context      := '{}'::jsonb;
      v_outcome := 'start';
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    -- No active flow. Distinguish "finished earlier today" from "nothing here".
    IF COALESCE((v_session.context->>'morning_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'morning' THEN
    IF v_text = '' THEN
      -- Empty answer to the active question: re-ask, no write, step unchanged.
      v_outcome := 'reask';
    ELSIF v_session.current_step = 1 THEN
      -- Q1 answered -> store morning_plan, advance to Q4 (step 4; Pass 2 inserts
      -- 2/3 between). daily_logs UPSERT happens in the write block below.
      v_session.current_step := 4;
      v_outcome := 'advance';
      v_write   := true;
    ELSIF v_session.current_step = 4 THEN
      -- Q4 answered -> store morning_execution_plan + submitted_at, COMPLETE.
      -- Session resets to idle and leaves the completion marker so a later
      -- same-day inbound reads as already_complete.
      v_session.current_flow := NULL;
      v_session.current_step := 0;
      v_session.context      := jsonb_build_object('morning_submitted', true);
      v_outcome  := 'advance';
      v_write    := true;
      v_complete := true;
    ELSE
      -- Defensive: an unexpected step for the morning flow. Re-ask rather than
      -- write to a column we cannot determine. (Not reachable in Pass 1.)
      v_outcome := 'reask';
    END IF;

  ELSE
    -- A non-morning flow is active (evening/etc. -- not built in Pass 1). This
    -- function only owns the morning flow; treat as idle here.
    v_outcome := 'idle';
  END IF;

  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Skipped entirely
  -- for start/already_complete/idle/reask (v_write=false) so no empty row is
  -- ever created -- an empty row would falsely read as "submitted". Relies on
  -- UNIQUE(project_id, engineer_id, log_date).
  IF v_write AND NOT v_complete THEN
    -- Q1: first answer of the day materialises the row.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_plan)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_plan = EXCLUDED.morning_plan;
  ELSIF v_write AND v_complete THEN
    -- Q4: update the same row + stamp submission. The row exists (Q1 precedes
    -- Q4 in the flow). UPSERT-guard the edge where it somehow does not.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_execution_plan, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_execution_plan = EXCLUDED.morning_execution_plan,
          morning_submitted_at   = EXCLUDED.morning_submitted_at;
  END IF;

  -- (4b) SESSION WRITE -- ALWAYS. Every outcome (incl. already_complete/idle/
  -- reask) refreshes the 30-minute TTL + updated_at through THIS RPC; nothing
  -- writes the session anywhere else. tenant_id/user_id are write-once via
  -- COALESCE (same rationale as acquire_and_transition_session).
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
