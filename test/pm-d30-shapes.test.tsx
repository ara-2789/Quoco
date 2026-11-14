import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { NextRequest } from 'next/server'

// Server Actions import lib/auth/profile ('server-only'); rendering never calls them (see pm-render.test.tsx).
vi.mock('@/app/(dashboard)/material-inward/actions', () => ({
  approveDeliveryAction: vi.fn(),
  rejectDeliveryAction: vi.fn(),
  setDeliveryDetailsAction: vi.fn(),
  linkInvoiceAction: vi.fn(),
  unlinkInvoiceAction: vi.fn(),
}))

import {
  D30_CAPTION_JPEG,
  D30_CAPTION_PDF,
  activeLinkIds,
  buildPmKit,
  deliveryRow,
  makeD30Shapes,
  removeStoredObjects,
  teardownCaptureKit,
  readerOf,
  type CaptureKit,
  type D30Shapes,
} from './helpers/pm-fixtures'
import { getDeliveryDetail, getMaterialInwardList } from '@/lib/capture/pm-queries'
import { handleCaptureFileGet } from '@/lib/capture/pm-file-access'
import { DetailView } from '@/components/material-inward/detail-view'
import * as copy from '@/lib/capture/pm-copy'

// The REAL approved values (2 Nov), compared whole (the two 'unclear' values share a prefix).
const DC_ACK_VALUES = Object.values(copy.PM_ACK_LABEL.dc)
const INVOICE_ACK_VALUES = Object.values(copy.PM_ACK_LABEL.invoice)
function expectNoneOf(text: string, values: string[]) {
  for (const v of values) expect(text, `must not contain ${JSON.stringify(v)}`).not.toContain(v)
}

// H3: the shapes the real D-30 test produced (docs/reviews/d30-record.md): a document with several stored files, a
// file-name caption, and an invoice with its automatic self-link and an awaiting_pm automatic delivery. Shared test-db,
// this run's own tenants only. Tests that use them: this file (reads, rendering, file route).

const HOOK_TIMEOUT_MS = 90_000
vi.setConfig({ testTimeout: 60_000 })

let kit: CaptureKit
let shapes: D30Shapes
let setup: Promise<void> | undefined
const NOW = new Date()

async function timed<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t0 = Date.now()
  try {
    return await fn()
  } finally {
    console.log(`[pm-d30-shapes] ${label}: ${Date.now() - t0} ms`)
  }
}

beforeAll(() => {
  setup = (async () => {
    kit = await timed('buildPmKit', () => buildPmKit('pmd3'))
    shapes = await timed('makeD30Shapes (dc 2 files + invoice 3 files, stored and acked)', () => makeD30Shapes(kit))
  })()
  return setup
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  if (setup) await setup.catch(() => undefined)
  if (!kit) return
  await timed('removeStoredObjects', () => removeStoredObjects(kit))
  await timed('teardownCaptureKit', () => teardownCaptureKit(kit))
}, HOOK_TIMEOUT_MS)

describe('the fixtures really have the D-30 shape (service-role read-back)', () => {
  it('DC: two stored files, the caption is the WhatsApp file name, awaiting_pm', async () => {
    const { data: files } = await kit.svc.from('capture_files').select('id, ingest_status, file_no').eq('document_id', shapes.dcTwoFiles.docId).order('file_no')
    expect((files ?? []).map((f: { ingest_status: string }) => f.ingest_status)).toEqual(['stored', 'stored'])
    const { data: doc } = await kit.svc.from('capture_documents').select('caption, engineer_ack, kind').eq('id', shapes.dcTwoFiles.docId).single()
    expect(doc).toMatchObject({ caption: D30_CAPTION_JPEG, engineer_ack: 'yes', kind: 'dc' })
    expect((await deliveryRow(kit, shapes.dcTwoFiles.deliveryId)).status).toBe('awaiting_pm')
  })
  it('invoice: three stored files, caption is a file name, awaiting_pm automatic delivery with exactly ONE active self-link', async () => {
    const { data: files } = await kit.svc.from('capture_files').select('ingest_status').eq('document_id', shapes.invThreeFiles.docId)
    expect((files ?? []).map((f: { ingest_status: string }) => f.ingest_status)).toEqual(['stored', 'stored', 'stored'])
    const { data: doc } = await kit.svc.from('capture_documents').select('caption, engineer_ack, kind').eq('id', shapes.invThreeFiles.docId).single()
    expect(doc).toMatchObject({ caption: D30_CAPTION_PDF, engineer_ack: 'yes', kind: 'invoice' })
    const delivery = await deliveryRow(kit, shapes.invThreeFiles.deliveryId)
    expect(delivery.status).toBe('awaiting_pm')
    expect(delivery.created_from_invoice_id).toBe(shapes.invThreeFiles.docId)
    const links = await activeLinkIds(kit, shapes.invThreeFiles.docId)
    expect(links.map((l) => l.link_source)).toEqual(['created_from_invoice'])
    expect(links[0].delivery_id).toBe(shapes.invThreeFiles.deliveryId)
  })
})

