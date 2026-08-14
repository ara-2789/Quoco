# DPR — engineer report format spec (decided 2026-08-13)

Supersedes the section-per-topic DPR layout that produced the 2026-08-13 report. Written
after the first unattended generation rendered `"No equipment reported this morning"` on a
day when equipment *was* reported — a confident false statement in a customer-facing
document.

## Scope

One report **per site engineer, per day**. Straight from that engineer's check-ins. No
human in the middle, no aggregation across engineers.

The project-level report, PM reconciliation and cross-engineer aggregation are a **separate
document, deferred** — see "Deferred decisions" at the end.

## The format

**Morning-only day (real data, 2026-08-13):**

```
DAILY PROGRESS — Sitename — Thu 13 Aug
Site engineer: Ravi Kumar

Morning check-in: complete
Evening check-in: not received

No evening check-in, so we do not know what was done today.

Work — planned: "Excavation of 1000 sq m earth" | done: not reported
Manpower — planned: 2 helpers | on site: not reported
Equipment — planned: job, ₹15/day | used: not reported
Schedule — not reported

MISSING
Evening check-in not received.

NOT ASKED YET
Tomorrow's plan.
```

**Complete day:**

```
DAILY PROGRESS — Sitename — Thu 13 Aug
Site engineer: Ravi Kumar

Morning check-in: complete
Evening check-in: complete

850 of 1000 sq m done. 3 workers were idle waiting for material.

Work — planned: "Excavation of 1000 sq m earth" | done: "excavation done" — 850 sq m
Manpower — planned: 2 helpers | on site: 18, working: 15
Equipment — planned: JCB | used: 6 hours
Schedule — not met

NEEDS ATTENTION
3 workers idle, waiting for material.
JCB idle for 2 hours.
```

## The rules behind it

### 1. Missing-ness is structural, not conditional

Every body line has two slots — what was planned, what came back. A missing half is visible
by construction. **This is the fix for the 13 Aug falsehood**: the bug existed because each
section decided at render time whether it had anything to say, and with evening null it
chose to assert absence. A template with two always-present slots has no branch that can
lie.

### 2. The model writes exactly one sentence

The verdict line under the check-in status is the model's entire output. Every body line,
every number, the check-in statuses, MISSING and NEEDS ATTENTION are rendered from
code-owned Facts with no model involvement. Containment applies to the verdict sentence
only; the body cannot hallucinate because the model never writes it.

### 2b. Free text is rendered VERBATIM, never cleaned

Rule 2 says the model writes only the verdict sentence. It follows that no other line may
be paraphrased — and that includes paraphrasing in code. Re-casing, trimming "of" and
"earth", reordering words or "tidying" an answer is still putting words in the engineer's
mouth, and doing it in code is worse than doing it in the model because it is silent and
nobody reviews it.

Free-text fields (`morning_plan`, `evening_output`) render exactly as stored, in quotes so
the reader can see they are the engineer's own words. Structured numbers
(`evening_output_quantities`, manpower counts, hours) render as numbers alongside.

This also satisfies Rule 3.4's echo-back instinct: the report shows the engineer what the
system recorded him as saying.

**Note on the samples in this spec:** earlier drafts prettified them — "excavation 1000 sq
m" for a stored `"Excavation of 1000 sq m earth"`, and "JCB 8 hours" for a field that does
not exist. Both were caught in review. Every sample here now renders real stored values
verbatim. If a future sample looks nicer than the data, the sample is wrong.

### 3. Plain language

Readers are Indian site engineers, PMs and owners, many reading English as a second
language. Every word in the body is a common one: planned, done, on site, working, used,
not met, not reported.

`"not reported"` replaces `"not captured"` — plainer, and more accurate: nobody reported it.

### 4. Length does not grow with the day

The body is four lines whatever happened. Detail moves to NEEDS ATTENTION, which lists
exceptions only. A clean day says so in one line (Rule 4.1).

### 5. MISSING and NEEDS ATTENTION are different things

