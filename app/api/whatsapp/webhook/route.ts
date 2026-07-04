import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { isNewMessage } from '@/lib/whatsapp/idempotency'
import { normalisePhoneNumber } from '@/lib/whatsapp/normalise'

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

  // Idempotency: Twilio retries webhook calls that don't respond fast
  // enough or return non-2xx. A repeated MessageSid is a no-op — we
  // already processed it, so just acknowledge without reprocessing.
  const messageSid = params.MessageSid
  if (!messageSid) {
    return NextResponse.json({ error: 'Missing MessageSid' }, { status: 400 })
  }

  const isNew = await isNewMessage(messageSid)
  if (!isNew) {
    console.log(`Duplicate message SID ${messageSid} — skipping (idempotent no-op)`)
    return NextResponse.json({ status: 'duplicate_ignored' })
  }

  const fromNumber = normalisePhoneNumber(params.From ?? '')
  const messageBody = params.Body ?? ''

  // TODO: session state machine dispatch (next block)

  console.log('Processing new WhatsApp message:', {
    from: fromNumber,
    body: messageBody,
    sid: messageSid,
  })

  return NextResponse.json({ status: 'received' })
}