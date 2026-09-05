import type {
  DprFacts,
  DprJudgment,
  AccountabilityEntry,
  CapturedCount,
  CapturedNumber,
  CapturedText,
  ExecutionQuantityFact,
  EquipmentItemFacts,
  SuppressionNote,
  EngineerDprFacts,
  CheckInStatus,
} from './schema'
import { TOMORROWS_PLAN_DATA_STATUS_FORCED } from './schema'
import { isManpowerNoteDiscarded, isEquipmentItemNoteDiscarded } from './discarded-fields'

// Merges Facts + validated Judgment + Accountability into the dprs row's TWO
// storage columns (023's schema): `structured` JSONB (all 6 sections) and
// `content` TEXT (human-readable). Pure — no IO, no API call, everything it
// needs is already assembled by the caller.
//
// RENDER-TIME NOT_CAPTURED GUARANTEE (schema.ts): a section/item whose FINAL
// data_status is 'not_captured', derived from code's OWN Facts — never the
// model's declaration — renders CODE-SIDE templated text; the model's note
// is UNREACHABLE at render time regardless of what it says. This file
// enforces that guarantee for the two cases unambiguously derivable from
// Facts alone: every relevant field independently not_captured, and a
// SuppressionNote present (§12 — always forces not_captured, unconditionally,
// section-wide for manpower/schedule, per-item for execution/equipment).
//
// NOT BUILT HERE, NAMED NOT HIDDEN: the full data_status CROSS-CHECK
// (comparing the model's 'complete' vs 'partial' declaration against an
// independent from-Facts derivation for those two states, to catch a model
// that declares 'complete' over a section that's actually 'partial') is
// explicitly named as unbuilt by case-manpower-equipment-not-captured.ts's
// own header comment — "a generator unit test... Not built here." This file
// inherits that same exclusion rather than silently deciding it: for
// 'complete'/'partial', the model's OWN declared data_status is trusted and
// rendered as-is. Only the not_captured guarantee above is structurally
// enforced.

// ROOT CAUSE (2026-08-11, Aravind's finding, on top of the "Not captured
// today.h" fix above): a single sentence, "Not captured today.", was used
// BOTH as a standalone statement (its own line) AND as a fragment
// interpolated into a line composed from several fields — producing "Not
// captured today.," (sentence + comma, from "Productive: X, Idle: Y") and
// "Not captured today. available" (sentence + unit label, from the
// equipment line). The "h"-suffix bug above was the SAME root cause in a
// narrower form: a value meant for composition was treated as if it were
// already a complete, standalone piece of text.
//
// Splitting the STRING alone would not have prevented this — a call site
// could still silently interpolate a standalone sentence into a slot meant
// for an inline fragment, with nothing catching it until someone read the
// output. Inline and Standalone are NOMINALLY TYPED here (each an
// intersection with a private, compile-time-only brand the other type
// lacks) specifically so that mistake becomes a TypeScript error, not
// something that ships and gets caught by a human reading rendered prose.
// A RenderedManpower/RenderedEquipmentItem field declared Inline cannot
// accept a Standalone value, or vice versa, without an explicit `as` cast —
// which is visible in review and greppable, unlike a naming convention two
// formatter functions can silently drift apart from.
declare const InlineBrand: unique symbol
declare const StandaloneBrand: unique symbol
type Inline = string & { readonly [InlineBrand]: true }
type Standalone = string & { readonly [StandaloneBrand]: true }

function inline(text: string): Inline {
  return text as Inline
}
function standalone(text: string): Standalone {
  return text as Standalone
}

// STANDALONE: a complete sentence, terminal punctuation included — used
// where the value IS the whole statement (its own line, or the whole
// explanation for a collapsed block).
const NOT_CAPTURED_STANDALONE: Standalone = standalone('Not captured today.')
// INLINE: lowercase, no terminal punctuation — used where the value is one
// fragment among several composed onto a single line with commas/labels.
const NOT_CAPTURED_INLINE: Inline = inline('not captured')

// Owner-facing prose for a §12 suppression, per reason — replaces internal
// vocabulary ("not aggregated") with a plain explanation of WHY a figure is
// withheld (2026-08-11, first real golden-case output review: an owner does
// not know what "not aggregated" means; this states the actual situation —
// more than one engineer reported the same thing separately, so the report
// declines to guess whether to sum or pick one). Always a complete
// sentence — Standalone by construction, never composed inline.
const SUPPRESSION_PROSE: Record<SuppressionNote['reason'], (count: number) => string> = {
  multi_engineer_manpower: (n) =>
    `${n} engineers reported manpower separately for this project today, so the figures are not combined.`,
  multi_engineer_schedule: (n) =>
    `${n} engineers reported schedule status separately for this project today, so it is not combined into a single answer.`,
  same_activity_overlap: (n) => `${n} engineers reported this same activity, so the quantity is not combined.`,
  same_type_equipment: (n) =>
    `${n} engineers reported this same type of equipment, so the utilisation figures are not combined.`,
}

