import { describe, it, expect } from 'vitest'
import { parseProductivity, isProductivityAnswered } from '@/lib/whatsapp/flows/parsers/productivity'

// Pure unit tests for the Q4 step 2 (productivity/idle) parser. AGGREGATE-ONLY
// v1 (design-decisions-beta-feedback.md §9) — no trade breakdown is ever
// produced; these tests don't look for one.

describe('parseProductivity', () => {
  it('all productive: "yes"', () => {
    const p = parseProductivity('yes')
    expect(p.all_productive).toBe(true)
    expect(p.idle_count).toBeNull()
    expect(p.idle_reason).toBeNull()
    expect(isProductivityAnswered(p)).toBe(true)
  })

  it('all productive: "fully done"', () => {
    const p = parseProductivity('fully done')
    expect(p.all_productive).toBe(true)
  })

  it('some idle with NO no/hedge word at all — a bare number is its own signal', () => {
    // The most natural real answer: no "no", just the count + reason.
    const p = parseProductivity('2 idle, cement shortage')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('cement shortage')
  })

  it('some idle with count and reason', () => {
    const p = parseProductivity('2 idle waiting for cement')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('waiting for cement')
    expect(isProductivityAnswered(p)).toBe(true)
  })

  it('"no" prefix still resolves to some-idle with the count', () => {
    const p = parseProductivity('no, 3 idle - rain')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(3)
    expect(p.idle_reason).toBe('rain')
  })

  it('hedge word alone ("mostly") resolves to some-idle, no count given', () => {
    const p = parseProductivity('mostly')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBeNull()
    expect(p.idle_reason).toBeNull()
  })

  it('some idle with no reason: idle_reason null', () => {
    const p = parseProductivity('2 idle')
    expect(p.all_productive).toBe(false)
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBeNull()
  })

  it('unclassifiable: neither yes nor no/hedge vocabulary', () => {
    const p = parseProductivity('site is busy today')
    expect(p.all_productive).toBeNull()
    expect(p.idle_count).toBeNull()
    expect(isProductivityAnswered(p)).toBe(false)
  })

  it('empty answer: unclassifiable, raw preserved as empty', () => {
    const p = parseProductivity('   ')
    expect(p.all_productive).toBeNull()
    expect(p.raw_text).toBe('')
    expect(isProductivityAnswered(p)).toBe(false)
  })

  it('raw_text is always preserved verbatim (trimmed)', () => {
    const p = parseProductivity('  2 idle waiting for cement  ')
    expect(p.raw_text).toBe('2 idle waiting for cement')
  })

  it('digit glued to a word: split at the boundary', () => {
    const p = parseProductivity('no 2idle cement delay')
    expect(p.idle_count).toBe(2)
    expect(p.idle_reason).toBe('cement delay')
  })
})
