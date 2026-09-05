# PR C4 proposal — surface `matched` at every place it's currently discarded

Not built. Proposal only, per instruction — folding §28(f) (2026-08-21,
never implemented) into the same PR as Batch 1's Finding A, since it's the
same defect class and the morning side has already waited two weeks longer
than the evening side.

## Scope — three surfaces, one convention

All three currently discard a `matched`-equivalent signal before it
reaches the DPR, and all three get the same treatment:

1. **Evening idle-hours-by-trade** (`evening_idle_hours.by_trade[].matched`)
   — Batch 1's Finding A. Discarded in `assemble.ts` building
   `idle_hours_by_trade` (`lib/dpr/schema.ts`'s `EngineerIdleHoursByTrade`
   has no `matched` field).
2. **Evening equipment-hours** (`evening_equipment_utilisation.items[].
   matched`) — found while answering your question last turn. Discarded in
   `assemble.ts:620-622`'s `eveningByType` map, which copies only
   `{hours_used, implausible}`.
3. **Morning equipment** (§28(f), 2026-08-21, never built) — the parser
   itself has no `matched` field to discard yet.
   `lib/whatsapp/flows/parsers/equipment.ts:77` computes
   `type = keyword ?? firstNameWord ?? 'equipment'` with no record of
   which branch fired. This one needs a parser change (add `matched:
   keyword !== null`), not just a rendering change — it's a level earlier
   than the other two.

## Do morning and evening need different treatment? No — argued, not assumed

Checked whether §28(f)'s own decided answer for morning (raw, as-entered)
should differ from the evening treatment already proposed. It shouldn't,
for two reasons:

- **A PM reading one DPR shouldn't learn two conventions for the same
  concern.** The equipment line already has a working convention for a
  *different* confidence flag (`implausible` → inline `(check this)`).
  Trade and equipment-hours use the identical `matched` semantics as
  morning equipment's parser-to-be — giving them different visual
  treatment because they were decided two weeks apart would be an
  accident of timing, not a real distinction.
- **This project already has a convention for exactly this distinction,
  underused so far.** `fmtText` (render.ts) already wraps reported free
  text in double quotes for `work.planned`/`work.done_text` — quoted =
  raw engineer text, unquoted = a structured, code-recognized value.
  Applying that same quoting to an unmatched trade/equipment token is not
  a new convention, it's the existing one, just not yet reused here.

## Proposed rendering, all three surfaces, same shape

Raw text in quotes (matching `fmtText`'s existing convention) + a marker
distinct from `implausible`'s wording, so a PM can tell which kind of flag
they're looking at without re-reading:

```
Bar Bender idle 4 hours.
"peb" idle 4 hours. (unrecognized trade — check spelling)
```

```
Equipment — planned: JCB | used: 6 hours
Equipment — planned: "Cement micsur 1000" (unrecognized equipment — check spelling) | used: not reported
```

```
Equipment — planned: JCB | used: "cment mixer 4hrs" (unrecognized equipment — check spelling)
```
(evening-side unmatched: the morning plan matched fine, but the evening
reply's own equipment-hours token didn't parse to a recognized type)

`implausible` stays exactly as it renders today — `(check this)` — since
that flags a different thing (a number that looks wrong, not a token that
wasn't recognized at all) and conflating the two wordings would lose that
distinction.

## What's still out of scope, deliberately

The evening-equipment "no morning-type match → entirely invisible" gap
(flagged when this was first reported) stays out of C4. That's a
structural question — should the equipment section ever show an
evening-only entry with no morning counterpart at all — not a rendering
fix, and bundling it risks the same "waited for a bigger decision" delay
this proposal exists to avoid for the confidence-marker fix.

## Build shape, once approved

- `lib/whatsapp/flows/parsers/equipment.ts`: add `matched: boolean` to
  `EquipmentItem`, set `keyword !== null`.
- `lib/dpr/schema.ts`: add `matched: boolean` to `EngineerIdleHoursByTrade`
  and to the equipment item Facts type.
- `lib/dpr/assemble.ts`: stop dropping `matched` in both lookup-map
  constructions (idle-hours, equipment-by-type); carry it through for
  morning equipment items too (currently has nowhere to come from until
  the parser change above lands).
- `lib/dpr/render.ts`: branch on `matched` at each of the three render
  sites; raw text (quoted) + marker when false, current behavior
  unchanged when true.
