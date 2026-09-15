# Equipment parser: a second machine after a number, with no separating comma, is silently merged into the previous item — OPEN, not fixed here

**Status: OPEN. Investigation only, per explicit instruction — no fix, no
lexicon edit, until Aravind has seen this trace.** Found 2026-09-12, real
evening conversation, Speed Mechatronics, engineer Vikram Rao. Repo state
this trace is pinned against: `main @ a14b34c1285aa11d71bb7bbae49a386cd774e378`
(`git status --porcelain` empty at time of writing — working tree matched
this SHA exactly).

## 1. The raw stored row

`daily_logs.id = 8e06a1f1-3481-45b8-9f8b-410fc6548948` — project_id
`acef67fe-e775-439d-82b8-5b8526868d6d` (Speed Mechatronics), engineer_id
`3534756b-2a32-4b91-954b-0bab15c2dba1` (Vikram Rao, tenant
`adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0`), `log_date = 2026-09-12`. Queried
read-only via `supabase db query --linked -f <probe>.sql` against prod
(`jvxwqignooseazzmwhvl`), raw JSON, no paraphrase:

```json
"morning_equipment": {
  "items": [
    { "type": "jcb", "count": 2, "daily_hire_cost": null, "owned_or_hired": null, "raw": "JCB 2" },
    { "type": "excavator", "count": 1, "daily_hire_cost": null, "owned_or_hired": null, "raw": "Poclain 1 Dumper 3" }
  ],
  "none": false,
  "raw_text": "JCB 2, Poclain 1 Dumper 3"
}

"evening_equipment_utilisation": {
  "confidence": "high",
  "raw_text": "JCB 8 hours ,excavator 6 hours",
  "items": [
    { "type": "jcb", "hours_used": 8, "matched": true, "implausible": false, "raw": "JCB 8 hours" },
    { "type": "excavator", "hours_used": 6, "matched": true, "implausible": false, "raw": "excavator 6 hours" }
  ]
}
```

`morning_submitted_at`: 2026-09-12 04:16:24 UTC. `evening_submitted_at`:
2026-09-12 13:17:07 UTC. **Exactly what got stored for all three machines
the engineer named: `jcb` (count 2) is correct. `excavator` (count 1) is
the "Poclain" — a real machine, silently relabelled, with its true count
(1) preserved by accident. "Dumper 3" — a third, entirely distinct
machine — was never stored as an item at all.** It exists only as
trailing, unparsed text inside the excavator item's own `raw` field
(`"Poclain 1 Dumper 3"`) — not as a `type`, not as a `count`, nowhere a
downstream reader would find it as its own entry.

## 2. Trace (a): Poclain → Excavator

`lib/whatsapp/flows/parsers/lexicon.ts:56-77`:

```ts
const EQUIPMENT_ALIASES: Readonly<Record<string, string>> = {
  jcb: 'jcb',
  excavator: 'excavator',
  poclain: 'excavator',
  poklain: 'excavator',
  hitachi: 'excavator', // colloquial site name for a tracked excavator
  ...
  dumper: 'dumper',
  tipper: 'tipper',
  lorry: 'lorry',
}

export function canonicalEquipment(token: string): string | null {
  return EQUIPMENT_ALIASES[token.toLowerCase()] ?? null
}
```

**Yes, deliberate.** `poclain`/`poklain` → `'excavator'` (line 59-60) is a
documented, intentional synonym mapping — same shape as `hitachi` →
`'excavator'`, both commented as colloquial site names for the one
canonical machine type. Nothing here is a bug in the mapping itself:
Poclain genuinely is a brand name for a tracked excavator, on Indian sites
this is normal vocabulary, and collapsing it to one canonical `type` is
the correct design for grouping/counting/DPR aggregation.

**The bug is downstream of the mapping, in the echo.** The evening Q4
prompt is built from `daily_logs.morning_equipment` directly (not the RPC
— see the comment at `lib/whatsapp/flows/evening.ts:143-153`, a documented
fix for a separate 2026-09-03 incident where the RPC's own `equipment_echo`
field was permanently null):

`lib/whatsapp/flows/evening.ts:154-171`:

