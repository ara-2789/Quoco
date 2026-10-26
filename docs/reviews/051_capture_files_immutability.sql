-- =============================================================================
-- 051_capture_files_immutability.sql
-- Slice 1a, PR-C step C2: a stored capture file can never be silently changed,
-- and only the ingest job (service_role) may fill in a file's stored details.
--
-- HELD -- NOT APPLIED to any database (test-db or prod). This file lives in
-- docs/reviews/, not supabase/migrations/, until an apply is actually
-- happening (CLAUDE.md section 6: a migration file enters supabase/migrations/
-- when it is being applied, not when it is written).
--
-- TIER: FULL. External-review triggers tripped (CLAUDE.md section 0): (a) a new
-- trigger function, which is live logic; (b) a new SECURITY DEFINER function
-- and a new column-level UPDATE grant on a tenant-scoped table.
--
-- WHAT IT DOES, IN PLAIN WORDS
--   1. A row of capture_files starts 'pending'. The ingest job (C5) later
--      fills in the stored details and moves it to 'stored' or 'rejected'.
--      Today nobody can UPDATE that table at all (049 grants SELECT only).
--      This file gives service_role UPDATE on seven columns, and nothing more.
--   2. A BEFORE UPDATE trigger then locks the rest. Identity columns never
--      change. 'stored' and 'rejected' are final: nothing about the row may
--      change again. This closes the hole the external reviewer proved open
--      on a stub (049-review-package.md:145): a stored file's sha256 could be
--      rewritten.
--
-- DECISIONS (all per Aravind, 26 Oct 2026)
--   * 'stored' and 'rejected' are terminal.
--   * 'failed' may move only to 'stored' or 'rejected'.
--   * An UPDATE that changes nothing on a terminal row is allowed, so a
--     retried ingest job is a harmless no-op.
--   * PITR is OFF until launch. The prod apply will record "PITR substituted"
--     (a saved pre-apply readback of the table's ACLs and triggers, plus
--     051-down-prod.sql). That readback is NOT part of this file.
--
-- STATUS TRANSITIONS (ingest_status). Anything not listed raises QE011.
--     pending -> pending | stored | rejected | failed
--     failed  -> failed  | stored | rejected      (failed -> failed is allowed)
--     stored  -> stored only (no column may change)
--     rejected-> rejected only (no column may change)
--     nothing -> pending, except pending -> pending
--
-- ERROR CODES (existing 049 codes; no new code)
--   QE009  an identity column changed            (049 trg_capture_documents_before_update, 049:784-791)
--   QE011  a terminal row changed, or a refused status move  (049 E11 family; mapping pr-b-050-plan.md:129-131)
--   QE014  the writer is not READ COMMITTED      (049:778-780, B3: first statement)
--
-- IDENTITY COLUMNS (QE009): id, created_at, tenant_id, project_id,
--   document_id, file_no, source_message_sid, media_index, claimed_content_type.
--   These are exactly the nine capture_files columns (049:305-340) that the
--   column grant below does NOT give to service_role. Nothing is left out.
--
-- CALLER NOTE: the trigger function body does not name the table. 049's DOWN
--   guard (049 DOWN, Guard 2) scans function bodies for table names; a body
--   naming the table would trip it. The function needs no table reference.
--
-- LOCKS: CREATE TRIGGER takes SHARE ROW EXCLUSIVE on capture_files and GRANT
--   takes a brief lock on it. Nothing here locks whatsapp_sessions or any
--   other table. SET LOCAL lock_timeout below makes a blocked apply fail fast.
--
-- SOURCE MAP (id -> where)
--   [src: R49:145]   docs/reviews/049-review-package.md:145 (PR-C BLOCKING item)
--   [src: P49:33]    docs/reviews/049-plan-review-package.md:33 (D-8: grant moved from PR-A to PR-C)
--   [src: S049-TBL]  supabase/migrations/049_capture_tables.sql:305-340 (capture_files)
--   [src: S049-GR]   supabase/migrations/049_capture_tables.sql:974-985 (grants; SELECT only)
--   [src: S049-TRG]  supabase/migrations/049_capture_tables.sql:770-815 (trg_capture_documents_before_update, the pattern)
--   [src: S049-ACL]  supabase/migrations/049_capture_tables.sql:988-1004 (per-role REVOKE + GRANT TO postgres)
--   [src: S050-ASSERT] supabase/migrations/050_material_inward_functions.sql:1915-1973 (assertion block pattern)
--   [src: PLAN-3d]   docs/plans/pr-c-plan.md section 3d items 1-5, section 8 row C2
--   [src: CM-s6]     CLAUDE.md section 6: every new function needs an explicit per-role REVOKE
--
-- DOWN: commented block at the end. The runnable files are
--   docs/reviews/051-down-testdb.sql and docs/reviews/051-down-prod.sql.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- 1. The trigger function.
-- -----------------------------------------------------------------------------
-- [src: PLAN-3d, S049-TRG, R49:145]
CREATE FUNCTION public.trg_capture_files_before_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- B3: first statement.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION USING ERRCODE = 'QE014', MESSAGE = 'E14';
  END IF;

  -- Identity: never changes, whatever the row's status.
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.tenant_id IS DISTINCT FROM OLD.tenant_id
     OR NEW.project_id IS DISTINCT FROM OLD.project_id
     OR NEW.document_id IS DISTINCT FROM OLD.document_id
     OR NEW.file_no IS DISTINCT FROM OLD.file_no
     OR NEW.source_message_sid IS DISTINCT FROM OLD.source_message_sid
     OR NEW.media_index IS DISTINCT FROM OLD.media_index
     OR NEW.claimed_content_type IS DISTINCT FROM OLD.claimed_content_type THEN
    RAISE EXCEPTION USING ERRCODE = 'QE009', MESSAGE = 'E9';
  END IF;

  -- Terminal rows: no column may change. An UPDATE that changes nothing is
  -- allowed (a retried job is a no-op).
  IF OLD.ingest_status IN ('stored', 'rejected') THEN
    IF NEW IS DISTINCT FROM OLD THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
    RETURN NEW;
  END IF;

  -- Non-terminal rows (pending, failed): only the listed status moves.
  IF NEW.ingest_status IS DISTINCT FROM OLD.ingest_status THEN
    IF NOT (   (OLD.ingest_status = 'pending' AND NEW.ingest_status IN ('stored', 'rejected', 'failed'))
            OR (OLD.ingest_status = 'failed'  AND NEW.ingest_status IN ('stored', 'rejected'))) THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. The trigger.
