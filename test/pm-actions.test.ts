import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  activeLinkIds,
  buildPmKit,
  deliveryRow,
  makeDocWithFile,
  negClient,
  readerOf,
  removeStoredObjects,
  teardownCaptureKit,
  type CaptureKit,
  type CaptureUserLabel,
} from './helpers/pm-fixtures'
import {
  runApprove,
  runLink,
  runReject,
  runSetDetails,
  runUnlink,
  type PmActionDeps,
  type PmDetailsFields,
} from '@/lib/capture/pm-actions'

// T-ACT-1..5, T-ERR-1 (database half), T-REPEAT-1..5, T-STALE-1, T-CONC-1 (CI-only) for PR-D.
// pm-actions functions are called with an injected signed-in client (the same shape the 'use server' wrappers build).
// Shared test-db; run-scoped tenants/users/projects only (helpers/pm-fixtures.ts).
//
// CONTROL: PM_CONTROL=service swaps the NEGATIVE actors for the service-role client. The five functions are not
// executable by service_role (050:1878-1895), so every negative that expects PM_ERR_NOT_AVAILABLE must go RED.

let kit: CaptureKit

beforeAll(async () => {
  kit = await buildPmKit('pma', ['admMem'])
})

afterAll(async () => {
  if (!kit) return
  await removeStoredObjects(kit)
  await teardownCaptureKit(kit)
})

const deps = (client: SupabaseClient, label: CaptureUserLabel): PmActionDeps => ({
  client: client as unknown as PmActionDeps['client'],
  profile: readerOf(kit, label),
})
const as = async (label: CaptureUserLabel) => deps(await kit.jwt(label), label)
const neg = async (label: CaptureUserLabel) => deps(await negClient(kit, label), label)

