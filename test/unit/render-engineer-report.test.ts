import { describe, it, expect } from 'vitest'
import { renderEngineerBody, renderEngineerReport, type EngineerReportMeta, type RenderedCheckInStatus } from '@/lib/dpr/render'
import type { EngineerDprFacts } from '@/lib/dpr/schema'

// Stage 3 of the DPR format redesign (2026-09-11,
// docs/plans/dpr-format-redesign.md) -- pure-function coverage for the
// WhatsApp-surface renderer's own new body and header shape. No DB, no
// model call. render-email.test.ts covers the SAME body logic indirectly
// through renderEmailReport (the two share renderEngineerBody); this file
// targets renderEngineerBody/renderEngineerReport directly, plus the
// header/footer assembly render-email.test.ts has no equivalent of.

const notCaptured = { status: 'not_captured' as const, value: null }
const reported = (value: string) => ({ status: 'reported' as const, value })

function baseFacts(overrides: Partial<EngineerDprFacts> = {}): EngineerDprFacts {
  return {
    morning_status: { status: 'not_received' },
    evening_status: { status: 'not_received' },
    work: {
      planned: notCaptured,
      done_text: notCaptured,
      done_quantity: { status: 'not_captured', value: null },
      unit: '',
      planned_corrected: notCaptured,
      done_text_corrected: notCaptured,
    },
    tomorrowNeeds: { note: notCaptured },
    manpower: { planned: notCaptured, on_site: notCaptured },
    idle_hours_by_trade: [],
    equipment: { items: [], machines_reported: notCaptured, run_hours: notCaptured },
    hindrances: [],
    ...overrides,
  }
}

const META: EngineerReportMeta = {
  project_name: 'Speed Mechatronics',
  engineer_name: 'Vikram Rao',
  formatted_date: 'Thu 11 Sep',
  project_manager_name: null,
}

describe('renderEngineerBody — section omission', () => {
  it('everything empty: the body is an empty string, no section headers at all', () => {
    expect(renderEngineerBody(baseFacts())).toBe('')
  })

  it('WORK is the first section, no leading blank line -- an answered morning half also surfaces RESOURCE\'s own morning-derived line, with the inline marker for the field that was not reported', () => {
    const facts = baseFacts({
      morning_status: { status: 'complete' },
      work: {
        planned: reported('Continue slab work'),
        done_text: notCaptured,
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: reported('Continue slab work'),
        done_text_corrected: notCaptured,
      },
    })
    const body = renderEngineerBody(facts)
    // manpower.planned was never set in baseFacts -- morning being
    // answered surfaces "Labour reported — morning" too, with the marker,
    // independent of WORK. This is correct, intentional per-field
    // behavior, not a WORK-only special case.
    expect(body).toBe('WORK\nMorning plan: "Continue slab work"\n\nRESOURCE\nLabour reported — morning: no input received')
    expect(body.startsWith('WORK\n')).toBe(true)
  })

  it('sections print in order WORK, RESOURCE, MACHINE, HINDRANCE, DEPENDENCY, each blank-line separated', () => {
    const facts = baseFacts({
      morning_status: { status: 'complete' },
      evening_status: { status: 'complete' },
      work: {
        planned: reported('Plan A'),
        done_text: reported('Done A'),
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: reported('Plan A'),
        done_text_corrected: reported('Done A'),
      },
      manpower: { planned: reported('10 masons'), on_site: reported('9 masons') },
      equipment: { items: [], machines_reported: reported('1 JCB'), run_hours: reported('JCB ran 5 hours') },
      hindrances: [{ description: 'Cement delivery delayed' }],
      tomorrowNeeds: { note: reported('Need 2 more masons tomorrow') },
    })
    const body = renderEngineerBody(facts)
    const sectionOrder = ['WORK', 'RESOURCE', 'MACHINE', 'HINDRANCE', 'DEPENDENCY']
    let lastIndex = -1
    for (const section of sectionOrder) {
      const idx = body.indexOf(section)
      expect(idx).toBeGreaterThan(lastIndex)
      lastIndex = idx
    }
    // Blank-line separated: exactly one blank line between each section.
    expect(body).toBe(
      [
        'WORK',
        'Morning plan: "Plan A"',
        'Work completed: "Done A"',
        '',
        'RESOURCE',
        'Labour reported — morning: "10 masons"',
        'Labour reported — evening: "9 masons"',
        '',
        'MACHINE',
        'Machines reported: "1 JCB"',
        'Run hours: "JCB ran 5 hours"',
        '',
        'HINDRANCE',
        'Cement delivery delayed',
        '',
        'DEPENDENCY',
        'Need 2 more masons tomorrow',
      ].join('\n'),
    )
  })
})

