-- supabase/migrations/013_session_transition_test_lock_probe.sql
-- Test-only lock-acquisition probe for acquire_and_transition_session (Test B).
--
-- WHY A NEW MIGRATION (not an edit to 012):
-- 012 is already applied to PRODUCTION. Per the standing rule, an applied
-- migration file is NEVER edited in place. This migration re-issues the
-- function with CREATE OR REPLACE and NO signature change, so it is a clean,
-- reversible-in-practice swap of the body only.
--
-- WHAT CHANGES vs 012:
-- When (and only when) p_test_sleep_ms IS NOT NULL, we capture a Postgres
-- wall-clock reading (clock_timestamp(), NOT now()/transaction_timestamp(),
-- which are frozen at txn start) at the EXACT moment the row lock is acquired
-- -- right after the acquire upsert, before the injected pause -- and MERGE it
-- into the returned context as `_test_lock_acquired_at`.
--
-- This is the DB-side proof for Test B: a second concurrent caller cannot take
-- the lock until the first caller commits, so caller-2's _test_lock_acquired_at
-- must be >= caller-1's lock time + the injected sleep. Because the timestamp
-- is read inside the function, it is immune to network / PostgREST / JS
-- event-loop scheduling noise (which a JS "when did the promise resolve"
-- measurement would fold in).
--
-- INVARIANTS (deliberate, must stay true):
--   * MERGE, never replace: `v_session.context || jsonb_build_object(...)`.
--     context is real production session state; nothing in it is ever dropped.
--   * Rides the SINGLE existing step-4 UPDATE as one extra key -- no separate
--     write, no extra round-trip -- so the timing profile Test B measures is
--     identical to the unmodified write path.
--   * Gated strictly on p_test_sleep_ms IS NOT NULL. Production never passes
--     that parameter, so `_test_lock_acquired_at` is NEVER present in any real
--     production row. It is a test-only diagnostic, not part of the context
--     schema.
-- Everything else is byte-for-byte the 012 behaviour.

CREATE OR REPLACE FUNCTION acquire_and_transition_session(
  p_phone_number   TEXT,
  p_tenant_id      UUID,
  p_user_id        UUID,
  p_requested_flow TEXT,        -- flow the caller wants to START; NULL = advance existing only
  p_caller         TEXT,        -- 'webhook' today; 'scheduled_trigger' later (cron, out of scope)
  p_now            TIMESTAMPTZ DEFAULT now(),
  p_test_sleep_ms  INTEGER     DEFAULT NULL  -- TEST-ONLY: pause mid-txn to force an interleave (Test B). NULL/no-op in prod.
)
RETURNS whatsapp_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session  whatsapp_sessions;
  v_priority INT;
  v_entry    JSONB;
  v_lock_at  TIMESTAMPTZ;   -- TEST-ONLY: wall-clock at lock acquisition (Test B); stays NULL in prod.
