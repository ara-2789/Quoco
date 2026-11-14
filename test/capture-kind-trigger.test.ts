// 052 block 2c, item 3: plan F tests T-K-1..4 and T-P-1 (docs/reviews/052-design/kind-removal-plan.md lines 105-106).
//
//   105: "T-K-1 nullable, CHECKs, `kind_source` domain. T-K-2 trigger: NULL -> all four once, `pm` only; a change of `received_at`
//        -> QE009; caller `kind_set_at` overwritten; any later change -> QE009; `engineer_declared` by UPDATE refused; backdated
//        stamp impossible; D-30-shaped row frozen; insert with any of the four -> QE012; service_role UPDATE 42501. T-K-3 a delivery
//        on an unclassified document fails the FK (23503). T-K-4 `pm_link_invoice` on an unclassified document is refused."
//   106: "T-P-1 existing PM actions refused before classification, working after."
//
// NOT written here (stopped, plan quoted in the package): T-M-1 ("seed a step-3 `invoice` session, apply: aborts with
// `APPLY_ABORT_052`") and T-M-2 ("backfill touches exactly the engineer-declared rows") need the MIGRATION TO RUN; 052 is already
// applied on test-db and a test cannot apply or roll it back. And the clause "D-30-shaped row frozen" of T-K-2 needs a document
// with kind_source = 'engineer_declared', which no role can create after 052 (INSERT refuses any kind column, UPDATE refuses
// engineer_declared); the 51 such rows on test-db are leaked fixtures and no test may depend on them.
//
// How the database is reached: owner-level test-db-only helpers (quoco_test_capture_insert / _update, scripts/
// test-db-only-capture-helpers.sql) run the REAL triggers; PM calls use real JWTs. Every test that asserts a refusal sits beside a
// passing call, and has a PLANTED-FAULT CONTROL: with TK_CONTROL=<name> the guarded precondition is made legal, so the refusal
// no longer happens and the test must go RED. (The database itself cannot be faulted from test code; the control proves the
// assertion can fail.)
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildCaptureKit, classifyAsPm, makeDoc, makeUnclassifiedDoc, teardownCaptureKit, type CaptureKit } from './helpers/capture-fixtures'

let kit: CaptureKit
const CONTROL = process.env.TK_CONTROL ?? ''
const on = (name: string) => CONTROL === name

beforeAll(async () => {
  kit = await buildCaptureKit('kind-trigger', ['eng', 'pm1', 'pm2', 'pmB'])
}, 60_000)

afterAll(async () => {
  if (kit) await teardownCaptureKit(kit)
})

const upd = (id: string, set: Record<string, unknown>) =>
  kit.svc.rpc('quoco_test_capture_update', { p_table: 'capture_documents', p_id: id, p_set: set })
const ins = (row: Record<string, unknown>, table = 'capture_documents') => kit.svc.rpc('quoco_test_capture_insert', { p_table: table, p_row: row })
const newDoc = async (label: string) => (await makeUnclassifiedDoc(kit, label)).docId
const PAST = () => new Date(Date.now() - 3600 * 1000).toISOString()
const baseRow = (sid: string, extra: Record<string, unknown> = {}) => ({
  tenant_id: kit.tenantA,
  project_id: kit.p1,
  sent_by: kit.uid('eng'),
  source_message_sid: kit.sid(sid),
  received_at: PAST(),
  ...extra,
})
async function row(id: string) {
  const { data, error } = await kit.svc
    .from('capture_documents')
    .select('kind,kind_source,kind_set_at,kind_set_by,received_at,created_at')
    .eq('id', id)
    .single<{ kind: string | null; kind_source: string | null; kind_set_at: string | null; kind_set_by: string | null; received_at: string; created_at: string }>()
  if (error || !data) throw new Error(`row(${id}) failed: ${error?.message}`)
  return data
}
const CARVE = () => ({ kind: 'dc', kind_source: 'pm', kind_set_by: kit.uid('pm1') })

