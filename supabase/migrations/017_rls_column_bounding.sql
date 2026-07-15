-- supabase/migrations/017_rls_column_bounding.sql
-- SECURITY — systemic follow-up to 015/HIGH-1. 015 column-bounded users_update;
-- 017 closes the same CLASS of hole on every other UPDATE path, and adds the
-- owner_user_id same-tenant enforcement deferred from 016 (backlog item 9).
-- Full audit + pinned prod pre-state: docs/reviews/017-review-package.md.
--
-- RISK CLASS: STRUCTURAL (NOT grants-only). Per reviewer O2 = option A, the
-- same-tenant guarantee is a UNIQUE index + composite FK, not a trigger. So this
-- migration carries structural DDL (a new unique constraint + FK swaps) and takes
-- the full runbook: PITR restore-window OBSERVED at prod apply (CLAUDE.md §0),
-- reviewer-gated. The column-bounding / anon-strip steps are grants-class + reversible.
--
-- WHY COMPOSITE FK, NOT TRIGGER (reviewer B1): a BEFORE-trigger doing
-- `SELECT ... FOR KEY SHARE` on the referenced user does NOT close the TOCTOU race —
-- FOR KEY SHARE conflicts only on KEY columns, and tenant_id is not part of any
-- unique index on users, so the lock never blocks a concurrent tenant_id repoint
-- (the exact write the race worried about). The composite FK's atomicity comes from
-- the UNIQUE(id, tenant_id) INDEX. The FK is also RLS-independent (unlike the
-- trigger, whose correctness was coupled to RLS WITH CHECK pinning NEW.tenant_id).
--
-- APPLY: dashboard SQL Editor (CLI IPv6/28P01-blocked, see docs/schema.md 013 note),
-- branch-verified first, artifact-provenance-pinned per §0. Regenerate types after.
--
-- ROLLBACK (reversible; no data loss): drop the composite FKs and re-add the plain
-- single-column FKs; drop the UNIQUE(id, tenant_id) constraints; restore the blanket
-- table UPDATE grants (GRANT UPDATE ON projects, daily_logs TO authenticated) and the
-- anon write verbs. Down path spelled out at the file end.
--
-- COLUMN-GRANT LISTS ARE PROVISIONING, NOT A LIVE BEHAVIOR CHANGE (locked decision,
-- keep-as-drafted). A grep of app/ + lib/ (2026-07-15) found ZERO authenticated UPDATE
-- code paths on projects or daily_logs today: every touchpoint is a read-only SELECT
-- (dashboard dprs/project-detail views) or a separate INSERT flow (projects/new); the
-- only writers are the service-role morning-flow RPC (bypasses grants) and the
-- service-role queue worker. There is NO PM-edit dashboard yet. So the granted/excluded
-- split in Steps 3/4 changes no current behavior under EITHER choice — it is
-- conservative provisioning for a future feature, excluding structural/identity and
-- RPC-managed submission-metadata columns by default. Grant classification:
-- ~/Desktop/017-grant-lists.txt / §4 of the review package.
--   *** FORWARD-POINTER: when a PM-edit dashboard is eventually built, that work MUST
--   consult this grant list and widen specific columns as needed (e.g. GRANT UPDATE
--   (log_date) if a "correct submission date" feature ships). Do not assume the
--   current exclusions are permanent product decisions — they are the safe default
--   for "no writer exists yet." ***

BEGIN;

-- =============================================================================
-- STEP 1 — UNIQUE(id, tenant_id) parents for the composite FKs.
-- Both are strict SUPERSETS of the existing PRIMARY KEY(id): since id is already
-- unique, every (id, tenant_id) pair is already unique, so these build instantly
-- and CANNOT fail on existing data. They exist solely to be FK-referenceable.
-- =============================================================================
ALTER TABLE public.users
  ADD CONSTRAINT users_id_tenant_id_key UNIQUE (id, tenant_id);

ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_tenant_id_key UNIQUE (id, tenant_id);

-- =============================================================================
-- STEP 2 — Composite same-tenant FKs (option A). Drop each plain single-column FK
-- and re-add it as a composite FK that also pins tenant_id, so the referenced row
-- MUST live in the same tenant as the referencing row. Enforced on ALL writers
-- (incl. service role — an FK is not bypassed by any role).
-- =============================================================================

