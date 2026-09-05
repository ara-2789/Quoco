import Anthropic from '@anthropic-ai/sdk'
import { DPR_JUDGMENT_SCHEMA, ENGINEER_DPR_JUDGMENT_SCHEMA } from './schema'
import type { DprFacts, DprJudgment, EngineerDprFacts } from './schema'
import type { NarrativeContext } from './narrative-context'
import { validateJudgment, type ValidationViolation } from './validate'
import { isManpowerNoteDiscarded, isScheduleNoteDiscarded, isEquipmentItemNoteDiscarded } from './discarded-fields'
import { extractDigitTokens, checkContainment } from './containment'
import type { NarrativeContext as EngineerNarrativeContext } from './narrative-context'

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

  // No idle-cost figure fed to the model (§33(c), design-decisions-beta-
  // feedback.md, 2026-08-25, built 2026-09-04 — production incident: a
  // rate typed from memory is not factual, so it must never enter a
  // report as if it were, whether via code-templated text or the model's
  // own prompt). idle_cost stays on EquipmentItemFacts (§33(e)) but this
  // prompt never mentions it.
  lines.push('EQUIPMENT FACTS (section 4):')
  if (facts.equipment.items.length === 0) lines.push('  (none reported)')
  for (const item of facts.equipment.items) {
    if (item.suppressed) {
      lines.push(`  - item ${item.morning_item_index} (${item.type}): suppressed (reported by ${item.suppressed.engineer_count} engineers, not aggregated)`)
    } else {
      lines.push(`  - item ${item.morning_item_index} (${item.type}): available ${fmtNumber(item.available_hours)}h, actual ${fmtNumber(item.actual_hours)}h`)
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
  lines.push(`  Hindrance (raw): ${narrative.hindrance_note ?? '(none)'}`)
  lines.push(`  Manpower idle reason (raw): ${narrative.manpower_idle_reason ?? '(none)'}`)
  for (const eq of narrative.equipment_idle_reasons) {
    lines.push(`  Equipment ${eq.type} idle reason (raw): ${eq.idle_reason ?? '(none)'}`)
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
  'execution_narrative may cite a digit ONLY if it appears in the EXECUTION FACTS section above — never a number from manpower, equipment, or narrative context, even if that number is real elsewhere in this report. ' +
  'Never attribute an activity to a named person, crew, or contractor, even if a name appears verbatim in the input — and do not identify anyone indirectly either ("the engineer who reported first", "the senior engineer", "the second team"). Describe only what was done, where, and how much. Report site output, not who performed it.'

// Equipment items the model is actually allowed to comment on — excludes
// suppressed and fully-not-captured items (isEquipmentItemNoteDiscarded,
// lib/dpr/discarded-fields.ts), the SAME predicate render.ts uses for the
// SAME items. Exported so generateDprJudgment's identity-echo check
// validates the model's response against the exact same set
// buildPerCallSchema constrained it to — one shared computation, not two
// that could silently drift apart.
export function eligibleEquipmentIndices(facts: DprFacts): number[] {
  return facts.equipment.items.filter((i) => !isEquipmentItemNoteDiscarded(i)).map((i) => i.morning_item_index)
}

// GENERALIZED STRUCTURAL FIX (2026-08-11, Aravind's decision, PR #51
// review). The zero-equipment case below was the FIRST instance found, not
// a special case of a broader rule — the broader rule is: for ANY Judgment
// note field whose content render.ts already knows it will discard
// (suppressed by §12, or the underlying Facts are fully not_captured), the
// per-call schema removes that field ENTIRELY. The model is never asked to
// write a note it cannot possibly have shown to anyone.
//
// REJECTED ALTERNATIVE — instructing the model in the prompt ("this section
// is suppressed, don't write a note for it"). This project already decided
// the arithmetic boundary is enforced at the TYPE level: "no field exists
// that can hold a number" beats "instruct the model not to write numbers"
// (schema.ts's whole Facts/Judgment design). An instructional fix here
// would be the same mistake in a new place, and it adds a failure mode the
// structural fix doesn't have: the per-call prompt wording and the actual
// Facts silently disagreeing on a future edit to either one. Structure
// makes the unwanted output impossible, not discouraged.
//
// `tomorrows_plan_carry_forward_note` is the ALWAYS-TRUE case of this same
// rule, not a separate approach: TOMORROWS_PLAN_DATA_STATUS_FORCED
// (schema.ts) means section 5 is unconditionally not_captured, every call,
// pre-Q6 — so this field is deleted unconditionally below, tied to that
// same constant. Remove this deletion when TOMORROWS_PLAN_DATA_STATUS_FORCED
// is removed at Q6 ship time, not before.
//
// ZERO-EQUIPMENT CASE — the original instance, third schema-shape attempt.
// A day with no eligible equipment items produces an empty index list. Two
// prior approaches both 400'd:
//   1. `enum: []` on morning_item_index — INVALID JSON Schema per the API
//      (`Enum must be a non-empty array`), not merely unsatisfiable.
//   2. `maxItems: 0` on the equipment_items array — also rejected
//      (`For 'array' type, property 'maxItems' is not supported`); this
//      API's structured-output schema compiler doesn't support that
//      keyword at all.
// RESOLVED, and now the template every other field in this function
// follows: DELETE the property from both `properties` and `required`
// entirely when there's nothing to constrain it to.
// `additionalProperties: false` (already on this schema) then makes it
// structurally impossible for the model to emit the key at all — no
// unsupported keyword needed, because nothing is being constrained; the
// property simply isn't part of the schema for this call. The judgment
// normalization right after JSON.parse (below, both call sites) treats
// every resulting absent key as its empty/default value, so every
// downstream consumer (validateJudgment, renderDpr) can keep assuming
// DprJudgment's declared (non-optional) shape holds — no scattered
// undefined-guards elsewhere.
export function buildPerCallSchema(facts: DprFacts): typeof DPR_JUDGMENT_SCHEMA {
  const schema = JSON.parse(JSON.stringify(DPR_JUDGMENT_SCHEMA)) as typeof DPR_JUDGMENT_SCHEMA
  const properties = schema.properties as unknown as Record<string, unknown>
  const requiredList = new Set(schema.required as readonly string[])

  // §5 — unconditional, every call. See the header comment above.
  delete properties.tomorrows_plan_carry_forward_note
  requiredList.delete('tomorrows_plan_carry_forward_note')

  if (isManpowerNoteDiscarded(facts.manpower)) {
    delete properties.manpower_idle_reason_note
    requiredList.delete('manpower_idle_reason_note')
  }

  if (isScheduleNoteDiscarded(facts.schedule)) {
    delete properties.schedule_miss_reason_note
    requiredList.delete('schedule_miss_reason_note')
  }

  const equipmentIndices = eligibleEquipmentIndices(facts)
  if (equipmentIndices.length === 0) {
    delete properties.equipment_items
    requiredList.delete('equipment_items')
  } else {
    ;(schema.properties.equipment_items.items.properties.morning_item_index as { enum?: number[] }).enum = equipmentIndices
  }

  ;(schema as unknown as { required: string[] }).required = Array.from(requiredList)
  return schema
}

export class DprValidationError extends Error {
  constructor(public readonly violations: ValidationViolation[]) {
    super(`DPR validation failed (${violations.length} violation(s)): ${violations.map((v) => `${v.field} [${v.kind}]: ${v.detail}`).join('; ')}`)
    this.name = 'DprValidationError'
  }
}

// `client` is a REQUIRED parameter, no default (2026-08-12, approved
// alongside Phase 3's dpr_generate handler) — matches the injected-client
// convention already used throughout this codebase (assembleDprFacts/
// assembleAccountability's SupabaseClient parameter, clearMessagingBlock's
// own client parameter). Every caller constructs and passes its own
// `new Anthropic()`; a test passes a mock instead. The previous shape
// (constructing the client internally) made this function untestable
// without either module-mocking the SDK or making a real, billed API call
// — the same testability gap this project already closed for Supabase
// clients, closed here for the same reason.
export async function generateDprJudgment(
  client: Anthropic,
  facts: DprFacts,
  narrative: NarrativeContext | null,
  meta: GenerateMeta,
): Promise<GenerateResult> {
  const equipmentIndices = eligibleEquipmentIndices(facts)
  const promptText = buildPrompt(facts, narrative, meta)

  const start = Date.now()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText }],
    output_config: { format: { type: 'json_schema', schema: buildPerCallSchema(facts) } },
  })
  const latency_ms = Date.now() - start

  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`)
  }
  const judgment = JSON.parse(textBlock.text) as DprJudgment
  // Normalize: buildPerCallSchema deletes any field whose section is
  // already suppressed/not_captured (see its own header comment), so the
  // model's response has no such key at all for those. Default each to its
  // empty value right here, at the parse boundary, so every downstream
  // consumer (the identity-echo loop below, validateJudgment, renderDpr)
  // can keep assuming DprJudgment's declared (non-optional) shape holds —
  // no scattered undefined-guards elsewhere. Harmless even when the schema
  // DID include a field: `?? ''`/`?? []` only ever fires on a genuinely
  // absent key.
  judgment.equipment_items = judgment.equipment_items ?? []
  judgment.manpower_idle_reason_note = judgment.manpower_idle_reason_note ?? ''
  judgment.schedule_miss_reason_note = judgment.schedule_miss_reason_note ?? ''
  judgment.tomorrows_plan_carry_forward_note = judgment.tomorrows_plan_carry_forward_note ?? ''

  // Identity-echo validation (schema.ts's own required check, next to the
  // morning_item_index comment): returned indices must be a subset of the
  // ELIGIBLE ones sent (eligibleEquipmentIndices — the same filtered set
  // buildPerCallSchema constrained the model to, not the full unfiltered
  // list) — closes the one place a number could otherwise leak through as
  // model output rather than a code-owned identity passthrough.
  for (const item of judgment.equipment_items) {
    if (!equipmentIndices.includes(item.morning_item_index)) {
      throw new Error(
        `Model returned morning_item_index ${item.morning_item_index}, not one of the eligible indices sent: ${equipmentIndices.join(', ')}`,
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
export async function callDprModel(client: Anthropic, promptText: string, facts: DprFacts): Promise<GenerateResult> {
  const start = Date.now()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 8192,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText }],
    output_config: { format: { type: 'json_schema', schema: buildPerCallSchema(facts) } },
  })
  const latency_ms = Date.now() - start
  const textBlock = response.content.find((b) => b.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`)
  }
  const judgment = JSON.parse(textBlock.text) as DprJudgment
  // Normalize — see generateDprJudgment's identical comment for why.
  judgment.equipment_items = judgment.equipment_items ?? []
  judgment.manpower_idle_reason_note = judgment.manpower_idle_reason_note ?? ''
  judgment.schedule_miss_reason_note = judgment.schedule_miss_reason_note ?? ''
  judgment.tomorrows_plan_carry_forward_note = judgment.tomorrows_plan_carry_forward_note ?? ''
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
  const cost_usd = (usage.input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return { judgment, usage, latency_ms, cost_usd }
}

