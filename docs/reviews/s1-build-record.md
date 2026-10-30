# S1 build record: Sentry outgoing-URL scrub

Tier: FULL (PII leaving the server; no DB change). Review mode: code review of the PR only.
Design: `s1-plan-rev3.md` (Rev 3, 3a, 3b; kept in `/tmp/quoco`, not in the repo). Reviews: `docs/reviews/s1-review-round-1.md`, `docs/reviews/s1-review-round-2.md`, `docs/reviews/s1-review-round-3.md` (copied byte-for-byte). Where the plan and a review disagree the latest review wins; the places this happened are in "Deviations".

## Commits

| | SHA | Content |
|---|---|---|
| RED | `8b8ee6bc02af06e10e964269da713fcfda49f143` | tests and controls only, no production code |
| GREEN | `593eddf97155bde0243c771b9a013fb3085d8cd7` (commit 2) | fix, review copies, this record |
| round 3 | the head of this PR (commit 3) | review-round-3 fixes (see "Round 3"); GREEN is re-run here |

A commit cannot contain its own SHA, so the GREEN SHA is printed at the top of `/tmp/quoco/s1-green.txt` and in the PR body. `main` at branch point: `594e006c5c753849660ea52ac75a5f0c11eec75e`.

## Evidence files (all under `/tmp/quoco`, outside the repo)

- `s1-red.txt`: run at the RED SHA, headed by HEAD and an empty `git status --porcelain`; json counts, the failing rows, and why each is red.
- `s1-green.txt`: run at the GREEN SHA, same header.
- `s1-controls.txt`: every control re-run at the GREEN SHA. `s1-controls-precommit.txt`: the first run, on the working tree before commit 2 (HEAD printed there is the RED SHA).
- `s1-build-log.txt`: every command and its raw output, including the diagnostic that explained a harness artifact (below).

## RED (commit 1)

133 tests in the 5 new/edited files: 81 red, 52 green. Of the 81: 35 are content assertions on code that exists (the real leak), 44 are rows that need a module that does not exist yet (`scrub-url`, `trace-targets`, `traces-sampler`), 2 are the J5 seam controls (export does not exist yet). The 52 green rows are guards and positive controls that must hold before and after (harness captured envelopes, tripwire flag set, J2.1 and J2.4 unchanged names, own-origin headers, scan M clean, scanner self-tests, config rows that already held).

**What the 44 module-missing rows are worth (N12).** Those 44 RED rows were all "Cannot find module" (or the `vi.mock` of a module that did not exist): an import failure does not show that an assertion can fail. For `traces-sampler` and `trace-targets` the assertion-level evidence is the GREEN-time controls instead: `SAMPLER_CONTROL=const1` and `TARGETS_CONTROL=all` both fire at the expected rows (table below). The 35 content failures and the other controls are the assertion-level evidence for the rest.

Every A1 location from the plan fails on the unfixed tree for its own reason: breadcrumb `data.url` and `data.http.query`, undici and `node:http` span descriptions, span `data.url`, `url.full`, `url.path`, `url.query`, `http.url`, `http.target`, the root's `contexts.trace.data.http.target`, `extra` free text, tenant/document/file ids in the raw text, the canaries, J2.2, J2.3, third-party headers. The side-by-side control: scan M (the C5-style mocked scan of the explicit `captureMessage` payload) passes on the unfixed tree while scan R (the real captured envelopes) fails. That pair is the proof that the C6 contract in `capture-ingest.ts` never covered what auto-instrumentation emits.

## GREEN (commit 2)

- New/edited S1 files: 133 of 133 pass.
- Required set (the S1 files, `scrub-pii`, `sentry-config`, `capture-error-phone-scrub`, `sentry-call-sites-no-phone`, `*sentry*`, all `test/capture-*.test.ts` and `test/unit/capture-*.test.ts`): 21 files, 531 tests, 524 passed, 0 failed, 7 skipped (existing rehearsal-only skips). The `test/capture-*` files are the repo's real test-db suites run through the allowlisted `.env.test` guard as usual.
- `tsc --noEmit`: clean. `eslint` on every changed file: clean.

## Controls (each must go RED, and at the expected row)

All 13 fire at the expected row(s) (12 at round 2, plus `rev2-classifier` in round 3). They are env switches read by test code only, so nothing is edited on disk; the sha256 printed per control is of the source file whose behaviour the switch neutralises.