function suppressionText(note: SuppressionNote): Standalone {
  return standalone(SUPPRESSION_PROSE[note.reason](note.engineer_count))
}

// Bare counts (headcount, productive_count, idle_count) — no unit, no
// currency, just the number or the not-captured phrase.
//
// THE RULE, STATED PRECISELY (2026-08-11, Aravind's Fix 1 audit — see that
// audit's own note below for what it found): Inline vs Standalone is NOT
// decided by whether a value happens to share a literal line with a
// sibling. It's decided by what KIND of content the value is. A "Label:
// value" line — headcount, utilisation, hours, money, a boolean — states a
// short DATA VALUE; the label is already doing the framing work, so the
// value itself must be a bare Inline fragment, even when it is the only
// thing on its line. Standalone is reserved for values that ARE a complete
// EXPLANATION with no separate label doing that job — a model's note, a
// suppression sentence, a collapsed block's one-line summary. "Own line"
// was the wrong test — it's what led headcount/utilisation_pct to be
// mistyped as Standalone in the first pass; both are label:value fields
// that happen not to share a line with a sibling, not explanations.
function fmtCountInline(c: CapturedCount | CapturedNumber): Inline {
  return c.status === 'not_captured' ? NOT_CAPTURED_INLINE : inline(String(c.value))
}

// formatIndianCurrency/fmtMoneyInline REMOVED (§33(c), design-decisions-
// beta-feedback.md, 2026-08-25, built 2026-09-04 — production incident: a
// rate typed from memory in free text is not factual and must not render
// as if it were). Unlike computeIdleCost (§33(e) — kept, unwritten, for
// the invoice era once a real rate exists), this was a pure render-layer
// text formatter with no other caller; removed outright rather than left
// truly dead in this file.

// Hour fields (available_hours, actual_hours) — unit is baked into the
// formatted string here, not appended later by the content template (the
// original fix for the "Not captured today.h" bug — see the header comment
// above for how this same shape recurred and got the general fix). Always
// Inline: available/actual hours are only ever composed onto the equipment
// line, never printed alone.
function fmtHoursInline(c: CapturedNumber): Inline {
  if (c.status !== 'reported' || c.value === null) return NOT_CAPTURED_INLINE
  return inline(`${c.value}h`)
}

// A raw JS boolean must never reach rendered content (2026-08-11 finding —
// "Plan met: true" is not what an owner reads). "Yes"/"No" pairs naturally
// with the existing "Plan met:" line prefix without repeating "plan met".
// Inline — a "Label: value" field per the rule above.
function fmtBoolean(value: boolean): Inline {
  return inline(value ? 'Yes' : 'No')
}

// ---- §1 Execution -----------------------------------------------------

interface RenderedExecutionItem {
  activity: string
  // Inline: composed onto one line with `unit` in renderContent
  // (`${quantity}${unit ? ' ' + unit : ''}`). A not_captured, unsuppressed
  // quantity ("engineer answered the unit but not the number") would hit
  // the exact same bug class Aravind named for manpower/equipment — "Not
  // captured today. nos" — if this were Standalone; fixed here alongside
  // those two, not left as a third latent instance.
  quantity: Inline
  unit: string
}

function renderExecutionItem(item: ExecutionQuantityFact): RenderedExecutionItem {
  if (item.suppressed) {
    // unit is forced to '' below, so nothing is ever composed onto this
    // value — a Standalone sentence displayed alone is safe; the inline()
    // wrap here is a type-level formality, not a live composition risk.
    return { activity: item.activity, quantity: inline(suppressionText(item.suppressed)), unit: '' }
  }
  return { activity: item.activity, quantity: fmtCountInline(item.quantity), unit: item.unit }
}

// ---- §3 Manpower --------------------------------------------------------

