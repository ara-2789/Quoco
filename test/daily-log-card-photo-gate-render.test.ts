import { describe, it, expect, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'

// UI slice 5 (Aravind, 2026-09-18). Rendered-output proof, same style as
// test/photo-sections-render.test.tsx (react-dom/server's
// renderToStaticMarkup, no jsdom, no network/database calls): the Daily
// Logs list card's own expansion (app/(dashboard)/daily-logs/
// engineer-card.tsx) reuses HalfColumn (components/daily-logs/
// log-detail-view.tsx) verbatim, so proving HalfColumn's own
// photoSections=null behaviour IS proving the list card's behaviour --
// that is the literal component instance the card renders, not a
// stand-in for it.
//
// TWO MOCKS BELOW, AND WHY: log-detail-view.tsx's module body
// unconditionally imports ScalarFieldRow AND HolidayField at the top of
// the file, regardless of which export a caller actually uses.
// ScalarFieldRow's own useFieldCorrection hook (lib/daily-logs/
// use-field-correction.ts) imports the correctDailyLogField Server
// Action (app/(dashboard)/daily-logs/actions.ts), which imports
// getProfile, which imports the 'server-only' marker package --
// HolidayField pulls in the SAME action file directly. 'server-only' is
// designed to throw unconditionally whenever it is actually executed
// outside Next's own bundler (confirmed directly: even after adding it
// as a real devDependency so the bare import resolves, executing it
// under plain Vitest throws "This module cannot be imported from a
// Client Component module" -- its OWN intentional guard, not a missing-
// package error). That makes rendering log-detail-view.tsx's module AT
// ALL structurally impossible under plain Vitest, for ANY of its
// exports -- a genuine, pre-existing gap (no test in this repo has ever
// rendered ScalarFieldRow or HolidayField), not something introduced by
// this slice.
//
// Neither mocked component renders any photo markup in the real
// implementation either (ScalarFieldRow renders a text field + edit
// controls; HolidayField renders a yes/no + reason form) -- mocking them
// away changes nothing about what this test is actually proving
// (photoSections gating -> DailyLogPhotoColumn's own markup), it only
// unblocks loading a module neither of them needs to be real for.
vi.mock('@/components/daily-logs/scalar-field-row', () => ({
  ScalarFieldRow: () => null,
}))
vi.mock('@/components/daily-logs/holiday-field', () => ({
  HolidayField: () => null,
}))

const { HalfColumn } = await import('@/components/daily-logs/log-detail-view')

const NOW = new Date('2026-09-18T12:00:00.000Z')
const FUTURE_EXPIRES_AT = '2099-01-01T00:00:00.000Z'

// fix/daily-log-fields (Aravind, 2026-09-18): headlineRow/secondaryRows
// and columns updated to the current shape -- 'kind: scalar'/'kind:
// text' discriminated rows, and the five raw_text jsonb columns
// (morning_manpower/morning_equipment/evening_manpower/
// evening_equipment_utilisation/evening_idle_hours) replacing
// morning_execution_plan/evening_workers_on_site/evening_schedule_met,
// which nothing writes (see this PR's own report).
const BASE_PROPS = {
  heading: 'Morning',
  chipVariant: 'ok' as const,
  chipLabel: 'Morning: Submitted 7:18 am',
  headlineRow: { kind: 'scalar' as const, column: 'morning_plan' as const, label: 'Morning plan' },
  secondaryRows: [{ kind: 'text' as const, column: 'morning_manpower' as const, label: 'Morning labour reported' }],
  dailyLogsId: 'zz-fixture-daily-log-id',
  columns: {
    is_holiday: null,
    holiday_reason: null,
    morning_plan: 'Slab preparation and shuttering.',
    evening_output: null,
    evening_tomorrow_needs: null,
    morning_manpower: { raw_text: '8 masn 12 helper' },
    morning_equipment: null,
    evening_manpower: null,
    evening_equipment_utilisation: null,
    evening_idle_hours: null,
  },
  edits: {},
  submittedAt: '2026-09-18T01:48:00.000Z',
  engineerName: 'Vikram Rao',
  canEdit: false,
  half: 'morning' as const,
  now: NOW,
}

function imgTags(html: string): string[] {
  return [...html.matchAll(/<img\b[^>]*>/g)].map((m) => m[0])
}

describe('HalfColumn (Daily Logs list card expansion, UI slice 5)', () => {
  it('non-PM (photoSections null): zero photo markup', () => {
    const html = renderToStaticMarkup(createElement(HalfColumn, { ...BASE_PROPS, photoSections: null }))
    expect(imgTags(html)).toHaveLength(0)
    expect(html).not.toMatch(/photo/i)
  })

  it('a real PM with real photos: the same half DOES render photo markup (contrast case)', () => {
    const html = renderToStaticMarkup(
      createElement(HalfColumn, {
        ...BASE_PROPS,
        photoSections: {
          morning: [{ id: 'zz-fixture-photo-id', kind: 'daily_log', expiresAt: FUTURE_EXPIRES_AT }],
          evening: [],
        },
      }),
    )
    expect(imgTags(html).length).toBeGreaterThan(0)
    expect(html).toMatch(/\/api\/photos\/daily_log\/zz-fixture-photo-id/)
  })

  it('a PM with zero photos for this half: still zero photo markup, but for a different reason than the non-PM case (real empty list, not a null gate)', () => {
    const html = renderToStaticMarkup(
      createElement(HalfColumn, { ...BASE_PROPS, photoSections: { morning: [], evening: [] } }),
    )
    expect(imgTags(html)).toHaveLength(0)
  })
})
