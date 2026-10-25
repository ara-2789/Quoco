-- S1: engineer path through apply_material_inward_turn (real 049 tables and triggers).
\pset pager off
\echo == S1.1 DC: S0 start -> S1 kind -> S2 two files -> S3 ack 1
SELECT t.turn('+91900000001', '4', 'e1-s0', NULL, true) AS s0_start;
SELECT t.ok('S0 start: flow=invoice step=1', t.sess('+91900000001') LIKE 'invoice/1 %');
SELECT t.turn('+91900000001', '1', 'e1-s1') AS s1_kind;
SELECT t.ok('S1 kind dc -> step 2, mi_kind=dc', t.sess('+91900000001') LIKE 'invoice/2 %"mi_kind": "dc"%');
SELECT t.turn('+91900000001', 'gate pass photo', 'e1-s2', t.media(2)) AS s2_files;
SELECT t.ok('S2 one document kind=dc, 2 files pending, delivery incomplete with dc_document_id',
  (SELECT count(*) = 1 FROM public.capture_documents WHERE source_message_sid = 'e1-s2' AND kind = 'dc')
  AND (SELECT count(*) = 2 FROM public.capture_files WHERE source_message_sid = 'e1-s2' AND ingest_status = 'pending')
  AND t.dstatus(t.docid('e1-s2')) = 'incomplete');
SELECT t.ok('S2 job capture_ingest with 2 files', (SELECT count(*) = 1 FROM public.jobs WHERE type = 'capture_ingest' AND payload->>'source_message_sid' = 'e1-s2' AND jsonb_array_length(payload->'files') = 2));
SELECT t.ok('S2 session at step 3 with mi_document_id; expires_at about now+30m',
  t.sess('+91900000001') LIKE 'invoice/3 %mi_document_id%'
  AND (SELECT expires_at BETWEEN now() + interval '29 minutes' AND now() + interval '31 minutes' FROM public.whatsapp_sessions WHERE phone_number = '+91900000001'));
SELECT t.turn('+91900000001', '1', 'e1-s3') AS s3_ack1;
SELECT t.ok('S3 ack 1: ack=yes, delivery awaiting_pm, flow closed',
  (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE source_message_sid = 'e1-s2')
  AND t.dstatus(t.docid('e1-s2')) = 'awaiting_pm' AND t.sess('+91900000001') LIKE 'NULL/0 %"mi_last_sid": "e1-s3"%');

\echo == S1.2 invoice: file creates automatic delivery + one active self-link; ack 2 -> S4 note
SELECT t.turn('+91900000002', '4', 'e2-s0', NULL, true) AS s0;
SELECT t.turn('+91900000002', '2', 'e2-s1') AS s1;
SELECT t.turn('+91900000002', NULL, 'e2-s2', t.media(1)) AS s2;
SELECT t.ok('invoice: automatic delivery created_from_invoice_id, status incomplete, exactly one active self-link',
  (SELECT count(*) = 1 FROM public.deliveries WHERE created_from_invoice_id = t.docid('e2-s2') AND status = 'incomplete')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = t.docid('e2-s2') AND link_source = 'created_from_invoice' AND unlinked_at IS NULL));
SELECT t.turn('+91900000002', '2', 'e2-s3') AS ack2;
SELECT t.ok('ack 2 -> ack=no, step 4, delivery awaiting_pm', (SELECT engineer_ack = 'no' FROM public.capture_documents WHERE id = t.docid('e2-s2')) AND t.sess('+91900000002') LIKE 'invoice/4 %' AND t.dstatus(t.docid('e2-s2')) = 'awaiting_pm');
SELECT t.turn('+91900000002', NULL, 'e2-s4', t.media(1)) AS file_at_s4;
SELECT t.ok('file at S4 attaches as file_no 2, session stays at step 4 (D-11)', (SELECT count(*) = 2 FROM public.capture_files WHERE document_id = t.docid('e2-s2')) AND t.sess('+91900000002') LIKE 'invoice/4 %');
SELECT t.turn('+91900000002', 'two bags short', 'e2-s5') AS note;
SELECT t.ok('S4 note stored, flow closed', (SELECT engineer_ack_note = 'two bags short' FROM public.capture_documents WHERE id = t.docid('e2-s2')) AND t.sess('+91900000002') LIKE 'NULL/0 %');

