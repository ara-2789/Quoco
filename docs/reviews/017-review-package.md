# Migration 017 — RLS column-bounding audit + `owner_user_id` same-tenant enforcement
## Reviewer package

> **Status: PRE-SQL.** This package is the audit + pinned pre-state + test plan for
> external review. No `017_*.sql` is written yet — it is authored *after* this
> audit is signed off and the two open items below are decided.
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

**Locked (this build session):**
1. `owner_user_id` (and the other Spine reference-binding cols) enforced via a
   **same-tenant TRIGGER (option B)** — no table/column/constraint change,
   reversible (`DROP TRIGGER/FUNCTION`), stays in 015's grants risk class.
2. **F3 (reference-column binding) = Spine-only now**; Phase-2 deferred (§6).
3. **F5 (role gates / least-privilege) = deferred** to its own backlog item.
4. Column-bound exclusion sets reviewed line-by-line (§4 / audit table).

**OPEN — reviewer decides:**
- **O1 — `daily_logs.dpr_content`:** keep (PM edits the DPR narrative) vs. exclude
  from the `authenticated` UPDATE grant (DPR body is generated, not hand-edited).
  Flagged, not silently decided.
- **O2 — option A override:** the reviewer may prefer the stronger, declarative,
  always-on **composite FK** (`(tenant_id, owner_user_id) REFERENCES
  users(tenant_id, id)`) over the trigger. This needs `UNIQUE(id, tenant_id)` on
  `users` = **structural DDL**, which raises 017 out of the grants risk class.
  Deliberately avoided by default; his call whether the stronger guarantee is
  worth the schema change.

---

## 3. Enforcement principle (the thesis)

Two tools, chosen by whether `authenticated` **legitimately writes** the column:

- **COLUMN-BOUND OUT** (015 `REVOKE UPDATE` + column `GRANT`): columns
  `authenticated` should *never* write. Fixed exclusion enforced at the
  column-privilege layer (SQLSTATE 42501), **upstream of RLS**. A blanket RLS
  `WITH CHECK` cannot bound columns; only the grant can.
- **SAME-TENANT TRIGGER** (option B): columns `authenticated` *does* legitimately
  write (a PM sets them) but whose value must stay in-tenant — so they can't be
  excluded from the grant. `BEFORE INSERT/UPDATE` raises if the referenced row's
  `tenant_id <> NEW.tenant_id`. Fires regardless of the service role (only RLS is
  bypassed, not triggers), so it also validates legitimate writes without breaking
  them.

Why the split matters: `owner_user_id` / `project_members.user_id,project_id` are
PM-writable → trigger. `tenant_id` / `created_by` / `engineer_id` / `project_id`
(daily_logs) / `dpr_approved_by` are never writable by `authenticated` → excluded.

---

## 4. What lands in 017 (Spine-only)

- **SAME-TENANT TRIGGER** on: `projects.owner_user_id`,
  `project_members.user_id`, `project_members.project_id` (INSERT + UPDATE).
- **COLUMN-BOUND OUT** (`REVOKE UPDATE … FROM authenticated; GRANT UPDATE(<safe>) …`):
  - `projects` → exclude `tenant_id`, `created_by`; keep `owner_user_id`
    (trigger-guarded), `name`, `client_name`, `client_contact`, `status`, `budget`.
  - `daily_logs` → exclude `engineer_id`, `project_id`, `dpr_approved_by`; keep
    `is_holiday`, `holiday_reason`, `weather`, morning_/evening_ correction cols.
    **`dpr_content` = O1 (open).**
- **anon write-grant strip (F4)** across all tables — cheap, reversible, no schema
  change.
- **`tenants` DROPPED** — only risk is an admin editing their own tenant's billing
  = intra-tenant integrity = F5, no cross-tenant/escalation vector.

---

## 5. Pinned live pre-state — probes (PROD, read-only)

> Source: `~/Desktop/017-probes.txt`. Run in the **prod** SQL Editor (confirm ref).
> Each query is pinned with its raw output directly beneath it.
>
> **PINNED (prod, this session).** Probes 1/2/4/5 are full verbatim captures; Probe 3
> is a verbatim head-excerpt + the operator-confirmed full-re-run invariant (users =
> exactly full_name+avatar_url, authenticated-only; all other tables blanket). The
> live captures confirm the §6 reconstruction with ZERO drift on the 20 audited
> policies. Probe 6 (below, §7) was run to test finding F6 — see the retraction.

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
SELECT table_name, column_name, grantee, privilege_type
FROM information_schema.role_column_grants
WHERE table_schema = 'public' AND grantee IN ('anon','authenticated')
  AND privilege_type = 'UPDATE'
