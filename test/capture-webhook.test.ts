// PR-C C4b: the webhook PDF gate, through handleWebhookPost (real signature check, real gate lookup, real router, real
// test-db). Plan: /tmp/quoco/c4-plan.md item 6; docs/plans/pr-c-plan.md Rev 4.
//
// Why a separate file: test/webhook.test.ts must stay unedited, and its signer is file-local. T-WH-17/18/21/22/25 there
// keep proving the "everything outside an 'invoice' session is byte-identical" half; this file proves the new half plus
// the exact Sentry event.
//
// The webhook has no `now` injection, so sessions are seeded relative to the REAL clock (one-minute-old rows, same IST
// day except for the deliberately expired one). A run that straddles IST midnight could flake T-PDF-GATE-1 only.
//
// ENGINEER: buildCaptureKit's 'eng' (active, one P1 membership) gets users.whatsapp_number = a run-scoped kit phone so the
// webhook gate (RT:130-159) and resolveEngineerProject accept it. teardownCaptureKit removes every capture row, job
// (capture_ingest), session, processed_messages row (SIDs are kit.sid(...)), user and tenant this file writes; media_ingest
// jobs are removed by this file's own afterEach/afterAll.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import crypto from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'

const { captureMessage, captureException } = vi.hoisted(() => ({
  captureMessage: vi.fn<(message: string, options?: Record<string, unknown>) => string>(() => 'mock-event-id'),
  captureException: vi.fn<(error: unknown, options?: Record<string, unknown>) => string>(() => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }))

import { handleWebhookPost } from '@/app/api/whatsapp/webhook/route'
import { UNSUPPORTED_MEDIA_REPLY } from '@/lib/whatsapp/media-reply'
import {
  MI_ACK_QUESTION_DC,
  MI_CAPTURE_FAILED_REPLY,
  MI_FILE_RECEIVED,
  MI_SESSION_ENDED_REPLY,
} from '@/lib/whatsapp/flows/material-inward-strings'
import { buildCaptureKit, getSession, seedSession, teardownCaptureKit, type CaptureKit } from './helpers/capture-fixtures'

const APP_URL = process.env.NEXT_PUBLIC_APP_URL
const AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN
if (!APP_URL || !AUTH_TOKEN) throw new Error('capture-webhook.test.ts requires NEXT_PUBLIC_APP_URL and TWILIO_AUTH_TOKEN in .env.test')
const WEBHOOK_URL = `${APP_URL}/api/whatsapp/webhook`

// Independent copy of Twilio's documented signing algorithm (same as test/webhook.test.ts:73-80).
function sign(url: string, params: Record<string, string>, authToken: string): string {
  let data = url
  for (const key of Object.keys(params).sort()) data += key + params[key]
  return crypto.createHmac('sha1', authToken).update(Buffer.from(data, 'utf-8')).digest('base64')
}

function request(params: Record<string, string>): NextRequest {
  return new NextRequest(WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'X-Twilio-Signature': sign(WEBHOOK_URL, params, AUTH_TOKEN!) },
    body: new URLSearchParams(params).toString(),
  })
}

function unescapeXml(t: string): string {
  return t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&')
}

let kit: CaptureKit
let enginePhone: string
let sidN = 0

beforeAll(async () => {
  delete process.env.CAPTURE_DIGIT4_TEST_PHONES
  kit = await buildCaptureKit('c4b-webhook', ['eng'])
  enginePhone = kit.phone('wh-eng')
  const { error } = await kit.svc.from('users').update({ whatsapp_number: enginePhone }).eq('id', kit.uid('eng'))
  if (error) throw new Error(`could not give the kit engineer a whatsapp_number: ${error.message}`)
})

afterAll(async () => {
  if (!kit) return
  await kit.svc.from('jobs').delete().eq('type', 'media_ingest').contains('payload', { tenant_id: kit.tenantA })
  await teardownCaptureKit(kit)
})

beforeEach(() => {
  captureMessage.mockClear()
  captureException.mockClear()
})

afterEach(async () => {
  await kit.svc.from('whatsapp_sessions').delete().eq('phone_number', enginePhone)
  await kit.svc.from('jobs').delete().eq('type', 'media_ingest').contains('payload', { tenant_id: kit.tenantA })
})

interface Posted {
  status: number
  text: string | null
  sid: string
}

async function post(
  media: Array<{ type: string | undefined; url?: string }>,
  o: { body?: string; client?: SupabaseClient; sid?: string } = {},
): Promise<Posted> {
  const sid = o.sid ?? kit.sid(`c4b-wh-${++sidN}`)
  const params: Record<string, string> = {
    From: `whatsapp:${enginePhone}`,
    Body: o.body ?? '',
    NumMedia: String(media.length),
    MessageSid: sid,
  }
  media.forEach((m, i) => {
    if (m.type !== undefined) params[`MediaContentType${i}`] = m.type
    params[`MediaUrl${i}`] = m.url ?? `https://example.invalid/m/${sid}/${i}`
  })
  const res = await handleWebhookPost(request(params), { supabaseClient: o.client ?? kit.svc })
  const xml = await res.text()
  const m = xml.match(/<Message>([\s\S]*?)<\/Message>/)
  return { status: res.status, text: m ? unescapeXml(m[1]) : null, sid }
}

