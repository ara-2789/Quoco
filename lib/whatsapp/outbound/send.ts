// The outbound WhatsApp send primitive — Pass 1 item B
// (docs/plans/pass1-outbound-send-plan.md). Raw fetch to Twilio's classic
// Messages REST API, NO Twilio SDK, no npm dependency added.
//
// VERIFIED AGAINST TWILIO'S CURRENT DOCS BEFORE WRITING THIS FILE, not
// memory (2026-08-27): the Messages resource (api.twilio.com/2010-04-01/
// Accounts/{AccountSid}/Messages) does NOT support an idempotency key --
// no Idempotency-Key/Idempotency-Token header, no idempotency parameter,
// confirmed by fetching Twilio's own message-resource docs directly and
// itemising every documented request parameter. (Idempotency keys DO exist
// elsewhere in Twilio's API surface -- Conversations Orchestrator config
// operations, the Voice Payment resource -- but not here.) This means
// migration 031's own claim-window reasoning (the UNIQUE(tenant_id,
// recipient_user_id, event_key) constraint on outbound_sends is the ONLY
// idempotency gate) stands unchanged -- there is no Twilio-side mechanism
// to fall back on or defer to.
//
// ENCODING: the classic Messages API is application/x-www-form-urlencoded,
// NOT JSON -- confirmed against Twilio's own docs (their own curl example
// uses --data-urlencode). This is a different convention from the Content
// API (content.twilio.com) that scripts/submit-templates.ts already talks
// to with a JSON body -- do not copy that script's Content-Type here.
// ContentVariables is itself a JSON-encoded STRING inside the form body,
// per Twilio's own parameter description ("key-value pairs... provided as
// a string value").
//
// AUTH: same approach as scripts/submit-templates.ts -- HTTP Basic,
// `Basic base64(accountSid:authToken)`, credentials read from
// process.env only. Never logged, never included in an error message or
// any payload dump -- only the response status/body (which never echoes
// the request's own auth header) is ever surfaced. `authHeader` is used
// exactly once, to build the outgoing `fetch` call below, and is never
// referenced again after that -- nothing downstream of the request could
// leak it even by accident.
//
// STATUSCALLBACK, ADDED FOR ITEM D (2026-08-28) -- WITHOUT THIS, ITEM D
// RECEIVES NOTHING. Twilio's Messages API only POSTs delivery-status
// updates to a StatusCallback URL that was supplied ON THE SEND ITSELF
// (per-message, not an account-wide default this codebase configures
// anywhere) -- confirmed against Twilio's own Messages resource docs, same
// verification discipline as this file's own IDEMPOTENCY KEY note above.
// Pointed at PRODUCTION_WEBHOOK_ORIGIN (lib/whatsapp/twilio-signature.ts) --
// the pinned production origin, never the env-derived fallback the same
// module also exposes for validation: this value is embedded in the
// OUTGOING Twilio API call itself, so it must be a real, reachable
// production URL, not whatever NEXT_PUBLIC_APP_URL happens to resolve to in
// a non-production environment (a test run must never ask Twilio to
// callback a URL that doesn't exist).
//
// RESPONSE SHAPE CAPTURE, ADDED 2026-08-29 (docs/reviews/first-cron-fire-
// record.md's own finding #2). The original `res.json().catch(() => null)`
// collapsed two genuinely different failure states -- "valid JSON with no
// `sid` field" and "JSON.parse itself threw" -- into one indistinguishable
// branch, and captured nothing else about the response. That is exactly
// what made 2026-08-29's real incident (a message Twilio's own console
// shows it created, with a real `sid`, that this codebase recorded as
// "2xx with no sid") impossible to fully explain after the fact.
//
// THE FIX IS SHAPE, NOT CONTENT -- considered and rejected a truncated raw-
// body capture. Twilio's own documented Message resource echoes `to`/
// `from` (E.164 numbers) and, for a Content Template send, a rendered
// `body` field containing the substituted template variables -- this
// codebase's own templates.ts passes the engineer's real name and project
// name as those variables. In Twilio's own documented example response,
// keys come back roughly alphabetically, and `body` and `from` both land
// within the first ~150-250 characters of a compact response that runs
// 400-800 characters total. There is no truncation bound that is both
// meaningfully smaller than "the whole thing" and reliably short enough to
// exclude that content -- and `outbound_sends` has no DELETE grant (031's
// own REVOKE) while Sentry has its own retention window, so a captured
// snippet, once written, is not something this codebase can take back
// later if the bound turns out to have been too generous. So: capture
// SHAPE, never content, unconditionally, not just "usually" --
// - `contentType` -- the response's own Content-Type header.
// - `bodyLength` -- the raw body's length in characters. A number, not
//   text; carries no content.
// - `bodyHash` -- the first 16 hex characters of SHA-256(raw body text).
//   Lets a human notice "this is the identical response shape as last
//   time" across occurrences without the hash ever being reversible back
//   to what the body said in any practical sense.
// - `parsed` -- whether JSON.parse succeeded at all.
// - `parsedKeys` -- ONLY when it did: the parsed object's own top-level
//   key NAMES, sorted, never values. Twilio's own field names (`to`,
//   `from`, `body`, `sid`, `status`, ...) are not personal data; what they
//   point at is. Seeing that a response has (or is missing) a `sid` key,
//   or has an unexpected extra key, is exactly the diagnostic signal this
//   capture exists for.
// Twilio's own numeric `error.code` field (e.g. 63015) is separately
// surfaced via the existing `errorCode` field below when present -- that
// value is Twilio's own opaque error-classification integer, not personal
// data, and is exactly what makes an error like today's identifiable
// without needing any content capture at all.

