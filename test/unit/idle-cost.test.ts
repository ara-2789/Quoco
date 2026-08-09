import { describe, it, expect } from 'vitest'
import { computeIdleCost } from '@/lib/dpr/idle-cost'
import type { CapturedNumber } from '@/lib/dpr/schema'

// Case #3 from bot-flows.md's DPR eval minimum-case list ("idle-equipment
// arithmetic") — filed here, not lib/dpr/eval/cases/, because it's a pure
// arithmetic regression fixture, not a model eval: computeIdleCost never
// calls Claude, and every assertion below is deterministic. Filing it beside
// golden cases would mislabel what a green run means (see case #1's own
// file for the golden-case convention this deliberately isn't).
//
// Also covers the "suppress idle cost when the hire rate is untrusted" rule
// (CLAUDE.md §10, "A COUNT IN A MONEY FIELD") — nothing tested this before:
// computeIdleCost has no separate trust parameter, so untrust is exercised
// here the same way any other missing input is — a daily_hire_cost already
// marked not_captured by the caller.

const reported = (value: number): CapturedNumber => ({ status: 'reported', value })
const notCaptured: CapturedNumber = { status: 'not_captured', value: null }

describe('computeIdleCost', () => {
  it('real arithmetic: rate 8000, available 8h, actual 3.27h -> 4730', () => {
    const result = computeIdleCost(reported(8), reported(3.27), reported(8000))
    expect(result).toEqual({ status: 'reported', value: 4730 })
  })

  it('fully utilised: actual equals available -> zero idle cost, still reported', () => {
    const result = computeIdleCost(reported(8), reported(8), reported(8000))
    expect(result).toEqual({ status: 'reported', value: 0 })
  })

  it('untrusted hire rate (daily_hire_cost already flagged not_captured) suppresses idle_cost, even with clean hours', () => {
    const result = computeIdleCost(reported(8), reported(3.27), notCaptured)
    expect(result).toEqual({ status: 'not_captured', value: null })
  })

  it('hours not captured, cost reported -> not_captured (never compute off a partial input)', () => {
    const result = computeIdleCost(notCaptured, notCaptured, reported(8000))
    expect(result).toEqual({ status: 'not_captured', value: null })
  })

  it('available_hours <= 0 -> not_captured (division guard)', () => {
    const result = computeIdleCost(reported(0), reported(0), reported(8000))
    expect(result).toEqual({ status: 'not_captured', value: null })
  })

  it('available_hours > 24 -> not_captured (defensive, mirrors the parser\'s own guard)', () => {
    const result = computeIdleCost(reported(30), reported(10), reported(8000))
    expect(result).toEqual({ status: 'not_captured', value: null })
  })

  it('actual_hours > available_hours -> not_captured (defensive, mirrors the parser\'s own guard)', () => {
    const result = computeIdleCost(reported(4), reported(6), reported(8000))
    expect(result).toEqual({ status: 'not_captured', value: null })
  })
})