describe('the PM page data layer on those shapes', () => {
  it('detail of the multi-file DC: both files are listed as stored', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), shapes.dcTwoFiles.deliveryId, NOW)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.detail.files.map((f) => f.display)).toEqual(['stored', 'stored'])
    expect(r.detail.files.map((f) => f.id).sort()).toEqual([...shapes.dcTwoFiles.fileIds].sort())
    expect(r.detail.hasStoredFile).toBe(true)
    expect(r.detail.status).toBe('awaiting_pm')
  })

  it('detail of the invoice: three stored files, created from the invoice, its self-link is the only active link', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), shapes.invThreeFiles.deliveryId, NOW)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.detail.document.kind).toBe('invoice')
    expect(r.detail.createdFromInvoice).toBe(true)
    expect(r.detail.status).toBe('awaiting_pm')
    expect(r.detail.files.map((f) => f.display)).toEqual(['stored', 'stored', 'stored'])
    expect(r.detail.activeLinks.map((l) => l.linkSource)).toEqual(['created_from_invoice'])
    expect(r.detail.linkedDeliveries).toEqual([]) // an automatic self-link is not an unlinkable PM link
  })

  it('the list shows both in the open group, and neither the list nor either detail carries the caption', async () => {
    const jwt = await kit.jwt('pm1')
    const list = await getMaterialInwardList(jwt, readerOf(kit, 'pm1'), NOW)
    expect(list.status).toBe('ok')
    const items = list.status === 'ok' ? list.items : []
    expect(items.map((i) => i.id)).toEqual(expect.arrayContaining([shapes.dcTwoFiles.deliveryId, shapes.invThreeFiles.deliveryId]))
    expect(items.filter((i) => [shapes.dcTwoFiles.deliveryId, shapes.invThreeFiles.deliveryId].includes(i.id)).map((i) => i.status)).toEqual(['awaiting_pm', 'awaiting_pm'])
    const a = await getDeliveryDetail(jwt, readerOf(kit, 'pm1'), shapes.dcTwoFiles.deliveryId, NOW)
    const b = await getDeliveryDetail(jwt, readerOf(kit, 'pm1'), shapes.invThreeFiles.deliveryId, NOW)
    const everything = JSON.stringify({ list, a, b })
    expect(everything).not.toContain(D30_CAPTION_JPEG)
    expect(everything).not.toContain(D30_CAPTION_PDF)
    expect(everything.toLowerCase()).not.toContain('caption')
  })
})

