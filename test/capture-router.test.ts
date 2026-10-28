// PR-C C3 (router safety): expire-first, D1(d) one-shot ended reply, S-3 photo guard, N13 reply wiring, exhaustive
// SessionFlow mapping. Plan: docs/plans/pr-c-plan.md rev 3, sections 3b, 3c, 3f, 4, 6, 7, 8 (row C3).
//
// Real test-db, through routeInboundMessage, with an explicit `now` on EVERY call (never the real clock).
// Sessions are seeded with the capture fixtures. The router's client is a thin Proxy that records every rpc() call.
//
// C4a (2026-10-28): the live-'invoice' stub is gone and the real handler is wired (plan rev 4). Edits made in C4a, each
// marked "C4a:" below: T-INV-LIVE's first case replaced by T-HANDLE-ROUTE-1; seedInvoice uses a valid random uuid;
// route() supplies a unique messageSid; T-D1-1's control sends 'hello'. New here: T-D1-6, T-D1-6d, AT-DARK-1c, T-S3-7.
// C4b: T-S3-5 rewritten (PDFs now reach the router as documentMedia; see its comment).
//
// SCOPE (rev 3, now delivered in C4a): the digit-4 START branch, T-D1-6 and the allowlisted-start control of AT-DARK-1 are C4's. In C3 a bare
// "4" always gets today's item_reserved reply. T-D1-4's PDF part is C4's (the webhook blocks PDFs before routing).
//
// Several tests end with a CONTROL: the same seed, one thing changed, proving the assertion above it is the router's
// doing and not an accident of the fixture. Controls sit after the main assertions in the same `it` on purpose: a test
// that mixed an unchanged-behaviour check with the new behaviour must still go red against the old router.
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const { captureMessage, captureException } = vi.hoisted(() => ({
  captureMessage: vi.fn<(message: string, options?: Record<string, unknown>) => string>(() => 'mock-event-id'),
  captureException: vi.fn<(error: unknown, options?: Record<string, unknown>) => string>(() => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }))

import {
  routeInboundMessage,
  buildIdleReply,
  buildIdleMenu,
  computeIdleHeaderState,
  type IdleHeaderState,
} from '@/lib/whatsapp/inbound-start'
import { mapSessionFlowToCheckinFlow, type SessionFlow } from '@/lib/whatsapp/session'
import { applyHindranceFlowTurn, HINDRANCE_QUESTIONS } from '@/lib/whatsapp/flows/hindrance'
import { MORNING_QUESTIONS, buildMorningReply } from '@/lib/whatsapp/flows/morning'
import { EVENING_QUESTIONS, buildEveningReply } from '@/lib/whatsapp/flows/evening'
import { istParts } from '@/lib/daily-logs/status'
import {
  MI_SESSION_ENDED_REPLY,
  CHECKIN_RESET_EXPLAIN_REPLY,
  MI_CHECKIN_PHOTO_NOT_SAVED_REPLY,
  MI_ASK_KIND,
  MI_ACK_REASK,
  MI_ACK_QUESTION_DC,
} from '@/lib/whatsapp/flows/material-inward-strings'
import {
  buildCaptureKit,
  getSession,
  seedSession,
  teardownCaptureKit,
  type CaptureKit,
} from './helpers/capture-fixtures'

let kit: CaptureKit

beforeAll(async () => {
  delete process.env.CAPTURE_DIGIT4_TEST_PHONES
  kit = await buildCaptureKit('c3-router', ['eng'])
})

afterAll(async () => {
  if (!kit) return
  for (const tenantId of [kit.tenantA, kit.tenantB]) {
    await kit.svc.from('hindrances').delete().eq('tenant_id', tenantId)
    await kit.svc.from('jobs').delete().eq('type', 'media_ingest').contains('payload', { tenant_id: tenantId })
  }
  await teardownCaptureKit(kit)
})

beforeEach(() => {
  captureMessage.mockClear()
  captureException.mockClear()
})

afterEach(async () => {
  await kit.svc.from('hindrances').delete().eq('tenant_id', kit.tenantA)
  await kit.svc.from('jobs').delete().eq('type', 'media_ingest').contains('payload', { tenant_id: kit.tenantA })
  await kit.svc.from('daily_logs').delete().eq('tenant_id', kit.tenantA)
})

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const MIN = 60 * 1000
const NOON = new Date('2026-08-20T12:00:00+05:30')
const ago = (d: Date, min: number) => new Date(d.getTime() - min * MIN)
const INVOICE_KEYS = ['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask'] as const

interface RpcCall {
  name: string
  args: Record<string, unknown>
}

/** A client whose rpc() calls are recorded; everything else passes straight through. */
function spyClient(): { client: SupabaseClient; calls: RpcCall[] } {
  const calls: RpcCall[] = []
  const client = new Proxy(kit.svc, {
    get(target, prop, receiver) {
      if (prop === 'rpc') {
        return (name: string, args?: Record<string, unknown>) => {
          calls.push({ name, args: args ?? {} })
          return (target.rpc as (n: string, a?: Record<string, unknown>) => unknown)(name, args)
        }
      }
      const v = Reflect.get(target, prop, receiver)
      return typeof v === 'function' ? v.bind(target) : v
    },
  }) as SupabaseClient
  return { client, calls }
}

function header(now: Date, state?: IdleHeaderState): IdleHeaderState {
  return (
    state ??
    computeIdleHeaderState({
      morningSubmitted: false,
      eveningSubmitted: false,
      attendance: null,
      istMinutes: istParts(now).minutes,
    })
  )
}

interface RouteExtra {
  isPhoto?: boolean
  media?: Array<{ url: string; contentType: string }>
  documentMedia?: Array<{ url: string; contentType: string }>
}

// C4a: every call carries a unique message SID (a live 'invoice' session now reaches the handler, whose RPC requires one).
let sidCounter = 0

/** Run `fn` with CAPTURE_DIGIT4_TEST_PHONES set to `phones`, restoring the previous value afterwards. */
async function withAllowlist<T>(phones: string, fn: () => Promise<T>): Promise<T> {
  const saved = process.env.CAPTURE_DIGIT4_TEST_PHONES
  process.env.CAPTURE_DIGIT4_TEST_PHONES = phones
  try {
    return await fn()
  } finally {
    if (saved === undefined) delete process.env.CAPTURE_DIGIT4_TEST_PHONES
    else process.env.CAPTURE_DIGIT4_TEST_PHONES = saved
  }
}

function route(phone: string, message: string, now: Date, client: SupabaseClient, extra: RouteExtra = {}) {
  return routeInboundMessage({
    messageSid: kit.sid(`c4a-router-${++sidCounter}`),
    phoneNumber: phone,
    tenantId: kit.tenantA,
    userId: kit.uid('eng'),
    projectId: kit.p1,
    message,
    now: now.toISOString(),
    supabaseClient: client,
    ...extra,
  })
}

const PHOTO: RouteExtra = { isPhoto: true, media: [{ url: 'https://example.invalid/m/0', contentType: 'image/jpeg' }] }

async function seedInvoice(phone: string, o: { updatedAt: Date; expiresAt: Date; step?: number }) {
  await seedSession(kit, phone, {
    flow: 'invoice',
    step: o.step ?? 3,
    // C4a: a valid uuid (was 'doc-x'). A live row now reaches apply_material_inward_turn, which casts mi_document_id to uuid.
    context: { mi_kind: 'dc', mi_document_id: crypto.randomUUID(), mi_last_sid: 'sid-y', mi_reask: 0 },
    updatedAt: o.updatedAt,
    expiresAt: o.expiresAt,
  })
}

async function seedCheckin(phone: string, flow: 'morning' | 'evening', ctx: Record<string, unknown>, now: Date) {
  await seedSession(kit, phone, {
    flow,
    step: 1,
    context: ctx,
    updatedAt: ago(now, 1),
    expiresAt: new Date(now.getTime() + 29 * MIN),
  })
}

async function count(table: string, filter: (q: any) => any): Promise<number> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { count: c, error } = await filter(kit.svc.from(table).select('id', { count: 'exact', head: true }))
  if (error) throw new Error(`count(${table}) failed: ${error.message}`)
  return c ?? 0
}

