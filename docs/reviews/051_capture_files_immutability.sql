-- =============================================================================
-- 051_capture_files_immutability.sql
-- Slice 1a, PR-C step C2: the database record of a stored capture file cannot
-- be silently changed, and only the ingest job (service_role) may fill in a
-- file's stored details.
--
-- REV 3, 2026-10-27, after external review round 2 (docs/reviews/051-external-review-round-2.md):
--   S1  one more CHECK, capture_files_details_terminal_only_chk: content_type and byte_size
--       are set only on 'stored' or 'rejected'. Every terminal detail must now arrive in the
--       SAME UPDATE that makes the row terminal, so a stale value from an earlier attempt can
--       never be inherited and then frozen. (Consequence: every one of the seven granted
--       columns is NULL on a pending or failed row, so a pending or failed row can no longer
--       change any column except by a status move. 'failed' -> 'failed' with changes is now
--       vacuous; a no-change UPDATE is still allowed.)
--   S2(a) the trigger is now BEFORE INSERT OR UPDATE. An INSERT must be a blank pending row:
--       ingest_status 'pending' and content_type, byte_size, sha256, storage_path,
--       reject_reason, preview_state and ingested_at all NULL (QE011 otherwise), so INSERT is
--       no longer outside the lock. 050's live insert names none of those columns, so it is
--       unaffected. R2-1 "no caller can ever supply the time" is therefore true for BOTH
--       INSERT and UPDATE as of rev 3 (2026-10-27). In rev 2 it was true for UPDATE only: an
--       owner (any DEFINER function) could INSERT a terminal row with its own ingested_at.
--   S3  the DOWN refuses (DOWN_PRECONDITION_051 ... terminal_rows=N) when N > 0.
--   R2-2 now() kept. R2-3 both path checks kept, no later drop planned.
-- REV 2, 2026-10-27, after external review round 1 (docs/reviews/051-external-review-round-1.md).
-- DATED CORRECTION (S1): rev 1 said "a stored capture file can never be silently
--   changed". That is struck. 051 locks the DATABASE RECORD of a stored file, not
--   the bytes in Storage. service_role can still overwrite a Storage object. The
--   byte guard is C5's: upload with upsert false to the row-owned path (B2), and
--   no C5 code path overwrites or deletes an object under a stored row.
-- Rev 2 adds, before the trigger: B1 (two lifecycle CHECKs), B2 (a row-owned
--   storage path CHECK), S2 (a database-stamped ingested_at column and its CHECK).
--   (rev 3 adds S1, S2(a), S3 above.) Why B1 and B2 are needed: the trigger freezes whatever lands in a terminal
--   row, so a row with a contradictory shape (a stored file carrying a
--   reject_reason, a rejected file carrying a hash and path) would be frozen
--   wrong, and two rows could certify one Storage object.
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
--   2. A BEFORE INSERT OR UPDATE trigger then locks the rest. Identity columns never
--      change. 'stored' and 'rejected' are final: nothing about the row may
--      change again. This closes the hole the external reviewer proved open
--      on a stub (049-review-package.md:145): a stored file's sha256 could be
--      rewritten.
--   3. (rev 2, five from rev 3) CHECK constraints keep every row's shape consistent, so the
--      lock never freezes a contradiction (B1, B2, S2 below).
--   3b.(rev 3) The trigger also fires on INSERT and accepts only a blank pending row.
--   4. (rev 2) A new column ingested_at records when a file reached 'stored' or
--      'rejected'. The DATABASE stamps it inside the trigger. No role can write
--      it, and it is NOT in the service_role grant (S2, per Aravind 27 Oct).
--
-- DECISIONS (all per Aravind, 26 Oct 2026)
--   * 'stored' and 'rejected' are terminal.
--   * 'failed' may move only to 'stored' or 'rejected'.
--   * An UPDATE that changes nothing on a terminal row is allowed, so a
--     retried ingest job is a harmless no-op.
--   * (rev 2, 27 Oct) B1 and B2 accepted as the reviewer wrote them. S2 yes, with
--     one change: ingested_at is stamped by the database, not written by the
--     caller (precedent: 049 TR1 stamps delivery_invoice_links.linked_at, F4-1).
--     'failed' -> 'failed' with column changes stays allowed (safe under B1).
--   * PITR is OFF until launch. The prod apply will record "PITR substituted"
--     (a saved pre-apply readback of the table's ACLs and triggers, plus
--     051-down-prod.sql). That readback is NOT part of this file.
--
-- ROW SHAPE (rev 2; a violation raises 23514, check_violation, from the CHECKs in section 1):
--   B1  reject_reason is set if and only if ingest_status = 'rejected'.
--       storage_path, sha256 and preview_state are set only when 'stored'.
--   S1  (rev 3) content_type and byte_size are set only on 'stored' or 'rejected', in the
--       same UPDATE that makes the row terminal. A 'too_large' or 'wrong_type' reject still
--       records what was observed, because that UPDATE sets them on the 'rejected' row.
--   B2  storage_path starts with tenant/project/document/<this row's id>. The id
--       is a fixed-width uuid, so no row's prefix can collide with another's.
--       049's existing capture_files_storage_path_prefix_chk (the document folder
--       only) is KEPT: it is applied and live, it is a weaker subset of the new
--       check, and dropping a live constraint is a separate, avoidable risk.
--       The new check is the strict one; the old one stays as a second wall.
--   S2  ingested_at is set if and only if ingest_status is 'stored' or 'rejected'.
--       The trigger stamps it with now() (transaction start time, the same
--       function 049's TR4 uses for approved_at, S-3) on the move from 'pending'
--       or 'failed' into 'stored' or 'rejected'. now() is stable inside the
--       transaction, so it never disagrees with the row's other writes in that
--       transaction. A caller who changes ingested_at gets QE009.
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
--   ingested_at (rev 2) is the one extra column: NOT granted, and NOT writable by
--   any caller. A change to it by anyone raises QE009 (it is checked with the
--   identity columns, before the trigger's own stamp). So the table's 17 columns
--   are: 9 identity + 7 granted + ingested_at (a test asserts this set).
--
-- CALLER NOTE: the trigger function body does not name the table. 049's DOWN
--   guard (049 DOWN, Guard 2) scans function bodies for table names; a body
--   naming the table would trip it. The function needs no table reference.
--
-- LOCKS: ALTER TABLE ADD CONSTRAINT takes ACCESS EXCLUSIVE on capture_files and
--   scans the table to validate. ADD COLUMN (nullable, no default) is a catalog
--   change only. CREATE TRIGGER takes SHARE ROW EXCLUSIVE and GRANT a brief lock.
--   Nothing here locks whatsapp_sessions or any other table. SET LOCAL
--   lock_timeout below makes a blocked apply fail fast. Existing pending rows
--   validate (the 050 insert writes only blank pending rows). A stored or rejected
--   row cannot exist today short of a hand edit: 049 grants SELECT only, so only the
--   table owner can UPDATE capture_files (external review round 2, R2-5). If one
--   does exist, this file aborts whole (G1b case D). The apply block's read-only
--   count of terminal rows is an early warning, not the guard.
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
--   [src: R1-B1]     docs/reviews/051-external-review-round-1.md (B1: lifecycle CHECKs)
--   [src: R1-B2]     same (B2: row-owned storage path)
--   [src: R1-S1]     same (S1: the bytes are not locked)
--   [src: R1-S2]     same (S2: terminal timestamp; stamped by the database per Aravind 27 Oct)
--   [src: R2-S1]     docs/reviews/051-external-review-round-2.md (S1: stale attempt data frozen into terminal rows)
--   [src: R2-S2]     same (S2: INSERT is outside the lock; option (a) taken per Aravind 27 Oct)
--   [src: R2-S3]     same (S3: the DOWN refuses over live terminal rows)
--   [src: S049-F4-1] supabase/migrations/049_capture_tables.sql (TR1 stamps delivery_invoice_links.linked_at)
--
-- DOWN: commented block at the end. The runnable files are
--   docs/reviews/051-down-testdb.sql and docs/reviews/051-down-prod.sql.
-- =============================================================================

BEGIN;

SET LOCAL lock_timeout = '3s';

-- -----------------------------------------------------------------------------
-- 1. Table changes (rev 2). All before the trigger exists.
-- -----------------------------------------------------------------------------
-- [src: R1-S2] ingested_at: nullable, no default. Stamped by the trigger below.
ALTER TABLE public.capture_files ADD COLUMN ingested_at timestamptz;

-- [src: R1-B1] reject_reason iff rejected; the stored details only on stored.
ALTER TABLE public.capture_files
  ADD CONSTRAINT capture_files_reject_reason_iff_chk
    CHECK ((ingest_status = 'rejected') = (reject_reason IS NOT NULL)),
  ADD CONSTRAINT capture_files_stored_only_chk
    CHECK (ingest_status = 'stored' OR (storage_path IS NULL AND sha256 IS NULL AND preview_state IS NULL));

-- [src: R1-B2] the path belongs to its row.
ALTER TABLE public.capture_files
  ADD CONSTRAINT capture_files_storage_path_row_chk
    CHECK (storage_path IS NULL OR starts_with(storage_path, tenant_id::text || '/' || project_id::text || '/' || document_id::text || '/' || id::text));

-- [src: R1-S2] ingested_at iff terminal.
ALTER TABLE public.capture_files
  ADD CONSTRAINT capture_files_ingested_at_iff_chk
    CHECK ((ingest_status IN ('stored', 'rejected')) = (ingested_at IS NOT NULL));

-- [src: R2-S1] content_type and byte_size only on a terminal row (stale attempt data is never inherited).
ALTER TABLE public.capture_files
  ADD CONSTRAINT capture_files_details_terminal_only_chk
    CHECK (ingest_status IN ('stored', 'rejected') OR (content_type IS NULL AND byte_size IS NULL));

-- -----------------------------------------------------------------------------
-- 2. The trigger function.
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

  -- S2(a): an INSERT must be a blank pending row. The caller (any owner or DEFINER function)
  -- can then never supply a status, a detail or the stamp; the trigger stamps on UPDATE only.
  IF TG_OP = 'INSERT' THEN
    IF NEW.ingest_status IS DISTINCT FROM 'pending'
       OR NEW.content_type IS NOT NULL
       OR NEW.byte_size IS NOT NULL
       OR NEW.sha256 IS NOT NULL
       OR NEW.storage_path IS NOT NULL
       OR NEW.reject_reason IS NOT NULL
       OR NEW.preview_state IS NOT NULL
       OR NEW.ingested_at IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = 'QE011', MESSAGE = 'E11';
    END IF;
    RETURN NEW;
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

  -- S2: ingested_at is never caller-set. Compare the caller's value to OLD FIRST
  -- (QE009 if it differs), and only THEN stamp it below.
  IF NEW.ingested_at IS DISTINCT FROM OLD.ingested_at THEN
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
    -- S2: the database stamps the move into a terminal status. now() = transaction
    -- start time (as 049's TR4 stamps approved_at); the table CHECK then requires it.
    IF NEW.ingest_status IN ('stored', 'rejected') THEN
      NEW.ingested_at := now();
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. The trigger.
-- -----------------------------------------------------------------------------
-- [src: PLAN-3d]
CREATE TRIGGER trg_capture_files_before_update
  BEFORE INSERT OR UPDATE ON public.capture_files
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_capture_files_before_update();

-- -----------------------------------------------------------------------------
-- 4. Function ACL. A trigger fires without the invoking role holding EXECUTE,
--    so no role needs it. All four roles are named (FROM PUBLIC alone does not
--    remove the per-role default grants). The GRANT to postgres changes the
--    effective ACL not at all (postgres owns the function) and satisfies
--    scripts/lint-migrations.mjs Rule 1, as 049:988-1004 does.
-- -----------------------------------------------------------------------------
-- [src: CM-s6, S049-ACL]
REVOKE ALL ON FUNCTION public.trg_capture_files_before_update() FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.trg_capture_files_before_update() TO postgres;

-- -----------------------------------------------------------------------------
-- 5. The column UPDATE grant (D-8). Column-scoped only: no table-level UPDATE,
--    nothing for anon or authenticated.
-- -----------------------------------------------------------------------------
-- [src: P49:33, PLAN-3d]
GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state)
  ON public.capture_files TO service_role;

-- -----------------------------------------------------------------------------
-- 6. IN-FILE POST-CONDITION BLOCK (S050-ASSERT pattern). Any miss aborts the
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
  v_con     text;
BEGIN
  -- Rev 2/3: the ingested_at column exists (timestamptz, nullable, no default) and the five new
  -- CHECK constraints exist, are CHECKs, and are validated.
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
     WHERE a.attrelid = 'public.capture_files'::regclass AND a.attname = 'ingested_at' AND NOT a.attisdropped
       AND a.atttypid = 'timestamptz'::regtype AND NOT a.attnotnull AND NOT a.atthasdef
  ) THEN
    v_bad := v_bad || ' ingested_at_column';
  END IF;
  FOREACH v_con IN ARRAY ARRAY['capture_files_reject_reason_iff_chk', 'capture_files_stored_only_chk',
                               'capture_files_storage_path_row_chk', 'capture_files_ingested_at_iff_chk',
                               'capture_files_details_terminal_only_chk'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint c
       WHERE c.conrelid = 'public.capture_files'::regclass AND c.conname = v_con AND c.contype = 'c' AND c.convalidated
    ) THEN
      v_bad := v_bad || ' constraint:' || v_con;
    END IF;
  END LOOP;

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

  -- Trigger present, enabled, BEFORE INSERT OR UPDATE FOR EACH ROW, bound to the function.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.capture_files'::regclass
       AND t.tgname = 'trg_capture_files_before_update'
       AND NOT t.tgisinternal
       AND t.tgenabled = 'O'
       AND t.tgfoid = v_oid
       AND (t.tgtype & 1) = 1      -- ROW
       AND (t.tgtype & 2) = 2      -- BEFORE
       AND (t.tgtype & 4) = 4      -- INSERT (rev 3, S2(a))
       AND (t.tgtype & 16) = 16    -- UPDATE
       AND (t.tgtype & (8 | 32)) = 0   -- not DELETE, TRUNCATE
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

  -- Rev 2: ingested_at is writable by no role (explicit, on top of the walk above).
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_column_privilege(v_role, 'public.capture_files', 'ingested_at', 'UPDATE') THEN
      v_bad := v_bad || ' ingested_at_update:' || v_role;
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
--   precondition: refuse (DOWN_PRECONDITION_051) unless the 051 ledger row, the function, the trigger, the five constraints and the column all exist, AND
--     refuse when any row has ingest_status IN ('stored','rejected') (terminal_rows=N, rev 3 S3): a rollback over live terminal rows
--     needs a separate reviewed artifact with its own decision on ingested_at;
--   DROP TRIGGER trg_capture_files_before_update ON public.capture_files;
--   DROP FUNCTION public.trg_capture_files_before_update();
--   DROP CONSTRAINT x5 (capture_files_details_terminal_only_chk, capture_files_ingested_at_iff_chk, capture_files_storage_path_row_chk,
--     capture_files_stored_only_chk, capture_files_reject_reason_iff_chk), then DROP COLUMN ingested_at
--     (the DOWN can no longer run over terminal rows, so it loses no ingested_at value);
--   REVOKE UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state)
--     ON public.capture_files FROM service_role;
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '051';
--   closing assertion: function, trigger, five constraints and the column gone, service_role column UPDATE false on all seven, SELECT still held.
-- Rollback order: C5 (the ingest job) must be rolled back BEFORE this DOWN, because the ingest needs the grant.
-- Then C, then B, then A (049's DOWN comes last).
-- =============================================================================
