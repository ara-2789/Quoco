-- 049 object fingerprint (read-only), scoped to 049's own objects only.
-- Run on TEST-DB immediately before the prod apply (the live rehearsal reference,
-- CLAUDE.md section 0, PROD APPLIES rule (b)) and on PROD after the apply.
-- PASS = every (k, v) line identical between the two runs.
--
-- Why scoped: the 9 whole-schema fingerprints used in block 2b hash every object
-- in public. Prod and test-db differ outside 049 by design (test-only helper
-- functions, the outbound_sends grant exception), so whole-schema hashes cannot
-- match across the two databases. These lines hash only what 049 creates.
-- Columns are keyed by name, not attnum (test-db has dropped-column gaps; see the
-- 048 prod record, F5). Nothing here casts to ::regclass, so the file also runs
-- before the apply, where every line reads empty / 0.
BEGIN;
SET TRANSACTION READ ONLY;
WITH t AS (
  SELECT c.oid, c.relname
    FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
     AND c.relname IN ('capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links')
), f AS (
  SELECT p.oid, p.proname
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('trg_dil_before_insert', 'trg_dil_before_update', 'trg_deliveries_before_update',
                       'trg_capture_documents_before_update', 'trg_deliveries_before_insert',
                       'trg_capture_documents_before_insert')
)
SELECT k, v FROM (
  SELECT 1 AS o, 'tables present' AS k, count(*)::text AS v FROM t
  UNION ALL
  SELECT 2, 'tbl ' || t.relname,
         pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
         || ' acl=' || COALESCE(c.relacl::text, 'NULL')
    FROM t JOIN pg_class c ON c.oid = t.oid
  UNION ALL
  SELECT 3, 'cols ' || t.relname,
         count(a.attnum) || ' ' || md5(string_agg(
           a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':'
           || a.attgenerated::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attname))
    FROM t JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
    LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
   GROUP BY t.relname
  UNION ALL
  SELECT 4, 'constraints ' || t.relname,
         count(con.oid) || ' ' || md5(COALESCE(string_agg(con.conname || ':' || pg_get_constraintdef(con.oid), ',' ORDER BY con.conname), ''))
    FROM t LEFT JOIN pg_constraint con ON con.conrelid = t.oid
   GROUP BY t.relname
  UNION ALL
  SELECT 5, 'triggers ' || t.relname,
         count(tg.oid) || ' ' || md5(COALESCE(string_agg(pg_get_triggerdef(tg.oid), ',' ORDER BY tg.tgname), ''))
    FROM t LEFT JOIN pg_trigger tg ON tg.tgrelid = t.oid AND NOT tg.tgisinternal
   GROUP BY t.relname
  UNION ALL
  SELECT 6, 'policies ' || t.relname,
         count(pol.policyname) || ' ' || md5(COALESCE(string_agg(pol.policyname || ':' || pol.permissive || ':' || pol.cmd || ':'
           || pol.roles::text || ':' || COALESCE(pol.qual, '') || ':' || COALESCE(pol.with_check, ''), ',' ORDER BY pol.policyname), ''))
    FROM t LEFT JOIN pg_policies pol ON pol.schemaname = 'public' AND pol.tablename = t.relname
   GROUP BY t.relname
  UNION ALL
  SELECT 7, 'indexes ' || t.relname,
         count(i.indexname) || ' ' || md5(COALESCE(string_agg(i.indexname || ':' || i.indexdef, ',' ORDER BY i.indexname), ''))
    FROM t LEFT JOIN pg_indexes i ON i.schemaname = 'public' AND i.tablename = t.relname
   GROUP BY t.relname
  UNION ALL
  SELECT 8, 'comments ' || t.relname,
         count(ds.description) || ' ' || md5(COALESCE(string_agg(COALESCE(a.attname, '<table>') || ':' || ds.description, ',' ORDER BY COALESCE(a.attname, '')), ''))
    FROM t LEFT JOIN pg_description ds ON ds.objoid = t.oid AND ds.classoid = 'pg_class'::regclass
    LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ds.objsubid AND ds.objsubid > 0
   GROUP BY t.relname
  UNION ALL
  SELECT 9, 'functions present', count(*)::text FROM f
  UNION ALL
  SELECT 10, 'fn ' || f.proname,
         'pg_proc_count=' || (SELECT count(*) FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname = f.proname)
         || ' owner=' || pg_get_userbyid(p.proowner) || ' secdef=' || p.prosecdef
         || ' config=' || COALESCE(p.proconfig::text, 'NULL') || ' acl=' || COALESCE(p.proacl::text, 'NULL')
         || ' md5_prosrc=' || md5(p.prosrc) || ' md5_def=' || md5(pg_get_functiondef(p.oid))
    FROM f JOIN pg_proc p ON p.oid = f.oid
  UNION ALL
  SELECT 11, 'bucket capture-documents',
         COALESCE((SELECT 'public=' || b.public || ' limit=' || b.file_size_limit || ' mimes=' || b.allowed_mime_types::text
                     FROM storage.buckets b WHERE b.id = 'capture-documents'), 'absent')
) x
ORDER BY o, k;
ROLLBACK;
