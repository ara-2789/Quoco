# PLAN ONLY — the outbound WhatsApp send primitive (2026-08-15)

**Status: PLAN ONLY. No implementation. No migration. No code touched.** Part 3 of
tonight's session (Part 1: PR #66/#68, MVP schedule freeze; Part 2: PR #67, two-stage DPR
delivery/versioning). This is the precondition for the product functioning at all — as of
tonight's diagnosis, no production mechanism starts a check-in in either flow, so nothing
downstream (parsers, the per-engineer DPR pipeline, the escalation queue) can ever run.

**Read in full before writing this:** `lib/checkin-escalations/reachability.ts`,
`lib/whatsapp/{dispatch,idempotency,normalise,reactivation,session}.ts`,
`lib/whatsapp/flows/{morning,evening,test-trigger}.ts`, `lib/daily-logs/cutoffs.ts`.

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

## 3b. Template vs. free-form — decided by WINDOW STATE, not event type

**Worked out per event, from `determineReachability`, not from which of the four sends it
is:**

| Event | Recipient's window | Free-form possible? |
|---|---|---|
| `morningSend` to an engineer who never messaged, or last messaged >24h ago | closed | No — template required |
| `morningSend` to an engineer who replied to something (e.g. a prior day's flow) within 24h | open | Yes |
| `morningNudge` to an engineer who already answered Q1 nine minutes ago (mid-flow) | open (their own answer reopened it) | Yes |
| `morningNudge` to an engineer silent since yesterday | closed | No — template required |
| `eveningSend`/`eveningNudge` | same logic, evaluated fresh each time — the window is per-recipient, per-instant, not per-event-type | — |

**The stated example in the task is exactly right and generalizes:** a 10:00 nudge to an
engineer who replied at 08:35 has an open window (< 24h since `whatsapp_sessions.
updated_at`); the identical nudge to someone silent since yesterday does not. `
determineReachability(sessionUpdatedAt, now)` (already built, `reachability.ts`, currently
unconsumed) is the entire decision — call it fresh, per recipient, per send, immediately
before choosing the branch. **Never cache or precompute window state across a checkpoint's
whole roster** — batch-fetching the raw `updated_at` values via `fetchSessionWindows` is
fine (already built for exactly this), but the open/closed DECISION must be evaluated
per-recipient at send time, since two engineers at the same checkpoint can be on opposite
sides of the boundary.

## 3c. The template gap — the important one, per the task's own framing

**Templates are not approved yet.** This primitive can be complete, correct, and unable to
send anything the moment `decideSendShape` returns `'template'` for a closed-window
recipient. **Design for that state explicitly — do not let it silently do nothing.**

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

## 3e. Failure handling — retryable vs. terminal, and the `messaging_blocked` gap this closes

| Failure | Retryable? | State left | How anyone finds out |
|---|---|---|---|
| Twilio 5xx / network timeout | Yes | `'sending'` (ambiguous, per 3d) | Sweep/reconciliation finds stale `'sending'` rows |
| Twilio 4xx — invalid/unreachable number | No — same number will fail again identically | `'failed'`, `error` populated | Sentry (error level — this is a real, actionable problem, not the expected template-gap state) |
| Template rejected (wrong category, unapproved variable shape) | No — same template, same rejection, every time | `'failed'` | Sentry — this is a configuration bug, always worth surfacing loudly |
| Repeated terminal failure for ONE recipient across multiple sends | — | **`messaging_blocked = true`** | Named status on the row, not silence |

**The last row is the actual point of cross-referencing `messaging_blocked` (Rule 4.4).**
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

## 3f. `nudged` / `nudge_sent_at` — this primitive is the honest writer PR #59 deferred

**PR #59's `sweep.ts` deliberately never writes `status='nudged'`**, because writing it
would mean claiming `nudge_sent_at` before anything was actually sent — exactly the "false
fact" this project's own §0 discipline refuses to ship (`status.ts`'s own CORRECTION 1
comment states this explicitly). **This primitive is the thing PR #59 was waiting for.**

**Exactly where, relative to the Twilio call, stated precisely:** `nudge_sent_at` is set
**after** the Twilio call succeeds (or, for the free-form branch, after the send API call
returns success) — never before, and never merged into the claim-before write from 3d
(that write only ever says "sending," not "sent"). The two-step shape:
1. Claim (3d) — `status: 'sending'`, no `nudge_sent_at` yet.
2. Twilio call.
3. On success: update the outbound-send row to `'sent'` **and**, in the same statement or
   an immediately-following one, write `checkin_escalations.status = 'nudged'` +
   `nudge_sent_at = now()` for this (engineer, half, date) row — the DB write
   `determineTargetStatus`'s own rank table already accounts for (`nudged: 1`) but that
   nothing currently ever transitions TO.
4. On failure: `nudge_sent_at` is never touched. The escalation row stays wherever the
   sweep's own clock-driven logic already put it (`awaited`/`escalated`) — a failed send
   attempt does not fabricate a sent-at time.

## 3g. §0 evaluation, condition by condition, §0's actual wording quoted

Quoting `CLAUDE.md` §0 directly, not paraphrased, against this specific primitive:

- **(a) "CREATES OR MODIFIES a live function's LOGIC... Narrowed to logic deliberately."**
  This primitive is designed to need **no new or modified Postgres function** — the
  idempotency claim (3d) is a plain `INSERT` against a new table with a unique constraint,
  same pattern as `isNewMessage`'s app-layer check, not a stored procedure. As designed:
  **does not trip (a).** Flagged as a design constraint to hold during implementation, not
  a guarantee independent of how it's actually built — if implementation finds it needs a
  claim RPC after all, (a) would need re-evaluating then.
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

**Net: (b), (d), (e) trip; (a) does not as designed; (c) is a judgment call recorded, not
silently assumed. Per §0's own rule — "if ANY migration in the PR trips a trigger, the
WHOLE PR needs the package" (generalized here from "migration" to "this workstream," same
reasoning §0 already applies to non-migration changes elsewhere in its own text) — this
requires the full external-review package before shipping, the same path 028 went
through.** Not assumed in either direction going in, evaluated condition by condition, and
the answer came out requiring review on three independent grounds, not one borderline call.

---

## Summary of what remains before this can be built

1. Decide the exact new table shape for outbound-send tracking (3d) — not sketched to SQL
   here, deliberately, since that's a schema decision for the review package, not this
   plan.
2. Decide the terminal-failure-count threshold for `messaging_blocked = true` (3e).
3. Full external-review package (3g) before any migration or code ships.
4. This is the actual precondition for the product functioning — nothing else in this
   session's three parts tonight can run in production until this exists.

Nothing built in this pass. Branch/PR for this document only — no code.
