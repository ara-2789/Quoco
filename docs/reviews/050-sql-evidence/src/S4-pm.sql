-- S4: the five pm_* functions (real 049 tables and triggers), grants, audience (B2), array shape (S1), E8.
\pset pager off
-- ids: I# invoice documents 5...0N with automatic delivery 6...0N and self-link 7...0N ; D# DC documents/deliveries
SELECT t.mk_inv('50000000-0000-0000-0000-000000000001','60000000-0000-0000-0000-000000000001','70000000-0000-0000-0000-000000000001','pm-i1') \gset
SELECT t.mk_inv('50000000-0000-0000-0000-000000000002','60000000-0000-0000-0000-000000000002','70000000-0000-0000-0000-000000000002','pm-i2') \gset
SELECT t.mk_inv('50000000-0000-0000-0000-000000000003','60000000-0000-0000-0000-000000000003','70000000-0000-0000-0000-000000000003','pm-i3') \gset
SELECT t.mk_inv('50000000-0000-0000-0000-000000000004','60000000-0000-0000-0000-000000000004','70000000-0000-0000-0000-000000000004','pm-i4') \gset
SELECT t.mk_inv('50000000-0000-0000-0000-000000000005','60000000-0000-0000-0000-000000000005','70000000-0000-0000-0000-000000000005','pm-i5') \gset
SELECT t.mk_inv('50000000-0000-0000-0000-000000000006','60000000-0000-0000-0000-000000000006','70000000-0000-0000-0000-000000000006','pm-i6') \gset
SELECT t.mk_dc('50000000-0000-0000-0000-0000000000a1','60000000-0000-0000-0000-0000000000a1','pm-d1') \gset
SELECT t.mk_dc('50000000-0000-0000-0000-0000000000a2','60000000-0000-0000-0000-0000000000a2','pm-d2') \gset
SELECT t.mk_dc('50000000-0000-0000-0000-0000000000a3','60000000-0000-0000-0000-0000000000a3','pm-d3') \gset
SELECT t.mk_dc('50000000-0000-0000-0000-0000000000a4','60000000-0000-0000-0000-0000000000a4','pm-d4') \gset
SELECT t.mk_dc('50000000-0000-0000-0000-0000000000a5','60000000-0000-0000-0000-0000000000a5','pm-d5') \gset
SELECT t.mk_dc('50000000-0000-0000-0000-0000000000a6','60000000-0000-0000-0000-0000000000a6','pm-d6') \gset
-- foreign deliveries: other PROJECT same tenant (P2), other TENANT (T2/P3)
SELECT t.mk_doc('50000000-0000-0000-0000-0000000000b1', 'dc', 'pm-fp2', '20000000-0000-0000-0000-000000000002') \gset
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id)
VALUES ('60000000-0000-0000-0000-0000000000b1','10000000-0000-0000-0000-000000000001','20000000-0000-0000-0000-000000000002','30000000-0000-0000-0000-000000000002', now() - interval '1 hour','50000000-0000-0000-0000-0000000000b1');
INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid)
VALUES ('50000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','dc','30000000-0000-0000-0000-000000000009','pm-ft2');
INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id)
VALUES ('60000000-0000-0000-0000-0000000000b2','10000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000003','30000000-0000-0000-0000-000000000009', now() - interval '1 hour','50000000-0000-0000-0000-0000000000b2');