\echo == S1.3 ack 3 -> partial, step 4
SELECT t.turn('+91900000003', '4', 'e3-s0', NULL, true);
SELECT t.turn('+91900000003', '1', 'e3-s1');
SELECT t.turn('+91900000003', NULL, 'e3-s2', t.media(1));
SELECT t.turn('+91900000003', '3', 'e3-s3') AS ack3;
SELECT t.ok('ack 3 -> partial, step 4', (SELECT engineer_ack = 'partial' FROM public.capture_documents WHERE id = t.docid('e3-s2')) AND t.sess('+91900000003') LIKE 'invoice/4 %');

\echo == S1.4 unclear: garbage -> one re-ask -> unclear, CLOSES (never S4), raw text is the note
SELECT t.turn('+91900000004', '4', 'e4-s0', NULL, true);
SELECT t.turn('+91900000004', '1', 'e4-s1');
SELECT t.turn('+91900000004', NULL, 'e4-s2', t.media(1));
SELECT t.turn('+91900000004', 'maybe', 'e4-s3') AS garbage1;
SELECT t.ok('first garbage -> reask, still step 3, no ack', t.sess('+91900000004') LIKE 'invoice/3 %' AND (SELECT engineer_ack IS NULL FROM public.capture_documents WHERE id = t.docid('e4-s2')));
SELECT t.turn('+91900000004', 'not sure', 'e4-s4') AS garbage2;
SELECT t.ok('second garbage -> ack=unclear, note=raw text, flow closed (no S4)', (SELECT engineer_ack = 'unclear' AND engineer_ack_note = 'not sure' FROM public.capture_documents WHERE id = t.docid('e4-s2')) AND t.sess('+91900000004') LIKE 'NULL/0 %');

\echo == S1.5 accepted ack forms: 1. / 2) / keycap 3
SELECT t.turn('+91900000005', '4', 'e5-s0', NULL, true); SELECT t.turn('+91900000005', '1', 'e5-s1'); SELECT t.turn('+91900000005', NULL, 'e5-s2', t.media(1));
SELECT t.turn('+91900000005', '1.', 'e5-s3');
SELECT t.ok('"1." -> yes', (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE id = t.docid('e5-s2')));
SELECT t.turn('+91900000006', '4', 'e6-s0', NULL, true); SELECT t.turn('+91900000006', '1', 'e6-s1'); SELECT t.turn('+91900000006', NULL, 'e6-s2', t.media(1));
SELECT t.turn('+91900000006', '2)', 'e6-s3');
SELECT t.ok('"2)" -> no', (SELECT engineer_ack = 'no' FROM public.capture_documents WHERE id = t.docid('e6-s2')));
SELECT t.turn('+91900000007', '4', 'e7-s0', NULL, true); SELECT t.turn('+91900000007', '1', 'e7-s1'); SELECT t.turn('+91900000007', NULL, 'e7-s2', t.media(1));
SELECT t.turn('+91900000007', E'3️⃣', 'e7-s3');
SELECT t.ok('keycap 3 -> partial', (SELECT engineer_ack = 'partial' FROM public.capture_documents WHERE id = t.docid('e7-s2')));
SELECT t.turn('+91900000008', '4', 'e8-s0', NULL, true); SELECT t.turn('+91900000008', '1', 'e8-s1'); SELECT t.turn('+91900000008', NULL, 'e8-s2', t.media(1));
SELECT t.turn('+91900000008', '12', 'e8-s3');
SELECT t.ok('"12" is NOT an ack -> reask, no ack stored', (SELECT engineer_ack IS NULL FROM public.capture_documents WHERE id = t.docid('e8-s2')) AND t.sess('+91900000008') LIKE 'invoice/3 %');

