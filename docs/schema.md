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

## WHATSAPP BOT (8 documented — 4 live, 3 Fast-Follow, 1 never created)
[DATED CORRECTION 2026-07-27: this header read "5 tables — active". Counted
directly, 8 ### subsections sit under it and they are NOT all live, so the old
label was wrong on both the number and the "active". Breakdown, per each
subsection's own status line: LIVE = whatsapp_sessions, processed_messages,
daily_logs, daily_log_edits. FAST-FOLLOW (table exists, flow unbuilt) =
safety_incidents, invoices, hindrances. NEVER CREATED = dprs. Re-count this
label whenever a subsection is added or removed.]

### whatsapp_sessions
- id, created_at, tenant_id (BETA)
- user_id UUID REFERENCES users(id) (BETA)
- phone_number TEXT NOT NULL — UNIQUE delivered by migration 012, LIVE (BETA):
  uq_whatsapp_sessions_phone_number (012:34, guarded IF NOT EXISTS)
  [DATED CORRECTION 2026-07-27: this line read "UNIQUE added in migration 008",
  wrong on both halves. (a) 008 never reserved it — THIS FILE's own 009 entry is
  where whatsapp_sessions.phone_number UNIQUE was reserved, and 012's header
  agrees ("whatsapp_sessions.phone_number UNIQUE -> planned migration 009"), so
  the "008" was an internal inconsistency, not a competing plan. (b) Neither
  reserved migration delivered it anyway: 008 and 009 are both still UNBUILT (no
  files exist). 012 created the UNIQUE index early and guarded it, because
  ON CONFLICT (phone_number) — which every session RPC depends on — cannot work
  without it. Do NOT confuse this with the plain 003 index on the same column;
  that one was redundant and 021 dropped it.]
- current_flow TEXT CHECK(morning/evening/safety/invoice/hindrance) (BETA)
- current_step INTEGER DEFAULT 0 (BETA)
- context JSONB DEFAULT '{}' (BETA)
- pending_flows JSONB DEFAULT '[]' — ordered list, stable total order:
  safety=0, scheduled_trigger=1, other=2; FIFO within equal priority (BETA)
- expires_at TIMESTAMPTZ DEFAULT now() + INTERVAL '30 minutes' (BETA)
- updated_at TIMESTAMPTZ DEFAULT now() (BETA)

### processed_messages — migration 011 (LIVE). Webhook SID idempotency.
- id UUID PK, created_at TIMESTAMPTZ DEFAULT now()
- message_sid TEXT NOT NULL UNIQUE — Twilio's message SID
- processed_at TIMESTAMPTZ DEFAULT now()
- Purpose: a repeated Twilio SID must be a no-op (no duplicate rows, no
  duplicate replies). isNewMessage (lib/whatsapp/idempotency.ts) never SELECTs —
  it INSERTs and catches the 23505 raised by the UNIQUE CONSTRAINT. The
  constraint, not any secondary index, is load-bearing: 021 dropped the
  duplicate idx_processed_messages_sid and idempotency was unaffected.
- NO tenant_id — a deviation from CLAUDE.md §4's every-table rule. The row is
  webhook-level dedupe keyed on a globally-unique Twilio SID and holds no tenant
  data. Recorded as an observation, not a blessing; whether it should be
  tenant-scoped is an open decision, not something this doc settles.
- RLS: enabled on prod OUT-OF-BAND (no migration source) — see the out-of-band
  registry in CLAUDE.md §10. A rebuild comes up RLS-DISABLED.
- GROWTH: fastest-growing table in the system (~13 rows per engineer per
  site-day). Rows are useless after ~24h; 011:20-23 suggests a 7-day prune and
  nothing implements it. A prune needs BRIN on created_at (append-only,
  time-ordered), not btree — there is no index on created_at today.

### daily_logs
- id, created_at, tenant_id (BETA)
- project_id UUID NOT NULL REFERENCES projects(id) (BETA)
- engineer_id UUID NOT NULL REFERENCES users(id) (BETA)
- log_date DATE NOT NULL DEFAULT CURRENT_DATE (BETA)
- morning_plan TEXT (BETA)
- morning_manpower_planned JSONB — an OBJECT, not a bare array (BETA):
  {planned_total: number|null, by_trade: [{trade, planned_count}], raw_text}
- morning_equipment JSONB — an OBJECT, not a bare array (BETA):
  {items: [{type, count, owned_or_hired, daily_hire_cost, raw}], none: boolean,
   raw_text}
  [DATED CORRECTION 2026-07-27: both lines above previously showed the BARE
  ARRAYS the bot-flows spec illustrates. That was never what shipped — migration
  018 writes the OBJECT forms above (see 018's STORAGE SHAPE block in MIGRATION
  ORDER), verified against the live parsers lib/whatsapp/flows/parsers/labour.ts
  (LabourParse) and equipment.ts (EquipmentParse). The object form is what makes
  a "no equipment" turn representable — none:true with items:[] — while still
  preserving the engineer's raw answer in raw_text.
  READERS MUST read morning_equipment->'items', NOT the column as an array, and
  treat empty as jsonb_array_length(morning_equipment->'items') = 0. Reading
  either column as a top-level array returns nothing and fails silently. As of
  2026-07-27 no reader exists yet (evening Q5 BOT-22 echo, DPR, dashboard are
  all unbuilt) — this correction lands BEFORE the first one is written.]
