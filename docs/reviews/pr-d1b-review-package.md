# PR-D1b review package: Material Inward usability

Tier: FULL (the page consumes `/api/capture-files`). Code review only. No database change, no migration, no RLS change, no change to the
`/api/capture-files` route code, no new dependency (`package.json` / `package-lock.json` untouched).
Base: `origin/main` `78ba82e` (merge of #351). Evidence files are in `docs/reviews/pr-d1b-evidence/` (index: its `README.md`).

## 1. What changed (product terms)

On the PM page "Material Inward", detail view for one delivery:
1. Order: delivery type first, then Approve and Reject, then a collapsed "More details (optional)" (DC no., DC date). Each of the two sections has its own
   "Save details" button on one shared form state. While the form differs from what was loaded, Approve and Reject are disabled.
2. Vehicle no. is gone from the form and the list. The stored vehicle is sent back unchanged on every save (the save function overwrites all four fields).
3. A stored photo shows as a thumbnail on the page, above the form on narrow screens and beside it on wide ones. Tapping opens a full-screen overlay in the
   same tab. Back closes it, Esc and Close close it, focus returns to the thumbnail, Rotate turns it in 90-degree steps (display only, no request).
   PDFs keep Open / Download in a new tab, unchanged.
4. Invoice picker lines read "{date}, {time} · {engineer} · {answer}", time in 12-hour IST with lowercase am/pm.
5. Strings: "DC / GRN" (kind label), "Internal transfer", "More details (optional)", "Photo of the document", "Close", "Rotate", the picker line, and the
   three error messages that said "internal GRN" now say "internal transfer". `PM_FIELD_VEHICLE` is deleted. Record: `docs/plans/pr-d1b-strings-approved.md`.
6. Not changed: a GRN that arrives "as it comes" is stored as kind `dc`.

## 2. Decisions (per Aravind)

- 2 and 3 Nov: items 1-5 and the strings. 12 Nov: `{time}` format; reload does NOT reopen the overlay (the leftover hash is stripped on load); two
  Save buttons on one state; Approve / Reject disabled while unsaved; `PM_FIELD_VEHICLE` deleted; no new dependencies (interactions are checked by hand);
  the three internal-transfer error strings approved; latency moved to a follow-up; test-db slot cleared.
- Plan: `docs/plans/pr-d1b-plan.md` (history, including its own R0 correction).

## 3. Two dated reversals (per Aravind, 12 Nov 2026)

- **D1 (signed URL minted on click only):** for image THUMBNAILS the 60 s URL is now minted when the page renders (the browser requests the route); on
  click for Open / Download. Comment-only change in `lib/capture/pm-file-access.ts`; the route code, its headers (`no-store`, `no-referrer`), its single
  404 refusal and its rate limit (120 per minute per user per instance) are unchanged.
- **D3 (no image element on the page):** an image element is allowed, for stored IMAGES only, and only with `src` = the route path `/api/capture-files/<id>`.
  `next/image` stays banned; no signed URL, storage host or token in our HTML. `test/pm-render.test.tsx` now allows an image element only in
  `components/material-inward/file-viewer.tsx` and only with that `src`.
- Detail and observation: `docs/reviews/pr-d1b-manual-run.md` section 1 and section 3.

## 4. Risks

- More route traffic: one request per thumbnail per page load, one more when the overlay opens. Rate limit 120 per minute per user per instance.
  Observed on prod data: one 302 per thumbnail, then one storage jpeg (156 kB, about 5.2 s on DevTools 3G); the overlay open made no new request.
- A failed image (expired, not stored, not a PM, rate limited) is one 404 with no body, so the PM sees a browser broken-image state. No wording was added.
  The 404 was observed; the on-screen look was not recorded.
- History / router: our history calls interact with Next 16's router. A first version left `#photo-<id>` in the URL after "Save details" (found in the manual
  run). Fixed in `d9ad29f` (section 5). The router's behaviour was READ from Next's source, then confirmed on a rebuilt app by the re-run (section 7).
- New reading: engineer names for the picker (`readEngineerNames`), filtered by the reader's tenant; only `id` and `full_name` are selected. Same-tenant
  composite FKs mean a cross-tenant id cannot occur in real data; the test is defence in depth.

## 5. Controls (each: mutate one file, run only the named test file, see RED, restore, hash after = before)