ORDER BY table_name, column_name, grantee;
```
```
table_name,column_name,grantee,privilege_type
-- Verbatim head of capture (boq_items, boq_sessions, daily_logs shown in full):
boq_items,adjusted_base_rate,anon,UPDATE
boq_items,adjusted_base_rate,authenticated,UPDATE
boq_items,amount,anon,UPDATE
boq_items,amount,authenticated,UPDATE
boq_items,boq_session_id,anon,UPDATE
boq_items,boq_session_id,authenticated,UPDATE
boq_items,... (every boq_items column, both anon + authenticated) ...
boq_items,tenant_id,anon,UPDATE
boq_items,tenant_id,authenticated,UPDATE
boq_items,unit,anon,UPDATE
boq_items,unit,authenticated,UPDATE
boq_sessions,... (every boq_sessions column, both anon + authenticated) ...
boq_sessions,tenant_id,anon,UPDATE
boq_sessions,tenant_id,authenticated,UPDATE
daily_logs,created_at,anon,UPDATE
daily_logs,created_at,authenticated,UPDATE
daily_logs,dpr_approved_by,anon,UPDATE
daily_logs,dpr_approved_by,authenticated,UPDATE
daily_logs,dpr_content,anon,UPDATE
daily_logs,dpr_content,authenticated,UPDATE
daily_logs,engineer_id,anon,UPDATE
daily_logs,engineer_id,authenticated,UPDATE
daily_logs,... (every daily_logs column, both anon + authenticated, incl. morning_/evening_ cols) ...
daily_logs,project_id,anon,UPDATE
daily_logs,project_id,authenticated,UPDATE
daily_logs,tenant_id,anon,UPDATE
daily_logs,tenant_id,authenticated,UPDATE

-- FULL RE-RUN INVARIANT (operator-confirmed, complete result across all 20+ tables):
--   * users: EXACTLY 2 rows -> (full_name, authenticated) and (avatar_url, authenticated).
--     ZERO anon rows on users. This is the 015 column-bounding, and it is the ONLY
--     column-bounded table in the schema.
--   * EVERY other table: all columns present for BOTH anon AND authenticated (blanket).
-- The head above is the verbatim capture excerpt; the invariant is the pinned claim the
-- audit's "users is the only column-bounding" rests on. (A full byte-level grid can be
-- re-captured on request; the excerpt + invariant are what the finding needs.)
```

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

[Every FK into users/projects is a plain single-column FK — no composite/same-tenant enforcement anywhere. Spine binding surface (017 scope): projects.owner_user_id, project_members.user_id, project_members.project_id (triggers); daily_logs.engineer_id, daily_logs.project_id (column-bound). whatsapp_sessions.user_id = F3 NO-ACTION (service-role-only writer, §7). Remainder = Phase-2 deferred.]
```

---

## 6. §3 audit table (reconstruction — superseded by §5 when pinned)

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
                                                                                             client_name, client_contact, budget, status                                                         column-bound in 017

4   project_members          tenant_id AND actor.role IN (pm, admin)               No        user_id -> users (X-TENANT), project_id -> projects (X-TENANT)        CROSS-TENANT (F3)               Spine — same-tenant TRIGGER
                                                                                             [both legit PM-writable -> trigger, not column-bound]                                                (user_id + project_id) in 017.
                                                                                                                                                                                                  Load-bearing for ENG-01/invites.

5   whatsapp_sessions        tenant_id = get_user_tenant_id()                      No        user_id -> users, phone_number, context, current_flow                BENIGN (tenant pinned;          Spine — NO ACTION (F3 explicit).
                                                                                             [user_id is a plain FK -> users(id), Probe 5 -- same F3 class as       ephemeral; real writes =        See F3 disposition note below for
                                                                                              owner_user_id, but see disposition]                                  service role)                   whatsapp_sessions.user_id.

6   daily_logs               tenant_id AND (engineer_id = me                       No        engineer_id -> users (pm repoint, X-TENANT), project_id -> projects,  CROSS-TENANT (F3) +             Spine — COLUMN-BOUND OUT
                             OR actor.role IN (pm, admin, qs))                               dpr_approved_by -> users, dpr_content (engineer forge on own row)     LOW integrity (DPR forge)       engineer_id, project_id,
                                                                                             [none legit-writable by authenticated -> exclude, no trigger]                                        dpr_approved_by in 017. No
                                                                                                                                                                                                  trigger (service-role RPC writes
                                                                                                                                                                                                  bypass grants, unaffected).

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

