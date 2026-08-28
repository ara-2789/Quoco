# Inbound-as-start-trigger — TS-only plan (II3)

**SUPERSEDED-BY-DESIGN (2026-08-20, PP2 — design-decisions-beta-feedback.md §27), NOT BY
BUG. Everything below still describes what is actually running in production today and
remains accurate as a description of it — but the permanent design decided in §27 is
that check-ins are CRON-triggered, never inbound-triggered. `routeInboundMessage`'s
no-active-session branch (everything this plan specifies) is SCAFFOLDING: correct and
intended to keep running exactly as built until the outbound-send primitive (#69/031)
and its trigger cron exist, at which point this branch is replaced by a short
acknowledgement — not extended, not kept alongside the cron as a second entry point. Read
§27 before treating any part of this plan as the long-term design.**

**Status: BUILT (2026-08-20, JJ1 go-ahead) — `lib/whatsapp/inbound-start.ts`,
`routeInboundMessage`, wired into `app/api/whatsapp/webhook/route.ts` in place of the
previous direct `dispatchInboundTurn` call. Pure-TS as planned: no migration, no RPC
change. The one plan ambiguity (which existing reply text fires on "both submitted")
was resolved by explicit confirmation before implementation: `EVENING_ALREADY_COMPLETE_
REPLY`, not the morning equivalent — see that branch's own code comment for the
reasoning. Tests: `test/inbound-start.test.ts` (the full (a) window matrix,
already-submitted-then-messages-again, flow-active delegation) and
`test/webhook.test.ts` T-WH-11/T-WH-12 (end-to-end wiring proof). No env flag — decided
and justified in `inbound-start.ts`'s own header comment. The refuse-when-submitted RPC
fix (design-decisions-beta-feedback.md §10, decided 2026-08-15) remains NOT bundled here
— it trips §0(a) and needs the full external-review path. Ships separately, on its own
timeline; this build's (b) mitigation exists specifically to hold that gap closed until
it does.**

**RETIRED, 2026-08-28 — the prediction in the header above came true.**
`routeInboundMessage`'s no-active-session branch no longer calls `apply_
morning_flow_turn`/`apply_evening_flow_turn` with `startFlow: true` for
anything. It now returns one of four static replies (the two window-guard
refusals this plan's own §35a work added later, plus two new acknowledgement
strings, `design-decisions-beta-feedback.md` §38) -- never starts a flow.
The cron (Pass 1 items B-F) is the sole flow-starter now, per §27's own
decision this file already anticipated. `lib/whatsapp/inbound-start.ts`'s
own header carries the current design in full; this plan document is a
historical record of the scaffolding it describes, not the current
behaviour.

## Scope boundary, stated first

This plan covers ONLY the case `readCurrentFlow` returns null (no active session) for a
registered, gated-clear engineer. If a flow IS active, `dispatchInboundTurn`'s existing
ordinary-reply routing already handles it correctly and is untouched by this plan.

## (d) Unknown sender — confirmed unchanged

Registration, gate, and idempotency checks (`app/api/whatsapp/webhook/route.ts:158-266`)
all run BEFORE `dispatchInboundTurn` is ever called (route.ts:302). An inbound from an
unregistered number never reaches this logic at all — `notRegisteredResponse()` fires
first, same as today. Nothing in this plan touches that path.

## (a) Flow selection — every window, including the one that was missing

The earlier HH1 answer ("before evening window and morning not submitted → morning, else
evening") did not cover the after-hours case: an inbound at 22:00, after the 19:45 report
has already generated. Starting evening then collects data with nowhere to land — a dead
end, Rule 3.5. Full window table, using `CHECKIN_CHECKPOINTS`
(`lib/daily-logs/cutoffs.ts`) as the clock, and `daily_logs.morning_submitted_at`/
`evening_submitted_at` (NOT session context — see (b) below) as the submission source:

| Window (IST) | Morning state | Evening state | Action |
|---|---|---|---|
| Before `morningSend` (00:00–08:30) | not submitted | — | **Start morning.** No reason to gate an early-arriving engineer — the schedule reminds, it doesn't restrict. |
| `morningSend`–`eveningClose` (08:30–19:45) | not submitted | — | **Start morning.** |
| `morningSend`–`eveningClose` (08:30–19:45) | submitted | not submitted | **Start evening.** Judgment call, named explicitly: an engineer finishing early and volunteering the evening report before 18:30 is accepted rather than refused — Rule 3.5's "never dead-end" outweighs the risk of a slightly-early "workers on site right now" answer. If Aravind wants evening gated to not start before `eveningSend`, that's a one-line change to this table, not a structural one. |
| `morningSend`–`eveningClose` (08:30–19:45) | submitted | submitted | Both done — reply with the EXISTING `MORNING_ALREADY_COMPLETE_REPLY`/`EVENING_ALREADY_COMPLETE_REPLY` text directly, WITHOUT calling either RPC (see (b) — this is the TS-side mitigation firing). |
| After `eveningClose` (19:45 onward, including after `ownerSend` at 20:30) | any | any | **Refuse. New copy, below.** The report has already been generated (and, past 20:30, delivered) — nothing captured now has anywhere to land today. |

**New copy (Rule 3.12: short sentences, no idiom, no unnecessary politeness scaffolding,
consistent vocabulary with the rest of the flow):**

> Today's report is ready. Send your update tomorrow morning.

Checked against the seven rules: two short sentences, each one idea; no question, so rule
2 doesn't apply; "report" and "update" are the two nouns already used elsewhere in this
doc's own PM-facing copy, not new synonyms; no idiom; concrete ("tomorrow morning," not
"later"); no digits needed; no "please"/"sorry" scaffolding — the refusal is stated
plainly, matching `FLOW_RACE_REPLY`'s own register (`dispatch.ts:38`), not
`MORNING_ALREADY_COMPLETE_REPLY`'s slightly warmer tone (that one closes a flow the
engineer just finished; this one is turning away an attempt, a different social moment,
plain is the safer register).

## (b) The submitted-check mitigation — labelled honestly

Before ever passing `startFlow: true`, the TS layer reads `daily_logs.morning_submitted_at`
and `evening_submitted_at` for today's `(project_id, engineer_id, log_date)` — NOT session
context, since context can be cleared/reset independent of the DB record (BOT-07's
next-IST-day reset, or a completed-and-cleared `current_flow`).

**This is TS-side mitigation for a known, already-decided, unbuilt RPC gap — not the fix.**
Both `apply_morning_flow_turn`'s and `apply_evening_flow_turn`'s own `p_start_flow` branches
(`022_evening_flow_apply_turn.sql:157-173`, `025_evening_productivity_reconciliation.sql:
229-243`) fire unconditionally on `current_flow IS NULL`, with no check against the
submitted marker — calling either with `startFlow: true` for an already-submitted flow
would restart it from Q1 (harmless to already-saved data, confusing UX). This plan avoids
ever making that call in the first place by checking `daily_logs` first and branching to a
static reply instead (the "both done" row in (a)'s table). **The RPC migration that adds
`refuse-when-submitted` directly to the start branch — the actual fix, per
design-decisions-beta-feedback.md §10 — remains this gap's real closer.** Once it ships,
this TS-side check becomes redundant defense-in-depth, not something to remove
immediately, but no longer load-bearing on its own.

## (c) Collision behaviour inherited — stated explicitly so nobody assumes the queue exists

Building on `apply_morning_flow_turn`/`apply_evening_flow_turn` directly — the only wired
path — inherits their plain `ELSE v_outcome := 'reask'` branch for "a flow is already
active." **This is NOT BOT-21's pending-flow guarantee.** `acquireAndTransition`/
`drainNextPendingFlow` and the `pending_flows` queue (BOT-21/BOT-26,
`lib/whatsapp/session.ts:78,121`) are fully built and tested but have zero production
callers (confirmed, `bot-flows.md`'s own dated correction, II1, same round) — this plan
does not wire them, and does not create any new expectation that a start-trigger arriving
mid-flow gets queued and delivered later. It gets re-asked the current flow's question,
exactly like today. If that gap matters for a specific scenario, it is a separate,
pre-existing gap this plan inherits rather than introduces.

## (e) Gate assessment — written out, not asserted

The TS-only wiring calls `apply_morning_flow_turn`/`apply_evening_flow_turn` with
`p_start_flow=true` — the EXACT same call shape the env-gated test sentinel already makes
in production code today (`route.ts:282-290`), from a new call site (`dispatchInboundTurn`,
gated by the (a)/(b) logic above) rather than a new mechanism. Checked against CLAUDE.md
§0's own conditions:
- **(a) "CREATES OR MODIFIES a live function's LOGIC."** Does not trip — no function is
  created or modified. Both RPCs are called exactly as designed, with an existing,
  already-supported parameter value (`p_start_flow=true`), from TypeScript.
- **(b) "CREATES OR MODIFIES WHAT CAN CALL, READ, OR WRITE AN EXISTING OBJECT."** Does not
  trip — the write path (calling this RPC with `p_start_flow=true`) already exists and is
  already granted to the roles that use it (`service_role`, which the webhook runs as).
  This plan adds a new CALL SITE under existing conditions, not a new capability.
- **(c)/(d)/(e)** — no auth/identity surface touched, nothing destructive, no billing.
- **Net: trips nothing.** No migration, no review package needed for the wiring itself.
  (The separately-tracked refuse-when-submitted RPC fix, if and when it ships, is its own
  migration and does trip (a) — named explicitly so it isn't conflated with this plan.)

## Built (2026-08-20)

See the status header at the top of this file. What remained genuinely NOT built by this
pass, deliberately: the refuse-when-submitted RPC fix ((b) above, its own migration and
review path), and the scheduled outbound-send primitive (#69/031 — this build only makes
an INBOUND message capable of starting a flow; nothing sends unprompted). The Twilio
sender swap (HH2/II4) is a separate, still-unauthorized go-ahead, ideally executed
alongside this build's deploy per that plan's own runbook.
