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
    // Inline flavor (2026-08-11 root-cause fix): productive_count/idle_count
    // are composed onto one line ("Productive: X, Idle: Y") and therefore
    // never carry the Standalone sentence's terminal punctuation.
    expect(result.structured.manpower.productive_count).toBe('not captured')
    expect(result.content).toContain('Productive: not captured, Idle: not captured')
    // THE ROOT-CAUSE BUG, directly: a Standalone sentence composed inline
    // produced "Not captured today.," (sentence + comma). Must never
    // recur, for any field, anywhere in content.
    expect(result.content).not.toContain('Not captured today.,')
  })
})

describe('renderDpr — wholly not-captured manpower (unsuppressed) collapses to ONE line, same as suppressed', () => {
  it('a single engineer whose whole manpower answer is not_captured renders one line, not four', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      manpower: {
        headcount: { status: 'not_captured', value: null },
        productive_count: { status: 'not_captured', value: null },
        idle_count: { status: 'not_captured', value: null },
        utilisation_pct: { status: 'not_captured', value: null },
      },
    }
    const judgment: DprJudgment = { ...baseJudgment, manpower_idle_reason_note: 'Fully productive today.' }
    const result = renderDpr(facts, judgment, [])
    expect(result.structured.manpower.wholly_blank).toBe(true)
    expect(result.structured.manpower.suppressed).toBeUndefined()
    // Isolate the MANPOWER UTILISATION section specifically — "Not
    // captured today." legitimately also appears under TOMORROW'S PLAN
    // (forced pre-Q6, unrelated to this fix), so counting the whole
    // document would over-count. Exactly one non-empty line under this
    // section's own header, not four.
    const section = result.content.split('MANPOWER UTILISATION\n')[1].split('\n\nEQUIPMENT')[0]
    const nonEmptyLines = section.split('\n').filter((l) => l.trim().length > 0)
    expect(nonEmptyLines).toEqual(['  Not captured today.'])
    expect(result.content).not.toContain('Headcount:')
    expect(result.content).not.toContain('Productive:')
    // The model's note is unreachable here too — isManpowerNoteDiscarded
    // forced it out of the per-call schema, same guarantee as the fully
    // suppressed case.
    expect(result.content).not.toContain('Fully productive today.')
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
    expect(result.structured.manpower.note).toBe('2 engineers reported manpower separately for this project today, so the figures are not combined.')
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
    expect(result.structured.execution.items[0].quantity).toBe('2 engineers reported this same activity, so the quantity is not combined.')
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
    expect(result.structured.equipment.items[0].note).toBe('2 engineers reported this same type of equipment, so the utilisation figures are not combined.')
    expect(result.content).not.toContain('Machine was idle waiting for fuel.')
    // A suppressed equipment item collapses to ONE line too (2026-08-11 —
    // "same principle as the suppressed-manpower block," extended to
    // equipment for BOTH suppression and wholly-not-captured, via the
    // shared isEquipmentItemNoteDiscarded predicate). Previously this case
    // rendered the suppression sentence four times, an unexercised
    // instance of the exact bug the wholly-not-captured case surfaced.
    expect(result.structured.equipment.items[0].blank).toBe(
      '2 engineers reported this same type of equipment, so the utilisation figures are not combined.',
    )
    expect(result.content).toContain('  - jcb: 2 engineers reported this same type of equipment, so the utilisation figures are not combined.')
    expect(result.content).not.toContain('available,')
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

describe('renderDpr — a raw JS boolean must never reach rendered content', () => {
  it('schedule_met true renders as "Yes", not "true"', () => {
    const facts: DprFacts = { ...emptyFacts, schedule: { schedule_met: true } }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.schedule.met).toBe('Yes')
    expect(result.content).toContain('Plan met: Yes')
    expect(result.content).not.toContain('true')
  })

  it('schedule_met false renders as "No", not "false"', () => {
    const facts: DprFacts = { ...emptyFacts, schedule: { schedule_met: false } }
    const judgment = { ...baseJudgment, schedule_miss_reason_note: 'Delayed due to rain.' }
    const result = renderDpr(facts, judgment, [])
    expect(result.structured.schedule.met).toBe('No')
    expect(result.content).toContain('Plan met: No')
    expect(result.content).not.toContain('false')
  })

  it('schedule_met null (not captured) still renders the not-captured phrase, not a boolean or "null"', () => {
    const facts: DprFacts = { ...emptyFacts, schedule: { schedule_met: null } }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.schedule.met).toBe('Not captured today.')
  })
})

describe('renderDpr — Indian currency formatting for money fields (idle_cost, daily_hire_cost)', () => {
  it('a small idle cost (375) renders with ₹ and no unnecessary grouping', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: { status: 'reported', value: 8 },
            actual_hours: { status: 'reported', value: 6 },
            daily_hire_cost: { status: 'reported', value: 1500 },
            idle_cost: { status: 'reported', value: 375 },
          },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.equipment.items[0].idle_cost).toBe('₹375')
    expect(result.structured.equipment.items[0].daily_hire_cost).toBe('₹1,500')
  })

  it('a larger figure uses Indian digit grouping (lakh convention: ₹1,50,000, not ₹150,000)', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'Crane',
            available_hours: { status: 'reported', value: 8 },
            actual_hours: { status: 'reported', value: 8 },
            daily_hire_cost: { status: 'reported', value: 150000 },
            idle_cost: { status: 'reported', value: 0 },
          },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.equipment.items[0].daily_hire_cost).toBe('₹1,50,000')
  })

  it('a not_captured money value renders the phrase, never "₹null" or "₹undefined" — and, being wholly blank, collapses per-field to the Inline/Standalone defaults', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: { status: 'not_captured', value: null },
            actual_hours: { status: 'not_captured', value: null },
            daily_hire_cost: { status: 'not_captured', value: null },
            idle_cost: { status: 'not_captured', value: null },
          },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    // Every field here is not_captured and the item isn't suppressed — this
    // is the wholly-blank collapse case, not a partial one. idle_cost is
    // Inline (composed on the detailed line when NOT collapsed) so its
    // not-captured default is the lowercase fragment; daily_hire_cost is
    // Standalone (never composed) so it keeps the full sentence.
    expect(result.structured.equipment.items[0].idle_cost).toBe('not captured')
    expect(result.structured.equipment.items[0].daily_hire_cost).toBe('Not captured today.')
    expect(result.structured.equipment.items[0].blank).toBe('Not captured today.')
  })
})

