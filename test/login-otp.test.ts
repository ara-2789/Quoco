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
// ADDRESS SAFETY NOTE (CORRECTED, follow-up to the build PR): every address
// in this suite is zz-test-*@quoco.test (test/helpers/run-scoped-fixtures.ts's
// deriveRunScopedEmail) -- an IANA-reserved, non-resolving TLD (RFC 2606) --
// EXCEPT resendEmail below, the one address T-OTP-04's first signInWithOtp
// call actually sends a real email to. A .test address there would hard-
// bounce (it cannot resolve), and that bounce lands on the same Resend
// account that sends the nightly owner reports from quoco.co.in -- a
// sender-reputation risk to customer email, not merely a wasted send.
// resendEmail is therefore Aravind's own real, explicitly-confirmed address
// (ar.rcpl+otptest@gmail.com), matching the plan's (h) text ("every test
// address used by any test that sends a real email must be an address
// Aravind controls") exactly, rather than the deviation the initial build
// PR flagged. Every other address here never reaches a send (see the table
// in ~/Desktop/otp-test-address.txt), so changing them would put a real
// address into paths that assert REFUSAL for no benefit.
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { createHash } from 'node:crypto'
import { renderToStaticMarkup } from 'react-dom/server'
import { getRunId, deriveRunScopedEmail } from './helpers/run-scoped-fixtures'
import * as authCopy from '@/lib/auth/copy'

// T-OTP-07 needs to render app/(auth)/login/page.tsx's default export, but
// that file imports profileForAuthId from '@/lib/auth/profile', which pulls
// in 'server-only' -- not even an installed package under vitest (same
// constraint test/engineer-add-render.test.tsx's own header documents for
// getProfile). Mocked here, not called: T-OTP-07 only renders LoginPage for
// an unrecognised ?error= value, which never invokes profileForAuthId (that
// only runs inside the verifyCode Server Action, never during render).
vi.mock('@/lib/auth/profile', () => ({ profileForAuthId: vi.fn() }))
import LoginPage from '@/app/(auth)/login/page'

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

    const { error } = await anon.auth.signInWithOtp({ email })
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
  // Real, Aravind-controlled address -- the only address in the suite whose
  // call actually sends an email -- made unique PER RUN in the local part
  // after the plus sign (Gmail ignores everything after the +, so this
  // still reaches the real inbox). CORRECTED (CI red on 4947264): a FIXED
  // literal here meant a local run's admin.createUser left the row behind,
  // and CI's own createUser for the SAME address then failed with "A user
  // with this email address has already been registered." Fixed using the
  // SAME run-scoped derivation deriveRunScopedEmail uses (SHA-256 of
  // `${runId}:${label}:email`, truncated to 6 bytes hex) -- reproduced here
  // rather than called directly, since that function's own output is
  // hardcoded to the zz-test-*@quoco.test shape, not a deliverable address.
  const resendEmailSuffix = createHash('sha256')
    .update(`${runId}:T_OTP_04_RESEND_USER:email`)
    .digest()
    .subarray(0, 6)
    .toString('hex')
  const resendEmail = `ar.rcpl+otptest-${resendEmailSuffix}@gmail.com`

  it('T-OTP-04: resend before cooldown is rate-limited (sends exactly one real email)', async () => {
    const db = serviceClient()
    const anon = anonClient()

    // Seed and delete THIS test's own user here (try/finally), not a
    // shared beforeAll/afterAll -- the address is unique per run now, so
    // nothing else needs it, and the delete must run whether the
    // assertions below pass or fail.
    let resendUserId: string | null = null
    try {
      const { data, error } = await db.auth.admin.createUser({
        email: resendEmail,
        email_confirm: true,
      })
      if (error || !data.user) {
        throw new Error(`seed resend user failed: ${error?.message ?? 'no user'}`)
      }
      resendUserId = data.user.id

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
    } finally {
      if (resendUserId) {
        // public.users.auth_id is a RESTRICT FK (users_auth_id_fkey) --
        // admin.createUser's own on_auth_user_created trigger already
        // inserted a public.users stub referencing this auth user, so
        // admin.deleteUser alone 500s ("violates foreign key constraint")
        // unless that stub is removed first (found live while cleaning up
        // this same fix's own leftover row -- see otp-ci-red-fix.txt;
        // matches test/helpers/db.ts's own established ordering for this
        // exact constraint). A bare admin.deleteUser() with no error check,
        // as this test used before, LOOKS like cleanup but silently never
        // deletes anything.
        await db.from('users').delete().eq('auth_id', resendUserId)
        await db.auth.admin.deleteUser(resendUserId)
      }
    }
  })

  // ---------------------------------------------------------------------
  // T-OTP-07: an unrecognised ?error= key renders the GENERIC approved
  // text, never the raw key. No live Supabase call -- a render test against
  // the login page component itself (plan (h), S4).
  // ---------------------------------------------------------------------
  it('T-OTP-07: unrecognised ?error= key renders the generic message, never the raw key', async () => {
    const element = await LoginPage({
      searchParams: Promise.resolve({ error: 'NOT_A_REAL_KEY' }),
    })
    const html = renderToStaticMarkup(element)

    expect(html).toContain(authCopy.errors.generic)
    expect(html).not.toContain('NOT_A_REAL_KEY')
  })

  // ---------------------------------------------------------------------
  // T-OTP-08 (added 1 Oct 2026, reflected-text defect -- observed live,
  // test-db, via a crafted ?email= query value): a non-email ?email= value
  // must never be placed into the page. No live Supabase call.
  // ---------------------------------------------------------------------
  it('T-OTP-08: an invalid, non-email ?email= value is never rendered on the code screen', async () => {
    const maliciousEmail = 'Your account is suspended, call 080-1234'
    let html: string | null = null
    try {
      const element = await LoginPage({
        searchParams: Promise.resolve({ step: 'code', email: maliciousEmail }),
      })
      html = renderToStaticMarkup(element)
    } catch (err) {
      // A redirect away from Screen 2 (next/navigation's redirect()) also
      // satisfies "never rendered" -- no page HTML is produced at all.
      const digest = (err as { digest?: string }).digest ?? ''
      expect(digest).toMatch(/^NEXT_REDIRECT/)
      return
    }
    expect(html).not.toContain(maliciousEmail)
  })
})
