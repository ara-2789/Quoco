# PR-A PLAN — slice 1a tables (written 10–11 Oct 2026)

PLAN ONLY. No SQL file, no migration file, no branch, no commit, no push, no database access of any kind. Every file was read with `git show origin/main:<path>` into `/tmp/quoco/src/` (copies; the repo checkout was not touched). Command log with raw output: `/tmp/quoco/pra-plan-log.txt`.

**Marks.** `[read file:line]` = read this session on origin/main. `[F1–F7]` = a fact you supplied (not re-derived). `[D1–D8]` = your decisions. `[inferred]` = my conclusion from what I read. `[GUESS]` = I filled a gap; every one is collected in §15. `Δv3` = a change from `docs/plans/slice-1a-plan-v3.md`. `wording owed — Aravind` = a user-facing string I did not write.

**Honest limits of this plan.**
1. I read `capture-engine-design.md` (all 328 lines) and `slice-1a-plan-v3.md` (all 426 lines) in full. `CLAUDE.md` I did not read start to finish this round: I confirmed it is **byte-identical to the copy loaded at session start** (`git diff --stat HEAD origin/main -- CLAUDE.md` empty, logged) and cite the rules by line from the origin/main copy.
2. I did not read `docs/bot-flows.md`, `docs/design-principles.md`, `lib/**` or `app/**` beyond three `git grep` lookups (logged). PR-A touches no app code.
3. Nothing in this plan was run against a database. Anything that needs Postgres to be sure (generated-column FKs, the lock-order claims) is `[GUESS]` and is a **rehearsal item**, not a conclusion.

---

## 0. Stop-condition check: D1–D8 against CLAUDE.md and the design record

**Result: no STOP.** I found no conflict between D1–D8 and a rule in CLAUDE.md or an entry in `capture-engine-design.md`. D2, D3, D4, D5, D6 are the design record's own A31, A34, A33, A36, A37 (`capture-engine-design.md:286,291,288,293,294`). Six things you should know, none of them a conflict:

| # | Note | Evidence |
|---|---|---|
| N-a | **D1 reuses the name `invoice` for a flow that handles DCs too.** Not a rule conflict. The name is now misleading in code and logs. CLAUDE.md §2 lists an "invoice flow" as Fast-Follow "DO NOT build yet"; D1 repurposes the slot, and P1 retired digit 5 (`capture-engine-design.md:131-133`). Nothing on main writes `current_flow='invoice'` [F7]; the only mentions are the type at `lib/whatsapp/session.ts:6` and a comment at `lib/whatsapp/inbound-start.ts:719` [read, logged]; `docs/schema.md:167` lists it. **N1 still applies**: those two routers map any unrecognised flow to "morning", and `invoice` is such a flow today (`capture-engine-design.md:306`). That is PR-C work, but D1 does not remove it. |
| N-b | **D1 removes v3 §2.4's CHECK change from PR-A entirely.** PR-A now alters **no existing table or function** (only `storage.buckets` gets one new row). That shrinks the blast radius and the DOWN risk. Δv3. |
| N-c | **D6 changes the shape of `capture_documents`.** v3 pointed the document at its delivery (`delivery_id` on the document). The only declarative way to guarantee "every delivery has a document" is to point the *delivery* at its document. Δv3, §5. This is a design change, not a wording one; it needs your yes. |
| N-d | **D5/A36 supersedes v3 §4.1's day-count rule** (v3 counted from `delivery_date`; `slice-1a-plan-v3.md:173`). The new start is the engineer's confirmation time, which v3 never stored. GAP B, §4. |
| N-e | **D8 "16 MB" is ambiguous.** A11 says "16 MB" and records that the cap is "inferred, not a Twilio fact" (`capture-engine-design.md:245`); v3 read it as 16 × 1024 × 1024 `[GUESS]` (`slice-1a-plan-v3.md:422`). The bucket needs a byte count. I use 16 777 216 and ask you in §16. |
| N-f | **`scripts/test-db-only-grants.sql` already holds three test-db-only DELETE exceptions** (outbound_sends, daily_log_photos, hindrance_photos; headers "SECOND ENTRY", "THIRD ENTRY", logged). CLAUDE.md names one (`CLAUDE.md:531` mentions the script once; its exception paragraph is about `outbound_sends` only) and says "if a second such exception is ever added, name it here too". Observation, not a PR-A change; a fourth entry (§8, §12) makes it more pressing. |

---

## 1. Repo-state header

```
origin/main @ 58a455ed8cc9bbc247b65f132b274afe98cd31d1   (fetched 10 Oct; 58a455e is the expected SHA; merge-base check exit 0)
  58a455e Merge PR #329 docs/capture-1a-decisions-2026-10-10b
  345f249 docs: capture 1a decisions A34-A37 (10 Oct)
supabase/migrations/ on origin/main: ends at 048_engineer_registration.sql   [read, logged]
scripts/migration-number-reservations.json: 14 entries, highest "048" (claimedBy supabase/migrations/048_engineer_registration.sql, APPLIED TO PROD 2026-09-21)   [read, logged]
`supabase migration list` local/remote:  NOT OBTAINED. It reads the remote ledger; this task forbids database access. Owed in the header of the real review request.
Last runbook executed: 048 prod apply, 2026-09-21   [read: reservations file, last git-log entry a8cab9c]
Local checkout: 84 commits behind origin/main (HEAD 78d7763); nothing read from it.
```

**Proposed migration number: 049.** Checks done: not in `supabase/migrations/` on origin/main; not in the reservations file; no `049` path under `docs/reviews/` on origin/main; no remote branch name containing 049/capture/pra/slice-1a other than `origin/docs/capture-1a-decisions-2026-10-06` (logged). **Limit, stated:** I cannot see unpushed sibling worktrees, so 049 is not proven free everywhere; the established practice is to say so [read: 044–048 reservation notes].

How 049 will be held (so the real PR does not trip the linter): `lint-migrations.mjs` Rule 8 requires a reservation entry naming the *held* file [read: 048 note, reservations file]. The migration lives at `docs/reviews/049_<name>.sql` until it is being applied, then moves into `supabase/migrations/` in the apply commit (`CLAUDE.md:990`). Lint Rule 9 (`scripts/lint-migrations.mjs:389-495`, no exceptions) will fail the PR unless every non-CASCADE FK to `users`/`tenants`/`projects` is registered in `scripts/shared-fixture-fk-coverage.json`; composite FKs are caught by its second regex [read]. Count of entries owed: §12.

**Tier and gate path (FULL).** New tenant-scoped tables, RLS, grants, triggers, a bucket. By the 19 Sep correction the tier follows what is at stake; this PR stores real supplier documents the moment engineers are switched on, and the switch trigger is expected to fire in this slice (`CLAUDE.md:625-690`, v3 §8). Order: external review package → test-db apply → DOWN rehearsal with captured output → CI green with pinned run URL (`headSha` = PR HEAD, `CLAUDE.md` "GREEN CI CERTIFIES A SHA") → merge (regular merge commit, branch continues) → PITR observed → prod apply (explicit go-ahead, ref printed) → verify by observation → ledger → reservations file → file on main. External-review triggers tripped: (a) [new trigger functions with logic, see §6], (b) [grants, RLS, SECURITY DEFINER], and arguably (c) not; (d)/(e) not. `CLAUDE.md:192`.

---

## 2. Tables, columns, constraints

