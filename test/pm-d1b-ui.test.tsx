import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

vi.mock('@/app/(dashboard)/material-inward/actions', () => ({
  approveDeliveryAction: vi.fn(),
  rejectDeliveryAction: vi.fn(),
  setDeliveryDetailsAction: vi.fn(),
  linkInvoiceAction: vi.fn(),
  unlinkInvoiceAction: vi.fn(),
}))

import { DecisionControls } from '@/app/(dashboard)/material-inward/decision-controls'
import { DetailsControls } from '@/app/(dashboard)/material-inward/details-controls'
import { LinkControls } from '@/app/(dashboard)/material-inward/link-controls'
import { DeliveryRow } from '@/components/material-inward/delivery-row'
import { DetailView } from '@/components/material-inward/detail-view'
import { DetailsDirtyContext } from '@/components/material-inward/details-dirty'
import { formatIstDate } from '@/components/material-inward/labels'
import * as copy from '@/lib/capture/pm-copy'
import type { PmDetail, PmListItem } from '@/lib/capture/pm-queries'

// PR-D1b rendered-output tests (renderToStaticMarkup, no DOM library: R6). Interactions (typing, Back, Esc, focus, Rotate)
// are in the manual run, not here.

const DEL_ID = '99999999-9999-4999-8999-999999999999'
const FILE_ID = '88888888-8888-4888-8888-888888888888'

function buttonTag(html: string, label: string): string {
  const esc = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const m = html.match(new RegExp('<button[^>]*>' + esc + '</button>'))
  if (!m) throw new Error(`button "${label}" not found`)
  return m[0]
}
const isDisabled = (tag: string) => /\sdisabled(?=[\s=>])/.test(tag)

describe('R1: Approve and Reject are disabled while the form differs from the loaded values', () => {
  it('DIRTY form: both buttons disabled, labels unchanged', () => {
    const html = renderToStaticMarkup(
      <DetailsDirtyContext.Provider value={true}>
        <DecisionControls deliveryId={DEL_ID} hasStoredFile />
      </DetailsDirtyContext.Provider>,
    )
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_APPROVE))).toBe(true)
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_REJECT))).toBe(true)
  })
  it('CLEAN (saved) form: both buttons enabled', () => {
    const html = renderToStaticMarkup(
      <DetailsDirtyContext.Provider value={false}>
        <DecisionControls deliveryId={DEL_ID} hasStoredFile />
      </DetailsDirtyContext.Provider>,
    )
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_APPROVE))).toBe(false)
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_REJECT))).toBe(false)
  })
  it('wiring: DetailsControls with the loaded values as rendered is clean, so the Approve inside it is enabled', () => {
    const loaded = { status: 'incomplete', deliveryType: 'supplier', vehicleNumber: 'TN01', dcNumber: 'DC-1', dcDate: '2026-10-30' }
    const html = renderToStaticMarkup(
      <DetailsControls deliveryId={DEL_ID} loaded={loaded}>
        <DecisionControls deliveryId={DEL_ID} hasStoredFile />
      </DetailsControls>,
    )
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_APPROVE))).toBe(false)
  })
})

describe('F1: a delivery with no details yet starts clean', () => {
  it('all-null loaded values, form as first rendered: Approve and Reject are enabled', () => {
    const loaded = { status: 'incomplete', deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
    const html = renderToStaticMarkup(
      <DetailsControls deliveryId={DEL_ID} loaded={loaded}>
        <DecisionControls deliveryId={DEL_ID} hasStoredFile />
      </DetailsControls>,
    )
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_APPROVE))).toBe(false)
    expect(isDisabled(buttonTag(html, copy.PM_ACTION_REJECT))).toBe(false)
  })
})

