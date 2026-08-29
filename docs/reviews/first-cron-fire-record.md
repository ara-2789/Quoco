# First cron fire — 2026-08-29 morning trigger — record, not a fix

**Recorded 2026-08-29.** This document records what actually happened the first time
Pass 1's outbound-send cron fired unattended in production, and a real defect surfaced
in the diagnosis process itself (a ruling-out error, corrected below, honestly, not
edited away). It is NOT a fix. Nothing in `lib/whatsapp/outbound/` or
`app/api/cron/morning-trigger/` was changed to produce this record.

## What happened, in order

`app/api/cron/morning-trigger` fired at 08:30 IST (03:00 UTC) as scheduled
(`vercel.json`'s `"0 3 * * *"` entry, live since PR #130). `runCheckpointTrigger`
resolved the one active project's morning roster to exactly one engineer — correct,
matches the known fixture state. `triggerCheckIn` claimed the `outbound_sends` row
(`event_key = 'morning_send:2026-08-29'`, `status='sending'`) and called
`sendWhatsAppTemplate`.

The Twilio POST returned an HTTP 2xx whose parsed body carried no `sid` field.
`send.ts`'s own defensive check (`send.ts:141-147`, written for exactly this class of
unexpected shape) refused to treat that as success and returned `{ ok: false }`. Back
in `trigger.ts`, that outcome is neither `429` nor `>=500`, so it fell through to the
non-retryable terminal branch: `outbound_sends` was updated to `status='failed'`, error
text `Twilio returned 2xx with no "sid" field in the response body.`, `twilio_sid`
left `NULL`. No RPC call was made — per §1's ordering, activation only ever follows a
believed-successful send. `whatsapp_sessions` for `+919176865600` was confirmed,
read-only, still exactly where it was on 2026-08-26 (`current_flow: null,
current_step: 0`) — untouched, as designed.

The 08:35 IST inbound "Hi" correctly returned `MORNING_AWAITING_TRIGGER_REPLY`,
consistent with an idle, never-activated session.

## The real cause: Twilio's own console, checked by Aravind directly

