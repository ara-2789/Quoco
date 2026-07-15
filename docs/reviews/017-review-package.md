# Migration 017 — RLS column-bounding audit + `owner_user_id` same-tenant enforcement
## Reviewer package

> **Status: PRE-SQL.** This package is the audit + pinned pre-state + test plan for
> external review. No `017_*.sql` is written yet — it is authored *after* this
> audit is signed off and the two open items below are decided.
>
> **RISK CLASS — STRUCTURAL (updated per reviewer O2 → option A).** 017 is **no
> longer a grants-only migration.** It now carries **structural DDL**: `UNIQUE(id,
> tenant_id)` on `users` + composite FKs on `projects.owner_user_id` and
> `project_members.user_id/project_id`. The earlier "stays in 015's grants risk
> class" framing is **withdrawn** — the same-tenant guarantee is enforced by a unique
> index + FK (declarative, always-atomic), not a trigger. This raises reviewer weight
> and mandates the full runbook + PITR-window observation at apply (§0). The
> column-bounding / anon-strip parts remain grants-class and reversible.
>
> **Provenance (CLAUDE.md §0, mandatory 017-onward):** every artifact here is
> pinned to its exact source — file contents via `git show <sha>:path`, probe
> captures with the query shown directly above its raw output, suite output with
> the commit SHA echoed at top. The §3 audit table below is a *reconstruction*
> from migration files; the live probe dumps (§5) are the authoritative pre-state
> and supersede it.

---

## 1. Purpose

015 column-bounded the `users_update` self-privilege-escalation hole (HIGH-1).
017 is the **systemic follow-up**: audit every OTHER update path for the same
class of hole, and add the `owner_user_id` same-tenant enforcement deferred from
016. Gates the ENG-01 / invitations work.

---

## 2. Locked decisions + open items for the reviewer

