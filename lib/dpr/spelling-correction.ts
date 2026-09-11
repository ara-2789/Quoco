import Anthropic from '@anthropic-ai/sdk'
import type { CapturedText } from './schema'

// Stage 2 of the DPR format redesign (2026-09-11,
// docs/plans/dpr-format-redesign.md §1) -- spelling-only correction for
// WORK's two free-text fields ("Morning plan" / "Work completed"). This
// module is DELIBERATELY NOT WIRED IN YET: nothing in dispatch.ts,
// assemble.ts, schema.ts (EngineerWorkFacts), or render.ts calls or
// consumes this file. It exists in full, independently tested, so its
// exact prompt text and guard rules can be reviewed and approved before
// any live report's WORK section ever passes through it -- Aravind's own
// instruction, because this is the one piece of the redesign that can
// silently change what an engineer actually said.
//
// GOVERNING CONSTRAINT (spec Rule 2b, narrowed -- a dated, deliberate
// partial reversal, not a new rule): fix misspelled words ONLY. Never fix
// grammar, never restructure a sentence, never rephrase. "cemant lorry not
// arived" -> "cement lorry not arrived". "Cement lorry not arrived, slab
// pour stopped" is returned byte-identical -- nothing about that sentence
// is a misspelling.
//
// TWO INDEPENDENT LAYERS, belt-and-suspenders, same posture this codebase
// already uses for digit containment (containment.ts):
//   1. The PROMPT (ENGINEER_SPELLING_SYSTEM_PROMPT below) states the
//      constraint to the model directly.
//   2. checkSpellingGuard (below) is a CODE-LEVEL check run on every
//      response, independent of whether the model followed the prompt.
//      Prompts drift; the guard does not. A field that fails the guard
//      falls back to its own raw text, unmodified -- never the model's
//      output, never a partial edit.

// ---------------------------------------------------------------------
// THE GUARD -- exact rules, stated once here, restated in the review
// report for approval:
//
//   1. WORD COUNT must match exactly between raw and corrected. Any
//      inserted, removed, merged, or split word fails the whole field.
//      This alone catches rephrasing and restructuring.
//   2. Per word position: if EITHER the raw or the corrected token
//      contains a digit, the two tokens must be BYTE-IDENTICAL. No
//      "spelling correction" is ever allowed to touch a number, unit
//      figure, or date -- this is the same digit-provenance concern
//      containment.ts already exists to protect, applied here before a
//      digit can ever be silently altered in the first place.
//   3. Per word position: leading/trailing punctuation attached to the
//      token must be UNCHANGED. Punctuation is not spelling.
//   4. Per word position: the punctuation-stripped "core" of the word may
//      differ only within a small edit-distance ceiling -- a genuine
//      typo fix, not a different word. Ceiling: the LARGER of 1 and 40%
//      of the raw word's length (rounded up), capped at 4 characters
//      absolute either way. Case is ignored for this comparison (a pure
//      capitalisation change costs nothing against the ceiling).
//   5. Any single word failing (2), (3), or (4), or the field failing
//      (1), fails the WHOLE FIELD -- that field falls back to its raw
//      text unmodified. The OTHER field's result is unaffected (per-field
//      isolation, Aravind's explicit instruction).
// ---------------------------------------------------------------------

export interface SpellingGuardResult {
  ok: boolean
  // Present only when ok is false -- for logs/tests, never shown to a
  // user. Names which rule failed and where.
  reason?: string
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = 0; i <= a.length; i++) dp[i][0] = i
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    }
  }
  return dp[a.length][b.length]
}

// Strips leading/trailing non-alphanumeric characters, returning the
// three parts separately so punctuation can be compared for exact
// equality (rule 3) while the alphanumeric core is compared by edit
// distance (rule 4).
function splitToken(token: string): { lead: string; core: string; trail: string } {
  let start = 0
  let end = token.length
  while (start < end && !/[\p{L}\p{N}]/u.test(token[start])) start++
  while (end > start && !/[\p{L}\p{N}]/u.test(token[end - 1])) end--
  return { lead: token.slice(0, start), core: token.slice(start, end), trail: token.slice(end) }
}

const HAS_DIGIT = /\d/

