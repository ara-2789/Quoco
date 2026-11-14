import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Server Actions import lib/auth/profile ('server-only'); these tests call the logic (runClassify) directly, never the action.
vi.mock('@/app/(dashboard)/material-inward/actions', () => ({ classifyDocumentAction: vi.fn() }))

import {
  buildPmKit,
  filesOfDoc,
  readerOf,
  removeStoredObjects,
  storeFile,
  teardownCaptureKit,
  type CaptureKit,
} from './helpers/pm-fixtures'
import { classifyAsPm, jpegMedia, linksOfInvoice, makeUnclassifiedDoc, miTurn } from './helpers/capture-fixtures'
import { getClassifyDocument, getUnclassifiedList } from '@/lib/capture/pm-queries'
import { runClassify, type PmActionDeps } from '@/lib/capture/pm-actions'
import * as copy from '@/lib/capture/pm-copy'

// PR-D2, against the REAL test-db and the REAL pm_classify_document (migration 052): one run-scoped kit (two tenants, projects P1 and P2
// of tenant A, P3 of tenant B, a PM on each, engineers). The classify logic is called with a real PM JWT client, so the database makes
// every authorisation decision. Concurrency (two PMs at once) is NOT exercised here: CI-only (CLAUDE.md section 7).

vi.setConfig({ testTimeout: 60_000 })
const HOOK_TIMEOUT_MS = 120_000
const NOW = new Date()

let kit: CaptureKit
let setup: Promise<void> | undefined

beforeAll(() => {
  setup = (async () => {
    kit = await buildPmKit('pmd2db')
  })()
  return setup
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  if (setup) await setup.catch(() => undefined)
  if (!kit) return
  await removeStoredObjects(kit)
  await teardownCaptureKit(kit)
}, HOOK_TIMEOUT_MS)

async function depsFor(label: 'pm1' | 'pm2' | 'pmB'): Promise<PmActionDeps> {
  const client = (await kit.jwt(label)) as unknown as SupabaseClient<Database>
  const r = readerOf(kit, label)
  return { client, profile: { id: r.id, tenant_id: r.tenant_id } }
}
async function deliveriesOf(docId: string): Promise<Array<{ id: string }>> {
  const { data, error } = await kit.svc.from('deliveries').select('id').or(`dc_document_id.eq.${docId},created_from_invoice_id.eq.${docId}`)
  if (error) throw new Error(`deliveriesOf: ${error.message}`)
  return (data ?? []) as Array<{ id: string }>
}
async function docOf(docId: string): Promise<{ kind: string | null; kind_source: string | null; kind_set_by: string | null; kind_set_at: string | null; received_at: string; created_at: string }> {
  const { data, error } = await kit.svc.from('capture_documents').select('kind, kind_source, kind_set_by, kind_set_at, received_at, created_at').eq('id', docId).single()
  if (error || !data) throw new Error(`docOf: ${error?.message}`)
  return data as { kind: string | null; kind_source: string | null; kind_set_by: string | null; kind_set_at: string | null; received_at: string; created_at: string }
}
async function listIds(label: 'pm1' | 'pm2' | 'pmB'): Promise<string[]> {
  const r = await getUnclassifiedList(await kit.jwt(label), readerOf(kit, label))
  if (r.status !== 'ok') throw new Error(`list for ${label}: ${r.status}`)
  return r.items.map((i) => i.documentId)
}

describe('T-D2-LIST (test-db): oldest received_at first, even when created_at says otherwise', () => {
  it('X is received before Y but created after it: the PM list puts X first, and the stored received_at really differs from created_at', async () => {
    // X: start turn, then reserve X's FILE-turn SID in processed_messages NOW (that row's created_at becomes X's received_at).
    const phoneX = kit.phone('listX')
    await miTurn(kit, phoneX, '4', kit.sid('listX-s0'), { start: true })
    const sidX = kit.sid('listX-s2')
    const { error: pErr } = await kit.svc.from('processed_messages').insert({ message_sid: sidX })
    if (pErr) throw new Error(`reserve X sid: ${pErr.message}`)
    // Y: made in full AFTER the reservation, so its received_at and created_at are both later than X's received_at.
    const y = await makeUnclassifiedDoc(kit, 'listY')
    // X's file turn last: its created_at is the latest of all, its received_at the earliest.
    const rx = await miTurn(kit, phoneX, null, sidX, { media: jpegMedia(1), skipProcessed: true })
    if (!rx.document_id) throw new Error('X has no document')
    const x = { docId: rx.document_id }

    const dx = await docOf(x.docId)
    const dy = await docOf(y.docId)
    expect(new Date(dx.received_at).getTime()).toBeLessThan(new Date(dy.received_at).getTime()) // received: X first
    expect(new Date(dx.created_at).getTime()).toBeGreaterThan(new Date(dy.created_at).getTime()) // created: Y first
    expect(dx.received_at).not.toBe(dx.created_at)

    const ids = (await listIds('pm1')).filter((id) => id === x.docId || id === y.docId)
    expect(ids).toEqual([x.docId, y.docId])
  })
})

