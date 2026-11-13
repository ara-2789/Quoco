-- main.sql -- 052 dry-run, post-apply exercise (3c step 3). 052 is ALREADY APPLIED when this runs.
-- LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST.
\pset pager off
\set ECHO none
\echo == M1 engineer turn: start goes to step 2; file creates a document with received_at set, kind NULL, no delivery
SELECT t.turn('+91900000001', '4', 'm-a0', NULL, true) AS start;
SELECT t.ok('start: flow=invoice step=2 (step 1 retired)', t.sess('+91900000001') LIKE 'invoice/2 %');
SELECT t.turn('+91900000001', 'gate pass photo', 'm-a2', t.media(2)) AS file_turn;
SELECT t.ok('document created: kind NULL, kind_source NULL, kind_set_at NULL, kind_set_by NULL',
  (SELECT kind IS NULL AND kind_source IS NULL AND kind_set_at IS NULL AND kind_set_by IS NULL FROM public.capture_documents WHERE source_message_sid = 'm-a2'));
SELECT t.ok('received_at equals processed_messages.created_at of the same SID',
  (SELECT d.received_at = pm.created_at FROM public.capture_documents d JOIN public.processed_messages pm ON pm.message_sid = d.source_message_sid WHERE d.source_message_sid = 'm-a2'));
SELECT t.ok('received_at <= created_at', (SELECT received_at <= created_at FROM public.capture_documents WHERE source_message_sid = 'm-a2'));
SELECT t.ok('0 deliveries and 0 links for the document',
  (SELECT count(*) = 0 FROM public.deliveries WHERE dc_document_id = t.docid('m-a2') OR created_from_invoice_id = t.docid('m-a2'))
  AND (SELECT count(*) = 0 FROM public.delivery_invoice_links WHERE invoice_document_id = t.docid('m-a2')));
SELECT t.ok('2 files pending, 1 capture_ingest job', (SELECT count(*) = 2 FROM public.capture_files WHERE source_message_sid = 'm-a2' AND ingest_status = 'pending')
  AND (SELECT count(*) = 1 FROM public.jobs WHERE type = 'capture_ingest' AND payload->>'source_message_sid' = 'm-a2'));
SELECT t.ok('session at step 3 with mi_document_id', t.sess('+91900000001') LIKE 'invoice/3 %mi_document_id%');
SELECT t.turn('+91900000001', '1', 'm-a3') AS ack1;
SELECT t.ok('ack stored (yes), flow closed, still no delivery', (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE source_message_sid = 'm-a2')
  AND t.sess('+91900000001') LIKE 'NULL/0 %'
  AND (SELECT count(*) = 0 FROM public.deliveries WHERE dc_document_id = t.docid('m-a2')));

\echo == M2 flow variants: stray step-1 session read as step 2; text at step 2 re-asks once then closes
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, pending_flows, expires_at, updated_at)
VALUES ('+91900000002', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'invoice', 1, '{}'::jsonb, '[]'::jsonb, now() + interval '30 minutes', now());
SELECT t.turn('+91900000002', NULL, 'm-b2', t.media(1)) AS stray_step1_file;
SELECT t.ok('stray step-1 session + file: document created, step 3', t.docid('m-b2') IS NOT NULL AND t.sess('+91900000002') LIKE 'invoice/3 %');
SELECT t.turn('+91900000003', '4', 'm-c0', NULL, true) AS start3;
SELECT t.turn('+91900000003', 'hello', 'm-c1') AS text1;
SELECT t.ok('text at step 2: first is a re-ask, flow still open', t.sess('+91900000003') LIKE 'invoice/2 %');
SELECT t.turn('+91900000003', 'hello again', 'm-c2') AS text2;
SELECT t.ok('second text closes the flow, nothing recorded', t.sess('+91900000003') LIKE 'NULL/0 %' AND t.docid('m-c1') IS NULL AND t.docid('m-c2') IS NULL);
-- Doc m-a2 (acked), m-b2 (no ack yet, session at step 3 for it). Doc m-d2: a third, left unclassified for the DOWN refusal.
SELECT t.turn('+91900000004', '4', 'm-d0', NULL, true) AS start4;
SELECT t.turn('+91900000004', NULL, 'm-d2', t.media(1)) AS file4;
SELECT t.ok('third document unclassified', (SELECT kind IS NULL FROM public.capture_documents WHERE source_message_sid = 'm-d2'));

