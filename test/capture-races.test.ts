// PR-B (migration 050): CONCURRENCY / LOCK / RACE tests. NOT YET RUN: 050 is not applied to test-db.
//
// EVERY test here is "NOT verified locally, CI-only" (CLAUDE.md section 0, docs/reviews/sandbox-cannot-test-concurrency.md):
// the Claude Code sandbox serialises concurrent RPC calls through the JS client, so caller 2 cannot be dispatched
// until caller 1 has returned and a local green run would pass TRIVIALLY. A local pass of this file is NOT evidence and
// must be reported as "not verified locally, CI-only", never as "passed". The title of each test says so.
//
// Covers: the six 049 lock paths (v3 / 049 header), T-A27-6, the duplicate-SID race, the B1 ack race, and the
// DOWN-vs-turn race (skipped here: it needs a table-owner connection and the DOWN artifact; the local two-psql
// evidence is docs/reviews/050-sql-evidence/transcripts/S5-down.txt and is NOT a CI verification either).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ack,
  buildCaptureKit,
  getDelivery,
  getSession,
  jpegMedia,
  linksOfDelivery,
  linksOfInvoice,
  makeDoc,
  miTurnRaw,
  noonIst,
  teardownCaptureKit,
  type CaptureKit,
  type MadeDoc,
} from './helpers/capture-fixtures'

const CI_ONLY = ' -- NOT verified locally, CI-only'
const ROUNDS = 4

// Diagnostics (block 16): CI run 39242144077 timed out three of these at 30 s with no indication of WHERE the time went.
// `setupClock` times fixture setup per round; `raceCalls` runs the raced RPCs together, times each one, and gives each its
// own client-side timeout (15 s, well under the 30 s test budget) that NAMES the stuck call instead of a bare test timeout.
// A raced call that really waits on a lock shows up here as a long `ms` on that call, not in `setup`.
const CALL_TIMEOUT_MS = 15000

function setupClock(test: string) {
  const t0 = Date.now()
  return (round: number, what: string) => console.log(`[race-diag] ${test} round=${round} ${what} setup_ms=${Date.now() - t0}`)
}

async function raceCalls<T extends { error: { code?: string; message: string } | null }>(
  test: string,
  round: number,
  calls: Array<[string, () => PromiseLike<T>]>,
): Promise<T[]> {
  const t0 = Date.now()
  const out = await Promise.all(
    calls.map(async ([name, fn]) => {
      const start = Date.now() - t0
      const timer = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error(`[race-diag] ${test} round=${round} call=${name} exceeded ${CALL_TIMEOUT_MS} ms client-side`)), CALL_TIMEOUT_MS),
      )
      const r = await Promise.race([Promise.resolve(fn()), timer])
      console.log(`[race-diag] ${test} round=${round} call=${name} start=+${start}ms end=+${Date.now() - t0}ms error=${r.error ? r.error.code : 'none'}`)
      return r
    }),
  )
  return out
}

let kit: CaptureKit

beforeAll(async () => {
  kit = await buildCaptureKit('races', ['eng', 'pm1'])
})

afterAll(async () => {
  if (kit) await teardownCaptureKit(kit)
})

async function typedDc(label: string): Promise<MadeDoc> {
  const d = await makeDoc(kit, 'dc', label)
  const pm = await kit.jwt('pm1')
  const r = await pm.rpc('pm_set_delivery_details', {
    p_delivery_id: d.deliveryId,
    p_delivery_type: 'supplier',
    p_vehicle_number: null,
    p_dc_number: null,
    p_dc_date: null,
  })
  if (r.error) throw new Error(`typedDc(${label}) failed: ${r.error.message}`)
  return d
}

