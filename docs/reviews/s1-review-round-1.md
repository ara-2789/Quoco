I'll pull the reviewer skill, finding classes, and the project's review conventions before reading the plan against them.

Pin matches. Now the SDK version the plan's line-cites depend on, and the files under change.

Hashes match. `^10.63.0` is a caret range — checking what the lockfile actually resolves, then reading the scrubber the plan edits.

Confirmed `next.span_name` is stamped on every Next span, not just fetch. Now the sampling-time name of the root span:

Root span is born as `GET` and renamed to `GET /api/jobs/tick` only in the `finally` after the handler runs. Checking what name Sentry's sampler actually hands to `tracesSampler` at start:

`vercelCronsMonitoring` hangs off `spanEnd` — that's the plan's unknown #12 and it's answerable from source. Reading it and the repo's `next.config.ts`:

`process.env.NEXT_OTEL_FETCH_DISABLED = "1"` in the Sentry server init — checking whether Next's patch-fetch honours it, because that decides whether the plan's addition #1 exists at runtime:

# S1 Rev 2 — external review, round 1

## Pins and scope

- `main` = `594e006c5c753849660ea52ac75a5f0c11eec75e` (`git ls-remote`, this session). Matches the plan's pin.
- Verified at that SHA: `scrub-pii.ts` sha256 `627308711cbaf713…5277`, blob `35599b3f…`; `capture-error-phone-scrub.test.ts` blob `c15457d5…`; `capture-ingest-support.ts` blob `13c0109b…`. `leakFindings` is at `:91-100`, not `:86-100`. The docstring starts at 86, so that's fine.
- Lockfile resolves every `@sentry/*` to `10.63.0`. `package.json` says `^10.63.0`, so the pin depends on `package-lock.json` staying in the byte-identical list. It is in that list. Good.
- The repo has no `node_modules`, so I pulled `next@16.2.11` and the six `@sentry/*@10.63.0` tarballs and read the cited paths there.
- **Could not verify:** `/tmp/quoco/s1-plan-delta.md` and `s1-rev2-log.txt` were not sent. The header claims "every row of the net edit table" landed. I can't check that claim. Every Rev 1 decision does show up as decided in Rev 2.

## Your six questions

**1. URL_KEYS completeness.** I grepped every `url.*` / `http.*` / `next.*` / `net.*` / `server.*` key that core, node, node-core, opentelemetry, browser and nextjs 10.63.0 write.

- **Scheme-less keys:** your seven are the complete set: `http.target`, `url.path`, `url.query`, `http.query`, `url.fragment`, `http.fragment`, `url.template`.
- **Scheme'd keys:** also caught by D1.
- **`http.request.header.referer`** (`browser/.../integrations/httpcontext.js:35`): a page URL. It belongs to S1b and D1 reduces it anyway.
- **Trace state `sentry.url`:** read only by `getCurrentURL` (`asyncContextStrategy-CvLbRw2N.js:539-549`). I found no path that serializes it. This agrees with your [unverified] note but doesn't upgrade it.
- **Gap:** the list is fine. The problem is that the list is also the classifier. See B1.

**2. Is the classifier safe?** No. See B1. It over-matches every span Next emits, not only fetch, and the transform for a match rewrites names. That is not "loses detail". It destroys every server trace's span names, and nothing in C2 would notice.

**3. Honour `parentSampled` first on a cron route?** Mechanically yes. Two corrections:
- **Return value:** `core.sampleSpan` hands you `ctx.inheritOrSampleWith(fallback)`. It prefers `parentSampleRate` over the boolean, so the DSC keeps the real upstream rate. Returning raw `parentSampled` records rate 1 for inherited traces. Use `inheritOrSampleWith(0.02)` and `inheritOrSampleWith(1)`. (N2)
- **Where rule (1) actually fires:** never for real cron traffic, because Vercel cron sends no `sentry-trace`. It fires for anyone who sends `sentry-trace: <t>-<s>-1` to `/api/jobs/tick`. Sampling runs at span start, before your CRON_SECRET check. The cost is quota only, not privacy.
- **Your unknown #2 resolves in your favour.** `shouldSample` → `inferSpanData` → `getSanitizedUrl`. For the SERVER branch it builds `GET ` + `stripUrlQueryAndFragment(http.target)`. That happens before Next's `updateName` at `base-server.js:515`, while Next's own name is still the bare `GET` (`:478`). So at sample time the sampler sees `name = 'GET /api/jobs/tick'` and `attributes['http.target']`. That the UI name equals the inferred name is a coincidence of mechanism. Write that in the sampler comment. Anyone who "fixes" the match against Next's raw span name will turn the sampler into a no-op.

