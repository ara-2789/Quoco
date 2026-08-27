import { describe, it, expect } from 'vitest'
import {
  truncateMorningPlan,
  selectEveningTemplate,
  buildMorningTemplate,
  MORNING_CHECKIN_SID,
  EVENING_CHECKIN_SID,
  EVENING_CHECKIN_NO_PLAN_SID,
} from '@/lib/whatsapp/outbound/templates'

describe('truncateMorningPlan', () => {
  it('returns a short plan unchanged', () => {
    expect(truncateMorningPlan('Pour slab on level 3')).toBe('Pour slab on level 3')
  })

  it('returns a plan at exactly the limit unchanged', () => {
    const exact = 'a'.repeat(150)
    expect(truncateMorningPlan(exact)).toBe(exact)
    expect(truncateMorningPlan(exact).length).toBe(150)
  })

  it('breaks on the last word boundary before the limit, never mid-word', () => {
    // Same fictional plan whatsapp-templates.md's own §28(v) entry uses as
    // its worked example -- the exact case the mid-word bug was found in.
    const plan =
      'Continue shuttering work for the second floor slab near grid lines D4 to D9, finish rebar tying for the retaining wall on the north side, coordinate with the ready-mix supplier for tomorrow.'
    const truncated = truncateMorningPlan(plan)
    expect(truncated.length).toBeLessThanOrEqual(150)
    expect(truncated.endsWith('…')).toBe(true)
    // The character immediately before the ellipsis must not be mid-word --
    // i.e. the original string must have a space (or end) right after the
    // truncated content, not a letter continuing into a cut word.
    const withoutEllipsis = truncated.slice(0, -1)
    const nextCharInOriginal = plan[withoutEllipsis.length]
    expect(nextCharInOriginal === ' ' || nextCharInOriginal === undefined).toBe(true)
  })

  it('never exceeds 150 characters for a long plan', () => {
    const plan = 'word '.repeat(60).trim() // 299 chars, plenty of spaces
    expect(truncateMorningPlan(plan).length).toBeLessThanOrEqual(150)
  })

  it('falls back to a hard cut, still within budget, when there is no space to break on', () => {
    const oneGiantWord = 'a'.repeat(200)
    const truncated = truncateMorningPlan(oneGiantWord)
    expect(truncated.length).toBeLessThanOrEqual(150)
    expect(truncated.endsWith('…')).toBe(true)
  })
})

describe('selectEveningTemplate', () => {
  it('selects the no-plan template when morningPlan is null -- the never-engaged case', () => {
    const sel = selectEveningTemplate('Arjun Nair', 'Emerald Heights', null)
    expect(sel.contentSid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
    expect(sel.contentVariables).toEqual({ '1': 'Arjun Nair', '2': 'Emerald Heights' })
    expect(sel.contentVariables['3']).toBeUndefined()
  })

  it('selects the no-plan template when morningPlan is undefined', () => {
    const sel = selectEveningTemplate('Arjun Nair', 'Emerald Heights', undefined)
    expect(sel.contentSid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
  })

  it('selects the no-plan template when morningPlan is an empty/whitespace string -- the attendance="absent" case', () => {
    expect(selectEveningTemplate('A', 'P', '').contentSid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
    expect(selectEveningTemplate('A', 'P', '   ').contentSid).toBe(EVENING_CHECKIN_NO_PLAN_SID)
  })

  it('selects the primary template with {{3}} when a real morning plan exists', () => {
    const sel = selectEveningTemplate('Arjun Nair', 'Emerald Heights', 'Pour slab on level 3')
    expect(sel.contentSid).toBe(EVENING_CHECKIN_SID)
    expect(sel.contentVariables).toEqual({
      '1': 'Arjun Nair',
      '2': 'Emerald Heights',
      '3': 'Pour slab on level 3',
    })
  })

  it('truncates a long morning plan into {{3}}', () => {
    const longPlan = 'word '.repeat(60).trim()
    const sel = selectEveningTemplate('A', 'P', longPlan)
    expect(sel.contentSid).toBe(EVENING_CHECKIN_SID)
    expect(sel.contentVariables['3']!.length).toBeLessThanOrEqual(150)
  })
})

describe('buildMorningTemplate', () => {
  it('builds the morning checkin template with name and project', () => {
    const sel = buildMorningTemplate('Arjun Nair', 'Emerald Heights')
    expect(sel.contentSid).toBe(MORNING_CHECKIN_SID)
    expect(sel.contentVariables).toEqual({ '1': 'Arjun Nair', '2': 'Emerald Heights' })
  })
})
