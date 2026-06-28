-- =============================================================
-- 002_rls_policies.sql
-- RLS enabled on all 22 tables.
-- Helper: get_user_tenant_id()
-- =============================================================


-- =============================================================
-- HELPER FUNCTION
-- =============================================================

CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT tenant_id FROM users WHERE id = auth.uid()
$$;


-- =============================================================
-- ENABLE RLS
-- =============================================================

ALTER TABLE tenants                ENABLE ROW LEVEL SECURITY;
ALTER TABLE users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects               ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE whatsapp_sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE daily_logs             ENABLE ROW LEVEL SECURITY;
ALTER TABLE safety_incidents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices               ENABLE ROW LEVEL SECURITY;
ALTER TABLE hindrances             ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenders                ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_documents       ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_document_chunks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_chat_sessions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE tender_chat_messages   ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_sessions           ENABLE ROW LEVEL SECURITY;
ALTER TABLE boq_items              ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_catalog           ENABLE ROW LEVEL SECURITY;
ALTER TABLE rate_catalog_history   ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendors                ENABLE ROW LEVEL SECURITY;
ALTER TABLE vendor_invoices        ENABLE ROW LEVEL SECURITY;
ALTER TABLE ra_bills               ENABLE ROW LEVEL SECURITY;
ALTER TABLE ra_bill_payments       ENABLE ROW LEVEL SECURITY;


-- =============================================================
-- tenants
-- SELECT: own row only. UPDATE: admin only. INSERT/DELETE: blocked.
-- =============================================================

CREATE POLICY "tenants_select" ON tenants
  FOR SELECT TO authenticated
  USING (id = get_user_tenant_id());

CREATE POLICY "tenants_update" ON tenants
  FOR UPDATE TO authenticated
  USING (
    id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) = 'admin'
  );


-- =============================================================
-- users
-- SELECT: all in own tenant. UPDATE: own row only. INSERT/DELETE: blocked.
-- =============================================================

CREATE POLICY "users_select" ON users
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "users_update" ON users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());


-- =============================================================
-- projects — full CRUD within tenant
-- =============================================================

CREATE POLICY "projects_select" ON projects
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "projects_insert" ON projects
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "projects_update" ON projects
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "projects_delete" ON projects
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- project_members
-- SELECT: all in tenant. INSERT/UPDATE/DELETE: PM or admin only.
-- =============================================================

CREATE POLICY "project_members_select" ON project_members
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "project_members_insert" ON project_members
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin')
  );

CREATE POLICY "project_members_update" ON project_members
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin')
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin')
  );

CREATE POLICY "project_members_delete" ON project_members
  FOR DELETE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin')
  );


-- =============================================================
-- whatsapp_sessions — full CRUD within tenant
-- =============================================================

CREATE POLICY "whatsapp_sessions_select" ON whatsapp_sessions
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "whatsapp_sessions_insert" ON whatsapp_sessions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "whatsapp_sessions_update" ON whatsapp_sessions
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "whatsapp_sessions_delete" ON whatsapp_sessions
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- daily_logs
-- SELECT: all in tenant. INSERT: own engineer_id only.
-- UPDATE: own log (engineer) or pm/admin/qs. DELETE: blocked.
-- =============================================================

CREATE POLICY "daily_logs_select" ON daily_logs
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "daily_logs_insert" ON daily_logs
  FOR INSERT TO authenticated
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND engineer_id = auth.uid()
  );

