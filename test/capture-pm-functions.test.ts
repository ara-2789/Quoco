// PR-B (migration 050): the five PM-side functions, over REAL PostgREST calls with real JWTs. NOT YET RUN: 050 is not
// applied to test-db (typechecked only until it is). Plan: docs/plans/pr-b-050-plan.md rev 6, section 11.
//
// Test IDs covered here: T-F5-1/2/3 (+ B2 audience, identical QE015), T-F5-SAME, T-S1-FOREIGN-ID, T-S1-ARRAY-SHAPE,
// T-S1-UNLINK, T-A28-2/4/5, T-Q3-1, T-LINK-1, T-D10-APPROVE-INCOMPLETE, QE016/QE017/QE011, T-B1-*-THEN-ACK,
// 049 package section 10: E8 -> QE008, "one QE code reaches supabase-js as error.code", Q-2 probe 4, and vitest
// cases c, d, f (helper insert, tenant guard, N-4 E12 via the helper).
//
// T-E8-RERAISE needs a REHEARSAL-ONLY planted unique index (CREATE INDEX needs table-owner rights, which CI does not
// have: service_role cannot DDL). It is skipped here with that reason; its evidence is the local PG17 scaffold run,
// docs/reviews/050-sql-evidence/transcripts/S4-pm.txt (green) and S4-pm-MUTANT-swallow.txt (the RED).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import { randomUUID } from 'node:crypto'
import { getRunId } from './helpers/run-scoped-fixtures'
import {
  ack,
  buildCaptureKit,
  captureAnon,
  getDelivery,
  getDoc,
  linksOfDelivery,
  linksOfInvoice,
  makeDoc,
  teardownCaptureKit,
  type CaptureKit,
  type CaptureUserLabel,
  type MadeDoc,
} from './helpers/capture-fixtures'

let kit: CaptureKit
const jwts = new Map<CaptureUserLabel, SupabaseClient>()
async function as(label: CaptureUserLabel): Promise<SupabaseClient> {
  const hit = jwts.get(label)
  if (hit) return hit
  const c = await kit.jwt(label)
  jwts.set(label, c)
  return c
}

beforeAll(async () => {
  kit = await buildCaptureKit('pm-functions', ['eng', 'engB', 'pm1', 'pm2', 'pmB', 'qs', 'deact', 'pend', 'admNon', 'admMem'])
})

afterAll(async () => {
  if (kit) await teardownCaptureKit(kit)
})

async function setDetails(label: CaptureUserLabel, deliveryId: string, type: string | null = 'supplier') {
  return (await as(label)).rpc('pm_set_delivery_details', {
    p_delivery_id: deliveryId,
    p_delivery_type: type,
    p_vehicle_number: 'ZZ-TN01',
    p_dc_number: `ZZ-${kit.runTag.slice(0, 8)}`,
    p_dc_date: '2026-10-01',
  })
}

/** A DC delivery with its type set, still unacknowledged (incomplete). */
async function typedDc(label: string, type: string | null = 'supplier'): Promise<MadeDoc> {
  const d = await makeDoc(kit, 'dc', label)
  if (type) {
    const r = await setDetails('pm1', d.deliveryId, type)
    expect(r.error).toBeNull()
  }
  return d
}

/** Q-2 probe 4: links unlinked as delivery_rejected whose delivery is NOT rejected must be 0 after every path. */
async function probe4(): Promise<number> {
  const { data: links, error } = await kit.svc
    .from('delivery_invoice_links')
    .select('delivery_id')
    .in('tenant_id', [kit.tenantA, kit.tenantB])
    .eq('unlink_reason', 'delivery_rejected')
  expect(error).toBeNull()
  let bad = 0
  for (const l of (links ?? []) as Array<{ delivery_id: string }>) {
    if ((await getDelivery(kit, l.delivery_id)).status !== 'rejected') bad++
  }
  return bad
}

const noDeliveryFound = randomUUID()

