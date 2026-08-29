'use server'

import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { COLUMN_CONTRACT, validateValue, type CorrectableColumn } from '@/lib/daily-logs/correction'
import { classifyRpcError } from '@/lib/daily-logs/rpc-error-mapping'

// DASH-03 Rule 4.3 inline correction — the ONE Server Action for this
// surface, calling migration 019's correct_daily_log RPC. Deliberately its
// own module (not inline `'use server'` in a page file, the pattern the four
// existing sites use) because it's called from client components
// (ScalarFieldRow / HolidayField via lib/daily-logs/use-field-correction.ts)
// — a named deviation from house pattern, not a silent one.

export type CorrectionActionResult =
  | { status: 'saved'; editId: string }
  | { status: 'no-change' }
  | { status: 'error'; kind: 'forbidden' | 'not-found' | 'too-large' | 'unknown'; message: string }

export async function correctDailyLogField(
  dailyLogsId: string,
  column: CorrectableColumn,
  rawValue: unknown,
): Promise<CorrectionActionResult> {
  // Server-side re-validation, independent of the client (CLAUDE.md §6 —
  // never trust client validation alone). A well-typed caller can't pass a
  // column outside COLUMN_CONTRACT, but a Server Action is a public HTTP
  // endpoint under the hood — an untyped/forged call is possible, so the
  // whitelist check runs here too, not only in the UI.
  if (!(column in COLUMN_CONTRACT)) {
    return { status: 'error', kind: 'unknown', message: 'Something went wrong — please try again.' }
  }
  const validated = validateValue(column, rawValue)
  if (!validated.ok) {
    return { status: 'error', kind: 'too-large', message: validated.error }
  }

  const supabase = await createClient()
  // Enforces auth (redirects to /login if unauthenticated) before ever
  // reaching the RPC — a clean redirect rather than relying solely on the
  // RPC's own auth.uid()-is-null rejection path.
  await getProfile()

  const { data, error } = await supabase.rpc('correct_daily_log', {
    p_daily_logs_id: dailyLogsId,
    p_column: column,
    p_new_value: validated.value,
  })

  if (error) {
    const classified = classifyRpcError(error)
    if (classified.reportToSentry) {
      Sentry.captureException(new Error(`correct_daily_log ${error.code ?? 'no code'}: ${error.message}`), {
        tags: { feature: 'dash-03-correction', column },
      })
    }
    return { status: 'error', kind: classified.kind, message: classified.message }
  }
  if (data === null) return { status: 'no-change' }
  return { status: 'saved', editId: data as string }
}