- **NEEDS ATTENTION** — what went wrong on site. The customer's problem.
- **MISSING** — what we failed to collect. Our problem.

An owner needs to know which he is looking at. They never share a heading.

### 6. Naming the engineer is attribution, not characterization

`Site engineer:` in the header stays on the right side of Rule 5.3. The report states what
was not collected; it never says anything about the person. Because the name is in the
header, MISSING does not repeat it.

### 7. Check-in status vocabulary

`complete` / `partial` / `not received` / `not applicable`.

**complete** — every question that was actually asked got an answer.
**partial** — some did.
**not received** — none did, and the engineer owed that half.
**not applicable** — the engineer did not owe that half at all.

Questions the bot deliberately skipped (e.g. Q5 equipment when no morning equipment
exists) must not count against completeness.

`not applicable` is evaluated **per half, independently**. Real data always wins: if a half
has any answer, it is never not-applicable regardless of timing. It applies when the
engineer's `project_members` membership began **after that half's SEND time** on
`log_date` — 07:30 for morning, 18:30 for evening.

**The threshold is the send time, not the cutoff.** The question being asked is "was this
person on the roster when the question went out." An engineer who joins at 11:00 never
received the morning question; testing against the 15:00 morning cutoff would wrongly
class them as owing it. Take both constants from `CHECKIN_CHECKPOINTS` in
`lib/daily-logs/cutoffs.ts` — never hardcode, and note the morning cutoff there was stale
at 10:30 until PR #59.

**CONDITIONAL ON THE TRIGGER CRONS SHIPPING — not presently mechanical (added
2026-08-14, review finding).** "Send time" describes a proactive push that does not exist
yet: no cron or trigger sends the morning or evening prompt today (CLAUDE.md §10 — the
evening flow specifically, and by the same absence the morning flow, has no code path
that starts it in production; an engineer self-initiates by messaging in). Under this
pull model, a membership beginning at 11:00 does **not** mean the engineer could not have
checked in before the actual close boundary (15:00 morning / 20:00 evening) — they could
have messaged in themselves. The rule above is still correct on Rule 5.3 grounds (never
let an explained absence read as unexplained) and should ship as written, but it is
recording an intent for when the send crons exist, not describing today's actual
mechanism. Whoever builds those crons should re-examine whether `not_applicable`'s
threshold should move from send-time to close-time once the push model is real.

**Two mechanics, pinned so they aren't rediscovered as bugs:**
- The `project_members.created_at` vs. `CHECKIN_CHECKPOINTS.morningSend`/`.eveningSend`
  comparison **must convert to IST before comparing**, the same conversion every other
  cutoff/send-time comparison in this codebase already does (`lib/daily-logs/status.ts`'s
  `istParts`). `created_at` is stored as `TIMESTAMPTZ` (UTC internally); comparing its raw
  UTC clock value against an IST wall-clock string is wrong for every join between 02:00
  and 07:30 UTC (07:30–13:00 IST) — it would misclassify a chunk of ordinary daytime joins.
- A membership that is removed and later re-added gets a **fresh `created_at`** on the new
  `project_members` row — there is no history table, so an engineer's earlier, prior
  membership window is not recoverable. **Policy: use the current row's `created_at`.** A
  returning engineer's earlier window is treated as if it never happened for this purpose
  — a known, named limitation, not a silent gap, and not fixable without new
  infrastructure this work does not build.

A `not applicable` half does not count toward MISSING and does not lower completeness. It
renders in plain language with its reason:

```
Morning check-in: not applicable — joined this project today
```

