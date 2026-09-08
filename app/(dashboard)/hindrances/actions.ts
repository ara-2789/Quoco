'use server'

import * as Sentry from '@sentry/nextjs'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'

// DASH-07 Phase 2 — Acknowledge / Undo (docs/plans/dash-07-hindrance-
// queue.md). Plain table UPDATEs, not RPCs -- authorization is enforced by
// migration 039's own RESTRICTIVE, project-scoped RLS policy
// (hindrances_update_project_scoped) plus column-level GRANTs
// (acknowledged_at, acknowledged_by only -- never ack_notified_at, which
// `authenticated` cannot write at all). No app-layer PM/membership
// pre-check duplicates that here: unlike daily-logs' correctDailyLogField
// (which pre-checks role so an ORDINARY non-PM viewer's read-then-attempt
// isn't Sentry-reported as a bug), this page only ever shows a PM their own
// PM'd projects' hindrances in the first place (getHindranceQueue's own
// project_members/role='pm' filter) -- an authenticated caller reaching
// this action with a hindrance id outside their own queue is not an
// ordinary path, so any resulting rejection is reported, not swallowed.

export type AckActionResult = { status: 'ok' } | { status: 'error'; message: string }

const SAVE_FAILURE_MESSAGE = "Couldn't save that. Try again."

export async function acknowledgeHindrance(hindranceId: string): Promise<AckActionResult> {
  const supabase = await createClient()
  const profile = await getProfile() // enforces auth -- redirects to /login if unauthenticated

  const { data, error } = await supabase
    .from('hindrances')
    .update({ acknowledged_at: new Date().toISOString(), acknowledged_by: profile.id })
    .eq('id', hindranceId)
    .select('id')

  if (error) {
    Sentry.captureException(new Error(`acknowledge hindrance ${error.code ?? 'no code'}: ${error.message}`), {
      tags: { feature: 'dash-07-hindrance-ack' },
    })
    return { status: 'error', message: SAVE_FAILURE_MESSAGE }
  }
  // RLS filtering an UPDATE to zero matched rows is not itself a Postgres
  // error (CLAUDE.md-documented behaviour) -- checked explicitly so a
  // silently-no-op write is never reported as success.
  if (!data || data.length === 0) {
    Sentry.captureMessage('acknowledge hindrance update matched zero rows', {
      level: 'warning',
      tags: { feature: 'dash-07-hindrance-ack' },
      extra: { hindranceId },
    })
    return { status: 'error', message: SAVE_FAILURE_MESSAGE }
  }

  // Both this action's callers -- the /hindrances row and the DASH-01 tile
  // -- share it unchanged, so both paths are revalidated here regardless of
  // which page triggered the write, ensuring either surface reflects it.
  revalidatePath('/hindrances')
  revalidatePath('/dashboard')
  return { status: 'ok' }
}

export async function unacknowledgeHindrance(hindranceId: string): Promise<AckActionResult> {
  const supabase = await createClient()
  await getProfile() // enforces auth -- redirects to /login if unauthenticated

  // Clears BOTH together, never touches ack_notified_at (not in this
  // payload at all -- Stage 3's sender-notified fact survives an undo by
  // construction, not by a guard that could be forgotten).
  const { data, error } = await supabase
    .from('hindrances')
    .update({ acknowledged_at: null, acknowledged_by: null })
    .eq('id', hindranceId)
    .select('id')

  if (error) {
    Sentry.captureException(new Error(`unacknowledge hindrance ${error.code ?? 'no code'}: ${error.message}`), {
      tags: { feature: 'dash-07-hindrance-ack' },
    })
    return { status: 'error', message: SAVE_FAILURE_MESSAGE }
  }
  if (!data || data.length === 0) {
    Sentry.captureMessage('unacknowledge hindrance update matched zero rows', {
      level: 'warning',
      tags: { feature: 'dash-07-hindrance-ack' },
      extra: { hindranceId },
    })
    return { status: 'error', message: SAVE_FAILURE_MESSAGE }
  }

  // Both this action's callers -- the /hindrances row and the DASH-01 tile
  // -- share it unchanged, so both paths are revalidated here regardless of
  // which page triggered the write, ensuring either surface reflects it.
  revalidatePath('/hindrances')
  revalidatePath('/dashboard')
  return { status: 'ok' }
}