HEAD, file hashes and raw FAIL lines are in the evidence files. `pr-d1b-ctl-2.redacted.txt` holds C1-C4 at `b0a9e5a`.
| # | Control | Result |
|---|---------|--------|
| C1 | T-RENDER: viewer emits a signed-URL-shaped src (dummy host, dummy value) | RED in `test/pm-render.test.tsx` (3 failed); file sha256 `2ac5d48b…0c68f5` before = after |
| C2 | Vehicle pass-through: `buildDetailsNext` sends `''` | RED in `test/pm-d1b-pure.test.ts` (2 failed); `details-next.ts` sha256 `768a998d…57f262d` before = after |
| C3 | R4: the tenant filter dropped on the engineer-name read | RED in `test/pm-engineer-names.test.ts` (1 failed); `pm-queries.ts` sha256 `919bdb84…da4d13b` before = after |
| C4 | F1: dirty check compares raw values (no `normaliseField`) | RED in `test/pm-d1b-pure.test.ts` and `test/pm-d1b-ui.test.tsx` (4 failed, the all-null "starts clean" case among them); `details-next.ts` sha256 as C2 |
| C5 | Viewer history: `history.state` (carries `__NA`) put back as data | RED in `test/pm-viewer-history.test.ts` (4 of 5 failed, the repro among them); `viewer-logic.ts` sha256 `d39fee15…b85b` before = after. File: `pr-d1b-viewer-history-control.txt` |
(Full 64-character hashes are in `docs/reviews/pr-d1b-manual-run.md` sections 1b and 4.) Earlier controls at `05bba02` are superseded; the branch history was
squashed before push.

## 6. Tests

- Node-only (no database): 13 files, 493 passed (`pr-d1b-tests-node-only-latest.txt`; re-run at the pushed HEAD, see the PR). `tsc --noEmit` and eslint clean.
- Test-db, project ref `exfccwlrhoutkgrlikod` (observed, `pr-d1b-testdb.txt` and `pr-d1b-manual-run.md` section 1c): 13 files, baseline `78ba82e` 407 passed / 7 skipped /
  0 failed; branch 408 passed / 7 skipped / 0 failed. The one added test is the DB-level vehicle pass-through test (`pm-actions.test.ts`): passed.
  Prod was not reachable from that run (only `.env.test` is loaded; `NEXT_PUBLIC_SUPABASE_URL` unset; `test/setup/guard.ts` aborts on any other ref).
  That run was at `7461cc1`, before the hash fix; the fix touches no database code.
- `test/capture-races.test.ts` (concurrency): CI-only, NOT verified locally.

## 7. Manual run (local production build against prod, test delivery `b9995385-c2da-476b-9cec-fa4ab989fdd9`)

- First run at `c94b421` (BUILD_ID `B9tAt1Q_eg5nNdKj8hU9Y`): layout stacked at 394 / 725 px and side by side on desktop; same-tab overlay; Back closes and Forward
  reopens; Esc / Close / focus; Rotate x4 with no request; hydrated DOM has no `token=`, `supabase.co` or `/storage/v1`, and `currentSrc` is the route path;
  vehicle preserved after save; picker label shown; unsaved edit disables Approve / Reject. One finding (leftover hash), now closed.
- Re-run at `3e378e1` (BUILD_ID `JrDWZU6aPjVNFyweEY5k5`, `manual-run-env.txt`, served-match MATCH): R1-R6 all PASS (repro, Back / Forward / Close, Esc and focus,
  Rotate, reload while open, vehicle preserved after save). Section 4 of `pr-d1b-manual-run.md`.
- Out of the checklist: a link and unlink of an invoice on the test delivery; prod state after: one `pm_manual` link, unlinked, no residual change.

## 8. NOT covered

- PDF behaviour on a real PDF (NOT COVERED; the PDF anchor is unchanged and asserted by `test/pm-render.test.tsx`).
- How a failed image looks on screen (404 observed, look not recorded).
- Android handset Back gesture: DEFERRED to the post-deploy prod check.
- Prod response headers / any Vercel-level CSP: the repo sets none (no `img-src` line anywhere, searched at `origin/main`); a platform CSP cannot be seen from
  a local build. Read, not observed: check after deploy with `curl -sI` of a prod page.
- Back-press count to leave the page after a reload with the overlay open (not recorded).
- Latency of the detail page (about 1.3 s): not measured here.

## 9. Follow-ups (out of scope)

Latency measurement (own PR); the thumbnail loads the full-size image (about 5 s on 3G); the browser tab title is "Create Next App" app-wide; remove
`PmListItem.vehicleNumber` (unused, kept in the query type) in PR-D2.

## 10. Post-merge checks owed

Android Back on a handset; `curl -sI` of a prod page for CSP / headers; observe one thumbnail on prod (one 302 then one image).
