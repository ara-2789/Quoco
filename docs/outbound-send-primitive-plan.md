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

**REVISION 3 (2026-08-15, same day) — #67 decided the owner receives the DPR by email, not
WhatsApp. `ownerSend` (20:30) is removed from this primitive's scope entirely — it was
never cleanly in scope (previously bundled with `eveningClose` as one ambiguous "fifth
send"), and is now explicitly named out, a different sender, owned by #67. This narrows,
not reopens: the four engineer checkpoints + `eveningClose`'s PM-notify remain exactly as
revision 2 designed them — still template-gated, still entangled with Meta approval, still
requiring the full review package. Changes: §0's owner-send blocker marked resolved; 3a's
"fifth send" framing split cleanly (PM-notify in scope, owner-send out); THE ENTANGLEMENT
with #67 rewritten to one open dependency instead of two; Summary updated. Diff against
`4f2c118`.**

**REVISION 4 (2026-08-19, round 3 external review — verdict STOP, iterate as a diff against
this pin, not a rewrite) — diff against `57cf77a`. Still nothing implemented; SQL is not
written here — this document remains plan-only, one round short of the review package.**

**Revision header — every finding, stable label, round of origin, status. This table is
the fix for the process defect below (the B2 collision): it is now the single place that
says what each label means and where it stands, so a label can never again silently absorb
a different finding's resolved status.**

| Label | Round of origin | Status this round | What changed |
|---|---|---|---|
| §0 (Meta pricing fact) | Round 2 | Carried over, **reframed** | Decision decoupled from the October date (A1) — the fact-check itself is unchanged and still hedged at the same confidence level it always was |
| A1 (October date framing) | Round 3 (external review) | **Resolved** | Every conditional branch on the date removed from the decision; date now appears only in cost projections |
| A2 (service-reply economics) | Round 3 (external review, NEW finding) | **Added** | Folded into §3g condition (e) and the Summary, as a named-but-open variable |
| A3 (log Meta's `pricing` object) | Round 3 (external review, NEW finding) | **Added** | Folded into B4's status-callback route spec as a day-one requirement, not a follow-up |
| A4 (IST/UTC day-key nits) | Round 3 (external review, NEW finding) | **Resolved** | Both sites named and fixed — §3c's "UTC day" → IST; §3d's `event_key` date now states IST explicitly |
| B1 | Round 1 | Resolved (round 2), carried over unchanged | Moot under §0's scoped decision; not re-opened this round |
| **B2 (round 1)** | **Round 1** | **Carried-over-unresolved for two full revisions, NOW fixed this round** | `messaging_blocked` was on track to be repurposed to represent delivery failure. It represents CONSENT, not delivery — see the fix in §3e below. |
| **B2 (round 2)** | **Round 2** | Resolved (round 2), **unchanged this round — relabeled only**, to stop colliding with B2 (round 1) | The skip-and-record-before-RPC-call ordering fix — substance untouched |
| B3 | Round 2 | Was a recommendation, undecided, through round 3. **DECIDED this round** | Options 1 (cutoff-close sweep) + 3 (force-switch backstop) adopted together; five conditions attached (§3b below) |
| B4 | Round 1 | Resolved (round 2), carried over, **gains A3's requirement this round** | Status-callback route spec now also logs Meta's `pricing` object from day one |
| S (roster/ledger, three items) | Round 2 | Resolved, unchanged | — |
| 3f "named tension" (retroactive `nudged` revert) | Round 2 (left open) | **Resolved this round** | Ruled: no revert, ever (B-c) |

**The process defect this table exists to prevent, stated plainly, per direct instruction —
not smoothed over:** revision 2's own header claimed "B1-B4" resolved as a block. That
claim was true for B1, B3 (as "recommended," not yet decided), and B4 — but **false for
B2**. The B2 label was reused in revision 2 for a genuinely different finding (the
skip-and-record ordering fix), and revision 2's header let that new B2 silently inherit
"resolved" status while the ORIGINAL round-1 B2 — `messaging_blocked` being repurposed to
mean delivery failure — was never touched. Two revisions (2 and 3) both carried a header
that read as if B2 was closed. It was not. Fixed here by never letting one label mean two
things again: **B2 (round 1)** and **B2 (round 2)** are now permanently distinct labels,
and the round-1 finding is fixed in substance below (§3e), not merely relabeled.

**REVISION 5 (2026-08-19, round 4 design review — both plans "moved substantially,
neither ready to send back" — resubmit as a diff against this pin) — diff against
`46f823f`. Still nothing implemented; still one round short of the review package.**

**Confirmed good, no further work this round (per direct instruction, not re-litigated):**
A2's `PER_MESSAGE_RATE_INR` left as a named open variable; B-a's substance (option ii,
derived from the send ledger, `messaging_blocked` left untouched as the consent state it
already is); B-b's fifth context-write site, found with file:line, with migration 022's own
header cited as corroboration; B-c's monotonic-ranks rationale.

**Revision header, this round:**

| Label | Round of origin | Status this round | What changed |
|---|---|---|---|
| C1 (A4's two sites, unnamed) | Round 4 (design review) | **Fixed.** Named by file:line, not just section: `docs/outbound-send-primitive-plan.md:539` (§3c's Sentry-alert day-key) and `docs/outbound-send-primitive-plan.md:565` (§3d's `event_key` date) — line numbers as of this revision's own commit, both re-checkable directly. |
| C2 (unreachability derivation underspecified) | Round 4 (design review) | **Specified.** All four required parts, in a new subsection under B2 (round 1), §3e: threshold (3 consecutive), window (7-day bound), clearing signal (a successful send in the same ledger — deliberately NOT an inbound reply, to keep this separate from `messaging_blocked`'s own clearing signal), and read sites (enumerated, one shared helper, not reimplemented per site). |
| C3 (does escalation advance for an unreachable engineer) | Round 4 (design review, product question) | **Decided: YES, with the alert text changed.** Adopted the reviewer's own inclination — escalation stays time-based and non-skippable (7.2), but the PM-facing text reads "engineer unreachable since `<time>`," not "has not responded," because the two states call for different PM actions. Justified against both named design principles, not just adopted by default. |

**REVISION 6 (2026-08-19, round 5 design review — "two smaller checks, then both go to
the reviewer") — diff against `3e38dfc`. Per direct instruction, this is intended to be the
last plan revision before the review package.**

**Accepted without further work this round (per direct instruction):** C2's full
specification and shared-helper design; C3 adopted as-is.

| Label | Round of origin | Status this round | What changed |
|---|---|---|---|
| R4 (C1's summary citation missing a filename) | Round 5 (design review) | **Fixed.** The revision-header row (above) always carried both full `file:line` citations — the defect was in the Summary section's own restatement, which abbreviated the second to bare `:527`. Both now independently carry the full filename there too. |
| R5 (low-volume recipient sanity check on C2's threshold/window) | Round 5 (design review) | **Checked, answered: engineers only.** Re-verified both C2 read sites (DASH-03, escalation alert-text) are engineer-scoped, not called for PM-notify despite sharing the same ledger table. Checked one edge deeper: the threshold/window combination doesn't silently break for ANY checkpoint in this primitive's scope, including PM-notify's lower volume, because every checkpoint fires at least once daily — the aging-out failure mode only bites a recipient class with fewer than 3 opportunities across 7 days, and none exists here. |

**GRADUATED (2026-08-19, external review verdict): both plans graduate to review-package
stage. No further plan revisions — this document is now frozen as the design record the
package cites, not itself edited further:**

- **P1 (process, accepted):** citations become `file:line @ <sha>` going forward — this
  document's own self-citations (C1's two IST/UTC sites) already had to be re-chased twice
  this arc as edits shifted line numbers; pinning to a SHA stops that from recurring.
- **P3 (labelling fix, my error to correct — findings untouched):** revisions 5 and 6 above
  attributed their findings to "round 4/5 external review." Those rounds came through the
  design-review chat channel, not the external reviewer's own channel — he conducted rounds
  3 and 4 on this arc, no more. **Every "Round 4 (external review)" / "Round 5 (external
  review)" label in this document's revision headers is corrected to "(design review)"
  above** — labelling only, matching §22 of the 028 package's own correction of this exact
  conflation; no finding's substance changed.
- **C2 sharpening (skip-row transparency)** lands in migration 031's own table comment
  (`outbound_sends`) and its review package, not as a further edit to this frozen document
  — the design (§3e/C2 above) already specifies the derivation correctly at the conceptual
  level; the sharpening is about how `computeUnreachable()` must treat the two skip
  outcomes differently, a detail that belongs where the ledger's own shape is defined.
- **Migration 031 (`outbound_sends`) is the artifact this document graduates into** —
  `supabase/migrations/031_outbound_send_ledger.sql`, review package at
  `docs/reviews/031-outbound-send-ledger-review-package.md`. BLOCKED — not applied, not
  rehearsed, per the same trigger-cron dependency this document's own S section already
  names, and additionally gated on B3's cross-flow RPC fix (§3b) shipping first, since this
  primitive's roster logic assumes that fix exists.

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
  up first, ahead of generic public docs) before treating this as fully confirmed.
  **REVISION 4 (round 3 external review): this gap no longer conditions anything below.**
  The prior text read "everything below is written conditionally — 'if this holds' — not
  as settled fact." That was wrong to apply to the DECISION (only to the raw fact itself,
  which stays exactly this hedged, unchanged). Per the reviewer's own ruling, quoted
  verbatim because it's the correct frame and shouldn't be paraphrased: **"The decision is
  robust to the date being wrong; only its price tag isn't. Adopt scoped always-template
  now, condition nothing on October."** The date remains unconfirmed to primary-source bar
  — that fact doesn't change, and the gap above stays open exactly as recorded. What
  changes is that the decision below no longer waits on it.

### Always-template — ADOPTED NOW, unconditionally; the date is a cost input, never a gate

**REVISION 4: this was previously framed as a recommendation weighed against a date that
might not hold. It is now a decision, adopted immediately, for reasons that hold whether or
not 1 October 2026 turns out to be the real date, or the real date turns out to be some
other day, or Meta's governance changes again before then.** The always-template scoping
below was never actually justified by the pricing arbitrage alone — re-reading the original
reasoning honestly, its strongest grounds were always mechanism-level, not calendar-level:
it deletes B1 and the 63016 async-failure class for trigger sends (below), and it clears
Q5's hard technical blocker (immediately below). Both of those hold today, regardless of
Meta's pricing calendar. The pricing fact only ever changed WHEN the choice stops being
free — never WHETHER it's the right choice. Restated precisely: **scoped always-template is
adopted now, for the five trigger sends in scope, unconditionally. The October date appears
nowhere in this plan's control flow after this revision — only in the cost projection
(§3g condition (e), and the new economics finding there).** "One send shape" still
undersells what always-template costs this specific product, checked against the real flow
shape rather than assumed away:

- **Q5 is structurally incompatible with a template.** Migration 024's own header:
  "Q5's prompt is data-driven... unlike every other step's static text" — the actual
  equipment list asked about varies per engineer per day (`equipment_echo`). A WhatsApp
  template has a fixed number of named variable slots, approved in advance; it cannot
  express "list of N items, N varying by day." This is not a preference to weigh, it's a
  hard technical blocker for that one step, template or no.
- **The owner-send blocker below is RESOLVED, not live — recorded for the record, not as an
  open constraint.** `docs/dpr-engineer-report-spec.md` §8 ("WhatsApp is the delivery
  surface") committed the OWNER to receiving the actual formatted report inline via
  WhatsApp — its own reasoning ("the inline `|` form rather than aligned columns, which
  collapse on mobile") only made sense if real report content was what got sent, not a
  link. A variable-length, multi-line report body cannot be a template body at all (fixed
  structure, per-parameter character limits) — under a naive "always-template, no
  exceptions" reading, the owner-send would have been impossible to build, not merely more
  expensive. **DECIDED (2026-08-15, #67's own revision, same day): the owner receives the
  DPR by email, not WhatsApp.** This removes the owner-send from this primitive's scope
  entirely — it is not a WhatsApp send of any shape, template or free-form, and does not
  factor into the always-template weighing below. Kept in this section as the finding that
  originally surfaced the need for that decision, not as a live blocker this plan still
  carries.

**DECIDED, not a recommendation as of this revision: neither the original hybrid (as
designed, still exposed to B1/B4) nor unscoped always-template. A narrower,
correctly-scoped position beats both on stated grounds, adopted now:**

**Always-template for the five OUTBOUND-INITIATED trigger sends in scope**
(`morningSend`, `morningNudge`, `eveningSend`, `eveningNudge`, and `eveningClose`'s
PM-notify — **`ownerSend` is explicitly NOT one of these**, per #67's email decision above;
it never enters this primitive at all). **Free-form stays, and is safe, for every IN-FLOW
reply** (Q2 through Q6, `already_complete`,
`reask`) because those are always sent in direct response to a message the engineer just
sent — the window is open by construction, no reachability check ever needed, no race to
have. **This scoped version achieves the reviewer's own stated payoff in full, not
partially:** B1 and the 63016 async-failure class only ever existed for outbound-INITIATED
sends in the first place (an in-flow reply was never exposed to the reachability race,
since it's triggered by the inbound that just re-opened the window) — so scoping
always-template to trigger sends deletes B1 and 63016-for-trigger-sends completely, at zero
cost to Q5 (an in-flow step, never a trigger send). The owner-send's content-shape problem
no longer needs solving as a precondition either — it's out of this primitive's scope
entirely (#67's email decision), which simplifies this reasoning rather than complicating
it further.

**Why this beats unscoped always-template on stated grounds, not by default:** (1) Q5's
data-driven prompt is a hard technical blocker unscoped always-template cannot clear
without redesigning that question entirely; (2) the reviewer's own promised benefit —
deleting B1, deleting 63016 — is achieved in full by the scoped version, so paying the
wider cost buys nothing additional on the one metric the argument for always-template was
actually made on. (The owner-send's committed §8 design was a second reason in the prior
revision — moot now that the owner-send isn't a WhatsApp send at all.)

**This changes B1, B3, and 3b below — each is revised in place, not left describing the
unscoped design.**

---

## 3a. The primitive — one function, and five WhatsApp events collapse to one shape;
`ownerSend` is not a sixth

**REVISED (this revision) — `eveningClose`/`ownerSend` were bundled together in the prior
revision as a single "structurally different" fifth send; #67's own revision (2026-08-15,
same day) decided the owner receives the DPR by email, not WhatsApp, which splits that
bundle in two. Restated cleanly below, not as a bundle.**

**The scheduled events are not one-sender-per-checkpoint.** Of the checkpoints in the
frozen schedule (`morningSend`, `morningNudge`, `morningEscalate`, `eveningSend`,
`eveningNudge`, `eveningClose`, `ownerSend`), **`morningEscalate` sends nothing**
(dashboard-only, confirmed in `bot-flows.md`: "NOT a WhatsApp push") and **`ownerSend` is
not a WhatsApp send at all** (email, per #67's decision — a different sender entirely,
outside this primitive's scope, built and owned by #67's own workstream, not sketched
here). **That leaves five real sends inside this primitive's scope**, and four of them —
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

**This is Part 1 §10's "six events, one mechanism" made concrete, narrowed to the events
this primitive actually owns.** The check-in sender doesn't need four code paths for four
checkpoints; it needs one call, invoked against whichever roster the checkpoint targets
(send: every active engineer; nudge: every active engineer not yet submitted —
`checkin_escalations`' own `status != 'submitted'` set). **`eveningClose`'s PM-notify is
the actual fifth send in this primitive's scope** — a DPR notification, addressed to a PM,
carrying a link, never touching `whatsapp_sessions` — different content from the four
engineer sends, same underlying transport concern (idempotency, template gating, failure
handling), which is why it belongs in this same primitive rather than a separate one.
**`ownerSend` (20:30) is explicitly OUT of scope for this primitive** — not a fifth or
sixth WhatsApp send, not something `sendTriggerMessage` needs to handle, not part of the
template-approval dependency below. **The primitive should be the generic WhatsApp
transport layer its actual callers share** (engineer check-ins + PM-notify), not a
catch-all for every nightly send regardless of channel.

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

### B3 — DECIDED this revision (options 1+3): "one call" holds intra-flow and BREAKS cross-flow

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

**DECIDED (round 3 external review, B-b): options 1 and 3 together, not option 2.** By the
time `eveningSend` fires (18:30), morning's own accountability window closed 3.5 hours
earlier (`morningCutoff`, 15:00) — the schedule has already treated that morning as over
for every purpose except the session's own `current_flow` value. Option 1 makes the session
state consistent with a decision the schedule already made; option 3 is a cheap backstop
for the case option 1's sweep somehow missed a session. Option 2 (BOT-21 queueing) is the
most faithful to the ORIGINAL spec but reopens a design question the schedule freeze (Part
1) implicitly already answered "no" to — see condition 3, below, for how this is recorded
against BOT-21 rather than silently overriding it. **Five conditions attached to this
decision, all required to appear in this plan — not optional follow-ups:**

**1. The fifth context-write site — the plan undercounted at four; there are five.**
Migration 022's own header ("CONTEXT DISCIPLINE — ONE RULE, FOUR SITES") predicted exactly
this gap: *"the exact trap for whoever adds a FIFTH site (Q5, a future flow, anything
touching context): copying the nearest existing line of code instead of the rule above."*
That fifth site exists, added by migration 024 for evening Pass 2, and any RPC change under
this decision touches session-context-writing code, so all five need to be on the table,
not four:

| # | Site | Where (current body) | What it writes |
|---|---|---|---|
| 1 | Morning START | `022:161-169` | `context - 'q2_reask' - 'q3_reask'` (strip morning's own in-flight counters only) |
| 2 | Morning Q4 COMPLETE | `022:219-227` | `(context - 'q2_reask' - 'q3_reask') \|\| {morning_submitted: true}` |
| 3 | Evening START | `025:229-239` (introduced `022:429-431`, extended `024:355-361`) | `context - 'e2_reask' - 'e4_reask' - 'e4_headcount' - 'e5_reask' - 'e6_reask'` |
| 4 | **Evening Q4b→Q5 transition — the fifth site** | `025:500-503` (introduced `024:542-544`) | `(context - 'e4_headcount') \|\| {e5_reask: 0}` |
| 5 | Evening COMPLETE | `025:691-698` (introduced `022:509-515`, extended `024:732-739`) | `(context - all evening reask keys) \|\| {evening_submitted: true}` |

Each has a TS "pure mirror" counterpart (`morning.ts`/`evening.ts`) that must stay in
agreement with it, same discipline as this project's other SQL/TS mirror pairs. **Found
while enumerating these, not asked for, flagged rather than silently fixed:** site 1's own
TS mirror (`morning.ts:188`) does a bare `context: {}` replace, not the strip the SQL side
got in migration 022 — the mirror's own header comment only claims to mirror the
`wrong_flow` outcome and the Q4-completion merge, not the START fix. This is a pre-existing
mirror/RPC divergence, not something this decision introduces, but it sits in exactly the
code this decision is about to touch — named here so it isn't rediscovered separately, not
fixed in this plan-only pass.

**2. Full external review gate — no shortcut.** Options 1 and 3 both modify
`apply_evening_flow_turn`'s (and, for option 1's sweep, possibly `apply_morning_flow_turn`'s
or a new function's) own logic — the SECURITY DEFINER flow RPCs — and touch session state
directly. This trips CLAUDE.md §0(a) on its own terms, independent of 3g's existing
"workstream as a whole" argument below: it is not "just an ELSE branch." No PR shipping
this fix goes without the full package 3g already requires for this workstream.

**3. BOT-21 needs a DATED supersession note, not an in-place edit.** `bot-flows.md`'s own
BOT-21 spec ("Same-day ACTIVE session at trigger time → add trigger to `pending_flows`,
send the trigger question immediately after the current flow completes") is option 2,
almost verbatim — and option 2 is the one NOT chosen. Editing that spec silently would
erase the record of what it originally said and why it changed. **Done as part of this
revision** (doc-only, matching this project's own "record the decision, don't silently
rewrite" discipline, same precedent as #67's own dated note to `bot-flows.md`'s "Late data"
section): a dated, struck-through note is added at BOT-21 in `bot-flows.md`, scoped
narrowly to the morning↔evening cross-flow case specifically — BOT-21's queueing behavior
is NOT being reversed wholesale, only for this one collision type; other trigger types
(safety-keyword-mid-flow, BOT-26's priority ordering) are unaffected and still queue via
`pending_flows` as spec'd. See that file for the exact note.

**4. The asymmetry with BOT-07 — stated explicitly, not left for a reader to notice.**
Morning and evening are NOT being treated identically here, and that's a real design
choice, not an oversight to smooth over. Under option 1, a morning session stuck active
past 15:00 gets FORCE-CLOSED same-day, hours before BOT-07's own next-IST-day reset would
otherwise touch it. Evening gets no equivalent same-day force-close — nothing in this
decision, or anywhere else in the current design, closes a stuck evening session before
BOT-07's ordinary next-day wipe. This is intentional, not inconsistent: evening is the LAST
flow of the day, so a stuck evening session has nothing downstream to protect the way a
stuck morning session threatens to block evening — but a future reader who assumes morning
and evening get symmetric treatment because they're "the same kind of thing" would be
wrong, and this plan should say so rather than let that assumption form quietly.

**5. The 15:00 sweep is a TRIGGER-CRON workstream dependency, not built in this PR.**
Same boundary the S section (below) already draws for the escalation sweep's own missing
cron: this decision needs a sweep that runs (or extends the existing escalation sweep) at
`morningCutoff`, and no cron for that exists in `vercel.json` today, and building one is not
this workstream's job. Noted here as a dependency and a handoff, not a gap this plan closes
— whoever builds the TRIGGER-CRON wiring inherits both this sweep and the escalation
sweep's own pre-existing missing-cron gap together, not as two separate discoveries.

**Every one of the three options was an RPC change — the "one mechanism" claim (3a) is
only true once the decided pair (1+3) ships, and both require touching the SECURITY
DEFINER flow functions.** This is the direct evidence behind the corrected §0(a) reading
(3g, revised below) — not a separate concern from it, and condition 2 above restates it as
a hard requirement rather than evidence for a separate argument.

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
  expected pre-launch state) on the FIRST skip of each **IST** day per template name — **NIT
  FIXED (round 3 external review, A4): this previously said "UTC day."** Every day boundary
  in this system is IST (Asia/Kolkata), never UTC (CLAUDE.md's own standing rule, and
  `cutoffs.ts`'s own header: "Consumers MUST convert now() to IST before comparing"). A
  UTC-keyed "first skip of the day" would flip over at 05:30 IST, not midnight — splitting
  one IST calendar day's worth of skips into two Sentry-alert windows (or merging the tail
  of one IST day with the head of the next), either of which defeats the "one alert per
  real day" intent this line exists for. Not on every skip — loud enough that the gap is
  visible in monitoring, not so loud it's self-defeating noise once templates are genuinely
  still pending for weeks.

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
one per (recipient, checkpoint, day). **NIT FIXED (round 3 external review, A4): the date
in that key was never pinned to a timezone — fixed here.** The date component is the IST
calendar date (`Asia/Kolkata`), matching this system's one convention for what "day" means
everywhere else (`log_date`, `cutoffs.ts`'s own checkpoints, `quoco_same_ist_day`) — never
the server's UTC clock. Stated explicitly because Vercel's `now()` is UTC and a naive
`toISOString().slice(0,10)` on it would silently key the same intended IST day differently
depending on whether the cron fires before or after 05:30 IST — the exact class of bug this
plan already had to catch once, on the same page, for the day-key in §3c's Sentry alert
window (A4, above). Computing it: derive from IST wall-clock at invocation time, the same
conversion `cutoffs.ts`'s own header mandates for every consumer, not a fresh derivation
invented for this key specifically.

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

### B2 (round 2) — the skip-and-record decision must precede the RPC call, not follow it

**Relabeled this revision, substance unchanged.** This finding is genuinely round 2's own —
it does not predate this document's revision 2. It is renamed `B2 (round 2)` only to stop
colliding with the ORIGINAL round-1 `B2` (§3e, above — `messaging_blocked`), which this
label previously and silently displaced.

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

## 3e. Failure handling — retryable vs. terminal, and B2 (round 1): `messaging_blocked` is
NOT a delivery-failure flag

| Failure | Retryable? | State left | How anyone finds out |
|---|---|---|---|
| Twilio 5xx / network timeout | Yes | `'sending'` (ambiguous, per 3d) | Sweep/reconciliation finds stale `'sending'` rows — B4, below, gives this a real source |
| Twilio 4xx — invalid/unreachable number | No — same number will fail again identically | `'failed'`, `error` populated | Sentry (error level — this is a real, actionable problem, not the expected template-gap state) |
| Template rejected (wrong category, unapproved variable shape) | No — same template, same rejection, every time | `'failed'` | Sentry — this is a configuration bug, always worth surfacing loudly |
| **Accepted synchronously, rejected asynchronously (error 63016 and others)** | **See B4 — this is the failure this table originally missed entirely** | — | — |
| Repeated terminal failure for ONE recipient across multiple sends | — | **`unreachable` — DERIVED, no column, no write. See B2 (round 1) below.** | Computed fresh from the send ledger whenever read; never a stored flag to go stale |

### B2 (round 1) — carried over unresolved for two revisions, fixed here

**The finding, exactly as it originally stood, not softened:** this section's own prior
draft proposed writing `messaging_blocked = true` on the `users` row after N consecutive
terminal send failures. **That is wrong, and it survived two revisions unaddressed because
the label that should have tracked it (`B2`) got reassigned to a different finding in
revision 2** (the process defect corrected in this revision's header table, above).

**Why it's wrong, checked against this codebase's own standing definition, not asserted
from first principles:** `messaging_blocked` was defined in migration 012 specifically as a
CONSENT gate — its own migration comment: "the webhook MUST refuse inbound from a number
that is not an ACTIVE, non-blocked user (BOT-08/ENG-02)." Every place that touches it
elsewhere in this codebase agrees, independently, on the same meaning: `lib/daily-logs/
status.ts` states outright that it is "ENGINEER opt-out/consent state, cleared only by the
engineer messaging in — NOT a PM silencing tool"; `lib/whatsapp/reactivation.ts` states the
only inbound that clears it is one gated solely by this flag from an otherwise-active
engineer; and to date, in the entire codebase, `clearMessagingBlock` is the ONLY writer
that has ever touched this column, and it only ever writes `false` — nothing anywhere has
ever set it `true` outside test fixtures (CLAUDE.md's own "BOT-27's SET-HALF DOES NOT
EXIST" entry, confirmed independently here by the same grep). **Had this section's original
proposal shipped, it would have been the FIRST-EVER writer of `messaging_blocked = true` in
this codebase — and it would have written it for the wrong reason.** A repeated delivery
failure (Twilio outage, carrier issue, the number no longer being on WhatsApp) and a
genuine opt-out (a real WhatsApp STOP) are different facts with different causes and
different remedies. Overloading the column means an infrastructure outage becomes
indistinguishable from a mass opt-out, and any future logic that reads `messaging_blocked`
to decide "should we ever message this person again" — including `reactivation.ts`'s own
gate, and the DASH-03 dashboard read this section originally cited as the payoff — makes
the wrong call the moment the two facts diverge.

**Fix chosen: option (ii), a status DERIVED from the send ledger — no new column.** Not
option (i) (`users.unreachable_since TIMESTAMPTZ`, a stored column set on failure and
cleared on success). Reasoning: 3d already designs an outbound-sends tracking table with a
per-message outcome (`sent` / `failed` / `skipped_no_template` / …) for every trigger send
— that table IS the send ledger this option needs, not a new thing to build. A derived
status can never drift out of sync with the ledger it's computed from, because it isn't a
separate fact that has to be kept in agreement with one — it IS the ledger, read a
different way. A stored `unreachable_since` column, by contrast, is a second copy of a fact
the ledger already contains, with its own write path and its own chance to go stale
(exactly the class of bug this project has hit before whenever two representations of the
same fact are required to agree by construction and nothing else — see CLAUDE.md's own
"HAND-MIRRORED RECONCILIATION" entry for the general shape of that risk).

**How it's computed, and how it clears — both stated, not left implicit; full specification
in C2, immediately below, which replaces the open-number/hand-wave version of this
paragraph from the prior round.** `messaging_blocked` is left exactly as this codebase
already defines it — a consent flag, written only by `clearMessagingBlock`'s existing
clear-half, with its still-open, still-tracked SET-half gap (a real WhatsApp STOP)
remaining exactly what CLAUDE.md already names it as: a separate, pre-launch, not-yet-built
piece of work that this primitive does not fix and was never positioned to fix correctly by
overloading this column.

### C2 — the unreachability derivation, fully specified (round 4 design review)

**Round 4 correctly called out that "derived from the send ledger" was a direction, not a
spec — not implementable as written. All four required parts, decided, not left open:**

**a. THRESHOLD — 3 consecutive terminal failures, not N-of-M.** `unreachable` is TRUE when
a recipient's most recent 3 outbound-send ledger rows (within the window, part b) are ALL
`'failed'`, with no `'sent'`/`'skipped_*'` row anywhere among them. Consecutive, not a
sliding "3 of the last 5" count: consecutive is simpler to compute (no combinatorics over a
larger row set) and avoids a genuinely reachable recipient with one bad day mixed among
several good ones being flagged on a technicality. 3, not 1 or 2: a single terminal
failure could be a one-off (a transient carrier-level rejection that happens to classify as
terminal); 3 independent trigger-send attempts — on different checkpoints, typically
different days — all failing is a much stronger signal that something about THIS recipient,
not one message, is broken.

**b. WINDOW — bounded to the last 7 days.** Only ledger rows from the last 7 days count
toward the 3. If fewer than 3 rows exist for a recipient in that window, they are NOT
marked unreachable — insufficient evidence, not a default-to-safe assumption in either
direction. **Why bounded at all, stated so this isn't read as arbitrary:** an unbounded
lookback means a recipient who had 3 failures months ago, then went quiet (e.g. left the
project, came back), would still read as `unreachable` today even though nothing about
their CURRENT reachability was ever tested — a ledger with no window is exactly the
"failure from three months ago still counts" bug named by the review question this answers.
7 days matches this system's own existing rhythm: roughly 4-5 trigger-send opportunities
per active engineer per day, so a genuinely broken channel produces well over 3 attempts
inside a 7-day window; a recipient who's been off-roster for that whole window simply
produces no rows to evaluate, which is the correct "insufficient evidence" outcome, not a
false positive.

**c. CLEARING — a single successful send in the SAME ledger, deliberately not an inbound
reply.** The moment a newer ledger row for this recipient shows anything other than
`'failed'` (a real send succeeded), "last 3 consecutive were failures" stops being true and
`unreachable` reads FALSE on the next read — no explicit clear-write, ever, for the same
reason nothing needed to write it TRUE either. **The asymmetry named explicitly, per
direct instruction: setting and clearing intentionally use the SAME signal type (both read
the outbound-send ledger), not different ones.** The alternative — clearing on a
successful INBOUND message from the recipient instead — was considered and rejected,
specifically because that is the signal `messaging_blocked` already uses to clear itself
(`reactivation.ts`). Using it here too would re-couple these two now-deliberately-separate
mechanisms (B2, round 1, above) through a shared clearing rule, even after their write
paths were split apart for exactly this reason — an inbound-based clear for `unreachable`
would mean a recipient stays `unreachable` even after a real outbound success, until they
also happen to reply, conflating "can we send to them" with "have they engaged," which are
different questions this fix already went to some trouble to keep separate.

**d. READ SITES — enumerated, one shared helper, not reimplemented per site.** Two
consumers need this value, both named, not left implicit:
1. **DASH-03/PM dashboard surface** — a derived read for PM visibility, as already stated
   above.
2. **Escalation alert-text generation (C3, below)** — the PM-facing copy for an escalated,
   currently-unreachable engineer reads differently than for one who simply hasn't
   responded; that branch needs this value too.

Both call the SAME function — a shared helper (e.g. `computeUnreachable(recipientId,
client): Promise<boolean>` in `lib/whatsapp/` or `lib/checkin-escalations/`, not sketched
further than its shape here) — never two independent re-derivations of "last 3 consecutive
failures within 7 days." **Stated as a hard requirement, not a style preference:** a value
computed in more than one place with more than one definition is the exact class of defect
B2 (round 1) just finished fixing for `messaging_blocked` — reintroducing it here, for a
DIFFERENT status this same section just designed, would undo the lesson in the same
document that names it.

**R5 (round 5 design review) — low-volume-recipient sanity check on threshold+window,
answered: engineers only, and checked one edge deeper than that.** Both read sites above
(DASH-03, escalation alert-text) are specifically engineer check-in surfaces — re-checked
against their own definitions, not assumed: DASH-03 is the daily-logs PM triage board
(engineer status per day), and the escalation alert-text is `checkin_escalations`'
own PM-facing copy for engineer nudge/escalate. **Nothing in this plan calls
`computeUnreachable` for a PM**, even though `eveningClose`'s PM-notify writes to the SAME
underlying outbound-send ledger table (3a) — the derived read is simply never invoked
against a PM recipient anywhere this plan specifies. One edge checked further, not just
asserted: even if a future PM-facing surface ever DID call this helper, the threshold/
window combination would not silently break for PM-notify's own lower volume (1 send/day
vs. an engineer's ~4/day across the four checkpoints) — 3 CONSECUTIVE failures needs only 3
of the 7 daily opportunities a 7-day window provides for ANY checkpoint that fires at least
once per day, so the aging-out failure mode (the earliest failure expiring before a third
arrives) only bites a recipient class with FEWER than 3 send-opportunities across 7 days.
No checkpoint in this primitive's scope — engineer or PM — fires less often than daily, so
that edge does not exist for anything currently in scope, named as-checked rather than
assumed safe.

### C3 — does escalation advance for an unreachable engineer? DECIDED: yes, with the alert text changed

**Product question, both answers defensible, decided rather than left open, per direct
instruction.** Adopted: **escalation continues to advance for an unreachable engineer —
time-based, never skippable, per design principle 7.2 — but the PM-facing alert text
changes when the derived `unreachable` read (C2) is true at the moment the alert is
generated.** Not "engineer has not responded" (implies: wait, they may still answer) but
**"engineer unreachable since `<time>`"** (implies: the channel itself may be broken —
consider a different action, a phone call, a site visit, not another WhatsApp nudge).

**Why YES over NO, weighed against both named principles, not defaulted to:** the NO
position (escalating over a dead channel is noise the PM can't act on, violating 4.2 —
"every alert carries its action") has real force, but it assumes the alert's only possible
action is "wait for a WhatsApp reply." **That assumption is exactly what the changed alert
text removes.** An unreachable engineer is precisely the case where the PM most needs to
know something is wrong (7.2's own reasoning) — silencing escalation for exactly the
recipients whose channel has failed would mean the PM finds out LATER, not sooner, for the
worst cases. Changing the text is what keeps 4.2 satisfied at the same time: the alert
still carries an action, it's just a different one (call/visit, not wait), read directly
off C2's own derived value at generation time. **Where this is read:** the same
`computeUnreachable` helper (C2d) — whatever generates PM-facing escalation copy
(`checkin_escalations` sweep / dashboard surface) branches its text on that one call, not a
second, independent unreachability check.

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
that may never have reached the recipient; the derived `unreachable` read (3e, B2 round 1)
never reflects this failure class, because from this primitive's own ledger perspective
nothing failed — an async-only failure never lands a `'failed'` row at all without this
route. **Plan a status-callback route now, as part of this workstream, not a later
addition:**

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
  Twilio error code preserved on the ledger row — the input the derived `unreachable` read
  (3e, B2 round 1) counts — and for Sentry).
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
- **NEW (round 3 external review, A3) — log Meta's per-message `pricing` object in full,
  from the first deployment of this route, as a day-one requirement, not a follow-up.**
  Twilio's status-callback payload carries Meta's own returned `pricing` object on the
  relevant status updates (billability category, pricing model, billable flag) — this is
  the empirical ground truth for whether a given message was actually billed, and at what
  rate, as opposed to what this plan's own economics figure (§3g condition (e), A2) predicts
  from a rate card. **Store it raw, unprocessed, on every status-callback row this route
  writes** (a JSONB column on the status-update/outbound-send record — exact column named
  in the review package, not sketched to SQL here). Without this, the day the October
  pricing change actually lands, this project would have no way to confirm it landed, or at
  what rate, except by watching an invoice arrive — the same "reasoning from a rate card
  instead of from invoices" gap this finding exists to close. Logging costs nothing extra
  (the payload already arrives at this route for every status update); not logging it means
  re-deriving this exact requirement later, after the fact, with no historical record to
  backfill from.

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

**RESOLVED this revision (B-c): no retroactive revert, ever.** Because step 3 fires on
`accepted` (synchronous), not `delivered` (async, B4), a message that's accepted then later
fails asynchronously will have already stamped `nudge_sent_at` — technically true ("Twilio
was asked to send this"), but not what a PM reading "nudged" on the dashboard would assume.
This was previously left as an open design question — whether a later `failed`
status-callback should revert `nudged` back to its prior rank. **Ruled: it should not.** On
async send failure, `nudged` is NOT reverted; the rank machinery stays advance-only in both
directions this table touches. **Rationale, stated so the "why" survives independent of the
rule:** an advance-only rank is monotonic, and a monotonic value is safe to reason about
from any concurrent reader without needing to know WHEN it was read relative to other
writers — any reader sees a rank that only ever moves forward. A revert breaks that
property: it introduces a real race between the async status-callback's revert-write and
any concurrent reader (the sweep, a dashboard query, a future consumer) that already
observed `nudged` and acted on it — "was this engineer nudged" would stop having one
stable answer and start depending on read-timing relative to an async event with no fixed
latency. The PM-facing imprecision this tension named (a message that "looks nudged" but
never arrived) is real, but it is B4's problem to solve — via the `accepted`/`delivered`
distinction B4 already draws, and via the ledger's own `failed` row, both queryable
independently of `checkin_escalations.status` — not something `nudged`'s own rank should
be made to carry by rewinding.

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
- **(e) "Moves money."** **Trips, unambiguously — and the amount is larger than this plan
  had accounted for, per a NEW finding from round 3 external review (A2), stated here
  because this is the condition it belongs under.** The trigger-send template cost
  (~₹0.115+ per the Authentication-template figure recorded tonight; check-in templates'
  own Utility-category rate separately) is real, but it is the SMALLER of two costs this
  change introduces, not the whole picture. **The same governance change that makes trigger
  sends billable (§0) also makes every IN-FLOW reply billable** — the free-form replies
  this plan deliberately keeps free-form and unconditional for Q2 through Q6,
  `already_complete`, and `reask` (§0/3b) become service messages, and post-October, a
  service message is billed at the same per-message rate as a template. **Approximately
  9-15 outbound service messages per engineer per day** (one per parser turn, re-ask, and
  confirmation across both flows) dwarfs the 4-5 trigger sends this section was originally
  scoped around — the trigger sends are a rounding error next to this. Per-engineer,
  per-month, post-October:

  ```
  (4 templates + ~10 service replies) × PER_MESSAGE_RATE_INR × WORKING_DAYS_PER_MONTH
  ```

  **`PER_MESSAGE_RATE_INR` is a named, open variable, not a guess.** Per direct instruction,
  not fabricated here: this must be sourced from Meta's own published rate card for the
  India market (the same per-market rates §0 already notes are due by 1 September 2026, not
  yet available at the time of this revision) — the ~₹0.115+ figure above is the
  Authentication-template rate recorded earlier this session, a different category with its
  own rate, not a stand-in for the Utility/service rate this formula needs. **This does not
  change the always-template scoping decision (§0/A1)** — free-form-for-in-flow was chosen
  for reachability-safety reasons that hold regardless of price, and the same messages
  would be billable whether sent free-form or as a template once the exemption lapses — but
  it materially changes the total cost this workstream commits the product to, and belongs
  in the pricing model the moment `PER_MESSAGE_RATE_INR` is known. **Also flagged in #67's
  plan** (per direct instruction, as an input to that plan's own cost awareness, even though
  #67 does not own any of these sends) since #67's stage 1 (PM-notify) shares this
  primitive's template-billing exposure.

**Net, corrected: (a), (b), (d), (e) all trip; (c) is a judgment call recorded, not
silently assumed. Per §0's own rule — "if ANY migration in the PR trips a trigger, the
WHOLE PR needs the package" (generalized here from "migration" to "this workstream," same
reasoning §0 already applies to non-migration changes elsewhere in its own text) — this
requires the full external-review package before shipping, the same path 028 went
through.** Not assumed in either direction going in, evaluated condition by condition, and
the answer came out requiring review on FOUR independent grounds, not one borderline call —
strengthened, not merely maintained, by round 1's own correction.

---

## THE ENTANGLEMENT with #67 — REWRITTEN this revision; PM-notify only, owner-send resolved

**Previous revision's conclusion — "both of #67's sends are `skipped_no_template` on every
attempt" — no longer holds for both.** #67's own same-day revision (2026-08-15) decided
the owner receives the DPR by email, not WhatsApp, which resolves this plan's own
"fifth send" content-shape question for `ownerSend` — not by this plan specifying a
template contract, but by `ownerSend` leaving WhatsApp, and this primitive's scope,
entirely. Restated stage by stage, since the two are no longer symmetric:

**PM-notify (`eveningClose`) — UNCHANGED, still fully entangled.** The PM never messages
the bot, so their WhatsApp window is always closed, so PM-notify is unconditionally a
template send, and is `skipped_no_template` on every attempt until Meta approves the
relevant template — exactly the prior revision's finding, now describing one send instead
of two. **#67's `delivery_status` state machine (its own `pm_notified` value, and the
`skipped_no_template` value #67 added) already accounts for this** — confirmed by reading
#67's current revision, not assumed: `skipped_no_template` is explicitly scoped there to
`pm_notify` only, matching this primitive's own vocabulary exactly, deliberately mirrored
rather than independently reinvented on either side.

**Owner-send (`ownerSend`) — RESOLVED, no longer entangled with this primitive at all.**
It is not a WhatsApp send, is not part of `sendTriggerMessage`'s roster, does not depend
on Meta template approval, and cannot be `skipped_no_template` — an email send has its own
success/failure shape (#67's own new email-provider dependency, its §2g), unrelated to
this primitive's template-gating problem. **This plan's own 3a already reflects the
narrowed scope** (`ownerSend` explicitly named out of scope, this revision) — restated
here so the entanglement itself doesn't read as unresolved when it isn't, for this stage.

**Net: one open, shared dependency remains (PM-notify ↔ Meta template approval), not
two.** The owner-send is no longer a joint problem between these two plans — it's #67's
alone, and a different kind of problem (email deliverability, not WhatsApp template
approval).

---

## Summary of what remains before this can be built

1. Decide the exact new table shape for outbound-send tracking (3d) — not sketched to SQL
   here, deliberately, since that's a schema decision for the review package, not this
   plan. **This revision adds a requirement to it (A3): a JSONB column for Meta's raw
   `pricing` object, logged from day one on the status-callback route.**
2. **FULLY SPECIFIED this revision (C2):** the derived `unreachable` read (3e, B2 round 1)
   — 3 consecutive terminal failures, bounded to a 7-day window, clearing on the next
   successful send in the same ledger (deliberately not an inbound reply — kept separate
   from `messaging_blocked`'s own clearing signal), computed by one shared helper for both
   read sites (DASH-03 and escalation alert-text, item 9 below), not reimplemented per
   site. `messaging_blocked` is not written by this primitive at all, this revision — fixed
   from a prior proposal that would have set it for the wrong reason.
3. **DECIDED this revision:** B3's cross-flow interference fix — options 1 (cutoff-close
   sweep) + 3 (force-switch backstop) together, not option 2. Five conditions attached
   (§3b, above), all carried into the review package: the fifth context-write site, the
   full-gate requirement, BOT-21's dated supersession, the stated BOT-07 asymmetry, and the
   TRIGGER-CRON handoff for the 15:00 sweep itself.
4. Build the status-callback route (B4) as part of this workstream, not a later addition —
   **now including A3's pricing-object logging as a day-one requirement, not a follow-up.**
5. **Narrowed this revision:** resolve the entanglement with #67 for PM-notify only — the
   owner-send half is resolved (#67's email decision) and no longer a shared open question.
6. Full external-review package (3g) before any migration or code ships — still trips on
   FOUR grounds; unaffected by the owner-send leaving this primitive's scope. **The
   per-message economics (A2, §3g condition (e)) belong in that package's cost accounting:
   4 templates + ~10 service replies per engineer per day, not templates alone —
   `PER_MESSAGE_RATE_INR` remains an open, named variable pending Meta's India rate card.**
7. This is the actual precondition for the product functioning — nothing else in this
   session's three parts tonight can run in production until this exists. **Scope is now
   five WhatsApp sends (four engineer checkpoints + PM-notify), not the DPR delivery
   pipeline as a whole — `ownerSend`/email is #67's own precondition to build, separately.**
8. **RESOLVED this revision (B-c):** no retroactive revert of `nudged` on async send
   failure, ever — advance-only ranks stay advance-only. Rationale in 3f.
9. **RESOLVED this revision (A1):** always-template for the five trigger sends is adopted
   now, unconditionally — not gated on the October date, which appears only in cost
   projections (item 6, above) from this revision forward.
10. **DECIDED this revision (C3):** escalation continues to advance for an unreachable
    engineer — never skippable, per 7.2 — but the PM-facing alert text changes to "engineer
    unreachable since `<time>`" instead of "has not responded" when item 2's derived
    `unreachable` read is true, so the alert keeps carrying a real action (4.2) even though
    that action is no longer "wait for a reply."
11. **NAMED this revision (C1):** A4's two IST/UTC fixes are cited by exact file:line in
    the revision header, above, not just by section —
    `docs/outbound-send-primitive-plan.md:539` and
    `docs/outbound-send-primitive-plan.md:565` as of this revision's own commit. **R4
    FIXED (round 5 design review): this line previously abbreviated the
    second citation to bare `:527`, no filename — the exact defect flagged.** Both now
    carry the full filename independently, not implied from the first.

Nothing built in this pass. Branch/PR for this document only — the one exception is the
dated, doc-only BOT-21 supersession note in `bot-flows.md` (B3 condition 3, above), same
provenance discipline as #67's own prior dated note to that file.
