-- =============================================================
-- 001_core_schema.sql
-- All 22 Quoco tables.
-- BETA columns: active in Phase 1, fully constrained.
-- FUTURE columns: nullable, no constraints, no defaults — activated in Phase 2/3.
-- RLS policies → 002_rls_policies.sql
-- Indexes      → 003_indexes.sql
-- pgvector     → 004_pgvector.sql
-- =============================================================

CREATE EXTENSION IF NOT EXISTS vector;

-- =============================================================
-- CORE (4 tables)
-- =============================================================

CREATE TABLE tenants (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ  DEFAULT now(),
    name                TEXT         NOT NULL,
    slug                TEXT         NOT NULL UNIQUE,
    plan                TEXT         DEFAULT 'trial'
                                         CHECK (plan IN ('trial', 'starter', 'growth', 'pro')),
    trial_ends_at       TIMESTAMPTZ,
    stripe_customer_id  TEXT,
    -- future:
    gstin               TEXT,
    cin                 TEXT,
    registered_address  TEXT,
    pwd_class           TEXT,
    iso_certifications  JSONB,
    annual_turnover     DECIMAL(15,2),
    profile_complete    BOOLEAN
);

CREATE TABLE users (
    id                   UUID         PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at           TIMESTAMPTZ  DEFAULT now(),
    tenant_id            UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    full_name            TEXT,
    avatar_url           TEXT,
    role                 TEXT         NOT NULL
                                          CHECK (role IN ('pm', 'qs', 'engineer', 'subcontractor', 'client', 'admin')),
    whatsapp_number      TEXT         UNIQUE,
    hierarchy_level      INTEGER,
    -- future:
    reporting_manager_id UUID,
    delegation_active    BOOLEAN,
    employee_id          TEXT
);

CREATE TABLE projects (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ  DEFAULT now(),
    tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name              TEXT         NOT NULL,
    status            TEXT         DEFAULT 'active'
                                       CHECK (status IN ('active', 'completed', 'on_hold', 'in_bidding', 'bids_submitted')),
    contract_value    DECIMAL(12,2),
    start_date        DATE,
    expected_end_date DATE,
    created_by        UUID         REFERENCES users(id),
    -- future:
    tender_id         UUID,
    client_name       TEXT,
    client_contact    TEXT,
    site_address      TEXT,
    project_type      TEXT,
    contract_type     TEXT
);

