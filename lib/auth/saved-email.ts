// Keeps the typed email across the /login error redirect
// (docs/plans/login-otp-ux-plan.md, section 14).
//
// WHY: after a rate-limited "Send code" the server redirects to
// /login?error=RESEND_RATE_LIMITED, and the email form remounts EMPTY. The
// recovery path ("Already have a code? Enter it here") submits that same
// field, so the PM would have to retype the address to use it. The address is
// saved on submit and put back into the empty field on mount.
//
// CLIENT-ONLY and TAB-SCOPED: sessionStorage only. Not localStorage, not a
// cookie, not the URL; the address is never added to any request or message.
//
// PLAIN MODULE on purpose: no 'use client', no React. page.tsx (a server
// component) must not call anything that lives in a 'use client' file; this
// module is only called from inside client components, but keeping it plain
// also makes it unit-testable in node. Every storage access is wrapped: a
// blocked / full / disabled sessionStorage (private mode, SecurityError) must
// never break sign-in, it just means nothing is remembered.

/** The one storage key. */
export const SAVED_EMAIL_KEY = 'quoco.login.email'

/** Longest valid email address (RFC 5321 path limit). */
const MAX_EMAIL_LENGTH = 254

/** The slice of the Storage interface this module needs. */
export type StorageLike = {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function isPlausibleEmail(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_EMAIL_LENGTH && value.includes('@')
}

/** Trims and stores `value`; ignores anything that is not plausibly an email. Never throws. */
export function saveEmail(storage: StorageLike | null | undefined, value: string): void {
  try {
    if (!storage) return
    const trimmed = typeof value === 'string' ? value.trim() : ''
    if (!isPlausibleEmail(trimmed)) return
    storage.setItem(SAVED_EMAIL_KEY, trimmed)
  } catch {
    // Storage blocked or full: remember nothing, break nothing.
  }
}

/** The saved email, or '' unless it is a non-empty string of <= 254 chars containing '@'. Never throws. */
export function readSavedEmail(storage: StorageLike | null | undefined): string {
  try {
    if (!storage) return ''
    const value = storage.getItem(SAVED_EMAIL_KEY)
    return isPlausibleEmail(value) ? value : ''
  } catch {
    return ''
  }
}

/** A StorageLike that can also delete a key (window.sessionStorage can). */
export type ClearableStorageLike = StorageLike & {
  removeItem: (key: string) => void
}

/**
 * Forgets the saved address. Called when the code step mounts (review round 2,
 * N1): once a code has been sent (or the have-code path was taken) the address
 * is no longer needed, and it must not outlive that on a shared computer, e.g.
 * showing the previous PM's address in /login after a sign-out in the same tab.
 * The email step's restore is unaffected (the rate-limit error path never
 * reaches the code step). Never throws.
 */
export function clearSavedEmail(storage: ClearableStorageLike | null | undefined): void {
  try {
    if (!storage) return
    storage.removeItem(SAVED_EMAIL_KEY)
  } catch {
    // Storage blocked: nothing to clear that we could have written.
  }
}

/** window.sessionStorage, or null when unavailable (SSR, or access throws). Never throws. */
export function browserSessionStorage(): ClearableStorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage
  } catch {
    return null
  }
}