describe('rendering the REAL detail objects of those shapes', () => {
  it('the multi-file DC page: one plain link per stored file to /api/capture-files/<id>, no caption, nothing signed', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), shapes.dcTwoFiles.deliveryId, NOW)
    if (r.status !== 'ok') throw new Error('detail not ok')
    const html = renderToStaticMarkup(<DetailView d={r.detail} />)
    const hrefs = [...html.matchAll(/href="(\/api\/capture-files\/[0-9a-f-]{36})"/g)].map((m) => m[1]).sort()
    expect(hrefs).toEqual(shapes.dcTwoFiles.fileIds.map((id) => `/api/capture-files/${id}`).sort())
    expect(html).not.toContain(D30_CAPTION_JPEG)
    expect(html).not.toMatch(/caption/i)
    for (const bad of ['token=', 'supabase.co', '/storage/v1']) expect(html).not.toContain(bad)
  })

  it('the invoice page: three file links, the invoice ack label (never a DC one), no caption', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), shapes.invThreeFiles.deliveryId, NOW)
    if (r.status !== 'ok') throw new Error('detail not ok')
    const html = renderToStaticMarkup(<DetailView d={r.detail} />)
    expect([...html.matchAll(/href="\/api\/capture-files\//g)]).toHaveLength(3)
    // The invoice's OWN ack element renders an invoice label and never a DC one. (The page also lists DC deliveries to link,
    // and each of those rows carries ITS OWN DC label: see the next test. So this test looks at the own-ack element only.)
    expect(ownAck(html)).toBe(copy.PM_ACK_INVOICE_YES)
    expectNoneOf(ownAck(html), DC_ACK_VALUES)
    expect(html).not.toContain(D30_CAPTION_PDF)
    expect(html).not.toMatch(/caption/i)
  })

  it('the invoice page: every picker candidate row (a PM-classified DC delivery) renders the neutral ack label (PR-D2, D8)', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), shapes.invThreeFiles.deliveryId, NOW)
    if (r.status !== 'ok') throw new Error('detail not ok')
    // the multi-file DC (acked yes, awaiting_pm, no link) is an eligible candidate for this invoice
    expect(r.detail.candidates.map((c) => c.id)).toContain(shapes.dcTwoFiles.deliveryId)
    // 052: these fixtures are classified by the PM (makeDocWithCaption -> classifyAsPm), so the candidate's own kind_source is 'pm' and the
    // engineer was asked the neutral question: D8 shows "Matches", not the pre-052 DC wording.
    expect(r.detail.candidates.every((c) => c.kindSource === 'pm')).toBe(true)
    expect(r.detail.candidates.every((c) => c.ack === null || ['yes', 'no', 'partial', 'unclear'].includes(c.ack))).toBe(true)
    const html = renderToStaticMarkup(<DetailView d={r.detail} />)
    const rows = [...html.matchAll(/<label class="flex items-center gap-2[^>]*>.*?<\/label>/g)].map((m) => m[0])
    expect(rows.length).toBe(r.detail.candidates.length)
    for (const row of rows) {
      expect([...INVOICE_ACK_VALUES, copy.PM_ACK_DC_UNCLEAR, copy.PM_ACK_NONE].some((v) => row.includes(v)), 'the row carries a neutral ack value or the no-answer value').toBe(true)
      expectNoneOf(row, [copy.PM_ACK_DC_YES, copy.PM_ACK_DC_NO, copy.PM_ACK_DC_PARTIAL]) // the per-kind DC wording is for engineer_declared rows only
    }
    expect(rows.some((row) => row.includes(copy.PM_ACK_INVOICE_YES))).toBe(true) // the positive expectation
  })

  it('the DC page (PM-classified): its own ack is the neutral "Matches" (PR-D2, D8), never the pre-052 DC wording', async () => {
    const r = await getDeliveryDetail(await kit.jwt('pm1'), readerOf(kit, 'pm1'), shapes.dcTwoFiles.deliveryId, NOW)
    if (r.status !== 'ok') throw new Error('detail not ok')
    const html = renderToStaticMarkup(<DetailView d={r.detail} />)
    expect(r.detail.document.kindSource).toBe('pm')
    expect(ownAck(html)).toBe(copy.PM_ACK_INVOICE_YES)
    expectNoneOf(ownAck(html), [copy.PM_ACK_DC_YES, copy.PM_ACK_DC_NO, copy.PM_ACK_DC_PARTIAL])
  })
})

/** The text of the detail view's own-ack element (data-testid="own-ack"), and nothing else on the page. */
function ownAck(html: string): string {
  const m = /data-testid="own-ack">([^<]*)</.exec(html)
  if (!m) throw new Error('own-ack element not found in the markup')
  return m[1]
}

describe('the file route on a multi-file document', () => {
  const req = (id: string) => new NextRequest(`http://localhost/api/capture-files/${id}`)

  it('EVERY stored file of the document opens for the owning PM (302), not only the first', async () => {
    for (const id of shapes.dcTwoFiles.fileIds) {
      const res = await handleCaptureFileGet(req(id), { fileId: id }, { supabaseClient: await kit.jwt('pm1'), serviceClient: kit.svc, rateLimit: { store: new Map() } })
      expect(res.status, `file ${id}`).toBe(302)
      expect(res.headers.get('referrer-policy')).toBe('no-referrer')
    }
  })

  it('a PM of another project is refused for the second file with the identical 404', async () => {
    const id = shapes.dcTwoFiles.fileIds[1]
    const res = await handleCaptureFileGet(req(id), { fileId: id }, { supabaseClient: await kit.jwt('pm2'), serviceClient: kit.svc, rateLimit: { store: new Map() } })
    expect(res.status).toBe(404)
    expect(res.headers.get('cache-control')).toBe('no-store')
    expect(await res.text()).toBe('')
  })
})