CREATE TABLE project_members (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ  DEFAULT now(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID         NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_id    UUID         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role       TEXT         NOT NULL,
    UNIQUE (project_id, user_id)
);

-- =============================================================
-- POST-CONTRACT / WHATSAPP BOT (5 tables)
-- =============================================================

CREATE TABLE whatsapp_sessions (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ  DEFAULT now(),
    tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id      UUID         REFERENCES users(id),
    phone_number TEXT         NOT NULL,
    current_flow TEXT         CHECK (current_flow IN ('morning', 'evening', 'safety', 'invoice', 'hindrance')),
    current_step INTEGER      DEFAULT 0,
    context      JSONB        DEFAULT '{}',
    expires_at   TIMESTAMPTZ  DEFAULT now() + INTERVAL '30 minutes',
    updated_at   TIMESTAMPTZ  DEFAULT now()
);

CREATE TABLE daily_logs (
    id                               UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at                       TIMESTAMPTZ  DEFAULT now(),
    tenant_id                        UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id                       UUID         NOT NULL REFERENCES projects(id),
    engineer_id                      UUID         NOT NULL REFERENCES users(id),
    log_date                         DATE         NOT NULL DEFAULT CURRENT_DATE,
    morning_plan                     TEXT,
    morning_manpower_planned         JSONB,
    morning_equipment                JSONB,
    morning_execution_plan           TEXT,
    morning_dependencies             TEXT,
    morning_hindrances               TEXT,
    morning_submitted_at             TIMESTAMPTZ,
    evening_output                   TEXT,
    evening_output_quantities        JSONB,
    evening_schedule_met             BOOLEAN,
    evening_schedule_miss_reason     TEXT,
    evening_workers_on_site          INTEGER,
    evening_productive_manpower      JSONB,
    evening_equipment_utilisation    JSONB,
    evening_dependencies_tomorrow    TEXT,
    evening_dependencies_structured  JSONB,
    evening_submitted_at             TIMESTAMPTZ,
    dpr_content                      TEXT,
    dpr_generated_at                 TIMESTAMPTZ,
    -- future:
    morning_submitted_via            TEXT,
    evening_submitted_via            TEXT,
    weather                          TEXT,
    dpr_approved_by                  UUID,
    UNIQUE (project_id, engineer_id, log_date)
);

CREATE TABLE safety_incidents (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ  DEFAULT now(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id      UUID         NOT NULL REFERENCES projects(id),
    reported_by     UUID         NOT NULL REFERENCES users(id),
    incident_type   TEXT,
    location        TEXT,
    description     TEXT,
    injury_status   TEXT,
    photo_url       TEXT,
    ocr_confidence  DECIMAL(5,2),
    pm_notified_at  TIMESTAMPTZ,
    status          TEXT         DEFAULT 'open'
                                     CHECK (status IN ('open', 'acknowledged', 'resolved')),
    submitted_via   TEXT         DEFAULT 'whatsapp',
    -- future:
    resolved_at         TIMESTAMPTZ,
    resolved_by         UUID,
    investigation_notes TEXT
);

CREATE TABLE invoices (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ  DEFAULT now(),
    tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id     UUID         NOT NULL REFERENCES projects(id),
    submitted_by   UUID         NOT NULL REFERENCES users(id),
    vendor_name    TEXT,
    amount         DECIMAL(10,2),
    invoice_date   DATE,
    invoice_number TEXT,
    line_items     JSONB,
    cost_head      TEXT         CHECK (cost_head IN ('materials', 'labour', 'equipment', 'sundry')),
    image_url      TEXT,
    ocr_confidence DECIMAL(5,2),
    submitted_via  TEXT         DEFAULT 'whatsapp',
    status         TEXT         DEFAULT 'pending'
                                    CHECK (status IN ('pending', 'approved', 'rejected')),
    reviewed_by    UUID         REFERENCES users(id),
    reviewed_at    TIMESTAMPTZ,
    -- future:
    vendor_id      UUID,
    gstin_extracted TEXT
);

CREATE TABLE hindrances (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ  DEFAULT now(),
    tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id     UUID         NOT NULL REFERENCES projects(id),
    reported_by    UUID         NOT NULL REFERENCES users(id),
    hindrance_type TEXT         CHECK (hindrance_type IN ('material_delay', 'weather', 'equipment', 'labour', 'design', 'utility', 'other')),
    area_affected  TEXT,
    description    TEXT,
    impact_level   TEXT         CHECK (impact_level IN ('minor', 'moderate', 'major')),
    photo_url      TEXT,
    submitted_via  TEXT         DEFAULT 'whatsapp'
                                    CHECK (submitted_via IN ('whatsapp_scheduled', 'whatsapp_adhoc', 'web_app')),
    dpr_included   BOOLEAN      DEFAULT true,
    status         TEXT         DEFAULT 'open'
                                    CHECK (status IN ('open', 'in_progress', 'resolved')),
    -- future:
    resolved_at TIMESTAMPTZ,
    resolved_by UUID
);

-- =============================================================
-- PRE-CONTRACT (8 tables)
-- tenders created before boq_sessions because boq_sessions.tender_id is BETA
-- =============================================================

CREATE TABLE tenders (
    id                  UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at          TIMESTAMPTZ  DEFAULT now(),
    tenant_id           UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    title               TEXT         NOT NULL,
    client_name         TEXT,
    estimated_value     DECIMAL(12,2),
    submission_deadline DATE,
    status              TEXT         DEFAULT 'draft'
                                         CHECK (status IN ('draft', 'submitted', 'won', 'lost')),
    created_by          UUID         REFERENCES users(id),
    -- future:
    ai_summary          TEXT,
    clarifications      JSONB,
    qualification_flags JSONB
);

CREATE TABLE tender_documents (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ  DEFAULT now(),
    tenant_id     UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tender_id     UUID         NOT NULL REFERENCES tenders(id),
    file_name     TEXT,
    file_url      TEXT,
    file_type     TEXT,
    document_type TEXT         CHECK (document_type IN ('tender', 'boq')),
    -- future:
    processing_status   TEXT,
    vector_chunks_count INTEGER,
    embedding_model     TEXT
);

CREATE TABLE tender_document_chunks (
    id                 UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at         TIMESTAMPTZ  DEFAULT now(),
    tenant_id          UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tender_document_id UUID         NOT NULL REFERENCES tender_documents(id),
    chunk_text         TEXT,
    chunk_index        INTEGER,
    page_number        INTEGER,
    -- future:
    embedding       vector(1536),
    chunk_tsv       tsvector,
    token_count     INTEGER,
    embedding_model TEXT
);

CREATE TABLE tender_chat_sessions (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ  DEFAULT now(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tender_id  UUID         NOT NULL REFERENCES tenders(id),
    user_id    UUID         NOT NULL REFERENCES users(id),
    title      TEXT,
    status     TEXT         DEFAULT 'active'
                                CHECK (status IN ('active', 'archived')),
    -- future:
    system_prompt   TEXT,
    last_message_at TIMESTAMPTZ
);

CREATE TABLE tender_chat_messages (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ  DEFAULT now(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    session_id UUID         NOT NULL REFERENCES tender_chat_sessions(id),
    role       TEXT         NOT NULL CHECK (role IN ('user', 'assistant')),
    content    TEXT,
    -- future:
    retrieved_chunk_ids UUID[],
    citations           JSONB,
    token_count         INTEGER
);

CREATE TABLE boq_sessions (
    id                UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at        TIMESTAMPTZ  DEFAULT now(),
    tenant_id         UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    tender_id         UUID         REFERENCES tenders(id),
    project_id        UUID         REFERENCES projects(id),
    original_file_url TEXT,
    status            TEXT         DEFAULT 'uploading'
                                       CHECK (status IN ('uploading', 'parsing', 'pricing', 'review', 'exported')),
    created_by        UUID         REFERENCES users(id),
    -- future:
    original_columns   JSONB,
    total_items        INTEGER,
    priced_items       INTEGER,
    project_location   TEXT,
    default_margin_pct DECIMAL(5,2)
);

CREATE TABLE boq_items (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ  DEFAULT now(),
    tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    boq_session_id UUID         NOT NULL REFERENCES boq_sessions(id),
    item_code      TEXT,
    description    TEXT,
    unit           TEXT,
    quantity       DECIMAL(12,3),
    final_rate     DECIMAL(10,2),
    amount         DECIMAL(12,2),
    is_approved    BOOLEAN      DEFAULT false,
    -- future:
    original_row_data  JSONB,
    embedding          vector(1536),
    description_tsv    tsvector,
    search_layer_used  INTEGER,
    source_rate        DECIMAL(10,2),
    source_name        TEXT,
    source_date        DATE,
    inflation_pct      DECIMAL(5,2),
    location_pct       DECIMAL(5,2),
    qty_pct            DECIMAL(5,2),
    adjusted_base_rate DECIMAL(10,2),
    margin_pct         DECIMAL(5,2),
    suggested_rate     DECIMAL(10,2),
    pricing_reasoning  TEXT,
    confidence_score   DECIMAL(5,2),
    pricing_status     TEXT
);

CREATE TABLE rate_catalog (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ  DEFAULT now(),
    item_code      TEXT,
    description    TEXT,
    trade_category TEXT,
    unit           TEXT,
    base_rate      DECIMAL(10,2),
    source_name    TEXT,
    effective_date DATE,
    state_code     TEXT,
    is_active      BOOLEAN      DEFAULT true,
    -- future:
    rate_min        DECIMAL(10,2),
    rate_max        DECIMAL(10,2),
    embedding       vector(1536),
    description_tsv tsvector,
    expiry_date     DATE
);

CREATE TABLE rate_catalog_history (
    id            UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at    TIMESTAMPTZ  DEFAULT now(),
    catalog_id    UUID         NOT NULL REFERENCES rate_catalog(id),
    recorded_rate DECIMAL(10,2),
    recorded_date DATE,
    -- future:
    location   TEXT,
    source_url TEXT,
    notes      TEXT
);

-- =============================================================
-- FINANCIAL (4 tables)
-- =============================================================

CREATE TABLE vendors (
    id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at     TIMESTAMPTZ  DEFAULT now(),
    tenant_id      UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    name           TEXT         NOT NULL,
    trade_category TEXT,
    phone          TEXT,
    status         TEXT         DEFAULT 'active'
                                    CHECK (status IN ('active', 'inactive')),
    -- future:
    gstin              TEXT,
    email              TEXT,
    bank_details       JSONB,
    auto_extracted     BOOLEAN,
    needs_verification BOOLEAN,
    rating             INTEGER
);

CREATE TABLE vendor_invoices (
    id         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ  DEFAULT now(),
    tenant_id  UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id UUID         NOT NULL REFERENCES projects(id),
    vendor_id  UUID         NOT NULL REFERENCES vendors(id),
    amount     DECIMAL(12,2),
    status     TEXT         DEFAULT 'pending'
                                CHECK (status IN ('pending', 'approved', 'paid')),
    -- future:
    invoice_number TEXT,
    invoice_date   DATE,
    due_date       DATE,
    payment_date   DATE,
    notes          TEXT
);

CREATE TABLE ra_bills (
    id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at   TIMESTAMPTZ  DEFAULT now(),
    tenant_id    UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    project_id   UUID         NOT NULL REFERENCES projects(id),
    bill_number  TEXT,
    gross_amount DECIMAL(12,2),
    net_payable  DECIMAL(12,2),
    status       TEXT         DEFAULT 'draft'
                                  CHECK (status IN ('draft', 'submitted', 'approved', 'paid')),
    -- future:
    period_from          DATE,
    period_to            DATE,
    retention_deduction  DECIMAL(12,2),
    advance_recovery     DECIMAL(12,2),
    submitted_at         TIMESTAMPTZ,
    approved_at          TIMESTAMPTZ
);

CREATE TABLE ra_bill_payments (
    id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      TIMESTAMPTZ  DEFAULT now(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    ra_bill_id      UUID         NOT NULL REFERENCES ra_bills(id),
    amount_received DECIMAL(12,2),
    payment_date    DATE,
    -- future:
    payment_reference TEXT,
    notes             TEXT
);
