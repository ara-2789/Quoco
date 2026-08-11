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

const NOT_CAPTURED_TEXT = 'Not captured today.'

const SUPPRESSION_LABEL: Record<SuppressionNote['reason'], string> = {
  multi_engineer_manpower: 'manpower',
  multi_engineer_schedule: 'schedule status',
  same_activity_overlap: 'quantity',
  same_type_equipment: 'utilisation',
}

function suppressionText(note: SuppressionNote): string {
  return `Reported by ${note.engineer_count} engineers — ${SUPPRESSION_LABEL[note.reason]} not aggregated.`
}

function capturedText(c: CapturedCount | CapturedNumber): string {
  return c.status === 'not_captured' ? NOT_CAPTURED_TEXT : String(c.value)
}

// ---- §1 Execution -----------------------------------------------------

interface RenderedExecutionItem {
  activity: string
  quantity: string
  unit: string
}

function renderExecutionItem(item: ExecutionQuantityFact): RenderedExecutionItem {
  return {
    activity: item.activity,
    quantity: item.suppressed ? suppressionText(item.suppressed) : capturedText(item.quantity),
    unit: item.suppressed ? '' : item.unit,
  }
}

// ---- §3 Manpower --------------------------------------------------------

interface RenderedManpower {
  headcount: string
  productive_count: string
  idle_count: string
  utilisation_pct: string
  note: string
}

function renderManpower(facts: DprFacts['manpower'], judgment: DprJudgment): RenderedManpower {
  if (facts.suppressed) {
    const text = suppressionText(facts.suppressed)
    return { headcount: text, productive_count: text, idle_count: text, utilisation_pct: text, note: text }
  }
  const allNotCaptured =
    facts.headcount.status === 'not_captured' &&
    facts.productive_count.status === 'not_captured' &&
    facts.idle_count.status === 'not_captured'
  return {
    headcount: capturedText(facts.headcount),
    productive_count: capturedText(facts.productive_count),
    idle_count: capturedText(facts.idle_count),
    utilisation_pct: facts.utilisation_pct.status === 'not_captured' ? NOT_CAPTURED_TEXT : `${facts.utilisation_pct.value}%`,
    note: allNotCaptured ? NOT_CAPTURED_TEXT : judgment.manpower_idle_reason_note,
  }
}

// ---- §4 Equipment ---------------------------------------------------------

interface RenderedEquipmentItem {
  type: string
  available_hours: string
  actual_hours: string
  daily_hire_cost: string
  idle_cost: string
  note: string
}

function renderEquipmentItem(item: EquipmentItemFacts, judgment: DprJudgment): RenderedEquipmentItem {
  if (item.suppressed) {
    const text = suppressionText(item.suppressed)
    return { type: item.type, available_hours: text, actual_hours: text, daily_hire_cost: text, idle_cost: text, note: text }
  }
  const allNotCaptured = item.available_hours.status === 'not_captured' && item.actual_hours.status === 'not_captured'
  const modelNote = judgment.equipment_items.find((j) => j.morning_item_index === item.morning_item_index)
  return {
    type: item.type,
    available_hours: capturedText(item.available_hours),
    actual_hours: capturedText(item.actual_hours),
    daily_hire_cost: capturedText(item.daily_hire_cost),
    idle_cost: capturedText(item.idle_cost),
    note: allNotCaptured ? NOT_CAPTURED_TEXT : (modelNote?.idle_reason_note ?? NOT_CAPTURED_TEXT),
  }
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
    accountability: AccountabilityEntry[]
  }
  content: string
}

export function renderDpr(facts: DprFacts, judgment: DprJudgment, accountability: AccountabilityEntry[]): RenderedDpr {
  const executionItems = facts.execution.quantities.map(renderExecutionItem)

  const schedule = facts.schedule.suppressed
    ? { met: suppressionText(facts.schedule.suppressed), note: suppressionText(facts.schedule.suppressed) }
    : {
        met: facts.schedule.schedule_met === null ? NOT_CAPTURED_TEXT : String(facts.schedule.schedule_met),
        note: facts.schedule.schedule_met === false ? judgment.schedule_miss_reason_note : '',
      }

  const manpower = renderManpower(facts.manpower, judgment)
  const equipmentItems = facts.equipment.items.map((item) => renderEquipmentItem(item, judgment))

  // §5 is FORCED not_captured pre-Q6 regardless of what the model said —
  // TOMORROWS_PLAN_DATA_STATUS_FORCED (schema.ts) already owns this; render
  // must not surface tomorrows_plan_carry_forward_note here until Q6 ships.
  const tomorrowsPlan = { note: NOT_CAPTURED_TEXT, data_status: TOMORROWS_PLAN_DATA_STATUS_FORCED }

  const structured: RenderedDpr['structured'] = {
    execution: { items: executionItems, narrative: judgment.execution_narrative, data_status: judgment.execution_data_status },
    schedule: { ...schedule, data_status: judgment.schedule_data_status },
    manpower: { ...manpower, data_status: judgment.manpower_data_status },
    equipment: { items: equipmentItems, data_status: judgment.equipment_data_status },
    tomorrows_plan: tomorrowsPlan,
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
  lines.push(`  Headcount: ${s.manpower.headcount}`)
  lines.push(`  Productive: ${s.manpower.productive_count}, Idle: ${s.manpower.idle_count}`)
  lines.push(`  Utilisation: ${s.manpower.utilisation_pct}`)
  lines.push(`  ${s.manpower.note}`)
  lines.push('')

  lines.push('EQUIPMENT UTILISATION')
  for (const item of s.equipment.items) {
    lines.push(`  - ${item.type}: ${item.available_hours}h available, ${item.actual_hours}h actual, idle cost ${item.idle_cost}`)
    lines.push(`    ${item.note}`)
  }
  lines.push('')

  lines.push("TOMORROW'S PLAN")
  lines.push(`  ${s.tomorrows_plan.note}`)
  lines.push('')

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