**Symmetric case, added 2026-08-14 (review round 3, reviewer's own finding): an engineer
who submitted real data earlier in the day and then left the project (deactivated, or
removed from `project_members`) before a later half's send time is `not_applicable` for
that later half too — not `not_received`.** Detected from the same eligible-set union
already required elsewhere in this design (active roster ∪ engineers with a `daily_logs`
row for `log_date`, per Rule 7's own real-data-wins principle): an engineer present in the
union by virtue of real data, but absent from the active-roster half of it, has left. No
new field or timestamp needed — this falls out of the union check already being done.
Reuses the existing status value and mechanism, a different reason string only:

```
Evening check-in: not applicable — left this project during the day
```

Rendering a departed engineer's un-owed half as `not received` would be Rule-5.3 shading
— language aimed at someone no longer there to have owed it. `not applicable` already
exists for exactly this shape (a half genuinely not owed); this is its mirror case
(membership ending early), not a new concept.

A day where both halves are not-applicable skips the model call entirely, exactly as a
holiday day does. A half-and-half day still calls the model, because one side has real
data.

### 8. WhatsApp is the delivery surface

Hence the inline `|` form rather than aligned columns, which collapse on mobile. A PDF
renderer with a proper table would be a second renderer off the same Facts, not a change
to this one.

## Where each side of each pair comes from — binding

The `planned` side must come from the question that owns that topic. Never from a
substring of another answer's free text, however much better it reads.

| Line | planned source | actual source |
|---|---|---|
| Work | `morning_plan` | `evening_output`, `evening_output_quantities` |
| Manpower | `morning_manpower_planned` | `evening_workers_on_site`, `evening_productive_manpower` |
| Equipment | `morning_equipment` | `evening_equipment_utilisation` |
| Schedule | — (no planned side) | `evening_schedule_met` |

`morning_execution_plan` is free text and is **not** a source for any structured pair.
Pulling equipment hours out of it would make the label lie about where the number came
from — the whole point of the pair is that each side traces to the question that asked it.

Render bad structured data honestly. On 2026-08-13 the equipment planned side is
`job, ₹15/day` — garbled, because "JCB 1500" was autocorrected to "Job 15oo". That is what
the engineer's answer parsed to, and showing it is how the defect becomes visible. Hiding
it behind nicer-looking free text would be the worse failure.

## Known data gap: planned equipment HOURS are not captured

`EquipmentItem` is `{type, count, owned_or_hired, daily_hire_cost, raw}`. **There is no
hours field.** The morning check-in asks what equipment is on site and what it costs; it
never asks how many hours it is planned to run. The "8 hours" in the original sample came
from `morning_execution_plan` free text, which is not a structured source.

Consequence, and it is not small: **the idle-hours calculation has no planned side.**
Evening captures hours used. Nothing captures hours planned. So
`planned hours − used hours = idle hours`, the figure the entire "nobody prices the wait"
argument rests on, cannot be computed today.

This is a check-in flow gap, not a report gap. **Deferred, recorded here.** Fixing it means
adding a planned-hours question to the morning equipment flow and a field to
`EquipmentItem` — do not attempt it as part of the report work.

Until then, the Equipment line shows what exists: equipment planned, hours used. The gap
between them stays empty and is honestly labelled as such.

## Known upstream defect this does NOT fix

`lib/dpr/assemble.ts:217-240` builds equipment facts by iterating
`evening_equipment_utilisation`, using `morning_equipment` only as a side lookup keyed by
`morning_item_index` to backfill `daily_hire_cost`. **Morning equipment never enters the
Facts corpus on its own.** The new format requires morning data as a first-class input, so
the assembler must change, not just the renderer. Audit every section for the same shape,
not just equipment — `EXECUTION OUTPUT` has it too.

---

# Deferred decisions — project report and reconciliation

Recorded 2026-08-13. **Not being built now.** Beta is single-engineer per project, where
none of this arises.

## Two documents, not one

- **Engineer report** — above. Per engineer, from check-ins, no human step.
- **Project report** — per site, resources reconciled across engineers, finalised by the
  PM in the dashboard. This is the owner's real report.

Open: does the owner receive per-engineer reports at all, or only the project report? On a
three-engineer site, three WhatsApp reports at 8pm is a lot. Instinct: engineer reports go
to the PM only.

## PM finalisation must not gate owner delivery

The product promise is a report every night without chasing anyone. If delivery waits on a
PM clicking approve, that promise fails the first evening he is at a site visit — silently,
which is worse.

**Design:** the owner's report goes at 20:00 regardless, carrying its own state (e.g. "Not
yet reviewed by PM" on the lines that matter). PM finalisation before 20:00 sends as final;
after 20:00 sends a marked revision showing what changed. `daily_log_edits` and
`last_regenerated_at` already exist for this.

## Never sum across engineers until the PM says the numbers combine

Two engineers each reporting 18 workers might be 36 people or the same 18 counted twice.
The system cannot know and must not decide.

- Before reconciliation: show the breakdown, never a total —
  `Manpower: Ravi 18, Suresh 12 — not yet combined`.
- After: show the PM's figure with the parts still visible underneath.

At no point does a number appear that nobody stands behind. This is the never-guess rule
applied at the aggregation layer.

Open: is additivity a standing per-project, per-metric setting the PM makes once, or a
daily decision? **Recommendation: standing default set at project setup, overridable on any
given day.** Asking the same question every evening is the friction that gets a dashboard
abandoned.

## Equipment: the metric is HOURS, not machine count

Hours is the metric because hours converts to money. Eight hours hired against six used is
the idle cost — the whole "nobody prices the wait" argument rests on that gap.

**Day-rate consequence:** `daily_hire_cost` means plant is billed by the day. Idle hours do
not reduce what you pay — they waste a fixed cost already committed. The honest framing is
the fraction of a paid day that went unused, which is stronger and more concrete than "the
machine was idle."

*To confirm with customers:* is day-rate right for how they actually hire plant? If some is
hourly with a minimum, the arithmetic differs — and that is a Fact, not a rendering choice.

**Correction on the record:** the multi-engineer equipment problem was first framed here as
double-counting machines. With hours it is harder, not easier — two engineers reporting the
same JCB give four and three hours, which may be seven hours of work or three hours of
double-reporting, and there is no way to tell. Worse, no way to detect it: equipment is
free text per message with **no machine identity to join on across engineers**. Reconciling
equipment hours across engineers has nothing to key on today.

---

# Context: how the current format failed on real data (2026-08-13)

First unattended DPR generation. Pipeline worked — 33 seconds, zero retries, no crash on a
fully-null evening half. `dprs.id af7760e8-2457-4c11-bc35-52929a0bbf54`.

Rendered content, verbatim:

```
EXECUTION OUTPUT
No execution activities were reported for this project day.

SCHEDULE VS PLAN
  Plan met: not captured

MANPOWER UTILISATION
  Not captured today.

EQUIPMENT UTILISATION
  No equipment reported this morning.

WHAT THIS REPORT DOES NOT KNOW
  - Tomorrow's Plan: not yet asked in this version of the check-in.

ACCOUNTABILITY
  - TEST — Evening Q5 Smoke 2026-08-10 (scenario 1: labelled reply) — no evening check-in
```

Three findings:

1. **"No equipment reported this morning" is false.** A JCB was reported;
   `morning_equipment.items` holds it. The section renders from the evening column only.
   Worse than a wrong number — the generator asserts a negative it cannot support, because
   it cannot tell "nothing was reported" from "nobody was asked."
2. **The DPR is architecturally evening-gated.** Morning captured a plan, planned manpower,
   equipment and an execution plan. None of it appears. On any day the evening is missed,
   the owner receives a document with no informational value.
3. **A test engineer's label rendered into an owner-facing report** — `users.full_name` for
   engineer `3534756b`, still carrying a 2026-08-10 smoke-test label, `status: 'active'` in
   prod. Nothing separates test users from real ones.

Also: `delivery_status: pending`, `delivered_owner_at: null`. The report generated and could
not be delivered — no outbound send capability exists anywhere in the system. Outbound
blocks evening check-in start, the nudge, PM escalation, **and delivery of the DPR itself**.
