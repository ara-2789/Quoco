import { describe, it, expect } from 'vitest'
import { parseLabourCount } from '@/lib/whatsapp/flows/parsers/labour'
import { parseIdleHoursByTrade } from '@/lib/whatsapp/flows/parsers/idle-hours'
import { parseEquipmentHoursByType } from '@/lib/whatsapp/flows/parsers/equipment-hours'
import { SECTION_42_CORPUS } from '../helpers/section-42-corpus'

// §42 (unmatched trade/equipment tokens are CAPTURED, not silently dropped)
// — TS-PARSER LAYER. FLIPPED GREEN, migration 035 round 3 (all three
// pending parsers from review package §10 are now built): parseLabourCount
// (labour.ts, existing, fixed in place), parseIdleHoursByTrade (idle-hours.ts,
// new), parseEquipmentHoursByType (equipment-hours.ts, ADDITIVE — see that
// file's own header for why the redesign lives under a new name rather than
// replacing parseEquipmentHours in place: evening.ts's live production
// wrapper, applyEveningFlowTurn, still calls the OLD parseEquipmentHours on
// every real evening turn, and cannot be rewired until 035 applies in the
// same lockstep deploy — review package §9 Finding A).
//
// This file previously carried `it.fails` TARGET tests (expected-fail, per
// CLAUDE.md's own build discipline) alongside "TODAY" tests documenting the
// pre-fix gap. Per that discipline's own stated plan: each TARGET assertion
// is now an ORDINARY test (the `.fails` wrapper removed, since it would now
// itself go red — the assertion genuinely passes), and each paired "TODAY"
// test is DELETED — it documented behaviour that no longer exists, not a
// regression worth guarding.
//
// SCOPE, unchanged from the original RED-test round: the three §42 sites
// review package §10 actually named. Morning Q3 equipment (equipment.ts) is
// still deliberately excluded — 035 never touches that branch.

const manpowerCase = SECTION_42_CORPUS.find((c) => c.site === 'manpower')!
const idleHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'idle_hours')!
const equipmentHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'equipment_hours')!

describe('§42 unmatched-token capture — site 1: manpower (parseLabourCount, shared by morning Q2 + evening step 2)', () => {
  it('an unmatched trade token is preserved in by_trade with matched:false, original case intact', () => {
    const parse = parseLabourCount(manpowerCase.input)
    const unmatched = parse.by_trade.find((t) => t.trade === manpowerCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
    // Case preservation, not just presence: the lowercasing fix means the
    // captured token is 'PEB', never the lowercased 'peb'.
    expect(unmatched!.trade).toBe('PEB')
  })

  it('the matched trade alongside it is unaffected', () => {
    const parse = parseLabourCount(manpowerCase.input)
    const matched = parse.by_trade.find((t) => t.trade === manpowerCase.matchedToken)
    expect(matched).toEqual({
      trade: manpowerCase.matchedToken,
      planned_count: manpowerCase.matchedCount,
      matched: true,
    })
  })
})

describe('§42 unmatched-token capture — site: idle_hours (evening step 3, new parser)', () => {
  it('an unmatched trade token is preserved in by_trade with matched:false, original case intact', () => {
    const parse = parseIdleHoursByTrade(idleHoursCase.input)
    const unmatched = parse.by_trade.find((t) => t.trade === idleHoursCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
    expect(unmatched!.trade).toBe('PEB')
  })

  it('the matched trade alongside it is unaffected', () => {
    const parse = parseIdleHoursByTrade(idleHoursCase.input)
    const matched = parse.by_trade.find((t) => t.trade === idleHoursCase.matchedToken)
    expect(matched).toEqual({ trade: idleHoursCase.matchedToken, idle_hours: 2, matched: true })
  })
})

describe('§42 unmatched-token capture — site: equipment_hours (evening step 4 redesign, parseEquipmentHoursByType)', () => {
  it('an unmatched equipment token is preserved as {type, hours_used, matched:false}, original case intact', () => {
    const parse = parseEquipmentHoursByType(equipmentHoursCase.input)
    const item = parse.items.find((i) => i.raw.includes(equipmentHoursCase.unmatchedToken))
    expect(item).toBeDefined()
    expect(item!.type).toBe(equipmentHoursCase.unmatchedToken)
    expect(item!.matched).toBe(false)
    expect(item!.hours_used).toBe(4)
  })

  it('the matched equipment type alongside it resolves via canonicalEquipment', () => {
    const parse = parseEquipmentHoursByType(equipmentHoursCase.input)
    const item = parse.items.find((i) => i.type === equipmentHoursCase.matchedToken)
    expect(item).toEqual({ type: 'jcb', hours_used: 6, matched: true, raw: 'JCB 6 hours' })
  })
})