**Rules applied to every table** `[read CLAUDE.md §4, §6; 038:196-216; 017:58,61]`: `id UUID PK DEFAULT gen_random_uuid()`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()` (Δ: 043/044 left it nullable; §6 says `DEFAULT now()`); `tenant_id UUID NOT NULL`; status = TEXT + CHECK; **no money, rate, amount, total, tax, confidence, paid, payment or retention column anywhere** (A17, A24, R7, A4); every parent link is a composite same-tenant FK; parent uniques `users_id_tenant_id_key` and `projects_id_tenant_id_key` already exist [read 017:58,61, probe P8 confirms before review]; new parents get their own `UNIQUE (…, tenant_id)`. All FKs `ON DELETE RESTRICT` (also the plain `tenant_id → tenants(id)` FK; see Δ below).

### 2.1 `deliveries` — one row per receipt, or per invoice-created record

| Column | Type / default | Constraint |
|---|---|---|
| `id`, `created_at` | as above | PK |
| `tenant_id` | uuid NOT NULL | `REFERENCES tenants(id) ON DELETE RESTRICT` **Δ**: 043/044 used `CASCADE` on this FK [read 044:185]. A tenant cascade is incoherent next to RESTRICT composite FKs (the tenant delete would still be blocked by `project_id`), and it silently permits deleting a durable record. `[GUESS]`, question Q-FK. |
| `project_id` | uuid NOT NULL | composite FK `(project_id, tenant_id) → projects(id, tenant_id)` |
| `reported_by` | uuid NOT NULL | composite FK `(reported_by, tenant_id) → users(id, tenant_id)`. Not checked: that the user is an *engineer* or a *member of the project*. That is the RPC's job (PR-B). `[inferred]` |
| `received_at` | timestamptz NOT NULL DEFAULT now() | |
| `delivery_date` | `date GENERATED ALWAYS AS ((received_at AT TIME ZONE 'Asia/Kolkata')::date) STORED` | allowed per F1 (`timezone(text,timestamptz)` immutable, `date(timestamp)` immutable). Prior art: 046's `report_date` [read reservations 046 note]. Boundary test in §12. |
| `status` | text NOT NULL DEFAULT `'incomplete'` | CHECK IN (`incomplete`,`awaiting_pm`,`approved`,`rejected`,`cancelled`) |
| `delivery_type` | text NULL | CHECK IN (`supplier`,`internal_transfer`); NULL until the PM sets it (A8) |
| `vehicle_number`, `dc_number` | text NULL | optional (A13); `CHECK (char_length(x) <= 64)` `[GUESS]` bound on PM-typed text |
| `dc_date` | date NULL | optional (A13) |
| `dc_document_id` | uuid NULL | **Δv3** — see §5. composite FK to `capture_documents`, kind pinned to `'dc'` |
| `created_from_invoice_id` | uuid NULL | composite FK to `capture_documents`, kind pinned to `'invoice'`. **Δv3**: v3's FK did not pin the kind (`slice-1a-plan-v3.md:107`), so it could point at a DC document |
| `approved_by`, `approved_at` | uuid / timestamptz NULL | FK `(approved_by, tenant_id) → users`; see CHECKs |
| `rejected_by`, `rejected_at`, `reject_reason` | NULL | **Δv3**: v3 had only `reject_reason`. A rejection with no actor or time is the gap GAP A exists to close for approvals; symmetrical, small. `[GUESS]` |
| `cancelled_at`, `cancel_reason` | NULL | `cancel_reason` CHECK IN (`superseded_by_link`) |

Pinned-kind columns (needed so the FKs below can name the kind): `dc_doc_kind text GENERATED ALWAYS AS (CASE WHEN dc_document_id IS NOT NULL THEN 'dc' END) STORED` and `inv_doc_kind … 'invoice'` likewise. FKs:
`(dc_document_id, project_id, tenant_id, dc_doc_kind) → capture_documents(id, project_id, tenant_id, kind)`,
`(created_from_invoice_id, project_id, tenant_id, inv_doc_kind) → capture_documents(id, project_id, tenant_id, kind)`.
Default FK matching (MATCH SIMPLE) skips the check when any referencing column is NULL, so the NULL branch is silent and the non-NULL branch checks all four. `[GUESS]` — a generated column used inside an FK is the part I could not verify offline; fallback is a trigger (adds to §6). **Rehearsal item R-1.**

Uniques: `UNIQUE (dc_document_id)`, `UNIQUE (created_from_invoice_id)` (a document anchors at most one delivery, for life; "coming back" on unlink reactivates the same row, A34); `UNIQUE (id, project_id, tenant_id)` (link FK target); `UNIQUE (id, created_from_invoice_id)` (self-link FK target, §2.4).

CHECKs (all `[GUESS]` as a set; each maps to a decision):
- `num_nonnulls(dc_document_id, created_from_invoice_id) = 1` — **D6/A37** (§5).
- `(approved_by IS NULL) = (approved_at IS NULL)`; `status='approved' ⇒ approved_by IS NOT NULL AND delivery_type IS NOT NULL`; `status IN ('incomplete','awaiting_pm','rejected') ⇒ approved_by IS NULL`. A *cancelled* row may keep `approved_*` (that is the record "approved, then superseded"); a *restored* row (D3) is `incomplete`/`awaiting_pm` and must be NULL, which is why GAP A needs a second home for the history.
- `status='rejected' ⇒ rejected_by, rejected_at NOT NULL AND btrim(reject_reason) <> ''`; `status<>'rejected' ⇒ those three NULL`.
- `(status='cancelled') = (cancelled_at IS NOT NULL) = (cancel_reason IS NOT NULL)`; `status='cancelled' ⇒ created_from_invoice_id IS NOT NULL` (only automatic deliveries are ever cancelled by a link; a DC delivery is never cancelled).
- `created_from_invoice_id IS NOT NULL ⇒ delivery_type IS DISTINCT FROM 'internal_transfer'` (v3 X8; kept).

Indexes `[GUESS]` minimal: `(project_id, received_at DESC)` for the PM list; FK-support on `(reported_by)`. More arrive with the PM-page query shapes in PR-D.

**Removed vs v3:** `source_name`. A30 settles it: the supplier name is blank in 1a and, in 1b, lives with the document reading, "no approved delivery row changes" (`capture-engine-design.md:287`). A column that is always NULL in 1a and not written in 1b is dead schema.

### 2.2 `capture_documents` — one row per DC or invoice

| Column | Type | Constraint |
|---|---|---|
| `id`, `created_at`, `tenant_id` | | as §2.1 (`tenant_id` → `tenants(id)` RESTRICT) |
| `project_id` | uuid NOT NULL | composite FK to `projects` |
| `kind` | text NOT NULL | CHECK IN (`dc`,`invoice`) |
| `sent_by` | uuid NOT NULL | composite FK `(sent_by, tenant_id) → users` |
| `engineer_ack` | text NULL | CHECK IN (`yes`,`no`,`partial`,`unclear`); NULL until answered |
| `engineer_ack_at` | timestamptz NULL | **Δv3, GAP B (§4)**; `CHECK ((engineer_ack IS NULL) = (engineer_ack_at IS NULL))` |
| `engineer_ack_note` | text NULL | raw text; `CHECK (engineer_ack_note IS NULL OR engineer_ack IN ('no','partial','unclear'))`; `char_length <= 1000` `[GUESS]` |
| `caption` | text NULL | the Body that accompanied the file; `char_length <= 1000` `[GUESS]` |

Uniques: `(id, tenant_id)`, `(id, project_id, tenant_id)`, `(id, project_id, tenant_id, kind)` (the last is what the §2.1 FKs and §2.4 FK target).
**Removed vs v3:** `delivery_id` (D6/§5). A document no longer knows its delivery; the delivery knows its document. The ack stays on the document and is never copied to a delivery or to linked DCs (v3 Q7 [read :353]).

### 2.3 `capture_files` — one row per stored or attempted file

`document_id` (composite FK `(document_id, project_id, tenant_id) → capture_documents(id, project_id, tenant_id)`), `tenant_id`, `project_id`, `file_no int NOT NULL CHECK (file_no > 0)`, `claimed_content_type text`, `content_type text`, `byte_size bigint`, `sha256 text`, `storage_path text`, `ingest_status text NOT NULL DEFAULT 'pending'`, `reject_reason text`, `preview_state text`. `UNIQUE (document_id, file_no)`.
- `ingest_status` CHECK IN (`pending`,`stored`,`rejected`,`failed`). `reject_reason` CHECK IN (`wrong_type`,`too_large`) `[GUESS]` list; more values = a CHECK edit. `preview_state` CHECK IN (`previewable`,`not_previewable`).
- `ingest_status='stored' ⇒ storage_path, content_type, byte_size, sha256 NOT NULL`; `='rejected' ⇒ reject_reason NOT NULL`.
- **`byte_size` cap applies to stored files only:** `CHECK (ingest_status <> 'stored' OR byte_size <= 16777216)`. A flat cap would make it impossible to *record* an oversize file, which A11 requires ("an oversize file shows to the PM only", `capture-engine-design.md:245`). `[GUESS]`
- `content_type` CHECK IN the same list as the bucket (§9) when not NULL. `sha256 ~ '^[0-9a-f]{64}$'`.
- `CHECK (storage_path IS NULL OR storage_path LIKE tenant_id::text || '/%')` — defence in depth: object access control is application code only (F4, 042 header), so a path that leaves the tenant's folder should be unrepresentable. `[GUESS]` Path convention proposed: `{tenant_id}/{project_id}/{document_id}/{file_id}.{ext}`; a new `capture` kind in PR-C.
- **Open (Q-SID):** v3 lists no `source_message_sid` / media index column, yet T-FLOW-3 requires "duplicate message SID → no duplicate rows". Webhook-level SID dedupe exists (CLAUDE.md §6) but I did not verify that it protects *this* write. Adding `source_message_sid text, media_index int, UNIQUE (source_message_sid, media_index)` is cheap now and a migration later. Recommended; your call.

### 2.4 `delivery_invoice_links` — many deliveries to one invoice (A16, A28, A33)

| Column | Type | Constraint |
|---|---|---|
| `id`, `created_at`, `tenant_id`, `project_id` | | as above |
| `delivery_id` | uuid NOT NULL | composite FK `(delivery_id, project_id, tenant_id) → deliveries(id, project_id, tenant_id)` |
| `invoice_document_id` | uuid NOT NULL | composite FK to `capture_documents`, kind pinned (v3 `doc_kind` column kept: `NOT NULL DEFAULT 'invoice' CHECK (doc_kind='invoice')`, FK `(invoice_document_id, project_id, tenant_id, doc_kind) → capture_documents(id, project_id, tenant_id, kind)`) |
| `link_source` | text NOT NULL | CHECK IN (`created_from_invoice`,`pm_manual`) |
| `linked_by` | uuid NULL | composite FK `→ users`; `CHECK ((link_source='pm_manual') = (linked_by IS NOT NULL))` |
| `linked_at` | timestamptz NOT NULL DEFAULT now() | |
| `unlinked_at`, `unlinked_by` | NULL | `CHECK ((unlinked_at IS NULL) = (unlinked_by IS NULL))` |
| `unlink_reason` | text NULL | CHECK IN (`superseded_by_link`,`pm_unlinked`, + see Q-REJ); `CHECK ((unlinked_at IS NULL) = (unlink_reason IS NULL))` |
| `superseded_approval_by`, `superseded_approval_at` | NULL | **GAP A recommendation (§3).** Both NULL or both set; only allowed when `link_source='created_from_invoice' AND unlink_reason='superseded_by_link'` |
| `self_invoice_id` | `uuid GENERATED ALWAYS AS (CASE WHEN link_source='created_from_invoice' THEN invoice_document_id END) STORED` | FK `(delivery_id, self_invoice_id) → deliveries(id, created_from_invoice_id)`. A self-link can only sit on the automatic delivery of *that* invoice, declaratively. `[GUESS]`, rehearsal item R-1 |

Partial uniques (D7: no `btree_gist`; these replace the exclusion constraint):
- **A33 — `UNIQUE (delivery_id) WHERE unlinked_at IS NULL`.** A delivery has at most one active link. Δv3: v3 had `(delivery_id, invoice_document_id)`; this is stronger and implies it. Consequences: a DC has at most one invoice (D4); an automatic delivery has exactly its one self-link and can never also be a PM-link target; a restore inserts a *new* self-link row while the old one is soft-unlinked, so the index stays satisfied.
- `UNIQUE (invoice_document_id) WHERE link_source='created_from_invoice' AND unlinked_at IS NULL` — at most one active self-link per invoice (kept from v3 `:124`; redundant given the above, cheap, explicit).
- Not expressible declaratively: "an invoice never has an active self-link **and** an active PM link" (A28). That is trigger TR1 (§6). Without `btree_gist` it cannot be a constraint. `[read v3 Q4 :322-323; D7]`

Rows are **never updated except to unlink, and never deleted.** Soft unlink only; `unlinked_at` never clears (TR3).

### 2.5 Summary of changes from v3

| Δ | Why |
|---|---|
| No `whatsapp_sessions` CHECK change | D1 / F2 / F7 |
| `source_name` dropped | A30 |
| `delivery_id` removed from `capture_documents`; `dc_document_id` and `created_from_invoice_id` on `deliveries`, exactly one non-NULL | D6, §5 |
| `engineer_ack_at` added | D5/A36, GAP B |
| Snapshot columns on the link row | D2/D3, GAP A |
| `rejected_by`/`rejected_at` added | attribution; symmetrical with approval |
| Kind pinned on `created_from_invoice_id`'s FK | v3's FK allowed pointing at a DC |
| A33 unique replaces `(delivery_id, invoice_document_id)` | D4 |
| `tenant_id` FK RESTRICT, `created_at` NOT NULL | §2 |
| `self_invoice_id` FK | declarative self-link correctness |
| `byte_size` cap only for stored files | A11 |

---

## 3. GAP A — where "approved by X at T, superseded by link by Y at T2" survives a restore

**Why a gap exists.** D3 says the restored automatic delivery returns as *pending* and "prior approval stays in history". The delivery row cannot carry both "pending" and "approved by X" (§2.1 CHECK `status IN ('incomplete','awaiting_pm','rejected') ⇒ approved_by IS NULL`, and it must not, or the PM page would show an approver on a pending record). So the approval must be copied somewhere that a later restore does not clear.

**Option 1 — an append-only event table** (`delivery_events`: `delivery_id`, `event` CHECK IN (`approved`,`rejected`,`superseded_by_link`,`restored_by_unlink`, …), `actor`, `occurred_at`, `prior_status`, `link_id`).
- For: general audit trail for every PM action, survives any future workflow (1b corrections). One query shows the whole life of a delivery.
- Against: a fifth table to grant, RLS, test and review in a FULL-tier PR. **Completeness depends on every PR-B function remembering to insert**; a forgotten insert is a silent history gap with no database guard (unless more triggers write events, which grows §6). Three new test families.

**Option 2 — snapshot columns on the soft-unlinked self-link row** (`superseded_approval_by`, `superseded_approval_at`, plus the existing `unlinked_by`/`unlinked_at`/`unlink_reason`; §2.4).
- For: no new table. Every supersession already writes one link row that is **never cleared, never deleted** (`unlinked_at` is immutable, and a restore inserts a *new* self-link instead of reopening the old one). So each approve→supersede cycle leaves its own row: "approved by X at T" is the snapshot, "superseded by Y at T2" is `unlinked_by`/`unlinked_at`. Multiple cycles do not overwrite each other. The snapshot can be **copied by trigger TR3 from the delivery row at the moment of unlinking** rather than supplied by the function, so a wrong stamp is impossible, not merely uncaught (the 043 argument for generated `expires_at`, `043:` header comment, logged).
- Against: it records only this one event type. Approvals and rejections that never involve a link have no history (approval is final, so the delivery row *is* the record). If 1b's correction design needs full history, an events table is added then, additively.

**Recommendation: Option 2.** It answers exactly the question D2+D3 ask, with the smallest review surface, and does not foreclose Option 1. **This is your choice (Q-GAPA); I have written §2.4 and §6 TR3 to Option 2 only so the plan is concrete.** If you pick Option 1, §2.4 loses two columns and §2.5 gains a table.

---

## 4. GAP B — the confirmation time for the 30-day rule

**Column: `capture_documents.engineer_ack_at timestamptz NULL`**, set in the same statement that stores `engineer_ack`, paired by CHECK (§2.2). It lives on the **document**, not the delivery, because the ack is stored on the document and never copied (v3 `:116`). For a DC delivery the clock reads its DC document; invoice documents carry an ack too but "invoice expected" applies only to DC deliveries (A16).

**What the day count uses.**
- Start = the **IST date of `engineer_ack_at`** (same IST rule as `delivery_date`). End = the IST date of the earliest active PM link's `linked_at`, else today. It stops at the link (A16 `capture-engine-design.md:266`).
- **Overdue** = 30 days after the start (A36). Display only: no job, no column, no notification reads it (A36). It is **computed at read time**, not stored; no generated column is needed. `>` vs `>=` at exactly 30 is unstated: **Q-30**.
- **A delivery whose engineer never answered** (`engineer_ack_at IS NULL`; status `incomplete`, shown "not acknowledged"): **the literal reading of A36 is that there is no clock.** No day count is computed and it is never "overdue"; the PM page shows "not acknowledged" instead. I implement that by default because A36 says "after the engineer's confirmation" and a delivery nobody confirmed has none. **Cost, stated:** a PM who approves such a delivery (v3 D9 assumed they may [read :392]) gets an "invoice expected" row that never ages. The alternative is to fall back to `received_at`. **Q-CLOCK, your decision**; the schema supports both (`received_at` is already stored), so this is an app rule in PR-D, not a PR-A change.
- **Q-ACK:** does a *No* or *Unclear* reply start the clock? `engineer_ack_at` is set for any recorded reply; whether "No" (goods did not arrive) should age an invoice expectation is not stated.

---

## 5. D6 — how the schema guarantees every delivery has a document

**Enforceable in the schema, declaratively, with no trigger — if the pointer runs delivery → document.** Design (Δv3):
- `deliveries.dc_document_id` (DC deliveries) **or** `deliveries.created_from_invoice_id` (automatic deliveries), `CHECK (num_nonnulls(dc_document_id, created_from_invoice_id) = 1)`, each a composite FK to a `capture_documents` row of the pinned kind in the same project and tenant (§2.1). A delivery row cannot be inserted without naming a real document, or with two.
- Insert order is document first, delivery second. Each step is an ordinary single-table insert; no deferred constraint is needed.
- `dc_document_id` and `created_from_invoice_id` are immutable (TR4). The document cannot be deleted while referenced: the FK is RESTRICT, and no role has DELETE (§8).

**Why not v3's shape** (document points at delivery, `capture_documents.delivery_id`): "a delivery has ≥1 document" is then a *child-must-exist* rule, which Postgres can only enforce with a `DEFERRABLE INITIALLY DEFERRED` constraint trigger firing at commit. That works for the engineer RPC (one transaction) but **cannot be exercised through PostgREST**, where each request is its own transaction (the delivery insert alone would always fail at its own commit), so CI could not seed a valid row without a test-only helper function. The reverse pointer avoids all of it. `[inferred]`

**What the schema does NOT guarantee, and where it is enforced instead:**
1. **That a document has a file.** A `capture_documents` row can exist with zero `capture_files` rows. Same child-must-exist problem. Enforced by the engineer RPC creating document, file rows and delivery in one transaction (PR-B, tested by T-FLOW-1), and made *visible* by the PM page file state (PR-D). A deferred trigger could enforce "≥1 file" in the RPC path only; I do not recommend it for the same reason as above.
2. **That a file's bytes exist, are valid, or are readable.** Ingest is an asynchronous job writing to Storage (outside the database); a file can be `pending`, `rejected` or `failed` (A11, R5). That is not a database property. Enforced by the ingest job and shown by the PM page (a `pending` file older than 15 minutes shows as failed, v3 `:117`).
3. **That an invoice document always has an active delivery or link** ("every invoice creates a delivery", A28). A reverse-direction rule; enforced by the engineer RPC and the PM functions (PR-B), tested by T-A28-1. The one allowed exception is a *rejected* automatic delivery (Q-REJ).

So D6's guarantee in PR-A is precisely: **no `deliveries` row exists that does not point at a `capture_documents` row.** "A document with a readable file" is an application guarantee.

---

## 6. Triggers

Functions are `SECURITY DEFINER`, `SET search_path = ''` `[GUESS]`, because `SELECT … FOR UPDATE/SHARE` needs UPDATE privilege on the locked table and `service_role` is deliberately given none (§8). Each gets `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role` **by name** and no GRANT (a trigger fires without the invoking role holding EXECUTE) `[inferred]`; `no-orphan-security-definer` lint requires the reassertion. This adds definer surface to review (trigger (a)/(b)). **Q-DEF:** definer triggers, or invoker triggers with PR-B definers as the only writers? Invoker triggers would break the test-db-only direct inserts of §12.

**Global lock order (contract for PR-B):** (1) the invoice `capture_documents` row → (2) `deliveries` rows, ascending `id` → (3) `delivery_invoice_links` rows. Any function that touches an automatic delivery (including **reject**) must take lock (1) first, or reject-vs-link can deadlock. `[inferred]`

| # | Trigger | Table, event | Lock order | Refuses when |
|---|---|---|---|---|
| **TR1** | `delivery_invoice_links_before_insert` — **A28 XOR** | `delivery_invoice_links`, BEFORE INSERT, one function with TR2's checks so the order is fixed | `SELECT … FROM capture_documents WHERE id = NEW.invoice_document_id FOR UPDATE` first, then the TR2 delivery lock | `NEW.unlinked_at IS NULL` and the invoice already has an active row whose `(link_source = 'created_from_invoice')` differs from NEW's. I.e. an active PM link while an active self-link exists, **or** an active self-link while an active PM link exists. Written with `<> 'created_from_invoice'` so 1b's `'auto_match'` needs no edit (v3 :125). |
| **TR2** | same function — **internal-transfer guard (i)** and target checks | BEFORE INSERT | then `SELECT … FROM deliveries WHERE id = NEW.delivery_id FOR SHARE` (compatible with other linkers; blocks a concurrent type update) | for a `pm_manual` link: target `created_from_invoice_id IS NOT NULL` (automatic), or `delivery_type = 'internal_transfer'`, or `status IN ('rejected','cancelled')`. For a self-link: target `status = 'rejected'` (A34: rejected never returns). Because D6 holds, "non-automatic" already means "has a DC document", so v3's separate "has a dc document" check disappears. |
| **TR3** | `delivery_invoice_links_before_update` — **link immutability** + GAP A snapshot | `delivery_invoice_links`, BEFORE UPDATE | row already locked by the UPDATE; reads the delivery row (caller holds lock 2) | any change other than NULL → value on `unlinked_by`, `unlinked_at`, `unlink_reason` (all three together); any change to an already-set value; any attempt to clear `unlinked_at`. When `unlink_reason='superseded_by_link'` on a self-link it **fills** `superseded_approval_by/at` from the delivery's `approved_by/approved_at` (NULL if not approved). |
| **TR4a** | `deliveries_before_update` — **`created_from_invoice_id` immutability** (and siblings) | `deliveries`, BEFORE UPDATE | the UPDATE's own row lock | `NEW.created_from_invoice_id IS DISTINCT FROM OLD.…`. Proposed siblings in the same function (`[GUESS]`, cheap): `dc_document_id`, `project_id`, `tenant_id`, `reported_by`, `received_at`. |
| **TR4b** | same function — **internal-transfer guard (ii)** | BEFORE UPDATE OF `delivery_type` | the UPDATE's own row lock (held, so a concurrent link insert's `FOR SHARE` in TR2 waits, and vice versa) | `NEW.delivery_type = 'internal_transfer'` and an active link row exists for this delivery (`delivery_id = NEW.id AND unlinked_at IS NULL`). |
| **A33** | *not a trigger* | partial unique index (§2.4) | the unique-index check serialises two concurrent links to one DC | second active link on a delivery: SQLSTATE 23505. |
| **D6** | *not a trigger* | CHECK + composite FKs (§5) | — | a delivery without exactly one document. |

**Proposed extras, outside your list; take or drop each (Q-X):**
- **TR4c — status transition guard** on `deliveries`: allow `incomplete→{awaiting_pm,approved,rejected,cancelled}`, `awaiting_pm→{approved,rejected,cancelled}`, `approved→cancelled` (D2 only), `cancelled→{incomplete,awaiting_pm}` (D3 restore), nothing out of `rejected`. Without it "approval is final" (A14/A31) and "rejected never returns" (A34) are only as strong as the PR-B functions. `[GUESS]`
- **TR5 — `capture_documents` immutability**: `kind`, `project_id`, `tenant_id`, `sent_by` immutable; `engineer_ack`/`engineer_ack_at` settable once; the note settable once. The ack is evidence the PM relies on.
- No DELETE triggers: no role holds DELETE (§8), and an owner-level delete is outside this threat model.

**Concurrency, stated plainly.** The lock-order and race claims above (TR1 two concurrent links, TR2/TR4b serialisation, A33 under contention) are **not verified locally and cannot be: CI-only** (`CLAUDE.md:478`). Where a test below depends on two callers genuinely overlapping, it is labelled "not verified locally, CI-only" and a local green is not reported as a pass.

---

## 7. RLS — every policy, in words

RLS is `ENABLE`d on all four tables; **not** `FORCE`d (the owner and the SECURITY DEFINER functions of PR-B must keep working; 043 does the same [read 043:257]). One policy per table, all `FOR SELECT TO authenticated`, named `<table>_select` (043:259 precedent):

- **`deliveries_select`, `capture_documents_select`, `capture_files_select`, `delivery_invoice_links_select`:** a row is visible when `tenant_id = get_user_tenant_id()` **and** the caller is a project member with role `pm` of the row's own `project_id`, i.e. there is a `project_members` row with that `project_id`, `user_id` = the caller's `users.id` (looked up by `auth_id = auth.uid()`), and `role = 'pm'`. Every table carries its own `project_id` (composite-FK-checked), so no policy joins to a parent table. 043's policy joined `daily_logs` to find the project [read 043:259-270]; mine reads the row's own column. Only the two-clause predicate differs in form from 043/044.
- **No other role reads:** `owner`, `engineer`, `qs` and a tenant `admin` who is not a `pm` member of that project see nothing. `[inferred]` — note this mirrors 043/044, which also check `project_members.role='pm'` only and not `users.role`.
- **No INSERT, UPDATE or DELETE policy exists on any table, and none of those privileges is granted to `anon` or `authenticated`** (§8). Writes happen only through SECURITY DEFINER functions (PR-B) and, for `capture_files` ingest columns, the narrow `service_role` column grant (§8). `service_role` bypasses RLS by design (BYPASSRLS), so for that role the grant layer is the only barrier (`CLAUDE.md:507`).
- `anon` has no grant at all, so any anon call fails at the grant (42501) before RLS is evaluated.

---

## 8. Grants

For **each** of the four tables, in this order, mirroring 043:287-308 / 044:312-332 `[read]`:

```
REVOKE ALL ON public.<t> FROM anon, authenticated, service_role;   -- by name, all three (CLAUDE.md:507, :953)
```

then only:

| Table | Grant | Reason |
|---|---|---|
| all four | `GRANT SELECT TO authenticated` | the PM page reads through the PM's own session; RLS (§7) bounds the rows |
| all four | `GRANT SELECT TO service_role` | server-side reads (signed-URL membership check in PR-C, ingest job, 1b reading job) |
| `capture_files` | `GRANT UPDATE (ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state) TO service_role` | the ingest job (TypeScript, PR-C) records the outcome. **Precedent correction:** v3 cites 039's column-scoped grant (`slice-1a-plan-v3.md:101`); 039's grant is `GRANT UPDATE (acknowledged_at, acknowledged_by) ON hindrances TO authenticated` [read 039:485-486], i.e. to `authenticated`, not `service_role`. The pattern is the same; the role differs. **Unused until PR-C** — the one grant here with no PR-A consumer; 047's purpose was removing unused rights. **Q-GRANT:** keep in PR-A (v3), or move into a PR-B/C migration. |

**Not granted to anyone:** INSERT, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN on any table (`service_role` included). `anon`: nothing. This is the claim "durable record / append-only" enforced by grants, as `CLAUDE.md:507` requires of a table that makes that claim. 047's `ALTER DEFAULT PRIVILEGES` already withholds five of those from anon/authenticated on new tables created by the migration runner [read: 047 reservation note], but the explicit REVOKE stays: it must not depend on a default that cannot be read from the file.

**Functions (trigger functions of §6):** `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, no grants (`CLAUDE.md:953`).

