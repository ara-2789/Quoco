-- ============================================================================
-- 016_corrections.sql
-- ----------------------------------------------------------------------------
-- The corrections migration: the trivial column/type fixes and the role rename
-- that were EVICTED from 007 (the identity-surgery migration) per the
-- checkpoint-1 review §1b, so a bug in a rename could never force rollback
-- pressure on the irreversible auth change. 007 = identity only; this is
-- everything else that 007 originally carried, plus the §11b RPC zero-row guard.
--
-- Fully reversible (no identity surgery here). Down-path at the foot of the file.
-- Rollback safety net is OBSERVED PITR (enabled + observation-verified on prod
-- 2026-07-12, 2-minute granularity, per CLAUDE.md §0) — capture a restore point
-- immediately before apply. A down-script is the convenience, PITR is the net.
--
-- Apply mechanics: SQL Editor is the deliberate fallback (CLI auth-blocked at
-- 28P01, as with 013/014/015). Verify on the test-db branch (exfccwlrhoutkgrlikod)
-- first, then prod, then a manual INSERT into supabase_migrations.schema_migrations
-- (SQL-Editor equivalent of `supabase migration repair --status applied 016`).
--
-- Pre-apply probe evidence (prod, service-role, read-only, 2026-07-12):
--   daily_logs        = 0 rows  -> all TYPE/rename/drop below are data-free
--   safety_incidents  = 0 rows  -> submitted_via CHECK needs no backfill
--   evening_dependencies_tomorrow / _structured : 0 / 0 non-null
--   morning_dependencies / morning_hindrances    : 0 / 0 non-null
--
-- EXPLICITLY DEFERRED (recorded decision, NOT an omission):
--   * complete_onboarding's double-call second-tenant minting (review §11b,
--     "known pre-existing behaviour") is a behavioural redesign entangled with
--     the invitations attach-flow, not a schema correction. Deferred to the
--     invitations work by decision on 2026-07-12. This migration adds only the
--     zero-row GUARD.
--   * projects.owner_user_id has NO same-tenant enforcement — the plain FK lets
--     a project point at an owner row in ANOTHER tenant. Enforcing that is
--     composite-FK / trigger territory; recorded for the backlog item-9 audit
--     (systemic tenant-scoping pass), not fixed here.
-- ============================================================================

BEGIN;

-- ----------------------------------------------------------------------------
-- 1. users.role : 'client' -> 'owner'. This is a value rename INTO a value the
--    old 001 CHECK forbids, so CONSTRAINT-DROP PRECEDES DATA: the old CHECK
--    excludes 'owner', so any UPDATE ... = 'owner' would be rejected while it
--    stands (it "passes" today only because zero 'client' rows exist — not a
--    guarantee to build on). Order: drop old constraint -> update data -> add
--    new constraint. The 001 inline CHECK is auto-named users_role_check by
--    Postgres's <table>_<column>_check convention; we still find it dynamically
--    (INTO STRICT, 007 pattern) as insurance so a mis-count fails loud rather
--    than dropping the wrong constraint if that convention ever didn't hold.
-- ----------------------------------------------------------------------------
DO $$
DECLARE
  v_conname TEXT;
BEGIN
  SELECT conname INTO STRICT v_conname
  FROM pg_constraint
  WHERE conrelid = 'public.users'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%role%';
  EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', v_conname);
EXCEPTION
  WHEN NO_DATA_FOUND THEN
    RAISE EXCEPTION 'migration 016: expected exactly one role CHECK on public.users, found none';
  WHEN TOO_MANY_ROWS THEN
    RAISE EXCEPTION 'migration 016: expected exactly one role CHECK on public.users, found several';
END $$;

UPDATE public.users SET role = 'owner' WHERE role = 'client';

ALTER TABLE public.users
  ADD CONSTRAINT users_role_check
  CHECK (role IN ('pm', 'qs', 'engineer', 'owner', 'subcontractor', 'admin'));

-- ----------------------------------------------------------------------------
-- 2. tenants : rename the Stripe-era column (Razorpay is the actual processor,
--    Stripe paused India onboarding) + add the billing-state columns.
--    NOTE: schema.md L68 wrongly claimed this was "renamed in 006" — it was
--    never renamed in any migration; stripe_customer_id is still live at 001:25.
-- ----------------------------------------------------------------------------
ALTER TABLE public.tenants RENAME COLUMN stripe_customer_id TO payment_customer_id;
ALTER TABLE public.tenants ADD COLUMN paid_until      TIMESTAMPTZ;
ALTER TABLE public.tenants ADD COLUMN last_payment_ref TEXT;

-- ----------------------------------------------------------------------------
-- 3. projects.owner_user_id : links a project to its owner (role='owner') row.
--    FK to users(id) — the standalone id post-007.
-- ----------------------------------------------------------------------------
ALTER TABLE public.projects
  ADD COLUMN owner_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- 4. daily_logs :
--    (a) holiday flag/reason
--    (b) evening_dependencies -> single JSONB per bot-flows.md:106 Q6 spec
--        [{item, responsible_party, required_by_time}]. The 001 draft carried
--        TWO leftover columns (evening_dependencies_tomorrow TEXT +
--        evening_dependencies_structured JSONB); both 0 rows. Rename the JSONB
--        one to the canonical name, drop the superseded TEXT one.
--    (c) morning_dependencies / morning_hindrances TEXT -> JSONB (0 rows; the
--        NULLIF guard is belt-and-braces since the tables are empty).
-- ----------------------------------------------------------------------------
ALTER TABLE public.daily_logs ADD COLUMN is_holiday    BOOLEAN DEFAULT false;
ALTER TABLE public.daily_logs ADD COLUMN holiday_reason TEXT;