const EMPTY: PmDetailsFields = { deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
const NEGATIVES: CaptureUserLabel[] = ['pm2', 'pmB', 'qs', 'deact']
let seq = 0
const tag = (p: string) => `${p}${++seq}`

/** A fresh DC delivery (one stored file) in project A1. */
async function newDc(p: string) {
  return makeDocWithFile(kit, 'dc', tag(p), 'stored')
}
/** A fresh invoice (and its automatic delivery) in project A1. */
async function newInvoice(p: string) {
  return makeDocWithFile(kit, 'invoice', tag(p), 'stored')
}
async function setType(deliveryId: string, type: 'supplier' | 'internal_transfer', who: CaptureUserLabel = 'pm1') {
  const row = await deliveryRow(kit, deliveryId)
  return runSetDetails(await as(who), {
    deliveryId,
    loaded: { status: row.status as string, deliveryType: row.delivery_type as string | null, vehicleNumber: row.vehicle_number as string | null, dcNumber: row.dc_number as string | null, dcDate: row.dc_date as string | null },
    next: { ...EMPTY, deliveryType: type },
  })
}
const NOT_AVAILABLE = { status: 'error', key: 'PM_ERR_NOT_AVAILABLE' }

describe('T-ACT-1: set details', () => {
  it('PM-A1 saves; the row carries the values', async () => {
    const d = await newDc('a1')
    const r = await runSetDetails(await as('pm1'), {
      deliveryId: d.deliveryId,
      loaded: { status: 'incomplete', ...EMPTY },
      next: { deliveryType: 'supplier', vehicleNumber: `ZZTestCapture-${kit.runTag}-veh`, dcNumber: 'DC-77', dcDate: '2026-10-30' },
    })
    expect(r).toEqual({ status: 'ok' })
    const row = await deliveryRow(kit, d.deliveryId)
    expect(row).toMatchObject({ delivery_type: 'supplier', vehicle_number: `ZZTestCapture-${kit.runTag}-veh`, dc_number: 'DC-77', dc_date: '2026-10-30' })
  })
  it.each(NEGATIVES)('%s is refused (NOT_AVAILABLE) and the row is unchanged', async (who) => {
    const d = await newDc('a1n')
    const before = await deliveryRow(kit, d.deliveryId)
    const r = await runSetDetails(await neg(who), { deliveryId: d.deliveryId, loaded: { status: 'incomplete', ...EMPTY }, next: { ...EMPTY, vehicleNumber: 'HACK' } })
    expect(r).toMatchObject(NOT_AVAILABLE)
    expect(await deliveryRow(kit, d.deliveryId)).toEqual(before)
  })
})

describe('T-ACT-2: approve', () => {
  it('PM-A1 approves a delivery with a type', async () => {
    const d = await newDc('a2')
    expect(await setType(d.deliveryId, 'supplier')).toEqual({ status: 'ok' })
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toEqual({ status: 'ok' })
    const row = await deliveryRow(kit, d.deliveryId)
    expect(row.status).toBe('approved')
    expect(row.approved_by).toBe(kit.uid('pm1'))
  })
  it.each(NEGATIVES)('%s is refused and the status is unchanged', async (who) => {
    const d = await newDc('a2n')
    await setType(d.deliveryId, 'supplier')
    const before = await deliveryRow(kit, d.deliveryId)
    expect(await runApprove(await neg(who), { deliveryId: d.deliveryId })).toMatchObject(NOT_AVAILABLE)
    expect(await deliveryRow(kit, d.deliveryId)).toEqual(before)
  })
})

describe('T-ACT-3: reject', () => {
  it('PM-A1 rejects with a reason', async () => {
    const d = await newDc('a3')
    expect(await runReject(await as('pm1'), { deliveryId: d.deliveryId, reason: `ZZTestCapture-${kit.runTag}-why` })).toEqual({ status: 'ok' })
    const row = await deliveryRow(kit, d.deliveryId)
    expect(row.status).toBe('rejected')
    expect(row.reject_reason).toBe(`ZZTestCapture-${kit.runTag}-why`)
  })
  it.each(NEGATIVES)('%s is refused and the row is unchanged', async (who) => {
    const d = await newDc('a3n')
    const before = await deliveryRow(kit, d.deliveryId)
    expect(await runReject(await neg(who), { deliveryId: d.deliveryId, reason: 'no' })).toMatchObject(NOT_AVAILABLE)
    expect(await deliveryRow(kit, d.deliveryId)).toEqual(before)
  })
})

describe('T-ACT-4: link', () => {
  it('PM-A1 links an invoice to a DC; the automatic delivery is cancelled by the link', async () => {
    const inv = await newInvoice('a4i')
    const dc = await newDc('a4d')
    expect(await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })).toEqual({ status: 'ok' })
    const links = await activeLinkIds(kit, inv.docId)
    expect(links.map((l) => l.link_source)).toEqual(['pm_manual'])
    expect(links[0].delivery_id).toBe(dc.deliveryId)
    expect((await deliveryRow(kit, inv.deliveryId)).status).toBe('cancelled')
  })
  it.each(NEGATIVES)('%s is refused and no link is written', async (who) => {
    const inv = await newInvoice('a4in')
    const dc = await newDc('a4dn')
    expect(await runLink(await neg(who), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })).toMatchObject(NOT_AVAILABLE)
    expect((await activeLinkIds(kit, inv.docId)).map((l) => l.link_source)).toEqual(['created_from_invoice'])
  })
})

// E4: does the DATABASE allow linking an invoice to a DC that is already APPROVED? The picker offers approved DCs
// (status not rejected/cancelled); 049's TR2 refuses rejected/cancelled targets (QE005) and the 050 legend says nothing
// about approved ones. This test RECORDS the raw result; it does not decide the answer. It asserts only that the call
// returned either ok or a coded error, and that the DC itself is unchanged.
describe('T-ACT-4b: link to an approved DC (raw result recorded)', () => {
  it('approved DC: PM-A1 links an invoice to an APPROVED DC; the raw RPC result is printed', async () => {
    const dc = await newDc('e4d')
    expect(await setType(dc.deliveryId, 'supplier')).toEqual({ status: 'ok' })
    expect(await runApprove(await as('pm1'), { deliveryId: dc.deliveryId })).toEqual({ status: 'ok' })
    expect((await deliveryRow(kit, dc.deliveryId)).status).toBe('approved')
    const inv = await newInvoice('e4i')

    const jwt = await kit.jwt('pm1')
    const raw = await jwt.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })
    const links = await activeLinkIds(kit, inv.docId)
    console.log(
      '[E4 raw] ' +
        JSON.stringify({
          data: raw.data,
          error: raw.error ? { code: raw.error.code, message: raw.error.message } : null,
          activeLinksOfInvoiceAfter: links.map((l) => ({ source: l.link_source, delivery_is_the_approved_dc: l.delivery_id === dc.deliveryId })),
          dcStatusAfter: (await deliveryRow(kit, dc.deliveryId)).status,
          invoiceAutomaticDeliveryStatusAfter: (await deliveryRow(kit, inv.deliveryId)).status,
        }),
    )
    expect(raw.error === null || typeof raw.error.code === 'string').toBe(true)
    expect((await deliveryRow(kit, dc.deliveryId)).status).toBe('approved') // a link never changes the DC's own status
  })
})