-- -----------------------------------------------------------------------------
-- [src: PLAN-3d]
CREATE TRIGGER trg_capture_files_before_update
  BEFORE UPDATE ON public.capture_files
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_files_before_update();

-- -----------------------------------------------------------------------------
-- 3. Function ACL. A trigger fires without the invoking role holding EXECUTE,
--    so no role needs it. All four roles are named (FROM PUBLIC alone does not
--    remove the per-role default grants). The GRANT to postgres changes the
--    effective ACL not at all (postgres owns the function) and satisfies
--    scripts/lint-migrations.mjs Rule 1, as 049:988-1004 does.
-- -----------------------------------------------------------------------------
-- [src: CM-s6, S049-ACL]
REVOKE ALL ON FUNCTION public.trg_capture_files_before_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_capture_files_before_update() TO postgres;

-- -----------------------------------------------------------------------------
-- 4. The column UPDATE grant (D-8). Column-scoped only: no table-level UPDATE,
--    nothing for anon or authenticated.
-- -----------------------------------------------------------------------------
-- [src: P49:33, PLAN-3d]
GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state)
  ON public.capture_files TO service_role;

-- -----------------------------------------------------------------------------
-- 5. IN-FILE POST-CONDITION BLOCK (S050-ASSERT pattern). Any miss aborts the
--    whole file: nothing from sections 1-4 survives.
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_bad  text := '';
  v_n    integer;
  v_oid  oid;
  v_col  record;
  v_role text;
  v_granted constant text[] := ARRAY['ingest_status', 'content_type', 'byte_size', 'sha256',
                                     'storage_path', 'reject_reason', 'preview_state'];
