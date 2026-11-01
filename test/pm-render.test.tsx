import { describe, it, expect, vi } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'

// 'use server' actions import lib/auth/profile ('server-only'), which cannot load under vitest. Rendering never calls
// them, so they are stubbed (the real wrappers are exercised through lib/capture/pm-actions in the test-db suites).
vi.mock('@/app/(dashboard)/material-inward/actions', () => ({
  approveDeliveryAction: vi.fn(),
  rejectDeliveryAction: vi.fn(),
  setDeliveryDetailsAction: vi.fn(),
  linkInvoiceAction: vi.fn(),
  unlinkInvoiceAction: vi.fn(),
}))

import { FileList } from '@/components/material-inward/file-list'
import { DeliveryRow } from '@/components/material-inward/delivery-row'
import { DecisionControls } from '@/app/(dashboard)/material-inward/decision-controls'
import { DetailsControls } from '@/app/(dashboard)/material-inward/details-controls'
import { LinkControls } from '@/app/(dashboard)/material-inward/link-controls'
import * as copy from '@/lib/capture/pm-copy'
import { DetailView } from '@/components/material-inward/detail-view'
import type { PmDetail, PmFileItem, PmListItem } from '@/lib/capture/pm-queries'

// PR-D rendered-output tests (react-dom/server renderToStaticMarkup, the photo-sections-render.test.tsx idiom). No DB,
// no network, no DOM library. T-ACK-1, T-RENDER-1, T-WARN-1.

const FILE_ID = '88888888-8888-4888-8888-888888888888'
const DEL_ID = '99999999-9999-4999-8999-999999999999'
const ACKS = ['yes', 'no', 'partial', 'unclear'] as const
// The opening of an image element, built so this file contains no image markup of its own.
const IMG_OPEN = '<' + 'img'

function item(over: Partial<PmListItem>): PmListItem {
  return {
    id: DEL_ID,
    projectName: 'P',
    status: 'awaiting_pm',
    deliveryType: 'supplier',
    vehicleNumber: 'TN01',
    dcNumber: 'DC-1',
    deliveryDate: '2026-10-30',
    receivedAt: '2026-10-30T05:00:00Z',
    kind: 'dc',
    ack: 'yes',
    createdFromInvoice: false,
    cancelReason: null,
    engineerName: 'E',
    fileCount: 1,
    invoiceExpectedDays: null,
    ...over,
  }
}

describe('T-ACK-1: an invoice never renders a DC ack label and a DC never renders an invoice one', () => {
  for (const ack of [...ACKS, null] as const) {
    it(`invoice, ack=${ack}`, () => {
      const html = renderToStaticMarkup(<DeliveryRow item={item({ kind: 'invoice', ack })} />)
      expect(html).toContain(ack === null ? copy.PM_ACK_NONE : copy.PM_ACK_LABEL.invoice[ack])
      expect(html).not.toContain('[PM_ACK_DC_')
    })
    it(`dc, ack=${ack}`, () => {
      const html = renderToStaticMarkup(<DeliveryRow item={item({ kind: 'dc', ack })} />)
      expect(html).toContain(ack === null ? copy.PM_ACK_NONE : copy.PM_ACK_LABEL.dc[ack])
      expect(html).not.toContain('[PM_ACK_INVOICE_')
    })
  }
  it('POSITIVE CONTROL: the kind drives the label (same ack, different kind, different slot)', () => {
    const a = renderToStaticMarkup(<DeliveryRow item={item({ kind: 'invoice', ack: 'yes' })} />)
    const b = renderToStaticMarkup(<DeliveryRow item={item({ kind: 'dc', ack: 'yes' })} />)
    expect(a).toContain('[PM_ACK_INVOICE_YES]')
    expect(b).toContain('[PM_ACK_DC_YES]')
    expect(a).not.toBe(b)
  })
})

