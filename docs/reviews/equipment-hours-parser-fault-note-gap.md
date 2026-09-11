# Equipment-hours parser: a status/fault note's digit is stored as a usage-hours measurement — OPEN, not fixed here

**Status: OPEN. Recorded so the defect has one place, not scattered across
a review round.** Found 2026-09-11 during the DPR format redesign's review
round, investigating a reported risk that the SUMMARY sentence could invert
a reported fault note ("Pump breakdown 1 hr") into a usage claim ("pump was
used for 1 hour"). Not fixed here, per Aravind's own instruction — this
document exists so the fix, when it happens, has a starting point, matching
this project's own convention (see `docs/reviews/quantities-parser-m2-m3-
unit-gap.md` for the sibling failure on the quantities parser, and
`docs/reviews/equipment-parser-count-gap.md` for an earlier equipment-side
instance of the same broad class).

## The mechanism, from the code itself

`parseChunk`, `lib/whatsapp/flows/parsers/equipment-hours.ts:70-102`, on
the chunk `"Pump breakdown 1 hr"`:

1. `splitDigitBoundaries` + tokenise → `Pump`, `breakdown`, `1`, `hr`.
2. `Pump` → `canonicalEquipment('pump')` resolves to `'concrete_pump'`
   (`lexicon.ts:71`) → `matchedType = 'concrete_pump'`.
3. `breakdown` → not a digit, not a recognised equipment keyword, not in
   `RATE_STOPWORDS` or `HOURS_FILLER_WORDS` (`hours`, `hour`, `hrs`,
   `used`, `run`, `ran`, `today` — note `hr` alone and `breakdown` are
   BOTH absent from this list) → becomes `firstWord`, but is never used
   because `matchedType` is already set.
4. `1` → first bare digit token → `hours_used = 1`.
5. `hr` → discarded (not a filler word by exact match, but nothing reads
   it either way once `hours_used` is already set).

Result: `{ type: 'concrete_pump', hours_used: 1, matched: true, raw:
'Pump breakdown 1 hr' }`. The parser has **no concept that `breakdown`
governs the sentence's meaning** — it extracts the nearest bare-digit
token and attaches it to whatever equipment type it matched, regardless of
the word standing between them. `hours_used: 1` asserts the pump was USED
for one hour; what was actually reported is that it was BROKEN for one
hour — the opposite claim.

## Same defect class as the quantities parser, one field over

`docs/reviews/quantities-parser-m2-m3-unit-gap.md` names the mechanism
once already, on `"100 m2"`: grab the first number, attach it to whatever
unit/type token matched, discard everything else in the chunk that would
have disambiguated it. This is the identical shape, on a different parser
(`equipment-hours.ts`, not `quantities.ts`) and a different consequence
(a false measurement instead of a discarded digit) — the root cause is the
same: **the parser has no model of which surrounding words modify a
number's meaning**, only "is this token a digit" and "does this token
match a known keyword."

## Confirmed live, real prod row

`daily_logs.id = 70e387d3-7c11-4734-a3bb-3ceb154fa01c` (2026-09-11, Speed
Mechatronics, engineer Vikram Rao): `morning_equipment.raw_text =
"Concrete pump 1, Vibrator 3"`; `evening_equipment_utilisation`:

```json
{
  "confidence": "high",
  "raw_text": "Pump breakdown 1 hr",
  "items": [
    { "type": "concrete_pump", "hours_used": 1, "matched": true,
      "implausible": false, "raw": "Pump breakdown 1 hr" },
    { "type": "vibrator", "hours_used": null, "matched": true,
      "implausible": null, "raw": null }
  ]
}
```

The vibrator entry is NOT a bug — it is migration 035's own Case B (a
morning-listed machine the evening text never mentions at all), correctly
recorded as `hours_used: null`/`raw: null`. Only the concrete_pump entry
is wrong: a status note describing DOWNTIME was stored as a usage-hours
FACT.

## Reaches the model's SUMMARY prompt today — this is the live part of the finding

The render-layer text (render.ts's MACHINE section, `Machine usage: "..."`)
reads `facts.equipment.run_hours` — the RAW text field, verbatim,
unaffected by this bug; the owner-facing rendered report already shows
"Pump breakdown 1 hr" correctly, unchanged by this note.

The SUMMARY-generation prompt is a SEPARATE path and IS affected:
`assemble.ts:655` maps `evening_equipment_utilisation.items[].hours_used`
straight into `EngineerDprFacts.equipment.items[].actual_hours` with no
transformation, and `generate.ts`'s `formatEngineerFacts` loops
`facts.equipment.items` and emits `Equipment concrete_pump — used 1h` as a
stated Fact line (not "context only" — `implausible` is `false`, since 1
does not exceed migration 035's own >24h flag threshold). Under
`ENGINEER_SYSTEM_PROMPT`'s existing digit-citation rule ("You may cite a
digit ONLY if it appears in a line stated as a Fact above"), the model is
explicitly permitted to restate that "1" as a usage duration — this is a
live path for the exact inversion risk this round's review set out to
check, via the OLD itemized `items[]`/`actual_hours` field, not the raw
`machines_reported`/`run_hours` text originally suspected.

The 2026-09-11 prompt addition (`ENGINEER_SYSTEM_PROMPT`'s new "Restate
only what a Fact literally says" sentence) is a real, if partial,
mitigation here — it instructs the model not to reword "Pump breakdown 1
hr" as "the pump was used," even though the Fact line handed to it already
says `used 1h`. It does not fix the underlying data: the Fact line itself
is still wrong, the prompt sentence just asks the model not to compound
that error into a further mischaracterisation. A model that follows the
instruction imperfectly, or a future prompt change that drops the
sentence, would have nothing else standing between this parser bug and an
owner-facing sentence claiming equipment usage that never happened.

## Not fixed here

Options, for a future dedicated parser review (not decided here):
- Extend `HOURS_FILLER_WORDS`-style logic into a small STOP-WORD set of
  fault/status words (`breakdown`, `broke`, `damage`, `repair`, `issue`,
  ...) that, when present in a chunk, either drop the number entirely or
  route it to a distinct field/flag ("downtime" rather than "hours_used")
  instead of `hours_used`.
- Same shape as `implausible` (migration 035, SQL-side): add a SQL-side or
  TS-side heuristic flag (not a silent rejection, per this parser's own
  "no arithmetic guard, on purpose" design principle from the 2026-08-31
  incident) that marks an item as "possible fault/status language,
  hours_used may not mean usage" for a downstream consumer (prompt
  formatter, render layer, PM dashboard) to treat differently.
- Broader: this parser and the quantities parser share the identical
  underlying shape (grab a digit, attach it to whatever keyword matched,
  discard the rest) — a shared review round covering both, rather than two
  separate point fixes, may be the right scope once someone picks this up.

This is real parser work with its own review round, shared by several
capture paths — not bolted onto this format-redesign round.
