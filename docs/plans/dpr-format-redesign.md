# DPR format redesign (2026-09-11)

Design doc, approved before code. Written after recon against
`origin/main` (`6f468a1`, PR #250 merged — the "Dependency" label and the
`public.hindrances` join are live and unchanged by this document).

**Status: DESIGN APPROVED (2026-09-11) — Stage 1 in progress.** All six
open decisions below are answered by Aravind. Covers all nine settled
decisions, the field-by-field implementation surface, staging, and the
(now-closed) open items.

---

## Governing principle

The DPR is a faithful record of what was reported. The record comes first;
interpretation comes last and is clearly secondary. Every section below is
checked against this before anything else.

## Target format

```
Good evening.
Daily Progress Report — [Site Name], [Date]

Site Engineer: [Name]
Project Manager: [Name]

Check-in: Morning [status] · Evening [status]

The sections below are as reported from site.

WORK
Morning plan: [as reported, spelling-corrected]
Work completed: [as reported, spelling-corrected]

RESOURCE
Labour reported — morning:
Labour reported — evening:
Idle hours:

MACHINE
Machines reported:
Run hours:

HINDRANCE          [live, unchanged]
DEPENDENCY         [live, unchanged]

SUMMARY (auto-generated)
```

---

## 1. Text correction — spelling only, not grammar

**Decision, restated precisely:** fix misspelled words; do not restructure
sentences, fix grammar, or rephrase for readability. `"cemant lorry not
arived"` → `"cement lorry not arrived"`. `"Cement lorry not arrived, slab
pour stopped"` stays byte-identical. This is a **dated, deliberate partial
reversal of spec Rule 2b** (free text rendered verbatim, never paraphrased),
narrowed specifically to spelling — Rule 2b's rephrasing prohibition still
holds in full.

**Current state, verified:** no correction pipeline exists anywhere today.
`renderEngineerBody()` (`lib/dpr/render.ts:604-753`) calls `fmtText()` on
`facts.work.planned` / `facts.work.done_text` and renders them exactly as
captured. The only model call in this pipeline is `generateEngineerVerdict`
(`lib/dpr/generate.ts:467`), which writes the one-sentence summary — it does
not touch, and structurally cannot touch, the WORK section's own text
(render.ts composes that section without ever passing it through the
model). Building spelling correction is new work, not a variant of
something that exists.

**Original text retained for comparison — yes, by construction, not as new
work.** `EngineerDprFacts.work.planned` / `.done_text` are `CapturedText`
already (`lib/dpr/schema.ts`) — the raw value as the engineer typed it. The
correction step must produce a **new, separate field** (`planned_corrected`
/ `done_text_corrected`, exact names TBD at implementation) rather than
overwrite the existing one. The raw value stays on the fact object
unconditionally — nothing about this feature removes it — so a side-by-side
audit is always possible from the stored row, even though only the
corrected text renders in the body.

**How the prompt is constrained against drifting into rephrasing —
proposed, not yet built:**

- A dedicated model call, separate from `generateEngineerVerdict`, with a
  system prompt that states the single allowed operation explicitly:
  *"Correct only misspelled words. Do not reorder words, change
  punctuation, expand abbreviations, fix grammar, or rephrase for clarity.
  If a word's spelling is ambiguous or it may be a proper noun / site
  term / local usage, leave it unchanged."*
- **Output-shape constraint, not just prompt wording** — the same
  containment-style discipline this codebase already applies to the
  verdict (Rule 2, `containment.ts`): request `output_config` as
  structured JSON (`{ corrected: string }`), and **verify the constraint
  in code after the call returns**, not just trust the prompt. The
  cheapest code check available: word-count and word-order equality
  between input and output (split on whitespace, compare token count and
  relative order of non-corrected tokens) — if the model has reordered,
  merged, or dropped words, that is detectable without semantic
  understanding, and the corrected text should be **rejected**, falling
  back to the raw text unmodified. This mirrors the existing
  `verdict_status: 'placeholder'` fallback pattern (`generate.ts`) rather
  than inventing a new failure shape.
