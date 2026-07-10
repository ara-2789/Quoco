import 'server-only'
import { cache } from 'react'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { profileForAuthId, PROFILE_COLUMNS, type Profile } from '@/lib/auth/profile-query'

// This module is the 'server-only' boundary (next/navigation + the server
// Supabase client). The pure query lives in profile-query.ts (no 'server-only')
// so it can be imported/called under vitest. Re-export it here so server callers
// keep importing profileForAuthId / Profile / PROFILE_COLUMNS from
// '@/lib/auth/profile' unchanged.
export { profileForAuthId, PROFILE_COLUMNS }
export type { Profile }

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
