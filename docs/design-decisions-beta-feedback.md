# Design Decisions — Beta-Customer Feedback

> Product/design decisions and parked items captured from beta-customer feedback
> and schema analysis. **These are DECISIONS and PARKED ITEMS — no implementation
> is authorised by this document.** Nothing here touches migration 007 (auth
> surgery); implementation rides in later migrations/passes as noted per item.
>
> Last updated: 2026-07-28 (§7 ad-hoc flow menu trigger; §8 engineer stream).

---

## 1. Absence handling — "Are you on site today?" → No

- A **"No"** answer short-circuits the morning flow but **MUST still write a
  `daily_logs` row** with the absence reason and stamp a completion marker.
  Absence-reported **counts as a completed check-in** — never nudged, never
  looks like the engineer "went dark".
- **DECISION: Option A (hierarchy handoff)** chosen over Option B (delegated
  numbers). On "No", the same morning questions are immediately offered to the
  **PM's WhatsApp number** for that project; the PM answers on behalf of the
  site. `daily_logs` gains a **`submitted_by`** concept (distinct from
  `engineer_id`) so the record honestly shows *who answered*.
- **Known implementation cost:** a PM covering multiple projects means one phone
  may need multiple queued flows — the **`pending_flows` queue (migration 012)**
  is the designed home for this.
- **PARKED — Option B (temporary delegated numbers with approval):** reopens
  identity-lifecycle questions (§10 of the 007 review), collides with phone
  uniqueness, and adds an approval-flow subsystem for the minority case. Revisit
  only if beta demand forces it.

## 2. Engineer number change / departure

Already solved by the **approved 007 design** — no new design needed.

- **Number change:** PM edits `whatsapp_number` via the dashboard. The partial
  unique index (`uq_users_...` pattern) allows reuse.
- **Departure:** **deactivation ONLY** (`status` + `messaging_blocked`), per the
  §10 binding policy of the 007 review. **No auth-deletion offboarding** until
  the invitations/re-link system ships.
- **Responsibility:** PM / tenant-admin.
- **Blocked on:** migration 007 + engineer-management UI.

## 3. Nudges & escalation

Target times TBD from customer — roughly **10:30** morning / **19:30** evening.

- **Architecture:** `jobs` table + Vercel Cron sweep. The
  `acquire_and_transition_session` `scheduled_trigger` caller is the designed
  entry point.
- **Sweep keys on `morning_submitted_at IS NULL`** (NEVER on row-existence), so
  it catches BOTH never-started and stalled-mid-flow. Stalled engineers get a
  **resume-aware nudge** ("2 of 5 answered — continue"); same-day resume logic
  already handles their reply.
- **External dependency:** nudges outside the 24h session window need approved
  **Meta templates** — timeline is hostage to the pending WhatsApp sender
  approval.

### Cutoff finalization (new design — DECIDED)

Submission and finalization are **TWO separate fields**:

- **`morning_submitted_at` / `evening_submitted_at`** — stamped **ONLY by a real
  human completing the flow**, never by cron. This is the **accountability
  signal**.
- **`morning_finalized_at` / `evening_finalized_at`** — stamped by a **cutoff
  cron** (e.g. 11:00) that closes still-open check-ins as-is:
  - partials close as **"partial, finalized by system"**
  - never-starteds as **"no submission"**.
- **Escalation/accountability reads `submitted_at`**; **DPR generation and
  day-closure read `finalized_at`**.
- The system **NEVER fabricates a submission.** The engineer gets **one
  informational message** when their check-in is auto-closed.

### 3.1 messaging_blocked is current-state, not history (DASH-03 limitation)

**DATED NOTE (2026-07-18, per DASH-03 review S1).** `users.messaging_blocked` is
a **current** flag on the user row — there is no per-day record of when a number
was blocked or unblocked. The Daily Logs board (DASH-03) therefore applies the
"Messaging blocked → legitimate absence, excluded from accountability" treatment
**only to TODAY's card**. For any PAST date, the board ignores the current
`messaging_blocked` flag and falls through to the normal cutoff-clock logic
(submitted → ok; else → gap), because whether the engineer was actually blocked
on that historical day is **unknowable** with today's schema.

This is a **documented limitation, not an accident**: retroactively excusing a
past gap on the strength of a flag that may have flipped since would silently
corrupt the very accountability fairness Rule 5.3 is meant to protect. When a
block-history mechanism exists (e.g. a `messaging_block_events` audit trail, or a
per-day flag stamped onto `daily_logs` like `is_holiday`), the past-date branch
can consult real history instead. Until then, `is_holiday` (stored ON the
`daily_logs` row, hence historically accurate) is the only absence excluded on
past dates. Enforced in `lib/daily-logs/status.ts`.

### 3.2 messaging_blocked chip → instructional-only reactivation CTA (2b)

**DATED NOTE (2026-07-25, DASH-03 / BOT-27 2b).** The Daily Logs board renders a
PM-facing reactivation affordance on a `messaging_blocked` engineer's card: a
low-emphasis native `<details>` "How to reactivate" disclosure (**today's card
only** — the same gate as §3.1, since the block state is derived per-half and
only fires for today), with copy-to-clipboard of the Quoco WhatsApp number and a
`wa.me` "Forward to <engineer>" deep link pre-filled with a forwardable message.
It renders **once per card** (the block is user-level, not per-half).

**Instructional ONLY — never a flag-flipping button.** Per BOT-27's canonical
definition, `messaging_blocked` is engineer consent-state, cleared only by the
engineer texting in; a PM cannot un-opt-out on their behalf. So no dashboard
control mutates the flag: the CTA component (`reactivate-cta.tsx`) holds no
supabase client, server action, or fetch, and a static source test
(`test/unit/reactivate-copy.test.ts`) enforces that "no false unblock" invariant.

**Copy says "text START," not "text us."** The interim clear-half currently
reactivates on ANY inbound (an intentional interim generosity), but the SET stage
will gate resume on the explicit START/RESUME keyword (bot-flows.md B2). The UI
teaches that FUTURE contract now, so the copy needn't change and engineers/PMs
aren't retrained when keyword-gating ships.

