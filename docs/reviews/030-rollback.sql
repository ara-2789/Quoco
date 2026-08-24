-- docs/reviews/030-rollback.sql
-- Down-migration for 030_morning_flow_attendance.sql — NOT a numbered
-- migration file (this project's supabase/migrations/ directory holds
-- forward migrations only; a numbered slot here would confuse
-- migration-lint and `supabase migration list`'s ledger correlation).
-- Written and applied 2026-08-24 (Aravind's decision) to restore test-db
-- to main's expected pre-030 state after leaving 030 applied there for the
-- test-db rehearsal broke shared CI for every other branch — see
-- docs/build-status.md's 2026-08-24 entry on the shared-test-db cost this
-- revealed, and docs/reviews/morning-flow-migration-review-package.md's
-- own artifact record for this file's role as review-package evidence,
-- verified by direct observation, not merely written.
--
-- Reverses 030 in the mirror order of 030's own forward steps, executed
-- so each reversal happens against the schema state 030 itself would have
-- seen at the equivalent forward step (transform the JSONB before renaming
-- the column back, exactly as 030 renamed the column before transforming
-- it forward):
--   1. Restore apply_morning_flow_turn's ORIGINAL 022 body via CREATE OR
--      REPLACE (never DROP+CREATE) — signature is BYTE-IDENTICAL to 030's
--      own (12 args; 030 already kept it unchanged from 022, review
--      package §10.1), so this is a body-only restoration, not a signature
--      change.
--   2. Drop quoco_classify_yes_no — 030's own new helper, no longer
--      referenced once the 022 body above is restored.
--   3. Reverse the JSONB key transform on morning_manpower (total ->
--      planned_total, by_trade[].count -> by_trade[].planned_count),
--      general predicate + in-transaction structural assertion, same
--      additive-idempotent discipline as 030's own forward transform
--      (CLAUDE.md §6). Runs BEFORE the rename below, while the column is
--      still named morning_manpower — mirrors 030's own forward order
--      (rename THEN transform) in reverse (transform THEN rename).
--   4. Rename morning_manpower -> morning_manpower_planned.
--   5. Restore migration 017's ORIGINAL column-bound UPDATE grant for
--      `authenticated`, naming morning_manpower_planned, with no
--      `attendance` entry (017 never had one).
--   6. Drop the attendance column (its CHECK constraint drops with it,
--      implicitly — PostgreSQL always drops a column's own constraints
--      when the column itself is dropped).
-- is_holiday is NOT touched anywhere in this file — it predates 030
-- entirely (already present pre-030) and 030 never altered its structure,
-- only wrote to it via application logic that this rollback also removes.

-- =============================================================================
-- STEP 1 -- restore apply_morning_flow_turn's ORIGINAL 022 body
-- =============================================================================
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
      -- CONTEXT DISCIPLINE, site 1 of 4 (see file header) -- 022's THIRD
      -- change, added after the reviewer's second pass. 018 wiped context to
      -- '{}' here; harmless then (morning was the only flow), but this is the
      -- FIRST write of a restart, and a restart on an already-completed day
      -- would otherwise destroy evening_submitted before Q4 ever runs -- the
      -- exact gap T-022-13 (reverse-order) caught and a completion-only fix
      -- could not. Strip only morning's own counters; see RESTART SEMANTICS
      -- in the file header for the behaviour change this implies.
      v_session.context      := v_session.context - 'q2_reask' - 'q3_reask';
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
      -- Q4 (free text) -> execution plan + submitted_at, COMPLETE.
      -- CONTEXT DISCIPLINE, site 2 of 4 (see file header) -- reviewer B2.
      -- 018's bare replace was safe only while morning was the only flow;
      -- this merges instead, mirroring evening's own completion exactly.
      v_session.current_flow := NULL;
      v_session.current_step := 0;
      v_session.context      := (v_session.context - 'q2_reask' - 'q3_reask')
                                || jsonb_build_object('morning_submitted', true);
      v_outcome := 'advance';
      v_col     := 'execution';

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- A DIFFERENT flow is active (evening). Report it as its OWN outcome so the
    -- webhook can retry against the correct RPC. Returning 'idle' here would make
    -- a mis-routed turn indistinguishable from a genuine no-flow inbound, and the
    -- engineer's answer would be silently swallowed (the SID is already consumed).
    -- The wrong_flow ELSE-branch change -- see WHY 'wrong_flow' EXISTS in the
    -- file header (a separate kind of change from CONTEXT DISCIPLINE, above).
    v_outcome := 'wrong_flow';
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

-- Re-assert the grant (migration-lint's no-orphan-security-definer rule
-- requires every file containing a SECURITY DEFINER CREATE OR REPLACE to
-- carry its own REVOKE/GRANT pair, even though this signature is
-- byte-identical to 030's own -- no overload risk, this is belt-and-braces
-- exactly like 030's own STEP 5 was).
REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;

-- =============================================================================
-- STEP 2 -- drop quoco_classify_yes_no (030's own new helper, unreferenced
-- once STEP 1 above restored the 022 body)
-- =============================================================================
DROP FUNCTION IF EXISTS quoco_classify_yes_no(TEXT);

-- =============================================================================
-- STEP 3 -- reverse the JSONB key transform on morning_manpower, BEFORE the
-- rename below (mirrors 030's own forward order -- rename then transform --
-- in reverse: transform then rename). General predicate + in-transaction
-- structural assertion, same additive-idempotent discipline as 030's own
-- forward transform (CLAUDE.md §6).
-- =============================================================================
UPDATE daily_logs
SET morning_manpower = jsonb_build_object(
      'planned_total', morning_manpower->'total',
      'by_trade', (
        SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'trade', trade_elem->>'trade',
                     'planned_count', (trade_elem->>'count')::int
                   )
                 ),
                 '[]'::jsonb
               )
        FROM jsonb_array_elements(COALESCE(morning_manpower->'by_trade', '[]'::jsonb)) AS trade_elem
      ),
      'raw_text', morning_manpower->'raw_text'
    )
