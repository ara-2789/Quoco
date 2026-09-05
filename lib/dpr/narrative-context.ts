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
  type: string
  idle_reason: string | null
}

export interface NarrativeContext {
  // RENAMED 2026-09-05 (PR C1). This column is evening_schedule_miss_reason,
  // but 035 (2026-08-31) reused it for the unconditional Q5 hindrance
  // question — its own COMMENT ON COLUMN says so plainly. The old field
  // name here (schedule_miss_reason) kept feeding the deferred project-
  // level formatFacts prompt AND the live per-engineer formatEngineerFacts
  // prompt labeled as a schedule-miss reason for five days; named for what
  // it actually is now.
  hindrance_note: string | null // evening_schedule_miss_reason, raw.
  // RECONNECTED 2026-09-05 (PR C2, found while building C1). Was
  // evening_productive_manpower.idle_reason — a column with no write path
  // since 035, permanently null. There is no per-trade idle_reason in the
  // new shape either (evening_idle_hours' by_trade carries only trade/
  // idle_hours/matched) — the closest raw text is the Q3 answer's own
  // raw_text, one string for the whole reply, same granularity loss this
  // field already had for schedule_miss_reason pre-035 (whole-answer raw
  // text, not per-item).
  manpower_idle_reason: string | null // evening_idle_hours.raw_text, whole-answer raw.
  // RECONNECTED 2026-09-05 (PR C2, found while building C1). 035's real
  // shape has no `idle_reason` key (it's `raw`) and no `morning_item_index`
  // (it's `type` — the join key migration 035 replaced position with,
  // same fix as assemble.ts's equipment join, PR C2's other half).
  equipment_idle_reasons: EquipmentIdleReason[] // evening_equipment_utilisation.items[].raw, one per type.
}

interface NarrativeContextRow {
  evening_schedule_miss_reason: string | null
  evening_idle_hours: { raw_text: string | null } | null
  evening_equipment_utilisation: { items: Array<{ type: string; raw: string | null }> } | null
}

export async function fetchNarrativeContext(
  client: SupabaseClient,
  project_id: string,
  log_date: string,
): Promise<NarrativeContext | null> {
  const { data: rows, error } = await client
    .from('daily_logs')
    .select('evening_schedule_miss_reason, evening_idle_hours, evening_equipment_utilisation')
    .eq('project_id', project_id)
    .eq('log_date', log_date)

  if (error) throw error
  if (!rows || rows.length === 0) return null
  if (rows.length > 1) return null // multi-engineer day — mirror §12's suppression trigger

  const row = rows[0] as unknown as NarrativeContextRow

  return {
    hindrance_note: row.evening_schedule_miss_reason,
    manpower_idle_reason: row.evening_idle_hours?.raw_text ?? null,
    equipment_idle_reasons: (row.evening_equipment_utilisation?.items ?? []).map((item) => ({
      type: item.type,
      idle_reason: item.raw,
    })),
  }
}

// -----------------------------------------------------------------------
// PER-ENGINEER (docs/dpr-engineer-report-spec.md) — a second, parallel
// fetch for a different report, added alongside fetchNarrativeContext
// above, not a replacement. Single-row by construction (keyed on
// engineer_id, not just project_id/log_date) — no multi-engineer branch to
// mirror at all, since a per-engineer report never has one.
//
// WHY THIS IS STILL NEEDED, even though the per-engineer Judgment schema
// is digit-allowed (unlike the old no-digit fields this module was built
// for): the verdict sentence still needs raw text as PROMPT INPUT to write
// something coherent about WHY, e.g. the spec's own sample verdict "3
// workers were idle waiting for material" — "waiting for material" is
// nowhere in Facts, only in the raw Q3 answer (evening_idle_hours.raw_text,
// PR C2). The Facts/Judgment boundary this module respects is about what
// the model may OUTPUT (never fabricate a number), never what it may READ.
// -----------------------------------------------------------------------

export async function fetchEngineerNarrativeContext(
  client: SupabaseClient,
  project_id: string,
  engineer_id: string,
  log_date: string,
): Promise<NarrativeContext | null> {
  const { data: row, error } = await client
    .from('daily_logs')
    .select('evening_schedule_miss_reason, evening_idle_hours, evening_equipment_utilisation')
    .eq('project_id', project_id)
    .eq('engineer_id', engineer_id)
    .eq('log_date', log_date)
    .maybeSingle()

  if (error) throw error
  if (!row) return null

  const typed = row as unknown as NarrativeContextRow
  return {
    hindrance_note: typed.evening_schedule_miss_reason,
    manpower_idle_reason: typed.evening_idle_hours?.raw_text ?? null,
    equipment_idle_reasons: (typed.evening_equipment_utilisation?.items ?? []).map((item) => ({
      type: item.type,
      idle_reason: item.raw,
    })),
  }
}
