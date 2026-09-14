import { describe, it, expect } from 'vitest'
import { isCompletion, type Attempt } from '@/lib/whatsapp/dispatch'

// FIX (Aravind, 2026-09-13, stage 1 post-build review). Before this fix,
// lib/whatsapp/inbound-start.ts decided "did this turn just complete the
// check-in" by string-comparing dispatchInboundTurn's rendered `reply`
// against MORNING_COMPLETE_REPLY/EVENING_COMPLETE_REPLY -- a wording edit to
// either constant would silently stop the photo-count branch from ever
// firing again, with no error and no failing test.
//
// isCompletion (lib/whatsapp/dispatch.ts) replaces that with a decision made
// from outcome/currentStep/attendance ALONE -- the same fields
// buildMorningReply/buildEveningReply already use to CHOOSE which reply text
// to render, never the rendered text itself. This file proves that
// structurally: every case below constructs an Attempt and asserts
// isCompletion's verdict WITHOUT ever touching a reply string. isCompletion's
// own signature has no `reply` parameter to read -- so no matter how
// MORNING_COMPLETE_REPLY/EVENING_COMPLETE_REPLY are worded, now or in the
// future, this file's assertions cannot be affected by that wording. That is
// the exact regression this fix closes, made unable to recur by
// construction rather than merely tested against today's copy.
describe('isCompletion (dispatch.ts) — completion is structural, never text-based', () => {
  it('morning: advance to step 0 with attendance present is a completion', () => {
    const a: Attempt = { flow: 'morning', outcome: 'advance', currentStep: 0, attendance: 'present' }
    expect(isCompletion(a)).toBe(true)
  })

  it('morning: advance to step 0 with attendance site_holiday is NOT a completion (different terminal reply, no photo count)', () => {
    const a: Attempt = { flow: 'morning', outcome: 'advance', currentStep: 0, attendance: 'site_holiday' }
    expect(isCompletion(a)).toBe(false)
  })

  it('morning: advance to step 0 with attendance absent is NOT a completion', () => {
    const a: Attempt = { flow: 'morning', outcome: 'advance', currentStep: 0, attendance: 'absent' }
    expect(isCompletion(a)).toBe(false)
  })

  it('morning: advance to a non-zero step is NOT a completion (mid-flow, not terminal)', () => {
    const a: Attempt = { flow: 'morning', outcome: 'advance', currentStep: 3, attendance: null }
    expect(isCompletion(a)).toBe(false)
  })

  it('morning: reask is NOT a completion regardless of step', () => {
    const a: Attempt = { flow: 'morning', outcome: 'reask', currentStep: 0, attendance: 'present' }
    expect(isCompletion(a)).toBe(false)
  })

  it('morning: already_complete is NOT a new completion (the flow was already done before this turn)', () => {
    const a: Attempt = { flow: 'morning', outcome: 'already_complete', currentStep: 0, attendance: 'present' }
    expect(isCompletion(a)).toBe(false)
  })

  it('evening: advance to step 0 is always a completion (no site_holiday/absent terminal exists for evening)', () => {
    const a: Attempt = { flow: 'evening', outcome: 'advance', currentStep: 0, equipmentEcho: null }
    expect(isCompletion(a)).toBe(true)
  })

  it('evening: advance to a non-zero step is NOT a completion', () => {
    const a: Attempt = { flow: 'evening', outcome: 'advance', currentStep: 3, equipmentEcho: null }
    expect(isCompletion(a)).toBe(false)
  })

  it('evening: reask is NOT a completion', () => {
    const a: Attempt = { flow: 'evening', outcome: 'reask', currentStep: 0, equipmentEcho: null }
    expect(isCompletion(a)).toBe(false)
  })

  it('hindrance never completes in the photo-count sense, regardless of outcome/step', () => {
    const a: Attempt = { flow: 'hindrance', outcome: 'advance', currentStep: 0, wasExhausted: false }
    expect(isCompletion(a)).toBe(false)
  })

  it('wrong_flow is never a completion, for any flow', () => {
    expect(isCompletion({ flow: 'morning', outcome: 'wrong_flow', currentStep: 0, attendance: null })).toBe(false)
    expect(isCompletion({ flow: 'evening', outcome: 'wrong_flow', currentStep: 0, equipmentEcho: null })).toBe(false)
  })
})