```ts
export interface EquipmentEchoItem {
  type: string
}

function formatEquipmentEcho(items: readonly EquipmentEchoItem[]): string {
  return items.map((item) => equipmentLabel(item.type)).join(', ')
}

export function buildEquipmentHoursPrompt(items: readonly EquipmentEchoItem[]): string {
  return (
    `Equipment you listed this morning: ${formatEquipmentEcho(items)}. ` +
    'How many *hours* was each used today? e.g. "JCB 6 hours, mixer 4 hours".'
  )
}
```

`lib/whatsapp/flows/evening.ts:238-256`, the fetch that feeds it:

```ts
async function fetchMorningEquipmentEcho(
  supabase: SupabaseClient,
  params: { projectId: string; userId: string; logDate: string },
): Promise<EquipmentEchoItem[]> {
  const { data, error } = await supabase
    .from('daily_logs')
    .select('morning_equipment')
    ...
  const morningEquipment = data?.morning_equipment as { items?: Array<{ type: string }> } | null
  return (morningEquipment?.items ?? []).map((item) => ({ type: item.type }))
}
```

`fetchMorningEquipmentEcho` extracts **only `{ type: item.type }`** — `raw`
is never even carried out of this function, let alone into the echo. The
echo is built by `equipmentLabel(item.type)` (`lexicon.ts:95-102`, a
generic humanizer: split canonical `type` on `_`, capitalize each word,
one override for `jcb`→`'JCB'`) — always the CANONICAL form, never the
engineer's own word. There is no code path anywhere in `evening.ts` that
reads `item.raw` when building the Q4 echo.

**Report:** the raw term (`"Poclain"`) does survive in the database — it's
right there in `morning_equipment.items[1].raw`. It just never reaches the
echo, because the echo function's own input type (`EquipmentEchoItem`,
line 154-156) only carries a `type` field — `raw` was designed out of the
echo path entirely, not merely dropped by an oversight at the call site.
Fixing this is a data-flow change (thread `raw` through
`fetchMorningEquipmentEcho` → `EquipmentEchoItem` → `formatEquipmentEcho`,
and decide what to show when an item has no distinct raw name, e.g. a
morning answer that used "excavator" itself) — not a lexicon edit, and
explicitly not touched here per instruction.

## 3. Trace (b): why "Dumper" was dropped — chunking failure, not a lexicon gap

**"Dumper" is in the lexicon.** `lexicon.ts:74`: `dumper: 'dumper'` (maps
to itself as its own canonical type). Confirmed no other file references
it: `grep -rli "dumper" ./lib` returns only `lexicon.ts`. This is **not**
a vocabulary gap — the word is fully recognised.

**It's a chunk-boundary failure.** The morning equipment parser
(`lib/whatsapp/flows/parsers/equipment.ts`) splits the raw answer into
chunks like this (`equipment.ts:96-99`):

```ts
const chunks = raw_text
  .split(/[,\n;]|\band\b|\bplus\b/i)
  .map((c) => c.trim())
  .filter(Boolean)
```

It splits **only** on comma, newline, semicolon, the literal word "and",
or the literal word "plus" — never on plain whitespace, and never on
encountering a second recognised equipment keyword inside what is
otherwise one chunk. The engineer's actual text, `"JCB 2, Poclain 1
Dumper 3"`, has exactly one comma, so this produces exactly two chunks:
`"JCB 2"` and `"Poclain 1 Dumper 3"`. The missing comma the task prompt
flagged is exactly right — a comma between "1" and "Dumper" would have
produced three correctly-split chunks.

Chunk 2, `"Poclain 1 Dumper 3"`, then goes through `parseChunk`
(`equipment.ts:52-85`):

```ts
function parseChunk(chunk: string): EquipmentItem | null {
  const tokens = splitDigitBoundaries(chunk.toLowerCase())
    .split(/\s+/)
    .filter(Boolean)

  let keyword: string | null = null
  let count: number | null = null
  let firstNameWord: string | null = null

  for (const t of tokens) {
    if (/^\d+$/.test(t)) {
      if (count === null) count = parseInt(t, 10)
      continue
    }
    const kw = canonicalEquipment(t)
    if (kw && keyword === null) keyword = kw
    if (firstNameWord === null && !RATE_STOPWORDS.has(t)) firstNameWord = t
  }
  ...
  const type = keyword ?? firstNameWord ?? 'equipment'
  return { type, count, owned_or_hired: detectTenure(tokens), daily_hire_cost: null, raw: chunk.trim() }
}
```