Twilio's message log for this exact send (08:31:37 IST, matching `outbound_sends
.created_at` to the second) shows:

```
Outbound API, status FAILED
Error 63015: Channel Sandbox can only send messages to phone numbers that have
joined the Sandbox
```

The sandbox join was re-sent at 08:32 IST — it lapsed by under a minute before the
cron fired.

## The ruling-out error — recorded honestly, not edited away

The first pass at this diagnosis excluded 63015 on the stated premise that it "arrives
as a 4xx" — i.e., that a rejected send would show up as a non-2xx HTTP response with
`sendResult.errorCode` populated. **That premise is wrong.** 63015 is not a
synchronous API rejection: Twilio accepts the POST, creates the message resource
(hence a real `sid` existed, per Twilio's own console record of it), and fails the
message *asynchronously* — which is exactly why Twilio's own log shows a created
message with terminal status `FAILED` rather than an HTTP error response. The
diagnosis was structurally sound (real ledger row, real code paths traced, real
session-state check) but ruled out the actual cause on a wrong assumption about how
Twilio's own API surfaces this class of failure, and did so without checking Twilio's
own message log — the one artifact that would have shown the true error immediately.
Named here so the same wrong premise isn't reused next time.

## The substantive finding: a 2xx from Twilio means ACCEPTED, not DELIVERED

This is the finding that matters beyond today's single miss. Twilio's documented
status lifecycle (`status-callback.ts`'s own header, verified against Twilio's current
docs 2026-08-28: `queued → sending → sent → delivered/read` on the happy path,
`→ undelivered/failed` on the unhappy one) means a synchronous 2xx only ever certifies
that Twilio *accepted* the request — never that the message reached anyone. Failure
can arrive later, out of band, via the `StatusCallback` POST. 63015 is evidence this
applies more broadly than the one case (`63016`, async Meta-side rejection) Pass 1's
own plan named explicitly (§1, §5) — the same "accepted-then-failed" shape also covers
a lapsed sandbox join, and plausibly other channel-level rejections neither the plan
nor this codebase has enumerated.

**Consequence for the design, checked against the actual code, not assumed:**

- `trigger.ts` writes `status='sent'` and calls `applyMorningFlowTurn`/
  `applyEveningFlowTurn(startFlow: true)` the moment Twilio's synchronous response
  parses out a `sid` — correctly reflecting "Twilio accepted it," which is all a
  synchronous 2xx ever proves.
- `coverage-sweep.ts`'s `sentCountForEventKey` counts `status='sent'` rows (`F2`,
  deliberately never a bare row count). Read in isolation, at a single point in time,
  a `'sent'` row that later fails asynchronously would read as covered.

**Whether this is a live hole was checked against the actual status-callback route
and the actual coverage-sweep scheduling, not assumed either way:**

`app/api/whatsapp/status-callback/route.ts` does move a row out of `'sent'`. Its
`classifyTwilioMessageStatus` (`status-callback.ts:74-77`) maps Twilio's
`undelivered`/`failed` statuses to `mark_failed`, and the route's own UPDATE
(`.eq('twilio_sid', messageSid).eq('status', 'sent')`) flips it to `status='failed'`
when a matching row exists. `coverage-sweep.ts` does not compute its gap once and
cache it — `runOutboundCoverageSweep` runs inside `/api/jobs/tick`, which fires every
60 seconds, all day, and `sentCountForEventKey` re-queries `outbound_sends` fresh on
every tick. Alerting is gated only on `windowClosed` (morningCutoff 15:00 / eveningClose
19:45), not on when the computation happens — so **if** the async failure callback
arrives before the checkpoint's window closes, the very next tick's coverage check
sees the post-flip count and correctly reports a gap. For today's actual scale (a
handful of hours between an 08:30/18:30 send and a 15:00/19:45 cutoff), that is a wide
margin. This mechanism is not, on inspection, structurally absent — Amendment (g)'s
own plan text already named the `'sent'→'failed'` flip as the intended closer for
exactly this shape of gap, and the code matches that intent.

**The real hole, named precisely, is not "the flip doesn't happen" — it's what the flip
depends on, and today's own incident demonstrates the dependency is not free-standing:**

The status-callback route's own header states its own assumption plainly: *"a genuine
callback for a message this system sent always has a matching row"* — because
`twilio_sid` is "only ever set by trigger.ts's own synchronous `'sent'` UPDATE." That
assumption holds only when the synchronous response's `sid` was successfully captured.
Today's own incident is a case where Twilio undisputedly created a message resource
(it has a real `sid` — Twilio's own console shows it, attached to a `FAILED` status)
and our system captured `NULL`. Had that same "sid missing from our side" failure
happened to a message that our own code read as `ok: true` in some other way (it
can't, as coded — see the next section for why this specific incident's row could
never have reached `'sent'`), or happened on any future send whose synchronous
response is malformed in a way `send.ts` doesn't yet catch, the async failure callback
for that real Twilio-side `sid` would arrive at `status-callback/route.ts`, find
**zero rows** matching `.eq('twilio_sid', messageSid)`, and fall through to the
"no matching ledger row" branch — a mere `Sentry.captureMessage(..., level: 'warning')`,
uncorrelated with the real claim row, per `route.ts`'s own "expected, not a bug, once
other send paths exist" framing (a framing written for manual/`scripts/submit-templates.ts`
sends, not for this case). **The coverage-closing mechanism is real, but it is only as
reliable as `twilio_sid` capture — and this incident is direct, not hypothetical,
evidence that capture can fail on a message Twilio genuinely accepted and later failed.**

**For today's specific row, this did NOT mask a coverage gap** — the row never reached
`'sent'` at all (see next section for why), so `sentCountForEventKey` correctly reads
0, `gap = 1` once `windowClosed`, and the coverage sweep — now live, since item E's
cron entries are what flip `isOutboundTriggerCronLive` — will alert on it. What it DID
do is orphan the real error: Twilio's own async callback for this `sid` (if Twilio
sent one, unverified — the status-callback route's own logs weren't pulled for this
record) had nothing in `outbound_sends` to attach to, so `outbound_sends.error` says
"2xx with no sid field" forever, not "63015 — Channel Sandbox... has joined the
Sandbox," even though the real cause is fully known from Twilio's own console.

**Not verified, named as a real gap in this record rather than assumed closed:** the
scenario Aravind described — a send that DOES capture `sid`, reaches `status='sent'`,
activates a real session, and THEN fails asynchronously with the flip never landing in
time or at all — has never actually been exercised end-to-end in this codebase. Today's
incident took the "no sid, straight to failed" branch instead. Whether the
`'sent'→'failed'` flip genuinely fires correctly under a real async failure remains
unverified by any real production event to date.

## Finding #2: the "2xx with no sid" cause is still unexplained, and now more consequential

Twilio's own console confirms a message resource was created for this send (it has a
`FAILED` status and a `sid`, by definition — Twilio does not display a status against
a resource it never created). That directly contradicts what our own system recorded:
a 2xx response whose body, as parsed, had no `sid`.

**Checked directly, not assumed: does the real `sid` appear anywhere in our own ledger
or logs?** No. `outbound_sends.twilio_sid` for this row is `NULL`. `send.ts`'s own
parse path (`res.json().catch(() => null)`) discards the distinction between "valid
JSON, genuinely no `sid` key" and "the parse itself threw" — both collapse to the
identical `responseBody = null` (or `responseBody` with no `sid` key), producing the
identical downstream error string either way. Neither `trigger.ts`'s Sentry capture
(fingerprint `twilio_4xx_failed`, `extra: { status, errorCode, errorMessage }` —
`errorCode` is always `undefined` on this branch, since it's only populated on the
`!res.ok` path, which this branch is not) nor the `outbound_sends` row itself carries
the raw response body or `Content-Type`. **We cannot distinguish, from anything this
system recorded, whether Twilio's synchronous body genuinely omitted `sid` (a Twilio-
side anomaly, undocumented) or whether the body had a real `sid` and our own parsing
failed to surface it (a bug on this side). The raw body was never captured, by design
of the current code, and is now unrecoverable for this specific incident.** This was
finding #3 of the original (now corrected) diagnosis; it stands, and matters more now
that it's confirmed to have also orphaned the async-failure correlation described above.

## Amendment (g)'s recorded follow-up — status, precisely

`docs/plans/pass1-outbound-send-plan.md`'s Amendment (g) recorded, as an open question,
reading "the first real Twilio error this system has ever seen" to check whether
Twilio/Meta distinguish per-second throttling from daily-tier exhaustion by error code
— framed around a `429`. **That follow-up is now satisfied, but not by a `429`.** The
first real Twilio error this system has seen is `63015` (WhatsApp sandbox join
lapsed), delivered as an accepted-then-asynchronously-failed message, not a rate limit.
It answers a different, and arguably more load-bearing, question than the one Amendment
(g) posed: not "how does Twilio signal throttling" but "does this system's synchronous/
asynchronous split actually hold up against a real accepted-then-failed message" — see
the coverage-mechanism and orphaned-callback findings above for what that check found.

## What this record does not do

No code changed. `send.ts`'s raw-body capture gap, the `twilio_sid`-dependency in the
status-callback route, and the never-yet-exercised `'sent'→'failed'` coverage flip are
all named above as open findings, not fixed here — any fix belongs to its own change,
reviewed on its own terms, same discipline as `service-role-table-grants-gap.md` and
every other finding-not-fix record in this directory.

## Standing operational note — the sandbox join expires; check it first

**The Twilio WhatsApp Sandbox join expires** (Twilio's own docs: three days after the
recipient last joined). A lapsed join produces error 63015 as an **asynchronous**
failure on a message Twilio already accepted — it is invisible in the synchronous API
response (the send call still returns 2xx; today's own `sid`-capture bug aside, a clean
2xx-with-sid response gives no hint the message is about to fail), and visible only in
Twilio's own console message log or via the `StatusCallback` POST to
`app/api/whatsapp/status-callback`. **Any morning where the trigger appears to have
done nothing — no message received, no obvious error surfaced to a human — should check
the sandbox join status FIRST**, before assuming a code-level failure: re-send `join
<sandbox-code>` from the recipient's phone, then confirm in Twilio's console that the
join is currently active, before spending time in this codebase's own logs.

This entire failure class — and this note — **stops applying once the production WABA
sender is wired** (`docs/twilio-sender-swap-runbook.md`; the registered sender
`+919940875600` already exists per CLAUDE.md §8's provider-console finding, 2026-08-21).
A production sender has no join/expiry concept; 63015 is specific to the sandbox. This
incident is one more concrete reason to prioritize that swap, beyond the reasons already
recorded in the runbook itself — it is not just a config inconvenience, it is a standing,
recurring, silent failure mode for every unattended cron send until the swap happens.

## Dated observation, 2026-08-29 — the idempotency gate, exercised for real for the first time

Aravind manually triggered `app/api/cron/morning-trigger` via Vercel's Run button, hours
after the original 08:31 IST failure, with `morning_send:2026-08-29` already claimed at
`status='failed'`. This is the first time the `UNIQUE(tenant_id, recipient_user_id,
event_key)` claim guarantee — and the re-claim CAS's refusal to touch a non-`'sending'`
row — has ever been exercised against a real prior claim rather than a test fixture.
Checked from data, read-only, against production, not from the absence of a WhatsApp
message:

- **`outbound_sends`**: still exactly one row for `morning_send:2026-08-29`.
  `created_at`/`updated_at` both byte-identical to the original 08:31:37 IST claim
  (`03:01:37.064936+00` / `03:01:37.385+00`). No second row, no touched timestamp.
- **Twilio's own message log** (queried directly, read-only, via the Messages list API —
  credentials read from env and never printed; response saved to a file and only
  structural fields extracted, body content tested for known phrases rather than
  printed): the most recent entry for `+919176865600` before the manual run was the
  03:05:36 UTC `MORNING_AWAITING_TRIGGER_REPLY` acknowledgement (already accounted for
  in this record's own "What happened" section, not new). Nothing exists between then
  and the check itself (04:24 UTC, roughly 79 minutes later, spanning the manual run).
  No new Twilio API call was made.
- **`whatsapp_sessions`** for `+919176865600`: unchanged, `current_flow: null,
  current_step: 0`, `updated_at` still 2026-08-26. No activation.
- **The route's actual response / Vercel's invocation log were not read** — this
  environment has no Vercel CLI or dashboard access. The verdict below rests on the
  three data points above (all only possible if the code returned `already_claimed`
  before any Twilio call, per `trigger.ts`'s own control flow), not on a log read; that
  distinction is worth keeping precise rather than papering over.

**Verdict: the idempotency gate behaved exactly as designed.** The claim INSERT hit the
UNIQUE constraint, the re-claim CAS correctly refused a `status='failed'` row (it only
ever matches `status='sending' AND error='rate_limited_429_retryable'`), and the run
resolved to `already_claimed` with zero side effects — no duplicate row, no second
Twilio call, no session mutation. First real-world exercise of this guarantee; it held.

## Dated correction, 2026-08-29 — the real cause of "Finding #2," found the same day

**This corrects "Finding #2" above (the "2xx with no sid" cause is still unexplained")
— not by editing it away, same discipline this file already applied to its own
ruling-out error.** Finding #2 was half right: it correctly stated the raw body was
never captured and was therefore unrecoverable for the specific 08:31 IST incident. It
was wrong to leave the underlying cause as an open question, because the cause is not
incident-specific at all — it is structural, and it predates both this morning's and
tonight's failures.

**The actual cause: `send.ts`'s request URL never asked Twilio for JSON.** Twilio's
classic 2010 API (`api.twilio.com/2010-04-01/...`) returns XML **by default** —
confirmed against Twilio's own current docs (`twilio.com/docs/usage/twilios-response`:
"Twilio 2010 APIs... return XML responses by default"), not memory. JSON is requested
by appending `.json` to the resource URI — the mechanism Twilio's own docs describe.
`send.ts`'s URL was `.../Messages`, with no `.json` suffix and no `Accept` header. Every
POST this file has ever made has therefore received XML back, and every attempt to
`JSON.parse` (or, pre-PR #135, `res.json()`) that body has failed.

**Re-reading this morning's failure under this cause: both original claims were true,
and the record's own "unexplained" framing was the only part that was wrong.** The 63015
async rejection was real (Twilio's own console confirmed it). The parse failure was also
real — but it was never a Twilio-side anomaly or a bug of unknown origin; it was
`JSON.parse` choking on XML, deterministically, on every call. Before PR #135's response-
shape capture, `res.json().catch(() => null)` could not distinguish "valid JSON, no
`sid` key" from "the parse itself threw" — both collapsed into the identical `null`, so
the original record could not have told these apart even if it had gone looking. That
ambiguity is exactly what made the cause look unexplained; it was never actually
unknowable, only unobserved until the capture existed to show it.

**One root cause explains 100% of this system's real send failures to date, and it
predates both incidents.** Checked directly on production, not inferred: `outbound_sends`
has **never once held a `status='sent'` row** — the only two rows in the table's
history, this morning's and tonight's, are both `status='failed'`. Every real trigger
this system has fired has hit this. Consequence, stated plainly rather than left
implicit: the status-callback correlation (`app/api/whatsapp/status-callback/route.ts`,
matching on `twilio_sid`) has never had a row to correlate against, because no row has
ever captured a real `twilio_sid`. Item F's coverage sweep (`sentCountForEventKey`,
counting `status='sent'` rows) has never counted a real delivery, because there has
never been one to count. Both mechanisms are exactly as this record's earlier sections
described their design and logic to be — untouched, correctly written — but **neither
has ever actually executed against a real success path.** "Believed working" and
"exercised" are not the same claim, and this record's earlier sections, written before
this correction, did not distinguish them as carefully as they should have.

**The methodological finding — the durable one, more than the bug itself.** Every test
in `test/unit/outbound-send.test.ts` mocks `fetch`; the response in every one of those
tests is a fixture this codebase wrote itself, never a real Twilio response. A green
suite there — across four review rounds (031's own review history) and one external
review (CLAUDE.md §0's gate, tripped by the ledger table's own grants) — could not have
caught this, structurally, no matter how thorough: the fixture IS the definition of what
the test believes the real API does, so a wrong belief about the real API's default
representation is invisible to any test built entirely on that belief. **Same class of
finding as `docs/reviews/sandbox-cannot-test-concurrency.md`** — that document found this
sandbox cannot produce genuine RPC concurrency against test-db, so a local green run for
a concurrency-dependent test proves nothing about the real mechanism; this one finds the
unit-test suite cannot produce a genuine Twilio response, so a green run there proves
something narrower than "this correctly talks to Twilio" — only "this correctly handles
whatever shape of response we told it to expect." Both are instances of the same
underlying limit: **the environment available to write and run a test is not always
capable of producing the actual condition the test is meant to verify, and a green
result under that limit is not the same evidence it would be otherwise.** Cross-
referenced deliberately, not coincidentally similar — the next time a test suite goes
green across multiple review rounds without incident, "did anything in this suite ever
touch the real thing" is the question this pairing exists to prompt.

**Fix applied same day**, `lib/whatsapp/outbound/send.ts`: `.json` appended to the
Messages URL. A new test (`test/unit/outbound-send.test.ts`) asserts the request URL
itself ends in `.json` — the one thing a mocked-`fetch` test can verify honestly, since
it tests what this code SENDS, not what it receives. Verification beyond the test suite
requires a real send; see the operational checklist recorded alongside this fix's own
PR for what to observe on the next trigger.
