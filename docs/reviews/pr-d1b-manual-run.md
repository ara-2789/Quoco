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
