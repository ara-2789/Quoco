// The ONE +91 number in test/ (add-engineer plan section 7.3, T21). Every other
// Indian-shaped number a test needs is DERIVED from this constant at runtime,
// by formatting or digit mutation only -- never written out as a second
// literal. Swappable in one edit: change the constant, nothing else moves.
//
// Every +91[6-9]... value is a routable live handset (plan section 3.6). The
// derived numbers are only ever fed to the read-only dry-run, to the parser,
// or to a refusal path -- never stored (docs/plans/add-engineer-plan.md U15).
export const TEST_BOUNDARY_PHONE_LITERAL = '+919176861156'

// The ten national digits: '9176861156'.
const NATIONAL = TEST_BOUNDARY_PHONE_LITERAL.slice(3)

function withDigitAt(digits: string, index: number, digit: string): string {
  return digits.slice(0, index) + digit + digits.slice(index + 1)
}

// Split the ten national digits as '91768 61156' for the spaced forms.
const SPACED = `${NATIONAL.slice(0, 5)} ${NATIONAL.slice(5)}`
const HYPHENATED = `${NATIONAL.slice(0, 5)}-${NATIONAL.slice(5)}`
const PLUS91 = '+' + '91'

// Forms plan section 3.3 says the validator must ACCEPT (S1..S4), every one
// derived from the boundary literal by formatting only.
export function boundaryAcceptedForms(): string[] {
  return [
    TEST_BOUNDARY_PHONE_LITERAL, // S1, bare
    `${PLUS91} ${SPACED}`, // S1, spaced
    `${PLUS91}-${HYPHENATED}`, // S1, hyphenated
    `(${PLUS91}) ${SPACED}`, // S1, bracketed country code
    `${PLUS91}(${NATIONAL.slice(0, 5)})${NATIONAL.slice(5)}`, // S1, bracketed group
    `91${NATIONAL}`, // S2, bare
    `91 ${SPACED}`, // S2, spaced
    `0${NATIONAL}`, // S3, bare
    `0 ${SPACED}`, // S3, spaced
    NATIONAL, // S4, bare
    SPACED, // S4, spaced
    HYPHENATED, // S4, hyphenated
    `  ${NATIONAL}  `, // S4, surrounding whitespace
    `(${NATIONAL.slice(0, 5)}) ${NATIONAL.slice(5)}`, // S4, bracketed
  ]
}

// Forms the validator must REJECT, each derived from the literal by mutation.
export function boundaryRejectedForms(): string[] {
  return [
    'abc',
    '',
    '   ',
    '+',
    `x${NATIONAL}`, // letter prefix
    `${NATIONAL}x`, // letter suffix
    NATIONAL.slice(0, 9), // too short
    `${NATIONAL}0`, // too long (11 national digits, not the 0-prefixed S3 shape)
    `${PLUS91}${NATIONAL}0`, // S1 plus an extra digit
    `${PLUS91}${withDigitAt(NATIONAL, 0, '5')}`, // first national digit outside [6-9]
    withDigitAt(NATIONAL, 0, '5'), // S4 with first digit outside [6-9]
    `00${PLUS91.slice(1)}${NATIONAL}`, // 00-prefixed form keeps its zeros
    `+1${NATIONAL}`, // other country code
    `++91${NATIONAL}`, // doubled plus
    `${PLUS91}${NATIONAL.slice(0, 5)}+${NATIONAL.slice(5)}`, // plus inside the digits
    `${PLUS91}${NATIONAL} ext 4`, // trailing text
  ]
}

// A valid Indian-shaped number that is NOT the boundary literal, made by
// changing the last two digits. offset 1..8 -> 8 distinct numbers. Read-only
// paths only (parser, dry-run, refusals).
export function boundaryDerivedNumber(offset: number): string {
  if (!Number.isInteger(offset) || offset < 1 || offset > 8) {
    throw new Error(`boundaryDerivedNumber: offset must be an integer 1..8, got ${offset}`)
  }
  const last2 = Number(NATIONAL.slice(8))
  const changed = String((last2 + offset) % 100).padStart(2, '0')
  return PLUS91 + NATIONAL.slice(0, 8) + changed
}
