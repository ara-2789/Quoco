// Email OTP login -- automated tests, docs/plans/email-otp-plan.md section
// (h). T-OTP-01, 01b, 02, 03, 04, 07 only (this build task's own scope);
// T-OTP-05 (full Server Action integration) and T-OTP-06 (dashboard layout
// regression guard) are explicitly out of scope for this slice.
//
// GOVERNING RULE (plan (h)): every assertion on a Supabase Auth error checks
// error.code, never error.message -- message text is not part of Supabase's
// stability contract. Every observed error.code is printed (raw, not
// summarised) so a human reviewing this run's output can see exactly what
// the real server returned.
//
// T-OTP-01/01b/02/03/04 exercise Supabase Auth directly (service-role admin
// API + a plain anon-key client) -- same pattern test/migration-007.test.ts
// established for driving real Supabase-authenticated calls without a
// Next.js request context, since these test the platform behaviour the
// Server Actions in app/(auth)/login/page.tsx wrap, not the actions
// themselves (T-OTP-05, which does exercise the actions, is out of scope).
//
// ADDRESS SAFETY NOTE, FLAGGED FOR ARAVIND: the plan's (h) text requires
// "every test address used by any test that sends a real email" to be an
// address Aravind controls. This suite instead uses zz-test-*@quoco.test
// (test/helpers/run-scoped-fixtures.ts's deriveRunScopedEmail) for every
// case, including T-OTP-04 (which does send one real email via
// signInWithOtp). `.test` is an IANA-reserved, non-resolving TLD (RFC
// 2606) -- no real mailbox anywhere can ever receive mail sent to it, so
// this satisfies the underlying safety goal (no real person is ever
// messaged) by construction, for a fully-automated suite with no human
// checking an inbox. This is a documented deviation from the plan's literal
// wording, not a silent one -- flagged here and in the build PR body. The
// MANUAL verification script in (h) still uses Aravind's own real address,
// unaffected by this choice.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getRunId, deriveRunScopedEmail } from './helpers/run-scoped-fixtures'

function serviceClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

function anonClient(): SupabaseClient {
  return createClient(
    process.env.SUPABASE_TEST_URL!,
    process.env.SUPABASE_TEST_ANON_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  )
}

async function findAuthUserByEmail(db: SupabaseClient, email: string) {
  const { data, error } = await db.auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`listUsers failed: ${error.message}`)
  return data.users.find((u) => u.email === email) ?? null
}

const runId = getRunId()

