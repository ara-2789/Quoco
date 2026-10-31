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
import { runApprove, runLink, runReject, runSetDetails, type PmActionDeps } from '@/lib/capture/pm-actions'

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
// Helpers for the C3 / picker blocks: act as a PM with an injected client, and read back received_at / status with the
// service client (read only). Nothing is written outside the kit's own flow.
// ---------------------------------------------------------------------------------------------------------------
const actAs = async (label: 'pm1' | 'pm2'): Promise<PmActionDeps> => ({
  client: (await kit.jwt(label)) as unknown as PmActionDeps['client'],
  profile: readerOf(kit, label),
})

/** Set a type (so approval is possible) and approve a delivery as the given PM. */
async function approveAs(label: 'pm1' | 'pm2', deliveryId: string) {
  const row = await deliveryRow(kit, deliveryId)
  const set = await runSetDetails(await actAs(label), {
    deliveryId,
    loaded: { status: row.status as string, deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null },
    next: { deliveryType: 'supplier', vehicleNumber: null, dcNumber: null, dcDate: null },
  })
  expect(set).toEqual({ status: 'ok' })
  expect(await runApprove(await actAs(label), { deliveryId })).toEqual({ status: 'ok' })
}

async function listFacts(deliveryIds: string[]) {
  const { data, error } = await kit.svc.from('deliveries').select('id, status, received_at').in('id', deliveryIds)
  if (error) throw new Error(`listFacts failed: ${error.message}`)
  return new Map((data ?? []).map((r: { id: string; status: string; received_at: string }) => [r.id, r]))
}

