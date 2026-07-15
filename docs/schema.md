# QUOCO — Database Schema Reference
# Read this when a task touches the schema, a migration, or DB types.
# Core rules are in CLAUDE.md; this is the detailed reference.

Migrations 001–005 are LIVE. The authoritative POST-migration state is below.
Column notes: (BETA) = active Phase 1. (FUTURE) = nullable, no constraints,
Phase 2/3 only. (FAST-FOLLOW) = Phase 1 but not Spine.

>>> PASS-1 BLOCKER — READ THIS (added 2026-07-07):
>>> The WhatsApp morning check-in flow (Pass 1: webhook + apply_morning_flow_turn
>>> / migration 014, code-complete and test-verified as of 2026-07-07) CANNOT
>>> SERVE A REAL ENGINEER YET. Reason: public.users.id still has a FK to
>>> auth.users(id) (constraint users_id_fkey). Migration 007 (the auth surgery)
>>> is what DROPS that FK so a users row can exist with auth_id = NULL and a
>>> standalone id — which is exactly ENG-01's model (PM creates an engineer from
>>> name + phone only, no email, no auth.users entry). 007 is NOT applied (blocked
>>> at Checkpoint 1). Until 007 ships, no real engineer/owner row can be created,
>>> so the bot logic works but NOBODY REAL CAN USE IT. This makes 007 a HARD
>>> PREREQUISITE for Pass 1 to matter in practice, not just an eventual cleanup.
>>> (The morning-flow integration tests sidestep this by creating their engineer
>>> via supabase.auth.admin.createUser(), which is a test-only crutch, not the
>>> production ENG-01 path.)
>>> NOTE: line ~56 below says "Migration 006 decouples users.id" — that conflicts
>>> with CLAUDE.md §5/§10, which assign the decouple to 007 (auth surgery). The
>>> observed FK (users_id_fkey still present on prod + branch) confirms it is NOT
>>> yet decoupled; treat 007 as the decoupling migration. Reconcile this line when
>>> 007 is authored.

---

## RLS POLICY PATTERN

Helper function (in migration 002 — must exist before any policy):

    CREATE OR REPLACE FUNCTION get_user_tenant_id()
    RETURNS UUID AS $$
      SELECT tenant_id FROM public.users WHERE auth_id = auth.uid()
    $$ LANGUAGE SQL SECURITY DEFINER STABLE SET search_path = public;

    -- NOTE: matches on auth_id = auth.uid(), NOT id = auth.uid().
    -- After migration 006, users.id is a standalone PK and auth_id is the
    -- link to auth.users. Every RLS policy depends on this function.

Standard policy for every tenant-scoped table:

    ALTER TABLE [table] ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "tenant_isolation" ON [table]
      USING (tenant_id = get_user_tenant_id());

- Webhook route uses the service role key (bypasses RLS) — protected by
  X-Twilio-Signature HMAC. Never expose the service role key to the client.
- Cross-project isolation: DASH-10 and DPR delivery scope to projects where
  the PM has a project_members row, not all tenant projects. Owner DPR
  content is strictly single-project scoped. (Tests: T-RLS-06 PM scope,
  T-RLS-07 owner scope.)

---

## CORE (4 tables)

### tenants
- id UUID PK DEFAULT gen_random_uuid()
- created_at TIMESTAMPTZ DEFAULT now()
- name TEXT NOT NULL (BETA)
- slug TEXT UNIQUE NOT NULL (BETA)
- plan TEXT DEFAULT 'trial' CHECK(trial/starter/growth/pro) (BETA)
- trial_ends_at TIMESTAMPTZ (BETA)
- payment_customer_id TEXT (BETA) — was stripe_customer_id, renamed in migration
  016 (applied to prod 2026-07-13). [DATED CORRECTION 2026-07-13: this line
  previously read "renamed in 006" — that was FALSE; no migration renamed it
  before 016. stripe_customer_id was live from 001 through 015; 016 did the rename.]
- paid_until TIMESTAMPTZ (BETA)
- last_payment_ref TEXT (BETA)
- gstin, cin, registered_address, pwd_class, iso_certifications,
  annual_turnover DECIMAL(15,2), profile_complete BOOLEAN (all FUTURE)