interface RenderedManpower {
  // headcount and utilisation_pct are Inline, same as productive_count/
  // idle_count — see fmtCountInline's own comment for the corrected rule
  // (2026-08-11 Fix 1 audit): "own line" doesn't make a field Standalone,
  // being a label:value DATA field does. Both were mistyped Standalone in
  // the first pass.
  headcount: Inline
  productive_count: Inline
  idle_count: Inline
  utilisation_pct: Inline
  note: Standalone
  // Present ONLY when the whole section is suppressed (§12) — lets
  // renderContent collapse the section to ONE line instead of repeating the
  // same suppression sentence across headcount/productive/idle/utilisation/
  // note (2026-08-11 finding: it was printing four times in one section).
  suppressed?: SuppressionNote
  // Present ONLY when the section is NOT suppressed but every underlying
  // field is independently not_captured (isManpowerNoteDiscarded's second
  // branch — a single engineer whose whole manpower answer went
  // unanswered). Same collapse-to-one-line treatment as `suppressed`,
  // added 2026-08-11 alongside the equipment version of this fix — no
  // fixture exercises this shape yet (every current golden case's blank
  // manpower is the multi-engineer suppressed case), but the underlying
  // bug shape (repeating "not captured" across headcount/productive/idle/
  // utilisation/note) is identical, so it gets the identical fix rather
  // than being left as a latent, not-yet-observed instance.
  wholly_blank?: true
}

function renderManpower(facts: DprFacts['manpower'], judgment: DprJudgment): RenderedManpower {
  if (facts.suppressed) {
    const text = suppressionText(facts.suppressed)
    return {
      headcount: NOT_CAPTURED_INLINE,
      productive_count: NOT_CAPTURED_INLINE,
      idle_count: NOT_CAPTURED_INLINE,
      utilisation_pct: NOT_CAPTURED_INLINE,
      note: text,
      suppressed: facts.suppressed,
    }
  }
  // isManpowerNoteDiscarded (lib/dpr/discarded-fields.ts) is the SAME
  // predicate generate.ts's buildPerCallSchema uses to decide whether the
  // model was even given a manpower_idle_reason_note field to write — one
  // shared source of truth, not two copies that have to agree. When it's
  // true here (and facts.suppressed is false), every one of
  // headcount/productive_count/idle_count is independently not_captured —
  // collapse the same way the suppressed branch does.
  if (isManpowerNoteDiscarded(facts)) {
    return {
      headcount: NOT_CAPTURED_INLINE,
      productive_count: NOT_CAPTURED_INLINE,
      idle_count: NOT_CAPTURED_INLINE,
      utilisation_pct: NOT_CAPTURED_INLINE,
      note: NOT_CAPTURED_STANDALONE,
      wholly_blank: true,
    }
  }
  return {
    headcount: fmtCountInline(facts.headcount),
    productive_count: fmtCountInline(facts.productive_count),
    idle_count: fmtCountInline(facts.idle_count),
    utilisation_pct: facts.utilisation_pct.status === 'not_captured' ? NOT_CAPTURED_INLINE : inline(`${facts.utilisation_pct.value}%`),
    // isManpowerNoteDiscarded is false here, so the model was given the
    // note field and judgment.manpower_idle_reason_note is real prose, not
    // a normalization default — no fallback needed.
    note: standalone(judgment.manpower_idle_reason_note),
  }
}

// ---- §4 Equipment ---------------------------------------------------------

interface RenderedEquipmentItem {
  type: string
  available_hours: Inline
  actual_hours: Inline
  // daily_hire_cost/idle_cost REMOVED (§33(c), 2026-08-25, built
  // 2026-09-04 — production incident): the Facts-layer fields stay
  // (§33(e)), but this render layer never composes them into output.
  note: Standalone
  // Present when EITHER the item is Facts-suppressed (§12) OR every
  // rendered field is independently not_captured (isEquipmentItemNoteDiscarded's
  // second branch) — the "wholly not-captured equipment line" fix
  // (2026-08-11): previously every field printed the same phrase
  // separately (available/actual/idle cost on one line, the note on a
  // second), FOUR occurrences for one machine. When present, renderContent
  // prints ONE line — this text, no unit labels, no separate note line —
  // instead of the two-line detailed block. Holds the actual explanation
  // (the suppression sentence, or the generic not-captured phrase), so
  // content never has to recompute it separately from `note`.
  blank?: Standalone
}

