import { describe, it, expect } from 'vitest'
import { formatIstTime, formatIstDate, linkOptionLabel } from '@/components/material-inward/labels'
import { buildDetailsNext, isDetailsDirty } from '@/components/material-inward/details-next'
import { isViewableImage, isViewerHash, nextRotation, parseViewerHash, viewerHash } from '@/components/material-inward/viewer-logic'
import { isMoreDetailsDirty } from '@/components/material-inward/details-dirty'
import * as copy from '@/lib/capture/pm-copy'

// PR-D1b pure tests. Node only: no database, no DOM, no network.

describe('R2: formatIstTime (12-hour IST, lowercase am/pm)', () => {
  const cases: Array<[string, string]> = [
    ['2026-11-02T05:03:00Z', '10:33 am'], // 05:03 UTC = 10:33 IST
    ['2026-11-02T18:30:00Z', '12:00 am'], // 00:00 IST the next day
    ['2026-11-02T18:45:00Z', '12:15 am'], // 00:xx -> 12:xx am
    ['2026-11-02T06:30:00Z', '12:00 pm'], // 12:00 IST
    ['2026-11-02T07:05:00Z', '12:35 pm'], // 12:xx -> 12:xx pm
    ['2026-11-02T07:30:00Z', '1:00 pm'],
    ['2026-11-02T17:29:00Z', '10:59 pm'],
    ['2026-11-02T00:05:00Z', '5:35 am'],
  ]
  for (const [iso, want] of cases) it(`${iso} -> ${want}`, () => expect(formatIstTime(iso)).toBe(want))

  it('a UTC instant that crosses the IST date line: the date and the time both move to the next IST day', () => {
    const iso = '2026-11-02T20:10:00Z' // 1:40 am on 3 Nov in IST
    expect(formatIstTime(iso)).toBe('1:40 am')
    expect(formatIstDate(iso)).toBe(formatIstDate('2026-11-03T05:00:00Z')) // same IST calendar day as a 3 Nov morning
    expect(formatIstDate(iso)).not.toBe(formatIstDate('2026-11-02T05:00:00Z'))
  })
  it('missing or invalid input is an em dash, never "NaN"', () => {
    expect(formatIstTime(null)).toBe('—')
    expect(formatIstTime('not a date')).toBe('—')
  })
})

describe('R2 / item 8: the picker option line', () => {
  const base = { receivedAt: '2026-11-02T05:03:00Z', documentCreatedAt: null, engineerName: 'Ravi', ack: 'yes' as const }
  it('is "{date}, {time} · {engineer} · {answer}", with the answer of the candidate\'s own kind', () => {
    expect(linkOptionLabel(base, 'dc')).toBe(`${formatIstDate(base.receivedAt)}, 10:33 am · Ravi · ${copy.PM_ACK_DC_YES}`)
    expect(linkOptionLabel(base, 'invoice')).toBe(`${formatIstDate(base.receivedAt)}, 10:33 am · Ravi · ${copy.PM_ACK_INVOICE_YES}`)
  })
  it('an invoice candidate uses its document time; no engineer is an em dash; no answer is the no-answer label', () => {
    const l = linkOptionLabel({ receivedAt: null, documentCreatedAt: '2026-11-02T05:03:00Z', engineerName: null, ack: null }, 'invoice')
    expect(l).toBe(`${formatIstDate('2026-11-02T05:03:00Z')}, 10:33 am · — · ${copy.PM_ACK_NONE}`)
  })
  it('text inside a name is never treated as a placeholder or a replacement pattern', () => {
    const l = linkOptionLabel({ ...base, engineerName: '{answer} $& $1' }, 'dc')
    expect(l).toContain(' · {answer} $& $1 · ')
  })
})

describe('R1 / vehicle pass-through: buildDetailsNext', () => {
  const loaded = { deliveryType: 'supplier', vehicleNumber: 'TN01AB1234', dcNumber: 'DC-1', dcDate: '2026-10-30' }
  it('PASS-THROUGH: changing DC no. and DC date sends the LOADED vehicle unchanged', () => {
    const next = buildDetailsNext(loaded, { deliveryType: 'supplier', dcNumber: 'DC-2', dcDate: '2026-11-02' })
    expect(next).toEqual({ deliveryType: 'supplier', vehicleNumber: 'TN01AB1234', dcNumber: 'DC-2', dcDate: '2026-11-02' })
    expect(next.vehicleNumber).toBe('TN01AB1234')
  })
  it('a delivery with no vehicle stays with no vehicle', () => {
    expect(buildDetailsNext({ ...loaded, vehicleNumber: null }, { deliveryType: '', dcNumber: '', dcDate: '' }).vehicleNumber).toBeNull()
  })
})