describe('T-F5-1/2/3 + B2 audience: every refusal inside the five pm_* functions is QE015', () => {
  let dcTarget: MadeDoc
  let invTarget: MadeDoc
  let selfLinkId: string
  let foreignProject: MadeDoc
  let foreignTenant: MadeDoc

  beforeAll(async () => {
    dcTarget = await typedDc('f5-dc')
    invTarget = await makeDoc(kit, 'invoice', 'f5-inv')
    selfLinkId = (await linksOfInvoice(kit, invTarget.docId))[0].id
    foreignProject = await makeDoc(kit, 'dc', 'f5-foreign-p2', { projectId: kit.p2 })
    foreignTenant = await makeDoc(kit, 'dc', 'f5-foreign-b', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') })
  })

  const FNS: Array<{ fn: string; args: () => Record<string, unknown> }> = [
    { fn: 'pm_set_delivery_details', args: () => ({ p_delivery_id: dcTarget.deliveryId, p_delivery_type: 'internal_transfer', p_vehicle_number: null, p_dc_number: null, p_dc_date: null }) },
    { fn: 'pm_approve_delivery', args: () => ({ p_delivery_id: dcTarget.deliveryId }) },
    { fn: 'pm_reject_delivery', args: () => ({ p_delivery_id: dcTarget.deliveryId, p_reason: 'ZZ refused' }) },
    { fn: 'pm_link_invoice', args: () => ({ p_invoice_document_id: invTarget.docId, p_delivery_ids: [dcTarget.deliveryId] }) },
    { fn: 'pm_unlink_invoice', args: () => ({ p_link_id: selfLinkId }) },
  ]
  const BAD_CALLERS: CaptureUserLabel[] = ['pm2', 'pmB', 'qs', 'deact', 'pend', 'admNon']

  for (const { fn, args } of FNS) {
    for (const who of BAD_CALLERS) {
      it(`${fn}: ${who} is refused QE015 and the rows are unchanged`, async () => {
        const before = await getDelivery(kit, dcTarget.deliveryId)
        const beforeInv = await getDelivery(kit, invTarget.deliveryId)
        const { data, error } = await (await as(who)).rpc(fn, args())
        expect(data).toBeNull()
        expect(error?.code).toBe('QE015')
        expect(await getDelivery(kit, dcTarget.deliveryId)).toEqual(before)
        expect(await getDelivery(kit, invTarget.deliveryId)).toEqual(beforeInv)
      })
    }

    it(`${fn}: anon is refused 42501 (a real anon-key call) and service_role is refused 42501`, async () => {
      const a = await captureAnon().rpc(fn, args())
      expect(a.error?.code).toBe('42501')
      const s = await kit.svc.rpc(fn, args())
      expect(s.error?.code).toBe('42501')
    })
  }

  it('T-F5-SAME the refusal is IDENTICAL for a nonexistent id, an id in another tenant and an id in another project', async () => {
    const pm = await as('pm1')
    const calls = await Promise.all([
      pm.rpc('pm_approve_delivery', { p_delivery_id: noDeliveryFound }),
      pm.rpc('pm_approve_delivery', { p_delivery_id: foreignProject.deliveryId }),
      pm.rpc('pm_approve_delivery', { p_delivery_id: foreignTenant.deliveryId }),
    ])
    const shape = calls.map((c) => ({ code: c.error?.code, message: c.error?.message, details: c.error?.details, hint: c.error?.hint }))
    expect(shape[0].code).toBe('QE015')
    expect(shape[1]).toEqual(shape[0])
    expect(shape[2]).toEqual(shape[0])
    // the refusal carries no row data: DETAIL is empty / absent and the message names no id
    expect(JSON.stringify(shape[0])).not.toContain(foreignTenant.deliveryId)
    // and the foreign rows are unchanged
    expect((await getDelivery(kit, foreignProject.deliveryId)).status).toBe('incomplete')
    expect((await getDelivery(kit, foreignTenant.deliveryId)).status).toBe('incomplete')
  })

  it('049 package section 10 item 3: ONE QE code reaches supabase-js as error.code (not a PGRST wrapper)', async () => {
    const { error } = await (await as('pm1')).rpc('pm_approve_delivery', { p_delivery_id: noDeliveryFound })
    expect(error?.code).toBe('QE015')
    expect(error?.code?.startsWith('PGRST')).toBe(false)
  })

  it('B2 positive controls: a PM member and an admin who is also a PM member both succeed', async () => {
    const own = await makeDoc(kit, 'dc', 'f5-ok')
    const r1 = await setDetails('pm1', own.deliveryId)
    expect(r1.error).toBeNull()
    const r2 = await setDetails('admMem', own.deliveryId, 'internal_transfer')
    expect(r2.error).toBeNull()
    expect((await getDelivery(kit, own.deliveryId)).delivery_type).toBe('internal_transfer')
  })
})

describe('T-S1 array shape and ownership of pm_link_invoice: QE015 for the whole call, nothing locked or written', () => {
  let inv: MadeDoc
  let dc: MadeDoc
  let foreignProject: MadeDoc
  let foreignTenant: MadeDoc

  beforeAll(async () => {
    inv = await makeDoc(kit, 'invoice', 's1-inv')
    dc = await typedDc('s1-dc')
    foreignProject = await makeDoc(kit, 'dc', 's1-foreign-p2', { projectId: kit.p2 })
    foreignTenant = await makeDoc(kit, 'dc', 's1-foreign-b', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') })
  })

  async function untouched() {
    expect((await getDelivery(kit, inv.deliveryId)).status).toBe('incomplete')
    const links = await linksOfInvoice(kit, inv.docId)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ link_source: 'created_from_invoice', unlinked_at: null })
  }

  const link = async (ids: unknown) => (await as('pm1')).rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: ids })

  it('T-S1-FOREIGN-ID a delivery of another project is QE015, NOT an FK 23503', async () => {
    const r = await link([foreignProject.deliveryId])
    expect(r.error?.code).toBe('QE015')
    await untouched()
  })

  it('T-S1-FOREIGN-ID a delivery of another tenant is QE015, NOT an FK 23503', async () => {
    const r = await link([foreignTenant.deliveryId])
    expect(r.error?.code).toBe('QE015')
    await untouched()
  })

  it('T-S1-FOREIGN-ID one good id plus one foreign id: the whole call is refused, the good id is not linked', async () => {
    const r = await link([dc.deliveryId, foreignProject.deliveryId])
    expect(r.error?.code).toBe('QE015')
    await untouched()
    expect(await linksOfDelivery(kit, dc.deliveryId)).toHaveLength(0)
  })

  it.each([
    ['an empty array', () => [] as unknown[]],
    ['a NULL element', () => [dc.deliveryId, null]],
    ['a duplicate id', () => [dc.deliveryId, dc.deliveryId]],
    ['21 ids (cap 20)', () => Array.from({ length: 21 }, () => randomUUID())],
  ])('T-S1-ARRAY-SHAPE %s -> QE015, nothing cancelled', async (_name, ids) => {
    const r = await link(ids())
    expect(r.error?.code).toBe('QE015')
    await untouched()
  })

  it('T-S1-ARRAY-SHAPE a NULL array and a nonexistent invoice -> QE015', async () => {
    const pm = await as('pm1')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: null })).error?.code).toBe('QE015')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: randomUUID(), p_delivery_ids: [dc.deliveryId] })).error?.code).toBe('QE015')
    await untouched()
  })

  it('T-LINK-1 a non-invoice document id (a DC document) as the invoice is refused QE015', async () => {
    const r = await (await as('pm1')).rpc('pm_link_invoice', { p_invoice_document_id: dc.docId, p_delivery_ids: [dc.deliveryId] })
    expect(r.error?.code).toBe('QE015')
  })

  it('T-S1-UNLINK a nonexistent link id, another project\'s link and another tenant\'s link give the identical QE015', async () => {
    const otherInv = await makeDoc(kit, 'invoice', 's1-unlink-other', { projectId: kit.p2 })
    const otherLink = (await linksOfInvoice(kit, otherInv.docId))[0].id
    const pm = await as('pm1')
    const a = await pm.rpc('pm_unlink_invoice', { p_link_id: randomUUID() })
    const b = await pm.rpc('pm_unlink_invoice', { p_link_id: otherLink })
    expect(a.error?.code).toBe('QE015')
    expect({ code: b.error?.code, message: b.error?.message }).toEqual({ code: a.error?.code, message: a.error?.message })
  })
})