| Control | Fires at |
|---|---|
| `URL_SCRUB_CONTROL=identity` | undici-shaped span, B2 rows, A1 undici spans, A1 breadcrumbs, J2.2 (26 rows) |
| `URL_TEXT_CONTROL=identity` | `reduceUrlsInText` rows, A1 D1 (15 rows) |
| `CLASSIFIER_CONTROL=rev2` | J2.1 (Rev 2 classifier + transform swapped into the REAL hooks via `vi.mock`) |
| `CLASSIFIER_CONTROL=rev2-classifier` (round 3, S7) | J2.2 and "Next root span is Tier 1 only" (the classifier ALONE swapped; the real Tier 2 stays) |
| `TARGETS_CONTROL=undefined` (server, edge, client) | HEADERS third party, `tracePropagationTargets is a defined array` x3 |
| `TARGETS_CONTROL=all` | the three `tracePropagationTargets` rows |
| `SAMPLER_CONTROL=const1` | sampler MATCH rows, server sampling config row |
| `TRIPWIRE_CONTROL=skip` | TRIPWIRE, at `expected undefined to be '1'` |
| `HOOKS_CONTROL=none` / `identity` | `wires the scrubber into all five hooks` (and `strips whatsapp` for identity) |
| `SEAM_CONTROL=show` | J5 CONTROL 1 and CONTROL 2 |

## Read versus observed

**Observed (in test runs, Node v26.5.0, `@sentry/*` 10.63.0):** the real `sentry.server.config.ts` with only the transport replaced; real undici and `node:http` spans and breadcrumbs, their keys and values; a Next-shaped root and INTERNAL child built through the real OpenTelemetry tracer; envelopes before and after the fix; `NEXT_OTEL_FETCH_DISABLED` set in the test process; `sentry-trace`/`baggage` received or not by local servers.

**Read, not observed:** that Next's `AppRender.fetch` span is suppressed in the production build/process; that the sampler sees `http.target` on Next's real root span (the unit rows use the shape read from `@sentry/opentelemetry`); anything on the browser or edge runtimes (unit rows through the shared hooks only); real Twilio/Supabase/Anthropic/Resend calls; the Sentry UI; Vercel behaviour (cron requests, deploy, Production Branch); whether any live `/auth/callback?code=` request exists.

## Deviations from the plan or a review

1. **Worktree.** Built in a git worktree (`.claude/worktrees/s1-sentry-url-scrub`), not by switching branches in the shared checkout; the branch was renamed to `s1-sentry-url-scrub`.
2. **Symlinks.** `node_modules` and `.env.test` are symlinked into the worktree (both gitignored) so vitest's `globalSetup` guard and the real suites can run. `.env.test` was never read or printed by this work. The instruction list said not to touch `.env*`; a symlink was the only way to run the required suites there.
3. **The plan's N3/J7 harness snippet parses but does not work.** `{ ...actual, init }` drops the exports of the externalised CJS module (vitest then reports `captureMessage` undefined on the mock). The harness uses a `Proxy` over the real module, with explicit types (the snippet's `transportOptions` was implicitly `any`, and `skipOpenTelemetrySetup` is not on the `@sentry/nextjs` init type).
4. **Harness artifact found in the first RED run.** A static `import { request } from 'node:http'` at the top of the test file binds the unpatched function before Sentry's init, so no `node:http` span appeared and the A1 `node:http` row failed for the wrong reason. A throwaway diagnostic (raw output in the build log) showed the spans do appear when `node:http` is loaded after init, as in the real server. The harness now loads it with `createRequire` after the config import. No assertion was weakened; the plan's A1 row was correct.
5. ~~**Tier 1 also runs on an error event's `contexts.trace`.** The plan listed transactions only. The trace context of an error event carries the same `http.target` with its query, so the same reduction applies.~~
   **30 Oct, round 3 (N10): the stated mechanism was false in 10.63.0.** An error event's trace context comes from `getTraceContextForScope` (`@sentry/opentelemetry/build/cjs/asyncContextStrategy-CvLbRw2N.js:731-734`) -> `core.spanToTraceContext` (`@sentry/core/build/cjs/utils/spanUtils.js:34-44`), which returns `parent_span_id`, `span_id` and `trace_id` only: no `data`, so no `http.target`. Only a TRANSACTION's `contexts.trace` carries the root span's attributes. The code stays as defence in depth (idempotent, fails closed through the existing catch, guards against an SDK change); the unit row uses a hand-built event, so it proves the function works, not that a real error event needs it. The comment in `scrub-pii.ts` now says so.
6. ~~**S6 pair-swap (awaiting reviewer ruling).**~~ **Accepted in round 3 (ruling 1), with one gap closed (S7).** The plan swaps the Rev 2 classifier AND transform under `CLASSIFIER_CONTROL=rev2`, because swapping only the classifier cannot make J2.1 fail: the rename guard (method and host both required) protects a hostless child. That leaves the classifier alone never shown RED, so `CLASSIFIER_CONTROL=rev2-classifier` swaps the classifier only: it goes RED at J2.2 (`expected undefined to be '/s1-root'`) and at the "Next root span is Tier 1 only" unit row, because a presence-based classifier makes Tier 2 delete `http.target` on the Next root.
7. **Seam controls are self-checking.** The two J5 controls assert the control's verdict (filename not kept; phone not redacted) so they pass when the control "fails"; `SEAM_CONTROL=show` runs the production expectation un-inverted so they go RED visibly.
8. **Controls were first run before commit 2** (HEAD printed is the RED SHA, tree dirty by design) and re-run at the GREEN SHA; both files are kept.
9. **Commit 2 edits one commit-1 test file** (`test/unit/sentry-outgoing-url-envelope.test.ts`) for the two `tsc` type errors in the harness (item 3). Types only, no assertion or behaviour change; the RED run was taken on the unedited version at the RED SHA.
10. **The test-db suites ran.** The required set includes `test/capture-*.test.ts`, which use the allowlisted test-db through `.env.test`. No schema change, no CLI, no migration.