Tokens for `"poclain 1 dumper 3"`: `poclain`, `1`, `dumper`, `3`. Walking
the loop:
- `poclain` → `canonicalEquipment('poclain') = 'excavator'`; `keyword` was
  `null`, so it's taken: `keyword = 'excavator'`.
- `1` → first digit token; `count === null`, so `count = 1`.
- `dumper` → `canonicalEquipment('dumper') = 'dumper'` — a real, matched
  keyword — but the guard `kw && keyword === null` at line 69 is now
  false (`keyword` is already `'excavator'`), so this second keyword is
  **discarded outright**, not stored anywhere, not even as `firstNameWord`
  (that branch is also gated on `firstNameWord === null`, but by this
  point `firstNameWord` is irrelevant since `keyword` already won — the
  `type` field only ever falls back to `firstNameWord` when `keyword` is
  `null`).
- `3` → second digit token; `count !== null` already, so it is **also
  silently discarded** — the same "first number wins, rest is dropped"
  mechanism already named in the two prior review docs (§5 below), one
  chunk over.

One `EquipmentItem` comes out: `{ type: 'excavator', count: 1, raw:
'Poclain 1 Dumper 3', ... }` — exactly matching the real stored row in §1.
**"Dumper 3" is not merely mis-parsed — it never gets the chance to become
its own item, because the chunk it lived in was never split.** This is a
chunking failure, confirmed directly against the real code and the real
stored data — not a lexicon gap. The evening-hours parser
(`equipment-hours.ts:111-114`) uses the byte-identical split regex, so the
same failure mode exists on the evening side too, though it did not fire
tonight because the evening reply ("JCB 8 hours ,excavator 6 hours") only
ever names two machines to begin with — the engineer, having never been
shown "Dumper" in the echo, had no occasion to answer for it.

## 4. Downstream consequence: what tonight's DPR will show

