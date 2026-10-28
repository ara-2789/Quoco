// PR-C C4a: the material-inward handler (lib/whatsapp/flows/material-inward.ts) through routeInboundMessage, DARK.
// Plan: docs/plans/pr-c-plan.md section 3a, 3f step 5, 7, 8 (row C4); docs/plans/pr-c-plan.md rev 4.
//
// Real test-db, explicit clock on every call (noonIst() + seconds, never the wall clock). The capture kit mints
// run-scoped tenants / users / phones / SIDs. Capture rows are not deletable by service_role; teardownCaptureKit removes
// them through quoco_test_capture_cleanup (fixture-tenant-guarded), so this file leaves no permanent rows when teardown
// succeeds (it throws if it does not).
//
// RACE PATHS: T-A27-6a / 6b stub the router's expire result to make the handler's RPC see 'expired' / 'idle'. That
// proves the handler's MAPPING deterministically. A genuine interleaving (a late turn landing between the router's
// read and the RPC's lock) is CI-only, "not verified locally".
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'

const { captureMessage, captureException } = vi.hoisted(() => ({
  captureMessage: vi.fn((_m: string, _o?: Record<string, unknown>) => 'mock-event-id'),
  captureException: vi.fn((_e: unknown, _o?: Record<string, unknown>) => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }))

import { routeInboundMessage, buildIdleMenu, buildIdleReply, computeIdleHeaderState, type IdleHeaderState } from '@/lib/whatsapp/inbound-start'
import { handleMaterialInwardTurn } from '@/lib/whatsapp/flows/material-inward'
import { MORNING_QUESTIONS } from '@/lib/whatsapp/flows/morning'
import { EVENING_QUESTIONS } from '@/lib/whatsapp/flows/evening'
import * as strings from '@/lib/whatsapp/flows/material-inward-strings'
import { istParts } from '@/lib/daily-logs/status'
import {
  buildCaptureKit,
  getSession,
  miTurn,
  miTurnRaw,
  noonIst,
  seedSession,
  teardownCaptureKit,
  type CaptureKit,
} from './helpers/capture-fixtures'

let kit: CaptureKit

beforeAll(async () => {
  delete process.env.CAPTURE_DIGIT4_TEST_PHONES
  kit = await buildCaptureKit('c4a-handler', ['eng'])
})

afterAll(async () => {
  if (!kit) return
  await teardownCaptureKit(kit)
})

beforeEach(() => {
  captureMessage.mockClear()
  captureException.mockClear()
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MIN = 60 * 1000
let sidN = 0
let tickN = 0
/** A strictly increasing instant on today's fixed IST noon (never crosses midnight in a test). */
const tick = () => new Date(noonIst().getTime() + ++tickN * 1000)

interface RpcCall {
  name: string
  args: Record<string, unknown>
}
type RpcStub = (name: string, args: Record<string, unknown>) => { data: unknown; error: unknown } | undefined

/** Records every rpc() call; `stub` may answer one instead of the database. Everything else passes through. */
function spyClient(stub?: RpcStub, fromHook?: (table: string) => unknown): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = []
  const client = new Proxy(kit.svc, {
    get(target, prop, receiver) {
      if (prop === 'rpc') {
        return (name: string, args?: Record<string, unknown>) => {
          calls.push({ name, args: args ?? {} })
          const stubbed = stub?.(name, args ?? {})
          if (stubbed !== undefined) return Promise.resolve(stubbed)
          return (target.rpc as (n: string, a?: Record<string, unknown>) => unknown)(name, args)
        }
      }
      if (prop === 'from' && fromHook) {
        return (table: string) => {
          const hooked = fromHook(table)
          return hooked !== undefined ? hooked : target.from(table)
        }
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  }) as SupabaseClient
  return { client, calls }
}

const img = (n: number) => Array.from({ length: n }, (_, i) => ({ url: `https://example.invalid/m/${i}`, contentType: 'image/jpeg' }))

/** A message SID with its processed_messages row (the webhook inserts this before routing). */
async function consumedSid(label: string): Promise<string> {
  const sid = kit.sid(`c4a-${label}-${++sidN}`)
  const { error } = await kit.svc.from('processed_messages').insert({ message_sid: sid })
  if (error) throw new Error(`processed_messages insert failed: ${error.message}`)
  return sid
}

/** One engineer message through the real router. `files` = photos attached. */
async function say(phone: string, message: string, client: SupabaseClient, files = 0, now: Date = tick(), sid?: string) {
  return routeInboundMessage({
    phoneNumber: phone,
    tenantId: kit.tenantA,
    userId: kit.uid('eng'),
    projectId: kit.p1,
    message,
    now: now.toISOString(),
    messageSid: sid ?? (await consumedSid('say')),
    supabaseClient: client,
    ...(files > 0 ? { isPhoto: true, media: img(files) } : {}),
  })
}

/** Start a session through the RPC directly (the digit-4 router branch is covered in capture-router.test.ts). */
async function startSession(label: string): Promise<string> {
  const phone = kit.phone(label)
  await miTurn(kit, phone, '4', kit.sid(`c4a-start-${label}`), { start: true, now: tick() })
  return phone
}

async function count(table: string, filter: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count: c, error } = await filter(kit.svc.from(table).select('id', { count: 'exact', head: true }))
  if (error) throw new Error(`count(${table}) failed: ${error.message}`)
  return c ?? 0
}
const docCount = () => count('capture_documents', (q) => q.eq('tenant_id', kit.tenantA))
const fileCount = () => count('capture_files', (q) => q.eq('tenant_id', kit.tenantA))

function sentryText(): string {
  return JSON.stringify([captureMessage.mock.calls, captureException.mock.calls], (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  )
}

// ---------------------------------------------------------------------------
// T-STR: the approved strings
// ---------------------------------------------------------------------------

// Typed here independently from docs/plans/pr-c-plan.md section 7 ("<br>" = LF; U+2705 check mark; U+2014 em dash).
const APPROVED: Record<string, string> = {
  MI_SESSION_ENDED_REPLY: 'That DC or invoice question has ended. Your answer was not recorded. Reply 4 to start again.',
  MI_MENU_LINE: 'You can send a DC or invoice — reply 4.',
  MI_ASK_KIND: 'Is it a DC or an invoice?\nReply 1 for DC\nReply 2 for invoice',
  MI_ASK_FILE_DC: 'Send one DC. A PDF, or photos of all its pages together.',
  MI_ASK_FILE_INVOICE: 'Send one invoice. A PDF, or photos of all its pages together.',
  MI_ACK_QUESTION_DC:
    'Did the material on this DC arrive?\nReply 1 for all arrived\nReply 2 for not arrived\nReply 3 for part arrived',
  MI_ACK_QUESTION_INVOICE:
    'Does this invoice match the material received at site?\nReply 1 for matches\nReply 2 for does not match\nReply 3 for partly matches',
  MI_ASK_NOTE_NO: 'What is wrong? Describe it in your own words.',
  MI_ASK_NOTE_PARTIAL: 'What is missing or different? Describe it in your own words.',
  MI_ACK_REASK: "Sorry, I didn't catch that.",
  MI_NOT_UNDERSTOOD_CLOSE: '✅ Your reply is recorded as a note. Your Project Manager will see it.',
  MI_DONE: '✅ Done. Your Project Manager will see it. To send another DC or invoice, reply 4.',
  MI_KIND_REASK: "Sorry, I didn't catch that.",
  MI_FILE_REASK: "Sorry, I didn't get a file. Send a PDF, or photos of all its pages.",
  MI_NOTHING_RECORDED_CLOSE: 'Nothing was recorded. To send a DC or invoice, reply 4.',
  MI_UNSUPPORTED_FILE_REPLY: "This file type isn't supported. Nothing was recorded. Send a PDF or a photo instead.",
  MI_IDLE_DOCUMENT_NUDGE: 'File not saved. To send a DC or invoice, reply 4 first.',
  MI_CAPTURE_FAILED_REPLY: "Sorry, I couldn't receive that file. Please send it again.",
  CHECKIN_RESET_EXPLAIN_REPLY: 'Your DC or invoice was stopped for the check-in. Files already received are kept.',
  MI_CHECKIN_PHOTO_NOT_SAVED_REPLY: 'Photo not saved.',
}

describe('T-STR: approved strings, byte for byte', () => {
  it('T-STR-1 every approved constant equals plan section 7 exactly', () => {
    const mod = strings as unknown as Record<string, unknown>
    for (const [name, expected] of Object.entries(APPROVED)) {
      expect(mod[name], name).toBe(expected)
    }
    // row 6 is one function with the two approved texts
    expect(strings.MI_FILE_RECEIVED(1)).toBe('✅ 1 file received.')
    expect(strings.MI_FILE_RECEIVED(2)).toBe('✅ 2 files received.')
    expect(strings.MI_FILE_RECEIVED(10)).toBe('✅ 10 files received.')
  })

  it('T-STR-2 the module exports exactly the approved MI_* / CHECKIN_* names (21 rows) and nothing else', () => {
    const exported = Object.keys(strings).filter((k) => /^(MI_|CHECKIN_)/.test(k)).sort()
    expect(exported).toEqual([...Object.keys(APPROVED), 'MI_FILE_RECEIVED'].sort())
    expect(exported).toHaveLength(21)
  })

  it('menu: buildIdleMenu / buildIdleReply never contain MI_MENU_LINE (the idle menu is untouched until C6)', () => {
    const states: IdleHeaderState[] = ['awaiting_morning', 'morning_closed', 'site_holiday', 'complete', 'none']
    for (const state of states) {
      expect(buildIdleMenu(state)).not.toContain(strings.MI_MENU_LINE)
      expect(buildIdleMenu(state)).not.toMatch(/reply 4/i)
      expect(buildIdleReply('item_reserved', state)).not.toContain(strings.MI_MENU_LINE)
    }
    const t = tick()
    const header = computeIdleHeaderState({ morningSubmitted: false, eveningSubmitted: false, attendance: null, istMinutes: istParts(t).minutes })
    expect(buildIdleMenu(header)).not.toContain(strings.MI_MENU_LINE)
  })
})

// ---------------------------------------------------------------------------
// outcome -> reply map, through the router
// ---------------------------------------------------------------------------

describe('outcome map (real RPC, real router)', () => {
  it('DC conversation: kind re-ask, kind, file re-ask, 2 photos, 1 more photo, ack re-ask, unclear close', async () => {
    const phone = await startSession('map-dc')
    const { client } = spyClient()
    const docs0 = await docCount()
    const files0 = await fileCount()

    expect((await say(phone, 'hello', client)).reply).toBe([strings.MI_KIND_REASK, strings.MI_ASK_KIND].join('\n'))
    expect((await say(phone, '1', client)).reply).toBe(strings.MI_ASK_FILE_DC)
    expect((await say(phone, 'no file here', client)).reply).toBe(strings.MI_FILE_REASK)

    const two = await say(phone, '', client, 2)
    expect(two.reply).toBe([strings.MI_FILE_RECEIVED(2), strings.MI_ACK_QUESTION_DC].join('\n'))
    expect(two.resolvedFlow).toBe('invoice')
    expect(await docCount()).toBe(docs0 + 1)
    expect(await fileCount()).toBe(files0 + 2)

    // further file at step 3: file line + the same prompt again (decision Q4)
    const more = await say(phone, '', client, 1)
    expect(more.reply).toBe([strings.MI_FILE_RECEIVED(1), strings.MI_ACK_QUESTION_DC].join('\n'))
    expect(await docCount()).toBe(docs0 + 1)
    expect(await fileCount()).toBe(files0 + 3)

    expect((await say(phone, 'x', client)).reply).toBe([strings.MI_ACK_REASK, strings.MI_ACK_QUESTION_DC].join('\n'))
    expect((await say(phone, 'y', client)).reply).toBe(strings.MI_NOT_UNDERSTOOD_CLOSE)
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
  })

  it('invoice conversation: kind 2, one photo, ack 2 -> "what is wrong", a photo at the note step, the note -> done', async () => {
    const phone = await startSession('map-inv')
    const { client } = spyClient()
    expect((await say(phone, '2', client)).reply).toBe(strings.MI_ASK_FILE_INVOICE)
    expect((await say(phone, '', client, 1)).reply).toBe([strings.MI_FILE_RECEIVED(1), strings.MI_ACK_QUESTION_INVOICE].join('\n'))
    expect((await say(phone, '2', client)).reply).toBe(strings.MI_ASK_NOTE_NO)
    // file at step 4: file line + the note prompt again
    expect((await say(phone, '', client, 1)).reply).toBe([strings.MI_FILE_RECEIVED(1), strings.MI_ASK_NOTE_NO].join('\n'))
    expect((await say(phone, 'the invoice shows 40 bags', client)).reply).toBe(strings.MI_DONE)
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
  })

  it('ack 3 -> "what is missing", note -> done; ack 1 -> done', async () => {
    const partial = await startSession('map-partial')
    const { client } = spyClient()
    await say(partial, '1', client)
    await say(partial, '', client, 1)
    expect((await say(partial, '3', client)).reply).toBe(strings.MI_ASK_NOTE_PARTIAL)
    expect((await say(partial, 'short by ten', client)).reply).toBe(strings.MI_DONE)

    const yes = await startSession('map-yes')
    await say(yes, '1', client)
    await say(yes, '', client, 1)
    expect((await say(yes, '1', client)).reply).toBe(strings.MI_DONE)
  })

  it('two misses at step 1 close the flow with nothing recorded', async () => {
    const phone = await startSession('map-closed')
    const { client } = spyClient()
    const docs0 = await docCount()
    expect((await say(phone, 'a', client)).reply).toBe([strings.MI_KIND_REASK, strings.MI_ASK_KIND].join('\n'))
    expect((await say(phone, 'b', client)).reply).toBe(strings.MI_NOTHING_RECORDED_CLOSE)
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
    expect(await docCount()).toBe(docs0)
  })

  it('a replayed SID is a no-op: empty reply, no second reply', async () => {
    const phone = await startSession('map-dup')
    const { client } = spyClient()
    const sid = await consumedSid('dup')
    const first = await say(phone, 'hello', client, 0, tick(), sid)
    expect(first.reply).toBe([strings.MI_KIND_REASK, strings.MI_ASK_KIND].join('\n'))
    const second = await say(phone, 'hello', client, 0, tick(), sid)
    expect(second.reply).toBe('')
  })

  it('files present but none usable: MI_UNSUPPORTED_FILE_REPLY, the RPC is not called', async () => {
    const phone = await startSession('map-nofile')
    await miTurn(kit, phone, '1', kit.sid('c4a-nofile-kind'), { now: tick() })
    const { client, calls } = spyClient()
    const r = await routeInboundMessage({
      phoneNumber: phone,
      tenantId: kit.tenantA,
      userId: kit.uid('eng'),
      projectId: kit.p1,
      message: 'caption',
      now: tick().toISOString(),
      messageSid: await consumedSid('nofile'),
      supabaseClient: client,
      isPhoto: true,
      media: [],
    })
    expect(r.reply).toBe(strings.MI_UNSUPPORTED_FILE_REPLY)
    expect(calls.map((c) => c.name)).not.toContain('apply_material_inward_turn')
  })

  it('wrong_flow (a check-in took over between the router and the RPC): explanation + the current check-in question', async () => {
    const t = tick()
    const base = { tenantId: kit.tenantA, userId: kit.uid('eng'), projectId: kit.p1, message: 'hello', isPhoto: false, media: [], now: t.toISOString(), expiresAt: null }
    for (const [flow, step, questions] of [
      ['morning', 1, MORNING_QUESTIONS],
      ['evening', 2, EVENING_QUESTIONS],
    ] as const) {
      const phone = kit.phone(`map-wf-${flow}`)
      await seedSession(kit, phone, { flow, step, context: {}, updatedAt: new Date(t.getTime() - MIN), expiresAt: new Date(t.getTime() + 29 * MIN) })
      const r = await handleMaterialInwardTurn({ ...base, phoneNumber: phone, messageSid: await consumedSid(`wf-${flow}`) }, kit.svc)
      expect(r.reply).toBe([strings.CHECKIN_RESET_EXPLAIN_REPLY, questions[step]].join('\n'))
      // the check-in session is untouched
      expect((await getSession(kit, phone))!.current_flow).toBe(flow)
    }
  })

  it('wrong_flow with a current_flow that is not morning/evening throws, with no phone or id in the text, and is not an S-F event', async () => {
    const t = tick()
    const phone = kit.phone('map-wf-hindrance')
    await seedSession(kit, phone, { flow: 'hindrance', step: 1, context: {}, updatedAt: new Date(t.getTime() - MIN), expiresAt: new Date(t.getTime() + 29 * MIN) })
    for (const files of [0, 1]) {
      const err = await handleMaterialInwardTurn(
        {
          phoneNumber: phone,
          tenantId: kit.tenantA,
          userId: kit.uid('eng'),
          projectId: kit.p1,
          message: 'hello',
          messageSid: await consumedSid('wf-h'),
          isPhoto: files > 0,
          media: img(files),
          now: t.toISOString(),
          expiresAt: null,
        },
        kit.svc,
      ).then(
        () => null,
        (e: unknown) => e as Error,
      )
      expect(err).toBeInstanceOf(Error)
      for (const needle of [phone, phone.replace('+', ''), kit.tenantA, kit.uid('eng')]) expect(err!.message).not.toContain(needle)
    }
    expect(captureMessage).not.toHaveBeenCalled() // thrown OUTSIDE the S-F catch, even for a file turn
  })
})

// ---------------------------------------------------------------------------
// S-F-1 (router half; the webhook HTTP-200 half arrives with C4b's capture-webhook test)
// ---------------------------------------------------------------------------

describe('S-F-1: record and alert on a failed file turn', () => {
  const FAILING_MESSAGE = 'boom +919876543210 https://example.invalid/m/0 secret body text'
  const failRpc = (code: string): RpcStub => (name) =>
    name === 'apply_material_inward_turn' ? { data: null, error: { code, message: FAILING_MESSAGE, details: '', hint: '', name: 'PostgrestError' } } : undefined

  async function atStep2(label: string): Promise<string> {
    const phone = await startSession(label)
    await miTurn(kit, phone, '1', kit.sid(`c4a-${label}-kind`), { now: tick() })
    return phone
  }

  it('T-SF-1 a failing RPC on a photo: MI_CAPTURE_FAILED_REPLY, one counts-only Sentry error, no phone/URL/body/ids anywhere', async () => {
    const phone = await atStep2('sf-1')
    const { client } = spyClient(failRpc('XX000'))
    const r = await say(phone, 'secret body text', client, 1)
    expect(r.reply).toBe(strings.MI_CAPTURE_FAILED_REPLY)
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = captureMessage.mock.calls[0] as [string, { level: string; fingerprint: string[]; extra: Record<string, unknown> }]
    expect(opts.level).toBe('error')
    expect(opts.fingerprint).toEqual(['capture-inbound', 'rpc_failed'])
    expect(opts.extra).toEqual({ mediaCount: 1, contentTypes: ['image/jpeg'], errorCode: 'XX000' })
    expect(captureException).not.toHaveBeenCalled()
    const text = sentryText()
    for (const needle of [phone, phone.replace('+', ''), '9876543210', 'example.invalid', 'secret body text', 'boom', kit.tenantA, kit.uid('eng')]) {
      expect(text).not.toContain(needle)
    }
    // nothing was recorded, and the session is still at step 2
    expect((await getSession(kit, phone))!.current_step).toBe(2)
  })

  it('T-SF-1b errorCode is error.code only when it is exactly five upper-case letters/digits, else "unknown"', async () => {
    const phone = await atStep2('sf-1b')
    for (const [code, expected] of [
      ['QE012', 'QE012'],
      ['22P02', '22P02'],
      ['PGRST301', 'unknown'],
      ['qe012', 'unknown'],
      ['', 'unknown'],
    ] as const) {
      captureMessage.mockClear()
      await say(phone, '', spyClient(failRpc(code)).client, 1)
      const [, opts] = captureMessage.mock.calls[0] as [string, { extra: { errorCode: string } }]
      expect(opts.extra.errorCode).toBe(expected)
    }
  })

  it('T-SF-1c a failing post-RPC read (after the RPC committed) is inside the same catch', async () => {
    const phone = await atStep2('sf-1c')
    let sessionReads = 0
    const failingChain = {
      select: () => failingChain,
      eq: () => failingChain,
      maybeSingle: async () => ({ data: null, error: { code: '57014', message: 'canceling statement' } }),
    }
    // read 1 is the router's routing read; read 2 is the handler's kind read
    const { client } = spyClient(undefined, (table) => (table === 'whatsapp_sessions' && ++sessionReads === 2 ? failingChain : undefined))
    const docs0 = await docCount()
    const r = await say(phone, '', client, 1)
    expect(r.reply).toBe(strings.MI_CAPTURE_FAILED_REPLY)
    expect(await docCount()).toBe(docs0 + 1) // the RPC had committed: documented consequence of wrapping the reads (Q8)
    const [, opts] = captureMessage.mock.calls[0] as [string, { extra: Record<string, unknown> }]
    expect(opts.extra).toEqual({ mediaCount: 1, contentTypes: ['image/jpeg'], errorCode: '57014' })
  })

  it('T-SF-1d a failing RPC on a TEXT turn propagates (Q6b): no S-F event, and the thrown text carries no phone, ids or provider message', async () => {
    const phone = await atStep2('sf-1d')
    const { client } = spyClient(failRpc('XX000'))
    const err = await say(phone, 'hello', client).then(
      () => null,
      (e: unknown) => e as Error,
    )
    expect(err).toBeInstanceOf(Error)
    expect(err!.message).toBe('apply_material_inward_turn failed (code XX000)')
    for (const needle of [phone, phone.replace('+', ''), '9876543210', 'boom', kit.tenantA, kit.uid('eng')]) expect(err!.message).not.toContain(needle)
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('T-SF-2 ordering: the webhook consumes the SID before routing, and the RPC still refuses a file turn with no SID row (QE012)', async () => {
    const src = readFileSync(resolve(__dirname, '../app/api/whatsapp/webhook/route.ts'), 'utf8')
    const consumed = src.indexOf('await isNewMessage(messageSid')
    const routed = src.indexOf('await routeInboundMessage(')
    expect(consumed).toBeGreaterThan(-1)
    expect(routed).toBeGreaterThan(consumed)
    expect(src).toMatch(/routeInboundMessage\(\{[\s\S]*?messageSid,/)

    const phone = await atStep2('sf-2')
    const refused = await miTurnRaw(kit, phone, null, kit.sid('c4a-sf-2-nosid'), {
      skipProcessed: true,
      now: tick(),
      media: [{ index: 0, content_type: 'image/jpeg', url: 'https://example.invalid/m/0' }],
    })
    expect(refused.error?.code).toBe('QE012')
    // CONTROL: the same call with the SID row present is accepted
    const accepted = await miTurnRaw(kit, phone, null, kit.sid('c4a-sf-2-sid'), {
      now: tick(),
      media: [{ index: 0, content_type: 'image/jpeg', url: 'https://example.invalid/m/0' }],
    })
    expect(accepted.error).toBeNull()
  })

  it('T-SF-3 a QE012 refusal on a photo through the router is an S-F event and the failure reply, not a swallowed network error', async () => {
    const phone = await atStep2('sf-3')
    const { client } = spyClient()
    const docs0 = await docCount()
    // a SID with NO processed_messages row (the webhook always inserts one; this is the bug signal)
    const r = await say(phone, '', client, 1, tick(), kit.sid('c4a-sf-3-orphan'))
    expect(r.reply).toBe(strings.MI_CAPTURE_FAILED_REPLY)
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = captureMessage.mock.calls[0] as [string, { fingerprint: string[]; extra: Record<string, unknown> }]
    expect(opts.fingerprint).toEqual(['capture-inbound', 'rpc_failed'])
    expect(opts.extra.errorCode).toBe('QE012')
    expect(await docCount()).toBe(docs0)

    // CONTROL: with the SID row present the same turn is accepted and raises no event
    captureMessage.mockClear()
    const ok = await say(phone, '', client, 1)
    expect(ok.reply).toBe([strings.MI_FILE_RECEIVED(1), strings.MI_ACK_QUESTION_DC].join('\n'))
    expect(captureMessage).not.toHaveBeenCalled()
    expect(await docCount()).toBe(docs0 + 1)
  })
})

// ---------------------------------------------------------------------------
// T-A27-6: RPC race outcomes 'expired' and 'idle' (mapping only; the true interleaving is CI-only, not verified locally)
// ---------------------------------------------------------------------------

describe('T-A27-6: the RPC says expired / idle after the router read the row as live', () => {
  const expireSaysLive: RpcStub = (name) => (name === 'expire_stale_material_inward' ? { data: false, error: null } : undefined)

  it("T-A27-6a 'expired': ended reply, row cleared by the RPC, counts-only event for a photo, the next message takes the idle path", async () => {
    const phone = kit.phone('a27-6a')
    const t = tick()
    await seedSession(kit, phone, {
      flow: 'invoice',
      step: 3,
      context: { mi_kind: 'dc', mi_document_id: crypto.randomUUID(), mi_last_sid: 'sid-y', mi_reask: 0 },
      updatedAt: new Date(t.getTime() - 31 * MIN),
      expiresAt: new Date(t.getTime() - 1 * MIN),
    })
    const { client, calls } = spyClient(expireSaysLive)
    const r = await say(phone, '', client, 1, t)
    expect(r.reply).toBe(strings.MI_SESSION_ENDED_REPLY)
    expect(calls.filter((c) => c.name === 'apply_material_inward_turn')).toHaveLength(1)
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = captureMessage.mock.calls[0] as [string, { fingerprint: string[]; extra: Record<string, unknown> }]
    expect(opts.fingerprint).toEqual(['capture-router', 'file_after_session_ended'])
    expect(opts.extra).toEqual({ mediaCount: 1, contentTypes: ['image/jpeg'] })
    const next = await say(phone, 'hello', spyClient().client, 0, new Date(t.getTime() + MIN))
    expect(next.reply).not.toBe(strings.MI_SESSION_ENDED_REPLY)
  })

  it("T-A27-6b 'idle' from a day-stale reset: the handler clears the row with p_now = max(now, expires_at), then the ended reply, once", async () => {
    const phone = kit.phone('a27-6b')
    const updatedAt = new Date('2026-08-19T23:50:00+05:30')
    const expiresAt = new Date('2026-08-20T00:20:00+05:30')
    const now = new Date('2026-08-20T00:05:00+05:30')
    await seedSession(kit, phone, {
      flow: 'invoice',
      step: 3,
      context: { mi_kind: 'dc', mi_document_id: crypto.randomUUID(), mi_last_sid: 'sid-y', mi_reask: 0 },
      updatedAt,
      expiresAt,
    })
    // the router's own expire call is stubbed to "not cleared"; the handler's later expire call passes through
    let expireCalls = 0
    const { client, calls } = spyClient((name) => (name === 'expire_stale_material_inward' && ++expireCalls === 1 ? { data: false, error: null } : undefined))
    const r = await say(phone, 'hello', client, 0, now)
    expect(r.reply).toBe(strings.MI_SESSION_ENDED_REPLY)
    expect(calls.map((c) => c.name)).toEqual(['expire_stale_material_inward', 'apply_material_inward_turn', 'expire_stale_material_inward'])
    expect(new Date(calls[2]!.args.p_now as string).getTime()).toBe(expiresAt.getTime())
    expect((await getSession(kit, phone))!.current_flow).toBeNull() // cleared (removing the 'idle' clear leaves 'invoice' here)

    const next = await say(phone, 'hello', spyClient().client, 0, new Date(now.getTime() + MIN))
    expect(next.reply).not.toBe(strings.MI_SESSION_ENDED_REPLY) // never repeats
  })
})

// ---------------------------------------------------------------------------
// T-NOWRITE-1: no TypeScript touches capture_files (all inserts are the RPC's blank pending rows; updates arrive with C5)
// ---------------------------------------------------------------------------

function sourcesMentioning(root: string, needle: string): string[] {
  const hits: string[] = []
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name)
      if (statSync(p).isDirectory()) walk(p)
      else if (/\.(ts|tsx)$/.test(name) && readFileSync(p, 'utf8').includes(needle)) hits.push(p)
    }
  }
  walk(root)
  return hits
}

describe('T-NOWRITE-1', () => {
  it('no file under lib/ or app/ mentions capture_files', () => {
    const root = resolve(__dirname, '..')
    expect([...sourcesMentioning(join(root, 'lib'), 'capture_files'), ...sourcesMentioning(join(root, 'app'), 'capture_files')]).toEqual([])
  })

  it('control: the scanner does find a file that mentions it (this test file)', () => {
    expect(sourcesMentioning(__dirname, 'capture_files').some((p) => p.endsWith('capture-handler.test.ts'))).toBe(true)
  })
})
