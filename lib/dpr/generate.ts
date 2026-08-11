import Anthropic from '@anthropic-ai/sdk'
import { DPR_JUDGMENT_SCHEMA } from './schema'
import type { DprFacts, DprJudgment } from './schema'
import type { NarrativeContext } from './narrative-context'
import { validateJudgment, type ValidationViolation } from './validate'

// The Anthropic client wrapper — the primary deliverable of this slice
// (2026-08-11 DPR generator slice), per Aravind's framing: "the Facts/
// Judgment boundary is the design's core claim and it is currently
// unenforced in running code." Everything above the final check in
// generateDprJudgment exists to get a real DprJudgment response; the actual
// enforcement (validateJudgment, lib/dpr/validate.ts) is the first code
// anywhere in this repo that actually RUNS the checks schema.ts only ever
// declared in comments.

const MODEL = 'claude-sonnet-5'
// Verified 2026-08-11 against the claude-api skill's cached pricing table,
// not carried over from memory (CLAUDE.md's own "verify model string /
// pricing before wiring, do not trust memory" discipline). Priced at the
// STANDARD rate, not the $2/$10 introductory rate live through 2026-08-31 —
// cost figures computed here must not silently become wrong the day that
// window closes.
const INPUT_COST_PER_MTOK = 3.0
const OUTPUT_COST_PER_MTOK = 15.0

export interface GenerateMeta {
  project_name: string
  log_date: string // 'YYYY-MM-DD'
}

export interface GenerateResult {
  judgment: DprJudgment
  usage: { input_tokens: number; output_tokens: number }
  latency_ms: number
  cost_usd: number
}

function fmtCount(c: { status: string; value: number | null }): string {
  return c.status === 'reported' || c.status === 'zero' ? String(c.value) : 'not captured'
}

function fmtNumber(c: { status: string; value: number | null }): string {
  return c.status === 'reported' ? String(c.value) : 'not captured'
}

// Formats DprFacts into the prompt's Facts section. THE BOUNDARY: the model
// receives ONLY what this function renders from Facts, plus the narrative
// raw-text context (formatNarrativeContext below) for the no-digit fields —
// nothing else ever crosses from daily_logs into the prompt.
function formatFacts(facts: DprFacts, meta: GenerateMeta): string {
  const lines: string[] = []
  lines.push(`Project: ${meta.project_name}, ${meta.log_date}`)
  lines.push('')

  lines.push('EXECUTION FACTS (section 1):')
  if (facts.execution.quantities.length === 0) lines.push('  (none reported)')
  for (const item of facts.execution.quantities) {
    if (item.suppressed) {
      lines.push(`  - ${item.activity}: quantity suppressed (reported by ${item.suppressed.engineer_count} engineers, not aggregated)`)
    } else {
      lines.push(`  - ${item.activity}: ${fmtNumber(item.quantity)} ${item.unit}`.trim())
    }
  }
  lines.push('')

  lines.push('SCHEDULE FACTS (section 2):')
  if (facts.schedule.suppressed) {
    lines.push(`  Suppressed (reported by ${facts.schedule.suppressed.engineer_count} engineers, not aggregated)`)
  } else {
    lines.push(`  Plan met: ${facts.schedule.schedule_met === null ? 'not captured' : facts.schedule.schedule_met}`)
  }
  lines.push('')

  lines.push('MANPOWER FACTS (section 3) — code-computed, do not restate or recalculate:')
  if (facts.manpower.suppressed) {
    lines.push(`  Suppressed (reported by ${facts.manpower.suppressed.engineer_count} engineers, not aggregated)`)
  } else {
    lines.push(`  Headcount: ${fmtCount(facts.manpower.headcount)}`)
    lines.push(`  Productive: ${fmtCount(facts.manpower.productive_count)}`)
    lines.push(`  Idle: ${fmtCount(facts.manpower.idle_count)}`)
    lines.push(`  Utilisation: ${fmtNumber(facts.manpower.utilisation_pct)}${facts.manpower.utilisation_pct.status === 'reported' ? '%' : ''}`)
  }
  lines.push('')

  lines.push('EQUIPMENT FACTS (section 4) — code-computed idle cost, do not restate or recalculate:')
  if (facts.equipment.items.length === 0) lines.push('  (none reported)')
  for (const item of facts.equipment.items) {
    if (item.suppressed) {
      lines.push(`  - item ${item.morning_item_index} (${item.type}): suppressed (reported by ${item.suppressed.engineer_count} engineers, not aggregated)`)
    } else {
      lines.push(
        `  - item ${item.morning_item_index} (${item.type}): available ${fmtNumber(item.available_hours)}h, actual ${fmtNumber(item.actual_hours)}h, idle cost Rs ${fmtNumber(item.idle_cost)}`,
      )
    }
  }
  lines.push('')

  lines.push("TOMORROW'S PLAN (section 5): not captured — no field for the model to write; ignore for this call.")
  lines.push('')

  return lines.join('\n')
}