describe('T-D2-CLASSIFY-PAIR (test-db): refused first on the SAME document, then allowed', () => {
  it('DC: a PM of another project is refused (QE015, nothing changed), then the project PM classifies it: kind pm, one delivery', async () => {
    const d = await makeUnclassifiedDoc(kit, 'pairD')
    expect(await listIds('pm1')).toContain(d.docId)
    const before = await docOf(d.docId)
    expect(before).toMatchObject({ kind: null, kind_source: null, kind_set_by: null, kind_set_at: null })
    expect(await deliveriesOf(d.docId)).toHaveLength(0)

    // 1. the refusal: pm2 is a PM, but of project P2
    const raw = await classifyAsPm(kit, d.docId, 'dc', 'pm2')
    expect(raw.error?.code).toBe('QE015')
    const refused = await runClassify(await depsFor('pm2'), { documentId: d.docId, kind: 'dc' })
    expect(refused).toMatchObject({ status: 'error', key: 'PM_ERR_CLASSIFY_NOT_AVAILABLE', message: copy.PM_ERR_CLASSIFY_NOT_AVAILABLE })
    expect(await docOf(d.docId)).toMatchObject({ kind: null, kind_source: null, kind_set_by: null, kind_set_at: null })
    expect(await deliveriesOf(d.docId)).toHaveLength(0)

    // 2. the same document, the project's own PM
    const ok = await runClassify(await depsFor('pm1'), { documentId: d.docId, kind: 'dc' })
    expect(ok.status).toBe('ok')
    if (ok.status !== 'ok') return
    const dels = await deliveriesOf(d.docId)
    expect(dels.map((x) => x.id)).toEqual([ok.deliveryId])
    const after = await docOf(d.docId)
    expect(after).toMatchObject({ kind: 'dc', kind_source: 'pm', kind_set_by: readerOf(kit, 'pm1').id })
    expect(after.kind_set_at).not.toBeNull()
    expect(await listIds('pm1')).not.toContain(d.docId) // it left the unclassified list

    // T-D2-ALREADY: the same kind again is the same success with the same delivery, and no second delivery
    const again = await runClassify(await depsFor('pm1'), { documentId: d.docId, kind: 'dc' })
    expect(again).toEqual({ status: 'ok', deliveryId: ok.deliveryId })
    expect(await deliveriesOf(d.docId)).toHaveLength(1)

    // T-D2-OTHER-KIND: the other kind is refused with the mapped string and the document is unchanged
    const other = await runClassify(await depsFor('pm1'), { documentId: d.docId, kind: 'invoice' })
    expect(other).toMatchObject({ status: 'error', key: 'PM_ERR_CLASSIFY_OTHER_KIND', message: copy.PM_ERR_CLASSIFY_OTHER_KIND })
    expect(await docOf(d.docId)).toMatchObject({ kind: 'dc', kind_source: 'pm', kind_set_by: readerOf(kit, 'pm1').id })
    expect(await deliveriesOf(d.docId)).toHaveLength(1)

    // D5: the classify page for an already-classified document goes to its delivery
    const page = await getClassifyDocument(await kit.jwt('pm1'), readerOf(kit, 'pm1'), d.docId, NOW)
    expect(page).toEqual({ status: 'redirect', deliveryId: ok.deliveryId })
  })

  it('invoice: refused first, then classified: one delivery AND its active self-link', async () => {
    const e = await makeUnclassifiedDoc(kit, 'pairE')
    const raw = await classifyAsPm(kit, e.docId, 'invoice', 'pm2')
    expect(raw.error?.code).toBe('QE015')
    expect(await docOf(e.docId)).toMatchObject({ kind: null })
    expect(await deliveriesOf(e.docId)).toHaveLength(0)
    expect(await linksOfInvoice(kit, e.docId)).toHaveLength(0)

    const ok = await runClassify(await depsFor('pm1'), { documentId: e.docId, kind: 'invoice' })
    expect(ok.status).toBe('ok')
    if (ok.status !== 'ok') return
    expect((await deliveriesOf(e.docId)).map((x) => x.id)).toEqual([ok.deliveryId])
    const links = await linksOfInvoice(kit, e.docId)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ delivery_id: ok.deliveryId, link_source: 'created_from_invoice' })
  })
})

