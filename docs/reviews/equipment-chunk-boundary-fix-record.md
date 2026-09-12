# Equipment chunk-boundary + echo fix — applied, with a correction and two related findings

Fixes the bug traced in the investigation-only PR (branch
`worktree-investigate-poclain-dumper-echo-bug`, not yet merged at time of
writing — this PR references it by branch since `docs/reviews/equipment-
chunk-boundary-poclain-dumper-gap.md` isn't on `main` yet): the real
2026-09-12 Speed Mechatronics/Vikram Rao incident where "Poclain" echoed
back as "Excavator" and "Dumper" was silently dropped entirely.

## Correction to the original investigation's §4 (downstream DPR consequence)

The original doc claimed tonight's DPR would show only "JCB" and
"Excavator," with no signal a third machine was ever mentioned, citing
`lib/dpr/assemble.ts` lines 265/288/668 (`equipmentLabel(item.type)` on the
structured `equipment.items[]` array) as the render path.

**That citation was the wrong function — `renderDpr`/`DprFacts`, which has
no call site anywhere outside `render.ts` itself (confirmed:
`grep -rn "renderDpr\b" lib/ app/ --include="*.ts"` matches only its own
definition and two unrelated comments in `generate.ts`). It is dead code
relative to the live dispatch path.** The function actually wired into
production (`lib/dpr/dispatch.ts:6,218` imports and calls
`renderEngineerReport`, which calls `renderEngineerBody`,
`lib/dpr/render.ts:653`) builds its MACHINE section entirely differently
(`render.ts:712-741`, comment "raw text, verbatim, no parsing (decision 6)"
— part of the 2026-09-11 DPR format redesign):

```ts
if (facts.equipment.machines_reported.status === 'reported' && facts.equipment.machines_reported.value !== null) {
  machine.push(`Machines reported: "${facts.equipment.machines_reported.value}"`)
}
if (facts.equipment.run_hours.status === 'reported' && facts.equipment.run_hours.value !== null) {
  machine.push(`Machine usage: "${facts.equipment.run_hours.value}"`)
}
```

`machines_reported` and `run_hours` are populated at `assemble.ts:681`
(`wrapText(row.morning_equipment?.raw_text ?? null)`) and its
`evening_equipment_utilisation.raw_text` counterpart — the **whole-answer
raw text, verbatim**, never the per-item canonical `type`. For the real
incident row, tonight's actual DPR MACHINE section reads:

```
MACHINE
Machines reported: "JCB 2, Poclain 1 Dumper 3"
Machine usage: "JCB 8 hours ,excavator 6 hours"
```

**The DPR was never affected by either half of this bug.** "Dumper 3" was
always visible to the PM/owner, verbatim, in the raw-text line — it was
only the WhatsApp Q4 echo shown BACK TO THE ENGINEER that lost it. This
corrects the original report's §4 outright rather than leaving a wrong
claim standing; per this project's own "session notes describe the past,
the repo describes the present" convention, the fix here is to state
plainly what the current live render path actually does, not what an
earlier, superseded render path (`renderDpr`) would have done.

## Fix 1 — echo shows the engineer's own word (approved wording: "raw word only")

`lib/whatsapp/flows/parsers/lexicon.ts` gains `rawEquipmentName(raw, canonicalType)`:
extracts the first non-digit, non-`RATE_STOPWORDS` token from an item's
stored `raw` text (digit-boundary split first, so `"JCB2"` still yields
`"JCB"`), falling back to `equipmentLabel(canonicalType)` when `raw` is
missing/empty or nothing survives. `EquipmentEchoItem` (`evening.ts`) gains
an OPTIONAL `raw?: string | null` field; `formatEquipmentEcho` now calls
`rawEquipmentName(item.raw, item.type)` instead of `equipmentLabel(item.type)`;
`fetchMorningEquipmentEcho` now selects and carries `raw` alongside `type`.

`raw` being optional (not required) means every existing caller/row that
predates this field — including `test/dispatch.test.ts`'s own
`seedMorningEquipmentForDispatch` helper, which seeds `{ type, count }` with
no `raw` at all — falls back to exactly the old canonical-label behaviour,
unchanged. Confirmed, not assumed: that integration test's own pinned
assertion (`reply.startsWith('Equipment you listed this morning: Concrete Mixer.')`)
passed with zero edits.

Real incident, after both fixes: the evening Q4 echo now reads **"Equipment
you listed this morning: JCB, Poclain, Dumper."** — three machines, the
engineer's own words, matching what he actually typed.

## Fix 2 — a chunk can now yield multiple items

`lib/whatsapp/flows/parsers/equipment.ts` and `equipment-hours.ts` (the
morning and evening equipment parsers — byte-identical vulnerability,
confirmed in the original investigation) both replace their single-item
`parseChunk` with: tokenize (now on ORIGINAL-CASE text, not pre-lowercased —
needed so a split segment's `raw` preserves the engineer's own casing for
Fix 1 to read back), find every token that resolves via `canonicalEquipment`,
and:

- **Fewer than 2 keyword tokens in the chunk** → exactly ONE segment, the
  whole chunk — byte-for-byte the pre-fix single-item logic. This is the
  regression-safety property the whole design leans on: single-keyword and
  zero-keyword chunks are not a separate code path, they're the `n<2` case
  of the same segmentation, so nothing about their behaviour could drift.
- **2 or more keyword tokens** → one segment per keyword, running from that
  keyword's own token up to (not including) the next keyword token; any
  tokens before the first keyword fold into segment 0. Each segment is
  parsed by the same single-item logic as before, now scoped to its own
  token range, and its `raw` is that segment's own tokens rejoined with a
  single space (not the whole original chunk).

For `"Poclain 1 Dumper 3"`: keyword tokens at `poclain`(0) and `dumper`(2).
Segment 0 = tokens[0:2] = `["Poclain","1"]` → `{type: 'excavator', count: 1,
raw: 'Poclain 1'}`. Segment 1 = tokens[2:4] = `["Dumper","3"]` → `{type:
'dumper', count: 3, raw: 'Dumper 3'}`. Two items, not one.

### Explicitly preserved (not broken) — the two named regression risks

- `"2 JCB 8"` (`equipment-hours-parser.test.ts`, the 2026-08-31 incident's
  own fix) — ONE keyword (`jcb`), so `keywordIndices.length < 2` and the
  whole chunk is one segment, same as before: the first number in the
  chunk (`2`, which comes BEFORE the keyword) still wins as `hours_used`.
  Confirmed green, unedited.
- `"4 hours per day"` (same file) — ZERO keyword tokens (`hours`/`per`/`day`
  all fail `canonicalEquipment`), one segment, same generic `'equipment'`
  fallback as before. Confirmed green, unedited.

## Tests — red then green

Added first, run red against the pre-fix code, then green after. Full
transcripts captured during the session; summarized here per-file:

- `test/unit/equipment-parser.test.ts`: 4 new cases (two multi-keyword
  cases matching the real incident text, one 3-keyword case, one explicit
  single-keyword regression guard). RED: 3 failed (the regression guard
  passed trivially, as intended — it isn't exercising new behaviour), 19
  passed. GREEN after the fix: 22/22.
- `test/unit/equipment-hours-parser.test.ts`: 3 new cases (one
  multi-keyword case, the two named regression guards for "2 JCB 8" and
  "4 hours per day"). RED: 1 failed (the multi-keyword case; both
  regression guards passed trivially, as intended), 12 passed. GREEN
  after: 13/13.
- `test/unit/equipment-label.test.ts`: 4 new cases for the echo wording
  (synonym-mapped raw word, the real 3-item incident string, a no-raw
  fallback guard, a digit-glued-to-name guard). RED: 2 failed (both
  showing "Excavator" instead of "Poclain" — exactly the bug), 24 passed.
  GREEN after: 26/26.

Full-suite result (`npx vitest run`, the project's own sequential,
fixture-shared run — a partial/reordered run of this suite is NOT valid
evidence here, see the note below): **1098 passed, 1 pre-existing failure
(`test/session-transition.test.ts` Test B — the documented, CLAUDE.md-
recorded local-sandbox concurrency limitation, unrelated to this change:
"CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY"), 1 todo.** No other
regressions. `tsc --noEmit`: clean.

**Methodology note, recorded so it isn't rediscovered as a false alarm
next time:** running a SUBSET of test files directly (e.g. just
`dispatch.test.ts` + `evening-flow.test.ts`, or `evening-flow.test.ts`
alone) produced spurious failures — a session outcome reading `'idle'`
where `'reask'` was expected, then a foreign-key violation during fixture
teardown — that did NOT reproduce in the full, sequentially-ordered run.
This suite's own config comment (`vitest.config.ts`: "Keep files sequential
so the shared test tenant / phone-prefix cleanup never overlaps across
files") already names why: fixtures are shared and order-dependent across
the WHOLE suite, not just within one file. Only `npx vitest run` (no path
filter) is valid evidence for this project's test-db-backed suite; a
filtered run's failure is not proof of a regression on its own.

## Report: labour.ts and idle-hours.ts — checked, NOT touched

Per instruction, scope stays at equipment.ts/equipment-hours.ts. Checked
whether the same missing-separator failure exists elsewhere; both other
parsers were read in full, not assumed from name-similarity alone.

**`labour.ts` does NOT have this bug — different architecture, immune by
construction.** It never chunks text into pieces and takes "the first
keyword/first number wins" per chunk. Instead it walks EVERY digit token in
the WHOLE answer and, for each one, looks at its own immediate neighbour
(`tokens[i-1]`/`tokens[i+1]`) for a trade word, tracking already-consumed
token indices (`consumedTradeTokens`) so one trade word can never be
double-attributed to two different numbers. Traced the exact example named
in the fix instructions, `"2 supervisor 20 helper"` — tokens `['2',
'supervisor', '20', 'helper']`: number `2` looks right, finds `supervisor`
(no known trade alias, so §42-captured unmatched, `{trade: 'supervisor',
planned_count: 2, matched: false}`); number `20` looks right, finds
`helper` (a known trade, not yet consumed), `{trade: 'helper',
planned_count: 20, matched: true}`. Both correctly attributed with zero
punctuation between them — this is exactly WHY it "parsed fine today," per
the instruction's own framing: the per-number-anchor design has no
"chunk" to collide inside in the first place.

**`idle-hours.ts` (`lib/whatsapp/flows/parsers/idle-hours.ts:94-128`) DOES
have the identical bug.** Its `parseChunk` is the same shape as
equipment.ts's pre-fix version — first digit wins, first `canonicalTrade`
match wins, everything else in the chunk discarded — and it uses the
byte-identical top-level split regex (`idle-hours.ts:143-146`,
`/[,\n;]|\band\b|\bplus\b/i`). A comma-less answer naming two trades, e.g.
`"mason 2 helper 3"`, collapses to ONE `by_trade` entry (`{trade: 'mason',
idle_hours: 2, matched: true}`), silently discarding `"helper 3"` — the
same failure shape, same root cause, same missing-comma trigger. **Not
fixed here** — flagging per instruction rather than widening scope without
asking. If this is worth the same treatment as equipment.ts/
equipment-hours.ts, it should be its own follow-up (own tests-first pass,
own red/green evidence) — the segmentation approach used here generalizes
directly (idle-hours.ts's `parseChunk` has the exact same three-piece
shape: tokenize, first-digit-wins, first-keyword-wins) but that is a
judgment call for a separate pass, not assumed here.
