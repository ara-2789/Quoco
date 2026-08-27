// Roster queries for the outbound send primitive (Pass 1 item B). Same
// project_members-JOIN-users shape as lib/dpr/accountability.ts and
// lib/checkin-escalations/roster.ts (roster comes from WHO SHOULD get a
// trigger, not from daily_logs -- an engineer with no daily_logs row yet
// is exactly who a trigger needs to reach), reusing extractEngineerRow so
// the array-vs-object PostgREST ambiguity is handled once, the same
// defensive way, everywhere it's handled at all.

import type { SupabaseClient } from '@supabase/supabase-js'
import { extractEngineerRow, type RosterEngineer } from '@/lib/dpr/accountability'

export interface OutboundRosterEngineer extends RosterEngineer {
  whatsapp_number: string
  tenant_id: string
}

async function fetchActiveEngineers(
  client: SupabaseClient,
  projectId: string,
): Promise<OutboundRosterEngineer[]> {
  // messaging_blocked EXCLUDED here, unlike lib/checkin-escalations/
  // roster.ts's own roster (that module deliberately keeps a blocked
  // engineer visible so a PM sees the gap, per that file's own header).
  // This is a DIFFERENT query for a DIFFERENT purpose: this roster feeds a
  // real Twilio send attempt, and plan §5's own failure-mode table is
  // explicit -- "Excluded from the roster query BEFORE any claim/send
  // attempt... no ledger row, no Twilio call, no error." Do not converge
  // these two rosters; they exist for opposite reasons.
  const { data: members, error } = await client
    .from('project_members')
    .select('users!inner(id, full_name, role, status, whatsapp_number, tenant_id, messaging_blocked)')
    .eq('project_id', projectId)
    .eq('users.role', 'engineer')
    .eq('users.status', 'active')
    .eq('users.messaging_blocked', false)

  if (error) throw error

  return (members ?? []).map((m) => {
    const raw = (m as { users: unknown }).users
    const row = extractEngineerRow(raw)
    const resolved = Array.isArray(raw) ? raw[0] : raw
    const typed = resolved as { whatsapp_number?: string | null; tenant_id?: string } | null
    return {
      engineer_id: row.id,
      engineer_name: row.full_name ?? 'Unnamed engineer',
      whatsapp_number: typed?.whatsapp_number ?? '',
      tenant_id: typed?.tenant_id ?? '',
    }
  })
}

/**
 * Morning trigger roster. No `daily_logs` join at all -- there is nothing
 * to read yet at 08:30; today's row, if any, is created BY this trigger's
 * own RPC call (startFlow: true), not read beforehand. Only exclusion:
 * `messaging_blocked`.
 */
export async function fetchMorningRoster(client: SupabaseClient, projectId: string): Promise<OutboundRosterEngineer[]> {
  return fetchActiveEngineers(client, projectId)
}

export interface EveningRosterEngineer extends OutboundRosterEngineer {
  /** daily_logs.morning_plan for today, or null if no row / no plan captured. Feeds templates.ts's own template-variant selection -- NOT a gate. */
  morningPlan: string | null
}

/** What today's daily_logs row (if any) contributes to the evening-roster decision -- deliberately narrow, mirrors lib/checkin-escalations/roster.ts's own TodayLogRow-shaped narrowing. */
export interface EveningTodayLogRow {
  attendance: string | null
  morning_plan: string | null
}

/**
 * Pure filter -- testable without a client, same split as
 * lib/checkin-escalations/roster.ts's own filterDueRoster.
 *
 * HARD REQUIREMENT (design-decisions-beta-feedback.md §37(a), confirmed
 * against §30(b)/(d)): this roster must NOT gate on morning submission.
 * An engineer who missed the morning window entirely may have been on
 * site all day -- the evening trigger asking what happened does not
 * depend on whether he already answered a different, earlier question.
 * The ONLY two exclusions are `messaging_blocked=true` (applied upstream,
 * in fetchActiveEngineers -- an already-excluded engineer never reaches
 * this function at all) and `attendance='site_holiday'` (below,
 * evening-only, since attendance is only known once a daily_logs row
 * exists for today). DO NOT add a `morning_submitted_at IS NOT NULL`
 * filter here, no matter how natural it looks copying
 * `routeInboundMessage`'s shape (`lib/whatsapp/inbound-start.ts`) --
 * that gate is specific to the INBOUND path and is NOT precedent for
 * this query. See §37(b) for the inbound gap this roster must not
 * inherit. See test/unit/outbound-roster.test.ts for the regression test
 * that pins this property directly.
 */
export function filterEveningRoster(
  roster: OutboundRosterEngineer[],
  todayLogsByEngineer: ReadonlyMap<string, EveningTodayLogRow>,
): EveningRosterEngineer[] {
  return roster
    .filter((r) => todayLogsByEngineer.get(r.engineer_id)?.attendance !== 'site_holiday')
    .map((r) => ({ ...r, morningPlan: todayLogsByEngineer.get(r.engineer_id)?.morning_plan ?? null }))
}

/**
 * Evening trigger roster (DB-touching). See filterEveningRoster's own doc
 * for the hard requirement this function must not violate.
 */
export async function fetchEveningRoster(
  client: SupabaseClient,
  projectId: string,
  logDate: string,
): Promise<EveningRosterEngineer[]> {
  const roster = await fetchActiveEngineers(client, projectId)
  if (roster.length === 0) return []

  const engineerIds = roster.map((r) => r.engineer_id)
  const { data: logs, error } = await client
    .from('daily_logs')
    .select('engineer_id, attendance, morning_plan')
    .eq('project_id', projectId)
    .eq('log_date', logDate)
    .in('engineer_id', engineerIds)
  if (error) throw error

  const byEngineer = new Map(
    (logs ?? []).map((l) => [l.engineer_id as string, l as EveningTodayLogRow]),
  )

  return filterEveningRoster(roster, byEngineer)
}