describe('T-K-1 nullable kind, NOT NULL received_at, the CHECKs and the same-tenant FK', () => {
  it('an unclassified document has all four kind columns NULL (kind is nullable); received_at is set', async () => {
    const r = await row(await newDoc('k1-null'))
    expect([r.kind, r.kind_source, r.kind_set_at, r.kind_set_by]).toEqual([null, null, null, null])
    expect(r.received_at).not.toBeNull()
  })

  it('received_at is NOT NULL (23502) and may not be after created_at (23514, capture_documents_received_order_chk); a valid one inserts', async () => {
    const missing = await ins({ ...baseRow('k1-missing'), received_at: undefined })
    expect(missing.error?.code).toBe('23502')
    const future = await ins(baseRow('k1-future', { received_at: on('k1') ? PAST() : new Date(Date.now() + 86_400_000).toISOString() }))
    expect(future.error?.code).toBe('23514')
    expect(future.error?.message).toContain('capture_documents_received_order_chk')
    expect((await ins(baseRow('k1-ok'))).error).toBeNull() // positive control
  })

  it('kind_set_by must be a user of the SAME tenant (composite FK, 23503); a same-tenant PM passes', async () => {
    const d1 = await newDoc('k1-fk-bad')
    const bad = await upd(d1, { ...CARVE(), kind_set_by: on('k1b') ? kit.uid('pm1') : kit.uid('pmB') })
    expect(bad.error?.code).toBe('23503')
    expect((await row(d1)).kind).toBeNull() // nothing written
    const d2 = await newDoc('k1-fk-ok')
    expect((await upd(d2, CARVE())).error).toBeNull()
  })
})

describe('T-K-2 the update and insert triggers', () => {
  it('NULL -> all four once, pm only; every later change is QE009', async () => {
    const id = await newDoc('k2a')
    expect((await upd(id, CARVE())).error).toBeNull()
    const r = await row(id)
    expect([r.kind, r.kind_source, r.kind_set_by]).toEqual(['dc', 'pm', kit.uid('pm1')])
    expect(r.kind_set_at).not.toBeNull()
    for (const [name, set] of Object.entries({
      kind: { kind: on('k2a') ? 'dc' : 'invoice' },
      kind_source: { kind_source: 'engineer_declared' },
      kind_set_by: { kind_set_by: kit.uid('pm2') },
      kind_set_at: { kind_set_at: new Date().toISOString() },
    })) {
      const c = await upd(id, set)
      expect(c.error?.code, name).toBe('QE009')
    }
    expect((await row(id)).kind).toBe('dc') // unchanged
  })

  it('a change of received_at is QE009, on a classified and on an unclassified document; the same value is not a change', async () => {
    const id = await newDoc('k2b')
    const cur = (await row(id)).received_at
    const other = new Date(new Date(cur).getTime() - 60_000).toISOString()
    expect((await upd(id, { received_at: on('k2b') ? cur : other })).error?.code).toBe('QE009')
    expect((await upd(id, { received_at: cur })).error).toBeNull() // positive control: an unchanged value passes
    await upd(id, CARVE())
    expect((await upd(id, { received_at: other })).error?.code).toBe('QE009')
  })

  it('a caller-supplied kind_set_at is overwritten by the database; a backdated stamp is impossible', async () => {
    const id = await newDoc('k2c')
    if (!on('k2c')) expect((await upd(id, { ...CARVE(), kind_set_at: '2000-01-01T00:00:00Z' })).error).toBeNull()
    const r = await row(id)
    expect(r.kind_set_at).not.toBeNull()
    expect(new Date(r.kind_set_at!).getTime()).toBeGreaterThanOrEqual(new Date(r.created_at).getTime())
    expect(r.kind_set_at).not.toMatch(/^2000/)
  })

  it('engineer_declared by UPDATE is refused; a kind without kind_set_by, and a source without a kind, are refused (QE009)', async () => {
    const id = await newDoc('k2d')
    expect((await upd(id, { kind: 'dc', kind_source: on('k2d') ? 'pm' : 'engineer_declared', kind_set_by: kit.uid('pm1') })).error?.code).toBe('QE009')
    expect((await upd(id, { kind: 'dc', kind_source: 'pm' })).error?.code).toBe('QE009')
    expect((await upd(id, { kind_source: 'pm', kind_set_by: kit.uid('pm1') })).error?.code).toBe('QE009')
    expect((await row(id)).kind).toBeNull()
    expect((await upd(id, CARVE())).error).toBeNull() // positive control
  })

  it('an INSERT carrying any of the four kind columns is QE012; the same insert without them passes', async () => {
    for (const extra of [{ kind: 'dc' }, { kind_source: 'pm' }, { kind_set_at: PAST() }, { kind_set_by: kit.uid('pm1') }]) {
      const r = await ins(baseRow(`k2e-${Object.keys(extra)[0]}`, on('k2e') ? {} : extra))
      expect(r.error?.code, Object.keys(extra)[0]).toBe('QE012')
    }
    expect((await ins(baseRow('k2e-ok'))).error).toBeNull()
  })

  it('service_role cannot UPDATE capture_documents through the API (42501); the owner-level helper can change a free column', async () => {
    const id = await newDoc('k2f')
    // control k2f: the update goes through the owner-level helper instead of service_role's own grant, so no 42501 happens
    const attempt = on('k2f') ? await upd(id, { caption: 'x' }) : await kit.svc.from('capture_documents').update({ caption: 'x' }).eq('id', id)
    expect(attempt.error?.code).toBe('42501')
    expect((await upd(id, { caption: 'y' })).error).toBeNull() // positive control
  })
})

