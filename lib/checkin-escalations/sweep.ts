// The check-in escalation sweep — one project/date/half at a time. Ties
// roster.ts, daily_logs submission facts, and status.ts's decision together,
// then writes via a two-step guarded upsert that needs no advisory lock and
// no new schema (Vercel Cron's at-least-once semantics answered with only
// what 027 already provides: the UNIQUE key and a rank-guarded UPDATE).
//
// NOT REGISTERED AS A CRON ROUTE — no app/api/ file calls this yet. A future
// slice loops over active projects (same SELECT id, tenant_id FROM projects
// WHERE status='active' shape app/api/cron/dpr-generate/route.ts already
// uses) and calls runCheckinEscalationSweep once per project. That loop, and
// the CRON_SECRET-gated HTTP route around it, are out of scope here.

import type { SupabaseClient } from '@supabase/supabase-js'
import { fetchDueRoster, type DueRosterEngineer } from './roster'
import { determineTargetStatus, allowedSourceStatuses, timestampColumnFor, type CheckinStatus, type Half } from './status'

export interface SweepParams {
  client: SupabaseClient
  /**
   * Explicit, not derived from the roster fetch — project_members/users
   * carries no tenant_id in this module's query (roster.ts mirrors
   * accountability.ts's shape, which doesn't select it either). The caller
   * already has it from the same active-projects loop that supplies
   * projectId — mirroring how app/api/cron/dpr-generate/route.ts's
   * runDprGenerateTrigger receives project.tenant_id from its own project
   * loop, not from a second lookup.
   */
  tenantId: string
  projectId: string
  logDate: string
  half: Half
  /** Injected for determinism — same convention as applyMorningFlowTurn/applyEveningFlowTurn's `now` parameter. */
  now: Date
}

export interface SweepResult {
  engineersConsidered: number
  writesAttempted: number
}

/**
 * Step 1 (per engineer): ensure a row exists — race-safe via 027's own
 * UNIQUE(project_id, engineer_id, log_date, half) constraint. Two concurrent
 * invocations both attempting this simply have one succeed and one no-op.
 *
 * Step 2: guarded advance. Skipped entirely when target is 'awaited' — there
 * is nothing to advance TO; the insert above already establishes that
 * baseline via the column's own DEFAULT. Otherwise, the UPDATE's
 * .in('status', allowedSourceStatuses(target)) filter is evaluated by
 * Postgres against the CURRENT row at execution time, not a client-side
 * snapshot — this, not application-level sequencing, is what makes it safe
 * under concurrent/retried invocations. Running this twice with the same
 * computed target: the second call's UPDATE matches zero rows (Correction 2
 * — the target's own current status is excluded from its own allowed
 * sources), so the row's timestamp is left exactly as the first call set it.
 */
export async function sweepEngineerHalf(
  client: SupabaseClient,
  params: { tenantId: string; projectId: string; engineerId: string; logDate: string; half: Half; targetStatus: CheckinStatus; now: string },
): Promise<void> {
  const { error: insertError } = await client.from('checkin_escalations').upsert(
    {
      tenant_id: params.tenantId,
      project_id: params.projectId,
      engineer_id: params.engineerId,
      log_date: params.logDate,
      half: params.half,
    },
    { onConflict: 'project_id,engineer_id,log_date,half', ignoreDuplicates: true },
  )
  if (insertError) throw insertError

  if (params.targetStatus === 'awaited') return

  const timestampColumn = timestampColumnFor(params.targetStatus)
  const updatePayload: Record<string, unknown> = { status: params.targetStatus, updated_at: params.now }
  if (timestampColumn) updatePayload[timestampColumn] = params.now

  const { error: updateError } = await client
    .from('checkin_escalations')
    .update(updatePayload)
    .eq('project_id', params.projectId)
    .eq('engineer_id', params.engineerId)
    .eq('log_date', params.logDate)
    .eq('half', params.half)
    .in('status', allowedSourceStatuses(params.targetStatus))
  if (updateError) throw updateError
}

export async function runCheckinEscalationSweep(params: SweepParams): Promise<SweepResult> {
  const { client, tenantId, projectId, logDate, half, now } = params

  const roster: DueRosterEngineer[] = await fetchDueRoster(client, projectId, logDate)
  if (roster.length === 0) return { engineersConsidered: 0, writesAttempted: 0 }

  const engineerIds = roster.map((r) => r.engineer_id)
  const submittedColumn = half === 'morning' ? 'morning_submitted_at' : 'evening_submitted_at'
  const { data: logs, error: logsError } = await client
    .from('daily_logs')
    .select(`engineer_id, ${submittedColumn}`)
    .eq('project_id', projectId)
    .eq('log_date', logDate)
    .in('engineer_id', engineerIds)
  if (logsError) throw logsError

  const submittedByEngineer = new Map<string, string | null>((logs ?? []).map((l) => [l.engineer_id as string, (l as Record<string, unknown>)[submittedColumn] as string | null]))

  const nowIso = now.toISOString()
  let writesAttempted = 0
  for (const engineer of roster) {
    const submittedAt = submittedByEngineer.get(engineer.engineer_id) ?? null
    const targetStatus = determineTargetStatus({ half, now, submittedAt })
    await sweepEngineerHalf(client, {
      tenantId,
      projectId,
      engineerId: engineer.engineer_id,
      logDate,
      half,
      targetStatus,
      now: nowIso,
    })
    writesAttempted += 1
  }

  return { engineersConsidered: roster.length, writesAttempted }
}
