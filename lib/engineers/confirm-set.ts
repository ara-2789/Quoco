// Confirm -> apply is a SET check, not a count (docs/plans/add-engineer-plan.md
// section 5.2, round-2 S3). A count check passes when the paste is edited
// between Confirm and Apply so that one number is swapped for another; the
// ticked attestation would then certify handsets the admin never saw.
//
// THREAT MODEL, stated so nobody reads more into it than is there (plan 5.2,
// rev13): the confirmed list travels from the client and is compared with a
// server re-parse of client-supplied text, so this catches ACCIDENTAL drift (a
// paste edited in another tab, a stale form) -- not a determined editor. It is
// an integrity check on the attestation, not a security control; authorisation
// and every classification re-run inside add_engineers_to_project.

// Sorted, element-for-element comparison of two lists of stored-form numbers.
// Plain string order; neither argument is mutated.
export function sameConfirmedSet(carried: readonly string[], reparsed: readonly string[]): boolean {
  if (carried.length !== reparsed.length) return false
  const a = [...carried].sort()
  const b = [...reparsed].sort()
  return a.every((n, i) => n === b[i])
}

const MAX_CARRIED = 50
const MAX_NUMBER_LENGTH = 64

// Hand validation of a hidden form field carrying a JSON array of numbers
// (no schema library in this repo -- add-engineer PR A, decision D-A7).
// Returns null for anything that is not an array of at most 50 short strings.
export function parseCarriedField(value: FormDataEntryValue | null | undefined): string[] | null {
  if (typeof value !== 'string') return null
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    return null
  }
  if (!Array.isArray(parsed) || parsed.length > MAX_CARRIED) return null
  const out: string[] = []
  for (const item of parsed) {
    if (typeof item !== 'string' || item.length > MAX_NUMBER_LENGTH) return null
    out.push(item)
  }
  return out
}
