// /login UX fix -- T-UX-2 .. T-UX-6 (docs/plans/login-otp-ux-plan.md).
// T-UX-1 (the latch) lives in test/submit-latch.test.ts.
//
// TEST-DB-FREE BY CONSTRUCTION: no Supabase client is created for real
// (@/lib/supabase/server is mocked), nothing here imports test/helpers/db or
// a service-role key, no email is sent. Node environment, renderToStaticMarkup
// only (no jsdom in this repo). What this file cannot cover -- the
// useFormStatus wiring, the latch-release effect, the real click handler --
// is covered by the manual preview checklist in the plan, not claimed here.
//
// redirect() from next/navigation works by THROWING; its error carries a
// `digest` of the form "NEXT_REDIRECT;<type>;<url>;<status>;". Assertions read
// the digest, as test/login-otp.test.ts T-OTP-08 already does.
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import * as authCopy from '@/lib/auth/copy'
import * as Sentry from '@sentry/nextjs'
import { createClient } from '@/lib/supabase/server'
import { profileForAuthId } from '@/lib/auth/profile'
import {
  HaveCodeButtonView,
  SubmitButtonView,
  loginFormKey,
} from '@/app/(auth)/login/pending-controls'
import LoginPage from '@/app/(auth)/login/page'

// 'server-only' is not an installed package under vitest (same constraint
// test/login-otp.test.ts documents); both modules are mocked, never called for real.
vi.mock('@/lib/auth/profile', () => ({ profileForAuthId: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn() }))
// The B6 catch reports through Sentry.captureMessage (review round 1, S3).
vi.mock('@sentry/nextjs', () => ({ captureMessage: vi.fn() }))

type Params = { step?: string; email?: string; error?: string }
type FakeProfile = Awaited<ReturnType<typeof profileForAuthId>>

const signInWithOtp = vi.fn()

function fakeClient(getUser: () => Promise<{ data: { user: { id: string } | null } }>) {
  return { auth: { getUser, signInWithOtp } } as unknown as Awaited<ReturnType<typeof createClient>>
}

function mockSession(user: { id: string } | null) {
  vi.mocked(createClient).mockResolvedValue(fakeClient(async () => ({ data: { user } })))
}

async function renderLogin(params: Params): Promise<string> {
  const element = await LoginPage({ searchParams: Promise.resolve(params) })
  return renderToStaticMarkup(element)
}

async function redirectDigestOf(params: Params): Promise<string> {
  try {
    await renderLogin(params)
  } catch (err) {
    return (err as { digest?: string }).digest ?? `NOT-A-REDIRECT: ${String(err)}`
  }
  return 'NO-THROW (page rendered)'
}

function buttonWithLabel(html: string, label: string): string | null {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return html.match(new RegExp(`<button[^>]*>${escaped}</button>`))?.[0] ?? null
}

beforeEach(() => {
  vi.mocked(createClient).mockReset()
  vi.mocked(profileForAuthId).mockReset()
  vi.mocked(Sentry.captureMessage).mockReset()
  signInWithOtp.mockReset()
  mockSession(null) // default: signed out
})