describe('F2: a closed overlay requests no image; one image per thumbnail', () => {
  const ids = ['88888888-8888-4888-8888-888888888881', '88888888-8888-4888-8888-888888888882', '88888888-8888-4888-8888-888888888883']
  const d = {
    id: DEL_ID, projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', projectName: 'P', status: 'awaiting_pm', deliveryType: null,
    vehicleNumber: null, dcNumber: null, dcDate: null, deliveryDate: '2026-10-30', receivedAt: '2026-10-30T05:00:00Z',
    cancelReason: null, rejectReason: null, createdFromInvoice: false, engineerName: 'E',
    document: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind: 'dc', ack: 'yes', ackNote: null },
    files: ids.map((id, i) => ({ id, fileNo: i + 1, display: 'stored', contentType: 'image/jpeg', previewState: 'previewable' })),
    hasStoredFile: true, activeLinks: [], linkedDeliveries: [], linkedInvoice: null, candidates: [], invoiceExpectedDays: null,
  } as unknown as PmDetail
  const html = renderToStaticMarkup(<DetailView d={d} />)
  const imgs = [...html.matchAll(/<img [^>]*>/g)].map((m) => m[0])
  const preloads = [...html.matchAll(/<link [^>]*rel="preload"[^>]*>/g)].map((m) => m[0]).filter((t) => t.includes('as="image"'))

  it(`N=${ids.length} stored images: exactly N image elements, each the route path`, () => {
    expect(imgs).toHaveLength(ids.length)
    expect(imgs.map((t) => /src="([^"]+)"/.exec(t)?.[1]).sort()).toEqual(ids.map((id) => `/api/capture-files/${id}`).sort())
    console.log(`F2 counts: img=${imgs.length} preload-image-links=${preloads.length}`)
  })
  it('at most N image preload links, each pointing at /api/capture-files/<id>', () => {
    expect(preloads.length).toBeLessThanOrEqual(ids.length)
    for (const t of preloads) expect(t).toMatch(/href="\/api\/capture-files\/[0-9a-f-]{36}"/)
  })
  it('the overlay (dialog and its full-screen image) is not in the page while closed', () => {
    expect(html).not.toContain('<dialog')
    expect(html).not.toContain(copy.PM_VIEWER_CLOSE)
    expect(html).not.toContain(copy.PM_VIEWER_ROTATE)
  })
})

describe('item 1 / 2: the form order, the collapsed block, and no vehicle', () => {
  const loaded = { status: 'incomplete', deliveryType: null, vehicleNumber: 'TN01AB1234', dcNumber: null, dcDate: null }
  const html = renderToStaticMarkup(
    <DetailsControls deliveryId={DEL_ID} loaded={loaded}>
      <DecisionControls deliveryId={DEL_ID} hasStoredFile />
    </DetailsControls>,
  )
  const at = (s: string) => html.indexOf(s)

  it('order: delivery type, then Approve, then Reject, then the "More details (optional)" block with DC no. and DC date', () => {
    const order = [copy.PM_FIELD_TYPE, copy.PM_ACTION_APPROVE, copy.PM_ACTION_REJECT, copy.PM_DETAILS_TOGGLE, copy.PM_FIELD_DC_NUMBER, copy.PM_FIELD_DC_DATE]
    const positions = order.map(at)
    for (const p of positions) expect(p).toBeGreaterThanOrEqual(0)
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
  })
  it('the DC fields are inside a <details> that is collapsed (no open attribute)', () => {
    const d = html.match(/<details[^>]*>/)
    expect(d).not.toBeNull()
    expect(d![0]).not.toContain('open')
    expect(html.indexOf('<details')).toBeLessThan(at(copy.PM_FIELD_DC_NUMBER))
    expect(at(copy.PM_FIELD_DC_DATE)).toBeLessThan(html.indexOf('</details>'))
  })
  it('two "Save details" buttons: one under the type, one inside the collapsed block', () => {
    expect(html.split(`>${copy.PM_ACTION_SAVE_DETAILS}</button>`).length - 1).toBe(2)
  })
  it('no vehicle field and no stored vehicle value is rendered by the form', () => {
    expect(html).not.toMatch(/vehicle/i)
    expect(html).not.toContain('TN01AB1234')
  })
})

describe('item 2: the list row no longer shows a vehicle', () => {
  it('a row with a vehicle number renders neither the number nor a vehicle label', () => {
    const item = {
      id: DEL_ID, projectName: 'P', status: 'awaiting_pm', deliveryType: 'supplier', vehicleNumber: 'TN01AB1234', dcNumber: 'DC-1',
      deliveryDate: '2026-10-30', receivedAt: '2026-10-30T05:00:00Z', kind: 'dc', ack: 'yes', createdFromInvoice: false,
      cancelReason: null, engineerName: 'E', fileCount: 1, invoiceExpectedDays: null,
    } as PmListItem
    const html = renderToStaticMarkup(<DeliveryRow item={item} />)
    expect(html).not.toContain('TN01AB1234')
    expect(html).not.toMatch(/vehicle/i)
    expect(html).toContain('DC-1')
  })
})