describe('R1: isDetailsDirty', () => {
  const loaded = { deliveryType: 'supplier', vehicleNumber: 'V', dcNumber: 'DC-1', dcDate: '2026-10-30' }
  const same = { deliveryType: 'supplier', dcNumber: 'DC-1', dcDate: '2026-10-30' }
  it('the loaded values are clean', () => expect(isDetailsDirty(loaded, same)).toBe(false))
  it('each form field makes it dirty', () => {
    expect(isDetailsDirty(loaded, { ...same, deliveryType: 'internal_transfer' })).toBe(true)
    expect(isDetailsDirty(loaded, { ...same, dcNumber: 'DC-2' })).toBe(true)
    expect(isDetailsDirty(loaded, { ...same, dcDate: '2026-10-31' })).toBe(true)
  })
  it('null and empty are the same, and surrounding spaces do not count (the server trims)', () => {
    const empty = { deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
    expect(isDetailsDirty(empty, { deliveryType: '', dcNumber: '   ', dcDate: '' })).toBe(false)
    expect(isDetailsDirty(loaded, { ...same, dcNumber: ' DC-1 ' })).toBe(false)
  })
  it('F1: all-null loaded values and the form state as FIRST RENDERED (null -> empty string, as DetailsControls initialises it) are NOT dirty', () => {
    const loadedNull = { deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
    const firstRender = { deliveryType: loadedNull.deliveryType ?? '', dcNumber: loadedNull.dcNumber ?? '', dcDate: loadedNull.dcDate ?? '' }
    expect(isDetailsDirty(loadedNull, firstRender)).toBe(false)
  })
  it('F1: whitespace-only input against null is NOT dirty, for every text field', () => {
    const loadedNull = { deliveryType: null, vehicleNumber: null, dcNumber: null, dcDate: null }
    expect(isDetailsDirty(loadedNull, { deliveryType: ' ', dcNumber: '   ', dcDate: ' ' })).toBe(false)
  })
  it('the vehicle is not a form field, so it can never make the form dirty', () => {
    expect(isDetailsDirty({ ...loaded, vehicleNumber: 'OTHER' }, same)).toBe(false)
  })
})

describe('R3: the viewer hash', () => {
  const A = '88888888-8888-4888-8888-888888888888'
  const B = '99999999-9999-4999-8999-999999999999'
  it('round trip: a hash made for a known id parses back to it', () => expect(parseViewerHash(viewerHash(A), [A, B])).toBe(A))
  it('is case-insensitive on the id and returns the id as it is in the list', () => {
    expect(parseViewerHash(`#photo-${A.toUpperCase()}`, [A])).toBe(A)
  })
  it('an id that is not in this delivery\'s viewable images does not parse', () => expect(parseViewerHash(viewerHash(B), [A])).toBeNull())
  it('anything else does not parse: empty, no prefix, other prefix, short id, extra text', () => {
    for (const h of ['', '#', '#photo-', `#${A}`, `#file-${A}`, '#photo-123', `#photo-${A}x`, `#photo-${A}/`]) {
      expect(parseViewerHash(h, [A]), h).toBeNull()
    }
  })
  it('isViewerHash: any #photo-* is the viewer\'s family (cleared on mount, even a malformed one)', () => {
    expect(isViewerHash(viewerHash(A))).toBe(true)
    expect(isViewerHash('#photo-junk')).toBe(true)
    expect(isViewerHash('#section-2')).toBe(false)
    expect(isViewerHash('')).toBe(false)
  })
})

describe('item 7: rotation is 90-degree steps and wraps', () => {
  it('0 -> 90 -> 180 -> 270 -> 0', () => {
    let d = 0
    const seen: number[] = []
    for (let i = 0; i < 4; i++) {
      d = nextRotation(d)
      seen.push(d)
    }
    expect(seen).toEqual([90, 180, 270, 0])
  })
})

describe('item 3: which files get an inline image', () => {
  it('only a stored image that is previewable', () => {
    expect(isViewableImage({ display: 'stored', contentType: 'image/jpeg', previewState: 'previewable' })).toBe(true)
    expect(isViewableImage({ display: 'stored', contentType: 'image/png', previewState: null })).toBe(true)
    expect(isViewableImage({ display: 'stored', contentType: 'application/pdf', previewState: 'previewable' })).toBe(false)
    expect(isViewableImage({ display: 'stored', contentType: 'image/webp', previewState: 'not_previewable' })).toBe(false)
    expect(isViewableImage({ display: 'pending', contentType: 'image/jpeg', previewState: null })).toBe(false)
    expect(isViewableImage({ display: 'stored', contentType: null, previewState: null })).toBe(false)
  })
})

describe('N1 (review round 1): isMoreDetailsDirty (DC no. / DC date only)', () => {
  const loaded = { deliveryType: 'supplier', vehicleNumber: 'V', dcNumber: 'DC-1', dcDate: '2026-10-30' }
  const same = { deliveryType: 'supplier', dcNumber: 'DC-1', dcDate: '2026-10-30' }
  it('clean', () => expect(isMoreDetailsDirty(loaded, same)).toBe(false))
  it('a changed DC no. or DC date is dirty', () => {
    expect(isMoreDetailsDirty(loaded, { ...same, dcNumber: 'DC-2' })).toBe(true)
    expect(isMoreDetailsDirty(loaded, { ...same, dcDate: '2026-10-31' })).toBe(true)
  })
  it('a changed delivery type alone is NOT a "More details" edit (that field is outside the block)', () => {
    expect(isMoreDetailsDirty(loaded, { ...same, deliveryType: 'internal_transfer' })).toBe(false)
  })
  it('whitespace-only differences are clean, as the server compares', () => {
    expect(isMoreDetailsDirty(loaded, { ...same, dcNumber: ' DC-1 ' })).toBe(false)
  })
})
