# Webhook wiring — `dispatchInboundTurn`, client injection, T-WH harness — review package

Migration 022's review package (§10) named a deliverable it deliberately did
not build: wiring the webhook to actually call `apply_evening_flow_turn`,
implementing the `wrong_flow` retry contract the migration's own header
specifies. This PR is that deliverable — plus everything that turned out to
be a prerequisite for testing it, and two debt-register entries in CLAUDE.md
that record what was found along the way.

Unlike every prior package in this series (017/019/020/021/022), **this PR
touches no migration and no schema.** It is application code only:

- `lib/whatsapp/dispatch.ts` (new) — the retry-contract dispatcher
- `lib/whatsapp/session.ts` — `readCurrentFlow` (new)
- `lib/whatsapp/flows/morning.ts`, `lib/whatsapp/flows/evening.ts` — injected
  `supabaseClient` param added to `applyMorningFlowTurn` /
  `applyEveningFlowTurn`
- `lib/whatsapp/idempotency.ts` — injected `supabaseClient` param added to
  `isNewMessage`
- `app/api/whatsapp/webhook/route.ts` — `POST`'s body extracted into
  `handleWebhookPost(request, deps)`; the ordinary-reply path now calls
  `dispatchInboundTurn`
- `test/unit/dispatch.test.ts` (new) — static source guard
- `test/dispatch.test.ts` (new) — retry-contract behavior against real test-db
- `test/webhook.test.ts` (new) — the T-WH HTTP harness
- `CLAUDE.md` — TESTING DEBT closeout + a candidate-CI-check debt entry

Commits: `8a24399` (implementation), `0a16d82` (TESTING DEBT closeout),
`980049c` (candidate CI check). All three on `feat/022-evening-flow-apply-turn`.

---

## Provenance / pinning

Per CLAUDE.md §0 — artifacts are pinned to source, never paraphrased.

| Artifact | Pin |
|---|---|
| Commit (HEAD, this package) | `980049c13be50a526899afdff4e71726e13c0d98` |
| Branch | `feat/022-evening-flow-apply-turn` |
| `git status --porcelain` at that commit | `''` (empty — clean tree) |
| `lib/whatsapp/dispatch.ts` | sha256 `9f76f0e7826fb7f38a1d0edbf01b787133bd0ac6cef057a33018fec477146f42` |
| `lib/whatsapp/session.ts` | sha256 `f38262425eadc26ec4c7964a50cf16befa0e9b4becb9462df61fe73c6caed1ad` |
| `lib/whatsapp/flows/morning.ts` | sha256 `9b1eb66ee89b0b93d02b66e3ad5c09702c01445cc678ef47f1176f59f592718a` |
| `lib/whatsapp/flows/evening.ts` | sha256 `00d615992c5705aeb490fdf4cfa1fdcc8e6041f943b09d5192da58ea8b2f2ff3` |
| `lib/whatsapp/idempotency.ts` | sha256 `f143ef74bfa3a81a2df5b4cd034182570776a6b2b34049bb6ad77a9beafa99c2` |
| `app/api/whatsapp/webhook/route.ts` | sha256 `ad5a32e296553260eb42730d7989017c1b84efed078a5df5a2ea62a137c46795` |
| `test/unit/dispatch.test.ts` | sha256 `dd840358dd2a694d57a20d2c880f610adcb6a4683b7bdef9a8fa418a9add863e` |
| `test/dispatch.test.ts` | sha256 `cc4f32f0f8b54c58885e70f7de53addf50dcc9db5cc271ea7febc2f6ad3d1259` |
| `test/webhook.test.ts` | sha256 `b9e478bfd50e8f904b6c7a458d3ed59e783be23a62f9ba942463db761579ab80` |
| `CLAUDE.md` | sha256 `c1a50beaa7ac04460a83d5a6939f470dc11c23a528b1d5338f4cfedf66aa1ac5` |

Each hash computed individually — filename and hash printed on the same
line, never reassembled from a batch — per the discipline 022's package
adopted after an earlier mislabelling (022-review-package.md, Provenance
section).

**RAW-CAPTURE STATUS — simpler than 022's, and that's a real difference, not
an oversight.** 022 mixed a manual SQL Editor rehearsal (narrative-confirmed)
with literal captures, because a rehearsal step existed to grade in the first
place. This PR has no interactive rehearsal step — it is deterministic
application code with an automated test suite, so:

- **§5 (automated test evidence) — LITERAL.** Re-run directly against the
  pinned commit above while drafting this package; output captured unedited.
