-- docs/reviews/051-down-prod.sql  -- DOWN artifact for migration 051, PROD (jvxwqignooseazzmwhvl).
-- NEVER APPLY THIS FILE TO THE OTHER DATABASE (test-db, exfccwlrhoutkgrlikod). Test-db has its own artifact,
-- docs/reviews/051-down-testdb.sql: same body, its own header. NOT RUN anywhere by the review-package block.
-- Plan docs/plans/pr-c-plan.md section 3d item 6 and section 8 ("DOWN for C2"). NOT RUN on prod by the
-- review-package block (only on a disposable local scaffold).
--
-- ROLLBACK ORDER: C5 (the capture_ingest job) MUST be rolled back BEFORE this DOWN runs, because the ingest
-- UPDATE needs the column grant this file revokes. Rolling this back first would make every ingest job fail with 42501.
-- Full order: C6 -> C5 -> C4 -> C3 -> this DOWN (C2); then, outside PR-C, C, then B, then A (049's DOWN last).
-- Run outside 08:25-08:40 and 18:25-18:40 IST (the same window rule as the apply).
--
-- WHAT IT DOES NOT TOUCH: no table rows, no 'capture_files' data. It removes the trigger, the function and the grant.
-- After it runs, capture_files is back to the 049 state: SELECT only for authenticated and service_role.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 0. Precondition: refuse unless the 051 ledger row AND the function AND the trigger all exist. A second run (or a run
--    against a database that never had 051) would otherwise report success on nothing.
DO $$
DECLARE
  v_ledger boolean;
  v_fn     integer;
  v_trg    integer;
BEGIN
  v_ledger := EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '051');
  SELECT count(*) INTO v_fn FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'trg_capture_files_before_update';
  SELECT count(*) INTO v_trg FROM pg_trigger t
   WHERE t.tgrelid = 'public.capture_files'::regclass AND t.tgname = 'trg_capture_files_before_update' AND NOT t.tgisinternal;
  IF NOT v_ledger OR v_fn <> 1 OR v_trg <> 1 THEN
    RAISE EXCEPTION 'DOWN_PRECONDITION_051: ledger_051=% functions_found=% triggers_found=%', v_ledger, v_fn, v_trg;
  END IF;
END;
$$;

-- 1. Drop the trigger, then the function.
DROP TRIGGER trg_capture_files_before_update ON public.capture_files;
DROP FUNCTION public.trg_capture_files_before_update();

-- 2. Remove the column grant (the seven columns, by name).
REVOKE UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state)
  ON public.capture_files FROM service_role;

-- 3. Remove the ledger row, before the closing assertion.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '051';

-- 4. Closing assertion: the function and trigger are gone, service_role has no UPDATE on any of the seven columns,
--    SELECT is still held, and the ledger row is gone.
DO $$
DECLARE
  v_bad text := '';
  v_col text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'trg_capture_files_before_update') THEN
    v_bad := v_bad || ' fn_remains';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid = 'public.capture_files'::regclass AND t.tgname = 'trg_capture_files_before_update') THEN
    v_bad := v_bad || ' trigger_remains';
  END IF;
  FOREACH v_col IN ARRAY ARRAY['ingest_status', 'content_type', 'byte_size', 'sha256', 'storage_path', 'reject_reason', 'preview_state'] LOOP
    IF has_column_privilege('service_role', 'public.capture_files', v_col, 'UPDATE') THEN
      v_bad := v_bad || ' svc_update:' || v_col;
    END IF;
  END LOOP;
  IF has_table_privilege('service_role', 'public.capture_files', 'UPDATE') THEN
    v_bad := v_bad || ' svc_table_update';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.capture_files', 'SELECT') THEN
    v_bad := v_bad || ' svc_select_lost';
  END IF;
  IF EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '051') THEN
    v_bad := v_bad || ' ledger_row_remains';
  END IF;
  IF v_bad <> '' THEN
    RAISE EXCEPTION 'DOWN_ASSERT_051:%', v_bad;
  END IF;
END;
$$;

COMMIT;
