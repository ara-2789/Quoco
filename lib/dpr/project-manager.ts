import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'

// Stage 1 plumbing (2026-09-11, docs/plans/dpr-format-redesign.md §5).
// Shared by both DPR delivery surfaces (dispatch.ts's WhatsApp path,
// owner-deliver-dispatch.ts's email path) so the read exists in exactly
// one place, not two independently-maintained copies.
//
// Every real project today has exactly one `project_members` row with
// role='pm' -- a CURRENT FACT, NOT SCHEMA-ENFORCED (no constraint limits
// a project to one PM; verified live against prod, 2026-09-11). If a
// project ever gains a second PM, this returns whichever one sorts first
// by `created_at` AND fires a Sentry warning naming the project and the
// count -- ambiguity is surfaced, not silently absorbed. This is NOT a
// design decision about which PM "should" show when there are several;
// it is a non-crashing default for code that must return something
// today, paired with the signal that tells Aravind when it starts
// mattering. Deterministic first-by-created_at was chosen over throwing
// on a multi-row result specifically so an unenforced ambiguity degrades
// to "shows one PM, warns" rather than "breaks DPR generation for that
// project." Aravind intends to add a proper engineer->PM link later,
// which resolves the ambiguity at the source (a real relationship, not a
// role scan) -- this warning is the bridge that tells him when that
// becomes worth building, not the intended end state.
//
// FAILS SOFT, NEVER THROWS (2026-09-11, review round 2). dispatch.ts
// calls this inside the main DPR generation flow -- a transient read
// failure here must not fail generation for a reason that has nothing to
// do with the report's own content. Both error paths capture to Sentry
// and return null; a report with one missing line still ships.
export async function resolveProjectManagerName(client: SupabaseClient, project_id: string): Promise<string | null> {
  const { data: memberships, error } = await client
    .from('project_members')
    .select('user_id')
    .eq('project_id', project_id)
    .eq('role', 'pm')
    .order('created_at', { ascending: true })
  if (error) {
    Sentry.captureException(error, {
      tags: { feature: 'dpr-project-manager' },
      extra: { project_id, stage: 'project_members lookup' },
    })
    return null
  }

  const rows = memberships ?? []
  if (rows.length === 0) return null

  if (rows.length > 1) {
    Sentry.captureMessage('resolveProjectManagerName: project has more than one role=\'pm\' member', {
      level: 'warning',
      tags: { feature: 'dpr-project-manager' },
      extra: { project_id, count: rows.length },
    })
  }

  const { data: user, error: userError } = await client.from('users').select('full_name').eq('id', rows[0].user_id as string).maybeSingle()
  if (userError) {
    Sentry.captureException(userError, {
      tags: { feature: 'dpr-project-manager' },
      extra: { project_id, stage: 'users lookup' },
    })
    return null
  }

  return (user?.full_name as string | null) ?? null
}
