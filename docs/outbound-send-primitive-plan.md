# PLAN ONLY — the outbound WhatsApp send primitive (2026-08-15)

**Status: PLAN ONLY. No implementation. No migration. No code touched.** Part 3 of
tonight's session (Part 1: PR #66/#68, MVP schedule freeze; Part 2: PR #67, two-stage DPR
delivery/versioning). This is the precondition for the product functioning at all — as of
tonight's diagnosis, no production mechanism starts a check-in in either flow, so nothing
downstream (parsers, the per-engineer DPR pipeline, the escalation queue) can ever run.

**Read in full before writing this:** `lib/checkin-escalations/reachability.ts`,
`lib/whatsapp/{dispatch,idempotency,normalise,reactivation,session}.ts`,
`lib/whatsapp/flows/{morning,evening,test-trigger}.ts`, `lib/daily-logs/cutoffs.ts`.

**REVISION 2 (2026-08-15) — review round 1 came back STOP on both this plan and #67's,
iterate together, nothing reopens skip-and-record or the history table. This revision
resolves: the Meta pricing fact-check and the always-template weighing it triggers (§0
below, renumbered ahead of 3a since it reshapes 3a-3f); B1-B4; the roster/ledger items
(S); the corrected §0(a) reading; and the cross-plan entanglement with #67. Diff is against
commit `1c1b678`.**

---

## 0. THE META PRICING FACT — verified as far as tooling allows, and what it changes

**Claim to check:** utility templates delivered in-window, and free-form/service messages
sent in-window, are free TODAY but stop being free on **1 October 2026** — the same date
free-form loses its exemption, at the same per-message rate as templates. Authentication
templates were never free in-window at all.

**What I could confirm directly against Meta's own documentation, and what I could not —
stated precisely, not glossed over:**

- Fetched `developers.facebook.com/documentation/business-messaging/whatsapp/pricing` and
  `developers.facebook.com/docs/whatsapp/pricing` directly, twice, with targeted prompts.
  **Both current pages state "Utility template messages sent within an open customer
  service window are free," with no end date, and no mention of the October 2026 change.**
  The changelog page (`.../whatsapp/changelog`) returned a server error on fetch.
- **I could not pin Meta's own primary-source page confirming the specific October 1, 2026
  change, despite three separate direct attempts against their live documentation.** This
  may mean the docs genuinely haven't been updated yet for a change six weeks out, or that
  the confirmation lives in a channel this session can't reach (WhatsApp Manager
  account-level notices, a partner-only communication) rather than the public docs — I
  cannot distinguish those from here, and I am not asserting which.
- **Independent corroboration is strong, specific, and consistent, but it is third-party**
  (multiple WhatsApp Business Solution Provider companies — Wati, SendPulse, GREEN-API,
  Nordflux, and others — a class of company with a direct commercial incentive to get their
  own customers' billing right, which makes fabrication or casual error less likely than
  for a random blog, but does not make them a primary source). Every source agrees on: the
  1 October 2026 effective date, the mechanism (service messages and in-window utility
  templates both become billable at the template rate, no volume discount for service
  messages), Meta announcing the change 1 July 2026, and final per-market rates due by 1
  September 2026. This is also consistent with, and embedded in, independently-reported
  context (Meta's Conversations conference 3 June 2026, Meta Business Agent Platform
  launching 1 July 2026, token billing for that separate product starting 1 August 2026) —
  a coherent, dated 2026 timeline, not an isolated claim.
- **Not resolved to the bar asked for.** Recording the gap rather than pretending the bar
  was met: pin Meta's own documentation once it's visible from an account with WhatsApp
  Manager access (Aravind's own account-level notices are the most likely place this shows
  up first, ahead of generic public docs) before treating this as fully confirmed. Until
  then, everything below is written **conditionally** — "if this holds" — not as settled
  fact.

### Weighing always-template against the recommendation, on the record, not by default

**If the fact holds, always-template becomes strictly cost-neutral against hybrid after 1
October 2026** — the reviewer's framing is right that far. But "one send shape" undersells
what always-template actually costs this specific product, checked against the real flow
shape rather than assumed away:

- **Q5 is structurally incompatible with a template.** Migration 024's own header:
  "Q5's prompt is data-driven... unlike every other step's static text" — the actual
  equipment list asked about varies per engineer per day (`equipment_echo`). A WhatsApp
  template has a fixed number of named variable slots, approved in advance; it cannot
  express "list of N items, N varying by day." This is not a preference to weigh, it's a
  hard technical blocker for that one step, template or no.
- **The owner-send is a harder blocker than "loses dynamic content."** `docs/
  dpr-engineer-report-spec.md` §8 ("WhatsApp is the delivery surface") already commits to
  the OWNER receiving the actual formatted report inline via WhatsApp — its own reasoning
  ("the inline `|` form rather than aligned columns, which collapse on mobile") only makes
  sense if real report content is what's being sent, not a link. A variable-length,
  multi-line report body cannot be a template body at all (fixed structure, per-parameter
  character limits) — under a naive "always-template, no exceptions" reading, the
  owner-send becomes impossible to build, not merely more expensive. This is a real
  finding beyond what was asked, surfaced because the entanglement section (below) can't be
  written honestly without it.

**Recommendation: neither the original hybrid (as designed, still exposed to B1/B4) nor
unscoped always-template. A narrower, correctly-scoped position beats both on stated
grounds:**

