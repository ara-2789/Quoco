// Key for the /login forms (docs/plans/login-otp-ux-plan.md, review round 1 B1;
// moved here in §13).
//
// DELIBERATELY NOT in app/(auth)/login/pending-controls.tsx: that file is
// 'use client', and a server component (page.tsx) cannot CALL a function
// exported from a client module -- Next replaces the export with a client
// reference and throws "Attempted to call loginFormKey() from the server" at
// render time. vitest does not enforce that boundary, so unit tests passed
// while every real GET /login crashed. Anything page.tsx calls while rendering
// on the server must live in a plain module like this one: no 'use client',
// no React imports. (scripts/smoke-login.sh is the gate that sees this class.)
//
// A server action that redirects to the SAME route with different search
// params keeps a form's React instance alive, so a latch held across the
// redirect would stay held. Keying each form by the params a redirect changes
// makes a redirect to a different URL remount the form: fresh latch, fresh
// pending. Strings from params, '' when absent.
//
// The key is RENDERED (data-latch-key), so callers pass only values the page
// already trusts -- never a raw query-string value (T-OTP-07 / T-OTP-08).
export function loginFormKey(params: { step?: string; error?: string; email?: string }): string {
  return `${params.step ?? ''}|${params.error ?? ''}|${params.email ?? ''}`
}
