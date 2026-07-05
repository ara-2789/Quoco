import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isNewMessage } from '@/lib/whatsapp/idempotency'
import { normalisePhoneNumber } from '@/lib/whatsapp/normalise'
import { createServiceClient } from '@/lib/supabase/service'
import { acquireAndTransition } from '@/lib/whatsapp/session'

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

  return crypto.timingSafeEqual(
    Buffer.from(expectedSignature),
    Buffer.from(twilioSignature),
  )
}

// BOT-08 unregistered reply. Sent as TwiML so Twilio delivers it to the
// sender. No session, no DB writes precede this.
function notRegisteredResponse(): NextResponse {
  return new NextResponse(
    '<Response><Message>This number is not registered with Quoco. Contact your Project Manager.</Message></Response>',
    { status: 200, headers: { 'Content-Type': 'text/xml' } },
  )
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
  const supabase = createServiceClient()
  const { data: user, error: lookupError } = await supabase
    .from('users')
    .select('id, tenant_id, status, messaging_blocked')
    .eq('whatsapp_number', fromNumber)
    .maybeSingle()

  if (lookupError) {
    // Structured error only — never leak the raw DB error to the caller.
    console.error('User lookup failed for inbound WhatsApp message:', lookupError.message)
    return NextResponse.json({ error: 'Lookup failed' }, { status: 500 })
  }

  // Unregistered number: BOT-08 rejection, no session, no DB writes.
  if (!user) {
    return notRegisteredResponse()
  }

  // Gated-but-known number (pending / deactivated / messaging_blocked): silent
  // 200 no-op. We do NOT send anything (never message a blocked number) and do
  // NOT reveal that the number is known to Quoco. No session, no DB writes.
  if (user.status !== 'active' || user.messaging_blocked) {
    return NextResponse.json({ status: 'ignored' })
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

  // --- Session acquire + transition -------------------------------------
  // requestedFlow is null: an inbound reply only ADVANCES whatever flow is
  // already active (BOT-07 resume). The webhook never STARTS a new flow —
  // that is exclusively the cron trigger routes' job (not built yet), which
  // will pass a requestedFlow and rely on this same function's BOT-21 queue.
  const session = await acquireAndTransition({
    phoneNumber: fromNumber,
    tenantId: user.tenant_id,
    userId: user.id,
    requestedFlow: null,
    caller: 'webhook',
  })

  // TODO (flow work): dispatch on session.current_flow / current_step to send
  // the next question. The morning/evening flows are not built yet, so today
  // this is a stub — the session acquire/transition is the deliverable here.
  console.log('WhatsApp session acquired:', {
    phone: fromNumber,
    flow: session.current_flow,
    step: session.current_step,
    pending: session.pending_flows.length,
  })

  return NextResponse.json({ status: 'received' })
}
