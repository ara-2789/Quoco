-- _fixture.sql -- fixed-ID fixtures for the 049 PG17 dry-run scenarios (DISPOSABLE LOCAL scaffold only).
-- ID scheme: 1...=tenant 2...=project 3...=users.id 4...=users.auth_id 5...=document 6...=delivery 7...=link
--   T1 10000000-0000-0000-0000-000000000001   T2 ...002
--   P1 20000000-0000-0000-0000-000000000001   P2 ...002 (T1)   P3 ...003 (T2)
--   PM1 ...31  ENG1 ...32  QS1 ...33  DPM(deactivated pm of P1) ...34  ADMN(admin, no membership) ...35
--   ADMP(admin, pm member of P1) ...36  PM2(pm of P2) ...37  PEND(pending pm of P1) ...38  PM3(pm of P3, T2) ...39
--   users.id = 30000000-0000-0000-0000-00000000000N ; users.auth_id = 40000000-0000-0000-0000-00000000000N
-- Loaded in every scenario; the tenant slug uses the helper-script fixture-guard prefix.
INSERT INTO public.tenants (id, name, slug) VALUES
  ('10000000-0000-0000-0000-000000000001', 'Fixture T1', 'zz-test-capture-t1'),
  ('10000000-0000-0000-0000-000000000002', 'Fixture T2', 'zz-test-capture-t2');
INSERT INTO public.projects (id, tenant_id, name) VALUES
  ('20000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'P1'),
  ('20000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'P2'),
  ('20000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000002', 'P3');
-- users.auth_id has an FK to auth.users(id) (the auth schema is a STUB in the scaffold): create the auth rows first.
INSERT INTO auth.users (id) VALUES
  ('40000000-0000-0000-0000-000000000001'), ('40000000-0000-0000-0000-000000000003'), ('40000000-0000-0000-0000-000000000004'),
  ('40000000-0000-0000-0000-000000000005'), ('40000000-0000-0000-0000-000000000006'), ('40000000-0000-0000-0000-000000000007'),
  ('40000000-0000-0000-0000-000000000008'), ('40000000-0000-0000-0000-000000000009');
INSERT INTO public.users (id, tenant_id, full_name, role, status, auth_id) VALUES
  ('30000000-0000-0000-0000-000000000001', '10000000-0000-0000-0000-000000000001', 'PM1',  'pm',       'active',      '40000000-0000-0000-0000-000000000001'),
  ('30000000-0000-0000-0000-000000000002', '10000000-0000-0000-0000-000000000001', 'ENG1', 'engineer', 'active',      NULL),
  ('30000000-0000-0000-0000-000000000003', '10000000-0000-0000-0000-000000000001', 'QS1',  'qs',       'active',      '40000000-0000-0000-0000-000000000003'),
  ('30000000-0000-0000-0000-000000000004', '10000000-0000-0000-0000-000000000001', 'DPM',  'pm',       'deactivated', '40000000-0000-0000-0000-000000000004'),
  ('30000000-0000-0000-0000-000000000005', '10000000-0000-0000-0000-000000000001', 'ADMN', 'admin',    'active',      '40000000-0000-0000-0000-000000000005'),
  ('30000000-0000-0000-0000-000000000006', '10000000-0000-0000-0000-000000000001', 'ADMP', 'admin',    'active',      '40000000-0000-0000-0000-000000000006'),
  ('30000000-0000-0000-0000-000000000007', '10000000-0000-0000-0000-000000000001', 'PM2',  'pm',       'active',      '40000000-0000-0000-0000-000000000007'),
  ('30000000-0000-0000-0000-000000000008', '10000000-0000-0000-0000-000000000001', 'PEND', 'pm',       'pending',     '40000000-0000-0000-0000-000000000008'),
  ('30000000-0000-0000-0000-000000000009', '10000000-0000-0000-0000-000000000002', 'PM3',  'pm',       'active',      '40000000-0000-0000-0000-000000000009');
INSERT INTO public.project_members (tenant_id, project_id, user_id, role) VALUES
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'pm'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'engineer'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'qs'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000004', 'pm'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000006', 'pm'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000007', 'pm'),
  ('10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000008', 'pm'),
  ('10000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000003', '30000000-0000-0000-0000-000000000009', 'pm');

-- Builders. Plain inserts as the table owner, so the 049 triggers fire exactly as in production.
-- t.mk_doc: a capture_documents row in T1/P1 (project overridable), sent by ENG1.
CREATE OR REPLACE FUNCTION t.mk_doc(p_id uuid, p_kind text, p_sid text, p_project uuid DEFAULT '20000000-0000-0000-0000-000000000001')
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO public.capture_documents (id, tenant_id, project_id, kind, sent_by, source_message_sid)
  VALUES (p_id, '10000000-0000-0000-0000-000000000001', p_project, p_kind, '30000000-0000-0000-0000-000000000002', p_sid);
  RETURN p_id;
END;
$$;

-- t.mk_dc: DC document + its DC delivery (supplier, incomplete). received_at one hour before now.
CREATE OR REPLACE FUNCTION t.mk_dc(p_doc uuid, p_dlv uuid, p_sid text)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.mk_doc(p_doc, 'dc', p_sid);
  INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, dc_document_id)
  VALUES (p_dlv, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000002', now() - interval '1 hour', p_doc);
  -- N-4 (SQL review r3): delivery_type is PM-owned and NULL at INSERT; set through UPDATE (same final state as before).
  UPDATE public.deliveries SET delivery_type = 'supplier' WHERE id = p_dlv;
  RETURN p_dlv;
END;
$$;

-- t.mk_inv: invoice document + its AUTOMATIC delivery (created_from_invoice_id) + the self-link. Insert order:
-- document, delivery, self-link (TR1 runs on the link).
CREATE OR REPLACE FUNCTION t.mk_inv(p_doc uuid, p_dlv uuid, p_link uuid, p_sid text)
RETURNS uuid LANGUAGE plpgsql AS $$
BEGIN
  PERFORM t.mk_doc(p_doc, 'invoice', p_sid);
  INSERT INTO public.deliveries (id, tenant_id, project_id, reported_by, received_at, created_from_invoice_id)
  VALUES (p_dlv, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001',
          '30000000-0000-0000-0000-000000000002', now() - interval '1 hour', p_doc);
  -- N-4 (SQL review r3): delivery_type set through UPDATE (same final state as before).
  UPDATE public.deliveries SET delivery_type = 'supplier' WHERE id = p_dlv;
  INSERT INTO public.delivery_invoice_links (id, tenant_id, project_id, delivery_id, invoice_document_id, link_source)
  VALUES (p_link, '10000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', p_dlv, p_doc, 'created_from_invoice');
  RETURN p_doc;
END;
$$;
