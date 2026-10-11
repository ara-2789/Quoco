-- EXPECT_PASS: 19
\echo == T-RLS (D-20, R7): SELECT audience = PMs of the row's project, users.status = active; nobody else ==
\pset tuples_only on
\pset format unaligned
\echo -- rows (inserted as the owner): P1: doc D1 + delivery V1, invoice D2 + V2 + link L1, file F1.  P2 (same tenant): D3, V3, invoice D4 + V4 + link L2, file F2.  T2/P3: doc D5, delivery V5, file F3.
SELECT t.mk_dc('{D1}', '{V1}', 'SM_R_dc1');
SELECT t.mk_inv('{D2}', '{V2}', '{L1}', 'SM_R_inv2');
SELECT t.mk_doc('{D3}', 'dc', 'SM_R_dc3', '{P2}');
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, delivery_type, dc_document_id) VALUES ('{V3}', '{T1}', '{P2}', '{U.ENG1}', now() - interval '1 hour', 'supplier', '{D3}');
SELECT t.mk_doc('{D4}', 'invoice', 'SM_R_inv4', '{P2}');
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, delivery_type, created_from_invoice_id) VALUES ('{V4}', '{T1}', '{P2}', '{U.ENG1}', now() - interval '1 hour', 'supplier', '{D4}');
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L2}', '{T1}', '{P2}', '{V4}', '{D4}', 'created_from_invoice');
INSERT INTO public.capture_files (id, tenant_id, project_id, document_id, file_no, source_message_sid, media_index) VALUES ('80000000-0000-0000-0000-000000000001', '{T1}', '{P1}', '{D1}', 1, 'SM_R_f1', 0), ('80000000-0000-0000-0000-000000000002', '{T1}', '{P2}', '{D3}', 1, 'SM_R_f2', 0);
INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid) VALUES ('{D5}', '{T2}', '{P3}', 'dc', '{U.PM3}', 'SM_R_dc5');
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{V5}', '{T2}', '{P3}', '{U.PM3}', now() - interval '1 hour', '{D5}');
INSERT INTO public.capture_files (id, tenant_id, project_id, document_id, file_no, source_message_sid, media_index) VALUES ('80000000-0000-0000-0000-000000000003', '{T2}', '{P3}', '{D5}', 1, 'SM_R_f3', 0);
\echo -- what each actor sees, as documents/deliveries/links/files counts. The owner sees everything (positive control for the rows):
\set cnt 'SELECT (SELECT count(*) FROM public.capture_documents)::text || ''/'' || (SELECT count(*) FROM public.deliveries)::text || ''/'' || (SELECT count(*) FROM public.delivery_invoice_links)::text || ''/'' || (SELECT count(*) FROM public.capture_files)::text'
SELECT t.val('owner sees all rows (docs/deliveries/links/files)', :'cnt', '5/5/2/3');
\echo
\echo -- ===== PM1: PM member of P1 -> only P1 =====
SET ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '{A.PM1}', false);
SELECT t.val('PM1 (pm of P1)', :'cnt', '2/2/1/1');
SELECT set_config('request.jwt.claim.sub', '{A.PM2}', false);
SELECT t.val('PM2 (pm of P2, same tenant) sees only P2', :'cnt', '2/2/1/1');
SELECT t.val('PM2 sees none of P1: document D1', $$SELECT count(*)::text FROM public.capture_documents WHERE id = '{D1}'$$, '0');
SELECT set_config('request.jwt.claim.sub', '{A.PM3}', false);
SELECT t.val('PM3 (pm of P3, OTHER tenant) sees only T2', :'cnt', '1/1/0/1');
SELECT t.val('PM3 sees none of T1: document D1', $$SELECT count(*)::text FROM public.capture_documents WHERE id = '{D1}'$$, '0');
SELECT set_config('request.jwt.claim.sub', '{A.ADMP}', false);
SELECT t.val('ADMP (admin who IS a pm member of P1)', :'cnt', '2/2/1/1');
SELECT set_config('request.jwt.claim.sub', '{A.ADMN}', false);
SELECT t.val('ADMN (admin, NO membership) sees nothing', :'cnt', '0/0/0/0');
SELECT set_config('request.jwt.claim.sub', '{A.QS1}', false);
SELECT t.val('QS1 (qs member of P1) sees nothing (QS excluded in 1a)', :'cnt', '0/0/0/0');
SELECT set_config('request.jwt.claim.sub', '{A.DPM}', false);
SELECT t.val('DPM (DEACTIVATED pm member of P1) sees nothing', :'cnt', '0/0/0/0');
SELECT set_config('request.jwt.claim.sub', '{A.PEND}', false);
SELECT t.val('PEND (PENDING pm member of P1) sees nothing', :'cnt', '0/0/0/0');
SELECT set_config('request.jwt.claim.sub', '', false);
SELECT t.val('authenticated with no auth.uid() sees nothing', :'cnt', '0/0/0/0');
RESET ROLE;
\echo
\echo -- ===== anon: no grant at all =====
SET ROLE anon;
SELECT t.expect('anon SELECT capture_documents', 'SELECT count(*) FROM public.capture_documents', '42501');
SELECT t.expect('anon SELECT deliveries', 'SELECT count(*) FROM public.deliveries', '42501');
SELECT t.expect('anon SELECT delivery_invoice_links', 'SELECT count(*) FROM public.delivery_invoice_links', '42501');
SELECT t.expect('anon SELECT capture_files', 'SELECT count(*) FROM public.capture_files', '42501');
RESET ROLE;
\echo
\echo -- ===== catalog: RLS enabled (not forced), one SELECT policy per table, no write policy =====
SELECT t.val('RLS enabled on all four, none forced', $$SELECT count(*)::text FROM pg_class WHERE oid IN ('public.capture_documents'::regclass, 'public.capture_files'::regclass, 'public.deliveries'::regclass, 'public.delivery_invoice_links'::regclass) AND relrowsecurity AND NOT relforcerowsecurity$$, '4');
SELECT t.val('exactly 4 policies, all SELECT, all TO authenticated', $$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links') AND cmd = 'SELECT' AND roles = '{authenticated}'$$, '4');
SELECT t.val('no INSERT/UPDATE/DELETE/ALL policy on the four tables', $$SELECT count(*)::text FROM pg_policies WHERE schemaname = 'public' AND tablename IN ('capture_documents', 'capture_files', 'deliveries', 'delivery_invoice_links') AND cmd <> 'SELECT'$$, '0');