\echo == S1.6 duplicate SID: file turn and text turn
SELECT t.turn('+91900000001', '1', 'e1-s3') AS dup_text_after_close;
SELECT t.ok('retried final ack (text turn) -> duplicate, no QE011, ack unchanged', (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE source_message_sid = 'e1-s2'));
SELECT t.turn('+91900000001', 'gate pass photo', 'e1-s2', t.media(2)) AS dup_file;
SELECT t.ok('retried file turn -> duplicate, still 1 doc and 2 files', (SELECT count(*) = 1 FROM public.capture_documents WHERE source_message_sid = 'e1-s2') AND (SELECT count(*) = 2 FROM public.capture_files WHERE source_message_sid = 'e1-s2'));
SELECT t.turn('+91900000003', '3', 'e3-s3') AS dup_text_mid_flow;
SELECT t.ok('retried ack mid-flow (S4 session) -> duplicate (no second ack, no QE011), still step 4', t.sess('+91900000003') LIKE 'invoice/4 %');
SELECT t.ok('outcome strings: duplicate', (t.turn('+91900000003', '3', 'e3-s3')->>'outcome') = 'duplicate');

\echo == S1.7 expiry: apply_material_inward_turn after 31 min, and expire_stale_material_inward
SELECT t.turn('+91900000009', '4', 'e9-s0', NULL, true);
SELECT t.turn('+91900000009', '1', 'e9-s1', NULL, false, now() + interval '31 minutes') AS late_turn;
SELECT t.ok('turn after 31 min -> expired, flow NULL', (t.sess('+91900000009') LIKE 'NULL/0 %'));
SELECT t.turn('+91900000010', '4', 'e10-s0', NULL, true);
SET ROLE service_role;
SELECT public.expire_stale_material_inward('+91900000010', now() + interval '31 minutes') AS expired_true;
SELECT public.expire_stale_material_inward('+91900000010', now() + interval '31 minutes') AS second_call_false;
RESET ROLE;
SELECT t.ok('expire_stale: cleared once (flow NULL), second call false', t.sess('+91900000010') LIKE 'NULL/0 %');
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, current_flow, current_step, context, expires_at, updated_at)
  VALUES ('+91900000011', '10000000-0000-0000-0000-000000000001', 'morning', 2, '{}', now() - interval '1 hour', now());
SELECT public.expire_stale_material_inward('+91900000011', now() + interval '31 minutes') AS morning_untouched_false;
SELECT t.ok('expire_stale leaves an expired MORNING session alone', t.sess('+91900000011') LIKE 'morning/2 %');

\echo == S-1 [SQL review r1]: the engineer must be an ENGINEER MEMBER of the project the document is created in
INSERT INTO public.users (id, tenant_id, full_name, role, status) VALUES ('30000000-0000-0000-0000-0000000000e2', '10000000-0000-0000-0000-000000000001', 'ENG2', 'engineer', 'active');
INSERT INTO public.project_members (tenant_id, project_id, user_id, role) VALUES ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-0000000000e2', 'engineer');
SELECT t.turn_as('+91900000020', '4', 's1x-s0', '30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-000000000001', NULL, true) AS p2_engineer_session_in_p1;
SELECT t.turn_as('+91900000020', '1', 's1x-s1', '30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-000000000001') AS kind;
SELECT t.expect('S-1: a P2 engineer sending the file into a P1 session is refused QE012', $$SELECT t.turn_as('+91900000020', NULL, 's1x-s2', '30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-000000000001', t.media(1))$$, 'QE012');
SELECT t.ok('S-1: NO rows written (no document, no file, no delivery for ENG2, no job) and the session is unchanged at step 2',
  (SELECT count(*) = 0 FROM public.capture_documents WHERE source_message_sid = 's1x-s2')
  AND (SELECT count(*) = 0 FROM public.capture_files WHERE source_message_sid = 's1x-s2')
  AND (SELECT count(*) = 0 FROM public.deliveries WHERE reported_by = '30000000-0000-0000-0000-0000000000e2')
  AND (SELECT count(*) = 0 FROM public.jobs WHERE type = 'capture_ingest' AND payload->>'source_message_sid' = 's1x-s2')
  AND t.sess('+91900000020') LIKE 'invoice/2 %');
