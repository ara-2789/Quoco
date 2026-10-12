-- TEST-DB-ONLY. NEVER APPLY THIS TO PRODUCTION. NEVER MOVE THIS FILE INTO
-- supabase/migrations/. NO MIGRATION NUMBER -- see WHY THIS FILE below.
--
-- Target: test-db ONLY (project ref exfccwlrhoutkgrlikod). NOT prod
-- (jvxwqignooseazzmwhvl). Applied BY HAND with an EXPLICIT target (print
-- supabase/.temp/project-ref and confirm it equals the named ref first --
-- `--linked` can resolve to prod). Not part of any automated pipeline.
--
-- HELD -- NOT APPLIED to any database. This block (2a) only drafts it and runs
-- it against a disposable local PG 17 scaffold. Applying it to test-db is
-- block 2b, together with the 049 test-db apply. Spec: docs/reviews/
-- 049-plan-review-package.md D-21 (Option Y) and review round 2 Q2-1.
--
-- WHAT THIS DOES (Option Y, D-21): migration 049's four tables
-- (deliveries, capture_documents, capture_files, delivery_invoice_links)
-- give service_role SELECT only, so CI -- which runs as service_role and has
-- no table-owner connection -- cannot seed or mutate them directly. These
-- SECURITY DEFINER helpers let CI do so WITHOUT any test-db grant divergence:
-- test-db table grants on the four tables equal prod, so CI can prove the
-- service_role restrictions. The helpers run with owner privileges, so the
-- 049 triggers STILL FIRE (a bypass-the-PR-B-function test runs in CI).
--
--   quoco_test_capture_fixture_tenant_ok(uuid)  the ONE tenant guard (below)
--   quoco_test_capture_insert(text, jsonb)       insert one row, any of the four tables
--   quoco_test_capture_update(text, uuid, jsonb) update one row by id
--   quoco_test_capture_cleanup(uuid)             delete every row of a fixture tenant
--   quoco_test_capture_acl()                     ACL + function fingerprint readback (jsonb)
--   quoco_test_capture_helpers_present()         CI pre-check: do all helpers exist
--
-- Q2-1 CONDITIONS (review-round-2.txt), met here:
--   1. insert (and update) refuse any tenant_id not created by the capture
--      fixture -- THE SAME GUARD as cleanup (one function, three callers).
--      The guard is a naming convention, stated so nobody mistakes it for a
--      provenance proof: tenants.slug LIKE 'zz-test-capture-%'. The capture
--      fixture (block 2b) must create its run-scoped tenants with that slug
--      prefix (test/helpers/db.ts: slugs are `zz-test-<name>-<runId>`).
--   2. the column list is built from the jsonb KEYS and each value is taken
--      from jsonb_populate_record in the SELECT list -- never
--      INSERT ... SELECT * FROM jsonb_populate_record, which would supply
--      values for the generated columns (delivery_date, self_invoice_id) and
--      be rejected ("cannot insert a non-DEFAULT value"). A caller that names
--      a generated column explicitly still gets that rejection, correctly.
--   3. quoco_test_capture_helpers_present() is the CI pre-check that the
--      helpers exist on test-db, so a missed hand-apply fails at setup rather
--      than mid-suite.
--
-- EXECUTE for service_role only (SECURITY DEFINER, SET search_path = '',
-- REVOKE FROM PUBLIC, anon, authenticated by name; GRANT TO service_role).
-- Same structural precedent as scripts/test-db-only-047-rights-check.sql.
--
-- WHY THIS FILE, NOT A MIGRATION NUMBER: same reasoning as the 047 helper's
-- header -- no production call site, and a numbered test-only object is
-- exactly the shape that produced 032's ledger/reality mismatch. Living in
-- scripts/, unnumbered, keeps prod's ledger truthful by construction. Every
-- apply/rehearsal/lint tool this project uses scans only supabase/migrations/
-- and docs/reviews/<digits>_*.sql.
--
-- PROD GUARD (R-H): the helpers must never exist on prod. 049's prod apply
-- carries a probe that to_regprocedure('public.quoco_test_capture_insert(text,jsonb)')
-- IS NULL on prod.
--
-- S-D ORDER: these function bodies name the four 049 tables, so 049's DOWN
-- guard MUST trip while they exist. On test-db: run this file's DOWN (below)
-- FIRST, then 049's DOWN.
--
-- Idempotent on re-run (CREATE OR REPLACE; grants re-asserted each run).

