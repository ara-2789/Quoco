-- docs/reviews/048_test_047_unused_rights_check.sql
-- D4's live-test helper for migration 047 (revoke unused table rights).
--
-- HELD, NOT APPLIED. Per CLAUDE.md's own "a migration file enters
-- supabase/migrations/ when it is being applied, not when it is written"
-- rule, this file stays in docs/reviews/ until an apply actually happens.
-- MUST BE APPLIED TO TEST-DB ONLY, ALONGSIDE 047's OWN TEST-DB REHEARSAL
-- (a later pass -- this pass writes the file only, applies nothing to any
-- database). Never applied to prod -- there is no live call site for this
-- function outside test/migration-047.test.ts, the same reasoning
-- 032_session_transition_lock_probe_nowait.sql's own header already gives
-- for quoco_test_row_is_locked.
--
-- SAME STRUCTURAL PRECEDENT AS quoco_test_row_is_locked (migration 032,
-- supabase/migrations/032_session_transition_lock_probe_nowait.sql),
-- FOLLOWED EXACTLY: SECURITY DEFINER, SET search_path = public, REVOKE
-- EXECUTE FROM PUBLIC, anon, authenticated, GRANT EXECUTE TO service_role
-- only. No parameter gating (032's own reasoning: "there is no
-- 'production' call site for this at all -- it exists purely for
-- [the test] to call directly").
--
-- PRECEDENT NOTE -- FLAGGED, NOT RESOLVED HERE. docs/reviews/032-ledger-
-- repair-record.md (2026-08-31) records migration 032's own
-- schema_migrations row being repaired on PRODUCTION (`supabase migration
-- repair --status applied 032 --linked`, post-repair probe:
-- `ledger_has_032: 1`) -- i.e. prod's LEDGER says 032 is applied. This is
-- in apparent tension with a separate, later, live observation made this
-- same session (2026-09-16, during migration 046's own prod apply): a
-- `supabase gen types typescript --linked` run while linked to PROD
-- produced output differing from test-db's own committed types/
-- database.ts by exactly one entry -- `quoco_test_row_is_locked` present
-- on test-db, ABSENT from prod's live-generated types. A ledger row and a
-- live schema object are two different facts (CLAUDE.md's own "a record
-- of a thing is not the thing" rule) -- `supabase migration repair` only
-- writes the bookkeeping row, it does not execute or verify any SQL, so a
-- ledger saying "applied" does not by itself prove the function exists on
-- prod today. This file's own task explicitly has no prod access this
-- pass, so this was NOT re-investigated live against prod here -- named
-- for Aravind's attention, not silently treated as settled either way.
-- This file's own design does not depend on the answer: it is held,
-- unapplied, until a later, explicit test-db-only apply pass, same as
-- every other held file in this project.
--
-- WHAT THIS RETURNS. One row, two counts -- exactly the two invariants
-- migration 047's own final DO block checks live, at apply time: the
-- count of DELETE/TRUNCATE/TRIGGER/REFERENCES/MAINTAIN grants to anon/
-- authenticated on any public table (via pg_class.relacl/aclexplode(),
-- not information_schema -- see 047's own header DATED CORRECTION for
-- why), and the count of polcmd 'd' (DELETE-command) RLS policies in
-- public. test/migration-047.test.ts's own D4 test asserts both are zero
-- via this function, calling it through testClient() (service_role) the
-- same way test/session-transition.test.ts calls
-- quoco_test_row_is_locked.
--
-- =============================================================================

CREATE OR REPLACE FUNCTION quoco_test_047_unused_rights_check()
RETURNS TABLE(grant_count BIGINT, policy_count BIGINT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    (
      SELECT count(*)::BIGINT
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
      CROSS JOIN LATERAL aclexplode(c.relacl) a
      WHERE n.nspname = 'public'
        AND c.relkind = 'r'
        AND pg_get_userbyid(a.grantee) IN ('anon', 'authenticated')
        AND a.privilege_type IN ('DELETE', 'TRUNCATE', 'TRIGGER', 'REFERENCES', 'MAINTAIN')
    ) AS grant_count,
    (
      SELECT count(*)::BIGINT
      FROM pg_policy pol
      JOIN pg_class c ON c.oid = pol.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND pol.polcmd = 'd'
    ) AS policy_count;
END;
$$;

-- =============================================================================
-- Grant -- service_role only, matching 032's own quoco_test_row_is_locked
-- precedent exactly.
-- =============================================================================
REVOKE EXECUTE ON FUNCTION public.quoco_test_047_unused_rights_check() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.quoco_test_047_unused_rights_check() TO service_role;
