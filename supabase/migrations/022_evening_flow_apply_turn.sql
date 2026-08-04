-- =============================================================================
-- 022_evening_flow_apply_turn.sql
-- Evening check-in flow, Pass 1 (Q1-Q3) + the cross-flow routing hardening.
--
-- WHAT THIS DOES
--   1. CREATE OR REPLACE apply_morning_flow_turn -- two KINDS of change to the
--      018 body, not a line count (a count was accurate through two reviewer
--      rounds and stopped being true on the third -- see CONTEXT DISCIPLINE,
--      below, for why a count is the wrong way to describe this class of fix):
--        (a) the non-morning ELSE branch returns 'wrong_flow' instead of
--            'idle' -- see WHY 'wrong_flow' EXISTS, below.
--        (b) morning's two context-writing sites (START and Q4 COMPLETE) are
--            brought into line with the rule evening's sites already follow
--            -- see CONTEXT DISCIPLINE, below.
--      The rest is byte-identical to 018 (the block was extracted from 018
--      mechanically, not retyped).
--   2. CREATE apply_evening_flow_turn -- the evening twin of the morning RPC.
--      Pass 1 covers Q1 (work done + quantities), Q2 (plan met?) and Q3 (miss
--      reason, conditional on Q2 = No). Q4/Q5 land in Pass 2; Q6 is deferred
--      alongside morning's own unbuilt Q5/Q6 (design-decisions §9).
--   3. Lock EXECUTE down on the new function (020 discipline).
--
-- CONTEXT DISCIPLINE -- ONE RULE, FOUR SITES.
-- THE RULE: a flow's context write strips only that flow's OWN in-flight
-- counters and merges everything else -- never a bare replace or wipe. Every
-- site in either RPC that writes session.context must follow it.
--   * Morning START     -- FIXED here (022, third reviewer-approved change):
--     context := context - 'q2_reask' - 'q3_reask'.
--   * Morning Q4 COMPLETE -- FIXED here (022, reviewer B2):
--     context := (context - 'q2_reask' - 'q3_reask') || {'morning_submitted': true}.
--   * Evening START     -- correct by design: context := context - 'e2_reask'.
--   * Evening COMPLETE  -- correct by design:
--     context := (context - 'e2_reask') || {'evening_submitted': true}.
--
-- WHY EVENING WAS NEVER WRONG. Morning's two violations are inherited from
-- 018, where a bare replace/wipe was harmless -- morning was the ONLY flow,
-- so nothing else ever lived in context for a wipe to destroy. Evening's
-- author had no such history and no single-flow assumption to unlearn:
-- evening was written INTO the two-flow world this migration creates, so
-- both its sites obey the rule from their first line. That is the exact trap
-- for whoever adds a FIFTH site (Q5, a future flow, anything touching
-- context): copying the nearest existing line of code instead of the rule
-- above. Follow the rule, not the precedent.
--
-- RESTART SEMANTICS -- A BEHAVIOUR CHANGE, NOT JUST A FIX (flagged for the
-- cron/webhook-wiring PR, not resolved here). Morning START fires on
-- p_start_flow AND current_flow IS NULL -- it does NOT check
-- morning_submitted. So a second start trigger on an already-completed day
-- restarts the flow; that was true before this change too. What changes is
-- what a restart DOES to the marker: under the old wipe, restarting destroyed
-- morning_submitted, and the flow's own eventual completion would silently
-- re-set it -- a later inbound in between would misread 'idle' instead of
-- 'already_complete'. Under the strip, the marker SURVIVES a restart. That is
-- strictly better than the old behaviour, but it is a genuine change to the
-- restart path, not merely a preservation fix, and nothing has yet decided
-- whether a start trigger SHOULD restart an already-completed flow at all.
-- Tracked as a DECIDE-BEFORE-CRON-PR item in
-- docs/design-decisions-beta-feedback.md (search RESTART SEMANTICS).
--
-- WHY 'wrong_flow' EXISTS -- read before touching the webhook.
-- The webhook picks WHICH rpc to call from an UNLOCKED read of
-- whatsapp_sessions.current_flow. Between that read and the RPC taking its lock,
-- the flow can change (a completion, or -- once crons exist -- a scheduled
-- trigger). The RPC itself is already safe: it re-reads the session UNDER THE
-- LOCK, and every daily_logs write is gated on v_col, which is only ever set
-- inside the matching-flow branch. A mis-route therefore CANNOT write wrong
-- data.
-- What it CAN do is swallow the turn. route.ts consumes the Twilio MessageSid
-- BEFORE calling the RPC, so an 'idle' return means no write, no reply, and a
-- Twilio retry of that SID is a duplicate no-op -- the engineer's answer
-- disappears with nothing telling them to resend (a Rule 3.5 dead-end).
-- 'wrong_flow' is a distinct outcome the webhook answers by calling the OTHER
-- rpc exactly once. Bounded by construction: one retry, never a loop.
--
-- SECURITY -- CREATE OR REPLACE, NEVER DROP+CREATE (the 020 incident class).
-- Replacing a function PRESERVES its ACL; dropping and recreating RESETS it to
-- PostgreSQL's default PUBLIC EXECUTE, which is precisely the hole 020 closed.
-- apply_morning_flow_turn's signature is UNCHANGED here, so REPLACE is both
-- correct and required. 018 used DROP-FIRST legitimately (its signature went
-- 8-arg -> 12-arg); this migration must NOT copy that pattern.
-- The NEW function is created PUBLIC-executable by default, so the REVOKE/GRANT
-- at the end of this file is not hygiene -- it is the fix. Morning's grants are
-- re-asserted there too (belt and braces), and a post-apply proacl probe covers
-- both functions.
--
-- NO DATA MUTATION beyond the engineer's own check-in rows. Fully reversible --
-- exact-inverse DOWN block at the end of this file.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. apply_morning_flow_turn -- 018's body with the wrong_flow ELSE branch and
--    both context-writing sites brought into line with CONTEXT DISCIPLINE
--    (see the file header; each site is marked inline below). Signature
--    identical to 018 (12 args), so this REPLACES in place and the 020 ACL
--    survives. Do not reformat this block: it is a mechanical extract, and
--    keeping it diffable against 018 is the point.
-- -----------------------------------------------------------------------------
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