-- projects.owner_user_id -> users(id, tenant_id).
-- MATCH SIMPLE (the default): owner_user_id is NULLABLE, and under MATCH SIMPLE a
-- NULL in ANY referencing column skips the check entirely — correct, because an
-- unassigned owner (NULL) is a valid state. *** DO NOT change to MATCH FULL later ***:
-- MATCH FULL would require both columns null-or-both-present and would reject a NULL
-- owner on a (non-null) tenant row. Preserves 016's ON DELETE RESTRICT.
ALTER TABLE public.projects DROP CONSTRAINT projects_owner_user_id_fkey;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_owner_user_id_fkey
  FOREIGN KEY (owner_user_id, tenant_id) REFERENCES public.users (id, tenant_id)
  ON DELETE RESTRICT;

-- project_members.user_id -> users(id, tenant_id). user_id is NOT NULL, so the check
-- is ALWAYS enforced (MATCH SIMPLE vs FULL is moot). Preserves ON DELETE CASCADE.
ALTER TABLE public.project_members DROP CONSTRAINT project_members_user_id_fkey;
ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_user_id_fkey
  FOREIGN KEY (user_id, tenant_id) REFERENCES public.users (id, tenant_id)
  ON DELETE CASCADE;

-- project_members.project_id -> projects(id, tenant_id). NOT NULL, always enforced.
ALTER TABLE public.project_members DROP CONSTRAINT project_members_project_id_fkey;
ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_project_id_fkey
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id)
  ON DELETE CASCADE;

-- =============================================================================
-- STEP 3 — COLUMN-BOUND OUT: projects. Revoke the blanket table UPDATE from
-- authenticated and re-grant ONLY the PM-editable business columns. Excluded (never
-- authenticated-writable): tenant_id, created_by (attribution), id, created_at
-- (structural/immutable). owner_user_id stays writable but is FK-guarded (Step 2).
-- 42501 (upstream of RLS) now rejects any UPDATE touching an excluded column.
-- =============================================================================
REVOKE UPDATE ON public.projects FROM authenticated;
GRANT  UPDATE (
  name, client_name, client_contact, contract_type, contract_value,
  expected_end_date, project_type, site_address, start_date, status,
  tender_id, owner_user_id
) ON public.projects TO authenticated;

-- =============================================================================
-- STEP 4 — COLUMN-BOUND OUT: daily_logs. Authenticated writers are pm/admin/qs
-- corrections (engineers have auth_id=NULL, no web login — CLAUDE.md §5). Grant the
-- observational / correction columns only. Excluded: engineer_id, project_id
-- (identity — FK repoint surface), dpr_approved_by, dpr_content (O1 = exclude; DPR
-- narrative editing is Fast-Follow, re-grant behind a role gate if/when it ships),
-- dpr_generated_at + *_submitted_at/_via (RPC-managed submission metadata), id,
-- tenant_id, created_at, log_date (structural/identity).
-- =============================================================================
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower_planned, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies
) ON public.daily_logs TO authenticated;

-- =============================================================================
-- STEP 5 — F4 anon write-strip (defense-in-depth, across ALL public tables).
-- anon has no write policy today so this is not exploitable now, but the privilege
-- layer should bound what it can bound (015's thesis). Strips anon INSERT/UPDATE/
-- DELETE on every base table in public. Idempotent; covers jobs/processed_messages
-- too (their RLS-enable is the SEPARATE F6 residual migration, independent of this).
-- SELECT is untouched (no anon SELECT policy exists; reads stay RLS-denied).
-- =============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon;', r.tablename);
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- DOWN (manual; run only to roll back):
--   BEGIN;
--   -- Step 2 reverse: restore plain single-column FKs
--   ALTER TABLE public.project_members DROP CONSTRAINT project_members_project_id_fkey;
--   ALTER TABLE public.project_members ADD CONSTRAINT project_members_project_id_fkey
--     FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
--   ALTER TABLE public.project_members DROP CONSTRAINT project_members_user_id_fkey;
--   ALTER TABLE public.project_members ADD CONSTRAINT project_members_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--   ALTER TABLE public.projects DROP CONSTRAINT projects_owner_user_id_fkey;
--   ALTER TABLE public.projects ADD CONSTRAINT projects_owner_user_id_fkey
--     FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--   -- Step 1 reverse
--   ALTER TABLE public.projects DROP CONSTRAINT projects_id_tenant_id_key;
--   ALTER TABLE public.users   DROP CONSTRAINT users_id_tenant_id_key;
--   -- Step 3/4 reverse: restore blanket table UPDATE
--   GRANT UPDATE ON public.projects   TO authenticated;
--   GRANT UPDATE ON public.daily_logs TO authenticated;
--   -- Step 5 reverse (only if a rebuild needs the Supabase defaults back):
--   -- GRANT INSERT, UPDATE, DELETE ON <tables> TO anon;
--   COMMIT;
-- =============================================================================
