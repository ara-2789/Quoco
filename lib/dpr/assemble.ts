import type { SupabaseClient } from '@supabase/supabase-js'
import { computeIdleCost } from './idle-cost'
import type {
  CapturedCount,
  CapturedNumber,
  DprFacts,
  EquipmentItemFacts,
  ExecutionQuantityFact,
} from './schema'

// The fact assembler — the deterministic half of DPR generation. No Claude
// call anywhere in this file. Follows the repo's pure-decision + thin-IO
// split (mirrors lib/whatsapp/reactivation.ts's decideInboundGate() /
// clearMessagingBlock(), and lib/whatsapp/flows/parsers/equipment-hours.ts's
// pure-parser-plus-RPC-does-the-join pattern): mergeDprFacts() is pure and
// unit-tested without a DB; assembleDprFacts() is the thin IO wrapper that
// fetches rows via an INJECTED client (per CLAUDE.md §10's CANDIDATE CI
// CHECK — no createServiceClient() buried in here) and calls it.

// -----------------------------------------------------------------------
// One engineer's row, POST-correction. daily_log_edits is the source of
// truth for the 9 scalar columns 019 made correctable (docs/schema.md);
// assembleDprFacts() applies the latest edit per column before building
// this shape. The 8 JSONB columns are NOT correctable in v1 (019's own
// restriction) and are read straight from daily_logs — evening_output_
// quantities, evening_productive_manpower, morning_equipment, and evening_
// equipment_utilisation below are never touched by a correction.
// -----------------------------------------------------------------------

export interface CorrectedDailyLogRow {
  engineer_id: string
  // §1 — NOT correctable (JSONB). quantity is number | null, not number:
  // this row is a cast over untyped JSONB (assembleDprFacts casts, doesn't
  // validate — see its own note), so the type must admit what the runtime
  // value can actually be, not what a clean write would produce.
  // CapturedNumber-wrapping happens during merge, via wrapNumber, not by
  // hand — a hand-built { status: 'reported', value } here would let a
  // null quantity through claiming 'reported' with no value, the exact
  // state the wrapper exists to prevent.
  evening_output_quantities: { items: Array<{ activity: string; quantity: number | null; unit: string }> } | null
  // §2 — correctable (scalar). Already corrected by the caller.
  evening_schedule_met: boolean | null
  // §3 headcount — correctable (scalar, evening_workers_on_site). Already
  // corrected by the caller.
  evening_workers_on_site: number | null
  // §3 productivity — NOT correctable (JSONB). confidence is ONE flag for
  // the whole answer (productive_count + idle_count together), never
  // per-field — docs/schema.md's own note on evening_productive_manpower.
  evening_productive_manpower: { productive_count: number | null; idle_count: number | null; confidence: 'high' | 'low' } | null
  // §4 rates — NOT correctable (JSONB). Position-indexed; evening_
  // equipment_utilisation's morning_item_index refers into THIS array for
  // THIS engineer only (schema.md's EQUIPMENT JOIN KEY note).
  morning_equipment: { items: Array<{ type: string; daily_hire_cost: number | null }> } | null
  // §4 hours — NOT correctable (JSONB). confidence is ONE flag for the
  // whole reply (every item in it), same convention as productivity's.
  evening_equipment_utilisation: {
    items: Array<{ morning_item_index: number | null; type: string; available_hours: number | null; actual_hours: number | null }>
    confidence: 'high' | 'low'
  } | null
}

export interface MergeDprFactsOptions {
  // The seam for CLAUDE.md §10's still-undecided "A COUNT IN A MONEY FIELD"
  // heuristic (daily_hire_cost can be a miscaptured count, not a real
  // rate). No detection is implemented here — defaulting to "trust
  // whatever's there" is a placeholder, not a decision, and is exactly why
  // this is a parameter rather than baked in: wiring a real heuristic later
  // means passing a different function here, not restructuring this file.
  isHireRateTrusted?: (cost: number) => boolean
}

const notCapturedCount: CapturedCount = { status: 'not_captured', value: null }
const notCapturedNumber: CapturedNumber = { status: 'not_captured', value: null }

function wrapCount(value: number | null, confidence?: 'high' | 'low'): CapturedCount {
  if (value === null) return notCapturedCount
  const base: CapturedCount = value === 0 ? { status: 'zero', value: 0 } : { status: 'reported', value }
  return confidence === 'low' ? { ...base, low_confidence: true } : base
}