-- -----------------------------------------------------------------------------
-- 2. apply_evening_flow_turn -- the evening twin. Same contract as the morning
--    RPC: it owns the row lock, makes the decision, and writes session +
--    daily_logs in ONE transaction. Mirrored (for tests and documentation only,
--    never authoritative) by dispatchEveningFlow in lib/whatsapp/flows/evening.ts.
--
-- STEP MAP -- current_step is a STEP ID, *not* a question number.
--    1 -> Q1  work completed + quantities   (free text + enrichment parse)
--    2 -> Q2  plan met?                     (parsed yes/no, one reask)
--    3 -> Q3  miss reason                   (free text; ONLY when Q2 = No)
--   (Pass 2 adds 4,5 -> Q4a/Q4b and 6 -> Q5. Q6 is deferred.)
-- Morning gets away with current_step = question number and step+1 advancement.
-- Evening CANNOT: Q3 is conditional, Q4 will occupy two steps, and Q5 auto-skips.
-- Advancement therefore goes through explicit per-branch next-step assignments
-- and never an increment. Anything that "simplifies" this back to step+1 breaks
-- the conditional edges silently.
--
-- ONE PARSE PARAMETER, NOT ONE PER QUESTION -- AND IT IS KEYED BY STEP.
-- Morning's shape (one typed pair per parsed question) would reach ~18 arguments
-- by the time Q5 lands here, so evening collapses them into p_parse/p_parse_ok.
-- CRITICAL: both are keyed by STEP ID, e.g.
--     p_parse    = {"1": {...quantities...}, "2": {...yesno...}}
--     p_parse_ok = {"1": true, "2": false}
-- and the RPC selects the entry matching the step it resolves UNDER THE LOCK.
-- They are NOT "the parse for the active step". The webhook cannot know which
-- step is active without reading the session unlocked, and that read can race a
-- concurrent turn -- sending a single parse chosen from a stale step would feed
-- the WRONG question's parse into a write, which is a correctness bug rather
-- than the merely-swallowed turn 'wrong_flow' handles. Keying sidesteps the race
-- entirely and follows morning's own precedent: 018 parses BOTH its shapes
-- unconditionally every turn and lets the locked RPC choose. Parsing is pure and
-- cheap, so computing an unused shape costs nothing.
-- (This is why p_parse_ok is JSONB and not the BOOLEAN originally sketched.)
--
-- Q1 IS NOT PARSE-GATED. evening_output (TEXT) is the answer;
-- evening_output_quantities is ENRICHMENT layered on top, exactly as morning
-- Q2's by_trade is. A quantity we failed to extract must never cost the engineer
-- a reask -- design-decisions §9 records why structured extraction is not
-- trusted as a gate on this product.
--
-- CONTEXT DISCIPLINE applies here too (evening sites 3 and 4 of 4) -- see the
-- rule, the full four-site inventory, and WHY EVENING WAS NEVER WRONG in the
-- file header. Not restated here; this comment stays a pointer on purpose so
-- the rule has exactly one canonical statement.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION apply_evening_flow_turn(
  p_phone_number  TEXT,
  p_tenant_id     UUID,
  p_user_id       UUID,        -- engineer; also used as daily_logs.engineer_id
  p_project_id    UUID,        -- engineer's single active project (project_members)
  p_message       TEXT,        -- raw inbound; trimmed inside; ''/NULL tolerated
  p_start_flow    BOOLEAN,     -- TRUE only from the env-gated test trigger
  p_parse         JSONB    DEFAULT NULL,  -- per-STEP parses, keyed by step id
  p_parse_ok      JSONB    DEFAULT NULL,  -- per-STEP conclusiveness, keyed by step id
  p_now           TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms INTEGER     DEFAULT NULL  -- TEST-ONLY: pause after lock to force an interleave
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
  v_col      TEXT    := NULL;    -- which daily_logs column this turn writes (NULL = no write)
  v_reask    INTEGER;            -- current per-step reask counter
  v_met      BOOLEAN := NULL;    -- resolved Q2 answer
  v_complete BOOLEAN := false;   -- does this turn finish the flow?
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
  -- is wiped to idle. context := '{}' drops BOTH flows' markers and counters,
  -- which is correct: a new IST day starts clean for morning and evening alike.
  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    v_session.current_flow  := NULL;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;
  END IF;

  v_session.context := COALESCE(v_session.context, '{}'::jsonb);
  v_text := btrim(COALESCE(p_message, ''));

  -- (2a) RESERVED -- THE SINGLE CURRENT-DAY daily_logs READ.
  -- Pass 2 adds exactly one SELECT here:
  --     SELECT * INTO v_log FROM daily_logs
  --      WHERE project_id = p_project_id AND engineer_id = p_user_id
  --        AND log_date   = v_log_date;
  -- It is the input to Q5's auto-skip (BOT-22: skip when the morning equipment
  -- list is empty -- test jsonb_array_length(morning_equipment->'items') = 0,
  -- NOT morning_equipment = '[]', because 018 stores an OBJECT, not a bare
  -- array), and it is where the future per-day stream snapshot is read from
  -- (design-decisions §8). It stays ONE read in ONE place so that both those
  -- consumers are additive rather than another query.
  -- Pass 1 has no consumer, so the query is deliberately NOT issued yet rather
  -- than shipped as a dead round trip on every inbound.

  -- (3) DECIDE (mirrored in dispatchEveningFlow). --------------------------------
  IF p_start_flow THEN
    IF v_session.current_flow IS NULL THEN
      v_session.current_flow := 'evening';
      v_session.current_step := 1;
      -- CONTEXT DISCIPLINE, site 3 of 4 (see file header). Clears only
      -- EVENING's own counter; morning_submitted survives.
      v_session.context := v_session.context - 'e2_reask';
      v_outcome := 'start';
    ELSE
      v_outcome := 'reask';
    END IF;

  ELSIF v_session.current_flow IS NULL THEN
    -- Keyed on EVENING's marker; morning's idle branch keys on its own.
    IF COALESCE((v_session.context->>'evening_submitted')::boolean, false) THEN
      v_outcome := 'already_complete';
    ELSE
      v_outcome := 'idle';
    END IF;

  ELSIF v_session.current_flow = 'evening' THEN
    IF v_text = '' THEN
      -- Empty answer: reask unlimited, no write, no budget consumed.
      v_outcome := 'reask';

    ELSIF v_session.current_step = 1 THEN
      -- Q1 (free text + enrichment) -> evening_output + quantities, advance to Q2.
      v_session.current_step := 2;
      v_outcome := 'advance';
      v_col     := 'output';

    ELSIF v_session.current_step = 2 THEN
      -- Q2 (parsed yes/no). One reask on an unclassifiable answer, then resolve.
      v_reask := COALESCE((v_session.context->>'e2_reask')::int, 0);

      IF NOT COALESCE((p_parse_ok->>'2')::boolean, false) AND v_reask < 1 THEN
        v_session.context := v_session.context || jsonb_build_object('e2_reask', v_reask + 1);
        v_outcome := 'reask';   -- step unchanged (2)
      ELSE
        IF COALESCE((p_parse_ok->>'2')::boolean, false) THEN
          v_met := COALESCE((p_parse->'2'->>'met')::boolean, false);
        ELSE
          -- Budget spent and STILL unclassifiable -> treat as NOT MET, ask Q3.
          -- WHY false and not NULL: evening_schedule_met is BOOLEAN, so an
          -- unclassifiable answer has nowhere on this step to preserve its raw
          -- text. Routing to Q3 puts the engineer's own words into
          -- evening_schedule_miss_reason (TEXT) instead of discarding them, and
          -- a hedged answer ("mostly", "half done", "partly") is in practice a
          -- not-fully-met day. Rule 3.5's own remedy -- accept and flag
          -- low-confidence -- is unavailable here: no confidence field exists
          -- anywhere in the system (CLAUDE.md §10, PARSER DEBT).
          v_met := false;
        END IF;

        v_session.context := v_session.context || jsonb_build_object('e2_reask', 0);
        v_col     := 'schedule_met';
        v_outcome := 'advance';

        IF v_met THEN
          -- Plan met -> Q3 skipped. Pass 1 ends the flow on this edge; Pass 2
          -- will send it to step 4 (Q4a) instead of completing.
          v_complete := true;
        ELSE
          v_session.current_step := 3;
        END IF;
      END IF;

    ELSIF v_session.current_step = 3 THEN
      -- Q3 (free text) -> miss reason + submit, COMPLETE (Pass 1 terminal).
      v_col      := 'miss_reason';
      v_outcome  := 'advance';
      v_complete := true;

    ELSE
      v_outcome := 'reask';
    END IF;

  ELSE
    -- A DIFFERENT flow is active (morning). Same contract as the morning RPC's
    -- ELSE branch: report it so the webhook retries against the right function
    -- instead of silently swallowing the engineer's answer.
    v_outcome := 'wrong_flow';
  END IF;

  -- (3a) COMPLETION -- CONTEXT DISCIPLINE, site 4 of 4 (see file header).
  -- MERGE the marker, never replace.
  IF v_complete THEN
    v_session.current_flow := NULL;
    v_session.current_step := 0;
    v_session.context      := (v_session.context - 'e2_reask')
                              || jsonb_build_object('evening_submitted', true);
  END IF;

  -- (4a) DAILY_LOGS WRITE (per-question, in THIS transaction). Only when a column
  -- was resolved above. UNIQUE(project_id, engineer_id, log_date) backs the upsert.
  IF v_col = 'output' THEN
    -- Q1: first evening answer materialises the row if morning never did.
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_output, evening_output_quantities)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_parse->'1')
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_output            = EXCLUDED.evening_output,
          evening_output_quantities = EXCLUDED.evening_output_quantities;

  ELSIF v_col = 'schedule_met' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_schedule_met, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_met,
       CASE WHEN v_complete THEN p_now ELSE NULL END)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_schedule_met = EXCLUDED.evening_schedule_met,
          -- COALESCE so the NOT-MET turn (which does not complete) can never
          -- null out an evening_submitted_at written by an earlier turn.
          evening_submitted_at = COALESCE(EXCLUDED.evening_submitted_at, d.evening_submitted_at);

  ELSIF v_col = 'miss_reason' THEN
    INSERT INTO daily_logs AS d
      (tenant_id, project_id, engineer_id, log_date, evening_schedule_miss_reason, evening_submitted_at)
    VALUES
      (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_now)
    ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
      SET evening_schedule_miss_reason = EXCLUDED.evening_schedule_miss_reason,
          evening_submitted_at         = EXCLUDED.evening_submitted_at;
  END IF;

  -- (4b) SESSION WRITE -- ALWAYS. Refreshes TTL + updated_at and persists the
  -- (merged) context, including the reask counter on a reask turn.
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

