# Design Decisions — DPR Generation & Reporting (§11-24, §37)

> Split from `docs/design-decisions-beta-feedback.md` (2026-09-14, docs-rescue/split pass).
> That file is now the INDEX for every section number in the original doc — consult it
> if a citation elsewhere doesn't match a section below. **Section numbers are unchanged
> from the original file; content below is moved verbatim, not re-worded.**

---

## 11. DPR section 5 decision — narrowed to what's derivable, no 7th question
(decided 2026-08-09; opened as an open question 2026-08-08 while scoping
evening Q4/Q5)

> **SUPERSEDED (2026-09-05 audit, `docs/reviews/design-decisions-audit-
> batch2-2026-09-05.md`).** This section describes the project-level DPR
> pipeline (`mergeDprFacts`/`generateDprJudgment`/`renderDpr`), which
> stopped shipping DPRs on 2026-08-14 when `lib/dpr/dispatch.ts` was
> rewired to the per-engineer pipeline. That pipeline is still exported
> and tested but has no live caller. The decision to defer it, and why, is
> recorded in `docs/dpr-engineer-report-spec.md`'s "Deferred decisions"
> section — not here. What follows is kept for the record; do not build
> against it as current behavior.

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

> **SUPERSEDED (2026-09-05 audit, `docs/reviews/design-decisions-audit-
> batch2-2026-09-05.md`).** Same disposition as §11 above: this describes
> the project-level pipeline's `SuppressionNote`/`ManpowerFacts` rollup
> rule, dead since the 2026-08-14 per-engineer rewire
> (`lib/dpr/dispatch.ts`). Deferral recorded in `docs/dpr-engineer-report-
> spec.md`'s "Deferred decisions" section, not here. Kept for the record.

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

> **SUPERSEDED (2026-09-05 audit, `docs/reviews/design-decisions-audit-
> batch2-2026-09-05.md`).** Same disposition as §11/§12: `assembleAccountability`
> is one of the four functions `lib/dpr/dispatch.ts`'s own header names as
> deliberately left unwired since the 2026-08-14 per-engineer rewire.
> Deferral recorded in `docs/dpr-engineer-report-spec.md`'s "Deferred
> decisions" section, not here. The two prerequisites named below (delivery-
> status observability, block history) remain real, independent gaps
> regardless of which pipeline ships — only the §6 mechanism itself is dead.

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

> **RESOLVED, DIFFERENT PIPELINE (2026-09-05 audit, `docs/reviews/design-
> decisions-audit-batch2-2026-09-05.md`).** The finding below was filed
> against the project-level `assemble.ts` function, dead since the
> 2026-08-14 per-engineer rewire (see §11's note above). Good news, not a
> gap: the live per-engineer path already does this correctly —
> `assembleEngineerDprFacts` calls `equipmentLabel()` directly when building
> each equipment item. Kept for the record; nothing to fix here today.

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

> **MOOT (2026-09-05 audit, `docs/reviews/design-decisions-audit-batch2-
> 2026-09-05.md`).** `evening_productive_manpower` — the column this
> section's `confidence` field lives on — no longer exists. Migration 035
> (2026-08-31) replaced it with `evening_manpower`/`evening_idle_hours`,
> which do not carry an equivalent single confidence field at all. Nothing
> to fix; the question this section raises doesn't apply to the current
> schema. Kept for the record.

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

> **SUPERSEDED (2026-09-05 audit, `docs/reviews/design-decisions-audit-
> batch2-2026-09-05.md`).** Both golden cases measured below
> (`case-complete-two-engineer-day`, `case-manpower-equipment-not-captured`)
> exercise the project-level pipeline, dead since the 2026-08-14
> per-engineer rewire (see §11's note above). No equivalent cost figure for
> the live per-engineer generator exists anywhere in this document — that
> is a real, open gap, not answered by the numbers below. Kept for the
> record; do not cite these figures as current DPR generation cost.

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