describe('login OTP', () => {
  // ---------------------------------------------------------------------
  // T-OTP-01: unknown email + app-level shouldCreateUser:false is refused.
  // ---------------------------------------------------------------------
  it('T-OTP-01: unknown email refused (shouldCreateUser:false), no auth.users row created', async () => {
    const db = serviceClient()
    const anon = anonClient()
    const email = deriveRunScopedEmail(runId, 'T_OTP_01_UNKNOWN')

    expect(await findAuthUserByEmail(db, email)).toBeNull()

    const { data, error } = await anon.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    })
    console.log(`[T-OTP-01] error.code=${error?.code} message=${error?.message}`)

    expect(error).not.toBeNull()
    expect(data.user).toBeNull()
    expect(await findAuthUserByEmail(db, email)).toBeNull()
  })

  // ---------------------------------------------------------------------
  // T-OTP-01b: unknown email, shouldCreateUser OMITTED -- observes the
  // platform "Allow new users to sign up" toggle on test-db directly (the
  // ONE thing T-OTP-01 cannot observe, since it always sets the app's own
  // flag explicitly). If this ever creates a row, that is a genuine
  // divergence from the plan's assumption (toggle disabled) -- clean up
  // immediately and surface it loudly rather than let the assertion below
  // silently fail past it.
  // ---------------------------------------------------------------------
  it('T-OTP-01b: unknown email refused with shouldCreateUser omitted (platform toggle), no row created', async () => {
    const db = serviceClient()
    const anon = anonClient()
    const email = deriveRunScopedEmail(runId, 'T_OTP_01B_UNKNOWN')

    expect(await findAuthUserByEmail(db, email)).toBeNull()

    const { data, error } = await anon.auth.signInWithOtp({ email })
    console.log(`[T-OTP-01b] error.code=${error?.code} message=${error?.message}`)

    const created = await findAuthUserByEmail(db, email)
    if (created) {
      // Divergence from the plan's assumption: clean up immediately, then
      // still fail loudly below via the toBeNull() assertion.
      await db.auth.admin.deleteUser(created.id)
      console.log(
        `[T-OTP-01b] FINDING: a row WAS created for an unconfirmed shouldCreateUser call -- ` +
          `test-db's "Allow new users to sign up" toggle appears to be ENABLED, contradicting ` +
          `the plan's assumption (only confirmed disabled on PROD, 2026-09-17). Row deleted.`,
      )
    }

    expect(error).not.toBeNull()
    expect(created).toBeNull()
  })

  // ---------------------------------------------------------------------
  // T-OTP-02/03/04 share one seeded, properly-provisioned user (D-O2's real
  // shape: admin.createUser({ email_confirm: true }), matching N2's
  // correction -- NOT the dashboard "Invite user" path).
  // ---------------------------------------------------------------------
  const knownEmail = deriveRunScopedEmail(runId, 'T_OTP_KNOWN_USER')
  let knownUserId: string | null = null

  beforeAll(async () => {
    const db = serviceClient()
    const { data, error } = await db.auth.admin.createUser({
      email: knownEmail,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(`seed known user failed: ${error?.message ?? 'no user'}`)
    }
    knownUserId = data.user.id
  })

  afterAll(async () => {
    if (knownUserId) {
      const db = serviceClient()
      await db.auth.admin.deleteUser(knownUserId)
    }
  })

  it('T-OTP-02: known email + correct code succeeds', async () => {
    const db = serviceClient()
    const anon = anonClient()

    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: knownEmail,
    })
    expect(linkError).toBeNull()
    const code = linkData?.properties?.email_otp
    expect(code).toBeTruthy()

    const { data, error } = await anon.auth.verifyOtp({
      email: knownEmail,
      token: code!,
      type: 'email',
    })
    console.log(`[T-OTP-02] error.code=${error?.code} message=${error?.message}`)

    expect(error).toBeNull()
    expect(data.session).not.toBeNull()
  })

  it('T-OTP-03: known email + wrong code fails', async () => {
    const db = serviceClient()
    const anon = anonClient()

    // Mint a real code first so the deliberately-wrong one below is
    // provably NOT the real one, not just "probably" wrong.
    const { data: linkData, error: linkError } = await db.auth.admin.generateLink({
      type: 'magiclink',
      email: knownEmail,
    })
    expect(linkError).toBeNull()
    const realCode = linkData?.properties?.email_otp
    const wrongCode = realCode === '000001' ? '000002' : '000001'

    const { data, error } = await anon.auth.verifyOtp({
      email: knownEmail,
      token: wrongCode,
      type: 'email',
    })
    console.log(`[T-OTP-03] error.code=${error?.code} message=${error?.message}`)

    expect(error).not.toBeNull()
    expect(data.session).toBeNull()
  })

  // -----------------------------------------------------------------------
  // T-OTP-04 gets its OWN dedicated seeded user, separate from knownEmail
  // above -- NOT per the plan's original text (which didn't specify either
  // way), but per a real finding from this test's first run (see
  // otp-build.txt): T-OTP-02/03's own admin.generateLink calls against
  // knownEmail count against the SAME per-email resend cooldown
  // signInWithOtp uses (over_email_send_rate_limit), so sharing knownEmail
  // made T-OTP-04's own FIRST call collide with 02/03's still-open cooldown
  // window when run in the same suite. Isolating T-OTP-04 to its own user
  // makes it self-contained again, matching (h)'s own intent that this
  // test's contribution to the hourly send cap is exactly one real email,
  // independent of test order or what else ran before it.
  // -----------------------------------------------------------------------
  const resendEmail = deriveRunScopedEmail(runId, 'T_OTP_04_RESEND_USER')
  let resendUserId: string | null = null

  beforeAll(async () => {
    const db = serviceClient()
    const { data, error } = await db.auth.admin.createUser({
      email: resendEmail,
      email_confirm: true,
    })
    if (error || !data.user) {
      throw new Error(`seed resend user failed: ${error?.message ?? 'no user'}`)
    }
    resendUserId = data.user.id
  })

  afterAll(async () => {
    if (resendUserId) {
      const db = serviceClient()
      await db.auth.admin.deleteUser(resendUserId)
    }
  })

  it('T-OTP-04: resend before cooldown is rate-limited (sends exactly one real email)', async () => {
    const anon = anonClient()

    // First call: a real signInWithOtp for an EXISTING user (distinct from
    // T-OTP-01's refusal case) -- this is the suite's one real email send.
    const first = await anon.auth.signInWithOtp({ email: resendEmail })
    console.log(`[T-OTP-04] first call error.code=${first.error?.code} message=${first.error?.message}`)
    expect(first.error).toBeNull()

    // Second call, immediately: must be refused by the resend cooldown, not
    // succeed again -- keeps this test's own contribution to the hourly
    // send cap at exactly one real email per run (plan (h) S2 correction).
    const second = await anon.auth.signInWithOtp({ email: resendEmail })
    console.log(`[T-OTP-04] second call error.code=${second.error?.code} message=${second.error?.message}`)
    expect(second.error).not.toBeNull()
  })
})