- A Levenshtein-distance ceiling per word is a candidate second guard (a
  "correction" that changes more than ~40% of a word's characters is more
  likely a rewrite than a spelling fix) — flagged as a refinement to
  decide at implementation, not blocking the design.
- This is a **new, small, per-report cost** (one additional short model
  call, or two fields batched into one call) — worth naming plainly since
  this project's own standing feedback is to not let cost drive the
  decision silently ([[dont-frame-model-choice-as-cost-driven]] equivalent
  reasoning) — the record here is the containment-and-verification
  mechanism, not the price.

**DECIDED (2026-09-11, Aravind):** ONE model call covering both fields
together, not two — fewer round trips, lower cost. The word-order/count
guard runs **per field independently** on the single call's structured
output (`{ planned_corrected: string, done_text_corrected: string }`):
if one field's correction fails the guard, that field alone falls back to
its raw text — the other field's correction still ships. One field
drifting must never discard the other's valid correction.

---

## 2. Implausible flag — dropped

**Confirmed, not accidental.** `EngineerEquipmentItemFacts.implausible`
(`lib/dpr/schema.ts`, migration 035's attention signal) only has meaning
against a **structured** `actual_hours` value compared to a machine count —
render.ts:658-662 renders it inline as `(check this)` on the per-machine
Equipment line. Once MACHINE becomes raw text with no parsing (decision 6,
below), there is no `actual_hours` value left to flag, since nothing
parses the reported text into a number at all.

**Disposition:** the flag, its render-path branch (render.ts:650-662), and
`EngineerEquipmentItemFacts.implausible` itself are all **removed**, not
stubbed and not left as dead code reachable by nothing. One tracked note
goes wherever the deferred equipment-parsing work is already tracked
(FAST-FOLLOW territory per CLAUDE.md §2 — equipment parsing was never
Spine scope to begin with): *"the implausibility check existed against
parsed `actual_hours`; when parsing returns, the check returns with it —
it is not preserved as inert code in the meantime."* No TODO comment left
in the render path itself — the removal is total, the note lives with the
future work it depends on.

---

## 3. Idle hours — moves into RESOURCE, NEEDS ATTENTION heading removed

**Data, unchanged.** `facts.idle_hours_by_trade[]` — already reported
(migration 035), already read (PR C2, 2026-09-05). Only its position and
heading change: today it renders under `NEEDS ATTENTION`
(render.ts:727-730, 737-741) as sentences (`"Mason idle 2 hours."`); target
renders it as a plain `Idle hours:` line inside `RESOURCE`.

**What disappears with the heading, named explicitly per Aravind's own
instruction to flag every removal:** `NEEDS ATTENTION`'s framing —
Rule 5's distinction between `MISSING` ("our problem," what the pipeline
failed to collect) and `NEEDS ATTENTION` ("the customer's problem," what
went wrong on site) — has no surviving equivalent once idle hours is its
only occupant and idle hours moves elsewhere. Confirmed by reading the
whole function: nothing else populates `needsAttention` today.

**CONFIRMED (2026-09-11, Aravind): the removal is intentional.** The
bottom `SUMMARY` carries the owner-facing concern instead, by naming idle
hours as a reported fact (per the constraint below). Recorded as a dated,
deliberate removal of spec Rule 5's `MISSING`/`NEEDS ATTENTION` framing
distinction — not an oversight, not a silent fold into the idle-hours
relocation.

**The summary may name idle hours, never judge it.** Settled wording of the
constraint: *"2 masons idle 2 hours"* is allowed (a restatement of a
reported fact); *"productivity was poor"* is not (an assessment).

**How the prompt enforces this line — proposed, extending the existing
containment mechanism rather than inventing a new one:**

- `buildEngineerFactsCorpus` (`containment.ts`) already exists to bound
  what digits the model may cite. Idle-hours values are already Facts
  (`facts.idle_hours_by_trade`), so they are already legitimately citable
  under the existing digit-provenance rule — no corpus change needed for
  the *numbers*.