\echo == AUDIENCE (B2) and identical refusal (S1): every failure is QE015, nothing changes
\set PM1 '40000000-0000-0000-0000-000000000001'
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000004', false) \gset
SET ROLE authenticated;
SELECT t.expect('T-B2-DEACTIVATED pm_link_invoice', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000001', ARRAY['60000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'QE015');
SELECT t.expect('T-B2-DEACTIVATED pm_approve_delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, 'QE015');
SELECT t.expect('T-B2-DEACTIVATED pm_reject_delivery', $$SELECT public.pm_reject_delivery('60000000-0000-0000-0000-0000000000a1','r')$$, 'QE015');
SELECT t.expect('T-B2-DEACTIVATED pm_set_delivery_details', $$SELECT public.pm_set_delivery_details('60000000-0000-0000-0000-0000000000a1','supplier',NULL,NULL,NULL)$$, 'QE015');
SELECT t.expect('T-B2-DEACTIVATED pm_unlink_invoice', $$SELECT public.pm_unlink_invoice('70000000-0000-0000-0000-000000000001')$$, 'QE015');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000008', false) \gset
SET ROLE authenticated;
SELECT t.expect('T-B2-PENDING pm_link_invoice', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000001', ARRAY['60000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'QE015');
SELECT t.expect('T-B2-PENDING pm_approve_delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, 'QE015');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000005', false) \gset
SET ROLE authenticated;
SELECT t.expect('T-B2-ADMIN-NONMEMBER pm_link_invoice', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000001', ARRAY['60000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'QE015');
SELECT t.expect('T-B2-ADMIN-NONMEMBER pm_approve_delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, 'QE015');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000003', false) \gset
SET ROLE authenticated;
SELECT t.expect('qs refused pm_approve_delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, 'QE015');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000007', false) \gset
SET ROLE authenticated;
SELECT t.expect('PM of another project (same tenant) refused', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, 'QE015');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', '40000000-0000-0000-0000-000000000009', false) \gset
SET ROLE authenticated;
SELECT t.expect('PM of another tenant refused', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, 'QE015');
RESET ROLE;
SELECT set_config('request.jwt.claim.sub', :'PM1', false) \gset
SET ROLE authenticated;
SELECT t.expect('T-F5-SAME PM1: nonexistent id', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000ff')$$, 'QE015');
SELECT t.expect('T-F5-SAME PM1: delivery in ANOTHER PROJECT (same tenant)', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000b1')$$, 'QE015');
SELECT t.expect('T-F5-SAME PM1: delivery in ANOTHER TENANT', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000b2')$$, 'QE015');
SELECT t.ok('T-F5-SAME: the three refusals carry the IDENTICAL message text',
  t.errmsg($$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000ff')$$) = t.errmsg($$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000b1')$$)
  AND t.errmsg($$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000b1')$$) = t.errmsg($$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000b2')$$)) AS identical;
SELECT t.errmsg($$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000ff')$$) AS the_message;
RESET ROLE;

\echo == ARRAY SHAPE and foreign id (S1): QE015, nothing locked or written
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT t.expect('T-S1-FOREIGN-ID other project: QE015 (not 23503)', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY['60000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'QE015');
SELECT t.expect('T-S1-FOREIGN-ID other tenant: QE015 (not 23503)', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY['60000000-0000-0000-0000-0000000000b2']::uuid[])$$, 'QE015');
SELECT t.expect('T-S1-FOREIGN-ID one good id + one foreign id', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY['60000000-0000-0000-0000-0000000000a1','60000000-0000-0000-0000-0000000000b1']::uuid[])$$, 'QE015');
SELECT t.expect('T-S1-ARRAY-SHAPE empty array', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY[]::uuid[])$$, 'QE015');
SELECT t.expect('T-S1-ARRAY-SHAPE NULL array', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', NULL)$$, 'QE015');
SELECT t.expect('T-S1-ARRAY-SHAPE NULL element', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY['60000000-0000-0000-0000-0000000000a1', NULL]::uuid[])$$, 'QE015');
SELECT t.expect('T-S1-ARRAY-SHAPE duplicate id', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY['60000000-0000-0000-0000-0000000000a1','60000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'QE015');
SELECT t.expect('T-S1-ARRAY-SHAPE 21 ids (cap 20)', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', (SELECT array_agg(gen_random_uuid()) FROM generate_series(1,21)))$$, 'QE015');
SELECT t.expect('T-S1-UNLINK nonexistent link id', $$SELECT public.pm_unlink_invoice('70000000-0000-0000-0000-0000000000ff')$$, 'QE015');
RESET ROLE;
SELECT t.ok('nothing cancelled, no pm_manual link written by any refusal',
  (SELECT count(*) = 0 FROM public.deliveries WHERE status = 'cancelled') AND (SELECT count(*) = 0 FROM public.delivery_invoice_links WHERE link_source = 'pm_manual'));

\echo == pm_link_invoice SUCCESS (PM1): I1 -> D1, D2 ; the automatic delivery is cancelled, the self-link soft-unlinked
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000001', ARRAY['60000000-0000-0000-0000-0000000000a2','60000000-0000-0000-0000-0000000000a1']::uuid[]) AS linked;
RESET ROLE;
SELECT t.ok('T-A28-2: two pm_manual links, automatic delivery cancelled (superseded_by_link), self-link unlinked with the pre-cancel snapshot',
  (SELECT count(*) = 2 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000001' AND link_source = 'pm_manual' AND unlinked_at IS NULL AND linked_by = '30000000-0000-0000-0000-000000000001')
  AND (SELECT status = 'cancelled' AND cancel_reason = 'superseded_by_link' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000001')
  AND (SELECT unlink_reason = 'superseded_by_link' AND superseded_from_status = 'incomplete' FROM public.delivery_invoice_links WHERE id = '70000000-0000-0000-0000-000000000001'));

\echo == QE008: a second invoice linking a DC delivery that already has an active link
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT t.expect('QE008 (uq_dil_active_per_delivery translated), D1 already linked to I1', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000002', ARRAY['60000000-0000-0000-0000-0000000000a1']::uuid[])$$, 'QE008');
RESET ROLE;
SELECT t.ok('T-A28-2 control: the failed link left I2''s automatic delivery UNcancelled and its self-link ACTIVE (whole call rolled back)',
  (SELECT status = 'incomplete' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000002')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000002' AND link_source = 'created_from_invoice' AND unlinked_at IS NULL)
  AND (SELECT count(*) = 0 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000002' AND link_source = 'pm_manual'));

\echo == T-B2-ADMIN-PMMEMBER: an admin who is also a pm member of the project succeeds
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000006';
SET ROLE authenticated;
SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000004', ARRAY['60000000-0000-0000-0000-0000000000a3']::uuid[]) AS admin_member_link;
RESET ROLE;
SELECT t.ok('admin PM-member linked I4 -> D3 (linked_by = ADMP)', (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000004' AND linked_by = '30000000-0000-0000-0000-000000000006' AND unlinked_at IS NULL));

\echo == E8 RE-RAISE (T-E8-RERAISE): a rehearsal-only planted unique index hit by a pm_manual insert
CREATE UNIQUE INDEX plant_uq_pm_per_invoice ON public.delivery_invoice_links (invoice_document_id) WHERE link_source = 'pm_manual' AND unlinked_at IS NULL AND invoice_document_id = '50000000-0000-0000-0000-000000000005';
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT t.expect('native 23505 reaches the caller (not QE008)', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000005', ARRAY['60000000-0000-0000-0000-0000000000a4','60000000-0000-0000-0000-0000000000a5']::uuid[])$$, '23505');
SELECT t.errmsg($$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000005', ARRAY['60000000-0000-0000-0000-0000000000a4','60000000-0000-0000-0000-0000000000a5']::uuid[])$$) AS native_error_text;
RESET ROLE;
SELECT t.ok('nothing changed: automatic delivery NOT cancelled, self-link still ACTIVE, no pm_manual row',
  (SELECT status = 'incomplete' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000005')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000005' AND link_source = 'created_from_invoice' AND unlinked_at IS NULL)
  AND (SELECT count(*) = 0 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000005' AND link_source = 'pm_manual'));
DROP INDEX public.plant_uq_pm_per_invoice;

\echo == pm_unlink_invoice: unlink one of two (no restore), then the last (restore: incomplete + NEW self-link)
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.pm_unlink_invoice(l.id) AS unlink_first FROM public.delivery_invoice_links l WHERE l.invoice_document_id = '50000000-0000-0000-0000-000000000001' AND l.delivery_id = '60000000-0000-0000-0000-0000000000a1' AND l.unlinked_at IS NULL;
RESET ROLE;
SELECT t.ok('T-A28-4 contrast: another PM link remains -> the automatic delivery is still cancelled',
  (SELECT status = 'cancelled' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000001'));
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.pm_unlink_invoice(l.id) AS unlink_last FROM public.delivery_invoice_links l WHERE l.invoice_document_id = '50000000-0000-0000-0000-000000000001' AND l.delivery_id = '60000000-0000-0000-0000-0000000000a2' AND l.unlinked_at IS NULL;
RESET ROLE;
SELECT t.ok('T-A28-4: last PM link gone -> automatic delivery restored (incomplete, cancelled_* cleared) with a NEW active self-link',
  (SELECT status = 'incomplete' AND cancelled_at IS NULL AND cancel_reason IS NULL FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000001')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000001' AND link_source = 'created_from_invoice' AND unlinked_at IS NULL)
  AND (SELECT count(*) = 2 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000001' AND link_source = 'created_from_invoice'));

\echo == pm_reject_delivery Path 4 with restore, blank reason, approve without type, bad transitions
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000006', ARRAY['60000000-0000-0000-0000-0000000000a6']::uuid[]) AS link_i6_d6;
SELECT t.expect('QE017 reject with blank reason', $$SELECT public.pm_reject_delivery('60000000-0000-0000-0000-0000000000a6','   ')$$, 'QE017');
SELECT public.pm_reject_delivery('60000000-0000-0000-0000-0000000000a6', 'not ours') AS reject_d6;
RESET ROLE;
SELECT t.ok('Path 4: rejecting the only linked DC delivery rejected it AND restored I6''s automatic delivery with a new self-link',
  (SELECT status = 'rejected' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-0000000000a6')
  AND (SELECT status = 'incomplete' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000006')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000006' AND link_source = 'created_from_invoice' AND unlinked_at IS NULL)
  AND (SELECT unlink_reason = 'delivery_rejected' FROM public.delivery_invoice_links WHERE delivery_id = '60000000-0000-0000-0000-0000000000a6'));
SET request.jwt.claim.sub = '40000000-0000-0000-0000-000000000001';
SET ROLE authenticated;
RESET ROLE;
UPDATE public.deliveries SET delivery_type = NULL WHERE id = '60000000-0000-0000-0000-000000000003';
SET ROLE authenticated;
SELECT t.expect('QE016 approve with no delivery_type', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-000000000003')$$, 'QE016');
SELECT t.expect('QE011 approve a rejected delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a6')$$, 'QE011');
SELECT t.expect('QE011 reject a rejected delivery', $$SELECT public.pm_reject_delivery('60000000-0000-0000-0000-0000000000a6','again')$$, 'QE011');
SELECT public.pm_set_delivery_details('60000000-0000-0000-0000-000000000003', 'supplier', 'TN9', 'DC-3', current_date) AS set_i3;
SELECT public.pm_approve_delivery('60000000-0000-0000-0000-000000000003') AS approve_auto_i3;
SELECT t.expect('QE011 X6/D-9: linking an invoice whose automatic delivery is APPROVED is refused', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000003', ARRAY['60000000-0000-0000-0000-0000000000a4']::uuid[])$$, 'QE011');
SELECT t.expect('QE006 retype to internal_transfer while a link is active', $$SELECT public.pm_set_delivery_details('60000000-0000-0000-0000-0000000000a3','internal_transfer',NULL,NULL,NULL)$$, 'QE006');
SELECT t.expect('QE007 retype an AUTOMATIC delivery to internal_transfer', $$SELECT public.pm_set_delivery_details('60000000-0000-0000-0000-000000000006','internal_transfer',NULL,NULL,NULL)$$, 'QE007');
RESET ROLE;
SELECT t.ok('X6: after the refused link, I3''s automatic delivery is still approved and its self-link still active',
  (SELECT status = 'approved' FROM public.deliveries WHERE id = '60000000-0000-0000-0000-000000000003')
  AND (SELECT count(*) = 1 FROM public.delivery_invoice_links WHERE invoice_document_id = '50000000-0000-0000-0000-000000000003' AND link_source = 'created_from_invoice' AND unlinked_at IS NULL));

\echo == GRANTS (T-F5-4 and the pm_* audience at the grant layer): refusals are 42501
SET ROLE anon;
SELECT t.expect('anon refused pm_approve_delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, '42501');
SELECT t.expect('anon refused pm_link_invoice', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000001', ARRAY['60000000-0000-0000-0000-0000000000a1']::uuid[])$$, '42501');
SELECT t.expect('anon refused apply_material_inward_turn', $$SELECT public.apply_material_inward_turn('+9100','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','x','sid-anon')$$, '42501');
SELECT t.expect('anon refused expire_stale_material_inward', $$SELECT public.expire_stale_material_inward('+9100')$$, '42501');
RESET ROLE;
SET ROLE service_role;
SELECT t.expect('service_role refused pm_approve_delivery', $$SELECT public.pm_approve_delivery('60000000-0000-0000-0000-0000000000a1')$$, '42501');
SELECT t.expect('service_role refused pm_set_delivery_details', $$SELECT public.pm_set_delivery_details('60000000-0000-0000-0000-0000000000a1','supplier',NULL,NULL,NULL)$$, '42501');
SELECT t.expect('service_role refused pm_reject_delivery', $$SELECT public.pm_reject_delivery('60000000-0000-0000-0000-0000000000a1','x')$$, '42501');
SELECT t.expect('service_role refused pm_link_invoice', $$SELECT public.pm_link_invoice('50000000-0000-0000-0000-000000000001', ARRAY['60000000-0000-0000-0000-0000000000a1']::uuid[])$$, '42501');
SELECT t.expect('service_role refused pm_unlink_invoice', $$SELECT public.pm_unlink_invoice('70000000-0000-0000-0000-000000000001')$$, '42501');
RESET ROLE;
SET ROLE authenticated;
SELECT t.expect('authenticated refused apply_material_inward_turn', $$SELECT public.apply_material_inward_turn('+9100','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','x','sid-auth')$$, '42501');
SELECT t.expect('authenticated refused expire_stale_material_inward', $$SELECT public.expire_stale_material_inward('+9100')$$, '42501');
SELECT t.expect('authenticated refused apply_morning_flow_turn (live ACL unchanged)', $$SELECT public.apply_morning_flow_turn('+9100','10000000-0000-0000-0000-000000000001','30000000-0000-0000-0000-000000000002','20000000-0000-0000-0000-000000000001','x',false)$$, '42501');
RESET ROLE;
SET ROLE service_role;
SELECT t.expect('service_role positive control: expire_stale_material_inward runs', $$SELECT public.expire_stale_material_inward('+9100')$$, 'ok');
RESET ROLE;
\echo == S4 end