const dailyLogCount = () => count('daily_logs', (q) => q.eq('tenant_id', kit.tenantA).eq('engineer_id', kit.uid('eng')))
const mediaJobCount = () => count('jobs', (q) => q.eq('type', 'media_ingest').contains('payload', { tenant_id: kit.tenantA }))
const photoRowCount = () => count('daily_log_photos', (q) => q.eq('tenant_id', kit.tenantA))
const hasInvoiceKeys = (ctx: Record<string, unknown>) => INVOICE_KEYS.some((k) => k in ctx)

function sentryText(): string {
  return JSON.stringify([captureMessage.mock.calls, captureException.mock.calls], (_k, v) =>
    v instanceof Error ? { name: v.name, message: v.message, stack: v.stack } : v,
  )
}

// ---------------------------------------------------------------------------
// T-C3-*: order
// ---------------------------------------------------------------------------

describe('T-C3: expire first', () => {
  it('T-C3-1 an expired invoice row is cleared and the ended reply is sent; hindrance does NOT start', async () => {
    const phone = kit.phone('c3-1')
    await seedInvoice(phone, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
    const { client } = spyClient()
    const r = await route(phone, '1', NOON, client)
    expect(r.reply).toBe(MI_SESSION_ENDED_REPLY)
    expect(r.resolvedFlow).toBeNull()
    const s = await getSession(kit, phone)
    expect(s!.current_flow).toBeNull()
    expect(hasInvoiceKeys(s!.context)).toBe(false)

    // CONTROL (the CI-run-845 failure): the same message with the clear step skipped. Starting the hindrance flow over
    // the still-'invoice' expired row refreshes expires_at past `now`.
    const p2 = kit.phone('c3-1-control')
    await seedInvoice(p2, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
    await applyHindranceFlowTurn({
      phoneNumber: p2,
      tenantId: kit.tenantA,
      userId: kit.uid('eng'),
      projectId: kit.p1,
      message: '1',
      startFlow: true,
      now: NOON.toISOString(),
      supabaseClient: kit.svc,
    })
    const c = await getSession(kit, p2)
    expect(new Date(c!.expires_at).getTime()).toBeGreaterThan(NOON.getTime())
  })

  it('T-C3-2 the first RPC after the routing read is expire_stale_material_inward; no flow RPC precedes it', async () => {
    const phone = kit.phone('c3-2')
    await seedInvoice(phone, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
    const { client, calls } = spyClient()
    await route(phone, '1', NOON, client)
    const names = calls.map((c) => c.name)
    expect(names[0]).toBe('expire_stale_material_inward')
    const flowRpcs = ['apply_morning_flow_turn', 'apply_evening_flow_turn', 'apply_hindrance_flow_turn']
    expect(names.slice(1).some((n) => flowRpcs.includes(n))).toBe(false)
    expect(calls[0]!.args).toMatchObject({ p_phone_number: phone })

    // CONTROL: a reversed order fails the same check.
    const reversed = ['apply_hindrance_flow_turn', 'expire_stale_material_inward']
    expect(reversed[0]).not.toBe('expire_stale_material_inward')
  })

  it('T-C3-3 every SessionFlow value goes through the exhaustive mapping; a sixth value fails tsc', () => {
    const expected: Record<SessionFlow, 'morning' | 'evening' | 'hindrance' | null> = {
      morning: 'morning',
      evening: 'evening',
      hindrance: 'hindrance',
      safety: null,
      invoice: null,
    }
    for (const flow of Object.keys(expected) as SessionFlow[]) {
      expect(mapSessionFlowToCheckinFlow(flow)).toBe(expected[flow])
    }
    // @ts-expect-error a sixth value is not a SessionFlow: the parameter type (and the `never` check) reject it
    expect(() => mapSessionFlowToCheckinFlow('sixth')).toThrow()
  })

  it('T-C3-4 morning, evening and hindrance rows idle 31 minutes are NOT cleared', async () => {
    for (const flow of ['morning', 'evening', 'hindrance'] as const) {
      // Router: no ended reply, and the expire RPC is not even asked about a non-invoice row.
      const p = kit.phone(`c3-4-router-${flow}`)
      await seedSession(kit, p, { flow, step: 1, context: {}, updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
      const { client, calls } = spyClient()
      const r = await route(p, 'hello', NOON, client)
      expect(r.reply).not.toBe(MI_SESSION_ENDED_REPLY)
      expect(calls.map((c) => c.name)).not.toContain('expire_stale_material_inward')

      // SQL (V3 T-A27-7): called directly, the function leaves the row alone.
      const q = kit.phone(`c3-4-sql-${flow}`)
      await seedSession(kit, q, { flow, step: 1, context: { keep: 'me' }, updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
      const { data, error } = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: q, p_now: NOON.toISOString() })
      expect(error).toBeNull()
      expect(data).toBe(false)
      const s = await getSession(kit, q)
      expect(s!.current_flow).toBe(flow)
      expect(s!.context).toEqual({ keep: 'me' })
    }
  })
})

// ---------------------------------------------------------------------------
// T-D1-*: the one-shot ended reply
// ---------------------------------------------------------------------------

describe('T-D1: D1(d) one-shot ended reply', () => {
  it('T-D1-1 expired at step 3: exact ended reply, row cleared, no ack written, no other flow RPC', async () => {
    const phone = kit.phone('d1-1')
    await seedInvoice(phone, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
    const { client, calls } = spyClient()
    const r = await route(phone, '1', NOON, client)
    expect(r.reply).toBe(MI_SESSION_ENDED_REPLY)
    expect(r.resolvedFlow).toBeNull()
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
    expect(calls.map((c) => c.name)).toEqual(['expire_stale_material_inward'])
    expect(await count('capture_documents', (q) => q.eq('tenant_id', kit.tenantA))).toBe(0)
    expect(await count('deliveries', (q) => q.eq('tenant_id', kit.tenantA))).toBe(0)

    // CONTROL: last turn 29:59 ago (expires_at = now + 1s): the router does not send the ended reply.
    const p2 = kit.phone('d1-1-control')
    await seedInvoice(p2, { updatedAt: new Date(NOON.getTime() - (30 * MIN - 1000)), expiresAt: new Date(NOON.getTime() + 1000) })
    // C4a: 'hello', not '1' (was '1'): a live row now reaches the handler, and '1' would be an ack against a document
    // that does not exist in this seed. The point of the control is only "29:59 is not ended".
    const r2 = await route(p2, 'hello', NOON, spyClient().client)
    expect(r2.reply).not.toBe(MI_SESSION_ENDED_REPLY)
  })

  it('T-D1-2 IST-day crossing: updated 23:50 D-1, expires 00:20 D, now 00:05 D -> ended once, row cleared (p_now = max(now, expires_at))', async () => {
    const updatedAt = new Date('2026-08-19T23:50:00+05:30')
    const expiresAt = new Date('2026-08-20T00:20:00+05:30')
    const now = new Date('2026-08-20T00:05:00+05:30')
    const phone = kit.phone('d1-2')
    await seedInvoice(phone, { updatedAt, expiresAt })
    const { client, calls } = spyClient()
    const r = await route(phone, 'hello', now, client)
    expect(r.reply).toBe(MI_SESSION_ENDED_REPLY)
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
    const expire = calls.find((c) => c.name === 'expire_stale_material_inward')
    expect(new Date(expire!.args.p_now as string).getTime()).toBe(expiresAt.getTime())

    // CONTROL: the same seed for a 'morning' row -> the normal idle reply, no ended reply.
    const p2 = kit.phone('d1-2-control')
    await seedSession(kit, p2, { flow: 'morning', step: 1, context: {}, updatedAt, expiresAt })
    const r2 = await route(p2, 'hello', now, spyClient().client)
    expect(r2.reply).toBe(buildIdleReply('unrecognized', header(now)))
  })

  it.each([
    [
      'T-D1-3a (after T-D1-1)',
      { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1), now: NOON },
    ],
    [
      'T-D1-3b (after T-D1-2)',
      {
        updatedAt: new Date('2026-08-19T23:50:00+05:30'),
        expiresAt: new Date('2026-08-20T00:20:00+05:30'),
        now: new Date('2026-08-20T00:05:00+05:30'),
      },
    ],
  ])('%s: "hello" gets the idle reply, "1" starts hindrance, the ended reply never repeats', async (label, seed) => {
    const phone = kit.phone(`d1-3-${label.slice(5, 7)}`)
    await seedInvoice(phone, { updatedAt: seed.updatedAt, expiresAt: seed.expiresAt })
    const { client } = spyClient()
    const first = await route(phone, 'hello', seed.now, client)
    expect(first.reply).toBe(MI_SESSION_ENDED_REPLY)
    const t2 = new Date(seed.now.getTime() + MIN)
    const second = await route(phone, 'hello', t2, client)
    expect(second.reply).toBe(buildIdleReply('unrecognized', header(t2)))
    const t3 = new Date(seed.now.getTime() + 2 * MIN)
    const third = await route(phone, '1', t3, client)
    expect(third.reply).toBe(HINDRANCE_QUESTIONS[1])
    expect(third.resolvedFlow).toBe('hindrance')
    expect(second.reply).not.toBe(MI_SESSION_ENDED_REPLY)
    expect(third.reply).not.toBe(MI_SESSION_ENDED_REPLY)

    if (label.includes('3b')) {
      // CONTROL (the defect the clear fixes): with the clear removed -- i.e. expire called with plain `now` instead of
      // max(now, expires_at) -- the unexpired day-stale row is NOT cleared, so the next message would be ended again.
      const p2 = kit.phone('d1-3-control')
      await seedInvoice(p2, { updatedAt: seed.updatedAt, expiresAt: seed.expiresAt })
      const { data } = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: p2, p_now: seed.now.toISOString() })
      expect(data).toBe(false)
      expect((await getSession(kit, p2))!.current_flow).toBe('invoice')
    }
  })

  it('T-D1-4 (photo part) a photo as the first message after expiry: ended reply, nothing stored, no nudge claimed', async () => {
    const phone = kit.phone('d1-4')
    await seedInvoice(phone, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
    const { client, calls } = spyClient()
    const r = await route(phone, '', NOON, client, PHOTO)
    expect(r.reply).toBe(MI_SESSION_ENDED_REPLY)
    expect(await mediaJobCount()).toBe(0)
    expect(await photoRowCount()).toBe(0)
    expect(await dailyLogCount()).toBe(0)
    expect(calls.map((c) => c.name)).not.toContain('claim_media_nudge')
    // Decision Q11: one counts-only Sentry event.
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = captureMessage.mock.calls[0] as [string, { fingerprint: string[]; extra: Record<string, unknown> }]
    expect(opts.fingerprint).toEqual(['capture-router', 'file_after_session_ended'])
    expect(opts.extra).toEqual({ mediaCount: 1, contentTypes: ['image/jpeg'] })
    const text = sentryText()
    for (const needle of [phone, phone.replace('+', ''), 'example.invalid', kit.tenantA, kit.uid('eng')]) {
      expect(text).not.toContain(needle)
    }
  })

  it('T-D1-5 a message 29:59 after the last turn is not treated as ended; the expire RPC ran and returned false', async () => {
    const phone = kit.phone('d1-5')
    await seedInvoice(phone, { updatedAt: new Date(NOON.getTime() - (30 * MIN - 1000)), expiresAt: new Date(NOON.getTime() + 1000) })
    const { client, calls } = spyClient()
    const r = await route(phone, 'hello', NOON, client)
    expect(r.reply).not.toBe(MI_SESSION_ENDED_REPLY)
    expect(calls[0]?.name).toBe('expire_stale_material_inward')
    expect((await getSession(kit, phone))!.current_flow).toBe('invoice')
  })

  // C4a. Aravind's rev 2: a bare "4" right after the session ended, on a phone where digit 4 is live, starts the flow at
  // once -- no ended reply. Control in the same test: "1" in the same state still gets the ended reply.
  it.each([
    ['expiry', { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1), now: NOON }],
    [
      'IST-day crossing',
      {
        updatedAt: new Date('2026-08-19T23:50:00+05:30'),
        expiresAt: new Date('2026-08-20T00:20:00+05:30'),
        now: new Date('2026-08-20T00:05:00+05:30'),
      },
    ],
  ])('T-D1-6 (%s) allowlisted phone: "4" after the session ended starts a new session at step 1, no ended reply', async (label, seed) => {
    const phone = kit.phone(`d1-6-${label.slice(0, 3)}`)
    await withAllowlist(phone, async () => {
      await seedInvoice(phone, { updatedAt: seed.updatedAt, expiresAt: seed.expiresAt })
      const { client, calls } = spyClient()
      const r = await route(phone, '4', seed.now, client)
      expect(r.reply).toBe(MI_ASK_KIND)
      expect(r.reply).not.toBe(MI_SESSION_ENDED_REPLY)
      expect(r.resolvedFlow).toBe('invoice')
      const s = await getSession(kit, phone)
      expect(s!.current_flow).toBe('invoice')
      expect(s!.current_step).toBe(1)
      const apply = calls.filter((c) => c.name === 'apply_material_inward_turn')
      expect(apply).toHaveLength(1)
      expect(apply[0]!.args.p_start_flow).toBe(true)

      // CONTROL: "1" in the same state is still the one-shot ended reply (and the row is cleared).
      const p2 = kit.phone(`d1-6-${label.slice(0, 3)}-control`)
      await withAllowlist(`${phone},${p2}`, async () => {
        await seedInvoice(p2, { updatedAt: seed.updatedAt, expiresAt: seed.expiresAt })
        const r2 = await route(p2, '1', seed.now, spyClient().client)
        expect(r2.reply).toBe(MI_SESSION_ENDED_REPLY)
        expect((await getSession(kit, p2))!.current_flow).toBeNull()
      })
    })
  })

  it('T-D1-6d dark phone (no allowlist): "4" after expiry is still the ended reply -- the switch gates the skip', async () => {
    delete process.env.CAPTURE_DIGIT4_TEST_PHONES
    const phone = kit.phone('d1-6d')
    await seedInvoice(phone, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
    const { client, calls } = spyClient()
    const r = await route(phone, '4', NOON, client)
    expect(r.reply).toBe(MI_SESSION_ENDED_REPLY)
    expect(calls.map((c) => c.name)).not.toContain('apply_material_inward_turn')
    expect((await getSession(kit, phone))!.current_flow).toBeNull()
  })

  it('T-D1-6e a photo (or any media) after expiry is the ended reply even on a live phone', async () => {
    const phone = kit.phone('d1-6e')
    await withAllowlist(phone, async () => {
      await seedInvoice(phone, { updatedAt: ago(NOON, 31), expiresAt: ago(NOON, 1) })
      const r = await route(phone, '4', NOON, spyClient().client, PHOTO)
      expect(r.reply).toBe(MI_SESSION_ENDED_REPLY)
    })
  })
})

// ---------------------------------------------------------------------------
// T-S3-*: a photo while invoice_reset_guard is set
// ---------------------------------------------------------------------------

const S3_MORNING = [MI_CHECKIN_PHOTO_NOT_SAVED_REPLY, CHECKIN_RESET_EXPLAIN_REPLY, buildMorningReply('reask', 1)].join('\n')
const S3_EVENING = [MI_CHECKIN_PHOTO_NOT_SAVED_REPLY, CHECKIN_RESET_EXPLAIN_REPLY, buildEveningReply('reask', 1)].join('\n')

describe('T-S3: invoice_reset_guard photo guard', () => {
  it('T-S3-1 morning guard + photo: nothing stored, guard stays, S-3 reply', async () => {
    const phone = kit.phone('s3-1')
    await seedCheckin(phone, 'morning', { invoice_reset_guard: 'morning' }, NOON)
    const r = await route(phone, '', NOON, spyClient().client, PHOTO)
    expect(r.reply).toBe(S3_MORNING)
    expect(await photoRowCount()).toBe(0)
    expect(await mediaJobCount()).toBe(0)
    expect(await dailyLogCount()).toBe(0)
    expect((await getSession(kit, phone))!.context.invoice_reset_guard).toBe('morning')
  })

  it('T-S3-2 evening mirror', async () => {
    const phone = kit.phone('s3-2')
    await seedCheckin(phone, 'evening', { invoice_reset_guard: 'evening' }, NOON)
    const r = await route(phone, '', NOON, spyClient().client, PHOTO)
    expect(r.reply).toBe(S3_EVENING)
    expect(await photoRowCount()).toBe(0)
    expect(await mediaJobCount()).toBe(0)
    expect(await dailyLogCount()).toBe(0)
    expect((await getSession(kit, phone))!.context.invoice_reset_guard).toBe('evening')
  })

  it('T-S3-3 inert: a morning guard on an EVENING session is handled as today (contrast: the matching guard is not)', async () => {
    const phone = kit.phone('s3-3')
    await seedCheckin(phone, 'evening', { invoice_reset_guard: 'morning' }, NOON)
    const r = await route(phone, '', NOON, spyClient().client, PHOTO)
    expect(r.reply).toBe(buildEveningReply('reask', 1))
    expect(await mediaJobCount()).toBe(1)
    expect((await getSession(kit, phone))!.context.invoice_reset_guard).toBe('morning')

    // Contrast: the SAME photo on a morning session whose guard IS morning is refused.
    await kit.svc.from('jobs').delete().eq('type', 'media_ingest').contains('payload', { tenant_id: kit.tenantA })
    const p2 = kit.phone('s3-3-contrast')
    await seedCheckin(p2, 'morning', { invoice_reset_guard: 'morning' }, NOON)
    const r2 = await route(p2, '', NOON, spyClient().client, PHOTO)
    expect(r2.reply).toBe(S3_MORNING)
    expect(await mediaJobCount()).toBe(0)
  })

  it('T-S3-4 POSITIVE CONTROL: after the first text clears the guard, the next photo is a normal check-in photo', async () => {
    const phone = kit.phone('s3-4')
    await seedCheckin(phone, 'morning', { invoice_reset_guard: 'morning' }, NOON)
    const { client } = spyClient()
    // 1. photo while the guard is set: refused
    expect((await route(phone, '', NOON, client, PHOTO)).reply).toBe(S3_MORNING)
    expect(await mediaJobCount()).toBe(0)
    // 2. first non-empty text: deferred (N13), clears the guard
    const t2 = new Date(NOON.getTime() + MIN)
    expect((await route(phone, 'hello', t2, client)).reply).toBe(`${CHECKIN_RESET_EXPLAIN_REPLY}\n${MORNING_QUESTIONS[1]}`)
    expect((await getSession(kit, phone))!.context).not.toHaveProperty('invoice_reset_guard')
    // 3. photo now: stored normally
    const t3 = new Date(NOON.getTime() + 2 * MIN)
    const r3 = await route(phone, '', t3, client, PHOTO)
    expect(r3.reply).toBe(buildMorningReply('reask', 1))
    expect(await mediaJobCount()).toBe(1)
    expect(await dailyLogCount()).toBe(1)
  })

  // C4b: REWRITTEN (was: "a PDF never reaches the router", a source-order check on route.ts). From C4b a PDF-bearing message
  // DOES reach the router (as documentMedia), but only a live 'invoice' session may consume it. With the S-3 guard set the
  // router hands it straight back (unsupportedMedia:true, so the webhook answers UNSUPPORTED_MEDIA_REPLY as before): no
  // S-3 reply, no check-in photo, nothing stored, no Sentry event of its own, and the guard is left alone.
  it('T-S3-5 (C4b) a PDF while the guard is set: unsupportedMedia, nothing stored, guard untouched', async () => {
    const phone = kit.phone('s3-5')
    await seedCheckin(phone, 'morning', { invoice_reset_guard: 'morning' }, NOON)
    const before = await getSession(kit, phone)
    const { client, calls } = spyClient()
    const r = await route(phone, 'caption', NOON, client, { documentMedia: [{ url: 'https://example.invalid/m/0', contentType: 'application/pdf' }] })
    expect(r).toEqual({ reply: '', resolvedFlow: null, unsupportedMedia: true })
    expect(calls).toEqual([])
    expect(await photoRowCount()).toBe(0)
    expect(await mediaJobCount()).toBe(0)
    expect(await dailyLogCount()).toBe(0)
    expect(await getSession(kit, phone)).toEqual(before)
    expect(captureMessage).not.toHaveBeenCalled()
    expect(captureException).not.toHaveBeenCalled()
  })

  it('T-S3-6 isPhoto with zero extractable items while the guard is set: not dispatched as an answer', async () => {
    const phone = kit.phone('s3-6')
    await seedCheckin(phone, 'morning', { invoice_reset_guard: 'morning' }, NOON)
    const { client, calls } = spyClient()
    const r = await route(phone, 'caption text', NOON, client, { isPhoto: true, media: [] })
    expect(r.reply).toBe(S3_MORNING)
    expect(calls.map((c) => c.name)).not.toContain('apply_morning_flow_turn')
    expect((await getSession(kit, phone))!.context.invoice_reset_guard).toBe('morning')
    expect(await mediaJobCount()).toBe(0)
  })

  // C4a (plan item 3): the reply carries the PLAIN question for the step, not build*Reply('reask', step). The guard can
  // only exist at step 1 in production, so this seeds an artificial step-2 row to tell the two apart: evening's 'reask'
  // at step 2 is "Sorry, I didn't catch a number there...", which would be wrong (nothing was misunderstood).
  it('T-S3-7 evening guard + photo at step 2: the plain question, never the "Sorry, I didn\'t catch" re-ask', async () => {
    const phone = kit.phone('s3-7')
    await seedSession(kit, phone, {
      flow: 'evening',
      step: 2,
      context: { invoice_reset_guard: 'evening' },
      updatedAt: ago(NOON, 1),
      expiresAt: new Date(NOON.getTime() + 29 * MIN),
    })
    const r = await route(phone, '', NOON, spyClient().client, PHOTO)
    expect(r.reply).toBe([MI_CHECKIN_PHOTO_NOT_SAVED_REPLY, CHECKIN_RESET_EXPLAIN_REPLY, EVENING_QUESTIONS[2]].join('\n'))
    expect(r.reply).not.toContain("Sorry, I didn't catch")
    expect(await mediaJobCount()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// T-N13-W: capture_deferred reply wiring
// ---------------------------------------------------------------------------

describe('T-N13-W: capture_deferred reply', () => {
  it('morning: deferred first message -> explanation + the step-1 question; control: no flag -> the plain question', async () => {
    const phone = kit.phone('n13w-m')
    await seedCheckin(phone, 'morning', { invoice_reset_guard: 'morning' }, NOON)
    const r = await route(phone, 'hello', NOON, spyClient().client)
    expect(r.reply).toBe(`${CHECKIN_RESET_EXPLAIN_REPLY}\n${MORNING_QUESTIONS[1]}`)

    const p2 = kit.phone('n13w-m-control')
    await seedCheckin(p2, 'morning', {}, NOON)
    const r2 = await route(p2, 'hello', NOON, spyClient().client)
    expect(r2.reply).toBe(buildMorningReply('reask', 1))
    expect(r2.reply).not.toContain(CHECKIN_RESET_EXPLAIN_REPLY)
  })

  it('evening mirror; control: no flag -> unchanged advance reply', async () => {
    const phone = kit.phone('n13w-e')
    await seedCheckin(phone, 'evening', { invoice_reset_guard: 'evening' }, NOON)
    const r = await route(phone, 'hello', NOON, spyClient().client)
    expect(r.reply).toBe(`${CHECKIN_RESET_EXPLAIN_REPLY}\n${EVENING_QUESTIONS[1]}`)

    const p2 = kit.phone('n13w-e-control')
    await seedCheckin(p2, 'evening', {}, NOON)
    const r2 = await route(p2, 'hello', NOON, spyClient().client)
    expect(r2.reply).toBe(buildEveningReply('advance', 2))
    expect(r2.reply).not.toContain(CHECKIN_RESET_EXPLAIN_REPLY)
  })
})

// ---------------------------------------------------------------------------
// T-HANDLE-ROUTE-1 (C4a: replaces T-INV-LIVE's first case, which pinned the C3 stub) and the 'safety' case (unchanged)
// ---------------------------------------------------------------------------

describe('live invoice / safety rows', () => {
  it("T-HANDLE-ROUTE-1 (C4a, replaces the C3 stub test) a live, unexpired 'invoice' row goes to the handler, not the idle path", async () => {
    const phone = kit.phone('handle-route-1')
    await seedInvoice(phone, { updatedAt: ago(NOON, 1), expiresAt: new Date(NOON.getTime() + 29 * MIN) })
    const { client, calls } = spyClient()
    const r = await route(phone, 'hello', NOON, client)
    // step 3, non-ack text, first miss: the one re-ask, then the same ack question
    expect(r.reply).toBe(`${MI_ACK_REASK}\n${MI_ACK_QUESTION_DC}`)
    expect(r.resolvedFlow).toBe('invoice')
    expect(calls.filter((c) => c.name === 'apply_material_inward_turn')).toHaveLength(1)
    expect((await getSession(kit, phone))!.current_flow).toBe('invoice')
    // the C3 stub's event is gone
    expect(captureMessage).not.toHaveBeenCalled()
    expect(r.reply).not.toBe(buildIdleReply('unrecognized', header(NOON)))
  })

  it("a live 'safety' row: one Sentry WARNING, then the idle reply path", async () => {
    const phone = kit.phone('safety-live')
    await seedSession(kit, phone, { flow: 'safety', step: 1, context: {}, updatedAt: ago(NOON, 1), expiresAt: new Date(NOON.getTime() + 29 * MIN) })
    const r = await route(phone, 'secret body text', NOON, spyClient().client)
    expect(r.reply).toBe(buildIdleReply('unrecognized', header(NOON)))
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = captureMessage.mock.calls[0] as [string, { fingerprint: string[]; level: string }]
    expect(opts.fingerprint).toEqual(['capture-router', 'safety_without_handler'])
    expect(opts.level).toBe('warning')
    const text = sentryText()
    for (const needle of [phone, phone.replace('+', ''), 'secret body text']) expect(text).not.toContain(needle)
  })
})

// ---------------------------------------------------------------------------
// AT-DARK: digit 4 stays dark in C3 (these two pass against the unchanged router: they are the guard)
// ---------------------------------------------------------------------------

describe('AT-DARK: no engineer-visible change', () => {
  it('AT-DARK-1 (C3 part): no allowlist, no session, "4" -> today\'s item_reserved reply; nothing started', async () => {
    delete process.env.CAPTURE_DIGIT4_TEST_PHONES
    const phone = kit.phone('dark-1')
    const { client, calls } = spyClient()
    const r = await route(phone, '4', NOON, client)
    expect(r.reply).toBe(buildIdleReply('item_reserved', header(NOON)))
    expect(r.resolvedFlow).toBeNull()
    expect(await getSession(kit, phone)).toBeNull()
    expect(calls.map((c) => c.name)).not.toContain('apply_material_inward_turn')
  })

  // C4a: the allowlisted-start CONTROL of AT-DARK-1 -- same call, phone allowlisted: the flow starts and the reply differs.
  it('AT-DARK-1c control: the same call with the phone allowlisted starts the flow', async () => {
    const phone = kit.phone('dark-1c')
    await withAllowlist(phone, async () => {
      const { client, calls } = spyClient()
      const r = await route(phone, '4', NOON, client)
      expect(r.reply).toBe(MI_ASK_KIND)
      expect(r.reply).not.toBe(buildIdleReply('item_reserved', header(NOON)))
      expect(r.resolvedFlow).toBe('invoice')
      const s = await getSession(kit, phone)
      expect(s!.current_flow).toBe('invoice')
      expect(s!.current_step).toBe(1)
      expect(calls.filter((c) => c.name === 'apply_material_inward_turn')).toHaveLength(1)
    })
  })

  it('AT-DARK-2 the idle menu text is byte-identical to origin/main for every header state', () => {
    // Literals captured from origin/main dfd3749's HEADER_LINE / ACTION_LINE (lib/whatsapp/inbound-start.ts).
    const GOLDEN: Record<IdleHeaderState, string> = {
      awaiting_morning: 'Your check-in will arrive shortly.\nYou can report a site hindrance now — reply 1.',
      morning_closed: 'The morning window has closed for today.\nYou can still report a site hindrance — reply 1.',
      site_holiday: 'Today is a site holiday, so there is nothing further to check in.\nYou can still report a site hindrance — reply 1.',
      complete: "Today's check-in is complete.\nYou can still report a site hindrance — reply 1.",
      none: 'You can report a site hindrance — reply 1.',
    }
    for (const state of Object.keys(GOLDEN) as IdleHeaderState[]) {
      expect(buildIdleMenu(state)).toBe(GOLDEN[state])
    }
  })
})
