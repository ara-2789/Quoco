# QUOCO — WhatsApp Bot, DPR & Queue Reference
# Read this when a task touches a bot flow, DPR generation, the jobs queue,
# templates, or engineer/owner registration. Core rules are in CLAUDE.md.

---

## ASYNC QUEUE — NFR-16

- jobs table (Supabase Postgres): type, payload JSONB, attempt_count,
  next_retry_at, status CHECK(pending/running/succeeded/failed).
- Polled by Vercel Cron worker at /api/jobs/tick.
- Max 3 jobs per worker invocation (60s Pro timeout with Claude latency
  of 20–40s per DPR).
- Separate cron entries per job type to avoid head-of-line blocking.
- Exponential backoff on retry.
- Dead-letter (NFR-17): a job that exhausts retries → status='failed',
  Sentry alert. A failed DPR generation → delivery_status='failed',
  9 PM owner send SKIPPED (never empty), PM + founder notified.
- ALL Claude API calls run here. NEVER synchronously in the webhook.

---

## TRIGGER TIMES (fixed for Phase 1 — all IST)

DATED CORRECTION (2026-08-15, MVP SCHEDULE FREEZE, Aravind's decision, final for MVP): the
list below is superseded by `CHECKIN_CHECKPOINTS` in `lib/daily-logs/cutoffs.ts`, the
single source of truth from this date — this doc is a reference copy of that constant, not
the authority; if they ever disagree, `cutoffs.ts` wins and this needs updating, not the
reverse. Current values, restated here for readability only:

- 08:30 — morning trigger (was 7:30 AM)
- 10:00 — morning nudge (was 9:00 AM)
- 10:30 — PM escalation appears on the DASH-01 dashboard, PERSISTENT until submit or the
  morning cutoff (was the 10:00–10:30 AM range below; now a fixed point, not a range)
- 15:00 — MORNING CUTOFF (unchanged)
- 18:30 — evening trigger (unchanged)
- 19:15 — evening nudge (was 7:30 PM)
- 19:45 — DPR generated, evening closes, PM notified — ONE MOMENT, not three
  (was 8:00 PM DPR generation as a separate step from evening close; Rule 7.2 now closes a
  missing evening AT REPORT TIME, not on its own independent clock)
- 20:30 — owner send, AUTOMATIC AND UNCONDITIONAL (was 9:00 PM "owner delivery job runs").
  If the PM does nothing between 19:45 and 20:30, the owner receives the report exactly as
  generated — the window is an opportunity for the PM to edit, never a gate the send waits
  on.
- Every 60s — jobs table polled by /api/jobs/tick (unchanged)

The bullet list immediately below this box is the PRE-2026-08-15 schedule, kept for the
record of what it was before the freeze, not current — per this project's own provenance
discipline (correct in place, don't silently rewrite). Don't build against it.

DATED CORRECTION (2026-08-12): the schedule below previously showed all four
scheduled sends — morning trigger, morning nudge, evening trigger, evening
nudge — as unconditionally template-gated. That was never the actual
decision; recorded now, not silently changed:

- FREE-FORM SEND IS THE PRIMARY PATH; the named template is the FALLBACK,
  used only when the engineer's 24-hour WhatsApp session window is closed
  (no inbound from them in the last 24h). An open window sends the same
  content as an ordinary free-form session message instead — cheaper
  (templates are billed per message; in-window free-form is not) and
  identical in content to the engineer. Applies to all four triggers below,
  not just the Q2–Q6 follow-ups the Sandbox limitation note (bottom of this
  file) already covered.
- Whichever path is used, everything downstream (session creation,
  pending_flows, BOT-21/BOT-26 ordering) is unchanged — this only affects
  HOW the initiating message is sent, never the state machine after it.

- 7:30 AM  — morning trigger. Template quoco_morning_checkin is the
  closed-window fallback.
- 9:00 AM  — morning nudge if no response. Template quoco_morning_nudge is
  the closed-window fallback.
- 10:00–10:30 AM — PM notified of a missing morning submission, on the
  DASH-01 dashboard exceptions surface — NOT a WhatsApp push. See "Morning
  cutoff" below.
- 3:00 PM (15:00) — MORNING CUTOFF. See "Morning cutoff" below.
- 6:30 PM  — evening trigger. Template quoco_evening_checkin is the
  closed-window fallback. Fires REGARDLESS of whether morning was
  submitted — see "Evening trigger no longer waits on morning" below; only
  is_holiday suppresses it.
- 7:30 PM  — evening nudge + PM notification if no response. Template
  quoco_evening_nudge is the closed-window fallback.
- 8:00 PM  — DPR generation job queued
- 9:00 PM  — owner delivery job runs
- Every 60s — jobs table polled by /api/jobs/tick

### Morning cutoff (decided earlier, recorded 2026-08-12)
Frame as a GAP IN THE SPEC, not a new rule: design-principles.md Rule 7.2
already required "nudge → escalate to PM at cutoff" and calls escalation
never skippable — but before this correction the schedule above only ever
escalated in the evening (the 7:30 PM line). Morning had a nudge (9:00 AM)
with no cutoff and no escalation step at all.

- 10:00–10:30 AM: PM notified of a missing morning submission. This is
  Rule 7.2's escalation step for morning, happening on the DASH-01
  dashboard exceptions surface (see PM DASHBOARD section below), not a
  WhatsApp push. quoco_manager_missed (WHATSAPP TEMPLATES #5) is DEFERRED
  for this purpose, not dropped — build the push when DASH-01's exceptions
  surface exists.
- 3:00 PM (15:00): MORNING CUTOFF. An engineer's morning state moves from
  "awaited" to "not submitted"; no further morning nudges are sent for
  that engineer/day; morning accountability firms up at this point. Does
  NOT change DPR content — generation is still 8:00 PM. Rationale (the
  part that matters most): it frees the queue before the evening cycle
  starts at 6:30 PM — left open, morning and evening nudges overlap and an
  engineer is chased for two things at once.

### Evening trigger no longer waits on morning (decided earlier, recorded 2026-08-12)
The evening trigger fires regardless of whether morning was submitted; only
is_holiday suppresses it. The 15:00 morning cutoff above resolves the
ambiguity BOT-20 was protecting against — by evening trigger time, morning
status for the day is already final either way.

COUPLED CHANGE, same decision: BOT-22's existing "a question whose morning
input is missing is not asked" rule now also applies to evening Q2/Q3 when
there is no morning plan — see EVENING CHECK-IN below. Per Rule 3.5, never
ask "was the plan met?" of someone who never gave a plan.

DEFERRED, recorded as open, NOT designed: whether the evening question SET
should narrow further (beyond skipping Q2/Q3) on a day with no morning
submission. Do not build against an assumed answer here.

---

## SESSION RULES (BOT-07)

- 30-minute TTL.
- Same calendar day IST + TTL expired → resume from last unanswered question
  (answers already in context JSONB are retained; do NOT restart from Q1).
- Next calendar day → fresh start regardless of session state.
- State in whatsapp_sessions — NEVER in memory.
- SELECT FOR UPDATE on the session row before any state change.

### Trigger-vs-session collision (BOT-21)
- Previous-day session at trigger time → force-reset, start fresh.
- Same-day ACTIVE session at trigger time → add trigger to pending_flows,
  send the trigger question immediately after the current flow completes.
  The trigger is never lost; the active flow is never destroyed.

### Pending flow ordering (BOT-26)
- pending_flows is an ordered list, stable total order:
  safety=0, scheduled_trigger=1, other=2; FIFO within equal priority.
- Three or more queued items have unambiguous order.

### Edge cases
- Unregistered number → "This number is not registered with Quoco.
  Contact your Project Manager." No session, no DB writes.
- messaging_blocked=true → no sends, no sessions, excluded from nudge logic.
- Safety keyword mid-flow → add safety to pending_flows, finish current flow,
  then process safety (BOT-19).

---

## MORNING CHECK-IN (6 questions, one at a time)

<!-- 2026-07-15 (Pass 2): a cofounder note describing Q3 as "bare activity names"
     referred to the FREE-TEXT plan questions (Q1 plan / Q4 execution), NOT Q3.
     Q3 remains equipment + hire rate per this spec. Terse Tamil/English tolerance
     applies to all four morning questions. -->

Q1: Plan of action today (free text) → morning_plan.
    'Site closed today' quick reply → is_holiday=true, holiday_reason;
    suppresses evening trigger + nudges for this engineer (BOT-20).
Q2: Workers planned by trade. Format: Trade — count.
    → morning_manpower_planned [{trade, planned_count}].
Q3: Equipment on site + hire rate. Format: Equipment — owned/hired — Rs rate/day.
    → morning_equipment [{type, count, owned_or_hired, daily_hire_cost}].
Q4: Execution method/sequence (free text) → morning_execution_plan.
Q5: Procurement dependencies. Capture ALL items first, THEN one follow-up:
    "For each item above, who is responsible? One name for all, or skip
    with 'not sure'." → morning_dependencies [{item, responsible_party}].
    Skip the responsibility prompt if no dependencies listed. (BOT-24)
Q6: Existing site blockers. Same pattern as Q5.
    → morning_hindrances [{description, responsible_party}].

NOTE: Q5/Q6 data is STORED but NOT surfaced in the Spine DPR. It feeds
Fast-Follow accountability when the escalation engine ships.

---

## EVENING CHECK-IN (6 questions, one at a time)

Trigger template (closed-window fallback only, per TRIGGER TIMES above)
includes morning-plan summary truncated to 150 chars in {{3}} — a template
variable limit. The free-form primary path is not length-constrained and
sends the untruncated plan.

Q1: Work completed today + quantity/area. Format: Activity — quantity done.
    Photo optional. → evening_output + evening_output_quantities.
    If NO morning submission: omit the morning-plan echo (BOT-22).
Q2: Plan met? Yes/No → evening_schedule_met.
    Yes → skip Q3, go to Q4. No → ask Q3.
    If NO morning submission: skip Q2 AND Q3 entirely, go straight to Q4 —
    same BOT-22 pattern as Q1's morning-plan echo above (decided 2026-08-12,
    couples with "Evening trigger no longer waits on morning" under TRIGGER
    TIMES). Never ask "was the plan met?" of someone who never gave a plan.
Q3: (conditional, only if Q2=No) Reason plan not met →
    evening_schedule_miss_reason.
Q4: Workers on site + productivity (two sub-steps):
    Step 1 headcount "How many on site today?"
    Step 2 productivity "All productive, or any idle? If idle: how many + why?"
    → evening_workers_on_site + evening_productive_manpower.
Q5: Equipment hours per machine. Bot echoes the morning equipment list by
    name and pre-fills a format per machine. AUTO-SKIPPED entirely if the
    morning equipment list is empty (BOT-22) — store empty utilisation array.
    Photo optional if idle/broken. → evening_equipment_utilisation.
Q6: Tomorrow's dependencies + responsibility. Same pattern as morning Q5/Q6.
    → evening_dependencies [{item, responsible_party, required_by_time}].

---

## ENGINEER & OWNER REGISTRATION (ENG-01 to ENG-07)

- PM creates an engineer from the dashboard: full name + WhatsApp number only.
  No email. users row: auth_id=null, role='engineer', status='pending'.
- quoco_engineer_optin fired immediately. Audit row written (ENG-06:
  registered_by, registered_at, name, phone — the Meta pre-consent record).
- Acceptable opt-in replies: YES, haan, aama, sari, ok, confirm, confirmed,
  thumbs-up emoji, 'yes sir', 'ok bhai'. Two ambiguous replies → PM notified
  of failed opt-in (ENG-05).
- status='active' on confirmation. Only active engineers receive triggers.
- Post-STOP reactivation CANNOT be initiated by Quoco (WhatsApp blocks
  business-initiated messages to a STOP'd number until the USER messages
  first). Runbook: PM asks the engineer to text the Quoco number; on that
  inbound, clear messaging_blocked and re-run opt-in (BOT-27).
  - IMPLEMENTATION STATUS (2026-07-21): the CLEAR-HALF is built — the webhook,
    on an inbound from an engineer gated SOLELY by messaging_blocked
    (status='active' AND messaging_blocked=true), clears the flag and sends a
    within-session TwiML acknowledgement. Idempotent on MessageSid so a Twilio
    retry cannot fall through into the morning flow. Logic split into a pure
    decideInboundGate() + clearMessagingBlock() IO in lib/whatsapp/reactivation.ts.
  - DEFERRED: re-firing the quoco_engineer_optin TEMPLATE is NOT built — it needs
    the outbound sender + Twilio production approval (BLOCKED, CLAUDE.md §10). The
    within-session TwiML ack stands in until then; no business-initiated send occurs.
  - CANONICAL DEFINITION of messaging_blocked (2026-07-21, per BOT-27 review B1) —
    the flag's ONE owner-model, so both consumers (the webhook clear-half and the
    DASH-03 board chip) stop assuming opposite semantics. `messaging_blocked` is
    ENGINEER opt-out / consent state: the engineer set it (a WhatsApp STOP), and
    only the engineer clears it (by messaging in — the clear-half above). It is
    NOT a PM silencing tool. A PM who wants to durably silence or remove someone
    uses status='deactivated' (which the clear-half correctly NEVER lifts —
    see the safety invariant below). Consequently the DASH-03 chip's PM affordance
    is INSTRUCTIONAL only ("ask the engineer to text START to reconnect"), never a
    button that flips the flag — a PM cannot un-opt-out on the engineer's behalf,
    the same way Quoco cannot business-initiate to a STOP'd number.
  - IMPLEMENTED (2b, 2026-07-25): the DASH-03 board renders that instructional
    affordance — a native <details> "How to reactivate" disclosure on a
    messaging_blocked engineer's card (TODAY only, gated on the derived chip
    state), with copy-to-clipboard of the Quoco number and a wa.me "Forward to
    <engineer>" deep link. The copy says "text START," per B2 below. It is
    instructional ONLY: the component holds NO write surface (no supabase client,
    no server action, no fetch), enforced by a static source guard. See
    app/(dashboard)/daily-logs/reactivate-cta.tsx + lib/daily-logs/reactivate-copy.ts,
    and design-decisions-beta-feedback.md §3.2.
  - SAFETY INVARIANT — the clear-half reactivates ONLY an engineer whose sole
    gate is the block (status still 'active'). A non-active status
    (pending / deactivated) stays gated regardless of the flag: a deactivated
    engineer is NEVER silently reactivated by texting in. COUPLING FOR THE SET
    STAGE (STOP-detection, still unbuilt): blocking MUST flip only
    messaging_blocked and leave status='active' — if the SET stage instead set
    status='deactivated', this clear-path would (correctly) refuse to reactivate
    and the flow would dead-end. Read this before building the SET stage.
  - CONSENT-SAFETY COUPLING (2026-07-21, per BOT-27 review B2) — the clear trigger
    is CURRENTLY "any inbound," which is a known interim compliance gap: a doubled
    STOP, or a reply to the opt-out confirmation, would reactivate someone who just
    opted OUT. The SET stage MUST close this:
    (1) STOP-keyword detection runs BEFORE the reactivate branch — an inbound that
        IS a STOP (or opt-out confirmation) must set/keep the block, never clear it.
    (2) Once buildable, the clear trigger becomes an EXPLICIT resume keyword
        (START / RESUME), not "any message" — so an accidental or opt-out message
        cannot reactivate. This is why the DASH-03 / 2b PM copy must say "text
        START to reconnect," NOT "text us to reconnect."
    (3) FUTURE-AUTHOR CHECK (do not resolve now): verify whether Twilio's
        platform-level Advanced Opt-Out would block a STOP'd number UPSTREAM of the
        webhook entirely (the inbound may never reach us). If so, the whole
        keyword-detection design changes — confirm before building the SET stage.
