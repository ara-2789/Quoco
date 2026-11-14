# PR-D2 plan — PM classify UI (PLAN ONLY, nothing written to the repo)
Every finding below is **read, not observed** (source read at the SHA below; no DB, no prod, no test-db touched). Raw output: `pr-d2-plan-evidence.txt`.

## 1. State
- Worktree `~/Desktop/quocoai-pm-ui`, detached at `d86ebcf3b491b9c31fec7ac74ca08ae61dae5778` = `origin/main`, clean before and during.
- #357 IS on top of `900255665d…` (merge `d86ebcf`). `git diff --stat 9002556..origin/main`: two files under `docs/reviews/052-prod-apply/`, 75 insertions, docs only.

## 2. Blockers
**No "STOP — DB change needed".** 
- 1a RPC `public.pm_classify_document(p_document_id uuid, p_kind text) RETURNS jsonb` (052:323-376), `SECURITY DEFINER`, REVOKE from PUBLIC/anon/service_role, GRANT to `authenticated` only (052:372-375). Returns `{document_id, kind, delivery_id, self_link_id, already_classified}` (052:258-266, 305-313). Types already carry it (`types/database.ts:2711`, `Args {p_document_id, p_kind}`, `Returns Json`).
- 1b RLS: `capture_documents_select` (049:906), `capture_files_select` (049:921) require only tenant + active PM on the row's project. No `kind` condition, no join to `deliveries`. A kind-NULL document and its files are readable by its project's PM. 052 adds no policy (grep, evidence). Types: `kind`, `kind_source`, `kind_set_at`, `kind_set_by` nullable, `received_at` string non-null (`types/database.ts:204-212`).
- 1c File route `/api/capture-files/[fileId]` (`lib/capture/pm-file-access.ts`): reads `capture_files` by RLS, then `appCheckCaptureFile` (active, tenant, `stored`, exact path, PM of project). Needs no delivery and no kind. Only a `not_previewable` file reads `capture_documents.kind`, and `resolveDownloadName(null,…)` returns neutral `file-<n>.<ext>` — confirmed neutral. Uses the service role only to sign (existing, unchanged).
- **Gap to design for (not a blocker):** PR-D1 list/detail are driven from `deliveries` (`pm-queries.ts:~145-200`), so an unclassified document (no delivery) is invisible today. D2 needs new queries on `capture_documents WHERE kind IS NULL` (user session, RLS).

