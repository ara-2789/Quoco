import { describe, it, expect } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { DailyLogPhotoSections } from '@/components/daily-logs/photo-sections'
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

function assertNeverLeaksStorage(html: string) {
  expect(html).not.toContain('supabase.co')
  expect(html).not.toContain('/storage/')
  expect(html).not.toContain(SEEDED_PHOTO_URL)
}

describe('DailyLogPhotoSections (rendered output, C7)', () => {
  it('PM input: both headings, correct alt text, /api/photos/{kind}/{id} src only, and "Kept until"', () => {
    const html = renderToStaticMarkup(
      <DailyLogPhotoSections
        photoSections={{
          morning: [{ id: 'aaaaaaaa-0000-0000-0000-000000000001', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
          evening: [{ id: 'aaaaaaaa-0000-0000-0000-000000000002', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
        }}
        now={NOW}
      />,
    )
    expect(html).toContain(MORNING_PHOTOS_HEADING)
    expect(html).toContain(EVENING_PHOTOS_HEADING)
    expect(html).toContain(MORNING_PHOTO_ALT)
    expect(html).toContain(EVENING_PHOTO_ALT)
    expect(html).toContain('Kept until')
    expect(html).not.toContain(NO_PHOTOS_FOR_LOG_TEXT)

    const srcs = imgSrcs(html)
    expect(srcs).toHaveLength(2)
    for (const src of srcs) expect(src).toMatch(IMG_SRC_RE)
    assertNeverLeaksStorage(html)
  })

  it('both empty for a PM: "No photos for this log.", no headings, no img', () => {
    const html = renderToStaticMarkup(<DailyLogPhotoSections photoSections={{ morning: [], evening: [] }} now={NOW} />)
    expect(html).toContain(NO_PHOTOS_FOR_LOG_TEXT)
    expect(html).not.toContain(MORNING_PHOTOS_HEADING)
    expect(html).not.toContain(EVENING_PHOTOS_HEADING)
    expect(imgSrcs(html)).toHaveLength(0)
  })

  it('non-PM input (null): output is the empty string', () => {
    const html = renderToStaticMarkup(<DailyLogPhotoSections photoSections={null} now={NOW} />)
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
