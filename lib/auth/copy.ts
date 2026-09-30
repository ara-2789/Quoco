// Approved English wording for the email OTP login flow at /login
// (docs/plans/email-otp-plan.md, section (f); all 17 constants approved by
// Aravind, 21 Sep 2026 -- see that plan's (k) STRINGS APPROVED records).
// {email} is a placeholder left for the caller to fill -- no formatting
// logic belongs in this file.
//
// Deliberate, do not "fix":
//   - `wrongCode` and `expiredCode` carry the SAME approved string on
//     purpose (plan (f)'s own note): Aravind's choice is one user-facing
//     message for both cases, even though Supabase's `error.code` CAN
//     distinguish them server-side (`otp_expired` vs. an invalid-code
//     code). Kept as two separate constants, not merged into one, per the
//     plan's instruction to keep proposed constant names as they are.
//   - `unknownEmail` DOES reveal that an email is not registered -- the
//     OPPOSITE choice from lib/engineers/copy.ts's `inUse`, which
//     deliberately does NOT reveal whether a number is registered. Both
//     are intentional: this slice is pre-beta with no public signup
//     surface to enumerate against (D-O2), while the engineers surface
//     protects against enumerating another company's phone numbers.
//     Revisit both against the same anti-enumeration standard once
//     self-serve signup opens (plan (e)'s ACCEPTED TRADE-OFF note).

export const emailStep = {
  heading: 'Sign in to Quoco',
  body: 'Enter your email and we will send you a 6-digit code.',
  submitLabel: 'Send code',
} as const

export const codeStep = {
  heading: 'Enter your code',
  body: 'We sent a 6-digit code to {email}. It expires in 10 minutes.',
  inputLabel: '6-digit code',
  submitLabel: 'Sign in',
  resendLabel: 'Send a new code',
  startOverLabel: 'Use a different email',
} as const

export const errors = {
  unknownEmail: 'We could not find that email. Contact your Quoco admin.',
  resendRateLimited: 'You asked for a code a moment ago. Wait a minute before asking again.',
  wrongCode: 'That code is wrong or has expired. Ask for a new one.',
  expiredCode: 'That code is wrong or has expired. Ask for a new one.',
  tooManyAttempts: 'Too many tries. Wait a minute, then ask for a new code.',
  generic: 'Something went wrong. Please try again.',
} as const

export const email = {
  otpSubject: 'Your Quoco sign-in code',
  otpBody: 'Your sign-in code is {{ .Token }}. It is valid for 10 minutes. If you did not ask to sign in, you can ignore this email.',
} as const
