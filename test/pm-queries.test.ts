import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  ack,
  buildPmKit,
  captureAnon,
  deliveryRow,
  makeDocWithFile,
  negClient,
  readerOf,
  removeStoredObjects,
  teardownCaptureKit,
  type CaptureKit,
  type MadeDoc,
} from './helpers/pm-fixtures'
import { getDeliveryDetail, getMaterialInwardList } from '@/lib/capture/pm-queries'
import { runApprove, runSetDetails, type PmActionDeps } from '@/lib/capture/pm-actions'

// T-R-1..4 (PR-D): the PM page reads, through lib/capture/pm-queries.ts, with the signed-in user's client (never raw table
// selects). Shared test-db; every row belongs to this run's own tenants A and B (zz-test-capture-*).
//
// CONTROL: PM_CONTROL=service swaps the NEGATIVE actors' client for the service-role client (helpers/pm-fixtures.ts
// negClient). Negatives that rest on RLS must then go RED; that proves the assertions can fail.

let kit: CaptureKit
let dcA1: MadeDoc & { fileId: string }
let invA1: MadeDoc & { fileId: string }
let dcA2: MadeDoc & { fileId: string }
let dcB: MadeDoc & { fileId: string }

// HOOK TIMEOUT (this file only; vitest.config.ts is untouched). The 30 s default is too tight: setup builds the kit (six
// logins, ~11 s, measured in pm-file-route on 31 Oct) plus four documents (~2-3 s each), and in the first full run this
// file took 44.9 s of which ~15.8 s was test bodies, i.e. setup plus teardown ~29 s [inferred]. 90 s is a ceiling with
// headroom for a slower CI runner, not a target. One timing line per step makes any overrun attributable.
const HOOK_TIMEOUT_MS = 90_000

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    return await fn()
  } finally {
    console.log(`[pm-queries] ${label}: ${Date.now() - t0} ms`)
  }
}

// Kept so afterAll can wait for an in-flight (possibly timed-out) setup before cleaning up (see pm-file-route.test.ts).
let setup: Promise<void> | undefined

beforeAll(() => {
  setup = (async () => {
    kit = await timed('buildPmKit', () => buildPmKit('pmq'))
    dcA1 = await timed('makeDocWithFile q-dca1 (stored)', () => makeDocWithFile(kit, 'dc', 'q-dca1', 'stored'))
    invA1 = await timed('makeDocWithFile q-inva1 (invoice, pending)', () => makeDocWithFile(kit, 'invoice', 'q-inva1', 'pending'))
    dcA2 = await timed('makeDocWithFile q-dca2 (stored, P2)', () => makeDocWithFile(kit, 'dc', 'q-dca2', 'stored', { projectId: kit.p2, userId: kit.uid('engP2') }))
    dcB = await timed('makeDocWithFile q-dcb (stored, tenant B)', () => makeDocWithFile(kit, 'dc', 'q-dcb', 'stored', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') }))
  })()
  return setup
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  if (setup) await setup.catch(() => undefined)
  if (!kit) return
  await timed('removeStoredObjects', () => removeStoredObjects(kit))
  await timed('teardownCaptureKit', () => teardownCaptureKit(kit))
}, HOOK_TIMEOUT_MS)

const NOW = new Date()
const ids = (r: Awaited<ReturnType<typeof getMaterialInwardList>>) => (r.status === 'ok' ? r.items.map((i) => i.id) : [])

describe('T-R-1: PM-A1 reads project A1', () => {
  it('list: both A1 deliveries, nothing from A2 or tenant B', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm1'), readerOf(kit, 'pm1'), NOW)
    expect(r.status).toBe('ok')
    expect(ids(r)).toContain(dcA1.deliveryId)
    expect(ids(r)).toContain(invA1.deliveryId)
    expect(ids(r)).not.toContain(dcA2.deliveryId)
    expect(ids(r)).not.toContain(dcB.deliveryId)
  })
  it('detail: the DC delivery with its stored file, the invoice delivery with its pending file', async () => {
    const jwt = await kit.jwt('pm1')
    const a = await getDeliveryDetail(jwt, readerOf(kit, 'pm1'), dcA1.deliveryId, NOW)
    expect(a.status).toBe('ok')
    if (a.status === 'ok') {
      expect(a.detail.document.kind).toBe('dc')
      expect(a.detail.files.map((f) => f.display)).toEqual(['stored'])
      expect(a.detail.hasStoredFile).toBe(true)
      expect(a.detail.engineerName).toContain('ZZTestCapture-')
    }
    const b = await getDeliveryDetail(jwt, readerOf(kit, 'pm1'), invA1.deliveryId, NOW)
    expect(b.status).toBe('ok')
    if (b.status === 'ok') {
      expect(b.detail.document.kind).toBe('invoice')
      expect(b.detail.createdFromInvoice).toBe(true)
      expect(b.detail.files.map((f) => f.display)).toEqual(['pending'])
      expect(b.detail.hasStoredFile).toBe(false)
    }
  })
  it('detail with a non-uuid id is not-found and never reaches the or() filter', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), 'x,delivery_id.neq.0', NOW)
    expect(r.status).toBe('not-found')
  })
})

