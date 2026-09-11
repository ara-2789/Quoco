# Quantities parser: "m2"/"m3" (standard Indian site shorthand for square/cubic metres) are mis-parsed on every report — OPEN, not fixed here

**Status: OPEN. Recorded so the defect has one place, not scattered across
a render-layer review.** Found 2026-09-11 during the DPR format redesign's
Stage 3 review, verifying a rendered sample against real prod data. Not
fixed here — this document exists so the fix, when it happens, has a
starting point, per this project's own convention (see
`docs/reviews/equipment-parser-count-gap.md` for the equipment-side sibling
of this exact failure class).

## The mechanism, from the code itself

`splitDigitBoundaries`, `lib/whatsapp/flows/parsers/quantities.ts:74-78`:

```ts
function splitDigitBoundaries(s: string): string {
  return s
    .replace(/(\d)(?!\.\d)(\D)/g, '$1 $2')
    .replace(/(\D)(?<!\d\.)(\d)/g, '$1 $2')
}
```

This runs on every chunk BEFORE unit recognition (`canonicalUnit`,
`lib/whatsapp/flows/parsers/lexicon.ts:227-229`) ever sees a token. It
unconditionally inserts a space at every digit↔non-digit boundary — with
no exception for a unit token that happens to end in a digit. `"100 m2"`
becomes `"100 m 2"` before tokenisation, i.e. three tokens: `100`, `m`,
`2` — never `m2` as one token.

`parseChunk`, same file, lines 89-145:
1. `100` → first number in the chunk → `quantity = 100`.
2. `m` → `canonicalUnit('m')` returns `'m'` (`lexicon.ts:211` — the alias
   table has `m: 'm'`, for plain metres) → `unit = 'm'`.
3. `2` → `quantity` is already set → **`numbers_discarded = true`, the `2`
   is dropped silently.**

Neither `m2` nor `m3` exists anywhere in `UNIT_ALIASES`
(`lexicon.ts:196-225`) — only the spelled-out forms (`sqm`, `sqmt`,
`sqmtr`, `cum`, `cbm`) and bare `m`/`km`. Adding them to the alias table
alone would not fix this either: `splitDigitBoundaries` already split
`m2` into two tokens before `canonicalUnit` is ever called on anything —
a compound alias can never be looked up as one token under the current
tokenisation order.

## This is the SAME defect this file's own comment already documents, one input pattern over

`QuantityItem.numbers_discarded`'s own doc comment (`quantities.ts:32-57`)
names the identical mechanism for `"M25"` (a concrete grade): tokenised
into `m` (matched as the unit alias) + `25` (discarded as a second
number), turning a grade designation into a fabricated "unit: m" reading.
`"100 m2"` hits the exact same code path for the exact same reason —
different surface symptom (a real, common Indian-English shorthand for
square metres, not a grade code), same root cause: digit-boundary
splitting runs before any unit token — compound or not — is ever checked
as a whole.

## Consequence, stated plainly

**Every DPR "Work completed" quantity suffix sourced from a `"<number>
m2"` or `"<number> m3"` free-text answer is wrong today** — the unit
silently downgrades from "square/cubic metres" to "metres" and the digit
that would have disambiguated it (the `2` or `3`) is discarded, not
stored anywhere, not flagged beyond the unsurfaced `numbers_discarded`
boolean (itself never read by any consumer — same gap this field's own
doc comment already names). `m2`/`m3` are standard, common Indian
construction-site shorthand for area/volume, not an edge case — this is
a live, everyday miswrite, not a rare malformed input.

## Confirmed live, real prod row

`daily_logs.id = b10a67fe-8335-46f8-9e5b-3eda8794a66e` (2026-09-05, Speed
Mechatronics): `evening_output = "Security Room - 100 m2"`,
`evening_output_quantities = {"items":[{"activity":"security room -",
"quantity":100,"raw":"Security Room - 100 m2","unit":"m",
"numbers_discarded":true}]}`. `numbers_discarded: true` is already stored
on this exact row, silently — proof this mechanism, not a hypothetical,
already fired on real production data.

## Not fixed here

Discovered while reviewing Stage 3 of the DPR format redesign
(`docs/plans/dpr-format-redesign.md`), which responded by dropping the
structured `done_quantity`/`unit` suffix from the "Work completed" render
line entirely (the free text already carries whatever number the engineer
gave, verbatim — a render-layer fix for that one consumer, not a parser
fix). This document exists because `parseQuantities` itself is still
wrong, and it feeds more than the DPR's own render line: the same
underlying `evening_output_quantities` value is stored regardless of
whether anything currently renders it. Fixing `splitDigitBoundaries` (or
adding a pre-check for compound unit tokens before digit-boundary
splitting runs) is real parser work with its own review round — not
bolted onto a format redesign.
