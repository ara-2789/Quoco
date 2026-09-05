import type { SupabaseClient } from '@supabase/supabase-js'
import { equipmentLabel } from '@/lib/whatsapp/flows/parsers/lexicon'
import type {
  CapturedCount,
  CapturedNumber,
  DprFacts,
  EquipmentItemFacts,
  ExecutionQuantityFact,
  CapturedText,
  CheckInHalfStatus,
  CheckInStatus,
  EngineerDprFacts,
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
        // Humanized here, at the Facts layer (2026-08-11 finding: PR #45's
        // WhatsApp Q5 fix humanized the same raw type for the prompt, but
        // this DPR path re-introduced the raw string — assemble.ts §16's
        // own tracked debt entry named this exact fix, before it was ever
        // observed in real output). A label a human reads must be
        // code-owned, never left to render.ts or the model.
        type: equipmentLabel(items[0].type),
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
    // computeIdleCost no longer called — see mergeEngineerDprFacts's
    // identical note above (§33(c)/(e)).
    const idle_cost = notCapturedNumber
    equipmentItems.push({
      morning_item_index: nextIndex++,
      type: equipmentLabel(item.type), // humanized — see the suppressed-branch comment above
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

// -----------------------------------------------------------------------
// PER-ENGINEER ASSEMBLER (docs/dpr-engineer-report-spec.md) — a second,
// parallel assembler for a different report, added alongside everything
// above, not a replacement. mergeDprFacts/assembleDprFacts above are
// UNCHANGED and stay live for the deferred project-level report. This one
// takes ONE daily_logs row (or null — an engineer with no submission at
// all still gets a report, per the roster/union design), never an array —
// there is no multi-engineer suppression apparatus here because there is
// nothing to suppress: one report, one engineer, no collision possible.
// -----------------------------------------------------------------------

export interface CorrectedEngineerLogRow {
  engineer_id: string
  morning_plan: string | null // correctable (scalar)
  morning_manpower: { total: number | null; by_trade: Array<{ trade: string; count: number }>; raw_text: string | null } | null
  morning_equipment: { items: Array<{ type: string; daily_hire_cost: number | null }>; none: boolean } | null
  evening_output: string | null // correctable (scalar)
  evening_output_quantities: { items: Array<{ activity: string; quantity: number | null; unit: string }> } | null
  // Q5 hindrance answer, per §2's own comment above (mergeEngineerDprFacts) —
  // correctable (scalar), migration 019's original whitelist entry, kept
  // live and correct by 035's reuse rather than a rename (that migration's
  // own reasoning).
  evening_schedule_miss_reason: string | null
  // evening_schedule_met/evening_workers_on_site/evening_productive_manpower
  // REMOVED 2026-09-05 (PR C2) -- none have had a write path since migration
  // 035 (2026-08-31); nothing here reads them anymore. Superseded by
  // evening_manpower and evening_idle_hours below.
  //
  // Evening Q2 (workers by trade). Actual on-site headcount, by trade --
  // schema.ts's EngineerManpowerFacts.on_site source.
  evening_manpower: { total: number | null; by_trade: Array<{ trade: string; count: number }>; raw_text: string | null } | null
  // Evening Q3 (idle hours by trade), tri-state (all_working/unknown) per
  // its own migration-035 CHECK. by_trade feeds EngineerIdleHoursByTrade;
  // the tri-state itself is not consumed yet (PR C2 renders idle entries
  // when present, same as before this reconnection existed for anything).
  evening_idle_hours: {
    by_trade: Array<{ trade: string; idle_hours: number | null; matched: boolean }>
    all_working: boolean | null
    unknown: boolean | null
    raw_text: string | null
  } | null
  // Evening Q4 (equipment hours used), migration 035 RESHAPE -- type-string
  // keyed, one number (hours_used) per type, no morning_item_index, no
  // available_hours. implausible: 035's own attention flag (schema.ts's
  // own comment on EngineerEquipmentItemFacts.implausible).
  evening_equipment_utilisation: {
    items: Array<{ type: string; hours_used: number | null; matched: boolean; implausible: boolean | null; raw: string | null }>
    raw_text: string | null
    confidence: 'high' | 'low'
  } | null
}

const notCapturedText: CapturedText = { status: 'not_captured', value: null }

// Rule 2b: verbatim, never trimmed/re-cased/reordered — this is the ONLY
// transformation CapturedText is allowed: pass the stored value through
// unchanged. Empty-string/whitespace-only is treated as not_captured (an
// engineer who submitted nothing meaningful for a free-text field), not as
// a reported empty string — matches wrapNumber/wrapCount's own "null means
// absent" convention one level up.
function wrapText(value: string | null): CapturedText {
  if (value === null || value.trim() === '') return notCapturedText
  return { status: 'reported', value }
}

// Same convention as parseCorrectedBoolean/parseCorrectedInteger above —
// SQL NULL clears the field, a non-string new_value is a type-integrity
// violation and throws rather than propagating a value of the wrong
// runtime type.
export function parseCorrectedText(column: string, rawValue: string | null, editValue: unknown): string | null {
  if (editValue === undefined) return rawValue
  if (editValue === null) return null
  if (typeof editValue === 'string') return editValue
  throw new Error(`daily_log_edits.new_value for text column "${column}" was not a string: ${JSON.stringify(editValue)}`)
}

// Pure. row === null means no daily_logs row exists at all for this
// engineer/day (a genuinely silent engineer, per the roster-driven
// trigger's own design — every roster/union engineer gets a report,
// submitted or not). checkInStatus is computed by the caller
// (deriveCheckInStatus below), not here — it needs project_members
// membership data this function has no reason to fetch.
export function mergeEngineerDprFacts(row: CorrectedEngineerLogRow | null, checkInStatus: { morning: CheckInHalfStatus; evening: CheckInHalfStatus }): EngineerDprFacts {
  if (!row) {
    return {
      morning_status: checkInStatus.morning,
      evening_status: checkInStatus.evening,
      work: { planned: notCapturedText, done_text: notCapturedText, done_quantity: notCapturedNumber, unit: '' },
      hindrance: { note: notCapturedText },
      manpower: { planned: notCapturedText, on_site: notCapturedText },
      idle_hours_by_trade: [],
      equipment: { items: [] },
    }
  }

  // §1 Work — planned verbatim (morning_plan). actual is a composite:
  // evening_output verbatim + the FIRST evening_output_quantities item
  // (single-engineer day, so there's no cross-engineer activity-name
  // matching to do — that problem is §12's, the deferred project report's,
  // not this one's). Spec's own binding table names both evening_output
  // and evening_output_quantities as Work's actual source; no rule for
  // matching a SPECIFIC quantity item to the plan beyond "the one
  // engineer's one quantity" for now — a real multi-activity-day nuance
  // named, not solved, here (see the plan document's own open question on
  // this pairing for a future multi-activity day).
  const firstQuantity = row.evening_output_quantities?.items[0] ?? null
  const work: EngineerDprFacts['work'] = {
    planned: wrapText(row.morning_plan),
    done_text: wrapText(row.evening_output),
    done_quantity: firstQuantity ? wrapNumber(firstQuantity.quantity) : notCapturedNumber,
    unit: firstQuantity?.unit ?? '',
  }

  // §2 Hindrance — REPLACED 2026-09-05 (PR C1). This used to read
  // row.evening_schedule_met, which has had no write path since migration
  // 035 (2026-08-31) deleted the question it answered — five days of
  // permanent null, not a genuine gap. The column that actually holds live
  // engineer input here is evening_schedule_miss_reason, reused by 035 for
  // the new unconditional Q5 hindrance question (that migration's own
  // COMMENT ON COLUMN says so). Read it as what it is.
  const hindrance: EngineerDprFacts['hindrance'] = { note: wrapText(row.evening_schedule_miss_reason) }

  // §3 Manpower — CHANGED 2026-09-05 (the "113 fabrication" incident,
  // schema.ts's own EngineerManpowerFacts comment has the full story).
  // Both fields now source `.raw_text`, never `.total` — `.total` on
  // BOTH morning_manpower and evening_manpower is a parser-summed number
  // (parseLabourCount sums every digit found in the free-text answer),
  // not something the engineer stated as one total. `.raw_text` is the
  // engineer's own answer, verbatim, already stored on both columns —
  // no new capture needed.
  const manpower: EngineerDprFacts['manpower'] = {
    planned: wrapText(row.morning_manpower?.raw_text ?? null),
    on_site: wrapText(row.evening_manpower?.raw_text ?? null),
  }

  // §3b Idle hours by trade — NEW 2026-09-05 (PR C2). evening_idle_hours
  // has existed since 035 with nothing reading it (DPR column audit
  // bucket 3b). One entry per trade the engineer reported idle time for;
  // a trade with idle_hours null/0, or never mentioned, gets no entry —
  // render.ts turns each entry into its own NEEDS ATTENTION line, the
  // same convention equipment idle-hours already used pre-035.
  const idle_hours_by_trade: EngineerDprFacts['idle_hours_by_trade'] = (row.evening_idle_hours?.by_trade ?? [])
    .filter((t) => t.idle_hours !== null && t.idle_hours > 0)
    .map((t) => ({ trade: t.trade, idle_hours: t.idle_hours as number }))

  // §4 Equipment — JOIN FIXED 2026-09-05 (PR C2). morning_equipment is
  // walked ON ITS OWN here, not merely as a side lookup (docs/dpr-
  // engineer-report-spec.md's "Known upstream defect this does NOT fix"
  // section, and the whole reason this reformat exists) — every morning
  // item becomes a Facts item, actual_hours/implausible 'not_captured'/
  // null unless a matching evening item exists. THE FIX ITSELF: the join
  // key was morning_item_index (a POSITIONAL scheme migration 035
  // deliberately retired — "the entire per-machine matching apparatus
  // this replaces is retired outright, not patched", that migration's own
  // words). Since 2026-08-31 this always missed: item.morning_item_index
  // is undefined on the real (035) stored shape, undefined !== null is
  // true, so eveningByIndex was keyed entirely on `undefined` and the
  // real per-engineer index lookup below always returned nothing (DPR
  // column audit, docs/reviews/dpr-column-audit-2026-09-05.md §3c — the
  // mechanism behind the 2026-09-04 incident's equipment-hours finding).
  // Rejoined by TYPE STRING, 035's own real join key, case/whitespace-
  // normalized (normalizeType, already used by the deferred assembler's
  // own §12 equipment section for the identical reason). Render bad
  // structured data honestly (spec): a garbled morning item ("job",
  // ₹15/day) still becomes a real Facts item, not silently dropped for
  // looking wrong.
  const eveningByType = new Map<string, { hours_used: number | null; implausible: boolean | null }>()
  for (const item of row.evening_equipment_utilisation?.items ?? []) {
    eveningByType.set(normalizeType(item.type), { hours_used: item.hours_used, implausible: item.implausible })
  }
  const equipmentConfidence = row.evening_equipment_utilisation?.confidence
  const items: EngineerDprFacts['equipment']['items'] = (row.morning_equipment?.items ?? []).map((morningItem) => {
    const eveningMatch = eveningByType.get(normalizeType(morningItem.type))
    const actual_hours = eveningMatch ? wrapNumber(eveningMatch.hours_used, equipmentConfidence) : notCapturedNumber
    const implausible = eveningMatch?.implausible ?? null
    const daily_hire_cost = morningItem.daily_hire_cost === null ? notCapturedNumber : { status: 'reported' as const, value: morningItem.daily_hire_cost }
    // computeIdleCost no longer called (§33(e), design-decisions-beta-
    // feedback.md, 2026-08-25, built 2026-09-04 — production incident):
    // idle cost is removed from the DPR (§33(c)); the function itself
    // stays, unused, for the invoice era. daily_hire_cost stays wired
    // as-is (§33(e) "do not drop") — the parser no longer writes a real
    // value into it (equipment.ts, §33(a)), so this naturally reads
    // not_captured on every new row; historical rows still flow through
    // honestly, per this file's own "render bad data honestly" design.
    const idle_cost = notCapturedNumber
    return {
      type: equipmentLabel(morningItem.type),
      daily_hire_cost,
      actual_hours,
      implausible,
      idle_cost,
    }
  })

  return {
    morning_status: checkInStatus.morning,
    evening_status: checkInStatus.evening,
    work,
    hindrance,
    manpower,
    idle_hours_by_trade,
    equipment: { items },
  }
}

// -----------------------------------------------------------------------
// Check-in status (spec Rule 7) — a THIRD-PARTY concern relative to Facts:
// needs project_members membership timing (created_at, active status) that
// has nothing to do with what daily_logs says. Kept in this file rather
// than a new module since it's small and reads the same row shape.
//
// SCOPE, STATED PLAINLY: "every question actually asked got an answer" is
// only fully recoverable for the two documented structural skips (evening
// Q3 on schedule_met=true, evening Q5/BOT-22 on empty morning_equipment —
// both derivable from Facts already in `row`). A genuinely abandoned
// mid-flow turn is NOT recoverable from daily_logs alone (would need a
// whatsapp_sessions.current_step read this function does not do) — falls
// through to the conservative default (partial, never complete) rather
// than guessing. Named, not silently assumed away.
// -----------------------------------------------------------------------

// Shape read straight off daily_logs for completeness purposes — a
// deliberately narrow subset, not the full CorrectedEngineerLogRow (no
// corrections applied here; completeness reads submission facts, not
// corrected content).
export interface HalfCompletenessRow {
  morning_submitted_at: string | null
  evening_submitted_at: string | null
  morning_plan: string | null
  morning_manpower: unknown
  morning_equipment: { items: unknown[] } | null
  evening_schedule_met: boolean | null
  evening_schedule_miss_reason: string | null
  evening_workers_on_site: number | null
  evening_productive_manpower: unknown
  evening_output: string | null
  evening_output_quantities: unknown
  evening_equipment_utilisation: { items: unknown[] } | null
}

// complete/partial/not_received only — NOT not_applicable, which the
// caller (dispatch.ts / the cron route) overlays afterward once it has the
// send-time/left-early comparison in scope (CHECKIN_CHECKPOINTS,
// project_members.created_at, IST conversion — none of which this
// function has any business reading). "Every question actually asked"
// covers the two documented structural skips only (evening Q3 on
// schedule_met=true, evening Q5/BOT-22 on empty morning_equipment) —
// anything else defaults to the conservative reading, per this file's own
// header note above.
export function deriveHalfCompleteness(half: 'morning' | 'evening', row: HalfCompletenessRow): CheckInStatus {
  if (half === 'morning') {
    if (row.morning_submitted_at) return 'complete'
    const anyField = row.morning_plan !== null || row.morning_manpower !== null || row.morning_equipment !== null
    return anyField ? 'partial' : 'not_received'
  }

  if (row.evening_submitted_at) return 'complete'

  // Evening Q3 (schedule-miss reason) is skipped when schedule_met===true
  // — its own absence never counts against completeness. Evening Q5
  // (equipment hours) is skipped when morning_equipment has zero items —
  // same treatment.
  const q3Skipped = row.evening_schedule_met === true
  const q5Skipped = row.morning_equipment !== null && row.morning_equipment.items.length === 0

  const fieldsAskedAndAnswered = [
    row.evening_schedule_met !== null,
    q3Skipped || row.evening_schedule_miss_reason !== null,
    row.evening_workers_on_site !== null,
    row.evening_productive_manpower !== null,
    row.evening_output !== null || row.evening_output_quantities !== null,
    q5Skipped || row.evening_equipment_utilisation !== null,
  ]
  const anyAnswered = fieldsAskedAndAnswered.some(Boolean)
  const allAnswered = fieldsAskedAndAnswered.every(Boolean)

  if (allAnswered) return 'complete' // every field present but evening_submitted_at somehow null — defensive, not the expected path
  return anyAnswered ? 'partial' : 'not_received'
}

// -----------------------------------------------------------------------
// Thin IO wrapper. Fetches ONE daily_logs row (project_id, engineer_id,
// log_date), applies corrections for the columns 019 made correctable that
// this file now reads (morning_plan, evening_output,
// evening_schedule_met, evening_workers_on_site — a superset of the old
// assembler's two, since morning_plan/evening_output are first-class
// inputs here per the spec's binding table). checkInStatus is computed
// from the SAME fetched row (pre-correction submission facts — a
// correction changes CONTENT, never whether a question was originally
// answered) and returned alongside the Facts so the caller can overlay
// not_applicable without a second query.
// -----------------------------------------------------------------------

export interface AssembleEngineerResult {
  facts: EngineerDprFacts
  completeness: { morning: CheckInStatus; evening: CheckInStatus }
}

// No isHireRateTrusted option, unlike the old assembler — deliberate, not
// an oversight. The spec's own instruction ("render bad structured data
// honestly... showing it is how the defect becomes visible") means
// daily_hire_cost is always shown as-is here, garbled or not.
export async function assembleEngineerDprFacts(
  client: SupabaseClient,
  project_id: string,
  engineer_id: string,
  log_date: string,
): Promise<AssembleEngineerResult> {
  const { data: logs, error: logsError } = await client
    .from('daily_logs')
    .select('*')
    .eq('project_id', project_id)
    .eq('engineer_id', engineer_id)
    .eq('log_date', log_date)
    .maybeSingle()

  if (logsError) throw logsError

  if (!logs) {
    // No row at all — a genuinely silent engineer. Both halves default to
    // not_received here; the caller overlays not_applicable if the
    // send-time rule applies.
    return {
      facts: mergeEngineerDprFacts(null, { morning: { status: 'not_received' }, evening: { status: 'not_received' } }),
      completeness: { morning: 'not_received', evening: 'not_received' },
    }
  }

  const { data: edits, error: editsError } = await client
    .from('daily_log_edits')
    .select('column_name, new_value, created_at')
    .eq('daily_logs_id', logs.id)
    .order('created_at', { ascending: true })

  if (editsError) throw editsError

  const latestEditByColumn = new Map<string, unknown>()
  for (const edit of edits ?? []) {
    latestEditByColumn.set(edit.column_name as string, edit.new_value)
  }

  const completenessRow: HalfCompletenessRow = {
    morning_submitted_at: logs.morning_submitted_at as string | null,
    evening_submitted_at: logs.evening_submitted_at as string | null,
    morning_plan: logs.morning_plan as string | null,
    morning_manpower: logs.morning_manpower,
    morning_equipment: logs.morning_equipment as { items: unknown[] } | null,
    evening_schedule_met: logs.evening_schedule_met as boolean | null,
    evening_schedule_miss_reason: logs.evening_schedule_miss_reason as string | null,
    evening_workers_on_site: logs.evening_workers_on_site as number | null,
    evening_productive_manpower: logs.evening_productive_manpower,
    evening_output: logs.evening_output as string | null,
    evening_output_quantities: logs.evening_output_quantities,
    evening_equipment_utilisation: logs.evening_equipment_utilisation as { items: unknown[] } | null,
  }
  const completeness = {
    morning: deriveHalfCompleteness('morning', completenessRow),
    evening: deriveHalfCompleteness('evening', completenessRow),
  }

  const correctedRow: CorrectedEngineerLogRow = {
    engineer_id: logs.engineer_id as string,
    morning_plan: parseCorrectedText('morning_plan', logs.morning_plan as string | null, latestEditByColumn.get('morning_plan')),
    morning_manpower: logs.morning_manpower as CorrectedEngineerLogRow['morning_manpower'],
    morning_equipment: logs.morning_equipment as CorrectedEngineerLogRow['morning_equipment'],
    evening_output: parseCorrectedText('evening_output', logs.evening_output as string | null, latestEditByColumn.get('evening_output')),
    evening_output_quantities: logs.evening_output_quantities as CorrectedEngineerLogRow['evening_output_quantities'],
    evening_schedule_miss_reason: parseCorrectedText(
      'evening_schedule_miss_reason',
      logs.evening_schedule_miss_reason as string | null,
      latestEditByColumn.get('evening_schedule_miss_reason'),
    ),
    // evening_manpower/evening_idle_hours: NOT correctable (JSONB, outside
    // migration 019's scalar-only whitelist, same treatment as the fields
    // they replace) — read straight through, per this file's own existing
    // convention for every other JSONB column.
    evening_manpower: logs.evening_manpower as CorrectedEngineerLogRow['evening_manpower'],
    evening_idle_hours: logs.evening_idle_hours as CorrectedEngineerLogRow['evening_idle_hours'],
    evening_equipment_utilisation: logs.evening_equipment_utilisation as CorrectedEngineerLogRow['evening_equipment_utilisation'],
  }

  const facts = mergeEngineerDprFacts(correctedRow, {
    morning: { status: completeness.morning },
    evening: { status: completeness.evening },
  })

  return { facts, completeness }
}
