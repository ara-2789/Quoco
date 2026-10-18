// PR-B (migration 050): the two edits to the LIVE check-in functions: N2 (a scheduled start over a live 'invoice'
// session) and N13 (the first step-1 message afterwards is deferred), plus the A27 interactions. NOT YET RUN: 050 is
// not applied to test-db (typechecked only until it is). Plan: docs/plans/pr-b-050-plan.md rev 6, sections 6, 7, 11.
//
// Test IDs covered here: T-SESS-1, T-N2-KEY, T-N13-1/2/3/4 (+ the extended four-message matrix), T-A27-3, T-A27-4,
// T-A27-7 (full), T-A27-8. The positive controls that need the PRE-050 bodies (T-SESS-1 and T-N2-KEY return 'reask'
// without the branch; T-N13 records absent / writes evening_output without the guard) cannot run on a test-db that
// already carries 050; they are proven on the local PG17 scaffold: docs/reviews/050-sql-evidence/transcripts/S3-red.txt.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildCaptureKit,
  getDelivery,
  getDoc,
  getSession,
  istToday,
  makeDoc,
  miTurn,
  noonIst,
  seedSession,
  teardownCaptureKit,
  type CaptureKit,
} from './helpers/capture-fixtures'

let kit: CaptureKit

beforeAll(async () => {
  kit = await buildCaptureKit('n2-n13', ['eng', 'pm1'])
})

afterAll(async () => {
  if (kit) await teardownCaptureKit(kit)
})

interface CheckinTurn {
  outcome: string
  current_flow: string | null
  current_step: number
  capture_discarded?: boolean | null
  capture_deferred?: boolean | null
  hindrance_discarded?: boolean | null
}

async function morning(phone: string, message: string, start: boolean, now?: Date): Promise<CheckinTurn> {
  const { data, error } = await kit.svc.rpc('apply_morning_flow_turn', {
    p_phone_number: phone,
    p_tenant_id: kit.tenantA,
    p_user_id: kit.uid('eng'),
    p_project_id: kit.p1,
    p_message: message,
    p_start_flow: start,
    ...(now ? { p_now: now.toISOString() } : {}),
  })
  if (error) throw new Error(`apply_morning_flow_turn failed (${error.code}): ${error.message}`)
  return data as CheckinTurn
}

async function evening(phone: string, message: string, start: boolean, now?: Date): Promise<CheckinTurn> {
  const { data, error } = await kit.svc.rpc('apply_evening_flow_turn', {
    p_phone_number: phone,
    p_tenant_id: kit.tenantA,
    p_user_id: kit.uid('eng'),
    p_project_id: kit.p1,
    p_message: message,
    p_start_flow: start,
    p_parse: { '1': [], '2': null, '3': null, '4': null },
    p_parse_ok: { '1': true, '2': false, '3': false, '4': false },
    ...(now ? { p_now: now.toISOString() } : {}),
  })
  if (error) throw new Error(`apply_evening_flow_turn failed (${error.code}): ${error.message}`)
  return data as CheckinTurn
}

async function hindrance(phone: string, message: string, start: boolean, now?: Date): Promise<CheckinTurn> {
  const { data, error } = await kit.svc.rpc('apply_hindrance_flow_turn', {
    p_phone_number: phone,
    p_tenant_id: kit.tenantA,
    p_user_id: kit.uid('eng'),
    p_project_id: kit.p1,
    p_message: message,
    p_start_flow: start,
    ...(now ? { p_now: now.toISOString() } : {}),
  })
  if (error) throw new Error(`apply_hindrance_flow_turn failed (${error.code}): ${error.message}`)
  return data as CheckinTurn
}

/** Put a session at S3 (document + delivery exist, ack pending) and return its document. */
async function liveInvoiceSession(label: string) {
  return makeDoc(kit, 'dc', label)
}

async function dailyLog(): Promise<{ attendance: string | null; evening_output: string | null } | null> {
  const { data, error } = await kit.svc
    .from('daily_logs')
    .select('attendance,evening_output')
    .eq('tenant_id', kit.tenantA)
    .eq('engineer_id', kit.uid('eng'))
    .eq('log_date', istToday())
    .maybeSingle<{ attendance: string | null; evening_output: string | null }>()
  if (error) throw new Error(`dailyLog read failed: ${error.message}`)
  return data
}

