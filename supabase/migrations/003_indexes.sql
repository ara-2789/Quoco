-- =============================================================
-- 003_indexes.sql
-- Performance indexes for all tenant-scoped tables.
-- Indexes use IF NOT EXISTS; safe to re-run.
-- =============================================================

-- -------------------------------------------------------------
-- tenant_id  (every tenant-scoped table)
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_tenant_id                   ON users(tenant_id);
CREATE INDEX IF NOT EXISTS idx_projects_tenant_id                ON projects(tenant_id);
CREATE INDEX IF NOT EXISTS idx_project_members_tenant_id         ON project_members(tenant_id);
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_tenant_id       ON whatsapp_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_tenant_id              ON daily_logs(tenant_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_tenant_id        ON safety_incidents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_invoices_tenant_id                ON invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_hindrances_tenant_id              ON hindrances(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenders_tenant_id                 ON tenders(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tender_documents_tenant_id        ON tender_documents(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tender_document_chunks_tenant_id  ON tender_document_chunks(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tender_chat_sessions_tenant_id    ON tender_chat_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tender_chat_messages_tenant_id    ON tender_chat_messages(tenant_id);
CREATE INDEX IF NOT EXISTS idx_boq_sessions_tenant_id            ON boq_sessions(tenant_id);
CREATE INDEX IF NOT EXISTS idx_boq_items_tenant_id               ON boq_items(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendors_tenant_id                 ON vendors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_tenant_id         ON vendor_invoices(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_tenant_id                ON ra_bills(tenant_id);
CREATE INDEX IF NOT EXISTS idx_ra_bill_payments_tenant_id        ON ra_bill_payments(tenant_id);

-- -------------------------------------------------------------
-- project_id
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_project_members_project_id  ON project_members(project_id);
CREATE INDEX IF NOT EXISTS idx_daily_logs_project_id        ON daily_logs(project_id);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_project_id  ON safety_incidents(project_id);
CREATE INDEX IF NOT EXISTS idx_invoices_project_id          ON invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_hindrances_project_id        ON hindrances(project_id);
CREATE INDEX IF NOT EXISTS idx_vendor_invoices_project_id   ON vendor_invoices(project_id);
CREATE INDEX IF NOT EXISTS idx_ra_bills_project_id          ON ra_bills(project_id);
CREATE INDEX IF NOT EXISTS idx_boq_sessions_project_id      ON boq_sessions(project_id);

-- boq_items and ra_bill_payments join to their parent, not project directly
CREATE INDEX IF NOT EXISTS idx_boq_items_boq_session_id      ON boq_items(boq_session_id);
CREATE INDEX IF NOT EXISTS idx_ra_bill_payments_ra_bill_id   ON ra_bill_payments(ra_bill_id);

-- -------------------------------------------------------------
-- whatsapp_sessions — looked up by phone on every inbound message
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_whatsapp_sessions_phone_number ON whatsapp_sessions(phone_number);

-- -------------------------------------------------------------
-- daily_logs
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_daily_logs_log_date    ON daily_logs(log_date);
CREATE INDEX IF NOT EXISTS idx_daily_logs_engineer_id ON daily_logs(engineer_id);

-- -------------------------------------------------------------
-- status columns
-- -------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_invoices_status         ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_safety_incidents_status ON safety_incidents(status);
CREATE INDEX IF NOT EXISTS idx_hindrances_status       ON hindrances(status);
