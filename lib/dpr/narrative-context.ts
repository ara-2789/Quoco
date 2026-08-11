import type { SupabaseClient } from '@supabase/supabase-js'

// Raw engineer free text, fed to the model as PROMPT INPUT for the no-digit
// narrative fields (schedule_miss_reason_note, tomorrows_plan_carry_forward_
// note, manpower_idle_reason_note, equipment_items[].idle_reason_note) —
// per the 2026-08-11 DATED AMENDMENT in schema.ts. Deliberately NOT part of
// DprFacts: the Facts/Judgment split governs what the model may OUTPUT
// (never a raw digit it invented), not what it may READ. This is a SEPARATE
// module from assemble.ts on purpose — mixing raw-text retrieval into "the
// fact assembler" would blur what that file's name promises. No Fact field
// changed, no schema change, PR #39's approved file untouched.
//
// Single-engineer days only for this slice. Multi-engineer suppression (§12)
// is a DprFacts concept — ManpowerFacts/ScheduleFacts suppress unconditionally
// on any multi-engineer day, and the corresponding narrative fields
// (manpower_idle_reason_note, schedule_miss_reason_note) would have nothing
// legitimate to comment on if their Facts are suppressed. Mirroring that
// here rather than deciding independently: suppressed() returns null (no raw
// context) whenever more than one engineer submitted, same trigger §12
// already uses.

export interface EquipmentIdleReason {
  morning_item_index: number | null
  idle_reason: string | null
}

export interface NarrativeContext {
  schedule_miss_reason: string | null // evening_schedule_miss_reason, raw.
  // Feeds BOTH schedule_miss_reason_note AND tomorrows_plan_carry_forward_
  // note — schema.ts's own field description already says the carry-forward
  // note applies the Q2/Q3 miss reason forward; there is no separate Q6 raw
  // text to fetch (Q6 hasn't shipped — TOMORROWS_PLAN_DATA_STATUS_FORCED).
  manpower_idle_reason: string | null // evening_productive_manpower.idle_reason, raw.
  equipment_idle_reasons: EquipmentIdleReason[] // evening_equipment_utilisation.items[].idle_reason, raw, one per item.
}

interface NarrativeContextRow {
  evening_schedule_miss_reason: string | null
  evening_productive_manpower: { idle_reason: string | null } | null
  evening_equipment_utilisation: { items: Array<{ morning_item_index: number | null; idle_reason: string | null }> } | null
}

export async function fetchNarrativeContext(
  client: SupabaseClient,
  project_id: string,
  log_date: string,
): Promise<NarrativeContext | null> {
  const { data: rows, error } = await client
    .from('daily_logs')
    .select('evening_schedule_miss_reason, evening_productive_manpower, evening_equipment_utilisation')
    .eq('project_id', project_id)
    .eq('log_date', log_date)

  if (error) throw error
  if (!rows || rows.length === 0) return null
  if (rows.length > 1) return null // multi-engineer day — mirror §12's suppression trigger

  const row = rows[0] as unknown as NarrativeContextRow

  return {
    schedule_miss_reason: row.evening_schedule_miss_reason,
    manpower_idle_reason: row.evening_productive_manpower?.idle_reason ?? null,
    equipment_idle_reasons: (row.evening_equipment_utilisation?.items ?? []).map((item) => ({
      morning_item_index: item.morning_item_index,
      idle_reason: item.idle_reason,
    })),
  }
}
