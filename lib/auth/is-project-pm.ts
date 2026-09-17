import type { SupabaseClient } from '@supabase/supabase-js'

// Stage 5a (docs/reviews/stage5a-review-package.md, C1; verdict Q7). The
// SINGLE source of truth for "is this viewer a PM on this project" --
// project_members.role = 'pm' for the exact (userId, projectId) pair,
// NEVER users.role / profile.role.
//
// WHY THIS EXISTS AS ITS OWN FUNCTION, NOT INLINED PER CALLER: canEditLog
// (lib/daily-logs/correction.ts:131-133) already gets this wrong in
// exactly the shape this function exists to prevent -- it compares
// `role === 'pm'` against a value sourced from users.role, and a real
// PM's users.role is 'admin' on prod (016_corrections.sql:177-181;
// project creation writes project_members.role = 'pm' independently of
// the creating user's own users.role, app/(dashboard)/projects/new/
// page.tsx:49-54). Confirmed live on prod, 2026-09-17 (docs/build-status.md):
// a real PM saw no edit controls because that check read the wrong column.
// This function is reused by D3/D6 (this slice) and by the later
// correction-gate fix (not this slice) so there is exactly one place that
// encodes "PM on this project," not a second copy of the same mistake.
export async function isProjectPm(
  client: SupabaseClient,
  userId: string,
  projectId: string,
): Promise<boolean> {
  const { data, error } = await client
    .from('project_members')
    .select('user_id')
    .eq('project_id', projectId)
    .eq('user_id', userId)
    .eq('role', 'pm')
    .maybeSingle<{ user_id: string }>()
  if (error) throw error
  return data !== null
}