- Owner row created at project creation (DASH-02): role='owner', auth_id=null,
  tenant_id set, from form fields. projects.owner_user_id references it (ENG-07).

---

## E.164 NORMALISATION (NFR-15)

All WhatsApp numbers stored + compared as E.164. Normalise at EVERY entry:
- Dashboard input ('98765 43210' → '+919876543210')
- Twilio inbound (strip 'whatsapp:' from 'whatsapp:+919876543210')
- Template sends
Lookup always against the normalised form. Share one normalise util across
all call sites. (Tests: T-PR-06 — all input shapes normalise identically.)

---

## DPR GENERATION — SPINE (6 sections)

Triggered when ALL active engineers complete evening check-in, OR at 8:00 PM,
whichever first. UPSERT against dprs(project_id, log_date).

> DEPENDENCY — PM CORRECTIONS ARE AUTHORITATIVE (recorded 2026-07-25, migration 019).
> Rule 4.3 inline correction (DASH-03) lets a PM edit daily_logs scalar fields
> after check-in, audit-logged in **daily_log_edits** (the source of truth for
> post-check-in edits). When this generator is built it MUST consult
> daily_log_edits for the (project_id, log_date) being generated and treat a
> corrected column's latest new_value as authoritative over the raw check-in
> value. As of 019 this is unbuilt (no generator exists — the dpr_generate job
> handler still throws "No handler implemented yet"), so 019 ships ONLY the
> audit trail + an explicit hook; do NOT wire correction-surfacing logic until
> the generator itself exists. Distinct from the Fast-Follow `resolutions` table
> (the accountability engine) — different concept, do not conflate.