**Test-db-only (not a migration; see §12 decision Q-TDB):** `scripts/test-db-only-grants.sql` gains a fourth entry giving `service_role` INSERT, UPDATE, DELETE on the four tables on test-db only, by the same mechanism as the three existing entries. Prod is unaffected.

**Post-apply readback (both DBs):** `has_table_privilege` for anon/authenticated/service_role × {SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN} per table; `information_schema.column_privileges` for the `capture_files` column grant; `has_function_privilege` per trigger function; and a real anon-key call per table, expecting 42501 (`CLAUDE.md:953` "prove a revoke two ways").

---

## 9. Bucket

Mirrors `042_storage_bucket_setup.sql:74-76` [read], with the two settings 042 lacked (F4: the existing bucket has neither):

```
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capture-documents', 'capture-documents', false, 16777216, ARRAY[ …list below… ])
ON CONFLICT (id) DO NOTHING;
```
`[GUESS]` bucket id `capture-documents`. The two extra columns exist (F4 says the current bucket has "no size limit, no MIME limit", implying them); I did not read the `storage.buckets` DDL.

**Because `DO NOTHING` would silently keep a pre-existing bucket with different limits,** the file adds an in-transaction `DO $$ … RAISE EXCEPTION` assertion that the row now has `public = false`, `file_size_limit = 16777216` and the exact MIME array (the assertion pattern of the ADDITIVE IDEMPOTENT rule, `CLAUDE.md:936`). Probe P4 confirms the id is free before review.