import { createHash } from 'crypto'
import { PRODUCTION_WEBHOOK_ORIGIN } from '@/lib/whatsapp/twilio-signature'

export interface SendTemplateParams {
  /** E.164, e.g. "+919876543210" -- the "whatsapp:" prefix is added here, not by the caller. */
  to: string
  /** Twilio Content SID for the approved template being sent, e.g. "HXd4a896b66bfd7b237f53dc4dca77fb76". */
  contentSid: string
  /** Template variable substitutions, keyed "1", "2", ... matching the template's own {{n}} numbering. */
  contentVariables: Record<string, string>
}

/**
 * Structural description of a Twilio HTTP response -- see this file's own
 * header ("RESPONSE SHAPE CAPTURE") for why this is shape, never content.
 */
export interface ResponseShape {
  contentType: string | null
  bodyLength: number
  /** First 16 hex chars of SHA-256(raw body text) -- correlation only. */
  bodyHash: string
  parsed: boolean
  /** Only present when `parsed` is true. Top-level key NAMES, sorted -- never values. */
  parsedKeys?: string[]
}

export type SendTemplateResult =
  | { ok: true; status: number; sid: string }
  | {
      ok: false
      status: number
      errorCode?: string
      errorMessage?: string
      responseShape: ResponseShape
    }

function readCredentials(): { accountSid: string; authToken: string; fromNumber: string } {
  const accountSid = process.env.TWILIO_ACCOUNT_SID
  const authToken = process.env.TWILIO_AUTH_TOKEN
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER
  if (!accountSid || !authToken || !fromNumber) {
    // Deliberately does not name which of the three is missing beyond this --
    // naming one and not the others invites a reader to assume the others
    // are fine, which isn't checked here. Never includes a value.
    throw new Error(
      'sendWhatsAppTemplate: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, and TWILIO_WHATSAPP_NUMBER must all be set in the environment.',
    )
  }
  return { accountSid, authToken, fromNumber }
}

function withWhatsAppPrefix(e164: string): string {
  return e164.startsWith('whatsapp:') ? e164 : `whatsapp:${e164}`
}

