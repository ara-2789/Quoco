# Design Decisions — Check-in Architecture & Triggers (§27, §28, §30, §31, §38-40)

> Split from `docs/design-decisions-beta-feedback.md` (2026-09-14, docs-rescue/split pass).
> That file is now the INDEX for every section number in the original doc — consult it
> if a citation elsewhere doesn't match a section below. **Section numbers are unchanged
> from the original file; content below is moved verbatim, not re-worded.**

---

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

