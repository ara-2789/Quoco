-- EXPECT_PASS: 11
\echo == T-B2 (B2): forged INSERT with snapshot values -> refused; caller snapshot on UPDATE -> overwritten by TR3 ==
\pset tuples_only on
\pset format unaligned
\echo -- setup: invoice D1 / automatic delivery V1 / self-link L1 (V1 will be approved), invoice D2 / V2 / L2 (V2 stays incomplete)
SELECT t.mk_inv('{D1}', '{V1}', '{L1}', 'SM_B2_inv1');
SELECT t.mk_inv('{D2}', '{V2}', '{L2}', 'SM_B2_inv2');
SELECT t.mk_inv('{D3}', '{V3}', '{L3}', 'SM_B2_inv3');
\echo -- B2a: a FULLY CONSISTENT forged INSERT (already unlinked, superseded, with a caller-supplied approver) -> refused (E10).
\echo --      It satisfies every CHECK, so only TR1 can stop it. The invoice D3 has its own active self-link L3, so no unique index is hit.
SELECT t.expect('B2a forged unlinked self-link carrying approver', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, unlinked_at, unlinked_by, unlink_reason, superseded_from_status, superseded_approval_by, superseded_approval_at) VALUES ('{T1}', '{P1}', '{V3}', '{D3}', 'created_from_invoice', now(), '{U.PM1}', 'superseded_by_link', 'approved', '{U.PM1}', now())$$, 'E10');
SELECT t.expect('B2a forged: only unlinked_at set', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, unlinked_at) VALUES ('{T1}', '{P1}', '{V3}', '{D3}', 'created_from_invoice', now())$$, 'E10');
SELECT t.expect('B2a forged: only unlink_reason set', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, unlink_reason) VALUES ('{T1}', '{P1}', '{V3}', '{D3}', 'created_from_invoice', 'pm_unlinked')$$, 'E10');
SELECT t.val('B2a no forged row exists', $$SELECT count(*)::text FROM public.delivery_invoice_links WHERE unlinked_at IS NOT NULL$$, '0');
\echo -- B2b: caller-supplied snapshot on UPDATE is OVERWRITTEN from the delivery. V1 is approved, then its self-link is unlinked
\echo --      with a FORGED snapshot (status incomplete, a different approver).
UPDATE public.deliveries SET status = 'approved', approved_by = '{U.PM1}', approved_at = now() WHERE id = '{V1}';
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link', superseded_from_status = 'incomplete', superseded_approval_by = '{U.ADMP}', superseded_approval_at = now() - interval '5 days' WHERE id = '{L1}';
SELECT t.val('B2b approved: superseded_from_status = approved', $$SELECT superseded_from_status FROM public.delivery_invoice_links WHERE id = '{L1}'$$, 'approved');
SELECT t.val('B2b approved: approver is the delivery approver, not the forged one', $$SELECT (superseded_approval_by = '{U.PM1}')::text FROM public.delivery_invoice_links WHERE id = '{L1}'$$, 'true');
SELECT t.val('B2b approved: approval time copied from the delivery', $$SELECT (l.superseded_approval_at = d.approved_at)::text FROM public.delivery_invoice_links l JOIN public.deliveries d ON d.id = l.delivery_id WHERE l.id = '{L1}'$$, 'true');
\echo -- B2c: V2 is incomplete (never approved); the forged snapshot claims 'approved' with an approver.
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link', superseded_from_status = 'approved', superseded_approval_by = '{U.ADMP}', superseded_approval_at = now() WHERE id = '{L2}';
SELECT t.val('B2c incomplete: superseded_from_status = incomplete', $$SELECT superseded_from_status FROM public.delivery_invoice_links WHERE id = '{L2}'$$, 'incomplete');
SELECT t.val('B2c incomplete: approver forced NULL', $$SELECT (superseded_approval_by IS NULL AND superseded_approval_at IS NULL)::text FROM public.delivery_invoice_links WHERE id = '{L2}'$$, 'true');
\echo -- B2d: an unlinked row is final -- a later UPDATE cannot rewrite its snapshot
SELECT t.expect('B2d rewrite snapshot on an unlinked row', $$UPDATE public.delivery_invoice_links SET superseded_from_status = 'awaiting_pm' WHERE id = '{L2}'$$, 'E10');
SELECT t.expect('B2d clear unlinked_at', $$UPDATE public.delivery_invoice_links SET unlinked_at = NULL, unlinked_by = NULL, unlink_reason = NULL, superseded_from_status = NULL WHERE id = '{L2}'$$, 'E10');