// Raw engineer text — PROMPT INPUT ONLY, per the 2026-08-11 amendment
// (schema.ts). Every field this feeds is no-digit, so nothing here needs
// containment checking: the output-side constraint already makes it
// impossible for a digit in this section to reach the model's response.
function formatNarrativeContext(narrative: NarrativeContext | null): string {
  if (narrative === null) {
    return 'NARRATIVE CONTEXT: suppressed (multiple engineers submitted today) — no per-engineer raw text available.'
  }
  const lines: string[] = [
    'NARRATIVE CONTEXT — raw engineer text, for the NO-DIGIT fields ONLY ' +
      '(schedule_miss_reason_note, tomorrows_plan_carry_forward_note, manpower_idle_reason_note, equipment idle_reason_note). ' +
      'Do NOT restate any digit from this section — those fields cannot contain digits.',
  ]
  lines.push(`  Schedule miss reason (raw): ${narrative.schedule_miss_reason ?? '(none)'}`)
  lines.push(`  Manpower idle reason (raw): ${narrative.manpower_idle_reason ?? '(none)'}`)
  for (const eq of narrative.equipment_idle_reasons) {
    lines.push(`  Equipment item ${eq.morning_item_index ?? 'unmatched'} idle reason (raw): ${eq.idle_reason ?? '(none)'}`)
  }
  return lines.join('\n')
}

function buildPrompt(facts: DprFacts, narrative: NarrativeContext | null, meta: GenerateMeta): string {
  return [formatFacts(facts, meta), formatNarrativeContext(narrative)].join('\n')
}

const SYSTEM_PROMPT =
  "You generate one project-day's daily progress report from data that has already been aggregated and computed elsewhere. " +
  'Any figure labeled as a Fact is already computed — never recalculate, round, or restate it differently, even when raw text nearby also mentions numbers. ' +
  'Fields marked no-digit must contain zero digit characters — describe reasons and causes in words only. ' +
  'execution_narrative may cite a digit ONLY if it appears in the EXECUTION FACTS section above — never a number from manpower, equipment, or narrative context, even if that number is real elsewhere in this report.'

// equipment_items[].morning_item_index is left as an open integer in the
// static DPR_JUDGMENT_SCHEMA export (schema.ts's own comment) — restricted
// here to the indices actually sent for THIS call, since the valid set
// differs every call and can't be hardcoded into that static export.
//
// ZERO-EQUIPMENT CASE — third attempt, 2026-08-11 (found running the first
// real golden-case batch). A day with no morning equipment produces
// equipmentIndices = []. Two prior approaches both 400'd:
//   1. `enum: []` on morning_item_index — INVALID JSON Schema per the API
//      (`Enum must be a non-empty array`), not merely unsatisfiable.
//   2. `maxItems: 0` on the equipment_items array — also rejected
//      (`For 'array' type, property 'maxItems' is not supported`); this
//      API's structured-output schema compiler doesn't support that
//      keyword at all.
// RESOLVED: DELETE equipment_items from both `properties` and `required`
// entirely when there's nothing to constrain it to. This is the common
// shape for a small site, not an edge case, so it can't be left to throw.
// `additionalProperties: false` (already on this schema) then makes it
// structurally impossible for the model to emit an equipment_items key at
// all — no unsupported keyword needed, because nothing is being
// constrained; the property simply isn't part of the schema for this call.
// The judgment normalization right after JSON.parse (below, both call
// sites) treats the resulting absent key the same as an empty array, so
// every downstream consumer (validateJudgment, renderDpr) can keep
// assuming equipment_items is always an array, matching DprJudgment's type.
export function buildPerCallSchema(equipmentIndices: number[]): typeof DPR_JUDGMENT_SCHEMA {
  const schema = JSON.parse(JSON.stringify(DPR_JUDGMENT_SCHEMA)) as typeof DPR_JUDGMENT_SCHEMA
  if (equipmentIndices.length === 0) {
    delete (schema.properties as unknown as Record<string, unknown>).equipment_items
    ;(schema as unknown as { required: string[] }).required = (schema.required as readonly string[]).filter(
      (f) => f !== 'equipment_items',
    )
  } else {
    ;(schema.properties.equipment_items.items.properties.morning_item_index as { enum?: number[] }).enum = equipmentIndices
  }
  return schema
}