const PDF = { type: 'application/pdf' }
const JPEG = { type: 'image/jpeg' }

async function count(table: string, filter: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count: c, error } = await filter(kit.svc.from(table).select('id', { count: 'exact', head: true }))
  if (error) throw new Error(`count(${table}) failed: ${error.message}`)
  return c ?? 0
}
const docs = () => count('capture_documents', (q) => q.eq('tenant_id', kit.tenantA))
const files = () => count('capture_files', (q) => q.eq('tenant_id', kit.tenantA))
const pendingFiles = () => count('capture_files', (q) => q.eq('tenant_id', kit.tenantA).eq('ingest_status', 'pending'))
const ingestJobs = () => count('jobs', (q) => q.eq('type', 'capture_ingest').contains('payload', { tenant_id: kit.tenantA }))
const mediaJobs = () => count('jobs', (q) => q.eq('type', 'media_ingest').contains('payload', { tenant_id: kit.tenantA }))

const MIN = 60 * 1000
const ago = (m: number) => new Date(Date.now() - m * MIN)
const ahead = (m: number) => new Date(Date.now() + m * MIN)

async function seed(flow: string, step: number, context: Record<string, unknown>, o: { updatedAt?: Date; expiresAt?: Date } = {}) {
  await seedSession(kit, enginePhone, { flow, step, context, updatedAt: o.updatedAt ?? ago(1), expiresAt: o.expiresAt ?? ahead(29) })
}