19  ra_bills                 tenant_id = get_user_tenant_id()                      No        project_id -> projects; amount                                       BENIGN x-tenant; MED integrity  Phase-2 — defer

20  ra_bill_payments         tenant_id = get_user_tenant_id()                      No        ra_bill_id -> ra_bills; amount                                       BENIGN x-tenant; MED integrity  Phase-2 — defer
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
                      guarded], name, client_name, client_contact, status, budget)
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
    writer of whatsapp_sessions is the service role (webhook + the 011-014/018
    RPCs), which bypasses RLS AND column grants AND is trusted to set user_id
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
  **no enforcement in 017**. The only writer of `whatsapp_sessions` is the service
  role (webhook + the 011-014/018 RPCs), which bypasses RLS AND column grants AND
  is trusted to set `user_id` correctly — identical reasoning to
  `daily_logs.dpr_approved_by`. No `authenticated` path writes `user_id`, so there
  is no caller for a trigger to constrain. Revisit if a future authenticated write
  path to `whatsapp_sessions` is added.

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
- **Residual (low-priority, non-urgent):** add a reproducibility migration so
  `ENABLE ROW LEVEL SECURITY` on these two tables is codified in a migration rather
  than only existing as an untracked prod state. (A DB rebuilt from migrations would
  otherwise lack it.) NOT part of 017; its own small housekeeping item.

---

## 8. Test plan — negative-control per finding (015 model)

Pattern per finding: **prove the hole OPEN pre-fix** (a raw `authenticated` client
statement that succeeds today) **and CLOSED post-fix** (same statement rejected —
trigger `RAISE` for the binding class, SQLSTATE 42501 for column-bounding). Run on
the test-db branch (`exfccwlrhoutkgrlikod`) against the two-tenant fixture
(`TEST_TENANT_A/B`, as used by T-007-03/07/08). Estimated ~14–18 new tests.

| ID | Finding | Pre-fix (open) | Post-fix (closed) |
|----|---------|----------------|-------------------|
| T-017-01 | `projects.owner_user_id` x-tenant (UPDATE) | tenant-A user sets `owner_user_id` = tenant-B user id → succeeds | trigger `RAISE` |
| T-017-02 | `projects.owner_user_id` x-tenant (INSERT) | same via INSERT → succeeds | trigger `RAISE` |
| T-017-03 | `projects.owner_user_id` SAME-tenant (happy path) | — | still succeeds (no false-positive) |
| T-017-04 | `project_members.user_id` x-tenant (UPDATE+INSERT) | pm binds tenant-B user → succeeds | trigger `RAISE` |
| T-017-05 | `project_members.project_id` x-tenant | pm points membership at tenant-B project → succeeds | trigger `RAISE` |
| T-017-06 | `projects` column-bound | authenticated UPDATE of `tenant_id`/`created_by` → succeeds | 42501 |
| T-017-07 | `daily_logs` column-bound | authenticated UPDATE of `engineer_id`/`project_id`/`dpr_approved_by` → succeeds | 42501 |
| T-017-08 | anon write strip (F4) | (default grants present) | anon UPDATE rejected |
| T-017-09 | REGRESSION: 015 users protections | — | role/tenant_id UPDATE still 42501 |
| T-017-10 | REGRESSION: legitimate writes | — | pm renames project, user sets full_name → succeed |
| T-017-11 | REGRESSION: service-role RPC | — | morning-flow RPC still writes engineer_id/project_id (grants bypassed) |

(`dpr_content` gets a column-bound test only if O1 resolves to "exclude".)

---

## 9. Pinning checklist (before reviewer hand-off)

- [x] §5 probe outputs = pinned prod captures (1/2/4/5 full verbatim; 3 head-excerpt
      + operator-confirmed invariant). Zero drift vs the §6 reconstruction.
- [x] F6 investigated + retracted (Probe 6), residual reproducibility item recorded.
- [ ] O1 (`dpr_content`) + O2 (option A) decided and folded.
- [ ] 017 SQL authored, pinned via `git show <sha>:supabase/migrations/017_*.sql`.
- [ ] Negative-control suite run, SHA echoed at top, green post-fix.
- [ ] PITR restore-window observation recorded at prod apply (§0).