function wrapNumber(value: number | null, confidence?: 'high' | 'low'): CapturedNumber {
  if (value === null) return notCapturedNumber
  const base: CapturedNumber = { status: 'reported', value }
  return confidence === 'low' ? { ...base, low_confidence: true } : base
}

// idle_cost inherits low_confidence from its hour inputs — computeIdleCost
// itself stays a narrow, already-tested pure arithmetic function (lib/dpr/
// idle-cost.ts) with no knowledge of confidence; propagating the flag onto
// its result is this file's job, not that function's.
function withInheritedLowConfidence(idleCost: CapturedNumber, ...inputs: Array<{ low_confidence?: true }>): CapturedNumber {
  if (idleCost.status !== 'reported') return idleCost
  return inputs.some((i) => i.low_confidence === true) ? { ...idleCost, low_confidence: true } : idleCost
}

function normalizeActivity(activity: string): string {
  return activity.trim().toLowerCase()
}

function normalizeType(type: string): string {
  return type.trim().toLowerCase()
}

export function mergeDprFacts(rows: CorrectedDailyLogRow[], opts: MergeDprFactsOptions = {}): DprFacts {
  const isHireRateTrusted = opts.isHireRateTrusted ?? (() => true)

  // ---- §1 Execution — list every activity, suppress quantity only where
  // an activity name collides across engineers (§12). One item per
  // distinct activity: two engineers reporting "slab pour" merge into ONE
  // suppressed item, never two rows for the same real-world activity.
  // Assumes at most one entry per activity per engineer — a within-row
  // duplicate (one engineer reporting the same activity twice) would
  // inflate the collision count; that's a parser-level concern, not
  // handled here.
  const activityGroups = new Map<string, Array<{ activity: string; unit: string; quantity: number | null }>>()
  for (const row of rows) {
    for (const item of row.evening_output_quantities?.items ?? []) {
      const key = normalizeActivity(item.activity)
      const list = activityGroups.get(key) ?? []
      list.push(item)
      activityGroups.set(key, list)
    }
  }
  const quantities: ExecutionQuantityFact[] = Array.from(activityGroups.values()).map((items) => {
    const [first] = items
    if (items.length > 1) {
      return {
        activity: first.activity,
        unit: first.unit,
        quantity: notCapturedNumber,
        suppressed: { reason: 'same_activity_overlap' as const, engineer_count: items.length },
      }
    }
    return { activity: first.activity, unit: first.unit, quantity: wrapNumber(first.quantity) }
  })

  // ---- §2 Schedule — CORRECTED 2026-08-10: originally miscategorized as
  // unaffected by §12. schedule_met is one boolean per engineer exactly
  // like headcount is one number per engineer, and suppresses the same
  // way — UNCONDITIONALLY on any multi-engineer day, not only when
  // engineers disagree (two engineers who happen to both say 'true' still
  // can't be safely collapsed into one boolean without losing which
  // engineer said what; behavior must not depend on the data's content —
  // see ScheduleFacts's own note). multi_engineer_schedule, never a
  // disagreement-flavored reason: Q2 asks about THAT ENGINEER's own plan,
  // so two different answers are two separate facts, not a contradiction.
  const schedule =
    rows.length > 1
      ? { schedule_met: null, suppressed: { reason: 'multi_engineer_schedule' as const, engineer_count: rows.length } }
      : { schedule_met: rows[0]?.evening_schedule_met ?? null }

  // ---- §3 Manpower — suppressed UNCONDITIONALLY the moment more than one
  // engineer submits (§12), regardless of what the numbers are. Single-
  // engineer days carry the confidence flag through per the low_confidence
  // decision (2026-08-10) rather than collapsing into not_captured or
  // silently dropping the doubt.
  const manpower =
    rows.length > 1
      ? {
          headcount: notCapturedCount,
          productive_count: notCapturedCount,
          idle_count: notCapturedCount,
          utilisation_pct: notCapturedNumber,
          suppressed: { reason: 'multi_engineer_manpower' as const, engineer_count: rows.length },
        }
      : (() => {
          const row = rows[0]
          const headcount = wrapCount(row?.evening_workers_on_site ?? null)
          const pm = row?.evening_productive_manpower ?? null
          const productive_count = wrapCount(pm?.productive_count ?? null, pm?.confidence)
          const idle_count = wrapCount(pm?.idle_count ?? null, pm?.confidence)
          // GUARD, added 2026-08-10: productive_count > headcount is
          // impossible at 024's WRITE time (productive_count is derived as
          // headcount − idle_count, floored at 0) — but evening_workers_
          // on_site is CORRECTABLE and evening_productive_manpower is NOT
          // (JSONB, outside 019's correctable set). A PM correcting
          // headcount downward (20 → 10) leaves productive_count at the
          // original 20, and without this guard the DPR would state
          // impossible utilisation (200%) — manufactured BY the correction
          // feature meant to make the report more accurate, not less. Not
          // clamped: not_captured matches this file's posture everywhere
          // else a value can't be trusted, rather than inventing a
          // "corrected" productive_count nobody actually reported.
          const utilisation_pct =
            headcount.status === 'not_captured' ||
            productive_count.status === 'not_captured' ||
            headcount.value === null ||
            productive_count.value === null ||
            headcount.value <= 0 ||
            productive_count.value > headcount.value
              ? notCapturedNumber
              : withInheritedLowConfidence(
                  { status: 'reported', value: (productive_count.value / headcount.value) * 100 },
                  headcount,
                  productive_count,
                )
          return { headcount, productive_count, idle_count, utilisation_pct }
        })()

  // ---- §4 Equipment — suppress ONLY items whose type collides across
  // engineers (§12); distinct types survive fully. Identity resolution
  // (is engineer A's JCB the same physical machine as engineer B's?) never
  // has to be answered — colliding items are suppressed wholesale, never
  // merged. Surviving items get a fresh 0..N-1 aggregate index (promoted
  // from case-complete-two-engineer-day.ts's provisional convention to
  // real behaviour here) since raw per-engineer morning_item_index values
  // can collide across engineers' own rows.
  interface RawEquipmentItem {
    type: string
    available_hours: number | null
    actual_hours: number | null
    daily_hire_cost: number | null
    confidence: 'high' | 'low'
  }
  const rawItems: RawEquipmentItem[] = []
  for (const row of rows) {
    const morningItems = row.morning_equipment?.items ?? []
    const eveningUtil = row.evening_equipment_utilisation
    for (const eveningItem of eveningUtil?.items ?? []) {
      // morning_item_index is null for a tier-4 unmatched chunk (024) — an
      // explicit "no match," not merely a missing lookup. Handled here
      // rather than relying on array indexing with a null to fail safely
      // by luck: honestly typing this field (number | null) is what forces
      // this branch to exist at all.
      const morningItem = eveningItem.morning_item_index === null ? undefined : morningItems[eveningItem.morning_item_index]
      rawItems.push({
        type: eveningItem.type,
        available_hours: eveningItem.available_hours,
        actual_hours: eveningItem.actual_hours,
        daily_hire_cost: morningItem?.daily_hire_cost ?? null,
        // Default 'low', not 'high': absence of a confidence field means we
        // don't know whether the parse was confident — resolving "don't
        // know" to "confident" would invert the whole point of the flag.
        // Pure insurance, not an expected path: 024 always writes this
        // field; nothing wrote evening_equipment_utilisation before 024.
        confidence: eveningUtil?.confidence ?? 'low',
      })
    }
  }
  const byType = new Map<string, RawEquipmentItem[]>()
  for (const item of rawItems) {
    const key = normalizeType(item.type)
    const list = byType.get(key) ?? []
    list.push(item)
    byType.set(key, list)
  }
  const equipmentItems: EquipmentItemFacts[] = []
  let nextIndex = 0
  for (const items of byType.values()) {
    if (items.length > 1) {
      equipmentItems.push({
        morning_item_index: nextIndex++,
        type: items[0].type,
        available_hours: notCapturedNumber,
        actual_hours: notCapturedNumber,
        daily_hire_cost: notCapturedNumber,
        idle_cost: notCapturedNumber,
        suppressed: { reason: 'same_type_equipment', engineer_count: items.length },
      })
      continue
    }
    const [item] = items
    const available_hours = wrapNumber(item.available_hours, item.confidence)
    const actual_hours = wrapNumber(item.actual_hours, item.confidence)
    const daily_hire_cost =
      item.daily_hire_cost === null
        ? notCapturedNumber
        : isHireRateTrusted(item.daily_hire_cost)
          ? { status: 'reported' as const, value: item.daily_hire_cost }
          : notCapturedNumber
    const idle_cost = withInheritedLowConfidence(
      computeIdleCost(available_hours, actual_hours, daily_hire_cost),
      available_hours,
      actual_hours,
    )
    equipmentItems.push({
      morning_item_index: nextIndex++,
      type: item.type,
      available_hours,
      actual_hours,
      daily_hire_cost,
      idle_cost,
    })
  }

  return {
    execution: { quantities },
    schedule,
    manpower,
    equipment: { items: equipmentItems },
    // §5 forced empty/not_captured pre-Q6 regardless of engineer count —
    // TOMORROWS_PLAN_DATA_STATUS_FORCED (schema.ts) already owns this.
    // TRANSITIONAL, same shape as that constant (flagged here 2026-08-11,
    // not fixed): this is a hardcoded [], not a read of
    // daily_logs.evening_dependencies — that column already exists on prod
    // (docs/schema.md) but is always empty pre-Q6, so hardcoding costs
    // nothing today. The moment Q6 ships, this MUST become a real read of
    // that column (and rows would need to carry it, same as the other JSONB
    // columns above) — if this file is read after Q6 ships and `[]` is still
    // hardcoded here, that is a bug, not a stable design choice.
    tomorrows_plan: { dependencies: [] },
  }
}

