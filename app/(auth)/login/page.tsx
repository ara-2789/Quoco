import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { profileForAuthId } from '@/lib/auth/profile'
import { emailStep, codeStep, errors as errorCopy } from '@/lib/auth/copy'
import * as Sentry from '@sentry/nextjs'
import {
  LatchedForm,
  LatchScope,
  SubmitButton,
  HaveCodeButton,
  EmailInput,
} from './pending-controls'
import { loginFormKey } from '@/lib/auth/login-form-key'

// Known error keys this page redirects with. An unrecognised or tampered
// ?error= value always falls through to GENERIC below via errorMessageFor's
// `?? errorCopy.generic` -- the raw query-string value is never rendered
// (docs/plans/email-otp-plan.md (e), S4). T-OTP-07 covers this directly.
const ERROR_MESSAGES: Record<string, string> = {
  UNKNOWN_EMAIL: errorCopy.unknownEmail,
  RESEND_RATE_LIMITED: errorCopy.resendRateLimited,
  WRONG_CODE: errorCopy.wrongCode,
  TOO_MANY_ATTEMPTS: errorCopy.tooManyAttempts,
  CALLBACK_FAILED: errorCopy.generic,
  GENERIC: errorCopy.generic,
}

function errorMessageFor(key: string | undefined): string {
  if (!key) return errorCopy.generic
  return ERROR_MESSAGES[key] ?? errorCopy.generic
}

// The exact pattern browsers use for <input type="email">'s own constraint
// validation (WHATWG HTML Standard, "valid e-mail address" production) --
// the SAME rule the Screen 1 email input already relies on client-side.
// Server-side here because Screen 2's ?email= is untrusted query-string
// input, never re-checked against this before (found live, 1 Oct 2026: a
// crafted ?email= value -- e.g. "Your account is suspended, call
// 080-1234" -- was rendered verbatim into the page, both in the approved
// LOGIN_CODE_STEP_BODY sentence and into two hidden form field values).
const HTML5_EMAIL_RE =
  /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/

function isValidEmail(value: string): boolean {
  return HTML5_EMAIL_RE.test(value)
}

// Maps a Supabase Auth error from the CODE-REQUEST call (signInWithOtp with
// shouldCreateUser:false) to one of this page's own known error keys.
// Observed on test-db (docs/plans/email-otp-plan.md (h), T-OTP-01/T-OTP-04):
// shouldCreateUser:false + unknown email -> 'otp_disabled'; the platform
// toggle path (unused by this call, which always sets the flag explicitly)
// returns 'signup_disabled' -- included here too since both mean the same
// thing to this app: no such account. A resend before the cooldown ->
// 'over_email_send_rate_limit'.
function requestErrorKey(code: string | undefined): string {
  switch (code) {
    case 'otp_disabled':
    case 'signup_disabled':
    case 'user_not_found':
      return 'UNKNOWN_EMAIL'
    case 'over_email_send_rate_limit':
      return 'RESEND_RATE_LIMITED'
    default:
      return 'GENERIC'
  }
}

// Maps a Supabase Auth error from the CODE-VERIFY call (verifyOtp) to one of
// this page's own known error keys. Observed on test-db (T-OTP-03): a
// deliberately wrong code returns 'otp_expired' -- the SAME code Supabase
// returns for an actually-expired one, which is exactly why the approved
// copy (f) shows one shared message for both; WRONG_CODE covers both here,
// by design, not by omission.
function verifyErrorKey(code: string | undefined): string {
  switch (code) {
    case 'over_request_rate_limit':
      return 'TOO_MANY_ATTEMPTS'
    default:
      return 'WRONG_CODE'
  }
}

async function requestCode(formData: FormData) {
  'use server'
  const email = (formData.get('email') as string).trim()
  const headersList = await headers()
  const origin = headersList.get('origin') ?? `https://${headersList.get('host')}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      shouldCreateUser: false,
      // RETAINED, not dropped (plan (a)'s B1 correction): keeps any magic
      // link still capable of being generated pointed at a valid
      // destination for as long as the dashboard email template hasn't
      // been flipped to {{ .Token }} yet (deploy-order window, (c)/(g)).
      emailRedirectTo: `${origin}/auth/callback`,
    },
  })

  if (error) {
    redirect(`/login?error=${requestErrorKey(error.code)}`)
  }
  redirect(`/login?step=code&email=${encodeURIComponent(email)}`)
}

async function resendCode(formData: FormData) {
  'use server'
  const email = (formData.get('email') as string).trim()
  const headersList = await headers()
  const origin = headersList.get('origin') ?? `https://${headersList.get('host')}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false, emailRedirectTo: `${origin}/auth/callback` },
  })

  if (error) {
    redirect(
      `/login?step=code&email=${encodeURIComponent(email)}&error=${requestErrorKey(error.code)}`,
    )
  }
  redirect(`/login?step=code&email=${encodeURIComponent(email)}`)
}