### Generation claim — prevents concurrent regen race (DPR-23)
Before generating, claim by upserting dprs with:
  generation_status='running', generator_job_id=<this_job>, started_at=now()
WHERE generation_status IN ('idle','pending','stale') AND generator_job_id IS NULL
A job that fails the claim exits silently. Stale claims (>5 min) reset to retry.

### What the job does
1. Aggregate all daily_logs rows for the project on that date.
2. Compute IN CODE (inject as facts into the Claude prompt — do NOT let the
   model do arithmetic):
   - Idle cost per machine = daily_hire_cost × (1 − actual_hours/available_hours)
   - Manpower utilisation % = productive ÷ on_site
3. Call Claude API (verify the current model string against
   platform.claude.com/docs before wiring this — do not hardcode a string
   from memory) with a structured JSON output prompt.
4. Store BOTH structured JSONB and human-readable content TEXT.
5. generation_status='idle' on completion.

### Late data before 9 PM owner send
**DATED SUPERSESSION (2026-08-15, docs/dpr-delivery-versioning-plan.md #67, review
round): the "silent replace, never a new version row" design below is being reversed,
not amended.** The versioning plan proposes a `dpr_versions` history table — every
regeneration writes a new row, `dprs.current_version` advances, nothing is silently
overwritten. This is a real design reversal of the decision recorded here and in
migration 023's own `COMMENT ON TABLE public.dprs` ("UPSERT target for regeneration —
silent replace, never a new version row per bot-flows.md"), not a clarification of it —
023's comment quotes THIS section as its authority, so both must be corrected together
in whichever migration ships the history table, not just one of the two. **Not yet
shipped** — #67 is plan-only as of this note; the text immediately below still describes
what is actually live today, and stays accurate until that migration applies.

