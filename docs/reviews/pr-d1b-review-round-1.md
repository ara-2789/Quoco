**PR #352 (PR-D1b) review: GO (conditional).** There are no blocking findings. Two should-fix items need to land before merge, because merge is deploy.

## Pins and scope

- PR head: `3aed0938cfc4691e3fe4633e72b0ba826b51df71`. Base `origin/main`: `78ba82e110193266a6f33a7d364729d242e89849`. The base is also the merge-base, so the package's base pin is correct.
- Read in full: every code file in the diff, the review package, the plan with its Revision 2, the evidence README, and the test changes in `pm-render`, `pm-viewer-history` and `pm-engineer-names`.
- `d9ad29f..3aed093` changes only files under `docs/`. The node-only evidence (taken just before `d9ad29f`) therefore applies to HEAD. The test-db run was at `7461cc1`. Code has changed since then only in `file-viewer.tsx`, `viewer-logic.ts` and `pm-viewer-history.test.ts`, with no database code, which matches §6.
- I re-ran 8 node-only files at `3aed093`: `pm-render`, `pm-d1b-pure`, `pm-d1b-ui`, `pm-engineer-names`, `pm-viewer-history`, `pm-strings-approved`, `pm-unit` and `capture-static-guards`. Result: **8 files, 405 passed, 0 failed.**
- **I could not check CI run 43194138715 from here.** I can't confirm its `head_sha` or what it concluded. Before merging, check that the run's head SHA is `3aed093` and not an earlier push.
- Test-db and `capture-races` were not re-run by me.

## Answers to the six questions

**1. T-RENDER, including React's auto preload: confirmed.**
- I rendered a bare `<button><img src="/api/capture-files/abc">` with react-dom 19.2.4, the version in `package.json`.
- `renderToStaticMarkup`, `renderToString` and the streaming render all emit `<link rel="preload" as="image" href="/api/capture-files/abc"/>`. The preload carries only the route path, exactly the `src`.
- `pm-d1b-ui.test.tsx:91-100` pins the preload `href` to the route-path shape. Control C1 went RED on the preload line first (`expected '<link rel="preload" as="image" href="…' not to contain 'token='`), which proves that assertion can fail.
- The client boundary passes only `fileId` to `FileImage`, so nothing storage-shaped reaches the page payload.
- The signed URL exists only in the 302 `Location`, and the route sets `no-store` on it.
- The route's `no-referrer` also carries over the redirect, because Fetch applies the redirect response's `Referrer-Policy`. So the storage host gets no Referer.
- Still open: prod/Vercel headers, as you listed.

**2. D3 reversal (plain `<img>` for images only): accepted.**
- The reason that makes this safe is in `capture-ingest.ts:84, 139-141`. Stored content types are detected from the file bytes, never from the client's label, and only `image/jpeg`, `image/png` and `image/webp` are possible. So every stored `image/*` will render; no HEIC-style dead images.
- `next/image` stays banned, which is correct: the optimiser would fetch the image server-side and serve it from its own path.

**3. Engineer-name read: correct.**
- `sent_by` and `reported_by` are `NOT NULL` (`049:287`, `:352`), so `.in('id', …)` can never receive a null.
- Both have same-tenant composite FKs (`049:298`, `:376`).
- The query has the same shape and permission-filter behaviour as the existing list read at `pm-queries.ts:197`.
- Control C3 went RED when the tenant filter was dropped. The read failing loudly matches how the list page handles the same failure.

**4. Vehicle pass-through: correct.**
- `buildDetailsNext` never reads vehicle from form state.
- The database caps stored vehicle values at 64 characters, so `validDetails` (`pm-actions.ts:108`) cannot reject a save over a field the PM can't see.
- D8 still compares vehicle, which is harmless: see N3.

**5. Viewer history vs the Next 16 router: the reading is correct.**
- I read `node_modules/next/dist/client/components/app-router.js` at 16.2.11. The patched `pushState`/`replaceState` skip the router only when `data.__NA` or `data._N` is set. With `null` data they call `copyNextJsInternalHistoryState`, then `applyUrlFromHistoryPushReplace`, which dispatches `ACTION_RESTORE`.
- `onPopState` traverses only when `__NA` is present. The copied state always carries it, so Back never falls into the reload branch.
- The `#photo-` fix is right. The dialog side has a separate defect: see S1.

**6. Approve/Reject disabled while unsaved: the dirty check is right.**
- `normaliseField` is the same function the server uses to compare.
- Wiring Decision controls in as `children` introduced a regression: see S2.

## Findings

**S1 (non-blocking, fix before merge): the native dialog can close without React knowing, and the thumbnail stops working until reload.**
- **Where:** `file-viewer.tsx:84-89` and `:112-119`. The `<dialog>` has `onCancel` but no `onClose`.
- **Mechanism:**
  - Esc on desktop and the Android Back gesture are "close requests". Chrome sends them to a modal dialog through CloseWatcher.
  - Chrome only fires a cancellable `cancel` event if the page has had user activation since the last cancelled close. Without that, `cancel` is either not cancellable or skipped, and the dialog closes natively.
  - Path to the bug: open by tap → Esc (your `cancel` handler cancels it, using up the activation) → Forward (reopens, no activation) → Esc. On that last Esc, the dialog closes natively while React state `open` stays `true` and the `#photo-` hash stays in the URL.
  - The next tap on the thumbnail calls `setOpen(true)`, which changes nothing. The `[open]` effect doesn't run, so `showModal()` is never called again.