export class DprValidationError extends Error {
  constructor(public readonly violations: ValidationViolation[]) {
    super(`DPR validation failed (${violations.length} violation(s)): ${violations.map((v) => `${v.field} [${v.kind}]: ${v.detail}`).join('; ')}`)
    this.name = 'DprValidationError'
  }
}

export async function generateDprJudgment(
  facts: DprFacts,
  narrative: NarrativeContext | null,
  meta: GenerateMeta,
): Promise<GenerateResult> {
  const client = new Anthropic()
  const equipmentIndices = facts.equipment.items.map((i) => i.morning_item_index)
  const promptText = buildPrompt(facts, narrative, meta)

  const start = Date.now()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText }],
    output_config: { format: { type: 'json_schema', schema: buildPerCallSchema(equipmentIndices) } },
  })
  const latency_ms = Date.now() - start

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`)
  }
  const judgment = JSON.parse(textBlock.text) as DprJudgment
  // Normalize: when equipmentIndices was empty, buildPerCallSchema deletes
  // equipment_items from the schema entirely (see its own comment), so the
  // model's response has no such key at all. Default to [] right here, at
  // the parse boundary, so every downstream consumer (the identity-echo
  // loop below, validateJudgment, renderDpr) can keep assuming
  // equipment_items is always an array, matching DprJudgment's declared
  // (non-optional) type — no scattered undefined-guards elsewhere.
  judgment.equipment_items = judgment.equipment_items ?? []

  // Identity-echo validation (schema.ts's own required check, next to the
  // morning_item_index comment): returned indices must be a subset of the
  // ones sent — closes the one place a number could otherwise leak through
  // as model output rather than a code-owned identity passthrough.
  for (const item of judgment.equipment_items) {
    if (!equipmentIndices.includes(item.morning_item_index)) {
      throw new Error(
        `Model returned morning_item_index ${item.morning_item_index}, not one of the indices sent: ${equipmentIndices.join(', ')}`,
      )
    }
  }

  // VALIDATION — the primary deliverable of this slice. ONE validator, ONE
  // failure path (lib/dpr/validate.ts): containment (section-scoped, Reading
  // A — execution_narrative's digits must trace to execution Facts only,
  // never the whole prompt, never another section) AND the four no-digit
  // fields, checked together, every violation reported, not first-failure-
  // only. No cast needed: GenerateMeta structurally satisfies ContainmentMeta
  // (both require project_name; GenerateMeta's extra log_date field is
  // simply unused here — this is a variable, not an object literal, so no
  // excess-property check applies).
  const validationResult = validateJudgment(judgment, facts.execution, meta)
  if (!validationResult.ok) {
    // THIS SLICE: throw. No dprs row gets written; nothing silently ships
    // unvalidated content. The eventual production answer — feed into the
    // existing Failed Delivery path (bot-flows.md DPR-24), never fall back
    // to delivering the violating text — is named, not built here.
    throw new DprValidationError(validationResult.violations)
  }

  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
  const cost_usd = (usage.input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK

  return { judgment, usage, latency_ms, cost_usd }
}

// Low-level entrypoint for the golden-case runner (scripts/dump-golden-
// cases.ts): those fixtures hand-author their own rawInputText (mirroring
// the deleted spike script's style) rather than going through buildPrompt,
// so they call the model directly and run validateJudgment against their
// own exported Facts afterward — same validator, different prompt source,
// still exercising the real checks.
export async function callDprModel(promptText: string, equipmentIndices: number[]): Promise<GenerateResult> {
  const client = new Anthropic()
  const start = Date.now()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText }],
    output_config: { format: { type: 'json_schema', schema: buildPerCallSchema(equipmentIndices) } },
  })
  const latency_ms = Date.now() - start
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`)
  }
  const judgment = JSON.parse(textBlock.text) as DprJudgment
  // Normalize: when equipmentIndices was empty, buildPerCallSchema deletes
  // equipment_items from the schema entirely (see its own comment), so the
  // model's response has no such key at all. Default to [] right here, at
  // the parse boundary, so every downstream consumer (the identity-echo
  // loop below, validateJudgment, renderDpr) can keep assuming
  // equipment_items is always an array, matching DprJudgment's declared
  // (non-optional) type — no scattered undefined-guards elsewhere.
  judgment.equipment_items = judgment.equipment_items ?? []
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
  const cost_usd = (usage.input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return { judgment, usage, latency_ms, cost_usd }
}
