Copied into the repo on 2026-10-10 from /tmp/quoco/slice1a-plan-v3.md (written 2026-10-06/07, 423 lines). Later decisions change this plan: A29 (late 1/2/3 after the timeout), A30 (supplier name blank in 1a; settles Q1 as option c), A31 (approved automatic delivery may be superseded by link; settles X6), A32 (multi-DC invoices are sent by engineers), A33 (a DC has at most one invoice). See docs/plans/capture-engine-design.md, 'Decisions, 6–10 Oct 2026 IST'. The plan text below is unchanged.

# Slice 1a plan v3 — engineer capture, A18 confirmation, storage, PM approval, PM invoice linking, automatic delivery from invoice

PLAN ONLY. No code, no commits, no branch, no push, no database access, no Supabase CLI. Written 2026-10-06/07 (IST night).
Base: `origin/main` = `5789b9c72e1fedd6ae4f8bb4f382fc1e746d1c30` (fetched, read back, logged; matches the expected SHA, so v2's code evidence was not re-read wholesale).
Worktree (detached, read-only use): `/Users/aravindanrajamani/Desktop/quoco-1a-plan-v2` (HEAD = the same SHA, `status --porcelain` empty at start). Log: `/tmp/quoco/slice1a-v3-log.txt`.

**Marks.** `[read]` = read this session (v3) at the line cited, against that SHA. `[v2-read]` = read in v2, carried, not re-read. `[per Aravind]` = a decision in A1–A28, not observed in code. `[web]` = provider doc via fetch tool (v2). `[inferred]` = my conclusion. `[GUESS]` = I filled a gap (collected in §12). `UNVERIFIED` = I could not check it offline.

**Honest notes on this task.**
1. **The brief arrived inline in the message, not as a file.** I cannot give a file line count. Its last line is `END OF BRIEF v3`, so it is not truncated. Unlike v2's brief, every question Q1–Q8 arrived whole.
2. **Logging.** Every shell command and its raw output is in the log, one command per call. Reads through the Read tool are not shell commands and are not in the log. They were: v2 plan (whole), `docs/plans/capture-engine-design.md` (whole, 253 lines), `lib/whatsapp/session.ts` (1–150), `supabase/migrations/044_hindrance_photos.sql` (425–504, 596–626), `001_core_schema.sql` (140–190, 360–400), `lib/whatsapp/inbound-start.ts` (225–370). The `[exit N]` lines come from my wrapper, not from the commands.
3. The last two log entries are the worktree `git status --porcelain` and `wc -l` of this file, as instructed.

---

## 0. Changes since v2, and every conflict

### 0.1 What the new decisions change in the plan

| Area | v2 | v3 | Cause |
|---|---|---|---|
| Money in 1a | `delivery_items`, PM item entry, rates, pre-tax sums, approval needs every item priced | **None. No money value anywhere in 1a.** Moved to the 1b appendix (§11). | A23, A24 |
| Owner email | P5: job, ledger, claim function, `sendEmail` idempotency | **Removed from 1a.** Appendix §11, updated for A19–A22, A26. | A24 |
| Engineer confirmation | Draft ack questions, invented wording | Numbered replies 1 Yes / 2 No / 3 Partially after a DC **or** an invoice; 2 and 3 ask a short free-text note. Four draft strings **withdrawn**; slots only. | A18, brief |
| Invoice with no DC | v2 §3.6: invoice creates **no** delivery; PM action "create delivery from invoice" | **Every invoice creates a delivery**, labelled "created from invoice"; linking it to other deliveries cancels it (§3.4, §4.5). `pm_create_delivery_from_invoice` is **deleted**. | A28 |
| Linking | PM links invoice to DCs; one table | Same table, plus a self-link row for the automatic delivery, `link_source` values `created_from_invoice` / `pm_manual`, a DB rule for "automatic XOR links to others" | A16, A28 |
| Engineer idle exit | none (N3: session lasts the IST day) | **30 minutes of silence ends a `material_inward` flow** (material_inward only); partial delivery stays, shows "not acknowledged" | A27 |
| Free-text GRN without a document | v2 C11: not built, asked | **Closed.** Every GRN is a WhatsApp message with a DC or invoice attached plus the confirmation. | resolved (6 Oct 23:11) |
| Delivery statuses | incomplete / awaiting_pm / approved / rejected | adds **`cancelled`**; `incomplete` is now defined (§3.1) | A28, D1, A27 |
| Delivery `owner_send_id`, value columns | in 1a | 1b, additive | A24 |

### 0.2 Conflicts (A16–A28 vs v2 or A1–A15 — A16–A28 win; each named)

| # | Conflict | Resolution in this plan |
|---|---|---|
| X1 | **v2 §3.6** (invoice makes no delivery; double-count hazard) vs **A28** (every invoice makes one). | A28 wins. v2's double-count hazard is real only in 1b (money); A28's "active automatic XOR links" rule is what removes it. Still: until the PM links, an invoice and its DC are two active deliveries for the same goods (§12 R2). |
| X2 | **A1** (1a includes the owner email) vs **A24** (owner email moves to 1b). | A24 wins. A1's text is stale; P7 records a dated correction. |
| X3 | **A7** (owner sees money, from PM values) vs **A23** (PM types no values) vs **A20/A21**. | All money is 1b. A7's "PM values" is superseded by A23's "machine reads, PM confirms". A19's "money values only" reading question (v2 C12) is **resolved by A21** (quantity and amount): reading (a). |
| X4 | **A13** "PM must enter supplier or origin name before approval" vs **A23/A24** (no machine reading in 1a, so no other source). | **Not resolved here, on instruction.** Four options in Q1. Until you pick, `pm_approve_delivery`'s name check is built to the answer. |
| X5 | **A13** "invoices view-only" vs **A16** (PM links by hand). | Resolved by the brief: linking allowed; no editing or approving of invoice content. (Carried from v2 C10.) |
| X6 | **A14** "approval is final in 1a" vs **A28** "linking cancels the automatic delivery". | **Open.** If the PM already approved the automatic delivery, cancelling it breaks "approval is final". Recommended: the link function **refuses** while the automatic delivery is approved (§4.5, §12 D3). This traps an invoice that was approved before it could be linked; your decision needed. |
| X7 | **N3 (v2)**: a session lasts until the IST date changes vs **A27**: 30 minutes. | A27 wins **for `material_inward` only**. Morning, evening, hindrance sessions keep the IST-day rule. A test proves they are unchanged (T-A27-7). |
| X8 | **A8** "PM sets the type at approval" vs **A16/A28**: "invoice expected" and the automatic delivery need a type before approval. | Born with type `NULL`, as A8 says. Consequence: an automatic delivery behaves as a purchase and **can never be set to internal transfer** while its self-link is active (Q3). Stated, not silently resolved. |
| X9 | **A27** ("next message handled as if no flow were active") vs the idle menu: after expiry, an engineer who answers the stale ack question with **1 / 2 / 3** hits the idle menu. | **This is a defect in A27 as written, not a wording gap.** At idle, `1` starts the **hindrance** flow, `2` replies "Safety reporting is not available here. If someone is hurt or in danger, call your site supervisor now.", `3` replies "That option isn't available yet. Nothing was recorded." `[read: inbound-start.ts:255-265, :321-327, :348-353]`. So "Yes" after a 31-minute silence starts a hindrance report; "No" triggers a safety message. Flagged for decision, not silently fixed (§12 D1, risk R1). Also touches Rule 3.5 "never punish, never dead-end" `[read: design-principles.md:33]`. |
| X10 | **Rule 3.6** (`"Question N of M"` in every prompt, `design-principles.md:34` `[read]`) vs a flow whose length depends on the reply (3 questions after Yes, 4 after No/Partially). | M is not fixed. **Needs your ruling** on how the progress line reads here (§7, §12 D4). |

Not conflicts, recorded: A20 (grand total in owner email; before-GST on dashboard), A21, A22, A25, A26 apply in 1b (A24) and are in §11.

---

## 0.3 Findings that carry from v2 (evidence kept; only the scope notes change)

N1 (two router collapses + flow-keyed media branches), N2 (morning/evening do not start over a live `material_inward`), N3 (`expires_at` never read; superseded for `material_inward` by A27), N4 (`acquire_and_transition_session` has no production caller), N7 (039 used column grants + RLS, not a definer function): **unchanged, `[v2-read]`**, and N1/N2 remain 1a requirements. **N5 (job queue has no lease) and N6 (`sendEmail` sends no idempotency key) move to §11**; they only matter for the 1b owner email. Full evidence text is in `/tmp/quoco/slice1a-plan-v2.md` §0; not copied here so it cannot drift.

### New findings this round

| # | Finding | Evidence | Consequence |
|---|---|---|---|
| **N8** | **Every flow RPC writes `expires_at = p_now + INTERVAL '30 minutes'` and `updated_at = p_now` on every turn it processes, including `reask`.** `expires_at` is therefore *already* a "30 minutes since the last turn" clock for every flow; nothing reads it (N3). No trigger on `whatsapp_sessions` touches `updated_at` (grep of `supabase/migrations` returned only indexes, RLS policies and a REVOKE). | `[read]` 044:604-614; `[read]` grep: `updated_at = p_now` at 038:378/696/1162, 040:884, 044:612; trigger grep (exit 0, no trigger lines) | A27's clock exists for free. The router/RPC compares `expires_at` to now, only for `material_inward`. No second constant to drift. The new RPC must write both columns the same way on every turn (T-A27-5). |
| **N9** | **A stale `material_inward` row breaks the other flows' start.** `apply_hindrance_flow_turn`'s start branch is: current_flow NULL → start; anything else → `reask` (044:464-486, comment 483-485: "any already-active flow re-asks its own current question"). If A27 only makes the **router** treat the session as idle, the row still says `material_inward`; the engineer types `1` (hindrance), the router calls the hindrance RPC, and it answers `reask` for a flow that is not hindrance. The same trap exists for any future start RPC. | `[read]` 044:464-486 | The 30-minute rule cannot live only in the router. It also needs the row cleared (Q5: new `expire_stale_material_inward`). N2's change covers the scheduled check-ins; this covers the engineer-initiated hindrance start. |
| **N10** | **The `vendors` table exists but nothing uses it.** `001_core_schema.sql:364-380`: `tenant_id`, `name NOT NULL`, `trade_category`, `phone`, `status`, plus unused future columns. RLS is tenant-wide CRUD (`002`:440-456) minus delete (047:241). No `from('vendors')` in `app/`, `lib/`, `components/` (grep exit 1). No project scope. | `[read]` 001; grep logged | Input to Q1 option (b): usable, but nobody can create a vendor today, and a vendor is not an "origin". |
| **N11** | **The existing `invoices` table is the thing 1b hardens, and it is not shaped like a document.** `001:155-177`: single-column FKs, `submitted_by NOT NULL`, `amount DECIMAL(10,2)` (breaks CLAUDE.md §6's 12,2 rule), status `pending/approved/rejected`, `image_url`. 1a does not touch it. | `[read]` 001:155-177 | Input to Q2. 1a keys the link table on `capture_documents.id`, never on `invoices.id`. |
| **N12** | **A bucket is created by migration**, precedent `042_storage_bucket_setup.sql:74` (`INSERT INTO storage.buckets`); 042's header says the apply tool can write `storage.buckets`. | `[read]` grep | The new capture bucket is created by the tables' migration (PR-A), mirroring 042. I did not read 042's policy section: **UNVERIFIED** whether a private bucket needs any `storage.objects` policy (v2's plan serves files through server-signed URLs, so likely none). |
| **N13** | **Check-in force-reset can swallow a numbered reply.** If a scheduled check-in force-resets a live `material_inward` session (N2) while the ack question is pending, the engineer's `1` then lands on the check-in's first question. | `[inferred]` from N2 + A18 | Risk R5. Accepted by D1 ("check-ins win") for text; worse for digits. |

---

## 1. Experience

Wording is not drafted anywhere in this plan. "Bot asks the ack question" means slot `MI_ACK_QUESTION_DC` or `_INVOICE`, which is yours.

**Engineer, common start.** Idle → `4` → bot asks DC or invoice → engineer answers → bot asks for the file(s) → engineer sends. **The file, the document row and the delivery row exist before any further question** (same transaction as the session write). The reply to the file says "received" (R1: never "saved"), then asks the A18 question.

| Path | What the engineer sees | What exists afterwards |
|---|---|---|
| **DC + Yes** | file → ack question → `1` → closing line | DC document, file(s), delivery `awaiting_pm`, ack `yes` |
| **DC + Partially** | file → ack question → `3` → note question → short note → closing line | same, ack `partial`, raw note on the document |
| **DC + No** | as above with `2` | ack `no`, raw note |
| **Invoice-only purchase (A28 case 2)** | choose invoice → file → ack question (invoice slot) → `1/2/3` (+ note) → closing line | invoice document, file(s), **an automatic delivery** (`created_from_invoice`, `incomplete` until the ack, then `awaiting_pm`) with its self-link; the engineer sees nothing different |
| **Multi-DC invoice (A28 case 3)** | identical to case 2 from the engineer's side | same rows; **the PM later links the invoice to the several DC deliveries, which cancels the automatic delivery in the same action** |
| **PDF** | identical to the photo path (any of DC / invoice) | original bytes, byte-checked (§5); an encrypted/unparseable PDF is stored `not_previewable` and the PM page says so |
| **Internal transfer** | **identical to a DC.** The engineer is never asked the type (A8). The PM sets "internal transfer" on the PM page. | after the PM sets it: no "invoice expected", cannot be linked |
| **Engineer silent 30 minutes, then types `1`** | the session has ended. `1` is handled **as if no flow were active** (A27): the idle menu's item 1, which today starts the **hindrance** flow. See X9. | the partial delivery stays, shows "not acknowledged" |

(A28's "case 1" is not defined in the brief. I read the cases as: **1** = invoice for one DC, **2** = invoice-only purchase, **3** = invoice bills several earlier DCs `[GUESS]`.)

**Engineer, unexpected input.** At the ack step: a reply that is not 1/2/3 → re-ask **once** with one example (Rule 3.5), then accept: ack `unclear`, the raw text kept in the note column, flow closes, PM sees "unclear". No numeric confidence anywhere (R7). At the kind step or the file step: one re-ask, then close with nothing recorded `[GUESS]` — Rule 3.5's "accept whatever comes" has nothing to accept when the input is not a file or a choice. Voice and video are intercepted upstream and unchanged `[v2-read]` (`route.ts:256-273`).

**PM.** One page, "Material Inward" (approved English title). A list of deliveries and a list of invoices; open a row to see its document(s), the engineer's confirmation, its type, its supplier-or-origin field (Q1), and, for DCs, "invoice expected" with the day count. The PM approves, rejects, sets the type, links an invoice, unlinks. **The PM types no numeric value anywhere** (A23). Detail in §4.

**Owner.** Nothing in 1a (A24).

---

## 2. Data model for 1a

**Rules for every table** (as v2 §3, precedent 043 and 038 STEP 0 `[v2-read]`): `tenant_id UUID NOT NULL REFERENCES tenants(id)`; every parent link is a composite FK `(parent_id, tenant_id) → parent(id, tenant_id)`; parent uniques `users` and `projects` already exist (`017:58,61` `[v2-read]`), new parents get `UNIQUE (id, tenant_id)`. RLS on. Status = `TEXT + CHECK`, never ENUM. `REVOKE ALL … FROM anon, authenticated, service_role` **by name** first, then the narrow grants below; no table gives `service_role` DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN (CLAUDE.md §6). **No money column anywhere** (A24). No `confidence`/`score`/`needs_review` column (R7). No `paid`/`payment_*` column or status (A17). No retention column (A4).

**Least-grant change from v2 `[GUESS]`.** v2 gave `service_role` INSERT/UPDATE on `deliveries`. In v3 every write to `deliveries`, `capture_documents` and `delivery_invoice_links` happens inside a `SECURITY DEFINER` function (the engineer RPC, the five PM functions, `expire_stale_material_inward`), so those three tables give `service_role` **SELECT only**. Only `capture_files` needs a table grant for `service_role` beyond SELECT, because the ingest job (TypeScript) updates its ingest columns: **column-scoped UPDATE** on `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state` (precedent 039's column-scoped grant, N7). Tradeoff: fewer grants, but the bypass tests (§9) must run as the table owner in the rehearsal, not as `service_role`.

### 2.1 `deliveries` — one row per physical receipt, or per invoice-created record
`id`, `created_at`, `tenant_id`, `project_id`, `reported_by` (engineer, `users.id`, **NOT NULL**; every delivery is now created by an engineer's WhatsApp send), `received_at TIMESTAMPTZ NOT NULL DEFAULT now()`, `delivery_date DATE` (IST), `status`, `delivery_type`, `source_name TEXT` (Q1), `vehicle_number`, `dc_number`, `dc_date` (all PM-entered, all optional), `approved_by`, `approved_at`, `reject_reason`, `created_from_invoice_id UUID NULL`, `cancelled_at`, `cancel_reason`.
- `status CHECK ('incomplete','awaiting_pm','approved','rejected','cancelled')`. **`incomplete`** = created, no ack yet (D1: "status incomplete from the first thing the engineer sends"). It becomes `awaiting_pm` inside the engineer RPC when the ack is stored. A delivery whose engineer never answered **stays `incomplete` and is displayed as "not acknowledged"** (A27, P4/O12). **The PM may approve an `incomplete` delivery** `[GUESS]`: blocking would strand every delivery whose engineer walked away.
- `delivery_type CHECK ('supplier','internal_transfer')`, `NULL` until the PM sets it.
- `created_from_invoice_id`: composite FK `(created_from_invoice_id, project_id, tenant_id) → capture_documents(id, project_id, tenant_id)`; **`UNIQUE (created_from_invoice_id)`** (an invoice has at most one automatic delivery for life; "coming back" on unlink reactivates the same row, Q4); immutable after insert (trigger or the absence of any function that changes it).
- CHECKs: `status='cancelled'` ⇒ `cancelled_at`, `cancel_reason` non-null; `cancel_reason CHECK ('superseded_by_link')` (1b/1c may add values); `created_from_invoice_id IS NOT NULL` ⇒ `delivery_type IS DISTINCT FROM 'internal_transfer'` (X8); `status='approved'` ⇒ `delivery_type`, `approved_by`, `approved_at` non-null **and `source_name` non-null/non-blank only if Q1 option (a) or (b) is chosen** (otherwise that clause is dropped and `source_name` stays optional).
- `delivery_date`: unchanged from v2 §3.1 — follows 043's method, rehearsal proves it, the 23-09-2026 00:30 IST boundary is a named test (T-DATE-1). `timezone('Asia/Kolkata', …)` immutability stays **UNVERIFIED**.
- RLS read: tenant match AND the caller is a `pm` of the row's project (`project_members.role='pm'`). No policy for `owner`, `engineer`, `qs`. No write policy: writes go through the definer functions.
- **Arrives in 1b, additive:** `owner_send_id`, value-before-GST / tax / grand-total columns (or a child table, A20/A26), `delivery_items`.

### 2.2 `capture_documents` and `capture_files` (unchanged from v2 §3.3 except the notes)
`capture_documents`: `id`, `created_at`, `tenant_id`, `project_id`, `delivery_id` (a DC's delivery; **NULL for an invoice** — the automatic delivery points back via `created_from_invoice_id`, and PM links go in the link table), `kind CHECK ('dc','invoice')`, `sent_by`, `engineer_ack CHECK ('yes','no','partial','unclear')` NULL until answered, `engineer_ack_note TEXT` (raw), `caption`. `UNIQUE (id, tenant_id)`, `UNIQUE (id, project_id, tenant_id)`, `UNIQUE (id, project_id, tenant_id, kind)`. Composite FKs `(project_id,tenant_id)`, `(delivery_id, project_id, tenant_id)`, `(sent_by, tenant_id)`.
`capture_files`: as v2 (`file_no`, `claimed_content_type`, `content_type` from bytes, `byte_size`, `sha256`, `storage_path` NULL until stored, `ingest_status`, `reject_reason`, `preview_state`, `UNIQUE (document_id, file_no)`).
- **The ack lives on the document, never copied to a delivery.** For an invoice the ack is shown on the invoice record only, labelled as the engineer's reply about that invoice. It is **not** evidence that the linked DCs arrived; each DC's own ack is (Q7).
- Rows and the ingest job are created inside the engineer RPC transaction (v2 §3.3 `[GUESS]`, kept). A `pending` file older than 15 minutes shows as failed on the PM page.
- RLS read: tenant match AND PM of the row's project. 1b adds machine-reading data in **new** tables (`capture_readings` or similar), so 1a's two tables need no column added later.

### 2.3 `delivery_invoice_links` — one table, many-to-many (the A16 + A28 model)
Columns: `id`, `created_at`, `tenant_id`, `project_id`, `delivery_id`, `invoice_document_id`, `doc_kind TEXT NOT NULL DEFAULT 'invoice' CHECK (doc_kind='invoice')`, `link_source CHECK ('created_from_invoice','pm_manual')`, `linked_by` (NULL for `created_from_invoice`, the PM for `pm_manual`; CHECK pins this), `linked_at`, `unlinked_by`, `unlinked_at`, `unlink_reason CHECK ('superseded_by_link','pm_unlinked')`.
- **Self-link.** The automatic delivery carries one row with `link_source='created_from_invoice'` pointing at its own invoice. So **every invoice always has at least one active link row** (its self-link, or the PM's links) — the universal invariant 1b's allocations lean on (Q2).
- FKs: `(delivery_id, project_id, tenant_id) → deliveries(id, project_id, tenant_id)`; `(invoice_document_id, project_id, tenant_id, doc_kind) → capture_documents(id, project_id, tenant_id, kind)`. The schema refuses a link across projects, across tenants, or to a non-invoice document. Needs `deliveries UNIQUE (id, project_id, tenant_id)`.
- Partial uniques: `(delivery_id, invoice_document_id) WHERE unlinked_at IS NULL` (no duplicate active link); `(invoice_document_id) WHERE link_source='created_from_invoice' AND unlinked_at IS NULL` (at most one active self-link per invoice).
- **The A28 database rule** (mechanics in Q4): a constraint trigger refuses any active-link insert that would leave one invoice with both an active self-link and an active PM link. Written as `link_source <> 'created_from_invoice'` for "other", so 1b adding `'auto_match'` needs no trigger change.
- **Two guard triggers for A16's "an internal transfer never expects an invoice"** (Q3), recommended: (i) a link insert is refused when the target delivery has `delivery_type='internal_transfer'`; (ii) a type change **to** `internal_transfer` is refused while the delivery has any active link. Both hold with the functions bypassed.
- **Soft unlink only**; `unlinked_at` once set cannot be cleared (a restore inserts a **new** self-link row, Q4). No money, no amounts, no proportions (A17, A24). **Can a DC have several invoices?** Allowed by the table; "invoice expected" clears at the first active PM link. Unanswered since v2; it stays in §12.
- RLS read: tenant match AND PM of the row's project.
- **Arrives in 1b, additive:** `link_source` gains `'auto_match'` (a CHECK change); allocation amounts in a **new** table keyed on `link_id`.

### 2.4 Other 1a schema changes
- `whatsapp_sessions.current_flow` CHECK gains `'material_inward'` (v2 §3.8: inline constraint from `001:92`; its auto-generated name is read from the catalog at apply time, **UNVERIFIED** now). `SessionFlow` (`session.ts:6` `[read]`) gains the value.
- New private storage bucket, created by migration, mirroring `042` (N12).
- `jobs.type` has no CHECK (`006:7` `[v2-read]`); new type `capture_ingest` is a code change only.

---

## 3. Engineer flow with message count per path

Steps. **S0** idle `4` → session `material_inward`, step 1. **S1** kind (DC or invoice; whether numbered or typed is **not decided**, slot `MI_ASK_KIND`). **S2** file(s). **S3** ack `1/2/3`. **S4** note (only after 2 or 3). RPC `apply_material_inward_turn` locks the session row `FOR UPDATE` (CLAUDE.md §6) and writes `expires_at = p_now + 30 min`, `updated_at = p_now` on every turn (N8).

| Path | Engineer messages | Bot replies | Notes |
|---|---|---|---|
| DC + Yes | 4 (`4`, kind, file, `1`) | 4 | the file's reply carries "received" and the ack question together |
| DC + No / Partially | 5 (adds the note) | 5 | |
| Invoice-only (case 2) | 4 / 5 | 4 / 5 | one extra system effect: the automatic delivery and self-link are created at S2 |
| Multi-DC invoice (case 3) | 4 / 5 | 4 / 5 | the linking happens later, on the PM page |
| PDF | same as photo | same | |
| A further photo of the same document at S3/S4 | +1 per photo | +? | attaches to the same document `[GUESS]`; **whether the bot replies to each is undecided** |
| Silent 30 min, then `1` | 3 before silence (`4`, kind, file) + 1 | 3 + the idle-menu path's reply | `1` starts hindrance (X9) |
| Garbage at S3 | +1 | +1 | one re-ask, then `unclear` |
| Garbage at S1 or S2 | +1 | +1 | one re-ask, then close with nothing recorded `[GUESS]` |

**Save-as-you-go (D1) per step:** file at S2 (rows exist), ack at S3, note at S4. Leaving at any point loses only the pending prompt. The delivery status is `incomplete` until the ack (§2.1).

---

## 4. PM page

Scope: only projects where the PM has a `project_members` row (CLAUDE.md §4). All wording is a slot (§7). Visual design is decided at build with the `impeccable` skill against `docs/design-system-ux-rules.md`.

### 4.1 List states
**Deliveries list**, newest first. Columns: date (DD-MM-YYYY; a new helper, v2), engineer, type (supplier / internal transfer / not set), status, ack (yes / no / partial / unclear / **not acknowledged**), file state, supplier-or-origin (per Q1), and the badge column below.

| State | Shown |
|---|---|
| `incomplete` | "not acknowledged" (A27) |
| `awaiting_pm` | ack shown; approve/reject available |
| `approved` | final; no edit |
| `rejected` | reason shown |
| `cancelled` | **visible, muted**, labelled "created from invoice" and why it was cancelled, with the link to the invoice (A28: "the cancelled record stays visible") |
| created from invoice | label "created from invoice" on the row; no "DC", no "invoice expected" text for it |
| DC delivery with no active PM link, type not internal transfer | **"invoice expected"** + days waiting (A16). Count runs from `delivery_date` to the earliest active PM link's IST date, else today; stops at the link. |
| internal transfer | never "invoice expected" |
| invoice linked | "invoice expected" gone; invoice reference shown |
| any state | **never a "DC missing" text** (A16); never "paid" (A17) |

`INVOICE_OVERDUE_DAYS` is declared with **no value** (A16: TBD); no overdue styling ships.

**Invoices list** (view only, A13): date, engineer, file state, the engineer's ack and note (labelled as about the invoice), "has its own delivery" (active self-link) or the count of DCs it is linked to, and the link / unlink actions.

### 4.2 Open a row
Files (image inline; PDF as an attachment download named by us, content type from verified bytes; v2 §6 `[v2-read]`); engineer ack and raw note; a job-time rejection shown here only ("wrong type", "too large"; R5; the engineer is told nothing, A11); type; supplier-or-origin per Q1; optional vehicle, DC number, DC date.

### 4.3 Approve
`pm_approve_delivery(delivery_id)`: requires status `incomplete`/`awaiting_pm`; `delivery_type` set; the Q1-dependent name check; for an automatic delivery, no extra rule. **Final** (A14). No numeric check exists in 1a.

### 4.4 Reject
`pm_reject_delivery(delivery_id, reason)`. Rejecting an automatic delivery is allowed; a rejected automatic delivery is **inactive** for the A28 rule (so a later link works) and is **never restored** by an unlink (Q4).

### 4.5 Type, linking, and automatic-delivery cancellation
- **Set type / details:** `pm_set_delivery_details(...)`, non-approved deliveries only. Setting `internal_transfer` is **refused** while any active link exists (Q3). The PM sees a plain refusal naming "unlink first".
- **Link:** `pm_link_invoice(p_invoice_document_id, p_delivery_ids uuid[])`, one call, atomic. Steps inside one transaction, in this order: (1) lock the invoice document row (`FOR UPDATE`); (2) check the caller is a PM of the invoice's project and every target delivery is in the same project and tenant; (3) every target must be a DC delivery (has a `dc` document), `status NOT IN ('rejected','cancelled')`, `delivery_type IS DISTINCT FROM 'internal_transfer'`, not itself a `created_from_invoice` delivery `[GUESS]`; (4) if the invoice has an active self-link: its automatic delivery must be `incomplete` or `awaiting_pm` (**refuse if `approved`**, X6); then set that delivery `cancelled` (`cancel_reason='superseded_by_link'`) and soft-unlink its self-link (`unlink_reason='superseded_by_link'`); (5) insert the `pm_manual` link rows. **The cancel and the link are one action** (A28). The constraint trigger sees the self-link inactive before step 5.
- **Unlink:** `pm_unlink_invoice(p_link_id)`; soft unlink; if that leaves the invoice with zero active PM links **and** its automatic delivery was cancelled by a link (not rejected), the automatic delivery comes back (Q4).
- A refusal message for "not allowed" and "not found" is the same one, per v2 §5 `[v2-read]` (no existence oracle).

---

## 5. PDF handling

**Unchanged from v2 §6** `[v2-read]`: A6, A11 (`CAPTURE_MAX_BYTES` 16 × 1024 × 1024, inferred cap, not a Twilio fact), A12 (new bucket, byte-level PDF checks only: `%PDF-` at byte 0, `/Encrypt` token, `%%EOF` marker). Webhook gate, second classifier beside `classifyMediaReply`, the three tests T-WH-17/21/25 rewritten (R4), the `capture` kind added to the photo route and `photo-access.ts`, job `capture_ingest` with a path derived from the file id so retries overwrite. **What v3 changes:** nothing about PDFs; the invoice path now also creates the automatic delivery and self-link in the same RPC transaction as the file rows (§3).

---

## 6. Session and router changes (N1, N2, N3, A27)

1. **Migration/functions (one PR, same as the CHECK, N1/N2):** CHECK gains `'material_inward'`; `apply_material_inward_turn` (service_role only); **new `material_inward` start-branch in `apply_morning_flow_turn` and `apply_evening_flow_turn`** (Q6); `expire_stale_material_inward` (Q5).
2. `session.ts:6` union gains `'material_inward'`.
3. **Replace both flow collapses** (`inbound-start.ts:723-724`, `dispatch.ts:266`, N1 `[v2-read]`) with one exhaustive function ending in a TypeScript `never` check. `Flow` at `dispatch.ts:47` stays three-valued.
4. New router branch **before** `inbound-start.ts:735` for `material_inward` (including media). Nothing falls through to `:749` or `:786+`.
5. **A27 in the router:** `readActiveFlowForRouting` (`session.ts:82-102` `[read]`) today returns `null` only when the IST date changed. v3 adds, **for `material_inward` only**: if `expires_at <= now`, call `expire_stale_material_inward(phone, now)` (service_role) and return `null`. Morning, evening and hindrance are untouched (X7).
6. Idle `4`: `classifyAdhocInput` (`inbound-start.ts:257-265` `[read]`) gains `'item4'`; the type is currently `'item1' | 'item2' | 'item_reserved' | 'unrecognized'`. `CORRECTION_LINE`'s `Exclude<AdhocInputKind,'item1'>` keying (`:348`) needs `item4` handled (or excluded) or the build fails — a deliberate exhaustiveness check.
7. **Pattern grep for the same defect class** (CLAUDE.md §0): the v2 grep stands (`flows/morning.ts:347-361`, `flows/evening.ts:368`, `flows/hindrance.ts:218`, `033:199`: none collapses an unknown value). v3 adds a second grep for "any code that starts a flow over an unknown non-null `current_flow`": the `reask` fall-through in the start branches (038 morning/evening, 040 evening, 044 hindrance). It is the N9 signature. Re-run at build.

---

## 7. String slots (no wording)

Every string is a named constant marked "Tamil owed, NOT approved" and comes to you first. **The four v2 draft strings are withdrawn and not listed.** Constraints any wording must meet, from the rules I re-read: Rule 3.5 (one example, re-ask once), Rule 3.6 (a progress line in every prompt, but see X10: M varies), Rule 3.12 (short sentences; **question last**; same word for the same thing; digits) `[read: design-principles.md:33,34,45]`.

- **Engineer:** `MI_MENU_LINE` (idle menu line for digit 4); `MI_ASK_KIND`; `MI_ASK_FILE_DC`, `MI_ASK_FILE_INVOICE`; `MI_FILE_RECEIVED` ("received", never "saved", R1); `MI_ACK_QUESTION_DC`, `MI_ACK_QUESTION_INVOICE` (A18's numbered question; the invoice one must not assert arrival of goods, Q7); `MI_ASK_NOTE_NO`, `MI_ASK_NOTE_PARTIAL`; `MI_ACK_REASK` (one re-ask with one example); `MI_NOT_UNDERSTOOD_CLOSE`; `MI_DONE`; `MI_KIND_REASK`, `MI_FILE_REASK`, `MI_NOTHING_RECORDED_CLOSE` (S1/S2 garbage, `[GUESS]`); `MI_UNSUPPORTED_FILE_REPLY` (inside the flow; names PDF as accepted); `MI_IDLE_DOCUMENT_NUDGE` (decision: reuse the photo nudge for a PDF at idle, or a variant). **A27 adds no string of its own** unless you decide X9 needs one (e.g. a message to an engineer who answers late). No string for oversize or job-time rejection reaches the engineer (A11, R5).
- **PM page:** `PM_PAGE_TITLE` = "Material Inward" (approved English); status labels (incomplete, awaiting approval, approved, rejected, **cancelled**); ack labels (yes, no, partial, unclear, **not acknowledged**); `PM_LABEL_CREATED_FROM_INVOICE`; `PM_LABEL_CANCELLED_REASON` (superseded by link); `PM_LABEL_INVOICE_EXPECTED` and its day-count label (**no "DC missing" string exists**, A16); `PM_LABEL_PDF_NOT_PREVIEWABLE`; `PM_LABEL_FILE_REJECTED_TYPE`, `…_SIZE`, `…_PENDING`, `…_FAILED`; `PM_TYPE_SUPPLIER`, `PM_TYPE_INTERNAL_TRANSFER`; the Q1 field label and "required" prompt (if any); refusal messages for: internal transfer while linked, link target ineligible, approved automatic delivery cannot be cancelled; actions `PM_ACTION_APPROVE`, `…_REJECT`, `…_LINK_INVOICE`, `…_UNLINK`; `PM_INVOICES_HEADING`; `PM_EMPTY_STATE`; `PM_FILE_UNAVAILABLE`.
- **None for:** owner email (1b), owner/PM WhatsApp alerts (O19), engineer reminders (O16), payment or paid wording (A17), confidence or low-confidence flags (R7).

---

## 8. PR breakdown (Q8)

| PR | Contents | Tier | Reason |
|---|---|---|---|
| **P0** | Already merged: PR #326 (`b14f122`, `ef2b18f`), record `docs/reviews/2026-10-06-p0-sentry-record.md`. New 1a Sentry calls follow its rule: counts, content types, ids only. | done | — |
| **PR-A** | Migration, tables: `deliveries`, `capture_documents`, `capture_files`, `delivery_invoice_links`; composite FKs, RLS, per-role grants, the A28 constraint trigger and the two internal-transfer guard triggers, `current_flow` CHECK, the new bucket (mirrors 042); regenerated `types/database.ts`. | **FULL** | New tenant-scoped tables, RLS, grants, triggers; tenant isolation is the stake. |
| **PR-B** | Migration, functions: `apply_material_inward_turn`; `pm_set_delivery_details`, `pm_approve_delivery`, `pm_reject_delivery`, `pm_link_invoice`, `pm_unlink_invoice`; `expire_stale_material_inward`; **N2 branches in the live morning and evening functions**. DOWN rehearsed with a live in-flight `material_inward` session (CLAUDE.md §7). | **FULL** | New and modified `SECURITY DEFINER` logic: external-review trigger (a) and (b). |
| **PR-C** | App: router/dispatch exhaustive mapping (N1), A27 router read, the `material_inward` handler, PDF handling, `capture_ingest`, photo-access kind, digit 4 live. | **FULL** | Extends the photo-access boundary, handles third-party bytes, reverses part of #325. |
| **PR-D** | PM page: lists, detail, approve, reject, type, link, unlink, "invoice expected", cancelled display. **Must be merged and live before engineers are switched on.** | **FULL** | Reads tenant data and exposes writes. |
| **PR-E** | String constants. | LIGHT | Land with the PR that uses each; every string still comes to you first. |
| **PR-F** | Docs: the dated corrections owed to the design record (§12). | LIGHT | |

Order: A → B → C → D → F. **Engineers are enabled only after D is merged and applied** (design record preconditions). PR-A and PR-B stay in `docs/reviews/` until applied (a migration enters `supabase/migrations/` only when it is being applied, CLAUDE.md §6); numbers confirmed at apply time (048 is on `main`). Regular merge commits for continuing branches. The SWITCH TRIGGER (first RCPL data on prod) is expected to fire in this slice; everything is FULL tier after it. **Removed vs v2:** the owner-email PR and its job, ledger, claim function and `sendEmail` change; `delivery_items`; the PM item-entry functions.

---

## 9. Tests

Markers: `ZZTestCapture-${RUN_TAG}-<scenario>` with `RUN_TAG = crypto.randomUUID()` on **every identifier a test asserts on**: engineer and PM `full_name`, `source_name`, `dc_number`, `caption`, note text, message SIDs, project names (pattern `webhook.test.ts:136-138` `[v2-read]`). Tests never run an unscoped `claimJobs`/`runJobsTick` (orphan jobs on test-db). Concurrency, lock and race tests are **CI-only; "not verified locally"** (CLAUDE.md §0) and are labelled so.

| ID | Behaviour | Positive control |
|---|---|---|
| T-ROUTE-1 (N1) | A `material_inward` session is never dispatched to the morning/evening RPC or the `:786+` media path. | Revert the new branch → red. |
| T-ROUTE-2 | Exhaustive: every `SessionFlow` value through the mapping; a fake extra value fails the build/test. | Fake value → fails. |
| T-SESS-1 (N2) | Scheduled morning **and** evening start over a live `material_inward` session: cleared, check-in starts, partial delivery rows survive; `already_complete` if that half is already submitted. | Same call on the 038/040 SQL (no new branch) returns `reask`. |
| T-DOWN-1 | DOWN leaves a live in-flight `material_inward` session safely reset (the CHECK removal would fail with a row present, so DOWN resets them first). | The same turn works before DOWN. |
| T-FLOW-1 | Save-as-you-go: rows after the file; ack after `1/2/3`; note after the note. A DC with no ack is `incomplete`/"not acknowledged". | Completing the flow changes it. |
| T-FLOW-2 | `2` asks the "no" note; `3` asks the "partial" note; `1` closes; garbage → one re-ask then `unclear` with raw text; **no numeric confidence stored**. | Valid replies take the normal path. |
| T-FLOW-3 | Duplicate message SID → no duplicate rows or reply. | A new SID creates another. |
| T-FLOW-4 | Sequential: check-in mid-flow runs. Simultaneous variants CI-only. | — |
| T-R1-1 | Every engineer reply after a file says "received", never "saved". | A planted "saved" fails. |
| T-A18-1 | **After a DC and after an invoice** the same numbered question path runs (two slots, same behaviour); the engineer is never asked for a rate, total or quantity (no digit-bearing field is stored from engineer text except the ack digit). | An invoice path missing the question fails. |
| T-PDF-1..4, T-SIZE-1, T-R5-1 | As v2 §11 `[v2-read]` (byte checks, encrypted → not previewable, original bytes, download type, cap, no outbound message on job-time rejection). | As v2. |
| T-PDF-5 (R4) | T-WH-17, 21, 25 rewritten to the idle nudge; T-WH-18/19/20/22/23/24 unedited and green. | A PDF inside an active `material_inward` session is accepted. |
| **T-A27-1** | Session 31 minutes idle: the next message is handled as idle (not by the material-inward handler); partial delivery rows unchanged; the delivery shows "not acknowledged". | Same message at 29 minutes is handled by the flow. |
| **T-A27-2** | Boundary tested at 29:59 and 30:01 only, never at exactly 30:00 (whether "after 30 minutes" is `>` or `>=` is not stated, `[GUESS]` `>`). | — |
| **T-A27-3** | Stale `material_inward` row + hindrance start (`1`): the hindrance flow **starts** (outcome `start`, not `reask`) because the row was cleared first. | Skip `expire_stale_material_inward` → outcome `reask` (N9, the bug). |
| **T-A27-4** | Stale row + scheduled morning start / evening start: starts normally (N2 path). | — |
| **T-A27-5** | Every valid turn, including a re-ask turn, refreshes `expires_at`/`updated_at`: an engineer replying every 25 minutes never expires. | A 31-minute gap expires. |
| **T-A27-6** | A turn that reaches the RPC after expiry (router read was stale): the RPC, under the lock, returns `expired`, writes nothing but the clear, and the handler replies via the idle path. CI-only (race). | A live turn processes. |
| **T-A27-7** | **Scoped to `material_inward` only:** a morning, an evening and a hindrance session each idle 31 minutes are still active; they only end on the IST date change. | The material_inward case does end. |
| **T-A27-8** | The IST-day rule still ends a `material_inward` session at midnight (23:50 start, 00:05 message) via the existing path. | — |
| **T-A27-9** | After expiry the next message is a PDF: handled by the idle nudge (A6), not attached to the old document. | Before expiry it attaches. |
| **T-A27-10 (X9)** | Characterisation test of what `1`, `2`, `3` do after expiry **under whatever you decide**; written after the decision, not before. | — |
| **T-A28-1** | An invoice send creates exactly one automatic delivery (`created_from_invoice_id` = the invoice, status `incomplete`) and one active self-link, in one transaction. A DC send creates a delivery and no link. | A DC send with an invoice-only assertion fails. |
| **T-A28-2** | `pm_link_invoice` to two DC deliveries: two `pm_manual` rows; the automatic delivery is `cancelled` with `cancel_reason='superseded_by_link'` and still listed; its self-link is soft-unlinked; **all in one call**. | A failed link (ineligible target) leaves the automatic delivery **un**cancelled (rollback). |
| **T-A28-3 (rule, function bypassed)** | **Run as the table owner in the rehearsal scaffold, not as `service_role`** (service_role has no write grant on these tables, so a `service_role` insert would be refused by the grant and prove nothing about the rule): inserting an active `pm_manual` link while an active self-link exists is refused; inserting a second self-link is refused; inserting a self-link while a `pm_manual` link is active is refused. | Same inserts with the self-link first soft-unlinked succeed. If the CI suite has a direct Postgres connection as the owner, the same test also runs there; **UNVERIFIED** that it does. |
| **T-A28-4** | Unlink restore (Q4): unlink the last PM link → the automatic delivery is `awaiting_pm` again with a **new** active self-link row; an unlink that leaves another PM link restores nothing; a **rejected** automatic delivery is not restored. | A restore does **not** happen when another PM link remains (the contrast case). |
| **T-A28-5 (X6)** | Linking while the automatic delivery is `approved` is refused; nothing changes. | The same link on an `awaiting_pm` automatic delivery succeeds. |
| **T-Q3-1** | `pm_set_delivery_details(type=internal_transfer)` on a delivery with an active link is refused; **also refused at the DB with the function bypassed** (owner insert/update, same note as T-A28-3). An automatic delivery can never be set to internal transfer. | Same call after unlink succeeds. |
| **T-LINK-1** | Link refused across projects, across tenants, to a non-invoice document, to an internal transfer, to a rejected or cancelled delivery, to an automatic delivery — by FK/CHECK/trigger even when the function is bypassed (owner). | Same-project, same-tenant link succeeds. |
| **T-LINK-2 (A16)** | One invoice → two DCs: "invoice expected" clears on both; unlink one → returns for that DC only. | — |
| **T-LINK-3 (A16)** | An invoice-only purchase's UI/data shows no DC text; **no string anywhere contains "DC missing" or "paid"** (grep over constants and rendered output). | A DC delivery with no link shows "invoice expected". |
| **T-LINK-4 (A16)** | Day count: from `delivery_date` to the link's IST date, stops at the link, IST boundary 23:59 vs 00:30; an unlinked delivery's count rises day over day. | — |
| **T-F5-1/2/3 (R6, A14)** | **For each PM function** — `pm_set_delivery_details`, `pm_approve_delivery`, `pm_reject_delivery`, `pm_link_invoice`, `pm_unlink_invoice`: a **PM of another project in the same tenant** is refused, row unchanged (-1); a **PM of another tenant** is refused (-2); refusal is **identical** for a nonexistent id and an unauthorised one; `anon`, a same-tenant non-PM (`qs`) and `service_role` are refused (`42501` via PostgREST where reachable, plus a real anon-key call) (-3). For `pm_link_invoice` the negative cases run on **both** the invoice id and each delivery id in the array (a PM of project A passing an invoice in A and a delivery in B is refused, and **nothing** is cancelled). | The right PM succeeds and the row changes. |
| **T-F5-4** | `apply_material_inward_turn` and `expire_stale_material_inward` are refused for `anon` and `authenticated` (42501) and succeed for `service_role`. | service_role call succeeds. |
| T-F6-1 | The anon-refusal test can fail: on a scaffold built per CLAUDE.md §7 (real dump, named stubs), a planted `GRANT … TO anon` turns it red. | The control. |
| T-DATE-1 | `delivery_date` boundary 23-09-2026 00:30 IST → 23-09, 22-09 23:59 IST → 22-09; DD-MM-YYYY parse reads day first. | A UTC implementation fails. |
| T-R7-1, T-A17-1, T-A24-1 | No `confidence`, no `paid`/`payment`, and **no money column or `amount`/`rate`/`total` column or UI string** in the migration, regenerated types and constants (A24: "1a carries NO money values"). | A planted column fails. |
| T-RLS-1..3, T-FK-1, T-PHOTO-1, T-SENTRY-1 | As v1/v2, extended to the four tables; `capture` kind in the photo-access agreement matrix. | As before. |

---

## 10. Answers to Q1–Q8

### Q1. A13 vs A23: where does the supplier or origin name come from in 1a? (options, no choice)

No machine reading exists in 1a, so the only possible sources are a person or a table. (N10: the `vendors` table exists, unused, tenant-wide RLS.)

| Option | What the PM does | What it means for A13 ("must enter supplier or origin name before approval") |
|---|---|---|
| **(a) PM types it** | Free text in one field | A13 holds **literally**. A23 says the PM "types no values", about the money value before GST and the tax; whether a supplier name counts as a "value" is yours to say. Cost: inconsistent spellings per supplier; free text suits an *origin* like "RCPL yard Kancheepuram". 1b then has two sources for the same field (typed vs read) to reconcile. |
| **(b) PM picks from `vendors`** | Selects an existing vendor | A13 holds, with cleaner data. But today **nobody can create a vendor** (no UI, no code uses the table, N10), so this adds a vendor-creation surface to 1a; an internal-transfer *origin* is not a vendor, so an "internal site" choice is needed too; `vendors` RLS is tenant-wide and unscoped by project; a same-tenant FK needs a `UNIQUE (id, tenant_id)` added to an existing table. Larger 1a scope. |
| **(c) Left blank until 1b** | Nothing | A13 is **suspended for 1a**: the approval gate has no name check. **Consequence you may not want:** approval is final (A14), so every delivery approved in 1a keeps an empty name unless 1b backfills it, which would be a data migration over rows the rules say cannot change. |
| **(d) Approval allowed without it (field stays optional)** | May type it, need not | A13 becomes "optional" instead of "required" **permanently**. Same final-approval consequence as (c) for deliveries approved without a name; the difference from (c) is only whether a field exists at all. |

(a)–(d) are not mutually exclusive in the UI (a field that is optional could be typed or picked), but each answers the A13 question differently. **Not chosen.** The CHECK on `status='approved'` and the approve function's name check are built to your answer.

### Q2. Does the 1a link table survive 1b's `invoices` hardening and machine reading with no rework and no data migration?

**Yes, provided 1a keeps these five things true**, all of which this plan already does:
1. **Links key on `capture_documents.id`, not on `invoices.id`.** 1b hardens `invoices` (N11: single-column FKs, `DECIMAL(10,2)`, `submitted_by NOT NULL`) and gives each machine-read invoice a `document_id UNIQUE` FK to `capture_documents`; joining a link to its `invoices` row is then one join, no re-pointing. 1a creates and touches **nothing** in `invoices`.
2. **A document's identity never changes:** `capture_documents.id` and `kind` are immutable, so 1b's reading tables can reference them.
3. **No money, amount or proportion on a link** (A17, A24). 1b's allocation of an invoice total across several DCs goes in a **new table keyed on `link_id`**; nothing on the link row is rewritten. Soft-unlinked rows are history and keep their allocations' meaning.
4. **`link_source` is a CHECK list** (`created_from_invoice`, `pm_manual`); 1b adds `'auto_match'` by altering the CHECK, additive; the A28 trigger tests `<> 'created_from_invoice'` so it needs no edit.
5. **Every invoice always has an active link row** (self-link or PM links). 1b's allocation rule "the invoice total is split over its active links" is therefore always well-defined, with no "invoice with no links" special case to migrate.

If any of these were broken (links keyed on the delivery side only, a money column on the link, an invoice with no link rows), 1b would need a rework or backfill. **Not a rework, but 1b's job:** the typed (Q1a) name vs the machine-read name; and how an invoice's one total relates to the *per-delivery* values A20 asks for when one invoice covers several DCs (§11, §12).

### Q3. The PM re-types a delivery from supplier to internal transfer while an invoice link is active: refuse or unlink?

**Recommend: refuse**, with a message naming "unlink first". Reasons: (i) A16 says an internal transfer never expects an invoice — an active link on one is a contradiction, not a state to fix silently; (ii) an automatic unlink is a hidden cascade: unlinking the last PM link **restores** the automatic delivery (Q4), so one innocent type edit would cancel a link, resurrect another delivery and change the invoice's meaning without the PM seeing it; (iii) refusal is explicit, reversible and costs the PM one extra click. Enforced twice: in `pm_set_delivery_details` (clean message) and by a DB trigger (guard (ii) in §2.3) so a bypassed function cannot create the state. The same rule makes an **automatic delivery** impossible to set to internal transfer while its self-link is active (X8). Also refused: linking an invoice **to** an already-internal-transfer delivery (guard (i)).

### Q4. A28 mechanics — the rule, the cancel, the unlink

**The rule (recommended).** Model the automatic delivery as a **self-link row** in the same table (§2.3). Then "active automatic delivery XOR active links to others" is a statement about **one table, per invoice**: *active rows with `link_source='created_from_invoice'` and active rows with any other `link_source` never coexist for one `invoice_document_id`.* Enforce with a **constraint trigger on `delivery_invoice_links`** (BEFORE INSERT, and BEFORE UPDATE refusing to clear `unlinked_at`) that first locks the invoice document row (`SELECT … FOR UPDATE`) so two concurrent transactions are serialised, then checks the other kind has no active row. Plus the declarative partial unique (at most one active self-link per invoice) and the immutability of `delivery.created_from_invoice_id`.
*Alternative, not recommended now:* a single exclusion constraint `EXCLUDE USING gist (invoice_document_id WITH =, (link_source = 'created_from_invoice') WITH <>) WHERE (unlinked_at IS NULL)` is declarative and race-safe, but needs the `btree_gist` extension. Whether it is installed and allowed on prod/test-db is **UNVERIFIED** offline, and per CLAUDE.md §7 an extension is a named stub in the dry-run. If a catalog probe at rehearsal shows it present, swapping the trigger for it is a small change.
**Why not a plain CHECK:** a CHECK cannot see other rows. **Test that the rule holds with the function bypassed:** T-A28-3, run as table owner (§9).

**The cancel step (inside `pm_link_invoice`).** Order matters: lock the invoice document → validate the caller and every target → refuse if the automatic delivery is `approved` (X6) → set the automatic delivery `cancelled` (`cancel_reason='superseded_by_link'`, `cancelled_at = now()`), soft-unlink its self-link (`unlink_reason='superseded_by_link'`) → insert the PM links. If any step fails the whole transaction rolls back and nothing is cancelled (T-A28-2 control). The cancelled delivery **stays in the list**, muted and labelled (A28).

**Unlink.** **Recommend: yes, the automatic delivery comes back**, because A28 says every invoice creates a delivery, and without a restore an invoice whose PM links are all removed would belong to **no active delivery and drop off the PM's work list silently**. Rule: when `pm_unlink_invoice` leaves the invoice with **zero active PM links**, **and** its automatic delivery is `cancelled` with `cancel_reason='superseded_by_link'`, then in the same transaction the automatic delivery goes back to `awaiting_pm` (its pre-cancel state is always `incomplete` or `awaiting_pm`; it is re-derived from whether the invoice document has an ack) with `cancelled_at`/`cancel_reason` cleared, and a **new** self-link row is inserted (the old one stays as history, since `unlinked_at` is never cleared). **Not restored:** a *rejected* automatic delivery (the PM said it is not a real delivery); a delivery whose unlink still leaves another PM link. Cost of this recommendation: a restore is an automatic side effect the PM did not click; it is shown on the list. Alternative (no restore, PM re-creates by hand) would reintroduce a PM action v3 deleted and the silent-drop gap.

### Q5. A27 mechanics

**Where the 30-minute check runs: both, with different jobs.**
- **Router read** (`readActiveFlowForRouting`, unlocked read, `session.ts:82-102`): for `material_inward` only, `expires_at <= now` ⇒ treat as not active. This is a **routing** decision. 022's own header says an unlocked read can mis-route but cannot write wrong data, because the RPC re-reads under the lock `[read: session.ts:37-44]`.
- **RPC, under the lock** (authoritative): `apply_material_inward_turn` checks `expires_at <= p_now` **before** doing anything; if expired it clears the session (flow NULL, step 0, MI context keys removed) and returns `expired` with no other write; the TS handler replies via the idle path.
- **The row must also be cleared on the router path, not only on the RPC path (N9).** Recommend a new `expire_stale_material_inward(p_phone_number, p_now)`, `SECURITY DEFINER`, `service_role` only, called by the router before it returns `null`: it locks the row and clears it only if still `material_inward` and still expired, so a late turn racing it is safe. **Why not fold the check into the BOT-07 reset block of every flow RPC** (038/040/044, the way the IST-date reset works): that would modify the live hindrance function too (a third live function in the external-review package) for a state only `material_inward` produces. The new function is new surface but touches no live logic.
- Clock: `expires_at`, already written as `p_now + 30 min` on every turn by every flow RPC (N8). 30 minutes lives in SQL only (the new RPC writes it; the router and the expire function only compare), so there is no second constant to drift.

**What the next message does.** After expiry the session is cleared and the message goes down the ordinary idle path. Consequences, listed because they surprise: `1` starts the hindrance flow, `2` gets the safety-not-available reply, `3` the "not available yet" reply, `4` starts a new material-inward flow, a PDF gets the idle nudge, and **the old delivery stays exactly as it was, "not acknowledged"** (X9, R1). **I did not choose anything here.** Options if you want to change it (each needs your decision, none is in the plan): (1) accept as written; (2) a short grace window after expiry in which a bare `1/2/3` gets a "that question has ended" reply instead of the menu; (3) shorten nothing, but change the ack digits. (2) and (3) conflict with A27's "as if no flow were active".

**Interaction with N2 and N3.**
- **N2 (check-in force-reset):** a scheduled morning/evening start over a *live* `material_inward` session clears it (Q6). Over an *expired* one it does the same; the expire function is not needed on that path, but the order of operations must not matter (T-A27-4). The pending ack prompt is lost either way; the delivery shows "not acknowledged" (N13/R5).
- **N3 (session lasts the IST day):** for `material_inward` the 30-minute rule is the shorter limit and wins; the IST-date rule still applies first (a session that crosses midnight ends by the date rule, T-A27-8). For every other flow N3 is unchanged (T-A27-7).
- **Hindrance start over a stale row:** handled by clearing the row first (N9, T-A27-3). A live `material_inward` session cannot reach the hindrance start branch (the router sends every message to the flow handler), except through a race between the router read and the RPC, which is CI-only.

**Tests:** T-A27-1 … T-A27-10 (§9). Concurrency variants (T-A27-6) are **not verified locally, CI-only**.

### Q6. N2 still required in 1a — confirmed

Yes. The live `apply_morning_flow_turn` (038) and `apply_evening_flow_turn` (040) start branch is: current_flow NULL → start; hindrance → clear and start; **anything else → `reask`** (038:518-520; 040 start branch 500-539, hindrance 512, `reask` 539; `[v2-read]`). With `material_inward` live the check-in would **not** start, contradicting D1 ("check-ins run on time"). **The change:** add a `material_inward` branch to **both** functions mirroring the hindrance branch: clear the session, keep the cross-flow markers, subtract only the flow's own context keys (038 B1 style), return `already_complete` if that day's half is already submitted; the partial delivery stays saved, unlike hindrance's discard. **Gate: external-review trigger (a)** (live function logic changes, CLAUDE.md §0), **FULL tier**; arguably also (b) (the packages already review per-role grants). Signatures unchanged, so `CREATE OR REPLACE` preserves grants (CLAUDE.md §6 qualifier), but the review package still fingerprints each function's ACL before and after. Required evidence: the review package opens with the repo-state header (§0), the disposable dry-run from a real dump (§7), T-SESS-1 with its `reask` positive control, and a **DOWN rehearsal with a live in-flight `material_inward` session** (§7). I am not touching the hindrance function (044); N9 is handled by Q5's new function.

### Q7. A28 case 3 — wording risk only

The A18 question asks whether goods **arrived**. An invoice that bills goods received earlier on DCs may not describe an arrival at all: the engineer might answer "Yes" to mean "the invoice is fine", or "No" because the invoice quantities differ, or "Partially" because only some DCs were seen. Three effects to flag: (1) the invoice-question slot (`MI_ACK_QUESTION_INVOICE`) should not assert arrival; (2) the ack is stored on the **invoice document**, not copied to the DCs, so it cannot be misread as evidence the earlier DCs arrived (each DC's own ack is that evidence); (3) in case 2 (invoice-only) the question *is* an arrival question, so one slot may need two meanings. **Whether site engineers send such invoices at all is an open question for Aravind** (§12 D5). I have not drafted or proposed wording.

### Q8. Revised PR breakdown — see §8. Tiers and reasons are in the table. Engineers are switched on only after PR-D.

---

## 11. 1b design carried forward (appendix, updated for A19–A22, A25, A26)

**Not built in 1a.** Kept so the design is not lost. Every number below needs re-checking when 1b is scoped.

**1b adds, all additive over 1a (no 1a column is rewritten):**
- **Machine reading (A2, A5, A23, A25).** New tables for readings and PM-confirmed values (not columns on `capture_documents`). Claude reads in a background job (never in the webhook, NFR-16); supplier documents may go to the Anthropic API (A5). The PM types **no** value (A23); the PM confirms before anything is stored, and **may correct a reading before confirming** (A25).
- **Money fields (A20, A26).** Per delivery: value before GST, tax, grand total. Tax kept as separate data points: CGST, SGST, IGST, round-off (A26). `DECIMAL(12,2)`. Arithmetic check (A15): subtotal + CGST + SGST + IGST + round-off = grand total. A line-sum check alone fails on correct GST invoices. The DC sample: lines 59,700; CGST 5,373; SGST 5,373; grand total 70,446.00 (A15 evidence).
- **`invoices` table hardening** (design record "Constraints" + N11): composite same-tenant FKs, project-scoped policies (not tenant-wide), `(12,2)` amount, link to `capture_documents.document_id UNIQUE`; FULL tier; per Q2 the 1a link table needs no change.
- **Automatic matching** (A16): `link_source` gains `'auto_match'`; PM links by hand remain.
- **Allocation** of an invoice's value across several linked DCs in a new table keyed on `link_id`. **Unresolved:** A20 asks for values *per delivery*; when one invoice covers several DCs, is the invoice total allocated, or does each DC carry its own read value? The A28 rule guarantees an invoice is counted either on its own automatic delivery or on its linked DCs, never both, which is the double-count protection v2 §3.2 wanted. `[GUESS]` that money is read per DC *and* per invoice and reconciled; undecided.
- **Delivery items (v2 §3.2, R8):** one row per physical item *only if 1b still wants items*; A23 says the PM types nothing, so items would come from machine reading, not PM entry. The v2 PM-entry functions (`pm_set_delivery_items`, the item-priced approval rule, `pm_create_delivery_from_invoice`) are **dead**: superseded by A23 and A28. The v2 "pre-tax gap" is closed by A20/A26 (tax is a data point). The sample sum 59,700 is a test fixture only.

**Owner email (A19–A22, A24):**
- Separate email, once per project per IST night, approved purchases only; **money values only; internal transfers absent** (A19); **purchases show quantity and amount** (A21; resolves v2 C12); **owner email shows the grand total, the dashboard commercial sections show the value before GST** (A20); no invoices or attachments (A7); nothing sent on an empty night.
- **An owner send unconfirmed for over 24 hours rolls forward to the next night (A22).** This settles v2 §8's "release and roll forward vs hold for a human" in favour of release. `[GUESS]` that "unconfirmed" means the ledger claim has no provider confirmation after 24 hours (v2's `abandoned`), not "unconfirmed by a person". Please confirm the reading.
- **Ledger + claim function (v2 §8):** `owner_delivery_sends` with `UNIQUE (project_id, send_date)`, `claim_owner_delivery_send` returning `nothing_to_send / claimed_new / already_sent / in_flight / takeover`, a lease constant (proposed 10 minutes), the set frozen at first claim (stamped `owner_send_id`), `Idempotency-Key` = ledger row id, byte-identical retry payload.
- **N5 (carried verbatim in substance, `[v2-read]`):** the job queue has no lease — `claimJobs` selects `pending`/`failed` only and sets `running`; nothing reclaims a `running` job; a worker killed mid-job leaves `running` forever, which also blocks the night's re-enqueue (`app/api/cron/owner-send/route.ts:110-116`). Retry backoff is `min(60·2^n, 1800)` s for n = 1..4 (2, 4, 8, 16 min); `MAX_ATTEMPTS = 5` (`lib/queue/jobs.ts`). So the stuck-claim rule must live in its own ledger with a lease; the cron's dedup must key on the ledger, not on `jobs` rows. The same latent defect exists for today's `owner_deliver` job (observation, out of scope).
- **N6 (carried):** `sendEmail` sends no idempotency key (`lib/email/send.ts:143-145,158-161`); Resend's documented `Idempotency-Key` header (≤ 256 characters, 24-hour window, same key + different payload → 409) `[web, v2, fetched 2026-10-06]` needs an optional parameter added; re-verify against the live API in the 1b rehearsal.
- **Tests carried:** T-ONCE-1/2/3 (once-per-night, stuck claim, > 24 h), T-EMAIL-1, T-OWNER-1/2/3 (internal transfers never appear, single-project scoping, roll-forward), T-ITEM-1/2 (if items survive), per v2 §11.

---

## 12. Risks, unknowns, guesses

### Decisions I need from you
- **D1. X9 / A27:** after expiry, `1` starts hindrance and `2` prints a safety message. Accept, or change? (Options in Q5.)
- **D2. Q1:** supplier/origin name: (a) PM types, (b) vendors table, (c) blank until 1b, (d) optional forever. And is a supplier name a "value" under A23?
- **D3. X6:** if the PM approved the automatic delivery and later wants to link the invoice, refuse (recommended) or allow cancelling an approved record? Refusing leaves that invoice unlinkable.
- **D4. X10 / Rule 3.6:** how does "Question N of M" read when M is 3 or 4 depending on the reply? 
- **D5. Q7:** do site engineers send invoices that bill earlier DCs (case 3), or is that purely a PM-side situation?
- **D6.** Q3 (refuse), Q4 (restore on unlink; self-link model; trigger vs extension): your ruling on each recommendation.
- **D7. A22 reading** (§11): "unconfirmed" = no provider confirmation?
- **D8.** Can a DC have more than one invoice? (the table allows it; unanswered since v2)
- **D9.** May the PM approve an `incomplete` ("not acknowledged") delivery? (I assumed yes.)
- **D10.** Multi-photo documents: further files at S3/S4 attach to the same document, and does the bot reply to each?
- **D11.** What does an idle `3` do once digit 4 is live? (today `item_reserved`; unchanged, but note it is an ack digit)
- **D12.** Overdue threshold for "invoice expected" is TBD (A16): the constant has no value.
- **D13.** Cofounder confirmation of A10/A18 is not recorded (carried from v2).

### Risks
- **R1.** Numbered ack replies (1/2/3) **collide with the idle menu digits** the moment a session ends by any route: expiry (X9), day change, N2 force-reset. The worst outcomes: "Yes" starts a hindrance report; "No" prints a safety message.
- **R2.** Until the PM links, an invoice and its DC are **two active deliveries for the same goods**. Harmless in 1a (no money); in 1b the PM must not approve the automatic delivery, or money doubles. 1b needs an approval guard for an automatic delivery whose invoice has candidate DCs (not designed).
- **R3.** The XOR is a trigger (or an extension), not a declarative CHECK; a trigger can be disabled by an owner and is a larger review surface. The two internal-transfer guard triggers add to it. Concurrency of the row lock is **CI-only, not verified locally**.
- **R4.** The least-grant change means the bypass tests must run as the table owner; if CI has no direct owner connection those tests exist only in the rehearsal with captured output.
- **R5 (N13).** A scheduled check-in arriving while the ack question is pending turns the engineer's next `1/2/3` into an answer to the check-in's first question.
- **R6.** Approving a "not acknowledged" delivery (D9) records a delivery nobody confirmed arrived.
- **R7.** Case 3's invoice ack (Q7) can be misread as arrival evidence on the PM page if the label is vague.
- **R8.** If the PM links an invoice to a DC delivery the engineer is still mid-flow on, the later ack still attaches to the right document (the ack is on the document), but the PM may have approved first; approval is final.
- **R9.** Restore-on-unlink is an automatic side effect (Q4); a PM may not expect a cancelled delivery to reappear.

### Unverified / not done
- `timezone('Asia/Kolkata', …)` immutability (rehearsal proves it, v2).
- The `current_flow` CHECK's constraint name; the state of 048 and later on prod and test-db (`supabase migration list` forbidden here).
- Whether `btree_gist` is available (Q4 alternative).
- Whether a private bucket needs any `storage.objects` policy (042's policy section not read).
- Storage-host behaviour for PDF download and bucket limits (v2).
- Whether the CI suite has a direct owner Postgres connection (T-A28-3 in CI).
- The morning function's live body is `038` and the evening's is `040` (`[v2-read]`); not re-read this round. A later migration touching them would change N2's target.
- I did not re-read `docs/reviews/2026-10-06-p0-sentry-record.md`, the sample PDF, or any test-db data.
- Twilio's real inbound size limit remains unknown (A11's 16 MB is an inferred cap).
- I did not verify the Resend page, 1b only.

### Guesses (each also marked in the text)
`'material_inward'` as the flow name; two document tables; soft unlink; atomic ingest-job insert in the RPC; the ack stored on the document; **self-link row as the model for the automatic delivery**; **`expires_at` as the A27 clock**; `>` not `>=` at 30 minutes; `incomplete` defined as "no ack yet"; PM may approve `incomplete`; link targets must carry a DC document and not be automatic deliveries; one re-ask then close-with-nothing at S1/S2; further files attach to the same document; case numbering (1/2/3) of A28; service_role SELECT-only on three tables; `CAPTURE_MAX_BYTES` 16 MiB read as 16 × 1024 × 1024; image magic-byte checks in the capture flow.

### Corrections owed to the design record (PR-F, dated, struck, not silent)
A16–A28 and findings N1–N4, N7–N13; A1's "owner email in 1a" (superseded by A24); A7's "PM values" (superseded by A23); the v1/v2 "TTL" claim (not in the record); A1's text "1a = engineer capture, storage, PM approval, owner email" is the line to strike.
