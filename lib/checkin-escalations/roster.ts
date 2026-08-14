// Due roster for the check-in escalation sweep. Roster comes from
// project_members, NOT daily_logs — same reasoning as lib/dpr/
// accountability.ts (an engineer who submitted nothing has no daily_logs row
// to read; absence can't be detected from rows that don't exist). This file
// does not modify accountability.ts (protected by the hard constraint) but
// reuses its exported extractEngineerRow and RosterEngineer type directly,
// rather than re-deriving the same PostgREST array-vs-object resolution
// logic a second time.
//
// EXCLUSION RULES — checked against real code, not assumed, and DELIBERATELY
// DIFFERENT from accountability.ts's own filter set in one respect:
//
//   - Holiday: EXCLUDED from the roster entirely, same as accountability.ts's
//     effective behaviour (a holiday engineer is computed to 'submitted' and
//     never appears in an accountability gap). daily_logs.is_holiday IS
//     NULLABLE (checked via information_schema, 2026-08-13) though its
//     column default is false — handled explicitly below via `=== true`,
//     which treats NULL (and the more common case of no daily_logs row at
//     all) as "not holiday", never as a silent drop.
//
//   - messaging_blocked: Aravind's decision (2026-08-13, reviewing this
//     module's first draft, which DID filter it out) — do NOT exclude.
//     accountability.ts itself has no messaging_blocked filter at all (its
//     §6 per-day aggregator never references the column); the first draft's
//     "exclude it" instruction cited Rule 5.3, which governs 7-day PATTERN
//     math (still suppressed, per accountability.ts's own header) and does
//     not extend to this sweep's per-day roster. Concretely: excluding a
//     blocked engineer means an engineer who cannot be reached, and
//     therefore never submits, produces NO ROW AT ALL — the gap becomes
//     invisible to the PM, violating design-principles Rule 4.4 (external
//     blockers are named statuses, never mysteries) and inverting Rule 4.2
//     (every alert carries its action) by removing the alert entirely.
//     Blocked engineers stay in the roster, are never advanced to a
//     nudge/send state (no sender exists in this slice regardless), and
//     close as not_submitted at cutoff like anyone else who did not submit.
//     users.messaging_blocked is NOT NULL (checked), so there is no NULL
//     ambiguity here even though the filter itself is gone.
//
//   NOT BUILT HERE, NAMED FOR LATER: a distinguishable "unreachable" status
//   on the dashboard (visually different from an ordinary not_submitted gap)
//   is the genuinely right long-term answer for a blocked engineer, so a PM
//   isn't shown an identical gap for "didn't submit" and "cannot receive
//   anything." That needs a new column on checkin_escalations — a schema
//   change, out of scope for this slice per the standing migration-state
//   rule (flag and stop, do not author one). Not decided beyond naming it.

import { extractEngineerRow, type RosterEngineer } from '@/lib/dpr/accountability'
import type { SupabaseClient } from '@supabase/supabase-js'

export interface DueRosterEngineer extends RosterEngineer {
  whatsapp_number: string
}

/** Pure filter — testable without a client. holidayEngineerIds is the set of engineer_ids whose daily_logs row has is_holiday === true for this date. */
export function filterDueRoster(roster: DueRosterEngineer[], holidayEngineerIds: ReadonlySet<string>): DueRosterEngineer[] {
  return roster.filter((r) => !holidayEngineerIds.has(r.engineer_id))
}

export async function fetchDueRoster(client: SupabaseClient, projectId: string, logDate: string): Promise<DueRosterEngineer[]> {
  const { data: members, error: membersError } = await client
    .from('project_members')
    .select('users!inner(id, full_name, role, status, whatsapp_number)')
    .eq('project_id', projectId)
    .eq('users.role', 'engineer')
    .eq('users.status', 'active')

  if (membersError) throw membersError

  const roster: DueRosterEngineer[] = (members ?? []).map((m) => {
    const raw = (m as { users: unknown }).users
    const row = extractEngineerRow(raw)
    const resolved = Array.isArray(raw) ? raw[0] : raw
    const whatsapp_number = (resolved as { whatsapp_number?: string | null } | null)?.whatsapp_number ?? ''
    return { engineer_id: row.id, engineer_name: row.full_name ?? 'Unnamed engineer', whatsapp_number }
  })

  if (roster.length === 0) return []

  // Same fetch shape as accountability.ts's TodayLogRow query — project_id +
  // log_date + engineer_id IN roster — but only pulling is_holiday, the one
  // field this module needs.
  const engineerIds = roster.map((r) => r.engineer_id)
  const { data: logs, error: logsError } = await client
    .from('daily_logs')
    .select('engineer_id, is_holiday')
    .eq('project_id', projectId)
    .eq('log_date', logDate)
    .in('engineer_id', engineerIds)
  if (logsError) throw logsError

  // === true (not a SQL .eq('is_holiday', false) filter) is what makes this
  // NULL-safe: NULL and "no row at all" both correctly fall through to "not
  // holiday" rather than being silently excluded from the roster.
  const holidayEngineerIds = new Set((logs ?? []).filter((l) => l.is_holiday === true).map((l) => l.engineer_id as string))

  return filterDueRoster(roster, holidayEngineerIds)
}
