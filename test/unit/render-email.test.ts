import { describe, it, expect } from 'vitest'
import { renderEmailReport, type EngineerReportMeta, type RenderedCheckInStatus } from '@/lib/dpr/render-email'
import type { EngineerDprFacts } from '@/lib/dpr/schema'

// §2h of docs/dpr-delivery-versioning-plan.md — pure-function tests, no DB,
// no model call, no fixture beyond a hand-built EngineerDprFacts. Mirrors
// what render.ts's own renderEngineerReport already produces for WhatsApp,
// checking the email renderer reuses the same body content (renderEngineerBody)
// and only the wrapping differs.

const META: EngineerReportMeta = {
  project_name: 'Emerald Heights',
  engineer_name: 'Arjun Nair',
  formatted_date: 'Mon 31 Aug',
}

const MORNING_COMPLETE: RenderedCheckInStatus = { status: 'complete' }
const EVENING_COMPLETE: RenderedCheckInStatus = { status: 'complete' }

function makeFacts(overrides: Partial<EngineerDprFacts> = {}): EngineerDprFacts {
  return {
    morning_status: { status: 'complete' },
    evening_status: { status: 'complete' },
    work: {
      planned: { status: 'reported', value: 'Continue slab work' },
      done_text: { status: 'reported', value: 'Slab concrete poured' },
      done_quantity: { status: 'reported', value: 120 },
      unit: 'sqm',
    },
    hindrance: { note: { status: 'not_captured', value: null } },
    manpower: {
      planned: { status: 'reported', value: '20 workers' },
      on_site: { status: 'reported', value: '18 workers' },
    },
    idle_hours_by_trade: [],
    equipment: { items: [] },
    ...overrides,
  }
}

describe('renderEmailReport', () => {
  it('subject names the project and the date', () => {
    const result = renderEmailReport(makeFacts(), 'Good day overall.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.subject).toBe('Daily Progress — Emerald Heights — Mon 31 Aug')
  })

  it('text output carries the header, check-in lines, verdict, and body — same content the WhatsApp render would produce', () => {
    const facts = makeFacts({ hindrance: { note: { status: 'reported', value: 'Rain for 1 hour' } } })
    const result = renderEmailReport(facts, 'Good progress today.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.text).toContain('Daily Progress — Emerald Heights — Mon 31 Aug')
    expect(result.text).toContain('Site engineer: Arjun Nair')
    expect(result.text).toContain('Morning check-in: complete')
    expect(result.text).toContain('Evening check-in: complete')
    expect(result.text).toContain('Good progress today.')
    // Body content (from the shared renderEngineerBody) — Work/Hindrance/Manpower lines.
    // fmtText wraps reported text values in double quotes (render.ts's own convention).
    expect(result.text).toContain('Work — planned: "Continue slab work" | done: "Slab concrete poured" — 120 sqm')
    expect(result.text).toContain('Hindrance — Rain for 1 hour')
    expect(result.text).toContain('Manpower — planned: "20 workers" | reported: "18 workers"')
  })

  it('html output is a real, escaped HTML document containing the same facts', () => {
    const result = renderEmailReport(makeFacts(), 'Good progress today.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.html).toContain('<div')
    expect(result.html).toContain('Emerald Heights')
    expect(result.html).toContain('Arjun Nair')
    expect(result.html).toContain('Good progress today.')
    expect(result.html).toContain('Work — planned:')
  })

  it('escapes HTML-significant characters in free-text fields — no raw markup injection from engineer input', () => {
    const facts = makeFacts({
      work: {
        planned: { status: 'reported', value: '<script>alert(1)</script>' },
        done_text: { status: 'reported', value: 'Done & <finished>' },
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
      },
    })
    const result = renderEmailReport(facts, 'Verdict with "quotes" & an ampersand.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.html).not.toContain('<script>')
    expect(result.html).toContain('&lt;script&gt;')
    expect(result.html).toContain('&amp;')
    expect(result.html).toContain('&quot;quotes&quot;')
    // Plain text is NOT escaped — it's plain text, not embedded in markup.
    expect(result.text).toContain('<script>alert(1)</script>')
  })

  it('reflects a not_received evening half via the MISSING section, same as the WhatsApp body', () => {
    const facts = makeFacts({
      evening_status: { status: 'not_received' },
      work: {
        planned: { status: 'reported', value: 'Continue slab work' },
        done_text: { status: 'not_captured', value: null },
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
      },
      manpower: {
        planned: { status: 'reported', value: '20 workers' },
        on_site: { status: 'not_captured', value: null },
      },
    })
    const result = renderEmailReport(facts, 'No evening data reported.', MORNING_COMPLETE, { status: 'not_received' }, META)
    expect(result.text).toContain('Evening check-in: not received')
    expect(result.text).toContain('MISSING')
    expect(result.text).toContain('Evening check-in not received.')
  })

  it('is a pure function — same inputs produce byte-identical output, no hidden state', () => {
    const facts = makeFacts()
    const a = renderEmailReport(facts, 'Same verdict.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    const b = renderEmailReport(facts, 'Same verdict.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(a).toEqual(b)
  })
})