SELECT t.turn_as('+91900000021', '4', 's1y-s0', '30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-000000000002', NULL, true);
SELECT t.turn_as('+91900000021', '1', 's1y-s1', '30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-000000000002');
SELECT t.turn_as('+91900000021', NULL, 's1y-s2', '30000000-0000-0000-0000-0000000000e2', '20000000-0000-0000-0000-000000000002', t.media(1)) AS p2_engineer_into_p2;
SELECT t.ok('S-1 positive control: the same P2 engineer into P2 creates the document', (SELECT count(*) = 1 FROM public.capture_documents WHERE source_message_sid = 's1y-s2'));
SELECT t.turn('+91900000022', '4', 's1z-s0', NULL, true);
SELECT t.turn('+91900000022', '1', 's1z-s1');
SELECT t.expect('S-1: ENG1 (an engineer member of P1 only, NOT of P2) sending into a P2 session is refused -- a non-member case; the other-ROLE membership case is S1b-s4.sql', $$SELECT t.turn_as('+91900000022', NULL, 's1z-s2', '30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000002', t.media(1))$$, 'QE012');

\echo == N-1 [SQL review r1]: S1 kind parsing uses the SAME normalisation as the S3 ack parser
SELECT t.turn('+91900000023', '4', 'n1a-s0', NULL, true);
SELECT t.turn('+91900000023', '1.', 'n1a-s1') AS kind_dot;
SELECT t.ok('N-1: "1." as the kind -> DC, step 2 (it used to be re-asked)', t.sess('+91900000023') LIKE 'invoice/2 %"mi_kind": "dc"%');
SELECT t.turn('+91900000024', '4', 'n1b-s0', NULL, true);
SELECT t.turn('+91900000024', '2)', 'n1b-s1') AS kind_paren;
SELECT t.ok('N-1: "2)" as the kind -> invoice, step 2', t.sess('+91900000024') LIKE 'invoice/2 %"mi_kind": "invoice"%');
SELECT t.turn('+91900000025', '4', 'n1c-s0', NULL, true);
SELECT t.turn('+91900000025', E'2\uFE0F\u20E3', 'n1c-s1') AS kind_keycap;
SELECT t.ok('N-1: keycap 2 as the kind -> invoice, step 2', t.sess('+91900000025') LIKE 'invoice/2 %"mi_kind": "invoice"%');
SELECT t.turn('+91900000026', '4', 'n1d-s0', NULL, true);
SELECT t.turn('+91900000026', 'Invoice.', 'n1d-s1');
SELECT t.ok('N-1: "Invoice." (case + trailing dot) -> invoice', t.sess('+91900000026') LIKE 'invoice/2 %"mi_kind": "invoice"%');
SELECT t.turn('+91900000027', '4', 'n1e-s0', NULL, true);
SELECT t.turn('+91900000027', '12', 'n1e-s1') AS kind_12;
SELECT t.ok('N-1 contrast: "12" is NOT a kind -> re-ask, still step 1', t.sess('+91900000027') LIKE 'invoice/1 %');

\echo == N-2 [SQL review r1]: the ack UPDATE must touch exactly one document row
INSERT INTO public.whatsapp_sessions (phone_number, tenant_id, user_id, current_flow, current_step, context, expires_at, updated_at)
VALUES ('+91900000028', '10000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'invoice', 3, '{"mi_kind": "dc"}', now() + interval '20 minutes', now());
SELECT t.expect('N-2: ack with mi_document_id missing is refused QE012 (it used to answer complete with no ack stored)', $$SELECT t.turn('+91900000028', '1', 'n2-ack')$$, 'QE012');
SELECT t.ok('N-2: the session is unchanged (rolled back), still invoice/3', t.sess('+91900000028') LIKE 'invoice/3 %');
\echo == S1 end