Regenerate via UPSERT. Silent replace. last_regenerated_at updated.
No PM notification unless already paused.

### Zero-data day (DPR-17)
No engineer submitted anything → delivery_status='skipped_no_data';
quoco_dpr_silent_day sent to owner; PM notified. NEVER send an empty DPR.

### Owner-send hold (DPR-24)
9 PM delivery holds if generation_status='running' OR an unprocessed job for
that DPR exists in jobs (status IN ('pending','running')). Hold up to 5 min;
if still blocked at 9:05 PM, send committed content + log a Sentry anomaly.
(A just-queued regen is still 'pending' — the hold must catch that too.)

### Failed delivery
Generation exhausts retries → delivery_status='failed';
quoco_dpr_delayed to owner; Sentry alert; PM + founder notified;
owner NEVER receives empty content.

### The 6 Spine DPR sections
1. Execution Output — what was done, with quantities
2. Schedule vs Plan — planned vs actual, variance
3. Manpower Utilisation — headcount, productivity %, idle reasons
4. Equipment Utilisation — hours per machine, utilisation %, idle cost Rs
5. Tomorrow's Plan — Q6's dependencies (once Q6 ships) + qualitative
   carry-forward of the plan-not-met reason from evening Q2/Q3. NO derived
   quantity, no inferred intent — no evening question captures a planned
   quantity for tomorrow, and morning Q1 is free text, never quantity-parsed,
   so a numeric "planned vs done vs outstanding" figure is not computable from
   real data. e.g. "Slab pour incomplete — JCB breakdown, vendor callout
   pending." Emits "not captured" until Q6 ships. Decision + full reasoning:
   design-decisions-beta-feedback.md §11.
