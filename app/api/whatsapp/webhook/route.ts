import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
import crypto from 'crypto'
import { isNewMessage } from '@/lib/whatsapp/idempotency'
import { normalisePhoneNumber } from '@/lib/whatsapp/normalise'
import { createServiceClient } from '@/lib/supabase/service'
import { applyMorningFlowTurn, buildMorningReply } from '@/lib/whatsapp/flows/morning'
import { isTestStartTrigger } from '@/lib/whatsapp/flows/test-trigger'
import { decideInboundGate, clearMessagingBlock } from '@/lib/whatsapp/reactivation'

// NFR-11: validate every inbound request is genuinely from Twilio before
// processing anything. Twilio signs each webhook request using your Auth
// Token; we recompute the signature and compare. Non-matching -> 403.
function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  twilioSignature: string,
  authToken: string,
): boolean {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }

  const expectedSignature = crypto
    .createHmac('sha1', authToken)
    .update(Buffer.from(data, 'utf-8'))
    .digest('base64')

  const expectedBuf = Buffer.from(expectedSignature)
  const providedBuf = Buffer.from(twilioSignature)

  // timingSafeEqual THROWS RangeError on length-mismatched buffers. A garbage
  // X-Twilio-Signature of the wrong length would otherwise become an unhandled
  // 500 — and Twilio retries 5xx, so malformed-signature probes create retry
  // noise (S1). A length mismatch is invalid by definition; return false. Length
  // is not secret, so short-circuiting here is not a timing leak.
  if (expectedBuf.length !== providedBuf.length) {
    return false
  }

  return crypto.timingSafeEqual(expectedBuf, providedBuf)
}

// Escape the five XML predefined entities before embedding free text in TwiML.
// Engineer answers are arbitrary free text and can contain & < > " ' — none of
// which may reach the XML body unescaped.
function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

