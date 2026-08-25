# Equipment parser: no machine count is ever recordable — record only, not fixed

**Status: OPEN. Recorded here so the defect has one place, not two scattered
incidents.** Two live production check-ins now demonstrate the same
mechanism from two different angles. No fix proposed or attempted in this
pass.

## The mechanism, from the code itself

`parseChunk`, `lib/whatsapp/flows/parsers/equipment.ts:40-73`:

```ts
function parseChunk(chunk: string): EquipmentItem | null {
  const tokens = splitDigitBoundaries(chunk.toLowerCase())
    .split(/\s+/)
    .filter(Boolean)

  let keyword: string | null = null
  let cost: number | null = null
  let firstNameWord: string | null = null

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      // First number in the chunk is taken as the daily hire rate — the field
      // gives rates ("JCB 1500"), not counts. count stays null.
      if (cost === null) cost = parseInt(t, 10)
      continue
    }
    const kw = canonicalEquipment(t)
    if (kw && keyword === null) keyword = kw
    if (firstNameWord === null && !RATE_STOPWORDS.has(t)) firstNameWord = t
  }

  const hasNumber = cost !== null
  // No known machine AND no number -> we cannot confidently call this equipment.
  if (keyword === null && !hasNumber) return null

  const type = keyword ?? firstNameWord ?? 'equipment'
  return {
    type,
    count: null,
    owned_or_hired: detectTenure(tokens),
    daily_hire_cost: cost,
    raw: chunk.trim(),
  }
}
```

Two facts, both load-bearing, both visible directly in this function:

1. **`count: null` is hardcoded, unconditionally, on every return.** There
   is no code path in this function — none — that ever sets `count` to
   anything else. This is not a parsing failure on hard inputs; it is the
   function's designed behaviour on every input.
2. **The FIRST numeric token encountered in the chunk becomes
   `daily_hire_cost`; every subsequent number is discarded** (`if (cost ===
   null) cost = parseInt(t, 10)` — the guard only ever fires once per
   chunk). The comment above it states the assumption plainly: "the field
   gives rates... not counts." That assumption is not always true.

## Consequence, stated plainly

**There is no way to record how many of a machine are on site.** "2 JCBs"
is unrepresentable by this parser's design — not a bug in recognizing "2"
as a count, but the absence of any code path that could store a count at
all. And because the FIRST number in a chunk is always taken as the rate,
**any answer that gives a count before a rate silently stores the count AS
the rate** — the two failure shapes are the same mechanism, not two
separate defects.

## Two live incidents — same mechanism, different symptoms

### 2026-08-21 — vocabulary miss, rate correct

Engineer answer: `"Cement micsur 1000"` ("micsur" — a typo for "mixer").
Neither `"cement"` nor `"micsur"` matches a lexicon entry (`canonicalEquipment`
returns `null` for both — "micsur" isn't a recognised spelling, and
"cement" was never in the equipment lexicon to begin with). `keyword` stays
`null`; `firstNameWord` falls to the first non-stopword token, `"cement"`.
Result: `type: "cement"` (a positional fallback, not a real machine),
`daily_hire_cost: 1000` (correct, by coincidence — the chunk had exactly
one number). Rendered in a real DPR as **"Cement, ₹1000/day"** — a
fabricated equipment line, sourced from `design-decisions-beta-feedback.md`
§28(aa)(2).

### 2026-08-25 — vocabulary correct, rate defect exposed

Engineer answer: `"Cement mixer - 1 1000"` (a real production check-in,
first live use of the migration-030 RPC — full record:
`docs/reviews/030-apply-record.md`). `"mixer"` DOES match the lexicon
(`lib/whatsapp/flows/parsers/lexicon.ts:63`, `mixer: 'concrete_mixer'`);
`"cement"` still doesn't. `keyword` resolves correctly to `concrete_mixer`.
But the chunk carries TWO numbers — `1` then `1000` — and the first-number
rule takes `1` as `daily_hire_cost`, discarding `1000` entirely. Result:
`type: "concrete_mixer"` (correct), `daily_hire_cost: 1` (a stored Rs 1/day
mixer). Tonight's DPR will render a concrete mixer at **₹1/day** — the
engineer most likely meant a count of 1 mixer at ₹1000/day, but the parser
has no field to put "1" in except the rate it already filled.

## Why these are the SAME defect, not two

The 2026-08-21 incident could read as a vocabulary gap (fix the lexicon,
teach it "micsur") and the 2026-08-25 incident could read as an unrelated
new bug. **They are not separable that way.** In the 2026-08-25 check-in,
vocabulary worked correctly TWICE — `mixer` → `concrete_mixer` here, and
`barbender` → `bar_bender` in the same check-in's manpower answer
(`lib/whatsapp/flows/parsers/lexicon.ts:37`, `barbender: 'bar_bender'` —
confirmed live in `030-apply-record.md`'s GATE 1 section). Correct
vocabulary resolution did not prevent the rate corruption, because
vocabulary and numeric interpretation are two independent mechanisms in
this function, and only one of them has a lexicon to get right or wrong.
**The defect is numeric interpretation — no count field exists, and the
first number found is always claimed as the rate — not vocabulary.**
Fixing the lexicon (adding "micsur") would not have prevented the
2026-08-25 incident at all; the type resolved correctly there already.

## Not fixed here

No fix is proposed or attempted in this pass, per instruction. This
document exists so the defect is recorded with its real mechanism and both
pieces of live evidence in one place, for whoever picks up the fix next.
