import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'crypto'
import { handleStatusCallbackPost } from '@/app/api/whatsapp/status-callback/route'
import { testClient } from './helpers/db'
import {
  OUTBOUND_TEST_TENANT_ID,
  OUTBOUND_TEST_PROJECT_ID,
  ensureOutboundParentFixtures,
  mintOutboundEngineer,
  cleanupOutboundSends,
  type MintedEngineer,
} from './helpers/outbound-fixtures'
import { MORNING_CHECKIN_SID } from '@/lib/whatsapp/outbound/templates'

// Item D2 (docs/plans/pass1-outbound-send-plan.md item D). Real HTTP-level
// harness against handleStatusCallbackPost, same extraction shape as
// test/webhook.test.ts against handleWebhookPost -- an injected test-db
// client, the SAME function POST calls in production.
//
// SIGNATURE, SAME DISCIPLINE AS test/webhook.test.ts's OWN T-WH-01: sign
// independently (never import validateTwilioSignature -- that would only
// prove "calling the same function agrees with itself"), against
// NEXT_PUBLIC_APP_URL (this file's own env-derived allowlist candidate,
// same one webhook.test.ts already relies on -- see lib/whatsapp/twilio-
// signature.ts's own header for why the env-derived origin is a candidate
// at all, not just the pinned production one).
//
// RESERVED DATES: 2026-09-17 through 2026-09-19 (test/helpers/db.ts's own
// reserved-blocks comment, continuing test/outbound-coverage-sweep.test.ts's
// own range). event_key's own CHECK constraint
// (`^[a-z_]+:\d{4}-\d{2}-\d{2}$`) requires an exact date with nothing
// after it -- a suffixed string like "2026-09-17_retry" would violate it,
// so distinct scenarios needing their own event_key use distinct DATES,
// not suffixed date strings.

const APP_URL = process.env.NEXT_PUBLIC_APP_URL
const REAL_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
if (!APP_URL || !REAL_AUTH_TOKEN) {
  throw new Error('status-callback.test.ts requires NEXT_PUBLIC_APP_URL and TWILIO_AUTH_TOKEN in .env.test')
}
const CALLBACK_URL = `${APP_URL}/api/whatsapp/status-callback`