CREATE POLICY "daily_logs_update" ON daily_logs
  FOR UPDATE TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND (
      engineer_id = auth.uid()
      OR (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin', 'qs')
    )
  )
  WITH CHECK (
    tenant_id = get_user_tenant_id()
    AND (
      engineer_id = auth.uid()
      OR (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin', 'qs')
    )
  );


-- =============================================================
-- safety_incidents — full CRUD within tenant
-- =============================================================

CREATE POLICY "safety_incidents_select" ON safety_incidents
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "safety_incidents_insert" ON safety_incidents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "safety_incidents_update" ON safety_incidents
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "safety_incidents_delete" ON safety_incidents
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- invoices — full CRUD within tenant
-- =============================================================

CREATE POLICY "invoices_select" ON invoices
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "invoices_insert" ON invoices
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "invoices_update" ON invoices
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "invoices_delete" ON invoices
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- hindrances — full CRUD within tenant
-- =============================================================

CREATE POLICY "hindrances_select" ON hindrances
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "hindrances_insert" ON hindrances
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "hindrances_update" ON hindrances
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "hindrances_delete" ON hindrances
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- tenders — full CRUD within tenant
-- =============================================================

CREATE POLICY "tenders_select" ON tenders
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tenders_insert" ON tenders
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tenders_update" ON tenders
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tenders_delete" ON tenders
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- tender_documents — full CRUD within tenant
-- =============================================================

CREATE POLICY "tender_documents_select" ON tender_documents
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_documents_insert" ON tender_documents
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_documents_update" ON tender_documents
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_documents_delete" ON tender_documents
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- tender_document_chunks — full CRUD within tenant
-- =============================================================

CREATE POLICY "tender_document_chunks_select" ON tender_document_chunks
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_document_chunks_insert" ON tender_document_chunks
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_document_chunks_update" ON tender_document_chunks
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_document_chunks_delete" ON tender_document_chunks
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- tender_chat_sessions — full CRUD within tenant
-- =============================================================

CREATE POLICY "tender_chat_sessions_select" ON tender_chat_sessions
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_chat_sessions_insert" ON tender_chat_sessions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_chat_sessions_update" ON tender_chat_sessions
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_chat_sessions_delete" ON tender_chat_sessions
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- tender_chat_messages — full CRUD within tenant
-- =============================================================

CREATE POLICY "tender_chat_messages_select" ON tender_chat_messages
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_chat_messages_insert" ON tender_chat_messages
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_chat_messages_update" ON tender_chat_messages
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "tender_chat_messages_delete" ON tender_chat_messages
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- boq_sessions — full CRUD within tenant
-- =============================================================

CREATE POLICY "boq_sessions_select" ON boq_sessions
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "boq_sessions_insert" ON boq_sessions
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "boq_sessions_update" ON boq_sessions
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "boq_sessions_delete" ON boq_sessions
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- boq_items — full CRUD within tenant
-- =============================================================

CREATE POLICY "boq_items_select" ON boq_items
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "boq_items_insert" ON boq_items
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "boq_items_update" ON boq_items
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "boq_items_delete" ON boq_items
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- rate_catalog — read-only, no tenant check (global reference data)
-- =============================================================

CREATE POLICY "rate_catalog_select" ON rate_catalog
  FOR SELECT TO authenticated
  USING (true);


-- =============================================================
-- rate_catalog_history — read-only, no tenant check (global reference data)
-- =============================================================

CREATE POLICY "rate_catalog_history_select" ON rate_catalog_history
  FOR SELECT TO authenticated
  USING (true);


-- =============================================================
-- vendors — full CRUD within tenant
-- =============================================================

CREATE POLICY "vendors_select" ON vendors
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "vendors_insert" ON vendors
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "vendors_update" ON vendors
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "vendors_delete" ON vendors
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- vendor_invoices — full CRUD within tenant
-- =============================================================

CREATE POLICY "vendor_invoices_select" ON vendor_invoices
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "vendor_invoices_insert" ON vendor_invoices
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "vendor_invoices_update" ON vendor_invoices
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "vendor_invoices_delete" ON vendor_invoices
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- ra_bills — full CRUD within tenant
-- =============================================================

CREATE POLICY "ra_bills_select" ON ra_bills
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_bills_insert" ON ra_bills
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_bills_update" ON ra_bills
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_bills_delete" ON ra_bills
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());


-- =============================================================
-- ra_bill_payments — full CRUD within tenant
-- =============================================================

CREATE POLICY "ra_bill_payments_select" ON ra_bill_payments
  FOR SELECT TO authenticated
  USING (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_bill_payments_insert" ON ra_bill_payments
  FOR INSERT TO authenticated
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_bill_payments_update" ON ra_bill_payments
  FOR UPDATE TO authenticated
  USING (tenant_id = get_user_tenant_id())
  WITH CHECK (tenant_id = get_user_tenant_id());

CREATE POLICY "ra_bill_payments_delete" ON ra_bill_payments
  FOR DELETE TO authenticated
  USING (tenant_id = get_user_tenant_id());
