-- TEST-DB-ONLY. NEVER APPLY THIS TO PRODUCTION. NEVER MOVE THIS FILE INTO
-- supabase/migrations/. NO MIGRATION NUMBER -- see WHY THIS FILE below.
--
-- Target: test-db ONLY (project ref exfccwlrhoutkgrlikod). NOT prod
-- (jvxwqignooseazzmwhvl).
--
-- WHAT THIS DOES: creates quoco_test_047_unused_rights_check(), the D4
-- live-test helper for migration 047 (revoke unused table rights). One
-- row, two counts -- exactly the two invariants migration 047's own final
-- DO block checks live, at apply time: the count of DELETE/TRUNCATE/
-- TRIGGER/REFERENCES/MAINTAIN grants to anon/authenticated on any public
-- table (via pg_class.relacl/aclexplode(), not information_schema -- see
-- 047's own header DATED CORRECTION for why), and the count of polcmd 'd'
-- (DELETE-command) RLS policies in public. test/migration-047.test.ts's
-- own D4 test asserts both are zero via this function, calling it through
-- testClient() (service_role) the same way test/session-transition.
-- test.ts calls quoco_test_row_is_locked.
--
-- APPLY: BY HAND, alongside migration 047's own test-db apply -- not part
-- of 047's own file, not part of any automated pipeline.
--
-- WHY THIS FILE, NOT A MIGRATION NUMBER (Aravind's decision, 2026-09-16):
-- this helper has no production call site -- it exists purely for
-- test/migration-047.test.ts to call directly, the same reasoning
-- quoco_test_row_is_locked's own migration (032) already gives for
-- itself. Giving a test-only object a migration number is exactly the
-- shape that produced 032's own ledger/reality mismatch (see "Backlog:
-- 032 ledger mismatch" in docs/reviews/047-review-package.md for the full
-- account, and the PROD FACT recorded there) -- a numbered migration
-- implies "this belongs in every database's ledger," which is false for
-- an object with no production reason to exist. Living in scripts/,
-- unnumbered, keeps prod's ledger truthful by construction: nothing here
-- can ever be mistaken for a migration to apply anywhere. Same mechanism
-- as scripts/test-db-only-grants.sql (that file's own header): every
-- apply/rehearsal/lint tool this project uses -- `supabase db push`,
-- `supabase db query --linked -f`, scripts/lint-migrations.mjs, the CI
-- "Migration Lint" job -- scans ONLY supabase/migrations/*.sql and
-- docs/reviews/^\d+_.*\.sql (files matching a numbered-migration
-- filename pattern). This file lives in scripts/, has no numeric prefix,
-- and will never be picked up by any of them.
--
-- EXECUTE for service_role only (SECURITY DEFINER, REVOKE FROM PUBLIC,
-- anon, authenticated; GRANT TO service_role) -- same structural
-- precedent as quoco_test_row_is_locked (migration 032,
-- supabase/migrations/032_session_transition_lock_probe_nowait.sql),
-- followed exactly. No parameter gating, same reasoning 032's own header
-- gives: there is no production call site for this at all.
--
-- Run once. `CREATE OR REPLACE` -- idempotent on re-run.

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