describe('renderDpr — THE "Not captured today.h" BUG: a not-captured hours value must never carry a unit suffix', () => {
  it('a not_captured available_hours/actual_hours renders the bare phrase, no "h" appended, anywhere it appears — and the wholly-blank item collapses to one content line', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'Concrete Mixer',
            available_hours: { status: 'not_captured', value: null },
            actual_hours: { status: 'not_captured', value: null },
            daily_hire_cost: { status: 'not_captured', value: null },
            idle_cost: { status: 'not_captured', value: null },
          },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    // Inline flavor — this item is wholly blank, so these are never
    // actually composed into the content line (it collapses instead), but
    // the structured values still carry the correct not-captured flavor
    // for their field type.
    expect(result.structured.equipment.items[0].available_hours).toBe('not captured')
    expect(result.structured.equipment.items[0].actual_hours).toBe('not captured')
    expect(result.content).not.toContain('Not captured today.h')
    expect(result.content).not.toContain('not capturedh')
    expect(result.content).toContain('  - Concrete Mixer: Not captured today.')
    expect(result.content).not.toContain('available,')
  })

  it('a real reported hours value DOES carry the "h" suffix, baked into the value itself', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: { status: 'reported', value: 8 },
            actual_hours: { status: 'reported', value: 6 },
            daily_hire_cost: { status: 'reported', value: 1500 },
            idle_cost: { status: 'reported', value: 375 },
          },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.equipment.items[0].available_hours).toBe('8h')
    expect(result.structured.equipment.items[0].actual_hours).toBe('6h')
  })
})

describe('renderDpr — suppressed manpower renders ONCE for the whole section, not once per field', () => {
  it('the content block has exactly one suppression line under MANPOWER UTILISATION, not four', () => {
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
    const suppressionLine = '2 engineers reported manpower separately for this project today, so the figures are not combined.'
    const occurrences = result.content.split(suppressionLine).length - 1
    expect(occurrences).toBe(1)
    expect(result.content).not.toContain('Headcount:')
    expect(result.content).not.toContain('Productive:')
  })
})

describe('renderDpr — the zero-equipment case renders an explicit "no equipment" line, not a blank section', () => {
  it('empty equipment.items produces a readable line under EQUIPMENT UTILISATION', () => {
    const result = renderDpr(emptyFacts, baseJudgment, [])
    expect(result.content).toContain('No equipment reported this morning.')
  })
})

describe('renderDpr — a PARTIALLY captured equipment item composes real and not-captured values on one line correctly', () => {
  it('one hour known, one not — no period-then-unit-label bug ("Not captured today. actual")', () => {
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'JCB',
            available_hours: { status: 'reported', value: 8 },
            actual_hours: { status: 'not_captured', value: null },
            daily_hire_cost: { status: 'reported', value: 1500 },
            idle_cost: { status: 'not_captured', value: null },
          },
        ],
      },
    }
    const judgment: DprJudgment = { ...baseJudgment, equipment_items: [{ morning_item_index: 0, idle_reason_note: 'Actual hours not confirmed.' }] }
    const result = renderDpr(facts, judgment, [])
    // Not wholly blank — available_hours IS captured — so this renders the
    // detailed two-line block, not the collapse. Every not-captured
    // fragment inside it must be the lowercase Inline flavor, with no
    // stray period before the next word.
    expect(result.content).toContain('  - JCB: 8h available, not captured actual, idle cost not captured')
    expect(result.content).not.toContain('Not captured today. actual')
    expect(result.content).not.toContain('Not captured today.,')
  })
})

describe("renderDpr — golden-case fixture drift regression: EquipmentItemFacts.type must already be a humanized label", () => {
  it('a raw canonical type (e.g. an un-humanized lexicon key) passes through render.ts unchanged — humanization is the Facts assembler\'s job, not render\'s, so a fixture that skips it produces exactly the raw string it was given', () => {
    // render.ts never calls equipmentLabel() itself (lib/dpr/assemble.ts
    // does, at Facts-assembly time) — this test documents that boundary so
    // a future reader doesn't go looking for a humanization step in this
    // file. If EquipmentItemFacts.type is wrong here, the bug is upstream.
    const facts: DprFacts = {
      ...emptyFacts,
      equipment: {
        items: [
          {
            morning_item_index: 0,
            type: 'concrete_mixer', // deliberately raw, to prove the passthrough
            available_hours: { status: 'reported', value: 8 },
            actual_hours: { status: 'reported', value: 8 },
            daily_hire_cost: { status: 'reported', value: 800 },
            idle_cost: { status: 'reported', value: 0 },
          },
        ],
      },
    }
    const result = renderDpr(facts, baseJudgment, [])
    expect(result.structured.equipment.items[0].type).toBe('concrete_mixer')
    expect(result.content).toContain('- concrete_mixer:')
  })
})