**Proposed MIME list — for your approval (D8):**

| Type | Why |
|---|---|
| `application/pdf` | A6: PDFs accepted, original bytes, all pages |
| `image/jpeg` | what WhatsApp photos arrive as (`lib/media/ingest.ts:72` default `.jpg`, logged) |
| `image/png` | handled by existing `extensionForContentType` (`ingest.ts:69`) |
| `image/webp` | same (`ingest.ts:70`) |
| `image/heic`, `image/heif` | A6 "no information lost": a phone photo sent as a *document* keeps its original HEIC. `[GUESS]` that supplier-document photos ever arrive this way; drop both if you would rather reject them |

Excluded: `image/gif` (handled by the existing photo path, but not a document photo), video, audio, Office types. **Adding a type later = a new migration** (`UPDATE storage.buckets`). The bucket MIME check is a **backstop**: PR-C's own byte-sniffing decides what is accepted (A6, A12), and the bucket sees only the Content-Type header the uploader declares. Whether Storage *also* sniffs bytes, and whether the limits bind a `service_role` upload, I did not verify: **rehearsal/CI test in §12 (T-BKT-1..3)**, not an assumption. The bucket's size limit cannot exceed the project-wide Storage limit; I cannot read that from SQL (**Q-GLOBAL**, probe list).

