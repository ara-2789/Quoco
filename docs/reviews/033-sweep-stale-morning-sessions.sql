-- supabase/migrations/033_sweep_stale_morning_sessions.sql
-- B3 -- the 15:00 IST morning cutoff sweep.
--
-- WHY THIS IS A NEW MIGRATION, NOT A TYPESCRIPT-ONLY CHANGE. The sweep must
-- atomically write daily_logs AND reset whatsapp_sessions for potentially
-- many stuck sessions per tick, without racing a concurrent real inbound
-- turn for the same phone number. Two separate client calls from TypeScript
-- would not be atomic -- a real answer arriving between them could be
-- silently clobbered or duplicated. Every other stateful multi-write flow in
-- this codebase (apply_morning_flow_turn, apply_evening_flow_turn,
-- acquire_and_transition_session) already solved this exact problem the same
-- way: one SECURITY DEFINER function, one transaction per session, real
-- row-level locking. This does the same.
--
-- SOURCES THIS IMPLEMENTS, READ BEFORE WRITING THIS FILE:
--   docs/reviews/morning-flow-migration-review-package.md §4 (B3 section,
--     including the step-5 parked-state spec) and §11.4 (the B3 inheritance
--     requirement for attendance_defaulted/attendance_raw).
--   design-decisions-beta-feedback.md §29(d) (MORNING CUTOFF SUBMITS AS-IS --
--     the widened scope: partial answers are kept, not cleared) and §30(i)
--     (sequencing correction -- this migration ships only after 030, against
--     030's final step numbering, not the old one).
--   docs/plans/flow-migration-rescoping-plan.md finding (j) -- expires_at is
--     dead; this sweep is the ONLY mechanism (short of BOT-07's lazy
--     next-IST-day wipe) that ever closes a stale morning session at all.
--
-- WHAT IT DOES. At/after morningCutoff (15:00 IST,
-- lib/daily-logs/cutoffs.ts:50), every whatsapp_sessions row with
-- current_flow='morning' is closed and its daily_logs row (if any) stamped
-- morning_submitted_at -- with whatever was actually answered, per §29(d)'s
-- widened scope. Per-step behaviour, since a partial means something
-- different at each step:
--
--   step 1 -- attendance unanswered. NO daily_logs write, row left absent
--     if none exists. Argued in the review package build notes: step 1
--     stuck means the engineer's phone never replied AT ALL -- not even an
--     unparseable reply. That is categorically different from the
--     exhausted-reask defaults (which fire only after a real-but-
--     unclassifiable reply exists) or step 5 (a known NO exists). Writing
--     any attendance value here, even flagged attendance_defaulted=true,
--     would assert the system has a data point when it has none. The
--     session still closes; the row does not gain a phantom answer.
--     Consequence checked: with no row, morning_submitted_at stays null, so
--     routeInboundMessage naturally treats this engineer as not-yet-
--     submitted if they message again later that day.
--   step 2 -- attendance='present' already written (step 1's own site).
--     Stamp submission only. Never touch a column the RPC already wrote.
--   step 3 -- plan captured (step 2's site), workers unanswered. Same as
--     step 2: stamp submission only.
--   step 4 -- workers captured (step 3's site), equipment unanswered. Same:
--     stamp submission only.
--   step 5 -- attendance answered NO (known), holiday follow-up never
--     resolved, and per row F1/F2 in the step-mapping table NO daily_logs
--     row may exist yet at all (attendance is only written on a YES at step
--     1; a NO advances straight to step 5 with no write). INSERT, not a
--     bare UPDATE that would silently no-op against a missing row -- ON
--     CONFLICT DO UPDATE covers the rare case evening already wrote a row
--     for this engineer/date first. Records 'absent', not 'site_holiday' --
--     the sweep cannot know which, and 'absent' keeps the evening trigger
--     and PM handoff alive rather than silently cancelling the day. Same
--     asymmetry-of-consequence default direction as the exhausted-reask
--     path, same reason (review package §2/§4).
--
-- MARKER REQUIREMENT (§11.4's own B3 inheritance clause). A swept row is
-- inferred, not stated. attendance_defaulted=true wherever this sweep
-- supplies an attendance value it was not told (step 5 only -- steps 2-4
-- never touch attendance at all, it was already correctly marked at
-- whichever real site wrote it). attendance_raw=NULL for the sweep's own
-- write -- unlike the RPC's two real write sites, a cron sweep has no
-- inbound turn to capture literal words from.
--
-- LOG_DATE, DELIBERATELY NOT p_now. Computed from the session's OWN
-- updated_at (the IST day of the engineer's last real turn -- start,
-- advance, or reask all refresh it, see 030's own "(4b) SESSION WRITE --
-- ALWAYS" block), not from the sweep's current timestamp. A session stuck
-- since a PRIOR day (sweep down, or first run after some sessions already
-- accumulated) must still be attributed to the day the engineer actually
-- answered, not the day it happened to get swept -- using p_now here would
-- silently misattribute a partial answer to the wrong day's log_date.
--
-- CUTOFF GATE. Computed fresh every call from p_now, IST wall-clock minutes-
-- since-midnight, same pattern as lib/checkin-escalations/status.ts's own
-- minutesOf(CHECKIN_CHECKPOINTS...) -- not hardcoded independently of
-- lib/daily-logs/cutoffs.ts's single source of truth (15:00 = 900 minutes).
-- Before the cutoff, the function is a no-op.
--
-- IDEMPOTENCY. The sweep's own WHERE current_flow = 'morning' clause is the
-- entire mechanism -- sweeping sets current_flow := NULL, so an already-
-- swept session can never match that clause again on a later tick. No
-- separate "already swept" flag needed. FOR UPDATE SKIP LOCKED on the
-- per-row cursor: a row a real concurrent apply_morning_flow_turn call
-- currently holds is left alone this tick, picked up the next minute
-- instead of blocked on.
--
-- WHERE THIS RUNS. Inside the existing jobs/tick cron (already polled every
-- 60s, NFR-16) -- app/api/jobs/tick/route.ts's runJobsTick, alongside job
-- claiming, NOT a new job type (this is time-triggered, not queued) and NOT
-- a new vercel.json entry -- ships without touching the cron entries
-- withheld for GATE 1 (design-decisions-beta-feedback.md §29's two hard
-- preconditions).
--
-- SIGNATURE, deliberately stable. One parameter, p_now, same convention as
-- every other flow-turn RPC's own `now` injection point for deterministic
-- tests. No reason for this to ever need a second parameter -- if that
-- changes, remember CLAUDE.md §0's CREATE OR REPLACE + appended-parameter
-- finding (the 030 first-draft incident) before touching this signature.

CREATE OR REPLACE FUNCTION sweep_stale_morning_sessions(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ist_minutes  INTEGER;
  v_row          whatsapp_sessions%ROWTYPE;
  v_log_date     DATE;
  v_project_id   UUID;
  v_swept_count  INTEGER := 0;
  v_swept_phones TEXT[]  := '{}';
BEGIN
  -- CUTOFF GATE -- see file header.
  v_ist_minutes := EXTRACT(HOUR FROM (p_now AT TIME ZONE 'Asia/Kolkata'))::int * 60
                 + EXTRACT(MINUTE FROM (p_now AT TIME ZONE 'Asia/Kolkata'))::int;
  IF v_ist_minutes < 900 THEN  -- 15:00 IST = 15*60
    RETURN jsonb_build_object('swept_count', 0, 'swept_phone_numbers', '[]'::jsonb, 'reason', 'before_cutoff');
  END IF;

  FOR v_row IN
    SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning' FOR UPDATE SKIP LOCKED
  LOOP
    v_log_date := (v_row.updated_at AT TIME ZONE 'Asia/Kolkata')::date;

    -- The engineer's project. Every real turn that could have advanced this
    -- session past step 1 required a p_project_id from the caller; this is
    -- the same lookup app/api/whatsapp/webhook/route.ts's own gate query
    -- already does (users -> project_members, "the engineer's single active
    -- project"). Defensive NULL check below, not expected in practice.
    SELECT project_id INTO v_project_id
    FROM project_members
    WHERE user_id = v_row.user_id
    LIMIT 1;

    IF v_project_id IS NOT NULL THEN
      IF v_row.current_step IN (2, 3, 4) THEN
        -- attendance (+ plan, + manpower, as applicable) already written by
        -- the RPC's own per-question site when each step was reached. The
        -- row is guaranteed to exist (attendance is written the moment step
        -- 1 resolves YES, before current_step ever reaches 2). Stamp
        -- submission only -- never touch a column the RPC already wrote.
        UPDATE daily_logs
           SET morning_submitted_at = p_now
         WHERE project_id  = v_project_id
           AND engineer_id = v_row.user_id
           AND log_date    = v_log_date;

      ELSIF v_row.current_step = 5 THEN
        -- Holiday follow-up, never resolved. INSERT, not a bare UPDATE --
        -- see file header for why no row may exist yet. absent, not
        -- site_holiday; attendance_defaulted=true (sweep-supplied, not a
        -- real answer); attendance_raw=NULL (no inbound turn to capture
        -- words from); is_holiday mirrors attendance='site_holiday', so
        -- false here, exactly matching the RPC's own (v_attendance =
        -- 'site_holiday') computation at its real write site.
        INSERT INTO daily_logs AS d
          (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw, is_holiday, morning_submitted_at)
        VALUES
          (v_row.tenant_id, v_project_id, v_row.user_id, v_log_date, 'absent', true, NULL, false, p_now)
        ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
          SET attendance           = EXCLUDED.attendance,
              attendance_defaulted = EXCLUDED.attendance_defaulted,
              attendance_raw       = EXCLUDED.attendance_raw,
              is_holiday           = EXCLUDED.is_holiday,
              morning_submitted_at = EXCLUDED.morning_submitted_at;
      END IF;
      -- current_step = 1 falls through here with no daily_logs write at
      -- all -- see file header's argument.

      v_swept_count  := v_swept_count + 1;
      v_swept_phones := v_swept_phones || v_row.phone_number;
    END IF;

    -- SESSION RESET -- always, regardless of step or whether a project_id
    -- was found, so a session never sits stuck forever behind a data
    -- problem the sweep itself can't fix. Mirrors 030's own completion
    -- write (4b): current_flow/current_step cleared, every reask key
    -- stripped. context.morning_submitted is set true only when something
    -- real was actually captured and stamped (steps 2-5) -- step 1 leaves
    -- it unset so a same-day retry is a genuine fresh start, not
    -- "already complete" over nothing that was ever submitted.
    UPDATE whatsapp_sessions
       SET current_flow = NULL,
           current_step = 0,
           context      = (context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                           || CASE WHEN v_row.current_step != 1
                                THEN jsonb_build_object('morning_submitted', true)
                                ELSE '{}'::jsonb
                              END,
           updated_at   = p_now
     WHERE id = v_row.id;
  END LOOP;

  RETURN jsonb_build_object('swept_count', v_swept_count, 'swept_phone_numbers', to_jsonb(v_swept_phones));
END;
$fn$;

-- =============================================================================
-- Grant -- service_role only. Called exclusively from app/api/jobs/tick's
-- cron route, never reachable from browser/authenticated context.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.sweep_stale_morning_sessions(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_morning_sessions(timestamptz) TO service_role;