- **§4 (no-divergence proof) and the evening-reachability grep in §6 —
  LITERAL.** Commands and their exit codes shown directly.
- **§2, §3 (why the dispatcher's shape and the client-injection blocker are
  what they are) — NARRATIVE, reviewer-and-owner-confirmed across the build.**
  The reasoning is real and was worked through turn-by-turn earlier in this
  session, but the earliest step (injecting the first four functions) predates
  a context-compaction boundary in that session, so its exact historical
  terminal output cannot be re-pasted verbatim here — only its outcome is
  cited (233/22 tests passing at that point, per the session's own summary of
  itself). Every full-suite count from `test/dispatch.test.ts` onward
  (239/239, then 239/239 again post-injection, then 249/249 final) was
  captured live in-session and is reproduced faithfully in §5, not
  reconstructed from memory.

---

## 1. What this PR is — five pieces, none incidental

A reviewer looking at a 10-file, 3-commit diff with no migration attached
should be able to see why each piece exists before reading a single line of
implementation:

1. **`dispatch.ts` exists because 022 named it, in writing, as an unbuilt
   deliverable with a specified contract.** Not a new idea — §2 quotes that
   contract verbatim and shows where each numbered step is implemented.
2. **Client injection across six functions exists because the harness could
   not run without it — not because it is a nicer pattern.** §3 shows
   exactly what broke and why.
3. **The `route.ts` extraction exists so the harness tests the SAME function
   body `POST` calls, not a parallel assembly.** §4 states and proves that
   property directly — push on it here if it doesn't hold.
4. **The T-WH harness exists to close a debt this repo deferred twice** —
   once at BOT-27, once explicitly in 022's own review. §5 shows the named
   RETRY-AFTER-CLEAR test (T-WH-07) is actually in it, not just the harness
   shell.
