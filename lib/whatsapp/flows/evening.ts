import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import type { SessionFlow, WhatsAppSession } from '@/lib/whatsapp/session'
import { classifyYesNo, equipmentLabel } from './parsers/lexicon'
import { parseQuantities, type QuantitiesParse } from './parsers/quantities'
import { parseLabourCount, isLabourAnswered } from './parsers/labour'
import { parseProductivity, isProductivityAnswered } from './parsers/productivity'
import {
  parseEquipmentHours,
  isEquipmentHoursAnswered,
  type EquipmentHoursParse,
} from './parsers/equipment-hours'

// Evening check-in flow. Pass 1 (022) shipped the first three questions; Pass
// 2 (024) adds Q4 (two steps) and Q5:
//   Q1 "Work completed + quantity"  -> daily_logs.evening_output (+ quantities)  (step 1)
//   Q2 "Plan met?"                  -> daily_logs.evening_schedule_met           (step 2, parsed)
//   Q3 "Why not?"                   -> daily_logs.evening_schedule_miss_reason   (step 3, CONDITIONAL)
//   Q4a "Headcount"                 -> daily_logs.evening_workers_on_site        (step 4, parsed, reuses parseLabourCount)
//   Q4b "Productivity/idle"         -> daily_logs.evening_productive_manpower    (step 5, parsed, AGGREGATE-ONLY)
//   Q5 "Equipment hours"            -> daily_logs.evening_equipment_utilisation  (step 6, parsed, AUTO-SKIPPABLE)
// Q6 (tomorrow's dependencies) is OUT OF SCOPE — no existing parser precedent
// for required_by_time on either side of the flow; tracked, not solved here
// (024_evening_flow_q4_q5.sql's own header).
//
// STEP IDS ARE NOT QUESTION NUMBERS. Q3 only fires when Q2 = No, Q4 occupies
// TWO steps, and Q5 auto-skips when the morning equipment list is empty.
// Every advance below assigns its next step explicitly. Anything that
// "simplifies" this into an increment breaks the conditional edges silently.
//
// AUTHORITY NOTE: dispatchEveningFlow below is a PURE mirror of the decision
// logic in supabase/migrations/024_evening_flow_q4_q5.sql, for unit tests and
// documentation. It is NOT authoritative — production behaviour is entirely
// determined by that RPC (which owns the row lock, the BOT-07 next-day reset,
// the Q5 auto-skip's daily_logs read, and the atomic session + daily_logs
// writes). A green dispatchEveningFlow unit test is not on its own proof of
// production correctness; the integration tests against apply_evening_flow_turn
// are. The mirror CANNOT read daily_logs itself (it has zero IO by design,
// same as morning's mirror) — callers that want to exercise the Q5 auto-skip
// decision pass a snapshot via options.morningEquipmentItems, exactly like
// `now` is already injected for determinism. A caller that omits it gets the
// "no morning equipment" (skip) behaviour by default, since that's the safer
// default for a test that isn't specifically about the skip decision.
//
// TRACKED (2026-08-08, not fixed) — DOES THIS MIRROR HAVE A PURPOSE AT ALL?
// Checked, not assumed: dispatchEveningFlow (and matchEquipmentHoursItems)
// have ZERO references anywhere in test/ — no unit test calls them, and
// nothing in production code calls them either (dispatchInboundTurn and
// route.ts both call applyEveningFlowTurn directly, never this function).
// The pattern itself is NOT vestigial, though — morning's own mirror
// (dispatchMorningFlow) has the identical "not authoritative, for tests and
// docs" framing AND real, dedicated coverage (test/unit/morning-dispatch.
// test.ts, 15 tests exercising its decision logic directly, in isolation,
// with no RPC/DB involved). That comparison is the point: this pattern WAS
// load-bearing when built out fully. Evening's copy of it is incomplete by
// omission, not vestigial by design — it was written to the same contract
// morning's mirror keeps, just never given the test half that gives a pure
// mirror its reason to exist. The fix this points toward, if ever built, is
// almost certainly NOT "delete the mirror" but "give it what morning's
// already has" — a dedicated test/unit/evening-dispatch.test.ts exercising
// dispatchEveningFlow's decisions (including matchEquipmentHoursItems' tier
// logic) directly, the same shape as morning-dispatch.test.ts, not a
// cross-check against the RPC. Not built. Scope it in or leave it tracked —
// this comment is the record either way.

// ---------------------------------------------------------------------------
// Outcomes. Unchanged by Pass 2 — the same six outcomes cover every step.
export type EveningOutcome =
  | 'start'
  | 'advance'
  | 'already_complete'
  | 'idle'
  | 'reask'
  | 'wrong_flow'