describe('pm_link_invoice / pm_unlink_invoice behaviour (T-A28-2/4/5, T-LINK-1, E8)', () => {
  it('T-A28-2 link to two DC deliveries: two pm_manual rows, the automatic delivery cancelled (superseded_by_link) in the same call, self-link soft-unlinked with the snapshot', async () => {
    const inv = await makeDoc(kit, 'invoice', 'a28-2-inv')
    const d1 = await typedDc('a28-2-d1')
    const d2 = await typedDc('a28-2-d2')
    const r = await (await as('pm1')).rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [d2.deliveryId, d1.deliveryId] })
    expect(r.error).toBeNull()
    const links = await linksOfInvoice(kit, inv.docId)
    const manual = links.filter((l) => l.link_source === 'pm_manual' && l.unlinked_at === null)
    expect(manual.map((l) => l.delivery_id).sort()).toEqual([d1.deliveryId, d2.deliveryId].sort())
    expect(manual.every((l) => l.linked_by === kit.uid('pm1'))).toBe(true)
    const auto = await getDelivery(kit, inv.deliveryId)
    expect(auto).toMatchObject({ status: 'cancelled', cancel_reason: 'superseded_by_link' })
    expect(auto.cancelled_at).not.toBeNull()
    const self = links.find((l) => l.link_source === 'created_from_invoice')!
    expect(self).toMatchObject({ unlink_reason: 'superseded_by_link', superseded_from_status: 'incomplete' })
  })

  it('E8 -> QE008 (049 package section 10 item 2) and T-A28-2 control: a second invoice linking an already-linked DC fails QE008 and cancels NOTHING', async () => {
    const invA = await makeDoc(kit, 'invoice', 'e8-invA')
    const invB = await makeDoc(kit, 'invoice', 'e8-invB')
    const dc = await typedDc('e8-dc')
    const pm = await as('pm1')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: invA.docId, p_delivery_ids: [dc.deliveryId] })).error).toBeNull()
    const r = await pm.rpc('pm_link_invoice', { p_invoice_document_id: invB.docId, p_delivery_ids: [dc.deliveryId] })
    expect(r.error?.code).toBe('QE008')
    // the whole call rolled back: B's automatic delivery is NOT cancelled and its self-link is still active
    expect((await getDelivery(kit, invB.deliveryId)).status).toBe('incomplete')
    const links = await linksOfInvoice(kit, invB.docId)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ link_source: 'created_from_invoice', unlinked_at: null })
  })

  // Needs a rehearsal-only planted unique index; CREATE INDEX needs table-owner rights and CI has only service_role
  // and PostgREST. The local PG17 scaffold run covers it (S4-pm.txt green: native 23505 + nothing cancelled + self-link
  // active; S4-pm-MUTANT-swallow.txt RED: a swallowing handler leaves the call "successful" and the delivery cancelled).
  it.skip('T-E8-RERAISE rehearsal-only (planted unique index): native 23505 reaches the caller, nothing cancelled, self-link active', () => {})

  it('T-A28-5 (X6/D-9) linking an invoice whose automatic delivery is APPROVED is refused (QE011) and nothing changes', async () => {
    const inv = await makeDoc(kit, 'invoice', 'x6-inv')
    const dc = await typedDc('x6-dc')
    const pm = await as('pm1')
    expect((await setDetails('pm1', inv.deliveryId)).error).toBeNull()
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: inv.deliveryId })).error).toBeNull()
    const r = await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })
    expect(r.error?.code).toBe('QE011')
    expect((await getDelivery(kit, inv.deliveryId)).status).toBe('approved')
    expect((await linksOfInvoice(kit, inv.docId)).filter((l) => l.unlinked_at === null)).toHaveLength(1)
    // contrast: the same link on an awaiting_pm / incomplete automatic delivery succeeds (see T-A28-2)
  })

  it('T-A28-4 unlink: another PM link remains -> nothing restored; the LAST PM link goes -> automatic delivery restored with a NEW self-link; a rejected one is not restored', async () => {
    const inv = await makeDoc(kit, 'invoice', 'a28-4-inv')
    const d1 = await typedDc('a28-4-d1')
    const d2 = await typedDc('a28-4-d2')
    const pm = await as('pm1')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [d1.deliveryId, d2.deliveryId] })).error).toBeNull()
    const manual = (await linksOfInvoice(kit, inv.docId)).filter((l) => l.link_source === 'pm_manual')
    expect((await pm.rpc('pm_unlink_invoice', { p_link_id: manual[0].id })).error).toBeNull()
    expect((await getDelivery(kit, inv.deliveryId)).status).toBe('cancelled') // contrast case: another PM link remains
    expect((await pm.rpc('pm_unlink_invoice', { p_link_id: manual[1].id })).error).toBeNull()
    const auto = await getDelivery(kit, inv.deliveryId)
    expect(auto).toMatchObject({ status: 'incomplete', cancelled_at: null, cancel_reason: null })
    const selfLinks = (await linksOfInvoice(kit, inv.docId)).filter((l) => l.link_source === 'created_from_invoice')
    expect(selfLinks).toHaveLength(2) // the old one stays as history
    expect(selfLinks.filter((l) => l.unlinked_at === null)).toHaveLength(1)

    // a REJECTED automatic delivery is not restored: reject it first (its self-link goes), link a DC, unlink it again
    const inv2 = await makeDoc(kit, 'invoice', 'a28-4-inv2')
    const d3 = await typedDc('a28-4-d3')
    expect((await pm.rpc('pm_reject_delivery', { p_delivery_id: inv2.deliveryId, p_reason: 'ZZ not a delivery' })).error).toBeNull()
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv2.docId, p_delivery_ids: [d3.deliveryId] })).error).toBeNull()
    const only = (await linksOfInvoice(kit, inv2.docId)).find((l) => l.link_source === 'pm_manual')!
    expect((await pm.rpc('pm_unlink_invoice', { p_link_id: only.id })).error).toBeNull()
    expect((await getDelivery(kit, inv2.deliveryId)).status).toBe('rejected')
    expect((await linksOfInvoice(kit, inv2.docId)).filter((l) => l.link_source === 'created_from_invoice' && l.unlinked_at === null)).toHaveLength(0)
  })

  it('a PM cannot unlink an automatic self-link (QE010)', async () => {
    const inv = await makeDoc(kit, 'invoice', 'self-unlink')
    const self = (await linksOfInvoice(kit, inv.docId))[0]
    const r = await (await as('pm1')).rpc('pm_unlink_invoice', { p_link_id: self.id })
    expect(r.error?.code).toBe('QE010')
  })

  it('T-LINK-1 refusals by the 049 triggers through the function: internal transfer (QE003), automatic delivery (QE004), rejected delivery (QE005)', async () => {
    const pm = await as('pm1')
    const inv = await makeDoc(kit, 'invoice', 'l1-inv')
    const internal = await typedDc('l1-internal', 'internal_transfer')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [internal.deliveryId] })).error?.code).toBe('QE003')
    const otherInv = await makeDoc(kit, 'invoice', 'l1-other-inv')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [otherInv.deliveryId] })).error?.code).toBe('QE004')
    const rejected = await typedDc('l1-rejected')
    expect((await pm.rpc('pm_reject_delivery', { p_delivery_id: rejected.deliveryId, p_reason: 'ZZ no' })).error).toBeNull()
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [rejected.deliveryId] })).error?.code).toBe('QE005')
    // none of the refusals cancelled anything
    expect((await getDelivery(kit, inv.deliveryId)).status).toBe('incomplete')
  })

  it('T-Q3-1 retype to internal transfer with an active link is refused (QE006); an AUTOMATIC delivery can never be retyped (QE007)', async () => {
    const pm = await as('pm1')
    const inv = await makeDoc(kit, 'invoice', 'q3-inv')
    const dc = await typedDc('q3-dc')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })).error).toBeNull()
    expect((await setDetails('pm1', dc.deliveryId, 'internal_transfer')).error?.code).toBe('QE006')
    const inv2 = await makeDoc(kit, 'invoice', 'q3-inv2')
    expect((await setDetails('pm1', inv2.deliveryId, 'internal_transfer')).error?.code).toBe('QE007')
    // control: after unlink the retype succeeds
    const manual = (await linksOfInvoice(kit, inv.docId)).find((l) => l.link_source === 'pm_manual')!
    expect((await pm.rpc('pm_unlink_invoice', { p_link_id: manual.id })).error).toBeNull()
    expect((await setDetails('pm1', dc.deliveryId, 'internal_transfer')).error).toBeNull()
  })
})

