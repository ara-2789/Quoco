\echo == T-ACL: ACL fingerprint after UP -- has_table_privilege matrix (anon, authenticated, service_role x 8 privileges x 4 tables), function fingerprint, real denials ==
\pset tuples_only on
\pset format unaligned
\echo -- Pre-state of the scaffold (REAL dump of test-db public): default ACL for new public tables/functions created by postgres:
SELECT 'default_acl ' || defaclobjtype::text || ' ' || defaclacl::text FROM pg_default_acl WHERE defaclnamespace = 'public'::regnamespace AND defaclrole = 'postgres'::regrole ORDER BY defaclobjtype;
\echo
\echo -- ===== the intended matrix: anon none; authenticated SELECT; service_role SELECT; nobody TRUNCATE/REFERENCES/TRIGGER/MAINTAIN/INSERT/UPDATE/DELETE =====
\pset format aligned
\pset tuples_only off
SELECT tb AS table_name, r AS role, COALESCE(string_agg(p, ',' ORDER BY p) FILTER (WHERE has_table_privilege(r, 'public.' || tb, p)), '(none)') AS granted
FROM unnest(ARRAY['capture_documents','capture_files','deliveries','delivery_invoice_links']) tb, unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p GROUP BY tb, r ORDER BY tb, r;
\pset tuples_only on
\pset format unaligned
SELECT t.val('privileges that differ from the intended matrix (96 cells)', $$SELECT count(*)::text FROM unnest(ARRAY['capture_documents','capture_files','deliveries','delivery_invoice_links']) tb, unnest(ARRAY['anon','authenticated','service_role']) r, unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER','MAINTAIN']) p WHERE has_table_privilege(r, 'public.' || tb, p) IS DISTINCT FROM (p = 'SELECT' AND r <> 'anon')$$, '0');
SELECT t.val('column-level grants on the four tables', $$SELECT count(*)::text FROM pg_attribute WHERE attrelid IN ('public.capture_documents'::regclass, 'public.capture_files'::regclass, 'public.deliveries'::regclass, 'public.delivery_invoice_links'::regclass) AND attacl IS NOT NULL$$, '0');
SELECT t.val('table ACL entries granted to PUBLIC (grantee 0)', $$SELECT count(*)::text FROM pg_class c, aclexplode(c.relacl) x WHERE c.oid IN ('public.capture_documents'::regclass, 'public.capture_files'::regclass, 'public.deliveries'::regclass, 'public.delivery_invoice_links'::regclass) AND x.grantee = 0$$, '0');
\echo -- raw relacl of the four tables (owner postgres keeps everything; that is not a role under test):
SELECT relname || ' ' || COALESCE(relacl::text, '(null)') FROM pg_class WHERE oid IN ('public.capture_documents'::regclass, 'public.capture_files'::regclass, 'public.deliveries'::regclass, 'public.delivery_invoice_links'::regclass) ORDER BY relname;
\echo
\echo -- ===== the four trigger functions: fingerprint =====
\pset format aligned
\pset tuples_only off
SELECT p.proname, p.prosecdef, p.proconfig, pg_get_userbyid(p.proowner) AS owner, p.proacl, has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_x, has_function_privilege('authenticated', p.oid, 'EXECUTE') AS auth_x, has_function_privilege('service_role', p.oid, 'EXECUTE') AS svc_x FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'trg\_%' ORDER BY p.proname;
\pset tuples_only on
\pset format unaligned
SELECT t.val('trigger functions that are SECURITY DEFINER, search_path pinned to empty, owner postgres', $$SELECT count(*)::text FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('trg_dil_before_insert','trg_dil_before_update','trg_deliveries_before_update','trg_capture_documents_before_update') AND p.prosecdef AND p.proconfig = ARRAY['search_path=""']::text[] AND pg_get_userbyid(p.proowner) = 'postgres'$$, '4');
SELECT t.val('EXECUTE held by anon/authenticated/service_role/PUBLIC on any trigger function', $$SELECT count(*)::text FROM pg_proc p, aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) x WHERE p.proname IN ('trg_dil_before_insert','trg_dil_before_update','trg_deliveries_before_update','trg_capture_documents_before_update') AND p.pronamespace = 'public'::regnamespace AND x.privilege_type = 'EXECUTE' AND (x.grantee = 0 OR x.grantee IN (SELECT oid FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')))$$, '0');
SELECT t.val('the four triggers exist and are enabled', $$SELECT count(*)::text FROM pg_trigger WHERE NOT tgisinternal AND tgrelid IN ('public.capture_documents'::regclass, 'public.deliveries'::regclass, 'public.delivery_invoice_links'::regclass) AND tgenabled = 'O'$$, '4');
\echo
\echo -- ===== real denials, as each role (42501 = insufficient_privilege). SQL runs through EXECUTE inside the role's session =====
SET ROLE anon;
SELECT t.expect('anon SELECT capture_documents', 'SELECT count(*) FROM public.capture_documents', '42501');
SELECT t.expect('anon INSERT capture_documents', 'INSERT INTO public.capture_documents DEFAULT VALUES', '42501');
SELECT t.expect('anon SELECT capture_files', 'SELECT count(*) FROM public.capture_files', '42501');
SELECT t.expect('anon INSERT capture_files', 'INSERT INTO public.capture_files DEFAULT VALUES', '42501');
SELECT t.expect('anon SELECT deliveries', 'SELECT count(*) FROM public.deliveries', '42501');
SELECT t.expect('anon INSERT deliveries', 'INSERT INTO public.deliveries DEFAULT VALUES', '42501');
SELECT t.expect('anon SELECT delivery_invoice_links', 'SELECT count(*) FROM public.delivery_invoice_links', '42501');
SELECT t.expect('anon INSERT delivery_invoice_links', 'INSERT INTO public.delivery_invoice_links DEFAULT VALUES', '42501');
SELECT t.expect('anon calls trg_dil_before_insert()', 'SELECT public.trg_dil_before_insert()', '42501');
SELECT t.expect('anon calls trg_dil_before_update()', 'SELECT public.trg_dil_before_update()', '42501');
SELECT t.expect('anon calls trg_deliveries_before_update()', 'SELECT public.trg_deliveries_before_update()', '42501');
SELECT t.expect('anon calls trg_capture_documents_before_update()', 'SELECT public.trg_capture_documents_before_update()', '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT t.expect('authenticated SELECT capture_documents (granted; RLS filters rows)', 'SELECT count(*) FROM public.capture_documents', 'ok');
SELECT t.expect('authenticated INSERT capture_documents', 'INSERT INTO public.capture_documents DEFAULT VALUES', '42501');
SELECT t.expect('authenticated UPDATE capture_documents', 'UPDATE public.capture_documents SET created_at = created_at', '42501');
SELECT t.expect('authenticated DELETE capture_documents', 'DELETE FROM public.capture_documents', '42501');
SELECT t.expect('authenticated TRUNCATE capture_documents', 'TRUNCATE public.capture_documents', '42501');
SELECT t.expect('authenticated SELECT capture_files (granted; RLS filters rows)', 'SELECT count(*) FROM public.capture_files', 'ok');
SELECT t.expect('authenticated INSERT capture_files', 'INSERT INTO public.capture_files DEFAULT VALUES', '42501');
SELECT t.expect('authenticated UPDATE capture_files', 'UPDATE public.capture_files SET created_at = created_at', '42501');
SELECT t.expect('authenticated DELETE capture_files', 'DELETE FROM public.capture_files', '42501');
SELECT t.expect('authenticated TRUNCATE capture_files', 'TRUNCATE public.capture_files', '42501');
SELECT t.expect('authenticated SELECT deliveries (granted; RLS filters rows)', 'SELECT count(*) FROM public.deliveries', 'ok');
SELECT t.expect('authenticated INSERT deliveries', 'INSERT INTO public.deliveries DEFAULT VALUES', '42501');
SELECT t.expect('authenticated UPDATE deliveries', 'UPDATE public.deliveries SET created_at = created_at', '42501');
SELECT t.expect('authenticated DELETE deliveries', 'DELETE FROM public.deliveries', '42501');
SELECT t.expect('authenticated TRUNCATE deliveries', 'TRUNCATE public.deliveries', '42501');
SELECT t.expect('authenticated SELECT delivery_invoice_links (granted; RLS filters rows)', 'SELECT count(*) FROM public.delivery_invoice_links', 'ok');
SELECT t.expect('authenticated INSERT delivery_invoice_links', 'INSERT INTO public.delivery_invoice_links DEFAULT VALUES', '42501');
SELECT t.expect('authenticated UPDATE delivery_invoice_links', 'UPDATE public.delivery_invoice_links SET created_at = created_at', '42501');
SELECT t.expect('authenticated DELETE delivery_invoice_links', 'DELETE FROM public.delivery_invoice_links', '42501');
SELECT t.expect('authenticated TRUNCATE delivery_invoice_links', 'TRUNCATE public.delivery_invoice_links', '42501');
SELECT t.expect('authenticated calls trg_dil_before_insert()', 'SELECT public.trg_dil_before_insert()', '42501');
SELECT t.expect('authenticated calls trg_dil_before_update()', 'SELECT public.trg_dil_before_update()', '42501');
SELECT t.expect('authenticated calls trg_deliveries_before_update()', 'SELECT public.trg_deliveries_before_update()', '42501');
SELECT t.expect('authenticated calls trg_capture_documents_before_update()', 'SELECT public.trg_capture_documents_before_update()', '42501');
RESET ROLE;
SET ROLE service_role;
SELECT t.expect('service_role SELECT capture_documents (granted; RLS filters rows)', 'SELECT count(*) FROM public.capture_documents', 'ok');
SELECT t.expect('service_role INSERT capture_documents', 'INSERT INTO public.capture_documents DEFAULT VALUES', '42501');
SELECT t.expect('service_role UPDATE capture_documents', 'UPDATE public.capture_documents SET created_at = created_at', '42501');
SELECT t.expect('service_role DELETE capture_documents', 'DELETE FROM public.capture_documents', '42501');
SELECT t.expect('service_role TRUNCATE capture_documents', 'TRUNCATE public.capture_documents', '42501');
SELECT t.expect('service_role SELECT capture_files (granted; RLS filters rows)', 'SELECT count(*) FROM public.capture_files', 'ok');
SELECT t.expect('service_role INSERT capture_files', 'INSERT INTO public.capture_files DEFAULT VALUES', '42501');
SELECT t.expect('service_role UPDATE capture_files', 'UPDATE public.capture_files SET created_at = created_at', '42501');
SELECT t.expect('service_role DELETE capture_files', 'DELETE FROM public.capture_files', '42501');
SELECT t.expect('service_role TRUNCATE capture_files', 'TRUNCATE public.capture_files', '42501');
SELECT t.expect('service_role SELECT deliveries (granted; RLS filters rows)', 'SELECT count(*) FROM public.deliveries', 'ok');
SELECT t.expect('service_role INSERT deliveries', 'INSERT INTO public.deliveries DEFAULT VALUES', '42501');
SELECT t.expect('service_role UPDATE deliveries', 'UPDATE public.deliveries SET created_at = created_at', '42501');
SELECT t.expect('service_role DELETE deliveries', 'DELETE FROM public.deliveries', '42501');
SELECT t.expect('service_role TRUNCATE deliveries', 'TRUNCATE public.deliveries', '42501');
SELECT t.expect('service_role SELECT delivery_invoice_links (granted; RLS filters rows)', 'SELECT count(*) FROM public.delivery_invoice_links', 'ok');
SELECT t.expect('service_role INSERT delivery_invoice_links', 'INSERT INTO public.delivery_invoice_links DEFAULT VALUES', '42501');
SELECT t.expect('service_role UPDATE delivery_invoice_links', 'UPDATE public.delivery_invoice_links SET created_at = created_at', '42501');
SELECT t.expect('service_role DELETE delivery_invoice_links', 'DELETE FROM public.delivery_invoice_links', '42501');
SELECT t.expect('service_role TRUNCATE delivery_invoice_links', 'TRUNCATE public.delivery_invoice_links', '42501');
SELECT t.expect('service_role calls trg_dil_before_insert()', 'SELECT public.trg_dil_before_insert()', '42501');
SELECT t.expect('service_role calls trg_dil_before_update()', 'SELECT public.trg_dil_before_update()', '42501');
SELECT t.expect('service_role calls trg_deliveries_before_update()', 'SELECT public.trg_deliveries_before_update()', '42501');
SELECT t.expect('service_role calls trg_capture_documents_before_update()', 'SELECT public.trg_capture_documents_before_update()', '42501');
RESET ROLE;