// The in-scope step ids, in order. Q6 (tomorrow's dependencies) is NOT here —
// out of scope for Pass 2, see the file header.
export const EVENING_STEP_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6]

// One reask per parsed question on an unclassifiable answer (Rule 3.5).
// Shared by every parsed step (2, 4, 5, 6) — not step-specific in its
// definition, only in how each step's own counter is keyed.
export const EVENING_PARSE_REASK_CAP = 1

// Context keys holding the per-step reask counters and Q4's intermediate
// headcount value. Prefixed 'e' + step number so evening's counters can never
// collide with morning's q1_reask/q3_reask/q4_reask/q5_reask (renamed by
// 030_morning_flow_attendance.sql) inside the SAME context object — both
// flows can run on one calendar day and the context is shared.
export const EVENING_Q2_REASK_KEY = 'e2_reask'
export const EVENING_Q4_REASK_KEY = 'e4_reask'
export const EVENING_Q4_HEADCOUNT_KEY = 'e4_headcount'
export const EVENING_Q5_REASK_KEY = 'e5_reask'
export const EVENING_Q6_REASK_KEY = 'e6_reask'

// Context marker set when the evening flow completes. Kept distinct from
// morning_submitted; evening MERGES this in rather than replacing the context.
export const EVENING_SUBMITTED_KEY = 'evening_submitted'

// Every one of evening's own in-flight keys — stripped (never left behind) on
// both a fresh start and completion. See CONTEXT DISCIPLINE in the migration
// header for why a restart must strip the FULL set, not just e2_reask.
const EVENING_IN_FLIGHT_KEYS: readonly string[] = [
  EVENING_Q2_REASK_KEY,
  EVENING_Q4_REASK_KEY,
  EVENING_Q4_HEADCOUNT_KEY,
  EVENING_Q5_REASK_KEY,
  EVENING_Q6_REASK_KEY,
]

// ---------------------------------------------------------------------------
// Reply copy — the SINGLE source of question/completion text, shared by the
// pure mirror (tests) and the webhook (production, keyed off the RPC's
// returned outcome + current_step), so the two can never diverge on copy.
// Steps 1-5 are static; step 6 (Q5) is DATA-DRIVEN — see buildEveningReply.
export const EVENING_QUESTIONS: Readonly<Record<number, string>> = {
  1: 'Evening check-in 🌇 What *work was completed* today? Add the quantity if you can — e.g. "slab concrete 120 sqm".',
  2: "Did you *meet today's plan*? Reply *yes* or *no*.",
  3: 'Got it. What *stopped the plan* being met today?',
  4: 'How many *workers* are on site right now? Just send a number.',
  5: 'Were they *all productive*, or was anyone idle? Reply *yes* if all productive, or tell us how many were idle and why — e.g. "2 idle, waiting for cement".',
}

export const EVENING_COMPLETE_REPLY =
  '✅ Evening check-in complete. Thanks — rest well!'

export const EVENING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's evening check-in. ✅ Nothing more needed."

// idle produces no outbound message (no active flow, nothing to say).
export const EVENING_IDLE_REPLY = ''

// wrong_flow is never rendered: the webhook retries against the other RPC and
// replies with THAT result. Present so buildEveningReply is total.
export const EVENING_WRONG_FLOW_REPLY = ''

// A minimal shape for the echoed morning equipment list — only what Q5's
// prompt needs to render. Mirrors the RPC's `equipment_echo` return value
// (morning_equipment->'items', see the migration's ECHO ORDER note) and the
// pure mirror's injected options.morningEquipmentItems.
//
// TRACKED DEBT (2026-08-08, not fixed): this type UNDER-describes what the
// RPC actually returns. `v_equipment_echo := v_morning_equipment->'items'`
// (024_evening_flow_q4_q5.sql) hands back the FULL stored morning_equipment
// item — type, count, daily_hire_cost, owned_or_hired, raw — not a
// {type}-only projection (found via a real test failure, T-024-16, which
// asserted the narrower shape this type claims). Harmless today: nothing
// reads the extra fields, and TS's structural typing doesn't complain about
// a value carrying MORE than its declared type. Costs someone real time the
// day they need daily_hire_cost off the echo (e.g. rendering "JCB — hired
// at ₹1500/day" in the Q5 prompt) and this type says it isn't there. Fix
// either by widening this type to match, or by having the RPC actually
// project down to {type} at the source — not decided, not built.
export interface EquipmentEchoItem {
  type: string
}