- The judgment risk is not digits, it's **adjectives** — nothing in the
  current containment system constrains vocabulary, only digit
  provenance. `ENGINEER_SYSTEM_PROMPT` (`generate.ts:434`) needs a new,
  explicit sentence in the same imperative register as its existing
  lines: *"State what was reported. Do not characterise it as good, bad,
  a problem, poor, or any other judgment — including about idle time,
  hindrances, or dependencies. If idle hours are reported, state the
  hours and the trade; do not add why it matters."*
- This is a **prompt-only constraint** — unlike the spelling-correction
  guard above, there is no cheap structural code check for "did the model
  editorialise" the way there is for "did the model reorder words."

**DECIDED (2026-09-11, Aravind): yes, add a denylist backstop behind the
prompt constraint.** Prompts drift; a small, cheap regex check on the
verdict output before it ships is worth it. Proposed word list, for
Aravind's approval before it ships (not yet approved — this is a proposal,
not a final list): `poor`, `excellent`, `concerning`, `disappointing`,
`good`, `bad`, `inadequate`, `low`, `high` (the last two only when
modifying a judgment noun like "morale"/"productivity", not a plain
measurement — flagged as the one entry needing care, since "low" a
legitimate reading is a hazard: "2 hours" itself is never a judgment word,
but "low productivity" is; a bare word-match denylist cannot tell these
apart, so `low`/`high` may need to be scoped to specific noun pairings
rather than matched standalone, or dropped from the list if that scoping
is too fragile to build cheaply).