/** open (incomplete/awaiting_pm) rows first; inside each group received_at never increases down the list. */
async function expectGroupOrder(listedIds: string[]) {
  const facts = await listFacts(listedIds)
  const isOpen = (id: string) => ['incomplete', 'awaiting_pm'].includes(facts.get(id)!.status)
  let seenNonOpen = false
  for (let i = 0; i < listedIds.length; i++) {
    const open = isOpen(listedIds[i])
    if (!open) seenNonOpen = true
    expect(open && seenNonOpen, `open delivery ${listedIds[i]} listed after a non-open one`).toBe(false)
    if (i > 0 && isOpen(listedIds[i - 1]) === open) {
      expect(
        new Date(facts.get(listedIds[i - 1])!.received_at).getTime(),
        `received_at must not increase within a group (${listedIds[i - 1]} then ${listedIds[i]})`,
      ).toBeGreaterThanOrEqual(new Date(facts.get(listedIds[i])!.received_at).getTime())
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// E1 / C3: list order. incomplete / awaiting_pm first, then the rest; newest received_at first inside each group; the cap is
// applied to that order. `received_at` is processed_messages.created_at of the file message (050:315-318), i.e. the REAL
// insert time, so the only way to make a delivery old is to create it first. Project P2 (PM-A2), in creation order:
//   dcA2      (main beforeAll) incomplete -> approved here, so it leaves the open group
//   oldAwait  awaiting_pm, created FIRST of the C3 documents  -> the oldest received_at of the open group (and its only member)
//   n1, n2    approved, created after it                      -> both NEWER than oldAwait
// With limit 2 the date-only order is [n2, n1] and loses oldAwait; the grouped order is [oldAwait, n2].
// ---------------------------------------------------------------------------------------------------------------
describe('C3: an old awaiting_pm delivery is not pushed off the capped list by newer approved ones', () => {
  let oldAwait: MadeDoc & { fileId: string }
  let n1: MadeDoc & { fileId: string }
  let n2: MadeDoc & { fileId: string }

  beforeAll(async () => {
    await setup // the main setup (and the kit) must exist first
    const p2 = { projectId: kit.p2, userId: kit.uid('engP2') }
    oldAwait = await timed('c3 oldAwait doc (created first)', () => makeDocWithFile(kit, 'dc', 'q-c3-old', 'stored', p2))
    await timed('c3 oldAwait ack', () => ack(kit, oldAwait, '1', 'q-c3-old'))
    await timed('c3 approve dcA2', () => approveAs('pm2', dcA2.deliveryId))
    n1 = await timed('c3 n1 doc', () => makeDocWithFile(kit, 'dc', 'q-c3-n1', 'stored', p2))
    n2 = await timed('c3 n2 doc', () => makeDocWithFile(kit, 'dc', 'q-c3-n2', 'stored', p2))
    await timed('c3 approve n1', () => approveAs('pm2', n1.deliveryId))
    await timed('c3 approve n2', () => approveAs('pm2', n2.deliveryId))
  }, HOOK_TIMEOUT_MS)

  it('the fixture is what the test says it is: statuses, and oldAwait has the OLDEST real received_at', async () => {
    const facts = await listFacts([oldAwait.deliveryId, n1.deliveryId, n2.deliveryId, dcA2.deliveryId])
    expect(facts.get(oldAwait.deliveryId)!.status).toBe('awaiting_pm')
    for (const d of [n1, n2, dcA2]) expect(facts.get(d.deliveryId)!.status).toBe('approved')
    const t = (id: string) => new Date(facts.get(id)!.received_at).getTime()
    expect(t(oldAwait.deliveryId), 'oldAwait must be older than n1').toBeLessThan(t(n1.deliveryId))
    expect(t(n1.deliveryId), 'n1 must be older than n2').toBeLessThan(t(n2.deliveryId))
  })

  it('(a) limit 2: the old open delivery is FIRST, the newest approved one follows, and the list is marked truncated', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW, { limit: 2 })
    expect(r.status).toBe('ok')
    expect(ids(r)).toEqual([oldAwait.deliveryId, n2.deliveryId])
    expect(ids(r)).not.toContain(n1.deliveryId)
    expect(ids(r)).not.toContain(dcA2.deliveryId)
    expect(r.status === 'ok' && r.truncated).toBe(true)
  })

  it('limit 3: open first, then approved newest-first (n2, then n1); still truncated (dcA2 is beyond the cap)', async () => {
    const r = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW, { limit: 3 })
    expect(ids(r)).toEqual([oldAwait.deliveryId, n2.deliveryId, n1.deliveryId])
    expect(r.status === 'ok' && r.truncated).toBe(true)
  })

  it('limit 4 holds all of P2 and is not truncated; the default cap shows the same four', async () => {
    const r4 = await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW, { limit: 4 })
    expect(ids(r4)).toEqual([oldAwait.deliveryId, n2.deliveryId, n1.deliveryId, dcA2.deliveryId])
    expect(r4.status === 'ok' && r4.truncated).toBe(false)
    expect(ids(await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW))).toEqual(ids(r4))
  })

  it('within the open group the order is newest received_at first (P1 has two open deliveries); groups never interleave', async () => {
    const list = await getMaterialInwardList(await kit.jwt('pm1'), readerOf(kit, 'pm1'), NOW)
    const listed = ids(list)
    expect(listed).toContain(dcA1.deliveryId)
    expect(listed).toContain(invA1.deliveryId) // both incomplete: dcA1 was created before invA1
    expect(listed.indexOf(invA1.deliveryId)).toBeLessThan(listed.indexOf(dcA1.deliveryId))
    await expectGroupOrder(listed)
    await expectGroupOrder(ids(await getMaterialInwardList(await kit.jwt('pm2'), readerOf(kit, 'pm2'), NOW)))
  })

  it('POSITIVE CONTROL (data form): the date-only order with the same cap DOES drop it, because n1 and n2 are newer', async () => {
    const { data, error } = await (await kit.jwt('pm2'))
      .from('deliveries')
      .select('id')
      .eq('project_id', kit.p2)
      .order('received_at', { ascending: false })
      .limit(2)
    expect(error).toBeNull()
    expect((data ?? []).map((d: { id: string }) => d.id)).toEqual([n2.deliveryId, n1.deliveryId])
    // The mutation form (swap the comparator in pm-queries.ts so this file goes RED at test (a)) is the controls run.
  })
})