ALTER TABLE public.daily_logs DROP COLUMN evening_dependencies_tomorrow;
ALTER TABLE public.daily_logs
  RENAME COLUMN evening_dependencies_structured TO evening_dependencies;

ALTER TABLE public.daily_logs
  ALTER COLUMN morning_dependencies TYPE JSONB USING NULLIF(morning_dependencies, '')::jsonb;
ALTER TABLE public.daily_logs
  ALTER COLUMN morning_hindrances   TYPE JSONB USING NULLIF(morning_hindrances, '')::jsonb;

-- ----------------------------------------------------------------------------
-- 5. invoices.amount : (10,2) -> (12,2). Money is DECIMAL(12,2), no exceptions.
-- ----------------------------------------------------------------------------
ALTER TABLE public.invoices
  ALTER COLUMN amount TYPE DECIMAL(12,2);

-- ----------------------------------------------------------------------------
-- 6. safety_incidents.submitted_via : align the default to a value that is IN
--    the CHECK (001 default was 'whatsapp', which is NOT in the allowed set),
--    backfill any legacy 'whatsapp' rows (0 today), THEN add the CHECK.
--    Data before constraint.
-- ----------------------------------------------------------------------------
ALTER TABLE public.safety_incidents
  ALTER COLUMN submitted_via SET DEFAULT 'whatsapp_scheduled';
UPDATE public.safety_incidents
  SET submitted_via = 'whatsapp_scheduled' WHERE submitted_via = 'whatsapp';
ALTER TABLE public.safety_incidents
  ADD CONSTRAINT safety_incidents_submitted_via_check
  CHECK (submitted_via IN ('whatsapp_scheduled', 'whatsapp_adhoc', 'web_app'));

-- ----------------------------------------------------------------------------
-- 7. hindrances.dpr_included : drop the default (001 had DEFAULT true). It is
--    set by the DPR generation job, not defaulted at insert.
-- ----------------------------------------------------------------------------
ALTER TABLE public.hindrances
  ALTER COLUMN dpr_included DROP DEFAULT;

-- ----------------------------------------------------------------------------
-- 8. complete_onboarding : add the §11b zero-row guard. Body otherwise verbatim
--    from 007:175-199. SECURITY DEFINER preserved (015 T-015-05 proves the
--    DEFINER write path survives the 015 grants); the EXECUTE grant from 005
--    persists across CREATE OR REPLACE. Without the guard a zero-row UPDATE
--    silently returns the fresh tenant_id, orphaning a tenant with no admin.
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.complete_onboarding(
  p_company_name TEXT,
  p_slug         TEXT,
  p_full_name    TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_tenant_id UUID;
  v_rows      INTEGER;
BEGIN
  INSERT INTO public.tenants (name, slug)
  VALUES (p_company_name, p_slug)
  RETURNING id INTO v_tenant_id;

  UPDATE public.users
  SET tenant_id = v_tenant_id,
      full_name = p_full_name,
      role      = 'admin'
  WHERE auth_id = auth.uid();

  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows = 0 THEN
    RAISE EXCEPTION 'complete_onboarding: no users row for auth.uid()=% — refusing to orphan tenant %', auth.uid(), v_tenant_id
      USING ERRCODE = 'no_data_found';
  END IF;

  RETURN v_tenant_id;
END;
$$;

COMMIT;

-- ============================================================================
-- DOWN / ROLLBACK (reference — prefer PITR restore point taken pre-apply)
-- ----------------------------------------------------------------------------
-- BEGIN;
--   -- 8. restore prior complete_onboarding (007 body, no guard)
--   --    (re-run 007:175-199 verbatim)
--   -- 7. ALTER TABLE public.hindrances ALTER COLUMN dpr_included SET DEFAULT true;
--   -- 6. ALTER TABLE public.safety_incidents DROP CONSTRAINT safety_incidents_submitted_via_check;
--   --    ALTER TABLE public.safety_incidents ALTER COLUMN submitted_via SET DEFAULT 'whatsapp';
--   -- 5. ALTER TABLE public.invoices ALTER COLUMN amount TYPE DECIMAL(10,2);
--   -- 4. ALTER TABLE public.daily_logs
--   --      ALTER COLUMN morning_hindrances   TYPE TEXT USING morning_hindrances::text;
--   --    ALTER TABLE public.daily_logs
--   --      ALTER COLUMN morning_dependencies TYPE TEXT USING morning_dependencies::text;
--   --    ALTER TABLE public.daily_logs RENAME COLUMN evening_dependencies TO evening_dependencies_structured;
--   --    ALTER TABLE public.daily_logs ADD COLUMN evening_dependencies_tomorrow TEXT;
--   --    ALTER TABLE public.daily_logs DROP COLUMN holiday_reason;
--   --    ALTER TABLE public.daily_logs DROP COLUMN is_holiday;
--   -- 3. ALTER TABLE public.projects DROP COLUMN owner_user_id;
--   -- 2. ALTER TABLE public.tenants DROP COLUMN last_payment_ref;
--   --    ALTER TABLE public.tenants DROP COLUMN paid_until;
--   --    ALTER TABLE public.tenants RENAME COLUMN payment_customer_id TO stripe_customer_id;
--   -- 1. (mirror of the up-path: constraint-drop precedes the data revert, since
--   --     'client' is forbidden by users_role_check while it stands)
--   --    ALTER TABLE public.users DROP CONSTRAINT users_role_check;
--   --    UPDATE public.users SET role='client' WHERE role='owner';  -- only if reverting the rename
--   --    ALTER TABLE public.users ADD CONSTRAINT users_role_check
--   --      CHECK (role IN ('pm','qs','engineer','subcontractor','client','admin'));
-- COMMIT;
-- ============================================================================