describe('T-SESS-1 / T-N2-KEY: a scheduled start over a live invoice session', () => {
  it('MORNING: outcome start, capture_discarded = true, check-in at step 1 with the morning guard, flow-owned keys gone, partial delivery survives "not acknowledged"', async () => {
    const d = await liveInvoiceSession('n2-morning')
    const r = await morning(d.phone, '', true)
    expect(r).toMatchObject({ outcome: 'start', current_flow: 'morning', current_step: 1, capture_discarded: true })
    const s = await getSession(kit, d.phone)
    expect(s!.context.invoice_reset_guard).toBe('morning')
    for (const k of ['mi_last_sid', 'mi_kind', 'mi_document_id', 'mi_reask']) expect(s!.context).not.toHaveProperty(k)
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('incomplete')
    expect((await getDoc(kit, d.docId)).engineer_ack).toBeNull()
  })

  it('EVENING: outcome start, capture_discarded = true, evening step 1 with the evening guard', async () => {
    const d = await liveInvoiceSession('n2-evening')
    const r = await evening(d.phone, '', true)
    expect(r).toMatchObject({ outcome: 'start', current_flow: 'evening', current_step: 1, capture_discarded: true })
    expect((await getSession(kit, d.phone))!.context.invoice_reset_guard).toBe('evening')
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('incomplete')
  })

  it('already_complete: the half is already submitted -> the session is cleared, no check-in starts, no guard, morning_submitted survives (subtract-only)', async () => {
    const base = noonIst()
    const phone = kit.phone('n2-already')
    await seedSession(kit, phone, {
      flow: 'invoice',
      step: 3,
      context: { morning_submitted: true, mi_kind: 'dc', mi_document_id: 'x', mi_last_sid: 'y' },
      updatedAt: base,
      expiresAt: new Date(base.getTime() + 20 * 60 * 1000),
    })
    const r = await morning(phone, '', true, base)
    expect(r).toMatchObject({ outcome: 'already_complete', current_flow: null, capture_discarded: true })
    expect((await getSession(kit, phone))!.context).toEqual({ morning_submitted: true })
  })

  it('T-A27-4 a stale (expired) invoice row plus a scheduled start: the check-in starts normally, order does not matter', async () => {
    const base = noonIst()
    const phone = kit.phone('n2-stale')
    await seedSession(kit, phone, { flow: 'invoice', step: 2, context: { mi_kind: 'dc' }, updatedAt: base, expiresAt: new Date(base.getTime() - 3600 * 1000) })
    const r = await morning(phone, '', true, new Date(base.getTime() + 60 * 1000))
    expect(r).toMatchObject({ outcome: 'start', current_flow: 'morning' })
  })

  it('control: a start over a live HINDRANCE session still returns hindrance_discarded (the existing branch is unchanged)', async () => {
    const base = noonIst()
    const phone = kit.phone('n2-hindrance-control')
    await seedSession(kit, phone, { flow: 'hindrance', step: 1, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 20 * 60 * 1000) })
    const r = await morning(phone, '', true, base)
    expect(r).toMatchObject({ outcome: 'start', hindrance_discarded: true })
    expect(r.capture_discarded ?? null).toBeNull()
  })
})

describe('T-N13: the FIRST non-empty step-1 message after an invoice discard is never taken as an answer', () => {
  const FIRST_MESSAGES = ['1', '2 bags short', 'partial, cement not received', 'some steel pending']

  it.each(FIRST_MESSAGES)('T-N13-2 MORNING first message %j is deferred: reask + capture_deferred, no attendance, q1_reask not consumed, guard cleared, still step 1', async (msg) => {
    const d = await liveInvoiceSession(`n13-m-${Buffer.from(msg).toString('hex').slice(0, 12)}`)
    await morning(d.phone, '', true)
    const before = await dailyLog()
    const r = await morning(d.phone, msg, false)
    expect(r).toMatchObject({ outcome: 'reask', current_flow: 'morning', current_step: 1, capture_deferred: true })
    const s = await getSession(kit, d.phone)
    expect(s!.context).not.toHaveProperty('q1_reask')
    expect(s!.context).not.toHaveProperty('invoice_reset_guard')
    expect((await dailyLog())?.attendance ?? null).toBe(before?.attendance ?? null)
  })

  it.each(FIRST_MESSAGES)('T-N13-1 EVENING first message %j is deferred: reask + capture_deferred, daily_logs.evening_output NOT written, still step 1', async (msg) => {
    const d = await liveInvoiceSession(`n13-e-${Buffer.from(msg).toString('hex').slice(0, 12)}`)
    await evening(d.phone, '', true)
    const r = await evening(d.phone, msg, false)
    expect(r).toMatchObject({ outcome: 'reask', current_flow: 'evening', current_step: 1, capture_deferred: true })
    expect((await getSession(kit, d.phone))!.context).not.toHaveProperty('invoice_reset_guard')
    const log = await dailyLog()
    expect(FIRST_MESSAGES).not.toContain(log?.evening_output ?? '')
  })

  it('the SECOND message is handled normally (morning: attendance recorded; evening: evening_output written)', async () => {
    const m = await liveInvoiceSession('n13-second-m')
    await morning(m.phone, '', true)
    await morning(m.phone, '2 bags short', false)
    const second = await morning(m.phone, 'yes', false)
    expect(second).toMatchObject({ outcome: 'advance', current_step: 2 })
    expect((await dailyLog())?.attendance).toBe('present')

    const e = await liveInvoiceSession('n13-second-e')
    await evening(e.phone, '', true)
    await evening(e.phone, '1', false)
    const text = `ZZTestCapture-${kit.runTag}-slab 10 sqm`
    const s2 = await evening(e.phone, text, false)
    expect(s2).toMatchObject({ outcome: 'advance', current_step: 2 })
    expect((await dailyLog())?.evening_output).toBe(text)
  })

  it('T-N13-3 after the deferral a bare 0 as the SECOND morning message still routes to not-on-site (step 5)', async () => {
    const d = await liveInvoiceSession('n13-zero')
    await morning(d.phone, '', true)
    await morning(d.phone, '5 things', false)
    expect(await morning(d.phone, '0', false)).toMatchObject({ outcome: 'advance', current_step: 5 })
  })

  it('T-N13-4 scoping: a flag set by the MORNING check-in does not defer the evening step 1', async () => {
    const base = noonIst()
    const phone = kit.phone('n13-scope')
    await seedSession(kit, phone, {
      flow: 'evening',
      step: 1,
      context: { invoice_reset_guard: 'morning' },
      updatedAt: base,
      expiresAt: new Date(base.getTime() + 20 * 60 * 1000),
    })
    const r = await evening(phone, `ZZTestCapture-${kit.runTag}-bricks laid`, false, base)
    expect(r).toMatchObject({ outcome: 'advance', current_step: 2 })
    expect(r.capture_deferred ?? null).toBeNull()
    expect((await getSession(kit, phone))!.context.invoice_reset_guard).toBe('morning')
  })

  it('an EMPTY first message does not consume the deferral: the guard stays set until the first non-empty message', async () => {
    const d = await liveInvoiceSession('n13-empty')
    await morning(d.phone, '', true)
    const empty = await morning(d.phone, '   ', false)
    expect(empty.outcome).toBe('reask')
    expect((await getSession(kit, d.phone))!.context.invoice_reset_guard).toBe('morning')
    expect((await morning(d.phone, 'hello', false)).capture_deferred).toBe(true)
  })
})