describe('T-K-3 a delivery on an unclassified document fails the composite FK', () => {
  it('23503 on an unclassified document; the same insert passes once the document is classified', async () => {
    const id = await newDoc('k3')
    const delivery = { tenant_id: kit.tenantA, project_id: kit.p1, reported_by: kit.uid('eng'), received_at: PAST(), dc_document_id: id }
    if (on('k3')) await upd(id, CARVE())
    const bad = await ins(delivery, 'deliveries')
    expect(bad.error?.code).toBe('23503')
    await upd(id, CARVE())
    expect((await ins(delivery, 'deliveries')).error).toBeNull()
  })
})

describe('T-K-4 / T-P-1 PM actions are refused before classification and work after', () => {
  it('T-K-4 pm_link_invoice on an UNCLASSIFIED document is refused and links nothing; once classified it links', async () => {
    const dc = await makeDoc(kit, 'dc', 'k4-dc')
    const inv = await makeUnclassifiedDoc(kit, 'k4-inv')
    const pm = await kit.jwt('pm1')
    if (on('k4')) await classifyAsPm(kit, inv.docId, 'invoice')
    const refused = await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })
    // Code review round 1, finding 3: the code is PINNED (QE015, as observed), so a network failure or any other error does not pass.
    // Control k4code: QE014 is planted as the expected code, which must be RED.
    expect(refused.error?.code, 'refused before classification').toBe(on('k4code') ? 'QE014' : 'QE015')
    const { data: links } = await kit.svc.from('delivery_invoice_links').select('id').eq('invoice_document_id', inv.docId)
    expect(links ?? []).toHaveLength(0)
    expect((await classifyAsPm(kit, inv.docId, 'invoice')).error).toBeNull()
    expect((await pm.rpc('pm_link_invoice', { p_invoice_document_id: inv.docId, p_delivery_ids: [dc.deliveryId] })).error).toBeNull()
  })

  it('T-P-1 approve and set-details have no delivery to act on before classification (QE015); after it they work', async () => {
    const u = await makeUnclassifiedDoc(kit, 'p1')
    const pm = await kit.jwt('pm1')
    // Code review round 1, finding 4: the premise is asserted, not assumed. The unclassified document has 0 deliveries, so there
    // is no id to give; a random UUID would be refused with or without the migration. Control p1before: the count is taken on a
    // CLASSIFIED document (which has 1 delivery), which must be RED.
    const counted = on('p1before') ? (await makeDoc(kit, 'dc', 'p1-classified')).docId : u.docId
    const { data: preDel } = await kit.svc.from('deliveries').select('id').or(`dc_document_id.eq.${counted},created_from_invoice_id.eq.${counted}`)
    expect(preDel ?? [], 'the unclassified document has no delivery').toHaveLength(0)
    // an unclassified document has no delivery: there is no id to give. Control p1: classify first and use the REAL delivery id.
    let nobody = crypto.randomUUID()
    if (on('p1')) nobody = ((await classifyAsPm(kit, u.docId, 'dc')).data as { delivery_id: string }).delivery_id
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: nobody })).error?.code).toBe('QE015')
    expect((await pm.rpc('pm_set_delivery_details', { p_delivery_id: nobody, p_delivery_type: 'supplier', p_vehicle_number: null, p_dc_number: null, p_dc_date: null })).error?.code).toBe('QE015')
    const c = await classifyAsPm(kit, u.docId, 'dc')
    expect(c.error).toBeNull()
    const id = (c.data as { delivery_id: string }).delivery_id
    expect((await pm.rpc('pm_set_delivery_details', { p_delivery_id: id, p_delivery_type: 'supplier', p_vehicle_number: null, p_dc_number: null, p_dc_date: null })).error).toBeNull()
    expect((await pm.rpc('pm_approve_delivery', { p_delivery_id: id })).error).toBeNull()
    const { data } = await kit.svc.from('deliveries').select('status').eq('id', id).single<{ status: string }>()
    expect(data!.status).toBe('approved')
  })
})