// Q5's prompt is built from the morning equipment list, in the SAME order the
// list is stored — that fixed order IS the join-key guarantee the migration's
// EQUIPMENT JOIN KEY note relies on (the engineer's Nth reply chunk maps back
// to the Nth echoed machine by construction of this exact template).
// WORDING, revised 2026-08-10 (sandbox smoke test — TIER 1 needs a labelled
// reply to be reachable, and the original wording put the decoding AFTER
// the example: "1) 8 6 waiting for fuel" ... "(available hours, actual
// hours run, idle reason)" — someone scanning on a phone reads the example
// before knowing what the numbers mean, and the example itself omitted the
// leading "1)", so a terse reply pattern-matches the unlabelled part of the
// example, not the "in this order" instruction. Decoding now comes FIRST,
// the example is labelled, "reply with its number" is imperative rather
// than implied by "in this order". "hours on site" replaces "available
// hours" — more concrete to a site engineer. Not yet confirmed against a
// real handset; that confirmation is the whole point of the sandbox run
// this wording was written for.
export function buildEquipmentHoursPrompt(items: readonly EquipmentEchoItem[]): string {
  const lines = items.map((item, i) => `${i + 1}) ${equipmentLabel(item.type)}`).join('\n')
  return (
    'For each machine below, reply with its number, hours on site, hours ' +
    'actually run, and a reason if it was idle. Like this: 1) 8 6 waiting for fuel\n' +
    lines
  )
}

/**
 * Build the outbound reply for a resolved turn, from the outcome and the
 * post-turn current_step. Completion is signalled by outcome 'advance' with
 * current_step 0 (the RPC resets the step to 0 when the flow completes).
 * `equipmentEcho` is REQUIRED to render step 6's prompt (both on advancing
 * INTO step 6 and on a reask while step 6 is active — the RPC returns it on
 * both paths, see the migration header) and is ignored for every other step.
 */
export function buildEveningReply(
  outcome: EveningOutcome,
  currentStep: number,
  equipmentEcho?: readonly EquipmentEchoItem[],
): string {
  switch (outcome) {
    case 'start':
      return EVENING_QUESTIONS[1]
    case 'advance':
      if (currentStep === 0) return EVENING_COMPLETE_REPLY
      if (currentStep === 6) return buildEquipmentHoursPrompt(equipmentEcho ?? [])
      return EVENING_QUESTIONS[currentStep] ?? ''
    case 'reask':
      if (currentStep === 6) return buildEquipmentHoursPrompt(equipmentEcho ?? [])
      return EVENING_QUESTIONS[currentStep] ?? ''
    case 'already_complete':
      return EVENING_ALREADY_COMPLETE_REPLY
    case 'idle':
      return EVENING_IDLE_REPLY
    case 'wrong_flow':
      return EVENING_WRONG_FLOW_REPLY
  }
}

// ---------------------------------------------------------------------------
// Pure decision mirror. ZERO Supabase calls — computes the write AS DATA and
// returns it; never executes anything. Operates on the session snapshot it is
// GIVEN: the BOT-07 next-day reset and the row lock are the RPC's job and are
// intentionally NOT re-implemented here. Q5's auto-skip decision needs
// morning_equipment, which lives in daily_logs, not session/context — the
// caller injects a snapshot via options.morningEquipmentItems (see the
// AUTHORITY NOTE above), the same pattern `now` already uses for determinism.

export type EveningDailyLogWrite = Partial<{
  evening_output: string
  evening_output_quantities: QuantitiesParse
  evening_schedule_met: boolean
  evening_schedule_miss_reason: string
  evening_workers_on_site: number | null // null when step 4's own budget was exhausted unparsed — see migration FIX 1
  evening_productive_manpower: {
    // NOT ProductivityParse's own all_productive — matches the RPC's ACTUAL
    // stored shape (024_evening_flow_q4_q5.sql), which never stores
    // all_productive at all. Found as a real shape mismatch while fixing the
    // two CONFIDENCE FLAG bugs below, corrected here rather than left.
    productive_count: number | null // null when headcount OR idle_count is null, OR when a
    // stated productive_count contradicted a stated idle_count (they don't
    // sum to headcount) — invalidated, never a tiebreak (2026-08-10)
    idle_count: number | null // null means genuinely unknown, never defaulted to 0 — same
    // contradiction case invalidates this too, together with productive_count
    idle_reason: string | null
    raw_text: string
    confidence: 'high' | 'low'
  }
  evening_equipment_utilisation: {
    items: Array<{
      morning_item_index: number | null
      type: string | null
      available_hours: number | null
      actual_hours: number | null
      idle_reason: string | null
      raw: string | null // null on a "not reported" entry (Case B — see MATCH TIERS)
      /** MATCH TIERS confidence — a DIFFERENT signal from the outer field below. */
      confidence: 'high' | 'low' | null
    }>
    raw_text: string | null
    /** Accept-after-budget-exhausted signal — see the migration's CONFIDENCE FLAG note. */
    confidence: 'high' | 'low' | null
  }
  evening_submitted_at: string
}>