// ---------------------------------------------------------------------------------------------------------------
// E2 / E3: link pickers. Project P1, in creation order (dcA1 and invA1 come from the main setup and are the OLDEST):
//   x1  DC, internal_transfer           ineligible (QE003)
//   x2  DC, rejected                    ineligible (QE005)
//   x3  DC, linked to inv2              ineligible (already has its one active link, QE008)
//   inv2        invoice, linked to x3 (its automatic delivery is cancelled by the link)
//   invApproved invoice whose automatic delivery is APPROVED (linking it would fail with QE011)
// ---------------------------------------------------------------------------------------------------------------
describe('E2/E3: link pickers apply every eligibility rule BEFORE the cap', () => {
  let x1: MadeDoc & { fileId: string }
  let x2: MadeDoc & { fileId: string }
  let x3: MadeDoc & { fileId: string }
  let inv2: MadeDoc & { fileId: string }
  let invApproved: MadeDoc & { fileId: string }

  beforeAll(async () => {
    await setup
    x1 = await timed('picker x1 doc', () => makeDocWithFile(kit, 'dc', 'q-p-x1', 'stored'))
    x2 = await timed('picker x2 doc', () => makeDocWithFile(kit, 'dc', 'q-p-x2', 'stored'))
    x3 = await timed('picker x3 doc', () => makeDocWithFile(kit, 'dc', 'q-p-x3', 'stored'))
    inv2 = await timed('picker inv2 doc', () => makeDocWithFile(kit, 'invoice', 'q-p-inv2', 'stored'))
    invApproved = await timed('picker invApproved doc', () => makeDocWithFile(kit, 'invoice', 'q-p-invok', 'stored'))
    const set = await runSetDetails(await actAs('pm1'), {
      deliveryId: x1.deliveryId,
      loaded: { status: 'incomplete', deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null },
      next: { deliveryType: 'internal_transfer', vehicleNumber: null, dcNumber: null, dcDate: null },
    })
    expect(set).toEqual({ status: 'ok' })
    expect(await runReject(await actAs('pm1'), { deliveryId: x2.deliveryId, reason: 'ZZTestCapture picker' })).toEqual({ status: 'ok' })
    expect(await runLink(await actAs('pm1'), { invoiceDocumentId: inv2.docId, deliveryIds: [x3.deliveryId] })).toEqual({ status: 'ok' })
    await timed('picker approve invApproved auto delivery', () => approveAs('pm1', invApproved.deliveryId))
  }, HOOK_TIMEOUT_MS)

  const candidateIds = (r: Awaited<ReturnType<typeof getDeliveryDetail>>) => (r.status === 'ok' ? r.detail.candidates.map((c) => c.id) : [])

  it('E2: invoice page, cap 2, THREE ineligible DCs are newer than the one eligible DC: the older eligible DC is still offered', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), invA1.deliveryId, NOW, { candidateLimit: 2 })
    expect(r.status).toBe('ok')
    expect(candidateIds(r)).toEqual([dcA1.deliveryId])
    for (const x of [x1, x2, x3]) expect(candidateIds(r)).not.toContain(x.deliveryId)
  })

  it('POSITIVE CONTROL (data form): the previous query shape (cap first, filters afterwards) would have offered nothing here', async () => {
    const { data, error } = await (await kit.jwt('pm1'))
      .from('deliveries')
      .select('id, delivery_type')
      .eq('project_id', kit.p1)
      .not('dc_document_id', 'is', null)
      .not('status', 'in', '(rejected,cancelled)')
      .order('received_at', { ascending: false })
      .limit(2)
    expect(error).toBeNull()
    const top = (data ?? []) as Array<{ id: string; delivery_type: string | null }>
    expect(top.map((t) => t.id)).not.toContain(dcA1.deliveryId) // dcA1 is cut by the cap...
    expect(top.map((t) => t.id).sort()).toEqual([x1.deliveryId, x3.deliveryId].sort()) // ...behind two rows that are not eligible
  })

  it('E2: with the default cap the picker holds exactly the eligible DC (an internal transfer, a rejected DC and a linked DC are all out)', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), invA1.deliveryId, NOW)
    expect(candidateIds(r)).toEqual([dcA1.deliveryId])
  })

  it('E3: DC page: the invoice whose automatic delivery is APPROVED is not offered; the others are', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), dcA1.deliveryId, NOW)
    expect(r.status).toBe('ok')
    expect(candidateIds(r)).not.toContain(invApproved.docId)
    expect(candidateIds(r)).toContain(invA1.docId)
    expect(candidateIds(r)).toContain(inv2.docId) // already linked elsewhere is allowed (many-to-many); its auto delivery is cancelled, not approved
  })

  it('E3: the exclusion happens BEFORE the cap: with cap 1 the newest invoice is the approved one, and it is skipped for the next', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), dcA1.deliveryId, NOW, { candidateLimit: 1 })
    expect(candidateIds(r)).toEqual([inv2.docId])
  })

  it('POSITIVE CONTROL: the approved-automatic invoice really is newer than the one offered, and really is approved', async () => {
    const { data } = await kit.svc.from('capture_documents').select('id, created_at').in('id', [inv2.docId, invApproved.docId])
    const at = new Map((data ?? []).map((r: { id: string; created_at: string }) => [r.id, new Date(r.created_at).getTime()]))
    expect(at.get(invApproved.docId)!).toBeGreaterThan(at.get(inv2.docId)!)
    expect((await deliveryRow(kit, invApproved.deliveryId)).status).toBe('approved')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// F1: the invoice-page DC picker when the "no active link" list is EMPTY. That filter is
// `.not('id','in', <active-link delivery ids of the project>)`; an empty list would be `not.in.()`. The code skips the filter
// when the list is empty (pm-queries.ts, `if (takenIds.length > 0)`); this proves the empty case against PostgREST.
// An invoice normally has an active self-link (its automatic delivery points at it), so the list is empty only when the
// viewed invoice's own delivery has been REJECTED (rejection soft-unlinks the self-link, 050 reject path 3) and nothing else in
// the project is linked. Project P3 (tenant B, PM-B): the beforeAll's dcB (a DC, incomplete, no link) plus an invoice made
// here and rejected. No pm_manual link is ever created in P3.
// ---------------------------------------------------------------------------------------------------------------
describe('F1: the invoice-page picker when the project has no active links at all', () => {
  let invB: MadeDoc & { fileId: string }

  beforeAll(async () => {
    await setup
    invB = await timed('f1 invoice in P3', () =>
      makeDocWithFile(kit, 'invoice', 'q-f1-invb', 'stored', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') }),
    )
    const rejected = await runReject(
      { client: (await kit.jwt('pmB')) as unknown as PmActionDeps['client'], profile: readerOf(kit, 'pmB') },
      { deliveryId: invB.deliveryId, reason: 'ZZTestCapture f1' },
    )
    expect(rejected).toEqual({ status: 'ok' })
  }, HOOK_TIMEOUT_MS)

  it('premise: project P3 has NO active link of any kind (so the not-in list is empty)', async () => {
    const { data, error } = await kit.svc.from('delivery_invoice_links').select('id, link_source').eq('project_id', kit.p3).is('unlinked_at', null)
    expect(error).toBeNull()
    expect(data ?? []).toEqual([])
  })

  it('the DC is offered and no error comes back (the not-in filter is skipped when the list is empty)', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pmB'), readerOf(kit, 'pmB'), invB.deliveryId, NOW)
    expect(r.status).toBe('ok') // 'error' would mean a read failed, e.g. a malformed not.in.() filter
    expect(r.status === 'ok' ? r.detail.candidates.map((c) => c.id) : []).toEqual([dcB.deliveryId])
  })

  it('same result with a small injected cap', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pmB'), readerOf(kit, 'pmB'), invB.deliveryId, NOW, { candidateLimit: 1 })
    expect(r.status === 'ok' ? r.detail.candidates.map((c) => c.id) : []).toEqual([dcB.deliveryId])
  })
})
