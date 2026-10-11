\echo == T-ORPH (D-19, S-B): the three orphan probes return 0 after every PR-B path ==
\pset tuples_only on
\pset format unaligned
\echo -- the three probes (psql variables, passed to t.val as the query text):
\set p1 'SELECT count(*)::text FROM public.capture_documents d WHERE d.kind = ''dc'' AND NOT EXISTS (SELECT 1 FROM public.deliveries x WHERE x.dc_document_id = d.id)'
\set p2 'SELECT count(*)::text FROM public.capture_documents d WHERE d.kind = ''invoice'' AND NOT EXISTS (SELECT 1 FROM public.deliveries x WHERE x.created_from_invoice_id = d.id) AND NOT EXISTS (SELECT 1 FROM public.delivery_invoice_links l WHERE l.invoice_document_id = d.id AND l.unlinked_at IS NULL)'
\set p3 'SELECT count(*)::text FROM public.capture_documents d WHERE d.kind = ''invoice'' AND NOT EXISTS (SELECT 1 FROM public.delivery_invoice_links l WHERE l.invoice_document_id = d.id AND l.unlinked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM public.deliveries x WHERE x.created_from_invoice_id = d.id AND x.status = ''rejected'')'
\echo -- probe 1: DC document with no delivery.  probe 2: invoice document with neither a delivery nor an active link (v2).
\echo -- probe 3 (S-B): invoice document with no active link whose automatic delivery is not rejected.
\echo
\echo -- STEP 0: empty
SELECT t.val('S0 probe1', :'p1', '0');
SELECT t.val('S0 probe2', :'p2', '0');
SELECT t.val('S0 probe3', :'p3', '0');
\echo -- STEP 1: create a DC (document D1 + delivery V1)
SELECT t.mk_dc('{D1}', '{V1}', 'SM_O_dc1');
SELECT t.val('S1 probe1', :'p1', '0');
SELECT t.val('S1 probe2', :'p2', '0');
SELECT t.val('S1 probe3', :'p3', '0');
\echo -- STEP 2: create an invoice (document D2 + automatic delivery V2 + self-link L1)
SELECT t.mk_inv('{D2}', '{V2}', '{L1}', 'SM_O_inv1');
SELECT t.val('S2 probe1', :'p1', '0');
SELECT t.val('S2 probe2', :'p2', '0');
SELECT t.val('S2 probe3', :'p3', '0');
\echo -- STEP 3: PATH 1 link D2 -> V1 (soft-unlink self-link, cancel V2, insert pm_manual L2)
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L1}';
UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V2}';
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L2}', '{T1}', '{P1}', '{V1}', '{D2}', 'pm_manual', '{U.PM1}');
SELECT t.val('S3 probe1', :'p1', '0');
SELECT t.val('S3 probe2', :'p2', '0');
SELECT t.val('S3 probe3', :'p3', '0');
\echo -- STEP 4: PATH 2 unlink with restore (unlink L2, restore V2 FIRST, then the new self-link L3)
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'pm_unlinked' WHERE id = '{L2}';
UPDATE public.deliveries SET status = 'incomplete', cancelled_at = NULL, cancel_reason = NULL, approved_by = NULL, approved_at = NULL WHERE id = '{V2}';
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L3}', '{T1}', '{P1}', '{V2}', '{D2}', 'created_from_invoice');
SELECT t.val('S4 probe1', :'p1', '0');
SELECT t.val('S4 probe2', :'p2', '0');
SELECT t.val('S4 probe3', :'p3', '0');
\echo -- STEP 5: PATH 3 reject an automatic delivery (new invoice D3 / V3 / L4: unlink delivery_rejected, then reject)
SELECT t.mk_inv('{D3}', '{V3}', '{L4}', 'SM_O_inv2');
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'delivery_rejected' WHERE id = '{L4}';
UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad invoice' WHERE id = '{V3}';
SELECT t.val('S5 probe1', :'p1', '0');
SELECT t.val('S5 probe2', :'p2', '0');
SELECT t.val('S5 probe3 (rejected automatic delivery is the allowed exception)', :'p3', '0');
\echo -- STEP 6: PATH 4 reject a DC with restore. DC D4/V4, invoice D5/V5/L5; link D5 -> V4 (PATH 1), then reject V4.
SELECT t.mk_dc('{D4}', '{V4}', 'SM_O_dc2');
SELECT t.mk_inv('{D5}', '{V5}', '{L5}', 'SM_O_inv3');
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'superseded_by_link' WHERE id = '{L5}';
UPDATE public.deliveries SET status = 'cancelled', cancelled_at = now(), cancel_reason = 'superseded_by_link' WHERE id = '{V5}';
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source, linked_by) VALUES ('{L6}', '{T1}', '{P1}', '{V4}', '{D5}', 'pm_manual', '{U.PM1}');
\echo -- path 4 steps 5-6: soft-unlink the link (delivery_rejected), update Dd to rejected
UPDATE public.delivery_invoice_links SET unlinked_at = now(), unlinked_by = '{U.PM1}', unlink_reason = 'delivery_rejected' WHERE id = '{L6}';
UPDATE public.deliveries SET status = 'rejected', rejected_by = '{U.PM1}', rejected_at = now(), reject_reason = 'bad dc' WHERE id = '{V4}';
\echo -- path 4 step 7: count D5's active PM links (must be 0)
SELECT t.val('S6 active PM links of D5', $$SELECT count(*)::text FROM public.delivery_invoice_links WHERE invoice_document_id = '{D5}' AND link_source = 'pm_manual' AND unlinked_at IS NULL$$, '0');
\if :{?red}
\echo -- RED FLOW MUTANT (named: path 4 WITHOUT step 8, no restore): the invoice D5 is left with no active link and a cancelled automatic delivery
\else
\echo -- path 4 step 8: restore V5 to pending FIRST, THEN insert the new self-link L7
UPDATE public.deliveries SET status = 'incomplete', cancelled_at = NULL, cancel_reason = NULL, approved_by = NULL, approved_at = NULL WHERE id = '{V5}';
INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source) VALUES ('{L7}', '{T1}', '{P1}', '{V5}', '{D5}', 'created_from_invoice');
\endif
SELECT t.val('S6 probe1', :'p1', '0');
SELECT t.val('S6 probe2', :'p2', '0');
SELECT t.val('S6 probe3', :'p3', '0');
\if :{?red}
\echo -- RED positive controls: plant a DC document with no delivery (probe 1) and an invoice document with nothing (probe 2)
SELECT t.mk_doc('{D8}', 'dc', 'SM_O_orph_dc');
SELECT t.mk_doc('{D9}', 'invoice', 'SM_O_orph_inv');
SELECT t.val('RED planted: probe1 must detect the orphan DC (expects 0, sees 1 -> FAIL proves the probe can fail)', :'p1', '0');
SELECT t.val('RED planted: probe2 must detect the orphan invoice (expects 0, sees 1 -> FAIL)', :'p2', '0');
\endif
