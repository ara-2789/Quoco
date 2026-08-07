-- ============================================================================
-- 999_zz_ci_acceptance_probe.sql
-- ----------------------------------------------------------------------------
-- THROWAWAY — P2 stage 2 acceptance-criterion probe (docs/reviews/p2-ci-gates.md).
-- Proves the migration linter catches a genuinely NEW violation in a NEW
-- file: no tenant_id, no RLS enable.
--
-- THIS FILE MUST NEVER ACTUALLY APPLY ANYWHERE — not to test-db, not to
-- prod. It exists to be linted, observed failing, and deleted on this same
-- branch. This PR is never merged.
-- ============================================================================

CREATE TABLE zz_ci_probe_table (
    id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ DEFAULT now(),
    some_field TEXT
);