\echo == M3 pm_classify_document: refusals first (each leaves kind NULL and writes nothing)
SELECT 'PM2 (other project)        ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000007', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'QS1 (qs)                   ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000003', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'DPM (deactivated pm)       ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000004', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'PM3 (other tenant)         ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000009', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'no auth uid                ' || t.try_as('authenticated', NULL, format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'unknown document id        ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', gen_random_uuid(), 'dc')) AS r;
SELECT 'NULL document id           ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', 'select public.pm_classify_document(NULL, ''dc'')::text') AS r;
SELECT 'PM1 bad kind               ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'receipt')) AS r;
SELECT 'PM1 NULL kind              ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,NULL)::text', t.docid('m-a2'))) AS r;
SELECT 'anon on wrapper            ' || t.try_as('anon', NULL, format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'service_role on wrapper    ' || t.try_as('service_role', NULL, format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT 'authenticated on helper    ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select private.capture_apply_classification(%L,%L,%L)::text', t.docid('m-a2'), 'dc', '30000000-0000-0000-0000-000000000001')) AS r;
SELECT 'service_role on helper     ' || t.try_as('service_role', NULL, format('select private.capture_apply_classification(%L,%L,%L)::text', t.docid('m-a2'), 'dc', '30000000-0000-0000-0000-000000000001')) AS r;
SELECT t.ok('all refusals left every document unclassified and wrote no delivery',
  (SELECT count(*) = 0 FROM public.capture_documents WHERE kind IS NOT NULL) AND (SELECT count(*) = 0 FROM public.deliveries));

\echo == M4 pm_classify_document: success paths
SELECT 'PM1 classifies m-a2 as dc ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT t.ok('dc: kind, source pm, set_by = PM1 users.id, kind_set_at stamped, one delivery, 0 links',
  (SELECT kind = 'dc' AND kind_source = 'pm' AND kind_set_by = '30000000-0000-0000-0000-000000000001' AND kind_set_at IS NOT NULL AND kind_set_at >= created_at FROM public.capture_documents WHERE id = t.docid('m-a2'))
  AND (SELECT count(*) = 1 FROM public.deliveries WHERE dc_document_id = t.docid('m-a2'))
  AND (SELECT count(*) = 0 FROM public.delivery_invoice_links WHERE invoice_document_id = t.docid('m-a2')));
SELECT t.ok('delivery: reported_by = ENG1 (not the PM), received_at = document received_at, status awaiting_pm (ack was stored first)',
  (SELECT x.reported_by = '30000000-0000-0000-0000-000000000002' AND x.received_at = d.received_at AND x.status = 'awaiting_pm'
     FROM public.deliveries x JOIN public.capture_documents d ON d.id = x.dc_document_id WHERE d.id = t.docid('m-a2')));
SELECT 'PM1 again, same kind       ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'dc')) AS r;
SELECT t.ok('second call: no new rows (still 1 delivery)', (SELECT count(*) = 1 FROM public.deliveries WHERE dc_document_id = t.docid('m-a2')));
SELECT 'PM1 again, other kind      ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-a2'), 'invoice')) AS r;
SELECT 'PM1 classifies m-b2 invoice (no ack yet) ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-b2'), 'invoice')) AS r;
SELECT t.ok('invoice: 1 automatic delivery (incomplete, no ack) + 1 active self-link',
  (SELECT count(*) = 1 FROM public.deliveries WHERE created_from_invoice_id = t.docid('m-b2') AND status = 'incomplete')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = t.docid('m-b2') AND link_source = 'created_from_invoice' AND unlinked_at IS NULL));
SELECT 'PM1 again on invoice: ids from the already_classified path ' || t.try_as('authenticated', '40000000-0000-0000-0000-000000000001', format('select public.pm_classify_document(%L,%L)::text', t.docid('m-b2'), 'invoice')) AS r;
SELECT t.turn('+91900000002', '1', 'm-b3') AS ack_after_classify;
SELECT t.ok('classify-then-ack: the existing ack path moves the new delivery to awaiting_pm',
  (SELECT status = 'awaiting_pm' FROM public.deliveries WHERE created_from_invoice_id = t.docid('m-b2'))
  AND (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE id = t.docid('m-b2')));
SELECT t.ok('classify created no jobs beyond the 3 ingest jobs and no outbound sends', (SELECT count(*) = 3 FROM public.jobs) AND (SELECT count(*) = 0 FROM public.outbound_sends));