## 3. What the PM sees (proposed; Aravind decides)
- **Unclassified section above the deliveries list** on `/material-inward` (alt: tabs). Source: `capture_documents`, `kind IS NULL`, project in the PM's `project_members` (same filter as D1, `pm-queries.ts:150`), `received_at` ascending, limit 100. Row: project, engineer name, received time (IST), age, engineer's answer, files count (+ first-file link). Age = `now - received_at`, never `created_at`. Badge `PM_AGE_OVERDUE` when age >= 24 h exactly. `now` is injected (page passes `new Date()`).
- **Row opens `/material-inward/classify/[documentId]`** (static segment beats `[deliveryId]`; both UUID-checked). Reuses `FileList`/viewer. Two buttons → confirm step with `PM_CLASSIFY_CONFIRM_NOTE` → action. If the doc already has a kind: redirect to its delivery (if any), else 404.
- **Success / `already_classified:true` same kind:** `redirect(/material-inward/<delivery_id>)`. If `delivery_id` is null or the result does not echo `document_id` → `PM_ERR_CLASSIFY_FAILED` + Sentry (D1's "success is never inferred", `pm-actions.ts settle`).
- **Refusal mapping (what 1a shows, exact conditions):**
  - **QE015**: document id NULL (339), document not found (350), caller not an active PM of the document's project/tenant (364). Same code for all (no existence oracle) → `PM_ERR_CLASSIFY_NOT_PM`.
  - **QE011**: document already has a DIFFERENT kind (helper, 052:248-250; also covers the 5 `engineer_declared` rows). Same kind → success with `already_classified:true`, not QE011.
  - **QE009: unreachable through this RPC.** It is raised by the table trigger only for immutable-column or kind-column tampering (052:405,414,418); the helper writes only NULL→(kind,'pm',set_by). Your proposed QE009 string would be dead copy. **Recommend: do not add `PM_ERR_CLASSIFY_KIND_CHANGE`; QE009 falls to generic.** Aravind to confirm.
  - QE012 (bad `p_kind`, 052:342; UI sends only 'dc'/'invoice'), QE014 (isolation level), 23514/23503 (constraint/FK) and anything else → `PM_ERR_CLASSIFY_FAILED` + Sentry. Raw DB message never rendered (`pmError` returns the mapped string only).
- **Double-tap:** buttons disabled while pending (same pattern as `decision-controls.tsx`, busy state); a true double submit is idempotent anyway (second call → `already_classified:true`).
- **Ack labels (code change):** today `ackLabel(kind, ack)` (`labels.ts:23`) returns `PM_ACK_NONE` for kind NULL, **so an unclassified doc with an answer would show "No answer yet" — wrong**. New signature `ackLabel(kind, ack, kindSource)`: `kindSource === 'engineer_declared'` → current `PM_ACK_LABEL[kind][ack]`; otherwise (`'pm'` or NULL kind) → `PM_ACK_INVOICE_YES/NO/PARTIAL` ("Matches"/"Does not match"/"Partly matches"), because the engineer was asked the neutral "match" question (`material-inward-strings.ts:34-38`). Call sites: `delivery-row.tsx:37`, `detail-view.tsx:80`, `labels.ts:85` (link picker). So `PmListItem`, `PmDetail.document`, `PmCandidate` gain `kindSource` and the three selects add `kind_source`.
  - **Wording problem:** `PM_ACK_INVOICE_UNCLEAR` says "Check the invoice…". For a PM-classified DC or an unclassified row that is wrong. Needs a neutral unclear string (see §6, flagged). Not invented here.
- **Neutral labels:** unclassified rows and the classify page show no "DC"/"Invoice" word before classification. File route download name already neutral (1c).
- **No "classified by / at"** in D2. **Remove `PmListItem.vehicleNumber`** (`pm-queries.ts:109` type, `:223` mapper; not rendered by `DeliveryRow`; `DETAIL` keeps its own `vehicleNumber`, used by the details form, `detail-view.tsx:42`). Test literals with `vehicleNumber` on list items (`pm-render.test.tsx:49`, `pm-d1b-ui.test.tsx:145`) update.
- **Nav:** none (D1 left the page URL-only until the C6 gate, `page.tsx` header comment).

## 4. Another project / tenant / non-PM
- List: only the user's PM projects. Other project's doc absent (query filter + RLS).
- Direct URL to another project's/tenant's doc, or a nonexistent id: RLS returns no row → `notFound()` (same as D1 detail).
- Forged action call with another project's doc id: RPC → QE015, UI shows `PM_ERR_CLASSIFY_NOT_PM`, document unchanged (DB is the authority; the page filter is convenience only).
- PM on no project: existing `PM_NOT_A_PM_STATE`.
- Classify action uses `createClient()` (user session) via `buildDeps()` like the five existing actions (`actions.ts`, `pm-actions.ts` header). No service-role import in the new code. (The file route's service-role signing is existing and untouched.)

## 5. Files
Touch: `lib/capture/pm-copy.ts`, `pm-errors.ts` (+`'classify'` action, mapping), `pm-actions.ts` (+`runClassify`, injectable deps, hand-validated UUID/kind, no Zod per D1 deviation), `pm-queries.ts` (+`getUnclassifiedList`, `getClassifyDocument`, `kindSource`, drop list `vehicleNumber`), `components/material-inward/{labels.ts, delivery-row.tsx, detail-view.tsx}`, new `unclassified-section.tsx`, `classify-view.tsx`, new `classify-controls.tsx` (client), new `app/(dashboard)/material-inward/classify/[documentId]/page.tsx`, `actions.ts` (+`classifyDocumentAction`), `page.tsx`. Tests: `pm-strings-approved`, `pm-render`, `pm-d1b-ui`, `pm-d30-shapes`, `pm-queries`, `pm-actions`, `pm-unit`, + new files.
Must NOT change: `supabase/**`, `types/database.ts`, `pm-file-access.ts` + file route, `lib/whatsapp/**`, `lib/media/capture-ingest.ts`, `lib/auth/**`, `package.json`, Vercel env (`CAPTURE_DIGIT4_TEST_PHONES` stays unset).

## 6. Strings — PROPOSED, NOT APPROVED (each constant commented "Tamil owed, NOT approved")
Your 16 as written, except: **PM_ERR_CLASSIFY_KIND_CHANGE: recommend dropping (QE009 unreachable, §3).** Reused unchanged: `PM_PENDING_ACTION` ("Saving…"), `PM_BACK_TO_LIST`, `PM_FIELD_*` labels, `PM_FILE_UNAVAILABLE`, `PM_NOT_A_PM_STATE`, `PM_LOAD_ERROR`, `PM_ACK_INVOICE_YES/NO/PARTIAL`.
Additional strings the design needs — FLAGGED, no final text invented:
- `PM_UNCLASSIFIED_TRUNCATED` — `PM_LIST_TRUNCATED` says "latest 100 deliveries", wrong for this section. (Or: no cap note, accept silent cap; Aravind decides.)
- `PM_ACK_NEUTRAL_UNCLEAR` — neutral replacement for the "invoice"-worded unclear text (draft idea: "Answer unclear. Confirm with the engineer before you approve.", which is the DC string and also neutral; reusing `PM_ACK_DC_UNCLEAR` is an option needing no new string).
- QE015 on classify could reuse `PM_ERR_NOT_AVAILABLE` ("This delivery is not available to you.") but it says "delivery" for a document; you proposed a separate string, kept.
Count: `pm-strings-approved.test.ts` pins 79 keys + `PM_PAGE_TITLE` (80 string exports; file has 83 `export const PM_`). D2 adds 15 (16 minus the dropped one) → 95, plus any flagged; test updated only after approval.

## 7. Tests (each with a positive control: one raw FAIL line, HEAD SHA, sha256 of the mutated file before/after restore)
No jsdom/testing-library; pattern is `renderToStaticMarkup` (`pm-render.test.tsx:4`), `makeDocWithCaption` in `test/helpers/pm-fixtures.ts:172` (now classifies as PM via `classifyAsPm`, `capture-fixtures.ts:372`).
- **T-D2-PROD-SHAPE** (review condition 1): literal row objects, not fixtures — kind 'dc' and 'invoice', `kind_source 'engineer_declared'`, `kind_set_by/at` NULL, `received_at` set, one delivery. Render list + detail: renders, absent from unclassified section, no `undefined|null|Invalid Date|NaN`. Control: mapper requires non-null `kind_set_at` → red.
- **T-D2-LIST**: kind-NULL doc only in unclassified section; `received_at` ascending; age from `received_at` with `received_at != created_at`. Control: use `created_at` → red.
- **T-D2-HIGHLIGHT**: injected `now`; 23 h 59 m no badge, 24 h 00 m badge. Control: `>` instead of `>=` → red.
- **T-D2-CLASSIFY-PAIR** (test-db, needs backend chat OK first): one document; PM of another project → QE015, kind still NULL, 0 deliveries; then own PM → success, 1 delivery (invoice: + self-link). Refusal first proves classifiability.
- **T-D2-ALREADY**: same kind twice → `already_classified:true` → success path/redirect target.
- **T-D2-OTHER-KIND**: other kind after classify → `PM_ERR_CLASSIFY_OTHER_KIND`; doc unchanged.
- **T-D2-ERRMAP**: QE015, QE011, QE012, QE009, QE014, 23514, unknown → expected keys; raw message never in result.
- **T-D2-ISOLATION**: other project and other tenant: absent from list, `notFound` on direct URL. **T-D2-SESSION-CLIENT**: `runClassify`/`actions.ts` do not import `lib/supabase/service`. **T-D2-ACK-LABELS**: `pm`+dc+yes → "Matches"; `engineer_declared`+dc+yes → "All arrived"; kind NULL+yes → "Matches"; invoice engineer_declared unchanged. **T-D2-ECHO**: result missing/mismatched `document_id` or null `delivery_id` → generic error. String-count test updated.
- Family run: all `test/pm-*.test.ts(x)`, `capture-pm-functions`, `capture-file-route-unclassified`, `pm-file-route`. Concurrency (two PMs) = CI-only, never reported as locally verified (CLAUDE.md §7).

## 8. Manual run
Local production build against prod (`login-manual-check.sh` pattern), `BUILD_ID` pinned. Expect: empty unclassified state; the 5 existing rows render in the list (live check of condition 1). **No classify on prod in this PR.** (CLAUDE.md §0: no prod write without Aravind's go-ahead.)

## 9. PR body must state
(2) "If 052 is ever rolled back after PR-D2 ships, the first step is reverting the PR-D2 deploy." (3) "Digit 4 stays dark until PR-D2 is merged and deployed; this PR does not touch Vercel env." Also: Tier FULL; external review gate; branch pushed on creation; merge commit (not squash) if the branch continues.

## 10. Risks
1. Unclassified rows exist before the engineer's ack: PM can classify while the session is mid-flow. Safe by DB design (052:298-304 (step 7) + ack turn `UPDATE … WHERE status='incomplete'`), but the delivery appears as "Details needed" with no answer; copy must not imply the engineer is done.
2. `kind_source` plumbing touches three queries; a missed select = wrong ack label silently (T-D2-ACK-LABELS covers list, detail, picker).
3. Set-once: a mis-tap with confirm step is only fixable by reject + resend (stated in `PM_CLASSIFY_CONFIRM_NOTE`).
4. `PmListItem` type change ripples into pm test literals (mechanical).
5. List cap 100 hides older unclassified docs silently unless a truncation string is approved.
6. Cached stale page: `dynamic='force-dynamic'`; action `revalidatePath` on both routes.
7. Rollback order (condition 2) is a process dependency, not enforced by code.

## 11. Unknowns for Aravind
1. Section above list (default) vs tabs?
2. Drop `PM_ERR_CLASSIFY_KIND_CHANGE`? (QE009 unreachable.)
3. Neutral "unclear" wording: reuse `PM_ACK_DC_UNCLEAR` or new string?
4. Truncation note for the unclassified section: new string or none?
5. Same-project, already-classified doc opened on the classify URL: redirect to its delivery (proposed) or 404?
6. Backend chat OK needed before any test-db run (T-D2-CLASSIFY-PAIR). Who gives it and when?
7. Not determinable from the repo: Vercel's current project default for `CAPTURE_DIGIT4_TEST_PHONES` (stated unset by you; provider console is the source of truth).
