-- =============================================================
-- 005_auth_trigger.sql
-- Auth + onboarding plumbing:
--   1. Relax NOT NULL on users.tenant_id / users.role
--      so the trigger can create a stub row before onboarding.
--   2. Patch users_select policy to allow own-row reads
--      (pre-onboarding users have null tenant_id, so the old
--       policy `tenant_id = get_user_tenant_id()` returned nothing).
--   3. handle_new_user trigger — inserts a stub public.users row
--      whenever a new auth.users row is created.
--   4. complete_onboarding RPC — creates the tenant and claims it
--      atomically, runs SECURITY DEFINER to bypass RLS.
-- =============================================================


-- =============================================================
-- 1. Relax constraints
-- =============================================================

ALTER TABLE users ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE users ALTER COLUMN role      DROP NOT NULL;


-- =============================================================
-- 2. Patch users_select — allow reading own row before onboarding
-- =============================================================

DROP POLICY "users_select" ON users;

CREATE POLICY "users_select" ON users
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR tenant_id = get_user_tenant_id());


-- =============================================================
-- 3. Trigger: auto-insert stub row into public.users on signup
-- =============================================================

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  INSERT INTO public.users (id)
  VALUES (NEW.id);
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();


-- =============================================================
-- 4. Onboarding RPC: create tenant + claim it in one transaction
-- =============================================================

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
  WHERE id = auth.uid();

  RETURN v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.complete_onboarding(TEXT, TEXT, TEXT) TO authenticated;
