-- 049 privilege readback (read-only). Run on PROD after the apply (runbook step D).
-- The UP already aborts on a wrong ACL (its in-transaction ACL_ASSERT block); this is the
-- post-apply OBSERVATION of the same facts, plus the PUBLIC pseudo-role, which that block
-- does not name. Expected values are in docs/reviews/049-prod-apply-runbook.md step D.
-- Table rule: anon nothing; authenticated and service_role SELECT only.
-- Function rule: no EXECUTE for anon, authenticated, service_role or PUBLIC.
BEGIN;
SET TRANSACTION READ ONLY;
WITH tbl AS (
  SELECT unnest(ARRAY['capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links']) AS t
), fn AS (
  SELECT unnest(ARRAY['trg_dil_before_insert', 'trg_dil_before_update', 'trg_deliveries_before_update',
                      'trg_capture_documents_before_update', 'trg_deliveries_before_insert',
                      'trg_capture_documents_before_insert']) AS f
), rl AS (
  SELECT unnest(ARRAY['anon', 'authenticated', 'service_role']) AS r
), pv AS (
  SELECT unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']) AS p
), tcells AS (
  SELECT tbl.t, rl.r, pv.p,
         has_table_privilege(rl.r, 'public.' || tbl.t, pv.p) AS got,
         (pv.p = 'SELECT' AND rl.r <> 'anon') AS want
    FROM tbl, rl, pv
   WHERE to_regclass('public.' || tbl.t) IS NOT NULL
), fcells AS (
  SELECT fn.f, rl.r, has_function_privilege(rl.r, ('public.' || fn.f || '()')::regprocedure, 'EXECUTE') AS got
    FROM fn, rl
   WHERE to_regprocedure('public.' || fn.f || '()') IS NOT NULL
)
SELECT k, v FROM (
  SELECT 1 AS o, 'table cells checked' AS k, count(*)::text AS v FROM tcells
  UNION ALL
  SELECT 2, 'table cells unexpected', count(*) FILTER (WHERE got IS DISTINCT FROM want)::text FROM tcells
  UNION ALL
  SELECT 3, 'table cells unexpected list',
         COALESCE(string_agg(t || ':' || r || ':' || p || '=' || got, ' ' ORDER BY t, r, p) FILTER (WHERE got IS DISTINCT FROM want), '-')
    FROM tcells
  UNION ALL
  SELECT 4, 'PUBLIC grants on 049 tables', count(*)::text
    FROM pg_class c CROSS JOIN LATERAL aclexplode(c.relacl) a
   WHERE c.relnamespace = 'public'::regnamespace
     AND c.relname IN (SELECT t FROM tbl) AND a.grantee = 0
  UNION ALL
  SELECT 5, 'function cells checked', count(*)::text FROM fcells
  UNION ALL
  SELECT 6, 'function cells with EXECUTE', count(*) FILTER (WHERE got)::text FROM fcells
  UNION ALL
  SELECT 7, 'functions with NULL proacl (default = PUBLIC EXECUTE)', count(*)::text
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (SELECT f FROM fn) AND p.proacl IS NULL
  UNION ALL
  SELECT 8, 'PUBLIC grants on 049 functions', count(*)::text
    FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
   WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN (SELECT f FROM fn) AND a.grantee = 0
) x
ORDER BY o;
ROLLBACK;