describe('T-UX-2: busy state (presentational views)', () => {
  const sendClass = 'btn'

  it('Send code: pending -> disabled + busy label; idle -> neither', () => {
    const busy = renderToStaticMarkup(
      <SubmitButtonView
        pending
        label={authCopy.emailStep.submitLabel}
        busyLabel={authCopy.emailStep.submitBusyLabel}
        className={sendClass}
      />,
    )
    expect(busy).toContain('disabled')
    expect(busy).toContain('Sending code…')
    expect(busy).not.toContain('>Send code<')

    const idle = renderToStaticMarkup(
      <SubmitButtonView
        pending={false}
        label={authCopy.emailStep.submitLabel}
        busyLabel={authCopy.emailStep.submitBusyLabel}
        className={sendClass}
      />,
    )
    expect(idle).not.toContain('disabled')
    expect(idle).not.toContain('Sending code…')
    expect(idle).toContain('>Send code<')
  })

  it('Send a new code: pending -> disabled + busy label; idle -> neither', () => {
    const busy = renderToStaticMarkup(
      <SubmitButtonView
        pending
        label={authCopy.codeStep.resendLabel}
        busyLabel={authCopy.codeStep.resendBusyLabel}
      />,
    )
    expect(busy).toContain('disabled')
    expect(busy).toContain('Sending code…')

    const idle = renderToStaticMarkup(
      <SubmitButtonView
        pending={false}
        label={authCopy.codeStep.resendLabel}
        busyLabel={authCopy.codeStep.resendBusyLabel}
      />,
    )
    expect(idle).not.toContain('disabled')
    expect(idle).not.toContain('Sending code…')
  })

  it('Sign in: pending -> disabled, label UNCHANGED (no busy label)', () => {
    const busy = renderToStaticMarkup(
      <SubmitButtonView pending label={authCopy.codeStep.submitLabel} />,
    )
    expect(busy).toContain('disabled')
    expect(busy).toContain('>Sign in<')
    expect(busy).not.toContain('Sending code…')

    const idle = renderToStaticMarkup(
      <SubmitButtonView pending={false} label={authCopy.codeStep.submitLabel} />,
    )
    expect(idle).not.toContain('disabled')
    expect(idle).toContain('>Sign in<')
  })

  it('have-code button: disabled while a send is pending, enabled otherwise', () => {
    const label = authCopy.emailStep.haveCodeLabel
    expect(renderToStaticMarkup(<HaveCodeButtonView pending label={label} />)).toContain('disabled')
    expect(renderToStaticMarkup(<HaveCodeButtonView pending={false} label={label} />)).not.toContain(
      'disabled',
    )
  })
})

describe('T-UX-3: have-code control', () => {
  const HAVE_CODE = authCopy.emailStep.haveCodeLabel

  // GET submitter (review round 1, S1): a string formAction replaces the form's
  // server action for this submission, so the browser submits natively and
  // requestCode is never called. Needs no JS (works before hydration).
  function expectGetSubmitter(button: string) {
    const tag = button.toLowerCase()
    expect(tag).toContain('type="submit"')
    expect(tag).toContain('formmethod="get"')
    expect(tag).toContain('formaction="/login"')
    expect(tag).toContain('name="step"')
    expect(tag).toContain('value="code"')
    expect(tag).toContain('data-no-latch')
  }

  it('email step: GET submitter (type=submit formmethod=get formaction=/login name=step value=code), placed AFTER Send code', async () => {
    const html = await renderLogin({})
    const haveCode = buttonWithLabel(html, HAVE_CODE)
    expect(haveCode, 'have-code button must be rendered on the email step').not.toBeNull()
    expectGetSubmitter(haveCode!)

    const send = buttonWithLabel(html, authCopy.emailStep.submitLabel)
    expect(send, 'Send code button must be rendered').not.toBeNull()
    expect(send).toContain('type="submit"')
    expect(html.indexOf(send!)).toBeLessThan(html.indexOf(haveCode!))
  })

  it('also present, after the message, when ?error=RESEND_RATE_LIMITED is shown', async () => {
    const html = await renderLogin({ error: 'RESEND_RATE_LIMITED' })
    const errorAt = html.indexOf(authCopy.errors.resendRateLimited)
    const haveCode = buttonWithLabel(html, HAVE_CODE)
    expect(errorAt).toBeGreaterThanOrEqual(0)
    expect(haveCode).not.toBeNull()
    expectGetSubmitter(haveCode!)
    expect(html.indexOf(haveCode!)).toBeGreaterThan(errorAt)
  })

  it('the have-code submitter sits in the SAME form as Send code (it submits the typed email)', async () => {
    const html = await renderLogin({})
    const form = html.match(/<form[\s\S]*?<\/form>/)?.[0] ?? ''
    expect(form).toContain(authCopy.emailStep.submitLabel)
    expect(form).toContain(HAVE_CODE)
    expect(form).toContain('name="email"')
  })

  it('rendering the email step and the code step sends nothing', async () => {
    await renderLogin({})
    await renderLogin({ error: 'RESEND_RATE_LIMITED' })
    await renderLogin({ step: 'code', email: 'ux-test@example.com' })
    expect(signInWithOtp).not.toHaveBeenCalled()
  })

  // haveCodeUrl() and its "URL builder encodes + and @" row are DELETED: the
  // browser now builds the query string natively from the form fields (the
  // GET submitter), so there is no app-side URL builder left to test. The
  // page's own server-side isValidEmail guard on step=code is unchanged.
})

