// Add-engineer slice 1, PR A (A1). Pure -- no database, no network.
// Covers plan section 3.3-3.5 (validator + line format), section 4 R1-R4, the
// 50-line / 100-character caps, and T9 (the validator corpus is derived from
// TEST_BOUNDARY_PHONE_LITERAL by formatting and mutation ONLY -- this file
// writes out no second +91 number; test/engineer-boundary-literal-guard.test.ts
// enforces that).
import { describe, expect, it } from 'vitest'
import { normalisePhoneNumber } from '@/lib/whatsapp/normalise'
import {
  MAX_LINES,
  MAX_NAME_LENGTH,
  parseRoster,
  validateIndianMobile,
  type RosterEntry,
} from '@/lib/engineers/parse-roster'
import {
  TEST_BOUNDARY_PHONE_LITERAL as N,
  boundaryAcceptedForms,
  boundaryDerivedNumber,
  boundaryRejectedForms,
} from './helpers/boundary-phone'

const STORED_FORM = /^\+91[6-9][0-9]{9}$/

function entriesOf(raw: string): RosterEntry[] {
  const r = parseRoster(raw)
  if (!r.ok) throw new Error(`expected ok parse, got ${r.error}`)
  return r.entries
}

describe('T9 validator corpus (derived from the boundary literal)', () => {
  it('pins why a validator is needed: normalisePhoneNumber alone stores "+abc"', () => {
    expect(normalisePhoneNumber('abc')).toBe('+abc')
    expect(validateIndianMobile('abc')).toBeNull()
  })

  it.each(boundaryAcceptedForms())('accepts %j and stores exactly the boundary literal', (form) => {
    expect(validateIndianMobile(form)).toBe(N)
  })

  it('every accepted result is the 13-character stored form and a fixed point of normalisePhoneNumber', () => {
    for (const form of boundaryAcceptedForms()) {
      const stored = validateIndianMobile(form)
      expect(stored, `form ${JSON.stringify(form)}`).not.toBeNull()
      expect(stored).toMatch(STORED_FORM)
      expect(stored!.length).toBe(13)
      expect(normalisePhoneNumber(stored!)).toBe(stored)
    }
  })

  it.each(boundaryRejectedForms())('rejects %j', (form) => {
    expect(validateIndianMobile(form)).toBeNull()
  })

  it('a derived number (last two digits changed) is accepted and distinct from the literal', () => {
    for (let k = 1; k <= 8; k++) {
      const d = boundaryDerivedNumber(k)
      expect(d).not.toBe(N)
      expect(validateIndianMobile(d)).toBe(d)
    }
  })
})

describe('line format (plan 3.5): name, then trailing number', () => {
  it('splits the approved help example shape "name, number"', () => {
    const [e] = entriesOf(`Suresh Kumar, ${N}`)
    expect(e).toMatchObject({ accepted: true, name: 'Suresh Kumar', number: N })
  })

  it('splits "name number" with no comma', () => {
    const [e] = entriesOf(`Suresh Kumar ${N}`)
    expect(e).toMatchObject({ accepted: true, name: 'Suresh Kumar', number: N })
  })

  it('the number is the TRAILING run of digits, +, spaces, hyphens, parentheses', () => {
    const [e] = entriesOf(`Suresh 2, ${boundaryAcceptedForms()[1]}`)
    expect(e).toMatchObject({ accepted: true, name: 'Suresh 2', number: N })
  })

  it('normalises every accepted number to the stored form', () => {
    for (const form of boundaryAcceptedForms()) {
      if (form.trim() === '') continue
      const [e] = entriesOf(`Ravi, ${form}`)
      expect(e.accepted, `form ${JSON.stringify(form)}`).toBe(true)
      expect(e.number).toBe(N)
    }
  })

  it('ignores blank and whitespace-only lines, and handles CRLF', () => {
    const entries = entriesOf(`\n  \nRavi, ${N}\r\n\r\n\t\n`)
    expect(entries).toHaveLength(1)
    expect(entries[0].name).toBe('Ravi')
  })

  it('keeps the line exactly as pasted', () => {
    const line = `  Ravi ,  ${boundaryAcceptedForms()[1]}  `
    const [e] = entriesOf(line)
    expect(e.line).toBe(line)
  })

  it('keeps the input order', () => {
    const a = boundaryDerivedNumber(1)
    const b = boundaryDerivedNumber(2)
    const entries = entriesOf(`Zed, ${b}\nAmy, ${a}`)
    expect(entries.map((e) => e.name)).toEqual(['Zed', 'Amy'])
  })

  // The plan says only "name = the rest, trimmed"; the parser also drops a
  // separator left at the end of the name (parse-roster.ts, splitLine) so the
  // approved "name, number" help example parses. The comma is covered above;
  // these two cover the other separators the regex strips.
  it('drops a trailing semicolon from the name', () => {
    const [e] = entriesOf(`Suresh Kumar; ${N}`)
    expect(e).toMatchObject({ accepted: true, name: 'Suresh Kumar', number: N })
  })

  it('drops a trailing colon from the name', () => {
    const [e] = entriesOf(`Suresh Kumar: ${N}`)
    expect(e).toMatchObject({ accepted: true, name: 'Suresh Kumar', number: N })
  })
})