## Debugging cost (plan section E)

- **Outgoing calls collapse to host.** A failed Twilio or Supabase call now reads `GET api.twilio.com` / `POST <ref>.supabase.co`: method, status and host survive; the SID path, the table, the bucket and the tenant do not. The existing explicit `captureMessage` context (feature tags, fingerprints, job ids) and Twilio's and Supabase's own logs are what tell the calls apart.
- **Client performance loses which chunk or script was slow (N13).** Tier 1 turns any non-URL `url` value into `[unparseable-url]` (and a relative one into `[same-origin]`), and the free-text pass (D1) reduces browser resource-span descriptions to the host. Client performance views can no longer show which chunk or script was slow.
- **Client error events lose the page path in `request.url`** (reduced to `scheme://host`); the route survives in the transaction name. Unverified on a real browser event.

## Out of scope

- **S1b:** navigation breadcrumb `data.from` / `data.to` (same-origin values are path + query + fragment, scheme-less), and pageload / navigation transaction names that carry a query. Browser `request.url` and absolute `url.full` ARE reduced (D1 and Tier 1).
- **D5:** scheme-less resource paths in free text: `lib/whatsapp/outbound/send.ts:245-271`, `lib/dpr/owner-deliver-dispatch.ts:485,516,538`, `lib/hindrance/pm-notify.ts:533`, `lib/whatsapp/outbound/trigger.ts:317` (writes `outbound_sends.error`), and the media-module thrown messages that embed an object path. **S1 does not close Twilio-SID exposure in Twilio error text.**

## Round 3 (this commit, on top of `593eddf97155bde0243c771b9a013fb3085d8cd7`)

Review: `docs/reviews/s1-review-round-3.md` (conditional GO). One commit, no behaviour change in production code (a comment only):
- **S7:** `CLASSIFIER_CONTROL=rev2-classifier` added to `sentry-outgoing-url-envelope.test.ts` and `scrub-url.test.ts`; RED at J2.2 and "Next root span is Tier 1 only" (above).
- **N10:** the comment above `withUrlTiersOnTraceContext` corrected; item 5 above struck with the corrected mechanism. Code kept.
- **N11:** the DSN normalisers (the test row at `:296` and the identical one in `scanEnvelopes`) deleted. The envelope header carries the dsn only when a tunnel is set (`@sentry/core/build/cjs/envelope.js:34,58`: `!!tunnel && dsn`) and none is; with them removed all 28 envelope-test rows still pass, so no DSN is in any scanned body.
- **N12, N13:** the lines above.
- Evidence for this commit: `/tmp/quoco/s1-green-2.txt` (headed by HEAD and an empty `git status --porcelain`), `/tmp/quoco/s1-controls-2.txt` (all 13 controls, HEAD and the neutralised file's sha256 per control), `/tmp/quoco/s1-round3-log.txt`.

## Open items

- **Vercel Production Branch** (Vercel, Settings, Git, Production Branch): decides what "merge at least one full day before D-30" means. `vercel.json` has only a `crons` key, so no git override in the repo.
- **Sentry Crons falsifier:** if Sentry, Crons shows a live `/api/jobs/tick` monitor today, the reading in `traces-sampler.ts` (no tick check-ins) is wrong and the sampler comment must be revisited before it ships.
- **Quota and retention:** after deploy, tick transactions per hour should fall from about 60 to about 1.2 (B3, drop the tick, is the one-line fallback). Events and transactions already stored in Sentry may contain Twilio paths and tenant/log ids; purging them is a Sentry-UI action, not part of this PR.
- **Post-deploy gate (D-30), the reviewer's four items:**
  1. Raw JSON of one real tick transaction, from Sentry UI → JSON. Pasted, not summarised.
  2. Raw JSON of one real error event.
  3. Tick transactions per hour, before and after.
  4. For headers: the A4 config assertion plus the local two-server behaviour test, with a written line that prod header receipt can't be observed from where you sit.
  Merge at least one full day before D-30. Aravind runs these (no Sentry MCP is authenticated).
- **Package attachments the reviewer asked for:** `s1-rev3-log.txt`, `s1-plan-delta.md`, `s1-rev2-log.txt`.
- **S1 live request:** whether any live request ever carries `/auth/callback?code=` is unverified; the route's own comment says the OTP flow does not use it. Tier 1 stays regardless.