// -----------------------------------------------------------------------
// Thin IO wrapper. Fetches daily_logs + daily_log_edits for (project_id,
// log_date) via the INJECTED client, applies the latest correction per
// (daily_logs_id, column_name) for the two correctable columns this file
// actually consumes (evening_schedule_met, evening_workers_on_site — see
// CLAUDE.md §10's tracked gap for why the other 7 of 019's 9 correctable
// columns feed no DprFacts field today), builds CorrectedDailyLogRow[], and
// calls mergeDprFacts(). The JSONB columns are read as-is (never
// correctable) and cast to their known parser-output shapes — schema.md's
// DATED CORRECTION notes are the source for these shapes; no runtime schema
// validation beyond null-guarding, same trust level the rest of this
// codebase already extends to these columns. The two correctable columns
// below get more than that — see parseCorrectedBoolean/parseCorrectedInteger.
// -----------------------------------------------------------------------

// The full set 019 made correctable, kept for documentation even though
// only evening_schedule_met / evening_workers_on_site are consumed into a
// typed CorrectedDailyLogRow field today — see CLAUDE.md §10.
export const CORRECTABLE_SCALAR_COLUMNS = [
  'is_holiday',
  'holiday_reason',
  'weather',
  'morning_plan',
  'morning_execution_plan',
  'evening_output',
  'evening_schedule_met',
  'evening_schedule_miss_reason',
  'evening_workers_on_site',
] as const

