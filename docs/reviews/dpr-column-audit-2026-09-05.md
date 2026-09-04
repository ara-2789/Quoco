# DPR column audit — lib/dpr/ reads vs. what the live flows write (2026-09-05)

**Requested by Aravind, ahead of PR C ("reconnect DPR to schema").** Full column-level
diff between what `lib/dpr/` reads and what the CURRENT morning and evening RPCs
actually write — the check nobody ran the first time 030, 033, or 035 shipped, or after
either. Findings only. No code changed here.

**Method**: read the actual current `apply_morning_flow_turn`/`apply_evening_flow_turn`
bodies (both live in `supabase/migrations/035_evening_flow_restructuring.sql` — 035
redefines BOTH functions, not just evening's; `030_morning_flow_attendance.sql`'s own
copy of `apply_morning_flow_turn` is superseded), plus `033_sweep_stale_morning_sessions.sql`
(a third writer of morning columns), against every `row.<column>` reference and `.select()`
call in `lib/dpr/assemble.ts`, `lib/dpr/narrative-context.ts`, `lib/dpr/render.ts`,
`lib/dpr/generate.ts`, `lib/dpr/schema.ts`. `render.ts`/`generate.ts` operate only on
already-assembled `Facts` objects — they never reference `daily_logs` columns directly,
so the read/write comparison is entirely in `assemble.ts` and `narrative-context.ts`.

## 1. Every column lib/dpr/ reads

From `assemble.ts` (both the deferred `mergeDprFacts`/`assembleDprFacts` path and the
live `mergeEngineerDprFacts`/`assembleEngineerDprFacts` path) and `narrative-context.ts`:

| Column | Read by |
|---|---|
| `morning_plan` | assemble.ts |
| `morning_manpower` (`.total` only) | assemble.ts |
| `morning_equipment` | assemble.ts |
| `morning_execution_plan` | assemble.ts (listed in `CORRECTABLE_SCALAR_COLUMNS`) |
| `morning_submitted_at` | assemble.ts (completeness only) |
| `evening_output` | assemble.ts |
| `evening_output_quantities` | assemble.ts |
| `evening_workers_on_site` | assemble.ts |
| `evening_productive_manpower` | assemble.ts |
| `evening_schedule_met` | assemble.ts |
| `evening_schedule_miss_reason` | assemble.ts, narrative-context.ts |
| `evening_equipment_utilisation` | assemble.ts, narrative-context.ts |
| `evening_submitted_at` | assemble.ts (completeness only) |

13 columns total (11 check-in data columns + 2 `_submitted_at` timestamps used only for
completeness derivation, not DPR content).

## 2. What the CURRENT flows actually write

Both RPCs' live bodies are in **035** (2026-08-31) — confirmed by reading the file
directly: it contains `CREATE OR REPLACE FUNCTION apply_morning_flow_turn` AND
`CREATE OR REPLACE FUNCTION apply_evening_flow_turn`. 030's own copy of
`apply_morning_flow_turn` is not what's live — 035's is. **033** (also 2026-08-25, same
day as 030) additionally writes `morning_submitted_at`/`attendance`/`attendance_defaulted`/
`attendance_raw`/`is_holiday` via `sweep_stale_morning_sessions`, a third writer for
abandoned sessions — confirmed by reading its body, not assumed from the filename.

**Morning** (035's copy, `030`'s pre-existing branches unchanged except one):
| Column | Written by | Shape |
|---|---|---|
| `morning_plan` | Q2 branch | TEXT, verbatim |
| `morning_manpower` | Q3 branch | JSONB `{total, by_trade:[{trade,count,matched}], raw_text}` — `matched` field added in 035, the one changed branch |
| `morning_equipment` | Q4 branch | JSONB `{items:[{type,count,owned_or_hired,daily_hire_cost,raw}], none, raw_text}` — unchanged by 035 |
| `morning_submitted_at` | Q4 branch, + 033's sweep | TIMESTAMPTZ |
| `morning_execution_plan` | **nothing** | — |