**4. The Next fetch-span stand-in.** It is a stand-in for a span that does not ship. See S2. Replace it with a tripwire. Don't try to improve its fidelity.

**5. Skip `stacktrace` / `debug_meta` / `sdk` / `modules`.**
- **For symbolication:** right set. Browser `abs_path` and `debug_meta.images[].code_file` are the URLs that matter. Server frames are `file://` / `app:///` and never match `https?://`.
- **Implementation:** the plan as written can't be built without a P0 regression. See S3.

**6. Any reason not to merge before D-30?**
- **With B1 open:** yes. Merging it blinds every server trace in exactly the window when D-30 needs them.
- **With B1 fixed:** no. Merge is deploy, so merge at least one full day before D-30, and run the observation gate (S5) on real envelopes in that window.

## Findings

**B1 — the classifier reads "has a URL-ish key" as "is outgoing". Next puts those keys on every span.**

- **Mechanism:**
  - `next/dist/server/lib/trace/tracer.js:159-163` stamps `next.span_name` + `next.span_type` on every span Next creates: `BaseServer.handleRequest`, `AppRouteRouteHandlers.runHandler`, render spans, all of them.
  - `base-server.js:477-483` puts `http.target: req.url` on the root.
  - A2 classifies on "`data` contains any key in URL_KEYS". `next.span_name` and `http.target` are both in URL_KEYS, so every one of those spans is "outgoing".
  - The transform then rewrites `description` / `next.span_name` to `<METHOD> <hostname>`.
  - `executing api route (app) /api/jobs/tick` has no method token and no hostname. The plan defines `HTTP <hostname>` for the missing method and defines nothing for the missing host.
  - The root's `contexts.trace.data['next.span_name']` gets the same treatment in `beforeSendTransaction`.
- **Outcome:** every server trace becomes a tree of identical, meaningless span names. The webhook, the tick and capture-ingest are indistinguishable below the transaction name.
- **Why the plan doesn't catch it:**
  - C2's root is `Sentry.startSpan({name:'GET /s1-test-root', op:'http.server'})`. It carries no Next attributes.
  - C4's preserved-set check covers only the http spans.
  - C5's "classifier doesn't touch non-http spans" row uses a `db` span, which doesn't have the keys that trigger this.
- **Fix: two tiers.**
  - **Tier 1, any span or breadcrumb, never renames:**
    - delete `url.query`, `http.query`, `url.fragment`, `http.fragment`;
    - strip query and fragment from `http.target`;
    - reduce absolute URL values;
    - leave `http.route` / `next.route` alone. They are route templates.
  - **Tier 2, outgoing only:** classified by provenance:
    - span kind CLIENT, or
    - `op` starts with `http.client`, or
    - `sentry.origin` in the `auto.http.*` client family, or
    - `next.span_type === 'AppRender.fetch'`.

    Tier 2 deletes path keys and does the `<METHOD> <host>` rename. Take `next.span_name` out of the trigger set. It stays in the transform set for `AppRender.fetch` only.
- **Test:** in the envelope harness, create the root the way Next does. Use `trace.getTracer('next.js').startActiveSpan('GET', { kind: SpanKind.SERVER, attributes: { 'next.span_name':'GET', 'next.span_type':'BaseServer.handleRequest', 'http.method':'GET', 'http.target':'/s1-root?code=S1CANARY_QUERY' } })`, plus an INTERNAL child `executing api route (app) /s1-root` carrying `next.span_name`. Assert:
  - the child `description` is byte-identical;
  - the root `http.target === '/s1-root'`;
  - the canary is absent from the raw envelope.
  - RED on HEAD for the canary. GREEN after.
  - Under the current A2, the description assertion must FAIL. That proves the test sees B1.

**S1 — D3 rests on a wrong premise. Half of the PKCE leak is server-side, and S1 currently removes it by accident.**

