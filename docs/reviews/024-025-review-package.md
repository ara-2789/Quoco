# Migrations 024 + 025 — evening-flow productivity — RETROACTIVE review package

**READ THIS FIRST. THIS IS NOT A PRE-APPLY REVIEW. BOTH MIGRATIONS ARE ALREADY
LIVE ON PRODUCTION.** 024 applied 2026-08-05; 025 applied 2026-08-11, 09:35 IST
(CLAUDE.md's own dated entries record both apply events). Nothing in this
package gates a deployment — there is no apply decision waiting on this read.
The question for the reviewer is **"is anything here still wrong, now that it's
already running against real customer data"** — not "should this ship." Please
read it with that framing; a package that reads like a pre-apply request but
is actually retroactive is easy to mistake for lower stakes than it is, and
the stakes here are that this code already computes the labour-utilisation
figure a project owner reads tonight.

Written 2026-08-11, retroactively, because neither migration went through
external review at the time — see below for why, and see CLAUDE.md §0's
EXTERNAL REVIEW GATE entry (added the same day) for the trigger condition that
would have caught both, going forward.

**Why this exists now, not earlier.** Both migrations modify a live function's
logic (`apply_evening_flow_turn`) — squarely inside the review-gate trigger
condition defined the same day this package was written. Asked why they never
went through review, the honest answer was that no such gate existed yet; it
depended on someone remembering to ask. This package is the first thing that
gate produces, applied retroactively to the two migrations that predate it.

---

## Provenance / pinning

Per CLAUDE.md §0 — artifacts pinned to source, never paraphrased. Each hash
computed individually, filename and hash on the same line.

| Artifact | Pin |
|---|---|
| This package's base commit | `82608fbd48a040fe7d134329e65384d31b581ead` (main, post PR #52 merge) |
| `git status --porcelain` at that commit, excluding this package's own branch work | clean |
| `024_evening_flow_q4_q5.sql` | sha256 `fca45234aba1af6b56679542adf1f6e6382eb593ff24e86b46370d489444c63f` |
| `025_evening_productivity_reconciliation.sql` | sha256 `0615dfb64c0114a632f28ac92885ddabb9e2f3f609795f33e4a96504b485dcb8` |
| `lib/whatsapp/flows/evening.ts` (the TS "pure mirror") | sha256 `42c0cd6ba26b0021d9b67bb9c2db07fb996adaf2278cf83b4d7c8617658339cf` |
| `lib/whatsapp/flows/parsers/productivity.ts` | sha256 `a790a2e6ee400f595aec6ff30a1dd4bc62e466ee21edd92ed8fc365ae28235aa` |
| `test/migration-024.test.ts` (current, 31 tests) | sha256 `943c423cef3f9f1f98a6185c3deef25c165bb47f252b30e6d9db981095660c87` |

**Commit history, both migrations** (`git log --oneline -- <file>`):

- 024: `3d22ad6` (feat, original) → `364cdaf` (fix) → `10ce89a` (fix) — all
  before 024 went live.
- 025: `ced936b` (fix, original) → `453931a` (fix, dated correction to the
  file header's Defect 3 bullet) — both before 025 went live.

**Prod's currently-applied function body** (re-verified this session, not
carried forward from an earlier log line): `prosrc` md5
`9bd64d28c9cbf0056c7fd63a83c12d3b`, length 35150 — matches the reference
recorded at prod's own 025 apply. Confirmed the same value on test-db as of
2026-08-11 after a same-session repair (see CLAUDE.md §0's `db push` entry for
that incident — an unrelated operational failure during a DIFFERENT
migration's rehearsal, not a defect in 024 or 025's own design; noted so a
reader doesn't conflate the two).

---

## 1. What changed, as one arc — 024 then 025

**024** (`3d22ad6`, live 2026-08-05) added Q4 (headcount, then productivity/
idle) and Q5 (per-machine equipment hours) to the evening check-in flow's RPC,
`apply_evening_flow_turn`. Before 024, this was a stub; 024 is what first made
the function actually derive `productive_count`/`idle_count` from a raw reply
and persist them.

024's original productivity derivation (step 5, before 025 touched it): take
the **first digit** in the reply as `idle_count`, unconditionally, then derive
`productive_count = headcount - idle_count`. No anchor-word matching, no check
on which number the engineer actually meant.

**025** (`ced936b` + `453931a`, live 2026-08-11) replaces that derivation
entirely, after a real production incident (§2 below) showed it was
confidently wrong on ordinary input. The replacement adds anchor-word pairing
(`idle`/`productive`, order-independent) plus a fallback guard for anything
the anchor logic doesn't cover — see §3 for the exact reconciliation rules.
025's own header states the change is a **verified-minimal diff** against
024's body: two new `DECLARE` entries and one block replaced; every other
line — steps 1-4, the Q5 auto-skip decision, all four equipment match tiers,
every write branch, the `EXECUTE` grants — confirmed byte-identical to 024 via
`diff` against the extracted function body, not asserted from memory.

---

## 2. The incident that produced 025 — how it was actually found

Quoted directly from `025_evening_productivity_reconciliation.sql:3-6`:

> "Fixes a severe, confidently-wrong bug in apply_evening_flow_turn's step 5
> (Q4b, productivity/idle) — found by a real Twilio sandbox smoke test against
> prod on 2026-08-10, NOT by any of the 17 unit/integration tests that existed
> before this migration."

**Found by a real, hand-run WhatsApp exchange against prod — not by code
review, and not by the test suite.** A real engineer answered evening Q4b "15
productive, 3 idle waiting for material" against a headcount of 18. The
pre-fix parser took the first digit in the message (15) as `idle_count`
unconditionally, derived `productive_count = 18 - 15 = 3`, and stored the two
numbers **exactly inverted** — 16.7% utilisation recorded instead of 83.3%,
`confidence='high'` because the parse "succeeded" (no reask was triggered).
Confidently, completely wrong, in the one DPR section that states labour cost
to an owner who acts on it.

**The test-suite fact, checked directly rather than taken from the migration
header alone — and flagging a real discrepancy rather than smoothing it
over.** `test/migration-024.test.ts` had **23** integration tests at the
commit immediately before the fix (`git show b20e61d:test/migration-024.test.ts
| grep -c '^  it('` → 23; `b20e61d` is the last commit touching the file
before `ced936b`) — all 23 passing, none of them catching this. The migration
header and `ced936b`'s own commit message both say "17 tests" instead of 23.
These two numbers are NOT the same measurement: 23 is every integration test
in that one file (equipment matching, Q5 auto-skip, and other logic unrelated
to productivity included); 17 is presumably a narrower count (productivity-
specific tests only, possibly spanning both `test/unit/productivity-parser.
test.ts` and a subset of the 23) that was never independently re-derived
before being written into the migration's own permanent record. Recorded here
precisely because it's a small, real inconsistency in this project's own
provenance discipline — not reconciled into one number, since I don't have
grounds to pick one over the other without re-deriving the narrower count
myself, which this package doesn't do. Whichever the true figure, the
substantive point is unchanged: a non-trivial, passing test suite existed and
did not catch this shape of bug — worth the reviewer's attention on its own,
independent of which exact count is correct.

---

## 3. The reconciliation logic 025 actually ships

Quoted from `025_evening_productivity_reconciliation.sql:45-64`:

> - idle-only (the common case, unchanged): productive_count derived from
>   headcount - idle_count, exactly as 024 always did.
> - BOTH idle and productive stated, and they SUM TO HEADCOUNT: real
>   confirmation, stronger than derivation — use both as parsed rather than
>   re-deriving over them.
> - BOTH stated but they DON'T sum to headcount: a genuine contradiction.
>   Neither number is trustworthy alone — NOT a tiebreak, same posture as
>   024's own idle>headcount guard: invalidate both, confidence='low'.
> - productive-only ("18 productive"), no idle number: derive idle the mirror
>   direction of 024's original formula.
> - THE GENERAL GUARD: numbers_discarded=true (a numeric token the parser saw
>   and could not place) forces confidence='low' regardless of whether
>   idle_count/productive_count still came out non-null from OTHER tokens in
>   the same message.

**Three additional defects, found in design review of 025's own first draft —
before it was ever committed, pushed, or applied** (quoted/summarized from
lines 71-127 of the same file):

- **Defect 1** (parser only, `productivity.ts`): `classifyYesNo` returned
  `met:true` on any YES_WORD ("ok", "done", "yes"...) whenever no NO_WORD was
  present, and "idle" is not a NO_WORD — "ok, 2 idle waiting for cement" hit
  the all-productive early return and discarded the real idle count through
  the ONE path THE GENERAL GUARD never reaches at all (an early return skips
  it entirely). Fixed by gating the early return on `!hasDigit && !hasIdleWord`
  too.
- **Defect 2** (both copies — TS mirror and SQL): the productive-only
  derivation had no upper guard. Headcount 18, "20 productive" produced
  `idle=0, productive=20`, `confidence='high'` — 111% utilisation, no check at
  all. Fixed symmetrically with the existing idle>headcount guard: invalidate,
  never clamp.
- **Defect 3** (both copies): when headcount is unknown and the parser DID
  anchor a productive count, the productive-only branch cannot fire, and the
  stated number is silently dropped. The file's own header contains a DATED
  CORRECTION (lines 105-127) walking back two overstated claims in the
  original Defect 3 paragraph — worth the reviewer reading directly rather
  than summarized again here, since it's an example of this project catching
  its own overclaim during the same review pass, not after.

---

## 4. THE STRUCTURAL FINDING THIS PACKAGE MOST WANTS AN OUTSIDE READ ON

The reconciliation logic above exists in **two hand-written, independently
maintained copies** — a TypeScript "pure mirror" (`lib/whatsapp/flows/
evening.ts`, which predicts what the RPC will do, used by callers before the
RPC call) and this migration's own PL/pgSQL function body (what actually
writes `daily_logs`). **Nothing in the codebase enforces that the two agree.**

Quoted in full from CLAUDE.md §10's HAND-MIRRORED RECONCILIATION entry:

> "This is the FOURTH defect of this general shape found in this repo's
> history (three instances fixed by inspection in this review pass, this
> fourth one is structural and wasn't)."

And the design-review process that caught Defects 1-3 above is itself
evidence of the risk, not just a description of it — quoted from the same
entry:

> "The design-review pass that caught Defects 1-3 in 025's first draft
> (2026-08-10, before the file was ever committed) found all three by
> hand-tracing BOTH copies separately — nothing in the test suite or the type
> system would have caught a divergence between them if one copy had been
> fixed and the other missed, which is close to what actually happened on the
> first pass (the TS fix alone shipped 4 of 5 new integration tests red,
> because the SQL copy never read the parser's new fields at all)."

**The test that would enforce agreement between the two copies does not
exist.** It was originally deferred as "the first item for the next session,"
a date-based deferral that slipped three sessions running and was retired in
favor of a conditional gate. Quoted in full, current text, CLAUDE.md §10:

> "DATED AMENDMENT (2026-08-11, Aravind's decision): the 'FIRST item for the
> next session' framing is retired — it slipped three sessions running (this
> one included) and would slip again, since a date-based deferral competes
> with whatever the next session's actual priority turns out to be and always
> loses. Replaced with a CONDITIONAL GATE instead of a date: this pure-mirror
> test is REQUIRED BEFORE the next change to `lib/whatsapp/flows/evening.ts`
> or to the evening RPC (`apply_evening_flow_turn`) — whichever comes first.
> Not required before unrelated work."

**This is what the reviewer's read is most valuable for**, more than
re-deriving the arithmetic in §3 by hand: is a conditional gate (versus a test
that already exists) the right amount of protection for two independently
hand-maintained implementations of the same logic, both live on prod, both
already proven to diverge once? An outside reader who hasn't been inside this
project's own reasoning the whole time is better positioned to say whether
"the evening flow is complete and frozen, so nothing is at risk while it
stays untouched" (the gate's own stated rationale) is actually a safe
assumption, or whether it's the same kind of assumption that let 024's
original bug ship undetected through 23 passing tests.

---

## 5. Current verified state (this session, not carried forward)

- Prod: `prosrc` md5 `9bd64d28c9cbf0056c7fd63a83c12d3b`, length 35150 —
  matches the reference recorded at prod's own 025 apply (2026-08-11, 09:35
  IST).
- Test-db: same md5/length, re-verified directly this session after an
  unrelated operational incident (a `db push` run during migration 026's
  rehearsal briefly reverted test-db's copy of this same function to a
  pre-024 body; repaired by re-applying 025's file directly; full record in
  CLAUDE.md §0). Not a defect in 024 or 025's own design — noted here only so
  a reader of this package doesn't need to separately wonder whether that
  incident touched the migrations under review. It didn't touch prod at all.
- `test/migration-024.test.ts`: 31/31 green against test-db, re-run this
  session after the repair above.

## 6. Out of scope for this package

- The `db push` incident itself (§5) — a process failure in a *different*
  migration's (026) rehearsal, already fully recorded and closed in CLAUDE.md
  §0. Not a finding about 024 or 025's design.
- Migration 026 itself — unrelated, uncommitted, paused pending a real
  end-to-end latency measurement before it ships. Not part of this review.
- Re-deriving the "17 vs 23" test count discrepancy (§2) to a single correct
  number — flagged, not resolved, here.

## 7. Questions for the reviewer, stated explicitly

1. Is the two-copy (TS mirror / PL-pgSQL) design in §4 sound at all, or should
   the RPC be the sole source of truth with the TS side reduced to a display
   hint rather than a predictive mirror? (This package takes no position;
   §4's own gate gets its rationale from the *current* design being kept.)
2. Are there other input shapes — beyond the five branches in §3 and the
   three defects in §3 — that could still produce a confidently-wrong,
   `confidence='high'` result? The five branches were derived from the one
   real incident plus hand-tracing, not from an exhaustive input-space
   analysis.
3. Does `confidence` propagation actually cover every branch correctly, or
   only the ones exercised by the 31 current tests?
4. Anything else this package's framing (written by the same people who wrote
   the code) would predictably miss.
