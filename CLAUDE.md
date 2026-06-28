# QUOCO — Claude Code Instructions
# Read this file at the start of every session before writing any code.
# Last updated: June 2026

---

## 1. WHAT IS QUOCO

Quoco is a multi-tenant SaaS platform for construction contractors in India. It covers the full project lifecycle — from pre-contract tendering through to post-contract delivery.

**The product has two modules:**

PRE-CONTRACT
- Tender Analyser: contractor uploads a tender document, chats with it via AI to understand scope, qualifications needed, and clarifications required
- BOQ Estimator: contractor uploads a blank BOQ file, Quoco prices every line item using a 3-layer search (contractor history → Quoco rate catalog → LLM) and outputs rates with margin and reasoning

POST-CONTRACT (Phase 1 — build this first)
- WhatsApp bot: site engineers submit morning and evening check-ins via WhatsApp. Claude generates a Daily Progress Report (DPR) sent to the PM and Owner every evening.
- PM web dashboard: Project Manager sees all site activity, daily logs, safety incidents, invoice queue, hindrance tracker, DPR archive
- Ad-hoc bot flows: engineers can report safety incidents, upload expense invoices (photo/receipt), and log hindrances at any time via WhatsApp

---

## 2. TECH STACK

- Framework: Next.js 16 App Router with TypeScript — use App Router conventions throughout
- Database: Supabase (PostgreSQL) — auth, DB, storage, pgvector (enabled, nullable columns for now)
- Auth: Supabase Auth — magic link only, no passwords
- File storage: Supabase Storage — tender documents, invoice photos, site photos
- AI: Claude API (claude-sonnet-4-6) — DPR generation, OCR, tender analysis, BOQ pricing
- WhatsApp: Twilio WhatsApp Business API — webhook at /api/whatsapp/webhook
- Billing: Stripe — per-project subscription pricing
- Deployment: Vercel
- Email: Resend — DPR delivery, notifications, invites
- Monitoring: Sentry
- UI: Tailwind CSS + shadcn/ui components
- Vector search: pgvector extension (enabled in Supabase, columns nullable until Phase 2)

---

## 3. MULTI-TENANCY RULES — CRITICAL

Every construction company that subscribes to Quoco is a TENANT. These rules are non-negotiable:

- Every database table MUST have a tenant_id UUID column (except rate_catalog and rate_catalog_history which are Quoco-owned and shared across all tenants)
- NEVER query the database without filtering by tenant_id
- Use tenant_id — NOT organization_id, NOT org_id, NOT company_id
- RLS enforced at DB layer using get_user_tenant_id() helper function — never rely on app-layer filtering alone
- Use Supabase SSR client in server components and API routes — NEVER the browser client on the server
- NEVER use the service role key client-side or in any route accessible without authentication
- All RLS policies must verify tenant membership through auth.uid() — not by checking tenant_id directly

---

## 4. CODING RULES

**TypeScript**
- TypeScript always — no 'any' types under any circumstances
- All database types must match the schema exactly
- Generate types from schema — do not hand-write them

**Money columns**
- Every amount, rate, cost, value column: DECIMAL(12,2) — no exceptions
- Never use TEXT or FLOAT for money — this cannot be changed after real data enters the system

**Status columns**
- Always TEXT with CHECK constraints — never ENUM types
- Example: status TEXT CHECK (status IN ('active', 'completed', 'on_hold'))
- Adding a new status value later only requires updating the CHECK constraint

**Database**
- All migrations in supabase/migrations/ as numbered files: 001_core_schema.sql, 002_rls_policies.sql etc.
- Never edit the schema directly in Supabase dashboard — always use migration files
- Every table needs: id UUID PRIMARY KEY DEFAULT gen_random_uuid(), created_at TIMESTAMPTZ DEFAULT now()
- Indexes on tenant_id for every table, plus specific indexes listed in schema section

**API routes**
- All routes under /api/ require authentication — no unauthenticated data access
- Validate all inputs with Zod before processing
- WhatsApp webhook at /api/whatsapp/webhook — must respond within 15 seconds (Twilio timeout)
- Claude API calls that take longer than 15 seconds must be queued — never called synchronously in the webhook handler

**Errors**
- Always wrap API calls in try/catch
- Return structured error responses — never expose raw database errors
- Log errors to Sentry in production

