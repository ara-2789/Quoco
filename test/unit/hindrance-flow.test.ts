import { describe, it, expect } from 'vitest'
import {
  classifyHindranceTiming,
  buildHindranceReply,
  HINDRANCE_QUESTIONS,
  HINDRANCE_RESOLVED_REPLY,
  HINDRANCE_UNSPECIFIED_REPLY,
} from '@/lib/whatsapp/flows/hindrance'

describe('classifyHindranceTiming', () => {
  it('classifies a bare "1" as active', () => {
    expect(classifyHindranceTiming('1')).toEqual({ ok: true, timing: 'active' })
  })

  it('classifies a bare "2" as potential', () => {
    expect(classifyHindranceTiming('2')).toEqual({ ok: true, timing: 'potential' })
  })

  it('classifies a digit followed by trailing text', () => {
    expect(classifyHindranceTiming('1, it is blocking now')).toEqual({ ok: true, timing: 'active' })
    expect(classifyHindranceTiming('2 maybe later')).toEqual({ ok: true, timing: 'potential' })
  })

  it('does NOT match a multi-digit number', () => {
    expect(classifyHindranceTiming('12')).toEqual({ ok: false, timing: null })
    expect(classifyHindranceTiming('21')).toEqual({ ok: false, timing: null })
  })

  it('treats any other digit and free text as unclassified', () => {
    expect(classifyHindranceTiming('3')).toEqual({ ok: false, timing: null })
    expect(classifyHindranceTiming('maybe')).toEqual({ ok: false, timing: null })
    expect(classifyHindranceTiming('')).toEqual({ ok: false, timing: null })
  })

  it('tolerates leading whitespace', () => {
    expect(classifyHindranceTiming('   1')).toEqual({ ok: true, timing: 'active' })
  })
})

describe('buildHindranceReply', () => {
  it('start returns Q1', () => {
    expect(buildHindranceReply('start', 1)).toBe(HINDRANCE_QUESTIONS[1])
  })

  it('advance to step 2 returns Q2', () => {
    expect(buildHindranceReply('advance', 2)).toBe(HINDRANCE_QUESTIONS[2])
  })

  it('reask at step 2 returns Q2 verbatim, no meta-commentary -- matches morning/evening convention', () => {
    expect(buildHindranceReply('reask', 2)).toBe(HINDRANCE_QUESTIONS[2])
  })

  it('a resolved completion (advance, step 0, wasExhausted=false) returns the plain confirmation', () => {
    expect(buildHindranceReply('advance', 0, false)).toBe(HINDRANCE_RESOLVED_REPLY)
  })

  it('an exhausted completion (advance, step 0, wasExhausted=true) returns the distinct confirmation', () => {
    expect(buildHindranceReply('advance', 0, true)).toBe(HINDRANCE_UNSPECIFIED_REPLY)
  })

  it('omitting wasExhausted on a completion falls back to the resolved reply, never the exhausted one', () => {
    expect(buildHindranceReply('advance', 0)).toBe(HINDRANCE_RESOLVED_REPLY)
  })

  it('idle and wrong_flow are never shown -- both render empty, matching morning/evening', () => {
    expect(buildHindranceReply('idle', 0)).toBe('')
    expect(buildHindranceReply('wrong_flow', 0)).toBe('')
  })
})