describe('pm_approve_delivery / pm_reject_delivery (D-10, QE011/QE016/QE017, Path 3 and Path 4, Q-2 probe 4)', () => {
  it('T-D10-APPROVE-INCOMPLETE the right PM approves an incomplete delivery: approved, approved_by and approved_at stamped', async () => {
    const d = await typedDc('d10')
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('incomplete')
    const r = await (await as('pm1')).rpc('pm_approve_delivery', { p_delivery_id: d.deliveryId })
    expect(r.error).toBeNull()
    const after = await getDelivery(kit, d.deliveryId)
    expect(after).toMatchObject({ status: 'approved', approved_by: kit.uid('pm1') })
    expect(after.approved_at).not.toBeNull()
  })

  it('QE016: approving a delivery with no type set; QE011: approving a rejected / already approved delivery', async () => {
    const pm = await as('pm1')
    const untyped = await typedDc('qe016', null)
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: untyped.deliveryId })).error?.code).toBe('QE016')
    const rejected = await typedDc('qe011-rej')
    expect((await pm.rpc('pm_reject_delivery', { p_delivery_id: rejected.deliveryId, p_reason: 'ZZ' })).error).toBeNull()
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: rejected.deliveryId })).error?.code).toBe('QE011')
    const approved = await typedDc('qe011-app')
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: approved.deliveryId })).error).toBeNull()
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: approved.deliveryId })).error?.code).toBe('QE011')
    expect((await pm.rpc('pm_reject_delivery', { p_delivery_id: approved.deliveryId, p_reason: 'ZZ late' })).error?.code).toBe('QE011')
  })

  it('QE017: a blank rejection reason (blank, whitespace, NULL)', async () => {
    const d = await typedDc('qe017')
    const pm = await as('pm1')
    for (const reason of ['', '   ', null]) {
      expect((await pm.rpc('pm_reject_delivery', { p_delivery_id: d.deliveryId, p_reason: reason })).error?.code).toBe('QE017')
    }
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('incomplete')
  })

  it('Path 3: rejecting an AUTOMATIC delivery soft-unlinks its self-link as delivery_rejected', async () => {
    const inv = await makeDoc(kit, 'invoice', 'p3')
    const r = await (await as('pm1')).rpc('pm_reject_delivery', { p_delivery_id: inv.deliveryId, p_reason: 'ZZ not a delivery' })
    expect(r.error).toBeNull()
    expect(await getDelivery(kit, inv.deliveryId)).toMatchObject({ status: 'rejected', rejected_by: kit.uid('pm1') })
    const self = (await linksOfInvoice(kit, inv.docId))[0]
    expect(self).toMatchObject({ unlink_reason: 'delivery_rejected' })
    expect(self.unlinked_at).not.toBeNull()
  })

  it('Path 4: rejecting the only linked DC delivery rejects it AND restores the automatic delivery with a new self-link; Q-2 probe 4 is 0', async () => {
    const pm = await as('pm1')
    const inv = await makeDoc(kit, 'invoice', 'p4-inv')
    const dc = await typedDc('p4-dc')
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })).error).toBeNull()
    expect((await getDelivery(kit, inv.deliveryId)).status).toBe('cancelled')
    expect((await pm.rpc('pm_reject_delivery', { p_delivery_id: dc.deliveryId, p_reason: 'ZZ not ours' })).error).toBeNull()
    expect((await getDelivery(kit, dc.deliveryId)).status).toBe('rejected')
    expect(await getDelivery(kit, inv.deliveryId)).toMatchObject({ status: 'incomplete', cancelled_at: null, cancel_reason: null })
    const selfActive = (await linksOfInvoice(kit, inv.docId)).filter((l) => l.link_source === 'created_from_invoice' && l.unlinked_at === null)
    expect(selfActive).toHaveLength(1)
    const dcLink = (await linksOfDelivery(kit, dc.deliveryId))[0]
    expect(dcLink).toMatchObject({ unlink_reason: 'delivery_rejected' })
    expect(await probe4()).toBe(0)
  })

  it('Q-2 probe 4 after every path above: links unlinked as delivery_rejected whose delivery is not rejected = 0', async () => {
    expect(await probe4()).toBe(0)
  })
})

