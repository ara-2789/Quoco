import { normalisePhoneNumber } from '@/lib/whatsapp/normalise'

// The add-engineers paste parser (docs/plans/add-engineer-plan.md sections
// 3.3-3.5, 4 R1-R4). PURE: no I/O, no copy strings, no pluralisation -- it
// returns machine identifiers (reasons) and the component maps them to the
// approved wording in lib/engineers/copy.ts.
//
// WHY A VALIDATOR EXISTS AT ALL: normalisePhoneNumber never rejects anything
// ('abc' -> '+abc'), and no validator exists anywhere else in the repo, so
// this is the first write path that has to refuse a mistyped number before it
// is stored and permanently held under the global UNIQUE (plan 3.2).

export const MAX_LINES = 50
export const MAX_NAME_LENGTH = 100

export type RosterRejection =
  | 'no_name' // R1
  | 'name_too_long' // R2
  | 'bad_number' // R3
  | 'duplicate_in_paste' // R4

export type RosterEntry =
  | { accepted: true; line: string; name: string; number: string }
  // For a rejected entry `number` is the token as pasted, not a stored form.
  | { accepted: false; line: string; name: string; number: string; reason: RosterRejection }

export type ParseResult =
  | { ok: true; entries: RosterEntry[] }
  | { ok: false; error: 'empty' | 'too_many_lines' }

// The single stored form (plan 3.3): '+91', a digit 6-9, nine more digits.
const STORED_FORM = /^\+91[6-9][0-9]{9}$/

// V3 (plan 3.3): after removing whitespace, hyphens and parentheses the token
// must match exactly one of these four shapes.
const ACCEPTED_SHAPES = [
  /^\+91[6-9][0-9]{9}$/, // S1
  /^91[6-9][0-9]{9}$/, // S2
  /^0[6-9][0-9]{9}$/, // S3
  /^[6-9][0-9]{9}$/, // S4
]

// V1: only ASCII digits, '+', whitespace, '-', '(' and ')' -- the separators
// normalisePhoneNumber itself strips.
const CHARSET = /^[0-9+\s\-()]*$/

// Validate one raw number token and return the STORED form, or null. Validation
// happens BEFORE normalisation (plan 3.3); the normaliser is then asserted to
// land on the stored form AND to be a fixed point, so a future change to
// normalise.ts cannot silently store something else.
export function validateIndianMobile(raw: string): string | null {
  if (!CHARSET.test(raw)) return null
  const t = raw.replace(/[\s\-()]/g, '')
  if (!ACCEPTED_SHAPES.some((shape) => shape.test(t))) return null
  const stored = normalisePhoneNumber(raw)
  if (!STORED_FORM.test(stored)) return null
  if (normalisePhoneNumber(stored) !== stored) return null
  return stored
}

// Plan 3.5: number = the trailing run of digits, '+', spaces, hyphens and
// parentheses; name = the rest, trimmed. The approved format help example is
// "Suresh Kumar, +91...", so a separator left at the end of the name (a comma,
// semicolon or colon) is dropped as well -- a decision the plan does not state.
const TRAILING_NUMBER_RUN = /^(.*?)([0-9+\s\-()]*)$/

function splitLine(line: string): { name: string; token: string } {
  const match = TRAILING_NUMBER_RUN.exec(line)
  const prefix = match ? match[1] : line
  const token = match ? match[2].trim() : ''
  const name = prefix.replace(/[\s,;:]+$/, '').trim()
  return { name, token }
}

function codePointLength(s: string): number {
  return [...s].length
}

export function parseRoster(raw: string): ParseResult {
  const lines = raw.split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
  if (lines.length === 0) return { ok: false, error: 'empty' }
  if (lines.length > MAX_LINES) return { ok: false, error: 'too_many_lines' }

  const seen = new Set<string>()
  const entries: RosterEntry[] = []
  for (const line of lines) {
    const { name, token } = splitLine(line)
    const reject = (reason: RosterRejection): RosterEntry => ({
      accepted: false,
      line,
      name,
      number: token,
      reason,
    })

    // R1, R2, R3, R4 in that order: the first problem is the one reported.
    if (name === '') {
      entries.push(reject('no_name'))
      continue
    }
    if (codePointLength(name) > MAX_NAME_LENGTH) {
      entries.push(reject('name_too_long'))
      continue
    }
    const stored = validateIndianMobile(token)
    if (stored === null) {
      entries.push(reject('bad_number'))
      continue
    }
    if (seen.has(stored)) {
      entries.push({ accepted: false, line, name, number: stored, reason: 'duplicate_in_paste' })
      continue
    }
    seen.add(stored)
    entries.push({ accepted: true, line, name, number: stored })
  }
  return { ok: true, entries }
}
