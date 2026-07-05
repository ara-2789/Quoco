-- supabase/migrations/012_whatsapp_session_transition.sql
-- BOT-07 / BOT-21 / BOT-26: atomic WhatsApp session acquire + transition + drain.
--
-- NUMBERING / DEPENDENCY NOTE (read before applying):
-- This feature needs four schema bits that docs/schema.md assigns to
-- migrations that are NOT yet applied:
--   * whatsapp_sessions.pending_flows  -> planned migration 007 (auth surgery,
--     irreversible, blocked on Checkpoint 1 review)
--   * users.status                     -> planned migration 007 (same)
--   * users.messaging_blocked          -> planned migration 007 (same)
--   * whatsapp_sessions.phone_number UNIQUE -> planned migration 009 (runs last)
-- users.status + users.messaging_blocked are needed NOW because the webhook
-- must refuse inbound from a non-active / blocked number (BOT-08 / ENG-02);
-- without them the gate cannot be enforced.
-- Rather than pull the irreversible 007 forward or reorder 009, we follow the
-- 011 precedent and add ONLY these four independent items here, guarded so they
-- are safe no-ops if 007/009 ever run. When 007 and 009 are finally authored,
-- they MUST make their pending_flows / status / messaging_blocked /
-- phone_number-UNIQUE steps idempotent (IF NOT EXISTS) so they do not collide
-- with what this migration created.

-- ---------------------------------------------------------------------------
-- (A) Schema: pending_flows column, phone_number uniqueness, and
--     users.status / users.messaging_blocked (all guarded, IF NOT EXISTS).
-- ---------------------------------------------------------------------------

-- pending_flows: ordered queue of flows waiting behind the active flow.
-- Each entry is shaped {type, priority, queued_at} (see BOT-26 below).
ALTER TABLE whatsapp_sessions
  ADD COLUMN IF NOT EXISTS pending_flows JSONB DEFAULT '[]'::jsonb;

-- ON CONFLICT (phone_number) needs a unique index/constraint on the column.
-- A unique index satisfies the conflict arbiter and is idempotent to create.
CREATE UNIQUE INDEX IF NOT EXISTS uq_whatsapp_sessions_phone_number
  ON whatsapp_sessions (phone_number);

-- users.status + users.messaging_blocked: the webhook MUST refuse inbound from
-- a number that is not an ACTIVE, non-blocked user (BOT-08 / ENG-02) — a
-- 'pending' (pre-opt-in) or 'deactivated' engineer must not transact with the
-- bot. Pulled forward from planned migration 007 (see numbering note above),
-- guarded so they are safe no-ops if 007 later runs. Both are additive with
-- safe defaults. 007 MUST guard its own versions of these adds (IF NOT EXISTS)
-- so they do not collide with what this migration created.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('pending', 'active', 'deactivated'));

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS messaging_blocked BOOLEAN NOT NULL DEFAULT false;

-- ---------------------------------------------------------------------------
-- (B) The SINGLE "same operating day" expression (BOT-07, constraint #6).
--     Computed as a date comparison in Asia/Kolkata — NEVER UTC, never a raw
--     timestamp compare. Lives in exactly ONE place and is reused everywhere
--     "same operating day" is checked.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION quoco_same_ist_day(a TIMESTAMPTZ, b TIMESTAMPTZ)
RETURNS BOOLEAN
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT (a AT TIME ZONE 'Asia/Kolkata')::date
       = (b AT TIME ZONE 'Asia/Kolkata')::date;
$$;

-- ---------------------------------------------------------------------------
-- (C) acquire_and_transition_session
--     Constraints #1 + #2: the acquire (atomic upsert), the read of current
--     state, the transition decision, and the final write ALL happen inside
--     this ONE function = ONE transaction. The ON CONFLICT ... DO UPDATE takes
--     the row lock and holds it for the rest of the function, so no concurrent
--     caller on the same phone_number can interleave its read/write with ours.
-- ---------------------------------------------------------------------------
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

  -- (Test B only) Hold the row lock across an injected pause so a second
  -- concurrent caller is forced to block on the acquire until we commit.
  -- This proves the lock genuinely spans acquire -> decide -> save.
  IF p_test_sleep_ms IS NOT NULL THEN
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
    -- and we do NOT queue a duplicate of it. BOT-07 same-day resume applies —
    -- current_flow/current_step/context are kept as-is; only the TTL is
    -- refreshed by the write below.
  END IF;

  -- (4) SINGLE WRITE. Always refresh the 30-minute TTL + updated_at, and
  -- persist the decision. Same transaction, lock still held.
  --
  -- COALESCE LIMITATION (deliberate): for an EXISTING row we keep the stored
  -- tenant_id/user_id and only fall back to the passed values when the stored
  -- one is NULL. Consequence: tenant_id/user_id are effectively write-once —
  -- the FIRST caller to materialise the row wins, and a later call passing a
  -- DIFFERENT tenant_id/user_id will NOT overwrite it. That is correct for our
  -- model (a phone number belongs to one tenant/user) but means this function
  -- is not the place to re-home a number between tenants; that must be an
  -- explicit, separate operation.
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

  RETURN v_session;
END;
$$;

-- ---------------------------------------------------------------------------
-- (D) drain_next_pending_flow (BOT-26)
--     When a flow completes, promote the next queued flow. Stable order:
--     ORDER BY (priority, queued_at) ascending -> safety(0) before
--     scheduled_trigger(1) before other(2); FIFO within equal priority.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION drain_next_pending_flow(
  p_phone_number TEXT,
  p_now          TIMESTAMPTZ DEFAULT now()
)
RETURNS whatsapp_sessions
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_session whatsapp_sessions;
  v_chosen  JSONB;
  v_rest    JSONB;
BEGIN
  -- Lock the row for the whole transaction before touching the queue.
  SELECT * INTO v_session
    FROM whatsapp_sessions
   WHERE phone_number = p_phone_number
   FOR UPDATE;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- EMPTY QUEUE -> safe no-op (Test D). NOTE: this empty-list path is the
  -- ONLY drain behaviour under test today. Draining a NON-empty queue is not
  -- yet integration-tested end-to-end because the only real producer of
  -- pending_flows is the cron trigger routes (BOT-21), which do not exist
  -- yet. Known follow-up when those routes land -- not a gap in this scope.
  IF COALESCE(jsonb_array_length(v_session.pending_flows), 0) = 0 THEN
    RETURN v_session;
  END IF;

  -- Split the queue into (chosen head, remaining tail) by the stable order.
  WITH ordered AS (
    SELECT e,
           row_number() OVER (
             ORDER BY (e->>'priority')::int, (e->>'queued_at')::timestamptz
           ) AS rn
      FROM jsonb_array_elements(v_session.pending_flows) e
  )
  SELECT (SELECT e FROM ordered WHERE rn = 1),
         COALESCE((SELECT jsonb_agg(e ORDER BY rn) FROM ordered WHERE rn > 1), '[]'::jsonb)
    INTO v_chosen, v_rest;

  UPDATE whatsapp_sessions
     SET current_flow  = v_chosen->>'type',
         current_step  = 0,
         context       = '{}'::jsonb,
         pending_flows = v_rest,
         expires_at    = p_now + INTERVAL '30 minutes',
         updated_at    = p_now
   WHERE id = v_session.id
  RETURNING * INTO v_session;

  RETURN v_session;
END;
$$;
