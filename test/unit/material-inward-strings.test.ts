import { describe, it, expect } from 'vitest'
import * as strings from '@/lib/whatsapp/flows/material-inward-strings'
import {
  MI_SESSION_ENDED_REPLY,
  CHECKIN_RESET_EXPLAIN_REPLY,
  MI_CHECKIN_PHOTO_NOT_SAVED_REPLY,
  MI_ASK_FILE,
  MI_ACK_QUESTION,
} from '@/lib/whatsapp/flows/material-inward-strings'

// Approved 2026-10-26 (Aravind). The literals below are typed independently of
// the module so a drift in either fails the comparison.
const EXPECTED = {
  MI_SESSION_ENDED_REPLY:
    'That DC or invoice question has ended. Your answer was not recorded. Reply 4 to start again.',
  CHECKIN_RESET_EXPLAIN_REPLY:
    'Your DC or invoice was stopped for the check-in. Files already received are kept.',
  MI_CHECKIN_PHOTO_NOT_SAVED_REPLY: 'Photo not saved.',
}

/** Control helper: change exactly one character. */
function mutateOneChar(s: string): string {
  return s.slice(0, -1) + (s.endsWith('.') ? '!' : '.')
}

describe('material-inward strings (C3 subset)', () => {
  it('MI_SESSION_ENDED_REPLY is byte-exact', () => {
    expect(MI_SESSION_ENDED_REPLY).toBe(EXPECTED.MI_SESSION_ENDED_REPLY)
  })
  it('CHECKIN_RESET_EXPLAIN_REPLY is byte-exact', () => {
    expect(CHECKIN_RESET_EXPLAIN_REPLY).toBe(EXPECTED.CHECKIN_RESET_EXPLAIN_REPLY)
  })
  it('MI_CHECKIN_PHOTO_NOT_SAVED_REPLY is byte-exact', () => {
    expect(MI_CHECKIN_PHOTO_NOT_SAVED_REPLY).toBe(EXPECTED.MI_CHECKIN_PHOTO_NOT_SAVED_REPLY)
  })
  it('control: a one-character change fails the comparison', () => {
    expect(mutateOneChar(MI_SESSION_ENDED_REPLY)).not.toBe(EXPECTED.MI_SESSION_ENDED_REPLY)
    expect(mutateOneChar(CHECKIN_RESET_EXPLAIN_REPLY)).not.toBe(EXPECTED.CHECKIN_RESET_EXPLAIN_REPLY)
    expect(mutateOneChar(MI_CHECKIN_PHOTO_NOT_SAVED_REPLY)).not.toBe(EXPECTED.MI_CHECKIN_PHOTO_NOT_SAVED_REPLY)
  })
})

// Migration 052 (docs/reviews/052-design/kind-removal-plan.md rev 8.1, section D). Tamil owed, NOT approved: accepted for the
// build only, final approval at PR review. The literals are typed here independently of the module, with the exact line breaks
// the plan gives MI_ACK_QUESTION (three "\n", one per option).
const NEW_052 = {
  MI_ASK_FILE: 'Send one DC or invoice. A PDF, or photos of all its pages together.',
  MI_ACK_QUESTION:
    'Does the material at site match this document?\nReply 1 for matches\nReply 2 for does not match\nReply 3 for partly matches',
}

describe('052 new strings (English approved 14 Nov 2026; Tamil owed) are byte-exact', () => {
  it('MI_ASK_FILE is exactly the plan text', () => {
    expect(MI_ASK_FILE).toBe(NEW_052.MI_ASK_FILE)
  })
  it('MI_ACK_QUESTION is exactly the plan text, including its three \\n characters', () => {
    expect(MI_ACK_QUESTION).toBe(NEW_052.MI_ACK_QUESTION)
    expect(MI_ACK_QUESTION.split('\n')).toEqual([
      'Does the material at site match this document?',
      'Reply 1 for matches',
      'Reply 2 for does not match',
      'Reply 3 for partly matches',
    ])
    expect(MI_ACK_QUESTION.match(/\n/g)).toHaveLength(3)
    expect(MI_ACK_QUESTION).not.toContain('\r')
    expect(MI_ACK_QUESTION).not.toContain(' / ') // the one-line " / " form from the block text is NOT the plan text
  })
  it('control: a one-character change, and the one-line form, fail the comparison', () => {
    expect(mutateOneChar(MI_ACK_QUESTION)).not.toBe(NEW_052.MI_ACK_QUESTION)
    expect(mutateOneChar(MI_ASK_FILE)).not.toBe(NEW_052.MI_ASK_FILE)
    expect(MI_ACK_QUESTION.replace(/\n/g, ' / ')).not.toBe(NEW_052.MI_ACK_QUESTION)
  })
  it('the six retired kind-specific constants are no longer exported', () => {
    for (const gone of ['MI_ASK_KIND', 'MI_KIND_REASK', 'MI_ASK_FILE_DC', 'MI_ASK_FILE_INVOICE', 'MI_ACK_QUESTION_DC', 'MI_ACK_QUESTION_INVOICE']) {
      expect(Object.keys(strings)).not.toContain(gone)
    }
  })
})