5. **The two CLAUDE.md entries exist because closing #4 both resolved a
   tracked debt item and surfaced a new one** (the six-function pattern in
   #2 recurring silently until something tried to test it) — §8 covers both.

---

## 2. `dispatch.ts` — implementing 022's own named contract

Quoted verbatim, not paraphrased — `supabase/migrations/022_evening_flow_apply_turn.sql:72-73`:

> `-- 'wrong_flow' is a distinct outcome the webhook answers by calling the OTHER`
> `-- rpc exactly once. Bounded by construction: one retry, never a loop.`

And the fuller specification 022's own review package wrote down as the
"webhook-wiring — named future deliverable" (`022-review-package.md`, §10):

> 1. Call the RPC matching the currently-known `current_flow` (or morning, if
>    idle/unknown).
> 2. If the result is `'wrong_flow'`, call the **other** RPC exactly once.
> 3. **The edge that was previously undefined, now specified:** if that
>    second call **also** returns `'wrong_flow'`, the flow genuinely moved
>    twice within the span of one turn … Reply with a fixed message … and
>    **stop** — never a third call, never throw, never silence.

`dispatchInboundTurn` (`lib/whatsapp/dispatch.ts:142-174`) implements exactly
these three steps: `readCurrentFlow` resolves step 1's "currently-known
current_flow (or morning, if idle/unknown)" (`dispatch.ts:151-158`); a single
`if (first.outcome !== 'wrong_flow') { return … }` / retry against
`secondFlow` implements step 2, with the retry structurally bounded — no
loop, `attempt()` is called at most twice in the function body; step 3's
"reply with a fixed message and stop" is `FLOW_RACE_REPLY`
(`dispatch.ts:37-38`), returned only when the second call also returns
`wrong_flow`.

---

## 3. Client injection — a blocker discovered, not a preference chosen

`vitest.config.ts` loads **only** `.env.test`, by design (its own comment:
*"the production service key that lives in `.env.local` is therefore never
read into scope during a test run"*). `createServiceClient()`
(`lib/supabase/service.ts`) reads `NEXT_PUBLIC_SUPABASE_URL!` /
`SUPABASE_SERVICE_ROLE_KEY!` — non-null-asserted, undefined in that
environment by construction.

Six functions in the inbound path each independently called
`createServiceClient()` internally: `readCurrentFlow`, `applyMorningFlowTurn`,
`applyEveningFlowTurn`, `dispatchInboundTurn` (indirectly, through the first
three), `isNewMessage`, and `handleWebhookPost` itself. Every one of them was
**structurally unreachable from a test** until it accepted an injected client
— not a style question, a hard `undefined!` at runtime. Confirmed all six
now carry the parameter:

```
$ grep -n "supabaseClient?: SupabaseClient" lib/whatsapp/session.ts lib/whatsapp/flows/morning.ts lib/whatsapp/flows/evening.ts lib/whatsapp/idempotency.ts lib/whatsapp/dispatch.ts app/api/whatsapp/webhook/route.ts
lib/whatsapp/session.ts:51:  supabaseClient?: SupabaseClient,
lib/whatsapp/flows/morning.ts:277:  supabaseClient?: SupabaseClient
lib/whatsapp/flows/evening.ts:262:  supabaseClient?: SupabaseClient
lib/whatsapp/idempotency.ts:20:  supabaseClient?: SupabaseClient,
lib/whatsapp/dispatch.ts:62:  supabaseClient?: SupabaseClient
app/api/whatsapp/webhook/route.ts:120:  deps: { supabaseClient?: SupabaseClient } = {},
```

The fix pattern was not invented for this PR: `clearMessagingBlock`
(`lib/whatsapp/reactivation.ts`) already took its client as a parameter,
shipped well before any of the six above were touched. Every injection here
is additive — `supabaseClient?: SupabaseClient` defaulting to
`createServiceClient()` when omitted, so today's production behavior is
unchanged, confirmed by full-suite green-to-green at each step (§5) — **not
all of equal weight, the same distinction the RAW-CAPTURE STATUS note above
makes and this claim should not quietly outrun.** The first step's 233/22
count is summary-sourced — this session's own account of itself, predating a
context-compaction boundary, not a re-pasteable frame. Every count from
239/239 onward (post-`dispatch.test.ts`, post-injection, and the 249/249
final) is a captured terminal frame, reproduced as such in §5. A
summary-sourced number is weaker evidence than a frame, the same principle
022's package applied at its §6.1 (a round it ran but never narrated a
result for, stated as absent rather than filled in); saying so here costs
nothing, and letting this sentence read as uniformly proven would cost more
than the caveat does. This is also the origin of the CLAUDE.md
candidate-CI-check entry in §8: the pattern existed one directory away and
still wasn't applied consistently, because nothing forced it until testing
exposed the gap — by which point it was a six-function refactor instead of a
one-line addition.

---

## 4. `route.ts` extraction — the no-divergence property, stated and shown

The whole value of an HTTP harness depends on one property: the harness must
exercise the same code `POST` actually runs, not a parallel assembly that
could quietly drift from it. That property is not just claimed here — it's
structural. `POST`'s entire body, as of this commit:

```
$ git show 980049c:app/api/whatsapp/webhook/route.ts | tail -4

export async function POST(request: NextRequest) {
  return handleWebhookPost(request)
}
```

`POST` calls `handleWebhookPost` with **zero** arguments beyond `request` —
no test-only branch, no second implementation. `deps.supabaseClient` is the
only thing that differs between production (`undefined` → falls through to
`createServiceClient()`) and the harness (`testClient()`). If a reviewer
wants to falsify the no-divergence claim, this four-line tail is the entire
surface to check — there is nowhere else for a second path to hide.

---

## 5. Automated test evidence — LITERAL

**10 new webhook-level tests, 6 new dispatch-level tests, 1 static guard —
17 new, zero regressions.**

```
✓ test/dispatch.test.ts (6 tests)
   ✓ no session (idle) — defaults to morning, no override needed
   ✓ session mid-morning, no override — readCurrentFlow correctly picks morning
   ✓ session mid-evening, no override — readCurrentFlow correctly picks evening
   ✓ retry direction A — firstFlow forces a genuine morning wrong_flow, evening resolves it
   ✓ retry direction B — firstFlow forces a genuine evening wrong_flow, morning resolves it
   ✓ double wrong_flow — the flow moves TWICE; onBeforeRetry is what this edge actually needs

✓ test/unit/dispatch.test.ts (1 test)
   ✓ route.ts contains no reference to onBeforeRetry

✓ test/webhook.test.ts (10 tests)
   ✓ T-WH-01: a non-matching signature is rejected with 403 (algorithm proof only)
   ✓ T-WH-02: a missing X-Twilio-Signature header is rejected with 403
   ✓ T-WH-03: unregistered number gets the BOT-08 response, zero storage footprint
   ✓ T-WH-04: gated_noop (pending status) is a silent no-op, zero storage footprint
   ✓ T-WH-05: gated_noop (deactivated status) is a silent no-op, zero storage footprint
   ✓ T-WH-06: no project membership gets an actionable message (SID still consumed)
   ✓ T-WH-07: reactivate clears the block, then a RETRY of the SAME MessageSid is a no-op
   ✓ T-WH-08: a duplicate MessageSid on an ordinary reply is a no-op, no double-write
   ✓ T-WH-09: an ordinary reply on an active morning session reaches morning
   ✓ T-WH-10: an ordinary reply on an active evening session reaches evening
```

T-WH-07 is the RETRY-AFTER-CLEAR test CLAUDE.md's TESTING DEBT entry named
verbatim at the 2026-07-21 deferral (*"a ROUTE-LEVEL test proving
RETRY-AFTER-CLEAR cannot fall into the morning flow"*) and left unbuilt for
two deferrals. It is the one test in this package that closes a specific,
previously-named gap rather than adding new coverage — see CLAUDE.md's §10
closure note for the full mapping.

**Full suite, pinned:**

```
=== PINNED SUITE RUN — webhook wiring ===
commit:    980049c13be50a526899afdff4e71726e13c0d98
branch:    feat/022-evening-flow-apply-turn
porcelain: ''  <- empty between quotes = clean tree
date:      2026-08-07
==========================================
 Test Files  24 passed (24)
      Tests  249 passed (249)
   Duration  151.47s
```

232 → 249 is exactly this PR's 17 new tests (1 static guard +
6 `dispatch.test.ts` + 10 `webhook.test.ts`), zero regressions — and the
file count matches the same way: 21 → 24 is exactly the 3 new test files.
Both counts were confirmed green-to-green at every intermediate step
(guard test, then `dispatch.test.ts`, then the client-injection step with
zero new tests, then `webhook.test.ts`), not just at this final pin.

`tsc --noEmit`: clean, exit 0.

**Evening reachability — grep, LITERAL, resolves a claim from 022's package
that is now stale.** 022's package (§10) stated flatly: *"the webhook
contains zero calls to `apply_evening_flow_turn`… the code path to start or
advance an evening flow via the deployed webhook does not exist yet."* That
is no longer true for one half of it:

```
$ grep -rn "applyEveningFlowTurn\|apply_evening_flow_turn" app/ lib/ --include="*.ts" | grep -v "/test"
app/api/whatsapp/webhook/route.ts:111: * applyEveningFlowTurn / dispatchInboundTurn (lib/whatsapp/{session,
lib/whatsapp/dispatch.ts:5:import { applyEveningFlowTurn, buildEveningReply } from './flows/evening'
lib/whatsapp/dispatch.ts:118:  const result = await applyEveningFlowTurn({

$ grep -rn "startFlow: true\|startFlow:true" app/ lib/ --include="*.ts" | grep -v "/test"
app/api/whatsapp/webhook/route.ts:288:      startFlow: true,
```

`applyEveningFlowTurn` now has exactly one real caller (`dispatch.ts`'s
`attempt()`), always with `startFlow: false`. The only `startFlow: true`
anywhere outside tests is `route.ts:288`, inside the test-only sentinel
branch, and it calls `applyMorningFlowTurn` — never evening. See §6 for what
this means in practice.

---

## 6. What this changes for evening — reachable, still not startable

It would be a reasonable but wrong reading of "webhook wiring landed" to
assume evening now works end to end through WhatsApp. It doesn't, and this
section exists so that assumption doesn't survive past this paragraph.

**What changed:** if a session's `current_flow` were ever `'evening'`, an
ordinary inbound reply through the real webhook would now correctly advance
it (T-WH-10 proves this against real test-db over real HTTP). Before this
PR, that code path did not exist — `route.ts` called `applyMorningFlowTurn`
unconditionally, so an evening session was invisible to the real webhook no
matter what state the database held.

**What didn't change:** nothing anywhere in `app/` or `lib/` sets
`current_flow = 'evening'` in the first place (§5's grep — the only
`startFlow: true` reaches morning). Evening was deliberately scoped out of
this PR at the plan stage ("Evening stays unstartable here — replies only");
`dispatch.ts`'s own header repeats the same boundary ("starting a flow is a
separate, explicit directive"). So on production today, `current_flow` still
can never become `'evening'` — not because the read/retry path is missing
(it isn't, anymore) but because no write path to create that state exists
yet. The distinction is: evening is now *reachable* through the real
webhook, but still not *startable* through it. Whoever builds an evening
starter (a cron, or a webhook-side trigger) is the PR that actually makes
`apply_evening_flow_turn` live on prod for the first time — this one only
makes sure that PR's inbound replies will route correctly once it does.

---

## 7. Explicitly out of scope / not proven

Recorded so none of these reads as an oversight, matching 022's own
precedent for this section.

- **T-WH-01's exact claim, restated once more because it is easy to
  overread.** `.env.test`'s `TWILIO_AUTH_TOKEN` is a fixed, obviously-fake
  value. T-WH-01 proves `validateTwilioSignature`'s HMAC-SHA1 comparison
  correctly *rejects a non-matching signature* — the algorithm is wired
  correctly. It does **not** prove production's real Vercel-configured
  `TWILIO_AUTH_TOKEN` is itself correct; that is a separate, unverified claim
  this package does not make.
- **No prod, no migration, no schema change — stated plainly, not left to be
  inferred from an absent runbook.** Every prior package in this series
  (017/019/020/021/022) carried a prod-apply runbook because each shipped a
  migration. This PR has none: `git diff --stat babeb48 980049c` touches no
  file under `supabase/migrations/`. There is nothing to apply, no rollback
  plan needed, no PITR window to observe. This package has no runbook
  section anywhere in it, by design, not by omission — see the Summary (§8)
  Prod status row.
- **022's step E — real webhook-triggered `service_role` proof for evening —
  is UNBLOCKED by this PR, but still not done.** 022's package (§10) flagged
  this as genuinely open, "blocked on the webhook-wiring deliverable." That
  deliverable is this PR, so the blocker is gone — but nothing on prod can
  exercise it yet, because (§6) nothing can start an evening flow on prod.
  This stays open until an evening-starter PR lands, at which point it
  becomes reachable the same way `apply_morning_flow_turn`'s equivalent proof
  was closed (`020-review-package.md` §8 Step 6).
- **Restart-semantics decision (`design-decisions-beta-feedback.md` §10,
  DECIDE-BEFORE-CRON-PR)** — unchanged by this PR, still open, still assigned
  to whoever builds the cron/starter PR.
- **The double-`wrong_flow` edge (T-WH's sibling in `test/dispatch.test.ts`)
  is deliberately not re-tested at the HTTP layer.** `test/webhook.test.ts`'s
  own header states this explicitly: retry-logic edge cases are
  `dispatch.test.ts`'s job; `webhook.test.ts` proves the wiring reaches
  `dispatchInboundTurn` and routes correctly, not that the retry contract
  itself is correct — testing the same logic twice at two layers would not
  add confidence.
- **Candidate CI check captured, not built.** CLAUDE.md §10 now records "no
  `createServiceClient()` where an injected client could be accepted" as a
  candidate for the process-hardening work order's P2 (CI gates), stage 1 —
  explicitly framed as *not* a hand-followed rule, since writing it as prose
  for a human to self-apply would be the exact honour-system gap P2 exists to
  close. The work order itself is not committed to this repo (confirmed by
  search — the only trace is `015-review-package.md` §7, which describes it
  as an external audit).

---

## 8. Summary

| | |
|---|---|
| Risk | Low — application code only, no migration, no schema change, no new prod-reachable behavior (§6: evening still unstartable) |
| Reversibility | Trivial — revert the 3 commits; no data-mutating statement anywhere in the diff |
| Evidence | 17 new tests, all LITERAL (§5); no-divergence proof by direct inspection of `POST`'s 4-line body (§4); evening-reachability claim re-derived by grep, correcting 022's now-stale statement (§5) |
| Client injection | Structural blocker, not a preference — six functions, all confirmed by grep (§3); additive-only, green-to-green at every step |
| Debt closed | CLAUDE.md TESTING DEBT — WEBHOOK HTTP HARNESS, including the specifically-named RETRY-AFTER-CLEAR test (T-WH-07) |
| Debt opened (captured, not built) | CANDIDATE CI CHECK — no `createServiceClient()` where injectable, CLAUDE.md §10, explicitly scoped to P2 stage 1, not a standing rule |
| Evening status | Reachable via the real webhook for the first time (ordinary replies only) — still not startable; no write path to `current_flow = 'evening'` exists on prod (§6) |
| Prod status | **Not applicable.** No migration, no prod apply, no runbook — this PR is application code that will ship the next time this branch merges and deploys |
| Test suite | 249/249, zero regressions, pinned to commit `980049c` |
| `tsc --noEmit` | Clean |
| Still open, tracked elsewhere | 022's step E (real webhook-triggered evening proof) — unblocked, not done; restart semantics (`design-decisions-beta-feedback.md` §10); evening-starter deliverable itself |