**Session management**
- WhatsApp conversation state stored in Supabase whatsapp_sessions table — NEVER in memory
- Serverless functions have no persistent memory — all state must be in the database
- Sessions expire after 30 minutes of inactivity

**One feature per Claude Code session**
- Never ask Claude Code to build multiple features in one prompt
- Plan first — list files to be touched and approach — wait for confirmation before coding
- Use /clear between every task to keep context clean
- Commit after every working feature before starting the next

---

## 5. USER ROLES

Six roles in Quoco — stored as TEXT on the users table:

- pm — Project Manager: full project visibility, dashboard, approvals, DPR review
- qs — Quantity Surveyor: BOQ, cost tracking, invoice approval, tender module
- engineer — Site Engineer: WhatsApp bot user, daily check-ins, ad-hoc reports
- subcontractor — Subcontractor: limited portal, WhatsApp updates
- client — Client/Owner: read-only dashboard, receives DPR
- admin — Admin/Back Office: user management, billing, settings

Role hierarchy level (for escalation logic):
- admin = 1, pm = 2, qs = 3, engineer = 4, subcontractor = 5, client = 6
- If an engineer misses evening submission by 7 PM, their reporting_manager_id receives a notification

---

## 6. DATABASE SCHEMA — 22 TABLES

Build all 22 tables in migration 001. Beta columns active. Future columns nullable with no constraints.
RLS on all 22 tables in migration 002 — written once, never changed.

### COLOUR CODE
- BETA = column is active and used in Phase 1
- FUTURE = column exists as nullable, populated in Phase 2 or 3

---

### CORE (4 tables)

**01. tenants**
- id, created_at
- name TEXT NOT NULL (BETA)
- slug TEXT UNIQUE NOT NULL (BETA)
- plan TEXT DEFAULT 'trial' CHECK (plan IN ('trial','starter','growth','pro')) (BETA)
- trial_ends_at TIMESTAMPTZ (BETA)
- stripe_customer_id TEXT (BETA)
- gstin TEXT (FUTURE)
- cin TEXT (FUTURE)
- registered_address TEXT (FUTURE)
- pwd_class TEXT (FUTURE)
- iso_certifications JSONB (FUTURE)
- annual_turnover DECIMAL(15,2) (FUTURE)
- profile_complete BOOLEAN DEFAULT false (FUTURE)

**02. users**
- id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE
- created_at
- tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE (BETA)
- full_name TEXT (BETA)
- avatar_url TEXT (BETA)
- role TEXT NOT NULL CHECK (role IN ('pm','qs','engineer','subcontractor','client','admin')) (BETA)
- whatsapp_number TEXT UNIQUE (BETA)
- hierarchy_level INTEGER (BETA) -- 1=admin, 2=pm, 3=qs, 4=engineer, 5=subcontractor, 6=client
- reporting_manager_id UUID REFERENCES users(id) (FUTURE)
- delegation_active BOOLEAN DEFAULT false (FUTURE)
- employee_id TEXT (FUTURE)

**03. projects**
- id, created_at
- tenant_id (BETA)
- name TEXT NOT NULL (BETA)
- status TEXT DEFAULT 'active' CHECK (status IN ('active','completed','on_hold','in_bidding','bids_submitted')) (BETA)
- contract_value DECIMAL(12,2) (BETA)
- start_date DATE (BETA)
- expected_end_date DATE (BETA)
- created_by UUID REFERENCES users(id) (BETA)
- tender_id UUID REFERENCES tenders(id) (FUTURE) -- nullable, set when project created from a won tender
- client_name TEXT (FUTURE)
- client_contact TEXT (FUTURE)
- site_address TEXT (FUTURE)
- project_type TEXT (FUTURE) -- residential, commercial, infrastructure, industrial
- contract_type TEXT (FUTURE) -- lump_sum, item_rate, epc, turnkey

**04. project_members**
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE (BETA)
- user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE (BETA)
- role TEXT NOT NULL (BETA)
- UNIQUE(project_id, user_id)

---

### WHATSAPP BOT / POST-CONTRACT (5 tables) — ALL ACTIVE IN PHASE 1

