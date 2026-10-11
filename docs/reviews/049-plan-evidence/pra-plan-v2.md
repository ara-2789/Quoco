# PR-A PLAN v2 — slice 1a tables (migration 049). Written 11 Oct 2026

PLAN ONLY. No SQL file, no migration file, no database access. v2 folds review round 1 (`review-round-1.txt`) and Aravind's decisions D-1..D-24 (cover file, `docs/reviews/049-plan-review-package.md`, section 3) into v1 (`pra-plan-v1.md`, kept unchanged as history). v2 is a full plan with the v1 structure, §0–§16.

**Tiers.** The PR that carries this document is LIGHT (docs only). Migration 049 is FULL tier.

**Marks.** `[read file:line]` = read this session at that line on the branch (which equals `origin/main` 58a455e plus docs). `[inferred]` = my conclusion from what I read. `[GUESS]` = I filled a gap; every one is collected in §15. `[F1–F7]` = a fact supplied on 10 Oct. `[D-n]` = a decision in the cover file. `[R#/B#/S#/N#]` = a review round 1 item. `[probe Pn]` = `prod-probe-1011.txt`. `[testdb s#]` = `test-db-probe-1010.txt`. The reviewer is not named.

**Limits of this plan.**
1. Nothing here was run against a database. Anything that needs Postgres to be sure is a rehearsal item.
2. The reviewer ran a hand-built stub on PG 16.15 (`review-round-1.txt:11`). I did not repeat it, and I do not treat its results as a rehearsal. Prod is PG 17.6 [probe P1].
3. I did not re-read `docs/bot-flows.md`, `docs/design-principles.md` or the full CLAUDE.md. CLAUDE.md citations are by line from the checked-out copy.

---

## Change table: every change from v1

| # | Change from v1 | Source | v2 § |
|---|---|---|---|
| C-1 | `capture_documents` has no `delivery_id`; `deliveries` points at its document; exactly one of `dc_document_id` / `created_from_invoice_id` | D-1 | 2.1, 2.2, 5 |
| C-2 | History of supersession = snapshot on the soft-unlinked self-link row (Option 2) | D-2 | 2.4, 3 |
| C-3 | Rejecting an automatic delivery soft-unlinks its self-link; new `unlink_reason` `'delivery_rejected'` | D-3 | 2.4, 6 |
| C-4 | Idempotency key columns added | D-4, S2 | 2.2, 2.3 |
| C-5 | `tenant_id → tenants` is `ON DELETE RESTRICT` | D-5 | 2.1 |
| C-6 | TR4c (status transition guard) and TR5 (`capture_documents` immutability) added | D-6 | 6 |
| C-7 | Trigger functions are `SECURITY DEFINER`, `SET search_path = ''` | D-7 | 6 |
| C-8 | `capture_files` column UPDATE grant removed; `service_role` has SELECT only | D-8 | 8 |
| C-9 | MIME list = pdf, jpeg, png, webp; HEIC/HEIF out | D-9 | 9 |
| C-10 | Size = 16 777 216 bytes | D-10 | 9 |
| C-11 | Project-wide Storage limit 50 MB, per Aravind | D-11 | 9, 13 |
| C-12 | Unacknowledged delivery: day count starts at `received_at`; any reply starts the clock; overdue at ≥ 30 | D-12, D-13, D-14 | 4 |
| C-13 | Test infrastructure = Option Y (test-only helper functions); Option X dropped; supersedes D-15 | D-21 (R6) | 8, 12 |
| C-14 | Types: follow 043/044 precedent; PR-A tests use untyped clients | D-16, D-24 (S5) | 12, 14 |
| C-15 | P10 re-run per Aravind; P1–P13 results recorded | D-17 | 13 |
| C-16 | `dc_doc_kind`, `inv_doc_kind` are fixed-value columns, not generated | D-18 | 2.1 |
| C-17 | Approved English strings E3, E5, E6, E7, E8, E11; others reuse the existing string | cover §4 | 10 |
| C-18 | One document per delivery, for life; later pages attach as `capture_files` rows; orphan probes added | D-19 (R1) | 5, 12 |
| C-19 | Read audience = PMs of the row's project only; QS excluded; admin only as PM member; `users.status = 'active'` required | D-20 (R7), L1 | 7 |
| C-20 | `received_at` has no DEFAULT; NOT NULL; supplied from the processed-message receipt row | D-22 (S1), L2 | 2.1, 4 |
| C-21 | While `approved` or `cancelled`, four content fields are immutable | D-23 (S6) | 6 |
| C-22 | TR4c refuses a move to `rejected` while any active link exists; reject path order fixed | B1 | 6 |
| C-23 | TR1 refuses an INSERT carrying unlink or snapshot values; TR3 overwrites the snapshot from the delivery | B2 | 6 |
| C-24 | First line of every invariant trigger refuses non-READ-COMMITTED | B3 | 6, 12 |
| C-25 | `superseded_from_status` added, filled by TR3, with CHECKs (my NULL-safe form, see §3) | R2 | 2.4, 3 |
| C-26 | Lock modes named at every level; self-enforcing TR4 lock; six numbered lock paths | R3 | 6 |
| C-27 | Corrected reason for definer; `public.`-qualified; codes-only RAISE; fingerprint; plain `CREATE FUNCTION` | R4 | 6, 8 |
| C-28 | `self_invoice_id` generated FK kept; PG17 rerun in rehearsal | R5 | 2.4, 12 |
| C-29 | `ON UPDATE RESTRICT` and `ON DELETE RESTRICT` written on every FK | R1, R5 | 2 |
| C-30 | Policies use `(select auth.uid())` | R7 | 7 |
| C-31 | Intensional DOWN guard; DOWN deletes the 049 ledger row; one `BEGIN … COMMIT`; bucket steps executed on test-db | R8 | 11 |
| C-32 | Message key on `capture_documents`; `media_index` NOT NULL; `file_no` and `media_index` are different facts | S2 | 2.2, 2.3 |
| C-33 | `storage_path` prefix = `tenant/project/document/` | S3 | 2.3 |
| C-34 | Timestamp-ordering CHECKs; retention-ledger lines | S4, L3 | 2, 15 |
| C-35 | Index on `delivery_invoice_links (invoice_document_id) WHERE unlinked_at IS NULL` | N1 | 2.4 |
| C-36 | Order of supersession: unlink the self-link first, then cancel; TR4c also refuses a move to `cancelled` while an active link exists | mine, from B2 + R2 (the snapshot must read the pre-cancel status) | 6 |
| C-37 | Reviewer's R2 CHECK strengthened for SQL NULL semantics | mine | 3 |
| C-38 | Helper script, registry notes and `not-applicable` entries for Rule 9 | D-21, L5 | 8, 12 |

---

## 0. Stop-condition check

**Result: no STOP.** Items checked:

| # | Check | Result |
|---|---|---|
| S-a | D-20 needs `users.status` | **Exists.** `ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('pending','active','deactivated'))` [read supabase/migrations/012_whatsapp_session_transition.sql:45-46]. The deactivation-only policy is defined at `docs/migration-007-checkpoint-1-review.md:675-692` ("§10a"; primary offboarding is `status='deactivated'` + `messaging_blocked=true`). Other files cite it as "CLAUDE.md §10a" (`supabase/migrations/028_dprs_engineer_id_option_a.sql:246`; `docs/reviews/020-review-package.md:380`). |
| S-b | D-21 vs the standing rule at `CLAUDE.md:541` ("If a second such exception is ever added, name it here too") | Option Y adds **no** entry to `scripts/test-db-only-grants.sql`, so the rule is not triggered by PR-A. The paragraph already lags that script: the script holds three DELETE entries [read scripts/test-db-only-grants.sql:64-66]; CLAUDE.md names one. Pre-existing drift, not widened. Separate docs PR (D-21). |
| S-c | D-22 vs D-12 | Consistent: D-12's clock reads `received_at`, which D-22 now defines. |
| S-d | D-19 vs the design record | Consistent: "further photos of the same document attach to that document" [read docs/plans/capture-engine-design.md:289]. |
| S-e | B1/B3/R3 vs each other | Two tensions, kept visible (not resolved silently): R3 says reject takes "no other lock", B1 says the reject path locks the invoice first (§6, question Q2-3); and B1 refuses a move to `rejected` while a link is active, so a DC-reject must unlink first, which raises whether the automatic delivery is restored (question Q2-2). |

