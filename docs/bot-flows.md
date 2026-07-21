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

- 7:30 AM  — morning trigger (quoco_morning_checkin)
- 9:00 AM  — morning nudge if no response (quoco_morning_nudge)
- 6:30 PM  — evening trigger (quoco_evening_checkin)
- 7:30 PM  — evening nudge + PM notification if no response
- 8:00 PM  — DPR generation job queued
- 9:00 PM  — owner delivery job runs
- Every 60s — jobs table polled by /api/jobs/tick

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

Trigger template includes morning-plan summary truncated to 150 chars in {{3}}.

Q1: Work completed today + quantity/area. Format: Activity — quantity done.
    Photo optional. → evening_output + evening_output_quantities.
    If NO morning submission: omit the morning-plan echo (BOT-22).
Q2: Plan met? Yes/No → evening_schedule_met.
    Yes → skip Q3, go to Q4. No → ask Q3.
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
5. Tomorrow's Plan — engineer's stated plan + dependencies
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
- DASH-02 Project creation: name, contract value, start/end dates, owner name,
  owner WhatsApp, owner email. Creates the owner users row + owner_user_id link.
- DASH-03 Daily Logs: morning+evening cards per engineer per day, missing
  highlighted. Ships Week 3.
- DASH-04 DPR Archive: list + full view. Ships Week 4.
- DASH-08 Mobile responsive: no native app in Phase 1.

FAST-FOLLOW (do not build yet): DASH-05 invoice queue, DASH-06 safety log,
DASH-07 hindrance tracker, DASH-10 accountability view + resolve action.

---

## WHATSAPP TEMPLATES (12 total — submit ALL on Week 2 Day 1)

11 Spine + 1 Fast-Follow. Submit all 12 to Meta together — pre-warming costs
nothing and approval takes days. Keep every template Utility-category and
non-promotional. Keep one spare variant of each critical template
pre-approved (a Meta pause on the morning trigger otherwise halts check-ins).

Spine:
1.  quoco_morning_checkin    — {{1}} name, {{2}} project
2.  quoco_evening_checkin    — {{1}} name, {{2}} project, {{3}} morning plan ≤150 chars
3.  quoco_morning_nudge      — {{1}} name, {{2}} project
4.  quoco_evening_nudge      — {{1}} name, {{2}} project
5.  quoco_manager_missed     — {{1}} engineer, {{2}} project
6.  quoco_dpr_ready_pm       — {{1}} project, {{2}} date, {{3}} dashboard link
7.  quoco_dpr_owner          — {{1}} project, {{2}} date, {{3}} 3-line summary
8.  quoco_engineer_optin     — {{1}} name, {{2}} company, {{3}} project
9.  quoco_dpr_silent_day     — {{1}} project, {{2}} PM name
10. quoco_dpr_delayed        — {{1}} project, {{2}} PM name
11. quoco_dpr_pause_expired  — {{1}} project, {{2}} date

Fast-Follow:
12. quoco_safety_alert_pm    — {{1}} project, {{2}} engineer, {{3}} type/location,
                               {{4}} injury status, {{5}} dashboard link

### Sandbox limitation
The Twilio SANDBOX cannot send custom approved templates — session messages
only. So Weeks 2–4 test conversational flows on the sandbox; all template
sends and the cron-trigger (T-CR) suite can only run on the PRODUCTION
sender after Meta approval. Design the trigger so the engineer's first reply
opens the 24-hour session window and Q2–Q6 travel as free-form session
messages (cheaper, no template constraint).