describe('T-R-2: other project (same tenant) and other tenant see none of A1', () => {
  it('PM-A2: own project only; A1 detail is not-found', async () => {
    const jwt = await negClient(kit, 'pm2')
    const r = await getMaterialInwardList(jwt, readerOf(kit, 'pm2'), NOW)
    expect(ids(r)).toContain(dcA2.deliveryId)
    expect(ids(r)).not.toContain(dcA1.deliveryId)
    expect(ids(r)).not.toContain(invA1.deliveryId)
    const d = await getDeliveryDetail(jwt, readerOf(kit, 'pm2'), dcA1.deliveryId, NOW)
    expect(d.status).toBe('not-found')
  })
  it('PM-B: tenant B only; A1 and A2 details are not-found', async () => {
    const jwt = await negClient(kit, 'pmB')
    const r = await getMaterialInwardList(jwt, readerOf(kit, 'pmB'), NOW)
    expect(ids(r)).toEqual([dcB.deliveryId])
    for (const d of [dcA1, invA1, dcA2]) {
      expect((await getDeliveryDetail(jwt, readerOf(kit, 'pmB'), d.deliveryId, NOW)).status).toBe('not-found')
    }
  })
  it('POSITIVE CONTROL: the owning PMs do see their own detail', async () => {
    expect((await getDeliveryDetail(await kit.jwt('pm2'), readerOf(kit, 'pm2'), dcA2.deliveryId, NOW)).status).toBe('ok')
    expect((await getDeliveryDetail(await kit.jwt('pmB'), readerOf(kit, 'pmB'), dcB.deliveryId, NOW)).status).toBe('ok')
  })
})

describe('T-R-3: a non-PM member and an inactive user see nothing', () => {
  it('qs member of A1 (role qs, not pm): not-a-pm, detail not-found', async () => {
    const jwt = await negClient(kit, 'qs')
    expect((await getMaterialInwardList(jwt, readerOf(kit, 'qs'), NOW)).status).toBe('not-a-pm')
    expect((await getDeliveryDetail(jwt, readerOf(kit, 'qs'), dcA1.deliveryId, NOW)).status).toBe('not-found')
  })
  it('deactivated PM of A1 (a pm membership exists, users.status = deactivated): zero rows, detail not-found', async () => {
    const jwt = await negClient(kit, 'deact')
    const r = await getMaterialInwardList(jwt, readerOf(kit, 'deact'), NOW)
    expect(r.status).toBe('ok')
    expect(ids(r)).toEqual([])
    expect((await getDeliveryDetail(jwt, readerOf(kit, 'deact'), dcA1.deliveryId, NOW)).status).toBe('not-found')
  })
})