// TwiML with a single outbound message (same status/content-type shape as
// notRegisteredResponse). Body is XML-escaped.
function twimlMessage(text: string): NextResponse {
  return new NextResponse(
    `<Response><Message>${escapeXml(text)}</Message></Response>`,
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
}

// TwiML with no message — Twilio sends nothing. Used for the 'idle' outcome and
// for every no-op / error response to a signature-valid Twilio request, so the
// body is always valid TwiML (returning JSON makes Twilio's debugger log schema
// warnings — N1). `status` lets an error path keep its 5xx (Twilio retries those)
// while still answering in TwiML.
function twimlEmpty(status = 200): NextResponse {
  return new NextResponse('<Response></Response>', {
    status,
    headers: { 'Content-Type': 'text/xml' },
  })
}

// BOT-08 unregistered reply. Sent as TwiML so Twilio delivers it to the
// sender. No session, no DB writes precede this.
function notRegisteredResponse(): NextResponse {
  return new NextResponse(
    '<Response><Message>This number is not registered with Quoco. Contact your Project Manager.</Message></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
}

// A registered, active engineer with no project_members row — a real setup gap,
// not a broken bot. Give them an actionable message rather than silence.
function noProjectResponse(): NextResponse {
  return twimlMessage(
    'Your number is registered but not yet linked to a project. Contact your Project Manager to be added.',
  )
}

// Shape of the single gate lookup (user row + embedded active-project rows).
interface GateUser {
  id: string
  tenant_id: string
  status: string
  messaging_blocked: boolean
  project_members: { project_id: string }[]
}

export async function POST(request: NextRequest) {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature')
  if (!twilioSignature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
  }

  const formData = await request.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value.toString()
  })

  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`

  const isValid = validateTwilioSignature(webhookUrl, params, twilioSignature, authToken)

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const fromNumber = normalisePhoneNumber(params.From ?? '')

  // --- Registration + gate lookup FIRST (BOT-08 / ENG-02) ---------------
  // This runs BEFORE the idempotency insert so an unregistered or gated
  // number leaves ZERO storage footprint — not even a processed_messages
  // row. BOT-08 forbids any trace tied to a number Quoco doesn't recognise
  // or has blocked. The retry cost (re-running this indexed lookup on Twilio
  // retries of unregistered numbers) is negligible and worth the guarantee.
  //
  // The engineer's single active project is embedded in this SAME query
  // (project_members(project_id)) — one round trip, read only after the gate
  // passes. The gate itself still keys solely on status + messaging_blocked.
  const supabase = createServiceClient()
  const { data: user, error: lookupError } = await supabase
    .from('users')
    .select('id, tenant_id, status, messaging_blocked, project_members(project_id)')
    .eq('whatsapp_number', fromNumber)
    .maybeSingle<GateUser>()

  if (lookupError) {
    // Observe in Sentry (S3), never leak the raw DB error to the caller. Keep the
    // 500 so Twilio retries a transient DB blip; answer in TwiML (N1). This runs
    // before idempotency, so a retry re-attempts the lookup cleanly.
    Sentry.captureException(lookupError, {
      tags: { feature: 'bot-27-reactivation', stage: 'gate-lookup' },
    })
    return twimlEmpty(500)
  }

  // Unregistered number: BOT-08 rejection, no session, no DB writes.
  if (!user) {
    return notRegisteredResponse()
  }

  // --- Gate decision (BOT-08 gate + BOT-27 reactivation clear-half) -------
  // decideInboundGate is a pure function (unit-tested in reactivation.test.ts):
  //   'gated_noop' → pending / deactivated (any flag): silent no-op, no writes,
  //                  no disclosure that the number is known. Unchanged BOT-08.
  //   'reactivate' → active engineer gated ONLY by messaging_blocked: clear the
  //                  block (BOT-27 clear-half), ack, stop. A deactivated+blocked
  //                  engineer is NOT reactivated — it is 'gated_noop'.
  //   'proceed'    → active + unblocked: fall through to the normal flow.
  const gate = decideInboundGate(user)

  if (gate === 'gated_noop') {
    return twimlEmpty()
  }

  if (gate === 'reactivate') {
    // Idempotency FIRST: a Twilio retry of the reconnect message must be a no-op
    // and must NOT fall through into the morning flow after the flag is cleared.
    // Recording a processed_messages row for this KNOWN, re-consenting engineer is
    // a deliberate, narrow relaxation of BOT-08's "gated numbers leave zero
    // footprint" rule (that rule targets UNKNOWN numbers, not a registered
    // engineer who just re-opened the session by messaging in).
    //
    // ACCEPTED FAILURE WINDOW (S3): the SID is consumed HERE, before the clear
    // below. So if the clear then fails, the engineer stays blocked with no reply
    // until their NEXT inbound (this SID now no-ops as a duplicate). That is the
    // deliberately SAFER ordering: clearing before consuming the SID would let a
    // Twilio retry of this same message fall through into the morning flow after
    // the flag was cleared. We trade a rare "stuck until next message" support
    // case (visible in Sentry) for never mis-triggering the flow on a retry.
    const reactSid = params.MessageSid
    if (!reactSid) {
      return twimlEmpty(400)
    }
    const isNewReact = await isNewMessage(reactSid)
    if (!isNewReact) {
      return twimlEmpty()
    }

    const { error: clearError, cleared } = await clearMessagingBlock(
      supabase,
      user.id,
      user.tenant_id,
    )
    if (clearError) {
      Sentry.captureException(new Error(clearError), {
        tags: { feature: 'bot-27-reactivation', stage: 'clear' },
      })
      return twimlEmpty(500)
    }
    if (!cleared) {
      // Zero rows matched: the TOCTOU guard fired — the engineer was deactivated
      // (or otherwise no longer status='active') between the gate read and this
      // write. Do NOT send a "reconnected" ack that would misrepresent state.
      return twimlEmpty()
    }

    // Within-session TwiML reply — a REPLY to their inbound, not a
    // business-initiated template, so it is permitted for a just-unblocked number
    // (their message reopened the 24h window). NOT the quoco_engineer_optin
    // template (deferred, blocked on the production sender). Copy is intentionally
    // minimal: it does NOT promise scheduled check-ins, which still need the
    // production sender (N2). The reconnect message does NOT enter the morning flow.
    return twimlMessage("You're reconnected to Quoco.")
  }

  // --- Idempotency (only now that the number is a real active user) -----
  // Twilio retries webhook calls that don't respond fast enough or return
  // non-2xx. A repeated MessageSid is a no-op — we already processed it.
  const messageSid = params.MessageSid
  if (!messageSid) {
    return NextResponse.json({ error: 'Missing MessageSid' }, { status: 400 })
  }

  const isNew = await isNewMessage(messageSid)
  if (!isNew) {
    console.log(`Duplicate message SID ${messageSid} — skipping (idempotent no-op)`)
    return NextResponse.json({ status: 'duplicate_ignored' })
  }

  // --- Resolve the engineer's active project (Pass 1: single project) ----
  // schema.md: one active project per engineer, app-enforced. Take the first
  // membership. A registered active engineer with none is a real setup gap —
  // reply with an actionable message, not silence.
  const projectId = user.project_members[0]?.project_id
  if (!projectId) {
    return noProjectResponse()
  }

  // --- Morning flow turn (single transactional RPC) ----------------------
  // applyMorningFlowTurn REPLACES acquire_and_transition_session on this path:
  // it takes the row lock, decides Q1/Q4, and writes session + daily_logs in
  // ONE transaction. startFlow is env-gated and structurally cannot be true
  // without ENABLE_TEST_FLOW_TRIGGER='true'.
  const messageBody = params.Body ?? ''
  const startFlow = isTestStartTrigger(messageBody)
  if (startFlow) {
    console.warn(
      `TEST-ONLY flow trigger fired for ${fromNumber} — ENABLE_TEST_FLOW_TRIGGER must NOT be set in production`,
    )
  }

  const result = await applyMorningFlowTurn({
    phoneNumber: fromNumber,
    tenantId: user.tenant_id,
    userId: user.id,
    projectId,
    message: messageBody,
    startFlow,
  })

  // Reply text is single-sourced from morning.ts — never inline here.
  const reply = buildMorningReply(result.outcome, result.currentStep)
  return reply === '' ? twimlEmpty() : twimlMessage(reply)
}