- morning_execution_plan TEXT (BETA)
- morning_dependencies JSONB — [{item, responsible_party}] (BETA)
  NOTE: was TEXT in original 001 — corrected to JSONB in 006
- morning_hindrances JSONB — [{description, responsible_party}] (BETA)
  NOTE: was TEXT in original 001 — corrected to JSONB in 006
- morning_submitted_at TIMESTAMPTZ (BETA)
- is_holiday BOOLEAN DEFAULT false (BETA)
- holiday_reason TEXT (BETA)
- evening_output TEXT (BETA)
- evening_output_quantities JSONB (BETA)
  [DATED CORRECTION 2026-08-08: this line previously showed the BARE ARRAY
  `[{activity, quantity, unit}]` bot-flows.md's spec illustrates — the SAME
  class of error the 2026-07-27 correction fixed on morning_manpower_planned/
  morning_equipment, just never applied here because nothing read this column
  until migration 024 was drafted. The column has been LIVE since migration
  022 (2026-08-05); its actual, verified-against-code shape is an OBJECT, not
  a bare array: `{items: [{activity, quantity, unit, raw}], raw_text}` — see
  lib/whatsapp/flows/parsers/quantities.ts (QuantitiesParse) and 022:525
  (`p_parse->'1'`, the whole object, stored verbatim). READERS MUST read
  evening_output_quantities->'items', not the column as an array.]
- evening_schedule_met BOOLEAN (BETA)
- evening_schedule_miss_reason TEXT (BETA)
- evening_workers_on_site INTEGER — migration 024 (LIVE — see the
  dated correction below). Column itself has existed, untouched,
  since 001_core_schema.sql; 024 is the first thing that writes it (Q4 step
  1, headcount — reuses parseLabourCount verbatim, only planned_total
  persisted). Written together with evening_productive_manpower in the same
  transaction, never alone — see that entry below for why.
- evening_productive_manpower JSONB — migration 024 (LIVE — see the
  dated correction below). AGGREGATE-ONLY v1
  (design-decisions-beta-feedback.md §9, 2026-07-28 — DECIDED before 024 was
  written) — no trade-level breakdown, ever; see that decision for the three
  reasons it's deferred. Shape, object-wrapped per the same convention as
  every other parsed column in this table (never the bare array an earlier
  draft of this note showed):
  `{productive_count, idle_count, idle_reason, raw_text, confidence}`.
  `confidence` ('high'|'low') is Rule 3.5's low-confidence flag — the FIRST
  place it exists anywhere in this schema (CLAUDE.md §10's PARSER DEBT entry
  tracks its absence everywhere else) — built here specifically, not as
  general hygiene, because this field and evening_equipment_utilisation's own
  `actual_hours`/`available_hours` feed DPR section 4's idle-cost currency
  arithmetic directly; see 024_evening_flow_q4_q5.sql's own CONFIDENCE FLAG
  note for the full reasoning.
- evening_equipment_utilisation JSONB — migration 024 (LIVE — see the
  dated correction below). AUTO-SKIPPED (stored as an empty items
  array) when morning_equipment is NULL (no morning submission at all — the
  case migration 022's own reserved-block comment's pinned skip test would
  have MISSED, jsonb_array_length(NULL->'items') being NULL not 0; fixed in
  024) or empty (morning explicitly said no equipment). Object-wrapped, per
  the same convention:
  `{items: [{morning_item_index, type, available_hours, actual_hours,
  idle_reason, raw}], raw_text, confidence}`.
  `morning_item_index` is the ACTUAL join key back to
  `morning_equipment.items` — POSITION, not `type`: two machines of the SAME
  type at different hire rates (two JCBs) would collide on a type-string
  join, since morning_equipment carries no other distinguishing field
  between them. `type` is still stored per entry, for display only. See
  024_evening_flow_q4_q5.sql's EQUIPMENT JOIN KEY note for the full
  reasoning and how the echo order guarantees the join resolves.

  [DATED CORRECTION 2026-08-10: the three entries above previously read
  "(WRITTEN, NOT YET REHEARSED OR APPLIED, 2026-08-08)" for all three
  columns. Wrong as of this correction — migration 024 is LIVE. Verified
  directly, not assumed: `apply_evening_flow_turn` exists on the linked
  project with the expected 024 signature, all three columns exist, and the
  full T-024 suite (23 tests) passes green against test-db. `supabase
  migration list --linked` still shows an empty `remote` column for 024 —
  that is NOT evidence against this; 023 shows the identical empty-remote
  pattern despite being confirmed applied via the SQL-editor runbook (its
  own dated entries below), the same CLI-tracking lag this repo has hit
  before. This is the THIRD time this project's docs have claimed a
  migration wasn't applied when it was — the miss here specifically:
  024's prod apply updated a separate handoff document but never came back
  to update schema.md or this test header, unlike 023, where PR #36 did
  exactly that. See also test/migration-024.test.ts's own header, corrected
  the same day for the identical stale claim about test-db.]