describe('B1 (review r1): the ack is ALWAYS stored; the delivery moves to awaiting_pm only WHERE status = incomplete', () => {
  it('T-B1-APPROVE-THEN-ACK ack stored, delivery stays approved, no error (an unconditional move would raise QE011 and lose the ack)', async () => {
    const d = await typedDc('b1-approve')
    expect((await (await as('pm1')).rpc('pm_approve_delivery', { p_delivery_id: d.deliveryId })).error).toBeNull()
    const a = await ack(kit, d, '1', 'b1-approve')
    expect(a.outcome).toBe('complete')
    expect((await getDoc(kit, d.docId)).engineer_ack).toBe('yes')
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('approved')
  })

  it('T-B1-REJECT-THEN-ACK ack stored, delivery stays rejected', async () => {
    const d = await typedDc('b1-reject')
    expect((await (await as('pm1')).rpc('pm_reject_delivery', { p_delivery_id: d.deliveryId, p_reason: 'ZZ' })).error).toBeNull()
    expect((await ack(kit, d, '2', 'b1-reject')).outcome).toBe('advance')
    expect((await getDoc(kit, d.docId)).engineer_ack).toBe('no')
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('rejected')
  })

  it('T-B1-LINK-THEN-ACK ack stored; the cancelled automatic delivery STAYS cancelled with cancelled_at / cancel_reason still set; the PM links stay active', async () => {
    const inv = await makeDoc(kit, 'invoice', 'b1-link-inv')
    const dc = await typedDc('b1-link-dc')
    expect((await (await as('pm1')).rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })).error).toBeNull()
    const a = await ack(kit, inv, '1', 'b1-link-inv')
    expect(a.outcome).toBe('complete')
    expect((await getDoc(kit, inv.docId)).engineer_ack).toBe('yes')
    const auto = await getDelivery(kit, inv.deliveryId)
    expect(auto.status).toBe('cancelled')
    expect(auto.cancelled_at).not.toBeNull()
    expect(auto.cancel_reason).toBe('superseded_by_link')
    expect((await linksOfInvoice(kit, inv.docId)).filter((l) => l.link_source === 'pm_manual' && l.unlinked_at === null)).toHaveLength(1)
  })

  it('B1 contrast: an ack on a still-incomplete delivery moves it to awaiting_pm', async () => {
    const d = await typedDc('b1-contrast')
    await ack(kit, d, '1', 'b1-contrast')
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('awaiting_pm')
  })
})

