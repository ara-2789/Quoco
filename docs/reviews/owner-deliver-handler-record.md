# owner_deliver job handler — build record and three decisions

**Status: BUILT, 2026-09-02.** Application code only, per explicit scope — migration 034 is
already live on production, so this handler reads/writes an existing schema, no migration
file, no apply. Recorded here rather than in `design-decisions-beta-feedback.md` because
that file is already at 206,040 chars, well past CLAUDE.md's own 120,000-char "plan a
split" threshold — adding to it would be the exact mistake that rule exists to prevent.

## Decision 1 — job granularity: per (project_id, log_date), not per engineer

Neither `decideOwnerDeliveryRoute` (`lib/dpr/owner-delivery-route.ts`) nor `renderEmailReport`
(`lib/dpr/render-email.ts`) decide whether the owner receives one send per engineer or one
aggregated send per project-day — both explicitly name this as unbuilt, left to "whoever
builds the ownerSend handler." Decided here: **one job per project-day**, fetching every
`dprs` row for that project+date, because (a) `dpr-delivery-versioning-plan.md` §2a
describes the 20:30 send as operating over "whatever `dprs` currently holds" for the
project, and (b) 034's own PROPAGATION GAP note requires the no-report notice be sent
**once** per owner per project-day, not once per engineer — which a per-engineer job could
not implement without either duplicate sends or an external dedup mechanism.

## Decision 2 — the report path sends per engineer — OPEN PRODUCT QUESTION, NOT DECIDED

**Built as scoped: an owner with four engineers on one project gets four separate emails
at 20:30, one per engineer's report.** This is consistent with `dprs` being per-engineer
end to end (028's key widening) and is what `renderEmailReport` already produces (one call
= one engineer). It is **not** the same question as Decision 1 — the notice path is
deliberately de-duplicated to one send; the report path is not, because each engineer's
report is a genuinely distinct document, not a duplicate of another.

**The trade, named, not resolved:**
- **Per-engineer (built)** preserves the DPR's own structure — each report stands alone,
  traceable to one engineer's Facts, matching how `dpr_versions`, `delivery_status`, and
  every other per-row artifact in this system already works. No aggregation logic to get
  wrong.
- **One combined email per project-day** is closer to what an owner probably wants to
  receive — a single digest, not four separate emails arriving at the same minute, one per
  site engineer.

**Not decided here, per explicit instruction — this is a product call to make once a real
owner report exists to look at, not a technical one to resolve by argument.** If a change
is wanted later, it is a change to this file's own send loop (batching N engineers' bodies
into one email) — `renderEmailReport`'s own per-engineer contract does not need to change,
since a combined email would still call it once per engineer and compose the results.

## Decision 3 — the terminal-value skip

**Decision, not merely observed:** this handler will not re-send to a `dprs` row already at
a stage-2 terminal `delivery_status` (`delivered`, `owner_send_failed`, `no_report_sent`,
`no_report_failed`, `skipped_unverified`). **Reason:** a retried job (network blip,
exponential backoff, a partial-batch failure on an earlier attempt) must not re-send a real
email or WhatsApp message to an owner who already received it. There is no claim-before-
send ledger for this handler the way `outbound_sends` insulates the engineer checkpoints
(031) — this same-row-already-terminal check is what stands in for one. See
`lib/dpr/owner-deliver-dispatch.ts`'s own header for the full reasoning and the asymmetry
with stage 1 (PM-notify), which this handler is documented to unconditionally overwrite.

## The gap this handler does not close, stated so it isn't discovered later

Every REPORT-route row this handler processes today writes `skipped_unverified` on its
first attempt, because `notification_email_verified_at` is `NULL` for every owner row that
exists — the confirm-email route that would ever set it (034 §5/§12f) is not built. Three
things must exist before owner delivery reaches anyone at all, none built by this entry:

1. The confirm-email route (034 §5/§12f).
2. The beta-provisioning operator script that creates a real `role='owner'` row with a
   `notification_email` in the first place (034 §2j/A1).
3. The eveningClose/ownerSend cron entry that actually calls
   `enqueueJob('owner_deliver', { project_id, log_date })` — confirmed by grep, nothing in
   this codebase calls it anywhere, and that remains true after this entry.

A green test suite for this handler means the receiving end is ready, not that owner
delivery works today.

## What's tested locally vs. what needs a real provider

**Tested locally** (mocked `fetchFn`/injected send functions, real test-db for the
integration test): the routing fan-out (which rows go to report vs. notice), the
`skipped_unverified` gate on both paths, the terminal-value skip, payload construction
through the injected send seam (asserting `sendEmail`/`sendWhatsAppTemplate` are called
with the right arguments), the copy-drift test, and the batch-write fan-out against real
test-db (one send outcome written to every row in `noticeRows`/`reportRows` as appropriate).

