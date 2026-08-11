import { describe, it, expect } from 'vitest'
import { renderDpr } from '@/lib/dpr/render'
import type { DprFacts, DprJudgment, AccountabilityEntry } from '@/lib/dpr/schema'

const baseJudgment: DprJudgment = {
  execution_narrative: 'Completed shuttering work.',
  execution_data_status: 'complete',
  schedule_miss_reason_note: '',
  schedule_data_status: 'complete',
  manpower_idle_reason_note: 'All workers were productive.',
  manpower_data_status: 'complete',
  equipment_items: [],
  equipment_data_status: 'complete',
  tomorrows_plan_carry_forward_note: 'Resume tomorrow.',
}

const emptyFacts: DprFacts = {
  execution: { quantities: [] },
  schedule: { schedule_met: true },
  manpower: {
    headcount: { status: 'reported', value: 10 },
    productive_count: { status: 'reported', value: 10 },
    idle_count: { status: 'reported', value: 0 },
    utilisation_pct: { status: 'reported', value: 100 },
  },
  equipment: { items: [] },
  tomorrows_plan: { dependencies: [] },
}

describe('renderDpr — §5 forced not_captured pre-Q6', () => {
  it('never surfaces tomorrows_plan_carry_forward_note, regardless of what the model wrote', () => {
    const result = renderDpr(emptyFacts, baseJudgment, [])
    expect(result.structured.tomorrows_plan.note).toBe('Not captured today.')
    expect(result.structured.tomorrows_plan.data_status).toBe('not_captured')
    expect(result.content).not.toContain('Resume tomorrow.')
  })
})

describe('renderDpr — manpower not_captured guarantee', () => {
  it('a fully not_captured section renders code-side text, NEVER the model note, even if the model wrote confident prose', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      manpower: {
        headcount: { status: 'not_captured', value: null },
        productive_count: { status: 'not_captured', value: null },
        idle_count: { status: 'not_captured', value: null },
        utilisation_pct: { status: 'not_captured', value: null },
      },
    }
    const judgment: DprJudgment = { ...baseJudgment, manpower_idle_reason_note: 'Everyone was fully productive today.' }
    const result = renderDpr(facts, judgment, [])
    expect(result.structured.manpower.note).toBe('Not captured today.')
    expect(result.content).not.toContain('Everyone was fully productive today.')
  })

  it('a partially captured section (headcount known, productivity not) still surfaces the model note', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      manpower: {
        headcount: { status: 'reported', value: 4 },
        productive_count: { status: 'not_captured', value: null },
        idle_count: { status: 'not_captured', value: null },
        utilisation_pct: { status: 'not_captured', value: null },
      },
    }
    const judgment: DprJudgment = { ...baseJudgment, manpower_idle_reason_note: 'Productivity not reported today.' }
    const result = renderDpr(facts, judgment, [])
    expect(result.structured.manpower.note).toBe('Productivity not reported today.')
    expect(result.structured.manpower.headcount).toBe('4')
    expect(result.structured.manpower.productive_count).toBe('Not captured today.')
  })
})

describe('renderDpr — suppression composes with the not_captured render rule (§12)', () => {
  it('a suppressed manpower section renders "reported by N engineers", never the generic not_captured text or the model note', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      manpower: {
        headcount: { status: 'not_captured', value: null },
        productive_count: { status: 'not_captured', value: null },
        idle_count: { status: 'not_captured', value: null },
        utilisation_pct: { status: 'not_captured', value: null },
        suppressed: { reason: 'multi_engineer_manpower', engineer_count: 2 },
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.manpower.note).toBe('Reported by 2 engineers — manpower not aggregated.')
    expect(result.structured.manpower.note).not.toBe('Not captured today.')
  })

  it('a suppressed execution item renders per-item, distinct items are untouched', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      execution: {
        quantities: [
          {
            activity: 'slab pour',
            unit: 'cum',
            quantity: { status: 'not_captured', value: null },
            suppressed: { reason: 'same_activity_overlap', engineer_count: 2 },
          },
          { activity: 'column shuttering', unit: 'nos', quantity: { status: 'reported', value: 8 } },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.execution.items[0].quantity).toBe('Reported by 2 engineers — quantity not aggregated.')
    expect(result.structured.execution.items[1].quantity).toBe('8')
  })

  it('a suppressed equipment item renders per-item, never the model idle_reason_note', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'jcb',
            available_hours: { status: 'not_captured', value: null },
            actual_hours: { status: 'not_captured', value: null },
            daily_hire_cost: { status: 'not_captured', value: null },
            idle_cost: { status: 'not_captured', value: null },
            suppressed: { reason: 'same_type_equipment', engineer_count: 2 },
          },
        ],
      },
    }
    const judgment: DprJudgment = {
      ...baseJudgment,
      equipment_items: [{ morning_item_index: 0, idle_reason_note: 'Machine was idle waiting for fuel.' }],
    }
    const result = renderDpr(facts, judgment, [])
    expect(result.structured.equipment.items[0].note).toBe('Reported by 2 engineers — utilisation not aggregated.')
    expect(result.content).not.toContain('Machine was idle waiting for fuel.')
  })
})

describe('renderDpr — §6 accountability is a pure pass-through, no rendering choice', () => {
  it('empty roster gaps renders the all-submitted line', () => {
    const result = renderDpr(emptyFacts, baseJudgment, [])
    expect(result.content).toContain('All engineers submitted both check-ins today.')
  })

  it('entries pass through verbatim into structured and content', () => {
    const accountability: AccountabilityEntry[] = [
      {
        engineer_name: 'Rajesh',
        morning_status: 'submitted',
        evening_status: 'missing',
        morning_pattern: null,
        evening_pattern: null,
        status_note: 'Rajesh — no evening check-in recorded',
      },
    ]
    const result = renderDpr(emptyFacts, baseJudgment, accountability)
    expect(result.structured.accountability).toEqual(accountability)
    expect(result.content).toContain('Rajesh — no evening check-in recorded')
  })
})

describe('renderDpr — content is a real string, not just structured JSON', () => {
  it('includes the execution narrative and quantities', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      execution: { quantities: [{ activity: 'shuttering', unit: 'nos', quantity: { status: 'reported', value: 8 } }] },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.content).toContain('Completed shuttering work.')
    expect(result.content).toContain('shuttering: 8 nos')
  })
})