WHERE morning_manpower IS NOT NULL;

-- In-transaction structural assertion: the reversal must be TOTAL. A
-- stale top-level `total` or a stale nested `count` means some row's shape
-- didn't match what the reversal above assumed -- abort rather than leave
-- a silent partial rollback.
DO $$
DECLARE
  v_stale_top    INTEGER;
  v_stale_nested INTEGER;
BEGIN
  SELECT count(*) INTO v_stale_top
  FROM daily_logs
  WHERE morning_manpower ? 'total';

  SELECT count(*) INTO v_stale_nested
  FROM daily_logs, jsonb_array_elements(COALESCE(morning_manpower->'by_trade', '[]'::jsonb)) AS trade_elem
  WHERE trade_elem ? 'count';

  IF v_stale_top > 0 OR v_stale_nested > 0 THEN
    RAISE EXCEPTION
      'morning_manpower JSONB key reversal incomplete: % row(s) with stale total, % by_trade element(s) with stale count',
      v_stale_top, v_stale_nested;
  END IF;
END $$;

-- =============================================================================
-- STEP 4 -- rename morning_manpower back to morning_manpower_planned
-- =============================================================================
ALTER TABLE daily_logs
  RENAME COLUMN morning_manpower TO morning_manpower_planned;

-- =============================================================================
-- STEP 5 -- restore migration 017's ORIGINAL column-bound UPDATE grant
-- (017_rls_column_bounding.sql:132-140, unedited -- reproduced verbatim
-- here, naming morning_manpower_planned, no `attendance` entry)
-- =============================================================================
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower_planned, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies
) ON public.daily_logs TO authenticated;

-- =============================================================================
-- STEP 6 -- drop the attendance column (its CHECK constraint,
-- daily_logs_attendance_check, drops implicitly with it). is_holiday is
-- NOT touched -- it predates 030 and is not part of this rollback.
-- =============================================================================
ALTER TABLE daily_logs
  DROP COLUMN attendance;
