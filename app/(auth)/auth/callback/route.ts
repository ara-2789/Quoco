import { createClient } from '@/lib/supabase/server'
import { profileForAuthId } from '@/lib/auth/profile'
import { NextRequest, NextResponse } from 'next/server'

// Handles OAuth and magic-link redirect callbacks (not used by the OTP code flow).
export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')

  if (!code) {
    return NextResponse.redirect(`${origin}/login?error=CALLBACK_FAILED`)
  }

  const supabase = await createClient()
  const { error } = await supabase.auth.exchangeCodeForSession(code)

  if (error) {
    // Known constant key, never error.message raw (docs/plans/
    // email-otp-plan.md (c)'s Q2 correction) -- matches the no-raw-
    // provider-text rule the new code-request/verify actions in
    // app/(auth)/login/page.tsx already follow.
    return NextResponse.redirect(`${origin}/login?error=CALLBACK_FAILED`)
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    return NextResponse.redirect(`${origin}/login`)
  }

  // Post-007: resolve the profile by auth_id. Reuse THIS client — it holds the
  // just-exchanged session; a fresh createClient() here wouldn't see it yet
  // (the session cookies are on the outgoing response, not the request).
  const profile = await profileForAuthId(supabase, user.id)

  return NextResponse.redirect(
    profile.tenant_id ? `${origin}/dashboard` : `${origin}/onboarding`,
  )
}