**Locked (reviewer-confirmed):**
1. **O2 = option A, composite FK** (reviewer's call + reasoning). Same-tenant
   enforcement for `owner_user_id` and `project_members.user_id/project_id` is a
   composite FK against `UNIQUE(id, tenant_id)` on `users` / `projects`. **Why not the
   trigger:** the B1 "`FOR KEY SHARE` = same lock as the FK" claim was **false** —
   `FOR KEY SHARE` conflicts only on KEY columns, and `tenant_id` is not part of any
   unique index on `users`, so the trigger's row lock never blocks a concurrent
   `tenant_id` repoint (the exact write the TOCTOU scenario worried about). The
   composite FK's atomicity comes from the `UNIQUE(id, tenant_id)` **index**, not a
   lock mode. Carries structural DDL — see the risk-class banner.
2. **O1 = EXCLUDE `dpr_content`** (reviewer's call). Excluded from the `authenticated`
   UPDATE grant. (S2: it is a **live** column — the schema.md "dropped in 007" note was
   stale/false, corrected 2026-07-15; no drop, no `dprs` table ever happened.)
3. **F3 (reference-column binding) = Spine-only now**; Phase-2 deferred (§6).
4. **F5 (role gates / least-privilege) = deferred** to its own backlog item.

**No open items remain** — per the reviewer's own statement, the audit is signable
once these five round-2 changes land. Nothing else is awaiting a decision before the
017 SQL is authored.

---

## 3. Enforcement principle (the thesis)

Two tools, chosen by whether `authenticated` **legitimately writes** the column:

- **COLUMN-BOUND OUT** (015 `REVOKE UPDATE` + column `GRANT`): columns
  `authenticated` should *never* write. Fixed exclusion enforced at the
  column-privilege layer (SQLSTATE 42501), **upstream of RLS**. A blanket RLS
  `WITH CHECK` cannot bound columns; only the grant can.
- **SAME-TENANT COMPOSITE FK** (option A, reviewer-confirmed): columns `authenticated`
  *does* legitimately write (a PM sets them) but whose value must stay in-tenant — so
  they can't be excluded from the grant. Enforced by a composite FK
  `(tenant_id, <ref_col>) REFERENCES users(tenant_id, id)` (or `projects(tenant_id,
  id)`) backed by a `UNIQUE(id, tenant_id)` index on the parent. Atomicity is
  structural — the unique index guarantees the referenced `(tenant_id, id)` pair
  exists at commit; there is no check-then-write window to race. Enforced on ALL
  writers including the service role (an FK is not bypassed by any role), so it also
  validates legitimate writes without breaking them.

Why the split matters: `owner_user_id` / `project_members.user_id,project_id` are
PM-writable → composite FK. `tenant_id` / `created_by` / `engineer_id` / `project_id`
(daily_logs) / `dpr_approved_by` are never writable by `authenticated` → excluded.

**Composite FK removes the RLS coupling (B2a — resolved by choosing A).** The B2a
concern was that a *trigger* comparing the referenced `tenant_id` to `NEW.tenant_id`
is only a same-tenant guarantee *because RLS `WITH CHECK` pins `NEW.tenant_id`* — a
coupled pair that silently disarms if the policy loosens. The **composite FK does not
have this coupling**: it requires that a user with `(tenant_id = project.tenant_id, id
= owner_user_id)` actually EXISTS, so the owner is always in the same tenant as the
project row regardless of what RLS does with `NEW.tenant_id`. Self-contained,
RLS-independent. This is a concrete advantage of A that the B2a analysis surfaced.

---

## 4. What lands in 017 (Spine-only)

- **STRUCTURAL (composite FK, option A):**
  - `ALTER TABLE users ADD CONSTRAINT users_id_tenant_id_key UNIQUE (id, tenant_id);`
    — superset of the existing PK(`id`); builds instantly, cannot fail on existing
    data (`id` already unique ⇒ every `(id, tenant_id)` already unique).
  - `projects.owner_user_id` → composite FK `(owner_user_id, tenant_id) REFERENCES
    users(id, tenant_id)`, **MATCH SIMPLE** (the default). `owner_user_id` is
    **NULLABLE** — under MATCH SIMPLE a NULL in any FK column skips the check entirely,
    which is correct (an unassigned owner is valid). **DO NOT tighten to MATCH FULL
    later** — that would force both columns null-or-both-present and reject a null
    owner on a non-null-tenant row. Comment this explicitly in the migration.
  - `project_members.user_id` and `project_members.project_id` → composite FKs to
    `users(id, tenant_id)` and `projects(id, tenant_id)` respectively; both columns are
    **NOT NULL**, so the check is always enforced (MATCH SIMPLE vs FULL is moot here).
    (Requires `UNIQUE(id, tenant_id)` on `projects` too — same instant-build superset.)
- **COLUMN-BOUND OUT** (`REVOKE UPDATE … FROM authenticated; GRANT UPDATE(<safe>) …`):
  - `projects` → exclude `tenant_id`, `created_by`; keep `owner_user_id`
    (FK-guarded), `name`, `client_name`, `client_contact`, `status`, `contract_value`.
  - `daily_logs` → exclude `engineer_id`, `project_id`, `dpr_approved_by`, **and
    `dpr_content` (O1 = exclude)**; keep `is_holiday`, `holiday_reason`, `weather`,
    morning_/evening_ correction cols.
- **anon write-grant strip (F4)** across all tables — cheap, reversible, grants-class.
- **`tenants` DROPPED** — only risk is an admin editing their own tenant's billing
  = intra-tenant integrity = F5, no cross-tenant/escalation vector.

**Grant lists are PROVISIONING, not a live behavior change (locked: keep-as-drafted).**
A grep of `app/` + `lib/` (2026-07-15) found **zero authenticated `UPDATE` code paths**
on `projects`/`daily_logs` today — every touchpoint is a read-only `SELECT` (dashboard
`dprs` + project-detail views) or a separate `INSERT` (`projects/new`); the only writers
are the service-role morning-flow RPC and the service-role queue worker (both bypass
grants). There is **no PM-edit dashboard yet**, so the granted/excluded split changes no
current behavior under either choice — it is conservative provisioning that excludes
structural/identity + RPC-managed submission-metadata columns by default. **Forward-
pointer (also in the migration header):** when a PM-edit dashboard is built, that work
MUST consult the grant list and widen specific columns as needed (e.g. `log_date` for a
"correct submission date" feature) — the current exclusions are the safe "no writer
exists yet" default, not permanent product decisions.

**What actually protects `daily_logs` (B2b — two writers, two complementary primary
controls, not one-behind-the-other).** `daily_logs` has **two distinct writers**, and
each control is the PRIMARY guarantee for a *different* one:
- **service-role RPC path** (`apply_morning_flow_turn`, migrations 014/018) — the
  morning/evening flow sets `engineer_id`/`project_id` from server-resolved session
  state, bypassing grants. The RPC being correct is the primary guarantee here; the
  column grant can't touch this path (service role bypasses grants).
- **PM dashboard path** (an `authenticated` PM/admin/qs UPDATE) — here the
  **column-bounding IS the primary control**: it's what stops a PM repointing
  `engineer_id`/`project_id` to another (incl. cross-tenant) row. The RPC can't protect
  this path — it isn't in it.
So the grant and the RPC are **complementary primaries, one per writer** — not
defense-in-depth stacked behind the RPC. Neither is redundant; each is the sole
protection on its own writer.

---

## 5. Pinned live pre-state — probes (PROD, read-only)

> Source: `~/Desktop/017-probes.txt`. Run in the **prod** SQL Editor (confirm ref).
> Each query is pinned with its raw output directly beneath it.
>
> **PINNED (prod, this session).** All five probes are full verbatim captures (Probe 3
> is the complete `role_column_grants` dump — 614 rows (306 anon + 308 authenticated)
> — with `users` showing exactly
> `full_name`+`avatar_url` for `authenticated` and zero anon, the sole column-bounded
> table). The live captures confirm the §6 reconstruction with ZERO drift on the 20
> audited policies. Probe 6 (§7) was run to test finding F6 — see the retraction.

### Probe 1 — all RLS policies (real USING / WITH CHECK)
```sql
SELECT tablename, policyname, cmd, roles, qual AS using_expr, with_check
FROM pg_policies WHERE schemaname = 'public'
ORDER BY tablename, cmd, policyname;
```
```
tablename,policyname,cmd,roles,using_expr,with_check
boq_items,boq_items_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
boq_items,boq_items_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
boq_items,boq_items_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
boq_items,boq_items_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
boq_sessions,boq_sessions_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
boq_sessions,boq_sessions_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
boq_sessions,boq_sessions_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
boq_sessions,boq_sessions_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
daily_logs,daily_logs_insert,INSERT,{authenticated},null,"((tenant_id = get_user_tenant_id()) AND (engineer_id = ( SELECT users.id FROM users WHERE (users.auth_id = auth.uid()))))"
daily_logs,daily_logs_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
daily_logs,daily_logs_update,UPDATE,{authenticated},"((tenant_id = get_user_tenant_id()) AND ((engineer_id = ( SELECT users.id FROM users WHERE (users.auth_id = auth.uid()))) OR (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text, 'qs'::text]))))","((tenant_id = get_user_tenant_id()) AND ((engineer_id = ( SELECT users.id FROM users WHERE (users.auth_id = auth.uid()))) OR (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text, 'qs'::text]))))"
hindrances,hindrances_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
hindrances,hindrances_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
hindrances,hindrances_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
hindrances,hindrances_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
invoices,invoices_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
invoices,invoices_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
invoices,invoices_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
invoices,invoices_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
project_members,project_members_delete,DELETE,{authenticated},"((tenant_id = get_user_tenant_id()) AND (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text])))",null
project_members,project_members_insert,INSERT,{authenticated},null,"((tenant_id = get_user_tenant_id()) AND (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text])))"
project_members,project_members_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
project_members,project_members_update,UPDATE,{authenticated},"((tenant_id = get_user_tenant_id()) AND (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text])))","((tenant_id = get_user_tenant_id()) AND (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = ANY (ARRAY['pm'::text, 'admin'::text])))"
projects,projects_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
projects,projects_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
projects,projects_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
projects,projects_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
ra_bill_payments,ra_bill_payments_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
ra_bill_payments,ra_bill_payments_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
ra_bill_payments,ra_bill_payments_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
ra_bill_payments,ra_bill_payments_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
ra_bills,ra_bills_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
ra_bills,ra_bills_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
ra_bills,ra_bills_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
ra_bills,ra_bills_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
rate_catalog,rate_catalog_select,SELECT,{authenticated},true,null
rate_catalog_history,rate_catalog_history_select,SELECT,{authenticated},true,null
safety_incidents,safety_incidents_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
safety_incidents,safety_incidents_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
safety_incidents,safety_incidents_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
safety_incidents,safety_incidents_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
tenants,tenants_select,SELECT,{authenticated},(id = get_user_tenant_id()),null
tenants,tenants_update,UPDATE,{authenticated},"((id = get_user_tenant_id()) AND (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = 'admin'::text))","((id = get_user_tenant_id()) AND (( SELECT users.role FROM users WHERE (users.auth_id = auth.uid())) = 'admin'::text))"
tender_chat_messages,tender_chat_messages_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_chat_messages,tender_chat_messages_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
tender_chat_messages,tender_chat_messages_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_chat_messages,tender_chat_messages_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
tender_chat_sessions,tender_chat_sessions_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_chat_sessions,tender_chat_sessions_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
tender_chat_sessions,tender_chat_sessions_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_chat_sessions,tender_chat_sessions_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
tender_document_chunks,tender_document_chunks_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_document_chunks,tender_document_chunks_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
tender_document_chunks,tender_document_chunks_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_document_chunks,tender_document_chunks_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
tender_documents,tender_documents_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_documents,tender_documents_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
tender_documents,tender_documents_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
tender_documents,tender_documents_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
tenders,tenders_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
tenders,tenders_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
tenders,tenders_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
tenders,tenders_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
users,users_select,SELECT,{authenticated},((auth_id = auth.uid()) OR (tenant_id = get_user_tenant_id())),null
users,users_update,UPDATE,{authenticated},(auth_id = auth.uid()),(auth_id = auth.uid())
vendor_invoices,vendor_invoices_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
vendor_invoices,vendor_invoices_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
vendor_invoices,vendor_invoices_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
vendor_invoices,vendor_invoices_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
vendors,vendors_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
vendors,vendors_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
vendors,vendors_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
vendors,vendors_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())
whatsapp_sessions,whatsapp_sessions_delete,DELETE,{authenticated},(tenant_id = get_user_tenant_id()),null
whatsapp_sessions,whatsapp_sessions_insert,INSERT,{authenticated},null,(tenant_id = get_user_tenant_id())
whatsapp_sessions,whatsapp_sessions_select,SELECT,{authenticated},(tenant_id = get_user_tenant_id()),null
whatsapp_sessions,whatsapp_sessions_update,UPDATE,{authenticated},(tenant_id = get_user_tenant_id()),(tenant_id = get_user_tenant_id())

[77 policy rows. NOTE: jobs and processed_messages are ABSENT — zero RLS policies on either (see §7 F6). Multi-line qual/with_check cells flattened to single lines for embedding; semantics identical.]
```

### Probe 2 — table-level write privileges for anon/authenticated (F4)
```sql
SELECT table_name, grantee, privilege_type
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
  AND privilege_type IN ('INSERT','UPDATE','DELETE')
ORDER BY table_name, grantee, privilege_type;
```
```
table_name,grantee,privilege_type
boq_items,anon,DELETE
boq_items,anon,INSERT
boq_items,anon,UPDATE
boq_items,authenticated,DELETE
boq_items,authenticated,INSERT
boq_items,authenticated,UPDATE
boq_sessions,anon,DELETE
boq_sessions,anon,INSERT
boq_sessions,anon,UPDATE
boq_sessions,authenticated,DELETE
boq_sessions,authenticated,INSERT
boq_sessions,authenticated,UPDATE
daily_logs,anon,DELETE
daily_logs,anon,INSERT
daily_logs,anon,UPDATE
daily_logs,authenticated,DELETE
daily_logs,authenticated,INSERT
daily_logs,authenticated,UPDATE
hindrances,anon,DELETE
hindrances,anon,INSERT
hindrances,anon,UPDATE
hindrances,authenticated,DELETE
hindrances,authenticated,INSERT
hindrances,authenticated,UPDATE
invoices,anon,DELETE
invoices,anon,INSERT
invoices,anon,UPDATE
invoices,authenticated,DELETE
invoices,authenticated,INSERT
invoices,authenticated,UPDATE
jobs,anon,DELETE
jobs,anon,INSERT
jobs,anon,UPDATE
jobs,authenticated,DELETE
jobs,authenticated,INSERT
jobs,authenticated,UPDATE
processed_messages,anon,DELETE
processed_messages,anon,INSERT
processed_messages,anon,UPDATE
processed_messages,authenticated,DELETE
processed_messages,authenticated,INSERT
processed_messages,authenticated,UPDATE
project_members,anon,DELETE
project_members,anon,INSERT
project_members,anon,UPDATE
project_members,authenticated,DELETE
project_members,authenticated,INSERT
project_members,authenticated,UPDATE
projects,anon,DELETE
projects,anon,INSERT
projects,anon,UPDATE
projects,authenticated,DELETE
projects,authenticated,INSERT
projects,authenticated,UPDATE
ra_bill_payments,anon,DELETE
ra_bill_payments,anon,INSERT
ra_bill_payments,anon,UPDATE
ra_bill_payments,authenticated,DELETE
ra_bill_payments,authenticated,INSERT
ra_bill_payments,authenticated,UPDATE
ra_bills,anon,DELETE
ra_bills,anon,INSERT
ra_bills,anon,UPDATE
ra_bills,authenticated,DELETE
ra_bills,authenticated,INSERT
ra_bills,authenticated,UPDATE
rate_catalog,anon,DELETE
rate_catalog,anon,INSERT
rate_catalog,anon,UPDATE
rate_catalog,authenticated,DELETE
rate_catalog,authenticated,INSERT
rate_catalog,authenticated,UPDATE
rate_catalog_history,anon,DELETE
rate_catalog_history,anon,INSERT
rate_catalog_history,anon,UPDATE
rate_catalog_history,authenticated,DELETE
rate_catalog_history,authenticated,INSERT
rate_catalog_history,authenticated,UPDATE
safety_incidents,anon,DELETE
safety_incidents,anon,INSERT
safety_incidents,anon,UPDATE
safety_incidents,authenticated,DELETE
safety_incidents,authenticated,INSERT
safety_incidents,authenticated,UPDATE
tenants,anon,DELETE
tenants,anon,INSERT
tenants,anon,UPDATE
tenants,authenticated,DELETE
tenants,authenticated,INSERT
tenants,authenticated,UPDATE
tender_chat_messages,anon,DELETE
tender_chat_messages,anon,INSERT
tender_chat_messages,anon,UPDATE
tender_chat_messages,authenticated,DELETE
tender_chat_messages,authenticated,INSERT
tender_chat_messages,authenticated,UPDATE
tender_chat_sessions,anon,DELETE
tender_chat_sessions,anon,INSERT
tender_chat_sessions,anon,UPDATE
tender_chat_sessions,authenticated,DELETE
tender_chat_sessions,authenticated,INSERT
tender_chat_sessions,authenticated,UPDATE
tender_document_chunks,anon,DELETE
tender_document_chunks,anon,INSERT
tender_document_chunks,anon,UPDATE
tender_document_chunks,authenticated,DELETE
tender_document_chunks,authenticated,INSERT
tender_document_chunks,authenticated,UPDATE
tender_documents,anon,DELETE
tender_documents,anon,INSERT
tender_documents,anon,UPDATE
tender_documents,authenticated,DELETE
tender_documents,authenticated,INSERT
tender_documents,authenticated,UPDATE
tenders,anon,DELETE
tenders,anon,INSERT
tenders,anon,UPDATE
tenders,authenticated,DELETE
tenders,authenticated,INSERT
tenders,authenticated,UPDATE
vendor_invoices,anon,DELETE
vendor_invoices,anon,INSERT
vendor_invoices,anon,UPDATE
vendor_invoices,authenticated,DELETE
vendor_invoices,authenticated,INSERT
vendor_invoices,authenticated,UPDATE
vendors,anon,DELETE
vendors,anon,INSERT
vendors,anon,UPDATE
vendors,authenticated,DELETE
vendors,authenticated,INSERT
vendors,authenticated,UPDATE
whatsapp_sessions,anon,DELETE
whatsapp_sessions,anon,INSERT
whatsapp_sessions,anon,UPDATE
whatsapp_sessions,authenticated,DELETE
whatsapp_sessions,authenticated,INSERT
whatsapp_sessions,authenticated,UPDATE

[NOTE: users is ABSENT from this list entirely — 015 stripped all anon+authenticated write verbs from users. jobs and processed_messages DO hold the default grants but are RLS-enabled with zero policies (deny-all) — see §7 F6.]
```

### Probe 3 — column-level UPDATE grants (proves 015 is the only column-bounding)
```sql
SELECT string_agg(format('%s | %s | %s | %s', table_name, column_name, grantee, privilege_type), E'\n'
       ORDER BY table_name, column_name, grantee) AS dump
FROM information_schema.role_column_grants
WHERE table_schema='public' AND grantee IN ('anon','authenticated') AND privilege_type='UPDATE';
```
```
boq_items | adjusted_base_rate | anon | UPDATE
boq_items | adjusted_base_rate | authenticated | UPDATE
boq_items | amount | anon | UPDATE
boq_items | amount | authenticated | UPDATE
boq_items | boq_session_id | anon | UPDATE
boq_items | boq_session_id | authenticated | UPDATE
boq_items | confidence_score | anon | UPDATE
boq_items | confidence_score | authenticated | UPDATE
boq_items | created_at | anon | UPDATE
boq_items | created_at | authenticated | UPDATE
boq_items | description | anon | UPDATE
boq_items | description | authenticated | UPDATE
boq_items | description_tsv | anon | UPDATE
boq_items | description_tsv | authenticated | UPDATE
boq_items | embedding | anon | UPDATE
boq_items | embedding | authenticated | UPDATE
boq_items | final_rate | anon | UPDATE
boq_items | final_rate | authenticated | UPDATE
boq_items | id | anon | UPDATE
boq_items | id | authenticated | UPDATE
boq_items | inflation_pct | anon | UPDATE
boq_items | inflation_pct | authenticated | UPDATE
boq_items | is_approved | anon | UPDATE
boq_items | is_approved | authenticated | UPDATE
boq_items | item_code | anon | UPDATE
boq_items | item_code | authenticated | UPDATE
boq_items | location_pct | anon | UPDATE
boq_items | location_pct | authenticated | UPDATE
boq_items | margin_pct | anon | UPDATE
boq_items | margin_pct | authenticated | UPDATE
boq_items | original_row_data | anon | UPDATE
boq_items | original_row_data | authenticated | UPDATE
boq_items | pricing_reasoning | anon | UPDATE
boq_items | pricing_reasoning | authenticated | UPDATE
boq_items | pricing_status | anon | UPDATE
boq_items | pricing_status | authenticated | UPDATE
boq_items | qty_pct | anon | UPDATE
boq_items | qty_pct | authenticated | UPDATE
boq_items | quantity | anon | UPDATE
boq_items | quantity | authenticated | UPDATE
boq_items | search_layer_used | anon | UPDATE
boq_items | search_layer_used | authenticated | UPDATE
boq_items | source_date | anon | UPDATE
boq_items | source_date | authenticated | UPDATE
boq_items | source_name | anon | UPDATE
boq_items | source_name | authenticated | UPDATE
boq_items | source_rate | anon | UPDATE
boq_items | source_rate | authenticated | UPDATE
boq_items | suggested_rate | anon | UPDATE
boq_items | suggested_rate | authenticated | UPDATE
boq_items | tenant_id | anon | UPDATE
boq_items | tenant_id | authenticated | UPDATE
boq_items | unit | anon | UPDATE
boq_items | unit | authenticated | UPDATE
boq_sessions | created_at | anon | UPDATE
boq_sessions | created_at | authenticated | UPDATE
boq_sessions | created_by | anon | UPDATE
boq_sessions | created_by | authenticated | UPDATE
boq_sessions | default_margin_pct | anon | UPDATE
boq_sessions | default_margin_pct | authenticated | UPDATE
boq_sessions | id | anon | UPDATE
boq_sessions | id | authenticated | UPDATE
boq_sessions | original_columns | anon | UPDATE
boq_sessions | original_columns | authenticated | UPDATE
boq_sessions | original_file_url | anon | UPDATE
boq_sessions | original_file_url | authenticated | UPDATE
boq_sessions | priced_items | anon | UPDATE
boq_sessions | priced_items | authenticated | UPDATE
boq_sessions | project_id | anon | UPDATE
boq_sessions | project_id | authenticated | UPDATE
boq_sessions | project_location | anon | UPDATE
boq_sessions | project_location | authenticated | UPDATE
boq_sessions | status | anon | UPDATE
boq_sessions | status | authenticated | UPDATE
boq_sessions | tenant_id | anon | UPDATE
boq_sessions | tenant_id | authenticated | UPDATE
boq_sessions | tender_id | anon | UPDATE
boq_sessions | tender_id | authenticated | UPDATE
boq_sessions | total_items | anon | UPDATE
boq_sessions | total_items | authenticated | UPDATE
daily_logs | created_at | anon | UPDATE
daily_logs | created_at | authenticated | UPDATE
daily_logs | dpr_approved_by | anon | UPDATE
daily_logs | dpr_approved_by | authenticated | UPDATE
daily_logs | dpr_content | anon | UPDATE
daily_logs | dpr_content | authenticated | UPDATE
daily_logs | dpr_generated_at | anon | UPDATE
daily_logs | dpr_generated_at | authenticated | UPDATE
daily_logs | engineer_id | anon | UPDATE
daily_logs | engineer_id | authenticated | UPDATE
daily_logs | evening_dependencies | anon | UPDATE
daily_logs | evening_dependencies | authenticated | UPDATE
daily_logs | evening_equipment_utilisation | anon | UPDATE
daily_logs | evening_equipment_utilisation | authenticated | UPDATE
daily_logs | evening_output | anon | UPDATE
daily_logs | evening_output | authenticated | UPDATE
daily_logs | evening_output_quantities | anon | UPDATE
daily_logs | evening_output_quantities | authenticated | UPDATE
daily_logs | evening_productive_manpower | anon | UPDATE
daily_logs | evening_productive_manpower | authenticated | UPDATE
daily_logs | evening_schedule_met | anon | UPDATE
daily_logs | evening_schedule_met | authenticated | UPDATE
daily_logs | evening_schedule_miss_reason | anon | UPDATE
daily_logs | evening_schedule_miss_reason | authenticated | UPDATE
daily_logs | evening_submitted_at | anon | UPDATE
daily_logs | evening_submitted_at | authenticated | UPDATE
daily_logs | evening_submitted_via | anon | UPDATE
daily_logs | evening_submitted_via | authenticated | UPDATE
daily_logs | evening_workers_on_site | anon | UPDATE
daily_logs | evening_workers_on_site | authenticated | UPDATE
daily_logs | holiday_reason | anon | UPDATE
daily_logs | holiday_reason | authenticated | UPDATE
daily_logs | id | anon | UPDATE
daily_logs | id | authenticated | UPDATE
daily_logs | is_holiday | anon | UPDATE
daily_logs | is_holiday | authenticated | UPDATE
daily_logs | log_date | anon | UPDATE
daily_logs | log_date | authenticated | UPDATE
daily_logs | morning_dependencies | anon | UPDATE
daily_logs | morning_dependencies | authenticated | UPDATE
daily_logs | morning_equipment | anon | UPDATE
daily_logs | morning_equipment | authenticated | UPDATE
daily_logs | morning_execution_plan | anon | UPDATE
daily_logs | morning_execution_plan | authenticated | UPDATE
daily_logs | morning_hindrances | anon | UPDATE
daily_logs | morning_hindrances | authenticated | UPDATE
daily_logs | morning_manpower_planned | anon | UPDATE
daily_logs | morning_manpower_planned | authenticated | UPDATE
daily_logs | morning_plan | anon | UPDATE
daily_logs | morning_plan | authenticated | UPDATE
daily_logs | morning_submitted_at | anon | UPDATE
daily_logs | morning_submitted_at | authenticated | UPDATE
daily_logs | morning_submitted_via | anon | UPDATE
daily_logs | morning_submitted_via | authenticated | UPDATE
daily_logs | project_id | anon | UPDATE
daily_logs | project_id | authenticated | UPDATE
daily_logs | tenant_id | anon | UPDATE
daily_logs | tenant_id | authenticated | UPDATE
daily_logs | weather | anon | UPDATE
daily_logs | weather | authenticated | UPDATE
hindrances | area_affected | anon | UPDATE
hindrances | area_affected | authenticated | UPDATE
hindrances | created_at | anon | UPDATE
hindrances | created_at | authenticated | UPDATE
hindrances | description | anon | UPDATE
hindrances | description | authenticated | UPDATE
hindrances | dpr_included | anon | UPDATE
hindrances | dpr_included | authenticated | UPDATE
hindrances | hindrance_type | anon | UPDATE
hindrances | hindrance_type | authenticated | UPDATE
hindrances | id | anon | UPDATE
hindrances | id | authenticated | UPDATE
hindrances | impact_level | anon | UPDATE
hindrances | impact_level | authenticated | UPDATE
hindrances | photo_url | anon | UPDATE
hindrances | photo_url | authenticated | UPDATE
hindrances | project_id | anon | UPDATE
hindrances | project_id | authenticated | UPDATE
hindrances | reported_by | anon | UPDATE
hindrances | reported_by | authenticated | UPDATE
hindrances | resolved_at | anon | UPDATE
hindrances | resolved_at | authenticated | UPDATE
hindrances | resolved_by | anon | UPDATE
hindrances | resolved_by | authenticated | UPDATE
hindrances | status | anon | UPDATE
hindrances | status | authenticated | UPDATE
hindrances | submitted_via | anon | UPDATE
hindrances | submitted_via | authenticated | UPDATE
hindrances | tenant_id | anon | UPDATE
hindrances | tenant_id | authenticated | UPDATE
invoices | amount | anon | UPDATE
invoices | amount | authenticated | UPDATE
invoices | cost_head | anon | UPDATE
invoices | cost_head | authenticated | UPDATE
invoices | created_at | anon | UPDATE
invoices | created_at | authenticated | UPDATE
invoices | gstin_extracted | anon | UPDATE
invoices | gstin_extracted | authenticated | UPDATE
invoices | id | anon | UPDATE
invoices | id | authenticated | UPDATE
invoices | image_url | anon | UPDATE
invoices | image_url | authenticated | UPDATE
invoices | invoice_date | anon | UPDATE
invoices | invoice_date | authenticated | UPDATE
invoices | invoice_number | anon | UPDATE
invoices | invoice_number | authenticated | UPDATE
invoices | line_items | anon | UPDATE
invoices | line_items | authenticated | UPDATE
invoices | ocr_confidence | anon | UPDATE
invoices | ocr_confidence | authenticated | UPDATE
invoices | project_id | anon | UPDATE
invoices | project_id | authenticated | UPDATE
invoices | reviewed_at | anon | UPDATE
invoices | reviewed_at | authenticated | UPDATE
invoices | reviewed_by | anon | UPDATE
invoices | reviewed_by | authenticated | UPDATE
invoices | status | anon | UPDATE
invoices | status | authenticated | UPDATE
invoices | submitted_by | anon | UPDATE
invoices | submitted_by | authenticated | UPDATE
invoices | submitted_via | anon | UPDATE
invoices | submitted_via | authenticated | UPDATE
invoices | tenant_id | anon | UPDATE
invoices | tenant_id | authenticated | UPDATE
invoices | vendor_id | anon | UPDATE
invoices | vendor_id | authenticated | UPDATE
invoices | vendor_name | anon | UPDATE
invoices | vendor_name | authenticated | UPDATE
jobs | attempt_count | anon | UPDATE
jobs | attempt_count | authenticated | UPDATE
jobs | completed_at | anon | UPDATE
jobs | completed_at | authenticated | UPDATE
jobs | created_at | anon | UPDATE
jobs | created_at | authenticated | UPDATE
jobs | id | anon | UPDATE
jobs | id | authenticated | UPDATE
jobs | last_error | anon | UPDATE
jobs | last_error | authenticated | UPDATE
jobs | next_retry_at | anon | UPDATE
jobs | next_retry_at | authenticated | UPDATE
jobs | payload | anon | UPDATE
jobs | payload | authenticated | UPDATE
jobs | status | anon | UPDATE
jobs | status | authenticated | UPDATE
jobs | type | anon | UPDATE
jobs | type | authenticated | UPDATE
processed_messages | created_at | anon | UPDATE
processed_messages | created_at | authenticated | UPDATE
processed_messages | id | anon | UPDATE
processed_messages | id | authenticated | UPDATE
processed_messages | message_sid | anon | UPDATE
processed_messages | message_sid | authenticated | UPDATE
processed_messages | processed_at | anon | UPDATE
processed_messages | processed_at | authenticated | UPDATE
project_members | created_at | anon | UPDATE
project_members | created_at | authenticated | UPDATE
project_members | id | anon | UPDATE
project_members | id | authenticated | UPDATE
project_members | project_id | anon | UPDATE
project_members | project_id | authenticated | UPDATE
project_members | role | anon | UPDATE
project_members | role | authenticated | UPDATE
project_members | tenant_id | anon | UPDATE
project_members | tenant_id | authenticated | UPDATE
project_members | user_id | anon | UPDATE
project_members | user_id | authenticated | UPDATE
projects | client_contact | anon | UPDATE
projects | client_contact | authenticated | UPDATE
projects | client_name | anon | UPDATE
projects | client_name | authenticated | UPDATE
projects | contract_type | anon | UPDATE
projects | contract_type | authenticated | UPDATE
projects | contract_value | anon | UPDATE
projects | contract_value | authenticated | UPDATE
projects | created_at | anon | UPDATE
projects | created_at | authenticated | UPDATE
projects | created_by | anon | UPDATE
projects | created_by | authenticated | UPDATE
projects | expected_end_date | anon | UPDATE
projects | expected_end_date | authenticated | UPDATE
projects | id | anon | UPDATE
projects | id | authenticated | UPDATE
projects | name | anon | UPDATE
projects | name | authenticated | UPDATE
projects | owner_user_id | anon | UPDATE
projects | owner_user_id | authenticated | UPDATE
projects | project_type | anon | UPDATE
projects | project_type | authenticated | UPDATE
projects | site_address | anon | UPDATE
projects | site_address | authenticated | UPDATE
projects | start_date | anon | UPDATE
projects | start_date | authenticated | UPDATE
projects | status | anon | UPDATE
projects | status | authenticated | UPDATE
projects | tenant_id | anon | UPDATE
projects | tenant_id | authenticated | UPDATE
projects | tender_id | anon | UPDATE
projects | tender_id | authenticated | UPDATE
ra_bill_payments | amount_received | anon | UPDATE
ra_bill_payments | amount_received | authenticated | UPDATE
ra_bill_payments | created_at | anon | UPDATE
ra_bill_payments | created_at | authenticated | UPDATE
ra_bill_payments | id | anon | UPDATE
ra_bill_payments | id | authenticated | UPDATE
ra_bill_payments | notes | anon | UPDATE
ra_bill_payments | notes | authenticated | UPDATE
ra_bill_payments | payment_date | anon | UPDATE
ra_bill_payments | payment_date | authenticated | UPDATE
ra_bill_payments | payment_reference | anon | UPDATE
ra_bill_payments | payment_reference | authenticated | UPDATE
ra_bill_payments | ra_bill_id | anon | UPDATE
ra_bill_payments | ra_bill_id | authenticated | UPDATE
ra_bill_payments | tenant_id | anon | UPDATE
ra_bill_payments | tenant_id | authenticated | UPDATE
ra_bills | advance_recovery | anon | UPDATE
ra_bills | advance_recovery | authenticated | UPDATE
ra_bills | approved_at | anon | UPDATE
ra_bills | approved_at | authenticated | UPDATE
ra_bills | bill_number | anon | UPDATE
ra_bills | bill_number | authenticated | UPDATE
ra_bills | created_at | anon | UPDATE
ra_bills | created_at | authenticated | UPDATE
ra_bills | gross_amount | anon | UPDATE
ra_bills | gross_amount | authenticated | UPDATE
ra_bills | id | anon | UPDATE
ra_bills | id | authenticated | UPDATE
ra_bills | net_payable | anon | UPDATE
ra_bills | net_payable | authenticated | UPDATE
ra_bills | period_from | anon | UPDATE
ra_bills | period_from | authenticated | UPDATE
ra_bills | period_to | anon | UPDATE
ra_bills | period_to | authenticated | UPDATE
ra_bills | project_id | anon | UPDATE
ra_bills | project_id | authenticated | UPDATE
ra_bills | retention_deduction | anon | UPDATE
ra_bills | retention_deduction | authenticated | UPDATE
ra_bills | status | anon | UPDATE
ra_bills | status | authenticated | UPDATE
ra_bills | submitted_at | anon | UPDATE
ra_bills | submitted_at | authenticated | UPDATE
ra_bills | tenant_id | anon | UPDATE
ra_bills | tenant_id | authenticated | UPDATE
rate_catalog | base_rate | anon | UPDATE
rate_catalog | base_rate | authenticated | UPDATE
rate_catalog | created_at | anon | UPDATE
rate_catalog | created_at | authenticated | UPDATE
rate_catalog | description | anon | UPDATE
rate_catalog | description | authenticated | UPDATE
rate_catalog | description_tsv | anon | UPDATE
rate_catalog | description_tsv | authenticated | UPDATE
rate_catalog | effective_date | anon | UPDATE
rate_catalog | effective_date | authenticated | UPDATE
rate_catalog | embedding | anon | UPDATE
rate_catalog | embedding | authenticated | UPDATE
rate_catalog | expiry_date | anon | UPDATE
rate_catalog | expiry_date | authenticated | UPDATE
rate_catalog | id | anon | UPDATE
rate_catalog | id | authenticated | UPDATE
rate_catalog | is_active | anon | UPDATE
rate_catalog | is_active | authenticated | UPDATE
rate_catalog | item_code | anon | UPDATE
rate_catalog | item_code | authenticated | UPDATE
rate_catalog | rate_max | anon | UPDATE
rate_catalog | rate_max | authenticated | UPDATE
rate_catalog | rate_min | anon | UPDATE
rate_catalog | rate_min | authenticated | UPDATE
rate_catalog | source_name | anon | UPDATE
rate_catalog | source_name | authenticated | UPDATE
rate_catalog | state_code | anon | UPDATE
rate_catalog | state_code | authenticated | UPDATE
rate_catalog | trade_category | anon | UPDATE
rate_catalog | trade_category | authenticated | UPDATE
rate_catalog | unit | anon | UPDATE
rate_catalog | unit | authenticated | UPDATE
rate_catalog_history | catalog_id | anon | UPDATE
rate_catalog_history | catalog_id | authenticated | UPDATE
rate_catalog_history | created_at | anon | UPDATE
rate_catalog_history | created_at | authenticated | UPDATE
rate_catalog_history | id | anon | UPDATE
rate_catalog_history | id | authenticated | UPDATE
rate_catalog_history | location | anon | UPDATE
rate_catalog_history | location | authenticated | UPDATE
rate_catalog_history | notes | anon | UPDATE
rate_catalog_history | notes | authenticated | UPDATE
rate_catalog_history | recorded_date | anon | UPDATE
rate_catalog_history | recorded_date | authenticated | UPDATE
rate_catalog_history | recorded_rate | anon | UPDATE
rate_catalog_history | recorded_rate | authenticated | UPDATE
rate_catalog_history | source_url | anon | UPDATE
rate_catalog_history | source_url | authenticated | UPDATE
safety_incidents | created_at | anon | UPDATE
safety_incidents | created_at | authenticated | UPDATE
safety_incidents | description | anon | UPDATE
safety_incidents | description | authenticated | UPDATE
safety_incidents | id | anon | UPDATE
safety_incidents | id | authenticated | UPDATE
safety_incidents | incident_type | anon | UPDATE
safety_incidents | incident_type | authenticated | UPDATE
safety_incidents | injury_status | anon | UPDATE
safety_incidents | injury_status | authenticated | UPDATE
safety_incidents | investigation_notes | anon | UPDATE
safety_incidents | investigation_notes | authenticated | UPDATE
safety_incidents | location | anon | UPDATE
safety_incidents | location | authenticated | UPDATE
safety_incidents | ocr_confidence | anon | UPDATE
safety_incidents | ocr_confidence | authenticated | UPDATE
safety_incidents | photo_url | anon | UPDATE
safety_incidents | photo_url | authenticated | UPDATE
safety_incidents | pm_notified_at | anon | UPDATE
safety_incidents | pm_notified_at | authenticated | UPDATE
safety_incidents | project_id | anon | UPDATE
safety_incidents | project_id | authenticated | UPDATE
safety_incidents | reported_by | anon | UPDATE
safety_incidents | reported_by | authenticated | UPDATE
safety_incidents | resolved_at | anon | UPDATE
safety_incidents | resolved_at | authenticated | UPDATE
safety_incidents | resolved_by | anon | UPDATE
safety_incidents | resolved_by | authenticated | UPDATE
safety_incidents | status | anon | UPDATE
safety_incidents | status | authenticated | UPDATE
safety_incidents | submitted_via | anon | UPDATE
safety_incidents | submitted_via | authenticated | UPDATE
safety_incidents | tenant_id | anon | UPDATE
safety_incidents | tenant_id | authenticated | UPDATE
tenants | annual_turnover | anon | UPDATE
tenants | annual_turnover | authenticated | UPDATE
tenants | cin | anon | UPDATE
tenants | cin | authenticated | UPDATE
tenants | created_at | anon | UPDATE
tenants | created_at | authenticated | UPDATE
tenants | gstin | anon | UPDATE
tenants | gstin | authenticated | UPDATE
tenants | id | anon | UPDATE
tenants | id | authenticated | UPDATE
tenants | iso_certifications | anon | UPDATE
tenants | iso_certifications | authenticated | UPDATE
tenants | last_payment_ref | anon | UPDATE
tenants | last_payment_ref | authenticated | UPDATE
tenants | name | anon | UPDATE
tenants | name | authenticated | UPDATE
tenants | paid_until | anon | UPDATE
tenants | paid_until | authenticated | UPDATE
tenants | payment_customer_id | anon | UPDATE
tenants | payment_customer_id | authenticated | UPDATE
tenants | plan | anon | UPDATE
tenants | plan | authenticated | UPDATE
tenants | profile_complete | anon | UPDATE
tenants | profile_complete | authenticated | UPDATE
tenants | pwd_class | anon | UPDATE
tenants | pwd_class | authenticated | UPDATE
tenants | registered_address | anon | UPDATE
tenants | registered_address | authenticated | UPDATE
tenants | slug | anon | UPDATE
tenants | slug | authenticated | UPDATE
tenants | trial_ends_at | anon | UPDATE
tenants | trial_ends_at | authenticated | UPDATE
tender_chat_messages | citations | anon | UPDATE
tender_chat_messages | citations | authenticated | UPDATE
tender_chat_messages | content | anon | UPDATE
tender_chat_messages | content | authenticated | UPDATE
tender_chat_messages | created_at | anon | UPDATE
tender_chat_messages | created_at | authenticated | UPDATE
tender_chat_messages | id | anon | UPDATE
tender_chat_messages | id | authenticated | UPDATE
tender_chat_messages | retrieved_chunk_ids | anon | UPDATE
tender_chat_messages | retrieved_chunk_ids | authenticated | UPDATE
tender_chat_messages | role | anon | UPDATE
tender_chat_messages | role | authenticated | UPDATE
tender_chat_messages | session_id | anon | UPDATE
tender_chat_messages | session_id | authenticated | UPDATE
tender_chat_messages | tenant_id | anon | UPDATE
tender_chat_messages | tenant_id | authenticated | UPDATE
tender_chat_messages | token_count | anon | UPDATE
tender_chat_messages | token_count | authenticated | UPDATE
tender_chat_sessions | created_at | anon | UPDATE
tender_chat_sessions | created_at | authenticated | UPDATE
tender_chat_sessions | id | anon | UPDATE
tender_chat_sessions | id | authenticated | UPDATE
tender_chat_sessions | last_message_at | anon | UPDATE
tender_chat_sessions | last_message_at | authenticated | UPDATE
tender_chat_sessions | status | anon | UPDATE
tender_chat_sessions | status | authenticated | UPDATE
tender_chat_sessions | system_prompt | anon | UPDATE
tender_chat_sessions | system_prompt | authenticated | UPDATE
tender_chat_sessions | tenant_id | anon | UPDATE
tender_chat_sessions | tenant_id | authenticated | UPDATE
tender_chat_sessions | tender_id | anon | UPDATE
tender_chat_sessions | tender_id | authenticated | UPDATE
tender_chat_sessions | title | anon | UPDATE
tender_chat_sessions | title | authenticated | UPDATE
tender_chat_sessions | user_id | anon | UPDATE
tender_chat_sessions | user_id | authenticated | UPDATE
tender_document_chunks | chunk_index | anon | UPDATE
tender_document_chunks | chunk_index | authenticated | UPDATE
tender_document_chunks | chunk_text | anon | UPDATE
tender_document_chunks | chunk_text | authenticated | UPDATE
tender_document_chunks | chunk_tsv | anon | UPDATE
tender_document_chunks | chunk_tsv | authenticated | UPDATE
tender_document_chunks | created_at | anon | UPDATE
tender_document_chunks | created_at | authenticated | UPDATE
tender_document_chunks | embedding | anon | UPDATE
tender_document_chunks | embedding | authenticated | UPDATE
tender_document_chunks | embedding_model | anon | UPDATE
tender_document_chunks | embedding_model | authenticated | UPDATE
tender_document_chunks | id | anon | UPDATE
tender_document_chunks | id | authenticated | UPDATE
tender_document_chunks | page_number | anon | UPDATE
tender_document_chunks | page_number | authenticated | UPDATE
tender_document_chunks | tenant_id | anon | UPDATE
tender_document_chunks | tenant_id | authenticated | UPDATE
tender_document_chunks | tender_document_id | anon | UPDATE
tender_document_chunks | tender_document_id | authenticated | UPDATE
tender_document_chunks | token_count | anon | UPDATE
tender_document_chunks | token_count | authenticated | UPDATE
tender_documents | created_at | anon | UPDATE
tender_documents | created_at | authenticated | UPDATE
tender_documents | document_type | anon | UPDATE
tender_documents | document_type | authenticated | UPDATE
tender_documents | embedding_model | anon | UPDATE
tender_documents | embedding_model | authenticated | UPDATE
tender_documents | file_name | anon | UPDATE
tender_documents | file_name | authenticated | UPDATE
tender_documents | file_type | anon | UPDATE
tender_documents | file_type | authenticated | UPDATE
tender_documents | file_url | anon | UPDATE
tender_documents | file_url | authenticated | UPDATE
tender_documents | id | anon | UPDATE
tender_documents | id | authenticated | UPDATE
tender_documents | processing_status | anon | UPDATE
tender_documents | processing_status | authenticated | UPDATE
tender_documents | tenant_id | anon | UPDATE
tender_documents | tenant_id | authenticated | UPDATE
tender_documents | tender_id | anon | UPDATE
tender_documents | tender_id | authenticated | UPDATE
tender_documents | vector_chunks_count | anon | UPDATE
tender_documents | vector_chunks_count | authenticated | UPDATE
tenders | ai_summary | anon | UPDATE
tenders | ai_summary | authenticated | UPDATE
tenders | clarifications | anon | UPDATE
tenders | clarifications | authenticated | UPDATE
tenders | client_name | anon | UPDATE
tenders | client_name | authenticated | UPDATE
tenders | created_at | anon | UPDATE
tenders | created_at | authenticated | UPDATE
tenders | created_by | anon | UPDATE
tenders | created_by | authenticated | UPDATE
tenders | estimated_value | anon | UPDATE
tenders | estimated_value | authenticated | UPDATE
tenders | id | anon | UPDATE
tenders | id | authenticated | UPDATE
tenders | qualification_flags | anon | UPDATE
tenders | qualification_flags | authenticated | UPDATE
tenders | status | anon | UPDATE
tenders | status | authenticated | UPDATE
tenders | submission_deadline | anon | UPDATE
tenders | submission_deadline | authenticated | UPDATE
tenders | tenant_id | anon | UPDATE
tenders | tenant_id | authenticated | UPDATE
tenders | title | anon | UPDATE
tenders | title | authenticated | UPDATE
users | avatar_url | authenticated | UPDATE
users | full_name | authenticated | UPDATE
vendor_invoices | amount | anon | UPDATE
vendor_invoices | amount | authenticated | UPDATE
vendor_invoices | created_at | anon | UPDATE
vendor_invoices | created_at | authenticated | UPDATE
vendor_invoices | due_date | anon | UPDATE
vendor_invoices | due_date | authenticated | UPDATE
vendor_invoices | id | anon | UPDATE
vendor_invoices | id | authenticated | UPDATE
vendor_invoices | invoice_date | anon | UPDATE
vendor_invoices | invoice_date | authenticated | UPDATE
vendor_invoices | invoice_number | anon | UPDATE
vendor_invoices | invoice_number | authenticated | UPDATE
vendor_invoices | notes | anon | UPDATE
vendor_invoices | notes | authenticated | UPDATE
vendor_invoices | payment_date | anon | UPDATE
vendor_invoices | payment_date | authenticated | UPDATE
vendor_invoices | project_id | anon | UPDATE
vendor_invoices | project_id | authenticated | UPDATE
vendor_invoices | status | anon | UPDATE
vendor_invoices | status | authenticated | UPDATE
vendor_invoices | tenant_id | anon | UPDATE
vendor_invoices | tenant_id | authenticated | UPDATE
vendor_invoices | vendor_id | anon | UPDATE
vendor_invoices | vendor_id | authenticated | UPDATE
vendors | auto_extracted | anon | UPDATE
vendors | auto_extracted | authenticated | UPDATE
vendors | bank_details | anon | UPDATE
vendors | bank_details | authenticated | UPDATE
vendors | created_at | anon | UPDATE
vendors | created_at | authenticated | UPDATE
vendors | email | anon | UPDATE
vendors | email | authenticated | UPDATE
vendors | gstin | anon | UPDATE
vendors | gstin | authenticated | UPDATE
vendors | id | anon | UPDATE
vendors | id | authenticated | UPDATE
vendors | name | anon | UPDATE
vendors | name | authenticated | UPDATE
vendors | needs_verification | anon | UPDATE
vendors | needs_verification | authenticated | UPDATE
vendors | phone | anon | UPDATE
vendors | phone | authenticated | UPDATE
vendors | rating | anon | UPDATE
vendors | rating | authenticated | UPDATE
vendors | status | anon | UPDATE
vendors | status | authenticated | UPDATE
vendors | tenant_id | anon | UPDATE
vendors | tenant_id | authenticated | UPDATE
vendors | trade_category | anon | UPDATE
vendors | trade_category | authenticated | UPDATE
whatsapp_sessions | context | anon | UPDATE
whatsapp_sessions | context | authenticated | UPDATE
whatsapp_sessions | created_at | anon | UPDATE
whatsapp_sessions | created_at | authenticated | UPDATE
whatsapp_sessions | current_flow | anon | UPDATE
whatsapp_sessions | current_flow | authenticated | UPDATE
whatsapp_sessions | current_step | anon | UPDATE
whatsapp_sessions | current_step | authenticated | UPDATE
whatsapp_sessions | expires_at | anon | UPDATE
whatsapp_sessions | expires_at | authenticated | UPDATE
whatsapp_sessions | id | anon | UPDATE
whatsapp_sessions | id | authenticated | UPDATE
whatsapp_sessions | pending_flows | anon | UPDATE
whatsapp_sessions | pending_flows | authenticated | UPDATE
whatsapp_sessions | phone_number | anon | UPDATE
whatsapp_sessions | phone_number | authenticated | UPDATE
whatsapp_sessions | tenant_id | anon | UPDATE
whatsapp_sessions | tenant_id | authenticated | UPDATE
whatsapp_sessions | updated_at | anon | UPDATE
whatsapp_sessions | updated_at | authenticated | UPDATE
whatsapp_sessions | user_id | anon | UPDATE
whatsapp_sessions | user_id | authenticated | UPDATE
```

**Reading:** `users` appears with EXACTLY two rows — `avatar_url | authenticated` and
`full_name | authenticated`, **zero anon rows** — the sole column-bounded table (015).
Every other table lists all columns for BOTH `anon` and `authenticated` (blanket).
`jobs`/`processed_messages` show column grants here but are RLS-enabled with zero
policies (default-deny) — see §7 F6.

### Probe 4 — projects.owner_user_id FK shape
```sql
SELECT conname, contype, confdeltype, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.projects'::regclass AND contype = 'f'
ORDER BY conname;
```
```
conname,contype,confdeltype,definition
projects_created_by_fkey,f,a,FOREIGN KEY (created_by) REFERENCES users(id)
projects_owner_user_id_fkey,f,r,FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
projects_tenant_id_fkey,f,c,FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE

[owner_user_id: confdeltype='r' (RESTRICT), plain single-column FK -> users(id), NO tenant term. Confirms the 016 gap: same-tenant is not enforced by the FK. created_by='a' (NO ACTION), tenant_id='c' (CASCADE).]
```

### Probe 5 — full F3 reference-binding surface (every FK into users/projects)
```sql
SELECT conrelid::regclass AS table_name, conname,
       pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'f'
  AND confrelid IN ('public.users'::regclass, 'public.projects'::regclass)
  AND connamespace = 'public'::regnamespace
ORDER BY table_name, conname;
```
```
table_name,conname,definition
projects,projects_created_by_fkey,FOREIGN KEY (created_by) REFERENCES users(id)
projects,projects_owner_user_id_fkey,FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
project_members,project_members_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
project_members,project_members_user_id_fkey,FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
whatsapp_sessions,whatsapp_sessions_user_id_fkey,FOREIGN KEY (user_id) REFERENCES users(id)
daily_logs,daily_logs_engineer_id_fkey,FOREIGN KEY (engineer_id) REFERENCES users(id)
daily_logs,daily_logs_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)
safety_incidents,safety_incidents_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)
safety_incidents,safety_incidents_reported_by_fkey,FOREIGN KEY (reported_by) REFERENCES users(id)
invoices,invoices_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)
invoices,invoices_reviewed_by_fkey,FOREIGN KEY (reviewed_by) REFERENCES users(id)
invoices,invoices_submitted_by_fkey,FOREIGN KEY (submitted_by) REFERENCES users(id)
hindrances,hindrances_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)
hindrances,hindrances_reported_by_fkey,FOREIGN KEY (reported_by) REFERENCES users(id)
tenders,tenders_created_by_fkey,FOREIGN KEY (created_by) REFERENCES users(id)
tender_chat_sessions,tender_chat_sessions_user_id_fkey,FOREIGN KEY (user_id) REFERENCES users(id)
boq_sessions,boq_sessions_created_by_fkey,FOREIGN KEY (created_by) REFERENCES users(id)
boq_sessions,boq_sessions_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)
vendor_invoices,vendor_invoices_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)
ra_bills,ra_bills_project_id_fkey,FOREIGN KEY (project_id) REFERENCES projects(id)

[Every FK into users/projects is a plain single-column FK — no composite/same-tenant enforcement anywhere. Spine binding surface (017 scope): projects.owner_user_id, project_members.user_id, project_members.project_id (composite FK, option A); daily_logs.engineer_id, daily_logs.project_id (column-bound). whatsapp_sessions.user_id = F3 NO-ACTION (service-role-only writer, §7). Remainder = Phase-2 deferred.]
```

---

## 6. §3 audit table (reconstruction — superseded by §5 when pinned)

> **ROUND-2 SUPERSEDING NOTE — the table below is the original reconstruction and
> still says "TRIGGER" and carries pre-round-2 rationale. The AUTHORITATIVE
> dispositions are §2/§4. Corrections that override the cells below:**
> - **Rows 3 & 4 (`owner_user_id`, `project_members.user_id/project_id`):** enforced by
>   **composite FK (option A)**, not a trigger — see §2/§3/§4. 017 carries structural DDL.
> - **Row 6 (`daily_logs`) rationale corrected (O1 + reviewer task 3):** drop the
>   "engineer forge on own row" justification entirely — it is **dead code**: engineers
>   have `auth_id = NULL`, no web login (CLAUDE.md §5), and never hold an `authenticated`
>   session, so an engineer can never reach this policy as `authenticated` (the same
>   "dead-but-denying" pattern as 007's `engineer_id = auth.uid()` finding). The **real**
>   justification: the only `authenticated` writers of `daily_logs` are **pm/admin/qs**;
>   a PM-editable DPR narrative is **Fast-Follow, not Spine**, so `dpr_content` is
>   **excluded now (O1)** and re-granted behind a **role gate** if/when that ships. The
>   column-bounding is the **primary control on the PM path** (B2b), not defense-in-depth.

```
========================================================================
Migration 017 — §3 AUDIT TABLE: every UPDATE policy, every table
========================================================================
SOURCE: reconstructed from migration files — 002 (baseline) as modified by
007 (auth-surgery policy rewrites, id -> auth_id), 015 (users column-grant),
016 (owner_user_id FK). This is NOT a live pg_policies dump; the live probes
(017-probes.txt) produce the authoritative pinned pre-state that supersedes
this reconstruction per CLAUDE.md §0.

All policies are FOR UPDATE TO authenticated. Reference columns = FK columns
confirmed in 001_core_schema.sql. Class in {FIXED, CROSS-TENANT (F3), BENIGN}.
"Col-bounded?" = does a COLUMN-level GRANT restrict writable columns (the 015
mechanism), vs. a blanket table grant where only RLS WITH CHECK constrains.

DECISIONS LOCKED (this session):
  (1) owner_user_id enforcement = TRIGGER (option B). No table/column/constraint
      change, reversible (DROP TRIGGER/FUNCTION), stays in 015's risk class.
      Composite FK (option A) noted as the reviewer-override for a stronger
      always-on guarantee (needs UNIQUE(id,tenant_id) on users = structural DDL,
      deliberately avoided).
  (2) F3 (reference-column binding) = Spine-only now; Phase-2 deferred w/ rationale.
  (3) F5 (role gates / least-privilege) = deferred to its own backlog item, NOT 017.
  (4) Column-bound exclusion sets = user reviews line-by-line before SQL.

------------------------------------------------------------------------------------------------------------------------
#   Table (_update)          Row gate (USING / WITH CHECK)                         Col-bnd?  Exposed sensitive columns (blanket-writable)                         Verdict                         Spine? / 017 disposition
------------------------------------------------------------------------------------------------------------------------
1   tenants                  id=tenant AND actor.role=admin                        No        paid_until, payment_customer_id, last_payment_ref                     BENIGN x-tenant (id pinned);    NOT IN 017 — dropped. Only risk
                                                                                             (admin self-extends own subscription)                                LOW/MED integrity (F5)          is admin editing OWN tenant's
                                                                                                                                                                                                  billing = intra-tenant integrity
                                                                                                                                                                                                  = F5 (deferred). No cross-tenant
                                                                                                                                                                                                  /escalation vector -> out of a
                                                                                                                                                                                                  security migration's scope.

2   users                    auth_id = auth.uid()                                  YES (015) — (role, tenant_id, auth_id, status EXCLUDED;                        FIXED — reference pattern       Spine — regression guard only
                                                                                   GRANT UPDATE(full_name, avatar_url))

3   projects                 tenant_id = get_user_tenant_id()  [NO role gate]      No        owner_user_id -> users (X-TENANT, 016 gap), created_by -> users,      CROSS-TENANT (F3, HIGH)         Spine — owner_user_id TRIGGER +
                                                                                             client_name, client_contact, contract_value, status                                                 column-bound in 017

4   project_members          tenant_id AND actor.role IN (pm, admin)               No        user_id -> users (X-TENANT), project_id -> projects (X-TENANT)        CROSS-TENANT (F3)               Spine — same-tenant TRIGGER
                                                                                             [both legit PM-writable -> trigger, not column-bound]                                                (user_id + project_id) in 017.
                                                                                                                                                                                                  Load-bearing for ENG-01/invites.

5   whatsapp_sessions        tenant_id = get_user_tenant_id()                      No        user_id -> users, phone_number, context, current_flow                BENIGN (tenant pinned;          Spine — NO ACTION (F3 explicit).
                                                                                             [user_id is a plain FK -> users(id), Probe 5 -- same F3 class as       ephemeral; real writes =        See F3 disposition note below for
                                                                                              owner_user_id, but see disposition]                                  service role)                   whatsapp_sessions.user_id.

6   daily_logs               tenant_id AND (engineer_id = me                       No        engineer_id -> users (pm repoint, X-TENANT), project_id -> projects,  CROSS-TENANT (F3) +             Spine — COLUMN-BOUND OUT
                             OR actor.role IN (pm, admin, qs))                               dpr_approved_by -> users, dpr_content (Fast-Follow, not Spine)        CROSS-TENANT (F3, PM path)      engineer_id, project_id,
                                                                                             [authenticated writers = pm/admin/qs ONLY; see §6-head row-6 note]                                   dpr_approved_by, dpr_content
                                                                                                                                                                                                  (O1) in 017. Column-bound is the
                                                                                                                                                                                                  PRIMARY control on the PM path
                                                                                                                                                                                                  (B2b), not DiD.

7   safety_incidents         tenant_id = get_user_tenant_id()                      No        project_id, reported_by, reviewed_by (refs); severity, submitted_via  BENIGN x-tenant; LOW integrity  Fast-Follow — defer

8   invoices                 tenant_id = get_user_tenant_id()                      No        project_id, submitted_by, reviewed_by (refs); amount, status         BENIGN x-tenant;                Fast-Follow — defer (F5)
                                                                                             (any member edits money — no role gate)                              MED integrity

9   hindrances               tenant_id = get_user_tenant_id()                      No        project_id, reported_by (refs); description, dpr_included             BENIGN x-tenant; LOW            Fast-Follow — defer

10  tenders                  tenant_id = get_user_tenant_id()                      No        created_by -> users; title, status                                   BENIGN x-tenant                 Phase-2 — defer

11  tender_documents         tenant_id = get_user_tenant_id()                      No        tender_id -> tenders                                                  BENIGN x-tenant                 Phase-2 — defer

12  tender_document_chunks   tenant_id = get_user_tenant_id()                      No        tender_document_id -> tender_documents; embedding                    BENIGN x-tenant                 Phase-2 — defer

13  tender_chat_sessions     tenant_id = get_user_tenant_id()                      No        tender_id -> tenders, user_id -> users                               BENIGN x-tenant                 Phase-2 — defer

14  tender_chat_messages     tenant_id = get_user_tenant_id()                      No        session_id -> tender_chat_sessions                                   BENIGN x-tenant                 Phase-2 — defer

15  boq_sessions             tenant_id = get_user_tenant_id()                      No        tender_id, project_id, created_by (refs)                             BENIGN x-tenant                 Phase-2 — defer

16  boq_items                tenant_id = get_user_tenant_id()                      No        boq_session_id -> boq_sessions, catalog_id -> rate_catalog           BENIGN x-tenant                 Phase-2 — defer

17  vendors                  tenant_id = get_user_tenant_id()                      No        name, contact                                                        BENIGN x-tenant                 Phase-2 — defer

18  vendor_invoices          tenant_id = get_user_tenant_id()                      No        project_id, vendor_id (refs); amount                                 BENIGN x-tenant; MED integrity  Phase-2 — defer

19  ra_bills                 tenant_id = get_user_tenant_id()                      No        project_id -> projects; gross_amount, net_payable                    BENIGN x-tenant; MED integrity  Phase-2 — defer

20  ra_bill_payments         tenant_id = get_user_tenant_id()                      No        ra_bill_id -> ra_bills; amount_received                              BENIGN x-tenant; MED integrity  Phase-2 — defer
------------------------------------------------------------------------------------------------------------------------

READING OF THE TABLE
  - Exactly ONE column-bounded UPDATE policy exists today: users (015).
  - Every other UPDATE policy is blanket; it is safe against tenant_id-hop ONLY
    because WITH CHECK re-pins the row's own tenant_id. (users was the lone
    exception — its check keyed on auth_id, not tenant_id — closed by 015.)
  - Role self-escalation exists only on users.role (closed by 015); no other
    table has a privilege column.
  - The genuinely OPEN cross-tenant vector is F3 REFERENCE-COLUMN BINDING:
    WITH CHECK pins the row's own tenant_id but NEVER the tenant of the entity a
    FK column points at. Sharp instances (Spine): #3 owner_user_id (drives owner
    DPR delivery scope -> exfil to a foreign owner), #4 user_id/project_id,
    #6 engineer_id. All plain single-column FKs (001) — no same-tenant enforcement.
  - Billing/money integrity notes (#1, #8, #18-20) are intra-tenant least-privilege
    -> F5, deferred.

ENFORCEMENT PRINCIPLE (the reviewer-facing thesis — removes every question mark)
  Two tools, chosen by whether authenticated LEGITIMATELY writes the column:
  - COLUMN-BOUND OUT (015 REVOKE + column GRANT): columns authenticated should
    NEVER write. Fixed exclusion at the privilege layer (42501, upstream of RLS).
    Cols: tenant_id, created_by, engineer_id, project_id, dpr_approved_by.
  - SAME-TENANT TRIGGER (option B): columns authenticated DOES legitimately write
    (a PM sets them) but whose value must stay in-tenant, so they can't be excluded
    from the grant. Cols: projects.owner_user_id, project_members.user_id,
    project_members.project_id. Trigger raises if the referenced row's tenant_id
    <> NEW.tenant_id. Fires regardless of service role (only RLS is bypassed), so
    it also validates legitimate writes without breaking them.
    [Reviewer-override: option A composite FK for a declarative always-on guarantee
     — needs UNIQUE(id,tenant_id) on users = structural DDL, deliberately avoided.]

WHAT LANDS IN 017 (Spine-only; column sets below for line-by-line review)
  - SAME-TENANT TRIGGER on: projects.owner_user_id (INSERT+UPDATE),
    project_members.user_id + project_members.project_id (INSERT+UPDATE).
  - COLUMN-BOUND OUT (REVOKE UPDATE + re-GRANT the safe cols) on:
      projects     -> exclude tenant_id, created_by (keep owner_user_id [trigger-
                      guarded], name, client_name, client_contact, status, contract_value)
      daily_logs   -> exclude engineer_id, project_id, dpr_approved_by
                      (keep is_holiday, holiday_reason, weather, the morning_/
                       evening_ correction cols)
                      >>> OPEN — FLAGGED FOR REVIEWER INPUT: dpr_content. Keep
                          (PM edits DPR narrative) vs exclude (DPR body is
                          generated, not hand-edited by authenticated). NOT
                          silently decided — reviewer chooses. <<<
  - anon write-grant strip (F4) across all tables — cheap, reversible, no schema change.
  - tenants: DROPPED (see #1) — no cross-tenant risk, F5-deferred.

F3 NO-ACTION, STATED EXPLICITLY (not silently skipped)
  - whatsapp_sessions.user_id -> users(id) [plain FK, Probe 5]: technically the
    same F3 reference-binding class, BUT no enforcement in 017. Rationale: the ONLY
    writer of whatsapp_sessions is the service role (webhook + the 011-014 RPCs and
    018 / Morning Flow Pass 2), which bypasses RLS AND column grants AND is trusted to set user_id
    correctly — identical reasoning to daily_logs.dpr_approved_by. No authenticated
    path writes user_id, so there is no caller for a trigger to constrain; adding
    one would guard a door no untrusted actor can reach. If a future authenticated
    write path to whatsapp_sessions is added, revisit. (Row #5.)

DEFERRED (written rationale for the reviewer package)
  - F3 Phase-2 reference cols (#10-20): probes 2/3 CONFIRM these tables carry the
    same blanket exposure (anon + authenticated hold table + column write grants,
    no column-bounding). The deferral is NOT "no exposure" — it is: the feature is
    UNSHIPPED and the tables are currently UNREACHABLE (no flow, no rows, no app
    path), so live blast radius is zero today. Revisit and enforce as part of the
    Phase-2 build, before those tables carry real data.
  - F5 least-privilege / role gates + intra-tenant integrity (#1 tenants billing,
    #8/#18-20 money): a distinct least-privilege workstream, not the cross-tenant
    class 017 targets.
```

---

## 7. F3 no-action + deferral rationale

**F3 NO-ACTION, stated explicitly (not silently skipped):**
- `whatsapp_sessions.user_id → users(id)` [plain FK, Probe 5]: same F3 class, but
  **no enforcement in 017**. Consistent with the `daily_logs` framing (B2b): the
  **real protection is that the sole writer is the service-role path** — the webhook
  and the session/queue/idempotency RPCs (migrations 011–014) and the morning-flow
  RPC (migration 014, extended by **018 — Morning Flow Pass 2, merged `05cdf2a`**),
  which bypass RLS and grants and are trusted to set `user_id` from server-resolved
  state. There is **no `authenticated` write path** to `whatsapp_sessions.user_id`, so
  (unlike `daily_logs`) there isn't even a direct REST surface to column-bound or a
  caller for a trigger to constrain — hence no-action rather than defense-in-depth.
  Revisit if a future authenticated write path to `whatsapp_sessions` is added.

**Deferred:**
- **F3 Phase-2 reference cols (#10–20):** probes 2/3 confirm these tables carry the
  same blanket exposure (anon + authenticated hold table + column write grants).
  The deferral is NOT "no exposure" — it is: the feature is unshipped and the
  tables are currently unreachable (no flow, no rows, no app path), so live blast
  radius is zero today. Enforce as part of the Phase-2 build, before real data.
- **F5 least-privilege / role gates + intra-tenant integrity (#1 tenants billing,
  #8/#18–20 money):** a distinct least-privilege workstream, not the cross-tenant
  class 017 targets.

**F6 — investigated during the audit, RETRACTED (false positive; diligence shown
deliberately):**
- Investigated during the audit, retracted — RLS is enabled on `jobs`/`processed_messages`
  (Probe 6: `relrowsecurity=true`) via an untracked out-of-band dashboard action, with
  zero policies defined, meaning default-deny applies regardless of the anon/authenticated
  grants Probe 2/3 show. Not a live hole.
- **How the false positive arose (recorded so the miss is legible):** F6 was first
  raised by inferring RLS state from the *migration files* — `jobs`(006)/`processed_messages`(011)
  are `CREATE TABLE`-only with no `ENABLE RLS` and are absent from 002's enable list —
  combined with Probe 2's grants and Probe 1's zero policies. That inverted RLS
  semantics: with RLS ENABLED a grant is necessary-but-not-sufficient (a permissive
  policy must also exist), so "grants + no policy" is the fail-CLOSED state, not open.
  It was caught PRE-IMPLEMENTATION because Probe 6 was required before any SQL was drafted.
- **Probe 6 (RLS status):**
```sql
SELECT relname, relrowsecurity, relforcerowsecurity
FROM pg_class WHERE relnamespace='public'::regnamespace
  AND relname IN ('jobs','processed_messages') ORDER BY relname;
```
```
relname             | relrowsecurity | relforcerowsecurity
jobs                | true           | (as returned)
processed_messages  | true           | (as returned)
```
- **Code cross-check:** every access routes through the service-role client
  (`lib/queue/jobs.ts` ×6, `lib/whatsapp/idempotency.ts`); no authenticated/anon path.
- **Residual (TRACKED + PRIORITIZED — not casual; reframed per reviewer S3):** the
  RLS-enabled-with-default-deny state on `jobs`/`processed_messages` exists **only as
  untracked prod dashboard state**. A db rebuild / branch-reset / DR-restore from the
  migration set would come up with these tables **RLS-DISABLED and all Probe-2/3 grants
  live** — i.e. the very anon/authenticated write+read exposure F6 first suspected,
  now real in any rebuilt environment. A migration to codify `ENABLE ROW LEVEL
  SECURITY` (+ deny-by-default) on both tables is **required before any future
  environment rebuild, branch reset, or DR restore is trusted.** Not blocking 017, but
  a tracked, prioritized backlog item — NOT housekeeping. (Own migration number, own
  small package.)

---

## 8. Test plan — negative-control per finding (015 model)

Pattern per finding: **prove the hole OPEN pre-fix** (a raw `authenticated` client
statement that succeeds today) **and CLOSED post-fix** (same statement rejected).
**Assertions key on `error.code` (SQLSTATE), never message text (N2)** — matching
015's T-015-01/02/03 (`expect(error?.code).toBe('42501')`): column-bounding rejections
assert `42501` (insufficient_privilege); the **composite-FK** rejections assert
**`23503` (foreign_key_violation)** — the same pattern as 016's T-016-07, which asserts
`23503` on the `owner_user_id` dangling-FK insert. (Option A is an FK, not a trigger, so
there is no custom `RAISE`/`ERRCODE` to pin.) Run on the test-db branch
(`exfccwlrhoutkgrlikod`) against the two-tenant fixture (`TEST_TENANT_A/B`, as used by
T-007-03/07/08). Estimated ~14–18 new tests.

**Order (N3): the service-role RPC regression runs FIRST.** Its failure means the bot
has stopped working for every engineer (morning/evening flows can't write) — a far
larger blast radius than any single hole staying open — so it is the canary, not an
afterthought at the bottom of the list.

| ID | Finding | Pre-fix (open) | Post-fix (closed) |
|----|---------|----------------|-------------------|
| **T-017-01** | **REGRESSION (CANARY — runs first): service-role RPC** | — | morning-flow RPC still writes `engineer_id`/`project_id` (grants + FK do NOT block a same-tenant service-role write). Failure ⇒ bot down for all engineers. |
| T-017-02 | `projects.owner_user_id` x-tenant (UPDATE) | tenant-A user sets `owner_user_id` = tenant-B user id → succeeds | FK violation `23503` |
| T-017-03 | `projects.owner_user_id` x-tenant (INSERT) | same via INSERT → succeeds | FK violation `23503` |
| T-017-04 | `projects.owner_user_id` SAME-tenant (happy path) | — | still succeeds (no false-positive) |
| T-017-05 | `project_members.user_id` x-tenant (UPDATE+INSERT) | pm binds tenant-B user → succeeds | FK violation `23503` |
| T-017-06 | `project_members.project_id` x-tenant | pm points membership at tenant-B project → succeeds | FK violation `23503` |
| T-017-07 | `projects` column-bound | authenticated UPDATE of `tenant_id`/`created_by` → succeeds | `42501` |
| T-017-08 | `daily_logs` column-bound | authenticated UPDATE of `engineer_id`/`project_id`/`dpr_approved_by` → succeeds | `42501` |
| T-017-09 | anon write strip (F4) | (default grants present) | anon UPDATE rejected |
| T-017-10 | REGRESSION: 015 users protections | — | role/tenant_id UPDATE still `42501` |
| T-017-11 | REGRESSION: legitimate writes | — | pm renames project, user sets full_name → succeed |

(`dpr_content` gets a column-bound test only if O1 resolves to "exclude".)

---

## 9. Pinning checklist (before reviewer hand-off)

- [x] §5 probe outputs = pinned prod captures (all five full verbatim; Probe 3 =
      complete 614-row role_column_grants dump; 306 anon + 308 authenticated). Zero
      drift vs the §6 reconstruction. [B3: the earlier "613" was a wc -l undercount —
      the dump's last line has no trailing newline; live count(*) to be re-confirmed = 614.]
- [x] F6 investigated + retracted (Probe 6), residual reproducibility item recorded.
- [x] O1 = EXCLUDE `dpr_content`; O2 = option A (composite FK). Reviewer-confirmed, folded.
- [x] Round-2 (B1/B2/B3/S1/S2/S3/N1–N3) folded; 018 ledger/order verified (S2/N1).
- [x] Live `count(*)` on prod = 614 (B3) — confirmed this session (operator-run,
      relayed to reviewer); matches the pinned dump's 614.
- [ ] 017 SQL authored, pinned via `git show <sha>:supabase/migrations/017_*.sql`.
- [ ] Negative-control suite run, SHA echoed at top, green post-fix.
- [ ] PITR restore-window observation recorded at prod apply (§0).

---

## 10. Reviewer FINAL LOOK — authored SQL + branch-verify (tip `69dac1a`; supersedes 34e65fd)

> The reviewer's round-2 sign-off was of the **plan/audit**. This section is the
> **actual implementation** for a final look before prod — he explicitly asked to
> see the MATCH SIMPLE null-semantics handling and the corrected exclusions in the
> real SQL. Risk class is **STRUCTURAL** (composite FK + UNIQUE index DDL), per §2.

### 10.1 Branch-verify (test-db `exfccwlrhoutkgrlikod`) — RAW artifacts (SF1)

Real vitest output, not a summary. Two captures; SHA echoed at the top of each.
(T-017-12 was added in the BF1/SF2/SF3 fix round, so it appears only in the
post-apply capture; the pre-apply capture predates it.)

**PRE-APPLY (holes open) — commit `34e65fd`, full suite:**
```
Test Files  1 failed | 9 passed (10)
     Tests  7 failed | 95 passed (102)
FAIL T-017-02  owner_user_id x-tenant UPDATE is rejected (23503)   [expected null not to be null]
FAIL T-017-03  owner_user_id x-tenant INSERT is rejected (23503)   [expected null not to be null]
FAIL T-017-05  project_members.user_id x-tenant INSERT (23503)     [expected null not to be null]
FAIL T-017-06  project_members.project_id x-tenant INSERT (23503)  [expected null not to be null]
FAIL T-017-07  projects.created_by -> 42501                        [expected null not to be null]
FAIL T-017-08  daily_logs.engineer_id -> 42501                     [expected null not to be null]
FAIL T-017-09  anon UPDATE rejected                                [expected null not to be null]
PASS T-017-01 (canary), T-017-04 (same-tenant happy), T-017-10 (015 regr), T-017-11 (legit)
```
The 7 reds are precisely the 017-introduced protections, open pre-fix.

**POST-APPLY (holes closed) — commit `69dac1a`, T-017 file:**
```
# commit: 69dac1a7118f8ccfbab2fb6a9a879e837d681b4f
# target: test-db branch exfccwlrhoutkgrlikod
 ✓ T-017-01 (canary): service-role morning RPC still writes engineer_id/project_id
 ✓ T-017-02: owner_user_id x-tenant UPDATE is rejected (23503)
 ✓ T-017-03: owner_user_id x-tenant INSERT is rejected (23503)
 ✓ T-017-04: owner_user_id SAME-tenant UPDATE still succeeds
 ✓ T-017-05: project_members.user_id x-tenant INSERT is rejected (23503)
 ✓ T-017-06: project_members.project_id x-tenant INSERT is rejected (23503)
 ✓ T-017-07: authenticated UPDATE of projects.created_by -> 42501
 ✓ T-017-08: authenticated UPDATE of daily_logs.engineer_id -> 42501
 ✓ T-017-09: anon UPDATE of projects is rejected
 ✓ T-017-10 (regression 015): authenticated UPDATE of users.role -> 42501
 ✓ T-017-11 (regression): legitimate authenticated writes still succeed
 ✓ T-017-12 (SF3): tenant-move of a referenced owner is rejected by NO ACTION (23503)
 Test Files  1 passed (1)   Tests  12 passed (12)
```
Full-suite post-apply = 103/103 (91 prior + 12 T-017). Zero collateral.

**Probes A1/B/C (§10.4): NOT yet run — operator SQL-Editor step.** They read
`pg_constraint` / `information_schema`, which PostgREST does not expose (service key
hits the REST API, not the catalog) and the CLI is IPv6-blocked — the same wall as
every probe this session. The suite's behavioral green (T-017-02..06, 12 all pass) is
autonomous proof the composite FKs exist and enforce; the catalog probes are the
pinned confirmation and must be run in the SQL Editor. NOT faked here.

### 10.2 Grant lists — LOCKED keep-as-drafted (provisioning, not behavior change)
A grep of `app/` + `lib/` found **zero authenticated UPDATE code paths** on
`projects`/`daily_logs` (read-only SELECT + a separate INSERT flow only; sole writers
are the service-role morning RPC + queue worker). No PM-edit dashboard exists → the
granted/excluded split changes no current behavior; excluding structural/identity +
RPC-metadata columns is the conservative default. Full classification: §4 +
`~/Desktop/017-grant-lists.txt`. Forward-pointer (also in the SQL header): a future
PM-edit dashboard MUST widen specific columns (e.g. `log_date`) as features need them.

### 10.3 Final authored SQL — pinned `git show 34e65fd:supabase/migrations/017_rls_column_bounding.sql`
Note for the reviewer: **Step 2** carries the MATCH SIMPLE decision + the explicit
DO-NOT-tighten-to-MATCH-FULL note on the nullable `owner_user_id`; **Steps 3/4** carry
the corrected exclusion sets (`contract_value` not `budget`; `dpr_content` excluded).

```sql
-- supabase/migrations/017_rls_column_bounding.sql
-- SECURITY — systemic follow-up to 015/HIGH-1. 015 column-bounded users_update;
-- 017 closes the same CLASS of hole on every other UPDATE path, and adds the
-- owner_user_id same-tenant enforcement deferred from 016 (backlog item 9).
-- Full audit + pinned prod pre-state: docs/reviews/017-review-package.md.
--
-- RISK CLASS: STRUCTURAL (NOT grants-only). Per reviewer O2 = option A, the
-- same-tenant guarantee is a UNIQUE index + composite FK, not a trigger. So this
-- migration carries structural DDL (a new unique constraint + FK swaps) and takes
-- the full runbook: PITR restore-window OBSERVED at prod apply (CLAUDE.md §0),
-- reviewer-gated. The column-bounding / anon-strip steps are grants-class + reversible.
--
-- WHY COMPOSITE FK, NOT TRIGGER (reviewer B1): a BEFORE-trigger doing
-- `SELECT ... FOR KEY SHARE` on the referenced user does NOT close the TOCTOU race —
-- FOR KEY SHARE conflicts only on KEY columns, and tenant_id is not part of any
-- unique index on users, so the lock never blocks a concurrent tenant_id repoint
-- (the exact write the race worried about). The composite FK's atomicity comes from
-- the UNIQUE(id, tenant_id) INDEX. NOTE the FK does not *permit-and-cascade* a
-- referenced-tenant_id change — with ON UPDATE NO ACTION (Step 2) it REJECTS that
-- write (fails loud with an FK violation), which is correct given tenant_id's
-- immutability (007 §9): the guarantee is "no dangling cross-tenant reference can
-- exist," not "cross-tenant moves are handled." The FK is also RLS-independent
-- (unlike the trigger, whose correctness was coupled to RLS WITH CHECK on NEW.tenant_id).
--
-- APPLY: dashboard SQL Editor (CLI IPv6/28P01-blocked, see docs/schema.md 013 note),
-- branch-verified first, artifact-provenance-pinned per §0. Regenerate types after.
--
-- ROLLBACK (reversible; no data loss): drop the composite FKs and re-add the plain
-- single-column FKs; drop the UNIQUE(id, tenant_id) constraints; restore the blanket
-- table UPDATE grants (GRANT UPDATE ON projects, daily_logs TO authenticated) and the
-- anon write verbs. Down path spelled out at the file end.
--
-- COLUMN-GRANT LISTS ARE PROVISIONING, NOT A LIVE BEHAVIOR CHANGE (locked decision,
-- keep-as-drafted). A grep of app/ + lib/ (2026-07-15) found ZERO authenticated UPDATE
-- code paths on projects or daily_logs today: every touchpoint is a read-only SELECT
-- (dashboard dprs/project-detail views) or a separate INSERT flow (projects/new); the
-- only writers are the service-role morning-flow RPC (bypasses grants) and the
-- service-role queue worker. There is NO PM-edit dashboard yet. So the granted/excluded
-- split in Steps 3/4 changes no current behavior under EITHER choice — it is
-- conservative provisioning for a future feature, excluding structural/identity and
-- RPC-managed submission-metadata columns by default. Grant classification:
-- ~/Desktop/017-grant-lists.txt / §4 of the review package.
--   *** FORWARD-POINTER: when a PM-edit dashboard is eventually built, that work MUST
--   consult this grant list and widen specific columns as needed (e.g. GRANT UPDATE
--   (log_date) if a "correct submission date" feature ships). Do not assume the
--   current exclusions are permanent product decisions — they are the safe default
--   for "no writer exists yet." ***

BEGIN;

-- =============================================================================
-- STEP 1 — UNIQUE(id, tenant_id) parents for the composite FKs.
-- Both are strict SUPERSETS of the existing PRIMARY KEY(id): since id is already
-- unique, every (id, tenant_id) pair is already unique, so these build instantly
-- and CANNOT fail on existing data. They exist solely to be FK-referenceable.
-- =============================================================================
ALTER TABLE public.users
  ADD CONSTRAINT users_id_tenant_id_key UNIQUE (id, tenant_id);

ALTER TABLE public.projects
  ADD CONSTRAINT projects_id_tenant_id_key UNIQUE (id, tenant_id);

-- =============================================================================
-- STEP 2 — Composite same-tenant FKs (option A). Drop each plain single-column FK
-- and re-add it as a composite FK that also pins tenant_id, so the referenced row
-- MUST live in the same tenant as the referencing row. Enforced on ALL writers
-- (incl. service role — an FK is not bypassed by any role).
--
-- ON UPDATE NO ACTION is stated EXPLICITLY on all three (BF1) — it is the default,
-- but here it is an INTENTIONAL CHOICE, not an omission: tenant_id is immutable
-- post-creation per 007 §9 (one auth account <-> one tenant, forever — a tenant-move
-- is NOT a modeled operation), so no legitimate path ever UPDATEs a referenced
-- (id, tenant_id) key and there is nothing for a cascade to do. If a referenced
-- tenant_id ever WERE updated, NO ACTION correctly REJECTS it (fails loud with an FK
-- violation) rather than silently cascading a tenant-move nobody designed.
--   *** FORWARD-POINTER: a future tenant-move / tenant-merge feature MUST revisit ALL
--   THREE FKs (projects.owner_user_id, project_members.user_id, project_members.
--   project_id) before shipping — with NO ACTION, the tenant_id UPDATE will be
--   rejected with an FK violation that surfaces on the *referenced* table (users /
--   projects), which reads as a confusing error on an unrelated table if unexpected. ***

-- projects.owner_user_id -> users(id, tenant_id).
-- MATCH SIMPLE (the default): owner_user_id is NULLABLE, and under MATCH SIMPLE a
-- NULL in ANY referencing column skips the check entirely — correct, because an
-- unassigned owner (NULL) is a valid state. *** DO NOT change to MATCH FULL later ***:
-- MATCH FULL would require both columns null-or-both-present and would reject a NULL
-- owner on a (non-null) tenant row. Preserves 016's ON DELETE RESTRICT.
ALTER TABLE public.projects DROP CONSTRAINT projects_owner_user_id_fkey;
ALTER TABLE public.projects
  ADD CONSTRAINT projects_owner_user_id_fkey
  FOREIGN KEY (owner_user_id, tenant_id) REFERENCES public.users (id, tenant_id)
  ON UPDATE NO ACTION ON DELETE RESTRICT;

-- project_members.user_id -> users(id, tenant_id). user_id is NOT NULL, so the check
-- is ALWAYS enforced (MATCH SIMPLE vs FULL is moot). Preserves ON DELETE CASCADE.
ALTER TABLE public.project_members DROP CONSTRAINT project_members_user_id_fkey;
ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_user_id_fkey
  FOREIGN KEY (user_id, tenant_id) REFERENCES public.users (id, tenant_id)
  ON UPDATE NO ACTION ON DELETE CASCADE;

-- project_members.project_id -> projects(id, tenant_id). NOT NULL, always enforced.
ALTER TABLE public.project_members DROP CONSTRAINT project_members_project_id_fkey;
ALTER TABLE public.project_members
  ADD CONSTRAINT project_members_project_id_fkey
  FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects (id, tenant_id)
  ON UPDATE NO ACTION ON DELETE CASCADE;

-- =============================================================================
-- STEP 3 — COLUMN-BOUND OUT: projects. Revoke the blanket table UPDATE from
-- authenticated and re-grant ONLY the PM-editable business columns. Excluded (never
-- authenticated-writable): tenant_id, created_by (attribution), id, created_at
-- (structural/immutable). owner_user_id stays writable but is FK-guarded (Step 2).
-- 42501 (upstream of RLS) now rejects any UPDATE touching an excluded column.
-- =============================================================================
REVOKE UPDATE ON public.projects FROM authenticated;
GRANT  UPDATE (
  name, client_name, client_contact, contract_type, contract_value,
  expected_end_date, project_type, site_address, start_date, status,
  tender_id, owner_user_id
) ON public.projects TO authenticated;

-- =============================================================================
-- STEP 4 — COLUMN-BOUND OUT: daily_logs. Authenticated writers are pm/admin/qs
-- corrections (engineers have auth_id=NULL, no web login — CLAUDE.md §5). Grant the
-- observational / correction columns only. Excluded: engineer_id, project_id
-- (identity — FK repoint surface), dpr_approved_by, dpr_content (O1 = exclude; DPR
-- narrative editing is Fast-Follow, re-grant behind a role gate if/when it ships),
-- dpr_generated_at + *_submitted_at/_via (RPC-managed submission metadata), id,
-- tenant_id, created_at, log_date (structural/identity).
-- =============================================================================
REVOKE UPDATE ON public.daily_logs FROM authenticated;
GRANT  UPDATE (
  is_holiday, holiday_reason, weather,
  morning_plan, morning_manpower_planned, morning_equipment,
  morning_execution_plan, morning_dependencies, morning_hindrances,
  evening_output, evening_output_quantities, evening_productive_manpower,
  evening_schedule_met, evening_schedule_miss_reason, evening_workers_on_site,
  evening_equipment_utilisation, evening_dependencies
) ON public.daily_logs TO authenticated;

-- =============================================================================
-- STEP 5 — F4 anon write-strip (defense-in-depth, across ALL public tables).
-- anon has no write policy today so this is not exploitable now, but the privilege
-- layer should bound what it can bound (015's thesis). Strips anon INSERT/UPDATE/
-- DELETE on every base table in public. Idempotent.
--
-- F4 IS NOT F6 (SF2 — different layers, do not conflate). This step operates on the
-- GRANT layer (table privileges); F6 is about the RLS layer (relrowsecurity) on
-- jobs/processed_messages. Stripping anon write-grants here neither substitutes for
-- nor interacts with F6's RLS-enable state — a table can be RLS-enabled yet still
-- carry stray grants, or grant-stripped yet RLS-disabled. F6 remains its own
-- separate migration; this step does not close or affect it.
-- SELECT is untouched (no anon SELECT policy exists; reads stay RLS-denied).
-- rate_catalog / rate_catalog_history are read-only reference tables (SELECT-only
-- policy, USING(true)); verified (SF2) NO code path or seed/import script writes them
-- as anon (only writers would be service-role/admin loads), so revoking anon writes
-- here breaks nothing.
-- =============================================================================
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('REVOKE INSERT, UPDATE, DELETE ON public.%I FROM anon;', r.tablename);
  END LOOP;
END $$;

COMMIT;

-- =============================================================================
-- DOWN (manual; run only to roll back):
--   BEGIN;
--   -- Step 2 reverse: restore plain single-column FKs
--   ALTER TABLE public.project_members DROP CONSTRAINT project_members_project_id_fkey;
--   ALTER TABLE public.project_members ADD CONSTRAINT project_members_project_id_fkey
--     FOREIGN KEY (project_id) REFERENCES public.projects(id) ON DELETE CASCADE;
--   ALTER TABLE public.project_members DROP CONSTRAINT project_members_user_id_fkey;
--   ALTER TABLE public.project_members ADD CONSTRAINT project_members_user_id_fkey
--     FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;
--   ALTER TABLE public.projects DROP CONSTRAINT projects_owner_user_id_fkey;
--   ALTER TABLE public.projects ADD CONSTRAINT projects_owner_user_id_fkey
--     FOREIGN KEY (owner_user_id) REFERENCES public.users(id) ON DELETE RESTRICT;
--   -- Step 1 reverse
--   ALTER TABLE public.projects DROP CONSTRAINT projects_id_tenant_id_key;
--   ALTER TABLE public.users   DROP CONSTRAINT users_id_tenant_id_key;
--   -- Step 3/4 reverse: restore blanket table UPDATE
--   GRANT UPDATE ON public.projects   TO authenticated;
--   GRANT UPDATE ON public.daily_logs TO authenticated;
--   -- Step 5 reverse (only if a rebuild needs the Supabase defaults back):
--   -- GRANT INSERT, UPDATE, DELETE ON <tables> TO anon;
--   COMMIT;
-- =============================================================================
```

### 10.4 Post-apply probes (drafted, HOLD — not yet run on prod)
Constraint-existence for the composite FKs + UNIQUE parents, the narrowed Probe-3
grant re-run, and the F4 anon-strip count. Full file: `/tmp/017-post-apply-probes.txt`.

```
================================================================
Migration 017 — POST-APPLY probes (read-only). HOLD — do NOT run against
prod until the pinned apply is done. Run in the SQL Editor pointed at the
target (branch first, then prod), paste each result under its query. Pinned
verification per CLAUDE.md §0.
================================================================


------------------------------------------------------------
Probe A1 — composite FKs present with the (id, tenant_id) reference
------------------------------------------------------------
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN (
  'projects_owner_user_id_fkey',
  'project_members_user_id_fkey',
  'project_members_project_id_fkey'
)
ORDER BY conname;

-- EXPECTED (each is now COMPOSITE, referencing (id, tenant_id)):
--  project_members_project_id_fkey | FOREIGN KEY (project_id, tenant_id) REFERENCES projects(id, tenant_id) ON DELETE CASCADE
--  project_members_user_id_fkey    | FOREIGN KEY (user_id, tenant_id)    REFERENCES users(id, tenant_id)    ON DELETE CASCADE
--  projects_owner_user_id_fkey     | FOREIGN KEY (owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT
-- STOP if any still reads as a single-column FK (id only) — the drop/re-add didn't take.


------------------------------------------------------------
Probe A2 — UNIQUE(id, tenant_id) parents present
------------------------------------------------------------
SELECT conrelid::regclass AS table_name, conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conname IN ('users_id_tenant_id_key', 'projects_id_tenant_id_key')
ORDER BY conname;

-- EXPECTED:
--  projects_id_tenant_id_key | UNIQUE (id, tenant_id)
--  users_id_tenant_id_key    | UNIQUE (id, tenant_id)


------------------------------------------------------------
Probe B — narrowed column grants (Probe-3 re-run, projects + daily_logs)
------------------------------------------------------------
SELECT string_agg(format('%s | %s', table_name, column_name), E'\n'
       ORDER BY table_name, column_name) AS granted
FROM information_schema.role_column_grants
WHERE table_schema = 'public' AND grantee = 'authenticated'
  AND privilege_type = 'UPDATE' AND table_name IN ('projects', 'daily_logs');

-- EXPECTED — projects (12 granted): client_contact, client_name, contract_type,
--   contract_value, expected_end_date, name, owner_user_id, project_type,
--   site_address, start_date, status, tender_id
--   ABSENT (excluded): tenant_id, created_by, id, created_at
-- EXPECTED — daily_logs (17 granted): evening_dependencies,
--   evening_equipment_utilisation, evening_output, evening_output_quantities,
--   evening_productive_manpower, evening_schedule_met, evening_schedule_miss_reason,
--   evening_workers_on_site, holiday_reason, is_holiday, morning_dependencies,
--   morning_equipment, morning_execution_plan, morning_hindrances,
--   morning_manpower_planned, morning_plan, weather
--   ABSENT (excluded): engineer_id, project_id, dpr_approved_by, dpr_content,
--   dpr_generated_at, morning_submitted_at, morning_submitted_via,
--   evening_submitted_at, evening_submitted_via, id, tenant_id, created_at, log_date
-- STOP if any excluded column appears, or any expected granted column is missing.


------------------------------------------------------------
Probe C — F4 anon write-strip (anon holds NO write verb on any public table)
------------------------------------------------------------
SELECT count(*) AS anon_write_grants
FROM information_schema.table_privileges
WHERE table_schema = 'public' AND grantee = 'anon'
  AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE');

-- EXPECTED: 0  (pre-017 this was 3 per table x ~24 tables; F4 revoked all of them)
-- Optional detail (if count != 0, list what survived):
--   SELECT table_name, privilege_type FROM information_schema.table_privileges
--   WHERE table_schema='public' AND grantee='anon'
--     AND privilege_type IN ('INSERT','UPDATE','DELETE') ORDER BY table_name, privilege_type;


------------------------------------------------------------
Probe D — composite-FK action semantics (confupdtype / confdeltype per FK)
------------------------------------------------------------
SELECT conname, confupdtype, confdeltype
FROM pg_constraint
WHERE conname IN (
  'projects_owner_user_id_fkey',
  'project_members_user_id_fkey',
  'project_members_project_id_fkey'
)
ORDER BY conname;

-- EXPECTED (per FK):
--   project_members_project_id_fkey | confupdtype='a' | confdeltype='c'
--   project_members_user_id_fkey    | confupdtype='a' | confdeltype='c'
--   projects_owner_user_id_fkey     | confupdtype='a' | confdeltype='r'
-- confupdtype: 'a' = NO ACTION (all three, BF1). confdeltype: 'r' = RESTRICT
-- (owner_user_id, preserving 016), 'c' = CASCADE (both project_members FKs).
-- NOTE: confupdtype='a' confirms RUNTIME SEMANTICS only. NO ACTION is the Postgres
-- default, so the catalog cannot distinguish an explicit clause from an implicit one
-- ('a' either way). The EXPLICITNESS of `ON UPDATE NO ACTION` (BF1) is proven by the
-- pinned 69dac1a DDL (sha256 in the E-017-02 pin), NOT by this probe.
```

### §10.4 — Errata (2026-07-15)

Errata discipline: additive dated corrections; the original §10.4 text above is
left intact.

**E-017-01 — Probe status clarified (no captured probe evidence exists yet).** The
original §10.4 correctly marks probes A1/A2/B/C as "drafted, HOLD — not yet run."
Reaffirming and sharpening that, to prevent any misreading downstream:
- Probes A1, A2, B, C have **NO CAPTURED OUTPUT anywhere in this package** — not from
  prod, not from the test-db branch. An operator-side SQL-Editor run on the branch is
  reported but was never pasted back or pinned; it is treated as **unverified** and is
  **SUPERSEDED ENTIRELY by the re-rehearsal captures in step 1 of the revised
  sequence**.
- **Probe D** (`confupdtype`/`confdeltype` per FK) is **authored below (§10.4), not yet
  run**.
- The only **PINNED** evidence today is **behavioral, not catalog-level**: suite
  T-017-02..06 + T-017-12 (green at `69dac1a`, §10.1) exercise the FK rejections, and
  T-017-12 specifically exercises the `ON UPDATE NO ACTION` tenant-move rejection. The
  catalog probes (A1/A2/B/C/D) remain the outstanding *definition-level* confirmation.
- These probes are required at **two** points, neither yet done: (a) branch rehearsal
  of the exact prod body, and (b) prod post-apply.

**E-017-02 — Rehearsal-body delta disclosed (OPEN, not yet closed).** The test-db
branch was applied once, from the **pre-BF1 body (`34e65fd`)**. The body pinned for
the prod apply is **`69dac1a`** (adds explicit `ON UPDATE NO ACTION` per BF1). The two
are **behaviorally identical** — `ON UPDATE NO ACTION` is the Postgres default, which
`pg_get_constraintdef` omits either way — so the branch's live FK behavior already
matches `69dac1a`, and the suite is green against it. **However:** the exact `69dac1a`
text has **not been executed in any environment**. This delta is therefore **disclosed
but NOT closed**; a re-rehearsal of the `69dac1a` body on the branch (clean apply +
probe captures + suite green) is **outstanding**.

Deterministic body pin (verifiable now; independent of any environment):
```
$ git show 69dac1a:supabase/migrations/017_rls_column_bounding.sql | shasum -a 256
7b06ed81c9f0ca8602c0a694c600593d20b2a04c1bc68e7be2997f168b5255a5  -
```

**Revised apply sequence (outstanding steps flagged):**
1. [OUTSTANDING] Branch re-rehearsal of the pinned `69dac1a` body — re-apply on the
   test-db branch, capture raw apply log, run A1/A2/B/C/D in the SQL Editor, suite
   green. Closes E-017-02 and supersedes any prior unpinned probe run (E-017-01).
2. [OUTSTANDING] Reviewer final sign-off on the real (branch) evidence.
3. [OUTSTANDING] PITR restore-window observation on prod (CLAUDE.md §0).
4. [OUTSTANDING] Pinned prod apply (`/tmp/017-pinned-prod-apply.txt`, body `69dac1a`,
   sha256 above).
5. [OUTSTANDING] Re-run A1/A2/B/C/D on prod, raw output captured.
6. [OUTSTANDING] Ledger row for `017` — manual INSERT into
   `supabase_migrations.schema_migrations` (the CLI `migration repair` is 28P01-blocked
   for this project; manual INSERT is the real method) — then regenerate types, then
   the schema.md 017 entry after the ledger confirms.
