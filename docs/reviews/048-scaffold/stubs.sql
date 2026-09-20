-- NAMED STUBS for the disposable 048 dry-run scaffold (CLAUDE.md §7). Not part of any migration.
-- Stub 1: roles the dump's OWNER TO / GRANT / REVOKE lines reference.
-- Roles are cluster-level, so creation is idempotent across database rebuilds.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role NOLOGIN BYPASSRLS; END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'supabase_auth_admin') THEN CREATE ROLE supabase_auth_admin NOLOGIN; END IF;
END $$;
-- Stub 2: auth schema. auth.uid() reads the same request GUCs Supabase's own does,
-- so a test can set the caller with set_config('request.jwt.claim.sub', <uuid>, true).
CREATE SCHEMA auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$$;
GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role, postgres;
-- Stub 3: schema privileges Supabase gives by default on public.
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role, postgres;