- **Where it leaks:** `app/(auth)/auth/callback/route.ts:8` reads `code` from the query. That is a server route handler. Its root span carries `http.target = '/auth/callback?code=<PKCE>'` (`base-server.js:482`), so the code ships today in `contexts.trace.data['http.target']` on server transactions.
- **Why "browser" is wrong:** §D and §I frame this as browser/incoming. `queryParams:false` doesn't touch it. Your own probe shows that flag only governs `query_string`.
- **What S1 does today:** A2's over-match deletes `http.target`, so S1 covers it by accident. The B1 fix must cover it on purpose: Tier 1 strips the query.
- **Fix:** record D3 again with the corrected mechanism, as a dated strike in §D and §I. The server `http.target` half is in S1. Pageload/navigation and browser `request.url` stay in S1b.
- **Test:** B1's canary covers `http.target`.
- **Server `request.url`:** if the raw-envelope scan also finds the canary in a server `request.url`, that moves into S1 too. Let the RED run decide. Don't argue it in advance.

**S2 — Addition #1 is false at runtime. No `AppRender.fetch` span ships.**

- **Mechanism:**
  - `@sentry/nextjs/build/cjs/server/index.js` `init()` sets `process.env.NEXT_OTEL_FETCH_DISABLED = "1"` unless `skipOpenTelemetrySetup`.
  - `next/dist/server/lib/patch-fetch.js:213` reads it into `hideSpan`.
  - `tracer.js:144` then returns `fn()` without creating a span.
  - So "one call yields two spans carrying the URL" is wrong under this SDK.
- **This is a [read] claim with a stopped read:** the author read patch-fetch and not the init that disables it. Same class as Rev 1's stale-main claim. Strike it, dated.
- **The C2 #4 stand-in fails twice.**
  - It tests a span that doesn't exist.
  - `Sentry.startSpan` makes a manual INTERNAL span. In `descriptionForHttpMethod`, `useInferredDescription` is false for that span, so it takes a different branch than a real CLIENT span would.
- **Fix:**
  - Replace C2 #4 with a tripwire: after importing the real server config, `expect(process.env.NEXT_OTEL_FETCH_DISABLED).toBe('1')`.
  - Keep `AppRender.fetch` in Tier 2 as defence in depth.
  - Add a line in the server config: setting `skipOpenTelemetrySetup` reopens this.
- **This answers Q4.**

**S3 — the D1 wiring contradicts itself, and the obvious resolution regresses P0.**

- **The contradiction:**
  - A3.2 puts the URL pass inside `scrubString`. `scrubString` is a leaf with no path (`scrub-pii.ts:48-54`).
  - A3.3 requires skipping whole subtrees. `scrubString` can't know it's inside `stacktrace`.
- **The obvious fix breaks P0:** stopping descent in `scrubValue` at those keys also switches off the phone/email regexes for frame `context_line` / `pre_context`. Today those regexes run there, because `deepScrub` walks everything. That is a P0 regression no current test pins.
- **Fix:**
  - `scrubValue` carries a `urlPass` flag. It is cleared on entering `stacktrace`, `debug_meta`, `sdk` and `modules`.
  - `scrubString(s, { urls })` always runs the phone and email passes and runs the URL pass only when `urls` is true.
  - Decide whether keys get the URL pass. `:79` scrubs keys today (N).
- **Test:** one frame with `filename: 'https://app.example.test/_next/static/chunks/a.js?dpl=x'` and `context_line` containing a phone. Assert the filename is byte-identical and the phone is redacted.
  - Control: with the skip removed, the filename assertion fails.
  - Control: with the descent stopped, the phone assertion fails.

**S4 — scheme-less Twilio resource paths in free text. Same class as D5, sites not listed.**

- **The path:** `lib/whatsapp/outbound/send.ts:245-271` parses Twilio's error `message`. That text lands in Sentry `extra.errorMessage` at:
  - `lib/dpr/owner-deliver-dispatch.ts:485`, `:516`, `:538`
  - `lib/hindrance/pm-notify.ts:533`
  - `trigger.ts:317`, into `last_error`
- **The leak:** Twilio's 404 texts are of the form "The requested resource /2010-04-01/Accounts/AC…/… was not found". I'm relying on Twilio's documented format here. I did not observe one in this codebase.
  - No scheme, so D1 misses it.
  - Not an outgoing item, so A2 misses it.
  - It contains the Account SID, which `leakFindings` treats as a leak class.
