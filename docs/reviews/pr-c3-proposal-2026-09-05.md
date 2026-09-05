# PR C3 proposal — manpower breakdown format + absent-day rendering (2026-09-05)

**Proposal only, per Aravind's instruction. Nothing built.** Both questions change the
same output (the Manpower line and the overall body shape), so they're presented
together for one decision, not two.

## (a) Manpower breakdown format

**Current state (post-PR C2)**: `Manpower — planned: X | on site: Y` — two totals, no
trade detail. `morning_manpower.by_trade` has been unread since migration 018
(2026-07-15) — the oldest finding in the whole column audit. `evening_manpower.by_trade`
exists (035, 2026-08-31) and is *also* unread today — C2 only reads `.total` off it.

**The two real examples**, re-queried directly against prod (`jvxwqignooseazzmwhvl`),
not assumed:
- Thursday (2026-09-03): `evening_manpower` = `{total:12, by_trade:[{trade:"mason",
  count:4,matched:true},{trade:"helper",count:6,matched:true},{trade:"bar_bender",
  count:2,matched:true}], raw_text:"4 mason 6 helper 2 barbender"}` — all three
  matched; `4+6+2=12`, sum equals total.
- Friday (2026-09-04): `evening_manpower` = `{total:28, by_trade:[{trade:"mason",
  count:12,matched:true},{trade:"help",count:8,matched:false},{trade:"peb",count:8,
  matched:false}], raw_text:"12 mason 8  help 8 peb workers"}` — **two of three
  entries unmatched**, not an edge case, roughly half of one real day's own
  breakdown. Note the stored trade for the third entry is `"peb"`, not `"peb
  workers"` — the parser's own tokenization, not a guess. `12+8+8=28`, sum equals
  total here too — both real rows checked agree, though that's two data points, not
  a proof the two numbers can never diverge (see the open question below).

That last fact should weigh on the decision: an unmatched-trade display isn't a rare
fallback path here, it's close to the common case for this project's own site
vernacular ("help" for helper, "peb workers" as a project-specific crew name neither
in a canonical trade lexicon). Whatever format is chosen must make unmatched entries
look ordinary, not broken — the same posture this project already took for equipment's
own unmatched types (§42: "captured, not dropped").

**Three format options:**

1. **Total only** (status quo, already shipped). Simplest; already correct for what it
   shows. Loses the trade detail entirely — an owner never sees that Friday's 28
   workers were split 12/8/8, or that a third of Thursday's crew was helpers.
2. **Breakdown only**, no aggregate line — e.g. `Manpower — 4 Mason, 6 Helper, 2 Bar
   Bender`. Loses the at-a-glance total an owner scanning many reports wants first,
   and doesn't obviously generalize to the "planned" side (morning's own breakdown)
   without becoming two breakdown lines with no summary number at all.
3. **Total with breakdown beneath** — e.g.:
   ```
   Manpower — planned: 15 | on site: 12
     On site by trade: 4 Mason, 6 Helper, 2 Bar Bender
   ```
   Keeps the scannable total, adds the detail as a second line, same shape this
   project already uses elsewhere (Work's own planned/done pair, Equipment's
   planned/used pair).

**Recommendation: option 3**, for consistency with every other section's own
"headline number, detail beneath" shape. Two sub-decisions inside it, genuinely open:

- **Show the breakdown for `on_site` only, or for both `planned` and `on_site`?**
  `morning_manpower.by_trade` has been sitting unread since 018 — the same finding
  this proposal exists to close — so symmetry argues for both. Against: two breakdown
  lines when planned and actual trade mix are usually similar reads as noise. Leaning
  toward on_site only (the evening/actual side is what actually happened, and is the
  side idle-hours-by-trade already sits next to in NEEDS ATTENTION) — not settled here.
- **Unmatched-trade rendering.** `tradeLabel()` (PR C2) assumes a clean canonical key
  and humanizes it (`bar_bender` → "Bar Bender"). An unmatched entry's stored `trade`
  string is whatever the engineer's own token was — running it through the same
  humanizer risks manufacturing a confident-looking label for something that was
  never confirmed as a real trade category. Recommendation: unmatched entries render
  their raw captured text verbatim, unhumanized, with a visible marker distinguishing
  them from matched trades — e.g. `12 Mason, 8 "help" (unmatched), 8 "peb"
  (unmatched)`. Exact marker wording not decided here.
