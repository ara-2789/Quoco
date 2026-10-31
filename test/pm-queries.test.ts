import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import {
  buildPmKit,
  captureAnon,
  makeDocWithFile,
  negClient,
  readerOf,
  removeStoredObjects,
  teardownCaptureKit,
  type CaptureKit,
  type MadeDoc,
} from './helpers/pm-fixtures'
import { getDeliveryDetail, getMaterialInwardList } from '@/lib/capture/pm-queries'

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

beforeAll(async () => {
  kit = await buildPmKit('pmq')
  dcA1 = await makeDocWithFile(kit, 'dc', 'q-dca1', 'stored')
  invA1 = await makeDocWithFile(kit, 'invoice', 'q-inva1', 'pending')
  dcA2 = await makeDocWithFile(kit, 'dc', 'q-dca2', 'stored', { projectId: kit.p2, userId: kit.uid('engP2') })
  dcB = await makeDocWithFile(kit, 'dc', 'q-dcb', 'stored', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') })
})

afterAll(async () => {
  if (!kit) return
  await removeStoredObjects(kit)
  await teardownCaptureKit(kit)
})

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