**05. whatsapp_sessions**
- id, created_at
- tenant_id (BETA)
- user_id UUID REFERENCES users(id) (BETA)
- phone_number TEXT NOT NULL (BETA)
- current_flow TEXT CHECK (current_flow IN ('morning','evening','safety','invoice','hindrance')) (BETA)
- current_step INTEGER DEFAULT 0 (BETA)
- context JSONB DEFAULT '{}' (BETA) -- all answers collected so far
- expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '30 minutes' (BETA)
- updated_at TIMESTAMPTZ DEFAULT now() (BETA)
- INDEX on phone_number

**06. daily_logs**
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- engineer_id UUID NOT NULL REFERENCES users(id) (BETA)
- log_date DATE NOT NULL DEFAULT CURRENT_DATE (BETA)
- morning_plan TEXT (BETA)
- morning_manpower_planned JSONB (BETA) -- [{trade, planned_count}]
- morning_equipment JSONB (BETA) -- [{type, count, owned_or_hired, daily_hire_cost}]
- morning_execution_plan TEXT (BETA)
- morning_dependencies TEXT (BETA)
- morning_hindrances TEXT (BETA)
- morning_submitted_at TIMESTAMPTZ (BETA)
- evening_output TEXT (BETA)
- evening_output_quantities JSONB (BETA) -- [{activity, quantity, unit}]
- evening_schedule_met BOOLEAN (BETA)
- evening_schedule_miss_reason TEXT (BETA)
- evening_workers_on_site INTEGER (BETA)
- evening_productive_manpower JSONB (BETA) -- [{trade, on_site, productive, idle_reason}]
- evening_equipment_utilisation JSONB (BETA) -- [{type, available_hours, actual_hours, idle_reason}]
- evening_dependencies_tomorrow TEXT (BETA)
- evening_dependencies_structured JSONB (BETA) -- [{item, quantity, unit, required_by_time}]
- evening_submitted_at TIMESTAMPTZ (BETA)
- dpr_content TEXT (BETA) -- full DPR text generated by Claude
- dpr_generated_at TIMESTAMPTZ (BETA)
- morning_submitted_via TEXT (FUTURE) -- whatsapp, web_app
- evening_submitted_via TEXT (FUTURE)
- weather TEXT (FUTURE)
- dpr_approved_by UUID REFERENCES users(id) (FUTURE)
- UNIQUE(project_id, engineer_id, log_date)
- INDEX on (project_id, log_date)

**07. safety_incidents**
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- reported_by UUID NOT NULL REFERENCES users(id) (BETA)
- incident_type TEXT (BETA)
- location TEXT (BETA)
- description TEXT (BETA)
- injury_status TEXT (BETA)
- photo_url TEXT (BETA)
- ocr_confidence DECIMAL(5,2) (BETA)
- pm_notified_at TIMESTAMPTZ (BETA)
- status TEXT DEFAULT 'open' CHECK (status IN ('open','acknowledged','resolved')) (BETA)
- submitted_via TEXT DEFAULT 'whatsapp' (BETA)
- resolved_at TIMESTAMPTZ (FUTURE)
- resolved_by UUID REFERENCES users(id) (FUTURE)
- investigation_notes TEXT (FUTURE)

**08. invoices** -- petty cash / site expenses submitted via WhatsApp bot
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- submitted_by UUID NOT NULL REFERENCES users(id) (BETA)
- vendor_name TEXT (BETA)
- amount DECIMAL(10,2) (BETA)
- invoice_date DATE (BETA)
- invoice_number TEXT (BETA)
- line_items JSONB (BETA)
- cost_head TEXT CHECK (cost_head IN ('materials','labour','equipment','sundry')) (BETA)
- image_url TEXT (BETA)
- ocr_confidence DECIMAL(5,2) (BETA)
- submitted_via TEXT DEFAULT 'whatsapp' (BETA)
- status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')) (BETA)
- reviewed_by UUID REFERENCES users(id) (BETA)
- reviewed_at TIMESTAMPTZ (BETA)
- vendor_id UUID (FUTURE) -- REFERENCES vendors(id) — populated when vendor module active
- gstin_extracted TEXT (FUTURE)

