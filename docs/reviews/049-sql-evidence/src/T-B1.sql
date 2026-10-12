-- EXPECT_PASS: 10
\echo == T-B1 (B1): link then reject -> refused; unlink then reject -> succeeds ==
\pset tuples_only on
\pset format unaligned
\echo -- setup: DC delivery V1 (document D1); invoice D2 with automatic delivery V2 and self-link L1
SELECT t.mk_dc('{D1}', '{V1}', 'SM_B1_dc');
SELECT t.mk_inv('{D2}', '{V2}', '{L1}', 'SM_B1_inv');
\echo -- PATH 1 (link I=D2 to Dd=V1): soft-unlink the self-link, cancel Da, insert the pm_manual link
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L1}';
UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V2}';
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L2}', '{T1}', '{P1}', '{V1}', '{D2}', 'pm_manual', '{U.PM1}');
\echo -- B1a: reject the DC delivery while its link is active -> refused (E13)
SELECT t.expect('B1a reject DC while link active', $$UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad dc' WHERE id = '{V1}'$$, 'E13');
SELECT t.val('B1a DC delivery still incomplete', $$SELECT status FROM public.deliveries WHERE id = '{V1}'$$, 'incomplete');
\echo -- B1b: unlink (delivery_rejected), THEN reject -> succeeds
SELECT t.expect('B1b unlink the PM link', $$UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'delivery_rejected' WHERE id = '{L2}'$$, 'ok');
SELECT t.expect('B1b reject DC after unlink', $$UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad dc' WHERE id = '{V1}'$$, 'ok');
SELECT t.val('B1b DC delivery is rejected', $$SELECT status FROM public.deliveries WHERE id = '{V1}'$$, 'rejected');
\echo -- B1c: an AUTOMATIC delivery with an active self-link (new invoice D3 / V3 / L3)
SELECT t.mk_inv('{D3}', '{V3}', '{L3}', 'SM_B1_inv3');
SELECT t.expect('B1c reject Da while self-link active', $$UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad inv' WHERE id = '{V3}'$$, 'E13');
SELECT t.expect('B1c cancel Da while self-link active', $$UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V3}'$$, 'E13');
SELECT t.expect('B1d unlink the self-link (delivery_rejected)', $$UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'delivery_rejected' WHERE id = '{L3}'$$, 'ok');
SELECT t.expect('B1d reject Da after unlinking', $$UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad inv' WHERE id = '{V3}'$$, 'ok');
SELECT t.val('B1d Da is rejected', $$SELECT status FROM public.deliveries WHERE id = '{V3}'$$, 'rejected');
