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

## 10. RESTART SEMANTICS — DECIDED 2026-08-15: refuse-when-submitted

**Aravind's decision, DECIDED, not open.** Of the three candidates below (kept, not
deleted, as the record of what was actually weighed), **refuse-when-submitted** is chosen:

- **Flow in progress (`current_flow IS NOT NULL`) when a start arrives → re-ask the
  current question.** ALREADY BUILT, in both RPCs, today: `apply_morning_flow_turn`
  (022_evening_flow_apply_turn.sql:157-173) and `apply_evening_flow_turn`
  (025_evening_productivity_reconciliation.sql:229-243) both return outcome `'reask'` from
  their `IF p_start_flow THEN ... ELSE v_outcome := 'reask'` branch when `current_flow` is
  not null. Nothing to build here.
- **No flow, not yet submitted → start.** Already the behaviour of the `current_flow IS
  NULL` branch inside `IF p_start_flow THEN` — unchanged.
- **No flow, already submitted → refuse.** NOT YET BUILT. The `IF p_start_flow THEN IF
  current_flow IS NULL THEN` branch in both RPCs currently starts unconditionally — it does
  not check `morning_submitted`/`evening_submitted` before doing so. This is the actual gap
  §10 originally flagged, and the piece this decision requires a future migration to add: a
  check mirroring the one `already_complete` already makes in the non-start path, refusing
  (outcome `already_complete`, not a fresh `start`) rather than restarting when the day's
  submission marker is already true.

**Guards at BOTH layers, not one:** the sweep (`lib/checkin-escalations/sweep.ts`) must not
enqueue a nudge for an already-submitted engineer in the first place, AND the RPC refuses
independently if a start arrives anyway — covers the race where submission lands at, say,
08:58 while a nudge for that engineer is already queued for 09:00/10:00. Two independent
checks, not one relied on to always run first.

**Consequence for the build, stated as the load-bearing fact it is:** THE SEND AND THE
NUDGE ARE THE SAME OPERATION, differing only in clock time — both are "call
`p_start_flow=true` against this engineer's session." The identical primitive that fires
the 08:30 send and the 10:00 nudge is also what would carry the PM notification content and
the automatic owner send, once those are wired to real triggers rather than the env-gated
test token. **Six scheduled events (send, nudge, escalate-surface, cutoff-close,
send-again, nudge-again on the evening side, DPR-generate/PM-notify, owner-send), one
underlying mechanism** — this is the shape the outbound-trigger primitive (see the
separate, dated finding on no-production-starter) needs to be designed around, not six
separate senders.