describe('renderEngineerBody — WORK', () => {
  it('renders planned_corrected/done_text_corrected, NOT the raw planned/done_text', () => {
    const facts = baseFacts({
      morning_status: { status: 'complete' },
      evening_status: { status: 'complete' },
      work: {
        planned: reported('cemant lorry not arived'),
        done_text: reported('poured cemant'),
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: reported('cement lorry not arrived'),
        done_text_corrected: reported('poured cement'),
      },
    })
    const body = renderEngineerBody(facts)
    expect(body).toContain('Morning plan: "cement lorry not arrived"')
    expect(body).toContain('Work completed: "poured cement"')
    expect(body).not.toContain('cemant')
    expect(body).not.toContain('arived')
  })

  it('Stage 3 review fix (item 2): Work completed renders free text ONLY -- the structured done_quantity/unit suffix is dropped, even when done_quantity is reported', () => {
    const facts = baseFacts({
      evening_status: { status: 'complete' },
      work: {
        planned: notCaptured,
        done_text: reported('Excavation done'),
        done_quantity: { status: 'reported', value: 850 },
        unit: 'sq m',
        planned_corrected: notCaptured,
        done_text_corrected: reported('Excavation done'),
      },
    })
    const body = renderEngineerBody(facts)
    // Scoped to the WORK line itself -- RESOURCE's own "Labour reported
    // — evening" label legitimately contains an em dash of its own.
    expect(body).toContain('Work completed: "Excavation done"\n')
    expect(body).not.toContain('850')
    expect(body).not.toContain('sq m')
    expect(body).not.toContain('Excavation done" —')
  })

  it('a field left unanswered WITHIN an answered half shows the inline "no input received" marker', () => {
    const facts = baseFacts({ morning_status: { status: 'partial' } })
    expect(renderEngineerBody(facts)).toContain('Morning plan: no input received')
  })

  it('a not_received half suppresses its own WORK line entirely -- no marker, no line at all', () => {
    const facts = baseFacts({
      morning_status: { status: 'not_received' },
      evening_status: { status: 'complete' },
      work: {
        planned: notCaptured,
        done_text: reported('Done something'),
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: notCaptured,
        done_text_corrected: reported('Done something'),
      },
    })
    const body = renderEngineerBody(facts)
    expect(body).not.toContain('Morning plan')
    expect(body).toContain('Work completed: "Done something"')
  })

  it('a not_applicable half (e.g. holiday) ALSO suppresses its own line, same as not_received', () => {
    const facts = baseFacts({
      morning_status: { status: 'not_applicable', reason: 'Site closed (holiday)' },
      evening_status: { status: 'not_applicable', reason: 'Site closed (holiday)' },
      work: {
        planned: notCaptured,
        done_text: notCaptured,
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: notCaptured,
        done_text_corrected: notCaptured,
      },
    })
    expect(renderEngineerBody(facts)).toBe('')
  })
})

describe('renderEngineerBody — RESOURCE', () => {
  it('Idle hours composes multiple trades on one line, comma-joined', () => {
    const facts = baseFacts({ idle_hours_by_trade: [{ trade: 'mason', idle_hours: 2 }, { trade: 'bar_bender', idle_hours: 1 }] })
    expect(renderEngineerBody(facts)).toContain('Idle hours: Mason idle 2 hours, Bar Bender idle 1 hours.')
  })

  it('Idle hours line is OMITTED entirely when empty -- not the inline marker, per decision 4\'s carve-out', () => {
    const facts = baseFacts({
      morning_status: { status: 'complete' },
      evening_status: { status: 'complete' },
      manpower: { planned: reported('10 masons'), on_site: reported('9 masons') },
    })
    const body = renderEngineerBody(facts)
    // RESOURCE has real content (Labour lines) but no Idle hours line at
    // all -- distinct from the marker convention the Labour lines use.
    expect(body).toContain('RESOURCE')
    expect(body).not.toContain('Idle hours')
  })
})

describe('renderEngineerBody — MACHINE', () => {
  it('renders machines_reported/run_hours as raw text, verbatim, quoted', () => {
    const facts = baseFacts({ equipment: { items: [], machines_reported: reported('roller, 2 JCBs'), run_hours: reported('JCB1 ran 6h, JCB2 ran 4h') } })
    const body = renderEngineerBody(facts)
    expect(body).toContain('Machines reported: "roller, 2 JCBs"')
    expect(body).toContain('Run hours: "JCB1 ran 6h, JCB2 ran 4h"')
  })

  it('MACHINE is omitted entirely when both fields are not_captured, even if `items` has entries -- items[] is never read by this section', () => {
    const facts = baseFacts({
      equipment: {
        items: [{ type: 'JCB', daily_hire_cost: notCaptured, actual_hours: { status: 'reported', value: 999 }, idle_cost: notCaptured, implausible: true }],
        machines_reported: notCaptured,
        run_hours: notCaptured,
      },
    })
    const body = renderEngineerBody(facts)
    expect(body).not.toContain('MACHINE')
    expect(body).not.toContain('JCB')
    expect(body).not.toContain('check this')
    expect(body).not.toContain('999')
  })

  it('the implausible flag never renders anywhere, even when true and machines_reported/run_hours ARE present', () => {
    const facts = baseFacts({
      equipment: {
        items: [{ type: 'JCB', daily_hire_cost: notCaptured, actual_hours: { status: 'reported', value: 999 }, idle_cost: notCaptured, implausible: true }],
        machines_reported: reported('1 JCB'),
        run_hours: reported('JCB ran 999 hours'),
      },
    })
    expect(renderEngineerBody(facts)).not.toContain('check this')
  })
})