describe('T-ACT-5: unlink', () => {
  it('PM-A1 unlinks; the automatic delivery is restored with a new self-link', async () => {
    const inv = await newInvoice('a5i')
    const dc = await newDc('a5d')
    await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })
    const link = (await activeLinkIds(kit, inv.docId))[0]
    expect(await runUnlink(await as('pm1'), { linkId: link.id })).toEqual({ status: 'ok' })
    expect((await activeLinkIds(kit, inv.docId)).map((l) => l.link_source)).toEqual(['created_from_invoice'])
    expect((await deliveryRow(kit, inv.deliveryId)).status).not.toBe('cancelled')
  })
  it.each(NEGATIVES)('%s is refused and the link stays active', async (who) => {
    const inv = await newInvoice('a5in')
    const dc = await newDc('a5dn')
    await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })
    const link = (await activeLinkIds(kit, inv.docId))[0]
    expect(await runUnlink(await neg(who), { linkId: link.id })).toMatchObject(NOT_AVAILABLE)
    expect((await activeLinkIds(kit, inv.docId)).map((l) => l.id)).toEqual([link.id])
  })
})

describe('T-ERR-1 (database half): each reachable refusal arrives as its key', () => {
  it('QE016: approve with no delivery type', async () => {
    const d = await newDc('e16')
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toMatchObject({ key: 'PM_ERR_TYPE_REQUIRED' })
  })
  it('QE011: approve twice', async () => {
    const d = await newDc('e11')
    await setType(d.deliveryId, 'supplier')
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toEqual({ status: 'ok' })
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
  })
  it('QE010: unlinking the automatic self-link', async () => {
    const inv = await newInvoice('e10')
    const self = (await activeLinkIds(kit, inv.docId)).find((l) => l.link_source === 'created_from_invoice')
    expect(self).toBeDefined()
    expect(await runUnlink(await as('pm1'), { linkId: self!.id })).toMatchObject({ key: 'PM_ERR_SELF_LINK_FIXED' })
  })
  it('QE008: a second invoice for a DC that is already linked', async () => {
    const dc = await newDc('e08d')
    const i1 = await newInvoice('e08a')
    const i2 = await newInvoice('e08b')
    expect(await runLink(await as('pm1'), { invoiceDocumentId: i1.docId, deliveryIds: [dc.deliveryId] })).toEqual({ status: 'ok' })
    expect(await runLink(await as('pm1'), { invoiceDocumentId: i2.docId, deliveryIds: [dc.deliveryId] })).toMatchObject({ key: 'PM_ERR_ALREADY_LINKED' })
  })
  it('QE006: retype a linked DC to internal transfer', async () => {
    const dc = await newDc('e06d')
    const inv = await newInvoice('e06i')
    await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })
    expect(await setType(dc.deliveryId, 'internal_transfer')).toMatchObject({ key: 'PM_ERR_RETYPE_LINKED' })
  })
  it('QE007: retype an automatic delivery to internal transfer', async () => {
    const inv = await newInvoice('e07')
    expect(await setType(inv.deliveryId, 'internal_transfer')).toMatchObject({ key: 'PM_ERR_RETYPE_AUTOMATIC' })
  })
  it('QE003: link to an internal-transfer DC', async () => {
    const dc = await newDc('e03d')
    const inv = await newInvoice('e03i')
    expect(await setType(dc.deliveryId, 'internal_transfer')).toEqual({ status: 'ok' })
    expect(await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })).toMatchObject({ key: 'PM_ERR_LINK_TARGET_INELIGIBLE' })
  })
  it('QE004: link to an automatic delivery', async () => {
    const inv = await newInvoice('e04i')
    const other = await newInvoice('e04o')
    expect(await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [other.deliveryId] })).toMatchObject({ key: 'PM_ERR_LINK_TARGET_INELIGIBLE' })
  })
  it('QE005: link to a rejected DC', async () => {
    const dc = await newDc('e05d')
    const inv = await newInvoice('e05i')
    expect(await runReject(await as('pm1'), { deliveryId: dc.deliveryId, reason: 'r' })).toEqual({ status: 'ok' })
    expect(await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })).toMatchObject({ key: 'PM_ERR_LINK_TARGET_INELIGIBLE' })
  })
  it('QE015: a PM of another project', async () => {
    const d = await newDc('e15')
    expect(await runApprove(await as('pm2'), { deliveryId: d.deliveryId })).toMatchObject({ key: 'PM_ERR_NOT_AVAILABLE' })
  })
})

