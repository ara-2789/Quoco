import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DailyLogPhotoColumn, DailyLogNoPhotosMessage } from '@/components/daily-logs/photo-sections'
import { DprPhotoSections } from '@/components/dprs/dpr-photo-sections'
import { HindranceCardPhotos } from '@/components/hindrances/hindrance-card-photos'
import {
  MORNING_PHOTOS_HEADING,
  EVENING_PHOTOS_HEADING,
  HINDRANCE_PHOTOS_HEADING,
  NO_PHOTOS_FOR_LOG_TEXT,
  MORNING_PHOTO_ALT,
  EVENING_PHOTO_ALT,
  HINDRANCE_PHOTO_ALT,
} from '@/lib/photos/copy'

// Stage 5a, build slice B3 (decision C, 2026-09-17). Rendered-output proof
// for C7, with NO new dependency: react-dom/server's renderToStaticMarkup
// (already a transitive dependency of Next.js's own react-dom), run
// against the three extracted PRESENTATIONAL components directly -- never
// the pages themselves, and never PhotoImg's onError fallback (that stays
// a manual check; see this repo's PR description / test report for why).
// Every fixture id/expiresAt/photoUrl below is synthetic -- this file
// makes zero network or database calls.

const IMG_SRC_RE = /^\/api\/photos\/(daily_log|hindrance)\/[0-9a-f-]+$/
const FUTURE_EXPIRES_AT = '2099-01-01T00:00:00.000Z'
const NOW = new Date('2026-09-17T12:00:00.000Z')
// A realistic-looking Storage object path -- must NEVER appear in output,
// even though the DPR fixture below carries it on the input data (the
// component must not just "not have photoUrl in its own type", it must
// actively discard whatever caller passes).
const SEEDED_PHOTO_URL = 'zz-tenant-fixture/some-daily-log-id/should-never-render.jpg'

function imgSrcs(html: string): string[] {
  return [...html.matchAll(/<img[^>]*\ssrc="([^"]*)"/g)].map((m) => m[1])
}

// Stage 5a, build slice B4: each thumbnail's anchor -- href, target, rel.
// Captures all three from the SAME <a> tag so a test can assert on the
// literal attribute values, not just their presence.
function anchors(html: string): { href: string; target: string; rel: string }[] {
  return [...html.matchAll(/<a href="([^"]*)" target="([^"]*)" rel="([^"]*)"/g)].map((m) => ({
    href: m[1],
    target: m[2],
    rel: m[3],
  }))
}

// Every anchor's href must be the SAME path the corresponding <img>'s src
// already uses (task item 3) -- asserted as array equality against
// imgSrcs' own output, in the same document order, rather than merely
// matching the same regex independently (which would miss a bug where an
// anchor pointed at a DIFFERENT id than its own image).
function assertAnchorsMatchImgSrcs(html: string) {
  const hrefs = anchors(html).map((a) => a.href)
  expect(hrefs).toEqual(imgSrcs(html))
  for (const a of anchors(html)) {
    expect(a.target).toBe('_blank')
    expect(a.rel).toBe('noopener noreferrer')
  }
}

function assertNeverLeaksStorage(html: string) {
  expect(html).not.toContain('supabase.co')
  expect(html).not.toContain('/storage/')
  expect(html).not.toContain(SEEDED_PHOTO_URL)
}