6. Accountability — MISSING SUBMISSIONS ONLY:
   - Engineer name + morning/evening status + 7-day pattern.
   - Pattern EXCLUDES holiday days (is_holiday=true) AND messaging_blocked
     days from BOTH numerator and denominator (never shame a blocked/leave
     engineer).
   - Factual wording: "Rajesh — evening not submitted today (missed 3 of
     last 5 site-operating days)."
   - ⚠️ CROSS-DATE CONSTRAINT (per DASH-03, 2026-07-18) — READ BEFORE BUILDING
     THIS. `messaging_blocked` is a CURRENT user-state flag, NOT a per-day
     fact: there is no record of when a number was blocked/unblocked. The
     accountability engine MUST NOT feed present-time `messaging_blocked` into
     any HISTORICAL (multi-day) accountability math — doing so would
     retroactively excuse gaps on days the engineer may well have been
     reachable. Any cross-date `messaging_blocked` read is a BUG until a
     block-history mechanism exists (e.g. a `messaging_block_events` audit
     trail, or a per-day flag stamped onto `daily_logs`). CONTRAST: `is_holiday`
     IS safe to use historically because it is stored ON the `daily_logs` row (a
     per-day fact). This constraint currently lives only as a code gate in
     `lib/daily-logs/status.ts` (the DASH-03 board applies `messaging_blocked`
     to TODAY only) — see it and `design-decisions-beta-feedback.md` §3.1 first.