**09. hindrances**
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- reported_by UUID NOT NULL REFERENCES users(id) (BETA)
- hindrance_type TEXT CHECK (hindrance_type IN ('material_delay','weather','equipment','labour','design','utility','other')) (BETA)
- area_affected TEXT (BETA)
- description TEXT (BETA)
- impact_level TEXT CHECK (impact_level IN ('minor','moderate','major')) (BETA)
- photo_url TEXT (BETA)
- submitted_via TEXT DEFAULT 'whatsapp' CHECK (submitted_via IN ('whatsapp_scheduled','whatsapp_adhoc','web_app')) (BETA)
- dpr_included BOOLEAN DEFAULT true (BETA)
- status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','resolved')) (BETA)
- resolved_at TIMESTAMPTZ (FUTURE)
- resolved_by UUID REFERENCES users(id) (FUTURE)

---

### PRE-CONTRACT (8 tables) — SKELETON IN PHASE 1, ACTIVATE PHASE 2

**10. tenders**
- id, created_at
- tenant_id (BETA)
- title TEXT NOT NULL (BETA)
- client_name TEXT (BETA)
- estimated_value DECIMAL(12,2) (BETA)
- submission_deadline DATE (BETA)
- status TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','won','lost')) (BETA)
- created_by UUID REFERENCES users(id) (BETA)
- ai_summary TEXT (FUTURE)
- clarifications JSONB (FUTURE)
- qualification_flags JSONB (FUTURE)

**11. tender_documents**
- id, created_at
- tenant_id (BETA)
- tender_id UUID NOT NULL REFERENCES tenders(id) (BETA)
- file_name TEXT (BETA)
- file_url TEXT (BETA)
- file_type TEXT (BETA) -- pdf, docx, xlsx
- document_type TEXT CHECK (document_type IN ('tender','boq')) (BETA)
- processing_status TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending','processing','done','failed')) (FUTURE)
- vector_chunks_count INTEGER (FUTURE)
- embedding_model TEXT (FUTURE)

**12. tender_document_chunks** -- RAG backbone, shared by chatbot and BOQ estimator
- id, created_at
- tenant_id (BETA)
- tender_document_id UUID NOT NULL REFERENCES tender_documents(id) (BETA)
- chunk_text TEXT (BETA)
- chunk_index INTEGER (BETA)
- page_number INTEGER (BETA)
- embedding vector(1536) (FUTURE) -- nullable, populated Phase 2
- chunk_tsv tsvector (FUTURE) -- keyword search index
- token_count INTEGER (FUTURE)
- embedding_model TEXT (FUTURE)

**13. tender_chat_sessions**
- id, created_at
- tenant_id (BETA)
- tender_id UUID NOT NULL REFERENCES tenders(id) (BETA)
- user_id UUID NOT NULL REFERENCES users(id) (BETA)
- title TEXT (BETA)
- status TEXT DEFAULT 'active' CHECK (status IN ('active','archived')) (BETA)
- system_prompt TEXT (FUTURE)
- last_message_at TIMESTAMPTZ (FUTURE)

**14. tender_chat_messages**
- id, created_at
- tenant_id (BETA)
- session_id UUID NOT NULL REFERENCES tender_chat_sessions(id) (BETA)
- role TEXT NOT NULL CHECK (role IN ('user','assistant')) (BETA)
- content TEXT (BETA)
- retrieved_chunk_ids UUID[] (FUTURE)
- citations JSONB (FUTURE)
- token_count INTEGER (FUTURE)

**15. boq_sessions**
- id, created_at
- tenant_id (BETA)
- tender_id UUID REFERENCES tenders(id) (BETA)
- project_id UUID REFERENCES projects(id) (BETA)
- original_file_url TEXT (BETA)
- status TEXT DEFAULT 'uploading' CHECK (status IN ('uploading','parsing','pricing','review','exported')) (BETA)
- created_by UUID REFERENCES users(id) (BETA)
- original_columns JSONB (FUTURE)
- total_items INTEGER (FUTURE)
- priced_items INTEGER (FUTURE)
- project_location TEXT (FUTURE)
- default_margin_pct DECIMAL(5,2) (FUTURE)