CREATE OR REPLACE FUNCTION public.quoco_test_capture_fixture_tenant_ok(p_tenant_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_tenant_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.tenants t
    WHERE t.id = p_tenant_id AND t.slug LIKE 'zz-test-capture-%'
  );
$$;

CREATE OR REPLACE FUNCTION public.quoco_test_capture_insert(p_table text, p_row jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_cols   text;
  v_out    jsonb;
BEGIN
  IF p_table IS NULL OR p_table NOT IN ('deliveries', 'capture_documents', 'capture_files', 'delivery_invoice_links') THEN
    RAISE EXCEPTION 'HELPER_TABLE_NOT_ALLOWED';
  END IF;
  IF jsonb_typeof(p_row) IS DISTINCT FROM 'object' OR p_row = '{}'::jsonb THEN
    RAISE EXCEPTION 'HELPER_ROW_NOT_OBJECT';
  END IF;
  BEGIN
    v_tenant := (p_row ->> 'tenant_id')::uuid;
  EXCEPTION WHEN others THEN
    v_tenant := NULL;
  END;
  IF NOT public.quoco_test_capture_fixture_tenant_ok(v_tenant) THEN
    RAISE EXCEPTION 'HELPER_TENANT_NOT_FIXTURE';
  END IF;
  SELECT string_agg(format('%I', k), ', ' ORDER BY k) INTO v_cols FROM jsonb_object_keys(p_row) AS k;
  EXECUTE format(
    'INSERT INTO public.%1$I (%2$s) SELECT %2$s FROM jsonb_populate_record(NULL::public.%1$I, $1) RETURNING to_jsonb(%1$I)',
    p_table, v_cols
  ) INTO v_out USING p_row;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.quoco_test_capture_update(p_table text, p_id uuid, p_set jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_tenant uuid;
  v_sets   text;
  v_out    jsonb;
BEGIN
  IF p_table IS NULL OR p_table NOT IN ('deliveries', 'capture_documents', 'capture_files', 'delivery_invoice_links') THEN
    RAISE EXCEPTION 'HELPER_TABLE_NOT_ALLOWED';
  END IF;
  IF jsonb_typeof(p_set) IS DISTINCT FROM 'object' OR p_set = '{}'::jsonb THEN
    RAISE EXCEPTION 'HELPER_ROW_NOT_OBJECT';
  END IF;
  EXECUTE format('SELECT tenant_id FROM public.%I WHERE id = $1', p_table) INTO v_tenant USING p_id;
  IF NOT public.quoco_test_capture_fixture_tenant_ok(v_tenant) THEN
    RAISE EXCEPTION 'HELPER_TENANT_NOT_FIXTURE';
  END IF;
  SELECT string_agg(format('%I = (jsonb_populate_record(NULL::public.%I, $2)).%I', k, p_table, k), ', ' ORDER BY k)
    INTO v_sets FROM jsonb_object_keys(p_set) AS k;
  EXECUTE format('UPDATE public.%1$I SET %2$s WHERE id = $1 RETURNING to_jsonb(%1$I)', p_table, v_sets)
    INTO v_out USING p_id, p_set;
  RETURN v_out;
END;
$$;

CREATE OR REPLACE FUNCTION public.quoco_test_capture_cleanup(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_links int;
  v_files int;
  v_deliveries int;
  v_documents int;
BEGIN
  IF NOT public.quoco_test_capture_fixture_tenant_ok(p_tenant_id) THEN
    RAISE EXCEPTION 'HELPER_TENANT_NOT_FIXTURE';
  END IF;
  DELETE FROM public.delivery_invoice_links WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_links = ROW_COUNT;
  DELETE FROM public.capture_files WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_files = ROW_COUNT;
  DELETE FROM public.deliveries WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_deliveries = ROW_COUNT;
  DELETE FROM public.capture_documents WHERE tenant_id = p_tenant_id;
  GET DIAGNOSTICS v_documents = ROW_COUNT;
  RETURN jsonb_build_object('delivery_invoice_links', v_links, 'capture_files', v_files,
                            'deliveries', v_deliveries, 'capture_documents', v_documents);
END;
$$;

CREATE OR REPLACE FUNCTION public.quoco_test_capture_acl()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_t   text;
  v_r   text;
  v_p   text;
  v_f   text;
  v_tbl jsonb := '{}'::jsonb;
  v_fn  jsonb := '{}'::jsonb;
  v_row jsonb;
  v_cell jsonb;
BEGIN
  FOREACH v_t IN ARRAY ARRAY['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links'] LOOP
    v_row := '{}'::jsonb;
    FOREACH v_r IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      v_cell := '{}'::jsonb;
      FOREACH v_p IN ARRAY ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN'] LOOP
        v_cell := v_cell || jsonb_build_object(v_p, has_table_privilege(v_r, 'public.' || v_t, v_p));
      END LOOP;
      v_row := v_row || jsonb_build_object(v_r, v_cell);
    END LOOP;
    v_tbl := v_tbl || jsonb_build_object(v_t, v_row);
  END LOOP;
  FOREACH v_f IN ARRAY ARRAY['trg_dil_before_insert', 'trg_dil_before_update', 'trg_deliveries_before_update', 'trg_capture_documents_before_update', 'trg_deliveries_before_insert', 'trg_capture_documents_before_insert'] LOOP
    SELECT jsonb_build_object(
             'exists', true,
             'prosecdef', p.prosecdef,
             'proconfig', to_jsonb(p.proconfig),
             'owner', pg_get_userbyid(p.proowner)::text,
             'anon_execute', has_function_privilege('anon', p.oid, 'EXECUTE'),
             'authenticated_execute', has_function_privilege('authenticated', p.oid, 'EXECUTE'),
             'service_role_execute', has_function_privilege('service_role', p.oid, 'EXECUTE'))
      INTO v_row
      FROM pg_proc p
     WHERE p.oid = to_regprocedure('public.' || v_f || '()');
    v_fn := v_fn || jsonb_build_object(v_f, COALESCE(v_row, jsonb_build_object('exists', false)));
  END LOOP;
  RETURN jsonb_build_object('tables', v_tbl, 'functions', v_fn);
END;
$$;

CREATE OR REPLACE FUNCTION public.quoco_test_capture_helpers_present()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT to_regprocedure('public.quoco_test_capture_fixture_tenant_ok(uuid)') IS NOT NULL
     AND to_regprocedure('public.quoco_test_capture_insert(text,jsonb)') IS NOT NULL
     AND to_regprocedure('public.quoco_test_capture_update(text,uuid,jsonb)') IS NOT NULL
     AND to_regprocedure('public.quoco_test_capture_cleanup(uuid)') IS NOT NULL
     AND to_regprocedure('public.quoco_test_capture_acl()') IS NOT NULL
     AND to_regprocedure('public.quoco_test_capture_helpers_present()') IS NOT NULL;
$$;

REVOKE ALL ON FUNCTION public.quoco_test_capture_fixture_tenant_ok(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quoco_test_capture_insert(text, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quoco_test_capture_update(text, uuid, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quoco_test_capture_cleanup(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quoco_test_capture_acl() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quoco_test_capture_helpers_present() FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.quoco_test_capture_fixture_tenant_ok(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.quoco_test_capture_insert(text, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.quoco_test_capture_update(text, uuid, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.quoco_test_capture_cleanup(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.quoco_test_capture_acl() TO service_role;
GRANT EXECUTE ON FUNCTION public.quoco_test_capture_helpers_present() TO service_role;

-- DOWN (rehearsal only -- inert when this file is applied normally; every
-- line below is blank or a comment). S-D ORDER: run this BEFORE 049's own
-- DOWN, because these function bodies name the four 049 tables and 049's
-- intensional DOWN guard must not see them.
--
-- BEGIN;
-- DROP FUNCTION IF EXISTS public.quoco_test_capture_helpers_present();
-- DROP FUNCTION IF EXISTS public.quoco_test_capture_acl();
-- DROP FUNCTION IF EXISTS public.quoco_test_capture_cleanup(uuid);
-- DROP FUNCTION IF EXISTS public.quoco_test_capture_update(text, uuid, jsonb);
-- DROP FUNCTION IF EXISTS public.quoco_test_capture_insert(text, jsonb);
-- DROP FUNCTION IF EXISTS public.quoco_test_capture_fixture_tenant_ok(uuid);
-- COMMIT;