// ===========================================================================
// PER-ENGINEER REPORT (docs/dpr-engineer-report-spec.md) — a second,
// parallel generator for a different report, added alongside everything
// above, not a replacement. generateDprJudgment/callDprModel above are
// UNCHANGED and stay live for the deferred project-level report.
// ===========================================================================

function fmtFactNumber(c: { status: string; value: number | null }): string {
  return c.status === 'reported' || c.status === 'zero' ? String(c.value) : 'not reported'
}

function fmtFactText(c: { status: string; value: string | null }): string {
  return c.status === 'reported' && c.value !== null ? c.value : 'not reported'
}

// The model's input for the per-engineer report — Facts (the boundary on
// what it may OUTPUT: every digit must trace to one of these) plus raw
// narrative text (READ-only prompt input, never digit-bearing itself in
// any way the model is permitted to restate as a NEW number — the
// containment check on the response is what actually enforces that
// boundary, not this function). Raw text is what lets the verdict say
// something like the spec's own sample, "3 workers were idle waiting for
// material" — "waiting for material" exists nowhere in Facts.
function formatEngineerFacts(facts: EngineerDprFacts, narrative: EngineerNarrativeContext | null, meta: { project_name: string; log_date: string }): string {
  const lines: string[] = []
  lines.push(`Project: ${meta.project_name}, ${meta.log_date}`)
  lines.push('')
  lines.push(`Work — planned: ${fmtFactText(facts.work.planned)}`)
  lines.push(`Work — done: ${fmtFactText(facts.work.done_text)}${facts.work.done_quantity.status === 'reported' ? `, ${facts.work.done_quantity.value} ${facts.work.unit}` : ''}`)
  lines.push(`Hindrance: ${fmtFactText(facts.hindrance.note)}`)
  for (const trade of facts.idle_hours_by_trade) {
    lines.push(`Idle hours, ${trade.trade}: ${trade.idle_hours}h`)
  }
  for (const item of facts.equipment.items) {
    lines.push(
      `Equipment ${item.type} — used ${fmtFactNumber(item.actual_hours)}h${item.implausible ? ' (flagged implausible -- do not restate as fact, only that it was flagged)' : ''}`,
    )
  }
  if (narrative?.hindrance_note) lines.push(`\nRaw hindrance note (context only, never a source of a new digit): ${narrative.hindrance_note}`)
  // Manpower, CHANGED 2026-09-05 (the "113 fabrication" incident,
  // schema.ts's own EngineerManpowerFacts comment). Both used to be
  // fmtFactNumber'd into the citable Facts section above -- removed
  // because the underlying values are parser-summed, not engineer-stated
  // (parseLabourCount sums every digit found in free text; no concept of
  // a stated total distinct from a breakdown). Raw text only, context-only,
  // same treatment as manpower_idle_reason directly below: the model may
  // read it for color, never cite a number out of it as a new Fact.
  if (facts.manpower.planned.status === 'reported') {
    lines.push(`Raw manpower planned, morning (context only, never a source of a new digit): ${facts.manpower.planned.value}`)
  }
  if (facts.manpower.on_site.status === 'reported') {
    lines.push(`Raw manpower reported, evening (context only, never a source of a new digit): ${facts.manpower.on_site.value}`)
  }
  if (narrative?.manpower_idle_reason) lines.push(`Raw manpower idle reason (context only): ${narrative.manpower_idle_reason}`)
  for (const eq of narrative?.equipment_idle_reasons ?? []) {
    if (eq.idle_reason) lines.push(`Raw equipment idle reason, ${eq.type} (context only): ${eq.idle_reason}`)
  }
  return lines.join('\n')
}