export interface EveningDispatch {
  outcome: EveningOutcome
  reply: string
  sessionUpdate: { current_step?: number; context?: Record<string, unknown> }
  dailyLogWrite: EveningDailyLogWrite | null
  /** Only set when current_step becomes 6 (advance or reask) — see buildEveningReply. */
  equipmentEcho?: readonly EquipmentEchoItem[]
}

export interface EveningDispatchOptions {
  /** Mirrors the RPC's p_start_flow (env-gated test trigger). */
  startFlow?: boolean
  /** Instant used for *_submitted_at; injectable so tests are deterministic. */
  now?: string
  /**
   * Snapshot of morning_equipment.items for THIS engineer/day, as the RPC
   * would read it under its lock. Drives Q5's auto-skip (BOT-22) and the
   * echo/join simulation. undefined or an empty array both mean "skip Q5" —
   * matching the RPC's own `IS NULL OR jsonb_array_length(...) = 0` test
   * (see the migration's BOT-22 NULL CASE note); there is no way to express
   * "genuinely unknown" here on purpose, since the mirror has no read to
   * fall back on.
   */
  morningEquipmentItems?: ReadonlyArray<{ type: string }>
}

/** One resolved entry in evening_equipment_utilisation.items — see the migration's STORAGE SHAPES note. */
export interface EquipmentUtilisationItem {
  morning_item_index: number | null
  type: string | null
  available_hours: number | null
  actual_hours: number | null
  idle_reason: string | null
  raw: string | null
  confidence: 'high' | 'low' | null
}

/**
 * MANUAL mirror of the RPC's MATCH TIERS (024_evening_flow_q4_q5.sql) — not
 * shared code, TypeScript can't call the SQL and vice versa, so this is a
 * by-hand reimplementation kept in the same order and logic on purpose, so a
 * divergence is a diff away from being spotted rather than buried in two
 * unrelated-looking implementations. See the migration's EQUIPMENT JOIN KEY /
 * MATCH TIERS note for the full reasoning behind each tier; not restated here.
 */
function matchEquipmentHoursItems(
  chunks: ReadonlyArray<{
    label: number | null
    canonical_type: string | null
    available_hours: number | null
    actual_hours: number | null
    idle_reason: string | null
    raw: string
  }>,
  morningItems: ReadonlyArray<{ type: string }>,
): EquipmentUtilisationItem[] {
  const claimed = new Array<boolean>(morningItems.length).fill(false)
  const chunkMorningIdx = new Array<number | null>(chunks.length).fill(null)
  const chunkConfidence = new Array<'high' | 'low' | null>(chunks.length).fill(null)

  // TIER 1 — explicit label match.
  chunks.forEach((chunk, i) => {
    const label = chunk.label
    if (label !== null && label >= 1 && label <= morningItems.length && !claimed[label - 1]) {
      chunkMorningIdx[i] = label - 1
      chunkConfidence[i] = 'high'
      claimed[label - 1] = true
    }
  })

  // TIER 2 — canonical-type match, only when exactly one unclaimed morning
  // item shares the chunk's canonical_type.
  chunks.forEach((chunk, i) => {
    if (chunkMorningIdx[i] !== null || chunk.canonical_type === null) return
    let matchIdx: number | null = null
    let matchCount = 0
    morningItems.forEach((item, j) => {
      if (!claimed[j] && item.type === chunk.canonical_type) {
        matchIdx = j
        matchCount += 1
      }
    })
    if (matchCount === 1 && matchIdx !== null) {
      chunkMorningIdx[i] = matchIdx
      chunkConfidence[i] = 'high'
      claimed[matchIdx] = true
    }
  })

  // TIER 3 — pure positional fallback, only when NOTHING in the whole reply
  // carried a label or canonical_type — checked by PRESENCE of the signal,
  // NOT by whether tiers 1/2 successfully resolved a match. An ambiguous
  // type name (two unlabelled mixers, both naming "mixer") is still a
  // signal that was ignored, not absent — stays tier-4 unmatched, never
  // falls through to a positional guess.
  const anySignal = chunks.some((c) => c.label !== null || c.canonical_type !== null)
  if (!anySignal && chunks.length === morningItems.length && morningItems.length > 0) {
    chunks.forEach((_, i) => {
      chunkMorningIdx[i] = i
      chunkConfidence[i] = 'low'
      claimed[i] = true
    })
  }

  // TIER 4 (implicit) — anything still unmatched keeps index/confidence null.

  const items: EquipmentUtilisationItem[] = chunks.map((chunk, i) => ({
    morning_item_index: chunkMorningIdx[i],
    type: chunkMorningIdx[i] !== null ? morningItems[chunkMorningIdx[i] as number].type : null,
    available_hours: chunk.available_hours,
    actual_hours: chunk.actual_hours,
    idle_reason: chunk.idle_reason,
    raw: chunk.raw,
    confidence: chunkConfidence[i],
  }))

  // CASE B — one explicit "not reported" entry per morning item nothing matched.
  morningItems.forEach((item, j) => {
    if (!claimed[j]) {
      items.push({
        morning_item_index: j,
        type: item.type,
        available_hours: null,
        actual_hours: null,
        idle_reason: null,
        raw: null,
        confidence: null,
      })
    }
  })

  return items
}