- evening_dependencies JSONB — [{item, responsible_party, required_by_time}] (BETA)
- evening_submitted_at TIMESTAMPTZ (BETA)
- dpr_content TEXT — LIVE on prod as of this note's original writing.
  [CORRECTED 2026-07-15, migration 017 audit S2: the prior note "DROPPED in
  migration 007 when dprs table is created" was STALE/FALSE — no migration
  ever dropped it (grep: only 001 creates it; the sole daily_logs DROP COLUMN
  in the tree is 016's evening_dependencies_tomorrow), and no dprs table was
  ever created. Confirmed live via Probe 3 (column grants present) + generated
  types (dpr_content: string | null). The 007 dprs/drop was planned, never executed.]
  [DATED UPDATE 2026-08-07: migration 023 drops this column — rehearsed clean
  on test-db (0 non-null rows observed, both on prod and test-db, before the
  drop; see docs/reviews/023-review-package.md). NOT YET applied to prod —
  this column is still live there as of this update. The per-engineer
  `daily_logs.dpr_content` interim path is superseded by the project-level
  `dprs` table (see that entry above); `app/(dashboard)/dprs/page.tsx` is
  repointed at `dprs` in the same migration's PR, since dropping this column
  first would break that page.]
  [DATED UPDATE 2026-08-07, 20:44 IST: APPLIED. Migration 023 ran on prod at
  20:44 IST — this column is now DROPPED there. The "NOT YET applied"
  wording directly above describes the state as of the PR merge (which
  deliberately preceded the apply — see the `dprs` entry below); it is
  superseded by this line, not deleted, since it was accurate when written.
  Post-apply probe confirmed zero rows lost (there were zero non-null rows
  to lose). Full evidence: docs/reviews/023-review-package.md §12.]
- morning_submitted_via TEXT, evening_submitted_via TEXT, weather TEXT,
  dpr_approved_by UUID (all FUTURE)
- UNIQUE(project_id, engineer_id, log_date)

### daily_log_edits — migration 019 (LIVE). PM correction audit trail.
- id UUID PK, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
- tenant_id UUID NOT NULL REFERENCES tenants(id)
- daily_logs_id UUID NOT NULL REFERENCES daily_logs(id)
- project_id UUID NOT NULL REFERENCES projects(id)
- log_date DATE NOT NULL
- column_name TEXT NOT NULL CHECK — the 9 SCALAR columns from 017's grant:
  is_holiday, holiday_reason, weather, morning_plan, morning_execution_plan,
  evening_output, evening_schedule_met, evening_schedule_miss_reason,
  evening_workers_on_site. The 8 JSONB-array columns are deliberately NOT
  correctable in v1 (a different UI problem, deferred pass).
- old_value JSONB, new_value JSONB
- edited_by UUID NOT NULL REFERENCES users(id)
- source TEXT NOT NULL DEFAULT 'pm_inline_correction' CHECK(pm_inline_correction)
- Indexes: idx_daily_log_edits_daily_logs_id; idx_daily_log_edits_project_date
- SOURCE OF TRUTH, not just an audit log: a future dpr_generate handler MUST
  consult this table for post-check-in edits. A DPR generated from daily_logs
  alone is stale by design.
- Written only via correct_daily_log() — the column write and the audit row are
  one transaction. RLS enabled; anon and authenticated are stripped of
  INSERT/UPDATE/DELETE, so there is no path that edits a log without an audit row.
- correct_daily_log RETURNS UUID and RETURNS NULL on a no-op (019:251). The
  GENERATED TYPE says `string`, not `string | null` — callers must handle null
  regardless of what types/database.ts claims.
- LOAD-BEARING DUPLICATION — DO NOT "SIMPLIFY": the column_name CHECK above
  duplicates the RPC's internal CASE whitelist on purpose. Two independent gates
  that must agree; if one is widened and the other is not, the write fails CLOSED
  rather than silently persisting an un-whitelisted column. Same discipline as
  021's index-predicate/MAX_ATTEMPTS coupling test.
- RETENTION: this and daily_logs are NOT hygiene tables — they are the business
  record behind every DPR ever sent. Retention here is a compliance question,
  never a storage one (CLAUDE.md §10).

### dprs — migration 023 (LIVE on prod, applied 2026-08-07 20:44 IST)
> DATED UPDATE (2026-08-07, 20:44 IST): APPLIED TO PROD. The "WRITTEN +
> REHEARSED ON TEST-DB... NOT YET APPLIED TO PROD" box directly below is now
> HISTORICAL — it correctly described the pre-apply state and is preserved
> for provenance, not current. All six post-apply verification queries on
> prod returned output IDENTICAL to the test-db rehearsal: 13 columns
> matching types/defaults; `relrowsecurity=true`, `relforcerowsecurity=false`;
> one `dprs_select` policy (`polcmd=r`, `roles={authenticated}`,
> `with_check` null, `using_expr` carrying both the `tenant_id` check and
> the `EXISTS` over `project_members`); `daily_logs.dpr_content` absent
> (zero rows); `relacl` identical character-for-character
> (`{postgres=arwdDxtm,anon=rDxtm,authenticated=rDxtm,service_role=arwdDxtm}`);
> six constraints matching by name and definition, `generator_job_id` in no
> foreign key. Pre-apply probe taken again at apply time (not trusted from
> the migration file's own header comment, per that comment's own
> instruction): `total_rows=1, non_null_dpr_content=0` — unchanged from the
> earlier reading. `ensure_rls` (the prod-only event trigger — OUT-OF-BAND
> DB OBJECTS registry, CLAUDE.md §10; `023-review-package.md` §4) was a
> non-event: `relforcerowsecurity=false` on prod, same as test-db where the
> trigger doesn't exist at all — fired exactly as predicted, changed
> nothing observable. PITR observed by direct dashboard inspection before
> the apply (CLAUDE.md §0, not a checklist entry); rollback target 20:43
> IST, 7 Aug 2026. `types/database.ts` was regenerated against test-db
> BEFORE this apply (the option-B decision, `023-review-package.md` §7) and
> confirmed BYTE-IDENTICAL — sha256 match, zero diff lines — against a
> fresh regen taken directly against prod AFTER the apply: the drift check
> that decision depended on passed, retroactively validating it rather than
> merely assuming it would. Full evidence: `docs/reviews/023-review-package.md`
> §12.
>
> HISTORICAL (2026-08-07, pre-apply) — preserved for provenance, not
> current. `supabase/migrations/023_dpr_reports.sql` created this table:
> written, rehearsed clean against test-db
> (`exfccwlrhoutkgrlikod`) via the SQL Editor (CLI is linked to prod; 023
> contains an `ALTER TABLE daily_logs DROP COLUMN dpr_content`, so CLI push
> was deliberately not used per CLAUDE.md §0), every post-apply verification
> query passed (columns, RLS, policy shape, grants, constraints). **Rehearsed
> is not applied** — as of this entry `dprs` still does not exist on PROD,
> only on test-db. Precisely two departures from the design below, both
> recorded in 023's own migration-file comments, not restated here: RLS is
> scoped via `project_members` (NOT tenant-wide — see 023's "RLS SCOPING"
> comment, which also records why the policy is deliberately PM-only, never
> owner-facing); `generator_job_id` is deliberately NOT a foreign key to
> `jobs.id` (`jobs` rows are a pruning candidate — see 023's own comment).
> No `SECURITY DEFINER` RPC exists for this table — only `service_role`
> writes, from the dpr_generate job handler (not yet built — see 023's "WHY
> NO SECURITY DEFINER RPC" comment). Full rehearsal evidence:
> `docs/reviews/023-review-package.md`.
>
> **⚠️ HISTORICAL — READ BEFORE USING ANYTHING BELOW THIS BOX, superseded by
> the update above.** No migration had ever created this table as of
> 2026-07-27. The columns documented below were a DESIGN, not a live schema.
> The header previously read "NEW in migration 007 (do not create until Week 4)";
> 007 is applied and is IDENTITY-SURGERY ONLY — the dprs/drop work was evicted
> from it at checkpoint-1 review and never executed. See the 007 entry in
> MIGRATION ORDER, and the corroborating 2026-07-15 correction under
> `daily_logs.dpr_content` above ("no dprs table was ever created", confirmed via
> the 017 audit's Probe 3 + generated types). The table was then assigned to
> migration **008**, which was UNBUILT (no file existed) — it landed as 023
> instead, per CLAUDE.md §6's "next unused number" rule (008-010 were never
> created; see the P1 correction pass).
> CONSEQUENCE AS OF 2026-07-27 (also now historical): DPR content lived in
> `daily_logs.dpr_content` (TEXT). That column is DROPPED by 023 (rehearsed
> clean — see the update above) once 023 reaches prod.

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
         SUPERSEDED BY 021 (2026-07-27): this index was never usable by the
         real claim query — claimJobs filters status IN ('pending','failed'),
         which does not imply this predicate, so Postgres could not use it and
         the 60-second poll fell back to a Seq Scan. Observed, not inferred
         (idx_scan = 0 across 10 real executions). 021 drops it and creates
         idx_jobs_claim. See the 021 entry below.
       - idx_jobs_type on (type, created_at)
         NOTE (2026-07-27, per the 021 audit): non-partial, so it indexes every
         job forever, and nothing queries jobs by type today (9,728 kB at 200k
         rows vs idx_jobs_claim's 56 kB). DEFERRED from 021 deliberately — it is
         unused, not redundant or broken, so dropping it is a product bet rather
         than hygiene. Revisit if no reader appears.
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
       - whatsapp_sessions.phone_number UNIQUE — ALREADY DELIVERED by 012
         (012:34, IF NOT EXISTS). NOT outstanding work. If 009 is ever authored
         it MUST keep this step idempotent or it collides with what 012 created
         (012's header states the requirement).
       - partial UNIQUE INDEX on users(whatsapp_number) WHERE status='active'
         — still outstanding. Note this is users.whatsapp_number, a DIFFERENT
         column from whatsapp_sessions.phone_number above.

011 — processed_messages: WhatsApp webhook SID idempotency (LIVE).
       - CREATE TABLE processed_messages (see the table section above) with
         message_sid TEXT NOT NULL UNIQUE, plus idx_processed_messages_sid — a
         duplicate of the index the UNIQUE constraint already creates, which its
         own comment concedes and which 021 later drops.
       NUMBERING: took 011 rather than 008/009/010 because 007/008/009 were
       RESERVED for planned work (auth surgery / dprs / constraints) and this
       table depends on none of them (011's header states this). There has never
       been a migration 010 — the number was skipped, not lost.
       APPLIED TO PRODUCTION: yes — present in prod's ledger (proven by the count
       arithmetic under 019/021 below). EXACT DATE NOT RECONSTRUCTED: no apply
       date or method is recorded anywhere in the repo; 011 predates the
       pinned-artifact discipline (standing only from 017). BOUNDS: file
       committed 2026-07-05; the ledger stood at 11 rows on 2026-07-10 (015
       package #6) which is exactly 001-007 + 011-014, and CLAUDE.md §0 records
       007 being applied out-of-order "after 011-014" — so 011 was live on prod
       by 2026-07-10. Do not narrow this to a specific day without evidence.

012 — atomic WhatsApp session acquire + transition + drain (BOT-07/21/26) (LIVE).
       - CREATE OR REPLACE acquire_and_transition_session, drain_next_pending_flow,
         quoco_same_ist_day. The last one is the REAL session lifecycle — an IST
         calendar-day comparison — NOT whatsapp_sessions.expires_at, which is
         written and never read (see the whatsapp_sessions note above).
       - CREATE UNIQUE INDEX uq_whatsapp_sessions_phone_number — required by the
         ON CONFLICT (phone_number) upsert every session RPC depends on
         (012/013/014/018). This is NOT the plain 003 index that 021 drops;
         confusing the two breaks the morning flow outright.
       - PULLED FORWARD from the blocked 007/009, all guarded IF NOT EXISTS:
         whatsapp_sessions.pending_flows, users.status, users.messaging_blocked.
         The webhook's BOT-08/ENG-02 gate needed them before 007 could clear
         Checkpoint 1. This is why those columns exist on prod despite 007's
         applied body not being the thing that delivered them.
       SECURITY ORIGIN: the over-broad default PUBLIC EXECUTE grant on the
       SECURITY DEFINER functions dates from here — the hole migration 020 closes
       (CLAUDE.md §10 SECURITY INCIDENT).
       APPLIED TO PRODUCTION on 2026-07-05 — the one date in this group that IS
       pinned, twice and independently: CLAUDE.md §10 ("live since 012 /
       2026-07-05") and docs/reviews/020-review-package.md ("anon-callable since
       012 (2026-07-05)"). Apply METHOD not recorded.

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

014 — morning flow Pass 1: apply_morning_flow_turn (LIVE). FUNCTION-ONLY, no DDL.
       The SINGLE transactional RPC that applies one inbound turn of the morning
       flow. Pass 1 is a deliberate SKELETON — it proves the shape on the two
       free-text questions only: Q1 "plan of action" -> daily_logs.morning_plan,
       Q4 "execution method/sequence" -> daily_logs.morning_execution_plan.
       Q2/Q3 land in 018 (which extends this same function 8-arg -> 12-arg via
       DROP-FIRST); Q5/Q6 are Pass 3, unbuilt.
       WHY IT IS ONE FUNCTION: the Supabase JS client cannot hold a transaction
       open across multiple PostgREST calls — each .rpc()/.from() commits
       independently — so the whole turn (session lock, step advance, daily_logs
       write) must be one server-side call or it is not atomic.
       APPLIED TO PRODUCTION: yes. EXACT DATE NOT RECONSTRUCTED — same gap as
       011. BOUNDS: file committed 2026-07-07; ledger tracking for BOTH 013 and
       014 was repaired on 2026-07-10 with schema_migrations verified at 11 rows
       (015 package #6); 007 was applied after 011-014 on 2026-07-10. So 014 was
       live on prod by 2026-07-10.

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

017 — RLS column-bounding audit + owner_user_id same-tenant enforcement.
       STRUCTURAL, reviewer-gated. Systemic follow-up to 015/HIGH-1: closes the
       same CLASS of column-privilege hole on every UPDATE path, and adds the
       owner_user_id same-tenant enforcement deferred from 016 (backlog item 9).
       Five steps: (1) ADD UNIQUE(id, tenant_id) on users + projects (strict
       supersets of the PK — build instantly, cannot fail on data); (2) swap three
       plain single-column FKs for COMPOSITE same-tenant FKs — projects.owner_user_id
       + project_members.user_id → users(id, tenant_id), project_members.project_id →
       projects(id, tenant_id), all ON UPDATE NO ACTION (explicit, BF1) so a
       cross-tenant repoint fails loud rather than cascading; owner FK MATCH SIMPLE
       (nullable owner skips check — DO NOT change to MATCH FULL); (3) REVOKE blanket
       UPDATE on projects from authenticated, re-GRANT 12 business columns only;
       (4) same on daily_logs, re-GRANT 17 observational/correction columns only
       (excludes dpr_content per O1, identity/RPC-metadata cols); (5) F4 anon
       write-strip across all public tables (defense-in-depth; F4 ≠ F6, does not
       touch RLS-enable state). Column-grant lists are PROVISIONING not a behavior
       change — grep (2026-07-15) found ZERO authenticated UPDATE code paths on
       either table today (no PM-edit dashboard exists). WHY composite FK not trigger
       (B1): FOR KEY SHARE conflicts only on KEY cols and tenant_id is in no unique
       index, so a trigger lock never blocks the repoint; the UNIQUE index gives the
       FK its atomicity, RLS-independently. Reversible — DOWN path (restore plain FKs,
       drop UNIQUE parents, restore blanket grants) at the migration file end.

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-07-16, from the PINNED commit
       69dac1a (git show 69dac1a:supabase/migrations/017_rls_column_bounding.sql;
       sha256 7b06ed81c9f0ca8602c0a694c600593d20b2a04c1bc68e7be2997f168b5255a5;
       frame at /tmp/017-pinned-prod-apply.txt). CLI IPv6/28P01-blocked, SQL Editor
       is the deliberate fallback (as with 013–016/018). PITR restore-window OBSERVED
       live pre-apply per CLAUDE.md §0 (2026-07-16: active window 09 Jul 2026
       22:01:51 → 15 Jul 2026 22:07:46, 2-min granularity, UTC+05:30). Ledger tracked
       via manual INSERT into supabase_migrations.schema_migrations (version 017, name
       rls_column_bounding); post-insert ledger = 15 rows. Prod after-probes (paired
       against the pinned "before"): A1 three composite FKs; A2 both UNIQUE(id,tenant_id)
       parents; B 29 column grants (17 daily_logs + 12 projects, excluded cols absent);
       C anon write-grants 69 → 0 (Step 5's first real revoke-from-populated run —
       branch ran it as a no-op on an already-empty set); D confupdtype a/a/a +
       confdeltype r/c/c. Branch re-rehearsal of the exact 69dac1a body: clean apply,
       A1–D pass, suite 103/103 on test-db exfccwlrhoutkgrlikod. Full package +
       errata (E-017-01/02) + run sheet: docs/reviews/017-review-package.md,
       docs/reviews/017-prod-runsheet.md.

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

019 — daily_log_edits + correct_daily_log: Rule 4.3 inline correction (DASH-03).
       - CREATE TABLE daily_log_edits (see the table section above) — RLS enabled,
         anon/authenticated stripped of INSERT/UPDATE/DELETE, two indexes.
       - correct_daily_log RPC — applies the daily_logs column write AND the audit
         row in one transaction. EXECUTE revoked from PUBLIC, granted narrowly.
         RETURNS UUID; RETURNS NULL on a no-op (019:251) even though the generated
         type says `string`.
       SCALAR-ONLY v1: the 9 text/boolean/integer columns from 017's grant. The 8
       JSONB-array columns are deliberately NOT correctable — deferred pass.
       LOAD-BEARING DUPLICATION: the table CHECK's column list duplicates the RPC's
       CASE whitelist ON PURPOSE — two gates that must agree, so drift fails CLOSED.
       Do not "simplify" it away. 021's MAX_ATTEMPTS coupling test follows this.
       APPLIED TO PRODUCTION: yes — PROVEN BY LEDGER ARITHMETIC, since no apply
       frame was pinned. The ledger stood at 15 rows after 017 (017 entry); the
       021 apply observed 17 -> 18. 15 + 019 + 020 = 17 is the only way to reach
       17, so both 019 and 020 have rows. EXACT DATE NOT RECONSTRUCTED. BOUNDS:
       after 2026-07-25 (020's apply required 019 to be OFF prod at that moment —
       the merge-order gate, 020 package §8 Step 2) and before 021's apply on
       2026-07-27. The 019 package records the round-3 rehearsal (2026-07-26) but
       no prod apply. Package: docs/reviews/019-review-package.md.

020 — function EXECUTE hardening. SECURITY (HIGH, PRE-EXISTING).
       Every public SECURITY DEFINER function carried PostgreSQL's default PUBLIC
       EXECUTE grant, live since 012 (2026-07-05). PUBLIC includes anon, so the
       public anon key could reach them through PostgREST /rpc/. 020 REVOKEs from
       PUBLIC and re-GRANTs narrowly across all seven.
       EXPLOITABILITY WAS NARROWER THAN "SEVEN" — do not overstate it. Three were
       genuinely exploitable (acquire_and_transition_session,
       apply_morning_flow_turn, drain_next_pending_flow — parameter-trusting, they
       take p_user_id/p_tenant_id as caller input and derive no identity from
       auth.uid(), so anon could forge check-in data for any engineer, bypassing
       the webhook, Twilio HMAC and idempotency). complete_onboarding is bounded
       (self-guards on auth.uid()). The trigger/event-trigger-returning ones
       (handle_new_user, rls_auto_enable) were NEVER PostgREST-callable — hardened
       for defense-in-depth only. Full breakdown: CLAUDE.md §10.
       FIRST migration to reference rls_auto_enable — an out-of-band prod object
       with no migration source, brought under version control here (see the
       out-of-band registry, CLAUDE.md §10).
       APPLIED TO PRODUCTION on 2026-07-25 via `supabase db push` — the EXCEPTION
       among 013-021, which all used the SQL Editor. Prod ref jvxwqignooseazzmwhvl,
       PITR window observed pre-apply the same day (§0). Pre-flight: 019 was
       removed from local first so it could not ride along (merge-order gate).
       Post-apply proacl prove-closed pinned; 6 of 6 prod checks complete, the last
       (Smoke C, webhook-driven apply_morning_flow_turn) closed 2026-07-26 with a
       full Q1-Q4 flow. Package: docs/reviews/020-review-package.md.

021 — index hygiene + claim-poll index. INDEX-ONLY: no table/column DDL, no
       function bodies, no ACL/RLS change, ZERO data mutation. Three changes,
       each provably redundant or provably unusable:
       - DROP idx_jobs_poll, CREATE idx_jobs_claim on (next_retry_at)
         WHERE status IN ('pending','failed') AND attempt_count < 5.
         Leading with next_retry_at lets ONE index scan serve the range filter,
         the ORDER BY and the LIMIT (no Sort node). attempt_count is in the
         PREDICATE, not left to a runtime filter, because dead-letter rows
         (attempt_count = 5, status stays 'failed', next_retry_at = moment of
         death) are permanent per NFR-17 and their PAST next_retry_at sorts them
         to the FRONT of an ascending scan — a status-only predicate would make
         every poll walk the whole dead set first (measured: 20,000 index entries
         vs 5,000 as shipped).
       - DROP idx_processed_messages_sid — duplicates the index that 011:11's
         `message_sid ... UNIQUE` already creates. isNewMessage depends on the
         CONSTRAINT's 23505, not on this index; the constraint is untouched.
       - DROP idx_whatsapp_sessions_phone_number (003:49, plain) — superseded by
         uq_whatsapp_sessions_phone_number (012:34, UNIQUE), which backs
         ON CONFLICT (phone_number) in 012/013/014/018 and is NOT touched.
       LOAD-BEARING COUPLING: the `attempt_count < 5` predicate must stay equal to
       MAX_ATTEMPTS (lib/queue/jobs.ts:26). Drift makes the index silently
       unusable — no error, no symptom. Guarded by test/unit/jobs-claim-index.test.ts
       (two gates that must agree, the 019 CHECK/CASE discipline).
       Rehearsed on test-db (cleaned existing branch, per §0 — not a fresh
       provision) with 200k representative rows. Measured: Seq Scan 2,877 buffers
       / 50.549 ms -> Index Scan 3 buffers / 0.149 ms (~340x); idx_jobs_poll
       idx_scan 0 across 10 real executions vs idx_jobs_claim +10. Negative
       controls (attempt_count < 7; status list + 'running') both revert to Seq
       Scan. Suite 169/169. Types regen zero diff.
       Fully reversible — exact-inverse DOWN at the migration file end; NO PITR
       dependency (rollback does not lean on a backup). No external-reviewer gate
       (018 precedent). Package: docs/reviews/021-review-package.md.

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-07-27, from the PINNED commit
       19b1e39 (git show 19b1e39:supabase/migrations/021_index_hygiene.sql; sha256
       bcf16a2436a6f36841264b6cdc574b992e1f1303774d2814f8946011acf83802). CLI
       28P01-blocked, SQL Editor is the deliberate fallback (as with 013-020).
       No PITR observation gate — 021's rollback does not depend on a backup
       (exact-inverse DOWN, zero data mutation); stated rather than skipped
       silently, per §0. Pre-apply frame captured on prod first (10 rows, all
       three drop targets present, definitions matching their migration files) —
       prod was not drifted, so the apply exercised exactly the rehearsed paths.
       Post-apply verification (runbook steps D-F, all observed on apply day):
       index inventory matches the expected post-state — idx_jobs_claim present,
       the three drop targets absent, and the two must-survive indexes
       (uq_whatsapp_sessions_phone_number, processed_messages_message_sid_key)
       both still present. Ledger tracked via manual INSERT into
       supabase_migrations.schema_migrations (version 021, name index_hygiene),
       count observed 17 -> 18 rows across the INSERT (before/after observation,
       not an asserted number). types re-regenerated from prod post-apply = ZERO
       diff vs the committed types/database.ts (confirmation gate passed).
       DEFERRED, ~1 week out: re-read pg_stat_user_indexes on prod for
       idx_jobs_claim.idx_scan. It will read 0 until the first real job type
       ships (the queue has no handlers yet) — expected, not a failure.

022 — evening check-in flow Pass 1 (apply_evening_flow_turn) + CONTEXT
       DISCIPLINE. New SECURITY DEFINER RPC covering Q1 (work done +
       quantities enrichment), Q2 (plan met? — parsed yes/no, conditional
       branch), Q3 (miss reason, only when Q2 = No). Hardened inline, not as a
       follow-up: REVOKE PUBLIC/anon/authenticated + GRANT service_role only,
       in the same transaction that creates it (020 discipline). Ships
       alongside two changes to apply_morning_flow_turn: its ELSE branch now
       returns 'wrong_flow' instead of 018's 'idle' when a different flow is
       active, so a mis-routed turn is reported rather than silently
       swallowed after the Twilio SID is consumed; and — CONTEXT DISCIPLINE,
       added during reviewer round 2 — both of morning's context-writing
       sites (start, Q4 completion) now merge context instead of replacing
       it, matching the rule evening's own two sites already followed.
       Reviewer round 2 also found a defect the original single-site fix
       (Q4 completion only) did not cover: morning's START branch did the
       same bare-replace wipe, caught by a reverse-order regression test
       (evening completes -> morning starts -> morning completes -> assert
       both markers coexist) rather than a test asserting the targeted
       fix's own predicted mechanism. Full finding, rehearsal evidence (two
       catalog-check rounds, 232/232 automated tests), and the runbook:
       docs/reviews/022-review-package.md §9 (the finding), §6 (catalog
       checks), §7 (test evidence).

       A cross-cutting decision was flagged, not resolved, by the CONTEXT
       DISCIPLINE fix: morning's start branch restarts an already-completed
       flow unconditionally (unchanged by 022) and the completion marker now
       SURVIVES that restart (previously it didn't) — strictly better, but a
       genuine behaviour change nothing has decided should be allowed at all.
       DECIDE-BEFORE-CRON-PR, recorded in
       docs/design-decisions-beta-feedback.md §10 (RESTART SEMANTICS).

       APPLIED TO PRODUCTION VIA SQL EDITOR on 2026-08-05, from the PINNED
       commit 6bbbc59 (git show 6bbbc59:supabase/migrations/022_evening_flow_apply_turn.sql;
       sha256 f7e1ee6dfe76bfaed27a6af416c8fcaa9c31aa87d924a353bc95206f7b23acfb).
       CLI 28P01-blocked, SQL Editor is the deliberate fallback (as with
       013-021).
       PITR observation gate (§0) — observed directly on prod before the
       apply: full rolling 7-day window, current as of observation
       (28 Jul 22:06:49 -> 04 Aug 22:06:49 IST).
       PRE-APPLY BASELINE, the rollback reference point: apply_morning_flow_turn
       on prod was confirmed still 018's body — 6981 chars,
       md5(prosrc) 6a762d496bb0e49f3fc2f29728d154bd (the catalog probe's own
       hash function, 32 hex chars — NOT sha256; mislabelled in an earlier
       draft of this entry and corrected here, same provenance-error class as
       the swapped file/hash labels caught earlier this round) — with both
       diagnostic flags (body_has_wrong_flow, morning_start_has_site1_fix)
       false, and
       apply_evening_flow_turn confirmed absent. Prod was not drifted; the
       apply exercised exactly the rehearsed paths.
       POST-APPLY VERIFICATION, observed directly on prod: ACLs on both
       functions — acl_is_default_public=false, single overload each,
       grantees limited to postgres + service_role only, no
       anon/authenticated/PUBLIC row on either. Both function bodies match
       test-db EXACTLY: apply_morning_flow_turn 8263 chars /
       md5(prosrc) fe6cc6c01f10b7e0c4d701ff8dfe66a5, apply_evening_flow_turn
       9016 chars / md5(prosrc) 08ac80270b431ddf3d94feae219fee2b (both from
       the catalog probe's md5(p.prosrc) column — not sha256; same correction
       as the pre-apply baseline above), and morning_start_has_site1_fix=true
       (the reviewer-round-2 fix confirmed live on prod, not just test-db).
       LEDGER — MISSING FROM THE ORIGINAL RUNBOOK, added retroactively. The
       022 runbook as first drafted (review package §11) had no ledger step
       at all; steps A-F never touched schema_migrations, and the raw SQL
       apply (step C) creates the function objects but records nothing in
       the ledger. Caught only when step G was reached. Manual INSERT into
       supabase_migrations.schema_migrations (version '022', name
       'evening_flow_apply_turn') — row count OBSERVED both sides, not
       asserted (§0): 18 -> 19 across the INSERT. Confirming SELECT: exactly
       one row at version '022', no duplicate, no typo'd version string.
       types re-regenerated from prod post-apply: apply_evening_flow_turn now
       present in Database['public']['Functions'] (+15 lines); tsc --noEmit
       fully clean (both known R6-gap errors gone).
       NOT closed out by this apply — genuinely OPEN: the real
       webhook-triggered apply_evening_flow_turn proof (runbook step E) is
       blocked on the webhook-wiring deliverable (review package §10) —
       nothing can reach evening's RPC via the real webhook until a cron or
       the webhook itself is wired to call it, which this migration does not
       do. "Applied" here means the migration's SQL is live and verified on
       prod, not that the feature is fully closed out end to end.

DOC GAP — RESOLVED 2026-07-27 (superseding the note first raised the same day).
Entries for 011, 012, 014, 019 and 020 are now present above, so this list IS a
complete index of the migration set: 001-007 and 011-021, with 008/009 listed as
PLANNED-NOT-BUILT (no files exist) and 010 never having existed. Two corrections
to what the original note claimed: (a) it said 011/012/014 were "described
elsewhere in the WHATSAPP BOT table notes" — they were NOT; every mention of them
was an incidental citation from another migration's entry, so the gap was larger
than recorded; (b) it assumed apply dates could be reconstructed from the review
packages. Only 012 (2026-07-05) and 020 (2026-07-25) could be. 011, 014 and 019
carry EXPLICIT "date not reconstructed" markers with evidence bounds instead of
invented dates (§0). Note that supabase_migrations.schema_migrations cannot
supply them either: every ledger INSERT used across 013-021 writes only
(version, name, statements), and this project numbers versions '001'-'021' rather
than as timestamps — so there is no date in the ledger to read. Recovering exact
days would mean the Supabase SQL Editor query history, not the database.

DOC DEBT — ALL THREE CLOSED 2026-07-27 (logged earlier the same day, fixed in a
follow-up pass). For the record, and because two of the three turned out to be
worse than logged:
  1. The stale phone_number cross-reference is corrected in place (see the dated
     correction under whatsapp_sessions). It was NOT a disagreement between two
     docs, as the debt note guessed: schema.md's own 009 entry and 012's header
     AGREE that 009 reserved it, so the "008" was an internal inconsistency
     inside this file. 012 delivered it early, guarded. The 009 entry above now
     marks that bullet as already-delivered so it stops reading as pending work.
  2. The WHATSAPP BOT header is recounted (8, with a live/Fast-Follow/never-
     created breakdown, since "active" was as wrong as "5").
  3. `### dprs` now carries a prominent DOES-NOT-EXIST marker, cross-referenced
     to the 2026-07-15 dpr_content correction and to 007's identity-surgery-only
     scope. Its old header ("NEW in migration 007") was doubly stale — 007 is
     applied and never created it; the table is now assigned to unbuilt 008.
No doc debt is currently logged against this file. Add the next one here rather
than leaving it only in a session transcript.

NOTE ON CLI MIGRATION TRACKING: migrations 001-005 were originally applied
via the Supabase dashboard SQL editor, not the CLI, so the CLI's remote
tracking table had no record of them. Before pushing 006, this was repaired
with `supabase migration repair --status applied 001` (through 005). Any
future session using `supabase db push` for the first time should run
`supabase migration list` first to confirm Local and Remote columns match
before pushing — do not let the CLI attempt to re-run 001-005.