describe('T-RENDER-1: files render as plain links and nothing signed', () => {
  const files: PmFileItem[] = [
    { id: FILE_ID, fileNo: 1, display: 'stored', contentType: 'image/png', previewState: 'previewable' },
    { id: '88888888-8888-4888-8888-888888888881', fileNo: 2, display: 'stored', contentType: 'application/pdf', previewState: 'not_previewable' },
    { id: '88888888-8888-4888-8888-888888888882', fileNo: 3, display: 'pending', contentType: null, previewState: null },
    { id: '88888888-8888-4888-8888-888888888883', fileNo: 4, display: 'pending_timeout', contentType: null, previewState: null },
    { id: '88888888-8888-4888-8888-888888888884', fileNo: 5, display: 'failed', contentType: null, previewState: null },
    { id: '88888888-8888-4888-8888-888888888885', fileNo: 6, display: 'rejected_type', contentType: null, previewState: null },
    { id: '88888888-8888-4888-8888-888888888886', fileNo: 7, display: 'rejected_size', contentType: null, previewState: null },
  ]
  const html = renderToStaticMarkup(<FileList files={files} />)

  it('every link is /api/capture-files/<uuid>, a new tab, noopener noreferrer', () => {
    const anchors = [...html.matchAll(/<a [^>]*>/g)].map((m) => m[0])
    expect(anchors).toHaveLength(2) // only the two STORED files are links
    for (const a of anchors) {
      expect(a).toMatch(/href="\/api\/capture-files\/[0-9a-f-]{36}"/)
      expect(a).toContain('target="_blank"')
      expect(a).toContain('rel="noopener noreferrer"')
    }
  })
  it('no signed URL, token, storage host, image tag or optimiser path anywhere', () => {
    for (const bad of ['token=', 'supabase.co', '/storage/v1', IMG_OPEN, '_next/image', 'data-nimg', 'srcset']) {
      expect(html).not.toContain(bad)
    }
  })
  it('not-stored files are labels only (no anchor)', () => {
    for (const label of [copy.PM_LABEL_FILE_PENDING, copy.PM_LABEL_FILE_PENDING_TIMEOUT, copy.PM_LABEL_FILE_FAILED, copy.PM_LABEL_FILE_REJECTED_TYPE, copy.PM_LABEL_FILE_REJECTED_SIZE]) {
      expect(html).toContain(label)
    }
  })
  it('a not-previewable PDF says so and offers the download slot', () => {
    expect(html).toContain(copy.PM_LABEL_PDF_NOT_PREVIEWABLE)
    expect(html).toContain(copy.PM_FILE_DOWNLOAD)
  })
  it('the 15-minute state and a real failure are different labels', () => {
    expect(copy.PM_LABEL_FILE_PENDING_TIMEOUT).not.toBe(copy.PM_LABEL_FILE_FAILED)
  })
  it('the list row links to the detail PAGE only, never to the file route', () => {
    const row = renderToStaticMarkup(<DeliveryRow item={item({})} />)
    expect([...row.matchAll(/href="([^"]+)"/g)].map((m) => m[1])).toEqual([`/material-inward/${DEL_ID}`])
  })
  it('no component or page of this feature imports next/image or uses an img element, and file links never use next/link', () => {
    const root = resolve(__dirname, '..')
    const dirs = ['components/material-inward', 'app/(dashboard)/material-inward']
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    for (const dir of dirs) {
      for (const f of walk(resolve(root, dir)).filter((p) => /\.(tsx|ts)$/.test(p))) {
        const src = readFileSync(f, 'utf8')
        expect(src, f).not.toMatch(/from 'next\/image'/)
        expect(src, f).not.toMatch(new RegExp(IMG_OPEN + '[\\s>]'))
      }
    }
    expect(readFileSync(resolve(root, 'components/material-inward/file-list.tsx'), 'utf8')).not.toMatch(/from 'next\/link'/)
  })
})

describe('T-WARN-1: approve with no stored file shows the warning AND still allows the approve (D10)', () => {
  it('no stored file: warning present, approve button present and not disabled', () => {
    const html = renderToStaticMarkup(<DecisionControls deliveryId={DEL_ID} hasStoredFile={false} />)
    expect(html).toContain(copy.PM_WARN_APPROVE_NO_FILE)
    const approve = html.match(/<button[^>]*>\[PM_ACTION_APPROVE\]<\/button>/)
    expect(approve).not.toBeNull()
    // the class list contains "disabled:opacity-60"; the ATTRIBUTE is `disabled=""` or a bare ` disabled`
    expect(approve![0]).not.toMatch(/\sdisabled(?=[\s=>])/)
  })
  it('POSITIVE CONTROL: with a stored file the warning is absent', () => {
    const html = renderToStaticMarkup(<DecisionControls deliveryId={DEL_ID} hasStoredFile />)
    expect(html).not.toContain(copy.PM_WARN_APPROVE_NO_FILE)
    expect(html).toContain(copy.PM_ACTION_APPROVE)
  })
  it('there is no block slot (the decision is warn-and-allow)', () => {
    expect('PM_BLOCK_APPROVE_NO_FILE' in copy).toBe(false)
  })
})

describe('controls render only copy constants', () => {
  it('details, decision and link controls contain no signed URL and only placeholder text', () => {
    const loaded = { status: 'incomplete', deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
    const htmls = [
      renderToStaticMarkup(<DetailsControls deliveryId={DEL_ID} loaded={loaded} />),
      renderToStaticMarkup(<DecisionControls deliveryId={DEL_ID} hasStoredFile />),
      renderToStaticMarkup(
        <LinkControls
          mode="dc"
          invoiceDocumentId={null}
          deliveryId={DEL_ID}
          candidates={[{ id: FILE_ID, receivedAt: '2026-10-30T05:00:00Z', dcNumber: null, ack: 'yes', engineerName: null }]}
          unlinkable={[]}
        />,
      ),
    ]
    for (const html of htmls) {
      for (const bad of ['token=', 'supabase.co', '/storage/v1', 'DC missing', ' paid']) expect(html).not.toContain(bad)
    }
    // A DC page offers INVOICES, so its candidate label is an invoice ack and never a DC one.
    expect(htmls[2]).toContain('[PM_ACK_INVOICE_YES]')
    expect(htmls[2]).not.toContain('[PM_ACK_DC_')
  })
})

// ---------------------------------------------------------------------------------------------------------------
// H2 / D-30 F4: `capture_documents.caption` holds the WhatsApp FILE NAME of a forwarded document, not text the engineer
// wrote. The PM page must not show it anywhere. PmDetail and PmListItem do not carry it; these tests inject it anyway (as a
// regression would) and require that no view renders it.
// ---------------------------------------------------------------------------------------------------------------
describe('H2: a caption that is a file name is never rendered', () => {
  const FILE_NAMES = ['phone pdf.pdf', 'WhatsApp Image 2026-10-05 at 10.00.00.jpeg']

  function detail(kind: 'dc' | 'invoice', caption: string): PmDetail {
    const document = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind, ack: 'yes', ackNote: null, caption }
    const base = {
      id: DEL_ID,
      projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      projectName: 'P',
      status: 'awaiting_pm',
      deliveryType: 'supplier',
      vehicleNumber: 'TN01',
      dcNumber: 'DC-1',
      dcDate: '2026-10-30',
      deliveryDate: '2026-10-30',
      receivedAt: '2026-10-30T05:00:00Z',
      cancelReason: null,
      rejectReason: null,
      createdFromInvoice: kind === 'invoice',
      engineerName: 'E',
      document,
      files: [{ id: FILE_ID, fileNo: 1, display: 'stored', contentType: 'image/jpeg', previewState: 'previewable' }],
      hasStoredFile: true,
      activeLinks: [],
      linkedDeliveries: [],
      linkedInvoice: null,
      candidates: [],
      invoiceExpectedDays: null,
    }
    return base as unknown as PmDetail
  }

  for (const name of FILE_NAMES) {
    for (const kind of ['dc', 'invoice'] as const) {
      it(`detail view (${kind}) with caption "${name}" renders neither the name nor any caption label`, () => {
        const html = renderToStaticMarkup(<DetailView d={detail(kind, name)} />)
        expect(html).not.toContain(name)
        expect(html).not.toMatch(/caption/i)
      })
    }
    it(`list row with caption "${name}" renders neither the name nor any caption label`, () => {
      const html = renderToStaticMarkup(<DeliveryRow item={{ ...item({}), caption: name } as unknown as PmListItem} />)
      expect(html).not.toContain(name)
      expect(html).not.toMatch(/caption/i)
    })
  }

  it('POSITIVE CONTROL (sanity): the detail view DOES render the other engineer-visible text it is given (the ack note)', () => {
    const d = detail('dc', 'phone pdf.pdf')
    ;(d.document as { ackNote: string | null }).ackNote = 'ZZ-visible-note'
    expect(renderToStaticMarkup(<DetailView d={d} />)).toContain('ZZ-visible-note')
  })

  it('no caption copy constant exists, and no code of this feature selects or reads a caption', () => {
    expect('PM_FIELD_CAPTION' in copy).toBe(false)
    const root = resolve(__dirname, '..')
    const walk = (d: string): string[] =>
      readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]))
    const dirs = ['lib/capture', 'components/material-inward', 'app/(dashboard)/material-inward']
    for (const dir of dirs) {
      for (const f of walk(resolve(root, dir)).filter((p) => /\.(tsx|ts)$/.test(p))) {
        const code = readFileSync(f, 'utf8')
          .split('\n')
          .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)) // comments may explain WHY; code may not use it
          .join('\n')
        expect(code, f).not.toMatch(/caption/i)
      }
    }
  })
})