**`storage.objects` policies: none created, none needed — same decision as 042** (`042:44-55`, logged): every read and write is `service_role` application code and the code's membership check *is* the access control. F4: the storage schema has 0 RLS policies. This is only safe if **RLS is enabled on `storage.objects`**; I have no fact for that (F4 says "0 policies", not "RLS on"). **Probe P7 is therefore a gate**, not a nicety: with RLS off and Supabase's default table grants, "no policy" would mean world-readable. §12 T-BKT-4 tests it as `anon` and as an authenticated PM.

---

## 10. RAISE messages and DB errors a PM could see

**Every string below is a user-facing string and is "wording owed — Aravind". I propose none.** Two structural recommendations that carry no wording: (1) each trigger raises with a **distinct SQLSTATE or a stable machine code** in `MESSAGE`, and the app maps code → named constant; SQL text is never shown (CLAUDE.md §6 "never expose raw DB errors"); (2) "not found" and "not allowed" stay indistinguishable at the PM-visible layer (v3 :195 [read]).

| # | Site | Condition | Reachable by a PM? |
|---|---|---|---|
| E1 | TR1 | PM link attempted while an active self-link exists | normally no: `pm_link_invoice` cancels the self-link first; a guard against function bugs. wording owed — Aravind |
| E2 | TR1 | self-link insert while an active PM link exists | only on a restore bug; wording owed — Aravind |
| E3 | TR2 | link target is an internal transfer | **yes**; wording owed — Aravind |
| E4 | TR2 | link target is an automatic ("created from invoice") delivery | no (the UI never offers it); wording owed — Aravind |
| E5 | TR2 | link target is rejected or cancelled | **yes**; wording owed — Aravind |
| E6 | TR4b | retype to internal transfer while linked ("unlink first" is behaviour you approved, `capture-engine-design.md:289`; the words are not) | **yes**; wording owed — Aravind |
| E7 | CHECK `created_from_invoice_id … ≠ internal_transfer` | retype an automatic delivery to internal transfer | **yes** (raw 23514 with a constraint name); wording owed — Aravind |
| E8 | A33 unique index | a second active invoice link on one DC | **yes** (raw 23505); wording owed — Aravind |
| E9 | TR4a | change of an immutable field | no |
| E10 | TR3 | edit of a link beyond unlinking; clearing `unlinked_at` | no |
| E11 | TR4c / TR5 (if taken) | forbidden status transition; second ack | E11-status: **yes** (e.g. approve an already-approved record); wording owed — Aravind |
| E12 | CHECK / FK violations (cross-project, cross-tenant, wrong kind, D6) | | no, if PR-B validates first; if not, raw 23503/23514; wording owed — Aravind |

