import type {
  DprFacts,
  DprJudgment,
  AccountabilityEntry,
  CapturedCount,
  CapturedNumber,
  ExecutionQuantityFact,
  EquipmentItemFacts,
  SuppressionNote,
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
// currency, just the number or the not-captured phrase, in each of the two
// flavors. headcount and utilisation_pct are always their own line
// (Standalone); productive_count and idle_count are always composed
// together on one line (Inline) — see renderManpower.
function fmtCountStandalone(c: CapturedCount | CapturedNumber): Standalone {
  return c.status === 'not_captured' ? NOT_CAPTURED_STANDALONE : standalone(String(c.value))
}

function fmtCountInline(c: CapturedCount | CapturedNumber): Inline {
  return c.status === 'not_captured' ? NOT_CAPTURED_INLINE : inline(String(c.value))
}

// Indian digit grouping (lakh/crore convention): the last three digits form
// one group, everything before that groups in pairs of two going left —
// ₹1,50,000, not ₹150,000. Decimal part is dropped when it's exactly .00
// (₹375, not ₹375.00) since idle cost is usually a clean figure; kept when
// it isn't (a genuine fractional-hour idle-cost computation).
function formatIndianCurrency(value: number): string {
  const negative = value < 0
  const [intPart, decPart] = Math.abs(value).toFixed(2).split('.')
  const lastThree = intPart.slice(-3)
  const rest = intPart.slice(0, -3)
  const grouped = rest === '' ? lastThree : `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${lastThree}`
  const decimalSuffix = decPart === '00' ? '' : `.${decPart}`
  return `${negative ? '-' : ''}₹${grouped}${decimalSuffix}`
}

// Money fields (idle_cost, daily_hire_cost) — ₹ + Indian grouping, or the
// not-captured phrase with no unit tacked on. daily_hire_cost is never
// composed inline today (Standalone only); idle_cost IS, on the equipment
// line (Inline).
function fmtMoneyStandalone(c: CapturedNumber): Standalone {
  if (c.status !== 'reported' || c.value === null) return NOT_CAPTURED_STANDALONE
  return standalone(formatIndianCurrency(c.value))
}

function fmtMoneyInline(c: CapturedNumber): Inline {
  if (c.status !== 'reported' || c.value === null) return NOT_CAPTURED_INLINE
  return inline(formatIndianCurrency(c.value))
}

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
function fmtBoolean(value: boolean): string {
  return value ? 'Yes' : 'No'
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
  headcount: Standalone
  productive_count: Inline
  idle_count: Inline
  utilisation_pct: Standalone
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
      headcount: NOT_CAPTURED_STANDALONE,
      productive_count: NOT_CAPTURED_INLINE,
      idle_count: NOT_CAPTURED_INLINE,
      utilisation_pct: NOT_CAPTURED_STANDALONE,
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
      headcount: NOT_CAPTURED_STANDALONE,
      productive_count: NOT_CAPTURED_INLINE,
      idle_count: NOT_CAPTURED_INLINE,
      utilisation_pct: NOT_CAPTURED_STANDALONE,
      note: NOT_CAPTURED_STANDALONE,
      wholly_blank: true,
    }
  }
  return {
    headcount: fmtCountStandalone(facts.headcount),
    productive_count: fmtCountInline(facts.productive_count),
    idle_count: fmtCountInline(facts.idle_count),
    utilisation_pct: facts.utilisation_pct.status === 'not_captured' ? NOT_CAPTURED_STANDALONE : standalone(`${facts.utilisation_pct.value}%`),
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
  daily_hire_cost: Standalone
  idle_cost: Inline
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
      daily_hire_cost: NOT_CAPTURED_STANDALONE,
      idle_cost: NOT_CAPTURED_INLINE,
      note: text,
      blank: text,
    }
  }
  const modelNote = judgment.equipment_items.find((j) => j.morning_item_index === item.morning_item_index)
  return {
    type: item.type,
    available_hours: fmtHoursInline(item.available_hours),
    actual_hours: fmtHoursInline(item.actual_hours),
    daily_hire_cost: fmtMoneyStandalone(item.daily_hire_cost),
    idle_cost: fmtMoneyInline(item.idle_cost),
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
    schedule: { met: string; note: string; data_status: string }
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

  const schedule = facts.schedule.suppressed
    ? { met: suppressionText(facts.schedule.suppressed), note: suppressionText(facts.schedule.suppressed) }
    : {
        met: facts.schedule.schedule_met === null ? NOT_CAPTURED_STANDALONE : fmtBoolean(facts.schedule.schedule_met),
        note: facts.schedule.schedule_met === false ? judgment.schedule_miss_reason_note : '',
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
    // No hardcoded unit suffix here — fmtHoursInline/fmtMoneyInline already
    // bake in "h" / "₹" (or the lowercase inline not-captured fragment) at
    // the value layer.
    lines.push(`  - ${item.type}: ${item.available_hours} available, ${item.actual_hours} actual, idle cost ${item.idle_cost}`)
    lines.push(`    ${item.note}`)
  }
  lines.push('')

  lines.push("TOMORROW'S PLAN")
  lines.push(`  ${s.tomorrows_plan.note}`)
  lines.push('')

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
