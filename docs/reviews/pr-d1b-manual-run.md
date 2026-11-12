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

Status at build time: NOT RUN. It needs a signed-in session, which only Aravind can provide (OTP).

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