**Degraded path:** if `TWILIO_WHATSAPP_NUMBER` is unset, the CTA falls back to
instruction-only (still says START; no number, copy button, or forward link) and
emits a Sentry **warning** — degraded-but-functioning, not a failure.

### 3.3 Inline corrections are allowed on PAST dates — and why that's safe (019)

**DATED NOTE (2026-07-25, Rule 4.3 inline correction, migration 019).** The
`correct_daily_log` RPC does **not** date-gate: a PM may correct a `daily_logs`
scalar field on **any** past date they're scoped to, not just today. This is a
**deliberate contrast with §3.1's messaging-blocked-today-only rule**, and the
difference is the whole point:

- **§3.1 refuses past dates** because `messaging_blocked` is a **present-time
  flag** with no per-day history — applying today's flag to a historical day
  would *retroactively invent* a fact (that the engineer was unreachable then)
  that may never have been true. That would corrupt accountability.
- **§3.3 permits past dates** because a correction does the **opposite**: it
  fixes the **factual record of what actually happened** on that day (a
  mistyped headcount, a wrong weather note). Nothing is being retroactively
  *misapplied*; a wrong record is being made right. And unlike the flag, the
  correction is **fully audited** — `daily_log_edits` keeps who/when/old/new —
  so the edit is transparent, not a silent history rewrite.

So the absence of a date gate here is intentional, not an oversight. The
integrity guard is the **audit trail**, not a time window: every past-date edit
is attributable and reversible-in-record. (Enforced in migration 019; the
membership + PM-only + column-whitelist guards live in the RPC, not in a date
check.)

## 4. Disappearing messages

- **No API control exists** (verify against current Meta docs at sender setup).
- **Non-build:** the canonical record is Postgres; the onboarding message tells
  engineers how to enable disappearing messages **themselves**.

## 5. GPS / photo attendance — PARKED

Parked pending a concrete customer example. Key constraint already known:

- **WhatsApp strips EXIF/GPS** from photos sent as images. **Native location
  share + our server timestamp** is the reliable time+place capture; **photos
  are visual evidence only.**
- Likely **merges with the morning team photo** (see §6, compulsory photos).

## 6. Weekly work reviews — capture-gap decisions

From schema analysis. Implementation rides in a **future migration (008 or the
corrections migration), NOT 007.**

- **Interim yardstick (until project schedules exist in a future phase):** a
  **`productivity_standards`** table — trade/equipment type, activity, unit,
  standard output/day, assumed efficiency. **Quoco-supplied defaults + tenant
  override** (same ownership pattern as `rate_catalog`).
  - Efficiency % = `actual output ÷ (headcount × standard)`.
  - Machinery wastage ₹ = `idle hours × hire rate`.

- **Controlled vocabulary (DECIDE-BEFORE-PASS-2 — flagged):** Pass 2's structured
  questions MUST use a **fixed trade/equipment/activity list**
  (buttons/numbered options), **not free text** — the efficiency joins die on
  free-text trade names. Evening **`productive_manpower` JSONB** shape pinned to
  **`[{trade, actual_count}]`** using the same vocabulary as morning.

- **Plan-as-list (DECIDE-BEFORE-PASS-2 — flagged):** morning plan captured as a
  **list of planned activities** so the evening flow can ask status against each
  — plan-vs-actual becomes **computation, not LLM inference**. Optional
  **`activity_id`** field (null until schedules exist) future-proofs the
  schedule flip.

- **Future phase:** a project schedule defines daily activity; check-ins become
  **schedule-driven** (confirm/status) rather than open questions.

- **Weather:** promoted **FUTURE → Phase 1.1**; **cron-stamped from a weather
  API** by project location, **zero engineer burden**.

- **BOQ rates:** money-lost calculations in the weekly review use `rate_catalog`
  (idle hours × rate; efficiency shortfall × BOQ rate). **Generator synthesis
  work, no new capture.**

- **Compulsory photos (DECIDED — required-but-finalizable):** morning =
  team/site/machinery photos, evening = work-completed photos. New
  **`daily_log_photos`** table (`{daily_log_id, phase, photo_url, caption,
  received_at}`), **Supabase Storage only, never Twilio URLs**. The flow **will
  not stamp `submitted_at` without the photo** (keeps asking), but the **cutoff
  cron still finalizes** photo-less check-ins as **"finalized, photo missing"** —
  the gap surfaces on the PM dashboard and weekly review. **Compliance through
  visibility, not hard blocks.** Storage-cost note: this becomes the product's
  **largest object-storage consumer.**

- **Explicitly NOT adding:**
  - percent-complete self-assessments (unreliable);
  - any new daily questions beyond the six (flow-burden ceiling).

## 7. Ad-hoc flow menu — trigger condition (2026-07-28)

Scope note: the ad-hoc flows themselves (Safety / Hindrance / Invoice) are
**Fast-Follow** per CLAUDE.md §2 and have **no flow spec in `docs/bot-flows.md`
yet** — BOT-30 is named in CLAUDE.md's Fast-Follow list but appears nowhere in
the flow doc. This entry is the first written record of their ENTRY CONDITION.
**Discussion only — no implementation authorised**, per this document's header.

- **DECIDED — the menu fires on an unrecognized inbound ONLY when the engineer
  is IDLE** (no active session, no current flow). Deliberately narrower than
  "any unrecognized input, always."

- **WHY the narrow form — it would otherwise collide with the re-ask mechanic.**
  Rule 3.5 (design-principles.md) says an unparseable reply gets one example and
  **one re-ask**, then whatever comes next is **accepted and flagged
  low-confidence for PM review** — never a dead end. An engineer mid-flow who
  sends a garbled equipment answer must get that re-ask nudge. If the ad-hoc
  menu also fired on unrecognized input, the same garbled answer would have two
  claimants and the engineer would be pushed out of the flow he was completing.
  Gating on idle keeps the two mechanisms disjoint by construction: mid-flow
  unrecognized input belongs to Rule 3.5, idle unrecognized input belongs to the
  menu.