**Fallback behavior on a hit — options, not picked here, Aravind's call:**
1. **Regenerate** — retry the model call once (mirrors the existing
   containment-retry pattern, `generate.ts`'s S10 discipline) before
   falling back.
2. **Fall back to a code-templated line** — same mechanism as
   `codeTemplatedVerdict` (dispatch.ts), skip the model's sentence
   entirely for this report.
3. **Strip the offending word/clause** — surgical, but risks leaving an
   awkward sentence fragment; the riskiest of the three since it can
   produce a worse-looking, ungrammatical result rather than a clean
   fallback.
Option 1 has the most precedent in this codebase (matches S10's existing
retry-then-placeholder shape) and is the tentative lean, but this is
Aravind's decision, not resolved here.

---

## 4. Missing-input markers — inline, per field

**Rule, restated precisely:** any line with no answer, inside an
otherwise-complete check-in, shows `"no input received"` inline in place
of the value. When an **entire half** is missing, the check-in line already
says `"Evening: not received"` — the six/seven field-level lines under that
half do **not** each additionally say `"no input received"`; the half-level
statement is the single clear statement, not a repeated one.

**Lines eligible for the inline marker** (i.e., can individually be blank
inside an otherwise `complete`/`partial` half, verified against
`EngineerDprFacts`'s per-field `status: 'reported' | 'not_captured'`
shape):
- `Morning plan` (`facts.work.planned`)
- `Work completed` (`facts.work.done_text` / `.done_quantity`)
- `Labour reported — morning` (`facts.manpower.planned`)
- `Labour reported — evening` (`facts.manpower.on_site`)
- `Idle hours` — **DECIDED (2026-09-11): omit the line entirely when
  empty**, per decision 7's empty-sections rule, applied at field
  granularity. "No input received" is for a field left unanswered inside
  an otherwise-answered section; an empty idle-hours array is a real,
  common, non-missing answer (nobody was idle) — not a gap. Confirmed as
  a real distinction, not uniform with the scalar fields above.
- `Machines reported` / `Run hours` — once these become the new
  `CapturedText`-shaped raw-text fields (Stage 1's `machines_reported`/
  `run_hours` fields, §6/field map below), the same omit-when-empty
  convention applies — same reasoning as idle hours, not the scalar
  inline-marker convention.

**Suppression rule, confirmed:** the half-missing case is already fully
determined by existing data — `facts.morning_status.status ===
'not_received'` / `facts.evening_status.status === 'not_received'` — so
when a half is `not_received`, none of that half's individual field lines
render the inline marker.

**DECIDED (2026-09-11, Aravind):** a `not_received` half's WORK/RESOURCE/
MACHINE lines for that half are **omitted entirely**, not printed with a
label and no markers. The check-in line states it once
(`"Evening: not received"`) — every field that would have come from that
half is suppressed, not individually marked. One clear statement, not six
repetitions.

---

## 5. Project Manager field

Reconfirmed this session (see prior verification pass): every one of the
three real prod projects has exactly one `project_members` row with
`role='pm'`. No FK/constraint enforces this — it is a current fact, not a
schema guarantee — so it is recorded in code as a comment naming the
assumption, not as a silent behavior.

**Surfaces needing the new read — three, not two** (correcting the earlier
scoping, which named two):
1. `lib/dpr/dispatch.ts` — builds `EngineerReportMeta` for the WhatsApp-
   rendered path (`dispatch.ts:168-172`).
2. `lib/dpr/owner-deliver-dispatch.ts` — builds a **second**,
   independently-constructed `EngineerReportMeta` object
   (`owner-deliver-dispatch.ts:409-412`) for the email delivery path.
3. `lib/dpr/render-email.ts` — declares its **own separate**
   `EngineerReportMeta` interface (`render-email.ts:52-59`), textually
   identical to `render.ts`'s but a distinct type (not imported/shared) —
   confirmed by reading both files. Adding a `project_manager_name` field
   means editing this interface too, or the email path will not compile
   once its two callers start passing the new field.

**DECIDED (2026-09-11, Aravind): build on the current 1:1 fact, do not
design for a case that does not exist yet, do not add a constraint.**

Implementation, per Aravind's own instruction and the duplicate-type note
below: the two separate `EngineerReportMeta` interfaces (render.ts,
render-email.ts) are unified into **one shared type**, defined once in
render.ts, imported by render-email.ts (which already imports
`renderEngineerBody` from render.ts — no new dependency) — gains
`project_manager_name: string | null`. A new shared helper,
`resolveProjectManagerName(client, project_id)`, queries
`project_members` filtered by `project_id` and `role='pm'`, ordered by
`created_at` ascending, takes the first row's `user_id`, and looks up
that user's `full_name`. Returns `null` when no PM row exists.

**The code comment this function carries, verbatim intent:** *"Every real
project today has exactly one `role='pm'` row — a CURRENT FACT, not
schema-enforced (no constraint limits a project to one PM). If a project
ever gains a second PM, this silently returns whichever one sorts first
by `created_at` — ambiguity named, not solved. Do not read this as a
design decision about which PM 'should' show; it is a non-crashing
default for code that must return something today."* Deterministic
first-by-`created_at` selection was chosen over throwing on a multi-row
result specifically so an unenforced ambiguity degrades to "shows one PM,
silently" rather than "breaks DPR generation for that project" — matching
Aravind's own framing of the consequence ("makes this field silently
ambiguous," not "makes this field crash").

---

## 6. Machine label and raw-text rendering

`"Machines reported:"` — kept, per Aravind's own instruction, on the
stated reasoning that it implies no number. Both `Machines reported` and
`Run hours` render raw text verbatim; parsing stays deferred (FAST-FOLLOW
territory, matching decision 2's equipment-parsing note).

**Field-map detail (full table is in §Field map below):** this is the
largest genuine gap in the whole redesign. `morning_equipment.raw_text`
exists at the DB/JSONB level but is **not even declared** in
`CorrectedEngineerLogRow`'s TypeScript type (`lib/dpr/assemble.ts:471`).
`evening_equipment_utilisation.raw_text` **is** typed and read into
`CorrectedEngineerLogRow` (`assemble.ts:506`) but is dropped before it
ever reaches `EngineerDprFacts` — `mergeEngineerDprFacts` only surfaces
the itemized `items[]` breakdown. Both need new plumbing: a type addition
plus a new field on `EngineerDprFacts.equipment` (e.g.
`morning_raw_text: CapturedText`, `run_hours_raw_text: CapturedText`),
and `renderEngineerBody()`'s per-item equipment loop replaced with two
plain lines reading those new fields instead of iterating `items[]`.

---

## 7. Empty sections omitted entirely

Confirmed as a straightforward extension of the pattern render.ts already
uses for the Hindrance section (`if (facts.hindrances.length > 0) { ... }`,
render.ts:694) — each of WORK / RESOURCE / MACHINE / HINDRANCE /
DEPENDENCY gets the same "only emit the header if there's at least one
non-empty line under it" treatment. No open question here; this is a
render-path implementation detail once the fields above exist.

---

## 8. Not-on-site days

**Corrected finding from the prior verification pass — the schema
picture is different from what was reported then, and more favorable.**
`daily_logs.attendance` (migration 030) is a three-value CHECK:
`'present' | 'absent' | 'site_holiday'`. It is **not** entirely unread —
`site_holiday` already flows into `is_holiday = true`
(`lib/whatsapp/flows/morning.ts:404-410`), and `resolveCheckInStatus`
already branches on `is_holiday` (`dispatch.ts:293-300`). The genuine gap
is narrower than "attendance is never read": **`attendance = 'absent'`
specifically is never read anywhere in the DPR pipeline.**

That value means exactly what "not-on-site" should mean: the engineer
personally was not on site, the site itself was not closed (distinct from
`site_holiday`), and — per `MORNING_ABSENT_REPLY`'s own copy ("We'll still
check in this evening") — the evening check-in is still expected to run
normally. So on an absent day, WORK/RESOURCE/MACHINE will typically be
empty or not_received (Q2/Q3 of the morning flow are skipped when
attendance resolves to absent — confirmed in `morning.ts`'s step-1
handling), which is exactly the condition decision 8 wants replaced with a
directing-to-PM line instead of the ordinary empty/no-input treatment.

**Proposed mechanism, extending the existing overlay pattern rather than
building a new one:** `resolveCheckInStatus` (`dispatch.ts:280-340`)
already has a `NotApplicableKind` discriminator (`'holiday' | 'joined_late'
| 'left_early'`) for exactly this class of "why is this half the status it
is" case. Read `attendance` alongside `is_holiday`/`holiday_reason` in the
existing `daily_logs` select (`dispatch.ts:285-291`), and add a fourth
kind — `'not_on_site'` — set when `attendance === 'absent'`. This is a
**morning-only** overlay in principle (evening may still have real data),
which is a different shape from the existing three kinds, all of which
apply symmetrically to both halves. The render path (not the status
overlay) is where the WORK/RESOURCE/MACHINE-replacement actually needs to
happen — `renderEngineerBody` needs the `attendance` fact (or the derived
kind) passed in to decide whether to render the normal sections or the
single directing line in their place.

**Copy:** still Aravind's, not proposed here per his own instruction.

---

## 9. Summary guard

`dispatch.ts`'s existing `eveningNeedsModel` gate (`dispatch.ts:144`,
`!eveningNeedsModel → codeTemplatedVerdict`) already implements exactly
this pattern for the holiday and fully-not_applicable cases —
`codeTemplatedVerdict` (`dispatch.ts:224-246`) is a small `if`-chain
returning a fixed sentence per structural case, no model call. Extending
it to not-on-site is additive: `codeTemplatedVerdict` gains a branch for
`morning.kind === 'not_on_site'` (or however decision 8's kind is
represented), following the same "structural check, not a substring match
on reason text" discipline the function's own header comment already
insists on. No new gate mechanism — this is a new branch on an existing
one.

---

## Known cost — labour raw text readability (recorded 2026-09-11, Stage 3 review)

**Not a defect, no action needed** — recorded because Stage 3's own
rendered sample against real prod data (2026-09-05, Speed Mechatronics)
made it visible for the first time: `Labour reported — morning`/
`Labour reported — evening` render a full wall of raw text when the
engineer's answer lists every trade individually, e.g. (the real prod
value on both halves that day — genuinely typed twice by the engineer,
confirmed via a live DB probe, not a render bug):