function signTwilioParams(url: string, params: Record<string, string>, authToken: string): string {
  const sortedKeys = Object.keys(params).sort()
  let data = url
  for (const key of sortedKeys) {
    data += key + params[key]
  }
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

function buildCallbackRequest(
  params: Record<string, string>,
  opts: { authToken?: string; signature?: string; omitSignature?: boolean } = {},
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
  if (!opts.omitSignature) {
    headers['X-Twilio-Signature'] =
      opts.signature ?? signTwilioParams(CALLBACK_URL, params, opts.authToken ?? REAL_AUTH_TOKEN!)
  }
  return new NextRequest(CALLBACK_URL, {
    method: 'POST',
    headers,
    body: new URLSearchParams(params).toString(),
  })
}

const LOG_DATE = '2026-09-17'
const LOG_DATE_RETRY = '2026-09-18'
const LOG_DATE_UNRECOGNIZED = '2026-09-19'

async function insertSentRow(engineer: MintedEngineer, eventKey: string, twilioSid: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('outbound_sends')
    .insert({
      tenant_id: OUTBOUND_TEST_TENANT_ID,
      project_id: OUTBOUND_TEST_PROJECT_ID,
      recipient_user_id: engineer.id,
      event_key: eventKey,
      status: 'sent',
      content_sid: MORNING_CHECKIN_SID,
      to_phone_number: engineer.whatsappNumber,
      twilio_sid: twilioSid,
    })
    .select('id')
    .single<{ id: string }>()
  if (error) throw new Error(`insertSentRow failed: ${error.message}`)
  return data.id
}

async function readRow(id: string) {
  const db = testClient()
  const { data, error } = await db.from('outbound_sends').select('*').eq('id', id).single()
  if (error) throw new Error(`readRow failed: ${error.message}`)
  return data
}

describe('handleStatusCallbackPost', () => {
  let engineer: MintedEngineer

  beforeAll(async () => {
    await ensureOutboundParentFixtures()
    engineer = await mintOutboundEngineer()
  })

  afterAll(cleanupOutboundSends)

  describe('signature validation', () => {
    it('a valid signature against the env-derived allowlisted origin is accepted', async () => {
      const params = { MessageSid: `SM_sig_ok_${Date.now()}`, MessageStatus: 'delivered' }
      const res = await handleStatusCallbackPost(buildCallbackRequest(params), { supabaseClient: testClient() })
      expect(res.status).toBe(200)
    })

    it('a non-matching signature is rejected with 403', async () => {
      const params = { MessageSid: `SM_sig_bad_${Date.now()}`, MessageStatus: 'delivered' }
      const forged = signTwilioParams(CALLBACK_URL, params, 'wrong-auth-token')
      const res = await handleStatusCallbackPost(buildCallbackRequest(params, { signature: forged }), {
        supabaseClient: testClient(),
      })
      expect(res.status).toBe(403)
    })

    it('a missing signature header is rejected with 403', async () => {
      const params = { MessageSid: `SM_sig_missing_${Date.now()}`, MessageStatus: 'delivered' }
      const res = await handleStatusCallbackPost(buildCallbackRequest(params, { omitSignature: true }), {
        supabaseClient: testClient(),
      })
      expect(res.status).toBe(403)
    })
  })

  describe('status mapping', () => {
    it('a "delivered" status is a no-op -- the ledger row is left exactly as it was', async () => {
      const eventKey = `morning_send:${LOG_DATE}`
      const twilioSid = `SM_delivered_${Date.now()}`
      const id = await insertSentRow(engineer, eventKey, twilioSid)

      const res = await handleStatusCallbackPost(
        buildCallbackRequest({ MessageSid: twilioSid, MessageStatus: 'delivered' }),
        { supabaseClient: testClient() },
      )
      expect(res.status).toBe(200)

      const row = await readRow(id)
      expect(row.status).toBe('sent') // unchanged -- 031's own status column has no 'delivered' state
      expect(row.error).toBeNull()
    })

    it('an "undelivered" status flips a \'sent\' row to \'failed\' and records the detail', async () => {
      const eventKey = `evening_send:${LOG_DATE}`
      const twilioSid = `SM_undelivered_${Date.now()}`
      const id = await insertSentRow(engineer, eventKey, twilioSid)

      const res = await handleStatusCallbackPost(
        buildCallbackRequest({
          MessageSid: twilioSid,
          MessageStatus: 'undelivered',
          ErrorCode: '63016',
          ChannelStatusMessage: 'Message failed to reach the recipient',
        }),
        { supabaseClient: testClient() },
      )
      expect(res.status).toBe(200)

      const row = await readRow(id)
      expect(row.status).toBe('failed')
      expect(row.error).toContain('undelivered')
      expect(row.error).toContain('Message failed to reach the recipient')
    })

    it('idempotent: a retried identical "failed" callback for an already-failed row is a safe no-op, not an error', async () => {
      const eventKey = `morning_send:${LOG_DATE_RETRY}`
      const twilioSid = `SM_failed_retry_${Date.now()}`
      const id = await insertSentRow(engineer, eventKey, twilioSid)

      const params = { MessageSid: twilioSid, MessageStatus: 'failed', ErrorCode: '30003' }
      const first = await handleStatusCallbackPost(buildCallbackRequest(params), { supabaseClient: testClient() })
      expect(first.status).toBe(200)
      const afterFirst = await readRow(id)
      expect(afterFirst.status).toBe('failed')

      // Retry -- the conditional UPDATE's own `.eq('status', 'sent')` guard
      // now matches zero rows (already 'failed'), same CAS-style shape as
      // trigger.ts's own re-claim UPDATE.
      const second = await handleStatusCallbackPost(buildCallbackRequest(params), { supabaseClient: testClient() })
      expect(second.status).toBe(200)
      const afterSecond = await readRow(id)
      expect(afterSecond.status).toBe('failed')
      expect(afterSecond.error).toBe(afterFirst.error) // not overwritten a second time
    })

    it('a MessageSid with no matching outbound_sends row is a safe 200, not a 500 or a thrown error', async () => {
      const res = await handleStatusCallbackPost(
        buildCallbackRequest({ MessageSid: `SM_no_match_${Date.now()}`, MessageStatus: 'failed', ErrorCode: '30003' }),
        { supabaseClient: testClient() },
      )
      expect(res.status).toBe(200)
    })

    it('an unrecognized MessageStatus value is a safe 200 no-op, never a 4xx/5xx that would make Twilio retry forever', async () => {
      const eventKey = `morning_send:${LOG_DATE_UNRECOGNIZED}`
      const twilioSid = `SM_unrecognized_${Date.now()}`
      const id = await insertSentRow(engineer, eventKey, twilioSid)

      const res = await handleStatusCallbackPost(
        buildCallbackRequest({ MessageSid: twilioSid, MessageStatus: 'some_future_twilio_status' }),
        { supabaseClient: testClient() },
      )
      expect(res.status).toBe(200)

      const row = await readRow(id)
      expect(row.status).toBe('sent') // untouched
    })
  })

  describe('malformed requests', () => {
    it('missing MessageSid or MessageStatus is rejected with 400', async () => {
      const params = { MessageStatus: 'delivered' } // no MessageSid
      const res = await handleStatusCallbackPost(buildCallbackRequest(params), { supabaseClient: testClient() })
      expect(res.status).toBe(400)
    })
  })
})