// daily_log_edits.new_value is JSONB. Migration 019's own NULL/TYPE
// CONVENTION comment requires a JSON scalar matching the target column's
// NATURAL to_jsonb() type — a JSON number for an integer column, a JSON
// boolean for a boolean column — but nothing enforces that today; 019's own
// text defers enforcement to "the future Server-Action wrapper's Zod,"
// which does not exist yet. Casting new_value straight into a typed field
// (`as boolean | null` / `as number | null`) asserts a contract nothing
// currently guarantees: a correction stored as the JSON STRING "10" would
// satisfy neither cast at compile time, TypeScript cannot catch it at
// runtime, and downstream arithmetic often coerces just well enough to
// look right while strict comparisons (`=== 0`, `> headcount`) silently
// misclassify. Parse and validate explicitly — fail loud on a mismatch
// rather than propagate a value of the wrong runtime type, matching this
// codebase's existing fail-closed posture for integrity violations (019's
// own column whitelist fails closed the same way).
//
// FORWARD NOTE (CLAUDE.md §10, REGENERATION-ON-CORRECTION DOES NOT EXIST):
// throwing is right HERE, today, precisely because assemble.ts has no
// caller yet — a thrown error means no DPR, which is visible and gets
// investigated, versus silently skipping a bad correction and letting the
// owner read a pre-correction number with nothing to flag it. Once the
// dpr_generate job handler exists, this throw MUST land in DPR-24's
// failed-delivery path (delivery_status='failed', Sentry, PM + founder
// notified), not crash a cron invocation silently. Whoever builds that
// handler needs to catch this, not let it propagate unhandled.