---

## 11. DOWN block

Commented, per `lint-migrations.mjs` `down-section-must-be-commented` (every line from the DOWN marker to EOF blank or `--`; `CLAUDE.md:1163`). Because PR-A now alters no existing table (§0 N-b), DOWN only removes what UP added. Order:

1. Guard (a `DO $$` block, comment-wrapped like the rest): **abort if any of the four tables is non-empty, or if any object from PR-B/PR-C still exists** (`apply_material_inward_turn`, `expire_stale_material_inward`, `pm_*`). Reason: those plpgsql bodies reference the tables by name with **no dependency record**, so `DROP TABLE` would succeed and leave live functions that fail at runtime, the exact "calling something that no longer exists" failure the DOWN rule exists for (`CLAUDE.md:1163`). Required DOWN order across PRs is therefore **C, B, A**.
2. `DROP TABLE delivery_invoice_links;` → `capture_files;` → `deliveries;` → `capture_documents;` (children before parents; the deliveries→documents FKs mean `capture_documents` goes last. Δv3 removed the old documents→deliveries FK, so there is **no circular FK** to break and no `CASCADE` is needed.)
3. `DROP FUNCTION` the trigger functions (after the tables; their triggers die with the tables).
4. Bucket: assert zero rows in `storage.objects` for `bucket_id='capture-documents'`, then `DELETE FROM storage.buckets WHERE id='capture-documents'`. Direct SQL deletion of objects would orphan blobs, so a non-empty bucket **aborts** DOWN.
5. Remove nothing from `whatsapp_sessions`: PR-A never wrote to it.

**A live `invoice` session if DOWN runs:** PR-A neither creates nor requires one. Nothing on main writes `current_flow='invoice'` [F7]; probe P3 confirms the count on prod before review. So the rehearsal requirement "confirm a live in-flight session is still processable after DOWN" (`CLAUDE.md:1163`) has **no PR-A subject**; it moves to PR-B's DOWN, which will be the first thing that can create such a session. I state that explicitly so it is not read as an omission. If DOWN is run after PR-B/C are applied, the step-1 guard refuses; the manual path is C→B→A, resetting any `invoice` session to idle first.

DOWN in production after real rows exist is **not a rollback**, it is data loss; the answer there is PITR, observed before the apply (`CLAUDE.md:32`).

---

## 12. Tests

**Environment facts that shape every row below** `[F5; read db.ts:203, :952; scripts/test-db-only-*.sql; CLAUDE.md:478]`:
- CI runs as `service_role` (`testClient()`, bypasses RLS) and as `anon`+sign-in (`jwtClient`, RLS applies). **There is no table-owner connection.** Anything that needs `SET ROLE`, `ALTER POLICY`, a planted GRANT, `TRUNCATE`, or a multi-statement transaction **runs only in the test-db rehearsal as `postgres`**, with captured output.
- PostgREST requests are one transaction each.
- **Fixture hazards found:** (i) `ensureTwoTenantFixtures` asserts exactly 1 project per tenant (`db.ts:1079`), so cross-project fixtures must **not** add a second project to `TEST_TENANT_A/B`; use a dedicated run-scoped tenant pair via `deriveRunScopedUuid` (new keys) and a new `ensureCaptureFixtures()`. (ii) A teardown that cannot delete capture rows, plus RESTRICT FKs, is the incident recorded in `test-db-only-grants.sql` ("18 failed test files", logged). (iii) Lint Rule 9 and `sweepSharedFixtureReferences` need registry entries.

### Decision Q-TDB (tests need rows and teardown; both options are real)

| | **X — extend `scripts/test-db-only-grants.sql`** (recommended) | **Y — test-only SECURITY DEFINER helpers** (`quoco_test_capture_*`, in a `scripts/test-db-only-*.sql`) |
|---|---|---|
| What | `service_role` gets INSERT, UPDATE, DELETE on the four tables **on test-db only** | helper functions seed and clean up as owner; table ACLs identical to prod |
| For | Third use of an established, working mechanism; the existing `sweepSharedFixtureReferences` (`db.ts:348`) works unchanged with new registry rows; CI can insert rows directly and so fire every trigger/CHECK/FK | test-db table ACLs mirror prod exactly, so the CI `service_role` DELETE-denial test is real |
| Against | **CI cannot prove `service_role` DELETE denial** (test-db has the grant); that proof moves to rehearsal as `postgres` + the prod post-apply readback. A fourth divergence; CLAUDE.md names one (§0 N-f) | a new generic-ish DML helper on test-db; the sweep registry needs a non-DELETE cleanup path; more test infrastructure |

**Recommendation: X**, because it is what the project already does and found necessary twice; its cost (denial proof moves) is real and named. **Your decision.** The tests below are written to X; under Y the "CI service_role denial" rows flip from rehearsal-only to CI.

### 12.1 RLS / tenant isolation — `jwtClient` only (CI)

Fixtures: run-scoped tenants T1 and T2; T1 has projects P1 and P2. PM_a is `pm` of P1 only; PM_b is `pm` of P2 only; PM_c is `pm` of tenant T2's project; QS_a is a `qs` member of P1; one more authenticated user with `role='admin'` in T1 and no membership. Rows seeded by `service_role` (X) in all four tables for P1, P2, T2. All identifiers carry `ZZTestCapture-${RUN_TAG}` (v3 §9 marker rule). Phone slots in §12.5.

| ID | Assertion | Red-first proof (how it fails when the policy is wrong) |
|---|---|---|
| RLS-1 | PM_a sees exactly P1's rows in each of the four tables | **Rehearsal:** drop the policy → 0 rows (test red); replace with `USING (tenant_id = get_user_tenant_id())` → still sees P2 rows (RLS-2 red) |
| RLS-2 (cross-project, same tenant) | PM_a sees **none** of P2's rows; PM_b none of P1's | **Rehearsal:** policy with the project clause removed → PM_a sees P2 → red |
| RLS-3 (cross-tenant) | PM_c sees none of T1's rows and PM_a none of T2's | **Rehearsal:** policy with the tenant clause removed (membership clause kept) → still green *unless* a cross-tenant `project_members` row is planted; the planted-row variant goes red. Named so the weaker mutant is not mistaken for a proof |
| RLS-4 | QS_a (member, role `qs`) and the membership-less admin see **zero** rows | **Rehearsal:** policy with `role='pm'` removed → QS_a sees rows → red |
| RLS-5 | `authenticated` INSERT / UPDATE / DELETE on each table → 42501 (grant, not RLS) | **Rehearsal:** planted `GRANT INSERT TO authenticated` → the call no longer fails at the grant → red |
| RLS-6 | `anon` key, SELECT/INSERT/UPDATE/DELETE on each table → 42501 | **Rehearsal:** planted `GRANT SELECT TO anon` → red (v3 T-F6-1) |
| RLS-7 | `authenticated` RPC call to each trigger function name → refused / not exposed | **Rehearsal:** planted `GRANT EXECUTE … TO authenticated` → red |