export function checkSpellingGuard(raw: string, corrected: string): SpellingGuardResult {
  const rawTokens = raw.split(/\s+/).filter(Boolean)
  const correctedTokens = corrected.split(/\s+/).filter(Boolean)

  if (rawTokens.length !== correctedTokens.length) {
    return { ok: false, reason: `word count changed: ${rawTokens.length} -> ${correctedTokens.length}` }
  }

  for (let i = 0; i < rawTokens.length; i++) {
    const rawTok = rawTokens[i]
    const corTok = correctedTokens[i]
    if (rawTok === corTok) continue

    if (HAS_DIGIT.test(rawTok) || HAS_DIGIT.test(corTok)) {
      return { ok: false, reason: `digit token changed at position ${i}: "${rawTok}" -> "${corTok}"` }
    }

    const rawParts = splitToken(rawTok)
    const corParts = splitToken(corTok)
    if (rawParts.lead !== corParts.lead || rawParts.trail !== corParts.trail) {
      return { ok: false, reason: `punctuation changed at position ${i}: "${rawTok}" -> "${corTok}"` }
    }

    const distance = levenshtein(rawParts.core.toLowerCase(), corParts.core.toLowerCase())
    const ceiling = Math.min(4, Math.max(1, Math.ceil(rawParts.core.length * 0.4)))
    if (distance > ceiling) {
      return { ok: false, reason: `word changed too much at position ${i}: "${rawTok}" -> "${corTok}" (distance ${distance} > ceiling ${ceiling})` }
    }
  }

  return { ok: true }
}

// ---------------------------------------------------------------------
// THE MODEL CALL -- ONE call covering both fields (Aravind's decision,
// docs/plans/dpr-format-redesign.md §1: fewer round trips, lower cost).
// Skipped entirely when neither field has real text -- nothing to
// correct, no reason to spend a call.
// ---------------------------------------------------------------------

const MODEL = 'claude-sonnet-5'
// Same figures as generate.ts's own verdict call, verified there
// 2026-08-11 against the claude-api skill's cached pricing table at the
// STANDARD rate -- not re-verified independently here, deliberately kept
// in sync with that file's own constant rather than risking the two
// drifting apart. If generate.ts's figures are ever updated, update this
// one in the same pass.
const INPUT_COST_PER_MTOK = 3.0
const OUTPUT_COST_PER_MTOK = 15.0

const NOT_PROVIDED = '(not provided)'

// Proposed for Aravind's approval -- restated verbatim in the Stage 2
// review report, not paraphrased there. Seven numbered rules, none
// optional, mirroring the guard's own five rules above but stated to the
// model BEFORE the guard ever runs, not as a substitute for it.
export const ENGINEER_SPELLING_SYSTEM_PROMPT =
  'You correct ONLY misspelled English words in two short free-text notes written by a construction site engineer over WhatsApp. Rules, all of them, none optional: ' +
  '(1) Fix a word\'s spelling ONLY when it is clearly a misspelling of a standard English word. ' +
  '(2) Never change grammar, sentence structure, punctuation, capitalisation, or word order. ' +
  '(3) Never add, remove, merge, or split any word. ' +
  '(4) Never rephrase or reword for clarity, tone, or brevity. ' +
  '(5) Never touch any number, unit, or digit, under any circumstance. ' +
  '(6) If a word might be a proper noun, a site-specific or trade term, an abbreviation, or non-standard usage you are not certain is a misspelling, leave it exactly as written. ' +
  `(7) If a note reads exactly "${NOT_PROVIDED}", return it back exactly as "${NOT_PROVIDED}", unchanged. ` +
  'Return each corrected note as a single string with the exact same number of words, in the exact same order, as the note you were given -- you are changing individual words\' spelling, nothing else.'

export const ENGINEER_SPELLING_CORRECTION_SCHEMA = {
  type: 'object',
  properties: {
    planned_corrected: {
      type: 'string',
      maxLength: 2000,
      description: 'The "Morning plan" note with only misspelled words fixed, same word count and order.',
    },
    done_text_corrected: {
      type: 'string',
      maxLength: 2000,
      description: 'The "Work completed" note with only misspelled words fixed, same word count and order.',
    },
  },
  required: ['planned_corrected', 'done_text_corrected'],
  additionalProperties: false,
} as const

export type WorkTextFieldStatus = 'not_attempted' | 'corrected' | 'fallback_raw'

export interface EngineerWorkTextCorrectionResult {
  planned: CapturedText
  planned_status: WorkTextFieldStatus
  done_text: CapturedText
  done_text_status: WorkTextFieldStatus
  model_called: boolean
  usage: { input_tokens: number; output_tokens: number }
  latency_ms: number
  cost_usd: number
}

function notAttempted(raw: CapturedText): { field: CapturedText; status: WorkTextFieldStatus } {
  return { field: raw, status: 'not_attempted' }
}