export function parseCorrectedBoolean(column: string, rawValue: boolean | null, editValue: unknown): boolean | null {
  if (editValue === undefined) return rawValue
  if (editValue === null) return null // SQL NULL clears the field — 019's own convention.
  if (typeof editValue === 'boolean') return editValue
  throw new Error(`daily_log_edits.new_value for boolean column "${column}" was not a boolean: ${JSON.stringify(editValue)}`)
}

export function parseCorrectedInteger(column: string, rawValue: number | null, editValue: unknown): number | null {
  if (editValue === undefined) return rawValue
  if (editValue === null) return null
  if (typeof editValue === 'number' && Number.isFinite(editValue)) return editValue
  throw new Error(`daily_log_edits.new_value for integer column "${column}" was not a finite number: ${JSON.stringify(editValue)}`)
}

export async function assembleDprFacts(
  client: SupabaseClient,
  project_id: string,
  log_date: string,
  opts: MergeDprFactsOptions = {},
): Promise<DprFacts> {
  const { data: logs, error: logsError } = await client
    .from('daily_logs')
    .select('*')
    .eq('project_id', project_id)
    .eq('log_date', log_date)

  if (logsError) throw logsError
  if (!logs || logs.length === 0) {
    // Zero-data day (DPR-17) is the CALLER's concern, not this function's
    // — the dispatch decision of whether to even reach the fact assembler
    // is generator-assembly logic that doesn't exist yet (same blocker as
    // golden case #6). This function just returns an all-empty DprFacts
    // rather than guessing at a skip decision that isn't its to make.
    return mergeDprFacts([], opts)
  }

  const dailyLogsIds = logs.map((row) => row.id as string)
  const { data: edits, error: editsError } = await client
    .from('daily_log_edits')
    .select('daily_logs_id, column_name, new_value, created_at')
    .in('daily_logs_id', dailyLogsIds)
    .order('created_at', { ascending: true })

  if (editsError) throw editsError

  // Latest new_value per (daily_logs_id, column_name) — later rows in the
  // ascending-ordered result overwrite earlier ones for the same key, so
  // the map ends up holding the last edit.
  const latestEditByKey = new Map<string, unknown>()
  for (const edit of edits ?? []) {
    latestEditByKey.set(`${edit.daily_logs_id}:${edit.column_name}`, edit.new_value)
  }

  const correctedRows: CorrectedDailyLogRow[] = logs.map((row) => {
    const scheduleMetEdit = latestEditByKey.get(`${row.id}:evening_schedule_met`)
    const workersOnSiteEdit = latestEditByKey.get(`${row.id}:evening_workers_on_site`)

    const eveningOutputQuantities = row.evening_output_quantities as {
      items: Array<{ activity: string; quantity: number | null; unit: string }>
    } | null
    const eveningProductiveManpower = row.evening_productive_manpower as {
      productive_count: number | null
      idle_count: number | null
      confidence: 'high' | 'low'
    } | null
    const morningEquipment = row.morning_equipment as { items: Array<{ type: string; daily_hire_cost: number | null }> } | null
    const eveningEquipmentUtilisation = row.evening_equipment_utilisation as {
      items: Array<{ morning_item_index: number | null; type: string; available_hours: number | null; actual_hours: number | null }>
      confidence: 'high' | 'low'
    } | null

    return {
      engineer_id: row.engineer_id as string,
      evening_output_quantities: eveningOutputQuantities,
      evening_schedule_met: parseCorrectedBoolean('evening_schedule_met', row.evening_schedule_met, scheduleMetEdit),
      evening_workers_on_site: parseCorrectedInteger('evening_workers_on_site', row.evening_workers_on_site, workersOnSiteEdit),
      evening_productive_manpower: eveningProductiveManpower,
      morning_equipment: morningEquipment,
      evening_equipment_utilisation: eveningEquipmentUtilisation,
    }
  })

  return mergeDprFacts(correctedRows, opts)
}