// THE EXCLUSION SENTENCE BELOW WAS MISSING UNTIL 2026-09-05 (the "113
// fabrication" incident's second half). The aggregate/deferred path's own
// SYSTEM_PROMPT (above in this file) already had the equivalent sentence
// ("never a number from manpower, equipment, or narrative context, even
// if that number is real elsewhere in this report") -- this prompt, the
// one that actually ships, did not. Without it, "Every digit you write
// must be traceable to a number shown in the Facts you were given" does
// NOT exclude the raw manpower/hindrance/idle-reason context lines below
// (formatEngineerFacts) -- a number inside them (e.g. "25" in "CIVIL Team
// 25 nos") genuinely IS "a number shown ... you were given," so the model
// citing it as a fact ("the site had a full civil team of 25") was never
// actually forbidden. Named as its own pattern in the admin-merge
// retrospective: the third time this session a safeguard turned out to
// live only in code that doesn't run (isHireRateTrusted on the deferred
// project-level assembler; the buildBodyCorpus comment; now this prompt).
const ENGINEER_SYSTEM_PROMPT =
  'You write ONE sentence summarising a construction site engineer\'s day, from Facts already computed elsewhere. ' +
  'Every digit you write must be traceable to a number shown in the Facts you were given — never invent, round, or recompute a figure. ' +
  'You may cite a digit ONLY if it appears in a line stated as a Fact above — never a number from a line marked "context only" (hindrance, manpower planned, manpower reported, manpower idle reason, or equipment idle reason), even if that number is real elsewhere in this report. ' +
  'Never attribute anything to a named person, crew, or contractor — describe only what was done, where, and how much. ' +
  'If the Facts are mostly empty, say so plainly in one short sentence rather than padding.'