function renderEquipmentItem(item: EquipmentItemFacts, judgment: DprJudgment): RenderedEquipmentItem {
  // isEquipmentItemNoteDiscarded (lib/dpr/discarded-fields.ts) — same
  // shared predicate generate.ts uses to decide which item indices the
  // model is even allowed to comment on. True here means either
  // Facts-suppressed OR available_hours AND actual_hours are BOTH
  // not_captured — and idle_cost is computed FROM those two hours
  // (computeIdleCost, lib/dpr/idle-cost.ts), so it is necessarily
  // not_captured too whenever this branch fires. Nothing rendered for this
  // item carries real data — collapse to one line.
  if (isEquipmentItemNoteDiscarded(item)) {
    const text = item.suppressed ? suppressionText(item.suppressed) : NOT_CAPTURED_STANDALONE
    return {
      type: item.type,
      available_hours: NOT_CAPTURED_INLINE,
      actual_hours: NOT_CAPTURED_INLINE,
      note: text,
      blank: text,
    }
  }
  const modelNote = judgment.equipment_items.find((j) => j.morning_item_index === item.morning_item_index)
  return {
    type: item.type,
    available_hours: fmtHoursInline(item.available_hours),
    actual_hours: fmtHoursInline(item.actual_hours),
    // isEquipmentItemNoteDiscarded is false here, so this item was one of
    // the eligible indices the model was asked about — modelNote should
    // always be found by identity-echo (generate.ts's own check on the
    // response). The fallback covers only a malformed/incomplete response
    // slipping past that check; not the normal path.
    note: modelNote ? standalone(modelNote.idle_reason_note) : NOT_CAPTURED_STANDALONE,
  }
}

// ---- "WHAT THIS REPORT DOES NOT KNOW" --------------------------------
//
// Aravind's finding (2026-08-11): §6 prints "All engineers submitted both
// check-ins today" directly above sections full of blanks — to an owner
// those contradict: if everyone reported, why does the report know
// nothing? §6 only ever answers "did they check in at all" (a binary on
// submission PRESENCE); it says nothing about whether a submitted check-in
// yielded USABLE DATA, and Part 1's collapse fix (renderManpower/
// renderEquipmentItem, above) made each individual blank read cleanly but
// still didn't say WHY it's blank.
//
// SMALL VERSION, undifferentiated cause (2026-08-11, Aravind's decision —
// docs/design-decisions-beta-feedback.md §22 has the full investigation).
// Of the four possible causes a blank field can have — never asked, asked-
// with-no-usable-answer, withheld by §12 policy, or a system fault that
// silently lost a real answer — this covers ONLY the first two:
//   - never asked (Q6 not built) — TOMORROWS_PLAN_DATA_STATUS_FORCED
//     already ties this to whether Q6 has shipped; reusing it here means
//     this line disappears on its own the moment that changes, not by
//     someone remembering to delete it.
//   - asked, no usable answer — scoped here to the manpower-productivity
//     shape specifically (headcount known, productivity/idle not), the
//     case Aravind's original finding was about.
// §12 suppression (withheld by policy) is deliberately NOT covered here —
// it already gets a full inline explanation within its own section
// (manpower.note / equipment item .blank), and duplicating that sentence
// in a second place would be exactly the redundancy Part 1 just removed
// elsewhere. A possible system fault is NOT covered either, and must not
// be implied: §22's investigation found no way to distinguish "the
// engineer didn't answer" from "we lost it" with data available today —
// asserting a specific cause here would be a claim this system cannot
// back up.
//
// NAMES NO ENGINEER, for either cause covered — same records-not-person
// posture as lib/dpr/accountability.ts's own noteFor() and §6 itself
// (Rule 5.3, docs/design-principles.md): a data gap is a property of the
// report, never a person, and per §22, attributing a productivity gap to
// a specific engineer is not something this system can currently do
// safely — the "asked, no usable answer" cause is not reliably
// distinguishable from "we lost it" with data available today, so
// attribution would overclaim what's actually known.
function computeDataGaps(facts: DprFacts, manpower: RenderedManpower): string[] {
  const gaps: string[] = []

  if (TOMORROWS_PLAN_DATA_STATUS_FORCED === 'not_captured') {
    gaps.push("Tomorrow's Plan: not yet asked in this version of the check-in.")
  }

  // Deliberately excludes the suppressed and wholly_blank cases — both
  // already carry a full inline explanation within §3 itself. Reaching
  // this branch with a real gap means headcount was captured (otherwise
  // wholly_blank would be true) but productivity/idle was not.
  if (!manpower.suppressed && !manpower.wholly_blank) {
    if (facts.manpower.productive_count.status === 'not_captured' || facts.manpower.idle_count.status === 'not_captured') {
      gaps.push('Manpower productivity: not answered today.')
    }
  }

  return gaps
}

// ---- §6 Accountability — entirely code, no model, no rendering choice to
// make: schema.ts's AccountabilityEntry already IS the render shape.