function rpcSpy(stub?: (name: string) => { data: unknown; error: unknown } | undefined, fromHook?: (table: string) => unknown) {
  const calls: string[] = []
  const client = new Proxy(kit.svc, {
    get(target, prop, receiver) {
      if (prop === 'rpc') {
        return (name: string, args?: Record<string, unknown>) => {
          calls.push(name)
          const s = stub?.(name)
          if (s !== undefined) return Promise.resolve(s)
          return (target.rpc as (n: string, a?: Record<string, unknown>) => unknown)(name, args)
        }
      }
      if (prop === 'from' && fromHook) {
        return (table: string) => {
          const h = fromHook(table)
          return h !== undefined ? h : target.from(table)
        }
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  }) as SupabaseClient
  return { client, calls }
}

// ---------------------------------------------------------------------------

describe('T-PDF-GATE-1: a PDF inside a live invoice session is accepted', () => {
  it('a PDF at step 2: ack question; +1 document, +1 pending file, +1 capture_ingest job; no unsupported reply', async () => {
    await seed('invoice', 2, { mi_kind: 'dc', mi_reask: 0 })
    const [d0, f0, p0, j0] = [await docs(), await files(), await pendingFiles(), await ingestJobs()]
    const r = await post([PDF])
    expect(r.status).toBe(200)
    expect(r.text).toBe([MI_FILE_RECEIVED(1), MI_ACK_QUESTION_DC].join('\n'))
    expect(r.text).not.toBe(UNSUPPORTED_MEDIA_REPLY)
    expect(await docs()).toBe(d0 + 1)
    expect(await files()).toBe(f0 + 1)
    expect(await pendingFiles()).toBe(p0 + 1)
    expect(await ingestJobs()).toBe(j0 + 1)
    expect((await getSession(kit, enginePhone))!.current_step).toBe(3)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('jpeg + pdf in one message: one document, two files', async () => {
    await seed('invoice', 2, { mi_kind: 'dc', mi_reask: 0 })
    const [d0, f0, j0] = [await docs(), await files(), await ingestJobs()]
    const r = await post([JPEG, PDF])
    expect(r.text).toBe([MI_FILE_RECEIVED(2), MI_ACK_QUESTION_DC].join('\n'))
    expect(await docs()).toBe(d0 + 1)
    expect(await files()).toBe(f0 + 2)
    expect(await ingestJobs()).toBe(j0 + 1)
  })
})

// ---------------------------------------------------------------------------

describe('T-PDF-GATE-2: outside an invoice session a PDF gets today\'s reply and today\'s event, nothing else', () => {
  const cases: Array<[string, Array<{ type: string }>, (() => Promise<void>) | null]> = [
    ['PDF at idle (no session)', [PDF], null],
    ['PDF mid-morning (active morning session)', [PDF], () => seed('morning', 2, {})],
    ['jpeg + pdf at idle', [JPEG, PDF], null],
    ["PDF with a live 'safety' row", [PDF], () => seed('safety', 1, {})],
    ['PDF with the S-3 guard set', [PDF], () => seed('morning', 1, { invoice_reset_guard: 'morning' })],
    ['PDF with a caption at idle', [PDF], null],
  ]
  it.each(cases)('%s', async (label, media, setup) => {
    if (setup) await setup()
    const before = await getSession(kit, enginePhone)
    const [d0, f0, i0, m0] = [await docs(), await files(), await ingestJobs(), await mediaJobs()]
    const r = await post(media, { body: label.includes('caption') ? 'morning plan: pour slab' : '' })
    expect(r.status).toBe(200)
    expect(r.text).toBe(UNSUPPORTED_MEDIA_REPLY)
    // exactly today's event (RT unsupportedMediaResponse), and nothing else -- in particular no 'safety' warning
    expect(captureMessage.mock.calls).toEqual([
      [
        'Unsupported inbound media',
        {
          level: 'warning',
          fingerprint: ['inbound-media', 'unsupported'],
          tags: { feature: 'inbound-media' },
          extra: { contentTypes: media.map((m) => m.type), numMedia: media.length },
        },
      ],
    ])
    expect(captureException).not.toHaveBeenCalled()
    expect(await getSession(kit, enginePhone)).toEqual(before)
    expect([await docs(), await files(), await ingestJobs(), await mediaJobs()]).toEqual([d0, f0, i0, m0])
  })
})

// ---------------------------------------------------------------------------

describe('T-D1-4 (PDF half)', () => {
  it('a PDF as the first message after expiry: the ended reply, nothing stored, no nudge, one counts-only event', async () => {
    await seed('invoice', 3, { mi_kind: 'dc', mi_document_id: crypto.randomUUID(), mi_last_sid: 'sid-y', mi_reask: 0 }, { updatedAt: ago(31), expiresAt: ago(1) })
    const [d0, f0, i0, m0] = [await docs(), await files(), await ingestJobs(), await mediaJobs()]
    const { client, calls } = rpcSpy()
    const r = await post([PDF], { client })
    expect(r.status).toBe(200)
    expect(r.text).toBe(MI_SESSION_ENDED_REPLY)
    expect([await docs(), await files(), await ingestJobs(), await mediaJobs()]).toEqual([d0, f0, i0, m0])
    expect(calls).not.toContain('claim_media_nudge')
    expect(captureMessage.mock.calls).toEqual([
      [
        'file received after the material-inward session ended',
        {
          level: 'info',
          fingerprint: ['capture-router', 'file_after_session_ended'],
          tags: { feature: 'capture-router' },
          extra: { mediaCount: 1, contentTypes: ['application/pdf'] },
        },
      ],
    ])
    expect((await getSession(kit, enginePhone))!.current_flow).toBeNull()
  })
})

// ---------------------------------------------------------------------------

describe('T-Q9: the router throws on a PDF message', () => {
  it('a failing routing read: UNSUPPORTED_MEDIA_REPLY and the same unsupported event, HTTP 200', async () => {
    const failing = {
      select: () => failing,
      eq: () => failing,
      maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'canceling statement' } }),
    }
    const { client } = rpcSpy(undefined, (table) => (table === 'whatsapp_sessions' ? failing : undefined))
    const r = await post([PDF], { client })
    expect(r.status).toBe(200)
    expect(r.text).toBe(UNSUPPORTED_MEDIA_REPLY)
    expect(captureMessage.mock.calls).toEqual([
      [
        'Unsupported inbound media',
        {
          level: 'warning',
          fingerprint: ['inbound-media', 'unsupported'],
          tags: { feature: 'inbound-media' },
          extra: { contentTypes: ['application/pdf'], numMedia: 1 },
        },
      ],
    ])
  })
})

// ---------------------------------------------------------------------------

describe('T-SF-1 (webhook half)', () => {
  it('a failing RPC on a PDF: HTTP 200, MI_CAPTURE_FAILED_REPLY, SID row present; a resend with a NEW SID creates exactly one document', async () => {
    await seed('invoice', 2, { mi_kind: 'dc', mi_reask: 0 })
    const d0 = await docs()
    const failRpc = (name: string) =>
      name === 'apply_material_inward_turn'
        ? { data: null, error: { code: 'XX000', message: 'boom +919876543210 https://example.invalid/m/0', details: '', hint: '', name: 'PostgrestError' } }
        : undefined
    const failed = await post([PDF], { client: rpcSpy(failRpc).client })
    expect(failed.status).toBe(200)
    expect(failed.text).toBe(MI_CAPTURE_FAILED_REPLY)
    const { data: sidRow } = await kit.svc.from('processed_messages').select('message_sid').eq('message_sid', failed.sid).maybeSingle()
    expect(sidRow).not.toBeNull()
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = captureMessage.mock.calls[0] as [string, { fingerprint: string[]; extra: Record<string, unknown> }]
    expect(opts.fingerprint).toEqual(['capture-inbound', 'rpc_failed'])
    expect(opts.extra).toEqual({ mediaCount: 1, contentTypes: ['application/pdf'], errorCode: 'XX000' })
    expect(JSON.stringify(captureMessage.mock.calls)).not.toMatch(/9876543210|example\.invalid|boom/)
    expect(await docs()).toBe(d0)

    // the engineer resends: a NEW SID on the real client
    const resend = await post([PDF])
    expect(resend.text).toBe([MI_FILE_RECEIVED(1), MI_ACK_QUESTION_DC].join('\n'))
    expect(await docs()).toBe(d0 + 1)
  })
})
