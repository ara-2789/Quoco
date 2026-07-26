# Design Decisions — Beta-Customer Feedback

> Product/design decisions and parked items captured from beta-customer feedback
> and schema analysis. **These are DECISIONS and PARKED ITEMS — no implementation
> is authorised by this document.** Nothing here touches migration 007 (auth
> surgery); implementation rides in later migrations/passes as noted per item.
>
> Last updated: 2026-07-09.

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