describe('renderEngineerBody — HINDRANCE / DEPENDENCY', () => {
  it('HINDRANCE renders one line per entry, under a bare header, chronological order preserved', () => {
    const facts = baseFacts({ hindrances: [{ description: 'Cement delayed' }, { description: 'Power outage 2 hours' }] })
    expect(renderEngineerBody(facts)).toBe('HINDRANCE\nCement delayed\nPower outage 2 hours')
  })

  it('DEPENDENCY renders the note under a bare header, not inline with the label (the old "Dependency — X" shape is gone)', () => {
    const facts = baseFacts({ tomorrowNeeds: { note: reported('Need more cement tomorrow') } })
    expect(renderEngineerBody(facts)).toBe('DEPENDENCY\nNeed more cement tomorrow')
    expect(renderEngineerBody(facts)).not.toContain('Dependency —')
  })

  it('both omitted when empty', () => {
    expect(renderEngineerBody(baseFacts())).toBe('')
  })
})

describe('renderEngineerReport — header/footer', () => {
  const morning: RenderedCheckInStatus = { status: 'complete' }
  const evening: RenderedCheckInStatus = { status: 'complete' }

  it('exact header shape for a representative day, PM omitted', () => {
    const facts = baseFacts({
      morning_status: { status: 'complete' },
      evening_status: { status: 'complete' },
      work: {
        planned: reported('Plan A'),
        done_text: reported('Done A'),
        done_quantity: { status: 'not_captured', value: null },
        unit: '',
        planned_corrected: reported('Plan A'),
        done_text_corrected: reported('Done A'),
      },
      manpower: { planned: reported('10 masons'), on_site: reported('9 masons') },
    })
    const result = renderEngineerReport(facts, 'A day of steady progress.', 'model', morning, evening, META)
    expect(result.content).toBe(
      [
        'Good evening.',
        'Daily Progress Report — Speed Mechatronics, Thu 11 Sep',
        '',
        'Site Engineer: Vikram Rao',
        '',
        'Check-in: Morning complete · Evening complete',
        '',
        'The sections below are as reported from site.',
        '',
        'WORK',
        'Morning plan: "Plan A"',
        'Work completed: "Done A"',
        '',
        'RESOURCE',
        'Labour reported — morning: "10 masons"',
        'Labour reported — evening: "9 masons"',
        '',
        'SUMMARY (auto-generated)',
        'A day of steady progress.',
      ].join('\n'),
    )
  })

  it('includes the "Project Manager:" line when present', () => {
    const result = renderEngineerReport(baseFacts(), 'V.', 'code_templated', morning, evening, { ...META, project_manager_name: 'Priya Singh' })
    expect(result.content).toContain('Site Engineer: Vikram Rao\nProject Manager: Priya Singh\n\nCheck-in:')
  })

  it('not-on-site day (attendance: absent -- morning not_applicable/kind:not_on_site, evening not_received): "The sections below are as reported from site." is suppressed, matching the real dispatch.ts shape', () => {
    const result = renderEngineerReport(
      baseFacts(),
      'Engineer not on site today.',
      'code_templated',
      { status: 'not_applicable', reason: 'not on site today' },
      { status: 'not_received' },
      META,
    )
    expect(result.content).toBe(
      [
        'Good evening.',
        'Daily Progress Report — Speed Mechatronics, Thu 11 Sep',
        '',
        'Site Engineer: Vikram Rao',
        '',
        'Check-in: Morning not applicable — not on site today · Evening not received',
        '',
        'SUMMARY (auto-generated)',
        'Engineer not on site today.',
      ].join('\n'),
    )
    expect(result.content).not.toContain('The sections below are as reported from site.')
  })

  it('a fully empty body: "The sections below are as reported from site." is suppressed -- no stray line introducing nothing', () => {
    const result = renderEngineerReport(baseFacts(), 'Site closed today.', 'code_templated', { status: 'not_applicable', reason: 'Site closed (holiday)' }, { status: 'not_applicable', reason: 'Site closed (holiday)' }, META)
    expect(result.content).toBe(
      [
        'Good evening.',
        'Daily Progress Report — Speed Mechatronics, Thu 11 Sep',
        '',
        'Site Engineer: Vikram Rao',
        '',
        'Check-in: Morning not applicable — Site closed (holiday) · Evening not applicable — Site closed (holiday)',
        '',
        'SUMMARY (auto-generated)',
        'Site closed today.',
      ].join('\n'),
    )
    expect(result.content).not.toContain('The sections below are as reported from site.')
  })

  it('structured passthrough is unchanged: facts/verdict/verdict_status/morning_status/evening_status', () => {
    const facts = baseFacts()
    const result = renderEngineerReport(facts, 'V.', 'placeholder', morning, evening, META)
    expect(result.structured).toEqual({ facts, verdict: 'V.', verdict_status: 'placeholder', morning_status: morning, evening_status: evening })
  })
})
