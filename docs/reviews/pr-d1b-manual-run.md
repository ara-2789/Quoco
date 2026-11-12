# PR-D1b: reversals of D1 and D3, and the manual run

Latency measurement moved to a follow-up (per Aravind, 12 Nov).

## 1. Dated reversals (per Aravind, 12 Nov 2026)

Both are deliberate, and both are scoped to image thumbnails.

- **D3 (image element).** PR-D had a rule that nothing on the page renders an image element; a stored file opened only through a plain
  `<a target="_blank">`. PR-D1b shows a stored IMAGE as a plain image element whose `src` is the route path `/api/capture-files/<id>`, with a
  same-tab full-screen viewer. Still true: no `next/image`; no signed URL, storage host or token in our HTML; PDFs and locked/damaged files keep
  today's Open / Download anchor exactly (`target="_blank" rel="noopener noreferrer"`, observed at `file-list.tsx:35-38` and required by
  `test/pm-render.test.tsx:101-102`). `test/pm-render.test.tsx` was changed to allow an image element only in
  `components/material-inward/file-viewer.tsx`, and only with `src={IMG_PATH(fileId)}`.
- **D1 (signed URL minted on click only).** The route's comment said the 60 s URL is "minted on click only, never on render". For image
  thumbnails it is now minted on RENDER (the browser requests the route when the page loads), and on click for Open / Download. Comment-only
  change in `lib/capture/pm-file-access.ts`; the route's code, headers (`Cache-Control: no-store`, `Referrer-Policy: no-referrer`),
  one-404 refusal shape, and rate limit (120 per minute per user per instance) are unchanged.
  Consequence to watch: each thumbnail is one route request per page load (plus the browser's own image preload, see below), and opening the
  overlay makes one more.

React preload links (read, not observed): when a page renders an `<img>`, React 19 also emits `<link rel="preload" as="image" href="...">` for it.
The server-HTML test (test/pm-d1b-ui.test.tsx, F2) shows 3 images give 3 image elements and 3 such links, each pointing at the route path. They are
React-generated for the thumbnails. Whether the browser makes one request or two per thumbnail is NOT observed; manual check 3 reads the Network panel.

## 1b. Controls at b0a9e5a (12 Nov 2026)

Earlier controls at 05bba02 superseded; branch history was squashed before push (12 Nov).

Each control: mutate one file, run only the named test file, see RED, restore with `git checkout -- <file>`, hash after equals hash before.
HEAD for all four: `b0a9e5add8eae1ac6b3ce2e495843725b9236ae5`. Raw output: `/tmp/quoco/pr-d1b-ctl-2.txt`.

| Control | Mutated file | sha256 before = after | FAIL line (one of the failing tests) |
|---------|--------------|-----------------------|--------------------------------------|
| C1 T-RENDER: viewer emits a signed-URL-shaped src (x.supabase.co, token=abc) | `components/material-inward/file-viewer.tsx` | `2ac5d48b41f4540944dec6f75504dab2b149caeb503d1c54a5d74fe0239c68f5` | `test/pm-render.test.tsx > T-RENDER: no signed URL, token, storage host or optimiser path anywhere (server HTML)`: `expected '<link rel="preload" as="image" href="…' not to contain 'token='` (3 failed) |
| C2 vehicle pass-through: `buildDetailsNext` sends `''` | `components/material-inward/details-next.ts` | `768a998d015f6783af6f26560d80ef091488c43e01bedcad0463b37ce57f262d` | `test/pm-d1b-pure.test.ts > R1 / vehicle pass-through > a delivery with no vehicle stays with no vehicle`: `expected '' to be null` (2 failed) |
| C3 R4 tenant filter dropped on the engineer-name read | `lib/capture/pm-queries.ts` | `919bdb8456630a1465d076febb70a4d106c2dd0629d0056fa0330c1a9da4d13b` | `test/pm-engineer-names.test.ts > R4 > TENANT B's user never shows B's name to a tenant A reader`: `expected true to be false` (1 failed) |
| C4 F1 dirty check compares raw values (no `normaliseField`) | `components/material-inward/details-next.ts` | `768a998d015f6783af6f26560d80ef091488c43e01bedcad0463b37ce57f262d` | `test/pm-d1b-ui.test.tsx > F1: a delivery with no details yet starts clean > all-null loaded values, form as first rendered: Approve and Reject are enabled` (4 failed, also 3 in `pm-d1b-pure.test.ts`) |

## 1c. Test-db run (12 Nov 2026), OBSERVED

Test database: project ref `exfccwlrhoutkgrlikod` (host of `SUPABASE_TEST_URL`; the repo's `test/setup/guard.ts` aborts on any other ref). Prod
(`jvxwqignooseazzmwhvl`) was not reachable: vitest loads only `.env.test` (`vitest.config.ts:9`); `NEXT_PUBLIC_SUPABASE_URL` is unset as vitest
sees it; the only grep hits for the prod-reaching names in the 13 files and `test/helpers/**` are two comments in `test/helpers/db.ts:27-28`.
`supabase/.temp/project-ref` was not used for this run (per Aravind, 12 Nov; vitest does not use the CLI link).

13 test-db files, one process each time, JSON reporter (`/tmp/quoco/pr-d1b-testdb.json`, `pr-d1b-testdb-baseline.json`):

| Run | Tests | Passed | Failed | Skipped |
|-----|-------|--------|--------|---------|
| Baseline, origin/main `78ba82e` | 414 | 407 | 0 | 7 |
| Branch, `7461cc1` | 415 | 408 | 0 | 7 |

The only difference is the new test, `T-ACT-1: set details > PR-D1b VEHICLE PASS-THROUGH: saving a new DC no. and date with the form's own
next keeps the stored vehicle` in `test/pm-actions.test.ts`: JSON status `passed`. No failure, so no flake re-run.
`test/capture-races.test.ts` (concurrency) was NOT run: CI-only, not verified locally.

## 2. Manual run (local production build against prod)

Status: RUN on 12 Nov by Aravind; results in section 3. (At build time it was NOT RUN: it needs a signed-in session, which only Aravind can provide.)
The table below is the checklist as planned; section 3 is the record.

Start with `scripts/login-manual-check.sh`, unchanged: clean HEAD, `npm run build`, `npm start -p 3000`, served BUILD_ID must equal
`.next/BUILD_ID` (written to `/tmp/quoco/manual-run-env.txt`). Paste that file into the result below. Approve and Reject are NOT exercised on prod.

| # | Check | Result |
|---|-------|--------|
| 1 | 360 px width: the photo is above the form; tap on the photo opens the overlay in the same tab (no new tab, no pop-up) | |
| 2 | Back closes the overlay and stays on the page; Forward re-opens it | |
| 3 | Network panel on page load: ONE `/api/capture-files/<id>` request per thumbnail (note any extra from the preload link). Opening the overlay adds one. A closed overlay adds none | |
| 4 | Esc and Close both close it; focus returns to the thumbnail | |
| 5 | Rotate x4 returns to the start; Network panel shows NO request on Rotate; rotation is 0 again after close and re-open | |
| 6 | Reload while the overlay is open: the overlay does NOT reopen, the URL hash is gone (R3). Note how many Back presses leave the page | |
| 7 | PDF: only Open / Download, new tab, no overlay | |
| 8 | Vehicle survives a save: a designated TEST delivery that has a vehicle number; save a changed DC no. / date from "More details"; read the vehicle back unchanged | |
| 9 | While the form is edited and unsaved, Approve and Reject are disabled; after a save they are enabled; a delivery with no details yet starts with them enabled | |
| 10 | A failed image (a file id of another tenant, or garbage): what the PM sees (broken icon, alt text, blank). No wording is added | |
| 11 | Hydrated DOM after opening the overlay: `document.documentElement.outerHTML` contains none of `token=`, `supabase.co`, `/storage/v1`; `img.currentSrc` is still the route path | |
| 12 | Next 16 router: opening the overlay (pushState) and Back do not trigger a route navigation or a re-render of the page data | |
| 13 | Android: a real handset Back gesture (emulation cannot show it) | |

## 3. Manual run results (12 Nov 2026)

All results are per Aravind, 12 Nov, from screenshots, against BUILD_ID `B9tAt1Q_eg5nNdKj8hU9Y` at `c94b421` (local production build against prod,
`scripts/login-manual-check.sh`, served-match MATCH). Test delivery `b9995385-c2da-476b-9cec-fa4ab989fdd9`. "Before" on prod (Aravind, 12 Nov 11:24):
`awaiting_pm`, vehicle `Test-veh1`, dc_number null, dc_date null, delivery_type `internal_transfer`.

| Check | Result |
|-------|--------|
| (a) Pre-condition: save form visible, at least one thumbnail | PASS (form visible, one photo thumbnail) |
| Page load requests | One `/api/capture-files/<id>` 302 per thumbnail, then one storage jpeg (156 kB, about 5.2 s on DevTools 3G). Opening the overlay: no new request |
| Layout | 394 px and 725 px: stacked (photo above form). Full desktop width: side by side |
| Open | Same tab; URL gains `#photo-<id>` |
| (g) Hydrated DOM | `outerHTML.match(/token=\|supabase\.co\|\/storage\/v1/g)` returned `null`. `dialog img` `currentSrc` = `http://localhost:3000/api/capture-files/6e229d28-4792-45fd-be2f-c1293f082967` |
| 5 Rotate x4 | PASS (returns to start, no new request) |
| 6 Esc / Close / focus | PASS |
| 7 Back closes and stays on the page; Forward reopens | PASS |
| 8 Approve / Reject disabled while DC no. is unsaved, enabled after clearing | PASS |
| (c)/(d) Save and vehicle | Prod row after save: `awaiting_pm`, vehicle `Test-veh1`, dc_number `test DC1`, dc_date null, delivery_type `supplier`. Vehicle PRESERVED |
| (e) Picker label | "31 Oct 2026, 12:29 pm · Vikram Rao · Matches" and "31 Oct 2026, 11:53 am · Vikram Rao · Matches" |
| 10 Failed image | `GET /api/capture-files/00000000-0000-4000-8000-000000000000` returned 404 (observed). The on-screen look was NOT recorded |
| 14 Reload while open | Overlay did not reopen; URL has no `#photo-<id>`. The Back-press count was NOT recorded |
| 12 Router | No `?_rsc` request for the detail page on open/close. The `material-inward?_rsc=` requests are for the LIST page (Link prefetch of "Back to Material Inward"). INFERRED from screenshots, not traced |
| 13 PDF | NOT COVERED |
| Android handset Back | DEFERRED to the post-deploy prod check |

Out of the checklist: Aravind linked and unlinked an invoice on the test delivery and reported pass. Prod state after (SQL on prod): one `pm_manual`
link to invoice `3bf3f3e7-b343-4f3a-a40c-5c745163acd9`, `linked_at` 2026-11-12 09:05:24Z, `unlinked_at` 2026-11-12 09:05:35Z. The invoice's automatic
delivery `06b89cbc-f2bf-4380-a212-323cd0e19bf6` is `awaiting_pm`, `cancel_reason` null. No residual change.

### Findings

- **OPEN: the hash stays in the URL with the overlay closed after "Save details".** Observed (screenshots): after Save details the overlay is closed but
  the URL still ends in `#photo-6e229d28-4792-45fd-be2f-c1293f082967`; after a reload the hash is gone and the overlay stays closed.
  Diagnosis below is READ, NOT OBSERVED (no fix applied; a code change would void this run).
  - Our code (`components/material-inward/file-viewer.tsx`) calls `window.history.pushState(window.history.state, '', viewerHash(fileId))` on open (`:95`),
    `window.history.replaceState(window.history.state, '', <path+search>)` on close when it did not push (`:106`) and on mount (`:70`). It passes the CURRENT
    history state, which Next's router owns and which carries `__NA: true`.
  - Next 16.2.11 (`node_modules/next/dist/client/components/app-router.js`): the patched `pushState` / `replaceState` do `if (data?.__NA || data?._N) { return
    originalPushState(data, _unused, url) }` (`:255`, `:271`), i.e. the router is NOT told about the new URL. Only calls without `__NA` reach
    `applyUrlFromHistoryPushReplace(url)` (`:237-247`), which updates the router's `canonicalUrl`. Separately, on every router state change (a server action with
    `revalidatePath` is one) the router runs `window.history.replaceState(historyState, '', canonicalUrl)` (`:64-66`), re-applying ITS URL.
  - The path that matches the screenshots (the checklist order): Back (overlay closes) then Forward (Next's popstate handler takes `window.location.href`,
    hash included, as `canonicalUrl`; our `sync()` reopens, `pushed.current` is false) then Close (`closeViewer` takes the `replaceState` branch with an
    `__NA` state, so the URL becomes clean but the router's `canonicalUrl` still has the hash) then Save details (server action, router refresh, `:64-66`
    writes `canonicalUrl` back) gives hash set, overlay closed.
  - User-visible effect: a URL with `#photo-<id>` and nothing open; the first Back press goes to the previous same-URL entry with no visible change, so one
    extra Back press is needed to leave the page. A reload clears it (the mount effect, R3).
  - Same root cause, second symptom (inferred, not observed): Save details while the overlay is OPEN makes the router rewrite the URL without the hash while
    the overlay stays open; Close then calls `history.back()` (`pushed.current` is true) and leaves the page.
  - Smallest fix (NOT applied): pass `null`, not `window.history.state`, in those three calls, so the router's patch runs `applyUrlFromHistoryPushReplace`
    and its `canonicalUrl` always equals the real URL (Next copies its own internal state onto the new entry itself, `copyNextJsInternalHistoryState`).
  - Test that would catch it, with a positive control: move the three history calls behind functions that take a history-like object (in
    `components/material-inward/viewer-logic.ts`) and test them in node against a fake that reproduces the router's patch above (bypass when the data carries
    `__NA`, else sync `canonicalUrl`). Assert that after open and after close `canonicalUrl` equals the fake's real URL, and that a simulated router refresh
    (`replaceState(canonicalUrl)`) leaves the URL unchanged. Positive control: put `window.history.state` back as the data argument; the assertion must go RED.
    Re-run the manual checks 7 and (c) after the fix (a new build).
  - **FIX APPLIED (commit `d9ad29f`, 12 Nov): the three history calls moved into `viewer-logic.ts` (`pushViewerEntry`, `clearViewerHash`,
    `stripViewerHashOnMount`, `closeViewerEntry`) and pass `null` as data.** Test `test/pm-viewer-history.test.ts` (fake of Next 16.2.11's patch, rules
    quoted in its header): after open, Back, Forward, Close and a simulated router refresh the real URL equals the router's URL and no `#photo-` is left; a
    refresh while open keeps the hash; mount strips a leftover hash. Positive control: `history.state` (an object with `__NA: true`) put back as data in the
    three calls; 4 of 5 tests went RED, including the repro; restored, `viewer-logic.ts` sha256 `d39fee15d92102b3ce96309739caa0ca94c91622802bc0de99f91bd16465b85b`
    before and after. The fake is a stand-in for the router, so the real behaviour is re-checked on a new build (re-run checklist R1-R6, results below once run).
- Follow-up, out of scope: the thumbnail loads the full-size image (about 5 s on 3G).
- Follow-up, out of scope: the browser tab title is "Create Next App" app-wide.
