# Impact study: engineer no longer chooses DC vs invoice

Read-only. Repo state read: worktree at `98b3a9e` (docs only on top of `fe75d6c`); `origin/main` `f536fe2` adds only the PR #347 docs, so all code and migration lines below are current. All claims are [read] unless marked [inferred] or [unknown]. Proposed flow: `4 -> send file(s) -> one neutral ack question`; the PM sets the kind later.
Naming trap [read]: `whatsapp_sessions.current_flow = 'invoice'` (`001_core_schema.sql:92`) is the name of the WHOLE material-inward flow, not the document kind. It would not change.

## 1. Every place `capture_documents.kind` is read or written
**Schema, `049_capture_tables.sql`**
- `:286` `kind text NOT NULL CHECK (kind IN ('dc','invoice'))`; `:296` `UNIQUE (id, project_id, tenant_id, kind)` (target of the composite FKs).
- `:361`, `:363` `dc_doc_kind` / `inv_doc_kind` fixed-value columns; `:379-380` the two composite FKs from `deliveries` pin `kind='dc'` / `'invoice'`.
- `:410`, `:422` `delivery_invoice_links.doc_kind` and `dil_invoice_document_fk` pin `kind='invoice'`; `:562` `trg_dil_before_update` keeps `doc_kind` immutable.
- `:785` `trg_capture_documents_before_update` makes `kind` immutable (`QE009`). `:855-876` the insert trigger has no kind rule.
- `:381` `deliveries_one_document_chk`: a delivery must carry exactly one of `dc_document_id` / `created_from_invoice_id`.
- `:646-655` `trg_deliveries_before_update` (TR4a): both pointer columns are immutable, so a delivery cannot be created "unpointed" and re-pointed later.
- Indexes `:447-449` are on `delivery_invoice_links`, not on `kind`. No index, view or policy reads `kind` (policies `:906-951` are tenant/project scoped).

**Functions, `050_material_inward_functions.sql`**
- `apply_material_inward_turn`: `:91,183` reads `mi_kind` from session context; S1 parser `:193-210` (`'1'/'dc'/'challan'`, `'2'/'invoice'/'bill'`) writes `mi_kind`; `:323-325` INSERT writes `kind`; `:328-343` branches on `v_kind = 'dc'` to create the delivery (`dc_document_id`) or, for an invoice, the delivery (`created_from_invoice_id`) plus the self-link. `:105` and `:209,223,269,290` clear `mi_kind`.
- The ack parser `:234` and ack UPDATE `:244-246` do not read kind. `:255-259` moves a delivery `incomplete -> awaiting_pm` WHERE `dc_document_id = doc OR created_from_invoice_id = doc`.
- `pm_link_invoice` `:808-811` refuses a document whose `kind` is not `'invoice'`. `pm_set_delivery_details`, `pm_approve_delivery`, `pm_reject_delivery` read `created_from_invoice_id` (`:490,561,641`), not `kind`. `pm_unlink_invoice` `:941-1012` uses `link_source` and the ack (`:1002-1005`).
- `expire_stale_material_inward` `:449-454` and the check-in resets in `apply_morning_flow_turn` / `apply_evening_flow_turn` (`:1142,1149,1473,1481`) only subtract the key `'mi_kind'` from context: harmless if the key never exists.
- 051 (`051_capture_files_immutability.sql`): no kind reference.

**App code**
- `lib/whatsapp/flows/material-inward.ts`: `readKind :159-170`; `promptForStep :193-203` picks `MI_ASK_KIND`, `MI_ASK_FILE_DC/INVOICE`, `MI_ACK_QUESTION_DC/INVOICE`; `:278,287,391` kind prompts and `MI_KIND_REASK`.
- `lib/whatsapp/inbound-start.ts`, `app/api/whatsapp/webhook/route.ts`: no kind logic (they pass messages through).
- `lib/media/capture-ingest.ts`: `kind` hits are result tags only; no `capture_documents` query. Storage path is `tenant/project/document/` (`049:337`), no kind.
- PM page: no file in `app/` or `lib/` reads `capture_documents`, `deliveries` or the PM functions (grep: only `material-inward.ts` matches). PR-D is not in origin. Its local draft `/tmp/quoco/pr-d-plan-draft.md:41,56` has per-kind ack slot text (T-ACK-1 "for each kind x each ack value"), so that draft depends on kind.
- `types/database.ts` has `kind: string` (`:207,220,233`); regenerated after the migration.

**Tests (count of kind-specific references)**: `capture-pm-functions` 47, `capture-engineer-flow` 29, `capture-handler` 22, `capture-router` 21, `capture-webhook` 15, `capture-races` 12, `capture-checkin-n2-n13` 8, `helpers/capture-fixtures` 4, `capture-files-immutability` 1; `unit/material-inward-strings` (constants). `photo-access-route.test.ts` `kind` is the photo-route param, unrelated.

## 2. What capture creates today, per kind, and what must wait
| | DC | invoice | Source |
|---|---|---|---|
| `capture_documents` | yes | yes | `050:322-325` |
| `capture_files` + `capture_ingest` job | yes | yes | `050:378-385` |
| delivery | 1, `dc_document_id` | 1 automatic, `created_from_invoice_id` | `050:328-340` |
| `delivery_invoice_links` | none | 1 active self-link `created_from_invoice` | `050:341-343` |
| `received_at` | `processed_messages.created_at` of the SID | same | `050:314-318` |