**The refusal copy changes at the same time.** `MORNING_ALREADY_COMPLETE_REPLY` ("You've
already sent today's morning check-in. ✅ Nothing more needed.") and its evening
equivalent are the reply text a refused restart would now surface where today it would
have silently restarted the flow instead — "Nothing more needed." is a Rule 3.5 dead-end
in the same family as the BOT-07 idle-silence finding (both say "the system received your
message and has nothing useful to tell you about it"). Named here as copy that needs
revisiting alongside the actual refuse-when-submitted implementation; not rewritten in
this pass — the RPC-level change hasn't shipped yet for this copy to attach to.

**Not implemented in this pass.** This section records the DECISION. The RPC-level change
(adding the submitted-check to the start branch in both migrations) is schema/live-function
logic — it goes through a new migration and the same external-review path 028 went
through, not a same-night doc-and-code edit.

---

*Original entry, 2026-08-05, kept below for the record of how the decision was reached —
not restated as still-open.*

### 10. RESTART SEMANTICS — start triggers restart completed flows (2026-08-05)

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

## 18. Containment Reading A resolved as (c): raw text stays prompt input,
moved to no-digit output — specificity lost, not relaxed (2026-08-11, DPR
generator slice, Aravind's decision)

**The question.** `schedule_miss_reason_note` and `tomorrows_plan_carry_
forward_note` were originally digits-allowed, containment-checked against
"the input text it was given" (schema.ts's pre-2026-08-11 comment) — the
engineer's own raw free text (`evening_schedule_miss_reason`). Under strict
Reading A (containment against code-owned `DprFacts` values only, not raw
prompt text), that raw text is not itself a Fact, so a digit the model
echoed from it would have no legitimate source to trace to — the two
options were (a) promote the raw text into a new `DprFacts` field so it
becomes code-owned, or (c) keep feeding it as prompt input but move the two
output fields to no-digit, matching sections 3 & 4's notes.

**Resolved: (c).** The Facts/Judgment split governs what the model may
OUTPUT, never what it may READ — feeding raw text as input was never the
boundary reading A protects. (a) was rejected because it blesses every
digit an engineer typed in free text as publishable: an engineer writing
"only 40 of 100 done" would produce a DPR number that never passed through
the quantity pipeline, able to directly contradict the code-owned execution
Facts in the same report. That is Reading B narrowed to one field, not a
different thing from it — the whole reason Reading A was chosen is that
engineer free text is not a verified source.

**The specificity this costs, named plainly:** "delayed by 3 hours" becomes
"delayed." No duration, no count, no measured quantity survives into either
field's output — only the qualitative shape of the reason. This is not
treated as a stopgap grudgingly accepted; it's the same rule already
governing sections 3 and 4's notes, applied consistently rather than
carved out as a third category for these two fields.

**The recovery path, if beta shows this matters:** capturing the specific
number as a REAL, structured question — e.g. a dedicated "how many hours
were lost" follow-up with its own parser, feeding a typed `DprFacts` field
the same way `evening_productive_manpower` does — not relaxing this rule to
let raw digits back into model output. If engineers or PMs surface a real
need for the duration figure, the fix is capturing it properly upstream,
the same way every other number in this schema is captured: through a
parser, into a Fact, containment-checked like everything else. Loosening
containment to solve it would recreate exactly the problem (c) exists to
close.

## 19. Containment's named limitation: identifier-digit blessing within one
section (opened 2026-08-11, PR #50 design review, NOT fixed)

**The gap.** `buildExecutionCorpus` (lib/dpr/containment.ts) normalizes
every digit-bearing token in the model's output to a `Set<number>` and
checks membership — containment is NUMERIC-SET membership, not
token-in-context matching. An activity Fact named "M25 slab" puts the bare
number `25` into the corpus (via the activity-string pass, the same
mechanism that legitimately makes ordinals and identifiers free — see
schema.ts's digit-rules note). Once `25` is in the corpus, the model may
correctly write "M25" back — but could ALSO write "25 bays" or "25
workers" and pass containment, because the check only asks "is 25 anywhere
in this section's Facts," never "does 25 in THIS sentence refer to the
same thing it did in the Facts."

**Why this matters precisely.** This is the SAME class of fabrication
section-scoping (§ approved in this PR's design review) was built to stop
— a real digit reused to dress up an invented figure — just surviving
WITHIN one section instead of across sections. Section-scoping closes the
cross-section case (a real equipment rate cited as an execution quantity);
it does not close this narrower, same-section case (a real identifier
digit cited as a fabricated quantity in the same narrative).

**What the check DOES catch, stated precisely so this isn't oversold:** a
number with no source anywhere in execution Facts — the actual incident
class this slice was built to catch, and the common case by far (most
fabrications invent a number that isn't real anywhere, not one that
happens to share a digit with a real identifier).

**What it does NOT catch:** a real identifier digit reused as a fabricated
magnitude in the same section, as in the M25 example above.

**Why not fixed here.** Closing this properly needs token-plus-context
matching — e.g. requiring the digit's surrounding words to overlap with
the source phrase it came from, not just requiring the digit itself to
appear somewhere in the section. That is real design work (what counts as
"enough" surrounding-word overlap, how to handle paraphrase, whether it
produces false positives on legitimate rephrasing), not a tweak to the
existing set-membership check. Recorded as the recovery path if beta
usage shows this gap is actually exploited — not built speculatively
against a failure mode not yet observed in real output.

## 20. First real generator run: decision (c) cost nothing measurable, and a
real cost-per-DPR figure (2026-08-11, PR #50 follow-up — first live calls
against Claude, not a fixture or a dry run)

**Decision (c)'s empirical answer.** §18 accepted a real tradeoff blind —
moving `schedule_miss_reason_note` and `tomorrows_plan_carry_forward_note`
to no-digit, at the cost of specificity ("delayed by 3 hours" becomes
"delayed"), rather than let raw engineer digits into the report. The first
two real golden cases to actually generate (case-complete-two-engineer-day,
case-manpower-equipment-not-captured — the third, zero-equipment case,
hadn't been fixed yet at the time of this run) came back with:

- **Zero containment violations.** Neither case's `execution_narrative`
  cited an uncontained digit.
- **Zero no-digit violations**, on the first attempt, no retries. Every one
  of the four no-digit fields — `schedule_miss_reason_note`,
  `manpower_idle_reason_note`, both cases' `equipment_items[].
  idle_reason_note`, `tomorrows_plan_carry_forward_note` — came back as
  clean prose with no digit characters at all, and nothing in the prose
  reads as contorted or evasive from having to avoid one.

**What this means, stated precisely — this is two real data points, not a
statistically powered claim.** It's real evidence the model can write a
coherent no-digit sentence without needing the literal number, in the exact
shape decision (c) worried about (a schedule miss reason, a carry-forward
note). It is not proof this holds at scale, under every real phrasing beta
users will send, or that the model never needs the number to stay coherent.
Recorded as the first evidence, to be added to as more real runs happen —
not treated as the question closed for good.

**Cost per DPR, measured, not estimated.**

| Case | Input tokens | Output tokens | Latency | Cost |
|---|---|---|---|---|
| case-complete-two-engineer-day | 1887 | 880 | 10273ms | $0.018861 |
| case-manpower-equipment-not-captured | 1727 | 473 | 11247ms | $0.012276 |

Average: **≈$0.0156/DPR** (n=2, golden-case fixtures rather than live
production Facts — a rough figure, not a robust average; will firm up as
more real project-days run).

**Priced at the standard rate ($3/$15 per MTok), not the $2/$10
introductory rate live through 2026-08-31** (`generate.ts`'s own comment on
`INPUT_COST_PER_MTOK`/`OUTPUT_COST_PER_MTOK` states this explicitly, for
the same reason: these figures must read correctly after the introductory
window closes, not just today). If run before 2026-08-31, real cost is
roughly a third lower than the table above.

| Scope | Monthly cost (1 DPR/day × 30 days) |
|---|---|
| 1 project | ≈$0.47 |
| 10 projects | ≈$4.67 |
| 50 projects | ≈$23.36 |

At any of these scales, DPR generation cost is not the constraint on
shipping this feature — it's negligible against Twilio, hosting, or any
other line item this product already carries. Worth having the number on
record precisely because it settles the question rather than leaving it as
an assumption.

## 21. Impersonal narrative — no named individuals in the DPR (2026-08-11,
Aravind's decision, PR #51 review)

**Decision.** The DPR narrative must not attribute site work to named
individuals. It reports site output — what was done, where, how much — not
who did it. Enforced globally in `SYSTEM_PROMPT` (`lib/dpr/generate.ts`),
not scoped to `execution_narrative` alone, because the rule is the same for
every free-text field the model writes. The prohibition also covers
indirect identification ("the engineer who reported first," "the senior
engineer," "the second team") — a model that complies with the letter of a
no-names rule while still pointing at a specific person through description
is worse than naming outright: the document *looks* anonymised while an
owner reading it can still work out who is meant.

**Rationale:**

(a) §6's accountability view is deliberately worded records-not-person, so
a missing check-in reads as a data gap, not an accusation. A narrative
naming individuals on the same document contradicts that stance directly.

(b) The DPR reaches the project owner. Attributing a shortfall to a named
engineer in a client-facing document politicises a daily operational
report.

(c) Nothing is lost — per-engineer submission status stays visible in §6
regardless of narrative wording.

(d) **Contractor naming is banned here too, but that is a separate
question, deliberately left undecided.** A subcontractor is a commercial
counterparty, not an employee — "the electrical contractor did not turn up"
is operationally useful to an owner in a way that naming an individual
engineer is not, and the politicisation argument in (b) does not transfer
cleanly to a firm. It is held under the same ban for beta anyway, for a
different reason: the name arrives as unverified free text from a WhatsApp
message, and a wrongly-named firm in a client-facing document is its own
liability, independent of the politicisation question. Revisit once beta
usage shows whether owners actually ask for contractor-level attribution.
Do not read this line item as settled the way (a)-(c) are — it is a
scope-narrowing note, not a closed decision.

**Origin.** Surfaced in the first live golden-case run (§20): with no such
instruction, `case-complete-two-engineer-day`'s `execution_narrative` named
both reporting engineers verbatim ("Rajesh's crew completed shuttering
work... Suresh's crew carried out RCC column casting"), sourced from that
case's raw input text. Confirmed fixed by a second live run against the
same case after the `SYSTEM_PROMPT` addition — see the DPR generator PR
for the rendered before/after.

## 22. "What this report does not know" — a blank field's CAUSE, not just its
presence (2026-08-11, Aravind's finding, PR #51 review round 3)

**The finding.** §6 (accountability) prints "All engineers submitted both
check-ins today" directly above sections that are still blank. To an owner
those two facts contradict: if everyone reported, why does the report know
nothing? §6 only ever answers "did they check in at all" — a binary on
submission PRESENCE. It says nothing about whether a submitted check-in
yielded USABLE DATA, and a blank field on its own carries no recorded
cause. Part 1's rendering fix (Inline/Standalone split, the wholly-blank
collapse) made each individual blank read cleanly instead of repeating
"Not captured today." three or four times — but cleanliness isn't
causation. It still didn't say WHY a field is blank.

**The four possible causes, and which are actually distinguishable with
data that exists today — checked, not assumed.** A blank field can mean:
(1) never asked (the flow question doesn't exist yet), (2) asked, no
usable answer given, (3) withheld by §12's multi-engineer suppression
policy, or (4) a system fault — the engineer answered correctly and the
pipeline lost or mangled it before persisting. The 2026-08-10 productivity
inversion bug is proof case (4) is not hypothetical.

Checked each against `docs/schema.md`'s actual column definitions, not
memory:

- **Cause 1 is fully solved already**, and by the RIGHT mechanism.
  `TOMORROWS_PLAN_DATA_STATUS_FORCED` (`lib/dpr/schema.ts`) is a
  compile-time constant tied to whether Q6 has shipped — more trustworthy
  than a per-row DB flag, which could in principle drift from reality;
  a hardcoded pre-Q6 constant cannot, until it's literally removed at ship
  time.
- **Cause 2 is fully solved already** too, via `CapturedCount`/
  `CapturedNumber`'s existing `not_captured` status — that status IS
  "asked, no usable answer," by construction, wherever cause 1 doesn't
  apply.
- **Cause 3 is fully solved already**, via `SuppressionNote` — though its
  meaning is under revision; see §24.
- **Cause 4 is NOT solved, and cannot be solved with today's data for
  every field — uneven, not uniformly absent.** `evening_productive_
  manpower` and `evening_equipment_utilisation`/`morning_equipment` DO
  preserve the engineer's raw reply text alongside the parsed values
  (`raw_text` at the whole-answer level, `raw` per item —
  `docs/schema.md` lines 227, 243) — a human reading that text after the
  fact COULD spot a mismatch (this is literally how the 2026-08-10
  inversion bug was actually found). But `evening_workers_on_site`
  (headcount) preserves NO raw text at all: migration 024 "reuses
  parseLabourCount verbatim, only planned_total persisted" — the parser's
  other output, including anything resembling raw text, is discarded at
  write time (`docs/schema.md` lines 214-219). For headcount specifically,
  the honest answer is: never stored, not recoverable even by hand.

  More importantly, even where raw text IS preserved, **nothing today
  compares it to the parsed value.** The raw text is a forensic record a
  human can go read during an incident investigation — not something
  `assemble.ts` or the DPR generator cross-checks automatically at report
  time. "Detectable" has two different answers depending on whether it
  means "a human doing archaeology could tell" (yes, for most fields) or
  "the system can tell, automatically, tonight" (no, for any field,
  today).

**Consequence for §6-adjacent wording: case 2's attribution to a named
engineer is UNSAFE, and this is a materially different answer than
originally assumed possible.** Since case 2 (asked, no answer) and case 4
(system fault) cannot currently be distinguished automatically — and never
can be for headcount, absent a schema change — an automatic per-night
report cannot safely say "this engineer didn't answer" rather than "we
lost it." Naming an engineer for a gap this system cannot actually attest
the CAUSE of would overclaim what's known, in a document the contractor's
client reads. The section built from this finding therefore names no
cause more specific than "not answered" / "not yet asked," and — as a
direct consequence — names no engineer, for any cause, matching
`lib/dpr/accountability.ts:69-72`'s existing records-not-person convention
and Rule 5.3 (`docs/design-principles.md`).

**BUILT (2026-08-11), small version, undifferentiated cause.** A new
section, `WHAT THIS REPORT DOES NOT KNOW`, in `renderContent`
(`lib/dpr/render.ts`), placed after `TOMORROW'S PLAN` and before
`ACCOUNTABILITY` — Rule 5.2's ordering (decisions/key drivers first,
flagged gaps next, full detail last) — and kept as its OWN section rather
than folded into §6: a missing check-in and an unusable answer call for
different PM actions (reactivation/engagement vs. data-quality), and
merging the two signals into one would destroy that distinction. Omitted
entirely (not printed empty) when there is nothing to explain — Rule
4.1/5.6, don't clutter a clean report.

Covers ONLY cause 1 (Tomorrow's Plan, via the existing
`TOMORROWS_PLAN_DATA_STATUS_FORCED` constant — the line disappears on its
own at Q6 ship time, nothing to remember to delete) and cause 2, scoped
specifically to the manpower-productivity shape the original finding was
about (headcount captured, productivity/idle not). Cause 3 (§12
suppression) is deliberately excluded — already fully explained inline
within its own section (`manpower.note` / an equipment item's `.blank`);
restating it here would be the exact same-sentence-in-multiple-places
redundancy Part 1 just removed elsewhere. Cause 4 is not claimed at all,
per the finding above — no field asserts a system fault occurred, because
this system cannot currently tell.

`computeDataGaps()` (`lib/dpr/render.ts`) is render/prompt-layer only: no
new `DprFacts` field, no RPC change, no migration — it reads Facts/
Judgment state the pipeline already computes and displays elsewhere.
`RenderedDpr.structured` gains `data_gaps: string[]` alongside `content`'s
new section, for a future PM dashboard surface to consume directly rather
than parsing rendered text.

Extending this to causes 3/4, or to other sections (schedule, equipment),
is future work, not implied as already covered — see §24 for cause 3's
fate under Part 2, and the "rough size" note in the PR discussion for what
building cause 4 detection would actually require (raw-text preservation
added to `evening_workers_on_site`, a new comparison heuristic with its
own false-positive risk, a new `DprFacts` field) — deliberately NOT
bundled into this pass.

## 23. Rejected: restricting beta to one engineer per project (2026-08-11,
Aravind's decision, recorded so it does not get re-proposed)

**Considered and rejected**, while scoping §24's per-engineer reporting
design. Never an enforced rule to begin with — confirmed by grep across
every migration file in `supabase/migrations/`: the only relevant
uniqueness constraint anywhere in the schema is `daily_logs`'
`UNIQUE(project_id, engineer_id, log_date)` (one row per engineer per
day). Nothing caps how many engineers a project can have, in schema, RPC,
or dashboard. §12's own prod query (this file, above) found zero
multi-engineer projects TODAY — an observed fact about current usage, not
a designed-in restriction.

**Rejected for two reasons.** (1) §24's per-engineer reporting design
removes the reason such a restriction would exist — the unresolvable
ambiguity §12 suppresses today stops being unresolvable once the report
shows both engineers' figures separately instead of collapsing them. (2)
An unenforced ASSUMPTION would be worse than either building the
restriction for real or not having it at all: §12 itself already named the
exact failure mode — "a customer with two engineers on one project would
get a DPR with a permanently blank labour section, not an occasionally
imprecise one." Relying on an informal, unenforced "beta customers only
have one engineer" belief is the same risk with no mechanism backing it —
a silent trap the day a customer adds a second engineer, waiting to be
discovered in production rather than caught here.

## 24. Per-engineer reporting replaces §12 suppression — APPROVED IN DESIGN,
DEFERRED IN BUILD (2026-08-11, Aravind's decision, PR #51 review round 3)

**Decision in principle.** Stop suppressing manpower/schedule/equipment/
execution figures on a multi-engineer day. Report what EACH engineer
reported, separately, and give the PM the power to resolve overlaps in the
app. Nothing is discarded; the resolution lands with the only party who
can actually know whether two headcounts are one crew counted twice or two
crews on different blocks. See §23 for the rejected alternative (restrict
beta to one engineer) this decision supersedes the need for.

**GATE, NOT A DATE (2026-08-11).** Built when the first project with two
active engineers exists, whichever comes first with an explicit decision
by Aravind — not before, and not on a calendar date. Zero such projects
exist today (§12's prod query), so §12 suppression is currently dormant —
this design costs nothing to leave unbuilt while that stays true. A
date-based deferral has already failed repeatedly in this project (the
migration-025 pure-mirror test deferral slipped three sessions running
before being replaced with a conditional gate, CLAUDE.md §10) — a
date competes with whatever the next session's actual priority turns out
to be and loses; a gate tied to the triggering event fires exactly when it
matters, not before, and cannot slip.

**The full design, so it doesn't need to be re-derived when the gate
fires:**

**(a) Reconciliation setting is per-project, not per-day.** A nullable
column on `projects`: `manpower_reconciliation_mode: 'disjoint_scopes' |
'overlapping_scopes' | null`. Project-level, not a per-engineer-pair
table — the only shape any current (hypothetical) data would support is
one relationship per project. Captured at FIRST COLLISION (the first day
two engineers actually report for one project), not at project setup — a
PM won't reliably know in advance whether two engineers' scopes will
overlap; grounding the question in an observed instance matches this
project's "verify by observation" posture (CLAUDE.md §0). Persists to the
project row, stays editable. Default before answered: `null` — never
attempt a combined total, always show the per-engineer split
unreconciled.

**(b) Staging — confirmed, no migration for the split itself.** The
per-engineer SPLIT (showing raw figures separately, no combined total) is
entirely a Facts-shape + prompt + render change, within the existing
`dprs.structured` (JSONB) / `dprs.content` (TEXT) columns — no migration.
The RECONCILIATION UI — (a)'s `manpower_reconciliation_mode` column, and
wherever a PM's resolved-total override would be stored — needs one,
deliberately staged second.

**(c) Generalizing across the four `SuppressionReason`s — uneven, not
uniform.**
- `multi_engineer_manpower`, `multi_engineer_schedule` generalize
  cleanly. Schedule specifically should build exactly what §12 already
  named ("1 of 2 engineers met today's plan") — not reinvented — though
  showing the literal per-engineer values (same shape as manpower) is
  favored over a computed "N of M" summary sentence, since a summary is
  itself a small aggregation decision (what about a third engineer who
  didn't answer at all?).
- `same_activity_overlap` (execution, §1) generalizes STRUCTURALLY (show
  both, don't discard) but stays a PER-DAY PM JUDGMENT CALL, not a
  persisted per-project setting like (a)'s. Two engineers reporting
  "shuttering, grid C1" might be the same work counted twice, or two
  genuinely separate pours sharing a name — unlike manpower/schedule, this
  isn't a stable property of the project, it varies day to day.
- `same_type_equipment` (§4) is an OPEN QUESTION for whoever builds the
  reconciliation UI — it sits between the two: generalizes structurally,
  and IF a project has stably-assigned distinct machines per engineer
  ("Engineer A always runs JCB #1"), a per-project setting like (a)'s
  would make sense — but that shouldn't be assumed as the common case
  without evidence from real usage.
- `SuppressionNote` does NOT disappear as a concept, but its meaning
  shifts from "discard, show nothing but a sentence" to "collided, shown
  separately, not yet reconciled." **RENAME TO MAKE AT BUILD TIME, noted
  now so it isn't rediscovered**: something like `unreconciled` reads more
  honestly than `suppressed` once nothing is actually being hidden.

**(d) `DprFacts` shape — the part most likely to be underestimated.**
Manpower and schedule become per-engineer LISTS — the only two sections
currently a single aggregate-or-suppressed object rather than a list.
Propose always an array, even length 1 for single-engineer days, so
there's one code path regardless of engineer count (this project's own
recurring lesson against hand-mirrored branches silently diverging,
CLAUDE.md §10). Equipment/execution are already lists — the
`byType`/`activityGroups` grouping-and-suppress branch in `assemble.ts`
disappears entirely once collisions stop collapsing; every engineer's item
becomes its own entry, but `EquipmentItemFacts`/`ExecutionQuantityFact`
need an `engineer_id`/`engineer_name` field added (neither carries
engineer attribution today, since the old aggregate assembler only ever
needed a COUNT of colliding engineers, never WHICH ones), and `type` alone
stops being a sufficient display label once two same-typed items can
legitimately coexist.

Containment corpus construction barely changes — it already builds from a
list of numeric values, indifferent to attribution. Item 8's impersonal-
narrative decision (no named individuals, direct or indirect) means the
model can never write "Engineer A poured 40 cum" regardless, which mostly
resolves the sharper version of this question (could the model misattribute
a real number to the wrong engineer in a sentence a reader could act on?)
as a side effect — a favorable interaction between the two decisions, not
independently proven here.

**The part most likely to be missed**: manpower/schedule's no-digit note
fields (`manpower_idle_reason_note`, `schedule_miss_reason_note`) are
single strings today, one per section. Per-engineer lists raise the
question of whether each engineer gets their own note — if so, that's a
`DprJudgment` schema change too, not just Facts, and `isManpowerNoteDiscarded`/
`isScheduleNoteDiscarded` (`lib/dpr/discarded-fields.ts`) need to
generalize from a single boolean to a per-entry predicate — the same shape
`isEquipmentItemNoteDiscarded` already has. Item 6's per-call-schema-
shaping work (`buildPerCallSchema`, `lib/dpr/generate.ts`) would multiply
across N engineer entries, not run once per section.

**Prompt guardrail — DEFENCE-IN-DEPTH, NOT A MUST-HAVE. Correction to the
original proposal (2026-08-11, Aravind).** The original proposal called a
new `SYSTEM_PROMPT` instruction ("do not sum or average per-engineer
figures into a combined statement") a must-have. Downgraded: the
STRUCTURAL protections already cover the dangerous case. The manpower and
schedule note fields are no-digit, so a summed figure cannot appear there
at all. A summed manpower figure in `execution_narrative` would fail
containment, because the corpus is section-scoped and manpower values are
not in execution's corpus. What the instruction actually adds is coverage
of QUALITATIVE aggregation ("together the figures suggest a larger
workforce") — real, but a materially smaller and different risk than the
arithmetic one, which structure already forecloses. Add the instruction
for that narrower purpose; describe it accurately as defence-in-depth when
it's added, not as the control — this project's standing lesson (the
whole reason the arithmetic boundary is enforced at the type level, not by
instruction) is that an instruction is not an enforcement mechanism, and
calling one a must-have invites a future author to rely on it as if it
were.

**Render**: the Inline/Standalone collapse work (Part 1, this session)
doesn't disappear — it multiplies. Each per-engineer entry independently
needs the same partial-vs-blank handling one section needed before.

**Golden fixtures**: `case-complete-two-engineer-day.ts` needs the most
rework of any file this design touches — its entire premise (manpower
suppressed, `manpower_data_status === 'not_captured'`) becomes wrong; it
currently asserts against exactly the behavior this design removes. At
least one NEW golden case is also needed — none of the current three
exercise "two engineers, both report real, different manpower numbers,
shown separately," a materially new scenario, not a variant of an
existing one.

**(e) Readability.** Collapse the per-engineer manpower block to one line
per engineer once N > 1 (`Engineer A: 15 on site, 12 productive, 3 idle` /
`Engineer B: 8 on site, 8 productive, 0 idle`), reserving the current
4-line detailed block for the single-engineer case where it already reads
well. A real UX decision, not a mechanical one — `docs/design-
principles.md` should be consulted before finalizing wording/layout, not
freelanced in a render change, per CLAUDE.md's own instruction for any
user-facing surface. Rough ceiling before a plain-text WhatsApp/email
report reads as a wall of numbers: somewhere around 4-5 engineers per
section — an estimate, not a measurement. Past that, a summary-first shape
("5 engineers reported manpower — full breakdown on the dashboard") with
detail deferred to the PM web view is one option, but whether the DPR text
stays the single source of truth for any roster size is a bigger product
question, left open here.

**(f) What the owner sees before reconciliation.** A framing sentence
must precede any split figures — never a raw juxtaposition with no
explanation: "Two engineers reported on this project today. Their figures
are shown separately below because the site coverage overlap between them
has not been confirmed." Same register as the Part 1 `SUPPRESSION_PROSE`
rewrite (this session) — plain explanation, no claimed total, no internal
vocabulary; this design doesn't need a new voice, just the same one no
longer used to justify hiding the numbers.

Owner's and PM's copy should DIFFER, flagged as a real decision rather
than assumed: the owner shouldn't be handed an unresolved gap to interpret
themselves — that IS the "reads like a system that cannot count" risk
this design exists to avoid triggering. Owner's copy: the split, always
with the explanatory sentence, never a bare call-to-action aimed at the
PM's own app. PM's copy (where the reconciliation UI lives): the same
split plus an actionable prompt ("Resolve: same site, or different
crews?"). Extends the existing owner/PM content-scoping precedent
(CLAUDE.md §4 — owner DPR content is strictly single-project scoped) along
a different axis — detail level, not project scope — rather than
inventing a new principle.

**Full origin and proposal discussion**: PR #51 review round 3
(2026-08-11).

## 25. TEMPLATES and a PRODUCTION SENDER are two separate Meta dependencies —
only the first is removed by the customer service window (2026-08-12)

Verified against Meta's and Twilio's current documentation (not memory —
both this session's and a prior session's recollection of this rule were
checked against source, since the two disagreed): a business-initiated
WhatsApp message sent inside the 24-hour customer service window (opened
and reset by any inbound message from the user) requires no pre-approved
template — Meta's own term for this is a "service" conversation, free of
charge, no category assignment beyond "service." This means the daily
check-in nudge rhythm (morning nudge ~9-12h after the prior evening reply,
evening nudge ~9-12h after the prior morning reply) can run with **zero
Meta template approvals**, provided every engineer has sent at least one
inbound message to open the window.

**This does NOT unblock the production Twilio sender**, and the two must
not be conflated when talking about what's "blocked on Meta." CLAUDE.md §10
tracks the sender application as its own item (~2 weeks, blocked on company
registration) — that dependency is unrelated to templates and is untouched
by this finding. The sender governs WHETHER Quoco can send WhatsApp
messages from a production number at all (currently only the Twilio Sandbox
is available); templates govern WHETHER a specific business-initiated
message needs pre-approval once a number CAN send. Removing the template
requirement for in-window nudges does nothing to the sender's own
~2-week/entity-paperwork timeline — the certificate/company-registration
path stays on the critical path for anything beyond sandbox testing
regardless of this finding.

**What the finding actually buys**: the ability to build and test the full
nudge/check-in rhythm against the Sandbox now, without waiting on template
approval — the template-approval tail is removed from the timeline, not the
sender-application blocker. The Sandbox carries its own separate
constraints (72-hour join expiry per engineer, no custom templates at all,
1 msg/3s rate limit) that don't apply to production but do shape how a
multi-day sandbox beta actually runs.

**The one case this doesn't cover**: a gap >24h since an engineer's last
inbound (a skipped day, weekend, sick day) closes the window, and the next
scheduled nudge would need either a template or the engineer to
self-initiate. Full analysis in the conversation this decision came from,
not restated here — see also CLAUDE.md's WhatsApp-flow entries.

## 26. AUTH DECISIONS — recorded as a SEPARATE workstream, NOT planned or built here (2026-08-15)

**Recorded only. No plan, no scoping, no code from this entry.** Aravind's decisions,
captured so they exist on the record before the workstream itself starts:

- **First user creation → magic link (unchanged, existing behaviour). Every login after
  the first → OTP delivered over WhatsApp**, not magic link, not password.
- **Session expiry: 7 days, SLIDING** — inactivity-based (each real request resets the
  7-day window forward), not a fixed ceiling from login time.
- **Trips CLAUDE.md §0 condition (c)** ("touches auth or identity") on its own terms,
  unambiguously — **this workstream goes to external review from the PLAN stage**, not
  just before apply. Named explicitly so nobody has to re-derive it from the gate's general
  wording when this work actually starts.
- **WhatsApp OTP needs its own Meta template category: Authentication.** Distinct approval
  track from the Utility-category check-in templates already in flight — purely functional
  wording required, a mandatory validity-period line, and the variable slot MUST be the
  bare numeric code (no surrounding sentence fragment in that slot). Priced at
  **~₹0.115 per delivered message in India, roughly half the equivalent SMS OTP cost.**
- **⚠ Authentication-category templates are billed on EVERY delivery, including inside an
  already-open 24-hour session window — unlike every other template category.** The
  "in-window sends are free" reasoning this project's check-in design leans on (§25 above)
  does NOT carry over to OTP sends. Every login OTP is a real, metered cost, full stop.
- **⚠ WhatsApp-only auth is a single point of lockout.** This codebase already has a named
  `messaging_blocked` state precisely because WhatsApp delivery fails for some users
  (opt-outs, carrier issues, number changes) — under WhatsApp-only OTP, a user in that
  state could not receive a login code to fix their own account. **Recorded as an
  accepted, dated MVP risk, not a blocker and not silently ignored** — SMS fallback is
  named as the eventual closer, not built now.
- **Shares the Meta template-approval dependency already on the critical path** for the
  check-in flows (§25's own finding: the certificate/company-registration timeline, not
  the template review itself, is the long pole) — Authentication-category approval is a
  SEPARATE submission from the Utility-category check-in templates, so this cannot go live
  ahead of its own approval landing, independent of whatever happens with the check-in
  templates' timeline.

**Why recorded here and not scoped further:** per direct instruction, this is capture
only. The workstream's own plan — when it starts — inherits condition (c)'s external-review
requirement from its first draft, not as a gate discovered partway through.

## 27. PP2 — check-ins are CRON-TRIGGERED, not inbound-triggered. `routeInboundMessage`'s start branch is SCAFFOLDING (2026-08-20)

**Aravind's decision, recorded, not built here.** The correct, permanent design: morning
and evening check-ins are triggered by a **scheduled cron** (morning send, evening send
at 18:30, per `CHECKIN_CHECKPOINTS`) calling the outbound-send primitive (#69/031) —
**never by an inbound message.** An inbound message's role is narrower than the II3 build
(`lib/whatsapp/inbound-start.ts`, `routeInboundMessage`) currently gives it:

- **A flow already active** → continue it (unchanged — `dispatchInboundTurn`'s existing
  ordinary-reply routing is correct under this design too, ordinary replies were never in
  question).
- **No flow active** → the inbound gets a **short acknowledgement** confirming receipt and
  naming when the next check-in comes — **it does not start a flow.** Starting is the
  cron's job, exclusively.

**Why this reverses II3's own design, stated plainly rather than left implicit:** II3
built `routeInboundMessage`'s no-active-session branch to let the ENGINEER'S OWN message
start morning or evening (per `docs/inbound-start-trigger-plan.md`'s window/submission-
state table) specifically because, at the time, no scheduled trigger existed at all and
the engineer-initiated path was the only way to get real data into the system before the
outbound-send primitive was built. That reasoning does not survive the cron existing.
Once the cron reliably sends the 8:30am/6:30pm prompt, an inbound-initiated start becomes
a second, competing way to enter the SAME state machine — exactly the kind of redundant
entry point CLAUDE.md's own §0 discipline (single source of truth, no parallel
mechanisms) argues against elsewhere in this project.

**Consequence 1 — `routeInboundMessage` is SCAFFOLDING, not the final shape.** It is
correct and tested for what exists TODAY (no cron, no outbound-send primitive) and should
keep running exactly as built until the cron lands. When it does, `routeInboundMessage`'s
no-active-session branch — the window table, the `daily_logs` submitted-check mitigation,
the KK2 race guard, `REPORT_READY_REPLY`, all of it — is replaced by the short
acknowledgement above. This is a planned removal, not a bug fix; recorded here so
whoever builds the cron doesn't have to rediscover that `routeInboundMessage`'s start
branch is meant to be retired, not extended.

**Consequence 2 — this moves the outbound-send primitive (#69/031, PR #69) to the head
of the build sequence, not just "the precondition" in the abstract sense CLAUDE.md's
STANDING ARCHITECTURAL FACT (§3) already names.** Under this design, it is not merely
true that "the system can only reply" — it is true that the system's *correct* behaviour
(cron-triggered check-ins) cannot exist AT ALL until #69/031 ships. Every other
Fast-Follow/Spine sequencing question is downstream of this one.

**Not built here.** No code changed by this entry. `routeInboundMessage` is unmodified —
this is the design record that says WHEN and WHY it will be, once the cron exists.
Cross-referenced from `docs/inbound-start-trigger-plan.md`'s own status header and
CLAUDE.md §3's STANDING ARCHITECTURAL FACT, both updated in the same pass as this entry.

## 28. Seven follow-on decisions to §27 (2026-08-21) — DECIDED, not built

Closes seven open threads from the 2026-08-20/21 session's live-defect investigation
(tonight's real `daily_logs` row, `303fb071-2afa-4b08-92cf-ab7202730051`). All seven are
design decisions only — no code, no migration, no branch created by this entry.

### a. Start semantics — resolves the §27-vs-bot-flows.md tension

**DECIDED.** The cron sends exactly ONE message, at 08:30 IST: the invite, and that
invite already contains the first question (template 1's body, once re-cut — see the
template section of this session's own record). The session is marked ACTIVE at SEND
time, `current_step = 1`, by the cron's own call — not by the engineer's reply. The
engineer's reply is the ANSWER to Q1, not a start signal. §27's own rule holds without
exception: **the engineer never initiates; the cron always does.** There is no second
message, and no two-step "invite, then ask" handshake — the tension recorded in §27's own
addendum (bot-flows.md:50-56 describing "the initiating message" as separate from "the
state machine after it") is resolved by removing that separation: the initiating message
*is* the state machine's first question, sent by the cron, not by a reply-triggered RPC
call.

**Correction to the 7:30-vs-08:30 claim this decision was drafted against, checked
before writing it in, not assumed:** the two candidate values do not actually conflict on
the page as claimed. `bot-flows.md:31` — inside the file's own current, authoritative
`TRIGGER TIMES` box (dated 2026-08-15, MVP SCHEDULE FREEZE) — already reads
`08:30 — morning trigger (was 7:30 AM)`: 08:30 is already the stated current value, with
7:30 already marked as the explicitly-superseded prior one. The literal `7:30 AM` bullet
lives at `bot-flows.md:68`, inside a SEPARATE, older bullet list the document already
disclaims in its own text (`bot-flows.md:47-49`): *"The bullet list immediately below
this box is the PRE-2026-08-15 schedule, kept for the record of what it was before the
freeze, not current... Don't build against it."* There is no live, undisclaimed
staleness here to strike through — both values are already correctly recorded, one
current and one explicitly marked historical. No edit made to `bot-flows.md` for this
sub-item; flagged here instead of performing a redundant or incorrect correction.

### b. Morning Q4 (execution method/sequence) — REMOVED from the flow

**DECIDED.** `morning_execution_plan` stays as a column — **not dropped**, a separate,
later, independently-gated migration decision, per the scoping already recorded this
session (the Q4-removal plan: which RPC/migration holds the live write, the in-flight-
session hazard at deploy time, the three test files needing updates, and 019's two SQL
sites + `assemble.ts`'s `CORRECTABLE_SCALAR_COLUMNS` needing to move together). That
scoping is the implementation plan for this decision when it's built; this entry is the
decision to build it, not the build.

### c. Attendance becomes the new Q1

**DECIDED.** Question order: **Q1 attendance, Q2 plan, Q3 labour, Q4 equipment.** Total
stays within the six-question ceiling.

**Citation correction, checked before writing it in:** the six-question ceiling is not
owned by this file's own §6 (§6 here is "Weekly work reviews — capture-gap decisions" —
real, and it does contain a compulsory-photos decision, see (e) below, but not a
question-count law). The ceiling is `design-principles.md`'s own Core Thesis corollary
(`design-principles.md:3`: *"the six-question ceiling is a design law, not a
preference... Engineer-burden feature requests get rerouted to PM-side or system-side
capture"*), restated at `design-principles.md:207` as a named anti-pattern
("Engineer-burden creep past the six-question ceiling"). Four questions (attendance,
plan, labour, equipment) is within that ceiling regardless of which document owns it;
correcting the citation, not the conclusion.

### d. Attendance "No" — v1 scope

**DECIDED, narrower than §1's full design.** On "No": write a `daily_logs` row, stamp
completion, end the flow. **§1's own decision (`design-decisions-beta-feedback.md:12-29`,
"DECISION: Option A (hierarchy handoff)") is DEFERRED, not built** — offering the same
questions to the PM's WhatsApp number requires sending a message the PM never asked for
(no inbound from the PM to reply to), which is exactly the outbound-send primitive
(#69/031) §27 already names as the head of the build sequence. Recorded explicitly so it
isn't assumed built: **"No" currently terminates the flow with no hierarchy handoff.**

**OPEN, not decided here:** which column stores the absence reason. `is_holiday`/
`holiday_reason` exist (schema, confirmed live) but are semantically about site-wide
holidays, not one engineer's personal absence — using them for this would conflate two
different facts. No dedicated absence-reason column exists today. Left open, per
instruction.

### e. Photo attendance — DEFERRED to §6's compulsory-photos work

**DECIDED (deferral, not built).** §5 (`design-decisions-beta-feedback.md:152-159`,
"GPS / photo attendance — PARKED") already names the reason this can't stand alone:
*"WhatsApp strips EXIF/GPS from photos sent as images. Native location share + our
server timestamp is the reliable time+place capture; photos are visual evidence
only."* §5 itself points at §6's compulsory-photos decision (`design-decisions-beta-
feedback.md:195-200`, inside §6 "Weekly work reviews — capture-gap decisions") as where
this merges — confirmed, that decision is real and does live there.

**The trap, named explicitly so a future build doesn't fall into it:** attendance must
NOT be inferred from photo arrival. A photo is evidence a message was sent with an
attachment — it is not proof of presence, and treating "photo received" as "present"
makes "forgot to attach the photo" indistinguishable from "not on site," which is exactly
backwards from what an attendance feature exists to catch.

### f. Equipment items with no lexicon match — render AS ENTERED

**DECIDED.** An equipment item whose parsed `type` doesn't match a known
`EQUIPMENT_ALIASES` keyword renders using its RAW entered text, not
`equipmentLabel(type)`'s humanized fallback. Evidence, verified directly this session,
not assumed: `type` is display-only downstream — `computeIdleCost`
(`lib/dpr/idle-cost.ts:15-19`) takes `available_hours`/`actual_hours`/`daily_hire_cost`
only and never reads `type` at all; nothing in the codebase groups, aggregates, or costs
by `type` (checked via `grep -rn "GROUP BY"` across the whole repo — the only match is an
unrelated roster-uniqueness comment). Tonight's own defect (`type: "cement"` rendering as
"Cement," a fabricated equipment name, when the engineer actually typed "Cement micsur
1000" meaning a concrete mixer) is exactly the failure this decision closes: raw text is
always more honest than a confident-looking guess assembled from the first non-numeric
word in the answer.

### g. Tonight's 19:45 DPR

**DECIDED.** Runs against `daily_logs` row `303fb071-2afa-4b08-92cf-ab7202730051`,
unmodified, deliberately — real defect evidence, not cleaned up or re-parsed before the
report generates. Consistent with every instruction this session gave about this row.

**Not built by this entry:** the Q4-removal migration, the attendance Q1 flow change,
the template re-cut, the equipment raw-text render fix, or the absence-reason column.
Seven decisions recorded; zero implemented.

### h. (a) extends to the evening trigger (2026-08-21, same-day follow-on)

**DECIDED.** The 18:30 IST evening cron sends exactly ONE message carrying evening Q1
directly, session marked ACTIVE at send time, `current_step = 1`, by the cron's own
call. The engineer's reply is the answer to Q1, not a start signal. Identical design to
(a)'s morning decision, on both triggers — no handshake, no second message, on either
side. `quoco_evening_checkin`/`quoco_evening_checkin_v2` need the same class of re-cut
(a) required for the morning templates — drafted, not applied (see the template section
of this session's own record; `docs/whatsapp-templates.md` not yet edited for this).

### i. BOT-22 `{{3}}` fallback — OPEN, not solved here

Checked, not assumed: no sender code exists anywhere for `quoco_evening_checkin`
(grepped `app/`, `lib/` — zero hits, confirming the outbound-send primitive genuinely
doesn't exist yet). `bot-flows.md:211`'s "omit the morning-plan echo (BOT-22)" describes
the FREE-FORM path only — a hand-assembled message can drop a sentence conditionally; an
approved Meta template's body structure is fixed, only variable *values* substitute per
send, so there is no template-side equivalent of "omit." **Nothing in this repo defines
what literal string fills `{{3}}` when `morning_plan` is null** — genuinely open, not
answered anywhere. Sharper under (d)'s attendance "No" decision than it was before: a
terminated flow (attendance = No) is now a SECOND route to a null `morning_plan`,
alongside the pre-existing "never engaged" case BOT-22 was originally written for.

### j. Process correction (2026-08-21) — the review quote did not match `main`

**Correction, not a rewrite, per this project's own standing discipline.** Template 1's
body was quoted back in review as ending *"...What work is planned today?"* — a stale
copy, not what's on `main`. The actual body on `main` at review time was *"Reply to
start today's morning check-in."* — no embedded question at all. **The decision to
re-cut template 1/1v2 stands**, but its FIRST stated justification ("the template already
embeds Q1, just the wrong one") was false. The real justification, recorded correctly in
(a) above: this is a **behaviour change**, from a two-step handshake (invite, then a
separate reply-triggered question) to a single message that embeds the question
directly — not a confirmation or correction of something the template already did.

### k. Two corrections from item (a)/(c), reaffirmed

Both corrections this entry already made — the 7:30-vs-08:30 claim (`bot-flows.md`
already marks 7:30 superseded at line 31; no live staleness existed to strike through)
and the six-question-ceiling citation (`design-principles.md`'s own Core Thesis
corollary, not this file's §6) — are confirmed correct and stand as originally written
in (a) and (c) above. No further edit needed to either.

### l. FLOW REDESIGN — both flows, superseding the question sets in `bot-flows.md`

**DECIDED.**

**MORNING (08:30 trigger, 4 questions):**
- Q1 Attendance — "Are you on site today? Reply yes or no." Carried in template 1.
  "No" writes the row, stamps completion, ends the flow.
- Q2 Action plan — free text, captured verbatim, NO quantities → `morning_plan`.
- Q3 Workers by trade → `morning_manpower`.
- Q4 Equipment — name + hire rate, or "no" → `morning_equipment`.

**EVENING (18:30 trigger, 5 questions, FIRES REGARDLESS OF ATTENDANCE):**
- Q1 Work completed + quantity → `evening_output`, `evening_output_quantities`. Carried
  in template 2.
- Q2 Workers by trade → `evening_manpower`.
- Q3 Idle hours by trade → `evening_idle_hours` (new column).
- Q4 Equipment run hours — auto-skips when morning equipment is empty (existing BOT-22
  behaviour, unchanged).
- Q5 "Anything that slowed the execution today?" — UNCONDITIONAL, no longer gated on a
  plan-met "no".

### m. NO PLAN-VS-ACTUAL REPORTING

**DECIDED.** Morning captures qualitative intent; evening captures quantitative result.
The two are never compared, because morning Q2 has no quantity to compare against.

- Evening "did you meet today's plan?" **DELETED.** It read `classifyYesNo` on the
  engineer's own reply and compared it to nothing.
- Old evening Q3 (miss reason) reframed as unconditional hindrance capture and moved
  last. Rationale: "reason for less work" implies a baseline the system no longer
  computes.
- The DPR's headline value metric becomes **EFFICIENCY** (output ÷ (trade count ×
  standard)), not plan attainment. Naming distinction, stated explicitly because it was
  conflated during this discussion: **EFFICIENCY = output ÷ (headcount × standard)**;
  **UTILISATION = hours run ÷ hours available** (equipment). Different metrics,
  different denominators. (Matches §6's own existing framing —
  `design-decisions-beta-feedback.md:170`: "Efficiency % = actual output ÷ (headcount ×
  standard)" — this decision doesn't invent the metric, it promotes it to headline.)

### n. §9 REVERSAL — evening manpower moves from aggregate-only to BY TRADE

**DECIDED, recorded as a reversal with reason, not a new decision.** §9
(`design-decisions-beta-feedback.md:339-380`, "Evening flow Q4 — v1 scope,
2026-07-28") deferred trade-level attribution deliberately, for three reasons verified
against the code at the time and re-verified now, independently, against the live
lexicon — all three numbers hold: **7 canonical trades, 26 aliases, 21 of them Civil
(mason 6, helper 8, carpenter 4, bar_bender 3); electrician has 2, plumber 1, neither
with Tamil** (`lib/whatsapp/flows/parsers/lexicon.ts:12-44`, counted directly from the
live `TRADE_ALIASES` map, not assumed from §9's own prior count).

**Reversed today because the `productivity_standards` denominator (e.g. 1 mason × 8 hrs
→ X sqm) requires a by-trade actual count** — the efficiency metric in (m) cannot exist
without it, so the risk §9 correctly named in 2026-07-28 is now accepted deliberately
rather than avoided. Idle capture moves from an aggregate headcount to **IDLE HOURS BY
TRADE**, which makes productive hours computable per trade: `(count × 8) − idle_hours`.

### o. COLUMN RENAMES — remove the planned/actual assumption from the schema

**DECIDED.**
- `morning_manpower_planned` → `morning_manpower`
- (new) `evening_manpower`, `evening_idle_hours`

The JSONB keys carry the same assumption and must migrate too: `planned_count` →
`count`, `planned_total` → `total` (confirmed these are the real live key names — read
directly off tonight's own `daily_logs` row, `morning_manpower_planned:
{"planned_total":22,"by_trade":[{"trade":"mason","planned_count":12},...]}`). This is a
data migration over existing rows, not an `ALTER TABLE` alone.

**Sync hazard, corrected before recording, not transcribed as given:** the drafted claim
was that `morning_manpower_planned` sits in the same three-way sync system as
`morning_execution_plan` — **checked directly, this is not accurate.** Grepped
`supabase/migrations/019_daily_log_corrections.sql` for `morning_manpower_planned`:
**zero hits.** It is not in 019's CHECK constraint, not in its CASE mapping, and not in
`assemble.ts`'s `CORRECTABLE_SCALAR_COLUMNS` (also zero hits there) — all three are
scoped to SCALAR columns; `morning_manpower_planned` is JSONB, and 019's own
correctable-columns work deliberately excluded JSONB columns from day one (a
pre-existing, separately-tracked gap, not something this rename interacts with).

**The real sync surface, checked directly:** the RPC write site
(`supabase/migrations/022_evening_flow_apply_turn.sql:259,263`), `types/database.ts`
(`:364,395,426`), and four test files (`test/migration-019.test.ts`,
`test/morning-flow.test.ts`, `test/unit/morning-dispatch.test.ts`,
`test/helpers/db.ts`) — a real, smaller hazard than `morning_execution_plan`'s (no 019
CHECK/CASE involvement), not the identical one.

### p. COLUMNS THAT BECOME UNREAD

**DECIDED — do NOT drop in the same migration as the flow change; collected data must
not be silently lost.** `morning_execution_plan`, `evening_schedule_met`,
`evening_schedule_miss_reason`, `evening_workers_on_site`, `evening_productive_manpower`.

`evening_schedule_miss_reason` specifically: if hindrance capture reuses it, the name
will mislead — rename or annotate deliberately, not left implicit.

**ADDENDUM (2026-08-21, same day, gap found while striking `bot-flows.md`'s superseded
question lists): add `morning_dependencies` and `morning_hindrances` to this list.**
Both were spec'd as morning Q5/Q6 (`bot-flows.md`'s now-struck-through question list),
never built (CLAUDE.md's own testing-debt/build-status record confirms Q5/Q6 shipped no
further than schema + spec), and are not part of §28(l)'s redesigned 4-question flow —
the same "becomes unread, do not drop" reasoning applies to both.

**OPEN, NOT DECIDED:** whether dependency capture — "what do you need from others
tomorrow, and who is responsible" — is being formally dropped or only deferred. §28(l)'s
redesign omitted it without an explicit decision either way; this addendum names the gap,
it does not close it.

**ADDENDUM (2026-08-25, §33(e)): add `daily_hire_cost` (column) and `computeIdleCost`
(`lib/dpr/idle-cost.ts` — code, not a column, but the same "kept, no longer called"
treatment) to this list.** §33's equipment-units decision stops writing
`daily_hire_cost` and stops rendering idle cost in the DPR; both stay in place, unread
for now, so a real rate from invoice data has somewhere to write to and a working
computation to call, once that lands (§33(d)/(f)).

### q. NMR — decided as a TRADE, not a separate axis

**DECIDED, simplification chosen deliberately over more accurate alternatives** (NMR as
an attribute of each trade line, or as its own bucket excluded from trade counts).
**Known cost, recorded not hidden:** NMR is properly an ENGAGEMENT category (casual
daily-wage muster labour), not a trade — an NMR mason and an NMR helper are
indistinguishable in the data under this simplification. Accepted for simplicity.

**Follow-on, NOT decided:** NMR needs aliases in the trade lexicon including Tamil
vernacular, and a `productivity_standards` decision — if NMR is largely unskilled
support, the honest treatment is exclusion from the efficiency denominator rather than
an invented standard.

### r. VOCABULARY — now load-bearing and blocking

**DECIDED (status, not a new design).** Morning Q3, evening Q2, and evening Q3 all join
on trade name, as does `productivity_standards`. Current lexicon (verified live, (n)
above): 7 canonical trades, 26 aliases, 21 Civil; electrician 2, plumber 1, neither
Tamil; multi-word trades ("pipe fitter", "cable jointer") can never match because
matching is single-token positional (`canonicalTrade(tokens[i+1])`, per §9's own already-
verified finding). §6's fixed-list requirement (buttons/numbered options, not free text)
is now a PREREQUISITE for the efficiency metric, not a Pass-2 nicety.

### s. EVENING TEMPLATE `{{3}}` — DECIDED

Submit a **SEPARATE no-morning-plan variant** of template 2 rather than passing a filler
string. Reason: a Meta template body is fixed at approval and only variable values
substitute, so `bot-flows.md:211`'s "omit the morning-plan echo" has no template-side
equivalent (§28(i) above); and a filler renders as "This morning you planned: no morning
check-in", which reads as a system message about a person, not about their day. Both
variants approve in the same batch, on the same clock.

Records that under (l), attendance="No" is now a **second route** to a null
`morning_plan`, alongside the pre-existing never-engaged case §28(i) already named.

### t. DECIDED (2026-08-28) — attendance "No" stays irreversible; check-in windows are a
data-integrity boundary, not a convenience limit

**The scenario that raised this, unchanged from the original entry:** "No" stamps
completion and ends the morning flow (§28(d)), so an engineer who answers no at 08:30 and
reaches site at 11:00 has no route back to Q2-Q4 despite the 15:00 cutoff still being
open. Evening then asks what was completed with no plan captured.

**DECIDED: no route back is built. The irreversibility is correct behaviour, not a gap.**
Check-in windows (`morningCutoff`, `eveningSend`, `eveningClose`) are a DATA-INTEGRITY
boundary, not a convenience limit that exists only to nudge timely submission. Late data
is not merely late — it is data whose date nobody can trust: an engineer answering
morning questions at 11:00, or amending a "No" after the fact, produces a record dated
to a day that, from the system's point of view, was never actually observed in real
time. A DPR built from it misrepresents a day already closed as if it had been captured
as it happened. Flexible update windows do not recover lost data faithfully — they
attract bad data (answered from memory, hours or days later, un-verifiable against what
was actually true at the time) and produce date misattribution (today's correction
silently rewriting yesterday's record). The correct response to a missed or wrong
morning answer is the same one this codebase already applies everywhere else state needs
correcting after the fact: the PM edit RPC (migration 019), a human-reviewed correction
with its own audit trail — never a reopened engineer-facing window.

This closes the "restart-semantics question arriving through a side door" the original
entry named — it does not belong with the outbound-send primitive as unresolved
plumbing; it is resolved, and the resolution is that no plumbing gets built for it.

### u. NOT BUILT BY THIS ENTRY

Every item above (l)-(t) is a decision. Zero implementation. **The flow migration is
UNSCOPED** — §28(b)'s earlier Q4-removal scope no longer covers this, because
attendance-as-Q1 renumbers every step and the reask keys (`q2_reask`, `q3_reask`) are
keyed by step number. Re-scope before building. **Trips CLAUDE.md §0(a) — external
review gate required** (creates/modifies a live function's logic).

### v. RECORDED, NOT BUILT (2026-08-22) — the 150-char morning-plan truncation must break
on a word boundary with an ellipsis, not mid-word

Found reading the WhatsApp template-submission dry-run payloads: the `{{3}}` sample value
for templates 2/2v2 (a 259-character fictional morning plan, truncated for the template's
own `≤150 chars` limit) originally cut mid-word ("...coordinate w") — fixed in the sample
itself (`docs/whatsapp-templates.md`/`.json`, 2026-08-22) by truncating at the last word
boundary before 150 chars and appending an ellipsis (139 chars total).

**Checked whether any real send-path code does this truncation today: it does not exist.**
Grepped `lib/`, `app/`, `scripts/` for any Twilio Content API template-send construction
(`ContentSid`, `ContentVariables`, an `HX...` template SID, any `require('twilio')`/
`from 'twilio'` import outside the sandbox's inline-TwiML reply) — zero hits, consistent
with CLAUDE.md §3's STANDING ARCHITECTURAL FACT: no outbound-send capability exists in
this codebase at all, only synchronous webhook replies. `morning_plan` itself is read only
by the DPR assembler/containment path (`lib/dpr/assemble.ts`, `lib/dpr/containment.ts`) and
written by the morning flow (`lib/whatsapp/flows/morning.ts:203`) — nothing today reads it
to populate an outbound template variable, because nothing today sends outbound templates.

**Recorded for whoever builds #69/031 (the outbound-send primitive):** when the evening
check-in cron send is built and it populates template 2/2v2's `{{3}}` from
`daily_logs.morning_plan`, the 150-char truncation MUST break on the last word boundary
before the limit and append an ellipsis — never a bare slice/substring cut mid-word. A
mid-word cut ("...coordinate w") is illegible to the reader and, per this same finding,
was exactly what the fictional SAMPLE had until this pass caught it — the real send path
should not repeat it. Not built here — zero implementation, same as every other item in
this section.

### w. PP2 vs §7 SCOPE LINE (2026-08-21) — resolves a live conflict between two DECIDED
sections

§27 (PP2) states inbound at idle gets an acknowledgement only and does not start a flow;
starting is the cron's job exclusively. §7 states an unrecognised inbound at idle opens
the ad-hoc selection menu. Same trigger, opposite outcomes.

**RESOLVED:** the cron starts SCHEDULED flows (morning 08:30, evening 18:30) — PP2's
principle holds, the engineer never has to remember to start a check-in. Inbound at idle
opens the AD-HOC MENU. Ad-hoc events cannot be scheduled by nature: a hindrance is
reported when it happens, an invoice when it arrives. PP2's "acknowledgement only" branch
was written before the ad-hoc menu existed and is superseded by this.

**Live evidence:** on 2026-08-21 at ~19:50 IST a real inbound at idle returned "Today's
report is ready. Send your update tomorrow morning." Under §7 that should have opened the
menu.

**GATE:** this must be settled in the outbound send primitive's design (#69/031), which
currently assumes PP2 as written.

### x. AD-HOC MENU IS THE ENGINEER'S FRONT DOOR (2026-08-21) — not an error handler for
unrecognised input

It is what he sees whenever he opens the thread outside a check-in, so it is designed as
a home screen. Standard fixed list, kept short. Initial set: hindrance, dependency,
invoice, delivery note, site cash.

**Delivery mechanism:** a WhatsApp interactive list sent as a FREE-FORM session reply —
his inbound opens the 24-hour window. No template, no Meta approval needed. Record that
interactive lists cannot be sent business-initiated, so the menu can only ever appear in
response to an inbound.

### y. PRODUCT POSITIONING (2026-08-21)

The engineer's WhatsApp thread is the system of record for site events that today live in
phone calls to the PM. Hindrances, dependencies, site cash, invoices and delivery notes
are work the engineer ALREADY does; routing it through Quoco is substitution, not
additional burden. The organisational value is that site truth stops being filtered
through whoever the owner happens to ask, and produces a timestamped, attributed trail
usable in extension-of-time and variation claims.

Engineer remains WhatsApp-ONLY, permanently. No engineer app, ever — this is the wedge:
competitors ship an engineer app that goes unopened and their data dries up.

### z. WEEKLY ENGINEER FEEDBACK (2026-08-21) — new, decided

The engineer currently gives data and receives nothing, which is where this class of
product dies. Send him his own numbers weekly over WhatsApp: efficiency by trade and idle
hours, computed from the data he already submits. Turns extraction into feedback.
Requires `productivity_standards` (does not exist) and the outbound send primitive.

### aa. CONSEQUENCES OF (y), EACH REQUIRING RE-PRIORITISATION (2026-08-21) — record, do
not schedule

1. **INBOUND MEDIA HANDLING is now load-bearing, not a §6 photo-attendance nicety.**
   Invoices, delivery notes and cash receipts are all photographs. Needs Twilio media
   download, a storage bucket, and a retention policy.
2. **SITE CASH NEEDS A CONFIRMATION ECHO, not accept-and-advance.** Evidence: on
   2026-08-21 "Cement micsur 1000" was stored as equipment type "cement" with
   `daily_hire_cost` 1000 and rendered in a real DPR as "Cement, ₹1000/day". The same
   parser class applied to petty cash fabricates expenditure. Anything carrying a rupee
   figure must read back what was understood before storing.
3. **DATA RETENTION becomes a statutory obligation, not an open item.** Once the thread
   holds invoices and delivery notes it is a financial record with retention periods
   behind it. Update the standing open item accordingly.

### bb. OWNER DELIVERY (2026-08-21)

WhatsApp notification carrying a deep link into the app; the app holds anything the owner
PULLS (invoices, delays, spend), WhatsApp carries what is PUSHED. Record the gap: NO
owner-facing WhatsApp template exists in the submitted batch — templates 6, 7, 9 and 10
all go to the PM, and 7 tells the PM the owner was EMAILED. Owner delivery today is
email-only. A new owner template is required and templates take days to approve.

Keep all links in `https://app.quoco.co.in/...` form (as template 6's button already is)
so Universal Links / App Links open the app when installed and the web page when not —
no custom scheme, no template re-cut.

### cc. MOBILE APP — DIRECTION SET, NOT SCHEDULED (2026-08-21)

Three personas, two clients, one data model: engineer on WhatsApp only; PM and owner in
the app with different permissions over the same records (PM exception-first and
editable, owner read-only and summarised). Sequencing: owner first (the buying decision),
PM second (mobile for site visits, web dashboard stays primary).

**BLOCKED ON DATA, NOT ON CLIENT WORK.** Of the mockup's five screens only two have any
backing data today (portfolio list, DPR). Invoices have no schema at all; hindrance
capture was only decided today and is unbuilt; contract value, spend-to-date, site photos
and PM contact do not exist anywhere.

Also record: the mockup's report screen mirrors `renderEngineerReport` and is already
superseded by §28(m) — its plan-vs-actual pairs, "Schedule: not met" and aggregate
productive/idle manpower were all removed today.

Owner phone-number sign-in depends on `quoco_login_otp`, which FAILED submission on
2026-08-21 (Authentication category requires the `whatsapp/authentication` content type,
not `twilio/text`).

## 29. Pass 1 outbound send primitive — five decisions (2026-08-22) — DECIDED, not built

Recorded alongside `docs/plans/pass1-outbound-send-plan.md`, which these decisions were
folded into as amendments. Plan and documentation only — no code, no migration file in
`supabase/migrations/`, no cron entries.

### a. NO STOP KEYWORD — BOT-27's SET-half is OUT of Pass 1's scope

Engineer opt-out is a PM decision, using the existing `status='deactivated'`.
`messaging_blocked` remains engineer CONSENT state and is never PM-clearable — this does
not reopen or contradict PR #69's own already-reasoned B2 (round 1) finding
(`outbound-send-primitive-plan.md`, "`messaging_blocked` is NOT a delivery-failure flag";
it stays a consent flag written only by `clearMessagingBlock`, which only ever writes
`false`) — it goes further: no code path is ever added to write `messaging_blocked=true`
from an inbound STOP keyword either. The scoping plan's own item A (STOP detection,
"ships first") is retracted by this decision, not merely deferred.

**Accepted cost, recorded plainly, not minimised:** with no in-product opt-out route, an
engineer who wants the messages to stop has exactly one option — WhatsApp's own Block —
which is invisible to this system (no signal, no row, no way to ever know it happened),
counts against the sending number's own quality rating under Meta's rules, and cannot be
undone by anyone on either side once it happens (unlike `messaging_blocked`, which
`clearMessagingBlock` can always reverse). This is a real, accepted trade, not an
oversight — see (b) for what replaces it, and its own dependency on the still-unbuilt
ad-hoc menu.

### b. OPT-OUT BECOMES AN AD-HOC MENU ITEM

A free-text-comment opt-out request, routed to the PM as a request rather than acted on
as a silent removal. Rationale: cannot be triggered accidentally (unlike a bare keyword
match, which a garbled or unrelated message could theoretically collide with); captures
WHY the engineer wants out, which distinguishes "I've left this project" (a roster
problem, PM should reassign) from "too many messages" (a product/frequency problem, PM
should reconsider cadence) — two situations with OPPOSITE correct PM responses that a
bare STOP keyword can never tell apart.

**Recorded as a dependency of §28(x):** until the ad-hoc menu is actually built, there is
**NO opt-out path of any kind** in this product — not the keyword (a, retracted), not the
menu item (this decision, unbuilt). Acceptable at beta scale, where the PM/founder can
plausibly notice and handle an unhappy engineer directly; this carries a real compliance
obligation once real engineers beyond the beta cohort are on the system, and that
obligation is not discharged by this decision, only named by it.

### c. TEMPLATE 8 COPY MUST CHANGE — and this decision is what LIFTS GATE 2

`quoco_engineer_optin`'s current body promises "Reply STOP at any time to stop these
messages" — no longer accurate, per (a). The copy must be rewritten to describe the
PM-managed route (b) instead, once the menu exists to describe. **This template is
unsubmitted and held under GATE 2 (`docs/whatsapp-templates.md`), so this correction is
free to make now, before it is ever seen by Meta or an engineer — no resubmission,
no re-approval cost, no 30-day name lock at risk.**

**This decision is what LIFTS GATE 2.** GATE 2 existed for exactly one reason — the
template's body carried a promise (`messaging_blocked` set by a STOP reply) that no code
ever kept. Once the promise itself is rewritten to match what (a)/(b) actually build,
there is nothing left for GATE 2 to guard against. GATE 2 lifts when this rewrite lands,
not before.

**Do not resubmit yet — flagged for approval, not actioned here.** This entry records the
decision and its consequence for GATE 2; it does not edit `docs/whatsapp-templates.md` or
resubmit anything. Per direct instruction: "Do not touch templates."

### d. MORNING CUTOFF SUBMITS AS-IS

At `morningCutoff` (15:00 IST), any session still at `current_flow='morning'` is closed
AND stamped submitted with whatever was actually answered — not merely reset to idle.

**This is broader than B3's originally decided fix** (`outbound-send-primitive-plan.md`
§"B3", options 1+3: cutoff-close the stale session so the evening trigger routes
correctly — a session-STATE fix only, silent on what happens to any partial answers
sitting in it). This decision adds the missing half: the partial morning data is REAL
data, submitted by the engineer, and is kept as the record — not discarded just because
the flow never reached its normal completion step. Same principle already applied
elsewhere in this project (an engineer's real answer always wins over a clean-but-empty
default). Widens what "B3's fix" has to build — recorded in
`docs/plans/pass1-outbound-send-plan.md`'s own Amendments (d) and review-package item 4.

### e. NO PARTIAL/COMPLETE DISTINCTION IN THE DPR

The DPR renders whatever was recorded and marks the rest missing — exactly the existing
behaviour, unchanged. Evidenced directly: the 2026-08-21 generated DPR already rendered
"not reported" for every evening field on a day evening was never submitted, with no
special-cased "partial day" framing anywhere in the output. No new state, no new column,
no new branching in the report generator. Same principle as §28(f): show what was said,
mark what was not — a morning session closed early by (d) is just one more case of a
field with nothing to report, handled by machinery that already exists.

### Two hard preconditions for enabling Pass 1's cron entries — recorded here too

Same two conditions as `docs/plans/pass1-outbound-send-plan.md`'s own closing section,
stated once each place rather than only cross-referenced, since both documents need to
stand on their own:

1. **GATE 1** — the flow migration (§28(l), attendance-as-Q1) shipped and verified live.
2. **B3's cross-flow fix, widened by (d) above** — built and verified: closes stale
   morning sessions AND stamps their partial answers as submitted.

Neither is scheduled. The Pass 1 CODE may merge before both are done. The two
`vercel.json` cron entries may not be added until both are confirmed true by direct
observation.

**CORRECTED, 2026-08-22 (§30(i)) — these are NOT parallel/independent preconditions.**
The numbered list above presented GATE 1 and B3 as two separate conditions with no
stated relationship between them — that framing is corrected here, not silently, since
no single sentence above asserted independence to strike through; the numbered-list
shape itself is what implied it. B3's 15:00 sweep must know which morning question
each `current_step` value means, in order to correctly preserve partial answers when it
stamps a stuck session as submitted. The morning flow migration CHANGES that mapping
(step 2 shifts from "workers" to "plan", step 3 from "equipment" to "workers," per the
re-scoping plan's own line-number table). Writing B3 before the migration ships means
writing it against a mapping the migration then invalidates — B3 would need
rewriting, not just re-verifying. **Corrected order: the morning flow migration ships
FIRST, THEN B3's sweep is written (once, against the mapping it will actually run
against), THEN the two `vercel.json` cron entries may be added** — not two
independently-satisfiable gates, a sequence. See §30(i) for the full reasoning.

## 30. Flow migration re-scope — nine decisions (2026-08-22) — DECIDED, not built

Recorded alongside `docs/plans/flow-migration-rescoping-plan.md`, which these
decisions amend (a dated note added there, not a silent rewrite — see that file).
Plan and documentation only — no code, no migration file.

### a. SPLIT INTO TWO MIGRATIONS — morning ships first, alone

Morning and evening ship as separate migrations, not one bundled change. Morning is a
mechanical renumber, fully verifiable against the re-scoping plan's own line-number
table (its §b). Evening is a restructuring — two questions deleted, two rebuilt as
by-trade pairs, one moved, one added, two new columns, every reask key reshuffled, and
its own test surface not yet audited (the re-scoping plan's own §f names this
explicitly). Bundled, a bug found in the evening half blocks the morning half from
shipping, even though morning is the simpler, already-fully-scoped change.

**MORNING SHIPS FIRST, and shipping it ALONE lifts GATE 1.** Evening's own Q1 (work +
quantity) is already correct today — template 2 already matches the live RPC's
evening Q1, unchanged by the evening restructuring — so GATE 1 (template-vs-RPC
agreement) only ever depended on the MORNING side. Only template 1's migration is a
precondition for GATE 1; evening's restructuring is a separate, later piece of work.

**Accepted cost of deferring evening, stated plainly:** until evening's migration
ships, engineers keep being asked *"Did you meet today's plan?"* — a question §28(m)
already decided to delete (no plan-vs-actual reporting) — because the live RPC still
asks it. Tolerable at the current beta scale (3 engineers); not tolerable once real
engineers beyond the beta cohort are on the system, since it's a live, dated
inconsistency between the documented decision and what the product actually does.

### b. ATTENDANCE FLOW — final shape

**Q1:** *"Are you on site today? Reply yes or no."* (template 1, unchanged from
already-submitted copy).
- **YES → normal route:** Q2 action plan / Q3 workers by trade / Q4 equipment (the
  4-question flow the re-scoping plan already scoped).
- **NO → follow-up Q2:** *"Is it a site holiday? Reply yes or no."*
  - **YES → SITE HOLIDAY.** Cancels every remaining trigger for that engineer that
    day — evening trigger, morning nudge, evening nudge, PM escalation. Flow ends,
    stamped submitted. **No PM handoff** — there is nothing to report on a day the
    site itself is closed.
  - **NO → ENGINEER ABSENT.** Flow ends, stamped submitted. **Evening trigger STILL
    FIRES** — half-day and late-arrival cases are real (the site may still be
    working with someone else present, or this engineer may arrive later). **PM
    handoff applies** — see (e).

Morning is therefore 4 questions on the YES path, 2 questions on either NO path (Q1 +
the holiday follow-up).

### c. STORAGE

New column `daily_logs.attendance`, `TEXT CHECK (attendance IN ('present', 'absent',
'site_holiday'))`. `is_holiday` (existing column) is set `true` alongside
`'site_holiday'` so existing readers of `is_holiday` keep working unchanged;
`attendance` is the authoritative field going forward. **Two independent booleans
would permit impossible states** (present AND holiday simultaneously) — a single
three-value column makes that state unrepresentable, not just unlikely.
`holiday_reason` has no source in this flow (the follow-up is bare yes/no, no free
text) — it stays `null`, not backfilled or guessed at.

### d. ROSTER FILTER CHANGE TO PASS 1 — amends the already-merged plan

The evening trigger's roster (per `docs/plans/pass1-outbound-send-plan.md`) currently
filters only on `messaging_blocked`. It must ALSO exclude any engineer whose
`daily_logs` row for that date has `attendance = 'site_holiday'` — a site-holiday
engineer's evening trigger must never fire, per (b) above. The same exclusion applies
to the nudge and PM-escalation rosters once Pass 2 builds them. **This changes an
already-merged plan (PR #87) — folded in as a dated amendment to
`docs/plans/pass1-outbound-send-plan.md` in this same commit, rather than left to be
discovered at build time.**

### e. PM HANDOFF ON THE ABSENT PATH — §1's handoff, narrowed

§1 (`design-decisions-beta-feedback.md`'s own absence-handling entry) predates this
three-way branch and treats every "no" answer alike. **It applies ONLY to
`'absent'`** — the site may still be working with nobody reporting, so the morning
plan, manpower, and equipment for that engineer's scope still need capturing by
someone. **It does NOT apply to `'site_holiday'`** — nothing was worked, nothing to
hand off.

**Delivery: dashboard first, WhatsApp later.** The PM fills the missing morning
fields directly in the web UI — he is already a web user, and this is a form of four
fields rather than four conversational turns relayed through someone else. This
builds on migration 019's correction RPC (`correct_daily_log`), which has existed
with **zero frontend callers** since 2026-08. §1's original design (the same
questions sent to the PM via a template + `pending_flows`) remains the better
long-term answer for a PM who isn't at a desk — recorded as deferred, not dropped.

**Convergence worth naming, found while recording this:** this is the SAME edit UI
§28(f) already assumed exists when it decided an unmatched equipment name renders as
entered ("the PM can correct it") — an assumption that is currently false, for the
identical reason: `correct_daily_log` has no frontend caller today. **One UI serves
both cases** — build it as a general daily-log edit surface, not an absent-day-specific
form, so it closes both this gap and §28(f)'s pre-existing one at once.

**Known gap, not solved here:** nothing can currently NOTIFY the PM that a handoff is
needed. PM escalation (the send that would carry this) is a Pass 2 item, not Pass 1.
Until it exists, an absent day surfaces only if the PM happens to check the dashboard
— no push, no reminder.

### f. DPR ON A SITE-HOLIDAY DAY

Still generates. Renders as **SITE CLOSED**, not "evening check-in not received."
Cancelling this engineer's remaining triggers (per (b)) stops the SYSTEM asking the
engineer anything further that day — it must not also stop the OWNER being told why
the day was quiet. This is an `assemble.ts` change, separate from both the morning and
evening flow migrations — recorded here as its own work item, not bundled into either
migration's scope.

### g. SITE CLOSURE IS RECORDED PER ENGINEER, NOT PER PROJECT

`daily_logs` is one row per engineer per project per day — one engineer can report
`'site_holiday'` while another engineer on the SAME project, SAME day, reports real
work. Nothing propagates between engineers; each evening trigger is suppressed (or
not) independently, per (d). **Accepted for v1.** **OPEN, not decided:** "was the site
as a whole closed today" has no project-level answer under this design — this will
matter once the DPR aggregates multiple engineers on one project and needs to state a
single site-status fact, not one per engineer.

### h. MISPARSE COST, ACCEPTED KNOWINGLY

A wrongly-parsed "yes" to the holiday follow-up cancels the day's entire capture for
that engineer, with no route to reopen it — this is the SAME irreversibility §28(t)
already named for attendance="No" generally, now sharpened to the specific
holiday-follow-up case. **Partly mitigated, not solved:** per (f), the DPR still
states the closure claim explicitly, so a PM/owner reading it sees an assertion
("site closed") they can question, rather than silence they might not notice at all.
Restart semantics for this class of misparse stay deferred to the outbound-send
primitive (#69/031), same as every other irreversibility this project has already
named and deferred, not newly introduced here.

### i. CORRECTION TO §29 — B3 AND GATE 1 ARE NOT PARALLEL PRECONDITIONS

Full correction recorded in place, above, in §29 itself (dated, not a silent
rewrite) — not repeated verbatim here. Summary: §29 listed GATE 1 and B3 as two
independent gates on enabling Pass 1's cron entries. They are ordered, not parallel —
B3's sweep must know which morning question each `current_step` value means in order
to correctly preserve partial answers, and (a)/(b) above (the morning flow migration)
change that exact mapping. **Corrected order: morning flow migration ships first, THEN
B3's sweep is written once against its final shape, THEN Pass 1's two `vercel.json`
cron entries may be added.**

---

## 31. Stable-signature refactor for the flow-turn RPCs — recorded 2026-08-23,
DECIDED IN PRINCIPLE, NOT SCHEDULED

**Origin.** Migration 030's first draft appended two parameters to
`apply_morning_flow_turn` and, in doing so, created a live duplicate
function overload (`CREATE OR REPLACE` does not replace across a changed
argument list — full incident: `docs/reviews/morning-flow-migration-review-
package.md` §10; the fix actually shipped for 030 itself: §10.1, keeping
the signature unchanged and moving classification inside the function).
That fix solves migration 030's own case. This entry records a longer-term
structural fix for the CLASS of problem, not just this one instance of it —
decided in principle, deliberately NOT scheduled against any current work.

**The problem, stated generally.** The signature IS the API for
`apply_morning_flow_turn` and `apply_evening_flow_turn` — every caller
(production wrapper, test helper, any future one) must match it exactly,
positionally or by name. Both signatures have only ever grown:
`apply_morning_flow_turn` — 8 parameters at `014_morning_flow_apply_turn.sql`
→ 12 at `018_morning_flow_parsers.sql` → (030's first draft, abandoned) 14 →
12 again (030 as shipped, §10.1). `apply_evening_flow_turn` — grew similarly
across `022_evening_flow_apply_turn.sql` and `024_evening_flow_q4_q5.sql`.
Every future migration that needs the RPC to know one more thing about a
turn (a new question, a new flag, a new piece of context) faces the exact
choice 030's first draft got wrong: append a parameter (risking the
orphaned-overload trap CLAUDE.md §0 now names explicitly) or find another
way. §10.1's fix works because Q1/holiday's yes-no classification HAPPENED
to have no race to avoid — that will not be true of every future addition
(e.g. evening's own restructuring, §30(a), already known to add
parameters), so relying on "there was always another way" is not a plan,
it's an assumption that has already failed once.

**Proposal.** Refactor both `apply_morning_flow_turn` and
`apply_evening_flow_turn` to a STABLE SIGNATURE — e.g.
`(p_phone text, p_now timestamptz, p_input jsonb)` — where every per-turn
value (message, start-flow flag, every parse result, every classification,
every future field) lives inside `p_input`'s JSONB shape instead of as a
named SQL parameter. Adding a new field becomes a JSONB CONTRACT change
(document the new key, read it with `COALESCE`/`->>`, done) rather than a
function IDENTITY change — `CREATE OR REPLACE` then always genuinely
replaces, because the argument type list never moves again.

**The trade, named honestly, not glossed over.** Argument validation moves
from Postgres into application code. Today, a caller that misspells
`p_manpower_ok` or passes the wrong type gets a loud, deploy-time/call-time
Postgres error (unknown parameter, type mismatch). Under a JSONB payload, a
typo'd key (`p_input->>'manpower_ok'` when the real key is
`'manpowerOk'`) fails SILENTLY at runtime — `->>'` on a missing key returns
`NULL`, not an error, and `COALESCE(..., false)` (the pattern this
project's own RPCs already use throughout) would make a typo indistinguishable
from a genuinely-absent value. This is a REAL cost, not a formality: it
trades a class of bug Postgres currently catches for free (at the exact
moment migration 030's first draft's mistake was caught, per CLAUDE.md §7's
dry-run rule) for a class of bug that needs its own test coverage to catch
instead. Whoever schedules this work owns building that coverage — it does
not come free with the refactor.

**Sequencing, if and when this is scheduled.** Should land BEFORE evening's
own restructuring (§30(a)) — evening's migration is already known to add
parameters to `apply_evening_flow_turn` for its new/moved questions, which
means it would hit the identical wall 030's first draft hit if it ships
against the current parameter-list shape. Doing the stable-signature
refactor first means evening's migration is written against the shape that
won't have this problem, rather than evening also needing its own §10.1-style
rescue.

**Explicitly NOT a volume or performance argument.** This is a maintainability/
safety proposal only. At this project's expected scale, a 12-, 14-, or even
20-parameter function signature is not itself a performance constraint —
the actual serialising bottleneck in both flow-turn RPCs is the row lock on
`whatsapp_sessions` per `phone_number` (the `INSERT ... ON CONFLICT ...
DO UPDATE` acquire step, present since `012_whatsapp_session_transition.sql`),
which is unchanged by this refactor either way. Do not read "stable
signature" as a claim that the current signatures are slow; they aren't —
the argument for this refactor is entirely about the orphaned-overload
failure mode, not throughput.

**Requires its own migration and its own external review gate** (CLAUDE.md
§0's trigger conditions — this modifies a live function's logic, condition
(a) — a full review package is required, not optional, whenever this is
actually scheduled).

## 32. Parse-attempt corpus + self-improving parsing prerequisites (2026-08-23)
— RECORD ONLY, NOT SCHEDULED

**Numbering note:** §31 is reserved for the stable-signature (JSONB payload)
RPC refactor recorded the same day, currently on an unmerged branch — this
entry is deliberately numbered §32, not §31, so the two land in the right
order once both branches merge, rather than colliding or requiring a
renumber later.

### a. DECIDED — RETAIN RAW INBOUND TEXT

Today `processed_messages` stores only `message_sid` and timestamps: no
body, no phone number. Engineer input is discarded the moment it is parsed.
Some survives incidentally in `raw_text` inside `morning_equipment` /
`morning_manpower` JSONB, but an unparseable answer that is re-asked and
then defaulted leaves NO trace — and those are precisely the cases worth
learning from. The corpus cannot be reconstructed retroactively, so capture
starts now.

### b. THE UNIT IS THE PARSE ATTEMPT, NOT THE MESSAGE

Record, per inbound: the raw text, the flow and step it arrived at, which
parser handled it, the parse result, whether it succeeded, and the re-ask
count at that point. A message log gives a chat history; an attempt log
gives a labelled training set with failures already marked. Design the
table around that. Do not design it in this pass — record the shape
requirement.

### c. PREREQUISITES FOR "SELF-IMPROVING PARSING" — recorded so the sequence
is not attempted out of order

1. **The corpus (a + b)** — nothing to learn from without it.
2. **GROUND TRUTH.** Learning needs a label: what the engineer actually
   meant. The only source is a human correction, which is the PM edit UI
   (§30(e)) — RPC exists since migration 019, no UI, zero frontend callers.
3. **A CONFIDENCE FIELD.** Nothing marks which parses were guesses. This is
   the standing PARSER DEBT (`design-principles.md:31` Rule 3.5 promises
   low-confidence flagging; no such field exists anywhere). Two live
   examples: "Cement micsur 1000" stored as equipment type "cement" at
   ₹1000/day and rendered in a real DPR (2026-08-21); and §30's
   exhausted-reask default storing `attendance='present'` for an engineer
   who never said so.

### d. NEAR-TERM APPROACH — DECIDED IN PRINCIPLE, NOT SCHEDULED

Not self-training: a deterministic lexicon first, an LLM fallback (Claude
API) when it fails, and human confirmation promoting a newly-recognised
form into the lexicon permanently. Bounded, degrades gracefully, and keeps
a human between a guess and a stored value — which matters most exactly
where autonomy is least wanted: rupee figures and attendance.

### e. INPUT LANGUAGE — multilingual, CONFIRMED

Rule 3.12's simple-English constraint governs what Quoco WRITES, not what
engineers may type. Template 8 states in writing: "You can reply in any
language — English, Tamil, or a mix." `classifyYesNo` already carries six
transliterated Tamil forms; the trade lexicon carries more. Expanding
yes/no coverage is the highest-leverage vernacular work available, because
attendance is Q1 of every morning check-in for every engineer every day,
and the shared corpus test added in migration 030 makes both
implementations testable against one fixture.

### f. RETENTION CLOCK

Retained message bodies are personal data tied to a WhatsApp number.
§28(aa)(3) already records retention as a statutory obligation once
invoices and delivery notes land; this decision starts that clock earlier.
Update that entry to reflect that the obligation now begins with raw-text
retention, not with media.

## 33. Equipment captures units, not hire rate — seven decisions (2026-08-25)

Record only. No code, no migration in this pass — see (f) for sequencing.

### a. EQUIPMENT CAPTURES UNITS, NOT HIRE RATE. DECIDED.

Morning Q4 changes from "name + hire rate" to "name + number of units." The
engineer's number now means the thing he naturally types: "JCB 2" is two
JCBs.

**This DISSOLVES the defect recorded in
`docs/reviews/equipment-parser-count-gap.md`, rather than patching it.**
`parseChunk`'s rule — the first numeric token in a chunk becomes
`daily_hire_cost`, `count` hardcoded `null` on every return — was the
defect itself, not a bug within an otherwise-sound design: with units
asked for instead of a rate, the same number the engineer already types
maps to `count` directly, no new parsing logic required to distinguish
"this number is a count" from "this number is a rate." Evidence both live
incidents trace to that exact rule: 2026-08-21 ("Cement micsur 1000") and
2026-08-25 ("Cement mixer - 1 1000," stored `daily_hire_cost: 1` for a
concrete mixer, live in production today — full record:
`docs/reviews/equipment-parser-count-gap.md`, `030-apply-record.md`'s GATE
1 section).

**Older than either live incident:** this exact defect was already a
named, tracked debt item before today — `docs/build-status.md`'s
"EQUIPMENT `daily_hire_cost` — A COUNT IN A MONEY FIELD" entry, opened
2026-08-05 from migration 022's own review (engineer C's rehearsal
example, "1 JCB, 2 mixers" → `daily_hire_cost: 1` / `daily_hire_cost: 2`,
`count: null` on both — the identical mechanism, caught in rehearsal
seven weeks before it shipped a fabricated rupee figure to a real DPR).
This decision closes that entry, not just the two incidents that made it
urgent.

### b. EVENING EQUIPMENT MIRRORS MANPOWER.

Morning captures units by type; evening captures hours by type; aggregates
are sums. Not per individual machine — "2 JCBs, 16 hours" is a type-level
answer, exactly as manpower is trade-level (§28(l)'s evening Q2/Q3 shape:
workers by trade, idle hours by trade). Idle equipment hours land the same
way idle labour hours do — §28(l)'s evening Q3 ("Idle hours by trade") is
the direct analogue; equipment's existing Q4 ("Equipment run hours,"
already auto-skipping on empty morning equipment, BOT-22) is the run-hours
half of the same UTILISATION metric §28(m) already defines (`hours run ÷
hours available`) — idle is the complement, not a new concept.

### c. IDLE COST REMOVED FROM THE DPR. DECIDED.

Rates typed from memory in free text are not factual and must not appear
in an owner-facing report as if they were. The DPR shows IDLE HOURS.
Rupee figures move to the app/dashboard, computed from invoice data, where
a number can be inspected rather than asserted.

**Record the consequence honestly:** the DPR loses its only rupee figure,
changing it from a report that quantifies waste in money to one that
quantifies it in hours.

**Record what this closes:** with `daily_hire_cost` unwritten (per (a))
and idle cost unrendered, the equipment parser stops producing money at
all. The entire fabricated-rupee defect class ends rather than being
contained — not just this pass's two incidents, but the whole shape of
finding named in (a)'s "A COUNT IN A MONEY FIELD" entry, including its own
two named downstream consumers (`docs/build-status.md`'s entry: this DPR
path, and `design-decisions-beta-feedback.md` §6's weekly-review
"Machinery wastage ₹ = idle hours × hire rate" yardstick). §6's own
formula is untouched by this decision — it is a *future-phase, weekly
review* feature, not the daily DPR (a) and (c) scope — but it shares the
identical untrusted-rate dependency and is left as a known, related,
not-yet-addressed item, not silently assumed safe.

### d. RATE FORMULA, for the invoice era — RECORDED, NOT BUILT.

```
hourly rate = day rate / standard working hours per day
idle cost   = idle hours × hourly rate
```

Two prerequisites that do not exist:

1. **"Standard working hours per day" is a CONFIGURABLE STANDARD**, same
   family as `productivity_standards` (§6) — likely tenant- or
   project-level, since a double-shift site is not 8.
2. **Invoices do not reliably state a day rate.** Monthly and weekly hire
   are common, so the day rate is itself sometimes derived. The formula
   must not assume a field that is not on the bill.

The join is invoice → equipment → days on site. That is a design task,
not a display change.

### e. COLUMNS AND CODE — do not drop.

`daily_hire_cost` stays as a column, no longer written. `computeIdleCost`
(`lib/dpr/idle-cost.ts`) stays, no longer called. Same treatment as
`morning_execution_plan` (§28(p)): collected data is not destroyed, and
when invoices arrive the code path is still there to point at a real
rate. Added to §28(p)'s unread list — see that section for the addendum.

### f. SEQUENCING — NOT SCHEDULED.

The parser change is TypeScript, but the write path is the morning RPC,
so this needs a migration. One production migration has already shipped
today (030). Assess whether this can ride with the evening restructuring
(§30(a)) rather than being its own apply, since that migration also
touches equipment handling — `evening.ts`'s own Q4/equipment-hours step
already reads `morning_equipment`'s stored item shape directly
(`equipmentEcho`, echoing `morning_equipment->'items'` per migration
024's `v_equipment_echo`) — record the assessment, do not decide it.

**Assessment, recorded not decided:** riding with §30(a) avoids a second
production apply and a second external-review round for a change that
touches the same table (`daily_logs.morning_equipment`) and the same
downstream reader (`evening.ts`'s equipment echo) §30(a) is already
modifying. Against combining: §30(a) is itself already a larger,
multi-question restructuring (§30(a)'s own text: "two questions deleted,
two rebuilt as by-trade pairs, one moved, one added, two new columns,
every reask key reshuffled") — adding a third concern risks the same
bundling hazard §30(a) itself was written to avoid for morning-vs-evening
(§30(a): "Bundled, a bug found in the evening half blocks the morning
half from shipping"). Neither side of this tradeoff is decided here.

### g. `docs/reviews/equipment-parser-count-gap.md` — superseded, not open.

Updated in this same pass: the count gap recorded there is superseded by
(a), not left open. The evidence in that document is kept, unedited — it
is the reason for this decision, not a closed incident with no further
use.

## 34. `checkin_escalations` cannot distinguish "asked, no answer" from "never asked" — OPEN, 2026-08-25

**Record only, not built.** Found while building B3 (the 15:00 IST morning
cutoff sweep) — carried here rather than fixed inline, since it belongs
with Pass 2's escalation work, not with B3's own scope.

**The gap.** `determineTargetStatus`
(`lib/checkin-escalations/status.ts:75-92`) computes an engineer's
check-in status purely from the project roster plus
`daily_logs.morning_submitted_at`/`evening_submitted_at` — it never reads
`whatsapp_sessions` at all. Two genuinely different situations therefore
collapse to the identical `not_submitted` status, with no `daily_logs` row
either way:
- the engineer was reached, a session opened (`whatsapp_sessions.current_
  flow = 'morning'`), and they never replied to Q1 at all;
- the engineer was never reached in the first place — no session, nothing.

**Why it matters.** These need OPPOSITE responses. One is an engineer
ignoring the bot; the other is delivery failing. Once Pass 1 sends
unprompted (the #69/031 outbound-send primitive, CLAUDE.md §3), that
distinction becomes the PRIMARY signal that the crons are actually
reaching people — and the existing cron-didn't-fire check (§29) only
catches a cron that never ran at all, not one that ran and was never
received (a bad number, a blocked account, a delivery failure Twilio
reports but nothing here reads).

**The evidence already exists, it is simply not consulted.** A
`whatsapp_sessions` row with `current_flow = 'morning'` — or, after B3
sweeps it, a `daily_logs` row with `attendance_defaulted = true` and no
`attendance_raw` (the step-5 sweep-stamp shape) or, for a step-1 stuck
session, an absent `daily_logs` row despite a session having existed —
already proves the engineer was reached. `determineTargetStatus` simply
never looks.

**Not decided here:** whether the fix is `determineTargetStatus` reading
`whatsapp_sessions` directly, a new `checkin_escalations` status value
distinguishing the two cases, or something else. Belongs with Pass 2's
escalation work, per this entry's own opening line.

## 35. Check-in window rules — DECIDED and built, 2026-08-26

Supersedes this entry's own earlier OPEN framing (options a/b/c, never
committed to git) — Aravind decided the same day the gap was found.

### 35a. The 2026-08-26 incident and its mechanism

Investigating a real production incident (~17:40 IST, phone
`+919176865600`): `"Hi"` correctly started the morning flow and asked
Q1. Thirteen seconds later, `"No"` — which `quoco_classify_yes_no`
classifies correctly (`{"ok": true, "met": false}`, confirmed live) —
produced Q1 again instead of advancing to the holiday follow-up.
Thirteen seconds rules out a client-side race (`readCurrentFlow`'s
unlocked-read window is sub-second, not double-digit); the RPC-level
"flow already active" retry path (`p_start_flow=true` against an active
session) returns `FLOW_RACE_REPLY`'s distinct text, not Q1's own
wording, so that path is also inconsistent with what was observed.

**The mechanism.** `sweep_stale_morning_sessions` (migration 033) has no
minimum-age filter — its cursor (`WHERE current_flow = 'morning' FOR
UPDATE SKIP LOCKED`) makes no distinction between a session parked for
six hours and one that started six seconds ago, and it runs every
60-second tick. `routeInboundMessage` (`lib/whatsapp/inbound-start.ts`)
had no `morningCutoff` check at all — an inbound with
`morning_submitted_at` still null started a fresh morning flow at ANY
hour, 08:30 and 17:40 treated identically. Together: the session started
at 17:40 was reset by the sweep — `current_flow` back to `NULL`,
`current_step` back to `0`, `context.morning_submitted` correctly NOT
set (migration 033's own B1 fix, session was at step 1) — within its
first tick, before the engineer's own next message arrived. The next
inbound read a clean idle session and started over. **Not directly
proven from a log** (session-level state was long since overwritten by
investigation time, Sentry/Vercel invocation logs were not pulled) — but
it is the only mechanism consistent with the code and the timestamps.
`attendance_defaulted=false` on the completed row proves the ENGINEER
completed the flow after being knocked back to Q1 — the sweep did not
complete it.

**What let this ship unnoticed.** Both `sweep_stale_morning_sessions`'s
external reviewer (round 1, migration 033) and Aravind independently
reasoned carefully about what the sweep does to a session it finds
PARKED — the skip-over-guess project-membership fix, the missing-row
guard, the B1 same-day gating fix all came from that scrutiny. Neither
asked what the sweep does to a session that is still LIVE, mid-turn, on
the very tick after it started. Recorded here as the actual gap in the
review process, not just in the code: a correctly-reviewed function can
still race code nobody thought to check it against.

### 35b. The fix — two window guards, `routeInboundMessage` only

**DECIDED (Aravind, 2026-08-26).**
- **Morning flow must not start after 15:00 IST (`morningCutoff`).**
  15:00 is already the grace window — no second grace. Guard added
  immediately before the `applyMorningFlowTurn` call
  (`lib/whatsapp/inbound-start.ts`): refuses if `ist.minutes >=
  cutoffMinutes(CHECKIN_CHECKPOINTS.morningCutoff)`, replying *"The
  morning check-in window has closed for today. Your evening check-in
  will be sent automatically."* — no instruction to act, since evening
  is cron-triggered, not something the engineer sends first.
- **Evening flow must not start before 18:30 IST (`eveningSend`).** Same
  shape, mirrored: refuses if `ist.minutes < cutoffMinutes(CHECKIN_
  CHECKPOINTS.eveningSend)`, replying *"It's not yet time for your
  evening check-in — it will be sent automatically."*
- **The sweep is deliberately UNCHANGED.** Confirmed, not assumed:
  `sweep_stale_morning_sessions`'s cursor already closes ANY
  `current_flow='morning'` session past the cutoff, live or not, with no
  minimum-age check — exactly the decided behaviour. `FOR UPDATE SKIP
  LOCKED` is not a grace period; it only skips a row an RPC call is
  *actively* holding at that exact instant, not a row that's merely
  recent, which is precisely what let the sweep catch the 17:40 session
  between turns. Partial-answer preservation (steps 2-4 stamp-only, step
  5 INSERTs `absent`/`attendance_defaulted=true`, step 1 leaves no row)
  is unchanged — a truncated flow, not lost data, is the sweep doing its
  job correctly now that starting a post-cutoff morning session is
  refused upstream.

Both guards are **SCAFFOLDING, not the intended end state** — §28(x)'s
ad-hoc menu is the eventual standing reply for any inbound outside a
check-in window; these refusals exist only because that menu is decided
but not yet built. Confirmed TypeScript-only, no migration: neither RPC
needs to change what it does when called, since the router now decides
whether to call it at all — same shape as the pre-existing `eveningClose`
refusal, which was already TS-only.

### 35c. `eveningNudge` (19:15) — CONFIRMED, not changed

DPR generation runs at 19:45 IST (`eveningClose`, `vercel.json`'s
`dpr-generate` cron confirmed at `15 14 * * *` UTC = 19:45 IST exactly).
That leaves a flat **30-minute gap** between the nudge and generation.
Stated honestly: **no document has ever evaluated that 30 minutes
against the five-question evening flow's actual completion time** — the
19:15 value was carried forward from "was 7:30 PM, now 19:15"
(`docs/bot-flows.md`), never independently derived. If an engineer is
mid-task when the nudge lands, the DPR generates on whatever partial
data exists at 19:45 regardless. **Accepted as-is, and now stated rather
than inherited** — this entry is the record of that acceptance, not a
claim that 30 minutes was verified sufficient.

### 35d. Evening nudge send — Pass 2, not built

Recorded only. Nothing can send an evening nudge until the outbound
primitive (#69/031, CLAUDE.md §3) exists — same blocker as every other
not-yet-built send in this codebase.

### 35e. §28(x)'s ad-hoc menu — now higher priority than previously scoped

With both new window guards live and `eveningClose`'s own refusal
already in place, an engineer messaging outside every check-in window
(before `morningCutoff` obviously doesn't apply, but the whole stretch
`morningCutoff`..`eveningSend`, and everything past `eveningClose`) now
has **no way to initiate anything at all** — three static refusals and
zero other paths in. §28(x)'s menu (`### x. AD-HOC MENU IS THE
ENGINEER'S FRONT DOOR`, §28's own text: "It is what he sees whenever he
opens the thread outside a check-in, so it is designed as a home
screen") was already decided as the eventual answer to this, but this
entry's own guards make the gap it fills larger and more immediate than
when §28(x) was originally scoped — it is now the only path in for a
real, currently-live window of the day, not a hypothetical one.

### 35f. Both refusal strings promise something that does not yet exist — ACCEPTED, checklist item added

`MORNING_WINDOW_CLOSED_REPLY` ("...Your evening check-in will be sent
automatically") and `EVENING_WINDOW_NOT_OPEN_REPLY` ("...it will be sent
automatically") are both false today. No cron exists. No outbound-send
primitive exists (#69/031, CLAUDE.md §3). Nothing sends anything. An
engineer refused at 16:00 IST is told to wait for a message that will
never arrive.

**Same defect class as template 8's "Reply STOP at any time"** — GATE 2
holds that template out of submission for promising a capability the
system does not have. Not gated the same way here, on scale: one
engineer (Aravind), Pass 1 measured in days rather than months, and
rewriting to an honestly vague string now would only need rewriting
again the moment the cron lands — churn without benefit at this size.
**Accepted, not fixed, and now stated rather than left implicit.**

**EXPLICIT PASS 1 CHECKLIST ITEM, added here and in
`docs/plans/pass1-outbound-send-plan.md`'s own "Two hard preconditions"
section (§35f, not only here — a note that lives solely in a decisions
file will not be read at cron-enable time):** when Pass 1's crons are
enabled, both refusal strings' promise becomes something to VERIFY, not
assume — confirm by direct observation (this project's own standing
"rollback mechanisms are verified by observation" discipline, same as
GATE 1/B3's own two hard preconditions) that an engineer refused during
either window actually receives the promised automatic message before
leaving these strings as-is. If Pass 1 slips, or real engineers arrive
before Pass 1 ships, this copy must change to something honest BEFORE
that happens — not be discovered false by an engineer waiting on a
message that never comes.

**REFRAMED, 2026-08-28 (item D/F/E pre-flight audit) — this is a
POST-item-E verification, never a THIRD precondition alongside GATE
1/B3, despite living inside a section titled "Two hard preconditions."**
Named explicitly because that placement invites exactly the misreading:
GATE 1 and B3 are things that must be true BEFORE the two `vercel.json`
cron entries are added; this item cannot be checked until AFTER they are
— it requires observing a real, refused engineer actually receive the
promised message, which cannot happen before the crons that send it
exist. **It gates nothing about enabling the crons; it is what you check
the day after you do.** Do not read "both preconditions confirmed
cleared" (this same section, below) as covering this item too — it does
not, and never did; the two are independently satisfiable in a way GATE
1/B3 are not. See §38 for the two now-decided replacement strings that
make this checklist item finally checkable at all — until this entry,
retirement itself (§28(w)) had no copy to verify for two of its four
branches.

## 36. UNIQUE index on `project_members(user_id)` — DECIDED IN PRINCIPLE, NOT SCHEDULED, 2026-08-26

**Citation correction, on read:** this entry was requested citing "§35's
multi-project gap" as one of the three things it closes. §35 (above) is
about check-in window timing and does not discuss multi-project anything —
the actual multi-project discussion is `docs/reviews/033-sweep-review-
package.md` §13.4 ("the real closer for the multi-project gap"). Corrected
here rather than propagated into a new permanent record.

**The proposal.** Add `CREATE UNIQUE INDEX ... ON project_members(user_id)`
— makes "one engineer belongs to exactly one project" (already a DECIDED
product rule, migration 031's own header, 2026-08-26) a database
constraint instead of an assumption every consumer has to individually
trust or defensively guard against.

**What it closes, three places at once, all already paid for by the same
underlying ambiguity:**
1. **`sweep_stale_morning_sessions`'s multi-project skip becomes dead
   code.** Migration 033 counts an engineer's `project_members` rows and
   skips (does not guess) when the count isn't exactly 1 — correct given
   today's unenforced schema, per `docs/reviews/033-sweep-review-package.md`
   §13.4's own "real closer" note: capturing `project_id` into the session
   at flow start is the actual fix, this index is what makes that capture
   safe to trust. With the index in place, the count can only ever be 0 or
   1 — the `!= 1` branch stops being reachable for any row the index
   allowed to exist, though the skip-and-alert code (B2, external review
   round 1) stays as defense-in-depth, not deleted.
2. **Migration 031's `project_id` ambiguity vanishes.** 031's own header
   (PROJECT SCOPE section, 2026-08-26) already states its correctness
   depends on this exact rule holding, and already states the schema
   doesn't enforce it. This index is that dependency's actual closure.
3. **The multi-project gap named in `033-sweep-review-package.md` §13.4
   closes** — the session-capture fix proposed there becomes safe to build
   on top of, rather than being its own separate source of the same
   ambiguity this index removes at the root.

**Its own migration, its own review — not folded into 031 or anything
else.** Per CLAUDE.md §0's EXTERNAL REVIEW GATE, a new constraint on an
existing table with live data trips condition (b) (grants/constraints
changing what's permitted) on its own terms.

**Must be checked against existing data FIRST — a duplicate today would
make the index fail to create.** `CREATE UNIQUE INDEX` on a column with
existing duplicate values simply errors; before this migration is written
for real, `SELECT user_id, count(*) FROM project_members GROUP BY user_id
HAVING count(*) > 1` must return zero rows, checked live, not assumed from
"the product rule says this shouldn't happen." If it returns any rows, per
this project's own decided rule that's a data-integrity violation to fix
first (which engineer's second project row is wrong), not a reason to
weaken the index.

**Recorded plainly, because this project has spent a week learning which
one it actually was:** "we decided" and "the database enforces it" are
different things. Migration 033's own skip-and-guard exists because the
first one was assumed to be the second. This index is the one place in
this specific chain where that gap can actually close, rather than being
individually re-guarded against at every consumer that touches
`project_members`.

## 37. Evening delivery gates on evening data, not morning submission — six decisions (2026-08-27)

Recorded from tonight's evening-trace investigation
(`docs/reviews/session-transition-lock-wait-flake.md` and this session's own
trace are unrelated — this entry stands alone, prompted by a live "Hi" to the
sandbox returning `MORNING_WINDOW_CLOSED_REPLY` three times today at 18:27,
18:30, and 18:56 IST). Record only — no code, no copy changed.

### a. Evening trigger goes to every engineer every day, except site-holiday

**CONFIRMED against §30(b)/(d), not newly decided — this entry states the
requirement so it survives to Pass 1's build.** §30(b): on the morning
`NO → ENGINEER ABSENT` path, "Evening trigger STILL FIRES — half-day and
late-arrival cases are real." §30(d): the evening trigger's roster excludes
`messaging_blocked=true` and, since §30(d), `attendance='site_holiday'` —
**nothing else**. Neither exclusion is, or was ever proposed to be, keyed on
whether morning was submitted. An engineer who missed the morning window
entirely may have been on site all day; the evening trigger existing to ask
what happened does not depend on whether he already answered a different,
earlier question.

**REQUIREMENT ON PASS 1's ROSTER QUERY, recorded as such:** the evening
roster (`docs/plans/pass1-outbound-send-plan.md`, item E) must NOT inherit
`routeInboundMessage`'s `morningSubmitted` gate (see (b) below for what that
gate actually is and where it lives). The roster's only two exclusions are
`messaging_blocked=true` and `attendance='site_holiday'`. Folded in as a
dated amendment to `docs/plans/pass1-outbound-send-plan.md` in this same
commit — per that file's own standing practice (Amendment (e), same
reasoning: "a note living only in a decisions file will not be read at
build time").

### b. The inbound gap — accepted, not fixed

`routeInboundMessage` (`lib/whatsapp/inbound-start.ts`) reads
`daily_logs.morning_submitted_at`/`evening_submitted_at` for the current IST
day, then branches:

```
205   if (!morningSubmitted) {
214     if (ist.minutes >= cutoffMinutes(CHECKIN_CHECKPOINTS.morningCutoff)) {
215       return { reply: MORNING_WINDOW_CLOSED_REPLY, resolvedFlow: null }
216     }
217     const result = await applyMorningFlowTurn(commonRpcParams)
        ...
225   }
226
227   // Morning submitted, evening not -- start evening ...
233   if (ist.minutes < cutoffMinutes(CHECKIN_CHECKPOINTS.eveningSend)) {
234     return { reply: EVENING_WINDOW_NOT_OPEN_REPLY, resolvedFlow: null }
235   }
236   const result = await applyEveningFlowTurn(commonRpcParams)
```

The evening branch (227-243) is nested inside the `else` of
`if (!morningSubmitted)` (205). An engineer who never touched morning at all
gets `MORNING_WINDOW_CLOSED_REPLY` for every message he sends for the rest
of the day, past `morningCutoff` (15:00 IST) — the evening window guard at
233 is never even evaluated for him, no matter how far past `eveningSend`
(18:30 IST) the clock is.

**Observed live, 2026-08-27:** `"Hi"` to the sandbox (`+919176865600`, no
`daily_logs` row for today, confirmed by direct prod read) returned
`MORNING_WINDOW_CLOSED_REPLY` at 18:27, 18:30, and 18:56 IST — the last two
**after** `eveningSend` had already passed.

**This is an unreviewed INTERACTION between two guards each reasoned about
independently in §35(b)** ("Morning flow must not start after 15:00,"
"Evening flow must not start before 18:30") — neither guard's own reasoning
considered the conjunction: an engineer who never touches morning, once past
both cutoffs. **Not the same defect as §35(f)'s acceptance.** §35(f) is a
promise temporarily false (no cron exists yet to make it true) — this is a
promise structurally unfulfillable *through this code path*, on any
timeline, for this specific engineer shape, because the branch that would
fulfill it is unreachable regardless of whether the cron exists. **Moot once
(a)'s cron ships** — the future outbound trigger is a separate code path
from `routeInboundMessage` and, per (a), was never designed to gate on
`morningSubmitted` in the first place. The refusal COPY remains wrong in the
interim (same string, same false promise) — revisit together with §35(f)'s
own Pass 1 checklist item, not as a second, separate fix.

### c. Owner delivery gates on evening data — DECIDED, supersedes the narrower rule proposed tonight

**Supersedes** the narrower "no `daily_logs` row at all" framing surfaced
during tonight's trace — that framing was too narrow and is corrected here,
not carried forward.

**Rationale:** morning is intent, evening is what happened. A DPR without
evening data has nothing an owner can act on — a morning-only day describes
a plan, not a result.

**The rule:**
- The DPR **is still generated** — it remains the internal record and the
  PM's own view (DASH-04 detail, DPR archive). Generation is unchanged by
  this entry.
- It is **NOT sent to the owner** when `evening_submitted_at IS NULL`.
- Instead the owner receives a short WhatsApp message: no report today,
  nothing was reported from site (copy in (d) below).

**Record precisely what "gates" means, since three different readings were
live in tonight's trace and only one is correct:** the gate is
**`evening_submitted_at IS NULL`** — not "no `daily_logs` row exists" (a row
can exist from a morning-only day and still gate), and not "partial data"
(a vaguer, ungoverned standard that would need its own definition of
partial). **A morning-only day is suppressed under this rule** — attendance
recorded, plan captured, nothing else, no evening half — exactly the shape
that would otherwise ship an owner a report describing intent with no
outcome.

### d. New owner-facing WhatsApp template required — flag prominently, it has lead time

**Owner delivery today is EMAIL-ONLY** (§28(bb)): "NO owner-facing WhatsApp
template exists in the submitted batch — templates 6, 7, 9 and 10 all go to
the PM, and 7 tells the PM the owner was EMAILED." (c) introduces the
**first owner-facing WhatsApp message in the product**, and it needs its own
Meta-approved template — Twilio/Meta template review takes days, and an
approved template's body cannot be edited afterward (same constraint §28(bb)
already named for the still-outstanding owner-notification template).
**Write it into Pass 2's template batch now**, not discovered at build time.

**Draft copy, for approval, register per Rule 3.12's own tiering** (owner is
PM/owner tier — templates 5/6/9/10/11/12, "can carry more structure" than
the strictest engineer tier, but still simple, two short sentences, no
idiom):

> No site report was received for {{1}} today, {{2}}. There is nothing to
> share for this date.

## 38. Inbound-start retirement — the two missing acknowledgement strings, DECIDED (2026-08-28)

Item D/F/E pre-flight audit, this session. §2's own retirement plan
(`docs/plans/pass1-outbound-send-plan.md`) leaves `routeInboundMessage`
with four idle-inbound branches once built: two already refuse with
static copy (`MORNING_WINDOW_CLOSED_REPLY`, `EVENING_WINDOW_NOT_OPEN_
REPLY`, §35b) and can return that text unconditionally once retirement
removes the RPC calls that currently sit past them; the other two
currently START a real flow (`applyMorningFlowTurn`/`applyEveningFlowTurn`
with `startFlow: true`) and have no refusal copy at all — retirement
removes the start, and until now nothing filled the gap it leaves.

### a. Approved copy (Aravind, 2026-08-28)

```
Morning, before morningCutoff:
"Good morning. Your check-in will arrive shortly — it comes to you automatically."

Evening, after eveningSend:
"Your evening check-in will arrive shortly — it comes to you automatically."
```

### b. Reasoning

- **Fills the genuine gap, not a cosmetic one.** Two of `routeInboundMessage`'s
  four idle branches currently start a flow rather than refusing — retirement
  (§2 item 1) leaves them with no reply at all unless this copy exists. The
  other two already refuse and need no new text.
- **§28(w)'s original fallback proposal is WRONG for these two branches —
  corrected here, dated, so it is not implemented as originally written.**
  §2 item 2 proposed falling back to the "already-done"/`REPORT_READY_REPLY`-
  style acknowledgement for every idle branch. `REPORT_READY_REPLY` ("Today's
  report is ready") states the OPPOSITE of the truth at, say, 09:00 or 19:00
  under these two branches — that half's check-in has not happened yet. Not a
  gap in the original proposal, a wrong answer for these two specific cases;
  do not implement §2 item 2 literally for the morning-before-cutoff or
  evening-after-send branches.
- **Register matches the two existing refusal strings deliberately — all
  four now read as one voice.** Both new strings echo "...it comes to you
  automatically" / "...will arrive shortly," the same construction as
  `MORNING_WINDOW_CLOSED_REPLY`/`EVENING_WINDOW_NOT_OPEN_REPLY`'s own
  "...will be sent automatically." States the fact rather than instructing
  the engineer — he is messaging because he believes he must start it
  himself; the copy's job is to make that belief unnecessary, not to correct
  him for holding it.

### c. Accepted imprecision, named honestly

"Shortly" is true before that half's own trigger has fired and merely
optimistic after it — if he ignored the 08:30 (or 18:30) trigger itself,
nothing further arrives until the nudge (Pass 2, not built, §35d). Naming
the actual clock time was considered and rejected: it hardcodes a
checkpoint value into copy that drifts the moment `CHECKIN_CHECKPOINTS`
changes (the same reasoning `REPORT_READY_REPLY`'s own "tomorrow morning,"
not a time, already used). Accepted knowingly, not overlooked.

### d. All four branches are TEMPORARY — known end date

`MORNING_WINDOW_CLOSED_REPLY`, `EVENING_WINDOW_NOT_OPEN_REPLY`, and both
strings above are every one of them SCAFFOLDING (§35b's own framing,
extended here to the two new strings by the same reasoning) — §28(x)'s
ad-hoc menu, once genuinely built, replaces all four with a single
interactive front door. This copy has a known expiration, not an indefinite
lifespan; do not invest further precision into any of the four beyond what
is recorded here.

### e. Two pre-flight findings, reconfirmed this round, not new

- **§35(f)'s checklist item is a POST-item-E verification, not a
  pre-flight one** — corrected in place at §35f above (REFRAMED,
  2026-08-28) and in `docs/plans/pass1-outbound-send-plan.md`'s own "Two
  hard preconditions" section (same date). It cannot be satisfied until an
  engineer refused during either window is observed actually receiving the
  promised message — impossible before the crons that send it exist.
- **§37(b) remains live, unchanged by this entry.** An engineer who never
  submits morning still receives the morning refusal on every inbound
  message for the rest of the day, on any timeline — confirmed against
  `main`'s actual code this same audit, not merely cited from §37(b)'s own
  2026-08-27 record. His real evening send still arrives via the cron
  (item E, once built), which does not route through `routeInboundMessage`
  at all — but the inbound echo itself stays wrong for that specific
  engineer shape until §28(x)'s menu ships. Not fixed by this entry's own
  two new strings, which do not touch this branch's own already-covered
  refusal text.

`{{1}}` = project name, `{{2}}` = date — same variable shape as templates 6
and 7. Category: Utility (same default basis as every other operational
template in the batch, per `whatsapp-templates.md`'s own "Category basis"
section). Template number and formal audit (the six Twilio/Meta compliance
rules already applied to templates 1-13) are Pass 2's own template-batch
work, not decided here — this entry fixes the copy's *content* requirements
only.

**It must NOT blame the engineer and must NOT promise a report later** —
checked against the draft above: no subject performs a failure ("was
received" is passive, names no one), no future tense promising delivery.

**Why silence alone was rejected, recorded:** sending nothing tonight and
sending nothing under this new rule would look IDENTICAL to the owner —
"the engineer didn't report" and "the delivery failed" are indistinguishable
from silence alone, and an owner noticing the gap is exactly the pressure
that improves compliance. Same reasoning this product already applies
elsewhere: the DPR itself shows gaps honestly (§30(f)'s site-holiday
handling, the "not received" text for a silent engineer per the DPR-17
rewrite in (e) below) rather than hiding them. A silent suppression here
would be the one place this product's own honesty-about-gaps principle
quietly stopped applying.

### e. The finding behind (c) — DPR-17's zero-data check, traced

**On 2026-08-27, a DPR was generated for a day with ZERO `daily_logs`
rows** — `generated_at` 19:45:49 IST, `delivery_status: 'pending'`, matching
`eveningClose` (19:45) exactly. Invisible today only because owner delivery
of that report is unbuilt (Pass 1 does not yet send it anywhere) — (c) is
what makes this finding consequential rather than academic.

**Trace, code as it stands on `main` today — report only, nothing changed:**

`DPR-17`'s zero-data check, in the form its name refers to, **no longer
exists in this code path.** It was a PROJECT-LEVEL skip in the original
cron route: zero `daily_logs` rows anywhere on a project for the day →
write one project-level `dprs` row with `delivery_status='skipped_no_data'`,
enqueue nothing. That mechanism produced the one row this project ever saw
carry that value (`35a2f41c`, since deleted by migration 028 Option A) and
is what CLAUDE.md §8's 2026-08-12 CRON_SECRET-resolution evidence actually
observed.

**It was superseded on 2026-08-14** (per-engineer report reformat, review
round 2 S3 / round 3 Q8/N3/S4 — `app/api/cron/dpr-generate/route.ts:19-33`'s
own header) by an ENGINEER-LEVEL union eligibility check in
`runDprGenerateTrigger`:

```
60    for (const project of projects ?? []) {
        // SET 1 -- active roster.
62      const { data: members, error: membersError } = await client
          .from('project_members')
          ...
        // SET 2 -- real data, regardless of current roster membership (S3).
79      const { data: logs, error: logsError } = await client
          .from('daily_logs')
          ...
88      const eligibleIds = new Set<string>([...rosterIds, ...dataEngineerIds])

        // Q8 (round 3): zero-eligible-engineers on an active project is an
        // accepted gap (S4 -- no dprs row is written, since engineer_id
        // NOT NULL makes a project-level marker incoherent), but detection is
        // IN SCOPE now, not deferred to a future incident.
94      if (eligibleIds.size === 0) {
          Sentry.captureMessage(...)
101       continue
        }
        ...
107     for (const engineer_id of eligibleIds) {
          ...
130       await enqueueJob('dpr_generate', { project_id: project.id, engineer_id, log_date: logDate }, client)
        }
```

**What it actually gates on now: zero ELIGIBLE ENGINEERS on an active
project** (no active roster member AND no `daily_logs` rows) — not zero
DATA. Today's project had one active roster member (SET 1 alone), so
`eligibleIds` was never empty, and a `dpr_generate` job was enqueued for him
**unconditionally**, per the route's own comment: "Every engineer in the
union gets a job, UNCONDITIONALLY... An engineer with zero `daily_logs` rows
still gets a full report reading 'not received' throughout (the
silent-engineer fix this reformat exists to build)."

**Why it did not fire today: it isn't the check that would have.** The
project-level zero-data skip this finding's name refers to was deliberately
removed thirteen days before today's observation (2026-08-14 → 2026-08-27),
replaced by a check that only
ever fires when a project has no engineers assigned to it at all — a
different, much narrower condition than "no data was submitted." Not a bug
in either version; the newer eligibility check is correct for its own
purpose (a silent engineer should get a report saying so, per its own
comment) — it simply means nothing upstream of (c) currently distinguishes
"nobody reported" from "a full day was reported," which is exactly the gap
(c) closes on the DELIVERY side, not the generation side.

### f. Scope: (c) and (d) belong with #67, not with generation

(c) and (d) change **delivery** — whether/how a generated DPR reaches the
owner — not **generation** (unchanged, per (c) above: the DPR is still
produced and still serves as the PM's own record regardless of this rule).
They belong with PR #67's two-stage delivery work
(`docs/dpr-delivery-versioning-plan.md`), not with (e)'s eligibility logic
and not as a new generation-time gate. Recorded here as scope, not
implemented — no code in this entry.

## 39. `EVENING_AWAITING_TRIGGER_REPLY` promises a message that will never come on a
site-holiday day — THIRD instance of the promises-something-that-does-not-happen class
(2026-08-30) — **RESOLVED-BY-DESIGN, same day, see closing note below**

**Observed live, today, not hypothesized.** An engineer whose morning check-in resolved
to `attendance='site_holiday'` messaged in after `eveningSend` (18:30 IST). Per §30(b)'s
own decided rule — *"Cancels every remaining trigger for that engineer that day —
evening trigger, morning nudge, evening nudge, PM escalation"* — `filterEveningRoster`
(`lib/whatsapp/outbound/roster.ts`) correctly excludes him from tonight's evening
roster; confirmed directly against the function's own filter, `attendance !==
'site_holiday'`. But `routeInboundMessage`'s idle branch (`lib/whatsapp/inbound-
start.ts`) returned `EVENING_AWAITING_TRIGGER_REPLY` — *"Your evening check-in will
arrive shortly — it comes to you automatically."* **A message promised that will
correctly, deliberately, never come.**

**Why:** `routeInboundMessage`'s existing `daily_logs` read selects only
`morning_submitted_at, evening_submitted_at` — never `attendance`. Its own branching
logic only asks "is morning submitted, is evening submitted," never "will evening ever
be attempted for this engineer today." For a site-holiday day, `morning_submitted_at`
IS set (the holiday follow-up's own write includes it, per `morning.ts`'s step-5
branch) and `evening_submitted_at` is null — indistinguishable, from this read alone,
from an engineer whose evening genuinely is still pending. **Scoped precisely: this is
specific to `attendance='site_holiday'`.** `attendance='absent'` does NOT trigger this
— §30(b)'s own text is explicit that the evening trigger *still fires* for an absent
engineer (half-day/late-arrival cases), matching `filterEveningRoster`'s own single
exclusion condition exactly. No other attendance value produces this gap.

**Third instance of a named class, not a new one — and a genuinely different proximate
cause from the first two, worth stating precisely rather than lumping together:**
1. **Template 8** (`quoco_engineer_optin`, "reply STOP") — false because the promised
   *mechanism* was never built (no code ever sets `messaging_blocked=true`; BOT-27
   SET-HALF, still open). A capability gap.
2. **§35f's original two refusal strings** — false because the promised *sender*
   didn't exist yet (no cron, no outbound-send primitive, at the time they were
   written). An infrastructure gap, since closed — item E's crons are live.
3. **This entry** — the sender and the cron both exist and fire correctly. The promise
   is false because the *reply-generation logic* doesn't know about a per-engineer,
   per-day exclusion that the *send-side* roster logic already, correctly, knows about.
   Not a capability gap, not an infrastructure gap — a **information gap between two
   code paths that should agree and don't.** §35f's own "accepted, verify once the cron
   exists" resolution does not apply here: the cron existing is exactly what does NOT
   fix this instance, since the falseness never depended on the cron's existence in the
   first place.

**§28(x)'s ad-hoc menu does NOT fix this — checked directly against the actual merged
spec, not assumed.** `docs/plans/adhoc-menu-spec.md` §a (DECIDED, 2026-08-28) resolves
`routeInboundMessage`'s six idle-branch replies into two groups: Group 1
(`REPORT_READY_REPLY`, `EVENING_ALREADY_COMPLETE_REPLY`) is **replaced** by the menu;
Group 2 — the four checkpoint-window replies, **including
`EVENING_AWAITING_TRIGGER_REPLY`** — **survives, with a pointer to the menu appended,
not replaced.** The false promise's own text persists verbatim after the menu ships;
only an extra sentence gets appended after it. **This also corrects §38(d) above**
("§28(x)'s ad-hoc menu, once genuinely built, replaces all four with a single
interactive front door") — that framing predates the menu spec's own later, more
specific decision and is superseded by it, not edited in place here per this file's own
correction discipline; §38(d) itself is left as written, dated, with this cross-
reference standing in for the fix.

**The fix, named, not built, per explicit instruction.** `routeInboundMessage`'s own
`daily_logs` SELECT already reads this exact row — extending it to also select
`attendance` is one additional column on an existing query, not a new read. With that
column in hand, the "morning submitted, evening not" branch (`EVENING_WINDOW_NOT_OPEN_
REPLY` / `EVENING_AWAITING_TRIGGER_REPLY`) checks `attendance === 'site_holiday'`
first: if true, the day is already, correctly, complete — the honest reply is in
`REPORT_READY_REPLY`'s own register (nothing more to capture today), not a promise of
an arrival that the roster filter has already, correctly, ruled out. Not designed
further here — column addition and branch condition only, no copy drafted, no code
written.

**RESOLVED-BY-DESIGN (Aravind, 2026-08-30), same day — not left open.**
`docs/plans/adhoc-menu-spec.md` §a's own 2026-08-28 decision (Group 2 survives, primary,
with a pointer appended — the framing this entry's own "does NOT fix this" paragraph
above correctly assessed) is itself superseded, same day as this entry: the menu is now
the ONLY reply to an idle inbound, full stop, with the four Group 2 replies **demoted to
a state-computed header line** above the list rather than surviving as primary text.
This closes the finding above, not merely narrows it: the header is computed from
`attendance` (and the rest of today's `daily_logs` row) via the exact fix this entry
already named — `routeInboundMessage`'s existing read, one column wider — applied at
the header's own construction site instead of independently. **The false promise this
entry records cannot recur under the new design**, because the reply no longer infers
"a check-in is coming" from the clock at all; it reads whether one actually will. See
`docs/plans/adhoc-menu-spec.md` §a for the full decision, the approved rough header
shape, and the Twilio/Meta delivery-mechanism research this resolution's own copy pass
depends on.

## 40. ONE evening template — {{3}}, the morning-plan echo, is REMOVED (2026-08-31) — supersedes §28(s)

**DECIDED (Aravind, 2026-08-31).** The evening check-in template drops `{{3}}` (the
morning-plan echo) entirely. `quoco_evening_checkin_no_plan` (2b), the template §28(s)
built specifically to handle the no-plan case, becomes unnecessary once there is no
plan-carrying variant left for it to be the fallback of — **one evening template, not
two, going forward.**

**This supersedes §28(s); §28(s) is left as written, not rewritten, per this file's own
correction discipline.** §28(s) itself remains an accurate record of why the two-template
split existed at the time it was decided (a fixed Meta body can't omit a variable
conditionally, so "no plan" needed its own template rather than a filler string). That
reasoning is not wrong; it is now moot, because the variable it was built to work around
no longer exists in the template at all.

**Reasoning, in full — recorded because this will be re-litigated as "why not remind him
what he planned?":**

- **PRIMARY (Aravind's own reasoning).** Echoing the plan **anchors** the evening
  answer. Putting "This morning you planned: {{3}}" directly above "What work was
  completed today?" invites the engineer to report *against the plan* — confirming or
  adjusting a stated intention — rather than reporting *against the day* as it actually
  happened. That is exactly the contamination §28(m) ("NO PLAN-VS-ACTUAL REPORTING")
  already named and ruled out for the SYSTEM's own comparison logic: morning is intent,
  evening is observation, and the two must not be allowed to influence each other. §28(m)
  stopped the system from computing a plan-vs-actual comparison; this decision stops the
  template from inviting the ENGINEER to compute one in his head before answering. Same
  principle, applied one layer earlier, at the point where the anchoring actually
  happens — a human reading his own stated plan half a page above the question, not a
  server-side join.
- **SECONDARY.** `{{3}}` was structurally fragile in two independent ways, both already
  on record: it goes **empty on a missed morning** (Meta rejects an empty variable value
  at send time — `templates.ts`'s `selectEveningTemplate` exists ONLY because of this,
  routing to `quoco_evening_checkin_no_plan` whenever `morningPlan` is null), and it
  **echoes garbled text back** whenever the plan itself parsed badly — `morning_plan` is
  stored as free-text verbatim (`morning.ts`'s step-2 branch, `.trim()` only, no
  parsing), so anything an engineer typed, however malformed, would be echoed back to
  him inside an approved template's rendered body.
- **What is lost, stated plainly, not minimised.** The engineer no longer sees his own
  morning plan when asked what he completed. §28(s) valued that as a courtesy — a
  reminder, not a demand. Nothing downstream computes against `{{3}}`'s absence: §28(m)
  already removed the one mechanism (the system's own plan-vs-actual comparison) that
  might have needed it, so there is no functional gap behind the lost courtesy, only the
  courtesy itself.

**Consequence for `quoco_evening_checkin_no_plan` (2b).** Retired going forward, not
retroactively un-submitted — it is already `approved` at Meta
(`docs/reviews/whatsapp-template-submission-status.md`, HX SID
`HX29c10ebad1290a1787e8ef14142ef4fc`) and approval cannot be undone or reversed by this
decision. `lib/whatsapp/outbound/templates.ts`'s `EVENING_CHECKIN_NO_PLAN_SID` constant
and `selectEveningTemplate`'s branch on it are **unchanged by this entry** — the new
single-template evening design ships as its own Content resource
(`quoco_evening_checkin_v3`, no `{{3}}`), submitted alongside this decision
(`docs/whatsapp-templates.md`), and the live code keeps sending the current two-template
pair until the SID constants are repointed, as its own separate change, once Meta
approves the replacement. This entry records the design decision and its full reasoning;
it does not itself touch `templates.ts` or unsubmit anything.

## 41. Photos are a first-customer requirement, not a Fast-Follow (2026-08-31) — DECIDED, not built

**DECIDED (Aravind, 2026-08-31).** Docs only — no schema, no code, no migration. This
entry reorders the roadmap; it does not build any part of it.

### a. Rationale, recorded because it reorders the roadmap

Indian construction sites already run on photos — a PM's WhatsApp is a photo feed. A
text-only product asks engineers to translate out of the medium they already use, and
competes with a habit that works. This moves inbound media handling from §28(aa)(1)'s
"load-bearing but unscheduled" framing (2026-08-21: "Invoices, delivery notes and cash
receipts are all photographs. Needs Twilio media download, a storage bucket, and a
retention policy") to a **prerequisite for onboarding a first customer.**

### b. It collapses three items into one build

Three of the ad-hoc menu's six CAPTURE items (`docs/plans/adhoc-menu-spec.md` §c —
excluding item 7, stop-messages, which is not a capture) are photographs: **material
received** (item 4) and **site document** (item 6) are each marked, verbatim,
"Buildable without media: **no**. Blocked on `§28(aa)(1)`"; **invoice** (item 5) is
blocked on the same section for the same reason, worded slightly differently in the
spec's own text ("blocked on `§28(aa)(1)` directly (its own photo) AND structurally on
item 4"). Checked directly against the spec's own per-item flow, not restated from
memory. §6's compulsory evening work-completed photo is the same missing capability.
**The menu without media ships half its items degraded** — three of six capture items
simply cannot function.

**REVISED ORDER: owner delivery → inbound media handling → ad-hoc menu.** This
sequences three pieces of work already recorded but never ordered against each other:
owner delivery (§28(bb), still email-only, no owner-facing WhatsApp template exists)
comes first; inbound media handling (§28(aa)(1)) second, now elevated by this entry;
the ad-hoc menu (§28(x), "the engineer's front door") third, since half its items
depend on the second. **Does not change CLAUDE.md §2's SPINE/FAST-FOLLOW
classification** — ad-hoc safety/invoice/hindrance flows remain listed there as
Fast-Follow; this entry orders the prerequisite work *within* what CLAUDE.md already
leaves unscheduled, it does not move anything across that boundary.

### c. Photos carry a purpose at capture

Relevance is a property of the purpose, decided at write time, never a judgement made
later. This is a **product** rule the schema will not enforce: a photo's purpose
derives from which flow captured it, so the enforcement is that hindrance photos can
only ever arrive through the hindrance flow (and so on for each of the other
photo-bearing capture items) — never a general upload with a purpose assigned
afterward.

### d. Three tiers in the DPR

- **EMBEDDED: work-completed photos only.** This is what an owner opens the report to
  see. Home: DPR Section 1, "Execution Output" (`docs/bot-flows.md`'s "The 6 Spine DPR
  sections" — "what was done, with quantities"), beside the activity the photo
  documents, per (e) below.
- **LINKED: everything else owner-facing** — safety, hindrance, invoice, site expense,
  site document. Each link must be **clearly named, never ambiguous**: the owner must
  know what he is opening before he opens it. Name the item and its subject, e.g.
  "Invoice — Ambuja Cement, ₹42,000," never "Photo 3."
- **NOT IN THE DPR: attendance photos.** Proof-of-presence for the PM, nothing an
  owner acts on. **This is §6's existing "morning = team/site/machinery photos"
  decision** (`design-decisions-beta-feedback.md` §6, "Compulsory photos") and §28(e)'s
  own "photo attendance... DEFERRED to §6's compulsory-photos work" — traced explicitly
  here so the mapping is not left implicit: morning's compulsory photo is what this
  entry calls an attendance photo, and §28(e)'s own trap ("attendance must NOT be
  inferred from photo arrival... a photo is evidence a message was sent with an
  attachment — it is not proof of presence") is exactly why it stays out of an
  owner-facing report rather than merely out of the embedded tier.

### e. The cap applies to embeds only

Maximum 10 embedded photos per DPR. Links are unbounded — a link costs a line of text,
not a screen, so capping them would hide activity for no benefit.

Photos sit **with their section**, not in a gallery at the end — the brickwork photo
beside "brickwork, 8 m³," inside DPR Section 1 (per (d) above), not a separate photos
block.

**OPEN, decide before build: what happens at an eleventh work-completed photo.** State
the drop rule, and require the DPR to **state** the truncation — "12 work photos
captured, 10 shown" — never silently omit. Silent truncation makes a report look
complete when it is not, contradicting the standard the DPR already holds for missing
data (`docs/dpr-engineer-report-spec.md`, rule 1, "Missing-ness is structural, not
conditional" — that document numbers rules, not `§`-sections; cited by name to avoid
the bare-`§N` ambiguity CLAUDE.md's own citation rule warns against). **Not decided
here** — named as an open question for whoever designs the actual capture/render
logic, not resolved by this entry.

### f. What this costs, stated honestly and not deferred

- **Twilio media download, a storage bucket, a `photos` table.** No schema authored by
  this entry — `daily_log_photos` (§6, "Compulsory photos": `{daily_log_id, phase,
  photo_url, caption, received_at}`) is the closest existing shape on record, built for
  a narrower case (morning/evening compulsory photos only); this entry's own
  ad-hoc-menu photos (material received, invoice, site document) need their own storage
  path per table (`hindrances.photo_url`, `invoices.image_url` already exist per
  `docs/schema.md`; `material_received` and a site-document equivalent do not exist at
  all — no schema for either).
- **A retention policy, which has no answer today.** §28(aa)(3) records that the thread
  becomes a financial record with statutory retention once it holds invoices and
  delivery notes. Photos make that concrete — the first thing built with a compliance
  clock attached.
- **The first recurring storage cost per project per month.** §6's own "Compulsory
  photos" entry already named this direction ("this becomes the product's largest
  object-storage consumer") — this entry confirms it as a recurring cost, not a
  one-time build cost.
- **Links need hosting the owner can reach WITHOUT logging in.** A real design
  question, and it interacts with the owner mobile app (§28(cc), "BLOCKED ON DATA, NOT
  ON CLIENT WORK" — "site photos... do not exist anywhere" is named there as one of
  the missing data surfaces the mobile app itself is blocked on; this entry is the
  decision that makes that data surface real).

### g. PRECONDITION, RECORDED 2026-09-03, BEFORE ANY §41 PHOTO-LINK WORK STARTS —
Resend click tracking is enabled on `quoco.co.in` and cannot be disabled from the
dashboard UI (checked directly by Aravind while completing domain verification for
owner-email delivery, same session). **Today this affects nothing** — checked directly
against the two email templates that actually send (`lib/dpr/render-email.ts`,
`lib/dpr/owner-no-report.ts`), full source read, not grepped-and-assumed: neither
contains an `<a href>`, a constructed URL, or any link markup anywhere. Every value
rendered into either template's HTML is `escapeHtml`'d plain content (project name,
engineer name, dates, verdict, body text) — there is nothing in a DPR or no-report
email for a click tracker to rewrite.

**This becomes load-bearing the moment §41 ships a photo link into an email body** —
that's the entry this precondition attaches to, since §41(f) above already names "links
need hosting the owner can reach without logging in" as an open question, and whatever
answers it will be an `<a href>` this same click-tracking layer touches. The concern,
named precisely: a Resend-rewritten link means the recipient's first hop goes through
Resend's own tracking domain before (presumably) redirecting to the real destination —
if that destination is a Supabase Storage SIGNED URL (a `photo_url`-shaped value,
carrying its own signature/expiry in the query string), the request is routed through a
third party before it ever reaches Supabase, regardless of whether the redirect
ultimately preserves the signature correctly. **Not verified either way in this
entry** — whether Resend's rewrite preserves a signed URL's query string intact through
its redirect, whether the redirect exposes the destination URL in a referer header, and
whether disabling tracking per-send (vs. only at the domain level) is possible via the
API even though the dashboard doesn't expose it, are all open questions this entry
raises but does not answer. **Consequence: whoever builds §41's actual link/hosting
answer verifies Resend's click-tracking behavior against a real signed URL BEFORE
shipping it, not after** — this is a precondition on that work, not a today problem;
nothing currently sending is affected.

## 43. Engineer-side correction of a submitted morning check-in: APPEND, never overwrite
— DECIDED, not built (2026-09-03)

**NUMBERED §43, NOT §42 — DELIBERATE, NOT A TYPO.** §42 already names a real, heavily-
used decision in `docs/plans/evening-flow-restructuring-scope.md` (the unmatched-parse-
token capture rule, cited bare as "§42" throughout migration 035's own header and this
project's own recent commits). Adding a SECOND thing called "§42" in a different file
is exactly the collision class CLAUDE.md's own standing rule already warns against
("a label whose meaning was assumed rather than checked against what else uses it") —
checked here before numbering, not after.

**The decision:** once an engineer's morning check-in has been submitted, he can ADD to
it later the same day — a manpower count that grew after submission, for instance. He
can never OVERWRITE what he already said. A PM can still correct/overwrite (Rule 4.3,
migration 019, PR #137) — this decision does not touch that. An engineer only ever adds.

**Motivating scenario:** an engineer answers "12 workers" at 08:35. Four more arrive at
10:00. Today, nothing exists for him to say so — the morning flow is already complete,
and CLAUDE.md's own §28(t) decision keeps that irreversible by design.

**Reasoning:**
- **Not a reversal of the PM-corrects-not-re-types rule.** `design-principles.md` Rule
  4.3, verbatim: *"PM is a data steward, not data entry. The PM corrects and completes
  (fix a parsed trade name, fill a skipped gap) — never re-types the day. Correction UI
  is inline on the daily log card, two clicks max."* Migration 019's edit RPC and PR
  #137's inline correction UI build exactly that. This decision leaves all of it
  standing — a PM still corrects (fixes a wrong value, fills a gap). An engineer never
  gets that power; he only ever ADDS a new fact alongside the original one.
- **The engineer knows first.** He's the one who watched four more workers walk onto
  site at 10:00. Routing that fact through a PM who wasn't there — wait for the PM to
  notice, or for the engineer to separately call/message the PM, who then has to use
  the correction UI on secondhand information — is slower and worse than letting the
  person who observed it say so directly, the same day, close to when it happened.
- **Why overwrite specifically is refused, not just "not built yet":** an
  engineer-writable overwrite would let a day be quietly rewritten to match the plan
  after the fact — the identical risk this project's own DPR containment/audit
  discipline already exists to prevent elsewhere, and the identical concern §28(t)
  raises about late data being unverifiable against what was actually true when
  submitted. `morning_submitted_at` is stamped once, by a real human, at the moment he
  actually answered — overwriting it (or the answer it stamps) erases that. Append
  keeps both facts on the record: planned 12, actual 16 — a real variance, more useful
  to an owner reading the DPR than a silently corrected 16 that hides the plan ever
  changed.
- **No audit question arises from this decision, by construction.** Nothing is ever
  overwritten, so there is nothing to reconcile against a prior value the way an edit
  RPC's own audit trail (`daily_log_edits`, migration 019) has to. A future append
  mechanism may still want its own record of what was added and when — named as an
  open item below, not designed here.

**Does this reverse §28(t) (2026-08-28, "attendance 'No' stays irreversible")? Checked
directly against that entry's own text, not assumed either way.** §28(t)'s literal
words are broader than its own scenario: *"never a reopened engineer-facing window"* —
read bare, that phrase could be stretched to forbid this decision too. **It doesn't,
once §28(t)'s own SCOPE and REASONING are checked, not just its closing sentence:**
- §28(t)'s scenario is REOPENING THE SAME FLOW — restarting Q2-Q4 of a morning check-in
  that already answered "No" and ended. This decision does not reopen any flow; it is a
  structurally separate write path (the ad-hoc menu, once built), never touching the
  original session or its own questions again.
- §28(t)'s own reasoning is about DATE-INTEGRITY and backdating specifically: *"a record
  dated to a day that... was never actually observed in real time... late data...
  answered from memory, hours or days later, un-verifiable against what was actually
  true at the time."* This decision's own motivating scenario is same-day, close to
  real-time (08:35 to 10:00) — the exact failure mode §28(t) names does not apply to it.
- §28(t) is also about a MISSING or WRONG original answer needing to be replaced. This
  decision is about a TRUE original answer (12 workers, correct at 08:35) later becoming
  incomplete as the day continues — not wrong when given, just no longer the whole
  picture.

**Conclusion: this is a NEW decision, narrower in scope than §28(t)'s own literal
wording might suggest, not a reversal of it — but §28(t)'s text should be read
alongside this entry from now on, since "never a reopened engineer-facing window" and
"an engineer can append via a separate channel" sit close enough together that a future
reader comparing the two, without this entry's own reconciliation, could reasonably see
a contradiction where none is intended.** Whoever eventually builds this should re-read
both together, not just this entry alone.

**OPEN, to be decided when this is actually built — recorded as open, not answered
here:**
a. **Where the append lands, schematically.** `daily_logs` is one row per
   `(project_id, engineer_id, log_date)`, upserted on that triple — an append is either
   a JSONB array column on that same row, or a separate table keyed to it (matching this
   project's own existing "log first, structure later" precedent in other tables). Not
   decided.
b. **Discoverable menu item, or free-text inbound.** A dedicated ad-hoc menu row makes
   the capability findable but adds one more thing to explain; "4 more workers came" is
   what an engineer would naturally type unprompted, but free text is harder to parse
   reliably than a structured pick. Not decided.
c. **How the DPR renders two numbers as a variance, not a contradiction.** Planned 12,
   actual 16, both true at different times of the same day — the render logic needs to
   say that plainly rather than read as two conflicting facts about headcount. Not
   designed here.
d. **The cutoff for appending — the question §28(t) would ask if it could.** This
   entry's own reconciliation with §28(t) rests on the motivating scenario being
   same-day and close to real-time (08:35 to 10:00) — exactly where §28(t)'s
   backdating concern doesn't reach. That reconciliation stops holding at some later
   point the same day: at 23:00, after the DPR has already generated (19:45) and
   already been delivered to the owner (20:30), an append at that hour IS backdating
   in every sense §28(t) cares about — AND it changes a record someone has already
   read, which §28(t)'s own scenario never had to contend with (nobody reads a DPR
   before it exists). Candidate anchors to weigh when this is actually built, none
   chosen here: `finalized_at`-style flag, DPR generation time, or reusing the
   existing `eveningClose` cutoff this project's own check-in windows already define.
   **Related, and explicitly a product question, not a schema one:** if a late append
   does land after the DPR already went to the owner, does he get a correction sent,
   or does the change only ever surface in the next day's report? Not decided.
e. **`attendance` itself is a concrete motivating case, not just headcount (added
   2026-09-05).** §39's evening-idle-inbound fix (PR #206) now states plainly, at
   idle-inbound time, that no evening check-in is coming today when
   `attendance = 'site_holiday'` — a firmer, more final-sounding claim than the
   generic replies it replaces. If `attendance` itself was captured wrong that
   morning (the engineer answered too fast, or the parser misread his answer), he
   now gets told definitively that nothing is coming, with no way to say "no,
   actually the site is working today." Before §39, an ambiguous generic reply at
   least left room for doubt; the new one closes it. This is the same shape as the
   headcount scenario above (a true-at-the-time answer that later needs amending,
   same day), not a new kind of problem — named here so `attendance` is in scope
   when this is actually built, not rediscovered as a separate decision later.

**Not built. This entry records the decision and its reasoning only.**
