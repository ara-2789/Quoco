-- EXPECT_PASS: 23
\echo == T-HELP (D-21, Q2-1): scripts/test-db-only-capture-helpers.sql -- loaded by the runner AFTER the 049 UP in this scenario only ==
\pset tuples_only on
\pset format unaligned
\echo -- a tenant that is NOT a capture fixture (slug lacks the zz-test-capture- prefix), with a project, a user and one document, created as the owner
INSERT INTO public.tenants (id, name, slug) VALUES ('10000000-0000-0000-0000-000000000003', 'Real-looking tenant', 'acme-builders');
INSERT INTO public.projects (id, tenant_id, name) VALUES ('20000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000003', 'Real project');
INSERT INTO public.users (id, tenant_id, full_name, role, status) VALUES ('30000000-0000-0000-0000-000000000010', '10000000-0000-0000-0000-000000000003', 'Real eng', 'engineer', 'active');
INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid) VALUES ('{D9}', '10000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000004', 'dc', '30000000-0000-0000-0000-000000000010', 'SM_H_real');
\echo
SET ROLE service_role;
SELECT t.val('CI pre-check: helpers present', $$SELECT public.quoco_test_capture_helpers_present()::text$$, 'true');
\echo -- insert through the helper (service_role has no INSERT grant of its own)
SELECT t.expect('H1 insert a capture_documents row for the fixture tenant', $$SELECT public.quoco_test_capture_insert('capture_documents', '{"id":"{D1}","tenant_id":"{T1}","project_id":"{P1}","kind":"dc","sent_by":"{U.ENG1}","source_message_sid":"SM_H_1"}'::jsonb)$$, 'ok');
SELECT t.expect('H2 insert a delivery: generated delivery_date is NOT supplied, defaults apply', $$SELECT public.quoco_test_capture_insert('deliveries', '{"id":"{V1}","tenant_id":"{T1}","project_id":"{P1}","reported_by":"{U.ENG1}","received_at":"2026-09-23T00:30:00+05:30","delivery_type":"supplier","dc_document_id":"{D1}"}'::jsonb)$$, 'ok');
SELECT t.val('H2 delivery_date was generated (IST date)', $$SELECT delivery_date::text FROM public.deliveries WHERE id = '{V1}'$$, '2026-09-23');
SELECT t.expect('H3 a caller NAMING a generated column still gets the rejection', $$SELECT public.quoco_test_capture_insert('deliveries', '{"id":"{V2}","tenant_id":"{T1}","project_id":"{P1}","reported_by":"{U.ENG1}","received_at":"2026-09-23T00:30:00+05:30","dc_document_id":"{D1}","delivery_date":"2026-01-01"}'::jsonb)$$, '428C9');
\echo -- the tenant guard (same function for insert, update and cleanup)
SELECT t.expect('H4 insert for a NON-fixture tenant', $$SELECT public.quoco_test_capture_insert('capture_documents', '{"tenant_id":"10000000-0000-0000-0000-000000000003","project_id":"20000000-0000-0000-0000-000000000004","kind":"dc","sent_by":"30000000-0000-0000-0000-000000000010","source_message_sid":"SM_H_x"}'::jsonb)$$, 'HELPER_TENANT_NOT_FIXTURE');
SELECT t.expect('H5 insert with NO tenant_id', $$SELECT public.quoco_test_capture_insert('capture_documents', '{"project_id":"{P1}","kind":"dc","sent_by":"{U.ENG1}","source_message_sid":"SM_H_y"}'::jsonb)$$, 'HELPER_TENANT_NOT_FIXTURE');
SELECT t.expect('H6 update a row of a NON-fixture tenant', $$SELECT public.quoco_test_capture_update('capture_documents', '{D9}', '{"caption":"x"}'::jsonb)$$, 'HELPER_TENANT_NOT_FIXTURE');
SELECT t.expect('H7 cleanup of a NON-fixture tenant', $$SELECT public.quoco_test_capture_cleanup('10000000-0000-0000-0000-000000000003')$$, 'HELPER_TENANT_NOT_FIXTURE');
SELECT t.val('H7 the non-fixture tenant row is still there', $$SELECT count(*)::text FROM public.capture_documents WHERE id = '{D9}'$$, '1');
SELECT t.expect('H8 table outside the allow-list', $$SELECT public.quoco_test_capture_insert('users', '{"tenant_id":"{T1}"}'::jsonb)$$, 'HELPER_TABLE_NOT_ALLOWED');
\echo -- the 049 triggers STILL FIRE through the helper (owner privileges do not bypass triggers)
SELECT t.expect('H9 update kind of a document -> TR5 refuses (E9)', $$SELECT public.quoco_test_capture_update('capture_documents', '{D1}', '{"kind":"invoice"}'::jsonb)$$, 'E9');
SELECT t.expect('H10 update an editable column', $$SELECT public.quoco_test_capture_update('capture_documents', '{D1}', '{"caption":"cement bags"}'::jsonb)$$, 'ok');
\echo -- the helper is the only write path for service_role; direct writes are still denied
SELECT t.expect('H11 direct INSERT as service_role', $$INSERT INTO public.capture_documents (tenant_id, project_id, kind, sent_by, source_message_sid) VALUES ('{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_H_z')$$, '42501');
RESET ROLE;
\echo -- EXECUTE: service_role only
SET ROLE anon;
SELECT t.expect('H12 anon calls the insert helper', $$SELECT public.quoco_test_capture_insert('capture_documents', '{}'::jsonb)$$, '42501');
SELECT t.expect('H12 anon calls helpers_present', $$SELECT public.quoco_test_capture_helpers_present()$$, '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT t.expect('H13 authenticated calls the cleanup helper', $$SELECT public.quoco_test_capture_cleanup('{T1}')$$, '42501');
SELECT t.expect('H13 authenticated calls the acl helper', $$SELECT public.quoco_test_capture_acl()$$, '42501');
RESET ROLE;
SET ROLE service_role;
SELECT t.val('H14 acl helper: service_role holds only SELECT on deliveries', $$SELECT (SELECT string_agg(k, ',' ORDER BY k) FROM jsonb_each_text(public.quoco_test_capture_acl() #> '{tables,deliveries,service_role}') AS e(k, v) WHERE v = 'true')$$, 'SELECT');
SELECT t.val('H14 acl helper: anon holds nothing on capture_files', $$SELECT count(*)::text FROM jsonb_each_text(public.quoco_test_capture_acl() #> '{tables,capture_files,anon}') AS e(k, v) WHERE v = 'true'$$, '0');
SELECT t.val('H14 acl helper: all four trigger functions are definer with empty search_path', $$SELECT count(*)::text FROM jsonb_each(public.quoco_test_capture_acl() #> '{functions}') AS e(k, v) WHERE (v ->> 'prosecdef') = 'true' AND v -> 'proconfig' = '["search_path=\"\""]'::jsonb$$, '4');
SELECT t.expect('H15 cleanup of the fixture tenant', $$SELECT public.quoco_test_capture_cleanup('{T1}')$$, 'ok');
SELECT t.val('H15 fixture tenant has no document left', $$SELECT count(*)::text FROM public.capture_documents WHERE tenant_id = '{T1}'$$, '0');
RESET ROLE;