- **SEPARATE MECHANISM from BOT-19 — which stays exactly as-is.** BOT-19 is a
  *specific keyword*, *mid-flow*, queued via `pending_flows`, **safety only**.
  The menu is *any unrecognized input*, *idle only*, and offers a choice of
  three flows. Different trigger, different state, different scope — do not
  merge them or let one's behaviour drift into the other.
  - **Mechanism nuance, recorded so the rationale doesn't get misremembered:**
    BOT-19 does **not** preempt a running flow. Per bot-flows.md ("Safety keyword
    mid-flow → add safety to `pending_flows`, finish current flow, then process
    safety") it **queues** safety and processes it **after** the active flow
    completes; BOT-26 gives it priority 0, so it jumps ahead of every OTHER
    queued item but still waits for the flow in progress. So the accurate
    statement is "safety can't wait *behind other queued work*," not "safety
    can't wait for the current flow to finish." Whether safety SHOULD preempt is
    a separate question this entry does not open.

- **OPEN QUESTION — NOT DECIDED.** Should `hindrance` (or similar keywords) be
  able to interrupt an **ACTIVE** flow the way safety does, instead of only
  firing at idle? That would need its own `pending_flows` entry type and a
  deliberate priority decision against BOT-26's existing order
  (safety=0, scheduled_trigger=1, other=2). It does **not** fall out of "any
  unrecognized input" by default and must not be assumed. **Revisit when the
  ad-hoc flows are actually being built** — not before.

## 8. Engineer STREAM (discipline) — CLOSED (2026-07-28)

> **⚠️ RECORDING GAP — read first.** These three decisions were taken in
> discussion and are recorded here as stated. The **prior** stream work they
> build on is **NOT in this repo**: a `grep -ri stream` over `docs/`, `lib/`,
> `app/`, `supabase/` and `types/` finds nothing, no commit on any branch
> mentions it, and this file had no stream section before today. In particular
> the **"snapshot-hybrid storage design"** that decision 1 depends on, and the
> "three original open questions" this section closes, exist only in
> conversation. **Capture the storage design before any of this is built** —
> decision 1 is unimplementable without it, and this note is the only thing
> currently stopping it from reading as settled-and-written-down.
> No `stream` column exists on `project_members` or `daily_logs` today, so every
> decision below needs schema work that is not yet designed or numbered.
>
> **NOT AN EVENING-FLOW BLOCKER — verified 2026-07-28.** Evening's v1 scope
> (Q1-Q3, Q4 step 1, Q5, Q6) references `stream` **nowhere**: the evening spec
> (`bot-flows.md:91-111`) contains no occurrence of stream/discipline/trade; none
> of the eight `evening_*` columns carries or joins on it; and the
> `quoco_evening_checkin` template takes `{{1}}` name, `{{2}}` project,
> `{{3}}` morning plan — no stream variable. So the storage-design gap above is a
> **fully separate, parallel task**, and evening may be built to completion
> without it. Decision 1's "evening reads the day's snapshot" rule binds only
> **once stream ships** — it is a constraint on that future feature, not a
> dependency of evening v1.
> FORWARD-COUPLING, noted so it is cheap later: evening's RPC must already SELECT
> the current-day `daily_logs` row for Q5's auto-skip. When stream lands, the
> snapshot can ride on that SAME read — so the evening design should keep that
> SELECT in one place rather than inlining it per-branch.

**DECIDED — 1. Mid-project reassignment uses the DAY'S SNAPSHOT, not the live
value.** A PM may reassign an engineer's stream mid-project. When that happens,
that day's **evening** flow must use the stream **snapshotted onto that day's
`daily_logs` row at morning check-in time** — never `project_members`' current
live value.
- **Rationale:** morning's data (plan, manpower, equipment) was already reported
  under whatever stream was active then. Evening must stay internally consistent
  with the same day's snapshot rather than retroactively adopting a same-day
  reassignment.
- **Effective date of a reassignment: the NEXT day's snapshot.** It never
  rewrites the current day.
- Consistent with, and reusing, the snapshot-hybrid storage design (see the
  recording gap above — that design still needs writing down).

**DECIDED — 2. An engineer covering two streams is a VALUE, not a structure.**
Simultaneous two-stream coverage is **not** modelled as structural
multi-assignment. Instead **"Combined"** (or a compound value such as
"Civil + Electrical") is itself a valid single stream value the PM can assign.
- **Rationale:** structural multi-assignment would force a redesign of
  `project_members`' and `daily_logs`' unique constraints for a rare case.
- **Cost: zero schema change beyond what stream storage already requires.**

**DECIDED — 3. Stream vocabulary is TENANT/PROJECT-CONFIGURABLE, not a fixed
global list.** Implementation implication, stated plainly because it is larger
than it looks: this needs a real **admin-managed table (Quoco defaults + tenant
override)** — the same ownership pattern already used for `rate_catalog` /
`rate_catalog_history` (schema.md) and already chosen for `productivity_standards`
in §6 above. **Not a hardcoded list**, and not a CHECK constraint.

**All original open questions now answered — this section is CLOSED:**

| Question | Resolution |
|---|---|
| Who assigns stream? | The **PM** |
| Does it change mid-project? | **Yes**, PM-driven — with the snapshot-consistency rule (decision 1) |
| Can one engineer span two streams? | **Yes**, via a "Combined" **value** — not structurally (decision 2) |
| Is the vocabulary fixed or configurable? | **Tenant-configurable**, admin-managed table (decision 3) |

(Four questions are listed above; the closing note that prompted this section
said "three." Recorded as four because four were asked — flagging rather than
silently dropping one.)

**Consequence for the parsers, not yet decided.** Decision 3 means the trade
vocabulary the WhatsApp parsers map against becomes tenant data. Today
`lib/whatsapp/flows/parsers/lexicon.ts` is a compile-time constant consumed by
functions documented as "PURE — no Supabase, no IO". Tenant-configurable
vocabulary does not force those parsers to do IO, but it does force the
vocabulary to be **injected** into them (`parse(raw)` → `parse(raw, vocab)`).
That is a signature-level change to shipped morning-flow code and needs its own
decision before evening Q4 is built. See the lexicon findings recorded against
this section's investigation.

**Nothing here is authorised for build** — per this document's header.

## 9. Evening flow Q4 — v1 scope (2026-07-28)

Placement note: recorded here rather than in a separate evening-flow document
because no such document exists, and because this decision partially answers
§6's DECIDE-BEFORE-PASS-2 "controlled vocabulary" flag — it belongs next to the
flag it responds to. **Discussion only, no implementation authorised.**

**DECIDED — Q4 step 1 (headcount): free text + `parseLabourCount`.** Same
low-risk pattern as morning Q2, already proven in production. Re-ask trigger is
`planned_total === null` (no digit anywhere in the answer).

**DECIDED — Q4 step 2 (productivity/idle): AGGREGATE-ONLY v1.**
- **Ships:** `evening_workers_on_site` + total productive/idle counts + the idle
  reason as **free text**.
- **Does NOT ship:** trade-level attribution `[{trade, actual_count}]`.
  **Deferred explicitly — this is a scope decision, not an omission.**

**Why trade attribution is deferred — three independent reasons, each verified
against the code on 2026-07-28:**
1. **No fallback or re-ask signal exists.** `canonicalTrade` returns `null` on an
   unrecognized token and `labour.ts:54-57` simply omits it from `by_trade` while
   still counting its number toward `planned_total`. Nothing distinguishes
   "recognized the trade" from "didn't" — so no re-ask can be triggered and no
   flag can be raised. The failure is silent by construction.
2. **Coverage is heavily Civil-biased.** 21 of 26 trade aliases belong to the
   four civil trades, with rich transliterated Tamil (`mesthiri`, `thozhilaali`,
   `thachan`). `electrician` has 2 aliases and `plumber` has 1 — **neither has
   any Tamil or transliterated form at all.** Vernacular input, which is the
   entire reason the parser exists, is effectively unsupported outside Civil.
3. **Multi-word trade names cannot match AT ALL.** Attribution is single-token
   and positional (`canonicalTrade(tokens[i+1])`, falling back to `tokens[i-1]`).
   "pipe fitter", "cable jointer", "steel fixer" are unrecognizable no matter how
   many aliases are added — this is an **architectural gap in the tokenizer, not
   missing data**. Multi-word names are disproportionately Electrical/Plumbing,
   i.e. exactly where §8's tenant-configurable stream vocabulary is heading.

**Consequence had it shipped anyway:** trade-attributed rows would silently feed
the future DPR efficiency calculation (§6: `efficiency % = actual ÷ (headcount ×
standard)`) with unreliable joins on precisely the terms most likely to appear as
stream coverage widens. A broken join there returns **wrong numbers, not an
error** — the failure mode §6 predicted in its own words ("the efficiency joins
die on free-text trade names").

**Relationship to §6:** this answers that flag **for evening Q4 only**, and by
deferring the structured half rather than by deciding the vocabulary. §6's
DECIDE-BEFORE-PASS-2 flag stays **OPEN** for everything else it covers (morning
Q2's `by_trade`, the activity vocabulary, plan-as-list).

**Revisit when** either a trade picker ships (buttons / numbered options, per
§6's own recommendation) **or** the lexicon gains n-gram matching plus an
unmapped-term signal. Not before.

### 9.1 HONEST GAP — the low-confidence flag does not exist → MOVED

Rule 3.5's promised low-confidence flag is **not implemented** (the
accept-and-advance half is; the flag half is not). It was first written down
here, then **promoted to CLAUDE.md §10 as "PARSER DEBT — RULE 3.5's
LOW-CONFIDENCE FLAG DOES NOT EXIST"** because it is cross-cutting — it affects
every future consumer of parsed check-in data, not just evening. **Read the full
entry there**; it is not restated here, so this section cannot drift from it.

## 10. RESTART SEMANTICS — start triggers restart completed flows (2026-08-05)

**DECIDE-BEFORE-CRON-PR.** Surfaced during migration 022's third reviewer round
(the CONTEXT DISCIPLINE fix — `apply_morning_flow_turn`'s start branch stopped
wiping `session.context` to `'{}'` and started stripping only its own
counters, matching evening's own start branch). That fix changed what a
restart DOES to the completion marker, but it did **not** decide, and nothing
before it had decided, whether a restart should be **allowed** at all.

**The fact, unchanged by 022:** `apply_morning_flow_turn`'s start branch fires
whenever `p_start_flow` is true and `current_flow IS NULL` — it does **not**
check `morning_submitted`. So a second start trigger arriving on a day morning
already completed **restarts the flow**, today, regardless of this fix.

**What 022 changed:** only what survives that restart. Before, wiping context
to `'{}'` destroyed `morning_submitted` immediately, and — because the restart
also overwrites `current_flow`/`current_step` — a later inbound arriving before
the flow re-completed would misread `already_complete` as `idle`. After,
stripping only `q2_reask`/`q3_reask` means the marker **survives** a restart.
Strictly better than the old behaviour, but still a **behaviour change to the
restart path**, not merely a preservation fix — worth being honest about
rather than filing purely as a bugfix.

**The open decision, for whichever PR wires a cron or scheduled trigger to
`p_start_flow`:** should a start trigger restart an already-completed flow at
all? Three candidate semantics, undecided:
- **fire-and-start** — current behaviour (restart unconditionally); now safe
  re: the marker, but still re-asks Q1 on a day the engineer already finished.
- **start-on-reply** — only start if the engineer's message wasn't itself
  interpretable as an answer to a still-pending question (requires a decision
  on what "pending" means with no active flow).
- **refuse-when-submitted** — start branch checks `morning_submitted` (mirror
  the check `already_complete` already makes in the non-start path) and
  no-ops or replies `already_complete` instead of restarting.

**Not resolved here.** 022 fixes the marker-survival bug; it does not pick a
restart semantic. The cron/webhook-wiring PR that first makes `p_start_flow`
reachable from a real trigger (today it is reachable only via the env-gated
test token — see `022_evening_flow_apply_turn.sql`'s header and
`docs/reviews/022-review-package.md` §9) must decide before shipping.

## 11. DPR section 5 decision — narrowed to what's derivable, no 7th question
(decided 2026-08-09; opened as an open question 2026-08-08 while scoping
evening Q4/Q5)

**DECIDED.** bot-flows.md's DPR GENERATION spec named section 5 "Tomorrow's
Plan — engineer's stated plan + dependencies." Scoping migration 024 (evening
Q4 headcount/productivity + Q5 equipment hours) surfaced a prior gap: no
evening question — built, deferred, or spec'd — ever asks the engineer what
tomorrow's plan is. Evening's six questions cover today's work, today's
schedule variance, today's headcount/productivity, today's equipment, and
tomorrow's *dependencies* (Q6) — dependencies are not a plan. Nothing
captures "stated plan," and this predates migration 024 entirely; it's a gap
in the original bot-flows.md spec, never surfaced until the evening question
list was read against the DPR section list side by side.

A first pass at a fix ("60 planned, 40 done, 20 outstanding") turned out to
overstate what's derivable: **no planned quantity is captured anywhere in the
real schema.** Morning Q1 is free text (`morning_plan`), never
quantity-parsed. Evening Q1 captures ACTUAL quantities only. Evening Q2 is
yes/no, Q3 is free text. A numeric planned-vs-done-vs-outstanding figure is
not computable from real data — that example came from the spike's fabricated
input (see `scripts/spike-dpr-claude.mjs`), not from the schema.

**Decision: section 5 = Q6's dependencies (once Q6 ships) + qualitative
carry-forward of the plan-not-met reason from evening Q2/Q3. NO derived
quantity, no inferred intent.** e.g. "Slab pour incomplete — JCB breakdown,
vendor callout pending."

**A seventh evening question was rejected**, not left open: evening is
already six messages at the end of a site day, and completion rate is the
binding constraint on the whole product (design-principles.md's Core
Thesis — "any new capture must replace or piggyback, never append"). Folding
a plan capture into an existing question was also rejected for Spine v1 —
narrowing the DPR spec to what's actually sourced beats quietly
under-delivering a field that reads as populated.

**Consequence:** section 5 emits "not captured" in every golden case until Q6
ships — but now with a known target shape (dependencies + qualitative
carry-forward), not an unresolved question. The DPR eval harness's golden
case for this must assert the narrowing is intentional, not a missed field.

**UPGRADE PATH, not a task — recorded for whoever next touches the morning
flow:** parsing a planned quantity out of morning Q1 would do two things at
once — make section 5 quantitative, AND upgrade section 2 (Schedule vs Plan)
from qualitative met/not-met to a real numeric variance. That single change
would most improve the DPR's substance of any option considered here. It is
morning-flow work, not evening, and not scoped now.

bot-flows.md's section 5 definition is amended to match this decision — see
its own entry, not restated here.

## 12. DPR rollup rule — DECIDED: suppress narrowly, not by section
(decided 2026-08-09; opened as an open question the same day while scoping
golden case #5)

**DECISION: safe default now, revisit with real data.** `daily_logs` is
`UNIQUE(project_id, engineer_id, log_date)` — one row per engineer, per day.
`dprs` is `UNIQUE(project_id, log_date)` — one row per project, per day.
bot-flows.md's own generation spec says "Aggregate all daily_logs rows for
the project on that date" — so on any day with more than one engineer, N
per-engineer rows become ONE DPR, and nothing previously defined the rule
that turns N rows into one number. This is a GENERATOR-LOGIC decision, not a
schema change (`CapturedCount`/`CapturedNumber` in lib/dpr/schema.ts are
untouched) and not a question-rewording (evening Q4's wording is untouched)
— both stay on the table as later options, not adopted now.

**The rule is narrow suppression, not blanket section-level suppression.** A
blanket "multi-engineer day → sections 1/3/4 all not_captured" would make
the DPR worthless every day for any two-engineer project — worse than an
imprecise number, and unnecessary, because most of a typical day's data
isn't actually ambiguous. Per section:

- **Execution (§1):** list ALL activities from ALL engineers, with
  quantities. Suppress the quantity ONLY for an activity reported by more
  than one engineer — the activity itself still appears. Distinct
  activities are not ambiguous and are never touched.
- **Manpower (§3):** suppress the aggregate headcount/productivity
  UNCONDITIONALLY on any multi-engineer day — this is the one genuinely
  unresolvable case. The ambiguity lives in the QUESTION ITSELF ("workers on
  site" doesn't distinguish "my crew" from "the whole site"), so two
  engineers coincidentally reporting the same number doesn't resolve
  anything either — there is no per-value comparison that could rescue this
  one the way §1/§4's overlap check does.
- **Equipment (§4):** suppress ONLY items whose `type` appears across more
  than one engineer. Distinct types keep their hours and idle cost
  untouched — the ambiguity is specifically same-type collision (is
  engineer A's JCB the same physical machine as engineer B's JCB?), not
  equipment data in general.
- **Schedule (§2):** suppress UNCONDITIONALLY on any multi-engineer day —
  same rule, same reason as manpower. **CORRECTED 2026-08-10** — this bullet
  originally listed §2 alongside §5/§6 as "unaffected." Wrong; see the
  dated correction immediately below for why.
- **Tomorrow's Plan (§5), Accountability (§6):** unaffected. Per-engineer by
  nature — no rollup, no aggregation, nothing to suppress.
- **Single-engineer project-days: entirely unaffected.**

**CORRECTION (2026-08-10) — §2 was miscategorized as unaffected; my own
error, caught while building the fact assembler (lib/dpr/assemble.ts), not
by anyone else.** The original bullet grouped Schedule with Tomorrow's Plan
and Accountability under "per-engineer by nature — no rollup, no
aggregation, nothing to suppress." That reasoning is correct for §5/§6 but
does NOT hold for §2: `evening_schedule_met` is exactly as per-engineer as
`evening_workers_on_site` is — one boolean per engineer, one field
(`ScheduleFacts.schedule_met`) to hold it for the whole project-day. On a
multi-engineer day, two engineers' booleans face the identical problem two
engineers' headcounts do: there is no way to collapse them into one value
without silently discarding one engineer's answer, REGARDLESS of whether
the two answers happen to agree — a coincidental match doesn't make the
collapse safe, any more than it does for manpower.

**Fixed:** §2 now suppresses unconditionally on any multi-engineer day,
exactly like §3, via the same `SuppressionNote` mechanism —
`ScheduleFacts.schedule_met` goes `null` accompanied by
`suppressed: {reason: 'multi_engineer_schedule', engineer_count}`, never a
silent, unlabelled `null` that would collapse "two engineers, two different
true answers" into the same shape as "nobody reported." That collapse is
exactly the distinction `CapturedCount` already makes for zero-vs-absent,
`SuppressionNote` for suppressed-vs-absent, and `low_confidence` for
shaky-vs-solid — §2 doesn't get to be the one place it's allowed, least of
all silently.

**Reason named `multi_engineer_schedule`, deliberately NOT a
`disagreement`-flavored name.** Q2 asks whether THAT ENGINEER's own plan
(following their own Q1) was met. Two engineers answering differently are
stating two SEPARATE facts about two separate areas of the same project —
not contradicting each other. Naming the reason around "disagreement" would
have encoded that misreading into the type permanently, for every future
reader of the enum, not just this correction's author.

**Recorded, not built:** once a multi-engineer project actually exists,
§2 should report something like "1 of 2 engineers met today's plan" — true,
useful, discards nothing. Suppression is the INTERIM answer only because
this whole rollup rule defers the real shape until the case occurs (the
prod query earlier in this section found zero multi-engineer projects
today) — not a statement that suppression is the right permanent design for
schedule data.

**CORRECTION to the framing above (2026-08-09), verified against prod, not
assumed.** This entry originally said single-engineer-heavy beta usage means
"this decision costs the DPR nothing in practice today" — imprecise in a way
worth naming: manpower suppression on a multi-engineer project isn't
occasional, it's UNCONDITIONAL AND PERMANENT — every day, for the life of
that project, until the reword ships. Section 3 is one of only two sections
where the DPR states a number that reads as money-adjacent to a contractor
(headcount/productivity). A customer with two engineers on one project would
get a DPR with a permanently blank labour section, not an occasionally
imprecise one. Whether that's actually a live problem depends entirely on
whether any project TODAY has more than one active engineer — checked, not
assumed:

```sql
SELECT p.id, p.name, count(*) AS engineer_count
FROM project_members pm
JOIN projects p ON p.id = pm.project_id
JOIN users u ON u.id = pm.user_id
WHERE u.role = 'engineer' AND u.status = 'active'
GROUP BY p.id, p.name
HAVING count(*) > 1;
```

Run against prod (`jvxwqignooseazzmwhvl`) via `supabase db query --linked`,
2026-08-09: **zero rows.** No project currently has more than one active
engineer. The deferral is genuinely free today — there is no project this
decision silently degrades right now. This is a snapshot, not a permanent
exemption: the moment a second active engineer joins any project's
`project_members`, that project's manpower section goes permanently
not_captured under this rule, and the question-reword stops being a
follow-up and becomes pre-launch work for that specific customer. Re-run
this query before onboarding any project expected to run two-plus
engineers, not on a fixed schedule.

**Instrumentation — proposed here, NOT built.** "Revisit with real data"
produces no data unless something records it. The generator needs to log,
per DPR, whether suppression fired and which rule triggered it
(`multi_engineer_manpower` / `same_activity_overlap` / `same_type_equipment`).
Candidate homes, not chosen:
  - a JSONB field on `dprs` (e.g. `suppression_log`) — durable, queryable
    across every DPR ever generated, colocated with the artifact it
    describes. Leaning here as the default candidate, since answering "how
    often does this actually fire" is the whole point of deferring the real
    decision, and that answer needs to be queryable in aggregate later.
  - a Sentry breadcrumb — cheap, uses monitoring already wired (CLAUDE.md
    §6), but not natively aggregable the way a DB column is; would need a
    separate report built on top.
  - a plain counter (jobs payload or a small dedicated table) — cheapest,
    but loses the day/project/activity-type detail that a future rewording
    decision would actually need to read.

**UPDATE (2026-08-10) — the fact assembler (lib/dpr/assemble.ts) needed no
extra bookkeeping to support this.** Every suppression `mergeDprFacts`
applies is already carried in the returned `DprFacts` as a `SuppressionNote`
on the relevant Fact — the assembler doesn't separately log anything itself.
Writing those notes into a durable `dprs.suppression_log` (the JSONB
candidate above) is still deferred: it needs a migration, which is planned
but deliberately not written yet — the assembler was kept reviewable on its
own first. Whoever adds that migration reads the `SuppressionNote`s already
present on a generated `DprFacts` object; no new signal needs to be
invented.

**Question-rewording stays on the table — the likely follow-up, not adopted
now.** Manpower's ambiguity is a QUESTION-DESIGN problem, not an
aggregation-math one: evening Q4 could ask "workers in YOUR area today"
instead of "workers on site," eliminating the ambiguity at the source rather
than suppressing after the fact. This is the natural next move once the
instrumentation above shows how often multi-engineer manpower suppression
actually fires in practice — not scoped now, and this decision doesn't
block it later.

**Built against this rule:** `SuppressionNote` (lib/dpr/schema.ts) — a
per-item way to say "this fact is not_captured because the rollup rule
suppressed it, and here's which rule and how many engineers collided"
(distinct from ordinary not_captured, same reasoning `CapturedCount`'s own
zero/absent split was built on), attached to `ManpowerFacts` (section-wide,
unconditional) and per-item to execution quantities and equipment items.
The "complete two-engineer day" golden case
(lib/dpr/eval/cases/case-complete-two-engineer-day.ts) is built against it —
its own headline finding: that case name can no longer mean "all five
model-touched sections are 'complete'," since manpower is unconditionally
suppressed the moment a second engineer submits, by design. That case's
equipment-item aggregate indexing (how two engineers' distinct-type items
get merged into one list) is marked PROVISIONAL in its own file, not
promoted here — it sidesteps this section's equipment identity-resolution
problem for the no-collision case only, and does not answer it.

## 13. Accountability (§6) — ship per-day status, suppress the 7-day pattern
(decided 2026-08-10)

**THE FACT THAT DECIDED THIS.** Before picking how to handle the pattern's
`messaging_blocked` exclusion, we established what actually sets that flag.
Grepped every write path in `app/`, `lib/`, `supabase/migrations/`: **nothing
in application code ever sets `messaging_blocked = true`.** The only writer
is `clearMessagingBlock()` (`lib/whatsapp/reactivation.ts`), and it only
ever writes `false`. The only places the value is ever `true` are test
fixtures, simulating a pre-blocked state so the clear-half has something to
clear. There is no Twilio status-callback endpoint and no cron job touches
this column. Full grep record: this section's own history in conversation;
tracked as its own item in CLAUDE.md §10 (search "BOT-27's SET-HALF").

That finding replaced the original question. It wasn't "how contaminated is
the pattern by past blocks" (options A/B/C, weighed before this fact was
established) — it's that **nothing was ever excluded, because the flag has
never been true in production, so there's no historical block data to
contaminate anything.** But the finding also exposed a BIGGER problem than
the one being asked about.

**THE BIGGER PROBLEM: outbound delivery is entirely unobserved.** No
status-callback endpoint means an outbound 7pm prompt that silently failed
to deliver — bad number, carrier issue, a STOP that went undetected because
nothing sets `messaging_blocked` either — leaves EXACTLY the same evidence
as an engineer who received the question and ignored it: no `daily_logs`
row. Design-principles.md's Rule 5.3 requires ruling out legitimate absence
BEFORE a name appears in this section at all. "We never delivered the
question" is the single most legitimate absence there is, and today it is
completely invisible to any query this codebase can run.

**DECISION:**
- **Ship the per-day status.** "No evening check-in recorded today" is a
  fact about our records, not a claim about the person — it needs neither
  prerequisite below, and it's genuinely knowable now.
- **Suppress the 7-day pattern entirely — not caveated, left out.** The
  pattern is what turns a status line into an accusation: it aggregates
  days we cannot confirm were even deliverable into a single number that
  reads as proven. A stated caveat next to a wrong number doesn't fix this
  — bot-flows.md's own example format ("missed 3 of last 5...") states the
  count with the same declarative confidence as everything else in a DPR,
  and a precise wrong number is harder to argue with, and more damaging,
  than an honest absence of one. Same shape as idle cost suppressed on an
  untrusted hire rate, or `productive_count` left `not_captured` rather
  than fabricated (lib/dpr/idle-cost.ts, lib/dpr/schema.ts) — not a new
  principle, the same one applied to a section that names a person instead
  of a quantity.
- **`'unconfirmed'` kept as a third status**, same family as
  `CapturedCount`'s zero-vs-absent, `SuppressionNote`'s suppressed-vs-absent,
  and `low_confidence`'s shaky-vs-solid — a fourth member, not a new idea.
  Triggered only by same-day peer corroboration (another roster engineer on
  the same project reported `is_holiday=true`); a fully silent day (nobody
  on the roster has a row) has no evidence either way and stays `missing`,
  worded factually rather than accusatorially either way.
- **Per-half status and pattern fields, window excluding today**, kept in
  the `AccountabilityEntry` type even though the pattern isn't computed
  (`morning_pattern`/`evening_pattern` are always `null`) — so turning the
  pattern on later is a fill-in at the aggregator, not a type redesign that
  ripples into every consumer. Per-half because bot-flows.md's own example
  ties a pattern to a specific half, making one shared value ambiguous.
  Today excluded from any future window because the example states today's
  miss in prose and then gives the pattern separately — including today
  would double-count the same failure twice in one sentence.

**THE TWO PREREQUISITES, tracked as blockers on §6's headline output, not
as general debt:**
1. **Delivery-status observability** — a Twilio status-callback endpoint (or
   equivalent), so an undelivered send is distinguishable from real silence.
   Does not exist.
2. **Block history** — a per-day record of `messaging_blocked` state (an
   audit trail, or a flag stamped onto `daily_logs` like `is_holiday`
   already is). Does not exist. Currently moot in practice (nothing sets
   the flag at all — see below), but becomes load-bearing again the moment
   prerequisite 1's sibling problem is fixed for opt-outs specifically.

Without the 7-day pattern, §6 is a status line, not its spec'd headline —
that's acknowledged, not minimized. Golden case #2 ("evening missing for
one engineer") asserts against the per-day status only; it does not — and
currently cannot — assert against a pattern.

**SEPARATE, PRE-LAUNCH ITEM — not filed here as a DPR concern, because it
isn't one.** "Nothing sets `messaging_blocked = true`" has a consequence
well outside this section: an engineer who texts STOP keeps getting
messaged, because nothing notices. That's a WhatsApp Business quality-rating
and compliance problem — Meta throttles messaging limits based on quality
rating, and repeated sends to an opted-out number degrades that rating for
the WHOLE product, not this feature. Tracked in CLAUDE.md §10, next to the
Twilio production-sender work it blocks, not in this document.

## 14. Does Q5 need to ask for available hours at all?
(recorded 2026-08-10, NOT decided — surfaced while revising Q5's prompt
wording ahead of the evening-flow sandbox smoke test, deliberately not
acted on now)

**The question, as raised, not resolved:** for a hired machine on an
ordinary day, "hours available" is usually just the working day and rarely
varies — the engineer is being asked to state something close to a
constant, machine after machine, every evening. Q5 is already the longest
question in the flow (per-machine, two numbers plus an optional reason);
asking for a number that's rarely informative doubles the typing for
comparatively little signal. If `available_hours` defaulted to a standard
value (the working day) and Q5 only asked for `actual_hours` (+ idle reason
when it's short), that would roughly halve the question's burden.

**Why this isn't decided here:** completion rate is the constraint
everything else in this flow bends around (§11's section-5 decision, the
six-question ceiling in design-principles.md's Core Thesis) — cutting Q5's
burden is exactly the kind of change that constraint should drive. But a
default has real failure modes this entry doesn't work through: a machine
that DIDN'T get the full working day (arrived late, broke down mid-morning,
was reassigned) would have its `available_hours` silently wrong unless the
engineer remembers to override it, and idle-cost arithmetic
(`lib/dpr/idle-cost.ts`) is exactly the currency-figure computation this
whole design has been careful not to feed a wrong number into. Whether a
default is safe enough to ship, what the default value should be, and
whether/how an engineer overrides it, are real product questions, not
implementation details — not decided by this entry.

**When to decide:** before the Twilio production sender clears, not now —
changing Q5's shape is exactly the kind of thing that should happen once,
deliberately, not be revised again right after real engineers have started
answering it under the current shape.

## 15. Q4b prompt could anchor to headcount — recorded, not built
(2026-08-10, surfaced fixing the productive/idle inversion bug)

**The idea.** Q4b (`EVENING_QUESTIONS[5]`) currently asks "how many were
idle and why" against a headcount already captured one step earlier (Q4a).
The prompt could restate that number back to the engineer — "Of the 18 on
site, how many were idle?" — making a single number unambiguous by
construction (there's only one blank left to fill) and making the phrasing
that caused the 2026-08-10 incident ("15 productive, 3 idle...") far less
natural to produce, since the question no longer reads as open-ended.

**Why this is recorded, not built.** It reduces how OFTEN parser robustness
gets exercised by a genuinely ambiguous reply — it does not replace the
anchor-word pairing or THE GENERAL GUARD (`numbers_discarded`,
`lib/whatsapp/flows/parsers/productivity.ts`) built the same day. An
engineer can still answer "15 productive, 3 idle" against a headcount-
anchored prompt if that's how they think to phrase it; the parser has to be
correct regardless of the question's wording. Prompt wording narrows the
distribution of real answers; it doesn't bound it. Treating it as a
substitute for parser robustness would be the same mistake the original 17
tests made at a different layer — designing for the phrasings the author
expects, not the ones a real person sends.

**Not scoped now** — a genuine wording change to shipped copy, same
category of decision as §14, deserving its own deliberate pass rather than
being folded into a bug-fix migration.

## 16. assemble.ts copies raw equipment `type` into DprFacts — a Facts/Judgment
boundary violation waiting to happen, not built yet (2026-08-11, surfaced
during PR #45's equipment-label humanize fix)

**The finding.** PR #45 fixed `buildEquipmentHoursPrompt` (the WhatsApp Q5
prompt) so a site engineer reads "1) JCB" instead of "1) jcb". While
confirming no other render path had the same raw-string problem, a second
site was found: `lib/dpr/assemble.ts` (lines 227, 242, 253, 278) copies
`item.type` — the same raw canonical storage key ("jcb", "concrete_mixer")
— straight into `DprFacts` for the equipment section, unchanged from the
morning/evening parsers' storage shape.

**Why this matters, precisely.** `DprFacts` is the Facts side of this
project's Facts/Judgment split (`lib/dpr/schema.ts`) — the whole design
principle behind that split is that every number and label a PM or owner
reads in a DPR should be traceable to code, not to something the model
decided. A `DprFacts.type` value of `"concrete_mixer"` handed to the DPR
generator means one of two things happens when the report renders "Concrete
Mixer": either the model performs that humanization itself (a
transformation happening on the JUDGMENT side of a boundary explicitly
built to keep transformations on the FACTS side), or nothing renders it and
the report shows the raw token instead. Neither is the intended shape —
the humanization this project just built for the WhatsApp prompt
(`equipmentLabel()`, `lib/whatsapp/flows/parsers/lexicon.ts`) should be the
SAME function feeding both surfaces, not reinvented differently (or left
undone) on the DPR side.

**Why this is recorded, not fixed.** The `dpr_generate` job handler does not
exist yet (CLAUDE.md §10) — `assemble.ts` has no caller that renders its
output to a human today, so there is no live bug, only a spec gap waiting
for the generator to be built. Fixing `assemble.ts` now, ahead of the
generator, would be guessing at a consumer's needs before the consumer
exists.

**Fix, when the generator is built:** call `equipmentLabel()` at the Facts
layer (`assemble.ts`) when constructing the equipment `DprFacts` entries, so
the Fact itself already carries the humanized label and the DPR generator
never has to (and structurally cannot) perform that transformation itself.
This is a spec item for that build, not a comment to rediscover — whoever
builds `dpr_generate` should treat this section as a requirement, not
optional polish.

## 17. `numbers_discarded` isn't persisted — a low confidence can't be
explained after the fact (2026-08-11, surfaced running the evening-flow
scenario 2/3 smoke test against prod)

**The gap.** `numbers_discarded` (`productivity.ts`, added alongside the
2026-08-10 inversion fix) is THE GENERAL GUARD — any numeric token the
parser sees but can't place downgrades confidence to `'low'`. It does its
job: `evening_productive_manpower.confidence` reflects it. But the flag
itself is never written to `daily_logs` — only its EFFECT (confidence
downgraded) survives; the CAUSE does not. `FIX 1` (headcount unknown) also
forces `confidence: 'low'`, through the same single field. So a PM (or the
future DPR generator) looking at a `'low'` confidence value has no way to
tell WHICH guard fired: a genuinely ambiguous reply with a discarded
number, or simply a missing headcount from an earlier step, or (in
principle) some future third guard added the same way. One field, several
possible causes, none distinguishable after the write.

**Why this isn't a bug.** Nothing today reads `confidence` expecting to
explain WHY it's low — the DPR generator doesn't exist yet, and the
WhatsApp flow itself doesn't re-ask based on this field (024's reask
budget is separate, already spent by the time this guard evaluates). No
live behaviour depends on the missing distinction.

**Why it matters for the generator build, specifically.** A DPR that
tells a PM "manpower utilisation not shown — low confidence" is a
reasonable sentence. A DPR that could instead say "manpower utilisation
not shown — the engineer's reply had an unrecognised number we couldn't
place" versus "— headcount wasn't captured earlier in the flow" is a
BETTER sentence, and today's schema cannot support writing either specific
version — only the generic one. Whoever builds `dpr_generate` needs to
either accept the generic explanation as permanent product scope, or widen
`evening_productive_manpower`'s stored shape (a `confidence_reason` field
or similar) before the generator's copy is written, not after. Recorded as
a generator-build consideration, not a defect to fix now.