- **Android note:** Back there goes through this same `cancel` route, not `popstate`. The desktop Back/Forward passes (R2) therefore tell you nothing about the Android check you deferred.
- **Fix:**
  - Add `onClose` to the dialog: if `open` is still true, run the same close sequence.
  - In `openViewer`, call `showModal()` directly when `dialogRef.current?.open === false`, instead of relying on a state change.
- **Proof:** manual run, desktop Chrome: tap → Esc → Forward → Esc → tap. The overlay must reopen, and the URL must not end in `#photo-`. Add "open via Forward, then Back gesture" to the post-deploy Android check.

**S2 (non-blocking, fix before merge): saving details wipes the typed reject reason.**
- **Where:** `detail-view.tsx:107-108`. `DecisionControls` is now a child of `<DetailsControls key={JSON.stringify(loaded)}>`.
- **Mechanism:**
  - A successful save, or a `STATE_CHANGED` refusal, revalidates the page (`actions.ts:31-32`).
  - The new `loaded` changes the key, and the whole subtree remounts, `DecisionControls` included. Its `reason` state (`decision-controls.tsx:29`) resets to `''`.
  - The textarea (`:63-70`) is not disabled while the form is dirty. So a PM who types a 300-character rejection, notices the type is wrong, fixes it and saves loses the reason.
  - This is new in this PR: before it, `DecisionControls` was a sibling outside the keyed element.
- **Fix:** keep the key on an inner form component and keep the `DetailsDirtyContext` provider and `children` outside the keyed element. Or report `dirty` upward through a callback and render `DecisionControls` as a sibling again.
- **Proof:** manual check: type a reason, change the type, Save. The reason must still be there.

**N1: the cause of the disabled Approve/Reject buttons can be invisible.**
- If the unsaved edit is DC no. or DC date inside a collapsed "More details", the PM sees greyed buttons and nothing on screen explains why.
- Two options: open the `<details>` while it holds the unsaved change, or add a one-line note (that needs a string approval).

**N2: images lost the "Open" new-tab path.**
- That path gave the full-resolution image with browser zoom and save.
- Package §1 item 3 says PDFs are unchanged but doesn't say images lost Open. Add one line so it is a recorded decision rather than a silent change.

**N3: `vehicle_number` now has no writer and no reader in the app.**
- The only writer is `pm_set_delivery_details`, and the PM page no longer shows or sends a new value.
- A wrong vehicle number can now be neither seen nor corrected, and new deliveries will stay null.
- Record it as a decision with an owner: drop the column in D2, or restore the field. Don't leave it as an implied leftover.

**N4: the same `users` name lookup now exists in three places** (`pm-queries.ts:64`, `:197`, `:357`). Fix the pattern, then sweep the pattern: route `:197` through `readEngineerNames`.

**N5: the history tests model Next by hand.**
- `pm-viewer-history.test.ts` is a stand-in for Next 16.2.11's behaviour. A Next upgrade keeps it green whatever the router does.
- Add a tripwire test that asserts `package.json` has `next === "16.2.11"`, with a failure message telling whoever bumps it to re-run manual checks R1–R3.

**N6: the plan's §1 is stale.**
- §1 still lists `decision-controls.tsx` and `pm-file-access.ts` as "never touched". Revision 2 records the first; nothing records the second.
- Add a dated line in §1 for both.

**N7: the picker label dropped the DC number.**
- In invoice mode the PM chooses up to 20 DCs. Two DCs from the same engineer on the same day now differ only by time.
- This was decided; noting it so the trade-off is on record when a PM picks wrongly.

## Credit

- `linkOptionLabel` substitutes all placeholders in one pass (`labels.ts`), so an engineer's name containing `{time}` can't be expanded.
- `formatIstTime` is computed from the UTC instant plus the fixed +05:30 offset, not from the machine's zone or the browser's am/pm casing. It is tested across midnight, noon and the IST date line.
- On mount, the viewer clears any `#photo-` hash family member, not only the exact form `parseViewerHash` accepts. A malformed leftover hash cannot survive.
- Control C5 targets the specific regression: putting `history.state` back as the data. 4 of 5 tests went RED.
- The overlay `<img>` is rendered only while open, and F2 counts image elements and preload links separately.

## Verdict

**GO (conditional).** There are no blocking findings, and the design is right on all six items you asked about.

Conditions before merge (merge is deploy):
1. S1 fixed, with the manual sequence above recorded: tap → Esc → Forward → Esc → tap reopens, and no `#photo-` is left in the URL.
2. S2 fixed, with the reject-reason retention check recorded.
3. The CI run confirmed green at the final head SHA.

The N items can go into the package or D2 with an owner. No new review round is needed: send the S1/S2 diff and the two manual results, and I'll check only that.

Post-deploy checks remain as you listed them. Add to them: Android Back after a Forward-reopen, and confirming the first thumbnail on prod makes one 302 and then one image request, preload included.
