import type { SupabaseClient } from '@supabase/supabase-js'
import type { Profile } from '@/lib/auth/profile-query'
import { isProjectPm } from '@/lib/auth/is-project-pm'

// The TypeScript half of the add-engineer authorisation (plan section 1, D6).
// ADVISORY ONLY: the authority is the SQL gate inside add_engineers_to_project
// (048's engineer_admin_gate), which re-runs on every call. This half decides
// what the page shows; if the two ever disagree SQL wins, and
// test/engineer-gate-agreement.test.ts (T6) is what catches the drift.
//
// The rule, in the SQL gate's own order:
//   1. no caller profile               -> not_permitted
//   2. project missing, or not in the caller's tenant (NULL-safe) -> not_found
//   3. users.role admin                -> allow
//      users.role pm AND a project_members 'pm' row here -> allow
//      anything else (qs, engineer, NULL role, pm without membership)
//                                      -> not_permitted
// 'not_found' is one indistinguishable answer for "no such project" and
// "another company's project" -- it must never reveal which.

export type EngineerAdminVerdict = 'allow' | 'not_permitted' | 'not_found'

export interface EngineerGateInput {
  profile: Pick<Profile, 'id' | 'tenant_id' | 'role'> | null
  // The project row as the CALLER can see it (under RLS a foreign tenant's
  // project simply is not there). tenant_id is NOT NULL on projects.
  project: { id: string; tenant_id: string } | null
  // project_members.role = 'pm' for (caller, project); never users.role.
  isProjectPm: boolean
}

export function decideEngineerAdminAccess(input: EngineerGateInput): EngineerAdminVerdict {
  const { profile, project, isProjectPm: pmHere } = input
  if (profile === null) return 'not_permitted'
  // NULL-safe tenant bind: a NULL caller tenant matches nothing (SQL: IS DISTINCT FROM).
  if (project === null || profile.tenant_id === null || project.tenant_id !== profile.tenant_id) {
    return 'not_found'
  }
  if (profile.role === 'admin') return 'allow'
  if (profile.role === 'pm') return pmHere ? 'allow' : 'not_permitted'
  return 'not_permitted'
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

// Resolve the gate's inputs through the CALLER's own client (never the service
// role), so RLS is a second layer: a project in another tenant is invisible and
// arrives here as null -> not_found.
export async function checkEngineerAdminAccess(
  client: SupabaseClient,
  profile: Pick<Profile, 'id' | 'tenant_id' | 'role'>,
  projectId: string,
): Promise<{ verdict: EngineerAdminVerdict; projectName: string | null }> {
  // A malformed id is "no such project", not a query error.
  if (!isUuid(projectId)) return { verdict: 'not_found', projectName: null }

  const { data: project, error } = await client
    .from('projects')
    .select('id, tenant_id, name')
    .eq('id', projectId)
    .maybeSingle<{ id: string; tenant_id: string; name: string }>()
  if (error) throw error

  const pm = project ? await isProjectPm(client, profile.id, project.id) : false
  return {
    verdict: decideEngineerAdminAccess({ profile, project, isProjectPm: pm }),
    projectName: project ? project.name : null,
  }
}