describe('T-R-4: anon sees nothing', () => {
  it('an anon-key client with no session: no rows, no detail', async () => {
    const anon = captureAnon()
    const r = await getMaterialInwardList(anon, readerOf(kit, 'pm1'), NOW)
    expect(r.status === 'ok' ? r.items.length : 0).toBe(0)
    expect((await getDeliveryDetail(anon, readerOf(kit, 'pm1'), dcA1.deliveryId, NOW)).status).not.toBe('ok')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// C3: list order. incomplete / awaiting_pm first, then the rest; newest received_at first inside each group; the cap is
// applied to that order. Project P2 (PM-A2): the beforeAll's own dcA2 (incomplete, received at the suite's noon base) plus
// three documents made here with explicit past `received_at` values:
//   oldAwait  awaiting_pm, 10 days ago   (the one the old date-only order loses)
//   n1        approved,     1 day ago
//   n2        approved,     2 hours ago
// ---------------------------------------------------------------------------------------------------------------
describe('C3: an old awaiting_pm delivery is not pushed off the capped list by newer approved ones', () => {
  const day = 24 * 3600 * 1000
  let oldAwait: MadeDoc & { fileId: string }
  let n1: MadeDoc & { fileId: string }
  let n2: MadeDoc & { fileId: string }
  const asPm2 = async (): Promise<PmActionDeps> => ({
    client: (await kit.jwt('pm2')) as unknown as PmActionDeps['client'],
    profile: readerOf(kit, 'pm2'),
  })

  async function approve(d: MadeDoc) {
    const row = await deliveryRow(kit, d.deliveryId)
    const set = await runSetDetails(await asPm2(), {
      deliveryId: d.deliveryId,
      loaded: { status: row.status as string, deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null },
      next: { deliveryType: 'supplier', vehicleNumber: null, dcNumber: null, dcDate: null },
    })
    expect(set).toEqual({ status: 'ok' })
    expect(await runApprove(await asPm2(), { deliveryId: d.deliveryId })).toEqual({ status: 'ok' })
  }

  beforeAll(async () => {
    await setup // the main setup (and kit) must exist first
    const t = Date.now()
    const p2 = { projectId: kit.p2, userId: kit.uid('engP2') }
    oldAwait = await timed('c3 oldAwait doc', () => makeDocWithFile(kit, 'dc', 'q-c3-old', 'stored', { ...p2, now: new Date(t - 10 * day) }))
    await timed('c3 oldAwait ack', () => ack(kit, oldAwait, '1', 'q-c3-old', new Date(t - 10 * day)))
    n1 = await timed('c3 n1 doc', () => makeDocWithFile(kit, 'dc', 'q-c3-n1', 'stored', { ...p2, now: new Date(t - 1 * day) }))
    n2 = await timed('c3 n2 doc', () => makeDocWithFile(kit, 'dc', 'q-c3-n2', 'stored', { ...p2, now: new Date(t - 2 * 3600 * 1000) }))
    await timed('c3 approve n1', () => approve(n1))
    await timed('c3 approve n2', () => approve(n2))
  }, HOOK_TIMEOUT_MS)

  it('the fixture is what the test says it is (statuses)', async () => {
    expect((await deliveryRow(kit, oldAwait.deliveryId)).status).toBe('awaiting_pm')
    expect((await deliveryRow(kit, n1.deliveryId)).status).toBe('approved')
    expect((await deliveryRow(kit, n2.deliveryId)).status).toBe('approved')
    expect((await deliveryRow(kit, dcA2.deliveryId)).status).toBe('incomplete')
  })

  it('limit 2: the open deliveries fill the cap (dcA2, then the OLD awaiting_pm one); newer approved ones do not push it off', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW, { limit: 2 })
    expect(r.status).toBe('ok')
    expect(ids(r)).toEqual([dcA2.deliveryId, oldAwait.deliveryId])
    expect(ids(r)).not.toContain(n1.deliveryId)
    expect(ids(r)).not.toContain(n2.deliveryId)
    expect(r.status === 'ok' && r.truncated).toBe(true)
  })

  it('limit 3: the old awaiting_pm delivery is ahead of the newer approved one; groups newest-first', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW, { limit: 3 })
    expect(ids(r)).toEqual([dcA2.deliveryId, oldAwait.deliveryId, n2.deliveryId])
    expect(r.status === 'ok' && r.truncated).toBe(true) // n1 is still beyond the cap
  })

  it('limit 4 holds everything in P2, open group first, then approved newest first, and is not truncated', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW, { limit: 4 })
    expect(ids(r)).toEqual([dcA2.deliveryId, oldAwait.deliveryId, n2.deliveryId, n1.deliveryId])
    expect(r.status === 'ok' && r.truncated).toBe(false)
  })

  it('POSITIVE CONTROL: the OLD date-only order with the same cap would have dropped it', async () => {
    // the previous implementation: one query, newest received_at first, limit 2
    const { data, error } = await (await kit.jwt('pm2'))
      .from('deliveries')
      .select('id')
      .eq('project_id', kit.p2)
      .order('received_at', { ascending: false })
      .limit(2)
    expect(error).toBeNull()
    expect((data ?? []).map((d: { id: string }) => d.id)).not.toContain(oldAwait.deliveryId)
    // while the new order keeps it (previous test): the two differ exactly on this row
  })

  it('the default cap is the documented 100', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW)
    expect(ids(r)).toHaveLength(4) // dcA2, oldAwait, n1, n2: all of P2 fits under 100
  })
})