/**
 * Pure mirror of apply_evening_flow_turn's decision logic. See AUTHORITY NOTE.
 */
export function dispatchEveningFlow(
  session: WhatsAppSession,
  inboundMessage: string,
  options: EveningDispatchOptions = {},
): EveningDispatch {
  const startFlow = options.startFlow ?? false
  const now = options.now ?? new Date().toISOString()
  const morningItems = options.morningEquipmentItems ?? []
  const text = inboundMessage.trim()
  const ctx: Record<string, unknown> = session.context ?? {}
  const submitted = ctx[EVENING_SUBMITTED_KEY] === true

  let outcome: EveningOutcome
  let sessionUpdate: EveningDispatch['sessionUpdate'] = {}
  let dailyLogWrite: EveningDailyLogWrite | null = null
  let equipmentEcho: readonly EquipmentEchoItem[] | undefined

  // Completion context: MERGE the marker and drop only evening's own
  // in-flight keys — the FULL set, not just e2_reask (see EVENING_IN_FLIGHT_KEYS).
  const completedContext = (): Record<string, unknown> => {
    const next: Record<string, unknown> = { ...ctx, [EVENING_SUBMITTED_KEY]: true }
    for (const key of EVENING_IN_FLIGHT_KEYS) delete next[key]
    return next
  }

  if (startFlow) {
    if (session.current_flow === null) {
      const next = { ...ctx }
      for (const key of EVENING_IN_FLIGHT_KEYS) delete next[key]
      outcome = 'start'
      sessionUpdate = { current_step: 1, context: next }
    } else {
      outcome = 'reask'
    }
  } else if (session.current_flow === null) {
    outcome = submitted ? 'already_complete' : 'idle'
  } else if (session.current_flow === 'evening') {
    if (text === '') {
      outcome = 'reask'
    } else if (session.current_step === 1) {
      outcome = 'advance'
      sessionUpdate = { current_step: 2 }
      dailyLogWrite = {
        evening_output: text,
        evening_output_quantities: parseQuantities(text),
      }
    } else if (session.current_step === 2) {
      const prior =
        typeof ctx[EVENING_Q2_REASK_KEY] === 'number' ? (ctx[EVENING_Q2_REASK_KEY] as number) : 0
      const classified = classifyYesNo(text)

      if (!classified.ok && prior < EVENING_PARSE_REASK_CAP) {
        outcome = 'reask'
        sessionUpdate = { context: { ...ctx, [EVENING_Q2_REASK_KEY]: prior + 1 } }
      } else {
        const met = classified.ok ? classified.met : false
        outcome = 'advance'
        dailyLogWrite = { evening_schedule_met: met }

        if (met) {
          // Plan met -> Q3 skipped, route to Q4 (022's reserved edge, now
          // resolved by 024 instead of completing here).
          sessionUpdate = { current_step: 4, context: { ...ctx, [EVENING_Q2_REASK_KEY]: 0 } }
        } else {
          sessionUpdate = { current_step: 3, context: { ...ctx, [EVENING_Q2_REASK_KEY]: 0 } }
        }
      }
    } else if (session.current_step === 3) {
      // Q3 -> miss reason, route to Q4 (022's other reserved edge).
      outcome = 'advance'
      sessionUpdate = { current_step: 4 }
      dailyLogWrite = { evening_schedule_miss_reason: text }
    } else if (session.current_step === 4) {
      // Q4 step 1 (headcount). Reuses parseLabourCount/isLabourAnswered
      // verbatim — only planned_total is used.
      const prior =
        typeof ctx[EVENING_Q4_REASK_KEY] === 'number' ? (ctx[EVENING_Q4_REASK_KEY] as number) : 0
      const parse = parseLabourCount(text)
      const answered = isLabourAnswered(parse)

      if (!answered && prior < EVENING_PARSE_REASK_CAP) {
        outcome = 'reask'
        sessionUpdate = { context: { ...ctx, [EVENING_Q4_REASK_KEY]: prior + 1 } }
      } else {
        outcome = 'advance'
        sessionUpdate = {
          current_step: 5,
          context: { ...ctx, [EVENING_Q4_HEADCOUNT_KEY]: parse.planned_total, [EVENING_Q4_REASK_KEY]: 0 },
        }
        // Nothing written to daily_logs yet — held until step 5 resolves.
      }
    } else if (session.current_step === 5) {
      // Q4 step 2 (productivity/idle). AGGREGATE-ONLY v1 — see
      // productivity.ts's own header.
      const prior =
        typeof ctx[EVENING_Q5_REASK_KEY] === 'number' ? (ctx[EVENING_Q5_REASK_KEY] as number) : 0
      const parse = parseProductivity(text)
      const answered = isProductivityAnswered(parse)

      if (!answered && prior < EVENING_PARSE_REASK_CAP) {
        outcome = 'reask'
        sessionUpdate = { context: { ...ctx, [EVENING_Q5_REASK_KEY]: prior + 1 } }
      } else {
        // headcount: null (NOT 0) when step 4's own context value is
        // missing/non-numeric — e.g. step 4 exhausted its own reask budget
        // on an unparseable answer (planned_total null -> e4_headcount
        // never set). Defaulting this to 0 was itself a bug of the same
        // class as the two fixed below, found while fixing them: it would
        // have silently produced "0 workers on site" instead of "not
        // captured".
        const headcount =
          typeof ctx[EVENING_Q4_HEADCOUNT_KEY] === 'number' ? (ctx[EVENING_Q4_HEADCOUNT_KEY] as number) : null

        // FIX 1 — confidence must reflect BOTH steps. productive_count is
        // derived from headcount (a STEP 4 value), so a clean step-5 parse
        // stamped confidence='high' even when step 4's own headcount was
        // never actually captured. See the migration's matching note for
        // the full trace. `let`, not `const` — the ARITHMETIC GUARD below
        // can downgrade this further.
        let confidence: 'high' | 'low' = answered && headcount !== null ? 'high' : 'low'

        const allProductive = parse.all_productive ?? false // boolean forced false on exhausted+unclassifiable — see FIX 2 below for why the COUNT is not also forced

        // FIX 2 — idle_count stays exactly as parsed, NULL included, never
        // defaulted to 0. Defaulting it made productive_count come out as
        // the FULL headcount on an unclassifiable answer — "everyone was
        // productive", the opposite of what "some idle, count unknown" (the
        // forced-false boolean above) actually means, and the rosiest
        // possible reading of an answer nobody understood.
        let idleCount = allProductive ? 0 : parse.idle_count

        // ARITHMETIC GUARD — idle_count > headcount is impossible. Same
        // class as Q5's actual_hours > available_hours guard
        // (equipment-hours.ts): a signature that means a misparse, not a
        // real answer. Checked here, not in productivity.ts, because the
        // parser has no access to headcount (cross-step, same reason FIX 1
        // lives here too). Invalidates rather than clamps — silently
        // computing Math.max(headcount - idleCount, 0) is exactly the
        // "everyone was productive" fabrication FIX 2 already closed for
        // the unclassifiable case, reachable a second way.
        if (idleCount !== null && headcount !== null && idleCount > headcount) {
          idleCount = null
          confidence = 'low'
        }

        // RECONCILIATION, added 2026-08-10 (sandbox smoke test — see
        // productivity.ts's own SEVERE BUG note for the full incident).
        // parse.productive_count is populated only when the engineer's
        // reply anchored a number to the word "productive" ("15
        // productive, 3 idle") — the common idle-only case leaves it null
        // and falls straight to the pre-existing derivation below,
        // unchanged. When it IS present:
        //   - idle also known, and they SUM TO HEADCOUNT: real
        //     confirmation, stronger than derivation — use both as parsed
        //     rather than re-deriving over them.
        //   - idle also known, but they DON'T sum to headcount: a genuine
        //     contradiction. Neither number is trustworthy alone — not a
        //     tiebreak, same posture as the idle>headcount guard just
        //     above: invalidate both, never silently pick one.
        //   - idle NOT known (productive-only, e.g. "18 productive"):
        //     derive idle the other direction, the mirror of the
        //     idle-only case this file already handled.
        let productiveCount: number | null
        if (idleCount !== null && parse.productive_count !== null && headcount !== null) {
          if (idleCount + parse.productive_count === headcount) {
            productiveCount = parse.productive_count
          } else {
            idleCount = null
            productiveCount = null
            confidence = 'low'
          }
        } else if (idleCount === null && parse.productive_count !== null && headcount !== null) {
          // DEFECT 2 — the mirror of the idle>headcount guard above had no
          // equivalent: headcount 18, "20 productive" produced idle=0,
          // productive=20 at confidence 'high' with no check at all. Same
          // posture as that guard — invalidate, never clamp into a
          // confident reading a real headcount could not support.
          if (parse.productive_count > headcount) {
            idleCount = null
            productiveCount = null
            confidence = 'low'
          } else {
            idleCount = Math.max(headcount - parse.productive_count, 0)
            productiveCount = parse.productive_count
          }
        } else {
          productiveCount = headcount === null || idleCount === null ? null : Math.max(headcount - idleCount, 0)
          // DEFECT 3 — CORRECTED 2026-08-10, same day as the original fix:
          // the comment this replaces claimed this branch "flags, doesn't
          // lose silently" — false, and worth naming precisely rather than
          // leaving misdescribed (this project has been bitten before by a
          // comment misstating whether a guard was load-bearing). The
          // number IS still lost: when headcount is unknown AND the parser
          // anchored a productive count ("15 productive" with no headcount
          // to check it against), the productive-only ELSIF above cannot
          // fire (it requires headcount !== null), so this branch runs and
          // parse.productive_count is never written anywhere — this `if`
          // sets confidence, nothing more, and does NOT recover the number.
          // ACCEPTED, not fixed: with headcount unknown there is no
          // utilisation figure to render regardless of which number
          // survives, so dropping the bare count to not_captured is the
          // honest outcome, not a compromise. And on the CURRENT confidence
          // formula (`answered && headcount !== null ? 'high' : 'low'`,
          // just above) headcount===null ALREADY forces 'low' before this
          // `if` ever runs — so today this is a no-op, redundant with that
          // formula, not an independent fix. Kept anyway as an explicit
          // guard for the day that formula's headcount-null condition is
          // ever narrowed or removed — at which point this stops being
          // redundant and starts being the only thing catching this case.
          if (headcount === null && parse.productive_count !== null) {
            confidence = 'low'
          }
        }

        // THE GENERAL GUARD — a numeric token the parser saw and could not
        // place is itself a reason not to trust this answer, independent
        // of whether idleCount/productiveCount still came out non-null
        // from OTHER tokens in the same message. See productivity.ts's own
        // THE GENERAL GUARD note for why this matters more than the
        // reconciliation above: it protects against phrasings nobody has
        // written yet, not just the one this incident found.
        if (parse.numbers_discarded) {
          confidence = 'low'
        }

        const productiveManpower: EveningDailyLogWrite['evening_productive_manpower'] = {
          productive_count: productiveCount,
          idle_count: idleCount,
          idle_reason: parse.idle_reason,
          raw_text: parse.raw_text,
          confidence,
        }

        outcome = 'advance'

        if (morningItems.length === 0) {
          // BOT-22 auto-skip — see the migration's BOT-22 NULL CASE note.
          // undefined/empty both mean "skip" here (the mirror has no way to
          // distinguish NULL-vs-empty the way the RPC's SQL does).
          sessionUpdate = { current_step: 0, context: completedContext() }
          dailyLogWrite = {
            evening_workers_on_site: headcount,
            evening_productive_manpower: productiveManpower,
            evening_equipment_utilisation: { items: [], raw_text: null, confidence: null },
            evening_submitted_at: now,
          }
        } else {
          sessionUpdate = {
            current_step: 6,
            context: (() => {
              const next: Record<string, unknown> = { ...ctx, [EVENING_Q5_REASK_KEY]: 0 }
              delete next[EVENING_Q4_HEADCOUNT_KEY]
              return next
            })(),
          }
          dailyLogWrite = {
            evening_workers_on_site: headcount,
            evening_productive_manpower: productiveManpower,
          }
          equipmentEcho = morningItems.map((m) => ({ type: m.type }))
        }
      }
    } else if (session.current_step === 6) {
      // Q5 (equipment hours). Only reached when morningItems was non-empty
      // at step 5.
      const prior =
        typeof ctx[EVENING_Q6_REASK_KEY] === 'number' ? (ctx[EVENING_Q6_REASK_KEY] as number) : 0
      const parse: EquipmentHoursParse = parseEquipmentHours(text)
      const answered = isEquipmentHoursAnswered(parse)

      if (!answered && prior < EVENING_PARSE_REASK_CAP) {
        outcome = 'reask'
        sessionUpdate = { context: { ...ctx, [EVENING_Q6_REASK_KEY]: prior + 1 } }
        equipmentEcho = morningItems.map((m) => ({ type: m.type }))
      } else {
        const confidence: 'high' | 'low' = answered ? 'high' : 'low'
        const items = matchEquipmentHoursItems(parse.items, morningItems)

        outcome = 'advance'
        sessionUpdate = { current_step: 0, context: completedContext() }
        dailyLogWrite = {
          evening_equipment_utilisation: { items, raw_text: parse.raw_text, confidence },
          evening_submitted_at: now,
        }
      }
    } else {
      outcome = 'reask'
    }
  } else {
    outcome = 'wrong_flow'
  }

  const stepForReply = sessionUpdate.current_step ?? session.current_step
  return {
    outcome,
    reply: buildEveningReply(outcome, stepForReply, equipmentEcho),
    sessionUpdate,
    dailyLogWrite,
    ...(equipmentEcho !== undefined ? { equipmentEcho } : {}),
  }
}