describe('R1-R4 rejections', () => {
  it('R1 no name: a line that is only a number', () => {
    const [e] = entriesOf(N)
    expect(e).toMatchObject({ accepted: false, reason: 'no_name' })
  })

  it('R1 no name: a comma and a number', () => {
    const [e] = entriesOf(`, ${N}`)
    expect(e).toMatchObject({ accepted: false, reason: 'no_name' })
  })

  it('R2 name over the cap: 101 characters rejected, 100 accepted', () => {
    expect(MAX_NAME_LENGTH).toBe(100)
    const ok = entriesOf(`${'a'.repeat(100)}, ${N}`)[0]
    expect(ok.accepted).toBe(true)
    const long = entriesOf(`${'a'.repeat(101)}, ${N}`)[0]
    expect(long).toMatchObject({ accepted: false, reason: 'name_too_long' })
  })

  it('R2 counts characters (code points), as the SQL char_length does', () => {
    const hundredEmoji = '\u{1F477}'.repeat(100)
    expect(entriesOf(`${hundredEmoji}, ${N}`)[0].accepted).toBe(true)
    expect(entriesOf(`${hundredEmoji}\u{1F477}, ${N}`)[0]).toMatchObject({ reason: 'name_too_long' })
  })

  it('R3 bad number: shown exactly as pasted, other rows still parse', () => {
    const entries = entriesOf(`Ravi, 12345\nAmy, ${N}`)
    expect(entries[0]).toMatchObject({ accepted: false, reason: 'bad_number', number: '12345' })
    expect(entries[1]).toMatchObject({ accepted: true, number: N })
  })

  it('R3 bad number: a name with no number at all', () => {
    const [e] = entriesOf('Ravi Kumar')
    expect(e).toMatchObject({ accepted: false, reason: 'bad_number' })
  })

  it('R3 bad number: letters inside the number', () => {
    const [e] = entriesOf(`Ravi, ${N.slice(0, 8)}ab${N.slice(10)}`)
    expect(e).toMatchObject({ accepted: false, reason: 'bad_number' })
  })

  it('R4 duplicate in paste: the SECOND occurrence is rejected, the first stays', () => {
    const entries = entriesOf(`Ravi, ${N}\nAmy, ${boundaryAcceptedForms()[7]}`)
    expect(entries[0]).toMatchObject({ accepted: true })
    expect(entries[1]).toMatchObject({ accepted: false, reason: 'duplicate_in_paste' })
  })

  it('R4 does not count a bad-number row as an earlier occurrence', () => {
    const entries = entriesOf(`Ravi, ${N.slice(0, 9)}\nAmy, ${N}`)
    expect(entries[0]).toMatchObject({ reason: 'bad_number' })
    expect(entries[1]).toMatchObject({ accepted: true })
  })

  it('reports the first problem in R1, R2, R3, R4 order', () => {
    // no name AND a bad number -> R1 wins
    expect(entriesOf('12345')[0]).toMatchObject({ reason: 'no_name' })
    // name too long AND a bad number -> R2 wins
    expect(entriesOf(`${'a'.repeat(101)}, 12345`)[0]).toMatchObject({ reason: 'name_too_long' })
    // bad number AND a duplicate can't both hold: a bad number is never a duplicate
    expect(entriesOf(`Ravi, 12345`)[0]).toMatchObject({ reason: 'bad_number' })
  })
})

describe('paste-level limits', () => {
  it('empty and whitespace-only pastes are refused as empty', () => {
    expect(parseRoster('')).toEqual({ ok: false, error: 'empty' })
    expect(parseRoster('  \n\t\n \r\n')).toEqual({ ok: false, error: 'empty' })
  })

  it('50 non-blank lines are accepted, 51 are refused; blank lines do not count', () => {
    expect(MAX_LINES).toBe(50)
    const line = (i: number) => `P${i}, ${boundaryDerivedNumber(1 + (i % 8))}`
    const fifty = Array.from({ length: 50 }, (_, i) => line(i)).join('\n\n')
    const r50 = parseRoster(fifty)
    expect(r50.ok).toBe(true)
    if (r50.ok) expect(r50.entries).toHaveLength(50)
    const fiftyOne = Array.from({ length: 51 }, (_, i) => line(i)).join('\n')
    expect(parseRoster(fiftyOne)).toEqual({ ok: false, error: 'too_many_lines' })
  })
})