function describeResponseShape(rawText: string, contentType: string | null, parsed: unknown, parseOk: boolean): ResponseShape {
  const bodyHash = createHash('sha256').update(rawText, 'utf8').digest('hex').slice(0, 16)
  const shape: ResponseShape = {
    contentType,
    bodyLength: rawText.length,
    bodyHash,
    parsed: parseOk,
  }
  if (parseOk && parsed !== null && typeof parsed === 'object') {
    shape.parsedKeys = Object.keys(parsed as Record<string, unknown>).sort()
  }
  return shape
}

/**
 * Send one approved WhatsApp Content Template via Twilio's classic Messages
 * REST API. No retry, no idempotency of its own -- the caller (the claim ->
 * send -> activate sequence in trigger.ts) is what makes a retry safe, via
 * outbound_sends' own UNIQUE constraint. This function does exactly one
 * thing: make the HTTP call and report what Twilio said.
 *
 * `fetchFn` is injectable, defaulting to global `fetch` -- same DI shape as
 * every `supabaseClient` parameter elsewhere in this codebase, and for the
 * identical reason: a test that stubs GLOBAL `fetch` to mock this call would
 * ALSO intercept the Supabase JS client's own internal HTTP calls (it uses
 * `fetch` too), silently feeding a mocked Twilio response into a real
 * database INSERT. Confirmed the hard way in this file's own CI round —
 * `vi.stubGlobal('fetch', ...)` in the trigger.ts integration test caused
 * the claim INSERT to receive the mocked Twilio 4xx body and fail with
 * Twilio's own error text as though it were a Postgres error. Injection
 * avoids the collision entirely; the test now passes its mock in directly
 * instead of mutating the global.
 */
export async function sendWhatsAppTemplate(
  params: SendTemplateParams,
  fetchFn: typeof fetch = fetch,
): Promise<SendTemplateResult> {
  const { accountSid, authToken, fromNumber } = readCredentials()
  const authHeader = `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages`

  const body = new URLSearchParams({
    From: withWhatsAppPrefix(fromNumber),
    To: withWhatsAppPrefix(params.to),
    ContentSid: params.contentSid,
    ContentVariables: JSON.stringify(params.contentVariables),
    StatusCallback: `${PRODUCTION_WEBHOOK_ORIGIN}/api/whatsapp/status-callback`,
  })

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })
  // Nothing below this line ever reads `authHeader` or the request's own
  // headers again -- only the RESPONSE (status, headers, body) is read
  // from here on, so there is nothing of the Authorization header left to
  // leak into any capture below, by construction.

  const contentType = res.headers.get('content-type')
  const rawText = await res.text()

  // Parsed once, here, ourselves -- replaces the old `res.json().catch(()
  // => null)`, which discarded exactly the distinction (did it parse at
  // all?) this capture now preserves.
  let parsed: unknown = null
  let parseOk = false
  try {
    parsed = JSON.parse(rawText)
    parseOk = true
  } catch {
    parsed = null
    parseOk = false
  }

  const responseBody =
    parseOk && parsed !== null && typeof parsed === 'object'
      ? (parsed as { sid?: string; code?: number; message?: string })
      : null

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: responseBody?.code != null ? String(responseBody.code) : undefined,
      errorMessage: responseBody?.message,
      responseShape: describeResponseShape(rawText, contentType, parsed, parseOk),
    }
  }

  const sid = responseBody?.sid
  if (!sid) {
    // 2xx without a usable `sid` -- refuse to guess a fake success, same
    // reasoning as submit-templates.ts's own "returned 2xx but no sid
    // field" refusal. Three genuinely different shapes, now genuinely
    // distinguishable in the message text (and, structurally, in
    // `responseShape.parsed` / `bodyLength`) instead of collapsing into
    // one string as before.
    const reason = !parseOk
      ? rawText.length === 0
        ? 'an empty response body'
        : 'a body that is not valid JSON'
      : 'valid JSON with no "sid" field'
    return {
      ok: false,
      status: res.status,
      errorMessage: `Twilio returned 2xx with ${reason}.`,
      responseShape: describeResponseShape(rawText, contentType, parsed, parseOk),
    }
  }

  return { ok: true, status: res.status, sid }
}