export interface EngineerVerdictResult {
  verdict: string
  verdict_status: 'model' | 'placeholder'
  usage: { input_tokens: number; output_tokens: number } // summed across attempts
  latency_ms: number // summed across attempts
  cost_usd: number // summed across attempts
  attempts: number
}

// S10: at most ONE immediate in-process retry on containment failure, then
// the placeholder — never throws, never involves markDprGenerationFailed,
// never touches the external job-retry path at all. renderedBody is the
// ALREADY-RENDERED report body (renderEngineerBody, render.ts) — the
// containment corpus is built from it directly (S1/S9), not from Facts.
export async function generateEngineerVerdict(
  client: Anthropic,
  facts: EngineerDprFacts,
  narrative: EngineerNarrativeContext | null,
  renderedBody: string,
  meta: { project_name: string; log_date: string },
): Promise<EngineerVerdictResult> {
  const corpus = extractDigitTokens(renderedBody)
  const promptText = formatEngineerFacts(facts, narrative, meta)

  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalLatencyMs = 0

  for (let attempt = 1; attempt <= 2; attempt++) {
    const start = Date.now()
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: 512,
      system: ENGINEER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: promptText }],
      output_config: { format: { type: 'json_schema', schema: ENGINEER_DPR_JUDGMENT_SCHEMA } },
    })
    totalLatencyMs += Date.now() - start
    totalInputTokens += response.usage.input_tokens
    totalOutputTokens += response.usage.output_tokens

    // S1 (round-4): a missing text block or malformed/truncated JSON is a
    // MODEL-OUTPUT problem, same class as a containment failure — not a
    // transport/API failure. max_tokens: 512 makes truncation (stop_reason:
    // 'max_tokens') a real way to reach this: a cut-off response yields
    // unparseable JSON. Caught HERE, per-attempt, so it falls through to
    // the retry / placeholder the exact same way a containment failure
    // does — never escapes this loop to the caller's catch block, which
    // would revert the claim, throw past a report whose BODY (code-owned,
    // already correct) is fully ready, and risk markDprGenerationFailed
    // for a problem that has nothing to do with whether a report can
    // exist. Only the client.messages.create call above is allowed to
    // throw past this loop — a genuine transport/API failure, correctly
    // routed to the external job-retry path.
    let judgment: { verdict: string } | undefined
    try {
      const textBlock = response.content.find((b) => b.type === 'text')
      if (!textBlock || textBlock.type !== 'text') {
        throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`)
      }
      const parsed = JSON.parse(textBlock.text) as { verdict?: unknown }
      if (typeof parsed.verdict !== 'string') {
        throw new Error(`Parsed response has no string 'verdict' field: ${textBlock.text}`)
      }
      judgment = { verdict: parsed.verdict }
    } catch {
      continue // same as a containment failure: attempt 2, then the placeholder
    }

    const result = checkContainment(judgment.verdict, corpus)
    if (result.ok) {
      const cost_usd = (totalInputTokens / 1_000_000) * INPUT_COST_PER_MTOK + (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK
      return {
        verdict: judgment.verdict,
        verdict_status: 'model',
        usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
        latency_ms: totalLatencyMs,
        cost_usd,
        attempts: attempt,
      }
    }
    // Falls through to attempt 2 (the ONE immediate in-process retry) on
    // the first failure; falls through to the placeholder below on the
    // second.
  }

  const cost_usd = (totalInputTokens / 1_000_000) * INPUT_COST_PER_MTOK + (totalOutputTokens / 1_000_000) * OUTPUT_COST_PER_MTOK
  return {
    verdict: '', // caller (dispatch.ts) substitutes CONTAINMENT_FAILURE_PLACEHOLDER (render.ts) — kept out of generate.ts so the placeholder's copy lives in one place, the renderer
    verdict_status: 'placeholder',
    usage: { input_tokens: totalInputTokens, output_tokens: totalOutputTokens },
    latency_ms: totalLatencyMs,
    cost_usd,
    attempts: 2,
  }
}