**16. boq_items**
- id, created_at
- tenant_id (BETA)
- boq_session_id UUID NOT NULL REFERENCES boq_sessions(id) (BETA)
- item_code TEXT (BETA)
- description TEXT (BETA)
- unit TEXT (BETA)
- quantity DECIMAL(12,3) (BETA)
- final_rate DECIMAL(10,2) (BETA) -- QS approved rate
- amount DECIMAL(12,2) (BETA)
- is_approved BOOLEAN DEFAULT false (BETA)
- original_row_data JSONB (FUTURE)
- embedding vector(1536) (FUTURE) -- for hybrid search
- description_tsv tsvector (FUTURE)
- search_layer_used INTEGER (FUTURE) -- 1, 2, or 3
- source_rate DECIMAL(10,2) (FUTURE)
- source_name TEXT (FUTURE)
- source_date DATE (FUTURE)
- inflation_pct DECIMAL(5,2) (FUTURE)
- location_pct DECIMAL(5,2) (FUTURE)
- qty_pct DECIMAL(5,2) (FUTURE)
- adjusted_base_rate DECIMAL(10,2) (FUTURE)
- margin_pct DECIMAL(5,2) (FUTURE)
- suggested_rate DECIMAL(10,2) (FUTURE)
- pricing_reasoning TEXT (FUTURE)
- confidence_score DECIMAL(5,2) (FUTURE)
- pricing_status TEXT DEFAULT 'pending' (FUTURE)

**17. rate_catalog** -- NO tenant_id — Quoco-owned, shared across all tenants
- id, created_at
- item_code TEXT (BETA)
- description TEXT (BETA)
- trade_category TEXT (BETA)
- unit TEXT (BETA)
- base_rate DECIMAL(10,2) (BETA)
- source_name TEXT (BETA) -- DSR 2024, CPWD, PWD-TN etc.
- effective_date DATE (BETA)
- state_code TEXT (BETA)
- is_active BOOLEAN DEFAULT true (BETA)
- rate_min DECIMAL(10,2) (FUTURE)
- rate_max DECIMAL(10,2) (FUTURE)
- embedding vector(1536) (FUTURE)
- description_tsv tsvector (FUTURE)
- expiry_date DATE (FUTURE)

**18. rate_catalog_history** -- price history per catalog item
- id, created_at
- catalog_id UUID NOT NULL REFERENCES rate_catalog(id) (BETA)
- recorded_rate DECIMAL(10,2) (BETA)
- recorded_date DATE (BETA)
- location TEXT (FUTURE)
- source_url TEXT (FUTURE)
- notes TEXT (FUTURE)

---

### FINANCIAL (4 tables) — SKELETON IN PHASE 1, ACTIVATE PHASE 3

**19. vendors**
- id, created_at
- tenant_id (BETA)
- name TEXT NOT NULL (BETA)
- trade_category TEXT (BETA)
- phone TEXT (BETA)
- status TEXT DEFAULT 'active' CHECK (status IN ('active','inactive')) (BETA)
- gstin TEXT (FUTURE)
- email TEXT (FUTURE)
- bank_details JSONB (FUTURE)
- auto_extracted BOOLEAN DEFAULT false (FUTURE)
- needs_verification BOOLEAN DEFAULT false (FUTURE)
- rating INTEGER (FUTURE)

**20. vendor_invoices**
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- vendor_id UUID NOT NULL REFERENCES vendors(id) (BETA)
- amount DECIMAL(12,2) (BETA)
- status TEXT DEFAULT 'pending' CHECK (status IN ('pending','approved','paid')) (BETA)
- invoice_number TEXT (FUTURE)
- invoice_date DATE (FUTURE)
- due_date DATE (FUTURE)
- payment_date DATE (FUTURE)
- notes TEXT (FUTURE)

**21. ra_bills** -- Running Account Bills raised by contractor to client
- id, created_at
- tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- bill_number TEXT (BETA)
- gross_amount DECIMAL(12,2) (BETA)
- net_payable DECIMAL(12,2) (BETA)
- status TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','paid')) (BETA)
- period_from DATE (FUTURE)
- period_to DATE (FUTURE)
- retention_deduction DECIMAL(12,2) (FUTURE)
- advance_recovery DECIMAL(12,2) (FUTURE)
- submitted_at TIMESTAMPTZ (FUTURE)
- approved_at TIMESTAMPTZ (FUTURE)

**22. ra_bill_payments** -- payments received from client against each RA Bill
- id, created_at
- tenant_id (BETA)
- ra_bill_id UUID NOT NULL REFERENCES ra_bills(id) (BETA)
- amount_received DECIMAL(12,2) (BETA)
- payment_date DATE (BETA)
- payment_reference TEXT (FUTURE)
- notes TEXT (FUTURE)

