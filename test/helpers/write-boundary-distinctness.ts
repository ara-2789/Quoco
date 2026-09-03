// §42's class, generalized: "an upstream distinction lost at the write
// boundary." It has now appeared TWICE inside artifacts that already
// passed review (the original manpower/equipment unmatched-token drop, and
// the idle-hours all_working/unknown collapse the reviewer's own finding
// just caught — §13.1). Reading a diff catches this inconsistently, by
// construction: the bug is an ABSENCE (a field never written), and an
// absence reads exactly like nothing was omitted at all.
//
// A WRITE-BOUNDARY DISTINCTNESS check catches it mechanically instead:
// take every semantically-distinct parser-output variant for one field,
// round-trip each through the REAL RPC, and assert the stored shapes are
// PAIRWISE DISTINCT. Two scenarios that are supposed to mean different
// things but produce byte-identical stored JSON is exactly the collapse
// this exists to catch — corpus-completeness (test/helpers/yesno-corpus.ts,
// test/helpers/section-42-corpus.ts) applied to the WRITE path instead of
// the parse path.
//
// THE ECHO-FIELD TRAP, the one thing that makes this check easy to get
// wrong: every scenario needs different input TEXT (that's what makes them
// different scenarios), so a naive full-object comparison would ALWAYS
// look "distinct" purely because `raw_text` differs -- completely missing
// a collapse in every OTHER field, which is exactly the bug this check
// exists to catch. `stripEcho` must be used before comparing, every time.

export interface DistinctnessCase {
  label: string
  shape: unknown
}

const ECHO_KEYS = new Set(['raw_text', 'raw'])

/** Remove echo/free-text fields that legitimately differ per scenario and
 * carry no semantic distinction of their own -- comparing WITH them would
 * make every case trivially "distinct" and defeat the check. RECURSIVE:
 * several §42 shapes carry a per-ITEM `raw` field nested inside an array
 * (equipment.ts's `EquipmentItem`, equipment-hours.ts's
 * `EquipmentHoursByTypeItem`), not just a top-level `raw_text` -- a
 * shallow strip would miss those and let per-item text differences leak
 * back into the comparison. Extend ECHO_KEYS if a new echo-style field is
 * added to a shape this helper is used against. */
export function stripEcho<T>(shape: T): T {
  if (Array.isArray(shape)) {
    return shape.map((item) => stripEcho(item)) as unknown as T
  }
  if (shape !== null && typeof shape === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(shape as Record<string, unknown>)) {
      if (ECHO_KEYS.has(key)) continue
      result[key] = stripEcho(value)
    }
    return result as T
  }
  return shape
}

/** Assert every case's (echo-stripped) shape is pairwise distinct from
 * every other case's. Throws naming the exact colliding pair and the
 * shared shape, so a failure is immediately actionable. */
export function assertPairwiseDistinct(cases: readonly DistinctnessCase[]): void {
  for (let i = 0; i < cases.length; i++) {
    for (let j = i + 1; j < cases.length; j++) {
      const a = JSON.stringify(cases[i].shape)
      const b = JSON.stringify(cases[j].shape)
      if (a === b) {
        throw new Error(
          `write-boundary distinctness violated: "${cases[i].label}" and "${cases[j].label}" ` +
            `produced IDENTICAL stored shapes (${a}) -- an upstream distinction was lost at the ` +
            `write boundary (§42's class, generalized).`,
        )
      }
    }
  }
}
