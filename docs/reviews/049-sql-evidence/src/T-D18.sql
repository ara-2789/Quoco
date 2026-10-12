-- EXPECT_PASS: 11
\echo == T-D18 (D-18): fixed-value kind columns -- wrong kind -> 23503; other project -> 23503 ==
\pset tuples_only on
\pset format unaligned
\echo -- setup: D1 dc (P1); D2 invoice (P1); D3 dc in project P2 (same tenant); D4 invoice (P1); D5 dc document in tenant T2
\echo -- (each attempt below uses its OWN delivery id, so one attempt's outcome cannot mask the next)
SELECT t.mk_doc('{D1}', 'dc', 'SM_D18_1');
SELECT t.mk_doc('{D2}', 'invoice', 'SM_D18_2');
SELECT t.mk_doc('{D3}', 'dc', 'SM_D18_3', '{P2}');
SELECT t.mk_doc('{D4}', 'invoice', 'SM_D18_4');
INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid) VALUES ('{D5}', '{T2}', '{P3}', 'dc', '{U.PM3}', 'SM_D18_5');
\echo -- wrong kind
SELECT t.expect('D18a dc_document_id pointing at an INVOICE document', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{V4}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D2}')$$, '23503');
SELECT t.expect('D18b created_from_invoice_id pointing at a DC document', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, created_from_invoice_id) VALUES ('{V5}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D1}')$$, '23503');
\echo -- other project, other tenant
SELECT t.expect('D18c delivery in P1 pointing at a DC document of P2 (same tenant)', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{V6}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D3}')$$, '23503');
SELECT t.expect('D18d delivery in T1/P1 pointing at a DC document of tenant T2', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{V7}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D5}')$$, '23503');
\echo -- the fixed-value columns themselves, and the exactly-one-pointer CHECK
SELECT t.expect('D18e dc_doc_kind forced to invoice', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, dc_doc_kind) VALUES ('{V8}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D2}', 'invoice')$$, '23514');
SELECT t.expect('D18f both document pointers set', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, created_from_invoice_id) VALUES ('{V9}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D1}', '{D2}')$$, '23514');
SELECT t.expect('D18g neither document pointer set', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at) VALUES ('{V10}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour')$$, '23514');
\echo -- positive controls: the right kind in the right project inserts; MATCH SIMPLE skips the non-chosen pointer
SELECT t.expect('D18h DC delivery -> DC document D1', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{V1}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D1}')$$, 'ok');
SELECT t.expect('D18i automatic delivery -> invoice document D4', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, created_from_invoice_id) VALUES ('{V2}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D4}')$$, 'ok');
\echo -- one document, one delivery, for life (D-19)
SELECT t.expect('D18j second delivery for the same DC document', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{V3}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D1}')$$, '23505');
SELECT t.expect('D18k second automatic delivery for the same invoice', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, created_from_invoice_id) VALUES ('{V11}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D4}')$$, '23505');