/** The invariants that must hold for one invoice after ANY interleaving of the six paths (049 orphan probes + XOR rule). */
async function expectInvoiceInvariants(inv: MadeDoc): Promise<void> {
  const links = await linksOfInvoice(kit, inv.docId)
  const activeSelf = links.filter((l) => l.link_source === 'created_from_invoice' && l.unlinked_at === null)
  const activeManual = links.filter((l) => l.link_source === 'pm_manual' && l.unlinked_at === null)
  const auto = await getDelivery(kit, inv.deliveryId)
  // A28 XOR: the self-link and PM links never coexist
  expect(activeSelf.length > 0 && activeManual.length > 0).toBe(false)
  // at most one active self-link
  expect(activeSelf.length).toBeLessThanOrEqual(1)
  // a delivery cancelled by supersession always has at least one active PM link behind it
  if (auto.status === 'cancelled') expect(activeManual.length).toBeGreaterThan(0)
  // a rejected automatic delivery has no active self-link
  if (auto.status === 'rejected') expect(activeSelf).toHaveLength(0)
  // an incomplete / awaiting_pm automatic delivery has exactly one active self-link (or the PM links took over)
  if (auto.status === 'incomplete' || auto.status === 'awaiting_pm') expect(activeSelf.length + activeManual.length).toBeGreaterThan(0)
}