\echo == M5 triggers (as owner; transactions rolled back)
SELECT 'UPDATE kind on a classified document        ' || t.try('UPDATE public.capture_documents SET kind = ''invoice'' WHERE id = ''' || t.docid('m-a2') || '''') AS r;
SELECT 'UPDATE kind_set_by on a classified document ' || t.try('UPDATE public.capture_documents SET kind_set_by = ''30000000-0000-0000-0000-000000000007'' WHERE id = ''' || t.docid('m-a2') || '''') AS r;
SELECT 'UPDATE received_at                          ' || t.try('UPDATE public.capture_documents SET received_at = received_at - interval ''1 minute'' WHERE id = ''' || t.docid('m-a2') || '''') AS r;
SELECT 'UPDATE engineer_declared onto unclassified  ' || t.try('UPDATE public.capture_documents SET kind = ''dc'', kind_source = ''engineer_declared'' WHERE id = ''' || t.docid('m-d2') || '''') AS r;
SELECT 'UPDATE kind without kind_set_by             ' || t.try('UPDATE public.capture_documents SET kind = ''dc'', kind_source = ''pm'' WHERE id = ''' || t.docid('m-d2') || '''') AS r;
SELECT 'INSERT carrying a kind                      ' || t.try('INSERT INTO public.capture_documents (tenant_id, project_id, kind, sent_by, source_message_sid, received_at) VALUES (''10000000-0000-0000-0000-000000000001'', ''20000000-0000-0000-0000-000000000001'', ''dc'', ''30000000-0000-0000-0000-000000000002'', ''m-x1'', now() - interval ''1 minute'')') AS r;
SELECT 'INSERT without received_at                  ' || t.try('INSERT INTO public.capture_documents (tenant_id, project_id, sent_by, source_message_sid) VALUES (''10000000-0000-0000-0000-000000000001'', ''20000000-0000-0000-0000-000000000001'', ''30000000-0000-0000-0000-000000000002'', ''m-x2'')') AS r;
SELECT 'INSERT with received_at in the future       ' || t.try('INSERT INTO public.capture_documents (tenant_id, project_id, sent_by, source_message_sid, received_at) VALUES (''10000000-0000-0000-0000-000000000001'', ''20000000-0000-0000-0000-000000000001'', ''30000000-0000-0000-0000-000000000002'', ''m-x3'', now() + interval ''1 hour'')') AS r;
SELECT 'a delivery on the unclassified document     ' || t.try('INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES (''10000000-0000-0000-0000-000000000001'', ''20000000-0000-0000-0000-000000000001'', ''30000000-0000-0000-0000-000000000002'', now() - interval ''1 minute'', ''' || t.docid('m-d2') || ''')') AS r;
BEGIN;
UPDATE public.capture_documents SET kind = 'dc', kind_source = 'pm', kind_set_by = '30000000-0000-0000-0000-000000000001', kind_set_at = '2000-01-01' WHERE source_message_sid = 'm-d2';
SELECT t.ok('caller-supplied kind_set_at is overwritten by the database', (SELECT kind_set_at > now() - interval '1 minute' FROM public.capture_documents WHERE source_message_sid = 'm-d2'));
ROLLBACK;
SELECT t.ok('rolled back: m-d2 still unclassified', (SELECT kind IS NULL FROM public.capture_documents WHERE source_message_sid = 'm-d2'));
SELECT t.ok('service_role has no UPDATE/INSERT/DELETE on capture_documents',
  NOT has_table_privilege('service_role', 'public.capture_documents', 'UPDATE') AND NOT has_table_privilege('service_role', 'public.capture_documents', 'INSERT') AND NOT has_table_privilege('service_role', 'public.capture_documents', 'DELETE'));

\echo == M6 state before the DOWN
SELECT 'documents=' || count(*) || ' unclassified=' || count(*) FILTER (WHERE kind IS NULL) || ' engineer_declared=' || count(*) FILTER (WHERE kind_source = 'engineer_declared') || ' pm=' || count(*) FILTER (WHERE kind_source = 'pm') FROM public.capture_documents;
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, pending_flows, expires_at, updated_at)
VALUES ('+91900000009', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'invoice', 2, '{"mi_last_sid":"x","unrelated":"keep"}'::jsonb, '[]'::jsonb, now() + interval '30 minutes', now());
INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES ('052', 'mi_kind_deferred');
