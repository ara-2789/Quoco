// Digit-4 (material-inward capture) go-live switch. docs/plans/pr-c-plan.md section 4.
//
// DARK in C3: nothing outside this module's own tests calls isCaptureDigit4Live.
// C4 wires the digit-4 start branch to it; C6 flips the constant.

export const CAPTURE_DIGIT_4_LIVE = false

// E.164: "+" then 8-15 digits.
const E164 = /^\+\d{8,15}$/

/**
 * Parse CAPTURE_DIGIT4_TEST_PHONES strictly: comma-separated E.164, whitespace
 * around entries tolerated. ANY malformed entry (including an empty entry from
 * a stray comma) -> empty list, i.e. fail closed. Unset or blank -> empty list.
 */
export function parseCaptureTestPhones(raw: string | undefined): string[] {
  if (raw === undefined || raw.trim() === '') return []
  const entries = raw.split(',').map((e) => e.trim())
  if (!entries.every((e) => E164.test(e))) return []
  return entries
}

/** True only if the constant is on, or this phone is on the strict allowlist. */
export function isCaptureDigit4Live(phone: string): boolean {
  if (CAPTURE_DIGIT_4_LIVE) return true
  return parseCaptureTestPhones(process.env.CAPTURE_DIGIT4_TEST_PHONES).includes(phone)
}