### users
- id UUID PK DEFAULT gen_random_uuid() — standalone PK, NOT FK to auth.users.
  Migration 006 decouples this from the original FK.
- created_at TIMESTAMPTZ DEFAULT now()
- auth_id UUID REFERENCES auth.users(id) ON DELETE SET NULL — NULLABLE.
  NULL for engineer + owner roles. Set for pm, admin, qs. (BETA)
- tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE (BETA)
- full_name TEXT (BETA)
- role TEXT NOT NULL CHECK(pm/qs/engineer/owner/subcontractor/admin) (BETA)
- whatsapp_number TEXT (BETA) — partial UNIQUE INDEX WHERE status='active',
  added in migration 008
- hierarchy_level INTEGER (BETA)
- status TEXT DEFAULT 'active' CHECK(pending/active/deactivated) (BETA)
- messaging_blocked BOOLEAN DEFAULT false (BETA)
- reporting_manager_id UUID, delegation_active BOOLEAN, employee_id TEXT (FUTURE)

### projects
- id, created_at, tenant_id (BETA)
- name TEXT NOT NULL (BETA)
- status TEXT DEFAULT 'active'
  CHECK(active/completed/on_hold/in_bidding/bids_submitted) (BETA)
- contract_value DECIMAL(12,2) (BETA)
- start_date DATE, expected_end_date DATE (BETA)
- created_by UUID REFERENCES users(id) (BETA)
- owner_user_id UUID REFERENCES users(id) — links project to its owner row.
  Captured at project creation. Required for DPR delivery. (BETA)
- tender_id, client_name, client_contact, site_address, project_type,
  contract_type (all FUTURE)

### project_members
- id, created_at, tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE (BETA)
- user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE (BETA)
- role TEXT NOT NULL (BETA)
- UNIQUE(project_id, user_id)
- One active project per engineer — enforced at insert in app logic,
  NOT a DB constraint.

---

## WHATSAPP BOT (5 tables — active)

### whatsapp_sessions
- id, created_at, tenant_id (BETA)
- user_id UUID REFERENCES users(id) (BETA)
- phone_number TEXT NOT NULL — UNIQUE added in migration 008 (BETA)
- current_flow TEXT CHECK(morning/evening/safety/invoice/hindrance) (BETA)
- current_step INTEGER DEFAULT 0 (BETA)
- context JSONB DEFAULT '{}' (BETA)
- pending_flows JSONB DEFAULT '[]' — ordered list, stable total order:
  safety=0, scheduled_trigger=1, other=2; FIFO within equal priority (BETA)
- expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '30 minutes' (BETA)
- updated_at TIMESTAMPTZ DEFAULT now() (BETA)

### daily_logs
- id, created_at, tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- engineer_id UUID NOT NULL REFERENCES users(id) (BETA)
- log_date DATE NOT NULL DEFAULT CURRENT_DATE (BETA)
- morning_plan TEXT (BETA)
- morning_manpower_planned JSONB — [{trade, planned_count}] (BETA)
- morning_equipment JSONB — [{type, count, owned_or_hired, daily_hire_cost}] (BETA)
- morning_execution_plan TEXT (BETA)
- morning_dependencies JSONB — [{item, responsible_party}] (BETA)
  NOTE: was TEXT in original 001 — corrected to JSONB in 006
- morning_hindrances JSONB — [{description, responsible_party}] (BETA)
  NOTE: was TEXT in original 001 — corrected to JSONB in 006
- morning_submitted_at TIMESTAMPTZ (BETA)
- is_holiday BOOLEAN DEFAULT false (BETA)
- holiday_reason TEXT (BETA)
- evening_output TEXT (BETA)
- evening_output_quantities JSONB — [{activity, quantity, unit}] (BETA)
- evening_schedule_met BOOLEAN (BETA)
- evening_schedule_miss_reason TEXT (BETA)
- evening_workers_on_site INTEGER (BETA)
- evening_productive_manpower JSONB (BETA)
- evening_equipment_utilisation JSONB —
  [{type, available_hours, actual_hours, idle_reason}] (BETA)