export interface RenderedDpr {
  structured: {
    execution: { items: RenderedExecutionItem[]; narrative: string; data_status: string }
    // met: Inline | Standalone, not Inline alone — see renderDpr's own
    // comment on the schedule.suppressed branch for why the suppressed
    // case is a genuine, flagged exception, not a typing oversight.
    schedule: { met: Inline | Standalone; note: Standalone; data_status: string }
    manpower: RenderedManpower & { data_status: string }
    equipment: { items: RenderedEquipmentItem[]; data_status: string }
    tomorrows_plan: { note: string; data_status: string }
    // Plain-English lines, computed by computeDataGaps (above) — one per
    // blank field this system can honestly explain the cause of. Empty on
    // a day with no explainable gaps; renderContent omits the section
    // header entirely rather than printing it empty (Rule 4.1/5.6, docs/
    // design-principles.md — don't clutter a clean report).
    data_gaps: string[]
    accountability: AccountabilityEntry[]
  }
  content: string
}

export function renderDpr(facts: DprFacts, judgment: DprJudgment, accountability: AccountabilityEntry[]): RenderedDpr {
  const executionItems = facts.execution.quantities.map(renderExecutionItem)

  // FIX 1 AUDIT FINDING, FLAGGED NOT FIXED (2026-08-11): the suppressed
  // branch forces a full Standalone sentence into `met`, glued after the
  // "Plan met:" label ("Plan met: 2 engineers reported schedule status
  // separately..."), and repeats the SAME sentence into `note` right below
  // it — the identical "same explanation, multiple times" shape Part 1
  // fixed for manpower (RenderedManpower.suppressed) and equipment
  // (RenderedEquipmentItem.blank). Schedule never received that collapse
  // treatment. Out of scope for Fix 1 (a flavor-consistency fix, not a
  // restructuring one) — recorded here so it is findable, not silently
  // left to be rediscovered as a "new" bug later. The `met: Inline |
  // Standalone` union exists BECAUSE of this exception: a real union, not
  // a dishonest cast, since this branch genuinely does hold a Standalone
  // sentence, unlike the not_captured branch below.
  const schedule = facts.schedule.suppressed
    ? { met: suppressionText(facts.schedule.suppressed), note: suppressionText(facts.schedule.suppressed) }
    : {
        met: facts.schedule.schedule_met === null ? NOT_CAPTURED_INLINE : fmtBoolean(facts.schedule.schedule_met),
        note: facts.schedule.schedule_met === false ? standalone(judgment.schedule_miss_reason_note) : standalone(''),
      }

  const manpower = renderManpower(facts.manpower, judgment)
  const equipmentItems = facts.equipment.items.map((item) => renderEquipmentItem(item, judgment))

  // §5 is FORCED not_captured pre-Q6 regardless of what the model said —
  // TOMORROWS_PLAN_DATA_STATUS_FORCED (schema.ts) already owns this; render
  // must not surface tomorrows_plan_carry_forward_note here until Q6 ships.
  const tomorrowsPlan = { note: NOT_CAPTURED_STANDALONE, data_status: TOMORROWS_PLAN_DATA_STATUS_FORCED }

  const structured: RenderedDpr['structured'] = {
    execution: { items: executionItems, narrative: judgment.execution_narrative, data_status: judgment.execution_data_status },
    schedule: { ...schedule, data_status: judgment.schedule_data_status },
    manpower: { ...manpower, data_status: judgment.manpower_data_status },
    equipment: { items: equipmentItems, data_status: judgment.equipment_data_status },
    tomorrows_plan: tomorrowsPlan,
    data_gaps: computeDataGaps(facts, manpower),
    accountability,
  }

  const content = renderContent(structured)

  return { structured, content }
}

