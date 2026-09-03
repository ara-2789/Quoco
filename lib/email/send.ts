// The outbound email send primitive -- owner delivery (docs/dpr-delivery-
// versioning-plan.md §2g). Raw fetch to Resend's REST API, NO SDK, no npm
// dependency added -- matching this codebase's own house style for Twilio
// (lib/whatsapp/outbound/send.ts).
//
// WHY RAW FETCH, NOT AN SDK -- STATED, NOT ASSUMED (Aravind, 2026-09-02):
// owning the request and response is what made this week's Twilio
// diagnoses possible. The XML-vs-JSON default-response bug
// (docs/reviews/first-cron-fire-record.md) was only findable because this
// codebase's own code controlled the URL and could be corrected by adding
// `.json` to it -- an SDK method call would have hidden that decision
// entirely. And PR #135's response-shape capture (this file's own
// describeResponseShape, mirroring send.ts's) depended on reading the RAW
// response body/headers directly -- an SDK that returns an already-parsed,
// already-decided result object gives nothing to capture. Same reasoning
// applies here before a single real email has ever been sent, not after
// the fact.
//
// NOT VERIFIED AGAINST RESEND'S CURRENT DOCS FROM A LIVE CALL -- CLAUDE.md's
// own "if a fact might have changed since training, say so" rule. The
// request/response shape below (POST https://api.resend.com/emails, Bearer
// auth, JSON body, `{id}` on success) is this session's best understanding
// of Resend's documented API, not confirmed against a real response -- no
// credentials exist in this sandbox (see the owner-deliver handler's own
// header for what remains untested until real credentials exist). Verify
// against Resend's current docs before the first real send.

import { createHash } from 'crypto'

export interface SendEmailParams {
  to: string
  subject: string
  text: string
  html: string
}

/**
 * Structural description of the provider's HTTP response -- same shape-
 * only-never-content discipline as send.ts's own ResponseShape, for the
 * same reason: an email body contains a full DPR (site data, names), and
 * this table/log has no guaranteed way to un-write a captured snippet
 * later if the bound turns out too generous.
 */
export interface EmailResponseShape {
  contentType: string | null
  bodyLength: number
  /** First 16 hex chars of SHA-256(raw body text) -- correlation only. */
  bodyHash: string
  parsed: boolean
  /** Only present when `parsed` is true. Top-level key NAMES, sorted -- never values. */
  parsedKeys?: string[]
}

export type SendEmailResult =
  | { ok: true; status: number; id: string }
  | {
      ok: false
      status: number
      errorMessage?: string
      responseShape: EmailResponseShape
    }

// Exported (2026-09-03) so a caller can check credentials BEFORE doing
// anything else -- the exact ordering defect this fixes: provision-beta-
// owner.ts used to write two rows before ever reaching sendEmail's own
// internal call to this function, so a missing credential was discovered
// only after real data was already committed. Calling this once, up
// front, fails the same way but before any write -- see that script's
// own header for the incident this closes.
export function readCredentials(): { apiKey: string; fromAddress: string } {
  const apiKey = process.env.RESEND_API_KEY
  const fromAddress = process.env.RESEND_FROM_EMAIL
  if (!apiKey || !fromAddress) {
    // Deliberately does not name which of the two is missing beyond this --
    // same reasoning as send.ts's own readCredentials.
    throw new Error('sendEmail: RESEND_API_KEY and RESEND_FROM_EMAIL must both be set in the environment.')
  }
  return { apiKey, fromAddress }
}

function describeResponseShape(rawText: string, contentType: string | null, parsed: unknown, parseOk: boolean): EmailResponseShape {
  const bodyHash = createHash('sha256').update(rawText, 'utf8').digest('hex').slice(0, 16)
  const shape: EmailResponseShape = {
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
 * Send one email via Resend's REST API. No retry, no idempotency of its
 * own -- same division of responsibility as sendWhatsAppTemplate: the
 * caller (the owner-deliver handler) is what makes a retry safe, via its
 * own terminal-delivery_status skip. This function does exactly one thing:
 * make the HTTP call and report what the provider said.
 *
 * `fetchFn` injectable, defaulting to global `fetch` -- same DI shape as
 * sendWhatsAppTemplate, for the same reason (a test stubbing global fetch
 * would also intercept the Supabase JS client's own internal HTTP calls).
 */
export async function sendEmail(params: SendEmailParams, fetchFn: typeof fetch = fetch): Promise<SendEmailResult> {
  const { apiKey, fromAddress } = readCredentials()

  const res = await fetchFn('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: fromAddress,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html,
    }),
  })
  // Nothing below this line ever reads `apiKey` again -- only the RESPONSE
  // is read from here on, matching send.ts's own leak-shape argument.

  const contentType = res.headers.get('content-type')
  const rawText = await res.text()

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
    parseOk && parsed !== null && typeof parsed === 'object' ? (parsed as { id?: string; message?: string }) : null

  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      errorMessage: responseBody?.message,
      responseShape: describeResponseShape(rawText, contentType, parsed, parseOk),
    }
  }

  const id = responseBody?.id
  if (!id) {
    // 2xx without a usable `id` -- refuse to guess a fake success, same
    // reasoning as send.ts's own "2xx with no sid field" refusal.
    const reason = !parseOk
      ? rawText.length === 0
        ? 'an empty response body'
        : 'a body that is not valid JSON'
      : 'valid JSON with no "id" field'
    return {
      ok: false,
      status: res.status,
      errorMessage: `Resend returned 2xx with ${reason}.`,
      responseShape: describeResponseShape(rawText, contentType, parsed, parseOk),
    }
  }

  return { ok: true, status: res.status, id }
}