- evening_dependencies JSONB — [{item, responsible_party, required_by_time}] (BETA)
- evening_submitted_at TIMESTAMPTZ (BETA)
- dpr_content TEXT — DROPPED in migration 007 when dprs table is created
- morning_submitted_via TEXT, evening_submitted_via TEXT, weather TEXT,
  dpr_approved_by UUID (all FUTURE)
- UNIQUE(project_id, engineer_id, log_date)

### dprs — NEW in migration 007 (do not create until Week 4)
- id, created_at, tenant_id UUID NOT NULL (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- log_date DATE NOT NULL (BETA)
- structured JSONB (BETA) — all 6 Spine DPR sections
- content TEXT (BETA) — human-readable, rendered from JSON
- generated_at TIMESTAMPTZ (BETA)
- last_regenerated_at TIMESTAMPTZ (BETA)
- delivered_owner_at TIMESTAMPTZ (BETA)
- delivery_status TEXT DEFAULT 'pending'
  CHECK(pending/delivered/paused/skipped_no_data/failed) (BETA)
- generation_status TEXT DEFAULT 'idle' CHECK(idle/pending/running/stale) (BETA)
- generator_job_id UUID (BETA)
- UNIQUE(project_id, log_date)
- NOTE: generation_status and delivery_status are ORTHOGONAL lifecycles.
  One tracks the compute job, one tracks the owner-send state. Do NOT
  collapse into one column or couple their transitions.

### safety_incidents (FAST-FOLLOW flow — table exists, flow ships later)
- id, created_at, tenant_id, project_id, reported_by (BETA)
- incident_type, location, description, injury_status TEXT (BETA)
- photo_url TEXT (BETA) — Supabase Storage only, never Twilio URL
- ocr_confidence DECIMAL(5,2), pm_notified_at TIMESTAMPTZ (BETA)
- status TEXT DEFAULT 'open' CHECK(open/acknowledged/resolved) (BETA)
- submitted_via TEXT CHECK(whatsapp_scheduled/whatsapp_adhoc/web_app) (BETA)
- resolved_at TIMESTAMPTZ, resolved_by UUID, investigation_notes TEXT (FUTURE)

### invoices (FAST-FOLLOW flow — table exists, flow ships later)
- id, created_at, tenant_id, project_id, submitted_by (BETA)
- vendor_name TEXT, invoice_date DATE, invoice_number TEXT (BETA)
- amount DECIMAL(12,2) — MUST be (12,2), not (10,2) (BETA)
- line_items JSONB (BETA)
- cost_head TEXT CHECK(materials/labour/equipment/sundry) (BETA)
- image_url TEXT (BETA) — Supabase Storage only
- ocr_confidence DECIMAL(5,2), submitted_via TEXT (BETA)
- status TEXT DEFAULT 'pending' CHECK(pending/approved/rejected) (BETA)
- reviewed_by UUID REFERENCES users(id), reviewed_at TIMESTAMPTZ (BETA)
- vendor_id UUID, gstin_extracted TEXT (FUTURE)

### hindrances (FAST-FOLLOW flow — table exists, flow ships later)
- id, created_at, tenant_id, project_id, reported_by (BETA)
- hindrance_type TEXT
  CHECK(material_delay/weather/equipment/labour/design/utility/other) (BETA)
- area_affected TEXT, description TEXT (BETA)
- impact_level TEXT CHECK(minor/moderate/major) (BETA)
- photo_url TEXT (BETA) — Supabase Storage only
- submitted_via TEXT CHECK(whatsapp_scheduled/whatsapp_adhoc/web_app) (BETA)
- dpr_included BOOLEAN — NO DEFAULT. Set by the DPR generation job. (BETA)
- status TEXT DEFAULT 'open' CHECK(open/in_progress/resolved) (BETA)
- resolved_at TIMESTAMPTZ, resolved_by UUID (FUTURE)

---

## SKELETON TABLES (Phase 2/3 — created, no app logic)

Pre-contract (9): tenders, tender_documents, tender_document_chunks,
tender_chat_sessions, tender_chat_messages, boq_sessions, boq_items,
rate_catalog, rate_catalog_history
Financial (4): vendors, vendor_invoices, ra_bills, ra_bill_payments

rate_catalog and rate_catalog_history have NO tenant_id (Quoco-owned, shared).

---

## FAST-FOLLOW TABLE (do not build until escalation engine ships)

### resolutions — migration 007, when escalation engine ships
- id, tenant_id, project_id (BETA)
- source_type TEXT NOT NULL CHECK(red_flag/dependency/safety/hindrance) (BETA)
- source_key TEXT NOT NULL (BETA) — deterministic hash for JSONB items
- resolved_by UUID NOT NULL REFERENCES users(id) (BETA)
- resolved_at TIMESTAMPTZ NOT NULL (BETA)
- resolution_note TEXT (BETA)

---

## MIGRATION ORDER

001 — core schema (live)
002 — RLS policies (live)
003 — indexes (live)
004 — pgvector extension (live)
005 — auth trigger handle_new_user() (live)

006 — jobs table for NFR-16 async queue (LIVE — applied Week 2).
       - jobs(id, created_at, type, payload JSONB, status CHECK(pending/
         running/succeeded/failed), attempt_count, next_retry_at,
         last_error, completed_at)
       - idx_jobs_poll on (status, next_retry_at) WHERE status IN
         ('pending','running')
       - idx_jobs_type on (type, created_at)
       No dependency on auth surgery — applied first since it was ready
       first and has zero risk to existing data.

007 — auth surgery (Week 2). CHECKPOINT 1 before running.
       DATED CORRECTION (2026-07-13): the header once read "auth surgery + column
       corrections" and the COLUMN-CORRECTION bullets below (owner_user_id;
       morning_* → JSONB; is_holiday/holiday_reason; evening_dependencies
       consolidation; invoices.amount → DECIMAL(12,2); safety_incidents
       submitted_via CHECK; hindrances.dpr_included DROP DEFAULT; tenants
       stripe→payment rename + paid_until/last_payment_ref; users.role 'owner')
       were EVICTED from 007 per checkpoint-1 review §1b — so a bug in a rename
       could never force rollback pressure on the irreversible auth change. The
       APPLIED 007 is IDENTITY-SURGERY ONLY. Those bullets shipped in
       **migration 016** (applied to prod 2026-07-13) — see the 016 entry below.
       The bullets are retained here for historical continuity, NOT as current
       truth; 016 is their authoritative home.
       - Decouple users.id from auth.users FK
       - Add users.auth_id nullable FK
       - Update handle_new_user(): insert with generated id AND auth_id=NEW.id
       - Add users.status (NOT NULL DEFAULT 'active'), users.messaging_blocked
         — NOTE: both were pulled forward into migration 012 (guarded, IF NOT
         EXISTS) for the webhook's BOT-08/ENG-02 gate. 012's version is what
         persists, so 007 MUST match exactly: status NOT NULL DEFAULT 'active',
         messaging_blocked NOT NULL DEFAULT false. A looser definition here
         would be silently skipped.
       - Add projects.owner_user_id
       - Add whatsapp_sessions.pending_flows
       - morning_dependencies, morning_hindrances → JSONB
       - Add daily_logs.is_holiday, holiday_reason, evening_dependencies
       - Fix invoices.amount → DECIMAL(12,2)
       - Add safety_incidents.submitted_via CHECK
       - Remove hindrances.dpr_included DEFAULT
       - Rename tenants.stripe_customer_id → payment_customer_id
       - Add tenants.paid_until, last_payment_ref
       - Add users.role value 'owner' to CHECK (rename from 'client')
       IRREVERSIBLE (decouples users.id). Rehearse on a Supabase branch
       snapshot; get the Checkpoint 1 review before running on prod.

