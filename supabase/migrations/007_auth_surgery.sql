-- =============================================================
-- 007_auth_surgery.sql
-- IDENTITY SURGERY — decouple public.users.id from auth.users.
--
-- Adds a nullable users.auth_id (FK -> auth.users, ON DELETE RESTRICT),
-- backfills it from the current id, makes it unique+indexed, drops the
-- old users.id -> auth.users FK, and repoints the tenant-resolution
-- helper, the signup trigger, the onboarding RPC, and the 8 RLS
-- policies that referenced auth.uid() against users.id onto auth_id.
--
-- Plan of record: docs/migration-007-checkpoint-1-review.md (APPROVED).
-- Scope is IDENTITY ONLY. Explicitly NOT here (see review §1b):
--   * users.status / messaging_blocked / whatsapp_sessions.pending_flows  -> 012 owns them
--   * client -> owner role rename                                         -> corrections migration
--   * column corrections, dprs / resolutions                             -> 008 / corrections
--
-- MUST run as a single transaction. Backfill (step 2) MUST precede the
-- function swap (step 6) or the only real user is locked out (review R1).
--
-- RERUN SEMANTICS — read before re-running:
--   * SINGLE-SHOT script. If a partial apply occurs via the SQL editor (running
--     it outside a transaction, statement by statement), do NOT re-run it
--     statement-by-statement — restore to the PITR mark and re-apply the WHOLE
--     script. The file is fail-brittle by design (step 4 raises on a missing
--     FK; DROP POLICY has no IF EXISTS), which is correct once declared.
--   * This is a ONE-TIME surgery, not an idempotent migration.
--   * The whole file is a single BEGIN..COMMIT, so a FAILED first attempt
--     rolls back completely — it leaves NO partial state. "Re-running" after
--     a failure therefore always starts from the clean pre-007 schema and is
--     safe.
--   * After a SUCCESSFUL apply, a second run ABORTS BY DESIGN at step 4: the
--     FK-drop guard RAISE EXCEPTIONs because users.id -> auth.users no longer
--     exists. That guard is the intended tripwire (a missing FK on rerun means
--     the surgery already happened) — do not "fix" it by making step 4 a
--     silent no-op; that would mask a partial-rerun where the column exists
--     without its FK (review §5, the confdeltype='r' probe).
--   * Individual statements are still guarded where cheap (ADD COLUMN /
--     CREATE INDEX IF NOT EXISTS, backfill WHERE auth_id IS NULL, CREATE OR
--     REPLACE functions, DROP TRIGGER IF EXISTS) so a clean-state rerun is
--     smooth up to the step-4 tripwire.
--
-- APPLY-ORDER NOTE: 007 is numbered below 011-014 but applies to prod AFTER
-- them (011-014 are already live). Audited: 011-014 take p_user_id as a
-- caller-supplied param and never call auth.uid() or resolve users by id, so
-- there is no cross-dependency — 007 applying out of numeric order is safe.
-- =============================================================

BEGIN;

-- -------------------------------------------------------------
-- 1. Add the new nullable link to auth.users.
--    RESTRICT (not SET NULL): review §10a — SET NULL + blind-insert
--    is a duplicate-profile machine.
-- -------------------------------------------------------------
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS auth_id UUID
    REFERENCES auth.users(id) ON DELETE RESTRICT;

-- -------------------------------------------------------------
-- 2. Backfill: every existing row keeps its login via auth_id = id.
--    Preserves the old equality for all current users, so old app
--    code keeps working through the deploy window (review R3).
--    MUST come before the unique index (step 3) and the swaps.
-- -------------------------------------------------------------
UPDATE public.users
   SET auth_id = id
 WHERE auth_id IS NULL;

-- -------------------------------------------------------------
-- 3. Uniqueness + index on auth_id (partial: NULL for whatsapp-only
--    users). Without this, get_user_tenant_id() can resolve to an
--    arbitrary/wrong-tenant row (review R2) and every RLS-guarded
--    query does a seq scan. Named uq_* (a partial unique index is
--    not expressible as a table constraint).
-- -------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_auth_id
  ON public.users(auth_id)
  WHERE auth_id IS NOT NULL;

-- -------------------------------------------------------------
-- 4. Drop the old users.id -> auth.users FK by DYNAMIC lookup
--    (do not hardcode the name; review R5). INTO STRICT so BOTH the
--    zero-FK case (already dropped -> surgery already ran) and the
--    two-FK case (ambiguous -> refuse to guess which to drop) fail
--    loud instead of silently no-op'ing or dropping an arbitrary one.
-- -------------------------------------------------------------
DO $$
DECLARE
  v_conname text;
BEGIN
  BEGIN
    SELECT c.conname
      INTO STRICT v_conname
      FROM pg_constraint c
     WHERE c.conrelid  = 'public.users'::regclass
       AND c.contype   = 'f'
       AND c.confrelid = 'auth.users'::regclass
       AND c.conkey = ARRAY[
         (SELECT a.attnum
            FROM pg_attribute a
           WHERE a.attrelid = 'public.users'::regclass
             AND a.attname  = 'id')
       ];
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      RAISE EXCEPTION
        '007: expected exactly one FK on users.id -> auth.users, found none '
        '(already dropped? this migration is single-shot — see header). Aborting.';
    WHEN TOO_MANY_ROWS THEN
      RAISE EXCEPTION
        '007: found MULTIPLE FKs on users.id -> auth.users; refusing to drop '
        'one blindly. Resolve manually. Aborting.';
  END;

  EXECUTE format('ALTER TABLE public.users DROP CONSTRAINT %I', v_conname);