> "TOTAL - 37Nos , CIVIL Team 25 nos, mASON - 7 , helper - 11 , Fittern - 7,
> roller operator - 1 , Supervisor -1, P.EB TEAM - 12 nOS , fitter - 3 ,
> Helper - 6, Operator - 1, Supervisor - 2."

Twelve comma-separated trade counts, inconsistent casing, on one line, is
a real readability cost to the owner reading this report — but it is the
**correct, deliberate consequence** of the 2026-09-05 "113 fabrication"
incident's own fix (schema.ts's `EngineerManpowerFacts` comment): raw
text, verbatim, never a parsed/summed number, because a parsed total was
the exact defect that reached an owner. This redesign does not reopen
that decision. It is what the owner reads **until equipment/labour
parsing returns** (deferred, FAST-FOLLOW territory per CLAUDE.md §2) —
recorded here so that eventual parsing work has a stated readability
reason to exist, not only a data-structure one.

---

## Field map — target format vs. what the assembler has today

| Target field | Status | Detail |
|---|---|---|
| Site Name, Date | Available | Unchanged |
| Site Engineer | Available | Unchanged |
| **Project Manager** | New read | §5 above — three files, not two |
| Check-in: Morning/Evening | Available, reformat only | Values exist; currently two lines, target is one `·`-joined line |
| Morning plan (spelling-corrected) | Raw text available; correction is new | §1 above |
| Work completed (spelling-corrected) | Raw text available; correction is new | §1 above |
| Labour reported — morning/evening | **Fully available, no change needed** | `facts.manpower.planned`/`.on_site`, already raw text (2026-09-05 fix) |
| Idle hours | Available, reposition only | Move from NEEDS ATTENTION into RESOURCE |
| **Machines reported** | New read | §6 above — type gap in `assemble.ts:471` |
| **Run hours** | New read (smaller gap) | Typed but dropped before `EngineerDprFacts` (`assemble.ts:506`) |
| Hindrance | Live (PR #250) | No change |
| Dependency | Live (PR #250) | No change |
| Not-on-site line | New — needs `attendance` read + render branch | §8 above |
| Summary guard extension | Small addition to existing gate | §9 above |

## What the current format has that this drops

- `MISSING` as a separate block — replaced by inline per-field markers
  (§4), per Aravind's own instruction. Confirmed as intentional.
- `NEEDS ATTENTION` as a heading/framing (Rule 5's "customer's problem"
  distinction) — no surviving equivalent once idle hours (its only
  current occupant) moves into RESOURCE. **Confirmed intentional by
  Aravind, 2026-09-11** (§3).
- The `implausible` / `(check this)` per-machine flag — dropped as a
  structural consequence of raw-text MACHINE, not a separate choice.
  Tracked note goes with the deferred equipment-parsing work (§2).
- Per-machine line-by-line granularity — target is two raw-text blobs
  (`Machines reported`, `Run hours`) instead of one line per machine with
  its own hours. A real reduction in structure, consistent with the
  labour fix's own precedent (verbatim over parsed).

## Copy slots still needing strings — Aravind writes these

1. Not-on-site PM-directing line (§8).
2. Inline no-input marker — proposed as `"no input received"` verbatim,
   consistently, across every eligible scalar line (§4); **not yet
   resolved** whether idle hours / machine lines (array-shaped today) use
   the same marker or the omit-if-empty convention instead — flagged in §4.
3. Section headers (`WORK`, `RESOURCE`, `MACHINE`, `HINDRANCE`,
   `DEPENDENCY`, `SUMMARY (auto-generated)`) — already given verbatim,
   not open.
4. Field labels — already given verbatim by Aravind, except:
   - `"Machines reported:"` — Aravind's own choice, kept as proposed
     (§6), not re-opened.
5. Any wording for the dropped implausible flag, only if §2's disposition
   (fully dropped) is not what Aravind confirms.

---

## Decisions — all six resolved 2026-09-11

1. **Multi-PM ambiguity (§5).** RESOLVED: build on the 1:1 fact, silent
   deterministic first-by-`created_at` selection, no constraint, code
   comment naming the assumption. Not designed further.
2. **Idle hours / machine lines and the inline marker (§4).** RESOLVED:
   omitted entirely when empty, not marked — empty-section rule applies
   at field granularity for these three array-shaped lines.
3. **Not-received half rendering (§4).** RESOLVED: omitted entirely — the
   check-in line states it once, no per-field repetition.
4. **Spelling-correction call shape (§1).** RESOLVED: one model call for
   both WORK fields, per-field independent guard/fallback.
5. **Judgment-language backstop (§3).** RESOLVED: yes, a denylist
   backstop behind the prompt constraint. Word list proposed, not yet
   approved (§3). Fallback-on-hit behavior still has three named options,
   Aravind's call, not resolved.
6. **NEEDS ATTENTION removal sign-off (§3, "what this drops").** RESOLVED:
   confirmed intentional removal, SUMMARY carries the owner-facing
   concern instead.

**Still genuinely open, carried forward, not blocking Stage 1:**
- The exact judgment-language denylist word list (§3) — proposed, awaiting
  approval.
- The fallback behavior on a denylist hit — regenerate / code-template /
  strip (§3) — three options named, none picked.
- Whether `low`/`high` belong in the denylist at all, given the
  false-positive risk on a plain measurement vs. a judgment (§3).

---

## Staging plan (once this doc is approved)

Proposed stages, each stopping for review before the next — matching this
project's own migration/lockstep discipline (CLAUDE.md §0) even though
most of this work is pure TypeScript, no new migration:

- **Stage A — plumbing, no render change.** New reads: `attendance`
  surfaced on `resolveCheckInStatus`'s return (now exported); `morning_
  equipment.raw_text` typed in `assemble.ts` and surfaced (alongside the
  already-typed `evening_equipment_utilisation.raw_text`) as two new
  `CapturedText` fields on `EngineerDprFacts.equipment`; `project_members`
  PM lookup via a new shared `resolveProjectManagerName` helper, called
  from both dispatch files. **Per Aravind's note:** the three separate
  `EngineerReportMeta` declarations (render.ts, render-email.ts, and
  dispatch.ts's implicit structural use) are unified into one type,
  defined once in render.ts and imported by render-email.ts — the exact
  duplicate-type trap that bit `narrative-context.ts` during migration
  040's Stage 2, closed here rather than repeated a third time. No
  visible output change — nothing added in Stage A is read by
  `renderEngineerBody`/`renderEngineerReport`/`renderEmailReport` yet.
  Existing tests stay green untouched; new tests cover the new reads
  only (a pure unit test for the two equipment raw-text fields, and
  integration tests for the attendance read and PM resolution against
  real test-db).
- **Stage B — spelling correction.** The new model call, its containment/
  word-order guard, the new corrected-text fields on `EngineerDprFacts`.
  Gated on Aravind resolving open item 4.
- **Stage C — render restructure.** `renderEngineerBody()` rewritten to
  the new section layout (WORK/RESOURCE/MACHINE), inline markers, omitted
  empty sections, implausible-flag removal, not-on-site line. This is the
  stage where the visible DPR output actually changes — largest blast
  radius, so it lands after A and B are independently verified.
- **Stage D — summary guard extension + prompt updates.** The
  `codeTemplatedVerdict` not-on-site branch, `ENGINEER_SYSTEM_PROMPT`'s
  judgment-language constraint, header line reformat
  (`Check-in: Morning [status] · Evening [status]`), `Good evening.` /
  `Project Manager:` header lines.

Each stage's own diff should be small enough to review on its own; none
of this trips CLAUDE.md §0's external-review-gate conditions (no function
grant/RLS/auth/money surface touched, no SQL at all in Stages B-D — Stage
A's `attendance` read is a SELECT addition to an existing query, not a
schema change) — so this is TypeScript-only sign-off, not a migration
review cycle, unless Stage A's PM-lookup turns up a reason to add an
index or constraint that isn't visible from here.