- **Fix:**
  - Widen D5 to "scheme-less resource paths in free text" and list these sites.
  - The S1 review package must not claim the outgoing-URL work closes Twilio-SID exposure.
- **Not blocking for S1.**

**S5 — the D-30 gate has no defined way to verify it on prod.**

- **The problem:** §H requires proving that third parties receive no `sentry-trace` / `baggage` on prod. Unknown #10 admits there's no method. That makes it a gate nobody can meet, so it will get waived.
- **Fix: make the gate exactly these four items.**
  1. Raw JSON of one real tick transaction, from Sentry UI → JSON. Pasted, not summarised.
  2. Raw JSON of one real error event.
  3. Tick transactions per hour, before and after.
  4. For headers: the A4 config assertion plus the local two-server behaviour test, with a written line that prod header receipt can't be observed from where you sit.
- **Who does it:** you run these, since no Sentry MCP is authenticated.

**N1.** Use `/^\/(?!\/)/`, not `/^\//`. The SDK's own same-origin test is `request.js:112`.
- `/^\//` also matches protocol-relative `//host/x`.
- In practice it only bites when `getLocationHref()` is empty (`request.js:111-117`). With a location, absolute resolution happens first.
- On the server it never matches. Zero cost to fix.

**N2.** `inheritOrSampleWith`. See Q3.

**N3.** The C2 harness snippet `init: (o) => (await orig()).init(...)` is an `await` in a non-async arrow. It won't parse. Hoist `await orig()` into the factory.

**N4.** Unknown #12 resolved from source: no tick check-ins exist today.
- `automaticVercelMonitors` sits under `webpack:`, which gives strategy `wrapper` (`getFinalConfigObjectUtils.js:171,194`).
- Turbopack injects `_sentryVercelCronsConfig` only for strategy `spans` (`getFinalConfigObjectBundlerUtils.js:34`).
- Route handlers aren't wrapped.
- **Tripwire:** if anyone turns on `_experimental.vercelCronsMonitoring`, check-ins start on `spanStart` (`handleOnSpanStart.js:33`). A 0.02-sampled root won't record, so about 98% of check-ins go missing. Put that in the sampler comment.
- **How to falsify me:** if Sentry → Crons shows a live `/api/jobs/tick` monitor today, my reading is wrong.

**N5.** §D says "none sets `ignoreSpans`". That's true of your files. It's false of the effective options: nextjs `init()` appends `nextjsIgnoreSpans` (`server/index.js` ~95-107). Add a dated note.

**N6.** Unknown #5 resolved from `ci.yml:30-34`: `pull_request→main` and `push→main` only. One push of both commits to the branch runs CI once, on the PR head. The red commit gets no run, so the RED transcript is local-only evidence. State that in the package.

## Credit

- **A4's "never left undefined" rule.** Correct on mechanism: unset propagates to everything (`tracePropagationTargets.js:8-11`).
- **Anchored regex with `(?:/|$)`, not a substring.** Closes the lookalike-host case. The two-port local test exercises it.
- **Sampler strict-AND failing toward 1.0.** Puts the miss on the quota side, never the privacy side.
- **C4.1 "if any A1 location doesn't fail on HEAD, stop".** Makes the whole A1 table falsifiable. It's the rule that would have caught S2 if the stand-in had been a real Next span.
- **Scan M vs Scan R in one run.** That is the proof that C6 never covered auto-instrumentation. Keep it in the package verbatim.
- **Refusing `twilioUrl()`** because it emits SID-shaped hex. Correctly tied to the C5 push-protection refusal.
- **Rev 1's stale-main error struck with a date, not rewritten.**

## Verdict

**STOP — one round short.** B1 blocks. The rest of the design is right.

**Rev 3 must contain:**
1. The two-tier classifier (B1), with the Next-shaped root/child test and its control.
2. D3 recorded again with the server `http.target` half in S1 (S1).
3. Addition #1 struck with a date, C2 #4 replaced by the `NEXT_OTEL_FETCH_DISABLED` tripwire (S2).
4. The `urlPass` flag design with the frame-plus-phone test (S3).
5. The S5 gate list written into §H.
6. D5 widened per S4.
7. N1-N6 folded in or answered.

After Rev 3 that carries these items, I expect a design GO. Merge GO then needs the RED and GREEN transcripts at their commit SHAs and the CI `headSha` equal to the PR HEAD.