Sections Hindrances / Dependencies / Red Flags / Recommendations are
FAST-FOLLOW — they ship with the accountability engine, not the Spine.

### DPR eval harness — REQUIRED deliverable (not optional)
15–20 golden input sets with assertion files, run in CI on every prompt
change. Assert on the structured JSON, never on prose. Minimum cases:
complete 2-engineer day; evening missing for one engineer; idle-equipment
arithmetic; vernacular answers; contradictory numbers flagged not averaged;
zero-data day; morning-missing/evening-present; two engineers finishing
seconds apart (claim race). DPR work is not "done" until these pass.

---

## PM DASHBOARD — SPINE

- DASH-01 Home: welcome + project list + Create Project.
  DATED NOTE (2026-08-12): gains an EXCEPTIONS section — tightly scoped,
  section only — to surface the 10:00–10:30 AM missing-morning PM
  notification from TRIGGER TIMES above. Must include design-principles.md
  Rule 4.1's required "if everything is fine, say so in one line" for the
  empty/all-clear state. NOT STARTED; gated behind the checkin_escalations
  migration (§0 external-review gate — new table, RLS from day one).
- DASH-02 Project creation: name, contract value, start/end dates, owner name,
  owner WhatsApp, owner email. Creates the owner users row + owner_user_id link.