**Honest limit on "red-first":** CI cannot alter a policy (F5), so the in-CI forms carry only a **positive control** (the right PM *does* see the row, so default-deny cannot pass the test by accident). The *mutation* red-first proof exists only in the rehearsal, captured. Engineers and owners have no auth login (`auth_id` null, CLAUDE.md §5), so "an engineer cannot read" is covered by the absence of a policy and a grant, not by a `jwtClient` test; stated, not hidden.

### 12.2 Trigger, CHECK, FK and grant tests — where each runs

**Rehearsal as `postgres` on the disposable scaffold (real `pg_dump` + named stubs, PG17, `CLAUDE.md:1063-1127`), captured output:** TR1 two-kinds-coexist refusals, self-link-on-wrong-delivery FK, TR2 target refusals, TR3 immutability, TR4a/TR4b (including the ordering `retype then link` and `link then retype`), the **A28 trigger with the PM function bypassed** (v3 T-A28-3), CHECK matrix, composite-FK cross-tenant / cross-project refusals, generated-column FK behaviour (R-1), `SET ROLE service_role; DELETE/TRUNCATE` → permission denied on every table, `SET ROLE anon/authenticated` full privilege matrix, ACL fingerprint, comment check (`col_description` for every `COMMENT ON` — `CLAUDE.md:1143`), policy-mutation and planted-GRANT red-first proofs, **forward + DOWN** (including the §11 guard), and every refusal in §10.

**CI as `service_role` (X: has test-only INSERT/UPDATE/DELETE):** insert paths that exercise CHECK/FK/trigger/unique refusals via PostgREST (cross-tenant composite FK, wrong-kind document, `num_nonnulls`, A33 second active link → 23505, TR1/TR2 refusals, TR4a immutability, TR3 unlink-only), plus `delivery_date` boundary (23-09-2026 00:30 IST → 23-09; 22-09 23:59 IST → 22-09), plus `capture_files` column-grant behaviour: UPDATE of `ingest_status` succeeds, UPDATE of `storage_path`'s sibling forbidden columns (e.g. `project_id`) → 42501. **Not provable in CI under X:** `service_role` DELETE and TRUNCATE denial (test-db carries the exception; PostgREST cannot TRUNCATE at all).

**CI-only, "not verified locally, CI-only" (`CLAUDE.md:478`):** two concurrent link inserts for one invoice (TR1 lock), TR2 vs TR4b overlap, two concurrent links to one DC (A33 under contention). A local pass proves nothing here and is reported as "not verified".

**Under X, the `service_role` denial probe CLAUDE.md requires for every new table** (`CLAUDE.md:1129`, `service_role` DELETE and, where relevant, TRUNCATE) is therefore: rehearsal `SET ROLE service_role` DELETE+TRUNCATE denial per table with captured output **plus** the prod post-apply `has_table_privilege` readback. Stated so the substitution is visible.

### 12.3 anon-key refusal (42501) on every new table
RLS-6 covers SELECT/INSERT/UPDATE/DELETE per table with a real anon-key client, positive control: the same client reads a deliberately public table or the policy-bearing table through `jwtClient` and succeeds. Rehearsal planted-GRANT red-first as above.

### 12.4 Bucket (CI as `service_role` via the Storage API, plus `anon`/PM clients)
| ID | Assertion | Red-first |
|---|---|---|
| T-BKT-1 | upload `text/plain` → refused | remove the MIME list (rehearsal) → accepted |
| T-BKT-2 | upload a 16 MiB + 1 byte `application/pdf` → refused; 16 MiB exactly → accepted | remove the limit → accepted |
| T-BKT-3 | each approved type uploads | positive control for 1–2 |
| T-BKT-4 | `anon` and an authenticated PM can neither list, download nor sign a URL for an object in the bucket | probe P7; with RLS off on `storage.objects` this test goes red |
| T-BKT-5 | the bucket row is `public=false`, limit 16777216, MIME array equals the approved list | catalog readback |

Objects uploaded by tests are removed through the Storage API in `afterAll`.

### 12.5 Phone slots and "deltas, never absolutes"
Slots are claimed from the registry, not picked from memory (`db.ts:61-66` says the grep, not the comment, is the truth). On origin/main the grep gives these taken slots (logged): 101–105, 190, 199, 301–358 (with gaps), 401, 501–508, 690–695, 801–808, 811–833, 840, 870–879, 900–907; the file's comment also reserves 200, 209, 299, 321–327, 401–432, 600, 701, 999 and keeps `+199955503XX` and `+19995550550` off-limits (`db.ts:68-110`). **Proposed claim: `testPhone('121')`–`('124')`** (engineer A1, engineer A2, engineer B, spare), free in both the grep and the comment. **`[GUESS]` until re-grepped at build** with `grep -rohE "testPhone\('[0-9]+'\)|\+19995550[0-9]{3}" test/` (the registry comment's own command) because slots go stale. Counters in assertions are **deltas against a same-test pre-snapshot, filtered by the run-scoped marker**, never absolute counts — test-db is shared and capture rows from earlier runs persist unless teardown ran. Tests never run an unscoped job tick (v3 §9).

### 12.6 Registry and helper changes PR-A makes to test infrastructure
- `scripts/shared-fixture-fk-coverage.json`: one entry per non-CASCADE FK to `users`/`tenants`/`projects`, **hand-count at build**: deliveries (tenant, project, reported_by, approved_by, rejected_by), capture_documents (tenant, project, sent_by), capture_files (tenant, project), delivery_invoice_links (tenant, project, linked_by, unlinked_by) ≈ **14 entries** `[inferred]`; plus teaching `db.ts`'s `SweepParent` and registry the new parents (`deliveries`, `capture_documents`) so the sweep goes child-first. Lint Rule 9 is fatal without them.
- `test/helpers/db.ts`: `ensureCaptureFixtures()` / `removeCaptureFixtures()` (shared helper file; touching it reaches every suite).
- `scripts/test-db-only-grants.sql`: a fourth entry (X). Applied to test-db only, by hand with an explicit target (its own header: never `--linked`, which resolves to **prod** in that worktree).

---

## 13. Prod read-only probes needed BEFORE review (list only; NOT run)

Each with the target ref printed first (`cat supabase/.temp/project-ref` must equal `jvxwqignooseazzmwhvl`) and results redirected to a file, then read selectively (`CLAUDE.md` "never pipe unfamiliar output").

| # | Probe | Why |
|---|---|---|
| P1 | `SELECT version();` | PG major must match the local scaffold (17.x); the dry-run rule |
| P2 | `SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.whatsapp_sessions'::regclass AND contype='c';` | F2 on **prod**, expect `whatsapp_sessions_current_flow_check` with the five flows |
| P3 | `SELECT count(*) FROM public.whatsapp_sessions WHERE current_flow='invoice';` | F7 on prod; expect 0 |
| P4 | `SELECT id, name, public, file_size_limit, allowed_mime_types FROM storage.buckets;` | F4 on prod; confirms `capture-documents` is free and the two columns exist |
| P5 | `SELECT name, default_version, installed_version FROM pg_available_extensions WHERE name='btree_gist';` | F3 on prod, for the record only (D7: not installed) |
| P6 | `SELECT p.oid::regprocedure, p.provolatile FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='pg_catalog' AND p.proname IN ('timezone','date') ORDER BY 1;` | F1 on prod; expect `timezone(text,timestamptz)` `i`, `date(timestamp)` `i` |