describe('A27 interactions with the other flows (SQL halves; the router half is PR-C)', () => {
  it('T-A27-3 a stale invoice row blocks the hindrance start until expire_stale_material_inward clears it; then the hindrance flow STARTS', async () => {
    const base = noonIst()
    const phone = kit.phone('a27-3')
    await seedSession(kit, phone, { flow: 'invoice', step: 2, context: { mi_kind: 'dc' }, updatedAt: base, expiresAt: new Date(base.getTime() - 60 * 1000) })
    const late = new Date(base.getTime() + 60 * 1000)
    // the bug N9 describes: without the clear, the hindrance start sees a live flow and re-asks
    expect((await hindrance(phone, '', true, late)).outcome).toBe('reask')
    const cleared = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: phone, p_now: late.toISOString() })
    expect(cleared.data).toBe(true)
    expect((await hindrance(phone, '', true, late)).outcome).toBe('start')
  })

  it('T-A27-7 an idle morning / evening / hindrance session at 31 minutes is STILL ACTIVE (only the invoice flow has the 30-minute rule)', async () => {
    const base = noonIst()
    const late = new Date(base.getTime() + 31 * 60 * 1000)
    const m = kit.phone('a27-7-m')
    await seedSession(kit, m, { flow: 'morning', step: 2, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 30 * 60 * 1000) })
    expect(await morning(m, 'ZZ plan of action', false, late)).toMatchObject({ outcome: 'advance', current_step: 3 })
    const e = kit.phone('a27-7-e')
    await seedSession(kit, e, { flow: 'evening', step: 1, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 30 * 60 * 1000) })
    expect(await evening(e, 'ZZ output', false, late)).toMatchObject({ outcome: 'advance', current_step: 2 })
    const h = kit.phone('a27-7-h')
    await seedSession(kit, h, { flow: 'hindrance', step: 1, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 30 * 60 * 1000) })
    expect((await hindrance(h, 'ZZ cement shortage', false, late)).outcome).not.toBe('wrong_flow')
    expect((await getSession(kit, h))!.current_flow).not.toBeNull()
  })

  it('T-A27-8 the IST-day rule still ends an invoice session at midnight: started 23:50, message 00:05 next day -> idle (not expired, not processed)', async () => {
    const t2350 = new Date(noonIst().getTime() + (11 * 60 + 50) * 60 * 1000)
    const phone = kit.phone('a27-8')
    await miTurn(kit, phone, '4', kit.sid('a27-8-s0'), { start: true, now: t2350 })
    const t0005 = new Date(t2350.getTime() + 15 * 60 * 1000)
    const r = await miTurn(kit, phone, '1', kit.sid('a27-8-s1'), { now: t0005 })
    expect(r.outcome).toBe('idle')
  })
})