- DASH-03 Daily Logs: morning+evening cards per engineer per day, missing
  highlighted. Ships Week 3.
- DASH-04 DPR Archive: list + full view. Ships Week 4.
- DASH-08 Mobile responsive: no native app in Phase 1.

FAST-FOLLOW (do not build yet): DASH-05 invoice queue, DASH-06 safety log,
DASH-07 hindrance tracker, DASH-10 accountability view + resolve action.

---

## WHATSAPP TEMPLATES (13 total — submit ALL on Week 2 Day 1)

DATED NOTE (2026-08-20, template design v2 — Y-round): copy is now ENGLISH-ONLY, no
bilingual (English+Tamil) template pairs — input accepts any language, output stays
simple English (`docs/design-principles.md` Rule 3.11, revised same pass). A bilingual
template set was drafted under an earlier, now-cancelled plan; it is NOT being submitted
to Meta, per that cancellation. Full copy deck: `claude/whatsapp-templates-en-ta.md`
(the filename predates the English-only decision; the content is English-only — flagged
there, not renamed here, to avoid a second divergence between a filename and what's
inside it).

DATED CORRECTION (2026-08-20, AA1, same day as the note above): that note originally
flagged a 13-vs-12 count discrepancy as unresolved, having grepped this repo for the
missing 13th template's origin and found nothing. **Correction: the 13th template is
real, not phantom — `quoco_login_otp`.** It originates in `auth-and-session-decisions.md`,
which lives in the claude.ai PROJECT, not this repo — a document this repo's own grep
could never find regardless of how thoroughly run, because it was never here. Recorded as
a standing boundary, not just fixed in place: design decisions and session records live in
the claude.ai project; code and this repo (including `bot-flows.md` itself) live in the
repo. A grep across the repo answers "does it exist in the repo," never "does it exist at
all" — when a referenced artifact isn't found here, the honest report is "not found in
repo, may be project-side," not "does not exist." The count is 13, correctly, from here on.

11 Spine + 1 Fast-Follow + 1 Authentication. Submit all 13 to Meta together —
pre-warming costs nothing and approval takes days. Keep every non-Authentication
template Utility-category and non-promotional. Keep one spare variant of each
critical template pre-approved (a Meta pause on the morning trigger otherwise
halts check-ins).

DATED NOTE (2026-08-12): templates #1–4 below (quoco_morning_checkin,
quoco_evening_checkin, quoco_morning_nudge, quoco_evening_nudge) are the
CLOSED-WINDOW FALLBACK for their trigger, not the primary send — see
TRIGGER TIMES above. Still submit and pre-approve all four; the fallback
path is the reason a Meta pause on any one of them halts check-ins (an
engineer with a closed 24h window has no other way to receive it).

DATED SUPERSESSION (2026-08-20): template 7 below, `quoco_dpr_owner`, sent a 3-line
report summary directly to the OWNER over WhatsApp. Per the #67 decision (owner receives
the DPR by email, not WhatsApp — `docs/dpr-delivery-versioning-plan.md`), that content no
longer goes by WhatsApp at all. Replaced by `quoco_dpr_owner_email_sent` — a PM-facing
confirmation that the email send happened, {{1}} project, {{2}} date only, no summary
variable. Full copy: `claude/whatsapp-templates-en-ta.md` template 7.