describe('vitest c, d, f (049 package line 267): the test-only helpers, and their guards', () => {
  const runId = getRunId()
  let nonFixtureTenant: string

  beforeAll(async () => {
    nonFixtureTenant = randomUUID()
    const { error } = await kit.svc.from('tenants').insert({ id: nonFixtureTenant, name: 'ZZ non-fixture', slug: `zz-nonfixture-${runId}` })
    expect(error).toBeNull()
  })

  afterAll(async () => {
    if (nonFixtureTenant) await kit.svc.from('tenants').delete().eq('id', nonFixtureTenant)
  })

  it('c. helper insert: quoco_test_capture_insert inserts a capture_documents row for a fixture tenant and the 049 triggers still fire', async () => {
    const { data, error } = await kit.svc.rpc('quoco_test_capture_insert', {
      p_table: 'capture_documents',
      p_row: { tenant_id: kit.tenantA, project_id: kit.p1, kind: 'dc', sent_by: kit.uid('eng'), source_message_sid: kit.sid('helper-c') },
    })
    expect(error).toBeNull()
    expect(data).toMatchObject({ tenant_id: kit.tenantA, kind: 'dc', source_message_sid: kit.sid('helper-c') })
    // the trigger still fires through the helper: an ack carried on INSERT is refused (F4-2 / QE012)
    const bad = await kit.svc.rpc('quoco_test_capture_insert', {
      p_table: 'capture_documents',
      p_row: { tenant_id: kit.tenantA, project_id: kit.p1, kind: 'dc', sent_by: kit.uid('eng'), source_message_sid: kit.sid('helper-c-ack'), engineer_ack: 'yes' },
    })
    expect(bad.error?.code).toBe('QE012')
  })

  it('d. tenant guard: the helper refuses a tenant that is not a zz-test-capture-* fixture tenant (insert, update and cleanup)', async () => {
    const ins = await kit.svc.rpc('quoco_test_capture_insert', {
      p_table: 'capture_documents',
      p_row: { tenant_id: nonFixtureTenant, project_id: kit.p1, kind: 'dc', sent_by: kit.uid('eng'), source_message_sid: kit.sid('helper-d') },
    })
    expect(ins.error?.message).toContain('HELPER_TENANT_NOT_FIXTURE')
    const clean = await kit.svc.rpc('quoco_test_capture_cleanup', { p_tenant_id: nonFixtureTenant })
    expect(clean.error?.message).toContain('HELPER_TENANT_NOT_FIXTURE')
    const guard = await kit.svc.rpc('quoco_test_capture_fixture_tenant_ok', { p_tenant_id: nonFixtureTenant })
    expect(guard.data).toBe(false)
    const ok = await kit.svc.rpc('quoco_test_capture_fixture_tenant_ok', { p_tenant_id: kit.tenantA })
    expect(ok.data).toBe(true)
  })

  it('f. N-4 E12 via the helper: a delivery INSERT that is not "incomplete" / carries PM fields is refused QE012', async () => {
    const doc = await kit.svc.rpc('quoco_test_capture_insert', {
      p_table: 'capture_documents',
      p_row: { tenant_id: kit.tenantA, project_id: kit.p1, kind: 'dc', sent_by: kit.uid('eng'), source_message_sid: kit.sid('helper-f') },
    })
    expect(doc.error).toBeNull()
    const docId = (doc.data as { id: string }).id
    const bad = await kit.svc.rpc('quoco_test_capture_insert', {
      p_table: 'deliveries',
      p_row: {
        tenant_id: kit.tenantA,
        project_id: kit.p1,
        reported_by: kit.uid('eng'),
        received_at: new Date(Date.now() - 3600 * 1000).toISOString(),
        dc_document_id: docId,
        status: 'approved',
      },
    })
    expect(bad.error?.code).toBe('QE012')
    const ok = await kit.svc.rpc('quoco_test_capture_insert', {
      p_table: 'deliveries',
      p_row: {
        tenant_id: kit.tenantA,
        project_id: kit.p1,
        reported_by: kit.uid('eng'),
        received_at: new Date(Date.now() - 3600 * 1000).toISOString(),
        dc_document_id: docId,
      },
    })
    expect(ok.error).toBeNull()
    expect(ok.data).toMatchObject({ status: 'incomplete' })
  })
})