- **Does `by_trade`'s own sum always equal `total`?** Both real rows checked agree
  (12=4+6+2, 28=12+8+8), but two data points from one engineer aren't a proof this
  can never diverge on a garbled or partial answer. If it ever does, the render needs
  to decide whether to show both numbers as-is (honest, but a reader might wonder why
  they disagree) or flag the mismatch explicitly. Not resolved here — flagging so it
  isn't discovered as a surprise mid-build.

## (b) Absent-day rendering, end to end

**The gap, stated precisely**: `attendance` (`daily_logs.attendance` — `'present' |
'absent' | 'site_holiday'`) **is not read into `EngineerDprFacts` at all today** —
confirmed by grep, zero references in `assemble.ts`. The render layer has no way to
know an engineer was marked absent versus present-but-uninformative. For an absent
day, `apply_morning_flow_turn`'s own step-1/step-5 branches complete the flow
immediately on a "No" — `morning_plan`/`morning_manpower`/`morning_equipment` are never
asked at all, not just left blank. Thursday's real report already shows the shape of
the problem forming: on-site headcount and idle hours now render correctly (PR C2),
but nothing in the report says *why* work/equipment read "not reported" — an owner
reading it today would reasonably conclude a barely-productive normal day, not that
the engineer said "No, I'm not on site."

**What already exists to build on**: `CheckInHalfStatus` already carries a `status +
reason` shape for a structurally similar problem (`not_applicable`, joined-late/
left-early — Spec Rule 7) — precedent for "a real reason for a gap gets a plain-
language string," not a new vocabulary. Separately, `dispatch.ts`'s `codeTemplatedVerdict`
already special-cases one shape (morning-complete/evening-not-received) with a
deterministic sentence instead of a model call — precedent for "a known day-shape gets
a code-templated output," not a new mechanism.

**Proposal**: add `attendance: { status: 'present' | 'absent' | 'site_holiday'; note:
CapturedText } | null` to `EngineerDprFacts` (read from `daily_logs.attendance` +
`attendance_raw`, straightforward — the column already exists, nothing new to capture).
When `status !== 'present'`, short-circuit the body — same mechanism class as
`codeTemplatedVerdict`, extended to the BODY, not just the verdict sentence.

**The real design choice — two shapes for what "short-circuit" means:**

i. **Banner + existing four-section shell.** Prepend one line above the current
   Work/Manpower/Equipment/Hindrance sections, e.g. `ABSENT — [reason]`, then let the
   four sections render exactly as today (all reading "not reported"). Minimal change;
   every report keeps an identical shape, which is the current design's own stated
   principle ("fixed four-category shape regardless of what was reported").
ii. **Replace the body entirely.** No four-section shell for an absent day — one short
    paragraph instead: e.g. *"Vikram Rao did not report to site on 2026-09-03 (marked
    absent). No work, manpower, equipment, or hindrance data exists for this day."*
    More honest — four lines all reading "not reported" carry zero information once
    the reason is already stated once. Breaks the "every report has the same shape"
    principle, deliberately, for a day-shape that structurally cannot have the other
    four sections mean anything.

**Recommendation: (ii).** The four-section shell earns its place by carrying real
per-section content; on a day where three of four sections were never going to be
asked, repeating "not reported" four times under a banner that already explained why
is exactly the "empty fields dressed as a normal report" problem this proposal exists
to close, just moved one line down instead of removed.

**`site_holiday` — same defect, not explicitly asked about, flagged anyway**: a
declared holiday has the identical shape (no work expected, not by omission) for a
different, better reason. Same treatment (a short stated-reason report, not empty
fields) would apply, worded for a holiday rather than an absence — e.g. *"Site holiday
declared for 2026-09-03. No work expected."* Not building this either; naming it so it
isn't found as a second, near-identical gap after (b) ships for absence alone.

**Not decided here**: the exact banner/paragraph wording for either case (i)/(ii), or
whether morning-absent-but-evening-somehow-answered (an inconsistent state that
shouldn't occur given the flow's own design, but isn't impossible to construct) needs
its own handling.
