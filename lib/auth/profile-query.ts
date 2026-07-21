import type { SupabaseClient } from '@supabase/supabase-js'

// Pure profile-resolution logic, deliberately FREE of 'server-only' / next /
// react imports so it is importable under vitest (and callable directly from
// tests). The server-coupled entrypoint (getProfile) lives in profile.ts, which
// keeps the 'server-only' boundary.
//
// The caller's public.users profile, resolved by auth_id (post-007 identity
// model — users.id is decoupled from auth.uid()).
export interface Profile {
  id: string
  tenant_id: string | null
  full_name: string | null
  role: string | null
}

export const PROFILE_COLUMNS = 'id, tenant_id, full_name, role'

// Resolve a profile by auth_id against the GIVEN client. Fail-loud:
//   - Authenticated but NO profile row -> THROW. Post-007 the handle_new_user
//     trigger guarantees exactly one users row per auth user, so a missing row
//     is an R1-class invariant violation, NEVER a valid empty state. Silently
//     returning null here is exactly how "R1: dashboard empty everywhere"
//     disguises itself as a brand-new user. Refuse to render.
//   - A .single() ERROR is surfaced (not discarded), distinguishing the
//     no-row case (PGRST116) from an RLS denial / query failure.
// Takes the client as a parameter so callers control auth context: the auth
// callback passes its POST-EXCHANGE server client; tests pass a real user-JWT
// client. (A fresh server createClient() in the callback wouldn't see the
// just-established session — cookies are on the outgoing response.)
export async function profileForAuthId(
  supabase: SupabaseClient,
  authUserId: string,
): Promise<Profile> {
  const { data, error } = await supabase
    .from('users')
    .select(PROFILE_COLUMNS)
    .eq('auth_id', authUserId)
    .single()

  if (error) {
    // PGRST116 = "0 rows" from .single().
    if (error.code === 'PGRST116') {
      throw new Error(
        `getProfile: authenticated auth user ${authUserId} has no public.users ` +
          `row (auth_id match). This is an R1-class invariant violation — ` +
          `handle_new_user should guarantee exactly one. Refusing to render an ` +
          `empty dashboard instead of surfacing the bug.`,
      )
    }
    throw new Error(
      `getProfile: users lookup failed for auth_id ${authUserId} ` +
        `(code ${error.code ?? 'none'}): ${error.message}. Likely an RLS denial ` +
        `or query error — NOT a missing profile.`,
    )
  }

  // Tradeoff acknowledged (same class as query.ts's casts): select-string vs.
  // generated types. Safe because errors/missing-row above already fail loud.
  return data as Profile
}