describe('T-REPEAT-1..5: repeat calls, and a second PM (admMem, a pm member of A1) having already acted', () => {
  it('T-REPEAT-1 set details: the same values twice are ok; after approval both the stale path and the RPC path refuse', async () => {
    const d = await newDc('r1')
    const next = { deliveryType: 'supplier', vehicleNumber: 'V-1', dcNumber: 'D-1', dcDate: '2026-10-30' }
    const loaded0 = { status: 'incomplete', ...EMPTY }
    expect(await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded: loaded0, next })).toEqual({ status: 'ok' })
    const loaded1 = { status: 'incomplete', ...next }
    expect(await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded: loaded1, next })).toEqual({ status: 'ok' })
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toEqual({ status: 'ok' })
    // stale form (status was incomplete when rendered): refused before the RPC
    expect(await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded: loaded1, next: { ...next, vehicleNumber: 'V-2' } })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
    // fresh form (status approved): reaches the RPC, whose trigger refuses a locked row
    const fresh = { status: 'approved', ...next }
    expect(await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded: fresh, next: { ...next, vehicleNumber: 'V-2' } })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
    expect((await deliveryRow(kit, d.deliveryId)).vehicle_number).toBe('V-1')
  })
  it('T-REPEAT-2 approve: repeat and other-PM-already-approved', async () => {
    const d = await newDc('r2')
    await setType(d.deliveryId, 'supplier')
    expect(await runApprove(await as('admMem'), { deliveryId: d.deliveryId })).toEqual({ status: 'ok' })
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
    expect(await runApprove(await as('admMem'), { deliveryId: d.deliveryId })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
  })
  it('T-REPEAT-3 reject: repeat and other-PM-already-rejected', async () => {
    const d = await newDc('r3')
    expect(await runReject(await as('admMem'), { deliveryId: d.deliveryId, reason: 'x' })).toEqual({ status: 'ok' })
    expect(await runReject(await as('pm1'), { deliveryId: d.deliveryId, reason: 'y' })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
    expect(await runApprove(await as('pm1'), { deliveryId: d.deliveryId })).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
  })
  it('T-REPEAT-4 link: repeat, and another PM linking a different invoice to the same DC', async () => {
    const dc = await newDc('r4d')
    const i1 = await newInvoice('r4a')
    const i2 = await newInvoice('r4b')
    expect(await runLink(await as('pm1'), { invoiceDocumentId: i1.docId, deliveryIds: [dc.deliveryId] })).toEqual({ status: 'ok' })
    expect(await runLink(await as('pm1'), { invoiceDocumentId: i1.docId, deliveryIds: [dc.deliveryId] })).toMatchObject({ key: 'PM_ERR_ALREADY_LINKED' })
    expect(await runLink(await as('admMem'), { invoiceDocumentId: i2.docId, deliveryIds: [dc.deliveryId] })).toMatchObject({ key: 'PM_ERR_ALREADY_LINKED' })
  })
  it('T-REPEAT-5 unlink: repeat, and another PM having unlinked first', async () => {
    const dc = await newDc('r5d')
    const inv = await newInvoice('r5i')
    await runLink(await as('pm1'), { invoiceDocumentId: inv.docId, deliveryIds: [dc.deliveryId] })
    const link = (await activeLinkIds(kit, inv.docId))[0]
    expect(await runUnlink(await as('admMem'), { linkId: link.id })).toEqual({ status: 'ok' })
    expect(await runUnlink(await as('pm1'), { linkId: link.id })).toMatchObject({ key: 'PM_ERR_ALREADY_UNLINKED' })
    expect(await runUnlink(await as('admMem'), { linkId: link.id })).toMatchObject({ key: 'PM_ERR_ALREADY_UNLINKED' })
  })
})

