import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

// The caller's public.users profile, resolved by auth_id (the post-007 identity
// model — users.id is decoupled from auth.uid()).
export interface Profile {
  id: string
  tenant_id: string | null
  full_name: string | null
  role: string | null
}

const PROFILE_COLUMNS = 'id, tenant_id, full_name, role'

// Core lookup against a GIVEN client. Fail-loud:
//   - Authenticated but NO profile row -> THROW. Post-007 the handle_new_user
//     trigger guarantees exactly one users row per auth user, so a missing row
//     is an R1-class invariant violation, NEVER a valid empty state. Silently
//     returning null here is exactly how "R1: dashboard empty everywhere"
//     disguises itself as a brand-new user. Refuse to render.
//   - A .single() ERROR is surfaced (not discarded), distinguishing the
//     no-row case (PGRST116) from an RLS denial / query failure.
// Exported so the auth callback route can pass its POST-EXCHANGE client — a
// fresh createClient() there wouldn't see the just-established session (the
// session cookies are on the outgoing response, not the incoming request).
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

  return data as Profile
}

// Server-component / server-action entrypoint. Owns the client + the auth gate:
//   - Unauthenticated -> redirect('/login') (never returns).
//   - Authenticated   -> profileForAuthId (throws if the row is missing).
// Wrapped in React cache() for per-request dedupe, so multiple call sites in one
// render share a single lookup (also erases the sequential-waterfall we had to
// accept when the members query depended on a separately-fetched profile).
export const getProfile = cache(async (): Promise<Profile> => {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  return profileForAuthId(supabase, user.id)
})