function renderContent(s: RenderedDpr['structured']): string {
  const lines: string[] = []

  lines.push('EXECUTION OUTPUT')
  lines.push(s.execution.narrative)
  for (const item of s.execution.items) {
    lines.push(`  - ${item.activity}: ${item.quantity}${item.unit ? ` ${item.unit}` : ''}`)
  }
  lines.push('')

  lines.push('SCHEDULE VS PLAN')
  lines.push(`  Plan met: ${s.schedule.met}`)
  if (s.schedule.note) lines.push(`  ${s.schedule.note}`)
  lines.push('')

  lines.push('MANPOWER UTILISATION')
  if (s.manpower.suppressed || s.manpower.wholly_blank) {
    // ONE line for the whole section — was FOUR (headcount, productive/idle,
    // utilisation, note all repeating the same sentence). `note` already
    // carries the right text for either trigger (the suppression sentence,
    // or the generic not-captured phrase) — see renderManpower, no need to
    // recompute it here.
    lines.push(`  ${s.manpower.note}`)
  } else {
    lines.push(`  Headcount: ${s.manpower.headcount}`)
    lines.push(`  Productive: ${s.manpower.productive_count}, Idle: ${s.manpower.idle_count}`)
    lines.push(`  Utilisation: ${s.manpower.utilisation_pct}`)
    lines.push(`  ${s.manpower.note}`)
  }
  lines.push('')

  lines.push('EQUIPMENT UTILISATION')
  if (s.equipment.items.length === 0) {
    // The zero-equipment case (2026-08-11 fix): an absent/empty
    // equipment_items IS "no equipment," not a rendering gap — say so
    // explicitly rather than leaving a header with nothing under it.
    lines.push('  No equipment reported this morning.')
  }
  for (const item of s.equipment.items) {
    if (item.blank !== undefined) {
      // ONE line for a machine with nothing to report — was FOUR occurrences
      // of "Not captured today." (available/actual/idle cost on one
      // composed line, the note repeating it again on a second). See
      // RenderedEquipmentItem.blank's own comment.
      lines.push(`  - ${item.type}: ${item.blank}`)
      continue
    }
    // No hardcoded unit suffix here — fmtHoursInline already bakes in "h"
    // (or the lowercase inline not-captured fragment) at the value layer.
    // No idle-cost figure (§33(c)) — a rate typed from memory is not
    // factual and must not appear in an owner-facing report as if it were.
    lines.push(`  - ${item.type}: ${item.available_hours} available, ${item.actual_hours} actual`)
    lines.push(`    ${item.note}`)
  }
  lines.push('')

  // FIX 2 (2026-08-11, Aravind): suppressed entirely while Q6 does not
  // exist. Printing "Not captured today." here duplicated the more
  // accurate WHAT THIS REPORT DOES NOT KNOW line below ("not yet asked in
  // this version of the check-in") three lines apart, on every single
  // report — and the duplicated pair actively disagreed: "not captured"
  // implies the question was asked and went unanswered, which is false
  // pre-Q6. The gaps line is the one true explanation; this section adds
  // nothing but a second, less accurate one.
  //
  // Driven off TOMORROWS_PLAN_DATA_STATUS_FORCED DIRECTLY — the same
  // module-level constant computeDataGaps checks — not off
  // s.tomorrows_plan.data_status (which is only equal to it because
  // nothing else assigns that field today) and not off a runtime null/
  // empty check on s.tomorrows_plan.note. A runtime check on rendered
  // state could ALSO be true post-Q6, on a day an engineer legitimately
  // has zero dependencies to report — a real, different state this
  // section must not suppress. Checking the constant is what makes this
  // section reappear automatically the day Q6 ships, with nothing to
  // remember to undo.
  if (TOMORROWS_PLAN_DATA_STATUS_FORCED !== 'not_captured') {
    lines.push("TOMORROW'S PLAN")
    lines.push(`  ${s.tomorrows_plan.note}`)
    lines.push('')
  }

  // Placed after the substantive sections and before ACCOUNTABILITY —
  // Rule 5.2 (docs/design-principles.md): decisions/key drivers first,
  // flagged gaps next, full detail last. Accountability (who's missing
  // entirely) is a different signal from this section (what's missing
  // from those who DID report) and calls for a different PM action —
  // kept separate rather than merged, per Aravind's decision. Omitted
  // entirely when there's nothing to explain, not printed empty.
  if (s.data_gaps.length > 0) {
    lines.push('WHAT THIS REPORT DOES NOT KNOW')
    for (const gap of s.data_gaps) {
      lines.push(`  - ${gap}`)
    }
    lines.push('')
  }

  lines.push('ACCOUNTABILITY')
  if (s.accountability.length === 0) {
    lines.push('  All engineers submitted both check-ins today.')
  } else {
    for (const entry of s.accountability) {
      lines.push(`  - ${entry.status_note}`)
    }
  }

  return lines.join('\n')
}

// ===========================================================================
// PER-ENGINEER REPORT (docs/dpr-engineer-report-spec.md) — a second,
// parallel renderer for a different report, added alongside everything
// above, not a replacement. renderDpr/renderContent above are UNCHANGED and
// stay live for the deferred project-level report.
// ===========================================================================

