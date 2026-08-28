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
// the request's own auth header) is ever surfaced.

export interface SendTemplateParams {
  /** E.164, e.g. "+919876543210" -- the "whatsapp:" prefix is added here, not by the caller. */
  to: string
  /** Twilio Content SID for the approved template being sent, e.g. "HXd4a896b66bfd7b237f53dc4dca77fb76". */
  contentSid: string
  /** Template variable substitutions, keyed "1", "2", ... matching the template's own {{n}} numbering. */
  contentVariables: Record<string, string>
}

export type SendTemplateResult =
  | { ok: true; status: number; sid: string }
  | { ok: false; status: number; errorCode?: string; errorMessage?: string }

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
  })

  const res = await fetchFn(url, {
    method: 'POST',
    headers: {
      Authorization: authHeader,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: body.toString(),
  })

  // Twilio's error responses are JSON ({code, message, more_info, status})
  // on non-2xx same as success responses on 2xx -- one parse path for both,
  // per Twilio's own documented error-response shape.
  const responseBody = (await res.json().catch(() => null)) as
    | { sid?: string; code?: number; message?: string }
    | null

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorCode: responseBody?.code != null ? String(responseBody.code) : undefined,
      errorMessage: responseBody?.message,
    }
  }

  const sid = responseBody?.sid
  if (!sid) {
    // 2xx with no sid is not a shape this endpoint is documented to return --
    // refuse to guess a fake success, same reasoning as submit-templates.ts's
    // own "returned 2xx but no sid field" refusal.
    return { ok: false, status: res.status, errorMessage: 'Twilio returned 2xx with no "sid" field in the response body.' }
  }

  return { ok: true, status: res.status, sid }
}
