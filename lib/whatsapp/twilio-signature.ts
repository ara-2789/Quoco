// Shared Twilio request-signature validation for every Twilio-facing route
// in this codebase -- today the inbound webhook (app/api/whatsapp/webhook/
// route.ts) and the new status-callback route (app/api/whatsapp/status-
// callback/route.ts, Pass 1 item D). Extracted here per docs/plans/pass1-
// outbound-send-plan.md's own Amendment (a): the status-callback route is a
// SECOND Twilio-facing endpoint and must not duplicate the single-string
// validation approach the webhook already had -- it must fix the bug once,
// shared, not carry the fragility forward into a second route.
//
// THE INCIDENT THIS CLOSES (docs/build-status.md, "WEBHOOK SIGNATURE
// VALIDATION IS HOST-PINNED, NOT HEADER-DERIVED", 2026-08-20). The old code
// built the validation URL from a single, fixed env var:
// `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`. NEXT_PUBLIC_
// APP_URL moved to https://app.quoco.co.in on 2026-08-19; Twilio's own
// sandbox config still posted to the old https://quoco-six.vercel.app for a
// full day. Different host string on each side -> every real inbound got a
// silent 403, undetected for a day because nobody happened to message the
// bot in that window.
//
// THE FIX: try a small, explicitly-maintained ALLOWLIST of known-good
// origins in turn, accept the first one whose signature matches. Safe
// specifically because the list is NOT taken from the incoming request's
// own Host header -- an attacker-controlled header can't add itself to the
// allowlist.
//
// THE ALLOWLIST, SOURCED, NOT GUESSED:
//   - 'https://app.quoco.co.in' -- pinned literal. The current, live
//     production custom domain. Confirmed current via docs/build-status.md's
//     dated 2026-08-19/20 entry (the domain move + same-day fix) and
//     corroborated by live references in docs/whatsapp-templates.md and
//     docs/design-decisions-beta-feedback.md's own template button URLs --
//     both read directly before this list was written, not recalled.
//   - process.env.NEXT_PUBLIC_APP_URL, VERBATIM, if set and not already the
//     pinned entry above -- kept as a SECOND candidate, not the primary
//     source, so this module does not reproduce the exact bug it exists to
//     fix (a single env-derived string as the ONLY source of truth). This
//     also means a deliberately-updated env var (ahead of a future domain
//     move, or a non-production environment such as CI's own test env,
//     which test/webhook.test.ts's own signing helper already relies on)
//     still validates without requiring a code change first -- while the
//     pinned entry means a stale/wrong env var can never be the ONLY thing
//     standing between a real Twilio request and a silent 403 again.
//   NOT included: 'https://quoco-six.vercel.app' (the OLD host from the
//   2026-08-19 incident) -- Twilio's own webhook config was repointed away
//   from it on 2026-08-20 (docs/build-status.md, same entry); nothing
//   currently configured in Twilio targets it, so keeping it would be dead
//   surface area, not defense in depth. Add it back explicitly, with its
//   own dated comment, if that ever stops being true.
//
// Computed fresh on every call (not cached at module load) -- cheap (one
// array literal, no I/O), and avoids any import-order/env-timing footgun
// where a cached value could go stale relative to a later env change within
// the same process (tests in particular).

import crypto from 'crypto'

/**
 * The pinned production origin, exported on its own (not just index [0] of
 * getAllowedWebhookOrigins) so a caller that needs a real, reachable
 * production URL -- not a validation candidate list -- has a named,
 * non-positional thing to import. Used by lib/whatsapp/outbound/send.ts to
 * build the StatusCallback URL embedded in an outgoing Twilio API call,
 * which must always be this real origin, never the env-derived fallback
 * (a non-production environment's NEXT_PUBLIC_APP_URL may not even be a
 * publicly reachable URL Twilio could ever call back to).
 */
export const PRODUCTION_WEBHOOK_ORIGIN = 'https://app.quoco.co.in'

export function getAllowedWebhookOrigins(): readonly string[] {
  const origins = [PRODUCTION_WEBHOOK_ORIGIN]
  const envUrl = process.env.NEXT_PUBLIC_APP_URL
  if (envUrl && !origins.includes(envUrl)) {
    origins.push(envUrl)
  }
  return origins
}

function signTwilioParams(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

/**
 * Validate an inbound Twilio request's X-Twilio-Signature header against
 * every allowlisted origin in turn (getAllowedWebhookOrigins), accepting
 * the first match. `path` is the route's own path only (e.g.
 * '/api/whatsapp/webhook') -- this function builds the full URL for each
 * candidate origin, matching Twilio's own signing contract (it signs over
 * the exact URL it posted to, including scheme and host).
 *
 * timingSafeEqual THROWS RangeError on length-mismatched buffers -- a
 * garbage X-Twilio-Signature of the wrong length would otherwise become an
 * unhandled 500, and Twilio retries 5xx, creating retry noise (S1,
 * inherited from the original webhook-only implementation). A length
 * mismatch is invalid by definition; skip to the next candidate rather than
 * throwing. Length is not secret, so this is not a timing leak.
 */
export function validateTwilioSignature(
  path: string,
  params: Record<string, string>,
  twilioSignature: string,
  authToken: string,
): boolean {
  const providedBuf = Buffer.from(twilioSignature)
  for (const origin of getAllowedWebhookOrigins()) {
    const url = `${origin}${path}`
    const expectedBuf = Buffer.from(signTwilioParams(url, params, authToken))
    if (expectedBuf.length !== providedBuf.length) continue
    if (crypto.timingSafeEqual(expectedBuf, providedBuf)) return true
  }
  return false
}