describe('T-A28-3 / T-Q3-1 / T-LINK-1 with the PR-B functions BYPASSED (quoco_test_capture_* helpers; the 049 triggers still fire)', () => {
  const helperInsert = (row: Record<string, unknown>) => kit.svc.rpc('quoco_test_capture_insert', { p_table: 'delivery_invoice_links', p_row: row })

  it('T-A28-3 a pm_manual link while the invoice has an active self-link is refused QE001; a self-link while a pm_manual link is active is refused QE002; with the self-link first soft-unlinked the pm_manual insert succeeds', async () => {
    const inv = await makeDoc(kit, 'invoice', 'a28-3-inv')
    const dc = await makeDoc(kit, 'dc', 'a28-3-dc')
    const manual = {
      tenant_id: kit.tenantA,
      project_id: kit.p1,
      delivery_id: dc.deliveryId,
      invoice_document_id: inv.docId,
      link_source: 'pm_manual',
      linked_by: kit.uid('pm1'),
    }
    expect((await helperInsert(manual)).error?.code).toBe('QE001')

    const self = (await linksOfInvoice(kit, inv.docId))[0]
    const unlink = await kit.svc.rpc('quoco_test_capture_update', {
      p_table: 'delivery_invoice_links',
      p_id: self.id,
      p_set: { unlinked_at: new Date().toISOString(), unlinked_by: kit.uid('pm1'), unlink_reason: 'superseded_by_link' },
    })
    expect(unlink.error).toBeNull()
    const ok = await helperInsert(manual)
    expect(ok.error).toBeNull() // positive control: the same insert succeeds once the self-link is out of the way

    const selfAgain = await helperInsert({
      tenant_id: kit.tenantA,
      project_id: kit.p1,
      delivery_id: inv.deliveryId,
      invoice_document_id: inv.docId,
      link_source: 'created_from_invoice',
    })
    expect(selfAgain.error?.code).toBe('QE002')
  })

  it('T-A28-3 a SECOND active self-link for one invoice is refused (unique index), even with the function bypassed', async () => {
    const inv = await makeDoc(kit, 'invoice', 'a28-3-second')
    const dup = await helperInsert({
      tenant_id: kit.tenantA,
      project_id: kit.p1,
      delivery_id: inv.deliveryId,
      invoice_document_id: inv.docId,
      link_source: 'created_from_invoice',
    })
    expect(dup.error).not.toBeNull()
    expect(['23505', 'QE002']).toContain(dup.error!.code)
  })

  it('T-Q3-1 / T-LINK-1 with the function bypassed: retype to internal transfer with an active link is refused QE006; a link to a delivery of another project is refused by the composite FK', async () => {
    const inv = await makeDoc(kit, 'invoice', 'q3-bypass-inv')
    const dc = await makeDoc(kit, 'dc', 'q3-bypass-dc')
    expect(
      (await helperInsert({
        tenant_id: kit.tenantA,
        project_id: kit.p1,
        delivery_id: dc.deliveryId,
        invoice_document_id: inv.docId,
        link_source: 'pm_manual',
        linked_by: kit.uid('pm1'),
      })).error?.code,
    ).toBe('QE001')
    // take the self-link out of the way, link the DC, then try the retype
    const self = (await linksOfInvoice(kit, inv.docId))[0]
    await kit.svc.rpc('quoco_test_capture_update', {
      p_table: 'delivery_invoice_links',
      p_id: self.id,
      p_set: { unlinked_at: new Date().toISOString(), unlinked_by: kit.uid('pm1'), unlink_reason: 'pm_unlinked' },
    })
    // pm_unlinked is only legal on pm_manual rows (CHECK dil_pm_unlinked_scope_chk): the update above must be refused
    expect((await linksOfInvoice(kit, inv.docId))[0].unlinked_at).toBeNull()
    const sup = await kit.svc.rpc('quoco_test_capture_update', {
      p_table: 'delivery_invoice_links',
      p_id: self.id,
      p_set: { unlinked_at: new Date().toISOString(), unlinked_by: kit.uid('pm1'), unlink_reason: 'superseded_by_link' },
    })
    expect(sup.error).toBeNull()
    const lnk = await helperInsert({
      tenant_id: kit.tenantA,
      project_id: kit.p1,
      delivery_id: dc.deliveryId,
      invoice_document_id: inv.docId,
      link_source: 'pm_manual',
      linked_by: kit.uid('pm1'),
    })
    expect(lnk.error).toBeNull()
    const retype = await kit.svc.rpc('quoco_test_capture_update', { p_table: 'deliveries', p_id: dc.deliveryId, p_set: { delivery_type: 'internal_transfer' } })
    expect(retype.error?.code).toBe('QE006')
    // a link whose delivery lives in another project: the composite FK (delivery_id, project_id, tenant_id) refuses it
    const other = await makeDoc(kit, 'dc', 'q3-bypass-p2', { projectId: kit.p2 })
    const cross = await helperInsert({
      tenant_id: kit.tenantA,
      project_id: kit.p1,
      delivery_id: other.deliveryId,
      invoice_document_id: inv.docId,
      link_source: 'pm_manual',
      linked_by: kit.uid('pm1'),
    })
    expect(cross.error?.code).toBe('23503')
  })
})