**Evening** (035, full rewrite):
| Column | Written by | Shape |
|---|---|---|
| `evening_output` | Q1 branch | TEXT, verbatim |
| `evening_output_quantities` | Q1 branch | JSONB, `p_parse->'1'` passed through from the TS quantities parser |
| `evening_manpower` | Q2 branch | **NEW column**, JSONB `{total, by_trade:[{trade,count,matched}], raw_text}` |
| `evening_idle_hours` | Q3 branch | **NEW column**, JSONB `{by_trade:[{trade,idle_hours,matched}], all_working, unknown, raw_text}` |
| `evening_equipment_utilisation` | Q4 branch | **RESHAPED**, JSONB `{items:[{type,hours_used,matched,implausible,raw}], raw_text, confidence}` — no `morning_item_index`, no `available_hours`, no `actual_hours` anywhere in this shape |
| `evening_schedule_miss_reason` | Q5 (hindrance) branch | TEXT — **REPURPOSED**: holds the Q5 hindrance free-text answer, not a schedule-miss reason. §33's own hindrance-question decision reused this column rather than adding a new one. |
| `evening_submitted_at` | Q5 branch (terminal) | TIMESTAMPTZ |
| `evening_workers_on_site` | **nothing** | — |
| `evening_productive_manpower` | **nothing** | — |
| `evening_schedule_met` | **nothing** (automated flow) — CAN still receive a value via a PM's manual correction, migration 019's `correct_daily_log`, since it's in `CORRECTABLE_SCALAR_COLUMNS`. No automated write path exists. | — |

## 3. The diff, three buckets

### 3a. READ BUT NEVER WRITTEN — renders "not reported" forever

| Column | Since | Notes |
|---|---|---|
| `evening_workers_on_site` | **035, 2026-08-31** | Superseded by `evening_manpower` (trade-level), which nothing reads |
| `evening_productive_manpower` | **035, 2026-08-31** | Superseded by `evening_idle_hours`, which nothing reads |
| `evening_schedule_met` | **035, 2026-08-31** | The question itself was deleted from the flow. Automated write path gone; PM manual correction is the only remaining write path (untested whether any PM has ever used it here) |
| `morning_execution_plan` | **Pre-existing, §28(p)** — a decision already recorded (not new), noted here for completeness of the full read list |

Three of four are new as of 035, same date, same migration — not three separate
incidents, one restructuring that broke three read paths at once.

### 3b. WRITTEN BUT NEVER READ — engineer answered, nothing shows it

| Column | Since | Notes |
|---|---|---|
| `evening_manpower` | **035, 2026-08-31** | Trade-level actual workers — replaces the old `evening_workers_on_site` scalar conceptually, but no reader was ever built for the new shape |
| `evening_idle_hours` | **035, 2026-08-31** | Trade-level idle hours + the `all_working`/`unknown` tri-state — replaces `evening_productive_manpower` conceptually, same gap |
| `morning_manpower.by_trade` | **018, 2026-07-15 (sub-field gap, not a whole-column one)** | Only `.total` is read; the per-trade breakdown has never been read by any lib/dpr/ path, since before any of the restructurings — the oldest gap in this whole audit, and the only one that predates 035 entirely |

### 3c. SAME NAME, DIFFERENT SHAPE — the dangerous class

**`evening_equipment_utilisation` — CONFIRMED BROKEN, precise mechanism, not a guess.**

- **Stored shape (035, 2026-08-31)**: `{items:[{type, hours_used, matched, implausible, raw}], raw_text, confidence}`. Joined to `morning_equipment` by **type string**, per 035's own comment ("§33(b)/§6: the entire per-machine matching apparatus this replaces is retired outright").
- **Assumed shape (both `assemble.ts` assemblers, live and deferred)**: `{items:[{morning_item_index, type, available_hours, actual_hours}]}`. Joined by **positional index** (`morning_item_index`).
- **The actual runtime consequence, traced through the live code** (`mergeEngineerDprFacts`, assemble.ts:567-577):
  ```
  for (const item of row.evening_equipment_utilisation?.items ?? []) {
    if (item.morning_item_index !== null) {           // item.morning_item_index is undefined (key doesn't exist in the real object) — undefined !== null is TRUE
      eveningByIndex.set(item.morning_item_index, ...) // sets the Map with key = undefined
    }
  }
  ...
  const eveningMatch = eveningByIndex.get(index)        // index is a real integer (0, 1, 2…) — never matches the undefined key
  ```
  `eveningMatch` is `undefined` for every equipment item, on every row, unconditionally.
  `available_hours`/`actual_hours` resolve to `notCapturedNumber` every time — **not a
  crash, not a garbage string, a silent, permanent "not reported"** for the one field
  (`evening_equipment_utilisation`) that has the most parsing machinery built around it
  in this whole codebase (`implausible` flagging, `confidence`, tri-state design).