// ---------------------------------------------------------------------------
// Production write path: the thin wrapper over the single transactional RPC.
// This is the ONLY thing that writes the session/daily_logs for the evening flow.

export interface EveningTurnResult {
  outcome: EveningOutcome
  currentFlow: SessionFlow | null
  currentStep: number
  logDate: string
  /** Populated by the RPC when current_step becomes 6 (advance or reask). */
  equipmentEcho: EquipmentEchoItem[] | null
}

export async function applyEveningFlowTurn(params: {
  phoneNumber: string
  tenantId: string
  userId: string
  projectId: string
  message: string
  startFlow: boolean
  now?: string
  /** TEST-ONLY: forces a mid-transaction pause to prove the row lock serialises. */
  testSleepMs?: number
  /**
   * Injected client, defaulting to createServiceClient() (today's exact
   * behaviour) when omitted. Same shape as clearMessagingBlock's own
   * client parameter (lib/whatsapp/reactivation.ts) — lets a test pass
   * testClient() instead of the prod-resolving default, without changing
   * any existing call site.
   */
  supabaseClient?: SupabaseClient
}): Promise<EveningTurnResult> {
  const supabase = params.supabaseClient ?? createServiceClient()

  // Parse EVERY parsed step's shape unconditionally (pure + cheap) and hand
  // them to the RPC KEYED BY STEP ID — same reasoning as morning's two typed
  // pairs and Pass 1's own p_parse/p_parse_ok (see 022's file header): the
  // webhook cannot know which step is active without an unlocked, racy read,
  // so every shape is computed every turn and the locked RPC selects the one
  // that matches. Q5's parser (parseEquipmentHours) deliberately never sees
  // morning_equipment — see that file's own header for why; the RPC resolves
  // the join under its own lock.
  const quantities = parseQuantities(params.message)
  const yesno = classifyYesNo(params.message)
  const headcount = parseLabourCount(params.message)
  const productivity = parseProductivity(params.message)
  const equipmentHours = parseEquipmentHours(params.message)

  const parse = {
    '1': quantities,
    '2': { met: yesno.met },
    '4': headcount,
    '5': productivity,
    '6': equipmentHours,
  }
  const parseOk = {
    '1': true, // Q1 is never parse-gated — see the header note in 022.
    '2': yesno.ok,
    '4': isLabourAnswered(headcount),
    '5': isProductivityAnswered(productivity),
    '6': isEquipmentHoursAnswered(equipmentHours),
  }

  const { data, error } = await supabase.rpc('apply_evening_flow_turn', {
    p_phone_number: params.phoneNumber,
    p_tenant_id: params.tenantId,
    p_user_id: params.userId,
    p_project_id: params.projectId,
    p_message: params.message,
    p_start_flow: params.startFlow,
    // Cast to Json because a concrete interface is not structurally assignable
    // to the recursive Json index type — a permanent TS limitation, not a stale
    // -types workaround (same note as morning.ts).
    p_parse: parse as unknown as Json,
    p_parse_ok: parseOk as unknown as Json,
    ...(params.now !== undefined ? { p_now: params.now } : {}),
    ...(params.testSleepMs !== undefined ? { p_test_sleep_ms: params.testSleepMs } : {}),
  })

  if (error) {
    throw new Error(`apply_evening_flow_turn failed for ${params.phoneNumber}: ${error.message}`)
  }

  const result = data as {
    outcome: EveningOutcome
    current_flow: SessionFlow | null
    current_step: number
    log_date: string
    equipment_echo: EquipmentEchoItem[] | null
  }

  return {
    outcome: result.outcome,
    currentFlow: result.current_flow,
    currentStep: result.current_step,
    logDate: result.log_date,
    equipmentEcho: result.equipment_echo,
  }
}
