import type { SupabaseClient } from '@supabase/supabase-js'

// B3 -- the 15:00 IST morning cutoff sweep. Thin wrapper around
// sweep_stale_morning_sessions (supabase/migrations/033_sweep_stale_morning_
// sessions.sql, currently held in docs/reviews/ pending apply -- see that
// file's own header for the full spec this implements). ALL decision logic
// (the cutoff gate, per-step behaviour, the attendance/defaulted/raw
// markers, the session reset) lives in the RPC, same authority split as
// every other flow-turn RPC in this codebase (applyMorningFlowTurn's own
// header: "production behaviour is entirely determined by that RPC"). This
// function is not a mirror -- there is no separate TypeScript decision
// logic to keep in sync, only a call and a typed return.
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
   */
  missingDailyLogsRows: MorningCutoffSweepMissingRow[]
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
  }
}
