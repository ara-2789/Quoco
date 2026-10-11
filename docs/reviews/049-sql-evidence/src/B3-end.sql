\pset tuples_only on
\pset format unaligned
\echo -- END STATE after both sessions finished
SELECT t.val('end state: V1 delivery_type', $$SELECT delivery_type FROM public.deliveries WHERE id = '{V1}'$$, :'exp_type');
SELECT t.val('end state: active links on V1', $$SELECT count(*)::text FROM public.delivery_invoice_links WHERE delivery_id = '{V1}' AND unlinked_at IS NULL$$, :'exp_links');
SELECT t.val('INVARIANT: no active link points at an internal_transfer delivery', $$SELECT count(*)::text FROM public.delivery_invoice_links l JOIN public.deliveries d ON d.id = l.delivery_id WHERE l.unlinked_at IS NULL AND d.delivery_type = 'internal_transfer'$$, '0');
