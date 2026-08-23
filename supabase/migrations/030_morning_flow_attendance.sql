-- supabase/migrations/030_morning_flow_attendance.sql
-- Morning flow migration -- attendance-first renumbering + morning_manpower rename.
-- Full spec: docs/reviews/morning-flow-migration-review-package.md (step-mapping
-- table, §2) -- this file implements that table's TARGET column exactly. Do not
-- read this header as the spec; it is a summary for orientation only.
--
-- NOT YET APPLIED anywhere (test-db or prod) as of authoring. This migration
-- ships FIRST, alone (design-decisions-beta-feedback.md §30(a)) -- evening's own
-- restructuring is a separate, later migration.
--
-- WHAT CHANGES, IN ONE LINE EACH:
--   1. daily_logs gains `attendance TEXT CHECK (IN present/absent/site_holiday)`.
--   2. daily_logs.morning_manpower_planned is RENAMED to morning_manpower, and
--      every existing row's JSONB keys are transformed in the same migration
--      (planned_total -> total, planned_count -> count) -- a real UPDATE, not a
--      side effect of the column rename.
--   3. apply_morning_flow_turn (CREATE OR REPLACE, never DROP+CREATE -- migration
--      020's own incident is why) is renumbered: Q1 attendance / Q2 plan / Q3
--      workers-by-trade / Q4 equipment (completes the flow) on the YES path;
--      Q1 NO branches to a new step 5 (holiday follow-up), which completes the
--      flow as 'site_holiday' or 'absent'.
--   4. Reask keys renamed q2_reask/q3_reask -> q3_reask/q4_reask (now attached to
--      the steps their logic actually lives at); new q1_reask, q5_reask added.
--   5. The daily_logs column-bound UPDATE grant for `authenticated`
--      (migration 017, step 4) is re-declared with morning_manpower in place of
--      morning_manpower_planned. `attendance` is DELIBERATELY NOT added to that
--      grant -- PM correction of attendance is explicitly out of this
--      migration's scope (review package §4, "The PM edit UI").
--
-- WHY THE RENAME STOPS AT THE WRITE BOUNDARY, NOT THE SHARED PARSER. The
-- review package's step-mapping table (row H) specs the STORED JSONB shape
-- (`total`/`count`), not the parser's own TypeScript field names. `parseLabourCount`
-- / `LabourParse` (lib/whatsapp/flows/parsers/labour.ts) is SHARED with evening's
-- Q4a headcount (lib/whatsapp/flows/evening.ts:476, reads `.planned_total`
-- directly) -- renaming the parser's own field names would force editing
-- evening.ts, which this migration's own review package (§4) explicitly places
-- out of scope ("evening ships separately"). Resolution: `parseLabourCount`
-- and its `planned_total`/`planned_count` field names are UNCHANGED; the RPC
-- reshapes p_manpower into `{total, by_trade:[{trade,count}], raw_text}` at the
-- point it writes `morning_manpower`, and nowhere else. Flagged in this
-- migration's own review report as a gap the step-mapping table didn't examine.
--
-- WHY p_yesno_met/p_yesno_ok ARE APPENDED, NOT INSERTED. `CREATE OR REPLACE
-- FUNCTION` only allows adding NEW trailing DEFAULT-valued parameters -- not
-- inserting them mid-list -- without Postgres treating it as a different
-- function (and DROP+CREATE is the one thing this project's own migration-020
-- incident forbids for this exact function). Both new parameters therefore sit
-- after p_test_sleep_ms, not near the other classify-and-pass-in params
-- (p_manpower/p_equipment) they're conceptually closest to.
--
-- WHY THE RETURN VALUE GAINS `attendance`. Three distinct completions now
-- produce the identical (outcome='advance', current_step=0) pair: the YES
-- path's Q4 completion, the NO path's site_holiday completion, and the NO
-- path's absent completion -- and all three need a DIFFERENT reply string
-- (MORNING_COMPLETE_REPLY / MORNING_SITE_HOLIDAY_REPLY / MORNING_ABSENT_REPLY,
-- review package §2.1). The review package's table does not name this
-- mechanism. Resolved here by precedent already established in this
-- codebase: apply_evening_flow_turn's own RETURN already carries an extra
-- `equipment_echo` field for the identical reason (a caller needing more
-- than outcome+step to render the right reply). `attendance` is NULL on
-- every turn except the two that resolve it (step 1's YES/default-YES write,
-- step 5's completion), so it costs nothing on the common path.
--
-- REVIEW PACKAGE GATE (CLAUDE.md §0's external-review trigger): this migration
-- modifies a live function's logic (a) and renames a column with an in-place
-- JSONB data transform touching real historical rows -- trips the gate. Not
-- submitted for external review yet; this file plus its TS mirror and tests are
-- the build the review package's own §5 evidence artifacts (dry-run, test-db
-- rehearsal, mirror-agreement test, GATE 1 observation) still need to be run
-- against before that review happens. NOT APPLIED to test-db or prod.

-- =============================================================================
-- STEP 1 -- daily_logs.attendance (new column)
-- =============================================================================
ALTER TABLE daily_logs
  ADD COLUMN attendance TEXT CHECK (attendance IN ('present', 'absent', 'site_holiday'));

-- =============================================================================
-- STEP 2 -- morning_manpower_planned -> morning_manpower (rename + data transform)
-- =============================================================================
ALTER TABLE daily_logs
  RENAME COLUMN morning_manpower_planned TO morning_manpower;

-- Every EXISTING row's JSONB payload still carries the OLD key names
-- (planned_total / planned_count) -- the column rename alone does not touch
-- row contents. General predicate (every row with a non-null value), per
-- CLAUDE.md §6's additive-idempotent convention -- this transform can only
-- rename keys in place, never removes a row or drops data.
UPDATE daily_logs
SET morning_manpower = jsonb_build_object(
      'total', morning_manpower->'planned_total',
      'by_trade', (
        SELECT COALESCE(
                 jsonb_agg(
                   jsonb_build_object(
                     'trade', trade_elem->>'trade',
                     'count', (trade_elem->>'planned_count')::int
                   )
                 ),
                 '[]'::jsonb
               )
        FROM jsonb_array_elements(COALESCE(morning_manpower->'by_trade', '[]'::jsonb)) AS trade_elem
      ),
      'raw_text', morning_manpower->'raw_text'
    )
WHERE morning_manpower IS NOT NULL;

-- In-transaction structural assertion: the transform must be TOTAL. A stale
-- top-level `planned_total` or a stale nested `planned_count` means some
-- row's shape didn't match what the transform above assumed -- abort the
-- whole transaction rather than leave a silent partial rename.
DO $$
DECLARE
  v_stale_top    INTEGER;
  v_stale_nested INTEGER;
BEGIN
  SELECT count(*) INTO v_stale_top
  FROM daily_logs
  WHERE morning_manpower ? 'planned_total';

  SELECT count(*) INTO v_stale_nested
  FROM daily_logs, jsonb_array_elements(COALESCE(morning_manpower->'by_trade', '[]'::jsonb)) AS trade_elem
  WHERE trade_elem ? 'planned_count';

  IF v_stale_top > 0 OR v_stale_nested > 0 THEN
    RAISE EXCEPTION
      'morning_manpower JSONB key rename incomplete: % row(s) with stale planned_total, % by_trade element(s) with stale planned_count',
      v_stale_top, v_stale_nested;
  END IF;
END $$;

-- =============================================================================
-- STEP 3 -- re-declare the daily_logs column-bound UPDATE grant (migration
-- 017, step 4) with the renamed column. Idempotent/declarative (015's own
-- RERUN SEMANTICS note) -- safe to re-issue in full. `attendance` is
-- deliberately NOT in this list -- see this file's header.
-- =============================================================================
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies
) ON public.daily_logs TO authenticated;

-- =============================================================================
-- STEP 4 -- apply_morning_flow_turn (CREATE OR REPLACE -- never DROP+CREATE)
-- =============================================================================
CREATE OR REPLACE FUNCTION apply_morning_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,        -- engineer; also used as daily_logs.engineer_id
  p_project_id    UUID,        -- engineer's single active project (project_members)
  p_message       TEXT,        -- raw inbound; trimmed inside; ''/NULL tolerated
  p_start_flow    BOOLEAN,     -- TRUE only from the env-gated test trigger
  p_manpower      JSONB    DEFAULT NULL,  -- Q3 parse (labour); reshaped+stored when step 3 advances
  p_manpower_ok   BOOLEAN  DEFAULT NULL,  -- Q3 parse acceptable? (a number was found)
  p_equipment     JSONB    DEFAULT NULL,  -- Q4 parse (equipment); stored verbatim when step 4 advances
  p_equipment_ok  BOOLEAN  DEFAULT NULL,  -- Q4 parse acceptable? (explicit none, or >=1 item)
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL,  -- TEST-ONLY: pause after lock to force an interleave. NULL/no-op in prod.
  p_yesno_met     BOOLEAN  DEFAULT NULL,  -- classifyYesNo(p_message).met -- shared by Q1 attendance (step 1) and the holiday follow-up (step 5). APPENDED (see file header on why).
  p_yesno_ok      BOOLEAN  DEFAULT NULL   -- classifyYesNo(p_message).ok
)
RETURNS jsonb   -- { outcome, current_flow, current_step, log_date, attendance }
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_session    whatsapp_sessions;
  v_text       TEXT;
  v_log_date   DATE;
  v_outcome    TEXT;
  v_col        TEXT := NULL;      -- which daily_logs write this turn performs (NULL = no write)
  v_reask      INTEGER;           -- current per-step reask counter (parsed steps)
  v_attendance TEXT := NULL;      -- resolved attendance value this turn writes, if any -- also echoed in the return value (see file header)
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
  -- is wiped to idle: context := '{}' also drops every parsed-step reask counter.
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
      -- CONTEXT DISCIPLINE (022's site 1, extended by this migration): strip
      -- EVERY parsed-step reask key morning now has -- q1/q3/q4/q5, not just
      -- the original two -- so a stray counter from before a same-day restart
      -- never leaks into a fresh start.
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
      -- Empty answer: reask unlimited, no write, no budget consumed.
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1 Attendance (classifyYesNo, computed in TS, passed in as
      -- p_yesno_met/p_yesno_ok). One reask on an unclassifiable answer.
      -- Exhausted-reask default is YES -- DECIDED 2026-08-23 (review package
      -- §2): default-YES-when-actually-absent leaves three questions
      -- unanswered, visible and B3-recoverable; default-NO-when-actually-
      -- present silently drops all three from an engineer who was on site
      -- and answering. The opposite of evening Q2's own default direction,
      -- because on THIS question NO is the shorter path, not the longer one.
      v_reask := COALESCE((v_session.context->>'q1_reask')::int, 0);
      IF NOT COALESCE(p_yesno_ok, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q1_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (1)
      ELSIF COALESCE(p_yesno_ok, false) AND NOT p_yesno_met THEN
        -- Genuinely parsed NO -> holiday follow-up (step 5). No daily_logs
        -- write yet -- attendance isn't known until the follow-up resolves.
        v_session.current_step := 5;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_outcome := 'advance';
      ELSE
        -- YES, or the exhausted-reask default (DECIDED: YES, not NO).
        v_session.current_step := 2;
        v_session.context := v_session.context || jsonb_build_object('q1_reask', 0);
        v_attendance := 'present';
        v_col        := 'attendance';
        v_outcome    := 'advance';
      END IF;

    ELSIF v_session.current_step = 2 THEN
      -- Q2 (free text) -> morning_plan, advance to Q3. (Old step 1's logic,
      -- moved here verbatim -- free text needs no reask handling.)
      v_session.current_step := 3;
      v_outcome := 'advance';
      v_col     := 'plan';

    ELSIF v_session.current_step = 3 THEN
      -- Q3 (parsed labour, workers by trade). Accept on a number; else reask
      -- once then accept raw. Reask key renamed q2_reask -> q3_reask (now
      -- attached to the step this logic actually lives at).
      v_reask := COALESCE((v_session.context->>'q3_reask')::int, 0);
      IF COALESCE(p_manpower_ok, false) OR v_reask >= 1 THEN
        v_session.current_step := 4;
        v_session.context := v_session.context || jsonb_build_object('q3_reask', 0);
        v_outcome := 'advance';
        v_col     := 'manpower';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q3_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (3)
      END IF;

    ELSIF v_session.current_step = 4 THEN
      -- Q4 (parsed equipment). Accept on none/known item; else reask once.
      -- Equipment is now the LAST question -- completes the flow directly
      -- (old step 4's free-text execution-plan role is retired; that column
      -- stops being written, per §28(p)/review package row K -- it stays in
      -- the table with its historical data, not dropped). Reask key renamed
      -- q3_reask -> q4_reask.
      v_reask := COALESCE((v_session.context->>'q4_reask')::int, 0);
      IF COALESCE(p_equipment_ok, false) OR v_reask >= 1 THEN
        -- CONTEXT DISCIPLINE (022's site 2, extended): merge, never replace
        -- -- a bare replace would wipe evening_submitted if evening ran
        -- earlier the same day (T-022-13's own reverse-order regression).
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_outcome := 'advance';
        v_col     := 'equipment';
      ELSE
        v_session.context := v_session.context || jsonb_build_object('q4_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (4)
      END IF;

    ELSIF v_session.current_step = 5 THEN
      -- Holiday follow-up (classifyYesNo again -- same p_yesno_met/p_yesno_ok
      -- params, this question's own reask key q5_reask). Exhausted-reask
      -- default stays `absent` (unchanged from the exhausted-attendance
      -- default reasoning above -- `absent` keeps the evening trigger and PM
      -- handoff alive, `site_holiday` would silently cancel both).
      v_reask := COALESCE((v_session.context->>'q5_reask')::int, 0);
      IF NOT COALESCE(p_yesno_ok, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('q5_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (5)
      ELSE
        IF COALESCE(p_yesno_ok, false) AND p_yesno_met THEN
          v_attendance := 'site_holiday';
        ELSE
          -- NO, or the exhausted-reask default.
          v_attendance := 'absent';
        END IF;
        v_session.current_flow := NULL;
        v_session.current_step := 0;
        v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                                    || jsonb_build_object('morning_submitted', true);
        v_col     := 'attendance_complete';
        v_outcome := 'advance';
      END IF;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- A DIFFERENT flow is active (evening). Report it as its OWN outcome so the
    -- webhook can retry against the correct RPC (unchanged from 022 -- see
    -- that migration's own header for WHY 'wrong_flow' exists).
    v_outcome := 'wrong_flow';
  END IF;

  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Only when a
  -- write was resolved above. UNIQUE(project_id, engineer_id, log_date)
  -- backs every upsert.
  IF v_col = 'attendance' THEN
    -- Step 1 YES (or exhausted-reask default): 'present'. Materialises the
    -- row (replaces old step-1's row-materialising role) -- flow continues,
    -- no submission stamp yet.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance = EXCLUDED.attendance;

  ELSIF v_col = 'attendance_complete' THEN
    -- Step 5 resolves the NO branch: 'site_holiday' or 'absent', completes
    -- the flow. is_holiday mirrors 'site_holiday' per §30(c) so existing
    -- readers of is_holiday keep working unchanged.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, attendance, is_holiday, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_attendance, (v_attendance = 'site_holiday'), p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET attendance           = EXCLUDED.attendance,
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
    -- morning_manpower stores the RESHAPED parse (total/count) -- NOT
    -- parseLabourCount's own planned_total/planned_count field names. See
    -- this file's header for why the rename stops here and doesn't touch
    -- the shared parser (evening's Q4a headcount depends on it unchanged).
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_manpower)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date,
       jsonb_build_object(
         'total', p_manpower->'planned_total',
         'by_trade', (
           SELECT COALESCE(
                    jsonb_agg(
                      jsonb_build_object('trade', t->>'trade', 'count', (t->>'planned_count')::int)
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
    -- Q4: store the equipment parse verbatim (none -> {items:[],none:true,...})
    -- AND stamp submission -- equipment now completes the flow.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, morning_equipment, morning_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, p_equipment, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET morning_equipment    = EXCLUDED.morning_equipment,
          morning_submitted_at = EXCLUDED.morning_submitted_at;
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
    'log_date',     v_log_date,
    'attendance',   v_attendance
  );
END;
$fn$;

-- =============================================================================
-- STEP 5 -- re-assert the grant (migration-lint's no-orphan-security-definer
-- rule, and 022's own precedent: "CREATE OR REPLACE preserves an existing ACL,
-- so this is belt-and-braces rather than a fix -- but asserting it costs
-- nothing"). Full signature, including the two appended parameters.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer, boolean, boolean
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer, boolean, boolean
) TO service_role;
