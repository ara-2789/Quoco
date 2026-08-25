import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { istDateString } from '@/lib/daily-logs/date'

// B3 -- the 15:00 IST morning cutoff sweep. Thin wrapper around
// sweep_stale_morning_sessions (supabase/migrations/033_sweep_stale_morning_
// sessions.sql -- see that file's own header for the full spec this
// implements). ALL decision logic
// (the cutoff gate, per-step behaviour, the attendance/defaulted/raw
// markers, the session reset, the project-membership skip) lives in the
// RPC, same authority split as every other flow-turn RPC in this codebase
// (applyMorningFlowTurn's own header: "production behaviour is entirely
// determined by that RPC"). This function is not a mirror -- there is no
// separate TypeScript decision logic to keep in sync, only a call and a
// typed return.
//
// Called from app/api/jobs/tick/route.ts's runJobsTick, once per tick,
// alongside job claiming -- NOT a queued job type (this is time-triggered,
// not queued) and NOT a new vercel.json cron entry. The RPC itself no-ops
// before 15:00 IST and is idempotent after it (see its own header) -- this
// wrapper adds nothing beyond the call and error handling.

export interface MorningCutoffSweepMissingRow {
  phoneNumber: string
  currentStep: number
  reason: string
}

export interface MorningCutoffSweepSkippedSession {
  phoneNumber: string
  currentStep: number
  projectMembershipCount: number
  reason: 'zero_project_memberships' | 'multiple_project_memberships'
}

export interface MorningCutoffSweepResult {
  sweptCount: number
  sweptPhoneNumbers: string[]
  reason?: string
  /**
   * Steps 2-4 assume a daily_logs row already exists for that engineer/date
   * (attendance is written the moment step 1 resolves YES) -- when it
   * doesn't, the RPC's own UPDATE silently affects zero rows. Surfaced here,
   * not thrown -- one bad row must not fail the whole tick's sweep. Empty
   * in the normal case.
   *
   * "Surfaced here" is not by itself a safety argument -- this value lives
   * in a cron HTTP response body nobody reads (external review round 1,
   * B2). reportMorningSweepAnomalies (below) is what actually makes this
   * visible; call it on every successful sweep.
   */
  missingDailyLogsRows: MorningCutoffSweepMissingRow[]
  /**
   * A session whose engineer has zero or more than one project_members row.
   * daily_logs is keyed on (project_id, engineer_id, log_date) -- guessing
   * a project for a multi-project engineer would fabricate data (step 5's
   * INSERT especially) against a project the engineer may have nothing to
   * do with. These sessions are left fully parked -- no daily_logs write,
   * no session reset -- and reported here every tick until the underlying
   * project_members data is fixed. Empty in the normal case.
   *
   * A zero-membership session parks FOREVER by design -- no inbound message
   * ever arrives to re-trigger anything, BOT-07's own next-day reset never
   * fires for a session whose current_flow never goes NULL. The
   * skip-over-guess decision (migration 033's own header) is safe only if
   * that permanence is actually visible somewhere a human looks -- see
   * reportMorningSweepAnomalies.
   */
  skippedCount: number
  skippedSessions: MorningCutoffSweepSkippedSession[]
}

export async function sweepStaleMorningSessions(
  client: SupabaseClient,
  now?: string,
): Promise<MorningCutoffSweepResult> {
  const { data, error } = await client.rpc('sweep_stale_morning_sessions', {
    ...(now !== undefined ? { p_now: now } : {}),
  })

  if (error) {
    throw new Error(`sweep_stale_morning_sessions failed: ${error.message}`)
  }

  const result = data as {
    swept_count: number
    swept_phone_numbers: string[]
    reason?: string
    missing_daily_logs_rows?: { phone_number: string; current_step: number; reason: string }[]
    skipped_count?: number
    skipped_sessions?: {
      phone_number: string
      current_step: number
      project_membership_count: number
      reason: 'zero_project_memberships' | 'multiple_project_memberships'
    }[]
  }

  return {
    sweptCount: result.swept_count,
    sweptPhoneNumbers: result.swept_phone_numbers,
    ...(result.reason !== undefined ? { reason: result.reason } : {}),
    missingDailyLogsRows: (result.missing_daily_logs_rows ?? []).map((r) => ({
      phoneNumber: r.phone_number,
      currentStep: r.current_step,
      reason: r.reason,
    })),
    skippedCount: result.skipped_count ?? 0,
    skippedSessions: (result.skipped_sessions ?? []).map((r) => ({
      phoneNumber: r.phone_number,
      currentStep: r.current_step,
      projectMembershipCount: r.project_membership_count,
      reason: r.reason,
    })),
  }
}

/**
 * B2 (external review round 1). The skip-over-guess decision for ambiguous
 * project membership, and the missing-daily_logs-row guard, both leaned on
 * "surfaced in the return value" as their safety argument -- but nothing
 * ever read that value: runJobsTick's response body is a cron HTTP response
 * nobody reads, and there was no Sentry call anywhere in this path. Call
 * this on every successful sweep (runJobsTick does) to make that visibility
 * real.
 *
 * DEDUP. A permanently-parked session (the zero/multi-membership case
 * especially -- see MorningCutoffSweepResult's own doc comment) gets
 * re-evaluated and re-skipped every tick, 60s apart, for as long as the
 * underlying data stays wrong -- without dedup this alerts every minute,
 * forever. Sentry's `fingerprint` groups every event sharing the same
 * fingerprint into ONE issue instead of a new one per call; scoping it to
 * (phone_number, reason, IST calendar date) collapses same-day recurrences
 * into one growing issue -- no per-minute spam -- while a session still
 * stuck the NEXT day surfaces as a fresh issue instead of silently vanishing
 * into an old, already-triaged one.
 */
export function reportMorningSweepAnomalies(result: MorningCutoffSweepResult, now: Date): void {
  const day = istDateString(now)

  for (const s of result.skippedSessions) {
    Sentry.captureMessage('morning-cutoff-sweep: session skipped, ambiguous project membership', {
      level: 'warning',
      fingerprint: ['morning-cutoff-sweep', 'skipped', s.reason, s.phoneNumber, day],
      tags: { feature: 'morning-cutoff-sweep', reason: s.reason },
      extra: {
        phone_number: s.phoneNumber,
        current_step: s.currentStep,
        project_membership_count: s.projectMembershipCount,
      },
    })
  }

  for (const r of result.missingDailyLogsRows) {
    Sentry.captureMessage('morning-cutoff-sweep: daily_logs row missing at sweep time', {
      level: 'warning',
      fingerprint: ['morning-cutoff-sweep', 'missing-row', r.phoneNumber, day],
      tags: { feature: 'morning-cutoff-sweep', reason: r.reason },
      extra: { phone_number: r.phoneNumber, current_step: r.currentStep },
    })
  }
}

/**
 * B2's third leg -- "the sweep's own error branch." Extracted from
 * runJobsTick's try/catch so the Sentry call is directly unit-testable
 * without standing up a full tick-route harness (none exists yet for
 * runJobsTick). Returns the same { error: string } shape runJobsTick's own
 * response already carried before this fix -- behaviour unchanged, only the
 * capture is new.
 */
export function reportMorningSweepError(err: unknown): { error: string } {
  const message = err instanceof Error ? err.message : String(err)
  Sentry.captureException(err instanceof Error ? err : new Error(message), {
    tags: { feature: 'morning-cutoff-sweep' },
  })
  return { error: message }
}
