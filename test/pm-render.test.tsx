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
import type { PmFileItem, PmListItem } from '@/lib/capture/pm-queries'

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