describe('T-UX-4: signed-in user on /login (B6)', () => {
  const REDIRECT = (to: string) => new RegExp(`^NEXT_REDIRECT;[a-z]+;${to.replace('/', '\\/')};`)

  it('user + tenant -> NEXT_REDIRECT to /dashboard', async () => {
    mockSession({ id: 'UX-AUTH-USER-0000' })
    vi.mocked(profileForAuthId).mockResolvedValue({ tenant_id: 'UX-TENANT-0000' } as FakeProfile)
    expect(await redirectDigestOf({})).toMatch(REDIRECT('/dashboard'))
  })

  it('user + tenant on the code step also redirects (every step, not just the first)', async () => {
    mockSession({ id: 'UX-AUTH-USER-0000' })
    vi.mocked(profileForAuthId).mockResolvedValue({ tenant_id: 'UX-TENANT-0000' } as FakeProfile)
    expect(await redirectDigestOf({ step: 'code', email: 'ux-test@example.com' })).toMatch(
      REDIRECT('/dashboard'),
    )
  })

  // Review round 1, B2: /onboarding has no sign-out, so a signed-in user with
  // NO tenant must keep reaching this form (the only way to switch address).
  // 2 of the 4 prod accounts are in this state (build log round 2, B2 count).
  it('user, no tenant -> the form renders (NOT redirected to /onboarding)', async () => {
    mockSession({ id: 'UX-AUTH-USER-0000' })
    vi.mocked(profileForAuthId).mockResolvedValue({ tenant_id: null } as FakeProfile)
    expect(await redirectDigestOf({})).toBe('NO-THROW (page rendered)')
    const html = await renderLogin({})
    expect(html).toContain(authCopy.emailStep.heading)
    expect(html).toContain(authCopy.emailStep.submitLabel)
  })

  it('no user -> the form renders, no redirect', async () => {
    mockSession(null)
    const html = await renderLogin({})
    expect(html).toContain(authCopy.emailStep.heading)
    expect(profileForAuthId).not.toHaveBeenCalled()
  })

  it('profile lookup throws -> the form renders (never locked out of /login)', async () => {
    mockSession({ id: 'UX-AUTH-USER-0000' })
    vi.mocked(profileForAuthId).mockRejectedValue(new Error('no profile row'))
    const html = await renderLogin({})
    expect(html).toContain(authCopy.emailStep.heading)
  })

  it('getUser throws -> the form renders', async () => {
    vi.mocked(createClient).mockResolvedValue(
      fakeClient(async () => {
        throw new Error('auth service down')
      }),
    )
    const html = await renderLogin({})
    expect(html).toContain(authCopy.emailStep.heading)
  })

  it('createClient throws (no request scope) -> the form renders', async () => {
    vi.mocked(createClient).mockRejectedValue(new Error('cookies() outside a request scope'))
    const html = await renderLogin({})
    expect(html).toContain(authCopy.emailStep.heading)
  })
})

describe('T-UX-7: the B6 catch reports the failure (review round 1, S3)', () => {
  const AUTH_ID = 'UX-AUTH-USER-0000'
  const EMAIL = 'ux-secret@example.com'

  it('profile lookup throws -> reported ONCE, by error name only (no auth id / email / message)', async () => {
    mockSession({ id: AUTH_ID })
    vi.mocked(profileForAuthId).mockRejectedValue(
      new TypeError(`profile row missing for auth id ${AUTH_ID} (${EMAIL})`),
    )
    const html = await renderLogin({})
    expect(html).toContain(authCopy.emailStep.heading) // still falls through to the form
    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1)
    const payload = JSON.stringify(vi.mocked(Sentry.captureMessage).mock.calls[0])
    expect(payload).toContain('TypeError')
    expect(payload).not.toContain(AUTH_ID)
    expect(payload).not.toContain(EMAIL)
    expect(payload).not.toContain('profile row missing')
  })

  it('no user -> NOT reported (signed out is normal)', async () => {
    mockSession(null)
    await renderLogin({})
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })

  it('user + tenant (redirect) and user with no tenant -> NOT reported', async () => {
    mockSession({ id: AUTH_ID })
    vi.mocked(profileForAuthId).mockResolvedValue({ tenant_id: 'UX-TENANT-0000' } as FakeProfile)
    await redirectDigestOf({})
    vi.mocked(profileForAuthId).mockResolvedValue({ tenant_id: null } as FakeProfile)
    await renderLogin({})
    expect(Sentry.captureMessage).not.toHaveBeenCalled()
  })
})

