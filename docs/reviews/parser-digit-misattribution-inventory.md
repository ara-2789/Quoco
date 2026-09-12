# Parser digit-misattribution: inventory across lib/whatsapp/flows/parsers/ — OPEN, not fixed here

**Status: OPEN.** Written 2026-09-12, a research pass following two confirmed
live bugs (`docs/reviews/equipment-hours-parser-fault-note-gap.md`,
`docs/reviews/quantities-parser-m2-m3-unit-gap.md`) found independently, one
day apart, in the same DPR-format-redesign review. This document exists
because two found by accident, in the same session, strongly suggested more
existed — confirmed below. No parser code is changed here; this is the
survey that precedes the fix (Aravind's decision: Option C, porting
`productivity.ts`'s anchor-word pairing — see the last section).

## The shared mechanism

Both confirmed bugs reduce to the same one-sentence defect: **the parser
attaches the nearest bare-digit token to whatever keyword/unit it has
already matched, with no model of which surrounding word governs what that
number actually measures.** `"Pump breakdown 1 hr"` → `breakdown` is
silently dropped, `1` becomes `hours_used` (a claimed USAGE duration, when
the report was of DOWNTIME). `"100 m2"` → digit-boundary splitting turns
`m2` into `m` + `2` before unit-matching ever runs, so `m` (bare metres)
matches first and the `2` that would have made it `sqm` is treated as a
second, discardable number.

`equipment-hours.ts`, `parseChunk` (lines 70-102), the clean instance of the
skeleton:

```ts
function parseChunk(chunk: string): EquipmentHoursItem | null {
  const tokens = splitDigitBoundaries(chunk).split(/\s+/).filter(Boolean)
  let hours_used: number | null = null
  let matchedType: string | null = null
  let firstWord: string | null = null

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      if (hours_used === null) hours_used = parseInt(t, 10)
      continue
    }
    const kw = canonicalEquipment(t)
    if (kw && matchedType === null) { matchedType = kw; continue }
    const lower = t.toLowerCase()
    if (firstWord === null && /\p{L}/u.test(t) && !RATE_STOPWORDS.has(lower) && !HOURS_FILLER_WORDS.has(lower)) {
      firstWord = t
    }
  }
  if (hours_used === null) return null
  const type = matchedType ?? firstWord ?? 'equipment'
  return { type, hours_used, matched: matchedType !== null, raw: chunk.trim() }
}
```

`quantities.ts`, the unit-matching half of `parseChunk` (lines 74-78,
112-131) — same shape, applied to units instead of trades/equipment:

```ts
function splitDigitBoundaries(s: string): string {
  return s
    .replace(/(\d)(?!\.\d)(\D)/g, '$1 $2')
    .replace(/(\D)(?<!\d\.)(\d)/g, '$1 $2')
}
...
    if (/^\d+(\.\d+)?$/.test(t)) {
      if (quantity === null) { quantity = parseFloat(t) } else { numbers_discarded = true }
      continue
    }
    const u = canonicalUnit(t)
    if (u && unit === null) { unit = u; continue }
```

## Full inventory — all 7 files in the directory

`lexicon.ts` is pure lookup tables (`canonicalEquipment`/`canonicalTrade`/
`canonicalUnit`/`classifyYesNo`/sentinel checks) with no digit-grabbing
logic of its own — not in scope. The other six:

| File | Same shape? | Notes |
|---|---|---|
| `equipment-hours.ts` | **Yes — confirmed live** | `docs/reviews/equipment-hours-parser-fault-note-gap.md`. Real prod row, 2026-09-11: `"Pump breakdown 1 hr"` → `hours_used: 1`. |
| `quantities.ts` | **Yes — confirmed live** | `docs/reviews/quantities-parser-m2-m3-unit-gap.md`. Real prod row, 2026-09-05: `"Security Room - 100 m2"` → `unit: "m"`, `numbers_discarded: true` (verified directly, `npx tsx`: `parseQuantities('100 m2')` returns `{quantity: 100, unit: 'm', numbers_discarded: true, ...}`). CORRECTION to this document's own first draft: the flag DOES fire here — digit-boundary splitting turns `m2` into two tokens, `100` and the trailing `2` genuinely IS a second bare-digit token, tripping the existing guard exactly as designed. **The gap is not that the flag fails to fire — it's that nothing downstream reads it** (the field's own doc comment: "NOT YET surfaced as a stored confidence field... nothing renders or reasons about it yet"), **and that the flag, even read, would only say "a number was dropped," not "your unit is wrong."** The real defect is the unit itself: `canonicalUnit('m')` resolves to bare metres before the compound token `m2` is ever given a chance to be recognised as one thing — that part of the failure has no discard flag protecting it at all. |
| `idle-hours.ts` | **Yes — same code shape, not yet confirmed on a real message, MOST EXPOSED** | `parseChunk` (lines 94-128) is near-identical to `equipment-hours.ts`'s: first digit → `idle_hours`, first `canonicalTrade` match → trade, everything else discarded via a small filler-word set (`idle`,`hours`,`hour`,`hrs`,`for`,`was`,`were`,`is`,`are`,`a`,`an`,`the`,`team`,`today` — no status word like `late`, `absent`, `left`). No discard flag exists here at all. The evening question invites exactly this failure: `"Was anyone idle today? ... e.g. 'mason idle 2 hours'"` — an answer like `"Mason left early 2 hours"` (describing an early departure, not idleness) parses to `{trade: mason, idle_hours: 2, matched: true}` with no less confidence than a real idle report. See "Consumer trace" below for why this is the most exposed of the four, not merely an equally-likely one. |
| `equipment.ts` | **Partially — same mechanism, narrower current exposure** | `parseChunk` (lines 52-85) grabs the first digit as `count` unconditionally. `docs/reviews/equipment-parser-count-gap.md`'s SUPERSEDED finding was about this SAME code, before Q3 was redefined from "rate" to "count" semantics (§33) — that specific rate/count ambiguity is dissolved, but the underlying "first digit, ignore the rest" mechanism it's built on is untouched. `"JCB down for 2 days"` → `count: 2`, read as "2 JCBs on site." Current exposure is narrow only because nothing downstream reads `.count` today (see below) — the parser-level defect is live, the consumption path is not. |
| `labour.ts` | **No — different mechanism, already-known and already-mitigated risk** | Sums every digit found and separately attributes each to its nearest unclaimed trade word, with real anti-double-counting (`consumedTradeTokens`). Its risk is different in kind: any number in the message, regardless of referent, adds to `planned_total`. Already the documented "113 fabrication" incident; already mitigated downstream (`assemble.ts` reads `.raw_text` only, never `.total`/`.by_trade`). Out of scope for the port per Aravind's own instruction — do not widen unless the port makes it trivial. |
| `productivity.ts` | **No — already solved this exact class, then orphaned** | See the dedicated section below — this is the most important entry in this table. |

## Consumer trace — what each parser's misparse reaches

Traced through `lib/dpr/assemble.ts`, the only place any of these six JSONB
columns are read anywhere in the app (grepped: `app/` has zero references
to any of them; `lib/daily-logs/correction.ts`'s `COLUMN_CONTRACT` — the
full DASH-03 dashboard whitelist, verified byte-for-byte against the live
RPC by its own test — exposes only 9 scalar text/boolean/integer columns,
none of these six JSONB fields among them).

| Parser | Field stored on misparse | `EngineerDprFacts`? | Rendered report? | Model SUMMARY prompt, as a citable Fact? |
|---|---|---|---|---|
| `idle-hours.ts` | `by_trade[].idle_hours` | Yes — `assemble.ts:623-625`, direct from `.by_trade`, filtered `>0` | **Yes** — RESOURCE section, `Idle hours: {trade} idle {n} hours.` | **Yes.** `formatEngineerFacts`: `Idle hours, {trade}: {n}h` — a Fact line, and `ENGINEER_SYSTEM_PROMPT` explicitly permits stating idle hours as fact ("You may state that idle hours were reported"). |
| `equipment-hours.ts` | `items[].hours_used` | Yes — `assemble.ts:655`, `actual_hours = wrapNumber(hours_used, ...)`, no transform | No (render.ts's MACHINE section reads the separate raw-text field `run_hours`, unaffected) | **Yes.** `Equipment {type} — used {actual_hours}h`, cited whenever `implausible` is false. |
| `quantities.ts` | `items[0].quantity`/`.unit` | Yes — `assemble.ts:589-590` | No (Stage 3 of the DPR redesign dropped the quantity/unit render suffix) | **Yes, still live.** `Work — done: {text}, {qty} {unit}` — a Fact line. Doesn't put a wrong digit in front of the model; puts a wrong UNIT next to a correct digit ("100 m" instead of "100 sqm"). |
| `equipment.ts` (count) | `items[].count` | **No** — `assemble.ts`'s narrowed type for `morning_equipment.items` is `{ type: string; daily_hire_cost: number | null }`; `count` isn't declared in the type the DPR pipeline reads and nothing references `.count` | No | No |

**`idle-hours.ts` is the most exposed of the four, not merely equally
likely to misfire:** it is the ONLY one of the four that reaches BOTH the
owner-facing rendered report body AND the model's citable Fact set,
combined with having zero discard/confidence mechanism of any kind. It has
not produced a confirmed incident yet purely because nobody has happened to
answer the idle-hours question with a status word instead of an idleness
report — the question's own example phrasing ("mason idle 2 hours")
practically invites the failure shape once someone answers a different but
structurally identical way ("mason left early 2 hours").

## Blast radius

- **No SQL mirror exists for any of these parsers' digit-extraction logic.**
  `apply_morning_flow_turn`/`apply_evening_flow_turn` receive `p_manpower`/
  `p_equipment`/etc. as already-parsed JSONB parameters computed by
  TypeScript before the RPC call; the SQL only reshapes/stores them. Unlike
  `classifyYesNo`, which has a genuine independent SQL reimplementation
  (`quoco_classify_yes_no`, requiring `yesno-mirror.test.ts`),
  `morning-flow-mirror.test.ts`'s "SQL vs TS" tests check state-machine/
  step-transition agreement given the SAME TS-computed parse — not a second
  parsing implementation. **A fix to the parsing algorithm itself carries no
  SQL-mirror divergence risk.**
- **Consequence: a fix is pure TypeScript. No migration file, no
  `supabase/migrations/` entry.** CLAUDE.md §0's external-review-gate
  conditions (a)-(e) are all about migrations (function logic, grants,
  auth, destructive ops, money) — a parser fix trips none of them.
- **The one caution:** if a fix changes an `isXAnswered`-style gating
  boolean (`isIdleHoursAnswered`, `isEquipmentHoursAnswered`,
  `isEquipmentAnswered`), that boolean crosses into the RPC as a
  `p_..._ok` parameter and affects the reask-vs-advance decision — exercise
  the existing mirror tests deliberately if a fix touches these functions'
  return values, per CLAUDE.md's own state-loss-regression testing rule
  (§7).
- **No dashboard exposure.** Confirmed via `COLUMN_CONTRACT` above.
- **Existing test coverage, per file:** `equipment-hours-parser.test.ts`
  (10), `equipment-parser.test.ts` (12), `idle-hours-parser.test.ts` (10),
  `labour-parser.test.ts` (13), `productivity-parser.test.ts` (32),
  `quantities-parser.test.ts` (18). **None of the six test files pair a
  status/fault word with an adjacent number** — grepped for
  `breakdown`/`broken`/`damage`/`repair`/`absent`/`late`/`leave`; the only
  hits are unrelated (`idle-hours-parser.test.ts`'s `"late"` cases only
  check it is NOT a sentinel; `labour-parser.test.ts`'s "breakdown" is the
  English-word sense of a trade tally). A structural gap across the whole
  directory, not a case any existing test contradicts.

## `productivity.ts` already solved this class, and the fix was orphaned — the point most worth recording here

`productivity.ts` (evening Q4 step 2, "all productive, or any idle") hit
this EXACT defect class for real on 2026-08-10: an engineer answered "15
productive, 3 idle waiting for material" against a headcount of 18, the
pre-fix parser took the FIRST digit as `idle_count` unconditionally
(exactly today's `equipment-hours.ts`/`idle-hours.ts` mechanism), and the
RPC derived `productive_count = 18-15 = 3` — the two numbers exactly
inverted, reported as high-confidence, in the one section where labour cost
shows directly to an owner who acts on it.

The fix that shipped, over two review rounds (2026-08-10, then a follow-on
2026-08-12 external-review fix for a second ambiguity), is real,
substantial, and still in the file today:

- **Anchor-word pairing**: `idle`/`productive` are recognised anchors; a
  digit immediately BEFORE or AFTER either word is assigned to that anchor,
  regardless of message order.
- **BEFORE is confident, AFTER is a guess**: a BEFORE match (`"15
  productive"`) is trusted and stored. An AFTER match (`"productive 15"`)
  is treated as ambiguous — see the next point.
- **Weak matches are claimed, never stored**: an AFTER-only match consumes
  the digit (so a later pass can't silently misassign it) but does NOT
  populate `idle_count`/`productive_count` — it only sets
  `numbers_discarded`. A guess is accounted for, never promoted to fact.
- **`numbers_discarded` as the general structural backstop**: ANY digit
  this parser sees but cannot confidently place sets this flag,
  independent of anchor-word coverage — "it would have caught the original
  bug with zero anchor-word logic," per the file's own comment. The caller
  (`evening.ts`) downgrades confidence to `'low'` whenever this fires.
- **32 tests** — by far the deepest suite of any file in this directory,
  reflecting two real incidents and two review rounds.

**Then migration 035 (`035_evening_flow_restructuring.sql`) split the
evening flow's Q4 step 2 into two NEW questions — `labour.ts` (step 2,
headcount) and `idle-hours.ts` (step 3, idle hours by trade) — and
`productivity.ts` was never called again.** Grepped project-wide:
`parseProductivity` has exactly two references left in the whole
repository — its own file and its own test file. It is not imported by
`evening.ts`, `morning.ts`, or anything else. The restructuring replaced
the QUESTION SHAPE (one combined free-text answer → two separate,
structured questions) without anyone re-implementing the ANCHOR-WORD FIX
inside either replacement. `idle-hours.ts` — the direct successor to the
"idle" half of what `productivity.ts` used to handle — was written from
scratch with the plain "first digit wins" skeleton, the same one
`productivity.ts` itself used to have before 2026-08-10 taught this
codebase, expensively, that it doesn't work.

**This is the finding a future reader most needs and would not otherwise
find:** the fix exists, in this repository, already reviewed, already
tested, already proven against a real production inversion — it just isn't
wired to anything anymore. Porting `productivity.ts`'s pattern into the
parsers that need it (Aravind's decision, below) is not inventing a new
design; it is un-orphaning one this codebase already paid for once.

## Decision: Option C, port `productivity.ts`'s anchor-word pattern

Aravind's ruling (2026-09-12), choosing over the stop-word-list alternative
named in the original research pass: **"Option A's stop-word list narrows
the class without closing it — 'Pump conked out 1 hr' passes a list
containing 'breakdown'. Do not reinvent; port the validated pattern and
carry its comments across so the lessons travel with the code."**

**Priority order, per Aravind's own reasoning** (idle-hours.ts is the most
exposed per the consumer trace above — same skeleton, no discard flag,
reaches both the rendered body and the citable prompt Fact, and the
question wording invites the exact failure): **1. `idle-hours.ts` — 2.
`equipment-hours.ts` — 3. `quantities.ts` — 4. `equipment.ts`.**

Explicitly out of scope for this port: `labour.ts` (already mitigated
downstream, raw_text-only, per the 113 incident) and `equipment.ts`'s
`count` field's actual DPR-pipeline exposure (it doesn't reach the pipeline
today) — do not widen to either unless the port makes it trivial to include
them.

Next step, per Aravind's instruction: failing tests first, for each
affected parser, before any parser code changes — see
`test/unit/idle-hours-parser.test.ts`, `test/unit/equipment-hours-parser.test.ts`,
`test/unit/quantities-parser.test.ts`, `test/unit/equipment-parser.test.ts`
for the new cases demonstrating each defect against the current
(unfixed) implementation.

## Port progress

**1. `idle-hours.ts` — DONE (commit `7c643b0`, 2026-09-12).** Anchor-word
guard: a digit is trusted as `idle_hours` only when the literal word
"idle" appears in the same chunk. Adapted, not copied verbatim — no
BEFORE/AFTER positional scan (this parser already chunks the input, so
"is the anchor present in this chunk" is the faithful equivalent at that
scope) and, more importantly, NO port of productivity.ts's "lone
unanchored number defaults to idle" fallback — porting that specific piece
would have silently readmitted the exact bug this fix closes, since
"Mason left early 2 hours" is itself a lone unanchored number.

**DELIBERATE COMPLETION-RATE COST, recorded per Aravind's own instruction
(2026-09-12, approving this port).** A bare "mason 2" (trade + digit, no
"idle" anchor anywhere) now returns `null` instead of a confident item.
When every chunk in an answer lacks the anchor, `isIdleHoursAnswered()`
flips from `true` to `false`, which crosses into `evening.ts`'s
`p_parse_ok['3']` and changes the RPC's reask-vs-advance decision for that
turn — a previously-silent (and possibly wrong) accept becomes an explicit
reask instead. **This is an accepted trade, not an incidental side effect:
a guess recorded as fact is worse than one more question.** Worth stating
plainly because completion rate is the binding constraint this product's
own six-question ceiling exists to protect (CLAUDE.md's own domain-reality
framing across these parsers' headers) — every parser in this port, not
only this one, may trade a small amount of completion rate for the
guarantee that what IS recorded is trustworthy. Track this cost across all
four ports, not just this one, as the port continues.

**2. `equipment-hours.ts` — PAUSED, needs a genuinely different approach,
not a straight port.** Investigated 2026-09-12. Unlike `idle-hours.ts`,
this parser's own existing test suite already treats bare, anchor-less
digit+equipment answers as CORRECTLY confident, by design — most directly,
`"2 JCB 8"` (the exact 2026-08-31 incident input the current design was
built to accept) has no unit word, no usage verb, nothing but two bare
digits and an equipment name, and is deliberately trusted. No candidate
positive anchor (a unit word like "hours"/"hr", a usage verb like
"used"/"ran"/"run", or the equipment keyword itself) both (a) rejects
"Pump breakdown 1 hr" and (b) preserves every existing confident-answer
test — the closest candidate that rejects the bug (requiring a usage verb)
also rejects 5 of 8 existing confident-answer tests. This file's own
header additionally states an already-decided, post-incident architectural
principle directly opposed to a refuse-to-store gate: "NO ARITHMETIC
GUARD, ON PURPOSE... Whatever number is reported is stored, exactly as
given... Implausibility is now a SQL-side FLAG... never a TS-side
rejection." Options reported to Aravind, not decided at time of writing:
(A) extend the anchor to usage verbs only, accepting a larger
completion-rate cost than idle-hours.ts's port; (B) don't gate at all —
add a confidence signal to `EquipmentHoursItem` instead (matching this
pipeline's own existing "flag, not gate" precedent, e.g. the `implausible`
field) and let a downstream consumer decide citability; (C) a scoped
blocklist for this file alone (Aravind's own earlier critique of stop-word
lists still applies). **SUPERSEDED by the 2026-09-12 AI-summary-removal
decision below before a choice was made** — see that section for why this
investigation, while still technically correct, no longer needs resolving
as a live bug.

**3–4, `quantities.ts` / `equipment.ts` — not yet reached** (paused at #2
per Aravind's own instruction to stop at the first parser needing a
different approach, before improvising).

## 2026-09-12 — the AI summary itself is being removed; re-derived exposure picture

Aravind's decision, made while #2 above was paused: remove the model-
generated SUMMARY sentence from the DPR entirely (separate work,
`lib/dpr/{generate,dispatch,render,render-email}.ts` — full disable-point
proposal reported separately, not yet applied). Rationale given: the
summary produced one factually inverted sentence (this exact "Pump
breakdown 1 hr" → "concrete pump used for 1 hour" case) and otherwise
restates the WORK/RESOURCE/MACHINE sections above it — a real reason to
question the whole apparatus, not only the parser bug that fed it a bad
Fact.

**This changes what "reaches the DPR" means for every parser in this
document, and was checked directly against the current render/prompt
code, not assumed:**

Once `generateEngineerVerdict`/`formatEngineerFacts` (the ONLY consumer of
`equipment.items[].actual_hours` and `work.done_quantity`/`.unit` as
citable Facts) stops being called at all, the sole remaining path from any
parsed number to anything an owner sees is `renderEngineerBody` (render.ts)
— traced section by section:

- **WORK** — `Morning plan`/`Work completed` read `planned_corrected`/
  `done_text_corrected` (free text). `done_quantity`/`.unit`
  (quantities.ts's parsed output) were already dropped from the render
  line in Stage 3 of the format redesign — confirmed, not re-derived.
  **quantities.ts's parsed numbers now reach NOTHING an owner sees.**
- **RESOURCE** — `Morning/Evening labour reported` read `.raw_text`
  (labour.ts), not `.total`/`.by_trade` — unaffected either way, already
  the case since the 113-incident fix. `Idle hours: ...` reads
  `facts.idle_hours_by_trade`, populated directly from
  `evening_idle_hours.by_trade` (idle-hours.ts's parsed output, filtered
  to `idle_hours > 0`) — **the ONE parsed-number path that still reaches
  the rendered report**, unaffected by the summary's removal.
- **MACHINE** — `Machines reported`/`Machine usage` read
  `machines_reported`/`run_hours` (raw text), never
  `equipment.items[].actual_hours`/`hours_used` (equipment-hours.ts's
  parsed output). **equipment-hours.ts's parsed numbers now reach NOTHING
  an owner sees** — their only live consumer was the prompt.
- `equipment.ts`'s `count` field already reached nothing (confirmed
  earlier in this document, unaffected either way — `assemble.ts`'s own
  narrowed type for `morning_equipment.items` never declares `count`).

**Confirms Aravind's own read exactly: `idle_hours_by_trade` (idle-hours.ts)
is the only one of the four parsers' structured numeric outputs left with
any real exposure once the summary is gone.** Consequence for this
document's own priority list:

- `idle-hours.ts` (already shipped, commit `7c643b0`) — **the fix that
  mattered.** Unaffected by the summary's removal; still the only parser
  whose output an owner still sees as a number, not just as raw text.
- `equipment-hours.ts` — drops from "confirmed live bug" to "cleanup,
  whenever." The paused #2 investigation above remains technically
  correct and worth finishing eventually (the parser still stores a wrong
  `hours_used` internally, in the DB), but it no longer reaches any
  owner-facing surface, so it no longer needs the same urgency the
  original review gave it.
- `quantities.ts` — same demotion. The m2/m3 bug is still real at the
  storage layer; it no longer reaches an owner-facing surface either way
  (Stage 3 already cut its render-layer path; the summary was its only
  other consumer).
- `equipment.ts` — unaffected, already lowest-priority, already zero DPR
  exposure before and after.

Not closed, not deleted from scope — recorded here as a re-prioritisation,
so whoever picks up #2/#3/#4 later starts from the right urgency, not the
2026-09-12 pre-summary-removal one.