No `dprs` row exists yet for `log_date = 2026-09-12` on this project as of
this investigation (prior days' rows all generate ~14:15 UTC / ~19:45 IST;
today's evening check-in landed at 13:17 UTC, before that window). Traced
forward through the code that will run tonight, not guessed:

- `035_evening_flow_restructuring.sql`'s own RPC (lines 662-712) builds the
  stored `evening_equipment_utilisation.items` by joining the evening
  reply's types against `morning_equipment.items` **by type string**, and
  separately adds a **"Case B" entry** (lines 694-712) — `{type: mtype,
  hours_used: null, ...}` — for any DISTINCT type present in
  `morning_equipment.items` that the evening reply never answered for.
  This is the exact safety net that correctly caught the *vibrator* in
  the sibling `equipment-hours-parser-fault-note-gap.md` incident
  (§5 below) — a real morning-listed machine silently going unanswered.
  **It cannot catch this case**, because it iterates
  `morning_equipment.items`, and "dumper" was never a member of that array
  to begin with (§3) — there is no distinct `mtype = 'dumper'` for the
  `NOT EXISTS` anti-join to ever find. Confirmed by re-reading the row in
  §1: `evening_equipment_utilisation.items` has exactly two entries (jcb,
  excavator), no third "not reported" entry, and `confidence: "high"` —
  the RPC has no signal that anything is missing, because from its own
  point of view nothing is.
- `lib/dpr/assemble.ts` (lines 265, 288, 668) runs every equipment item's
  `type` through `equipmentLabel()` before it becomes a DPR fact — the
  same humanizer used for the echo (§2). Tonight's report will show
  "Excavator" wherever this project's row is rendered, for the same
  reason the evening echo did: nothing in the DPR pipeline reads `raw`
  either.

**Net effect: tonight's DPR will show two machines — JCB and Excavator —
both flagged `implausible: false`, both `confidence: high`. It will not
show three. Nothing in the stored row, the RPC output, or the DPR
assembly pipeline carries any signal that a third machine was ever
mentioned.** The 3 dumper-hours the engineer tried to report are not
"missing data" in any place a PM or owner could notice and ask about —
they were never captured past the morning parse, so there is no gap for
anyone downstream to see. The engineer's own evening answer
("JCB 8 hours, excavator 6 hours") answers exactly and only the two
machines the (wrong) echo showed him — he was never asked about the
Dumper, so there was never a chance for him to notice or correct the
substitution either.

## 5. Relation to the existing parser findings

Two prior docs exist in this family, plus one referenced in the task that
**does not exist in this repository under that name or any similar one** —
confirmed by `find . -iname "*digit-misattribution*"` (no output) and a
repo-wide grep for `digit-misattribution` (no output). Flagging this
directly rather than silently treating the citation as real, per this
project's own standing rule that a document is audited for asserted-but-
nonexistent artifacts before being relied on (CLAUDE.md §0). If Part A of
today's paired task is the one creating that inventory, this note should
be folded into it once it exists; until then, this is a standalone record.

- **`docs/reviews/equipment-hours-parser-fault-note-gap.md`** (OPEN) — a
  status/fault note's digit (`"Pump breakdown 1 hr"`) gets attached to the
  matched keyword as a false usage-hours value. Root mechanism: grab the
  first digit in the chunk, attach it to whatever keyword matched,
  discard the word that actually governed the digit's meaning.
- **`docs/reviews/quantities-parser-m2-m3-unit-gap.md`** (OPEN) — `"100
  m2"` becomes `100`, `m`, `2` after digit-boundary splitting; `m` resolves
  to plain metres and the `2` is discarded. Same root mechanism, one field
  over (quantities, not equipment).
- **`docs/reviews/equipment-parser-count-gap.md`** (SUPERSEDED 2026-08-25)
  — the old rate-capture design took the first number in a chunk as a
  rate, discarding a second number in the same chunk (`"Cement mixer - 1
  1000"`). Same root mechanism as the two above, on an earlier version of
  this exact file.

**This is a related but genuinely different mechanism, and belongs in its
own note rather than being folded into any of the three above as a fourth
instance.** All three existing docs are about mishandling **inside a
single, correctly-delimited chunk** — the comma-split itself is assumed
correct in every one of them, and the bug is "first digit/first number
wins, the rest of that same chunk is silently discarded." What happened
today is one level up: **the chunk boundary itself was wrong** — a second,
distinct, fully-recognised equipment keyword ("Dumper") appeared after a
number with no comma before it, so it never became a separate chunk at
all, and `parseChunk`'s `keyword === null` guard (line 69) then discards
that second keyword outright once a chunk already matched one. The
existing docs describe lossy digit/number handling; this is lossy **item**
handling — an entire machine, keyword and count together, silently
absorbed into a neighboring item's `raw` string with no trace in any
structured field. Same broad family ("grab the first of X per unit,
discard everything else, no model of what a later token modifies or
introduces"), same two files (`equipment.ts` and its evening-side sibling
`equipment-hours.ts` — byte-identical split regex, confirmed at
`equipment-hours.ts:111-114`), but a new failure shape not described by
any existing document. Recorded here as its own note; whoever integrates
this with Part A's parser-digit-misattribution work should treat this as
a sibling finding, not a duplicate.

## Not fixed here — options for a future pass, named but not chosen

Recorded so a fix has a starting point, per this project's own convention
(see the three docs above for the same pattern) — none of these are
decided or applied:

- Split chunks on a recognised-keyword boundary too (not just
  comma/and/plus) — risks false splits inside legitimate multi-word
  machine names or rate phrases; needs real-sample review before deciding
  what counts as a boundary.
- Cap `parseChunk` to one keyword+count pair per chunk and, on finding a
  second keyword, split the remainder off into its own chunk retroactively
  — closer to the actual engineer intent, more code.
- Surface a signal when a chunk's token count suggests more than one
  item was intended (e.g. two digit groups, two keyword matches) so a
  reask or a flagged-low-confidence path can catch it, mirroring the
  `implausible`/`confidence` flags this project already uses elsewhere
  rather than a silent accept.