Things that are not conflicts but affect reading:
- **D-1 and D-19 together** make a document belong to **exactly one** delivery for life [D-19]. v1 §5 had said "≥1" in the v3 shape.
- **The `invoice` flow note** from v1 §0 N-a stands: decision D1 of the 10 Oct brief reuses the `invoice` flow name for DC and invoice (not PR-A scope). Nothing on main writes `current_flow='invoice'` [F7]; prod has 0 such sessions [probe P3].

---

## 1. Repo-state header

```
origin/main @ 58a455ed8cc9bbc247b65f132b274afe98cd31d1   (fetched 11 Oct)
review branch docs/049-plan-review-package @ f4613d43bdf4c459e9c30d9fc848c40581509fa9   (PR #330 head before this fold)
supabase/migrations/ ends at 048_engineer_registration.sql   [read, ls]
scripts/migration-number-reservations.json: highest "048" (APPLIED TO PROD 2026-09-21)   [read: prior session]
supabase migration list, prod, 11 Oct: 44 rows, local = remote on all 44, last 048   [probe P13; raw: prod-P13-raw.json]
Last runbook executed: 048 prod apply, 2026-09-21
Proposed number: 049
```
Number 049: not in `supabase/migrations/`, not in the reservations file, no `049` path under `docs/reviews/` on `origin/main` before this PR [v1 §1]. Unpushed sibling worktrees were not visible, so 049 is not proven free everywhere (limit stated, as in the 044–048 reservation notes).

**Tier and gate path (FULL):** external review → test-db apply → DOWN rehearsal with captured output → CI green with pinned run URL and `headSha` = PR HEAD → merge (regular merge commit) → PITR observed → prod apply (explicit go-ahead; ref printed) → verify by observation → ledger → reservations file → file on `main`. External-review triggers tripped: (a), (b) [CLAUDE.md:192].

**Lint obligations.** Rule 8 needs a reservation entry naming the held file under `docs/reviews/049_<name>.sql`. Rule 9 (`scripts/lint-migrations.mjs:389-495`, no exceptions) needs every non-CASCADE FK to `users`/`tenants`/`projects` in `scripts/shared-fixture-fk-coverage.json` [read]. Under Option Y those entries use `"action": "not-applicable"` with a note, as `outbound_sends` does [read scripts/shared-fixture-fk-coverage.json:142-147, :219-224]. Hand-count at build.

---

## 2. Tables

**Rules for every table** [read CLAUDE.md §4, §6]: `id UUID PK DEFAULT gen_random_uuid()`; `created_at TIMESTAMPTZ NOT NULL DEFAULT now()`; `tenant_id UUID NOT NULL`; TEXT + CHECK for status; **no money, rate, amount, total, tax, confidence, paid, payment or retention column anywhere** [A17, A24, R7 of the design record]. **Every FK is written with `ON UPDATE RESTRICT ON DELETE RESTRICT`** [C-29]: the explicit form closes the review's finding that a bare `ON UPDATE` is a finding on its face (`review-round-1.txt:31`), and a generated referencing column rejects `SET NULL`, `SET DEFAULT` and `ON UPDATE CASCADE` anyway (`review-round-1.txt:68`). Parent uniques `users_id_tenant_id_key` and `projects_id_tenant_id_key` exist [read 017_rls_column_bounding.sql:58,61; probe P8].

### 2.1 `deliveries`

| Column | Type / default | Constraint |
|---|---|---|
| `id`, `created_at` | | PK |
| `tenant_id` | uuid NOT NULL | `REFERENCES public.tenants(id) ON UPDATE RESTRICT ON DELETE RESTRICT` [D-5; 043/044 used CASCADE, read 044:185] |
| `project_id` | uuid NOT NULL | `FOREIGN KEY (project_id, tenant_id) REFERENCES public.projects(id, tenant_id) ON UPDATE RESTRICT ON DELETE RESTRICT` |
| `reported_by` | uuid NOT NULL | composite FK to `public.users(id, tenant_id)`, RESTRICT both |
| `received_at` | timestamptz **NOT NULL, no DEFAULT** | [D-22, S1] see §4 for the value |
| `delivery_date` | `date GENERATED ALWAYS AS ((received_at AT TIME ZONE 'Asia/Kolkata')::date) STORED` | allowed [F1; probes P6, testdb s1]. Now derived from the receipt time, not from processing time |
| `status` | text NOT NULL DEFAULT `'incomplete'` | CHECK IN (`incomplete`,`awaiting_pm`,`approved`,`rejected`,`cancelled`) |
| `delivery_type` | text NULL | CHECK IN (`supplier`,`internal_transfer`) |
| `vehicle_number`, `dc_number` | text NULL | `char_length <= 64` [GUESS] |
| `dc_date` | date NULL | |
| `dc_document_id` | uuid NULL | see below |
| `dc_doc_kind` | `text NOT NULL DEFAULT 'dc' CHECK (dc_doc_kind = 'dc')` | [D-18: fixed value, not generated] |
| `created_from_invoice_id` | uuid NULL | see below |
| `inv_doc_kind` | `text NOT NULL DEFAULT 'invoice' CHECK (inv_doc_kind = 'invoice')` | [D-18] |
| `approved_by`, `approved_at` | NULL | `(approved_by, tenant_id)` composite FK to users |
| `rejected_by`, `rejected_at`, `reject_reason` | NULL | composite FK for `rejected_by` |
| `cancelled_at`, `cancel_reason` | NULL | `cancel_reason` CHECK IN (`superseded_by_link`) |

FKs to documents (D-18): `FOREIGN KEY (dc_document_id, project_id, tenant_id, dc_doc_kind) REFERENCES public.capture_documents(id, project_id, tenant_id, kind) ON UPDATE RESTRICT ON DELETE RESTRICT`, and the same for `(created_from_invoice_id, project_id, tenant_id, inv_doc_kind)`. The default FK match (MATCH SIMPLE) skips the check when any referencing column is NULL, so when `dc_document_id` is NULL the DC FK is not enforced and the invoice FK carries the check, and the other way round. Review round 1 saw the fixed-value kind column refuse an invoice document (23503) and another project's document (23503), and MATCH SIMPLE skip the non-chosen pointer (`review-round-1.txt:21-25`, PG 16 stub). **Rehearsal item: repeat on PG 17.**

