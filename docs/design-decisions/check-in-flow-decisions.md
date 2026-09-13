# Design Decisions — Check-in Flow (§1-10, §34, §35, §43)

> Split from `docs/design-decisions-beta-feedback.md` (2026-09-14, docs-rescue/split pass).
> That file is now the INDEX for every section number in the original doc — consult it
> if a citation elsewhere doesn't match a section below. **Section numbers are unchanged
> from the original file; content below is moved verbatim, not re-worded.**

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
