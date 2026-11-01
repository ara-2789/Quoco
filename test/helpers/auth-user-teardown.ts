import type { SupabaseClient } from '@supabase/supabase-js'

// Teardown for a run-scoped auth user (zz-test-<hex>@quoco.test, test/helpers/run-scoped-fixtures.ts).
//
// ORDER MATTERS. Since migration 007 the on_auth_user_created trigger inserts a public.users row
// (a stub, or a profile the test later claims) with auth_id = the new auth user, and users_auth_id_fkey is
// ON DELETE RESTRICT. admin.deleteUser alone therefore fails while that row exists, so the public.users row
// goes first, then the auth user (the auth.* children - identities, sessions, one-time tokens - cascade).
//
// Both steps are error-checked: a bare deleteUser with no check LOOKS like cleanup and silently deletes nothing,
// which is exactly how test-db collected five leaked users per full run. A failure here throws, so a leak
// fails the hook instead of passing. Messages carry the Supabase error text only: no email, phone or id.
//
// Callers delete anything that references the public.users row (project_members, daily_logs, ...) BEFORE calling
// this; the cascade on project_members is harmless, a NO ACTION/RESTRICT reference makes this throw.
export async function deleteAuthUserAndProfile(db: SupabaseClient, authUserId: string): Promise<void> {
  const { error: profileErr } = await db.from('users').delete().eq('auth_id', authUserId)
  if (profileErr) throw new Error(`teardown: deleting the public.users row of a test auth user failed: ${profileErr.message}`)
  const { error: authErr } = await db.auth.admin.deleteUser(authUserId)
  if (authErr) throw new Error(`teardown: deleting a test auth user failed: ${authErr.message}`)
}