-- -----------------------------------------------------------------------------
-- 3. EXECUTE hardening (020 discipline).
--
-- The function above was just created, so PostgreSQL has already granted PUBLIC
-- EXECUTE on it by default. PUBLIC includes anon, and apply_evening_flow_turn is
-- PARAMETER-TRUSTING (it takes p_user_id / p_tenant_id / p_project_id as caller
-- input and derives no identity from auth.uid()), so leaving that default in
-- place would reopen the exact hole 020 closed -- an anon caller could forge
-- check-in data for any engineer through PostgREST /rpc/, bypassing the webhook,
-- Twilio's HMAC and SID idempotency.
--
-- Morning's grants are re-asserted too. CREATE OR REPLACE preserves an existing
-- ACL, so this is belt-and-braces rather than a fix -- but asserting it costs
-- nothing and means the post-apply proacl probe has a single expected shape for
-- both functions.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_evening_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference -- exact inverse, no PITR dependency)
-- -----------------------------------------------------------------------------
-- Restores 018's apply_morning_flow_turn body (the 'idle' ELSE branch) and drops
-- the evening function. NOTE the ordering discipline: the morning restore must
-- itself be a CREATE OR REPLACE of the 018 body -- never DROP+CREATE -- or the
-- 020 ACL resets to PUBLIC on the way back down.
--
-- BEGIN;
--   -- 1. Re-apply 018's function verbatim:
--   --      psql -f supabase/migrations/018_morning_flow_parsers.sql
--   --    (018 is DROP-FIRST + CREATE, so after running it re-assert the grants:)
--   --      REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
--   --        text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
--   --      ) FROM PUBLIC, anon, authenticated;
--   --      GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
--   --        text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
--   --      ) TO service_role;
--   DROP FUNCTION IF EXISTS apply_evening_flow_turn(
--     text, uuid, uuid, uuid, text, boolean, jsonb, jsonb, timestamptz, integer
--   );
-- COMMIT;
--
-- Any evening_* data already written by this flow is left in place: it is the
-- engineer's real check-in record, not migration scaffolding.
-- =============================================================================