**Cannot be tested locally, and are not claimed to be:**
- Any real send to Resend or Twilio — no live credentials in this sandbox.
- The async bounce/complaint webhook path (`delivered -> owner_send_failed`,
  `no_report_sent -> no_report_failed`) — legal, expected transitions per 034's own
  transition table, but the webhook that would ever write them (§2g) does not exist.
- Genuine concurrent job claims — this project's own standing rule: concurrency/lock/race
  verification is CI-only in this sandbox (`docs/reviews/sandbox-cannot-test-concurrency.md`).

## Raw fetch for the email provider, not an SDK — reason recorded

Matches `lib/whatsapp/outbound/send.ts`'s own house style, deliberately: owning the request
and response is what made this week's Twilio diagnoses possible. The XML-vs-JSON
default-response bug (`docs/reviews/first-cron-fire-record.md`) was only findable and
fixable because this codebase controls the request URL directly; an SDK method call would
have hidden that decision inside the library. PR #135's response-shape capture depended on
reading the raw response body/headers — an SDK returning an already-parsed result object
gives nothing to capture. Same reasoning applied to `lib/email/send.ts` before a single
real email has ever been sent, not after an equivalent incident.

## The async-failure gap on both send branches is one open dependency, not two — recorded, not fixed (2026-09-03)

Both stage-2 send branches write a `STAGE_2_TERMINAL` `dprs.delivery_status`
(`no_report_sent` on the WhatsApp side, `delivered` on the email side) the moment the
provider's SYNCHRONOUS accept comes back ok — never on confirmed delivery. A terminal value
is never revisited (`classifyDprRowForStage2` treats it as `already_terminal` forever), so
if the provider fails ASYNCHRONOUSLY after accepting — a WhatsApp send render-rejected or
sent to an unreachable number, an email bounce or spam complaint — nothing in this codebase
ever corrects the row. This is the same underlying gap on both channels, not two separate
bugs:

- **WhatsApp**: `owner-deliver-dispatch.ts` calls `sendWhatsAppTemplate()` directly, not
  `lib/whatsapp/outbound/trigger.ts`'s claim-before-send flow — so no `outbound_sends` row
  is ever written for this send. A real async failure callback from Twilio has no
  `twilio_sid` to match against; `app/api/whatsapp/status-callback/route.ts` finds zero rows
  and emits only a decorrelated Sentry WARNING, fingerprinted by the message SID alone, not
  linked to the project, log_date, or `dprs` row it belongs to.
- **Email**: no Resend bounce/complaint webhook route exists in this repo at all — not even
  an unwired one, confirmed by grep. §2g, named in `034-owner-email-review-package.md`, is
  still unbuilt.

**Fixing the WhatsApp half in isolation would not close this gap.**
`034_owner_email_delivery.sql`'s own PROPAGATION GAP comment already names the real missing
piece: no mapping exists from a provider-message row back to the right `dprs` row(s), and
the relationship is **one-to-N, not 1:1** — one no-report notice is sent per owner per
project-day, while `dprs` rows are per engineer. Routing the WhatsApp send through
`trigger.ts`'s ledger, on its own, would leave `outbound_sends.status` correctly `'failed'`
while `dprs.delivery_status` stays silently wrong — a fix that *looks* closed and isn't,
worse than the open gap it replaces because it stops looking suspicious.

**Decided: accept the gap, do not half-fix it.** Do not wire the WhatsApp send into
`trigger.ts`'s ledger without the `outbound_sends → dprs` propagation logic built alongside
it — the propagation layer is the one future piece of work that closes both channels
together, not "give WhatsApp a ledger row" as a smaller task on its own. No owner row exists
in production yet for either channel to reach today (§"The gap this handler does not close"
above), so there is no live exposure behind this decision. Recorded in
`lib/dpr/owner-deliver-dispatch.ts`'s own header alongside this entry.

**Correction to the record.** An earlier description of this gap, in conversation,
characterized Twilio error 63015 landing as a zero-match/decorrelated Sentry event as an
OBSERVED 2026-08-30 production incident. It was not — checked directly against
`docs/reviews/first-cron-fire-record.md` and `first-successful-delivery-record.md` before
this entry was written. The 2026-08-29 63015 incident never captured a `twilio_sid` at all
(a separate XML-parsing bug), so that row never reached `status='sent'` and the zero-match
scenario was explicitly **not confirmed** to have occurred; the 2026-08-30 event was a
different error (63027) whose callback matched correctly and flipped `sent` → `failed` as
designed. The zero-match orphan-callback scenario described above is a real, argued,
**anticipated** risk in this codebase — not observed history. Recorded here so the next
reader doesn't inherit the same misattribution.