---

## 7. RLS POLICY PATTERN

Use this helper function in migration 002 — write it first:

```sql
CREATE OR REPLACE FUNCTION get_user_tenant_id()
RETURNS UUID AS $$
  SELECT tenant_id FROM public.users WHERE id = auth.uid()
$$ LANGUAGE SQL SECURITY DEFINER STABLE;
```

Standard policy pattern for every tenant-scoped table:
```sql
ALTER TABLE [table_name] ENABLE ROW LEVEL SECURITY;
CREATE POLICY "tenant_isolation" ON [table_name]
  USING (tenant_id = get_user_tenant_id());
```

rate_catalog and rate_catalog_history have no tenant_id — use read-only policy:
```sql
CREATE POLICY "read_only" ON rate_catalog FOR SELECT USING (true);
```

---

## 8. WHATSAPP BOT — PHASE 1 FLOWS

### Scheduled flows
- Morning: 7:30 AM trigger (configurable per project) — 6 questions, one at a time
- Evening: 6:30 PM trigger (configurable per project) — 6 questions, one at a time
- Missed morning: follow-up nudge at 9:00 AM — one nudge only
- Missed evening: follow-up nudge at 7:30 PM. DPR generated at 8:00 PM with available data. Missing fields named explicitly.

### Morning questions (v2)
Q1: Plan of action for today (free text)
Q2: Workers planned by trade — format: Trade — count
Q3: Equipment on site + hire rate — format: Equipment — owned/hired — ₹rate/day
Q4: Execution method/sequence (free text)
Q5: Procurement dependencies — any materials/support awaited today
Q6: Site blockers — access, equipment, safety issues right now

### Evening questions (v2) — photos encouraged
Q1: Work completed today with quantity/area — format: Activity — quantity done [photo optional]
Q2: Plan met? Yes or No
Q3: Reason if No (conditional — skip if Yes) [photo optional for site conditions]
Q4: Workers on site + productivity — format: X on site. All productive / Y idle — reason [photo if idle]
Q5: Equipment hours — bot echoes back morning equipment list by name, pre-fills format [photo if idle/broken]
Q6: Tomorrow's dependencies — format: Item — quantity — by what time

### Ad-hoc flows (engineer-initiated)
Bot shows menu: 1) Safety incident  2) Site expense/invoice  3) Execution hindrance
- Safety: photo/text → Claude OCR → confirm fields → save → PM notified immediately
- Invoice: receipt photo → Claude Vision OCR → confirm vendor/amount/date → cost head selection → save for QS review
- Hindrance: photo/text → classify type and severity → save → pulled into evening DPR

### Key bot rules
- One question per message — never bundle multiple questions in one WhatsApp message
- Bot echoes back context from morning when asking evening questions
- Format hints shown with every structured question — always include an example
- Session state in whatsapp_sessions table — never in memory
- Twilio webhook must respond within 15 seconds — queue Claude API calls separately
- Handle Twilio retries — implement idempotency on webhook
- Unregistered phone numbers: "This number is not registered with Quoco. Contact your PM."

---

## 9. DPR GENERATION

DPR generated by Claude API after evening check-in is saved (or at 8 PM if not submitted).

### Prompt context to include:
- Morning inputs (all 6 questions)
- Evening inputs (all 6 questions)
- Any ad-hoc safety/hindrance/invoice reports from that day
- Yesterday's DPR for continuity
- Project details (name, contract value, start date)

### DPR sections:
1. Execution Output — what was done, with quantities
2. Schedule vs Plan — planned vs actual, % completion, variance
3. Manpower and Resource Utilisation — headcount, productivity %, idle reasons
4. Equipment Utilisation — hours run per machine, utilisation %, idle cost in ₹
5. Hindrances and Blockers — active hindrances with impact level
6. Dependencies — open dependencies + tomorrow's requirements
7. Red Flags — AI-identified risks with severity (CRITICAL/WATCH/NOTE)
8. Recommendations — specific actionable steps to resolve red flags
9. Tomorrow's Plan Preview — engineer's stated plan + dependencies

### DPR robustness rules:
- Generate a useful DPR even from incomplete or inconsistently formatted inputs
- Extract information from free-text even when format was not followed
- If a field is missing, note it as "Not submitted — [Name], Site Engineer" — never leave blank
- Named attribution for missing submissions — accountability must be explicit

