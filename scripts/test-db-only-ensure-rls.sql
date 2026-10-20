-- scripts/test-db-only-ensure-rls.sql
--
-- TEST-DB ONLY. No migration number, never ledgered, never applied to prod.
-- Purpose: make test-db (exfccwlrhoutkgrlikod) match a prod object that no
-- migration creates. Prod (jvxwqignooseazzmwhvl) has the event trigger
-- `ensure_rls` (ddl_command_end, tags CREATE TABLE / CREATE TABLE AS /
-- SELECT INTO) calling public.rls_auto_enable(), which turns RLS on for every
-- new table in `public`. Test-db lacked it (observed 12 Oct 2026), so a
-- rehearsal could pass with RLS off on a table that prod would give RLS on.
--
-- Source: copied verbatim from prod, 12 Oct 2026, read-only probes by Aravind:
--   pg_get_functiondef('public.rls_auto_enable'::regproc)
--   pg_event_trigger WHERE evtname = 'ensure_rls'
--   prosecdef = true; proconfig = {search_path=pg_catalog}; owner postgres;
--   proacl = {postgres=X/postgres,service_role=X/postgres}
--
-- Guard: refuses unless this database carries the test-only capture helpers
-- (scripts/test-db-only-capture-helpers.sql), which never exist on prod.
-- One transaction: a refusal applies nothing.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.quoco_test_capture_helpers_present()') IS NULL THEN
    RAISE EXCEPTION 'NOT_TEST_DB: quoco_test_capture_helpers_present() absent; refusing';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_event_trigger WHERE evtname = 'ensure_rls') THEN
    RAISE EXCEPTION 'ALREADY_PRESENT: event trigger ensure_rls exists; nothing to do';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.rls_auto_enable()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog'
AS $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

-- Prod ACL: {postgres=X/postgres,service_role=X/postgres}
REVOKE ALL ON FUNCTION public.rls_auto_enable() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO postgres;
GRANT EXECUTE ON FUNCTION public.rls_auto_enable() TO service_role;

CREATE EVENT TRIGGER ensure_rls ON ddl_command_end
  WHEN TAG IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
  EXECUTE FUNCTION public.rls_auto_enable();

COMMIT;

-- DOWN (test-db only):
-- BEGIN;
-- DROP EVENT TRIGGER ensure_rls;
-- DROP FUNCTION public.rls_auto_enable();
-- COMMIT;