DATED NOTE (2026-08-20): templates 6 and 12 now take a CTA URL button for their
dashboard/details link instead of a body-variable link — drop the old {{3}}/{{5}} link
variables from both when re-submitting; the button component carries the URL instead.
Template 6's copy states an 8:30 PM deadline — VERIFIED against `CHECKIN_CHECKPOINTS`
(`lib/daily-logs/cutoffs.ts`), not assumed: 8:30 PM (`ownerSend`) is correct there
specifically as the PM's edit-window deadline, NOT as when the report becomes ready
(that's 7:45 PM, `eveningClose`) — see `claude/whatsapp-templates-en-ta.md` template 6
for the full check, since conflating the two would have been a wrong-copy re-approval
cost.

Spine:
1.  quoco_morning_checkin       — {{1}} name, {{2}} project
2.  quoco_evening_checkin       — {{1}} name, {{2}} project, {{3}} morning plan ≤150 chars
3.  quoco_morning_nudge         — {{1}} name, {{2}} project
4.  quoco_evening_nudge         — {{1}} name, {{2}} project
5.  quoco_manager_missed        — {{1}} engineer, {{2}} project
6.  quoco_dpr_ready_pm          — {{1}} project, {{2}} date, CTA URL button (was {{3}} link)
7.  quoco_dpr_owner_email_sent  — {{1}} project, {{2}} date (SUPERSEDES quoco_dpr_owner —
                                  see the dated supersession note above)
8.  quoco_engineer_optin        — {{1}} name, {{2}} company, {{3}} project — now carries
                                  "reply in any language" + "reply STOP" (see
                                  CLAUDE.md's BOT-27 entry: the STOP promise is not yet
                                  kept by the code — named pre-launch blocker)
9.  quoco_dpr_silent_day        — {{1}} project, {{2}} PM name
10. quoco_dpr_delayed           — {{1}} project, {{2}} PM name
11. quoco_dpr_pause_expired     — {{1}} project, {{2}} date

Fast-Follow:
12. quoco_safety_alert_pm       — {{1}} project, {{2}} engineer, {{3}} type/location,
                                  {{4}} injury status, CTA URL button (was {{5}} link)

Authentication:
13. quoco_login_otp             — {{1}} numeric code. AUTHENTICATION category (Meta's own
                                  template class, distinct from Utility) — origin:
                                  `auth-and-session-decisions.md`, claude.ai project, not
                                  this repo (AA1). Category-specific rules, not the
                                  Utility rules above:
                                    * Purely functional wording — no branding flourish, no
                                      greeting, nothing beyond stating the code and its
                                      purpose.
                                    * A mandatory validity line ("This code expires in N
                                      minutes") — Meta requires this for Authentication
                                      category approval; a Utility-style template with no
                                      expiry statement will not pass review under this
                                      category.
                                    * The code itself is a BARE numeric variable — no
                                      surrounding words inside {{1}}, no formatting
                                      (dashes, spaces) baked into the variable, so the
                                      WhatsApp client's own tap-to-copy behavior works.
                                    * Charged on EVERY delivery, including when the
                                      recipient's 24-hour session window is already open —
                                      Authentication-category templates do not get the
                                      free-in-window exception Utility templates do (see
                                      the Sandbox limitation note below for that
                                      exception's own scope). Budget accordingly; this is
                                      not a "submit and forget" template the way #1-4's
                                      closed-window fallback is.

### Sandbox limitation
The Twilio SANDBOX cannot send custom approved templates — session messages
only. So Weeks 2–4 test conversational flows on the sandbox; all template
sends and the cron-trigger (T-CR) suite can only run on the PRODUCTION
sender after Meta approval. Design the trigger so the engineer's first reply
opens the 24-hour session window and Q2–Q6 travel as free-form session
messages (cheaper, no template constraint).