describe('item 4 / 9: the detail page order, the photo above or beside the form, and the DC / GRN label', () => {
  function detail(kind: 'dc' | 'invoice', deliveryType: string | null): PmDetail {
    return {
      id: DEL_ID, projectId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', projectName: 'P', status: 'awaiting_pm', deliveryType,
      vehicleNumber: 'TN01AB1234', dcNumber: null, dcDate: null, deliveryDate: '2026-10-30', receivedAt: '2026-10-30T05:00:00Z',
      cancelReason: null, rejectReason: null, createdFromInvoice: kind === 'invoice', engineerName: 'E',
      document: { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', kind, ack: 'yes', ackNote: null },
      files: [{ id: FILE_ID, fileNo: 1, display: 'stored', contentType: 'image/jpeg', previewState: 'previewable' }],
      hasStoredFile: true, activeLinks: [], linkedDeliveries: [], linkedInvoice: null, candidates: [], invoiceExpectedDays: null,
    } as unknown as PmDetail
  }
  it('a DC shows "DC / GRN"; an invoice still shows "Invoice"; an internal transfer shows "Internal transfer"', () => {
    const dc = renderToStaticMarkup(<DetailView d={detail('dc', 'internal_transfer')} />)
    expect(dc).toContain(copy.PM_KIND_DC)
    expect(dc).toContain(copy.PM_TYPE_INTERNAL_TRANSFER)
    expect(dc).not.toContain('Internal GRN')
    expect(renderToStaticMarkup(<DetailView d={detail('invoice', 'supplier')} />)).toContain(copy.PM_KIND_INVOICE)
  })
  it('the Files card comes before the form in the markup (above on a narrow screen), in a two-column grid from lg', () => {
    const html = renderToStaticMarkup(<DetailView d={detail('dc', null)} />)
    expect(html.indexOf(`>${copy.PM_FIELD_FILES}<`)).toBeGreaterThan(-1)
    expect(html.indexOf(`>${copy.PM_FIELD_FILES}<`)).toBeLessThan(html.indexOf(copy.PM_FIELD_TYPE))
    expect(html).toContain('lg:grid-cols-2')
  })
  it('the page puts delivery type, Approve, Reject, then More details, in that order', () => {
    const html = renderToStaticMarkup(<DetailView d={detail('dc', null)} />)
    const positions = [copy.PM_FIELD_TYPE, copy.PM_ACTION_APPROVE, copy.PM_ACTION_REJECT, copy.PM_DETAILS_TOGGLE].map((s) => html.indexOf(s))
    expect([...positions].sort((a, b) => a - b)).toEqual(positions)
    expect(positions.every((p) => p >= 0)).toBe(true)
  })
})

describe('item 8: the picker option line, rendered', () => {
  it('a DC page lists invoices as "{date}, {time} · {engineer} · {answer}"', () => {
    const html = renderToStaticMarkup(
      <LinkControls
        mode="dc"
        invoiceDocumentId={null}
        deliveryId={DEL_ID}
        candidates={[{ id: FILE_ID, receivedAt: null, documentCreatedAt: '2026-11-02T05:03:00Z', dcNumber: null, ack: 'yes', engineerName: 'Ravi' }]}
        unlinkable={[]}
      />,
    )
    expect(html).toContain(`${formatIstDate('2026-11-02T05:03:00Z')}, 10:33 am · Ravi · ${copy.PM_ACK_INVOICE_YES}`)
  })
})

// S2 (review round 1): a save or STATE_CHANGED refresh must not remount Approve / Reject, or the typed reject reason is lost.
// A remount needs a React `key` that changes with the loaded values, on an element that CONTAINS DecisionControls. renderToStaticMarkup
// cannot show a remount, so this is a structural check on the source of the two files that place it. The behaviour itself is the
// manual S2 run (type a reason, change the type, Save: the reason stays).
describe('S2: DecisionControls is not inside a keyed element', () => {
  const root = resolve(__dirname, '..')
  const detailView = readFileSync(resolve(root, 'components/material-inward/detail-view.tsx'), 'utf8')
  const detailsControls = readFileSync(resolve(root, 'app/(dashboard)/material-inward/details-controls.tsx'), 'utf8')
  const code = (src: string) => src.replace(/\{\/\*[\s\S]*?\*\/\}/g, '').replace(/^\s*\/\/.*$/gm, '')

  it('detail-view.tsx: the DetailsControls element that wraps DecisionControls carries no key', () => {
    const open = code(detailView).match(/<DetailsControls\b[^>]*>/)
    expect(open).not.toBeNull()
    expect(open![0]).not.toMatch(/\bkey=/)
  })
  it('detail-view.tsx: no key={...} anywhere on the way from the card to DecisionControls', () => {
    const between = code(detailView).split('<DetailsControls')[1]?.split('</DetailsControls>')[0] ?? ''
    expect(between).not.toMatch(/\bkey=/)
  })
  it('details-controls.tsx: {children} is not rendered inside a keyed element', () => {
    expect(code(detailsControls)).not.toMatch(/\bkey=/)
  })
  it('details-controls.tsx resets its own draft when the loaded values change (D8 kept without a remount)', () => {
    expect(code(detailsControls)).toMatch(/seenKey !== loadedKey/)
  })
})