Must wait for the PM's classification: the delivery (its pointer columns are immutable, `049:648-649`, and exactly one must be set, `:381`) and the self-link. Can stay at capture: document, files, ingest job, ack, note. At classify time `received_at` can still be read from `processed_messages` by `source_message_sid`; `deliveries_received_order_chk` (`:391`, `received_at <= created_at`) holds because the delivery is created later; `delivery_date` (`:354`) stays the capture day.
Status at classify: the insert trigger forces `incomplete` (`049:834`); precedent for "then move to `awaiting_pm` if the ack exists" is `050:745-749` and `:1002-1005`.

## 3. Ack semantics with one neutral question
- Today: DC "arrived" (1 all arrived / 2 not arrived / 3 part arrived) and invoice "matches" (1 matches / 2 does not match / 3 partly matches), both stored as `yes/no/partial` (`050:234`; strings `material-inward-strings.ts:35-40`).
- With one neutral question the stored enum is unchanged, but its MEANING depends on the wording: a "yes" no longer says "material arrived" or "invoice matches" unless the wording covers both. After classification the PM page can only show a kind-specific label if the engineer's answer fits that reading [inferred].
- The draft PR-D page shows per-kind ack slots (`pr-d-plan-draft.md:41`): it would need a neutral label for unclassified rows, then per-kind text after classify, or one neutral text always.
- Unchanged: ack is set once (`049:794-799`), `unclear` closes without step 4, the note rules (`049:301`).

## 4. Size, migrations first
| Item | What | Tier |
|---|---|---|
| M1 migration | `ALTER COLUMN kind DROP NOT NULL` (`049:286`; the CHECK already passes NULL, keys stay) | FULL: gate (b) |
| M1 | `CREATE OR REPLACE trg_capture_documents_before_update`: allow `kind` NULL -> value once (`:785`) | FULL: gate (a) |
| M1 | `apply_material_inward_turn` (same signature, so grants kept): start at step 2, drop S1 and `v_kind`, insert `kind` NULL, no delivery or link | FULL: gate (a) |
| M1 | NEW `pm_classify_document(doc, kind)` SECURITY DEFINER: set kind, create delivery (+ self-link), status from ack; grants, PM-on-project check | FULL: gates (a)(b); new function needs the per-role REVOKE and an anon-key test |
| App | `flows/material-inward.ts`, `inbound-start.ts` (prompt and step mapping), regenerated `types/database.ts` | LIGHT alone; coupled to M1 |
| PM page (PR-D, unbuilt) | "unclassified" queue + classify action; neutral ack label | FULL when it ships (it exposes real data) |
| Strings | 6 touched: remove `MI_ASK_KIND`, `MI_KIND_REASK`; replace the pairs `MI_ASK_FILE_DC/INVOICE` and `MI_ACK_QUESTION_DC/INVOICE` with 2 neutral new ones. 2 new strings need approval | per your rules |
| Tests | the 9 files above + strings test + new classify tests (anon, wrong-PM, set-once, status-from-ack) + DOWN rehearsal with an in-flight session | |

Tier note: under the 2026-09-19 rule the stakes are low (prod holds only your test data), but the external-review gate triggers (a) logic and (b) grants/SECURITY DEFINER both fire, so a review package is required regardless. Your call whether to treat it as FULL.
Rollout coupling [inferred]: an old app calling the new RPC would throw in `readKind`; migration and app must ship together, or the app tolerates both. In-flight sessions at step 1 during rollout [unknown]; cheapest window is before C6, while digit 4 is gated to your phone.

## 5. Prod data today
The 5 D-30 documents on `acef67fe...` all have `kind` set, 5 deliveries, 2 self-links (`d30-after2-result.csv`). Dropping NOT NULL and relaxing the update trigger needs NO backfill; they stay as classified.

## 6. What makes it cheaper than it looks
- `kind` stays nullable, no `'unclassified'` sentinel: NULL passes the existing CHECK, and MATCH SIMPLE FKs skip NULL pointers (`049:344` comment). No change to the 5 other constraints, indexes, policies or 051.
- Keep step numbers: start at step 2 so steps 3 (ack) and 4 (note) and the router's step mapping stay the same.
- `capture-ingest`, storage paths, jobs payload, webhook gate, `expire_stale_material_inward`, the check-in functions: untouched (the `'mi_kind'` subtract is a no-op).
- Deliveries on classify reuse the pattern of the unlink path (`CASE WHEN v_has_ack`), so the state machine (TR4c) is not rewritten.
- OCR later is just another caller of `pm_classify_document`.
- Cost that stays: the delivery state machine is untouched but a wrong classification cannot be undone (kind and pointers immutable); mistakes would be handled by reject. Decide set-once vs reversible.

## Unknowns for Aravind
1. Classification: set-once (mistakes via reject) or reversible? Reversible means relaxing TR4a (`049:646-655`), a bigger FULL change.
2. Neutral ack wording intent: keep yes/no/partial as "all fine / not / partly"? That decides the PM page labels.
3. Is C6 still unflipped, so no real engineer has a session in flight at deploy?
4. Until OCR exists, does every capture need a manual PM classification? Volume and an aging rule for unclassified rows [unknown].
5. Does PR-D proceed in parallel? Its draft assumes per-kind slots.
