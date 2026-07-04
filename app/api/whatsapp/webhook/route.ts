import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'

// NFR-11: validate every inbound request is genuinely from Twilio before
// processing anything. Twilio signs each webhook request using your Auth
// Token; we recompute the signature and compare. Non-matching -> 403.
function validateTwilioSignature(
  url: string,
  params: Record<string, string>,
  twilioSignature: string,
  authToken: string,
): boolean {
  // Twilio's signing algorithm: sort params by key, concatenate key+value
  // pairs onto the URL, HMAC-SHA1 with the auth token, base64 encode.
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
    // Fail closed: if the auth token isn't configured, reject everything
    // rather than silently skip validation.
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature')
  if (!twilioSignature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
  }

  // Twilio sends form-encoded data, not JSON.
  const formData = await request.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value.toString()
  })

  // Must match the exact URL Twilio was configured to call, including
  // protocol and path. NEXT_PUBLIC_APP_URL should be the production URL
  // once deployed (e.g. https://quoco-xxxx.vercel.app or a custom domain).
  const webhookUrl = `${process.env.NEXT_PUBLIC_APP_URL}/api/whatsapp/webhook`

  const isValid = validateTwilioSignature(webhookUrl, params, twilioSignature, authToken)

  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  // TODO: message SID idempotency check (next task)
  // TODO: session state machine dispatch (next session)

  console.log('Validated Twilio webhook:', params)

  return NextResponse.json({ status: 'received' })
}