import { describe, it, expect } from 'vitest'
import { renderEmailReport, type EngineerReportMeta, type RenderedCheckInStatus } from '@/lib/dpr/render-email'
import type { EngineerDprFacts } from '@/lib/dpr/schema'

// §2h of docs/dpr-delivery-versioning-plan.md — pure-function tests, no DB,
// no model call, no fixture beyond a hand-built EngineerDprFacts. Mirrors
// what render.ts's own renderEngineerReport already produces for WhatsApp,
// checking the email renderer reuses the same body content (renderEngineerBody)
// and only the wrapping differs.
//
// REWRITTEN 2026-09-11 (Stage 3 of the DPR format redesign,
// docs/plans/dpr-format-redesign.md) for the new WORK/RESOURCE/MACHINE/
// HINDRANCE/DEPENDENCY body and the new "Good evening." / Site Engineer /
// Project Manager / Check-in / "sections below" header with SUMMARY moved
// to the end. The old assertions (two-line check-in, "Work — planned: ...
// | done: ...", "Manpower planned — ...", MISSING block) all described a
// format this file no longer produces.

const META: EngineerReportMeta = {
  project_name: 'Emerald Heights',
  engineer_name: 'Arjun Nair',
  formatted_date: 'Mon 31 Aug',
  project_manager_name: null,
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
      planned_corrected: { status: 'reported', value: 'Continue slab work' },
      done_text_corrected: { status: 'reported', value: 'Slab concrete poured' },
    },
    tomorrowNeeds: { note: { status: 'not_captured', value: null } },
    manpower: {
      planned: { status: 'reported', value: '20 workers' },
      on_site: { status: 'reported', value: '18 workers' },
    },
    idle_hours_by_trade: [],
    equipment: { items: [], machines_reported: { status: 'not_captured', value: null }, run_hours: { status: 'not_captured', value: null } },
    hindrances: [],
    ...overrides,
  }
}

describe('renderEmailReport', () => {
  it('subject names the project and the date', () => {
    const result = renderEmailReport(makeFacts(), 'Good day overall.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.subject).toBe('Daily Progress — Emerald Heights — Mon 31 Aug')
  })

  it('text output carries the new header shape, the check-in line, the body sections, and SUMMARY at the end', () => {
    const facts = makeFacts({ tomorrowNeeds: { note: { status: 'reported', value: 'Rain for 1 hour' } } })
    const result = renderEmailReport(facts, 'Good progress today.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.text).toContain('Good evening.')
    expect(result.text).toContain('Daily Progress Report — Emerald Heights, Mon 31 Aug')
    expect(result.text).toContain('Site Engineer: Arjun Nair')
    expect(result.text).toContain('Check-in: Morning complete · Evening complete')
    expect(result.text).toContain('The sections below are as reported from site.')
    expect(result.text).toContain('WORK')
    expect(result.text).toContain('Morning plan: "Continue slab work"')
    // Stage 3 review fix (item 2) -- the structured done_quantity/unit
    // suffix is dropped entirely; free text only.
    expect(result.text).toContain('Work completed: "Slab concrete poured"')
    expect(result.text).not.toContain('120 sqm')
    expect(result.text).toContain('RESOURCE')
    expect(result.text).toContain('Labour reported — morning: "20 workers"')
    expect(result.text).toContain('Labour reported — evening: "18 workers"')
    expect(result.text).toContain('DEPENDENCY')
    expect(result.text).toContain('Rain for 1 hour')
    expect(result.text).toContain('SUMMARY (auto-generated)')
    expect(result.text).toContain('Good progress today.')
    // SUMMARY is the LAST thing in the report, not right after the header
    // (the old design's ordering) -- a full reversal.
    expect(result.text.indexOf('SUMMARY (auto-generated)')).toBeGreaterThan(result.text.indexOf('WORK'))
  })

  it('omits the "Project Manager:" line when null, includes it when present', () => {
    const withoutPm = renderEmailReport(makeFacts(), 'V.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(withoutPm.text).not.toContain('Project Manager:')
    const withPm = renderEmailReport(makeFacts(), 'V.', MORNING_COMPLETE, EVENING_COMPLETE, { ...META, project_manager_name: 'Priya Singh' })
    expect(withPm.text).toContain('Project Manager: Priya Singh')
    expect(withPm.html).toContain('Project Manager: Priya Singh')
  })

  it('html output is a real, escaped HTML document containing the same facts', () => {
    const result = renderEmailReport(makeFacts(), 'Good progress today.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.html).toContain('<div')
    expect(result.html).toContain('Emerald Heights')
    expect(result.html).toContain('Arjun Nair')
    expect(result.html).toContain('Good progress today.')
    expect(result.html).toContain('WORK')
    expect(result.html).toContain('SUMMARY (auto-generated)')
  })

  it('escapes HTML-significant characters in free-text fields — no raw markup injection from engineer input', () => {
    const facts = makeFacts({
      work: {
        planned: { status: 'reported', value: '<script>alert(1)</script>' },
        done_text: { status: 'reported', value: 'Done & <finished>' },
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: { status: 'reported', value: '<script>alert(1)</script>' },
        done_text_corrected: { status: 'reported', value: 'Done & <finished>' },
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

  it('a not_received evening half suppresses evening-derived lines entirely -- no MISSING block, no marker, just absence (the check-in line already says so once)', () => {
    const facts = makeFacts({ evening_status: { status: 'not_received' } })
    const result = renderEmailReport(facts, 'No evening data reported.', MORNING_COMPLETE, { status: 'not_received' }, META)
    expect(result.text).toContain('Check-in: Morning complete · Evening not received')
    expect(result.text).not.toContain('MISSING')
    expect(result.text).not.toContain('Work completed')
    expect(result.text).not.toContain('Labour reported — evening')
    // Morning-derived lines are unaffected by the evening half's status.
    expect(result.text).toContain('Morning plan:')
    expect(result.text).toContain('Labour reported — morning:')
  })

  it('a field left unanswered within an otherwise-answered half shows the inline "no input received" marker', () => {
    const facts = makeFacts({
      manpower: {
        planned: { status: 'reported', value: '20 workers' },
        on_site: { status: 'not_captured', value: null },
      },
    })
    const result = renderEmailReport(facts, 'V.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(result.text).toContain('Labour reported — evening: no input received')
  })

  it('WORK is omitted entirely when both halves are unanswered -- empty sections are not printed with an empty header', () => {
    const facts = makeFacts({
      morning_status: { status: 'not_received' },
      evening_status: { status: 'not_received' },
    })
    const result = renderEmailReport(facts, 'No check-in received today.', { status: 'not_received' }, { status: 'not_received' }, META)
    expect(result.text).not.toContain('WORK')
    expect(result.text).not.toContain('RESOURCE')
  })

  it('is a pure function — same inputs produce byte-identical output, no hidden state', () => {
    const facts = makeFacts()
    const a = renderEmailReport(facts, 'Same verdict.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    const b = renderEmailReport(facts, 'Same verdict.', MORNING_COMPLETE, EVENING_COMPLETE, META)
    expect(a).toEqual(b)
  })
})
