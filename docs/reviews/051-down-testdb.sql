-- docs/reviews/051-down-testdb.sql  -- DOWN artifact for migration 051 (rev 3), TEST-DB (exfccwlrhoutkgrlikod).
-- NEVER APPLY THIS FILE TO THE OTHER DATABASE (prod, jvxwqignooseazzmwhvl). Prod has its own artifact,
-- docs/reviews/051-down-prod.sql: same body, its own header.
-- Plan docs/plans/pr-c-plan.md section 3d item 6 and section 8 ("DOWN for C2"). NOT RUN on test-db by the
-- review-package block (only on a disposable local scaffold).
--
-- ROLLBACK ORDER: C5 (the capture_ingest job) MUST be rolled back BEFORE this DOWN runs, because the ingest
-- UPDATE needs the column grant this file revokes. Rolling this back first would make every ingest job fail with 42501.
-- Full order: C6 -> C5 -> C4 -> C3 -> this DOWN (C2); then, outside PR-C, C, then B, then A (049's DOWN last).
-- Run outside 08:25-08:40 and 18:25-18:40 IST (the same window rule as the apply).
--
-- ROLLING BACK OVER LIVE TERMINAL ROWS needs a separate reviewed artifact with its own decision on ingested_at
-- (external review round 2, S3). This file REFUSES (DOWN_PRECONDITION_051 ... terminal_rows=N) when any row has
-- ingest_status IN ('stored','rejected'), so it can never silently discard ingested_at values.
--
-- WHAT IT DOES NOT TOUCH: no table rows. It removes the trigger, the function, the five rev-2/rev-3 CHECK constraints,
-- the ingested_at column, and the grant. After it runs, capture_files is back to the 049 state: SELECT only for
-- authenticated and service_role, no ingested_at, and 049's own constraints untouched.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- 0. Precondition: refuse unless the 051 ledger row AND the function AND the trigger AND the five constraints AND the
--    ingested_at column all exist, AND no row is terminal (S3). A second run (or a run against a database that never
--    had 051) would otherwise report success on nothing.
DO $$
DECLARE
  v_ledger boolean;
  v_fn     integer;
  v_trg    integer;
  v_con    integer;
  v_col    integer;
  v_term   bigint;
BEGIN
  v_ledger := EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '051');
  SELECT count(*) INTO v_fn FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'trg_capture_files_before_update';
  SELECT count(*) INTO v_trg FROM pg_trigger t
   WHERE t.tgrelid = 'public.capture_files'::regclass AND t.tgname = 'trg_capture_files_before_update' AND NOT t.tgisinternal;
  SELECT count(*) INTO v_con FROM pg_constraint c
   WHERE c.conrelid = 'public.capture_files'::regclass
     AND c.conname IN ('capture_files_reject_reason_iff_chk', 'capture_files_stored_only_chk',
                       'capture_files_storage_path_row_chk', 'capture_files_ingested_at_iff_chk',
                       'capture_files_details_terminal_only_chk');
  SELECT count(*) INTO v_col FROM pg_attribute a
   WHERE a.attrelid = 'public.capture_files'::regclass AND a.attname = 'ingested_at' AND NOT a.attisdropped;
  -- S3: counted only when the column exists (a run against a database without 051 must still report the missing objects).
  IF v_col = 1 THEN
    SELECT count(*) INTO v_term FROM public.capture_files WHERE ingest_status IN ('stored', 'rejected');
  ELSE
    v_term := 0;
  END IF;
  IF NOT v_ledger OR v_fn <> 1 OR v_trg <> 1 OR v_con <> 5 OR v_col <> 1 OR v_term > 0 THEN
    RAISE EXCEPTION 'DOWN_PRECONDITION_051: ledger_051=% functions_found=% triggers_found=% constraints_found=% ingested_at_found=% terminal_rows=%',
      v_ledger, v_fn, v_trg, v_con, v_col, v_term;
  END IF;
END;
$$;

-- 1. Drop the trigger, then the function (first: the constraints below must not be dropped under a live trigger).
DROP TRIGGER trg_capture_files_before_update ON public.capture_files;
DROP FUNCTION public.trg_capture_files_before_update();

-- 2. Drop the five rev-2/rev-3 constraints, then the column they reference.
ALTER TABLE public.capture_files
  DROP CONSTRAINT capture_files_details_terminal_only_chk,
  DROP CONSTRAINT capture_files_ingested_at_iff_chk,
  DROP CONSTRAINT capture_files_storage_path_row_chk,
  DROP CONSTRAINT capture_files_stored_only_chk,
  DROP CONSTRAINT capture_files_reject_reason_iff_chk;
ALTER TABLE public.capture_files DROP COLUMN ingested_at;

-- 3. Remove the column grant (the seven columns, by name).
REVOKE UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state)
  ON public.capture_files FROM service_role;

-- 4. Remove the ledger row, before the closing assertion.
DELETE FROM supabase_migrations.schema_migrations WHERE version = '051';

-- 5. Closing assertion: the function, trigger, five constraints and the column are gone, service_role has no UPDATE on any
--    of the seven columns, SELECT is still held, and the ledger row is gone.
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
  IF EXISTS (SELECT 1 FROM pg_constraint c
              WHERE c.conrelid = 'public.capture_files'::regclass
                AND c.conname IN ('capture_files_reject_reason_iff_chk', 'capture_files_stored_only_chk',
                                  'capture_files_storage_path_row_chk', 'capture_files_ingested_at_iff_chk',
                                  'capture_files_details_terminal_only_chk')) THEN
    v_bad := v_bad || ' constraint_remains';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute a
              WHERE a.attrelid = 'public.capture_files'::regclass AND a.attname = 'ingested_at' AND NOT a.attisdropped) THEN
    v_bad := v_bad || ' ingested_at_remains';
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