describe('049 lock paths 1-6 under concurrency (PostgREST, two real sessions)', () => {
  it(`path 1 x path 1: two invoices linking the SAME DC delivery -> exactly one wins, the loser gets QE008 and cancels nothing${CI_ONLY}`, async () => {
    const T = 'p1xp1'
    for (let i = 0; i < ROUNDS; i++) {
      const clock = setupClock(T)
      const invA = await makeDoc(kit, 'invoice', `r11-a${i}`)
      clock(i, 'invA')
      const invB = await makeDoc(kit, 'invoice', `r11-b${i}`)
      clock(i, 'invB')
      const dc = await typedDc(`r11-dc${i}`)
      clock(i, 'dc')
      const pm = await kit.jwt('pm1')
      clock(i, 'jwt')
      const [ra, rb] = await raceCalls(T, i, [
        ['link-A', () => pm.rpc('pm_link_invoice', { p_invoice_document_id: invA.docId, p_delivery_ids: [dc.deliveryId] })],
        ['link-B', () => pm.rpc('pm_link_invoice', { p_invoice_document_id: invB.docId, p_delivery_ids: [dc.deliveryId] })],
      ])
      const results = [ra, rb]
      expect(results.filter((r) => r.error === null)).toHaveLength(1)
      const loser = results.find((r) => r.error !== null)!
      // QE008 is the contract; a deadlock (40P01) would be a lock-order defect and fails this assertion
      expect(loser.error!.code).toBe('QE008')
      expect((await linksOfDelivery(kit, dc.deliveryId)).filter((l) => l.unlinked_at === null)).toHaveLength(1)
      await expectInvoiceInvariants(invA)
      await expectInvoiceInvariants(invB)
    }
  })

  it(`path 1 x path 3: linking an invoice while its AUTOMATIC delivery is being rejected -> the end state satisfies the invariants, no deadlock${CI_ONLY}`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const inv = await makeDoc(kit, 'invoice', `r13-inv${i}`)
      const dc = await typedDc(`r13-dc${i}`)
      const pm = await kit.jwt('pm1')
      const rs = await Promise.all([
        pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] }),
        pm.rpc('pm_reject_delivery', { p_delivery_id: inv.deliveryId, p_reason: 'ZZ race' }),
      ])
      for (const r of rs) if (r.error) expect(r.error.code).not.toBe('40P01')
      await expectInvoiceInvariants(inv)
    }
  })

  it(`path 1 x path 4: linking a second DC to an invoice while a linked DC is being rejected (restore race) -> invariants hold${CI_ONLY}`, async () => {
    const T = 'p1xp4'
    for (let i = 0; i < ROUNDS; i++) {
      const clock = setupClock(T)
      const inv = await makeDoc(kit, 'invoice', `r14-inv${i}`)
      clock(i, 'inv')
      const d1 = await typedDc(`r14-d1-${i}`)
      const d2 = await typedDc(`r14-d2-${i}`)
      clock(i, 'd1+d2')
      const pm = await kit.jwt('pm1')
      expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [d1.deliveryId] })).error).toBeNull()
      clock(i, 'jwt+first-link')
      const rs = await raceCalls(T, i, [
        ['reject-d1', () => pm.rpc('pm_reject_delivery', { p_delivery_id: d1.deliveryId, p_reason: 'ZZ race' })],
        ['link-d2', () => pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [d2.deliveryId] })],
      ])
      for (const r of rs) if (r.error) expect(r.error.code).not.toBe('40P01')
      await expectInvoiceInvariants(inv)
    }
  })

  it(`path 1 x path 2: linking while the last PM link is being removed (unlink-with-restore race) -> invariants hold${CI_ONLY}`, async () => {
    const T = 'p1xp2'
    for (let i = 0; i < ROUNDS; i++) {
      const clock = setupClock(T)
      const inv = await makeDoc(kit, 'invoice', `r12-inv${i}`)
      clock(i, 'inv')
      const d1 = await typedDc(`r12-d1-${i}`)
      const d2 = await typedDc(`r12-d2-${i}`)
      clock(i, 'd1+d2')
      const pm = await kit.jwt('pm1')
      expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [d1.deliveryId] })).error).toBeNull()
      const link = (await linksOfInvoice(kit, inv.docId)).find((l) => l.link_source === 'pm_manual')!
      clock(i, 'jwt+first-link')
      const rs = await raceCalls(T, i, [
        ['unlink', () => pm.rpc('pm_unlink_invoice', { p_link_id: link.id })],
        ['link-d2', () => pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [d2.deliveryId] })],
      ])
      for (const r of rs) if (r.error) expect(r.error.code).not.toBe('40P01')
      await expectInvoiceInvariants(inv)
    }
  })

  it(`path 5 x path 1: approving the automatic delivery while an invoice link is being made -> X6 holds (never a link over an approved automatic delivery)${CI_ONLY}`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const inv = await makeDoc(kit, 'invoice', `r51-inv${i}`)
      const dc = await typedDc(`r51-dc${i}`)
      const pm = await kit.jwt('pm1')
      await pm.rpc('pm_set_delivery_details', { p_delivery_id: inv.deliveryId, p_delivery_type: 'supplier', p_vehicle_number: null, p_dc_number: null, p_dc_date: null })
      const rs = await Promise.all([
        pm.rpc('pm_approve_delivery', { p_delivery_id: inv.deliveryId }),
        pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] }),
      ])
      for (const r of rs) if (r.error) expect(['QE011', 'QE005', 'QE008']).toContain(r.error.code)
      const auto = await getDelivery(kit, inv.deliveryId)
      const manual = (await linksOfInvoice(kit, inv.docId)).filter((l) => l.link_source === 'pm_manual' && l.unlinked_at === null)
      // never "approved AND linked away": either approved with its self-link, or cancelled by the link (the approve then failed)
      expect(auto.status === 'approved' && manual.length > 0).toBe(false)
      await expectInvoiceInvariants(inv)
    }
  })

  it(`path 6 x path 1: retyping a DC to internal transfer while it is being linked -> never both (QE006 / QE003 decide)${CI_ONLY}`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const inv = await makeDoc(kit, 'invoice', `r61-inv${i}`)
      const dc = await typedDc(`r61-dc${i}`)
      const pm = await kit.jwt('pm1')
      await Promise.all([
        pm.rpc('pm_set_delivery_details', { p_delivery_id: dc.deliveryId, p_delivery_type: 'internal_transfer', p_vehicle_number: null, p_dc_number: null, p_dc_date: null }),
        pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] }),
      ])
      const d = await getDelivery(kit, dc.deliveryId)
      const active = (await linksOfDelivery(kit, dc.deliveryId)).filter((l) => l.unlinked_at === null)
      expect(d.delivery_type === 'internal_transfer' && active.length > 0).toBe(false)
      await expectInvoiceInvariants(inv)
    }
  })
})