describe('T-STALE-1: the set-details form carries what it loaded; a changed row refuses BEFORE the RPC (D8)', () => {
  it('another PM changed the vehicle after the form loaded: STATE_CHANGED, their value stands', async () => {
    const d = await newDc('s1')
    const loaded = { status: 'incomplete', ...EMPTY }
    // admMem saves first, from the same starting point
    expect(await runSetDetails(await as('admMem'), { deliveryId: d.deliveryId, loaded, next: { ...EMPTY, vehicleNumber: 'THEIRS' } })).toEqual({ status: 'ok' })
    // pm1's form still holds the old values
    const r = await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded, next: { ...EMPTY, vehicleNumber: 'MINE' } })
    expect(r).toMatchObject({ status: 'error', key: 'PM_ERR_STATE_CHANGED' })
    expect((await deliveryRow(kit, d.deliveryId)).vehicle_number).toBe('THEIRS')
  })
  it('POSITIVE CONTROL: the same save with a refreshed form succeeds', async () => {
    const d = await newDc('s1c')
    const loaded = { status: 'incomplete', ...EMPTY }
    await runSetDetails(await as('admMem'), { deliveryId: d.deliveryId, loaded, next: { ...EMPTY, vehicleNumber: 'THEIRS' } })
    const refreshed = { status: 'incomplete', ...EMPTY, vehicleNumber: 'THEIRS' }
    expect(await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded: refreshed, next: { ...EMPTY, vehicleNumber: 'MINE' } })).toEqual({ status: 'ok' })
    expect((await deliveryRow(kit, d.deliveryId)).vehicle_number).toBe('MINE')
  })
  it('empty vs null is not a difference', async () => {
    const d = await newDc('s1e')
    expect(await runSetDetails(await as('pm1'), { deliveryId: d.deliveryId, loaded: { status: 'incomplete', deliveryType: '', vehicleNumber: '  ', dcNumber: '', dcDate: '' }, next: { ...EMPTY, dcNumber: 'N' } })).toEqual({ status: 'ok' })
  })
})

// T-CONC-1: two PMs acting at the same instant. NOT VERIFIED LOCALLY: this sandbox serialises concurrent RPC calls
// (CLAUDE.md section 0 "CONCURRENCY ... IS CI-ONLY"), so a local pass would prove nothing. Runs only when CI is set.
const ciOnly = process.env.CI ? it : it.skip
describe('T-CONC-1 (CI-only)', () => {
  ciOnly('two PMs approving the same delivery at once: exactly one wins, the other gets STATE_CHANGED', async () => {
    const d = await newDc('c1')
    await setType(d.deliveryId, 'supplier')
    const [a, b] = await Promise.all([
      (async () => runApprove(await as('pm1'), { deliveryId: d.deliveryId }))(),
      (async () => runApprove(await as('admMem'), { deliveryId: d.deliveryId }))(),
    ])
    const oks = [a, b].filter((r) => r.status === 'ok').length
    expect(oks).toBe(1)
    expect([a, b].find((r) => r.status === 'error')).toMatchObject({ key: 'PM_ERR_STATE_CHANGED' })
  })
})