END $$;

-- -------------------------------------------------------------
-- 4b. NEW STEP (flagged to reviewer — not in the original §5 list):
--     give users.id a default so post-007 inserts can generate it.
--     Pre-007 id was always supplied as auth.uid(); 001 gave it NO
--     default. handle_new_user (step 6) and the ENG-01 engineer
--     insert both now need a generated id via a plain INSERT.
--     Inert for existing rows.
-- -------------------------------------------------------------
ALTER TABLE public.users
  ALTER COLUMN id SET DEFAULT gen_random_uuid();

-- -------------------------------------------------------------
-- 5/6a. Repoint get_user_tenant_id() onto auth_id.
--       Preserve STABLE / SECURITY DEFINER / search_path exactly
--       (review §1a.5 — InitPlan planning depends on STABLE).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM users WHERE auth_id = auth.uid()
$$;

-- -------------------------------------------------------------
-- 6b. handle_new_user(): INSERT-ONLY, corrected insert. Supplies id
--     EXPLICITLY (gen_random_uuid()) rather than leaning on 4b's column
--     default — self-contained, so a future migration dropping that default
--     can't silently reintroduce R4. (4b's default stays for the ENG-01
--     plain-insert path.) auth_id = NEW.id. NO re-link logic — deferred to
--     the invitations deliverable (review §10b; no users.email to match yet).
-- -------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id, auth_id)
  VALUES (gen_random_uuid(), NEW.id);
  RETURN NEW;
END;
$$;

-- Self-contained: (re)create the trigger here rather than assuming 005's
-- CREATE TRIGGER still stands. DROP IF EXISTS keeps a clean-state rerun smooth.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- -------------------------------------------------------------
-- 6c. complete_onboarding(): match the caller by auth_id.
--     Body otherwise identical to 005.
-- -------------------------------------------------------------
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
BEGIN
  INSERT INTO public.tenants (name, slug)
  VALUES (p_company_name, p_slug)
  RETURNING id INTO v_tenant_id;

  UPDATE public.users
  SET tenant_id = v_tenant_id,
      full_name = p_full_name,
      role      = 'admin'
  WHERE auth_id = auth.uid();

  RETURN v_tenant_id;
END;
$$;
-- GRANT from 005 persists across CREATE OR REPLACE; no re-grant needed.

-- -------------------------------------------------------------
-- 7. The 8 RLS policies that reference auth.uid() against users.id.
--    CREATE POLICY has no OR REPLACE -> drop + recreate each.
--    All "pure tenant" policies inherit the helper fix and are
--    untouched (review §3b).
--
--    ROLE-TARGET CHECK (review round 2, item 4): every recreated policy below
--    keeps its 002 original's target verbatim — FOR <cmd> TO authenticated,
--    PERMISSIVE (the default). None widens to PUBLIC or flips to RESTRICTIVE.
--    Verified pair-by-pair against 002_rls_policies.sql / 005 (users_select).
-- -------------------------------------------------------------

-- users_select (last defined in 005:30) — own row now via auth_id.
DROP POLICY "users_select" ON users;
CREATE POLICY "users_select" ON users
  FOR SELECT TO authenticated
  USING (auth_id = auth.uid() OR tenant_id = get_user_tenant_id());

-- users_update (002:81)
DROP POLICY "users_update" ON users;
CREATE POLICY "users_update" ON users
  FOR UPDATE TO authenticated
  USING (auth_id = auth.uid())
  WITH CHECK (auth_id = auth.uid());

-- tenants_update (002:60)
DROP POLICY "tenants_update" ON tenants;
CREATE POLICY "tenants_update" ON tenants
  FOR UPDATE TO authenticated
  USING (
    id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_id = auth.uid()) = 'admin'
  );

-- project_members_insert (002:118)
DROP POLICY "project_members_insert" ON project_members;
CREATE POLICY "project_members_insert" ON project_members
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('pm', 'admin')
  );

-- project_members_update (002:125)
DROP POLICY "project_members_update" ON project_members;
CREATE POLICY "project_members_update" ON project_members
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('pm', 'admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('pm', 'admin')
  );

-- project_members_delete (002:136)
DROP POLICY "project_members_delete" ON project_members;
CREATE POLICY "project_members_delete" ON project_members
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('pm', 'admin')
  );

-- daily_logs_insert (002:176) — engineer_id resolves via auth_id now.
DROP POLICY "daily_logs_insert" ON daily_logs;
CREATE POLICY "daily_logs_insert" ON daily_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
  );

-- daily_logs_update (002:183)
DROP POLICY "daily_logs_update" ON daily_logs;
CREATE POLICY "daily_logs_update" ON daily_logs
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
      OR (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('pm', 'admin', 'qs')
    )
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (
      engineer_id = (SELECT id FROM users WHERE auth_id = auth.uid())
      OR (SELECT role FROM users WHERE auth_id = auth.uid()) IN ('pm', 'admin', 'qs')
    )
  );

COMMIT;
