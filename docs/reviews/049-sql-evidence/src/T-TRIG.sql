-- EXPECT_PASS: 122
\echo == T-TRIG: TR1..TR5 and the A33 index -- every refusal with its E-code, each with a positive control ==
\pset tuples_only on
\pset format unaligned
\echo -- setup: DC V1/D1; DC V2/D2 (will be internal_transfer); invoice D3/V3/L1; invoice D4/V4/L2; plain invoice document D5
SELECT t.mk_dc('{D1}', '{V1}', 'SM_T_dc1');
SELECT t.mk_dc('{D2}', '{V2}', 'SM_T_dc2');
SELECT t.mk_inv('{D3}', '{V3}', '{L1}', 'SM_T_inv3');
SELECT t.mk_inv('{D4}', '{V4}', '{L2}', 'SM_T_inv4');
SELECT t.mk_doc('{D5}', 'invoice', 'SM_T_inv5');
\echo
\echo -- ===== TR1 XOR (A28): E1 / E2 =====
SELECT t.expect('E1 PM link of D3 while D3 has an ACTIVE SELF-LINK', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{T1}', '{P1}', '{V1}', '{D3}', 'pm_manual', '{U.PM1}')$$, 'E1');
\echo -- PATH 1 on D3: soft-unlink the self-link, cancel V3, insert the pm_manual link L3 (V1 <- D3)
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L1}';
UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V3}';
SELECT t.expect('PATH 1 positive control: pm_manual link V1 <- D3', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L3}', '{T1}', '{P1}', '{V1}', '{D3}', 'pm_manual', '{U.PM1}')$$, 'ok');
SELECT t.expect('E2 self-link of D3 while D3 has an ACTIVE PM LINK', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{T1}', '{P1}', '{V3}', '{D3}', 'created_from_invoice')$$, 'E2');
\echo
\echo -- ===== TR2 target checks: E3 / E4 / E5 (invoice D5 has no links, so TR1's XOR passes and TR2 answers) =====
SELECT t.expect('TR4b positive control: retype of an UNLINKED DC (V2) to internal_transfer succeeds', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V2}'$$, 'ok');
SELECT t.expect('E3link to an INTERNAL TRANSFER', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{T1}', '{P1}', '{V2}', '{D5}', 'pm_manual', '{U.PM1}')$$, 'E3');
SELECT t.expect('E4 link to an AUTOMATIC delivery', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{T1}', '{P1}', '{V4}', '{D5}', 'pm_manual', '{U.PM1}')$$, 'E4');
SELECT t.mk_dc('{D7}', '{V7}', 'SM_T_dc7');
UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad dc' WHERE id = '{V7}';
SELECT t.expect('E5 link to a REJECTED DC delivery', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{T1}', '{P1}', '{V7}', '{D5}', 'pm_manual', '{U.PM1}')$$, 'E5');
SELECT t.mk_doc('{D6}', 'invoice', 'SM_T_inv6');
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, created_from_invoice_id) VALUES ('{V6}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D6}');
UPDATE public.deliveries SET delivery_type = 'supplier' WHERE id = '{V6}';
\echo -- (F4-2: a delivery can no longer be INSERTed already rejected; it is created incomplete and rejected through the guarded UPDATE path)
UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad invoice' WHERE id = '{V6}';
SELECT t.expect('E5 (A34) self-link for a REJECTED automatic delivery', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{T1}', '{P1}', '{V6}', '{D6}', 'created_from_invoice')$$, 'E5');
\echo
\echo -- ===== A33 (unique index): a DC has at most one active link -- E8 =====
SELECT t.expect('E8 second active link on V1 (already linked by L3)', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{T1}', '{P1}', '{V1}', '{D5}', 'pm_manual', '{U.PM1}')$$, '23505');
\echo
\echo -- ===== TR3: link edits =====
SELECT t.expect('E10 change delivery_id of an active link', $$UPDATE public.delivery_invoice_links SET delivery_id = '{V2}' WHERE id = '{L3}'$$, 'E10');
SELECT t.expect('E10 change linked_by of an active link', $$UPDATE public.delivery_invoice_links SET linked_by = '{U.ADMP}' WHERE id = '{L3}'$$, 'E10');
SELECT t.expect('E10 half an unlink (unlinked_at only)', $$UPDATE public.delivery_invoice_links SET unlinked_at = now() WHERE id = '{L3}'$$, 'E10');
SELECT t.expect('TR3 positive control: no-op update of an active link', $$UPDATE public.delivery_invoice_links SET created_at = created_at WHERE id = '{L3}'$$, 'ok');
\echo
\echo -- ===== TR4a immutable columns: E9 =====
SELECT t.expect('E9 change received_at', $$UPDATE public.deliveries SET received_at = received_at - interval '1 minute' WHERE id = '{V1}'$$, 'E9');
SELECT t.expect('E9 change reported_by', $$UPDATE public.deliveries SET reported_by = '{U.PM1}' WHERE id = '{V1}'$$, 'E9');
SELECT t.expect('E9 change project_id', $$UPDATE public.deliveries SET project_id = '{P2}' WHERE id = '{V1}'$$, 'E9');
SELECT t.expect('E9 change dc_document_id', $$UPDATE public.deliveries SET dc_document_id = '{D2}' WHERE id = '{V1}'$$, 'E9');
SELECT t.expect('E9 change created_from_invoice_id of an automatic delivery', $$UPDATE public.deliveries SET created_from_invoice_id = '{D5}' WHERE id = '{V4}'$$, 'E9');
\echo
\echo -- ===== TR4b retype to internal_transfer while linked: E6 (and observation O-3) =====
SELECT t.expect('E6 retype linked DC V1 to internal_transfer', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V1}'$$, 'E6');
SELECT t.val('E6 V1 still supplier', $$SELECT delivery_type FROM public.deliveries WHERE id = '{V1}'$$, 'supplier');
\echo -- O-3 closed (Aravind, 11 Oct): retyping an AUTOMATIC delivery raises E7, raised BEFORE TR4b's E6
SELECT t.expect('E7 (O-3) automatic V4 WITH an active self-link retyped to internal_transfer -> E7, not E6', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V4}'$$, 'E7');
SELECT t.expect('E7 (O-3) rejected automatic V6 (no active link) retyped to internal_transfer -> E7', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V6}'$$, 'E7');
SELECT t.val('E7 V4 still supplier', $$SELECT delivery_type FROM public.deliveries WHERE id = '{V4}'$$, 'supplier');
\echo -- (N-4: the INSERT guard now answers E12 first for this row, so the CHECK backstop is shown with the user triggers disabled on deliveries; same expectation, 23514)
ALTER TABLE public.deliveries DISABLE TRIGGER USER;
SELECT t.expect('E7 backstop: the CHECK still refuses an automatic delivery INSERTed as internal_transfer (23514)', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, created_from_invoice_id, delivery_type) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D5}', 'internal_transfer')$$, '23514');
ALTER TABLE public.deliveries ENABLE TRIGGER USER;
SELECT t.expect('E6 is unchanged for a DC delivery: linked DC V1 retyped -> E6 (still)', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V1}'$$, 'E6');
\echo
\echo -- ===== TR4c status transitions =====
SELECT t.expect('E11 nothing leaves rejected (V7 rejected -> incomplete)', $$UPDATE public.deliveries SET status = 'incomplete', rejected_by = NULL, rejected_at = NULL, reject_reason = NULL WHERE id = '{V7}'$$, 'E11');
SELECT t.mk_dc('{D8}', '{V8}', 'SM_T_dc8');
SELECT t.expect('positive: incomplete -> approved (V8)', $$UPDATE public.deliveries SET status = 'approved', approved_by = '{U.PM1}', approved_at = now() WHERE id = '{V8}'$$, 'ok');
SELECT t.expect('E11 approved -> awaiting_pm', $$UPDATE public.deliveries SET status = 'awaiting_pm', approved_by = NULL, approved_at = NULL WHERE id = '{V8}'$$, 'E11');
SELECT t.mk_dc('{D9}', '{V9}', 'SM_T_dc9');
SELECT t.expect('positive: incomplete -> awaiting_pm (V9)', $$UPDATE public.deliveries SET status = 'awaiting_pm' WHERE id = '{V9}'$$, 'ok');
SELECT t.expect('E11 awaiting_pm -> incomplete', $$UPDATE public.deliveries SET status = 'incomplete' WHERE id = '{V9}'$$, 'E11');
\echo -- D-23 approved means locked
SELECT t.expect('E11 approved V8: vehicle_number', $$UPDATE public.deliveries SET vehicle_number = 'TN01AB1234' WHERE id = '{V8}'$$, 'E11');
SELECT t.expect('E11 approved V8: delivery_type', $$UPDATE public.deliveries SET delivery_type = 'internal_transfer' WHERE id = '{V8}'$$, 'E11');
SELECT t.expect('E11 approved V8: dc_number', $$UPDATE public.deliveries SET dc_number = 'DC-1' WHERE id = '{V8}'$$, 'E11');
SELECT t.expect('E11 approved V8: dc_date', $$UPDATE public.deliveries SET dc_date = current_date WHERE id = '{V8}'$$, 'E11');
SELECT t.expect('positive: a non-locked column (reject_reason is irrelevant; caption-like edit) -- no-op update of approved V8', $$UPDATE public.deliveries SET dc_number = dc_number WHERE id = '{V8}'$$, 'ok');
\echo -- B-1 (SQL review r1): who approved / rejected / cancelled cannot be rewritten after the fact; each group changes only on its own transition
SELECT t.expect('B-1 rewrite the approver of approved V8, status unchanged', $$UPDATE public.deliveries SET approved_by = '{U.ADMP}', approved_at = now() WHERE id = '{V8}'$$, 'E11');
SELECT t.expect('B-1 clear the approver of approved V8, status unchanged', $$UPDATE public.deliveries SET approved_by = NULL, approved_at = NULL WHERE id = '{V8}'$$, 'E11');
SELECT t.val('B-1 V8 approver is still PM1', $$SELECT (approved_by = '{U.PM1}')::text FROM public.deliveries WHERE id = '{V8}'$$, 'true');
SELECT t.expect('B-1 set rejected_by on awaiting_pm V9 without moving to rejected', $$UPDATE public.deliveries SET rejected_by = '{U.PM1}' WHERE id = '{V9}'$$, 'E11');
SELECT t.expect('B-1 set cancelled_at/cancel_reason on V9 without moving to cancelled', $$UPDATE public.deliveries SET cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V9}'$$, 'E11');
SELECT t.expect('B-1 rewrite reject_reason of rejected V7, status unchanged', $$UPDATE public.deliveries SET reject_reason = 'rewritten' WHERE id = '{V7}'$$, 'E11');
SELECT t.mk_dc('{D13}', '{V13}', 'SM_T_dc13');
SELECT t.expect('B-1 positive: a move INTO rejected sets rejected_* (V13)', $$UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'short count' WHERE id = '{V13}'$$, 'ok');
\echo -- approved automatic delivery, superseded, cancelled, restored (D-23, D-33): invoice D10 / V10 / L10
SELECT t.mk_inv('{D10}', '{V10}', '{L10}', 'SM_T_inv10');
UPDATE public.deliveries SET status = 'approved', approved_by = '{U.PM1}', approved_at = now() WHERE id = '{V10}';
SELECT t.expect('E13 cancel V10 while its self-link is active (C-36)', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link', approved_by = approved_by WHERE id = '{V10}'$$, 'E13');
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L10}';
SELECT t.val('snapshot recorded the pre-cancel status', $$SELECT superseded_from_status FROM public.delivery_invoice_links WHERE id = '{L10}'$$, 'approved');
SELECT t.expect('B-1 cancel V10 WHILE changing approved_by', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link', approved_by = '{U.ADMP}' WHERE id = '{V10}'$$, 'E11');
SELECT t.val('B-1 V10 is still approved by PM1 after the refused cancel', $$SELECT status || ':' || (approved_by = '{U.PM1}')::text FROM public.deliveries WHERE id = '{V10}'$$, 'approved:true');
SELECT t.expect('positive: approved -> cancelled once unlinked', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V10}'$$, 'ok');
SELECT t.expect('E11 cancelled V10: content locked (vehicle_number)', $$UPDATE public.deliveries SET vehicle_number = 'X1' WHERE id = '{V10}'$$, 'E11');
SELECT t.expect('positive: restore cancelled -> incomplete (approved_* and cancelled_* cleared)', $$UPDATE public.deliveries SET status = 'incomplete', cancelled_at = NULL, cancel_reason = NULL, approved_by = NULL, approved_at = NULL WHERE id = '{V10}'$$, 'ok');
SELECT t.val('B-1 positive: after restore approved_* and cancelled_* are cleared', $$SELECT (approved_by IS NULL AND approved_at IS NULL AND cancelled_at IS NULL AND cancel_reason IS NULL)::text FROM public.deliveries WHERE id = '{V10}'$$, 'true');
SELECT t.expect('positive: after restore the content is editable again', $$UPDATE public.deliveries SET vehicle_number = 'TN01AB1234' WHERE id = '{V10}'$$, 'ok');
\echo
\echo -- ===== B-2 (SQL review r1): a self-link is refused onto a CANCELLED delivery (the other direction of C-36) =====
SELECT t.mk_inv('{D14}', '{V14}', '{L14}', 'SM_T_inv14');
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L14}';
UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V14}';
SELECT t.expect('B-2 self-link INSERTed onto cancelled V14 (invoice D14 has no active link)', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L15}', '{T1}', '{P1}', '{V14}', '{D14}', 'created_from_invoice')$$, 'E5');
SELECT t.val('B-2 no active link was created on V14', $$SELECT count(*)::text FROM public.delivery_invoice_links WHERE delivery_id = '{V14}' AND unlinked_at IS NULL$$, '0');
SELECT t.expect('B-2 positive: restore V14 FIRST (paths 2 and 4)', $$UPDATE public.deliveries SET status = 'incomplete', cancelled_at = NULL, cancel_reason = NULL WHERE id = '{V14}'$$, 'ok');
SELECT t.expect('B-2 positive: THEN the new self-link is accepted', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L15}', '{T1}', '{P1}', '{V14}', '{D14}', 'created_from_invoice')$$, 'ok');
\echo
\echo -- ===== TR5 capture_documents =====
SELECT t.mk_doc('{D11}', 'dc', 'SM_T_doc11');
SELECT t.expect('positive: set ack once', $$UPDATE public.capture_documents SET engineer_ack = 'no', engineer_ack_at = now(), engineer_ack_note = 'two bags short' WHERE id = '{D11}'$$, 'ok');
SELECT t.expect('E11 change ack once set', $$UPDATE public.capture_documents SET engineer_ack = 'yes', engineer_ack_note = NULL WHERE id = '{D11}'$$, 'E11');
SELECT t.expect('E11 change ack_at once set', $$UPDATE public.capture_documents SET engineer_ack_at = now() + interval '1 minute' WHERE id = '{D11}'$$, 'E11');
SELECT t.expect('E11 change the note once set', $$UPDATE public.capture_documents SET engineer_ack_note = 'other' WHERE id = '{D11}'$$, 'E11');
SELECT t.expect('E9 change kind', $$UPDATE public.capture_documents SET kind = 'invoice' WHERE id = '{D11}'$$, 'E9');
SELECT t.expect('E9 change sent_by', $$UPDATE public.capture_documents SET sent_by = '{U.PM1}' WHERE id = '{D11}'$$, 'E9');
SELECT t.expect('E9 change source_message_sid', $$UPDATE public.capture_documents SET source_message_sid = 'SM_other' WHERE id = '{D11}'$$, 'E9');
SELECT t.expect('E9 change project_id', $$UPDATE public.capture_documents SET project_id = '{P2}' WHERE id = '{D11}'$$, 'E9');
\echo -- S-1 (SQL review r1): id and created_at are immutable (every ordering CHECK is measured against created_at)
SELECT t.expect('S-1 change id of a delivery', $$UPDATE public.deliveries SET id = '{V20}' WHERE id = '{V9}'$$, 'E9');
SELECT t.expect('S-1 change created_at of a delivery', $$UPDATE public.deliveries SET created_at = created_at - interval '2 days' WHERE id = '{V9}'$$, 'E9');
SELECT t.expect('S-1 change id of a capture_documents row', $$UPDATE public.capture_documents SET id = '{D20}' WHERE id = '{D11}'$$, 'E9');
SELECT t.expect('S-1 change created_at of a capture_documents row', $$UPDATE public.capture_documents SET created_at = created_at - interval '2 days' WHERE id = '{D11}'$$, 'E9');
SELECT t.expect('positive: caption is editable', $$UPDATE public.capture_documents SET caption = 'cement' WHERE id = '{D11}'$$, 'ok');
\echo
\echo
\echo -- ===== S-3 (SQL review r2, Option A per Aravind): the database stamps the time at each allowed transition =====
\echo -- Each block is ONE transaction, so now() is the same value the trigger used; the caller supplies a FUTURE time and it must not be stored.
SELECT t.mk_dc('{D15}', '{V15}', 'SM_T_dc15');
SELECT t.mk_dc('{D16}', '{V16}', 'SM_T_dc16');
SELECT t.mk_inv('{D17}', '{V17}', '{L17}', 'SM_T_inv17');
SELECT t.mk_doc('{D18}', 'dc', 'SM_T_doc18');
SELECT t.mk_doc('{D19}', 'dc', 'SM_T_doc19');
BEGIN;
SELECT t.expect('S-3 approved_at: move INTO approved with approved_at = now() + 5 days', $$UPDATE public.deliveries SET status = 'approved', approved_by = '{U.PM1}', approved_at = now() + interval '5 days' WHERE id = '{V15}'$$, 'ok');
SELECT t.val('S-3 approved_at was stored as the transaction time', $$SELECT (approved_at = now())::text FROM public.deliveries WHERE id = '{V15}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-3 rejected_at: move INTO rejected with rejected_at = now() + 30 days', $$UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now() + interval '30 days', reject_reason = 'short count' WHERE id = '{V16}'$$, 'ok');
SELECT t.val('S-3 rejected_at was stored as the transaction time', $$SELECT (rejected_at = now())::text FROM public.deliveries WHERE id = '{V16}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-3 unlinked_at: unlink with unlinked_at = now() + 3 days', $$UPDATE public.delivery_invoice_links SET unlinked_at = now() + interval '3 days', unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L17}'$$, 'ok');
SELECT t.val('S-3 unlinked_at was stored as the transaction time', $$SELECT (unlinked_at = now())::text FROM public.delivery_invoice_links WHERE id = '{L17}'$$, 'true');
SELECT t.expect('S-3 cancelled_at: move INTO cancelled with cancelled_at = now() + 7 days', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now() + interval '7 days', cancel_reason = 'superseded_by_link' WHERE id = '{V17}'$$, 'ok');
SELECT t.val('S-3 cancelled_at was stored as the transaction time', $$SELECT (cancelled_at = now())::text FROM public.deliveries WHERE id = '{V17}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-3 engineer_ack_at: ack first set with engineer_ack_at = now() + 10 days', $$UPDATE public.capture_documents SET engineer_ack = 'yes', engineer_ack_at = now() + interval '10 days' WHERE id = '{D18}'$$, 'ok');
SELECT t.val('S-3 engineer_ack_at was stored as the transaction time', $$SELECT (engineer_ack_at = now())::text FROM public.capture_documents WHERE id = '{D18}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-3 engineer_ack_at: ack first set with NO caller time at all (the database supplies it)', $$UPDATE public.capture_documents SET engineer_ack = 'no' WHERE id = '{D19}'$$, 'ok');
SELECT t.val('S-3 engineer_ack_at was stamped as the transaction time', $$SELECT (engineer_ack_at = now())::text FROM public.capture_documents WHERE id = '{D19}'$$, 'true');
COMMIT;
\echo
\echo -- ===== F4-1 (per Aravind 11 Oct): linked_at is stamped by the database at INSERT =====
SELECT t.mk_dc('{D21}', '{V21}', 'SM_T_dc21');
SELECT t.mk_doc('{D22}', 'invoice', 'SM_T_inv22');
BEGIN;
SELECT t.expect('F4-1 linked_at: INSERT a pm_manual link with linked_at = now() + 5 days', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by, linked_at) VALUES ('{L21}', '{T1}', '{P1}', '{V21}', '{D22}', 'pm_manual', '{U.PM1}', now() + interval '5 days')$$, 'ok');
SELECT t.val('F4-1 linked_at was stored as the transaction time', $$SELECT (linked_at = now())::text FROM public.delivery_invoice_links WHERE id = '{L21}'$$, 'true');
COMMIT;
SELECT t.expect('F4-1 the later unlink of that link succeeds (unlinked_at >= the stamped linked_at)', $$UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'pm_unlinked' WHERE id = '{L21}'$$, 'ok');
\echo
\echo -- ===== F4-2 (per Aravind 11 Oct): INSERT paths cannot carry attribution or ack values (E12). A delivery is CREATED incomplete. =====
SELECT t.mk_doc('{D23}', 'dc', 'SM_T_doc23');
SELECT t.expect('F4-2 INSERT a delivery as approved (with approver and time)', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, delivery_type, dc_document_id, status, approved_by, approved_at) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', 'supplier', '{D23}', 'approved', '{U.PM1}', now())$$, 'E12');
SELECT t.expect('F4-2 INSERT an incomplete delivery carrying approved_by', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id, approved_by) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D23}', '{U.PM1}')$$, 'E12');
SELECT t.expect('F4-2 INSERT an incomplete delivery carrying cancel_reason', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id, cancel_reason) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D23}', 'superseded_by_link')$$, 'E12');
SELECT t.expect('F4-2 INSERT a delivery as rejected', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id, status, rejected_by, rejected_at, reject_reason) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D23}', 'rejected', '{U.PM1}', now(), 'x')$$, 'E12');
SELECT t.expect('F4-2 INSERT a delivery as awaiting_pm (it becomes awaiting_pm by UPDATE when the ack is stored)', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id, status) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D23}', 'awaiting_pm')$$, 'E12');
SELECT t.expect('F4-2 INSERT a document with engineer_ack', $$INSERT INTO public.capture_documents (tenant_id, project_id, kind, sent_by, source_message_sid, engineer_ack, engineer_ack_at) VALUES ('{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_T_f42a', 'yes', now())$$, 'E12');
SELECT t.expect('F4-2 INSERT a document with engineer_ack_note only', $$INSERT INTO public.capture_documents (tenant_id, project_id, kind, sent_by, source_message_sid, engineer_ack_note) VALUES ('{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_T_f42b', 'note')$$, 'E12');
SELECT t.expect('F4-2 positive: the normal creation path -- a delivery INSERT (incomplete) succeeds', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D23}')$$, 'ok');
SELECT t.expect('F4-2 positive: the normal creation path -- a document INSERT (no ack) succeeds', $$INSERT INTO public.capture_documents (tenant_id, project_id, kind, sent_by, source_message_sid) VALUES ('{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_T_f42c')$$, 'ok');
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT t.val('isolation level of this transaction', $$SELECT current_setting('transaction_isolation')$$, 'repeatable read');
SELECT t.expect('E14 the delivery INSERT guard under RR', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D23}')$$, 'E14');
SELECT t.expect('E14 the document INSERT guard under RR', $$INSERT INTO public.capture_documents (tenant_id, project_id, kind, sent_by, source_message_sid) VALUES ('{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_T_f42d')$$, 'E14');
ROLLBACK;
\echo
\echo -- ===== S-4 (SQL review r3, per Aravind 12 Oct): created_at is stamped by the database at INSERT on all three trigger-guarded tables =====
\echo -- One transaction per case, so now() is the value the trigger used. Future-dated AND past-dated caller values must both be ignored.
SELECT t.mk_doc('{D31}', 'dc', 'SM_T_dc31');
SELECT t.mk_doc('{D32}', 'dc', 'SM_T_dc32');
SELECT t.mk_doc('{D35}', 'invoice', 'SM_T_inv35');
SELECT t.mk_doc('{D36}', 'invoice', 'SM_T_inv36');
BEGIN;
SELECT t.expect('S-4 deliveries: INSERT with created_at = now() + 2 hours', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, created_at) VALUES ('{V31}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D31}', now() + interval '2 hours')$$, 'ok');
SELECT t.val('S-4 deliveries (future): created_at was stored as the transaction time', $$SELECT (created_at = now())::text FROM public.deliveries WHERE id = '{V31}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-4 deliveries: INSERT with created_at = now() - 3 days', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, created_at) VALUES ('{V32}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D32}', now() - interval '3 days')$$, 'ok');
SELECT t.val('S-4 deliveries (past): created_at was stored as the transaction time', $$SELECT (created_at = now())::text FROM public.deliveries WHERE id = '{V32}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-4 capture_documents: INSERT with created_at = now() + 30 days', $$INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid, created_at) VALUES ('{D33}', '{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_T_s4a', now() + interval '30 days')$$, 'ok');
SELECT t.val('S-4 capture_documents (future): created_at was stored as the transaction time', $$SELECT (created_at = now())::text FROM public.capture_documents WHERE id = '{D33}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-4 capture_documents: INSERT with created_at = now() - 3 days', $$INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid, created_at) VALUES ('{D34}', '{T1}', '{P1}', 'dc', '{U.ENG1}', 'SM_T_s4b', now() - interval '3 days')$$, 'ok');
SELECT t.val('S-4 capture_documents (past): created_at was stored as the transaction time', $$SELECT (created_at = now())::text FROM public.capture_documents WHERE id = '{D34}'$$, 'true');
COMMIT;
\echo -- ... and the reviewer's consequence: a document born with a future created_at could never be acknowledged. Now it can:
SELECT t.expect('S-4 the document D33 (supplied created_at = now() + 30 days) CAN be acknowledged', $$UPDATE public.capture_documents SET engineer_ack = 'yes' WHERE id = '{D33}'$$, 'ok');
BEGIN;
SELECT t.expect('S-4 delivery_invoice_links: INSERT with created_at = now() + 2 days', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by, created_at) VALUES ('{L31}', '{T1}', '{P1}', '{V31}', '{D35}', 'pm_manual', '{U.PM1}', now() + interval '2 days')$$, 'ok');
SELECT t.val('S-4 links (future): created_at was stored as the transaction time', $$SELECT (created_at = now())::text FROM public.delivery_invoice_links WHERE id = '{L31}'$$, 'true');
COMMIT;
BEGIN;
SELECT t.expect('S-4 delivery_invoice_links: INSERT with created_at = now() - 3 days', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by, created_at) VALUES ('{L32}', '{T1}', '{P1}', '{V32}', '{D36}', 'pm_manual', '{U.PM1}', now() - interval '3 days')$$, 'ok');
SELECT t.val('S-4 links (past): created_at was stored as the transaction time', $$SELECT (created_at = now())::text FROM public.delivery_invoice_links WHERE id = '{L32}'$$, 'true');
COMMIT;
\echo -- the "C4 shape" (reviewer): received_at in the FUTURE relative to the transaction, with a future created_at to hide it -> refused by deliveries_received_order_chk
SELECT t.mk_doc('{D37}', 'dc', 'SM_T_dc37');
SELECT t.expect('S-4 C4 shape: received_at = now() + 1 hour with created_at = now() + 2 hours', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id, created_at) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() + interval '1 hour', '{D37}', now() + interval '2 hours')$$, '23514');
SELECT t.val('S-4 C4 shape: it is deliveries_received_order_chk that refuses it', $$SELECT (t.errmsg('INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, dc_document_id, created_at) VALUES (''{T1}'', ''{P1}'', ''{U.ENG1}'', now() + interval ''1 hour'', ''{D37}'', now() + interval ''2 hours'')') LIKE '%deliveries_received_order_chk%')::text$$, 'true');
\echo
\echo -- ===== N-4 (SQL review r3, Option A per Aravind 12 Oct): PM-owned fields are NULL at deliveries INSERT; set later only through UPDATE =====
-- N-5: each N-4 case owns its document and delivery ids (no borrowing of {D37} from the S-4 C4 case or {V21} from F4-1).
SELECT t.mk_doc('{D38}', 'dc', 'SM_T_dc38');
SELECT t.mk_doc('{D39}', 'dc', 'SM_T_dc39');
SELECT t.mk_doc('{D40}', 'dc', 'SM_T_dc40');
SELECT t.mk_doc('{D41}', 'dc', 'SM_T_dc41');
SELECT t.mk_dc('{D42}', '{V41}', 'SM_T_dc42');
SELECT t.expect('N-4 INSERT a delivery with delivery_type set', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, delivery_type) VALUES ('{V42}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D38}', 'internal_transfer')$$, 'E12');
SELECT t.expect('N-4 INSERT a delivery with vehicle_number set', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, vehicle_number) VALUES ('{V43}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D39}', 'TN01AB1234')$$, 'E12');
SELECT t.expect('N-4 INSERT a delivery with dc_number set', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, dc_number) VALUES ('{V44}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D40}', 'DC-1')$$, 'E12');
SELECT t.expect('N-4 INSERT a delivery with dc_date set', $$INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id, dc_date) VALUES ('{V45}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D41}', current_date)$$, 'E12');
SELECT t.expect('N-4 positive: the same four fields are set later through UPDATE (V41)', $$UPDATE public.deliveries SET delivery_type = 'supplier', vehicle_number = 'TN01AB1234', dc_number = 'DC-9', dc_date = current_date WHERE id = '{V41}'$$, 'ok');
\echo
\echo -- ===== B3 / E14: every invariant trigger refuses a REPEATABLE READ writer =====
BEGIN ISOLATION LEVEL REPEATABLE READ;
SELECT t.val('isolation level of this transaction', $$SELECT current_setting('transaction_isolation')$$, 'repeatable read');
SELECT t.expect('E14 TR1 insert link under RR', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{T1}', '{P1}', '{V3}', '{D5}', 'created_from_invoice')$$, 'E14');
SELECT t.expect('E14 TR3 update link under RR', $$UPDATE public.delivery_invoice_links SET created_at = created_at WHERE id = '{L3}'$$, 'E14');
SELECT t.expect('E14 TR4 update delivery under RR', $$UPDATE public.deliveries SET vehicle_number = 'RR1' WHERE id = '{V9}'$$, 'E14');
SELECT t.expect('E14 TR5 update document under RR', $$UPDATE public.capture_documents SET caption = 'rr' WHERE id = '{D11}'$$, 'E14');
ROLLBACK;
BEGIN ISOLATION LEVEL SERIALIZABLE;
SELECT t.expect('E14 TR4 update delivery under SERIALIZABLE', $$UPDATE public.deliveries SET vehicle_number = 'SZ1' WHERE id = '{V9}'$$, 'E14');
ROLLBACK;
SELECT t.expect('positive control: the same update under the default READ COMMITTED', $$UPDATE public.deliveries SET vehicle_number = 'RC1' WHERE id = '{V9}'$$, 'ok');