BEGIN
  -- (1) ATOMIC ACQUIRE. Insert-or-lock the row for this phone in one step.
  -- The DO UPDATE is a deliberate no-op whose only purpose is to lock the
  -- existing row and let us RETURN its current values. This closes the race
  -- where two "no session exists, create one" paths both INSERT and one
  -- crashes on the UNIQUE constraint.
  INSERT INTO whatsapp_sessions AS s
    (phone_number, tenant_id, user_id, pending_flows, expires_at, updated_at)
  VALUES
    (p_phone_number, p_tenant_id, p_user_id, '[]'::jsonb, p_now + INTERVAL '30 minutes', p_now)
  ON CONFLICT (phone_number) DO UPDATE
    SET phone_number = s.phone_number   -- no-op: lock + return existing row
  RETURNING * INTO v_session;

  -- (Test B only) The lock is now held. Capture the DB-side wall clock at this
  -- exact point, then hold the lock across an injected pause so a second
  -- concurrent caller is forced to block on the acquire until we commit. This
  -- proves the lock genuinely spans acquire -> decide -> save.
  IF p_test_sleep_ms IS NOT NULL THEN
    v_lock_at := clock_timestamp();
    PERFORM pg_sleep(p_test_sleep_ms / 1000.0);
  END IF;

  -- (2) + (3) READ current state (already in v_session) and DECIDE.
  IF NOT quoco_same_ist_day(p_now, v_session.updated_at) THEN
    -- BOT-07 next-day / BOT-21 previous-day: wipe and fresh-start regardless
    -- of prior state. Context from a previous operating day is discarded.
    v_session.current_flow  := p_requested_flow;
    v_session.current_step  := 0;
    v_session.context       := '{}'::jsonb;
    v_session.pending_flows := '[]'::jsonb;

  ELSIF v_session.current_flow IS NULL THEN
    -- Same day, nothing active: start the requested flow fresh. A bare
    -- inbound with no requested flow leaves the session idle.
    IF p_requested_flow IS NOT NULL THEN
      v_session.current_flow := p_requested_flow;
      v_session.current_step := 0;
      v_session.context      := '{}'::jsonb;
    END IF;

  ELSE
    -- Same day, a flow is already active.
    IF p_requested_flow IS NOT NULL
       AND p_requested_flow IS DISTINCT FROM v_session.current_flow THEN
      -- BOT-21 collision: a NEW flow is requested mid-flow. Queue it into
      -- pending_flows; NEVER clobber the active flow (constraint #3).
      -- Priority: safety=0, scheduled_trigger=1, other=2 (BOT-26).
      v_priority := CASE
                      WHEN p_requested_flow = 'safety'    THEN 0
                      WHEN p_caller = 'scheduled_trigger' THEN 1
                      ELSE 2
                    END;
      -- Entry shape {type, priority, queued_at}. queued_at uses the SAME
      -- p_now as this transaction so drain's (priority, queued_at) sort is a
      -- true, stable FIFO within equal priority (constraint #7).
      v_entry := jsonb_build_object(
        'type',      p_requested_flow,
        'priority',  v_priority,
        'queued_at', p_now
      );
      v_session.pending_flows :=
        COALESCE(v_session.pending_flows, '[]'::jsonb) || jsonb_build_array(v_entry);
    END IF;
    -- else: the SAME flow was re-requested while already active, OR this is a
    -- bare inbound advancing the active flow. Either way it is a deliberate
    -- SILENT NO-OP on flow/step/context: we do NOT restart the active flow
    -- and we do NOT queue a duplicate of it. BOT-07 same-day resume applies --
    -- current_flow/current_step/context are kept as-is; only the TTL is
    -- refreshed by the write below.
  END IF;

  -- (4) SINGLE WRITE. Always refresh the 30-minute TTL + updated_at, and
  -- persist the decision. Same transaction, lock still held.
  --
  -- TEST-ONLY diagnostic key: when p_test_sleep_ms was supplied we MERGE
  -- `_test_lock_acquired_at` onto the decided context (context || {..}, never a
  -- replacement -- real context state is fully preserved). It rides THIS one
  -- UPDATE as an extra key, not a separate write, so Test B measures the true
  -- write path. This key is NEVER present when p_test_sleep_ms IS NULL, i.e.
  -- never in any real production row -- it is not part of the context schema.
  --
  -- COALESCE LIMITATION (deliberate): for an EXISTING row we keep the stored
  -- tenant_id/user_id and only fall back to the passed values when the stored
  -- one is NULL. Consequence: tenant_id/user_id are effectively write-once --
  -- the FIRST caller to materialise the row wins, and a later call passing a
  -- DIFFERENT tenant_id/user_id will NOT overwrite it. That is correct for our
  -- model (a phone number belongs to one tenant/user) but means this function
  -- is not the place to re-home a number between tenants; that must be an
  -- explicit, separate operation.
  UPDATE whatsapp_sessions
     SET current_flow  = v_session.current_flow,
         current_step  = v_session.current_step,
         context       = CASE
                           WHEN p_test_sleep_ms IS NOT NULL
                             THEN v_session.context
                                  || jsonb_build_object('_test_lock_acquired_at', v_lock_at)
                           ELSE v_session.context
                         END,
         pending_flows = v_session.pending_flows,
         tenant_id     = COALESCE(whatsapp_sessions.tenant_id, p_tenant_id),
         user_id       = COALESCE(whatsapp_sessions.user_id, p_user_id),
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;