### DPR delivery:
- PM receives for review first
- Auto-sends to Owner at 9 PM unless PM disables
- Owner gets WhatsApp summary + email with full PDF

---

## 10. PHASE 1 SCOPE — BUILD THIS, NOTHING ELSE

### Active in Phase 1 (build and ship):
- Company signup and tenant onboarding
- Admin user invite flow
- 6 RBAC roles
- Project creation and team member management
- WhatsApp number registration per user
- WhatsApp morning bot flow (6 questions)
- WhatsApp evening bot flow (6 questions)
- WhatsApp ad-hoc flows: safety, invoice, hindrance
- Claude DPR generation
- DPR delivery via WhatsApp + email (Resend)
- PM web dashboard: daily log view, safety log, invoice approval queue, hindrance tracker, DPR archive
- Stripe billing: subscription checkout, 14-day trial, webhook handling

### Explicitly deferred — do not build in Phase 1:
- Tender chatbot and BOQ estimator (Phase 2)
- RA Bills and vendor invoices (Phase 3)
- Schedule / Gantt chart (Phase 3)
- Client portal login (Phase 2)
- Role hierarchy escalation logic (Phase 2)
- Native mobile app (Phase 3)
- Rate catalog population (Phase 2)
- pgvector / hybrid search (Phase 2)

### Phase 1 complete when:
- All 3 beta companies have engineers submitting morning + evening check-ins for 14 consecutive days
- DPR delivered to owners every evening automatically
- Evening completion rate above 70% without founder intervention
- All 3 companies are paying via Stripe

---

## 11. FILE AND FOLDER STRUCTURE

```
quoco/
├── CLAUDE.md                    ← this file
├── app/
│   ├── (auth)/
│   │   ├── login/page.tsx
│   │   └── auth/callback/route.ts
│   ├── (dashboard)/
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx
│   │   ├── projects/page.tsx
│   │   ├── daily-logs/page.tsx
│   │   ├── safety/page.tsx
│   │   ├── invoices/page.tsx
│   │   └── hindrances/page.tsx
│   └── api/
│       ├── whatsapp/webhook/route.ts
│       ├── dpr/generate/route.ts
│       └── auth/route.ts
├── lib/
│   ├── supabase/
│   │   ├── client.ts
│   │   └── server.ts
│   └── whatsapp/
│       ├── flows/
│       │   ├── morning.ts
│       │   ├── evening.ts
│       │   ├── safety.ts
│       │   ├── invoice.ts
│       │   └── hindrance.ts
│       └── session.ts
├── supabase/
│   └── migrations/
│       ├── 001_core_schema.sql
│       ├── 002_rls_policies.sql
│       ├── 003_indexes.sql
│       └── 004_pgvector.sql
├── types/
│   └── database.ts
└── proxy.ts                     ← Next.js 16 middleware (not middleware.ts)
```

---

## 12. ENVIRONMENT VARIABLES

Required in .env.local — never commit this file:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      ← server-side only, never expose to client
ANTHROPIC_API_KEY=              ← server-side only
TWILIO_ACCOUNT_SID=             ← server-side only
TWILIO_AUTH_TOKEN=              ← server-side only
TWILIO_WHATSAPP_NUMBER=         ← e.g. whatsapp:+14155238886
RESEND_API_KEY=                 ← server-side only
STRIPE_SECRET_KEY=              ← server-side only
STRIPE_WEBHOOK_SECRET=          ← server-side only
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
SENTRY_DSN=
```

NEXT_PUBLIC_ prefix only for values that are truly safe to expose in the browser.
All other keys must only be used in server-side API routes.

---

## 13. CURRENT BUILD STATUS

Phase 0: COMPLETE — manual DPR validated, 5 days of field data collected
Phase 1: STARTING NOW

Completed so far:
- Next.js 16 project created
- Supabase client configured (lib/supabase/client.ts, lib/supabase/server.ts, proxy.ts)
- .env.local configured with Supabase URL and anon key
- GitHub repo: github.com/ara-2789/Quoco
- Bot questions finalised at v2 (morning 6Q + evening 6Q with photo prompts)

Next task: Create supabase/migrations/001_core_schema.sql with all 22 tables
