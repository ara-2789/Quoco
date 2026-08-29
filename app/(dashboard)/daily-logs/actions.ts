'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { COLUMN_CONTRACT, canEditLog, validateValue, type CorrectableColumn } from '@/lib/daily-logs/correction'
import { classifyRpcError, forbiddenBecauseNotPm } from '@/lib/daily-logs/rpc-error-mapping'

// DASH-03 Rule 4.3 inline correction — the ONE Server Action for this
// surface, calling migration 019's correct_daily_log RPC. Deliberately its
// own module (not inline `'use server'` in a page file, the pattern the four
// existing sites use) because it's called from client components
// (ScalarFieldRow / HolidayField via lib/daily-logs/use-field-correction.ts)
// — a named deviation from house pattern, not a silent one.

export type CorrectionActionResult =
  | { status: 'saved'; editId: string }
  | { status: 'no-change' }
  | {
      status: 'error'
      kind: 'forbidden' | 'not-found' | 'too-large' | 'required' | 'invalid' | 'unknown'
      message: string
    }

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
  // validateValue's own kind ('required' | 'invalid' | 'too-large') is
  // passed through as-is, not collapsed to one bucket — the caller (Sentry
  // tags, any future analytics) should be able to tell "the value was too
  // long" apart from "no value was given" without the kind and the message
  // disagreeing.
  const validated = validateValue(column, rawValue)
  if (!validated.ok) {
    return { status: 'error', kind: validated.kind, message: validated.error }
  }

  const supabase = await createClient()
  const profile = await getProfile() // also enforces auth — redirects to /login if unauthenticated

  // The role gate for WRITES. The read side is deliberately NOT gated: any
  // project_members role can view the detail page, but only role==='pm' may
  // write. Checked HERE, before the RPC, not left to the RPC's own 42501 —
  // a Server Action is callable directly regardless of what the UI renders
  // (same "untyped/forged call is possible" reasoning as the column
  // whitelist above), so a non-PM project member reaching this function is
  // an expected, ordinary path, not a hypothetical. Deliberately NOT
  // Sentry-reported (forbiddenBecauseNotPm's own comment has the full
  // reasoning) — reporting it would tag every ordinary non-PM read-then-
  // attempted-edit as a bug, drowning the one signal that actually matters:
  // a 42501 the RPC returns AFTER this check has already passed.
  if (!canEditLog(profile.role)) {
    const forbidden = forbiddenBecauseNotPm()
    return { status: 'error', kind: forbidden.kind, message: forbidden.message }
  }

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

  // 'saved' branch ONLY — never on 'no-change' (nothing changed, the
  // server-rendered page is already accurate) and never on 'error' (the
  // write never happened). This invalidates the Next.js cache for the
  // detail route; the actual client re-render is triggered separately by
  // router.refresh() in lib/daily-logs/use-field-correction.ts (and
  // holiday-field.tsx's own orchestration) once this action resolves —
  // revalidatePath alone does not cause an already-mounted client
  // component to re-fetch on its own.
  revalidatePath(`/daily-logs/${dailyLogsId}`)
  return { status: 'saved', editId: data as string }
}
