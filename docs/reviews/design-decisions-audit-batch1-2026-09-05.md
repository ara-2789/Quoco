# design-decisions-beta-feedback.md audit — Batch 1 (§1–§10)

Scope: the design-decisions-beta-feedback.md §-by-§ audit approved 2026-09-05,
motivated by three recorded-but-unbuilt items (daily_logs test-debt, §33,
`jobs` retention) surfacing as live failures with no owner or trigger to
revisit them. Every section below was read in full and checked against the
CURRENT codebase (migrations, `types/database.ts`, `lib/`, `app/`) — not
against memory of an earlier session, and not accepted on the strength of its
own self-label. Per instruction: self-labeled "DECIDED, not built" sections
were checked for (a) age, (b) downstream dependents, (c) whether the absence
is producing wrong behavior silently — the last one being the actual point,
since §33 wore an accurate label for six weeks while quietly fabricating
money. Self-labeled "DECIDED and built" sections were verified to the
(a)/(b)/(c) evidence bar in the audit's own scoping message, not accepted on
the label.

**Sorted with silently-wrong-today findings first**, per instruction.

| # | Section | Self-label | Verified status | Evidence | Age if unbuilt | Silently wrong? |
|---|---|---|---|---|---|---|
| 1 | §9 Evening Q4 v1 scope | "Ships: aggregate... Does NOT ship: trade attribution" | **STALE — reversed by a later migration, and the reversal has an active live gap** | see Finding A | n/a (superseded, not simply unbuilt) | **YES — live, right now** |
| 2 | §3 Nudges & escalation | (no label; describes architecture as designed) | **NOT WIRED — sweep code exists, zero callers** | see Finding B | ~since 027 (2026-07-25), unwired the whole time | **YES — live, right now** |
| 3 | §1 Absence handling | (no label on the PM-handoff half) | **PARTIALLY BUILT — data capture yes, PM handoff no** | see Finding C | since this doc's creation (pre-2026-07-28) | **YES — a silent data/coverage gap, not fabricated data** |
| 4 | §10 Restart semantics | "NOT YET BUILT" (self-labeled, explicit) | **CONFIRMED still true against the latest migration (035)** | see Finding D | 3 weeks (2026-08-15) | Not yet — but is the next thing to become wrong |
| 5 | §8 Engineer STREAM | "CLOSED" | **Design CLOSED; 0% built** — label is technically correct, reads as done | `grep -rn stream supabase/migrations/*.sql` → zero | 5+ weeks (2026-07-28) | No current consumer, so no current wrong output |
| 6 | §7 Ad-hoc flow menu | "Discussion only, no implementation authorised" | **Superseded without a cross-reference** — the idle-input path it gates now does something else entirely (§38) | see Finding E | n/a — Fast-Follow, correctly unbuilt | No — the flows it would gate don't exist yet either |
| 7 | §2 Engineer number change/departure | "Already solved... no new design needed" | **Design solved; the UI half is not built** | zero hits for `whatsapp_number` editing anywhere under `app/(dashboard)/` | since 007 shipped | No — a missing capability, not wrong data |
| 8 | §6 Weekly work reviews | (no label; "rides in a future migration") | **0% built**, as expected | zero `productivity_standards`/`daily_log_photos` tables, no weather cron | n/a — correctly deferred | No |
| — | §3.1 messaging_blocked today-only | (DATED NOTE) | **BUILT, verified** | `lib/daily-logs/status.ts` implements exactly the today-only gate, cites §3.1 itself | — | — |
| — | §3.2 reactivation CTA | (DATED NOTE) | **BUILT, verified** | `app/(dashboard)/daily-logs/reactivate-cta.tsx` + `test/unit/reactivate-copy.test.ts` both exist | — | — |
| — | §3.3 inline corrections, no date gate | (DATED NOTE) | **BUILT, verified** | migration 019's `correct_daily_log` genuinely has no date check; `daily_log_edits` audit trail exists | — | — |
| — | §4 Disappearing messages | "Non-build" | Consistent — no code either way, as decided | — | — | — |
| — | §5 GPS/photo attendance | "PARKED" | **Confirmed 0% built**, matches label exactly | zero GPS-related code anywhere | — | — |

## Finding A — §9's decision was reversed by migration 035, and the fix has an active gap (HIGHEST PRIORITY)

§9 (2026-07-28) decided evening manpower ships **aggregate-only**: total
productive/idle counts, explicitly deferring trade-level attribution for
three named reasons — no fallback/reask signal on an unrecognized trade
token, Civil-biased lexicon coverage, and multi-word trade names being
architecturally unparseable. It warned explicitly: *"a broken join there
returns wrong numbers, not an error."*