// M1: the detail view's OWN ack element (data-testid="own-ack") renders the label of the document's own kind and never the
// other kind's. (Picker candidate rows on the same page carry the OTHER kind's labels by design; this looks at one element only.)
describe('M1: the own-ack element', () => {
  const ownAck = (html: string) => {
    const m = /data-testid="own-ack">([^<]*)</.exec(html)
    if (!m) throw new Error('own-ack element not found')
    return m[1]
  }
  const view = (kind: 'dc' | 'invoice', ack: string | null) =>
    renderToStaticMarkup(
      <DetailView
        d={
          {
            id: DEL_ID,
            projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
            projectName: 'P',
            status: 'awaiting_pm',
            deliveryType: 'supplier',
            vehicleNumber: null,
            dcNumber: null,
            dcDate: null,
            deliveryDate: '2026-10-30',
            receivedAt: '2026-10-30T05:00:00Z',
            cancelReason: null,
            rejectReason: null,
            createdFromInvoice: kind === 'invoice',
            engineerName: 'E',
            document: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind, ack, ackNote: null },
            files: [],
            hasStoredFile: false,
            activeLinks: [],
            linkedDeliveries: [],
            linkedInvoice: null,
            candidates: [],
            invoiceExpectedDays: null,
          } as unknown as PmDetail
        }
      />,
    )

  for (const ack of ACKS) {
    it(`invoice, ack=${ack}: the own-ack element is the invoice label and not a DC one`, () => {
      const t = ownAck(view('invoice', ack))
      expect(t).toBe(copy.PM_ACK_LABEL.invoice[ack])
      expect(t).not.toContain('[PM_ACK_DC_')
    })
    it(`dc, ack=${ack}: the own-ack element is the DC label and not an invoice one`, () => {
      const t = ownAck(view('dc', ack))
      expect(t).toBe(copy.PM_ACK_LABEL.dc[ack])
      expect(t).not.toContain('[PM_ACK_INVOICE_')
    })
  }
  it('no ack: both kinds show the no-ack slot', () => {
    expect(ownAck(view('invoice', null))).toBe(copy.PM_ACK_NONE)
    expect(ownAck(view('dc', null))).toBe(copy.PM_ACK_NONE)
  })
})