Uniques: `UNIQUE (dc_document_id)`, `UNIQUE (created_from_invoice_id)` (one document, one delivery, for life [D-19]); `UNIQUE (id, project_id, tenant_id)`; `UNIQUE (id, created_from_invoice_id)` (target of §2.4's self-link FK).

CHECKs:
- `num_nonnulls(dc_document_id, created_from_invoice_id) = 1` [D-1, A37].
- `(approved_by IS NULL) = (approved_at IS NULL)`; `status = 'approved' ⇒ approved_by IS NOT NULL AND delivery_type IS NOT NULL`; `status IN ('incomplete','awaiting_pm','rejected') ⇒ approved_by IS NULL`. A `cancelled` row may keep `approved_*`; a restored row has them cleared (the history is in §2.4).
- `status = 'rejected' ⇒ rejected_by, rejected_at NOT NULL AND btrim(reject_reason) <> ''`; `status <> 'rejected' ⇒ those three NULL`.
- `(status = 'cancelled') = (cancelled_at IS NOT NULL) = (cancel_reason IS NOT NULL)`; `status = 'cancelled' ⇒ created_from_invoice_id IS NOT NULL`.
- `created_from_invoice_id IS NOT NULL ⇒ delivery_type IS DISTINCT FROM 'internal_transfer'`.
- **Timestamp ordering** [S4]: `approved_at >= created_at`, `rejected_at >= created_at`, `cancelled_at >= created_at` (each only when non-NULL). All use `now()` at insert/update, so equal values in one transaction pass.

Indexes [GUESS]: `(project_id, received_at DESC)` for the PM list; `(reported_by)`.

### 2.2 `capture_documents`

| Column | Type | Constraint |
|---|---|---|
| `id`, `created_at`, `tenant_id` | | as §2.1 |
| `project_id` | uuid NOT NULL | composite FK |
| `kind` | text NOT NULL | CHECK IN (`dc`,`invoice`) |
| `sent_by` | uuid NOT NULL | composite FK to users |
| `source_message_sid` | **text NOT NULL, `UNIQUE`** | [S2, C-32] the message that created the document |
| `engineer_ack` | text NULL | CHECK IN (`yes`,`no`,`partial`,`unclear`) |
| `engineer_ack_at` | timestamptz NULL | `(engineer_ack IS NULL) = (engineer_ack_at IS NULL)`; `engineer_ack_at >= created_at` |
| `engineer_ack_note` | text NULL | only when `engineer_ack IN ('no','partial','unclear')`; `char_length <= 1000` [GUESS] |
| `caption` | text NULL | `char_length <= 1000` [GUESS] |

Uniques: `(id, tenant_id)`, `(id, project_id, tenant_id)`, `(id, project_id, tenant_id, kind)`. **No `delivery_id`** [D-1]. **One document per delivery, for life** [D-19]: a later page or photo of the same document is another `capture_files` row on this document, never a second document and never a second delivery. That is a PR-B flow requirement; PR-A enforces what it can: `UNIQUE (dc_document_id)` and `UNIQUE (created_from_invoice_id)`.

**Why the message key is here.** A duplicate webhook for the creating message must fail at the first insert, before any delivery or file row exists [S2]. `UNIQUE (source_message_sid)` on this table does that. A later message that attaches another page is keyed on the file (§2.3).

### 2.3 `capture_files`

`document_id` (composite FK `(document_id, project_id, tenant_id)` → `capture_documents`, RESTRICT both), `tenant_id`, `project_id`, `file_no int NOT NULL CHECK (file_no > 0)`, `source_message_sid text NOT NULL`, `media_index int NOT NULL CHECK (media_index >= 0)`, `claimed_content_type`, `content_type`, `byte_size bigint`, `sha256`, `storage_path`, `ingest_status`, `reject_reason`, `preview_state`.
- `UNIQUE (document_id, file_no)`; `UNIQUE (source_message_sid, media_index)` [D-4, S2].
- **`file_no` and `media_index` are two facts, not one** [inferred, under D-19]. `media_index` is the position inside one Twilio message (0 … NumMedia−1). `file_no` is the page order across the whole document, which can span several messages. For a one-message document they differ by one, but across messages they do not. Both stay.
- `ingest_status` CHECK IN (`pending`,`stored`,`rejected`,`failed`); `reject_reason` CHECK IN (`wrong_type`,`too_large`) [GUESS list]; `preview_state` CHECK IN (`previewable`,`not_previewable`).
- `ingest_status = 'stored' ⇒ storage_path, content_type, byte_size, sha256 NOT NULL`; `= 'rejected' ⇒ reject_reason NOT NULL`.
- `CHECK (ingest_status <> 'stored' OR byte_size <= 16777216)`: the cap binds stored files only, so an oversize file stays recordable [A11; design record line 245].
- `content_type` CHECK IN (the §9 list) when non-NULL; `sha256 ~ '^[0-9a-f]{64}$'`.
- **`storage_path` prefix** [S3]: `CHECK (storage_path IS NULL OR starts_with(storage_path, tenant_id::text || '/' || project_id::text || '/' || document_id::text || '/'))`. A path into a sibling project's folder in the same tenant is no longer representable. Path convention: `{tenant_id}/{project_id}/{document_id}/{file_id}.{ext}`.
- Index: `(document_id)` is covered by the unique.

### 2.4 `delivery_invoice_links`

| Column | Type | Constraint |
|---|---|---|
| `id`, `created_at`, `tenant_id`, `project_id` | | as above |
| `delivery_id` | uuid NOT NULL | `(delivery_id, project_id, tenant_id)` → `deliveries(id, project_id, tenant_id)` |
| `invoice_document_id`, `doc_kind` | uuid NOT NULL; `doc_kind text NOT NULL DEFAULT 'invoice' CHECK (doc_kind='invoice')` | `(invoice_document_id, project_id, tenant_id, doc_kind)` → `capture_documents(id, project_id, tenant_id, kind)` |
| `link_source` | text NOT NULL | CHECK IN (`created_from_invoice`,`pm_manual`) |
| `linked_by` | uuid NULL | `(link_source = 'pm_manual') = (linked_by IS NOT NULL)` |
| `linked_at` | timestamptz NOT NULL DEFAULT now() | |
| `unlinked_at`, `unlinked_by` | NULL | `(unlinked_at IS NULL) = (unlinked_by IS NULL)`; `unlinked_at >= linked_at` |
| `unlink_reason` | text NULL | CHECK IN (`superseded_by_link`,`pm_unlinked`,`delivery_rejected`) [D-3]; `(unlinked_at IS NULL) = (unlink_reason IS NULL)` |
| `superseded_from_status` | text NULL | CHECK IN (`incomplete`,`awaiting_pm`,`approved`) [R2] |
| `superseded_approval_by`, `superseded_approval_at` | NULL | composite FK for the user |
| `self_invoice_id` | `uuid GENERATED ALWAYS AS (CASE WHEN link_source = 'created_from_invoice' THEN invoice_document_id END) STORED` | `FOREIGN KEY (delivery_id, self_invoice_id) REFERENCES public.deliveries(id, created_from_invoice_id) ON UPDATE RESTRICT ON DELETE RESTRICT` [R5: kept] |

Snapshot CHECKs (my NULL-safe form, see §3): `(superseded_from_status IS NOT NULL) = COALESCE(link_source = 'created_from_invoice' AND unlink_reason = 'superseded_by_link', false)`; `(superseded_approval_by IS NOT NULL) = (superseded_from_status IS NOT DISTINCT FROM 'approved')`; `(superseded_approval_by IS NULL) = (superseded_approval_at IS NULL)`.

Partial uniques and indexes [D-7, D-4 of the design record A33]:
- `UNIQUE (delivery_id) WHERE unlinked_at IS NULL` (a delivery has at most one active link: a DC has at most one invoice [A33]; an automatic delivery has only its self-link).
- `UNIQUE (invoice_document_id) WHERE link_source = 'created_from_invoice' AND unlinked_at IS NULL`.
- **`CREATE INDEX … (invoice_document_id) WHERE unlinked_at IS NULL`** [N1]: TR1's XOR scan needs it; the self-link unique does not cover PM links.

Rows are never deleted, and are updated only to unlink (TR3).

**Invariant after D-3:** every invoice has an active link, **unless its automatic delivery was rejected** [D-3].

---

## 3. GAP A — history of "approved, then superseded by link"

**Decided: Option 2** [D-2]. The history lives on the soft-unlinked self-link row. Each approve→supersede cycle leaves its own row, which is never cleared and never deleted, because `unlinked_at` is immutable and a restore inserts a **new** self-link row.

**What each column records**
- Who superseded and when: `unlinked_by`, `unlinked_at` (the PM who linked the invoice).
- Who approved, and when: `superseded_approval_by`, `superseded_approval_at` (copied from the delivery, only if it was approved).
- What state it was in before: `superseded_from_status` ∈ {`incomplete`,`awaiting_pm`,`approved`} [R2]. A NULL approver now means "was not approved" by construction, instead of being ambiguous.

**B2 fix (the snapshot was forgeable at INSERT).** The review inserted an already-unlinked link row with a caller-supplied approver and got `INSERT 0 1` (`review-round-1.txt:106-112`).
- **TR1 refuses an INSERT** when any of `unlinked_at`, `unlinked_by`, `unlink_reason`, `superseded_approval_by`, `superseded_approval_at`, `superseded_from_status` is non-NULL.
- **TR3 overwrites** the three snapshot columns unconditionally from the delivery row and never trusts `NEW`.

**My strengthening of R2's CHECK [C-37, GUESS — round 2 to confirm].** The review proposed `CHECK ((superseded_approval_by IS NOT NULL) = (superseded_from_status = 'approved'))`. When `superseded_from_status` is NULL the right side is NULL, so `true = NULL` is NULL and a CHECK passes on NULL. A row with an approver and no status would be accepted. I use `IS NOT DISTINCT FROM`, add a `COALESCE`-wrapped CHECK that `superseded_from_status` is non-NULL exactly for a superseded self-link, and pair `by`/`at`. Rehearsal item: try the forged combinations.

**Order matters (C-36).** TR3 reads the delivery's status at the moment of unlinking. The path therefore **unlinks the self-link first, then cancels the delivery**. If it cancelled first, TR3 would record `cancelled` as the "before" state. TR4c also refuses a move to `cancelled` while an active link exists (the same shape as B1), so the wrong order fails loudly. This reverses v1 §4.5 step order and is **my addition, not a review item** (question Q2-4).

**Safe for 1b:** an events table is additive later; the CHECKs are scoped to `created_from_invoice` + `superseded_by_link` [R2].

---

## 4. GAP B and the clock

**Column:** `capture_documents.engineer_ack_at` (§2.2), set in the same statement as `engineer_ack` [D-13]. Any recorded reply (`yes`, `no`, `partial`, `unclear`) starts the clock.

**Day count.** For a DC delivery with no active PM link and `delivery_type IS DISTINCT FROM 'internal_transfer'` ("invoice expected"):
- Start = the IST date of `engineer_ack_at` of the delivery's DC document; **if the engineer never answered** (`engineer_ack_at IS NULL`), the start is the IST date of `received_at` [D-12].
- End = the IST date of the earliest active PM link's `linked_at`, else today (A16).
- **Overdue when the day count is ≥ 30** [D-14]. Display only. Computed at read time; no job, column or notification reads it (A36). This is an app rule for PR-D; **no PR-A schema change** beyond `engineer_ack_at` and `received_at`.

**`received_at`** [D-22, S1, L2]. It has no DEFAULT. The RPC supplies it. **Value, stated exactly:** the `created_at` of the `processed_messages` row for the inbound `MessageSid`. Why this value:
- `processed_messages` is where the webhook records a first-seen message: `isNewMessage(messageSid)` inserts `{ message_sid }` [read lib/whatsapp/idempotency.ts:24-26], called from the webhook at `app/api/whatsapp/webhook/route.ts:224`, before any routing.
- The table has `created_at TIMESTAMPTZ DEFAULT now()` and `processed_at TIMESTAMPTZ DEFAULT now()` [read supabase/migrations/011_processed_messages.sql:8-12]. Both default to the **database clock at the idempotency insert**, so they are the earliest server time this system holds for the message.
- The columns are nullable, so the RPC must refuse a missing row or a NULL [inferred].
- **Not** `p_now`: `p_now` is optional in `lib/whatsapp/session.ts:135,185,208` (passed only when injected) and otherwise defaults inside the RPC to the transaction time at the RPC call, later than the idempotency insert. The router builds `new Date()` at `lib/whatsapp/inbound-start.ts:567,707,767,787` for its own use, also later.
- **Twilio's own timestamp:** this codebase reads none from the inbound payload. The only inbound fields read in the webhook code are `MessageSid`, `NumMedia` and `MediaUrl{i}` [read app/api/whatsapp/webhook/route.ts:219,262]. Whether Twilio sends a message timestamp that we ignore: **not verified**.
- A webhook retry hits the duplicate-SID path and is a no-op, so the first-delivery time is what is stored [read idempotency.ts:30-33].
- Open: the value reaches the RPC either by a SID lookup inside the RPC or by being passed from the route. That is a PR-B/C choice; PR-A only requires NOT NULL.

---

## 5. D6 — every delivery has a document

**Enforced declaratively** [D-1, A37]: `CHECK (num_nonnulls(dc_document_id, created_from_invoice_id) = 1)` plus the two composite FKs with fixed-value kinds (§2.1). A `deliveries` row cannot exist without naming a real document of the right kind in the same project and tenant. Insert order is document first, delivery second; each is a single-table insert, so PostgREST-style seeding works without a deferred constraint.

**Cardinality is exactly one document per delivery, for life** [D-19]. `UNIQUE (dc_document_id)` and `UNIQUE (created_from_invoice_id)` enforce the other half: a document anchors at most one delivery.

**Not guaranteed by the schema, and where it is enforced instead** (as v1 §5, with D-19 added):
1. A document has ≥1 file: the engineer RPC (document, file rows and delivery in one transaction), PR-B, tested by T-FLOW-1; made visible by the PM page (PR-D).
2. A file's bytes exist and are valid: ingest job and PM page file state.
3. **"Every document has a delivery or a link" is app-only.** The reversal trades one unguaranteed direction for another (`review-round-1.txt:29`). A DC document with no delivery is supplier evidence no PM page lists. **Orphan probes** [D-19], to run in the rehearsal and in PR-B tests:
   - `SELECT count(*) FROM public.capture_documents d WHERE d.kind = 'dc' AND NOT EXISTS (SELECT 1 FROM public.deliveries x WHERE x.dc_document_id = d.id);`
   - `SELECT count(*) FROM public.capture_documents d WHERE d.kind = 'invoice' AND NOT EXISTS (SELECT 1 FROM public.deliveries x WHERE x.created_from_invoice_id = d.id) AND NOT EXISTS (SELECT 1 FROM public.delivery_invoice_links l WHERE l.invoice_document_id = d.id AND l.unlinked_at IS NULL);`
   Both must return 0 after every happy-path scenario. An invoice whose automatic delivery was rejected is the one allowed exception **only if it has an active PM link or its delivery row exists**; the second probe's `deliveries` branch already covers a rejected automatic delivery, because the row remains.

---

## 6. Triggers

**Common rules for every trigger function** [R4, D-7]
- `SECURITY DEFINER`, `SET search_path = ''`; every relation is `public.`-qualified.
- **Reason (corrected):** an invariant check must not change behaviour with the writer's grants. Under invoker, prod `service_role` (SELECT only) would get 42501 from the `FOR SHARE` lock in TR2 instead of the invariant verdict (`review-round-1.txt:55`). The v1 reason (test-db inserts) was wrong, and under Option Y it is moot.
- `RAISE` carries codes only, never another row's data (definer reads bypass RLS) [R4].
- Plain `CREATE FUNCTION`, **never `CREATE OR REPLACE`**: the public-function default ACL is `anon=X, authenticated=X, service_role=X, postgres=X` [probe P9, rows `public`/`f`], so a same-name function must abort, not be silently replaced.
- `REVOKE ALL ON FUNCTION … FROM PUBLIC, anon, authenticated, service_role` by name; no GRANT (a trigger fires without the invoking role holding EXECUTE [inferred]).
- **Fingerprint pins**, read back after apply: `prosecdef = true`, `proconfig = {search_path=""}`, owner `postgres`, plus the ACL.
- **First statement of every invariant trigger** [B3]: `IF current_setting('transaction_isolation') <> 'read committed' THEN RAISE EXCEPTION USING ERRCODE = <code>, MESSAGE = <code only>`. The reviewer raced a link INSERT against a retype to `internal_transfer` on a stub: READ COMMITTED refused (E6, end state `supplier`, 1 link), REPEATABLE READ did not (end state `internal_transfer`, 1 link) (`review-round-1.txt:114-121`). The guard turns a silent write-skew into a refusal. Applies to TR1–TR5.

### Lock contract [R3]

Three levels, always acquired in this order:
1. the **invoice** `capture_documents` row — mode `FOR NO KEY UPDATE`;
2. the `deliveries` rows, ascending `id` — a **DC delivery is taken `FOR SHARE` by every link and unlink path, never stronger**; an automatic delivery that is going to be updated is taken `FOR NO KEY UPDATE`;
3. the `delivery_invoice_links` rows.

Why `FOR SHARE` on DC deliveries (`review-round-1.txt:44-45`): transaction A unlinks DC *Dd* from invoice I1 and holds I1, wanting *Dd*. Transaction B links *Dd* to I2, holds I2 and `FOR SHARE` on *Dd*, and waits at the A33 unique index for A. If A's lock on *Dd* were stronger than `SHARE`, A and B would form a cycle.

Why `FOR NO KEY UPDATE`, not `FOR UPDATE`, on the invoice: `FOR UPDATE` also blocks `FOR KEY SHARE`, which every FK check against the invoice row takes. TR5 makes the key columns immutable [R3, `review-round-1.txt:46`].

**TR3 does not lock the delivery.** It runs at level 3; a lock there would invert the order. It reads the delivery without a lock, because a correct caller already holds level 2 [R3].

**The contract is self-enforcing** [R3]. In TR4 (deliveries BEFORE UPDATE), for a row with `created_from_invoice_id IS NOT NULL`, the first lock action is `PERFORM 1 FROM public.capture_documents WHERE id = NEW.created_from_invoice_id FOR NO KEY UPDATE`. A correct caller already holds that lock, so it is a no-op. An out-of-order caller (delivery first) can deadlock against a correct one and get 40P01, instead of a silent race. This claims no more than that: a lone out-of-order caller simply gets the lock. **The unlocked read of `created_from_invoice_id` that finds the invoice is safe only because TR4a makes that column immutable** [R3]; this file says so, on purpose.

### Triggers

| # | Function (proposed name) | Table, event | Refuses when |
|---|---|---|---|
| **TR1** | `public.trg_dil_before_insert` | `delivery_invoice_links`, BEFORE INSERT | (a) isolation ≠ read committed; (b) **any** of `unlinked_at`, `unlinked_by`, `unlink_reason`, `superseded_*` is non-NULL [B2]; (c) after `FOR NO KEY UPDATE` on the invoice document: the invoice already has an active row whose `(link_source = 'created_from_invoice')` differs from NEW's (A28 XOR; written with `<>` so a later `auto_match` needs no edit); then the TR2 checks below, in the same function so the order is fixed |
| **TR2** (inside TR1's function) | | | `FOR SHARE` on the target delivery (both kinds), then: for `pm_manual`: target is automatic (`created_from_invoice_id IS NOT NULL`), or `delivery_type = 'internal_transfer'`, or `status IN ('rejected','cancelled')`; for a self-link: target `status = 'rejected'` (A34) |
| **TR3** | `public.trg_dil_before_update` | links, BEFORE UPDATE | (a) isolation guard; (b) any change other than NULL → value on `unlinked_by`+`unlinked_at`+`unlink_reason` together; any change to an already-set value; clearing `unlinked_at`. Then **overwrites** `superseded_from_status`, `superseded_approval_by`, `superseded_approval_at` from the delivery row, never trusting `NEW` [B2]: for a self-link unlinked with `superseded_by_link`, status must be `incomplete`, `awaiting_pm` or `approved` (else refuse) and `approved_by/at` are copied only when `approved`; for every other unlink they are forced NULL |
| **TR4a** | `public.trg_deliveries_before_update` | `deliveries`, BEFORE UPDATE | isolation guard; `created_from_invoice_id`, `dc_document_id`, `project_id`, `tenant_id`, `reported_by`, `received_at` change |
| **TR4b** | same function | BEFORE UPDATE OF `delivery_type` | new `internal_transfer` while an active link row exists for this delivery |
| **TR4c** | same function | BEFORE UPDATE | (1) **status transitions** [D-6]: allowed `incomplete → awaiting_pm | approved | rejected | cancelled`, `awaiting_pm → approved | rejected | cancelled`, `approved → cancelled`, `cancelled → incomplete | awaiting_pm`; nothing leaves `rejected` [GUESS set; A14, A31, A34]; (2) **→ `rejected` while any active link exists**, DC or automatic [B1]; (3) **→ `cancelled` while any active link exists** [C-36]; (4) **while `OLD.status IN ('approved','cancelled')`, `delivery_type`, `vehicle_number`, `dc_number` and `dc_date` are immutable** [D-23, S6]. A restore (`cancelled → pending`) changes only status and the `cancelled_*`/`approved_*` columns |
| **TR5** | `public.trg_capture_documents_before_update` | `capture_documents`, BEFORE UPDATE | isolation guard; `kind`, `project_id`, `tenant_id`, `sent_by`, `source_message_sid` change; `engineer_ack`/`engineer_ack_at` change once set; the note changes once set [D-6] |
| A33 | not a trigger | partial unique index | second active link on one delivery: 23505 |
| D6 | not a trigger | CHECK + FKs | §5 |

Isolation note [B3]: the read-committed requirement means a REPEATABLE READ or SERIALIZABLE writer cannot change these tables at all. PostgREST and the PR-B functions run at the default level, so this costs nothing today [inferred].

### Numbered lock steps for each PR-B path [R3]

Notation: **I** invoice document, **Da** automatic delivery, **Dd** DC delivery, mode in brackets.

1. **Link** `pm_link_invoice(I, [Dd…])`
   1. Lock **I** [NO KEY UPDATE].
   2. Validate the caller is a PM of I's project; validate every target (reads).
   3. In ascending `id` order lock every target **Dd** [SHARE]; lock **Da** (if I has an active self-link) [NO KEY UPDATE] in the same pass.
   4. Soft-unlink the self-link (`superseded_by_link`). TR3 snapshots Da's current status/approval.
   5. Update **Da** to `cancelled` (TR4c: no active link now; TR4 re-locks I, a no-op).
   6. Insert the `pm_manual` links (TR1: isolation, I again, XOR, TR2 `FOR SHARE` again on each Dd).
2. **Unlink with restore** `pm_unlink_invoice(link)`
   1. Read the link's `invoice_document_id` without a lock (safe: TR3 makes it immutable). Lock **I** [NO KEY UPDATE]. Re-read the link under the lock; refuse if it is no longer active.
   2. In ascending `id` order lock the link's **Dd** [SHARE] and, if restore is possible, **Da** [NO KEY UPDATE].
   3. Soft-unlink the PM link (`pm_unlinked`).
   4. If I now has zero active PM links and **Da** is `cancelled` with `superseded_by_link`: **update Da first** to `incomplete` (invoice document has no ack) or `awaiting_pm` (it has one), clearing `cancelled_*` and `approved_*`; **then** insert the new self-link (TR1: no PM links; TR2: Da not rejected). Never insert the self-link first.
   5. A rejected Da is not restored.
3. **Reject an automatic delivery** `pm_reject_delivery(Da)`
   1. Read Da's `created_from_invoice_id` without a lock (safe: TR4a). Lock **I** [NO KEY UPDATE].
   2. Lock **Da** [NO KEY UPDATE]; re-read its status.
   3. Soft-unlink its self-link (`delivery_rejected`).
   4. Update Da to `rejected` (TR4c: no active link).
4. **Reject a DC delivery** `pm_reject_delivery(Dd)`
   1. Read Dd's active link, if any, without a lock. If one exists, lock its **I** [NO KEY UPDATE].
   2. Lock **Dd** [NO KEY UPDATE]; re-read the active link under the lock.
   3. If a link is active, soft-unlink it (`delivery_rejected`) [B1].
   4. Update Dd to `rejected` (TR4c).
   Tension kept visible: R3 says reject takes no other lock; B1 says the reject path locks the invoice first. I followed B1 and kept R3's ordering (invoice, then delivery) (question Q2-3). Open: whether unlinking the last PM link here restores the automatic delivery as in path 2 (question Q2-2).
5. **Approve** `pm_approve_delivery(d)`
   - DC: update **Dd** (implicit [NO KEY UPDATE]); no other lock.
   - Automatic: read `created_from_invoice_id` unlocked; lock **I** [NO KEY UPDATE]; update **Da**. This closes the approve-vs-link race (D-2: a link may supersede an approved automatic delivery).
6. **Retype** `pm_set_delivery_details(d)`
   - DC: update **Dd** only. TR4b reads active links without a lock; TR2 in a concurrent link insert takes `FOR SHARE` on Dd, so the two serialise [read committed only; B3].
   - Automatic: lock **I** first, then update **Da**.

**Concurrency, stated plainly.** Everything in this section about overlapping callers is **not verified locally and cannot be: CI-only** [CLAUDE.md:478]. The B3 race is a **rehearsal** item on PG 17 under both isolation levels; the RR run must show the refusal.

---

## 7. RLS

RLS `ENABLE`d on all four tables, not `FORCE`d (as 043 [read 043:257]). One policy per table, `FOR SELECT TO authenticated`, named `<table>_select`.

**Read audience** [D-20, R7]: **PMs of the row's project only.** In words, a row is visible when all hold:
1. `tenant_id = public.get_user_tenant_id()` [probe P12: `STABLE SECURITY DEFINER`, `SELECT tenant_id FROM users WHERE auth_id = auth.uid()`];
2. the caller has a `project_members` row for the row's own `project_id` with `role = 'pm'` [probe P11 confirms the role set];
3. the caller's `users` row has `auth_id = (select auth.uid())` and **`status = 'active'`** [012:45-46; L1].

Predicate shape (not final SQL): `EXISTS (SELECT 1 FROM public.project_members pm JOIN public.users u ON u.id = pm.user_id WHERE pm.project_id = <table>.project_id AND pm.role = 'pm' AND u.auth_id = (select auth.uid()) AND u.status = 'active')`, alongside the tenant clause. `uq_users_auth_id` makes the `auth_id` lookup single-row [read supabase/migrations/007_auth_surgery.sql:76].

- **QS is excluded in 1a** (a Phase 2 role) [D-20].
- **Admin sees rows only if a PM member of that project** [D-20]. `users.role` is not consulted anywhere.
- **Deactivated or pending users read nothing**: only `status = 'active'` passes [D-20].
- `(select auth.uid())` is evaluated once per query, not per row [R7, N].
- Engineers and owners have no auth login (`auth_id` null) and no policy.
- No INSERT, UPDATE or DELETE policy exists. `service_role` bypasses RLS, so for that role the grant layer is the only barrier (§8).
- **Divergence from 043/044, stated.** Those policies check `project_members.role = 'pm'` and not `users.status` [read 043:259-271]. PR-A's policies add the status check; 043/044 are not changed here (out of scope; recorded in §15).

---

## 8. Grants

For **each** of the four tables, first:
`REVOKE ALL ON public.<t> FROM anon, authenticated, service_role;` by name [CLAUDE.md:507; probe P9: the default ACL for new `public` tables gives `anon=arw`, `authenticated=arw`, `service_role=arwdDxtm`].

Then only:

| Grant | To | Reason |
|---|---|---|
| `SELECT` on all four | `authenticated` | the PM page reads through the PM's session; RLS bounds the rows |
| `SELECT` on all four | `service_role` | server-side reads (signed-URL membership check, ingest job, reading job) |

**Nothing else, to anyone.** `service_role` has **SELECT only** on all four tables [D-8]: no INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER or MAINTAIN. The `capture_files` column UPDATE grant of v1 §8 is **removed from PR-A and moves to PR-C** [D-8]. Writes happen only through PR-B `SECURITY DEFINER` functions.

**Trigger functions:** `REVOKE ALL … FROM PUBLIC, anon, authenticated, service_role`, no GRANT (§6).

**Option Y: no test-db grant divergence** [D-21]. `scripts/test-db-only-grants.sql` is **not touched**. Test-db table grants on the four tables equal prod, so CI tests that call these tables as `service_role` or `anon` prove the real restrictions. The test infrastructure is §12.

**Post-apply readback (both databases):** `has_table_privilege` for each of `anon`, `authenticated`, `service_role` × {SELECT, INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER, MAINTAIN} per table; `has_function_privilege` for each trigger function and role; the function fingerprint of §6; a real anon-key call per table expecting 42501 [CLAUDE.md:953].

---

## 9. Bucket

Mirrors `042_storage_bucket_setup.sql:74-76` [read], with the two settings that bucket lacks [probe P4: `file_size_limit` null, `allowed_mime_types` null]:
```
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('capture-documents','capture-documents', false, 16777216,
        ARRAY['application/pdf','image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO NOTHING;
```
`[GUESS]` bucket id. An in-transaction `DO $$ … RAISE EXCEPTION` assertion then checks the row has `public = false`, `file_size_limit = 16777216` and the exact array (the ADDITIVE IDEMPOTENT pattern, CLAUDE.md:936), so `DO NOTHING` cannot silently keep a stale bucket.

- **MIME list** [D-9]: `application/pdf`, `image/jpeg`, `image/png`, `image/webp`. HEIC and HEIF are excluded. Adding a type later is a new migration.
- **Size** [D-10]: 16 MiB = 16 777 216 bytes.
- **Project-wide limit** [D-11]: 50 MB, per Aravind (dashboard; not probed). 16 MiB is under it.
- **No `storage.objects` policy, same as 042** [read 042:44-55]. Gate now passed: RLS is on for `storage.objects` (`relrowsecurity` true, `relforcerowsecurity` false) and there are 0 policies in schema `storage` [probe P7a, P7b]. Test-db has 0 policies too [testdb s4b]; its RLS flag is not in that file.
- The bucket check is a backstop. PR-C's byte checks decide acceptance (A6, A12). Whether Storage enforces the list and limit on `service_role` uploads, and whether it sniffs bytes, is tested, not assumed (T-BKT).

---

## 10. RAISE codes and strings

Every trigger raises a **stable code** (distinct SQLSTATE or code-only `MESSAGE`); the app maps code → named constant; SQL text is never shown (CLAUDE.md §6 Errors). "Not found" and "not allowed" stay indistinguishable at the PM-visible layer.

**English approved by Aravind on 11 Oct 2026. Tamil owed, NOT approved.** Each ships as a named constant with the comment "Tamil owed, NOT approved".

| # | Site | Condition | String |
|---|---|---|---|
| E1 | TR1 XOR | PM link while a self-link is active | "Something went wrong — please try again." (existing) |
| E2 | TR1 XOR | self-link while a PM link is active | same existing string |
| E3 | TR2 | target is an internal transfer | Can't link. Internal transfers don't have invoices. |
| E4 | TR2 | target is an automatic delivery | existing string |
| E5 | TR2 | target is rejected or cancelled | Can't link. This delivery was rejected or cancelled. |
| E6 | TR4b | retype to internal transfer while linked | This delivery has a linked invoice. Unlink it first. |
| E7 | CHECK | retype an automatic delivery to internal transfer | Deliveries created from an invoice can't be internal transfers. |
| E8 | A33 index | second active link on one DC | This DC already has an invoice. Unlink it first. |
| E9 | TR4a | immutable field | existing string |
| E10 | TR3 | link edit beyond unlinking | existing string |
| E11 | TR4c, TR5 | forbidden status transition, content change while locked, second ack | This delivery has changed. Refresh to see the latest. |
| E12 | CHECK/FK | cross-project, cross-tenant, wrong kind, D6 | existing string |
| E13 | TR4c (1) | **new**: move to `rejected` or `cancelled` while an active link exists (B1) | **wording owed — Aravind** [GUESS: could reuse E6's "Unlink it first"; not decided] |
| E14 | B3 guard | non-read-committed isolation | not PM-reachable; existing string |

The PR-D button label must be "Unlink", to match E6 and E8.

---

## 11. DOWN

One explicit `BEGIN; … COMMIT;` (a DO-block guard under autocommit does not protect the DROPs) [R8]. The block is commented in the file (`down-section-must-be-commented`, CLAUDE.md:1163). Order:

1. **Guard, intensional** [R8]: abort if any of the four tables is non-empty, **or** if any function other than PR-A's own trigger functions has a body matching `\m(deliveries|capture_documents|capture_files|delivery_invoice_links)\M`: `SELECT proname FROM pg_proc WHERE prosrc ~ '…' AND proname NOT IN (the PR-A trigger functions)`. This catches renamed or later PR-B/PR-C/PR-D functions without listing them (the v1 guard listed names, which a renamed function would slip past). plpgsql bodies record no dependency, so `DROP TABLE` alone would leave broken functions.
2. `DROP TABLE public.delivery_invoice_links; … public.capture_files; … public.deliveries; … public.capture_documents;` There is no circular FK now (documents no longer point at deliveries), so no `CASCADE`.
3. `DROP FUNCTION` the trigger functions.
4. **Ledger:** `DELETE FROM supabase_migrations.schema_migrations WHERE version = '049';` in the same transaction, so `migration list` does not show 049 applied with no objects [R8]. (The apply is by file plus `migration repair`; 042 header lines 22-30 [read].)
5. **Bucket:** assert zero rows in `storage.objects` for `bucket_id = 'capture-documents'`, then `DELETE FROM storage.buckets WHERE id = 'capture-documents'`. **Supabase Storage may refuse direct SQL deletes on `storage.*`; I could not verify this from here, and the disposable scaffold stubs `storage`, so it cannot show it either** [R8, `review-round-1.txt:94`]. Therefore **the bucket INSERT and DELETE are executed on test-db with the output captured** (forward and DOWN). If the delete is refused, the DOWN uses the Storage API for bucket removal [GUESS].
6. Nothing is removed from `whatsapp_sessions`: PR-A never wrote to it [F7; probe P3 = 0].

DOWN after real rows exist is data loss, not rollback; the answer there is PITR, observed before the apply (CLAUDE.md:32). Required cross-PR DOWN order: C, B, A.

---

## 12. Tests

### Environment [F5; read test/helpers/db.ts:203,952]
- CI runs as `service_role` (`testClient()`, untyped `SupabaseClient`) and as `anon` + sign-in (`jwtClient`). **There is no table-owner connection.**
- **Option Y** [D-21]: test-only `SECURITY DEFINER` helper functions, so CI never needs table-write grants.

### Option Y design [D-21, L5]
- New file `scripts/test-db-only-capture-helpers.sql` [GUESS name]. Header states: test-db only; never a migration; applied by hand with an **explicit target** (its sibling's header warns that `--linked` can resolve to prod, `scripts/test-db-only-grants.sql:5-8`); `EXECUTE` for `service_role` only. Precedents that define test-only functions: `quoco_test_row_is_locked` in `supabase/migrations/013_session_transition_test_lock_probe.sql` and `032_session_transition_lock_probe_nowait.sql:57` (in migrations), and `quoco_test_047_unused_rights_check()` in `scripts/test-db-only-047-rights-check.sql:51` (a script; `SECURITY DEFINER`, `REVOKE … FROM PUBLIC, anon, authenticated`, `GRANT … TO service_role`, lines 42-43, 85-86) [read]. The other script, `scripts/test-db-only-grants.sql`, defines no function (three `GRANT DELETE` lines, :64-66) [read].
- Functions [GUESS names]: `quoco_test_capture_insert(p_table text, p_row jsonb)`, `quoco_test_capture_update(p_table text, p_id uuid, p_set jsonb)`, `quoco_test_capture_cleanup(p_tenant_id uuid)`, `quoco_test_capture_acl()`. Allow-list of exactly the four tables; `search_path = ''`; owner privileges, so **triggers still fire** and a bypass-the-PR-B-function test runs in CI; cleanup refuses any tenant not created by the capture fixture [GUESS guard: slug prefix].
- The helpers appear in `types/database.ts` once generated from test-db, as the two existing test functions already do [read types/database.ts:2282,2289]. See §14.
- Record the helpers in the OUT-OF-BAND DB OBJECTS registry [read docs/build-status/2026-q3-weeks-1-2.md:82] and add a prod apply probe that `to_regprocedure('public.quoco_test_capture_insert(text,jsonb)')` is NULL on prod [inferred].

### 12.1 What runs where

| Where | What |
|---|---|
| **Rehearsal as `postgres`** on a disposable PG 17 scaffold built from a structure-only real dump with named stubs (CLAUDE.md:1063-1127) | policy-mutation and planted-GRANT red-first proofs; DOWN forward/back with the §11 guard; the **B3 race on PG 17 under READ COMMITTED and REPEATABLE READ** (RR must refuse); generated-column FK `self_invoice_id` and fixed-value kind FKs on PG 17 (R5, D-18); the forged-combination checks of §3; ACL and fingerprint readback; `col_description` for every `COMMENT ON`; the orphan probes after happy-path scenarios; `SET ROLE service_role/anon/authenticated` privilege matrix |
| **Test-db** (captured output) | bucket INSERT and DELETE; forward and DOWN; MIME and size refusal (T-BKT) |
| **CI as `service_role`** (table grants equal prod) | REST INSERT / UPDATE / DELETE on each of the four tables → 42501; REST SELECT works; `quoco_test_capture_acl()` shows no TRUNCATE, REFERENCES, TRIGGER, MAINTAIN, INSERT, UPDATE, DELETE for `service_role`, and only SELECT for `authenticated`, nothing for `anon`; trigger, CHECK, FK, unique refusals through `quoco_test_capture_insert/update`; fixture cleanup through `quoco_test_capture_cleanup` |
| **CI as `jwtClient` / `anon`** | RLS tests below |
| **CI-only, "not verified locally"** | concurrent link/unlink/retype/reject overlap (TR1–TR4 under contention, A33 under contention). A local pass proves nothing here. |

**CI can prove `service_role` restrictions** [D-21]. Under the withdrawn Option X it could not.

### 12.2 RLS — `jwtClient` only
Fixtures: dedicated run-scoped tenants (not `TEST_TENANT_A/B`, whose helper asserts exactly one project each: `test/helpers/db.ts:1079`). T1 has projects P1 and P2. PM_a is a `pm` member of P1 only; PM_b of P2 only; PM_c of a tenant-T2 project; QS_a a `qs` member of P1; an `admin` user with no membership; an `admin` user who is a `pm` member of P1; a **deactivated** PM (`users.status='deactivated'`, auth account still valid) in P1.

| ID | Assertion | Red-first proof |
|---|---|---|
| RLS-1 | PM_a sees exactly P1's rows in each table | rehearsal: drop the policy → 0 rows; clause removed → see below |
| RLS-2 | PM_a sees none of P2's rows (same tenant); PM_b none of P1's | rehearsal: remove the project clause → PM_a sees P2 |
| RLS-3 | PM_c sees none of T1's rows, PM_a none of T2's | rehearsal: planted cross-tenant `project_members` row; the weaker "tenant clause removed only" mutant is named so it is not mistaken for a proof |
| RLS-4 | QS_a and the membership-less admin see zero rows; the admin who is a `pm` member of P1 sees P1's rows | rehearsal: remove `role='pm'` → QS_a sees rows |
| RLS-5 | **deactivated PM sees zero rows; pending user sees zero rows** [D-20] | rehearsal: remove the `status` clause → the deactivated PM sees rows |
| RLS-6 | `authenticated` INSERT/UPDATE/DELETE → 42501 on each table | rehearsal: planted `GRANT INSERT TO authenticated` |
| RLS-7 | `anon` SELECT/INSERT/UPDATE/DELETE → 42501 on each table | rehearsal: planted `GRANT SELECT TO anon` |
| RLS-8 | `authenticated` and `anon` cannot call the trigger functions via RPC | rehearsal: planted `GRANT EXECUTE` |

**Honest limit:** CI cannot alter a policy, so in CI each test carries a positive control (the right PM *does* see the row); the mutation red-first proof exists only in the rehearsal, captured. Engineers and owners have no login, so they are covered by "no policy, no grant".

### 12.3 Trigger and constraint tests (via helpers in CI; owner-level in rehearsal)
Positive control in each: the same call succeeds once the forbidden condition is removed.

| ID | Behaviour |
|---|---|
| T-B1-1 | **link a DC, then `UPDATE … status='rejected'` is refused; unlink, then reject succeeds.** Also for an automatic delivery with an active self-link. [B1] |
| T-B1-2 | `→ cancelled` while an active link exists is refused; unlink then cancel succeeds [C-36] |
| T-B2-1 | **a forged INSERT** carrying `unlinked_*`, `unlink_reason` or `superseded_*` is refused |
| T-B2-2 | **an UPDATE carrying a caller-supplied snapshot is overwritten** from the delivery (approved → snapshot has approver; awaiting_pm → `superseded_from_status = 'awaiting_pm'`, approver NULL) |
| T-B2-3 | the §3 CHECK combinations: approver with NULL status refused; NULL approver with status `approved` refused |
| T-B3-1 | **rehearsal only:** the link-vs-retype race under READ COMMITTED (refused, end state `supplier`) and REPEATABLE READ (refused by the isolation guard) on PG 17 |
| T-B3-2 | every invariant trigger raises under `SET TRANSACTION ISOLATION LEVEL REPEATABLE READ` (rehearsal) |
| T-A28-1 | TR1 XOR both directions, function bypassed |
| T-A33-1 | second active link on one DC → 23505; a second invoice cannot link an automatic delivery |
| T-LINK-1 | link refused across projects/tenants, to non-invoice, to an internal transfer, to rejected/cancelled, to an automatic delivery |
| T-Q3-1 | retype to internal transfer with an active link refused (TR4b); automatic delivery can never be internal transfer |
| T-D23-1 | while `approved` or `cancelled`: `delivery_type`, `vehicle_number`, `dc_number`, `dc_date` immutable; restore leaves them as they were; after restore they are editable [D-23] |
| T-D6-1 | a delivery with neither or both document pointers refused; wrong-kind and wrong-project document refused (D-18) |
| T-ORPHAN-1 | **orphan probes** of §5 return 0 after every happy-path scenario [D-19]; also run in PR-B tests |
| T-S1-1 | `received_at` cannot be omitted (NOT NULL, no default) [D-22]; `delivery_date` boundary: 00:30 IST on 23-09-2026 → 23-09; 23:59 IST on 22-09-2026 → 22-09 |
| T-S2-1 | duplicate `source_message_sid` on a document refused at the first insert; duplicate `(source_message_sid, media_index)` on a file refused; `media_index < 0` refused |
| T-S3-1 | `storage_path` into a sibling project's folder refused; correct prefix accepted |
| T-S4-1 | each timestamp-ordering CHECK refuses an earlier value |
| T-GRANT-1 | `service_role` REST INSERT/UPDATE/DELETE → 42501 on all four tables; `quoco_test_capture_acl()` readback; TRUNCATE denial by privilege readback (PostgREST cannot TRUNCATE) |
| T-FP-1 | trigger-function fingerprint (`prosecdef`, `proconfig`, owner, ACL) |
| T-BKT-1..5 | `text/plain` refused; 16 MiB + 1 byte `application/pdf` refused, 16 MiB accepted; each approved type accepted; `anon` and a PM cannot list, download or sign; bucket row equals the approved settings. Red-first: remove the list/limit in rehearsal. HEIC refused (D-9) |

Identifiers carry a per-run marker (`ZZTestCapture-${RUN_TAG}`) and assertions use **deltas against a same-test snapshot**, never absolute counts (the phone-slot and run-scope rules, `test/helpers/db.ts:44-110`). Phone slots: claim from the registry by grep at build (`grep -rohE "testPhone\('[0-9]+'\)|\+19995550[0-9]{3}" test/`); `'121'`–`'124'` were free on origin/main on 10 Oct [GUESS until re-grepped]. Tests never run an unscoped job tick.

### 12.4 Typing [D-24, S5, L4]
PR-A's tests use **untyped clients** for the four tables: `testClient()` and `jwtClient()` return a plain `SupabaseClient` [read test/helpers/db.ts:203,952], and rows are typed at the call with `.single<{ … }>()`. Two examples already on main: `test/daily-log-photos.test.ts:106-107` (`.single<{ expires_at: string }>()` on `daily_log_photos`) and `test/media-ingest.test.ts:289,323` (`.single<{ retention_class: string; expires_at: string; received_at: string }>()`). This is what breaks the circular order (CI green → merge → prod apply → types): CI does not need `types/database.ts` to contain the tables.

---

## 13. Probes

**Run on 11 Oct (prod, `jvxwqignooseazzmwhvl`): P1–P13, all exit 0** [`prod-probe-1011.txt`; raw P13: `prod-P13-raw.json`].

| Probe | Observed (prod, 11 Oct) |
|---|---|
| P1 | PostgreSQL 17.6 |
| P2 | `whatsapp_sessions_current_flow_check`: morning, evening, safety, invoice, hindrance |
| P3 | 0 sessions with `current_flow = 'invoice'` |
| P4 | one bucket `daily-log-photos`, private, `file_size_limit` null, `allowed_mime_types` null |
| P5 | `btree_gist` 1.7 available, not installed |
| P6 | `timezone(text, timestamptz)` `i`; `date(timestamp)` `i`; `date(timestamptz)` `s` |
| P7a/b | `storage.objects`: `relrowsecurity` true, `relforcerowsecurity` false; 0 policies in `storage` |
| P8 | `projects_id_tenant_id_key`, `users_id_tenant_id_key` exist |
| P9 | default ACL for `public` tables (owner postgres): `anon=arw`, `authenticated=arw`, `service_role=arwdDxtm`; for functions `anon=X`, `authenticated=X`, `service_role=X` |
| P10 | CLI result ambiguous (four columns with one name collapsed to one key). **Re-run by Aravind in the SQL Editor with one row per name: 0 rows, per Aravind; the project selector was not confirmed** [D-17]. A plain `CREATE TABLE` aborts on a name collision. |
| P11 | `project_members.role` CHECK: pm, qs, engineer, owner, subcontractor, admin |
| P12 | `get_user_tenant_id()`: `STABLE SECURITY DEFINER SET search_path TO 'public'`, `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| P13 | 44 rows, local = remote on all, last 048. The evidence file was a Python extraction; the **raw output is now `prod-P13-raw.json`** (two text lines, then one JSON line, so the file is not valid JSON as a whole). In the extraction's "last 6", `time` equals the version string; that is how the CLI reports it, not a misparse of ours [inferred: the raw file shows `"time":"043"` etc.] |
| P14 | project-wide Storage limit 50 MB, per Aravind (dashboard; **not probed**) [D-11] |

Test-db, 10 Oct: `test-db-probe-1010.txt` (volatility s1/STEP 1, flow CHECK s2, `btree_gist` s3, bucket s4a, 0 storage policies s4b).

**Still owed in the SQL package:** the P10 and P14 values pinned as "per Aravind" with the date; P7 on test-db; the pre-apply re-probes of §8.

---

## 14. `types/database.ts`

Command per CLAUDE.md §6: `npx supabase gen types typescript --linked --schema public`. The instruction must **name the target ref**, `supabase/.temp/project-ref` must be printed and equal it first, and output goes to a file, not the transcript [CLAUDE.md:185].

**Precedent, from `git log` on `origin/main`** [D-16]: for 043 and 044, types changed in the **post-apply PRs** (#273 `ab124c6`, 64 insertions; #276 `8cf25f3`, 54 insertions), not in the migration PRs (#270, #275, "test-db only"); both messages say the types were generated while linked to **test-db, not prod**, and that output is equivalent because generated types exclude grants. 048 did the same (`fd96199`). So: a later commit, after the prod apply, source test-db, stated in the message.

**Consequences for PR-A.**
- Tests do not depend on the types (§12.4) [D-24].
- Option Y adds test-only functions to test-db. Generated-from-test-db types will include `quoco_test_capture_*`, as they already include `quoco_test_047_unused_rights_check` and `quoco_test_row_is_locked` [read types/database.ts:2282,2289]. That is existing precedent, accepted as-is at `fd96199`.
- Expected diff: four new `Tables` entries (composite FKs in Relationships); the generated columns `delivery_date` and `self_invoice_id` as `never` in Insert/Update [confirm]; no `whatsapp_sessions` change.

---

## 15. Risks, unknowns, guesses

### Retention-ledger lines [S4, L3]
**None found as a standalone ledger.** The register is the "DATA RETENTION POSTURE" section in `docs/build-status/2026-q3-weeks-1-2.md:248` with dated additions, and each review package carries its own "Retention-ledger lines" section (`docs/reviews/034-owner-email-review-package.md:227`, `docs/reviews/029-dpr-versioning-review-package.md:171`) [read]. Lines for the SQL package:
- `deliveries`, `capture_documents`, `capture_files`, `delivery_invoice_links`: **business record / compliance class**, not hygiene (supplier delivery and invoice evidence) [GUESS on class — Aravind to confirm]. Grain: one row per delivery, document, file, and link event. Unbounded growth, no prune mechanism, none proposed.
- Bucket objects: kept for the life of the project; no completion event exists, so retention is indefinite for now [read docs/plans/capture-engine-design.md:235, A4]. No tombstone mechanism is designed (043's `photo_url` tombstone has no equivalent here).

### Risks
- **R-A.** Definer trigger functions add review surface; each is a thing an owner can disable.
- **R-B.** The isolation guard makes REPEATABLE READ and SERIALIZABLE writers unable to touch these tables.
- **R-C.** `tenant_id → tenants RESTRICT` departs from 043/044.
- **R-D.** `self_invoice_id` (generated, in an FK) is proven only on a PG 16 stub [R5]; PG 17 rehearsal is owed.
- **R-E.** Bucket `DO NOTHING`: covered by the assertion block. Storage may refuse direct SQL deletes; unverified (§11).
- **R-F.** After a restore the approval is not visible on the delivery row; PR-D must surface the link-row history.
- **R-G.** The switch trigger (first RCPL or beta data on prod) is expected to fire in this slice (CLAUDE.md:684).
- **R-H.** Option Y's helper functions are generic DML on test-db, `service_role`-only; they must not exist on prod (probe at apply).
- **R-I.** PR-A's policies read `users.status`; 043/044's do not. A deactivated PM can still read photos until those are changed (out of scope).

### Unverified
Whether Twilio sends a message timestamp we ignore; PG 17 behaviour of the generated-column FK and of the isolation guard (the review's results are PG 16, stub); Storage MIME/size enforcement on `service_role` uploads; direct SQL delete on `storage.*`; whether CI has any way to apply the helper script (applied by hand with an explicit target, per precedent); lint Rule 9's regex on `ON UPDATE RESTRICT ON DELETE RESTRICT` clauses (it treats any non-CASCADE as needing an entry [read lint-migrations.mjs:440-488]); free phone slots after a build-time re-grep; the value-pass path for `received_at` (RPC lookup or argument).

### Guesses
Bucket id `capture-documents`; character caps (64/1000); `reject_reason` list; the status transition matrix in TR4c; `→ cancelled` refusal while linked (C-36); the strengthened R2 CHECK (C-37); retention class; helper file and function names, and the tenant guard in `quoco_test_capture_cleanup`; trigger function names; the E13 string; the Storage-API fallback in DOWN; indexes.

---

## 16. Questions

**For Aravind, before SQL**
1. **Q-recv.** `received_at` = `processed_messages.created_at` for the inbound `MessageSid` (§4). Confirm this value, or choose another.
2. **Q2-2.** Rejecting a DC delivery that has an active PM link unlinks it (`delivery_rejected`). If that was the invoice's last PM link, should the automatic delivery be restored, as in path 2? The design record's A34 says "when the last link is removed", without a reason.
3. **Q2-4.** C-36 (unlink first, then cancel; `→ cancelled` refused while linked) is my addition. Accept?
4. **Q-E13.** E13 wording for "can't reject or cancel while linked".
5. **Retention class** for the four tables (§15).

**For the reviewer, round 2** — see cover file section 10: confirm each disposition, plus Q2-1 (Option Y), Q2-2 (restore on DC reject), Q2-3 (R3 vs B1 on the reject path), Q2-4 (C-36), Q2-5 (the strengthened R2 CHECK).

END OF PR-A PLAN v2
