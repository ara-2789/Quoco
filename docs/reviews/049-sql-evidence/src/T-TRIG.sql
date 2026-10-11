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
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, delivery_type, created_from_invoice_id, status, rejected_by, rejected_at, reject_reason) VALUES ('{V6}', '{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', 'supplier', '{D6}', 'rejected', '{U.PM1}', now(), 'bad invoice');
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
SELECT t.expect('E7 backstop: the CHECK still refuses an automatic delivery INSERTed as internal_transfer (23514)', $$INSERT INTO public.deliveries (tenant_id, project_id, reported_by, received_at, created_from_invoice_id, delivery_type) VALUES ('{T1}', '{P1}', '{U.ENG1}', now() - interval '1 hour', '{D5}', 'internal_transfer')$$, '23514');
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
\echo -- approved automatic delivery, superseded, cancelled, restored (D-23, D-33): invoice D10 / V10 / L10
SELECT t.mk_inv('{D10}', '{V10}', '{L10}', 'SM_T_inv10');
UPDATE public.deliveries SET status = 'approved', approved_by = '{U.PM1}', approved_at = now() WHERE id = '{V10}';
SELECT t.expect('E13 cancel V10 while its self-link is active (C-36)', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link', approved_by = approved_by WHERE id = '{V10}'$$, 'E13');
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L10}';
SELECT t.val('snapshot recorded the pre-cancel status', $$SELECT superseded_from_status FROM public.delivery_invoice_links WHERE id = '{L10}'$$, 'approved');
SELECT t.expect('positive: approved -> cancelled once unlinked', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V10}'$$, 'ok');
SELECT t.expect('E11 cancelled V10: content locked (vehicle_number)', $$UPDATE public.deliveries SET vehicle_number = 'X1' WHERE id = '{V10}'$$, 'E11');
SELECT t.expect('positive: restore cancelled -> incomplete (approved_* and cancelled_* cleared)', $$UPDATE public.deliveries SET status = 'incomplete', cancelled_at = NULL, cancel_reason = NULL, approved_by = NULL, approved_at = NULL WHERE id = '{V10}'$$, 'ok');
SELECT t.expect('positive: after restore the content is editable again', $$UPDATE public.deliveries SET vehicle_number = 'TN01AB1234' WHERE id = '{V10}'$$, 'ok');
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
SELECT t.expect('positive: caption is editable', $$UPDATE public.capture_documents SET caption = 'cement' WHERE id = '{D11}'$$, 'ok');
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
