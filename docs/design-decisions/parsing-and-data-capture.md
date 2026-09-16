# Design Decisions — Parsing & Data Capture (§6, §32, §33)

> Split from `docs/design-decisions-beta-feedback.md` (2026-09-14, docs-rescue/split pass).
> That file is now the INDEX for every section number in the original doc — consult it
> if a citation elsewhere doesn't match a section below. **Section numbers are unchanged
> from the original file; content below is moved verbatim, not re-worded.**

---

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
  received_at}`), **Supabase Storage only, never Twilio URLs**. ~~The flow
  **will not stamp `submitted_at` without the photo** (keeps asking)~~, but the
  **cutoff cron still finalizes** photo-less check-ins as **"finalized, photo
  missing"** — the gap surfaces on the PM dashboard and weekly review.
  **Compliance through visibility, not hard blocks.** Storage-cost note: this
  becomes the product's **largest object-storage consumer.**

  **DATED CORRECTION (2026-09-13) — deliberate reversal, not a refinement.**
  Photos are now **optional**: the question offers a "none" reply. Reason:
  blocking a check-in over a missing photo costs the whole day's data to
  enforce one field, and engineers on poor signal would be stuck. The
  struck-through sentence above is kept, not rewritten, per this project's
  own correction discipline — the "keeps asking" behaviour it described is
  no longer how the flow works.
  Because "photo missing" is now a valid answer rather than a compliance
  gap, the **"none" reply must be stored explicitly** so the PM dashboard can
  distinguish "engineer reported no photos" from a blank that reads as a
  system failure.

- **Explicitly NOT adding:**
  - percent-complete self-assessments (unreliable);
  - any new daily questions beyond the six (flow-burden ceiling).

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

### h. BUILT 2026-09-04 — production incident, not the planned trigger. ADDENDUM.

This shipped as an emergency fix, not on the sequencing this section left
open at (f). Two real DPR emails (2026-09-03, 2026-09-04) contained
fabricated equipment rates the parser had miscaptured as counts — exactly
the defect (a) names — because nothing in this section's OWN decision had
been built yet when those two check-ins ran. Full incident: the production
report Aravind gave 2026-09-04 comparing WhatsApp screenshots against sent
DPR content.

Built: (a) parser count-not-rate (`lib/whatsapp/flows/parsers/equipment.ts`,
`lib/whatsapp/flows/morning.ts`), (c)/(e) idle cost removed from both DPR
renderers and never computed (`lib/dpr/render.ts`, `lib/dpr/generate.ts`,
`lib/dpr/assemble.ts` — both the live per-engineer path and the unused
project-level path, same defect class, same fix). (f)'s stated blocker —
"the write path is the morning RPC, so this needs a migration" — did NOT
hold: `030_morning_flow_attendance.sql:334` documents `p_equipment` as
"stored verbatim," and `morning_equipment` is bare, unconstrained JSONB
(migration 001) with no CHECK on its internal shape anywhere in the
migration history. No migration was needed; this shipped as a pure
TypeScript change. (d) (the rate formula for the invoice era) remains
unbuilt, as designed.

**A confidence gate existed and did not hold — but not the one first
suspected.** `isHireRateTrusted` (the deferred project-level assembler,
`mergeDprFacts`) was checked and found to be dead code — no call site
outside tests and two scripts touches `renderDpr`/`mergeDprFacts` at all.
The function that actually produced the two fabricated values,
`mergeEngineerDprFacts` (the live per-engineer assembler), has **no trust
gate by explicit design** — its own comment: *"No isHireRateTrusted
option, unlike the old assembler — deliberate, not an oversight. The
spec's own instruction... means daily_hire_cost is always shown as-is
here, garbled or not."* That instruction, from
`docs/dpr-engineer-report-spec.md`, was written for a context where a
human would see the garbled output and notice the defect. It shipped
unmodified into a path with no human checkpoint before an owner's inbox.

**The lesson, stated precisely**: "render bad data honestly so the defect
is visible" is a debugging-context design principle. Applied to a
customer-facing artifact with no review gate, "visible" only ever meant
"visible to the customer" — the defect became visible to Aravind by
accident, from a screenshot comparison, two days after two real owners
had already read it. A design principle written for one audience does not
automatically carry over when the same code path's actual audience
changes.