008 — dprs table + resolutions table + new columns (Week 4, before DPR work)

009 — constraints (run LAST — can fail if 007/008 incomplete):
       - whatsapp_sessions.phone_number UNIQUE
       - partial UNIQUE INDEX on users(whatsapp_number) WHERE status='active'

013 — session-transition test lock probe (CREATE OR REPLACE of
       acquire_and_transition_session, body-only; signature unchanged from
       012's 7 params). Adds a test-only `_test_lock_acquired_at` diagnostic
       merged into context ONLY when p_test_sleep_ms IS NOT NULL — never
       present in any production row. Backs Test B's DB-side lock proof.

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-07-07, not via CLI
       `db push`, due to an IPv6-only direct-connection host blocking CLI
       access. supabase_migrations.schema_migrations does NOT have a row for
       013 as a result — the function itself IS correctly live and verified
       (see the has_013_probe check), but CLI tracking is out of sync.
       DATED CORRECTION (2026-07-13): the original plan here — "run `supabase
       migration repair --status applied 013` once CLI connectivity is resolved" —
       is SUPERSEDED and was never executed. The CLI stays 28P01-blocked (auth),
       not merely IPv6-blocked, and `migration repair` has NOT run for ANY
       migration. The honest ledger method (used for 015 and 016) is a manual
       INSERT into supabase_migrations.schema_migrations via the SQL Editor. If
       013 still lacks a ledger row, backfill it the same way (manual INSERT) —
       do NOT wait on the CLI. Verify 013's row presence by direct observation
       before assuming either state (§0: a record is not the thing).

015 — users_update column grant — SECURITY (HIGH-1, review §11a).
       REVOKE UPDATE ON public.users FROM authenticated; re-GRANT column-wise on
       (full_name, avatar_url) only. Closes the pre-existing self-privilege-
       escalation / tenant-hop hole where an authenticated user could UPDATE
       their own row and set role='admin' or repoint tenant_id — RLS WITH CHECK
       alone did not bound columns; Postgres rejects an UPDATE touching an
       ungranted column at the privilege layer (42501), upstream of RLS. Also
       (round-2 defence-in-depth) REVOKE INSERT,UPDATE,DELETE FROM anon and
       INSERT,DELETE FROM authenticated — strips unused default-granted write
       verbs. complete_onboarding (SECURITY DEFINER) unaffected — runs as owner.
       Fully reversible (down: GRANT INSERT,UPDATE,DELETE ON public.users TO
       authenticated + anon).

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-07-12 (CLI auth-blocked at
       28P01; SQL Editor is the deliberate fallback, as with 013/014). Ledger
       tracked via manual INSERT into supabase_migrations.schema_migrations the
       same day (the SQL-Editor equivalent of `supabase migration repair
       --status applied 015`); post-insert ledger = 12 rows. Verified on the
       test-db branch (42/42) AND prod (probes A/B/C/D green) before + after
       apply. External reviewer signed off round 3 (all six checks). Full
       artifact package: docs/reviews/015-review-package.md.

016 — corrections (Week 2). The column/type fixes + the users.role 'client'→
       'owner' rename EVICTED from 007 (review §1b), plus the §11b
       complete_onboarding zero-row guard. Single BEGIN…COMMIT, fully reversible.
       Items: users.role CHECK gains 'owner' (drop old CHECK → UPDATE data → add
       users_role_check, in that order — rename INTO a previously-forbidden
       value); tenants.stripe_customer_id → payment_customer_id + paid_until,
       last_payment_ref; projects.owner_user_id UUID FK → users(id) ON DELETE
       RESTRICT; daily_logs is_holiday/holiday_reason, drop
       evening_dependencies_tomorrow, rename _structured → evening_dependencies,
       morning_dependencies/morning_hindrances TEXT → JSONB; invoices.amount
       (10,2) → (12,2); safety_incidents.submitted_via default realigned to
       'whatsapp_scheduled' + CHECK; hindrances.dpr_included DROP DEFAULT;
       complete_onboarding CREATE OR REPLACE with GET DIAGNOSTICS zero-row RAISE.
       Deferred (NOT in 016): complete_onboarding double-call minting → invitations;
       owner_user_id same-tenant enforcement → migration 017 (backlog item 9).

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-07-13, from the PINNED branch
       tip (git show <sha>:supabase/migrations/016_corrections.sql; frame in the
       review package). CLI auth-blocked at 28P01, SQL Editor is the deliberate
       fallback (as with 013/014/015). Ledger tracked via manual INSERT into
       supabase_migrations.schema_migrations the same day (2026-07-13); post-insert
       ledger = 13 rows. The six prod probes P1–P6 (role CHECK, tenants cols,
       owner_user_id confdeltype='r', daily_logs shape, submitted_via
       default+CHECK, complete_onboarding prosecdef+search_path) all green on
       2026-07-13. DATE SPLIT: the branch rehearsal, the F3-1/F3-2/F5-1 data probes,
       the test-db verification (50/50, incl. T-016-08), and the reviewer rounds
       were 2026-07-12; the prod apply, the six prod probes, and the ledger INSERT
       are 2026-07-13. External reviewer signed off with pinned-artifact provenance
       requirements. Full package: docs/reviews/016-review-package.md.

018 — morning flow Pass 2 (Q2 labour + Q3 equipment parsers). FUNCTION-ONLY:
       no table/column DDL — CREATE OR REPLACE of apply_morning_flow_turn only
       (both target columns, morning_manpower_planned + morning_equipment, are
       pre-existing nullable JSONB from 001 / 016-era). Extends the morning flow
       step order 1→4 to 1→2→3→4: Q2 writes the parsed labour object to
       morning_manpower_planned (step 2), Q3 writes the parsed equipment object
       to morning_equipment (step 3). Parsing is done in TypeScript (pure —
       lib/whatsapp/flows/parsers/{labour,equipment}.ts); the webhook parses the
       inbound unconditionally and passes p_manpower/p_equipment (+ _ok flags),
       and the RPC selects the one matching the active step under its existing
       lock. Signature goes 8-arg → 12-arg via DROP-FIRST (DROP FUNCTION the old
       signature, then CREATE) so no overload survives. Locking semantics
       unchanged beyond the anticipated context replace→merge on the parsed steps
       (per-step q2_reask/q3_reask counters; BOT-07 next-day reset wipes them).
       Feature-class, trivially reversible — NO external-reviewer gate.
       STORAGE SHAPE: both parsed columns are OBJECTS, not the bare arrays the
       bot-flows spec illustrates — morning_manpower_planned =
       {planned_total, by_trade:[{trade,planned_count}], raw_text};
       morning_equipment = {items:[{type,count,owned_or_hired,daily_hire_cost,
       raw}], none, raw_text}. This preserves the raw answer even on a
       "no equipment" turn (none:true, items:[]). READERS (Pass 3 evening Q5
       BOT-22 echo, DPR, dashboard) MUST read `.items` and treat empty as
       jsonb_array_length(morning_equipment->'items')=0. No reader exists yet
       (verified 2026-07-15).

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-07-14, from the PINNED branch
       tip 3d98cd3 (git show 3d98cd3:supabase/migrations/018_morning_flow_parsers.sql;
       frame at /tmp/018-pinned-prod-apply.txt). CLI IPv6/28P01-blocked, SQL
       Editor is the deliberate fallback (as with 013/014/015/016). Ledger tracked
       via manual INSERT into supabase_migrations.schema_migrations
       (version 018, name morning_flow_parsers); post-insert ledger = 14 rows.
       Prod signature probe: exactly one apply_morning_flow_turn, 12-arg list
       (n_args=12, n_defaults=6) — drop-first confirmed, no overload. types
       re-regenerated from prod post-apply = ZERO diff vs the branch-generated
       types/database.ts (confirmation gate passed). Branch verification: full
       suite 91/91 green (incl. 13 morning-flow integration tests + the BOT-07
       counter-wipe case) on test-db exfccwlrhoutkgrlikod.

NOTE ON CLI MIGRATION TRACKING: migrations 001-005 were originally applied
via the Supabase dashboard SQL editor, not the CLI, so the CLI's remote
tracking table had no record of them. Before pushing 006, this was repaired
with `supabase migration repair --status applied 001` (through 005). Any
future session using `supabase db push` for the first time should run
`supabase migration list` first to confirm Local and Remote columns match
before pushing — do not let the CLI attempt to re-run 001-005.