**Always-template for the four/five OUTBOUND-INITIATED trigger sends specifically**
(`morningSend`, `morningNudge`, `eveningSend`, `eveningNudge`, and — pending §8's own
content-shape question, see the entanglement section — `eveningClose`'s PM-notify).
**Free-form stays, and is safe, for every IN-FLOW reply** (Q2 through Q6, `already_complete`,
`reask`) because those are always sent in direct response to a message the engineer just
sent — the window is open by construction, no reachability check ever needed, no race to
have. **This scoped version achieves the reviewer's own stated payoff in full, not
partially:** B1 and the 63016 async-failure class only ever existed for outbound-INITIATED
sends in the first place (an in-flow reply was never exposed to the reachability race,
since it's triggered by the inbound that just re-opened the window) — so scoping
always-template to trigger sends deletes B1 and 63016-for-trigger-sends completely, at zero
cost to Q5 (an in-flow step, never a trigger send) and without needing to solve the
owner-send's content-shape problem as a precondition.

**Why this beats unscoped always-template on stated grounds, not by default:** (1) Q5's
data-driven prompt is a hard technical blocker unscoped always-template cannot clear
without redesigning that question entirely; (2) the owner-send's existing committed design
(§8, full inline content) is a prior decision this workstream shouldn't silently overrule
by adopting a policy that makes it unbuildable; (3) the reviewer's own promised benefit —
deleting B1, deleting 63016 — is achieved in full by the scoped version, so paying the
wider cost buys nothing additional on the one metric the argument for always-template was
actually made on.

**This changes B1, B3, and 3b below — each is revised in place, not left describing the
unscoped design.**

---

## 3a. The primitive — one function, and the six events collapse to one shape

**The six scheduled events are not six senders.** Of the six checkpoints in the frozen
schedule (`morningSend`, `morningNudge`, `morningEscalate`, `eveningSend`, `eveningNudge`,
`eveningClose`/`ownerSend`), **`morningEscalate` sends nothing** (dashboard-only, confirmed
in `bot-flows.md`: "NOT a WhatsApp push"). That leaves five real sends, and four of them —
`morningSend`, `morningNudge`, `eveningSend`, `eveningNudge` — are, mechanically, the exact
same call: `applyMorningFlowTurn` / `applyEveningFlowTurn` with `startFlow: true, message:
''`, exactly the shape `test-trigger.ts`'s env-gated sentinel already uses today. The RPC's
own branching (Part 1, §10, DECIDED) already produces the right outcome for every session
state without the caller needing to know which of "send" or "nudge" it's doing:

- `current_flow IS NULL`, not submitted → `'start'` (Q1 goes out) — correct for the FIRST
  send of the day.
- `current_flow` already active (mid-flow) → `'reask'` (current question re-sent) —
  correct for a NUDGE to someone stuck mid-flow. Already built, confirmed in the RPC
  source (Part 1's own restart-semantics review).
- `current_flow IS NULL`, already submitted → once refuse-when-submitted ships (Part 1,
  not yet built), `'already_complete'` and nothing is sent — correct: no message needed.

**This is Part 1 §10's "six events, one mechanism" made concrete.** The check-in
sender doesn't need four code paths for four checkpoints; it needs one call, invoked
against whichever roster the checkpoint targets (send: every active engineer; nudge: every
active engineer not yet submitted — `checkin_escalations`' own `status != 'submitted'`
set). `eveningClose`/`ownerSend` are a fifth, structurally different send (a DPR
notification/delivery, addressed to a PM or owner, carrying a link or report content, never
touching `whatsapp_sessions`) — different content, same underlying transport concern
(window state, idempotency, failure handling). **The primitive should be the generic
transport layer both callers share, not duplicated per caller.**

**Shape, sketched:**

```ts
interface SendMessageInput {
  toWhatsappNumber: string       // E.164, already normalised
  tenantId: string
  eventKey: string                // idempotency key component — see 3d
  windowState: ReachabilityResult // from determineReachability — caller's job to compute
  freeFormText: string            // what to send if the window is open
  templateName: string | null     // what to send if closed; null if none exists (see 3c)
  templateVariables: Record<string, string>
}

interface SendMessageResult {
  outcome: 'sent_freeform' | 'sent_template' | 'skipped_duplicate' | 'skipped_no_template' | 'failed'
  twilioSid: string | null
  error: string | null
}

async function sendWhatsAppMessage(
  client: SupabaseClient,   // injected, no module-level construction — same convention
                            // as every other lib/whatsapp/* function (readCurrentFlow,
                            // clearMessagingBlock, isNewMessage all take this shape)
  twilioClient: TwilioClient, // ALSO injected — the stated requirement (3a: "testable
                               // without Twilio") means this is a parameter, not an
                               // internal `new Twilio(...)`, mirroring generate.ts's own
                               // `client: Anthropic` parameter, not a module-level client
  input: SendMessageInput,
): Promise<SendMessageResult>
```

**Pure decision logic, separated from I/O, per the requirement:** a pure function —
`decideSendShape(windowState, templateName): 'freeform' | 'template' | 'no_template'` —
computes WHICH branch fires, unit-testable with zero Supabase/Twilio calls, mirroring this
codebase's existing pure/IO split (`decideInboundGate` / `clearMessagingBlock`,
`determineTargetStatus` / `sweepEngineerHalf`). `sendWhatsAppMessage` itself is the thin IO
wrapper that calls the pure function, then does the claim/send/record sequence (3d).

**REVISED per §0's scoped always-template decision: `decideSendShape` is only ever called
for OUTBOUND-INITIATED trigger sends, and for those it never returns `'freeform'`** — the
branch collapses to `'template' | 'no_template'`, `windowState` is no longer an input to
it at all. IN-FLOW replies (the RPC's own returned `reply` text for `advance`/`reask`/
`already_complete`) go out free-form unconditionally, through a SEPARATE, simpler path
that never calls `decideSendShape` and never touches reachability — they are safe by
construction (§0). Two call shapes inside one primitive, not one call shape used two ways:
`sendTriggerMessage` (template-gated, idempotency-tracked per 3d) for the four/five
checkpoint sends, and `sendFlowReply` (free-form always, still idempotency-tracked per 3d
— a retry must not double-send a reply either) for in-flow turns.

### B3 — "one call" holds intra-flow and BREAKS cross-flow; this is a real, undecided design gap

**Correction accepted in full: 3a's "four sends, one call" claim, as written, is only true
within one flow.** All of §10's own worked cases (Part 1, restart semantics) are same-flow
— morning-mid-flow-gets-a-morning-nudge, morning-complete-gets-a-morning-restart-attempt.
None of them cover what happens when a DIFFERENT flow's trigger arrives while the FIRST
flow is still active. Concretely: `eveningSend` (18:30) calling `applyEveningFlowTurn
({startFlow: true})` for an engineer whose session still shows `current_flow='morning'`
(never finished, or never even started, that day's morning flow) hits the evening RPC's
`ELSE` branch (`025:229-243`) — which returns `'reask'`, but **re-sends whatever question
morning was on**, not an evening question, because the branch doesn't check WHICH flow is
active, only THAT one is. **The evening flow never starts for that engineer. The 19:45
report reads evening as not received — correctly, in the sense that nothing evening-shaped
was ever asked, but the actual cause (a morning session no one ever closed) is invisible
from that report.**

**Not a hypothetical edge case — the RPC comment for the ELSE branch doesn't distinguish
flows, and `bot-flows.md`'s own BOT-21 spec says something different (queue the new flow
behind the active one via `pending_flows`) implemented by `acquire_and_transition_session`
— a real, built RPC (`session.ts`'s `acquireAndTransition`) that the CURRENT morning/
evening RPCs do not call into at all.** Three real options, each requiring a decision here,
not deferred to implementation:

1. **Cutoff-close the stale morning session at `morningCutoff` (15:00).** A new sweep (or
   extending the existing escalation sweep) resets `current_flow`/`current_step` to
   idle for any session still stuck at `'morning'` past the cutoff — mirroring what
   `checkin_escalations` already does for the ACCOUNTABILITY record (closing it as
   `not_submitted`) but extending that closure to the SESSION STATE too, which nothing
   does today. By `eveningSend`, the session is already idle, and the evening RPC's normal
   `current_flow IS NULL` branch starts it cleanly.
2. **Wire BOT-21 queueing into the flow RPCs.** `eveningSend` arriving mid-morning queues
   evening into `pending_flows` instead of returning a mis-flowed `reask`; evening starts
   only once morning completes or is abandoned. Matches the ALREADY-SPECIFIED
   `bot-flows.md` behavior and the ALREADY-BUILT (but currently unconsumed by these two
   RPCs) queueing mechanism — the most spec-faithful option, but the one requiring the most
   RPC surgery (both `apply_morning_flow_turn` and `apply_evening_flow_turn` would need to
   learn to read/write `pending_flows`, which they don't today).
3. **Force-switch at `eveningSend`.** The evening trigger unconditionally overwrites
   `current_flow` to `'evening'` regardless of what was active, discarding any in-progress
   morning answers. Simplest RPC change of the three.

**Recommendation, not yet decided on the record — leaning toward option 1 combined with
option 3 as a backstop, not option 2:** by the time `eveningSend` fires (18:30), morning's
own accountability window closed 3.5 hours earlier (`morningCutoff`, 15:00) — the schedule
has already treated that morning as over for every purpose EXCEPT the session's own
`current_flow` value. Option 1 makes the session state consistent with a decision the
schedule already made; option 3 is a cheap backstop for the case option 1's sweep somehow
missed a session. Option 2 (BOT-21 queueing) is the most faithful to the ORIGINAL spec but
reopens a design question — should a same-day morning answer ever be accepted AFTER 15:00
just because evening queued behind it? — that the schedule freeze (Part 1) implicitly
already answered "no" by giving morning a hard, non-negotiable cutoff. **Not finalized here
— this is a recommendation for the reviewer to accept or override, not a decision made
unilaterally, per the same discipline this plan applies to the always-template
recommendation (§0).**

**Every one of the three options is an RPC change — the "one mechanism" claim (3a) is
only true once ONE of these three ships, and all three require touching the SECURITY
DEFINER flow functions.** This is the direct evidence behind the corrected §0(a) reading
(3g, revised below) — not a separate concern from it.

## 3b. Template vs. free-form — SUPERSEDED by §0's scoped decision, kept below for the record

**The section as originally written (below, struck) reasoned per-recipient window state
from `determineReachability` for every event. §0 (added this revision) supersedes it: under
the scoped always-template recommendation, window state is no longer consulted for ANY
sending decision at all.** Trigger sends always use template, unconditionally — no
reachability check. In-flow replies always go free-form, unconditionally — safe by
construction, since they're sent in direct response to the inbound that just reopened the
window, so no reachability check is needed there either. **`determineReachability`/
`fetchSessionWindows` (`reachability.ts`, built for PR #59, already unconsumed) remain
unconsumed after this workstream too** — built for a need that, on closer analysis, doesn't
materialize the way originally anticipated. Not removed — kept per this project's own
"leave retained-but-unused logic in place" pattern, since a future redesign (e.g. if the
scoped decision is revisited) could still want it.

~~**Worked out per event, from `determineReachability`, not from which of the four sends it
is:**~~

~~| Event | Recipient's window | Free-form possible? |~~
~~|---|---|---|~~
~~| `morningSend` to an engineer who never messaged, or last messaged >24h ago | closed | No — template required |~~
~~| `morningSend` to an engineer who replied to something (e.g. a prior day's flow) within 24h | open | Yes |~~
~~| `morningNudge` to an engineer who already answered Q1 nine minutes ago (mid-flow) | open (their own answer reopened it) | Yes |~~
~~| `morningNudge` to an engineer silent since yesterday | closed | No — template required |~~
~~| `eveningSend`/`eveningNudge` | same logic, evaluated fresh each time — the window is per-recipient, per-instant, not per-event-type | — |~~

~~**The stated example in the task is exactly right and generalizes:** a 10:00 nudge to an
engineer who replied at 08:35 has an open window (< 24h since `whatsapp_sessions.
updated_at`); the identical nudge to someone silent since yesterday does not.~~ **Still true
as an analysis of window mechanics — the reason it no longer drives the send-shape decision
is the cost argument evaporating in six weeks (§0), not that the mechanics were wrong.**

### B1 — RESOLVED: moot under §0's scoped decision, not fixed, deleted

**The finding, restated precisely so "moot" isn't read as "wrong":** both flow RPCs write
`updated_at = p_now` unconditionally, including on `p_start_flow` calls (018:228-238,
022:295, 025:797). Once the `morningSend` cron calls the RPC for the whole roster, every
engineer's `whatsapp_sessions.updated_at` gets bumped by the SEND itself, not by anything
the engineer did — so by `morningNudge` at 10:00, every roster engineer reads as
window-open, including someone who has never replied to anything. Meta's real window keys
off the recipient's own last INBOUND, which nothing in this schema records separately from
"last time this row was touched by either side." **This was a real bug in the design as
originally written, correctly caught.** It does not need fixing under the adopted
recommendation because the thing it would have poisoned — a reachability check gating
trigger sends — no longer exists (§0, 3b). **No inbound-only timestamp is being added in
this pass.** If the scoped always-template decision is ever revisited (e.g. post-October,
if reconsidering opportunistic free-form for trigger sends becomes attractive again for
some other reason), B1 must be re-opened and fixed before doing so — it does not go away
on its own merits, only on the decision built on top of it going away.

## 3c. The template gap — now the PRIMARY state for every trigger send, not a fallback

**Sharper under §0's scoped decision than originally framed:** with trigger sends
unconditionally template-gated (no free-form fallback for an open window anymore), **the
"no template exists yet" branch isn't a closed-window edge case — it's the state EVERY
trigger send is in, for every recipient, until Meta approves the four/five relevant
templates.** Review round 1's stop applies here directly: nothing about skip-and-record
itself is reopened (still the right choice, reasoning below unchanged), but its ground
shifted from "an occasional fallback" to "today's only outcome." **Design for that state
explicitly — do not let it silently do nothing.**

Three candidates, one chosen:

- **Hold and retry** — queue the send, retry later hoping approval lands. Rejected: there
  is no clock at which "later" resolves this — template approval is an external,
  unscheduled event (Meta's own timeline), so "retry" degenerates into "retry forever,"
  which is indistinguishable from silently doing nothing except for the wasted invocations.
- **Skip and record** — write a row marking this send as skipped for lack of a template,
  move on. **Chosen.** Matches this project's own established posture (NFR-17's
  dead-letter, `markDprGenerationFailed`'s honest-failure pattern): a real record exists,
  queryable, distinguishable from "sent" and from "failed for a Twilio reason." The
  `outcome: 'skipped_no_template'` value in 3a's sketch is this.
- **Alert** — **chosen alongside "skip and record," not instead of it.** A single skip is
  expected and boring (templates genuinely aren't approved yet — this isn't a bug during
  that window). But **a skip on an event where the primitive doesn't yet know whether
  approval has landed is exactly the silent-failure shape this task explicitly rejects**
  ("a build that silently does nothing when templates are missing is worse than one that
  refuses loudly"). Concretely: Sentry-capture (warning level, not error, since this is an
  expected pre-launch state) on the FIRST skip of each UTC day per template name, not on
  every skip — loud enough that the gap is visible in monitoring, not so loud it's
  self-defeating noise once templates are genuinely still pending for weeks.

**The actual closing condition is external, not code:** this state resolves itself the
moment the Meta template approval lands (already on the critical path per `design-
decisions-beta-feedback.md` §25/§26) — nothing in the primitive needs to change; `
templateName` stops being `null` for real, and `decideSendShape` starts returning
`'template'`-with-a-real-name instead of `'no_template'`.

## 3d. Idempotency — claim BEFORE the Twilio call, not after

**Vercel Cron is at-least-once**, so two invocations of the same checkpoint must not
double-send to the same recipient. Twilio's own inbound-SID idempotency pattern
(`isNewMessage`, insert-and-catch-`23505`) can't be reused directly for OUTBOUND — Twilio
only hands back a message SID **after** a send succeeds, so there is no pre-existing
external key to dedupe against before calling them. **The idempotency key has to be
ours**, deterministic from the event itself: `(tenant_id, recipient, event_key)` where
`event_key` is something like `morning_send:2026-08-15` or `evening_nudge:2026-08-15` —
one per (recipient, checkpoint, day).

**Claim BEFORE the Twilio call, not after — stated explicitly, with both failure modes
named, not just the choice:**

- **Claim-before (chosen):** `INSERT` a row into an outbound-sends tracking table with
  `status: 'sending'`, unique-constrained on `(tenant_id, recipient, event_key)`, same
  insert-and-catch-duplicate shape as `isNewMessage`. If the insert hits the unique
  violation, this invocation is a retry of an already-claimed send — check the existing
  row's status rather than blindly sending again. Only after a successful claim does the
  Twilio call happen; the row is then updated to `'sent'`/`'failed'` with the real SID.
  **Failure mode: a crash between claim and Twilio call (or a Twilio timeout with an
  unknown outcome) leaves a row stuck at `'sending'` — a FALSE record of intent, not a
  false record of delivery.** Recoverable: a sweep that finds `'sending'` rows older than
  some threshold (a few minutes) can re-check via Twilio's own message-status API or just
  retry, since nothing was actually sent yet in the crash case, or can be reconciled via
  Twilio's status-callback webhook if one is wired.
- **Claim-after (rejected):** send first, record after. **Failure mode: a crash or timeout
  between the Twilio call succeeding and the DB write leaves NO record at all** — the
  message is already in the recipient's WhatsApp, but the system doesn't know it, and a
  retry sends it AGAIN. This is a duplicate delivered to a real person — irreversible,
  unlike claim-before's stuck-but-recoverable row.

**Claim-before is the only choice that keeps the failure mode "recoverable ambiguity"
instead of "irreversible duplicate."** This mirrors the exact reasoning this project
already applied to `handleDprGenerateJob`'s claim-before-Claude-call pattern
(`dispatch.ts:94`, claim the row before the billed API call) — same shape, same reasoning,
applied to an even less reversible side effect (a delivered WhatsApp message vs. a
regenerable report).

### B2 — the skip-and-record decision must precede the RPC call, not follow it

**Skip-and-record itself is not reopened** (3c) — this is about WHERE it sits in the
sequence for trigger sends specifically, and it was sequenced wrong in the first draft.
**As originally implied, the flow was: RPC call (which starts the session,
`current_flow='morning'`, `current_step=1`) → THEN decide whether a template exists to
send.** If no template exists, the RPC has already committed the engineer's session to
step 1 — they never actually received Q1 (nothing was sent), but their next real inbound
message (whatever they happen to say, to anyone, about anything) gets consumed by the RPC
as if it were an answer to a question they were never asked.

**Correct order, stated explicitly:**
1. `decideSendShape` (now just `'template' | 'no_template'` for trigger sends, §0/3b) — no
   RPC call yet.
2. If `'no_template'`: record the skip (3c's `skipped_no_template` outcome) and **STOP —
   do not call the RPC at all.** The session stays exactly where it was; nothing was
   promised to the engineer that wasn't delivered.
3. If `'template'`: claim (3d) → call the RPC (`startFlow: true`) → Twilio send → record
   the real outcome.

**The retry-convergence property, stated so the ordering rule is understood, not just
obeyed:** a send failure AFTER the RPC call (step 3, Twilio itself fails) is safe and
self-healing in a way a failure BEFORE it is not — the RPC has already set
`current_flow`/`current_step`, so a RETRY of this same checkpoint calls the RPC again,
which (per the RPC's own branching) returns `'reask'` for the SAME question, and the retry
resends it. No data is lost, no question is skipped, the engineer just sees the message
arrive slightly late. This is exactly why 3d's claim-before analysis calls a
stuck-`'sending'` row after the Twilio call "recoverable" — the RPC-side state is already
correct and self-consistent regardless of whether the Twilio call it triggered succeeded.
**That property is what makes it safe to call the RPC only ONCE we already know a message
can be sent (step 3, template confirmed to exist) — calling it any earlier, before that's
known, is what created B2's bug in the first place.**

## 3e. Failure handling — retryable vs. terminal, and the `messaging_blocked` gap this closes

| Failure | Retryable? | State left | How anyone finds out |
|---|---|---|---|
| Twilio 5xx / network timeout | Yes | `'sending'` (ambiguous, per 3d) | Sweep/reconciliation finds stale `'sending'` rows — B4, below, gives this a real source |
| Twilio 4xx — invalid/unreachable number | No — same number will fail again identically | `'failed'`, `error` populated | Sentry (error level — this is a real, actionable problem, not the expected template-gap state) |
| Template rejected (wrong category, unapproved variable shape) | No — same template, same rejection, every time | `'failed'` | Sentry — this is a configuration bug, always worth surfacing loudly |
| **Accepted synchronously, rejected asynchronously (error 63016 and others)** | **See B4 — this is the failure this table originally missed entirely** | — | — |
| Repeated terminal failure for ONE recipient across multiple sends | — | **`messaging_blocked = true`** | Named status on the row, not silence |

**The `messaging_blocked` row is the actual point of cross-referencing Rule 4.4.**
CLAUDE.md already tracks, as a pre-launch gap, that `messaging_blocked` has a CLEAR half
(`reactivation.ts`, built) but no SET half anywhere in the codebase — nothing currently
ever sets it true. **This primitive is what makes that write honest, and closing it is
in scope for this workstream, not deferred again:** after N consecutive terminal failures
(a real number to pick during implementation, not here) for one recipient, set
`messaging_blocked = true` on their `users` row. This is exactly what the flag is FOR —
"repeated failure for one engineer is a named status, not a mystery" is a direct quote of
the task's own framing, and it's what turns silent, invisible degradation (an engineer
nobody's reaching, with nothing anywhere saying so) into a PM-visible fact (the existing
DASH-03/dashboard surfaces already read `messaging_blocked`).

### B4 — the dominant failure mode was missing entirely, and it's not deleted by always-template

**Correction accepted, and stated precisely why it survives the always-template scoping
(§0) rather than being deleted by it:** a free-form send made while the window LOOKS open
can still be accepted synchronously by Twilio (HTTP 201, a real SID returned, message
queued) and then rejected ASYNCHRONOUSLY once WhatsApp itself evaluates delivery — error
**63016** specifically is exactly this: the window closed (by WhatsApp's clock, not the
sender's stale read of it) between accept and actual delivery attempt. **This class was
originally the primary risk of the free-form path** — scoping trigger sends to
always-template (§0) deletes 63016 SPECIFICALLY for those sends, because a template send
doesn't depend on window state to be valid. **It does not delete the general problem: any
WhatsApp send — template included — can be accepted synchronously and fail asynchronously**
for other reasons (invalid/deactivated number discovered late, undeliverable device,
carrier-level rejection, rate limiting). **The dominant failure mode this section
originally missed is not "63016," it's "synchronous accept is not proof of delivery, for
any category of message" — 63016 was just the sharpest example of it under the design as
first drafted.**

**No status-callback route exists anywhere in this tree** — grepped `app/api/` for any
Twilio status-callback handler: none. Without one, this primitive has no way to ever learn
that an "accepted" send didn't actually arrive. Concretely, without this route: the
primitive records `'sent'` at Twilio-accept time; 3f stamps `nudge_sent_at` on a message
that may never have reached the recipient; `messaging_blocked`'s terminal-failure counter
(above) never increments for this failure class, because from this primitive's own
perspective nothing failed. **Plan a status-callback route now, as part of this
workstream, not a later addition:**

- **New route**, e.g. `app/api/whatsapp/status-callback/route.ts` — Twilio POSTs delivery
  status updates here as a message's real state resolves (`queued` → `sent` → `delivered`
  → `read`, or `failed`/`undelivered` with an error code).
- **HMAC-verified, same discipline as the inbound webhook** (`validateTwilioSignature`,
  already built and tested — `test-trigger`'s own T-WH-01/02 pattern extends directly to
  this route, same signature-validation function, different payload shape).
- **Idempotent on Twilio's `MessageSid`** — Twilio can and does retry status-callback
  POSTs; the same `processed_messages`-style insert-and-catch-duplicate pattern applies,
  keyed on `(MessageSid, MessageStatus)` rather than just `MessageSid` alone, since the
  SAME SID legitimately produces multiple distinct status updates over its lifecycle
  (queued, then sent, then delivered) and each is a real, non-duplicate event, only a
  repeat of the SAME status update is a retry to dedupe.
- **Outcome vocabulary, stated so `nudge_sent_at`'s real meaning is explicit, not implied:**
  `accepted` (Twilio took it, delivery unknown — this is what the OLD design silently
  treated as final), `delivered` (WhatsApp confirms arrival — the only state that should
  ever be read as "this message reached the recipient"), `failed` (terminal, with the
  Twilio error code preserved for the `messaging_blocked` counter and for Sentry).
  **`nudge_sent_at` (3f) should be understood as "accepted," not "delivered"** — stamping
  it means the send was handed to Twilio successfully, not that the recipient has it yet;
  this plan does not propose gating `nudge_sent_at` on `delivered` (that would delay a
  correction record for a WhatsApp-side confirmation lag with no clear benefit), but the
  DISTINCTION needs to be named so a future reader doesn't assume more certainty than the
  column actually carries.
- **This also gives 3d's stuck-`'sending'`-row sweep a real reconciliation source.** The
  original 3d text said such a sweep "can be reconciled via Twilio's status-callback
  webhook if one is wired" — conditional, because none was planned. With this route built,
  that condition is met: a `'sending'` row past a timeout is resolved by checking whether
  a status-callback for its SID ever arrived, not by guessing or blindly retrying.

## 3f. `nudged` / `nudge_sent_at` — this primitive is the honest writer PR #59 deferred

**PR #59's `sweep.ts` deliberately never writes `status='nudged'`**, because writing it
would mean claiming `nudge_sent_at` before anything was actually sent — exactly the "false
fact" this project's own §0 discipline refuses to ship (`status.ts`'s own CORRECTION 1
comment states this explicitly). **This primitive is the thing PR #59 was waiting for.**

**Exactly where, relative to the Twilio call, stated precisely** (nudge is a trigger send —
`sendTriggerMessage`, §0/3a — so this is unconditionally the template path, no free-form
branch to consider here): `nudge_sent_at` is set **after** the Twilio call succeeds — never
before, and never merged into the claim-before write from 3d (that write only ever says
"sending," not "sent"). **B4's outcome vocabulary applies directly:** this write happens
on Twilio's `accepted` outcome, not on `delivered` — `nudge_sent_at` means "handed to
Twilio successfully," the same qualification B4 names for the send record generally, not
a stronger delivery guarantee. The two-step shape:
1. Claim (3d) — `status: 'sending'`, no `nudge_sent_at` yet.
2. Twilio call.
3. On `accepted`: update the outbound-send row to `'sent'` **and**, in the same statement
   or an immediately-following one, write `checkin_escalations.status = 'nudged'` +
   `nudge_sent_at = now()` for this (engineer, half, date) row — the DB write
   `determineTargetStatus`'s own rank table already accounts for (`nudged: 1`) but that
   nothing currently ever transitions TO.
4. On failure (synchronous, from step 2) OR on a later async `failed` status-callback
   (B4): `nudge_sent_at` is never touched (or, for the async case, was already written
   optimistically at step 3 and is NOT retroactively unset — see the note below). The
   escalation row otherwise stays wherever the sweep's own clock-driven logic already put
   it (`awaited`/`escalated`) — a failed send attempt does not fabricate a sent-at time.

**Named tension, not resolved here:** because step 3 fires on `accepted` (synchronous),
not `delivered` (async, B4), a message that's accepted then later fails asynchronously
will have already stamped `nudge_sent_at` — technically true ("Twilio was asked to send
this"), but not what a PM reading "nudged" on the dashboard would assume. Whether a later
`failed` status-callback should retroactively revert `nudged`→ its prior status is a real
design question for implementation, not decided in this plan — named so it isn't
rediscovered as a surprise.

## S. Roster filters and ledger completeness

Three smaller corrections, all accepted, none reopening the primitive's shape:

- **The nudge roster's actual dependency, named plainly:** 3a's `morningNudge`/
  `eveningNudge` roster is "every engineer with a `checkin_escalations` row not yet
  `submitted`" — but those rows only exist because a sweep (PR #59, `sweep.ts`) writes
  them, and that sweep's own cron is **not present in `vercel.json`** — confirmed by
  reading the file (Part 1 tonight only added/removed `dpr-generate` and, briefly,
  `owner-deliver`; no escalation-sweep cron exists there at all). **This primitive
  depends on a cron that doesn't exist yet either.** Not this workstream's job to add it,
  but the dependency needs to be visible here rather than discovered at integration time.
- **`messaging_blocked` belongs in 3a's ROSTER FILTER, not only in 3e's write path.** As
  drafted, 3e only covers messaging_blocked as an OUTCOME (something this primitive sets
  after repeated failure) — but `bot-flows.md`'s own line about it (the free-form/template
  fallback section) implies it should also gate WHO gets sent to in the first place. A
  blocked engineer must never be included in ANY trigger-send roster (`morningSend`
  through `eveningNudge`) — filtered out at roster-selection time, the same layer that
  already filters on `status = 'active'`, not discovered downstream as a wasted claim-and-
  fail cycle through 3d/3e.
- **`already_complete` should write a ledger row too.** As drafted, an engineer who's
  already submitted produces no outbound-send row at all when a checkpoint's roster query
  reaches them (they're simply skipped in application logic). **Better: still write a row,
  outcome `skipped_already_submitted`.** This makes a day's send ledger for a given
  checkpoint a COMPLETE accounting of the whole roster (sent / skipped-no-template /
  skipped-already-submitted / failed), not a partial one where "already submitted" is
  invisible by omission — the same reasoning that made `skipped_no_template` a real,
  recorded outcome (3c) rather than silent nothing applies identically here.

## 3g. §0 evaluation, condition by condition, §0's actual wording quoted

Quoting `CLAUDE.md` §0 directly, not paraphrased, against this specific primitive:

- **(a) "CREATES OR MODIFIES a live function's LOGIC... Narrowed to logic deliberately."**
  **CORRECTED — the reviewer disagrees with the original "does not trip" reading, and is
  right.** ~~This primitive is designed to need no new or modified Postgres function... As
  designed: does not trip (a).~~ That was true of the primitive's OWN table (the
  idempotency claim, 3d, is still a plain `INSERT`, not a stored procedure) but false of the
  workstream this primitive cannot function without: **B1's fix (if the always-template
  scoping is ever revisited) and B3's fix (cross-flow interference, all three options,
  named above) both require changing `apply_morning_flow_turn`/`apply_evening_flow_turn`'s
  own logic — and those are the SECURITY DEFINER flow RPCs, the most sensitive functions
  in this codebase.** Refuse-when-submitted (Part 1, §10, DECIDED but not yet built) is the
  same category — its own plan document already says it needs its own migration and
  review. **Corrected reading: (a) does NOT trip for the outbound-send tracking table in
  isolation, but DOES trip for the workstream as a whole, via its own preconditions — B3
  specifically cannot ship without an RPC change, by the plan's own analysis two sections
  up, so treating (a) as clear for "this PR" would be exactly the kind of narrowing-by-
  scope §0's own "SUBJECT MATTER, NOT DDL SHAPE" line exists to prevent.** Scoped in, not
  scoped out: any PR that ships this primitive and B3's fix together trips (a) through B3
  alone, independent of how cleanly the tracking table itself is built.
- **(b) "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING OBJECT."** A new
  outbound-sends tracking table is a **new** object, not a modified existing one — but §0's
  own text extends this condition's spirit explicitly: *"a brand-new SECURITY DEFINER
  function, or a new table with wrong RLS from day one, has no prior safe state to fall
  back on and is at least as dangerous as a bad change to an existing one."* **Trips (b) on
  that basis** — this table's RLS/grants need the same scrutiny a modification would get,
  precisely because getting them wrong on a brand-new table carrying phone numbers and send
  history is not lower-stakes than getting them wrong on an existing one.
- **(c) "Touches auth or identity."** Judgment call, named as one rather than silently
  assumed: this primitive touches WhatsApp reachability and phone-number identity, not
  web-auth/login identity — the file's own AUTH DECISIONS section (§26, tonight) is
  clearly about magic-link/OTP/session auth, a different surface. **Reading: does not trip
  (c)** on that basis, but the adjacency (phone numbers, `messaging_blocked` as an
  identity-adjacent gate) is real enough to name rather than wave past.
- **(d) "Is destructive or irreversible."** **Trips.** A delivered WhatsApp message cannot
  be unsent — a bug here (wrong recipient, wrong content, a double-send from a claim-after
  design) is a real-world, non-DB-rollback-recoverable consequence, not a hypothetical one.
  This is the condition a schema-only reading of "destructive" would miss; §0's own
  "SUBJECT MATTER, NOT DDL SHAPE" framing is exactly why it still counts.
- **(e) "Moves money."** **Trips, unambiguously.** Every template send is billed
  (~₹0.115+ per the Authentication-template figure recorded tonight; check-in templates'
  own Utility-category rate separately) — this primitive is a real, recurring, per-message
  cost the moment templates go live, which is the task's own framing verbatim ("adds an
  outbound money-spending capability").

**Net, corrected: (a), (b), (d), (e) all trip; (c) is a judgment call recorded, not
silently assumed. Per §0's own rule — "if ANY migration in the PR trips a trigger, the
WHOLE PR needs the package" (generalized here from "migration" to "this workstream," same
reasoning §0 already applies to non-migration changes elsewhere in its own text) — this
requires the full external-review package before shipping, the same path 028 went
through.** Not assumed in either direction going in, evaluated condition by condition, and
the answer came out requiring review on FOUR independent grounds, not one borderline call —
strengthened, not merely maintained, by round 1's own correction.

---

## THE ENTANGLEMENT with #67 — stated here, and identically in #67's own plan

**PMs and owners never message the bot.** Every reachability/window discussion in this
plan (§0, 3b) is about ENGINEERS, whose flows are the only thing that ever generates an
inbound message. A PM or an owner has no symmetric path — nothing in this product's design
has them texting the bot first. **Their WhatsApp windows are therefore always closed, with
no exception, structurally, not as a transient state that might change.**

**Consequence for #67's two-stage delivery (`eveningClose` PM-notify, `ownerSend`):**
under skip-and-record (3c), which this revision keeps and strengthens, **both of #67's
sends are `skipped_no_template` on every single attempt until Meta approves the relevant
templates** — there is no free-form fallback available to either send, ever, because
neither recipient class can have an open window by construction. This is not a corner case
of the template gap; for PM-notify and owner-send specifically, IT IS THE ONLY CASE.
**#67's `delivery_status` state machine (its own proposed `pm_notified` value) needs a
skip outcome of its own, mirroring this primitive's `skipped_no_template`, or
`delivery_status` sits at `'pending'` forever with nothing anywhere explaining why** — the
exact silent-failure shape 3c was written to prevent, reappearing one layer up if #67 does
not also account for it.

**Consequence for this plan's own "fifth send":** 3a named `eveningClose`/`ownerSend` as
"structurally different — same transport concern, different content" without specifying
what that content actually is. It can't stay unspecified: §0 above found that the
owner-send's content (per `dpr-engineer-report-spec.md` §8, full inline report text) may be
fundamentally incompatible with a template's fixed-slot structure, which is a #67 content
question this plan cannot resolve unilaterally. **#69 needs #67 to specify the actual
content contract for both sends (a template with a link and which variables, or a
redesign of §8 to not require inline content) before "structurally different" can become a
real implementation, not a placeholder description.**

---

## Summary of what remains before this can be built

1. Decide the exact new table shape for outbound-send tracking (3d) — not sketched to SQL
   here, deliberately, since that's a schema decision for the review package, not this
   plan.
2. Decide the terminal-failure-count threshold for `messaging_blocked = true` (3e).
3. Decide B3's cross-flow interference fix (one of three named options, or another).
4. Build the status-callback route (B4) as part of this workstream, not a later addition.
5. Resolve the entanglement with #67 above — both plans block on the same open question.
6. Full external-review package (3g) before any migration or code ships — now trips on
   FOUR grounds, not three.
7. This is the actual precondition for the product functioning — nothing else in this
   session's three parts tonight can run in production until this exists.

Nothing built in this pass. Branch/PR for this document only — no code.