/**
 * Corrects spelling only, in place, for the WORK section's two free-text
 * fields. NOT wired into any render or assembly path yet -- see this
 * file's own header. Each field's own raw CapturedText is passed straight
 * through (status 'not_attempted') when it was never reported; a reported
 * field is corrected and guard-checked, falling back to its own raw text
 * (status 'fallback_raw') if the guard rejects it. Per-field isolation:
 * one field's guard failure never discards the other field's valid
 * correction (Aravind's explicit instruction).
 */
export async function correctEngineerWorkText(client: Anthropic, planned: CapturedText, doneText: CapturedText): Promise<EngineerWorkTextCorrectionResult> {
  const plannedRaw = planned.status === 'reported' ? planned.value : null
  const doneTextRaw = doneText.status === 'reported' ? doneText.value : null

  if (plannedRaw === null && doneTextRaw === null) {
    return {
      ...notAttemptedPair(planned, doneText),
      model_called: false,
      usage: { input_tokens: 0, output_tokens: 0 },
      latency_ms: 0,
      cost_usd: 0,
    }
  }

  const promptText = ['Morning plan:', plannedRaw ?? NOT_PROVIDED, '', 'Work completed:', doneTextRaw ?? NOT_PROVIDED].join('\n')

  const start = Date.now()
  const response = await client.messages.create({
    model: MODEL,
    max_tokens: 800,
    system: ENGINEER_SPELLING_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: promptText }],
    output_config: { format: { type: 'json_schema', schema: ENGINEER_SPELLING_CORRECTION_SCHEMA } },
  })
  const latency_ms = Date.now() - start
  const usage = { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens }
  const cost_usd = (usage.input_tokens / 1_000_000) * INPUT_COST_PER_MTOK + (usage.output_tokens / 1_000_000) * OUTPUT_COST_PER_MTOK

  // A missing text block or malformed/truncated JSON falls both fields
  // back to raw -- same "model-output problem, not a transport failure"
  // class generate.ts's own S1 handling treats per-attempt, but with no
  // retry here (Aravind's "ONE model call," not "one call plus retries").
  let parsed: { planned_corrected?: unknown; done_text_corrected?: unknown } | undefined
  try {
    const textBlock = response.content.find((b) => b.type === 'text')
    if (!textBlock || textBlock.type !== 'text') throw new Error(`No text block in response. stop_reason: ${response.stop_reason}`)
    parsed = JSON.parse(textBlock.text) as { planned_corrected?: unknown; done_text_corrected?: unknown }
  } catch {
    return { ...notAttemptedFallbackPair(planned, doneText, plannedRaw, doneTextRaw), model_called: true, usage, latency_ms, cost_usd }
  }

  const plannedResult = resolveField(planned, plannedRaw, parsed.planned_corrected)
  const doneTextResult = resolveField(doneText, doneTextRaw, parsed.done_text_corrected)

  return {
    planned: plannedResult.field,
    planned_status: plannedResult.status,
    done_text: doneTextResult.field,
    done_text_status: doneTextResult.status,
    model_called: true,
    usage,
    latency_ms,
    cost_usd,
  }
}

function notAttemptedPair(planned: CapturedText, doneText: CapturedText) {
  const p = notAttempted(planned)
  const d = notAttempted(doneText)
  return { planned: p.field, planned_status: p.status, done_text: d.field, done_text_status: d.status }
}

// Both fields fall back to raw (parse failure -- no per-field signal to
// isolate on, since the response itself couldn't be read at all). A field
// that was never reported in the first place stays 'not_attempted', not
// 'fallback_raw' -- there was nothing to fall back FROM.
function notAttemptedFallbackPair(planned: CapturedText, doneText: CapturedText, plannedRaw: string | null, doneTextRaw: string | null) {
  return {
    planned: planned,
    planned_status: (plannedRaw === null ? 'not_attempted' : 'fallback_raw') as WorkTextFieldStatus,
    done_text: doneText,
    done_text_status: (doneTextRaw === null ? 'not_attempted' : 'fallback_raw') as WorkTextFieldStatus,
  }
}

function resolveField(raw: CapturedText, rawValue: string | null, correctedValue: unknown): { field: CapturedText; status: WorkTextFieldStatus } {
  if (rawValue === null) return notAttempted(raw)
  if (typeof correctedValue !== 'string' || correctedValue === NOT_PROVIDED) {
    return { field: raw, status: 'fallback_raw' }
  }
  const guard = checkSpellingGuard(rawValue, correctedValue)
  if (!guard.ok) {
    return { field: raw, status: 'fallback_raw' }
  }
  return { field: { status: 'reported', value: correctedValue }, status: 'corrected' }
}
