# PR-D1b — Material Inward usability — PLAN (no code written)
Worktree ~/Desktop/quocoai-pm-ui only. Tier FULL (consumer of /api/capture-files). Code review only. Raw output: /tmp/quoco/pr-d1b-evidence.txt

## 0. Base (observed)
origin/main = 78ba82e110193266a6f33a7d364729d242e89849, parents 5e8e0143… (first) and 756fc736… (second). Matches expected. Tree clean.
`main` is checked out in ~/Desktop/quocoai, so build branch is: `git switch -c feat/pr-d1b-mi-usability origin/main` (worktree is on docs/closing-pr-d1-and-login @756fc73, not main).
All code below was read at origin/main with `git show`, not from the working tree.

## 1. Files in scope (everything else untouched)
Modify: lib/capture/pm-copy.ts · lib/capture/pm-queries.ts (picker: add engineer name; read-only selects) ·
components/material-inward/{detail-view,file-list,delivery-row,labels}.tsx|ts · app/(dashboard)/material-inward/{details-controls,link-controls}.tsx
New: components/material-inward/file-viewer.tsx (client overlay) · components/material-inward/details-next.ts (pure "build next" fn, so the pass-through is testable in node) ·
docs/plans/pr-d1b-strings-approved.md · docs/reviews/pr-d1b-latency-and-manual-run.md · tests (§9).
Never touched: app/api/capture-files/**, lib/capture/pm-file-access.ts, lib/capture/pm-actions.ts, supabase/**, types/database.ts, package.json, next.config.ts, proxy.ts, vercel.json, decision-controls.tsx, docs/plans/pr-d1-strings-approved.md (kept as history; the new record says which keys it supersedes).
Proof: `git diff --name-only origin/main...HEAD | sort | diff - /tmp/quoco/pr-d1b-expected-files.txt` must print nothing (the expected list is written at build time, from this section).

## 2. Behaviour, item by item
1. Detail order. DetailView: header card, Files card (photo beside/above), then delivery type, then Approve/Reject, then `<details>` "More details (optional)" holding DC no. and DC date. `DetailsControls` gets a `children` slot so DecisionControls renders between the type block and the collapsed block. Linked invoices card stays last.
   DECISION NEEDED (see unknowns): approve needs a SAVED type (PM_ERR_TYPE_REQUIRED today), and pm_set_delivery_details writes all four fields. Plan: ONE shared state, TWO "Save details" buttons (under the type select, and inside the collapsible), both send all four values. No new string.
2. Vehicle. Input removed from form; removed from list row (delivery-row.tsx:34-38). PmListItem.vehicleNumber stays in the query type (unused) to avoid touching list queries/fixtures.
   TRAP handled in details-next.ts: `vehicleNumber: loaded.vehicleNumber` is always what is sent, never form state. The stale-form check (pm-actions.ts D8) still compares vehicle, so another PM changing it still gives PM_ERR_STATE_CHANGED (intended).
3. Image preview: plain `<img src="/api/capture-files/<id>" alt={PM_FILE_PREVIEW_ALT}>`; no next/image, no srcset, no loader. Only files with display 'stored', contentType image/*, previewState != 'not_previewable'.
4. Viewer. Files card: `lg:grid-cols-2` (photo left/right of the form column on wide, stacked above on narrow). Thumbnail is a `<button>`; tap opens a native `<dialog>` (showModal: focus trap + top layer + Esc `cancel` event for free) with the same route URL, object-contain. PDFs and not_previewable files keep the existing `<a target=_blank>` Open/Download exactly as now.
5. Back button. Mechanism: URL hash is the single source of truth. Open = `history.pushState(null,'',pathname+search+'#photo-<fileId>')`. Overlay is open iff the hash matches a stored image id of THIS delivery (pure fn parseViewerHash(hash, ids), unit-tested). A `popstate`/`hashchange` listener re-derives state, so Back pops the entry and closes. Close/Esc: `history.back()` if we pushed in this document, else `replaceState` to the clean URL.
   Reload while open: hash survives, so the overlay REOPENS on the same photo (rotation resets to 0, image re-requested, new signed URL). Close then clears the hash; one extra Back press is needed to leave the page (the pre-push same-URL entry). Next 16 App Router patches pushState/replaceState and has its own popstate handler: whether it ignores our entry is READ, NOT OBSERVED; checked in the manual run (§8). Unknown if it misbehaves.
6. Esc and Close button close; focus goes back to the thumbnail (ref stored on open; after a reload-restore, found by `[data-file-thumb="<id>"]`).
7. Rotate: `useState` degrees, +90 mod 360, CSS `transform: rotate()` on the overlay img only. Not stored, reset on close, no fetch (checked in the manual run via Network panel: zero requests on Rotate). Opening the overlay DOES make one new request (new signed URL); the thumbnail's one is separate.
8. Picker option: `PM_LINK_OPTION` with {date}, {time}, {engineer}, {answer}; both modes. answer = ackLabel(kind, ack) (null → PM_ACK_NONE, existing). engineer null → "—" (existing convention). Needs engineer names in PmCandidate, which are `null` today (pm-queries.ts:453, :500): DC candidates → deliveries.reported_by; invoice candidates → capture_documents.sent_by; one extra `users` select, tenant-filtered, same shape as getMaterialInwardList. dcNumber is no longer shown in the label (per the format). Date/time format: see unknowns.
9. GRN/DC "as it comes": kind stays 'dc'; PM_KIND_DC = "DC / GRN". No DB, no flow change.
10. Latency: measure only (§10).

## 3. Strings (all English; every constant gets the comment "Tamil owed")
Approved, per Aravind 3 Nov: PM_KIND_DC "DC / GRN" (was "DC") · PM_TYPE_INTERNAL_TRANSFER "Internal transfer" (was "Internal GRN (from another site)") · PM_DETAILS_TOGGLE "More details (optional)" (new) · PM_FILE_PREVIEW_ALT "Photo of the document" (new; also the dialog's aria-label, so no extra string) · PM_LINK_OPTION "{date}, {time} · {engineer} · {answer}" (new).
Viewer buttons, named here: PM_VIEWER_CLOSE = "Close", PM_VIEWER_ROTATE = "Rotate" (both new, PM_ family, per Aravind).
PM_FIELD_VEHICLE: DELETE. After this PR nothing renders it; a dead approved-looking string rots, and the Tamil-owed list should only hold live strings. Git history keeps it and one line restores it. Its pin in test/pm-strings-approved.test.ts is removed in the same commit. (Keeping it is the alternative; say so if preferred.)
NOT approved, comment "Tamil owed, NOT approved". There is NO earlier "internal transfer" wording to restore (pm-copy.ts before 5699af6 held placeholders only), so the proposed text is a mechanical word swap, for Aravind to confirm:
- PM_ERR_LINK_TARGET_INELIGIBLE now: `This DC cannot take an invoice. It is an internal GRN, created from an invoice, or rejected.`
  proposed: `This DC cannot take an invoice. It is an internal transfer, created from an invoice, or rejected.`
- PM_ERR_RETYPE_LINKED now: `Unlink the invoice before you change this to an internal GRN.`
  proposed: `Unlink the invoice before you change this to an internal transfer.`
- PM_ERR_RETYPE_AUTOMATIC now: `A delivery created from an invoice cannot be an internal GRN.`
  proposed: `A delivery created from an invoice cannot be an internal transfer.`
Record: docs/plans/ (the folder holding pr-d1-strings-approved.md) → new docs/plans/pr-d1b-strings-approved.md. Every entry "per Aravind, 3 Nov"; the three errors in a separate "NOT approved" block. test/pm-strings-approved.test.ts pins values inline (it never reads the doc), so it is updated with them.
No other string is added. Every other need is in the unknowns.

## 4. Image load failure (read, not observed)
Today: no `<img>` exists; "Open" opens a new tab, and every refusal is `404` with an empty body (pm-file-access.ts:69) → a blank tab. After: a failed `<img>` shows the browser's broken-image icon, possibly with the alt text "Photo of the document"; rendering depends on the img box size and browser → UNKNOWN, observe in the manual run. All causes (expired, not stored, non-PM, other tenant, inactive, rate-limited at 120/min/instance, signed-URL 60 s TTL) are the same 404 and indistinguishable to the PM. No onError handler and no wording are added. The PM can still use the failure-state labels already in the Files list (pending/failed) because those files render no `<img>`.

## 5. T-RENDER (no signed URL / storage host / token)
- Server HTML: renderToStaticMarkup(DetailView) with stored images; assert `src="/api/capture-files/<id>"` is present and none of `token=`, `supabase.co`, `/storage/v1`, `_next/image`, `data-nimg`, `srcset` appear.
- Overlay: render the viewer component directly in its open state (no DOM needed) and apply the same assertions.
- Hydrated DOM: not testable in the node test env (vitest `environment: 'node'`, no jsdom/testing-library; adding them = new dependency, see unknowns). Done in the manual run: after opening the overlay, run `document.documentElement.outerHTML` and `img.currentSrc` and grep for the three markers (browsers keep the original URL after a redirect: read, not observed).
- test/pm-render.test.tsx:101, :106, :126-135 currently FORBID an img element and target=_blank on file links (D3). Updated on purpose and called out in the PR as a dated reversal of D3 for images only; the next/image ban and "no next/link to the route" stay.
- Control: temporarily make file-list emit a fake `https://x.supabase.co/storage/v1/...?token=` src; the test must go RED at that assertion. Print HEAD SHA and sha256 of the mutated file before/after.

## 6. CSP (read, not observed)
Searched the whole repo at origin/main (excluding docs/ and the two skill directories): NO `Content-Security-Policy` and NO `img-src` line exists. Quoted verbatim: there is no line to quote; `git grep -i "img-src|Content-Security-Policy|connect-src"` returns exit 1 (evidence file). Headers are set nowhere: next.config.ts has no headers(); proxy.ts only sets Supabase session cookies; vercel.json has crons only. The 302 from /api/capture-files points at `<supabase host>/storage/v1/object/sign/capture-documents/<path>?token=…` (test/pm-file-route.test.ts:120-121; host = NEXT_PUBLIC_SUPABASE_URL). With no CSP in the app, `img` may load it. NOT observed: a platform-level CSP from the Vercel project, and the real response headers of prod. A local build cannot show Vercel headers, so one `curl -sI` of a prod page after deploy is needed (unknown U6). If one exists and lacks the Supabase host, images are blank on prod only.

## 7. Vehicle pass-through test
details-next.ts `buildDetailsNext(loaded, form)`; new test/pm-details-passthrough.test.ts (node): (a) with loaded.vehicleNumber "TN01AB1234", changing DC no./date gives next.vehicleNumber "TN01AB1234"; (b) loaded null stays null; (c) DB-level, in test/pm-actions.test.ts (test-db, build stage only): seed vehicle V-1, runSetDetails with buildDetailsNext(...) changing DC no./date, row.vehicle_number still V-1.
Control: change details-next.ts to send `''`; show ONE raw FAIL line; restore; print `git rev-parse HEAD` and sha256 of details-next.ts before mutation and after restore (the two hashes must be equal).

## 8. Tests and manual run
Run: touched files test/pm-strings-approved, pm-render, pm-d30-shapes, pm-unit, pm-queries, pm-actions, pm-file-route, pm-bucket-guard + new pm-details-passthrough, pm-viewer; whole family test/capture-*.test.ts and test/unit/capture-*.test.ts (capture-checkin-n2-n13, engineer-flow, files-immutability, handler, ingest, pm-functions, races, router, static-guards, tables, webhook, unit/capture-error-phone-scrub, capture-fixtures-clock, capture-ingest-bytes, capture-switch); test/capture-races is CI-only for concurrency. Also tsc --noEmit. No test-db run at plan stage. Verify total vs baseline, JSON reporter if a line is missing.
Manual: `scripts/login-manual-check.sh` UNCHANGED (clean HEAD → npm run build → `npm start -p 3000` → served BUILD_ID == .next/BUILD_ID, written to /tmp/quoco/manual-run-env.txt), .env.local → prod. Aravind signs in (OTP). Checks: (1) 360 px width: photo above form, tap opens overlay; (2) Back closes overlay and stays on page; (3) Esc + Close, focus returns to thumbnail; (4) Rotate ×4, Network panel shows no request; (5) reload while open (behaviour in §2.5), Next router does not re-navigate on our pushState; (6) PDF: Open/Download only, new tab; (7) vehicle survives a save: use a designated TEST delivery that has a vehicle, save DC no./date, read back vehicle; (8) broken image look (open a file id of another tenant/garbage in DevTools) ; (9) hydrated-DOM marker grep. Approve/Reject are NOT exercised on prod. Real Android handset back-gesture can't be shown by emulation (U5).

## 9. Test files to add/change
Change: pm-strings-approved, pm-render, pm-d30-shapes (if it asserts "DC"/GRN labels), pm-queries (engineerName). Add: pm-details-passthrough, pm-viewer (parseViewerHash, rotation step, open-state markup).

## 10. Latency (measure only; no fix)
Method: an UNCOMMITTED local patch (saved as /tmp/quoco/pr-d1b-timing.patch, then `git checkout`-reverted, `git status --short` empty before any commit) that logs `[d1b-timing] step=ms` with performance.now() around: proxy getUser; layout getUser + users query; page getProfile; getDeliveryDetail delivery row; each of the 5 Promise.all queries and their wall time; candidate queries (2-3 sequential); render. 15 sequential reloads of one delivery on the local prod build, first request reported separately; median/p90 per step. Also the RTT to Supabase from this machine.
Limit: the 1.3 s was measured on Vercel syd1 (docs/reviews/pr-d1-closing-record.md:18); local numbers give the SHAPE (number of sequential round trips × RTT), not the Vercel absolute. Hypothesis to test, not a conclusion: three `auth.getUser()` network calls per request (proxy, layout, page) plus 3-4 dependent query stages.
Where written: raw lines → /tmp/quoco/pr-d1b-evidence.txt; table → docs/reviews/pr-d1b-latency-and-manual-run.md.


---
# REVISION 2 (12 Nov, per Aravind) — maps each revision to the plan section it changes

## R0 (STEP 0, resolves a contradiction in plan §5 vs §2.4/§4/§8)
Plan §5 said test/pm-render.test.tsx FORBIDS target="_blank" on file links. That was WRONG. Observed at origin/main 78ba82e:
- test/pm-render.test.tsx:96-104, the test "every link is /api/capture-files/<uuid>, a new tab, noopener noreferrer", REQUIRES it:
  :101 `expect(a).toContain('target="_blank"')` and :102 `expect(a).toContain('rel="noopener noreferrer"')`.
- What the tests FORBID is an image element and the optimiser: :106 `for (const bad of ['token=', 'supabase.co', '/storage/v1', IMG_OPEN, '_next/image', 'data-nimg', 'srcset'])`
  and :126-135 (`not.toMatch(/from 'next\/image'/)` and `not.toMatch(new RegExp(IMG_OPEN + '[\\s>]'))`).
- components/material-inward/file-list.tsx:35-40 today: `<a href={`/api/capture-files/${f.id}`} target="_blank" rel="noopener noreferrer" className="text-blue-700 underline">`.
TRUE: the Open/Download link DOES open a new tab today. So PDFs and locked files keep today's anchor EXACTLY (target="_blank" kept; one anchor test still asserts it).
Only the image-element ban changed (now: an image element exists only in file-viewer.tsx, only with src={IMG_PATH(fileId)}); the next/image ban stays.

## Mapping
- R1 -> §2.1, U1: DetailsDirtyContext (new components/material-inward/details-dirty.ts); DetailsControls provides `isDetailsDirty(...)`; DecisionControls (decision-controls.tsx, a file §1 listed as untouched, now touched ONLY for this) disables both buttons while dirty; labels unchanged; no string added.
  Tests: test/pm-d1b-ui.test.tsx (dirty -> both disabled, clean -> enabled, initial wiring clean), test/pm-d1b-pure.test.ts (isDetailsDirty). Typing itself is a manual check (R6).
- R2 -> §2.8, U2: formatIstTime (labels.ts), pure; linkOptionLabel does one-pass substitution. Tests in test/pm-d1b-pure.test.ts incl. 00:xx -> 12:xx am, 12:xx -> 12:xx pm, and a UTC instant over the IST date line.
- R3 -> §2.5, U3: reload does NOT reopen. Mount effect replaceState()s any #photo-* hash to the clean URL; pushState on open and Back-closes kept; Forward re-opens. parseViewerHash/isViewerHash tests and manual check 5 updated.
- R4 -> §2.8: new readEngineerNames (pm-queries.ts) filtered by tenant. Test test/pm-engineer-names.test.ts is NODE-ONLY (in-memory users table applying eq/in), so it can be run now. The code gives: the candidate STAYS, name null, label shows an em dash. Real data cannot reach that case (same-tenant composite FKs, 049:298).
- R5 -> §10: no instrumented preview. Local timing only; NOT done at build time (needs a signed-in session); method and empty table in docs/reviews/pr-d1b-latency-and-manual-run.md.
- R6 -> §8, U9: no dependency added (package.json / package-lock.json untouched). Back / Esc / focus / Rotate stay in the manual run.
- R7 -> §3: PM_FIELD_VEHICLE deleted with its pin; the three PM_ERR_* strings carry "Tamil owed, NOT approved" and the proposed text.
Files added beyond plan §1 by R-items: components/material-inward/details-dirty.ts (R1), components/material-inward/viewer-logic.ts (pure viewer helpers; plan §2.5 named parseViewerHash), test/pm-d1b-pure.test.ts, test/pm-d1b-ui.test.tsx (replace the planned pm-viewer / pm-details-passthrough files, same coverage), test/pm-engineer-names.test.ts (R4). decision-controls.tsx (R1).
