// The check-in escalation sweep — one project/date/half at a time. Ties
// roster.ts, daily_logs submission facts, and status.ts's decision together,
// then writes via a two-step guarded upsert that needs no advisory lock and
// no new schema (Vercel Cron's at-least-once semantics answered with only
// what 027 already provides: the UNIQUE key and a rank-guarded UPDATE).
//
// DATED CORRECTION (2026-09-04): the paragraph below, struck, predates this
// file's own wrapper actually being wired in and was wrong on two counts.
// It said the future loop calls runCheckinEscalationSweep "once per
// project" (singular) — the real loop calls it once per project PER HALF
// (two calls each, 'morning' and 'evening'). And it predicted a
// CRON_SECRET-gated HTTP route, which never happened: this sweep runs
// inside the EXISTING app/api/jobs/tick cron instead
// (runCheckinEscalationTickSweep, this file), the same placement as B3's
// morning-cutoff sweep and the outbound coverage sweep — see runJobsTick's
// own header for why idempotent time-triggered sweeps live there rather
// than as queued jobs or a dedicated route. vercel.json is unchanged.
//
// ~~NOT REGISTERED AS A CRON ROUTE — no app/api/ file calls this yet. A future
// slice loops over active projects (same SELECT id, tenant_id FROM projects
// WHERE status='active' shape app/api/cron/dpr-generate/route.ts already
// uses) and calls runCheckinEscalationSweep once per project. That loop, and
// the CRON_SECRET-gated HTTP route around it, are out of scope here.~~

import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { istDateString } from '@/lib/daily-logs/date'
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

// -----------------------------------------------------------------------------
// runCheckinEscalationTickSweep — the loop this file's own header used to
// only anticipate. Called once per app/api/jobs/tick invocation (see that
// route's own header for placement/isolation discipline), same active-
// projects query app/api/cron/dpr-generate/route.ts uses, then
// runCheckinEscalationSweep once per project PER HALF.
// -----------------------------------------------------------------------------

export interface CheckinEscalationSweepFailure {
  projectId: string
  half: Half
  message: string
}

export interface CheckinEscalationSweepResult {
  projectsSwept: number
  engineersConsidered: number
  writesAttempted: number
  /**
   * PER-PROJECT ISOLATION. Unlike sweepStaleMorningSessions/
   * runOutboundCoverageSweep (single operations), this is a loop over N
   * active projects x 2 halves — a naive version would let the first
   * throwing project abort every project after it, silently, reporting one
   * tick-level error indistinguishable from a genuine single failure. Each
   * (project, half) call below is isolated in its own try/catch; a failure
   * is collected here, not thrown, so one bad project never prevents the
   * rest of the tick's projects from being swept. Empty in the normal case.
   */
  failures: CheckinEscalationSweepFailure[]
}

const HALVES: readonly Half[] = ['morning', 'evening']

export async function runCheckinEscalationTickSweep(
  client: SupabaseClient,
  now: Date,
): Promise<CheckinEscalationSweepResult> {
  const logDate = istDateString(now)

  // Only this query failing rejects the whole sweep — with no active-projects
  // list, looping over "nothing" would be a false all-clear (projectsSwept: 0,
  // no failures), not an honest report that the sweep never ran at all.
  const { data: projects, error: projectsError } = await client
    .from('projects')
    .select('id, tenant_id')
    .eq('status', 'active')
  if (projectsError) throw projectsError

  let engineersConsidered = 0
  let writesAttempted = 0
  const failures: CheckinEscalationSweepFailure[] = []

  for (const project of projects ?? []) {
    for (const half of HALVES) {
      try {
        // NOT hoisted: fetchDueRoster (via runCheckinEscalationSweep) issues
        // two queries and is called once per half here, so the identical
        // roster is fetched twice per project per tick. Left as-is
        // deliberately — hoisting it would change runCheckinEscalationSweep's
        // own signature (roster becomes an input, not something it fetches),
        // out of scope for this change. Revisit if active projects reach the
        // dozens; at today's scale the duplicate fetch is noise.
        const result = await runCheckinEscalationSweep({
          client,
          tenantId: project.tenant_id,
          projectId: project.id,
          logDate,
          half,
          now,
        })
        engineersConsidered += result.engineersConsidered
        writesAttempted += result.writesAttempted
      } catch (err) {
        failures.push({
          projectId: project.id,
          half,
          message: err instanceof Error ? err.message : String(err),
        })
      }
    }
  }

  return {
    projectsSwept: (projects ?? []).length,
    engineersConsidered,
    writesAttempted,
    failures,
  }
}

/**
 * Same dedup convention as reportMorningSweepAnomalies (lib/daily-logs/
 * morning-cutoff-sweep.ts): fingerprint ends in the IST calendar day, so
 * same-day recurrences of the same (project, half) failure collapse into
 * one growing issue rather than paging every tick, while a failure still
 * live the NEXT day surfaces as a fresh issue.
 *
 * THE ONLY ANOMALY REPORTED HERE IS A PER-PROJECT FAILURE FROM THE LOOP
 * ABOVE. A project/half with zero engineers on the roster is a normal
 * product condition (exactly what DASH-01 will surface as its own tile,
 * not an error) — engineersConsidered: 0 is carried in the result for
 * whoever reads it, never sent to Sentry. Using an error tracker as a
 * product-data channel is the mistake this reporter deliberately does not
 * make.
 */
export function reportCheckinEscalationSweepAnomalies(result: CheckinEscalationSweepResult, now: Date): void {
  const day = istDateString(now)

  for (const f of result.failures) {
    Sentry.captureMessage('checkin-escalation-sweep: project sweep failed', {
      level: 'warning',
      fingerprint: ['checkin-escalation-sweep', 'project_sweep_failed', f.projectId, f.half, day],
      tags: { feature: 'checkin-escalation-sweep', reason: 'project_sweep_failed' },
      extra: { project_id: f.projectId, half: f.half, message: f.message },
    })
  }
}

/**
 * Third leg, same shape as reportMorningSweepError/
 * reportOutboundCoverageSweepError — extracted so the Sentry call is
 * directly unit-testable without a full tick-route harness.
 */
export function reportCheckinEscalationSweepError(err: unknown): { error: string } {
  const message = err instanceof Error ? err.message : String(err)
  Sentry.captureException(err instanceof Error ? err : new Error(message), {
    tags: { feature: 'checkin-escalation-sweep' },
  })
  return { error: message }
}