// Rule 2b: verbatim, quoted, never paraphrased — the ONLY transformation
// applied is wrapping in quotes. `not reported` (Rule 3's plain-language
// vocabulary — "not captured" retired) for not_captured.
function fmtText(c: CapturedText): string {
  return c.status === 'reported' && c.value !== null ? `"${c.value}"` : 'not reported'
}

function fmtCaptured(c: CapturedCount | CapturedNumber): string {
  return c.status === 'reported' || c.status === 'zero' ? String(c.value) : 'not reported'
}

const CHECK_IN_LABEL: Record<CheckInStatus, string> = {
  complete: 'complete',
  partial: 'partial',
  not_received: 'not received',
  not_applicable: 'not applicable',
}

export interface RenderedCheckInStatus {
  status: CheckInStatus
  reason?: string // spec Rule 7's exact copy, e.g. "joined this project today"
}

function fmtCheckInLine(label: 'Morning' | 'Evening', s: RenderedCheckInStatus): string {
  const base = `${label} check-in: ${CHECK_IN_LABEL[s.status]}`
  return s.status === 'not_applicable' && s.reason ? `${base} — ${s.reason}` : base
}

export interface EngineerReportMeta {
  project_name: string
  engineer_name: string
  // Pre-formatted, code-side — e.g. "Thu 13 Aug". Never derived from a
  // digit inside the containment corpus (matches the old design's
  // ContainmentMeta exclusion of log_date — S1/2026-08-11 decision,
  // extended here to the same header line).
  formatted_date: string
}

// The BODY ONLY — four pair lines + MISSING + NEEDS ATTENTION + NOT ASKED
// YET. Deliberately excludes the header and check-in status lines (S1: the
// containment corpus is built from exactly this string, and a header date
// like "Thu 13 Aug" must never enter it — same reasoning the 2026-08-11
// ContainmentMeta decision already established for the old design, applied
// here to a different corpus). Pure — no model involvement anywhere in
// this function (Rule 2: everything except the verdict is code-owned).
export function renderEngineerBody(facts: EngineerDprFacts): string {
  const lines: string[] = []

  // §1 Work
  const doneParts: string[] = [fmtText(facts.work.done_text)]
  if (facts.work.done_quantity.status === 'reported') {
    doneParts.push(`${facts.work.done_quantity.value}${facts.work.unit ? ` ${facts.work.unit}` : ''}`)
  }
  const done = facts.work.done_text.status === 'reported' || facts.work.done_quantity.status === 'reported' ? doneParts.join(' — ') : 'not reported'
  lines.push(`Work — planned: ${fmtText(facts.work.planned)} | done: ${done}`)

  // §3 Manpower
  const manpowerActual =
    facts.manpower.on_site.status === 'not_captured' && facts.manpower.working.status === 'not_captured'
      ? 'not reported'
      : `${fmtCaptured(facts.manpower.on_site)}, working: ${fmtCaptured(facts.manpower.working)}`
  lines.push(`Manpower — planned: ${fmtCaptured(facts.manpower.planned)} | on site: ${manpowerActual}`)

  // §4 Equipment — one line per item; an empty list still gets one line,
  // rather than a header with nothing under it, to keep the body's fixed
  // four-category shape regardless of what was reported.
  if (facts.equipment.items.length === 0) {
    lines.push('Equipment — planned: not reported | used: not reported')
  }
  // §33(c) (design-decisions-beta-feedback.md, 2026-08-25, built
  // 2026-09-04, production incident): a rate typed from memory in free
  // text is not factual and must not appear in an owner-facing report as
  // if it were. daily_hire_cost stays on EngineerDprFacts (§33(e) — not
  // dropped, for the invoice era) but is never composed into report text.
  for (const item of facts.equipment.items) {
    const used = item.actual_hours.status === 'reported' ? `${item.actual_hours.value} hours` : 'not reported'
    lines.push(`Equipment — planned: ${item.type} | used: ${used}`)
  }

  // §2 Hindrance — REPLACED 2026-09-05 (PR C1, production incident:
  // evening_schedule_miss_reason was reused by migration 035 (2026-08-31)
  // for the new unconditional Q5 hindrance question, but this section kept
  // labeling its content as a schedule assessment that no longer happens —
  // an owner reading "Schedule not met" over hindrance text like "Rain 1
  // hour" was reading a real answer under a false frame. The old Schedule
  // line/MISSING/NEEDS ATTENTION entries are removed outright, not
  // reworded — schedule status itself has had no data source since 035
  // (see hindrance's own comment in assemble.ts), so there is nothing left
  // to report under that heading.
  if (facts.hindrance.note.status === 'reported') {
    lines.push(`Hindrance — ${facts.hindrance.note.value}`)
  }

  // MISSING — what we failed to collect (Rule 5, "our problem"). Driven by
  // check-in status: a not_received half is the primary case; a partial
  // evening additionally names which specific facts came back empty.
  const missing: string[] = []
  if (facts.morning_status.status === 'not_received') missing.push('Morning check-in not received.')
  if (facts.evening_status.status === 'not_received') missing.push('Evening check-in not received.')
  if (facts.evening_status.status === 'partial') {
    if (facts.work.done_text.status === 'not_captured' && facts.work.done_quantity.status === 'not_captured') missing.push('Work done: not reported.')
    if (facts.manpower.on_site.status === 'not_captured') missing.push('Manpower on site: not reported.')
  }

  // NEEDS ATTENTION — what went wrong on site (Rule 5, "the customer's
  // problem"). Code-composed sentences splicing in raw engineer text
  // verbatim (Rule 2b — not a paraphrase, a direct substring), never a
  // model field. Idle manpower/equipment only — the hindrance answer
  // renders in its own section above, not folded in here.
  const needsAttention: string[] = []
  if (facts.manpower.working.status !== 'not_captured' && facts.manpower.on_site.status !== 'not_captured') {
    const idle = (facts.manpower.on_site.value ?? 0) - (facts.manpower.working.value ?? 0)
    if (idle > 0) needsAttention.push(`${idle} workers idle.`)
  }
  for (const item of facts.equipment.items) {
    if (item.available_hours.status === 'reported' && item.actual_hours.status === 'reported') {
      const idleHours = (item.available_hours.value ?? 0) - (item.actual_hours.value ?? 0)
      if (idleHours > 0) needsAttention.push(`${item.type} idle for ${idleHours} hours.`)
    }
  }

  if (missing.length > 0) {
    lines.push('')
    lines.push('MISSING')
    lines.push(...missing)
  }
  if (needsAttention.length > 0) {
    lines.push('')
    lines.push('NEEDS ATTENTION')
    lines.push(...needsAttention)
  }

  // "NOT ASKED YET / Tomorrow's plan." REMOVED 2026-09-04 (Aravind,
  // production incident): this was internal build-status scaffolding
  // ("nothing captures tomorrow's plan yet, so there's nothing this
  // section could ever say other than this one line") that shipped
  // unconditionally into two real customer-facing DPR emails. Removed
  // outright, not replaced -- when Q6 (tomorrow's plan capture) ships,
  // this section is added back with real content, not restored as a
  // placeholder.

  return lines.join('\n')
}

