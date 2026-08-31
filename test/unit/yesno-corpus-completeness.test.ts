import { describe, it, expect } from 'vitest'
import { YES_WORDS, NO_WORDS } from '@/lib/whatsapp/flows/parsers/lexicon'
import { YESNO_CORPUS } from '../helpers/yesno-corpus'

// ADDED external review round 2 (review package §11.6) -- closes the gap the
// reviewer named in yesno-corpus.ts's own header: "every literal checked
// against the live word lists as of <date>" is a DATE-STAMPED PROMISE, not a
// mechanism. A word added to YES_WORDS/NO_WORDS next month passes
// classifyYesNo's own TS tests fine, never reaches quoco_classify_yes_no
// (SQL), and this corpus never knows -- test/unit/yesno-mirror.test.ts only
// checks agreement on what the corpus ALREADY lists, it cannot notice an
// entry the corpus never gained in the first place.
//
// This test flips the direction of the check: instead of iterating the
// corpus and asking "does each side agree", it iterates the EXPORTED WORD
// SETS THEMSELVES and asserts every member has a single-token case in the
// corpus. A word present in YES_WORDS/NO_WORDS but absent from the corpus
// fails HERE, immediately, on the TS side alone -- before it ever gets a
// chance to silently drift from the SQL port (030_morning_flow_attendance.sql's
// own quoco_classify_yes_no, hand-kept in sync, no shared source of truth).
//
// Only YES_WORDS and NO_WORDS are checked -- the only two sets this module
// actually exports. NONE_WORDS stays private (not exported), so it's outside
// what "iterate the exported sets" can reach; its members are already
// enumerated in the corpus by hand (see that file's own NONE_WORDS section).
describe('yesno corpus completeness (exported sets vs corpus)', () => {
  const corpusInputs = new Set(YESNO_CORPUS.map((c) => c.input.trim().toLowerCase()))

  it('every YES_WORDS member has a single-token case in the corpus', () => {
    const missing = [...YES_WORDS].filter((word) => !corpusInputs.has(word))
    expect(missing).toEqual([])
  })

  it('every NO_WORDS member has a single-token case in the corpus', () => {
    const missing = [...NO_WORDS].filter((word) => !corpusInputs.has(word))
    expect(missing).toEqual([])
  })
})