// UI slice 2 (Aravind, 2026-09-18): the daily-log page now renders
// Morning/Evening in two separate columns (log-detail-view.tsx), so the
// combined DailyLogPhotoSections component this block used to test was
// replaced by two smaller pieces -- DailyLogPhotoColumn (one half's own
// grid) and DailyLogNoPhotosMessage (the combined D8 empty-state text,
// which still depends on BOTH halves being empty together). This is a
// real prop-shape change, not a colour-only edit -- updating these tests
// to match is the correct response, per that file's own header comment.
describe('DailyLogPhotoColumn (rendered output, C7)', () => {
  it('morning half, PM input: heading, correct alt text, /api/photos/{kind}/{id} src only, and "Kept until"', () => {
    const html = renderToStaticMarkup(
      <DailyLogPhotoColumn
        photoSections={{
          morning: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
          evening: [],
        }}
        half="morning"
        now={NOW}
      />,
    )
    expect(html).toContain(MORNING_PHOTOS_HEADING)
    expect(html).not.toContain(EVENING_PHOTOS_HEADING)
    expect(html).toContain(MORNING_PHOTO_ALT)
    expect(html).toContain('Kept until')
    expect(html).not.toContain(NO_PHOTOS_FOR_LOG_TEXT)

    const srcs = imgSrcs(html)
    expect(srcs).toHaveLength(1)
    for (const src of srcs) expect(src).toMatch(IMG_SRC_RE)
    assertNeverLeaksStorage(html)
    assertAnchorsMatchImgSrcs(html)
  })

  it('evening half, PM input: heading, correct alt text, /api/photos/{kind}/{id} src only, and "Kept until"', () => {
    const html = renderToStaticMarkup(
      <DailyLogPhotoColumn
        photoSections={{
          morning: [],
          evening: [{ id: 'aaaaaaaa-0000-0000-0000-000000000002', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
        }}
        half="evening"
        now={NOW}
      />,
    )
    expect(html).toContain(EVENING_PHOTOS_HEADING)
    expect(html).not.toContain(MORNING_PHOTOS_HEADING)
    expect(html).toContain(EVENING_PHOTO_ALT)
    expect(html).toContain('Kept until')

    const srcs = imgSrcs(html)
    expect(srcs).toHaveLength(1)
    for (const src of srcs) expect(src).toMatch(IMG_SRC_RE)
    assertNeverLeaksStorage(html)
    assertAnchorsMatchImgSrcs(html)
  })

  it('this half empty: output is the empty string (no heading), even if the OTHER half has photos', () => {
    const html = renderToStaticMarkup(
      <DailyLogPhotoColumn
        photoSections={{
          morning: [],
          evening: [{ id: 'aaaaaaaa-0000-0000-0000-000000000003', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
        }}
        half="morning"
        now={NOW}
      />,
    )
    expect(html).toBe('')
  })

  it('non-PM input (null): output is the empty string', () => {
    const html = renderToStaticMarkup(<DailyLogPhotoColumn photoSections={null} half="morning" now={NOW} />)
    expect(html).toBe('')
  })
})

describe('DailyLogNoPhotosMessage (rendered output, D8/C7)', () => {
  it('both halves empty for a PM: "No photos for this log."', () => {
    const html = renderToStaticMarkup(
      <DailyLogNoPhotosMessage photoSections={{ morning: [], evening: [] }} />,
    )
    expect(html).toContain(NO_PHOTOS_FOR_LOG_TEXT)
  })

  it('one half non-empty: output is the empty string (no message)', () => {
    const html = renderToStaticMarkup(
      <DailyLogNoPhotosMessage
        photoSections={{
          morning: [{ id: 'aaaaaaaa-0000-0000-0000-000000000004', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
          evening: [],
        }}
      />,
    )
    expect(html).toBe('')
  })

  it('non-PM input (null): output is the empty string', () => {
    const html = renderToStaticMarkup(<DailyLogNoPhotosMessage photoSections={null} />)
    expect(html).toBe('')
  })
})

describe('DprPhotoSections (rendered output, C7)', () => {
  it('PM input: Evening then Hindrance headings, correct alt text, /api/photos/{kind}/{id} src only, and "Kept until"', () => {
    const html = renderToStaticMarkup(
      <DprPhotoSections
        photoSections={{
          evening: [
            { id: 'bbbbbbbb-0000-0000-0000-000000000001', photoUrl: SEEDED_PHOTO_URL, kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT },
          ],
          hindrance: [
            { id: 'bbbbbbbb-0000-0000-0000-000000000002', photoUrl: SEEDED_PHOTO_URL, kind: 'hindrance', expiresAt: FUTURE_EXPIRES_AT },
          ],
        }}
        now={NOW}
      />,
    )
    expect(html).toContain(EVENING_PHOTOS_HEADING)
    expect(html).toContain(HINDRANCE_PHOTOS_HEADING)
    expect(html).toContain(EVENING_PHOTO_ALT)
    expect(html).toContain(HINDRANCE_PHOTO_ALT)
    expect(html).toContain('Kept until')

    const srcs = imgSrcs(html)
    expect(srcs).toHaveLength(2)
    for (const src of srcs) expect(src).toMatch(IMG_SRC_RE)
    assertNeverLeaksStorage(html)
    assertAnchorsMatchImgSrcs(html)
  })

  it('non-PM input (null): output is the empty string', () => {
    const html = renderToStaticMarkup(<DprPhotoSections photoSections={null} now={NOW} />)
    expect(html).toBe('')
  })

  it('zero total photos for a PM: output is the empty string too (D8, no placeholder on this page)', () => {
    const html = renderToStaticMarkup(<DprPhotoSections photoSections={{ evening: [], hindrance: [] }} now={NOW} />)
    expect(html).toBe('')
  })

  it('evening empty, hindrance non-empty: only the Hindrance heading renders', () => {
    const html = renderToStaticMarkup(
      <DprPhotoSections
        photoSections={{
          evening: [],
          hindrance: [
            { id: 'bbbbbbbb-0000-0000-0000-000000000003', photoUrl: SEEDED_PHOTO_URL, kind: 'hindrance', expiresAt: FUTURE_EXPIRES_AT },
          ],
        }}
        now={NOW}
      />,
    )
    expect(html).not.toContain(EVENING_PHOTOS_HEADING)
    expect(html).toContain(HINDRANCE_PHOTOS_HEADING)
  })
})

describe('HindranceCardPhotos (rendered output, C7)', () => {
  it('PM input: /api/photos/{kind}/{id} src, Hindrance alt text, "Kept until", and NO heading at all', () => {
    const html = renderToStaticMarkup(
      <HindranceCardPhotos
        isPm
        photos={[{ id: 'cccccccc-0000-0000-0000-000000000001', kind: 'hindrance', expiresAt: FUTURE_EXPIRES_AT }]}
        now={NOW}
      />,
    )
    expect(html).toContain(HINDRANCE_PHOTO_ALT)
    expect(html).toContain('Kept until')
    expect(html).not.toContain('<h2')
    expect(html).not.toContain(HINDRANCE_PHOTOS_HEADING)

    const srcs = imgSrcs(html)
    expect(srcs).toHaveLength(1)
    expect(srcs[0]).toMatch(IMG_SRC_RE)
    assertNeverLeaksStorage(html)
    assertAnchorsMatchImgSrcs(html)
  })

  it('non-PM input (isPm false): output is the empty string, even with photos present', () => {
    const html = renderToStaticMarkup(
      <HindranceCardPhotos
        isPm={false}
        photos={[{ id: 'cccccccc-0000-0000-0000-000000000002', kind: 'hindrance', expiresAt: FUTURE_EXPIRES_AT }]}
        now={NOW}
      />,
    )
    expect(html).toBe('')
  })

  it('zero photos for a PM: output is the empty string (no heading, no placeholder)', () => {
    const html = renderToStaticMarkup(<HindranceCardPhotos isPm photos={[]} now={NOW} />)
    expect(html).toBe('')
  })
})