export interface RenderedEngineerReport {
  content: string
  structured: {
    facts: EngineerDprFacts
    verdict: string
    verdict_status: 'model' | 'placeholder' | 'code_templated'
    morning_status: RenderedCheckInStatus
    evening_status: RenderedCheckInStatus
  }
}

export const CONTAINMENT_FAILURE_PLACEHOLDER = 'Summary unavailable for this report.'

// Composes the final report. `verdict` is whatever the caller already
// decided (the model's sentence, the containment-failure placeholder, or a
// code-templated line for holiday/fully-not_applicable/fully-empty days —
// dispatch.ts's job to choose which, never this function's). This function
// does not call the model and does not decide containment — it only lays
// out already-decided pieces, matching Rule 2's "the model's entire output
// is the verdict sentence" as literally as possible: nothing here can turn
// into model output by accident.
export function renderEngineerReport(
  facts: EngineerDprFacts,
  verdict: string,
  verdictStatus: RenderedEngineerReport['structured']['verdict_status'],
  morningStatus: RenderedCheckInStatus,
  eveningStatus: RenderedCheckInStatus,
  meta: EngineerReportMeta,
): RenderedEngineerReport {
  const body = renderEngineerBody(facts)

  const lines: string[] = []
  lines.push(`DAILY PROGRESS — ${meta.project_name} — ${meta.formatted_date}`)
  lines.push(`Site engineer: ${meta.engineer_name}`)
  lines.push('')
  lines.push(fmtCheckInLine('Morning', morningStatus))
  lines.push(fmtCheckInLine('Evening', eveningStatus))
  lines.push('')
  lines.push(verdict)
  lines.push('')
  lines.push(body)

  return {
    content: lines.join('\n'),
    structured: { facts, verdict, verdict_status: verdictStatus, morning_status: morningStatus, evening_status: eveningStatus },
  }
}
