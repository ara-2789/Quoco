// Shared corpus for §42 (unmatched trade/equipment tokens are CAPTURED, not
// silently dropped) — migration 035's review round, finding 5. ONE corpus,
// referenced by every by-trade/by-type site §42 touches, so the TS-parser
// layer (test/unit/section-42-unmatched-capture.test.ts) and the post-RPC
// row-read-back layer (test/section-42-row-readback.test.ts) cannot
// silently diverge on what counts as "an unmatched token."
//
// Real-world motivation, not invented: docs/reviews/field-samples.md's own
// sample 1, "Civil - 25 Nos, P.EB - 11 Nos" — P.EB is a real site discipline
// this project's lexicon (lib/whatsapp/flows/parsers/lexicon.ts's
// TRADE_ALIASES) has never recognised. 'PEB' below drops the period — the
// tokenizer lowercases but does not strip punctuation, so "P.EB" and "PEB"
// are DIFFERENT tokens to every parser in this file; 'PEB' is used because
// it is also the exact literal the migration's own scaffold evidence
// (docs/reviews/035-evening-flow-review-package.md §4, §8) already used, and
// re-using it here rather than inventing a third spelling is deliberate.
//
// Each case documents what TODAY (pre-035, nothing in §11's PENDING list
// built yet) actually does with the unmatched token — the RED tests assert
// against that. Once a site's parser/mirror/SQL exists, the SAME case is
// reused to assert the target shape (matched:false, token preserved) rather
// than duplicated — a second corpus would be exactly the drift risk finding
// 8 (review round) was raised to prevent.

export interface UnmatchedTokenCase {
  site: 'manpower' | 'idle_hours' | 'equipment_hours'
  description: string
  input: string
  unmatchedToken: string
  // What SHOULD also be recognised in the same answer, so the case isn't
  // all-unmatched (that would exercise the garbled/reask path instead of
  // the mixed matched+unmatched path §42 is actually about).
  matchedToken: string
  matchedCount?: number
}

export const SECTION_42_CORPUS: readonly UnmatchedTokenCase[] = [
  {
    site: 'manpower',
    description:
      'field-samples.md sample 1 shape: a recognised trade plus an unrecognised discipline in one answer. Shared by morning Q2 and evening step 2 (both call parseLabourCount — 035_evening_flow_restructuring.sql header, "SAME field names as morning\'s p_manpower").',
    input: '25 mason 11 PEB',
    unmatchedToken: 'PEB',
    matchedToken: 'mason',
    matchedCount: 25,
  },
  {
    site: 'idle_hours',
    description:
      'evening step 3 (idle hours by trade) — a parser that does not exist yet in any form (review package §10, item 2). One trade recognised, one not.',
    input: 'mason idle 2 hours, PEB idle 3 hours',
    unmatchedToken: 'PEB',
    matchedToken: 'mason',
  },
  {
    site: 'equipment_hours',
    description:
      'evening step 4 (equipment, one number per type) — the target shape parseEquipmentHours does not produce yet (review package §10, item 3). "hydra" (common site slang for a mobile crane) is not in EQUIPMENT_ALIASES.',
    input: 'JCB 6 hours, hydra 4 hours',
    unmatchedToken: 'hydra',
    matchedToken: 'jcb',
  },
] as const