describe('T-UX-8: forms are keyed by the params a redirect changes (review round 1, B1)', () => {
  function latchKeysIn(html: string): string[] {
    return [...html.matchAll(/data-latch-key="([^"]*)"/g)].map((m) => m[1])
  }

  it('the key differs between (email step, no error), (email step, RESEND_RATE_LIMITED) and (code step, WRONG_CODE)', () => {
    const plain = loginFormKey({})
    const rateLimited = loginFormKey({ error: 'RESEND_RATE_LIMITED' })
    const wrongCode = loginFormKey({ step: 'code', error: 'WRONG_CODE', email: 'ux-test@example.com' })
    expect(plain).toBe('||')
    expect(rateLimited).toBe('|RESEND_RATE_LIMITED|')
    expect(wrongCode).toBe('code|WRONG_CODE|ux-test@example.com')
    expect(new Set([plain, rateLimited, wrongCode]).size).toBe(3)
  })

  it('the rendered form carries that key in data-latch-key (inspected in the HTML)', async () => {
    const plain = latchKeysIn(await renderLogin({}))
    const rateLimited = latchKeysIn(await renderLogin({ error: 'RESEND_RATE_LIMITED' }))
    const wrongCode = latchKeysIn(
      await renderLogin({ step: 'code', error: 'WRONG_CODE', email: 'ux-test@example.com' }),
    )
    expect(plain).toEqual(['||'])
    expect(rateLimited).toEqual(['|RESEND_RATE_LIMITED|'])
    expect(wrongCode).toEqual([
      'code|WRONG_CODE|ux-test@example.com',
      'code|WRONG_CODE|ux-test@example.com',
    ])
    expect(new Set([...plain, ...rateLimited, ...wrongCode]).size).toBe(3)
  })

  // The key is rendered into the HTML, so it must never carry a raw
  // query-string value (the T-OTP-07 / T-OTP-08 reflected-text rule).
  it('an unknown ?error= collapses to GENERIC and an ?email= on the email step is dropped: nothing raw is rendered', async () => {
    const html = await renderLogin({ error: 'NOT_A_REAL_KEY', email: 'Your account is suspended' })
    expect(latchKeysIn(html)).toEqual(['|GENERIC|'])
    expect(html).not.toContain('NOT_A_REAL_KEY')
    expect(html).not.toContain('Your account is suspended')
  })
})

describe('T-UX-10 (render part): the code step shares ONE latch (review round 1, S2)', () => {
  function latchIdsIn(html: string): string[] {
    return [...html.matchAll(/data-latch-id="([^"]*)"/g)].map((m) => m[1])
  }

  it('verify and resend forms carry the SAME latch id; the email step has one form', async () => {
    const code = latchIdsIn(await renderLogin({ step: 'code', email: 'ux-test@example.com' }))
    expect(code).toHaveLength(2)
    expect(code[0]).not.toBe('')
    expect(code[1]).toBe(code[0])

    const email = latchIdsIn(await renderLogin({}))
    expect(email).toHaveLength(1)
  })
})

describe('T-UX-5: approved strings (English approved by Aravind 2 Nov 2026; Tamil owed)', () => {
  it('the three constants exist with the exact text', () => {
    expect(authCopy.emailStep.haveCodeLabel).toBe('Already have a code? Enter it here')
    expect(authCopy.emailStep.submitBusyLabel).toBe('Sending code…')
    expect(authCopy.codeStep.resendBusyLabel).toBe('Sending code…')
  })
})

describe('T-UX-6: test-db-free restatement of the T-OTP-07 / T-OTP-08 render assertions', () => {
  it('an unrecognised ?error= key renders the generic message, never the raw key', async () => {
    const html = await renderLogin({ error: 'NOT_A_REAL_KEY' })
    expect(html).toContain(authCopy.errors.generic)
    expect(html).not.toContain('NOT_A_REAL_KEY')
  })

  it('a non-email ?email= value is never rendered on the code screen', async () => {
    const malicious = 'Your account is suspended, call 080-1234'
    let html: string | null = null
    try {
      html = await renderLogin({ step: 'code', email: malicious })
    } catch (err) {
      expect((err as { digest?: string }).digest ?? '').toMatch(/^NEXT_REDIRECT/)
      return
    }
    expect(html).not.toContain(malicious)
  })
})
