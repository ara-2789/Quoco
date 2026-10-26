import { describe, it, expect } from 'vitest'
import {
  MI_SESSION_ENDED_REPLY,
  CHECKIN_RESET_EXPLAIN_REPLY,
  MI_CHECKIN_PHOTO_NOT_SAVED_REPLY,
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
