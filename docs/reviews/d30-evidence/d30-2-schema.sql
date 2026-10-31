-- =============================================================================
-- d30-2-schema.sql  --  PART A: D-30 pre-run schema readback ("PITR substituted").
-- READ-ONLY: three plain SELECT statements, no BEGIN/ROLLBACK, no writes, no volatile functions.
-- Run in the Supabase SQL editor on PROD jvxwqignooseazzmwhvl. The editor shows ONLY the last
-- statement's result, so run the statements ONE AT A TIME (select one, Run) and paste each back:
--   A1  facet readback + per-object md5 + overall md5 (compare with the recorded baselines)
--   A2  full function bodies (pg_get_functiondef) -- the SAVED copy; save the raw output to a file
--   A3  the two 051 fingerprints, reproduced verbatim from 051-sql-evidence/P1-prod-postapply.txt
--
-- Facet formulations for cols / constraints / triggers / policies / indexes / comments / function
-- lines are copied from docs/reviews/049-apply-probes/FP049.sql so a value is comparable with what
-- 049's record describes. 049's record keeps COUNTS only for the tables (md5s were never written
-- down), so for those the baseline column is a count, not a hash. Where nothing was recorded the
-- baseline column says 'NONE RECORDED'. No baseline is invented.
--
-- Objects and where they come from (file:line, all under supabase/migrations/):
--   capture_documents          049_capture_tables.sql:281
--   capture_files              049_capture_tables.sql:312 ; 051_capture_files_immutability.sql:162 (ingested_at),
--                              :165-182 (CHECKs), :267 (trigger), :288 (column UPDATE grant)
--   deliveries                 049_capture_tables.sql:347
--   delivery_invoice_links     049_capture_tables.sql:403
--   jobs                       006_jobs_queue.sql:4 ; written by 050_material_inward_functions.sql:378
--   whatsapp_sessions          001_core_schema.sql:86 ; read/written by 050 (apply_* functions)
--   daily_logs                 001_core_schema.sql:99 ; written by 050 (apply_morning/evening_flow_turn)
--   users, project_members     001_core_schema.sql:36, :72 ; read by 050 (caller/PM checks)
--   projects, tenants          001_core_schema.sql:52, :17 ; FK targets of the 049 tables
--   storage bucket capture-documents  049_capture_tables.sql:1021
--   Functions (16):
--     049: trg_dil_before_insert :464, trg_dil_before_update :538, trg_deliveries_before_update :632,
--          trg_capture_documents_before_update :770, trg_deliveries_before_insert :822,
--          trg_capture_documents_before_insert :855
--     050: apply_material_inward_turn :68, expire_stale_material_inward :426, pm_set_delivery_details :466,
--          pm_approve_delivery :543, pm_reject_delivery :615, pm_link_invoice :772, pm_unlink_invoice :914,
--          apply_morning_flow_turn :1026 (CREATE OR REPLACE), apply_evening_flow_turn :1363 (CREATE OR REPLACE)
--     051: trg_capture_files_before_update :190
--   There is no migration after 051 (ls supabase/migrations at HEAD fe75d6cd).
-- =============================================================================