BEGIN
  -- Exactly one function of this name in public.
  SELECT count(*) INTO v_n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'trg_capture_files_before_update';
  IF v_n <> 1 THEN
    v_bad := v_bad || ' fn_rows=' || v_n;
  END IF;

  v_oid := 'public.trg_capture_files_before_update()'::regprocedure::oid;

  -- Fingerprint: SECURITY DEFINER, owner postgres, search_path '', a non-NULL ACL with no PUBLIC entry.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p
     WHERE p.oid = v_oid
       AND p.prosecdef
       AND p.proowner = 'postgres'::regrole
       AND p.proconfig = ARRAY['search_path=""']::text[]
       AND p.proacl IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee = 0)
  ) THEN
    v_bad := v_bad || ' fn_fingerprint';
  END IF;

  -- No role holds EXECUTE.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_function_privilege(v_role, v_oid, 'EXECUTE') THEN
      v_bad := v_bad || ' exec:' || v_role;
    END IF;
  END LOOP;

  -- Trigger present, enabled, BEFORE UPDATE FOR EACH ROW, bound to the function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.capture_files'::regclass
       AND t.tgname = 'trg_capture_files_before_update'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND t.tgfoid = v_oid
       AND (t.tgtype & 1) = 1      -- ROW
       AND (t.tgtype & 2) = 2      -- BEFORE
       AND (t.tgtype & 16) = 16    -- UPDATE
       AND (t.tgtype & (4 | 8 | 32)) = 0   -- not INSERT, DELETE, TRUNCATE
  ) THEN
    v_bad := v_bad || ' trigger';
  END IF;

  -- Column UPDATE: true for service_role on exactly the seven columns, false on every other column;
  -- false for anon and authenticated on every column.
  FOR v_col IN
    SELECT a.attname::text AS attname
      FROM pg_attribute a
     WHERE a.attrelid = 'public.capture_files'::regclass AND a.attnum > 0 AND NOT a.attisdropped
  LOOP
    IF has_column_privilege('service_role', 'public.capture_files', v_col.attname, 'UPDATE')
         IS DISTINCT FROM (v_col.attname = ANY (v_granted)) THEN
      v_bad := v_bad || ' svc_col_update:' || v_col.attname;
    END IF;
    IF has_column_privilege('anon', 'public.capture_files', v_col.attname, 'UPDATE') THEN
      v_bad := v_bad || ' anon_col_update:' || v_col.attname;
    END IF;
    IF has_column_privilege('authenticated', 'public.capture_files', v_col.attname, 'UPDATE') THEN
      v_bad := v_bad || ' auth_col_update:' || v_col.attname;
    END IF;
  END LOOP;

  -- All seven granted columns exist (a typo would otherwise show only as a missing 'true').
  SELECT count(*) INTO v_n
    FROM pg_attribute a
   WHERE a.attrelid = 'public.capture_files'::regclass AND a.attnum > 0 AND NOT a.attisdropped
     AND a.attname = ANY (v_granted);
  IF v_n <> 7 THEN
    v_bad := v_bad || ' granted_cols_found=' || v_n;
  END IF;

  -- No table-level UPDATE for any of the three roles.
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'public.capture_files', 'UPDATE') THEN
      v_bad := v_bad || ' tbl_update:' || v_role;
    END IF;
  END LOOP;

  -- service_role holds no DELETE or TRUNCATE (unchanged by this file; asserted so a regression aborts), and keeps SELECT.
  IF has_table_privilege('service_role', 'public.capture_files', 'DELETE') THEN
    v_bad := v_bad || ' svc_delete';
  END IF;
  IF has_table_privilege('service_role', 'public.capture_files', 'TRUNCATE') THEN
    v_bad := v_bad || ' svc_truncate';
  END IF;
  IF NOT has_table_privilege('service_role', 'public.capture_files', 'SELECT') THEN
    v_bad := v_bad || ' svc_select_lost';
  END IF;

  IF v_bad <> '' THEN
    RAISE EXCEPTION 'POSTCONDITION_051:%', v_bad;
  END IF;
END;
$$;

COMMIT;

-- =============================================================================
-- DOWN (commented, inert text). The runnable files are docs/reviews/051-down-testdb.sql
-- and docs/reviews/051-down-prod.sql (identical bodies; each names its own database).
--
-- DOWN, in order, one transaction:
--   SET LOCAL lock_timeout = '3s';
--   precondition: refuse (DOWN_PRECONDITION_051) unless the 051 ledger row, the function and the trigger all exist;
--   DROP TRIGGER trg_capture_files_before_update ON public.capture_files;
--   DROP FUNCTION public.trg_capture_files_before_update();
--   REVOKE UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state)
--     ON public.capture_files FROM service_role;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '051';
--   closing assertion: function and trigger gone, service_role column UPDATE false on all seven, SELECT still held.
-- Rollback order: C5 (the ingest job) must be rolled back BEFORE this DOWN, because the ingest needs the grant.
-- Then C, then B, then A (049's DOWN comes last).
-- =============================================================================