Migration 035 (2026-08-31, five weeks later) **reversed this decision
entirely** — confirmed directly in the migration file: `evening_workers_on_
site`/`evening_productive_manpower` are replaced by `evening_manpower` and
`evening_idle_hours`, both **by-trade** JSONB (`{by_trade:[{trade, idle_hours,
matched}]}`). §9 itself was never updated to note this — it still reads as
the live scope decision.

To 035's credit, it actually solved §9's Reason 1: `lib/whatsapp/flows/
parsers/idle-hours.ts`'s own header describes "§42 UNMATCHED-TOKEN CAPTURE" —
an unrecognized trade token is captured with `matched: false` and the
original text preserved, never silently dropped. Reason 2 (Civil-biased
lexicon) is unchanged (`electrician`/`plumber` still have 1–2 aliases each,
confirmed by reading `lexicon.ts` directly) but is no longer silent on its
own, since an unmatched token is no longer discarded.

**The live gap**: that `matched` flag is thrown away before it ever reaches
the DPR. `lib/dpr/schema.ts`'s `EngineerIdleHoursByTrade` is `{trade,
idle_hours}` only — no `matched` field. `assemble.ts` maps `row.evening_idle_
hours.by_trade` into this shape and drops `matched` in the process.
`render.ts`'s loop (`for (const trade of facts.idle_hours_by_trade)`) then
renders every entry identically via `tradeLabel()`, with no branch on
whether it was a confident match.

**Consequence, concretely**: an engineer's garbled or unrecognized trade word
in tonight's evening reply renders in the live "NEEDS ATTENTION" section of
the DPR sent to the PM/owner exactly as if it were a normal, correctly
identified trade — humanized, no flag, no "(unmatched)" marker, nothing.
This is precisely the failure mode §9 named five weeks ago, now live. **It
shipped tonight**, in this same session's own PR C2 (merged as commit
`786930d`) — the PR C3 proposal doc (`docs/reviews/pr-c3-proposal-2026-09-05.md`)
already flags "unmatched-trade rendering" as an **open** design question for
the *future* manpower-breakdown work, not realizing the unconditional
rendering already shipped live in C2, ahead of that question being answered.

## Finding B — §3's nudge/escalation mechanism has zero callers in production

`lib/checkin-escalations/sweep.ts` exports `runCheckinEscalationSweep`, fully
implemented (upserts to `checkin_escalations`, status transitions, roster
fetching). A repo-wide grep for this function name finds exactly one
occurrence: its own definition. It is not called from `app/api/jobs/tick/
route.ts` (which does call the morning-cutoff sweep and the outbound
coverage-sweep — just not this one), not from any cron in `vercel.json`, not
from anywhere. PR #192 ("run the check-in escalation sweep on every job
tick") is what would wire this — confirmed still `state: OPEN`, `mergedAt:
null` via `gh pr view 192`.

**Consequence**: none of §3's nudge/escalation mechanism runs today. No
engineer who stalls or never starts a check-in gets a nudge; no escalation
surfaces on any PM-facing view from this path (`checkin_escalations` rows
are only ever written by the sweep this session confirmed elsewhere is
otherwise unwired). This is the accountability safety net for the entire
Spine check-in flow, silently not running, since migration 027 shipped the
table it's meant to populate (2026-07-25 — six weeks).

**Correction to an earlier framing this session gave the user**: I initially
suspected merging #192 would activate the §10 restart-refuse danger (Finding
D). It doesn't — `sweep.ts` never imports `triggerCheckIn`/`p_start_flow`; it
only updates `checkin_escalations` bookkeeping, no outbound send. #192 is
safe to merge on its own merits; it does not interact with Finding D.

## Finding C — §1's PM-handoff-on-absence was never built

§1's core decision (Option A) is that when an engineer answers "No" to
attendance, the same morning questions get offered to the **PM's** WhatsApp
number. Verified: `daily_logs` has never had a `submitted_by` column in any
migration (confirmed against `types/database.ts`, the generated live shape —
the only `submitted_by` column anywhere belongs to `invoices`, an unrelated
Fast-Follow table). The only trace of the intended mechanism is a single
comment in `lib/whatsapp/flows/morning.ts:397` ("`absent` keeps the evening
trigger and PM handoff alive") — describing an aspiration, not a mechanism;
no `pending_flows` insert, no outbound dispatch to a PM number, exists
anywhere in the absence branch. What **is** built: the first, simpler half of
§1 (write a `daily_logs` row with `attendance`/`is_holiday` and a completion
marker) — confirmed at `morning.ts:404-412`.

**Consequence**: every day an engineer reports absent, the record the design
promised (a PM-supplied account of what happened on site) never materializes
— the day's `daily_logs` row carries only the absence flag. This compounds
with an already-known, separately-tracked gap this session found earlier
tonight (`docs/reviews/pr-c3-proposal-2026-09-05.md`): `attendance` isn't
even read into the DPR facts assembler today, so an absent day's DPR reads as
a normal, quiet day rather than flagging the absence at all.

## Finding D — §10's restart-refuse gap is still real, confirmed against the latest migration

§10 (2026-08-15) names a specific, precise gap: the `p_start_flow` branch of
both flow RPCs starts unconditionally when `current_flow IS NULL`, never
checking `morning_submitted`/`evening_submitted` first. Migration 035
(2026-08-31, the current, latest definition of both RPCs) was checked
directly:

```
281:  IF p_start_flow THEN
282:    IF v_session.current_flow IS NULL THEN
283:      v_session.current_flow := 'morning';
...
286:      v_outcome := 'start';        -- unconditional, no submitted check
287:    ELSE
288:      v_outcome := 'reask';
```

The `morning_submitted` check that DOES exist in this file (line 292) lives
in the **non-start** branch (`ELSIF ... current_flow IS NULL`, i.e. an
ordinary inbound message on an idle session) — the exact behavior §10
already credited as "unchanged" and correctly built. The start-branch gap
§10 flagged as "NOT YET BUILT" is, verified directly against the newest
migration, still exactly that.

I also checked the roster/trigger layer for an application-level guard that
might compensate: `lib/whatsapp/outbound/roster.ts:191-196`'s own comment on
`fetchMorningRoster` states plainly *"no `daily_logs` join at all — there is
nothing to read yet at 08:30"* — no submitted-check exists there either.

**Why this isn't live-wrong today**: `vercel.json` fires the morning trigger
once daily (`0 3 * * *`, 08:30 IST) — every fire happens on a day nobody
could have submitted yet, so the gap is currently inert. **Why it matters
now**: §10's own text ("the send and the nudge are the same operation... once
wired to real triggers") identifies this exact trigger primitive as the thing
a future nudge mechanism would reuse. §3's nudge mechanism (Finding B) isn't
sending anything yet, but the moment it does — reusing this same `p_start_
flow=true` call against an engineer who already completed earlier that day —
this gap fires for real: their completed flow silently restarts, re-asking
Q1. This is a genuine, unclosed prerequisite for the very next piece of work
in this area, not a stale worry.

## Finding E — §7's decision was superseded without a cross-reference

§7 (2026-07-28) decided the (not-yet-built) ad-hoc flow menu should fire
"on an unrecognized inbound ONLY when the engineer is IDLE." §38
(2026-08-28, later in the same document) retired the inbound-start
scaffolding entirely — confirmed: `routeInboundMessage`'s no-session branch
today returns "one of four static replies, never an RPC call"
(`lib/whatsapp/inbound-start.ts:131,148`), not a three-way menu. §7 has no
pointer to §38 the way §9.1 explicitly says "MOVED" when it hands its own
finding to CLAUDE.md. Low severity — the ad-hoc flows themselves are
Fast-Follow and correctly unbuilt either way — but the design record itself
is stale in exactly the shape the earlier daily_logs/§33/jobs pattern
already demonstrated causes real confusion later.

## File-split note (tracked, not acted on)

Per instruction: not splitting `design-decisions-beta-feedback.md` now.
Having read §1–§10 (lines 1–497 of 3,503, roughly 14% of the file) at real
depth, one structural observation worth recording for the end-of-audit
decision: §8's "RECORDING GAP" and §9's now-confirmed staleness both stem
from the same root cause — a design decision section with no mechanism
forcing a revisit when a LATER section (or a later migration entirely)
overtakes it. A split by decade (§1–10/§11–20/§21–30/§31–41, matching this
audit's own batching) would not fix that on its own; whatever the final
split decision is, it should be paired with the "MOVED"-style cross-reference
convention §9.1 already uses once, applied consistently, not just a
mechanical file-size fix.

## Batch 2 preview

§11–20 next, on approval — covers the DPR section 5 decision, the DPR
rollup/suppression rule, accountability shipping, and several Q4/Q5-adjacent
parser findings (§14–19) that, based on this batch's pattern, are worth
checking against the SAME migration-035 reversal risk Finding A just found,
since several of them predate 035 and reference the pre-035 evening shape
directly.