-- ---- A1 -----------------------------------------------------------------------------------------
WITH tl(tbl, tier) AS (VALUES
  ('capture_documents',      '049 table'),
  ('capture_files',          '049 table + 051 immutability'),
  ('deliveries',             '049 table'),
  ('delivery_invoice_links', '049 table'),
  ('jobs',                   '050 writes (capture_ingest job)'),
  ('whatsapp_sessions',      '050 reads/writes'),
  ('daily_logs',             '050 reads/writes'),
  ('users',                  '050 reads; FK target'),
  ('project_members',        '050 reads'),
  ('projects',               'FK target of 049 tables'),
  ('tenants',                'FK target of 049 tables')
), t AS (
  SELECT c.oid, c.relname, tl.tier
    FROM pg_class c JOIN tl ON tl.tbl = c.relname
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind = 'r'
), fl(fname, rec_md5_def, rec_acl, rec_src) AS (VALUES
  -- recorded md5(pg_get_functiondef) : 050-prod-apply-record.md:43 (post-apply, prod)
  ('apply_morning_flow_turn',  'cf2e78881f03d4e03a0dc51fd9b6008e', '{postgres=X/postgres,service_role=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('apply_evening_flow_turn',  '9987ab905a5563f94f9226445fbcef8b', '{postgres=X/postgres,service_role=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('apply_material_inward_turn','cecc170b26208d4b820402879e020271','{postgres=X/postgres,service_role=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('expire_stale_material_inward','06cc13da48b24ff258b6ce4e3b6bf944','{postgres=X/postgres,service_role=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('pm_approve_delivery',      '2e4ccc5c49aefe125e4f8e9ddb3ffe7d', '{postgres=X/postgres,authenticated=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('pm_link_invoice',          '1ba0c060ee0e222eaa5224c411ff4320', '{postgres=X/postgres,authenticated=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('pm_reject_delivery',       '07165f5b1317a12577dc59e3e463b062', '{postgres=X/postgres,authenticated=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('pm_set_delivery_details',  '6333390e137ee7e140b668e2b56f03bd', '{postgres=X/postgres,authenticated=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  ('pm_unlink_invoice',        '28185a9d79ea308ead1d2e7d67b0fc9c', '{postgres=X/postgres,authenticated=X/postgres}', '050-prod-apply-record.md:43,49-51'),
  -- 049 trigger functions: record says "identical md5_prosrc and md5_def" prod==test-db but never wrote the values down
  ('trg_dil_before_insert',                NULL, '{postgres=X/postgres}', '049-prod-apply-record.md:29 (acl only; md5 NOT recorded)'),
  ('trg_dil_before_update',                NULL, '{postgres=X/postgres}', '049-prod-apply-record.md:29 (acl only; md5 NOT recorded)'),
  ('trg_deliveries_before_update',         NULL, '{postgres=X/postgres}', '049-prod-apply-record.md:29 (acl only; md5 NOT recorded)'),
  ('trg_capture_documents_before_update',  NULL, '{postgres=X/postgres}', '049-prod-apply-record.md:29 (acl only; md5 NOT recorded)'),
  ('trg_deliveries_before_insert',         NULL, '{postgres=X/postgres}', '049-prod-apply-record.md:29 (acl only; md5 NOT recorded)'),
  ('trg_capture_documents_before_insert',  NULL, '{postgres=X/postgres}', '049-prod-apply-record.md:29 (acl only; md5 NOT recorded)'),
  -- 051: no standalone md5 recorded; its function body is inside fingerprint J (see A3)
  ('trg_capture_files_before_update',      NULL, NULL, 'NONE RECORDED standalone; covered by fingerprint J in A3')
), f AS (
  SELECT p.oid, p.proname, fl.rec_md5_def, fl.rec_acl, fl.rec_src
    FROM pg_proc p JOIN fl ON fl.fname = p.proname
   WHERE p.pronamespace = 'public'::regnamespace
), facets(obj, facet, val, baseline, baseline_src) AS (
  -- ---- table facets ----
  SELECT t.relname, '01 owner/rls/force/relacl',
         pg_get_userbyid(c.relowner) || ' rls=' || c.relrowsecurity || ' force=' || c.relforcerowsecurity
           || ' acl=' || COALESCE(c.relacl::text, 'NULL'),
         CASE WHEN t.relname IN ('capture_documents','deliveries','delivery_invoice_links')
              THEN 'postgres rls=true force=false acl={postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}' END,
         CASE WHEN t.relname IN ('capture_documents','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (capture_files differs by design after 051: see A3)' END
    FROM t JOIN pg_class c ON c.oid = t.oid
  UNION ALL
  SELECT t.relname, '02 table acl (aclexplode)',
         COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                                     || ':' || a.privilege_type || CASE WHEN a.is_grantable THEN '+grant' ELSE '' END,
                                     ' ' ORDER BY a.grantee, a.privilege_type)
                     FROM pg_class c2 CROSS JOIN LATERAL aclexplode(c2.relacl) a WHERE c2.oid = t.oid), '-'),
         NULL, NULL
    FROM t
  UNION ALL
  SELECT t.relname, '03 column acl (aclexplode on attacl)',
         COALESCE((SELECT string_agg(pa.attname || '>' || CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END
                                     || ':' || a.privilege_type, ' ' ORDER BY pa.attname, a.grantee, a.privilege_type)
                     FROM pg_attribute pa CROSS JOIN LATERAL aclexplode(pa.attacl) a
                    WHERE pa.attrelid = t.oid AND pa.attacl IS NOT NULL), '-'),
         CASE WHEN t.relname = 'capture_files'
              THEN 'service_role UPDATE on exactly ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state' END,
         CASE WHEN t.relname = 'capture_files' THEN '051-prod-apply-record.md:17; 051 migration :288' END
    FROM t
  UNION ALL
  SELECT t.relname, '04 columns (count md5)',
         (SELECT count(a.attnum) || ' ' || md5(string_agg(
            a.attname || ':' || format_type(a.atttypid, a.atttypmod) || ':' || a.attnotnull || ':'
            || a.attgenerated::text || ':' || COALESCE(pg_get_expr(d.adbin, d.adrelid), ''), ',' ORDER BY a.attname))
            FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
           WHERE a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped),
         CASE t.relname WHEN 'capture_documents' THEN 'count=11' WHEN 'deliveries' THEN 'count=23'
                        WHEN 'delivery_invoice_links' THEN 'count=17' WHEN 'capture_files' THEN 'count=16 at 049; 17 expected after 051 ingested_at' END,
         CASE WHEN t.relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (count only; md5 NOT recorded)' END
    FROM t
  UNION ALL
  SELECT t.relname, '05 constraints (count md5)',
         (SELECT count(con.oid) || ' ' || md5(COALESCE(string_agg(con.conname || ':' || pg_get_constraintdef(con.oid), ',' ORDER BY con.conname), ''))
            FROM pg_constraint con WHERE con.conrelid = t.oid),
         CASE t.relname WHEN 'capture_documents' THEN 'count=15' WHEN 'deliveries' THEN 'count=33'
                        WHEN 'delivery_invoice_links' THEN 'count=21' WHEN 'capture_files' THEN 'count=16 at 049; changed by 051 (+CHECKs :165-182)' END,
         CASE WHEN t.relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (count only; md5 NOT recorded)' END
    FROM t
  UNION ALL
  SELECT t.relname, '06 triggers non-internal (count md5)',
         (SELECT count(tg.oid) || ' ' || md5(COALESCE(string_agg(pg_get_triggerdef(tg.oid), ',' ORDER BY tg.tgname), ''))
            FROM pg_trigger tg WHERE tg.tgrelid = t.oid AND NOT tg.tgisinternal),
         CASE t.relname WHEN 'capture_documents' THEN 'count=2' WHEN 'deliveries' THEN 'count=2'
                        WHEN 'delivery_invoice_links' THEN 'count=2' WHEN 'capture_files' THEN 'count=0 at 049; 1 after 051 (trg_capture_files_before_update)' END,
         CASE WHEN t.relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (count only; md5 NOT recorded)' END
    FROM t
  UNION ALL
  SELECT t.relname, '07 policies (count md5)',
         (SELECT count(pol.policyname) || ' ' || md5(COALESCE(string_agg(pol.policyname || ':' || pol.permissive || ':' || pol.cmd || ':'
              || pol.roles::text || ':' || COALESCE(pol.qual, '') || ':' || COALESCE(pol.with_check, ''), ',' ORDER BY pol.policyname), ''))
            FROM pg_policies pol WHERE pol.schemaname = 'public' AND pol.tablename = t.relname),
         CASE WHEN t.relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links') THEN 'count=1' END,
         CASE WHEN t.relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (count only; md5 NOT recorded)' END
    FROM t
  UNION ALL
  SELECT t.relname, '08 indexes (count md5)',
         (SELECT count(i.indexname) || ' ' || md5(COALESCE(string_agg(i.indexname || ':' || i.indexdef, ',' ORDER BY i.indexname), ''))
            FROM pg_indexes i WHERE i.schemaname = 'public' AND i.tablename = t.relname),
         CASE t.relname WHEN 'capture_documents' THEN 'count=5' WHEN 'capture_files' THEN 'count=3'
                        WHEN 'deliveries' THEN 'count=7' WHEN 'delivery_invoice_links' THEN 'count=4' END,
         CASE WHEN t.relname IN ('capture_documents','capture_files','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (count only; md5 NOT recorded)' END
    FROM t
  UNION ALL
  SELECT t.relname, '09 comments (count md5)',
         (SELECT count(ds.description) || ' ' || md5(COALESCE(string_agg(COALESCE(a.attname, '<table>') || ':' || ds.description, ',' ORDER BY COALESCE(a.attname, '')), ''))
            FROM pg_description ds
            LEFT JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ds.objsubid AND ds.objsubid > 0
           WHERE ds.objoid = t.oid AND ds.classoid = 'pg_class'::regclass),
         CASE WHEN t.relname IN ('capture_documents','deliveries','delivery_invoice_links') THEN 'count=1' END,
         CASE WHEN t.relname IN ('capture_documents','deliveries','delivery_invoice_links')
              THEN '049-prod-apply-record.md:29 (count only; md5 NOT recorded). capture_files comments changed by 051: see A3 K' END
    FROM t
  UNION ALL
  -- ---- function facets ----
  SELECT f.proname, '10 function (owner secdef config acl md5_prosrc md5_def)',
         'pg_proc_count=' || (SELECT count(*) FROM pg_proc p2 WHERE p2.pronamespace = 'public'::regnamespace AND p2.proname = f.proname)
         || ' owner=' || pg_get_userbyid(p.proowner) || ' secdef=' || p.prosecdef
         || ' config=' || COALESCE(p.proconfig::text, 'NULL') || ' acl=' || COALESCE(p.proacl::text, 'NULL')
         || ' md5_prosrc=' || md5(p.prosrc) || ' md5_def=' || md5(pg_get_functiondef(p.oid)),
         CASE WHEN f.rec_md5_def IS NOT NULL THEN 'md5_def=' || f.rec_md5_def || ' acl=' || f.rec_acl
              WHEN f.rec_acl IS NOT NULL THEN 'acl=' || f.rec_acl END,
         f.rec_src
    FROM f JOIN pg_proc p ON p.oid = f.oid
  UNION ALL
  SELECT f.proname, '11 function acl (aclexplode on proacl)',
         COALESCE((SELECT string_agg(CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE pg_get_userbyid(a.grantee) END || ':' || a.privilege_type, ' ' ORDER BY a.grantee, a.privilege_type)
                     FROM pg_proc p3 CROSS JOIN LATERAL aclexplode(p3.proacl) a WHERE p3.oid = f.oid), '-'),
         NULL, NULL
    FROM f
  UNION ALL
  SELECT 'bucket capture-documents', '12 storage bucket',
         COALESCE((SELECT 'public=' || b.public || ' limit=' || b.file_size_limit || ' mimes=' || b.allowed_mime_types::text
                     FROM storage.buckets b WHERE b.id = 'capture-documents'), 'absent'),
         NULL, 'NONE RECORDED as a value (049 migration :1021 sets public=false, limit 16777216)'
), objmd5 AS (
  SELECT obj, md5(string_agg(facet || '=' || val, '|' ORDER BY facet)) AS om FROM facets GROUP BY obj
), shown AS (
  SELECT 1 AS o, obj || '  /  ' || facet AS k, val AS v, md5(val) AS md5_of_v, baseline, baseline_src,
         CASE WHEN baseline IS NULL THEN 'BASELINE ONLY (first readback)'
              WHEN facet LIKE '01%' THEN CASE WHEN val = baseline THEN 'MATCH' ELSE 'DIFFERS' END
              WHEN facet LIKE '10%' THEN CASE WHEN strpos(val, ' acl=' || substring(baseline from 'acl=(.*)$') || ' md5_prosrc=') > 0
                                               AND (substring(baseline from 'md5_def=([0-9a-f]+)') IS NULL
                                                    OR strpos(val, 'md5_def=' || substring(baseline from 'md5_def=([0-9a-f]+)')) > 0)
                                              THEN 'MATCH' ELSE 'DIFFERS' END
              WHEN baseline ~ '^count=[0-9]+$' THEN CASE WHEN split_part(val, ' ', 1) = substring(baseline from '[0-9]+') THEN 'MATCH (count only)' ELSE 'DIFFERS' END
              ELSE 'COMPARE BY EYE' END AS status
    FROM facets
  UNION ALL
  SELECT 2, 'OBJECT md5  /  ' || obj, om, om, NULL, NULL, 'BASELINE ONLY (first readback)' FROM objmd5
  UNION ALL
  SELECT 3, 'OVERALL md5 over all object md5s (ordered by object name)',
         (SELECT md5(string_agg(obj || '=' || om, '|' ORDER BY obj)) FROM objmd5),
         (SELECT md5(string_agg(obj || '=' || om, '|' ORDER BY obj)) FROM objmd5), NULL, NULL, 'BASELINE ONLY (first readback)'
  UNION ALL
  SELECT 0, 'SNAPSHOT  /  now(), server_version, objects found (tables of 11, functions of 16)',
         now()::text || ' | ' || current_setting('server_version') || ' | tables=' || (SELECT count(*) FROM t)
           || ' functions=' || (SELECT count(*) FROM f),
         NULL, 'tables=11 functions=16 (expected)', NULL,
         CASE WHEN (SELECT count(*) FROM t) = 11 AND (SELECT count(*) FROM f) = 16 THEN 'MATCH (counts)' ELSE 'DIFFERS (object count)' END
)
SELECT o, k, v, md5_of_v, baseline, baseline_src, status
  FROM shown
 ORDER BY o, k;

-- ---- A2: full bodies (the saved copy). Save the raw output; md5 per row is in the last column. ----
SELECT p.proname,
       pg_get_function_identity_arguments(p.oid) AS identity_args,
       pg_get_functiondef(p.oid)                 AS functiondef,
       md5(pg_get_functiondef(p.oid))            AS md5_def
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.proname IN ('trg_dil_before_insert','trg_dil_before_update','trg_deliveries_before_update',
                     'trg_capture_documents_before_update','trg_deliveries_before_insert','trg_capture_documents_before_insert',
                     'apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details',
                     'pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice',
                     'apply_morning_flow_turn','apply_evening_flow_turn','trg_capture_files_before_update')
 ORDER BY p.proname, p.oid;

-- ---- A3: the two 051 fingerprints, reproduced VERBATIM (expression text copied from
-- docs/reviews/051-sql-evidence/P1-prod-postapply.txt:273 (J) and :284 (K)).
-- Recorded prod post-apply values: J = 19102bc8020867d2650e13c6fddd13c0 ; K = b97d2e3b734f6c002fd5c0a57a06e643
-- (051-prod-apply-record.md:20). PASS = both equal the recorded values.
SELECT 'J fingerprint' AS name,
       '19102bc8020867d2650e13c6fddd13c0' AS recorded,
       md5(concat_ws('|', (SELECT coalesce(string_agg(pg_get_functiondef(p.oid), '' ORDER BY p.oid), '-') FROM pg_proc p WHERE p.proname = 'trg_capture_files_before_update'), (SELECT coalesce(string_agg(p.proacl::text, ',' ORDER BY p.oid), '-') FROM pg_proc p WHERE p.proname = 'trg_capture_files_before_update'), (SELECT coalesce(string_agg(pg_get_triggerdef(g.oid), ';' ORDER BY g.tgname), '-') FROM pg_trigger g WHERE g.tgrelid = 'public.capture_files'::regclass AND NOT g.tgisinternal), (SELECT relacl::text FROM pg_class WHERE oid = 'public.capture_files'::regclass), (SELECT coalesce(string_agg(attname || ':' || attacl::text, ',' ORDER BY attname), '-') FROM pg_attribute WHERE attrelid = 'public.capture_files'::regclass AND attacl IS NOT NULL), (SELECT coalesce(string_agg(conname || ':' || pg_get_constraintdef(oid) || ':' || convalidated::text, ';' ORDER BY conname), '-') FROM pg_constraint WHERE conrelid = 'public.capture_files'::regclass), (SELECT coalesce(string_agg(attname || ':' || format_type(atttypid, atttypmod) || ':' || attnotnull::text || ':' || atthasdef::text, ',' ORDER BY attnum), '-') FROM pg_attribute WHERE attrelid = 'public.capture_files'::regclass AND attnum > 0 AND NOT attisdropped))) AS live
UNION ALL
SELECT 'K comments hash',
       'b97d2e3b734f6c002fd5c0a57a06e643',
       md5(concat_ws('|', coalesce(obj_description('public.capture_files'::regclass, 'pg_class'), '-'), (SELECT coalesce(string_agg(a.attname || '=' || coalesce(col_description(a.attrelid, a.attnum), '-'), ',' ORDER BY a.attnum), '-') FROM pg_attribute a WHERE a.attrelid = 'public.capture_files'::regclass AND a.attnum > 0 AND NOT a.attisdropped), (SELECT coalesce(string_agg(coalesce(obj_description(p.oid, 'pg_proc'), '-'), ',' ORDER BY p.oid), '-') FROM pg_proc p WHERE p.proname = 'trg_capture_files_before_update')));
