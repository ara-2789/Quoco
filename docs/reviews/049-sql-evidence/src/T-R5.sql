\echo == T-R5 (R5): self_invoice_id generated column inside an FK -- wrong invoice -> 23503; correct -> inserts (PG 17) ==
\pset tuples_only on
\pset format unaligned
\echo -- the constraint as PG 17 stores it (RESTRICT written explicitly, generated column inside the FK):
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'dil_self_link_fk';
SELECT 'self_invoice_id attgenerated=' || attgenerated::text FROM pg_attribute WHERE attrelid = 'public.delivery_invoice_links'::regclass AND attname = 'self_invoice_id';
\echo -- setup: invoice D1 + automatic delivery V1 + self-link L1; plain invoice document D2 (no delivery, no link); DC V3/D3
SELECT t.mk_inv('{D1}', '{V1}', '{L1}', 'SM_R5_1');
SELECT t.mk_doc('{D2}', 'invoice', 'SM_R5_2');
SELECT t.mk_dc('{D3}', '{V3}', 'SM_R5_dc');
\echo -- free V1 of its active link so the partial unique index cannot answer first (it would give 23505, not the FK)
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'delivery_rejected' WHERE id = '{L1}';
SELECT t.expect('R5a self-link for V1 naming a DIFFERENT invoice D2', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L2}', '{T1}', '{P1}', '{V1}', '{D2}', 'created_from_invoice')$$, '23503');
SELECT t.val('R5a no row was inserted', $$SELECT count(*)::text FROM public.delivery_invoice_links WHERE id = '{L2}'$$, '0');
SELECT t.expect('R5b self-link for V1 naming its OWN invoice D1', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L3}', '{T1}', '{P1}', '{V1}', '{D1}', 'created_from_invoice')$$, 'ok');
SELECT t.val('R5b generated self_invoice_id = D1', $$SELECT (self_invoice_id = '{D1}')::text FROM public.delivery_invoice_links WHERE id = '{L3}'$$, 'true');
\echo -- a pm_manual link has self_invoice_id NULL, so the FK is skipped (MATCH SIMPLE) and it may name any invoice
SELECT t.expect('R5c pm_manual link V3 -> D2 (self_invoice_id NULL, FK skipped)', $$INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L4}', '{T1}', '{P1}', '{V3}', '{D2}', 'pm_manual', '{U.PM1}')$$, 'ok');
SELECT t.val('R5c self_invoice_id is NULL', $$SELECT (self_invoice_id IS NULL)::text FROM public.delivery_invoice_links WHERE id = '{L4}'$$, 'true');
\echo -- a generated column cannot be written
SELECT t.expect('R5d explicit value for the generated column', $$INSERT INTO public.delivery_invoice_links (tenant_id, project_id, delivery_id, invoice_document_id, link_source, self_invoice_id) VALUES ('{T1}', '{P1}', '{V1}', '{D1}', 'created_from_invoice', '{D1}')$$, '428C9');
\echo -- RESTRICT both ways: the delivery cannot be deleted or re-keyed while a link references it
SELECT t.expect('R5e DELETE the referenced delivery', $$DELETE FROM public.deliveries WHERE id = '{V1}'$$, '23503');
SELECT t.expect('R5e re-key the referenced delivery (ON UPDATE RESTRICT)', $$UPDATE public.deliveries SET id = '{V9}' WHERE id = '{V1}'$$, '23503');