describe('engineer-side races', () => {
  it(`B1 race: the engineer's ack and a PM link of the same invoice at the same time -> the ack is always stored and no error is raised by either${CI_ONLY}`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const inv = await makeDoc(kit, 'invoice', `rb1-inv${i}`)
      const dc = await typedDc(`rb1-dc${i}`)
      const pm = await kit.jwt('pm1')
      const [a, l] = await Promise.all([
        ack(kit, inv, '1', `rb1-${i}`).then(
          (v) => ({ ok: true as const, v }),
          (e: unknown) => ({ ok: false as const, e }),
        ),
        pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] }),
      ])
      expect(a.ok).toBe(true)
      expect(l.error).toBeNull()
      const { data } = await kit.svc.from('capture_documents').select('engineer_ack').eq('id', inv.docId).single<{ engineer_ack: string | null }>()
      expect(data!.engineer_ack).toBe('yes')
      await expectInvoiceInvariants(inv)
    }
  })

  it(`duplicate-SID race: the same text SID delivered twice at once -> exactly one is processed, the other is a duplicate, no QE011${CI_ONLY}`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const d = await makeDoc(kit, 'dc', `rdup${i}`)
      const sid = kit.sid(`rdup${i}-ack`)
      const rs = await Promise.all([miTurnRaw(kit, d.phone, '1', sid), miTurnRaw(kit, d.phone, '1', sid)])
      for (const r of rs) expect(r.error).toBeNull()
      const outcomes = rs.map((r) => (r.data as { outcome: string }).outcome).sort()
      expect(outcomes).toEqual(['complete', 'duplicate'])
    }
  })

  it(`duplicate-SID race (file turn): the same file SID delivered twice at once -> one document, one set of files, one job${CI_ONLY}`, async () => {
    for (let i = 0; i < ROUNDS; i++) {
      const phone = kit.phone(`rdupf${i}`)
      await miTurnRaw(kit, phone, '4', kit.sid(`rdupf${i}-s0`), { start: true })
      await miTurnRaw(kit, phone, '1', kit.sid(`rdupf${i}-s1`))
      const sid = kit.sid(`rdupf${i}-s2`)
      const rs = await Promise.all([
        miTurnRaw(kit, phone, null, sid, { media: jpegMedia(1) }),
        miTurnRaw(kit, phone, null, sid, { media: jpegMedia(1) }),
      ])
      for (const r of rs) expect(r.error).toBeNull()
      const { data: docs } = await kit.svc.from('capture_documents').select('id').eq('source_message_sid', sid)
      const { data: jobs } = await kit.svc.from('jobs').select('id').eq('type', 'capture_ingest').contains('payload', { source_message_sid: sid })
      expect(docs).toHaveLength(1)
      expect(jobs).toHaveLength(1)
    }
  })

  it(`T-A27-6 a turn that reaches the RPC after expiry while the router clears the row (expire_stale) -> the row ends cleared, nothing raised, no document created${CI_ONLY}`, async () => {
    const base = noonIst()
    for (let i = 0; i < ROUNDS; i++) {
      const phone = kit.phone(`ra27-${i}`)
      await miTurnRaw(kit, phone, '4', kit.sid(`ra27-${i}-s0`), { start: true, now: base })
      await miTurnRaw(kit, phone, '1', kit.sid(`ra27-${i}-s1`), { now: base })
      const late = new Date(base.getTime() + 31 * 60 * 1000)
      const [t, e] = await Promise.all([
        miTurnRaw(kit, phone, null, kit.sid(`ra27-${i}-s2`), { media: jpegMedia(1), now: late }),
        kit.svc.rpc('expire_stale_material_inward', { p_phone_number: phone, p_now: late.toISOString() }),
      ])
      expect(t.error).toBeNull()
      expect(e.error).toBeNull()
      expect(['expired', 'idle']).toContain((t.data as { outcome: string }).outcome)
      expect(await getSession(kit, phone)).toMatchObject({ current_flow: null, current_step: 0 })
      const { data } = await kit.svc.from('capture_documents').select('id').eq('source_message_sid', kit.sid(`ra27-${i}-s2`))
      expect(data ?? []).toHaveLength(0)
    }
  })
})

describe('DOWN versus a live turn', () => {
  // The DOWN needs a table-owner connection (LOCK TABLE, DROP FUNCTION, CREATE OR REPLACE FUNCTION) and the DOWN
  // artifact; CI has only service_role over PostgREST, so this cannot run here. The race itself (EXCLUSIVE does not
  // deadlock, SHARE ROW EXCLUSIVE does, lock_timeout 3s gives up cleanly) is recorded from two real psql sessions on the
  // local scaffold in docs/reviews/050-sql-evidence/transcripts/S5-down.txt. That is rehearsal evidence, NOT a CI result.
  it.skip(`T-DOWN-1 concurrent-turn case (needs an owner connection; see the scaffold transcript)${CI_ONLY}`, () => {})
})
