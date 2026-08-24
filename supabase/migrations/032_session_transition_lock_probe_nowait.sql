-- supabase/migrations/032_session_transition_lock_probe_nowait.sql
-- Test-only NOWAIT lock probe for test/session-transition.test.ts's Test B.
--
-- NUMBERING NOTE: `ls supabase/migrations/` on `main` shows 029 as the
-- latest applied file, making 030 the next free slot by that check alone.
-- 030 and 031 are BOTH deliberately SKIPPED here, for two separate reasons:
--   * 030 -- `030_morning_flow_attendance.sql` already exists, written and
--     reviewed, on the unmerged `feat/morning-flow-attendance-migration`
--     branch (not yet submitted for external review as of this file's
--     authoring). Taking 030 on `main` here would collide with that pending
--     file the moment it merges.
--   * 031 -- CLAUDE.md §3's own text already informally reserves this
--     number for a DIFFERENT, much larger piece of planned work: "the
--     #69/031 outbound-send primitive." Taking 031 here would collide with
--     that project's own existing plan, not merely a bare `ls`'s blind spot.
-- This file takes 032 instead, reserving both 030 and 031 for their own
-- eventual work -- the CLAUDE.md "confirm the true next number" rule's own
-- intent (don't collide with known pending work), applied to two cases a
-- bare `ls` can't see on its own.
--
-- WHY THIS EXISTS. Test B (`test/session-transition.test.ts`) proves two
-- concurrent callers on the same phone number serialize on the row lock.
-- Its original setup fired caller 1, slept 100ms client-side, then fired
-- caller 2 -- RELYING on that gap to guarantee caller 1 reached Postgres
-- first. Nothing enforced it; see docs/reviews/session-transition-lock-
-- wait-flake.md for the full incident (three real CI failures, an initial
-- retry-based fix that only masked a process-level bias, and this, the
-- actual ordering guarantee). This function lets the TEST directly OBSERVE
-- that caller 1 currently holds the row lock, from a SEPARATE connection,
-- before it ever dispatches caller 2 -- removing the latency dependency
-- entirely, rather than retrying around it.
--
-- MECHANISM. `SELECT ... FOR UPDATE NOWAIT` on an EXISTING row either
-- acquires the row lock immediately (nobody else holds it) or raises
-- `lock_not_available` (SQLSTATE 55P03) immediately if another transaction
-- already holds it -- Postgres's lock manager surfaces this synchronously,
-- independent of MVCC snapshot visibility, so it works even while the
-- OTHER transaction (caller 1's) is still uncommitted. This ONLY works on a
-- row that already EXISTS as a committed row before the probe runs -- an
-- uncommitted INSERT creating a brand-new row is invisible to any other
-- session's queries until commit, so the test must SEED the target row
-- (idle, empty context -- identical starting state to what a genuinely
-- fresh INSERT would produce) before firing either caller.
--
-- SCOPE, DELIBERATELY MINIMAL. Read-only: acquires and immediately releases
-- (function returns, auto-committing transaction ends) -- never writes
-- anything, never blocks a real caller, reveals only a BOOLEAN (locked /
-- not locked) for a caller-supplied phone number. `service_role`-only,
-- same restriction as every other test/RPC surface in this project
-- (021_index_hygiene / 013's own precedent) -- never reachable by `anon` or
-- `authenticated`. Not gated behind a parameter the way 013's
-- `p_test_sleep_ms` is, because there is no "production" call site for this
-- at all -- it exists purely for `test/session-transition.test.ts` to call
-- directly, the same shape as `quoco_same_ist_day` (012) needing no grant
-- restriction because there is nothing here to protect beyond limiting the
-- caller to server-side code.
CREATE OR REPLACE FUNCTION quoco_test_row_is_locked(p_phone_number TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row whatsapp_sessions%ROWTYPE;
BEGIN
  BEGIN
    SELECT * INTO v_row
    FROM whatsapp_sessions
    WHERE phone_number = p_phone_number
    FOR UPDATE NOWAIT;
    -- Acquired cleanly (or no row exists yet) -- not locked by anyone else.
    RETURN false;
  EXCEPTION WHEN lock_not_available THEN
    -- SQLSTATE 55P03 -- another transaction currently holds this row's lock.
    RETURN true;
  END;
END;
$$;

-- =============================================================================
-- Grant -- service_role only, matching every other test-diagnostic surface
-- in this project (migration-lint's no-orphan-security-definer rule).
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.quoco_test_row_is_locked(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quoco_test_row_is_locked(text) TO service_role;