**Additions of mine (not in your list; take or drop):**
| # | Probe | Why |
|---|---|---|
| P7 | `SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid='storage.objects'::regclass;` and `SELECT count(*) FROM pg_policies WHERE schemaname='storage';` | **gate for §9**: "no policy" is safe only if RLS is enabled |
| P8 | `SELECT conname, conrelid::regclass FROM pg_constraint WHERE conname IN ('users_id_tenant_id_key','projects_id_tenant_id_key');` | the composite-FK targets exist on prod |
| P9 | `SELECT defaclrole::regrole, defaclobjtype, defaclacl FROM pg_default_acl;` | what a new table receives by default after 047 |
| P10 | none of the 4 table names / the trigger-function names exist: `to_regclass('public.deliveries')` etc. | no name collision |
| P11 | `SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.project_members'::regclass AND contype='c';` | the six-role CHECK (048) is what the RLS predicate assumes |
| P12 | `SELECT pg_get_functiondef('public.get_user_tenant_id()'::regprocedure);` | the RLS function the policies call |
| P13 | `supabase migration list` (local vs remote) | the §1 header line I could not fill |
| P14 | **Not SQL:** the project-wide Storage file size limit (dashboard / management API) | the bucket's 16 MiB cannot exceed it |

---

## 14. `types/database.ts` regeneration

Command per `CLAUDE.md` §6: `npx supabase gen types typescript --linked --schema public > types/database.ts`, committed as a diff after every schema migration. Points specific to this PR:
- `gen types --linked` is a Supabase CLI command that touches a project: the instruction must **name the ref** and `supabase/.temp/project-ref` must be printed and equal it first (`CLAUDE.md` "CLI … MAY RUN ONLY WHEN THE INSTRUCTION NAMES THE TARGET PROJECT REF"). Output redirected to a file, not piped to the transcript.
- **Which database.** Generated types differ by database: test-db carries test-only objects prod does not (048's reservation note: `quoco_test_row_is_locked` "absent from prod's live-generated TypeScript types" [read]). Generating from test-db before the prod apply would put test-only helpers into committed types (Y), and the new test-db-only GRANTs do not affect types (X). Recommended: **generate from prod after the prod apply**, in the apply's follow-up commit. The cost: tests added in PR-A reference `.from('deliveries')` and will not type-check until the types land. **Q-TYPES:** commit types from test-db with the helper diff reviewed, or order the tests after the prod apply. Not resolved here.
- Expected diff: four new `Tables` entries (Row/Insert/Update/Relationships, composite FKs appear in Relationships), no `Functions` entries (trigger functions are not exposed), no change to `whatsapp_sessions`. The generated-column fields (`delivery_date`, `dc_doc_kind`, `inv_doc_kind`, `self_invoice_id`) appear as `never` in Insert/Update: confirm.

---

## 15. Risks, unknowns, guesses

### Risks
- **R-A.** Definer trigger functions add review surface (§6 Q-DEF), and every trigger is a thing an owner can disable. The declarative parts (D6, A33, `self_invoice_id`, kind pinning) were chosen to keep the trigger list short.
- **R-B.** Under X, **test-db ≠ prod grants** on four more tables; CI cannot prove the service_role DELETE denial. Mitigated by rehearsal capture + prod readback, not eliminated.
- **R-C.** `tenant_id → tenants RESTRICT` departs from 043/044's CASCADE. If you wish to keep tenant deletion workable the whole composite-FK set has to be reconsidered, not just this column.
- **R-D.** The generated-column composite FKs (`dc_doc_kind`, `inv_doc_kind`, `self_invoice_id`) are unproven. If Postgres rejects them, D6 falls back to a trigger and the §5 argument about PostgREST seeding weakens (the reverse pointer would still hold, with a trigger instead of an FK for the kind).
- **R-E.** `ON CONFLICT DO NOTHING` on the bucket: mitigated by the assertion block; if a same-id bucket already exists with other settings, the apply aborts (correct) rather than proceeds.
- **R-F.** An approved-then-superseded delivery is shown as pending after a restore (D3); the PM page (PR-D) must surface the link-row history or the approval vanishes from the PM's view, even though it is recorded. A PR-D requirement created by GAP A.
- **R-G.** The switch trigger (first RCPL/beta data on prod) is expected to fire in this slice; from then everything is FULL tier permanently (`CLAUDE.md:684`).

### Unverified (I could not check offline)
Generated-column FK acceptance and `MATCH SIMPLE` behaviour (R-1); lock-order and race behaviour (CI-only); whether Storage enforces the MIME list on `service_role` uploads and whether it sniffs bytes; whether `storage.objects` has RLS on (P7); the project-wide Storage limit (P14); whether `storage.buckets` has exactly the columns I name; how test-db-only scripts are applied in CI (I read their headers: applied by hand with an explicit target; I did not find a CI step); whether lint Rule 9's regex handles a `FOREIGN KEY … REFERENCES … ON DELETE RESTRICT` clause identically (it handles composite clauses; `ON DELETE RESTRICT` is not CASCADE so entries are required) `[read lint-migrations.mjs:440-488]`; that `phone` slots 121–124 are free after a build-time re-grep.

### Guesses (each is also marked above)
Bucket id `capture-documents`; MIME list entries `heic`/`heif`; byte count 16 777 216; `reject_reason` value list; char-length caps (64 / 1000); `rejected_by/at`; `byte_size` cap only on stored rows; `storage_path` tenant-prefix CHECK and path convention; generated-column FKs; definer + empty `search_path` for trigger functions; TR4c/TR5 extras; the `capture_files` column-scoped UPDATE living in PR-A; 14 registry entries; phone slots 121–124; indexes; `tenant_id` RESTRICT.

---

## 16. Questions to answer before any SQL is written

**Decisions that change the schema**
1. **Q-D6 shape.** Approve the reversal in §5 (delivery points at its document; `capture_documents.delivery_id` is removed; exactly one of `dc_document_id` / `created_from_invoice_id`)? It is what makes D6 declarative, and it changes v3 §2.2.
2. **Q-GAPA.** Option 1 (events table) or Option 2 (snapshot on the self-link row)? I recommend 2.
3. **Q-REJ.** When the PM **rejects an automatic delivery**, what happens to its self-link? v3 says a rejected automatic delivery is "inactive for the A28 rule" (`:189`), but its self-link row stays active unless something unlinks it, and then a later PM link would trip TR1. Recommended: reject soft-unlinks the self-link with a new `unlink_reason='delivery_rejected'`. Cost: "every invoice always has an active link" (v3 Q2 point 5, `:312`) becomes "…unless its automatic delivery was rejected", which 1b's allocation logic must know.
4. **Q-SID.** Add `source_message_sid` + `media_index` with a unique to `capture_files` now?
5. **Q-FK.** `tenant_id → tenants` RESTRICT (mine) or CASCADE (043/044 precedent)?
6. **Q-X.** Take TR4c (status-transition guard) and TR5 (document immutability), or leave those to PR-B functions only?
7. **Q-DEF.** Definer trigger functions (needed for `FOR SHARE`/`FOR UPDATE` without table grants), or invoker?
8. **Q-GRANT.** Keep the `capture_files` column UPDATE grant in PR-A (unused until PR-C) or defer it?

**D8 and the bucket**
9. **Approve or edit the MIME list** in §9, including whether `image/heic` and `image/heif` stay.
10. **16 MB = 16 777 216 bytes (16 MiB)**, or 16 000 000?
11. **Q-GLOBAL.** Can you read the project-wide Storage file size limit from the dashboard (P14)?

**GAP B and the clock**
12. **Q-CLOCK.** A delivery the engineer never answered: no clock (my default, A36 literal) or fall back to `received_at`?
13. **Q-ACK.** Does a *No* or *Unclear* reply start the 30-day clock?
14. **Q-30.** Overdue at day 30 (`>=`) or day 31 (`>`)?

**Process**
15. **Q-TDB.** Option X (fourth entry in `test-db-only-grants.sql`; CI loses the service_role DELETE-denial proof) or Option Y (test-only helper functions)? And do you want CLAUDE.md §0's "named exception" paragraph brought in line with the three entries the script already holds (§0 N-f)?
16. **Q-TYPES.** Types from test-db now (reviewing the helper diff) or from prod after the apply?
17. **P7, P13, P14** are the probes I could not make myself and that gate the review request: please say when they have been run, or tell me to include them in the package as "owed".

**Carried from earlier, still open and relevant to PR-A**
- The cofounder's confirmation of A10/A18 is still not recorded (`capture-engine-design.md:324-325`). It does not block PR-A's schema; it blocks switching engineers on.
- Every string in §10 is wording owed — Aravind.

END OF PR-A PLAN 1010
