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

## 12. DPR rollup rule — undefined, surfaced while scoping golden case #5
(opened 2026-08-09, NOT decided here)

**OPEN PRODUCT QUESTION.** `daily_logs` is `UNIQUE(project_id, engineer_id,
log_date)` — one row per engineer, per day. `dprs` is `UNIQUE(project_id,
log_date)` — one row per project, per day. bot-flows.md's own generation
spec already says "Aggregate all daily_logs rows for the project on that
date" — so on any day with more than one engineer, N per-engineer rows
become ONE DPR, and **nothing anywhere defines the rule that turns N rows
into one number.** This surfaced while scoping golden case #5
("contradictory numbers flagged, not averaged") — but it's bigger than
conflicts: the question is unanswered even when every engineer's report is
internally consistent and simply describes a different slice of the same
site-day.

**Three sections, three different flavors of the same question:**

- **Manpower (section 3, headcount/productivity):** two engineers each
  report a headcount. Do they represent DIFFERENT crews on one project
  (correct answer: sum) or the SAME whole-site estimate reported twice
  (summing double-counts)? Code cannot tell these apart from the numbers
  alone — it's a fact about how the engineers were actually asked to report,
  which nothing in the schema captures today.
- **Execution (section 1, quantities):** if two engineers report the SAME
  activity ("slab pour"), are their quantities two PARTS of one pour
  (sum) or the same fact logged twice (duplicate, don't sum)? If they report
  DIFFERENT activities, simple concatenation is probably right and this
  question doesn't even arise — the ambiguity is specifically same-activity
  overlap.
- **Equipment (section 4):** the sharpest edge. Two engineers may each log
  the SAME physical JCB in their own `morning_equipment` — there is no
  shared identifier across engineers' rows (each engineer's equipment list
  is independently indexed; `morning_item_index`, per schema.ts's own join-
  key note, is only unique WITHIN one engineer's row). Naively concatenating
  two engineers' equipment lists would DOUBLE the machine and double its
  idle cost — a real currency figure, stated to the owner, wrong by 2x. This
  isn't an aggregation-math question like the other two; it's an IDENTITY
  RESOLUTION problem (is engineer A's item 0 the same physical machine as
  engineer B's item 1?) with no data to resolve it against today.

**What each answer implies for `CapturedCount`/`CapturedNumber`
(lib/dpr/schema.ts):**

- **Sum:** no shape change — a single rolled-up value is still one number.
  Silently wrong for manpower/equipment when the "different slice" premise
  is false, and code has no way to detect that it's false.
- **Pick one (e.g. max, or a designated lead-engineer report):** no shape
  change either, but this is close to the "silently average or pick"
  failure golden case #5 exists specifically to rule out — picking one
  number and discarding the other loses a real disagreement, which is a
  narrower version of the same problem sum has.
- **Flag multiplicity, don't reduce to one value:** genuinely changes the
  wrapper shape — `CapturedCount` would need something like a
  `per_engineer: Array<{engineer_id, value}>` alongside (or instead of) a
  single `value`, plus a status meaning "conflicting reports, not resolved."
  Every downstream consumer (DPR render, future dashboard, any costing math)
  now has to handle a multi-valued fact instead of one number — a bigger
  ripple than it looks from this section alone.

**Not decided here on purpose.** "A contractor with two engineers on one
tower wants '45 workers on site,' not '23 and 22'" is a real instinct but
explicitly not a spec — recorded as raised, not adopted. Equipment's
identity-resolution problem in particular may need a different answer than
manpower's pure aggregation-math one; this may not be a single rule at all.
Golden case #1 ("complete two-engineer day") is blocked on this decision —
it cannot be written until a rollup rule exists to assert against.
