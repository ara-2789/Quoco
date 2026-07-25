-- =============================================================================
-- 020_function_execute_hardening.sql
-- SECURITY (HIGH, PRE-EXISTING) — lock down EXECUTE on SECURITY DEFINER functions
-- that PostgreSQL granted to PUBLIC by default at CREATE time (live since 012,
-- 2026-07-05). PUBLIC includes `anon`, so anyone holding the public anon key can
-- call these via PostgREST /rpc/ directly.
--
-- THE HOLE: three functions are PARAMETER-TRUSTING — they take p_user_id (and
-- p_tenant_id) as caller input and derive NO identity from auth.uid(). With the
-- default PUBLIC grant, an anon caller can invoke them straight through PostgREST
-- and forge check-in / session data for ANY engineer — bypassing the webhook,
-- Twilio's X-Twilio-Signature HMAC check, and SID idempotency entirely. That is
-- the whole trust boundary of the bot, sidestepped.
--
-- FIX: revoke the default PUBLIC/role grants and re-grant EXECUTE to exactly the
-- role each function is actually called by. One transaction. Signatures below are
-- pulled VERBATIM from the live migration files (not memory), using the CURRENT
-- definition after every CREATE-OR-REPLACE / DROP:
--   * acquire_and_transition_session — 013 (replaced 012 in place, same sig)
--   * apply_morning_flow_turn        — 018 (018:55 DROPs 014's 8-arg sig first;
--                                       only the 12-arg version exists)
--   * drain_next_pending_flow        — 012 (single definition)
--   * complete_onboarding            — 016 (005/007/016 all (text,text,text))
--   * get_user_tenant_id / handle_new_user — 007
-- Verified: NO orphan overloads survive (each prior version was replaced in place
-- or explicitly dropped). The rehearsal's pg_proc.proacl probe is the live
-- confirmation of that + of the post-apply ACLs.
--
-- NOT COVERED HERE (deliberate):
--   * quoco_same_ist_day(timestamptz, timestamptz) [012] — a pure date helper,
--     no p_user_id, no data access; harmless even if PUBLIC-callable. Left as-is
--     unless review wants it hardened too.
--
-- OUT-OF-BAND OBJECT INCLUDED: rls_auto_enable() has NO migration-file history
-- (prod-only, dashboard-created — see CLAUDE.md OUT-OF-BAND DB OBJECTS registry).
-- Its signature/owner/invocation were confirmed from the live prod pg_proc +
-- event-trigger probe (not the files). This migration is the FIRST to reference
-- it. Because it is PROD-ONLY, its REVOKE is existence-guarded (LANDMINE 3) so
-- this same migration applies cleanly on test-db too.
--
-- RISK CLASS: grants-only, fully reversible (DOWN restores the prior grants — see
-- block at end). But the BLAST RADIUS of a WRONG revoke is product-wide (landmine
-- #1), so this carries the same external-review + rehearsal gate as 007/015/017.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- CLASS 1 — parameter-trusting, NO in-body auth.uid() identity check. These are
-- server-only (the webhook calls them via the service-role client). Strip every
-- caller-reachable grant; re-grant to service_role only.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.acquire_and_transition_session(
  text, uuid, uuid, text, text, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.acquire_and_transition_session(
  text, uuid, uuid, text, text, timestamptz, integer
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(
  text, uuid, uuid, uuid, text, boolean, jsonb, boolean, jsonb, boolean, timestamptz, integer
) TO service_role;

REVOKE EXECUTE ON FUNCTION public.drain_next_pending_flow(
  text, timestamptz
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.drain_next_pending_flow(
  text, timestamptz
) TO service_role;

-- -----------------------------------------------------------------------------
-- CLASS 2 — auth.uid()-deriving, self-guarding (matches the caller's OWN row).
-- Safe for authenticated, but no reason for anon/PUBLIC to hold it. Re-assert the
-- authenticated grant explicitly (005:86 granted it; don't assume it survives the
-- PUBLIC revoke — it does, being a separate grant, but state it to be sure).
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.complete_onboarding(
  text, text, text
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_onboarding(
  text, text, text
) TO authenticated;

-- -----------------------------------------------------------------------------
-- LANDMINE 1 — get_user_tenant_id(): called BY RLS policies, which execute their
-- functions as the QUERYING role. `authenticated` MUST retain EXECUTE or EVERY
-- tenant-scoped dashboard read breaks product-wide. Revoke PUBLIC/anon ONLY; keep
-- (re-assert) authenticated. Rehearsal MUST verify an ordinary dashboard read
-- still returns rows post-apply.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.get_user_tenant_id() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO authenticated;

-- -----------------------------------------------------------------------------
-- LANDMINE 2 — handle_new_user(): the AFTER INSERT ON auth.users trigger fn.
-- Trigger execution does NOT re-check EXECUTE (it is checked at trigger-creation),
-- so revoking every caller grant does not stop the trigger firing. Strip all
-- caller grants; GRANT supabase_auth_admin (the role Supabase Auth inserts as)
-- belt-and-braces. Rehearsal MUST verify a REAL magic-link signup end-to-end,
-- not just a unit test.
-- -----------------------------------------------------------------------------
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;

-- -----------------------------------------------------------------------------
-- LANDMINE 3 — rls_auto_enable(): OUT-OF-BAND object, no migration-file history
-- (prod-only; dashboard-created — CLAUDE.md OUT-OF-BAND DB OBJECTS registry).
-- Confirmed via the live prod pg_proc + event-trigger probe: it is the function
-- behind the `ensure_rls` EVENT TRIGGER (fires on ddl_command_end) — a
-- defense-in-depth helper that auto-enables ROW LEVEL SECURITY on every new
-- public-schema table. No regular table trigger references it. It is fired by the
-- event trigger as owner=postgres, NEVER caller-invoked — same shape as
-- handle_new_user (landmine 2): event-trigger firing does NOT check the
-- function's own EXECUTE ACL, so stripping every caller grant cannot stop it.
-- Strip all caller grants; no re-grant. First migration to reference it.
--
-- EXISTENCE-GUARDED: rls_auto_enable exists on PROD only (absent on test-db). A
-- bare REVOKE on a missing function ERRORS and would abort this whole
-- (BEGIN..COMMIT) migration on the test-db apply. The DO block runs the REVOKE
-- only where the function exists (prod) and no-ops with a NOTICE on test-db. So
-- there is no test-db ACL test for it — its verification is the PROD proacl
-- probe, post-apply.
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc
    WHERE proname = 'rls_auto_enable' AND pronamespace = 'public'::regnamespace
  ) THEN
    EXECUTE 'REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated';
  ELSE
    RAISE NOTICE 'rls_auto_enable() absent (expected on test-db) — skipping its REVOKE';
  END IF;
END $$;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference — grants-only, no PITR dependency). Restores the
-- PostgreSQL default (EXECUTE to PUBLIC) for each. Note: this re-opens the hole;
-- only for emergency revert.
-- -----------------------------------------------------------------------------
-- BEGIN;
--   GRANT EXECUTE ON FUNCTION public.acquire_and_transition_session(text,uuid,uuid,text,text,timestamptz,integer) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.apply_morning_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,boolean,jsonb,boolean,timestamptz,integer) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.drain_next_pending_flow(text,timestamptz) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.complete_onboarding(text,text,text) TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.get_user_tenant_id() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.handle_new_user() TO PUBLIC;
--   GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO PUBLIC;  -- PROD only
-- COMMIT;
-- =============================================================================
