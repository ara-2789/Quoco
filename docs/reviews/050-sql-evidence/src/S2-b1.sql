-- S2: B1 (review r1): the ack is always stored; the delivery moves to awaiting_pm only WHERE status = 'incomplete'.
\pset pager off
\echo == B1.1 approve-then-ack (D-10: the PM approves an incomplete delivery first)
SELECT t.turn('+91910000001', '4', 'b1a-s0', NULL, true) \gset
SELECT t.turn('+91910000001', '1', 'b1a-s1') \gset
SELECT t.turn('+91910000001', NULL, 'b1a-s2', t.media(1)) \gset
SELECT t.dlv(t.docid('b1a-s2')) AS da \gset
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000001', false) \gset
SET ROLE authenticated;
SELECT public.pm_set_delivery_details(:'da', 'supplier', 'TN01AB1', 'DC-1', current_date) AS set_details;
SELECT public.pm_approve_delivery(:'da') AS approve_incomplete;
RESET ROLE;
SELECT t.ok('T-D10-APPROVE-INCOMPLETE: approved from incomplete, approved_by = PM1, approved_at stamped',
  (SELECT status = 'approved' AND approved_by = '30000000-0000-0000-0000-000000000001' AND approved_at IS NOT NULL FROM public.deliveries WHERE id = :'da'));
SELECT t.turn('+91910000001', '1', 'b1a-s3') AS ack_after_approval;
SELECT t.ok('T-B1-APPROVE-THEN-ACK: ack stored (yes), delivery STAYS approved, no error',
  (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE id = t.docid('b1a-s2')) AND t.dstatus(t.docid('b1a-s2')) = 'approved');

\echo == B1.2 reject-then-ack
SELECT t.turn('+91910000002', '4', 'b1b-s0', NULL, true) \gset
SELECT t.turn('+91910000002', '1', 'b1b-s1') \gset
SELECT t.turn('+91910000002', NULL, 'b1b-s2', t.media(1)) \gset
SELECT t.dlv(t.docid('b1b-s2')) AS dbb \gset
SET ROLE authenticated;
SELECT public.pm_reject_delivery(:'dbb', 'wrong material') AS reject;
RESET ROLE;
SELECT t.turn('+91910000002', '2', 'b1b-s3') AS ack_after_rejection;
SELECT t.ok('T-B1-REJECT-THEN-ACK: ack stored (no), delivery STAYS rejected',
  (SELECT engineer_ack = 'no' FROM public.capture_documents WHERE id = t.docid('b1b-s2')) AND t.dstatus(t.docid('b1b-s2')) = 'rejected');

\echo == B1.3 link-then-ack (the automatic delivery is cancelled by the link; the ack arrives afterwards)
SELECT t.turn('+91910000003', '4', 'b1c-s0', NULL, true) \gset
SELECT t.turn('+91910000003', '2', 'b1c-s1') \gset
SELECT t.turn('+91910000003', NULL, 'b1c-s2', t.media(1)) \gset
SELECT t.turn('+91910000004', '4', 'b1d-s0', NULL, true) \gset
SELECT t.turn('+91910000004', '1', 'b1d-s1') \gset
SELECT t.turn('+91910000004', NULL, 'b1d-s2', t.media(1)) \gset
SELECT t.docid('b1c-s2') AS invc, t.dlv(t.docid('b1d-s2')) AS dd, t.dlv(t.docid('b1c-s2')) AS dc \gset
SET ROLE authenticated;
SELECT public.pm_link_invoice(:'invc', ARRAY[:'dd']::uuid[]) AS link;
RESET ROLE;
SELECT t.ok('link cancelled the automatic delivery (superseded_by_link)', (SELECT status = 'cancelled' AND cancel_reason = 'superseded_by_link' AND cancelled_at IS NOT NULL FROM public.deliveries WHERE id = :'dc'));
SELECT t.turn('+91910000003', '1', 'b1c-s3') AS ack_after_link;
SELECT t.ok('T-B1-LINK-THEN-ACK: ack stored, delivery STAYS cancelled with cancelled_at / cancel_reason still set',
  (SELECT engineer_ack = 'yes' FROM public.capture_documents WHERE id = :'invc')
  AND (SELECT status = 'cancelled' AND cancelled_at IS NOT NULL AND cancel_reason = 'superseded_by_link' FROM public.deliveries WHERE id = :'dc'));
SELECT t.ok('... self-link still soft-unlinked (superseded_by_link) and exactly one active PM link',
  (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = :'invc' AND link_source = 'created_from_invoice' AND unlink_reason = 'superseded_by_link')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = :'invc' AND link_source = 'pm_manual' AND unlinked_at IS NULL));

\echo == B1 REDs: the unconditional status move this fix avoids, run directly as the table owner (exact codes)
SELECT t.expect('RED approved -> awaiting_pm raises QE011', format('UPDATE public.deliveries SET status = %L WHERE id = %L', 'awaiting_pm', :'da'), 'QE011');
SELECT t.expect('RED rejected -> awaiting_pm raises QE011', format('UPDATE public.deliveries SET status = %L WHERE id = %L', 'awaiting_pm', :'dbb'), 'QE011');
SELECT t.expect('RED cancelled -> awaiting_pm with cancelled_* left set raises 23514 (deliveries_cancelled_at_chk)', format('UPDATE public.deliveries SET status = %L WHERE id = %L', 'awaiting_pm', :'dc'), '23514');
\echo == S2 end