- **This is the mechanism behind the 2026-09-04 incident's own equipment-hours finding**
  (Friday's "8,6" answer producing `type:"equipment"` entries instead of attaching hours
  to the roller/crane) — not a new discovery, the root cause for something already
  observed empirically on real production data.
- Also confirmed in the deferred `mergeDprFacts` path (assemble.ts:222-244) — the
  identical `morning_item_index` assumption, same break, same date.
- `narrative-context.ts:40` (already flagged by Aravind) types this same column in the
  pre-035 shape too — same root cause, third call site.

**`evening_schedule_miss_reason` — same name, same TYPE (TEXT), different MEANING.**
Not a shape mismatch in the JSON-shape sense (both sides agree it's a plain string), but
the column's semantic content changed entirely: it now holds the Q5 **hindrance** answer,
not a schedule-miss explanation — since 035 (2026-08-31), the schedule-met question
doesn't exist anymore for this to be an explanation OF. `assemble.ts`/`narrative-context.ts`
read it into `schedule.note`/`schedule_miss_reason_note` fields, meaning today's DPR
narrative context — if it ever surfaces this field — presents hindrance text as if it
were a schedule-miss reason. Worth its own bucket: same name, same shape, wrong meaning.

## 4. The morning half — checked, not assumed clean

Nobody had audited this after either 030 or 033. Checked directly:

- `morning_plan`: written (Q2 branch, unchanged across 018/030/035), read (`wrapText`).
  **Consistent.**
- `morning_manpower.total`: written (Q3 branch; 035 only changed the `by_trade` internals,
  adding `matched` — `total` itself untouched), read (`wrapCount(row.morning_manpower?.total)`).
  **Consistent.** `by_trade` itself is bucket 3b (written, never read — see above), but
  that's an old gap (018), not something 030/033/035 introduced.
- `morning_equipment`: written (Q4 branch, unchanged since 018, same TS parser shape on
  both write and read side per the PR B fix). **Consistent.**
- `morning_submitted_at`: written by three call sites now (035's own two branches +
  033's sweep) — all TIMESTAMPTZ, all consistent with what `deriveHalfCompleteness` reads.
  **Consistent.**
- `morning_execution_plan`: the one real morning-side gap, and it's not new — §28(p)'s
  own decision, already recorded, not a 030/033 regression.

**The morning half is not where the damage is.** 030 restructured question ORDER and
added attendance-specific columns (`attendance`, `is_holiday`, etc. — none of them
DPR-relevant); it did not reshape the JSONB internals of any column `lib/dpr/` reads.
033 added a third writer for the same, already-consistent shapes. The screenshots
showing "some morning data flowing through" were not lucky — the morning-side DPR
surface has stayed shape-consistent through every migration that's touched it. The
entire shape-drift problem is on the evening side, and it traces to one migration: 035.

## 5. Summary — how long, and how much

| Finding | Since | Age as of 2026-09-05 |
|---|---|---|
| `evening_workers_on_site` unread | 035 | 5 days |
| `evening_productive_manpower` unread | 035 | 5 days |
| `evening_schedule_met` unread (question deleted) | 035 | 5 days |
| `evening_manpower` unread | 035 | 5 days |
| `evening_idle_hours` unread | 035 | 5 days |
| `evening_equipment_utilisation` shape break (join always misses) | 035 | 5 days |
| `evening_schedule_miss_reason` meaning repurposed | 035 | 5 days |
| `morning_manpower.by_trade` unread | 018 | ~7 weeks — the oldest, and the only pre-035 gap |
| `morning_execution_plan` unwritten | §28(p) decision | pre-existing, already recorded |

**Six of eight real findings trace to one migration, 035, applied 2026-08-31 — five days
before this audit.** The evening flow has not correctly fed the DPR for a single day
since that migration shipped. This is not a slow accumulation of small drifts; it's one
restructuring that changed five column shapes/names in one PR and had no downstream
consumer check run against it. The morning half, despite two migrations (030, 033)
touching it in the same window, stayed correct throughout — the manpower/equipment JSONB
internals were never reshaped there, only question ordering and a new attendance
surface were added.

## Not decided here

Scope, sequencing, and whether PR C needs splitting are Aravind's call, per his own
instruction. This document is the input to that decision, not the decision.