async function verifyCode(formData: FormData) {
  'use server'
  const email = (formData.get('email') as string).trim()
  const code = (formData.get('code') as string).trim()

  // ONE client instance for verifyOtp AND the getUser()/profile redirect
  // below (plan (a)'s N1 addition) -- a second, freshly-created client in
  // this action would not see the just-established session; the cookies
  // land on the outgoing response, not the request (server.ts's own
  // comment -- the same reasoning the callback route already relies on).
  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token: code, type: 'email' })

  if (error) {
    redirect(
      `/login?step=code&email=${encodeURIComponent(email)}&error=${verifyErrorKey(error.code)}`,
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const profile = await profileForAuthId(supabase, user.id)
  redirect(profile.tenant_id ? '/dashboard' : '/onboarding')
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; email?: string; error?: string }>
}) {
  const params = await searchParams

  // B6 (docs/plans/login-otp-ux-plan.md, narrowed in §12): a user who is
  // already signed in AND has a tenant goes to /dashboard instead of seeing
  // the sign-in form. ONLY the lookups are inside the try. The target is
  // computed there and redirect() is called OUTSIDE it, because redirect()
  // works by throwing NEXT_REDIRECT -- a redirect inside this try would be
  // caught by the catch below and the signed-in user would still see the form.
  //
  // Everything else renders the form: no session, a session whose profile has
  // NO tenant (NOT sent to /onboarding: that page has no sign-out, so /login
  // is the only way such a user can switch address), or a failed lookup. A
  // failed lookup is also REPORTED (the missing-profile-row invariant
  // profileForAuthId throws on should not be silent), by error name only:
  // never the auth id, email or a token.
  let signedInTarget: string | null = null
  try {
    const supabase = await createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (user) {
      const profile = await profileForAuthId(supabase, user.id)
      signedInTarget = profile.tenant_id ? '/dashboard' : null
    }
  } catch (err) {
    signedInTarget = null
    Sentry.captureMessage('login: signed-in lookup failed', {
      level: 'error',
      tags: { feature: 'login-b6' },
      extra: { errorName: err instanceof Error ? err.name : typeof err },
    })
  }
  if (signedInTarget) redirect(signedInTarget)

  // Review round 1, B1: forms are keyed by the params a redirect changes, so a
  // same-route redirect (e.g. to ?error=...) remounts them with a fresh latch.
  // The key is RENDERED (data-latch-key), so it only ever carries values this
  // page already trusts: a known error key (anything else collapses to
  // GENERIC, exactly like errorMessageFor), and the email only on the code
  // step, where it is validated below before anything renders. A raw
  // query-string value must never reach the HTML (T-OTP-07 / T-OTP-08).
  const formKey = loginFormKey({
    step: params.step === 'code' ? 'code' : undefined,
    error:
      params.error === undefined
        ? undefined
        : Object.prototype.hasOwnProperty.call(ERROR_MESSAGES, params.error)
          ? params.error
          : 'GENERIC',
    email: params.step === 'code' ? params.email : undefined,
  })

  if (params.step === 'code') {
    const email = params.email ?? ''

    // Screen 2's ?email= is untrusted (it round-trips through the URL, not
    // a session). Validated here with the SAME rule Screen 1's own email
    // input uses, before it reaches LOGIN_CODE_STEP_BODY's {email}
    // placeholder or either hidden form field below. On failure: back to
    // Screen 1, not a blanked-out Screen 2 -- LOGIN_CODE_STEP_BODY's
    // approved wording requires a real {email} value, and no approved
    // string exists for "no address to show" without inventing one, which
    // this fix does not do. Screen 1's own approved copy needs no email
    // value at all, so it has no equivalent gap.
    if (!isValidEmail(email)) {
      redirect('/login')
    }

    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">{codeStep.heading}</h2>
        <p className="text-gray-700 text-sm mb-6">{codeStep.body.replace('{email}', email)}</p>

        {params.error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {errorMessageFor(params.error)}
          </div>
        )}

        {/* Verify + resend share ONE latch (LatchScope): while either is in
            flight both buttons are disabled and a tap on the other is refused. */}
        <LatchScope key={formKey}>
        <LatchedForm action={verifyCode} className="space-y-4" latchKey={formKey}>
          <input type="hidden" name="email" value={email} />
          <div>
            <label htmlFor="code" className="block text-sm font-medium text-gray-700 mb-1">
              {codeStep.inputLabel}
            </label>
            <input
              id="code"
              name="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
          </div>
          {/* Pending: disabled, label unchanged (no busyLabel). */}
          <SubmitButton
            label={codeStep.submitLabel}
            className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </LatchedForm>

        <LatchedForm action={resendCode} className="mt-4" latchKey={formKey}>
          <input type="hidden" name="email" value={email} />
          <SubmitButton
            label={codeStep.resendLabel}
            busyLabel={codeStep.resendBusyLabel}
            className="w-full text-center text-sm text-blue-600 hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
          />
        </LatchedForm>
        </LatchScope>

        <p className="mt-4 text-center text-sm text-gray-700">
          <a href="/login" className="text-blue-600 hover:underline">
            {codeStep.startOverLabel}
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">{emailStep.heading}</h2>
      <p className="text-gray-700 text-sm mb-6">{emailStep.body}</p>

      {params.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {errorMessageFor(params.error)}
        </div>
      )}

      <LatchedForm
        key={formKey}
        action={requestCode}
        className="space-y-4"
        latchKey={formKey}
        rememberEmail
      >
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email address
          </label>
          {/* Client component, rendered as JSX only: restores the email saved
              before the error redirect into this (empty) field. */}
          <EmailInput className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent" />
        </div>
        <SubmitButton
          label={emailStep.submitLabel}
          busyLabel={emailStep.submitBusyLabel}
          className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
        />
        {/* AFTER "Send code" in DOM order, so Enter in the email field still
            sends. A GET submitter (formMethod=get, formAction=/login): it
            replaces the form's server action for its own submission, so it
            never calls requestCode and needs no JS. */}
        <HaveCodeButton
          label={emailStep.haveCodeLabel}
          className="w-full text-center text-sm text-blue-600 hover:underline disabled:opacity-60 disabled:cursor-not-allowed"
        />
      </LatchedForm>
    </div>
  )
}
