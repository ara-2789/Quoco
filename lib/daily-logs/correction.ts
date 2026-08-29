// Pure, framework-free contract for Rule 4.3 inline correction (DASH-03),
// matching migration 019_daily_log_corrections.sql's own whitelist. No React,
// no Supabase — unit-tested directly (test/unit/column-contract.test.ts,
// test/unit/correction.test.ts), same style as reactivate-copy.ts / date.ts.
//
// COLUMN_CONTRACT deliberately mirrors the FULL RPC/DB-level whitelist — all 9
// columns 019 allows correct_daily_log to touch — not just the subset this
// build renders. Migration 019 deliberately duplicates its whitelist across
// the table CHECK and the RPC CASE so a partial widening fails closed; keeping
// this map at the full 9 (verified byte-for-byte against the migration file by
// column-contract.test.ts) makes it a real third gate on the same shape,
// rather than a UI-scoped copy that could silently drift from what the RPC
// actually allows.
export const COLUMN_CONTRACT = {
  is_holiday: 'boolean',
  holiday_reason: 'text',
  weather: 'text',
  morning_plan: 'text',
  morning_execution_plan: 'text',
  evening_output: 'text',
  evening_workers_on_site: 'integer',
  evening_schedule_met: 'boolean',
  evening_schedule_miss_reason: 'text',
} as const

export type CorrectableColumn = keyof typeof COLUMN_CONTRACT
export type ColumnCastType = (typeof COLUMN_CONTRACT)[CorrectableColumn]

// This build's UI surface: all 9 minus `weather`, which has no capture path
// anywhere in the product (no morning/evening question asks it — grepped,
// confirmed against lib/whatsapp/flows/morning.ts's MORNING_QUESTIONS) and no
// PM-entry design has been decided (design-principles §0 names moving its
// capture off the engineer, e.g. a weather API, as a separate, undecided
// product question this build does not answer). Excluding it here is a named
// UI decision layered on top of the full contract above, not a narrowing of
// what the RPC/DB actually allows.
export const UI_VISIBLE_COLUMNS = (Object.keys(COLUMN_CONTRACT) as CorrectableColumn[]).filter(
  (c) => c !== 'weather',
)

// The real RPC boundary (019: `pg_column_size(p_new_value) > 100000` raises
// program_limit_exceeded) with a 5% margin, checked client-side before ever
// calling the Server Action. NOT a UX-invented shorter cap — WhatsApp allows
// 4096 chars per message and evening_output concatenates chunks, so a real,
// legitimate value can already be several thousand characters; a smaller
// arbitrary cap would make an existing long value un-savable.
export const MAX_VALUE_BYTES = 95_000

export type ValidationResult =
  | { ok: true; value: boolean | number | string | null }
  | { ok: false; error: string }

function byteLength(s: string): number {
  return new TextEncoder().encode(s).length
}

/**
 * Validate + coerce a raw UI value into the shape correct_daily_log expects
 * (019's own NULL/TYPE convention): JSON true/false for booleans, a JSON
 * number for integers, a JSON string for text — never a stringified
 * boolean/int. An empty/whitespace-only text input, or an explicitly-cleared
 * integer input, becomes SQL NULL (clears the field), never `""` or `0`.
 *
 * Called from BOTH the client (to disable Save / choose the Save-vs-Clear
 * label) and the Server Action (never trusts client-side validation alone —
 * CLAUDE.md §6).
 */
export function validateValue(column: CorrectableColumn, raw: unknown): ValidationResult {
  const castType = COLUMN_CONTRACT[column]

  if (castType === 'boolean') {
    if (raw === null || raw === undefined) return { ok: false, error: 'A value is required.' }
    if (typeof raw !== 'boolean') return { ok: false, error: 'Expected yes or no.' }
    return { ok: true, value: raw }
  }

  if (castType === 'integer') {
    if (raw === null || raw === '' || raw === undefined) return { ok: true, value: null }
    const n = typeof raw === 'number' ? raw : Number(raw)
    if (!Number.isInteger(n) || !Number.isFinite(n) || n < 0) {
      return { ok: false, error: 'Enter a whole number, 0 or more.' }
    }
    return { ok: true, value: n }
  }

  // text
  if (raw === null || raw === undefined) return { ok: true, value: null }
  const trimmed = String(raw).trim()
  if (trimmed === '') return { ok: true, value: null }
  if (byteLength(trimmed) > MAX_VALUE_BYTES) {
    return { ok: false, error: "That's too long to save." }
  }
  return { ok: true, value: trimmed }
}

/** Render a column's value (old or new) for the "was: <value>" trust-chain clause. */
export function formatValue(column: CorrectableColumn, value: unknown): string {
  const castType = COLUMN_CONTRACT[column]
  if (value === null || value === undefined) return '(empty)'
  if (castType === 'boolean') return value ? 'Yes' : 'No'
  if (castType === 'integer') return String(value)
  return String(value)
}

/**
 * The role gate (§10 of the build plan): edit affordances render only for a
 * PM. Read access to the detail page itself is NOT gated by this — every
 * project_members role can view; only editing is restricted. A single named
 * function rather than an inline `role === 'pm'` comparison scattered across
 * components, so the gate is one thing to find and change, not several.
 */
export function canEditLog(role: string | null): boolean {
  return role === 'pm'
}