describe('T-D2-ISOLATION (test-db): another project and another tenant', () => {
  it("a document of project P2 and one of tenant B are absent from pm1's list and are a 404 on direct URL; each is visible to its own PM", async () => {
    const f = await makeUnclassifiedDoc(kit, 'isoF', { projectId: kit.p2, userId: kit.uid('engP2') })
    const g = await makeUnclassifiedDoc(kit, 'isoG', { tenantId: kit.tenantB, projectId: kit.p3, userId: kit.uid('engB') })

    const pm1 = await listIds('pm1')
    expect(pm1).not.toContain(f.docId)
    expect(pm1).not.toContain(g.docId)
    expect(await listIds('pm2')).toContain(f.docId) // positive: the same row IS visible to the right PM
    expect(await listIds('pmB')).toContain(g.docId)
    expect(await listIds('pm2')).not.toContain(g.docId)

    expect(await getClassifyDocument(await kit.jwt('pm1'), readerOf(kit, 'pm1'), f.docId, NOW)).toEqual({ status: 'not-found' })
    expect(await getClassifyDocument(await kit.jwt('pm1'), readerOf(kit, 'pm1'), g.docId, NOW)).toEqual({ status: 'not-found' })
    expect((await getClassifyDocument(await kit.jwt('pm2'), readerOf(kit, 'pm2'), f.docId, NOW)).status).toBe('ok') // positive
    expect(await getClassifyDocument(await kit.jwt('pm1'), readerOf(kit, 'pm1'), 'not-a-uuid', NOW)).toEqual({ status: 'not-found' })
    expect(await getClassifyDocument(await kit.jwt('pm1'), readerOf(kit, 'pm1'), '00000000-0000-4000-8000-000000000000', NOW)).toEqual({ status: 'not-found' })

    // a forged classify with the other project's / tenant's document id: refused, the documents are unchanged
    for (const [docId, label] of [[f.docId, 'pm1'], [g.docId, 'pm1']] as const) {
      const r = await runClassify(await depsFor(label), { documentId: docId, kind: 'dc' })
      expect(r).toMatchObject({ status: 'error', key: 'PM_ERR_CLASSIFY_NOT_AVAILABLE' })
      expect(await docOf(docId)).toMatchObject({ kind: null })
      expect(await deliveriesOf(docId)).toHaveLength(0)
    }
  })
})

describe('T-D2-NOFILE (test-db): the stored-file flag follows the file', () => {
  it('false while the only file is pending, true after it is stored', async () => {
    const h = await makeUnclassifiedDoc(kit, 'fileH')
    const read = async () => {
      const r = await getClassifyDocument(await kit.jwt('pm1'), readerOf(kit, 'pm1'), h.docId, NOW)
      if (r.status !== 'ok') throw new Error(`classify read: ${r.status}`)
      return r.doc
    }
    expect((await read()).hasStoredFile).toBe(false)
    const files = await filesOfDoc(kit, h.docId)
    expect(files).toHaveLength(1)
    await storeFile(kit, files[0].id)
    expect((await read()).hasStoredFile).toBe(true)
    const list = await getUnclassifiedList(await kit.jwt('pm1'), readerOf(kit, 'pm1'))
    if (list.status !== 'ok') throw new Error('list not ok')
    expect(list.items.find((i) => i.documentId === h.docId)?.hasStoredFile).toBe(true)
  })
})
