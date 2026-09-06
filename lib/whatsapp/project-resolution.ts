import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'

// Ad-hoc menu PR 2, step 3 (docs/plans/adhoc-menu-spec.md, "Project
// resolution" section). SKIP-AND-SURFACE, NEVER BEST-GUESS -- same
// behavior migration 033's own sweep already established and tested
// (COUNT project_members, proceed only on exactly 1; 0 or 2+ skips the
// write and alerts, never guesses). Confirmed live and real, not
// hypothetical: `route.ts`'s own gate lookup takes `project_members[0]`
// with no count check at all (docs/reviews/route-ts-naive-project-pick.md)
// -- this is the FIRST code in the codebase to actually do this job.
//
// DELIBERATELY DOES NOT ACCEPT AN ALREADY-RESOLVED projectId PARAMETER.
// Any caller that already has one (e.g. route.ts's own gate, which passes
// its own naive `project_members[0]` pick downstream) must not thread it
// through here -- that value IS the thing under question. This function
// always re-derives from a fresh, independent query.
export type ProjectResolution =
  | { outcome: 'resolved'; projectId: string }
  | { outcome: 'zero_memberships' }
  | { outcome: 'multiple_memberships'; count: number }

/**
 * Resolve the single project an engineer belongs to, for a write that
 * needs exactly one. Called at flow START (before any question is asked),
 * never at the write itself -- a skip discovered after the engineer has
 * already answered Q1/Q2 discards work he's done (Aravind's own ruling,
 * 2026-09-06).
 */
export async function resolveEngineerProject(
  userId: string,
  supabaseClient?: SupabaseClient,
): Promise<ProjectResolution> {
  const supabase = supabaseClient ?? createServiceClient()

  const { data, error } = await supabase.from('project_members').select('project_id').eq('user_id', userId)

  if (error) {
    throw new Error(`resolveEngineerProject lookup failed for ${userId}: ${error.message}`)
  }

  const rows = data ?? []

  if (rows.length === 0) {
    Sentry.captureMessage('resolveEngineerProject: zero project_members rows', {
      level: 'warning',
      tags: { feature: 'adhoc-menu-project-resolution' },
      extra: { userId },
    })
    return { outcome: 'zero_memberships' }
  }

  if (rows.length > 1) {
    Sentry.captureMessage('resolveEngineerProject: ambiguous project_members (2+ rows)', {
      level: 'warning',
      tags: { feature: 'adhoc-menu-project-resolution' },
      extra: { userId, count: rows.length },
    })
    return { outcome: 'multiple_memberships', count: rows.length }
  }

  return { outcome: 'resolved', projectId: rows[0].project_id as string }
}

// --- Engineer-facing copy for the two failure branches (Aravind, 2026-
// 09-06; "Project Manager" not "PM" throughout, per Rule 3.12's "same word
// for the same thing" -- every other engineer-facing string in this
// codebase spells it out). Neither is shown for 'resolved'; the caller
// proceeds into the flow instead. ------------------------------------
export const ZERO_MEMBERSHIPS_REPLY =
  "You're not assigned to a project yet. Ask your Project Manager to add you before reporting anything. Nothing was recorded."

export const MULTIPLE_MEMBERSHIPS_REPLY =
  "You're assigned to more than one project, so I can't tell which this is for. Ask your Project Manager to check your project assignments. Nothing was recorded."

/** Maps a resolution outcome to its engineer-facing reply. Throws on 'resolved' -- callers must branch on outcome before reaching for copy, never call this speculatively. */
export function replyForProjectResolution(resolution: ProjectResolution): string {
  if (resolution.outcome === 'zero_memberships') return ZERO_MEMBERSHIPS_REPLY
  if (resolution.outcome === 'multiple_memberships') return MULTIPLE_MEMBERSHIPS_REPLY
  throw new Error('replyForProjectResolution called with a resolved outcome -- no reply exists for success')
}
