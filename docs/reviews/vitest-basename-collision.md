# A test file's own summary line was intermittently missing from full `vitest run` output — investigated 2026-09-02, mechanism NOT confirmed

**Status: OBSERVED ANOMALY, LEADING THEORY DISCONFIRMED BY DIRECT TEST.** This entry was
originally written asserting a basename collision as the cause. That theory was tested
directly and did NOT reproduce. Corrected here rather than left standing — the honest
finding is narrower than first claimed, and the corrected version is what matters, not the
history of getting there.

## What was actually observed, confirmed

Building the `owner_deliver` job handler (`docs/reviews/owner-deliver-handler-record.md`),
`test/owner-deliver-dispatch.test.ts` (a real-test-db integration suite, ~45s runtime) and
`test/unit/owner-deliver-dispatch.test.ts` (pure-logic unit tests, ~1ms runtime) shared an
identical basename in different directories.

- Run standalone (`npx vitest run test/owner-deliver-dispatch.test.ts`): 10/10 pass, every
  time.
- Two consecutive FULL-suite runs (`npx vitest run`, no path args): the integration file's
  own per-file summary line was **absent** from the printed output — not listed passed, not
  listed failed. `test/unit/owner-deliver-dispatch.test.ts`'s line, same basename, printed
  correctly both times. Overall totals: 75 files / 931 tests, identical between the two runs.
- Renamed the integration file to `test/owner-deliver-job.test.ts` (no other change). Next
  full run: its line appeared correctly (10 tests) — but the overall total was **still**
  75 files / 931 tests, unchanged from the two runs where the line was missing.

## The theory this entry originally asserted, and why it doesn't hold

**Original claim: same-basename collision under full-glob discovery causes the suppression.**
Tested directly: two trivial scratch files (`test/zzscratch-repro.test.ts`,
`test/unit/zzscratch-repro.test.ts`, identical basename, sub-millisecond runtime, the `unit`
one containing a deliberately failing assertion) added to the real 75-file suite and run via
the same full glob. **Both lines printed correctly, and the deliberate failure was reported**
(2 failed files instead of 1, total count correctly up by 2). The collision did not
reproduce with matching, fast files. This directly disconfirms "same basename alone,
under full-glob discovery, is sufficient to suppress a line" — it is not.

## What the evidence actually points to, stated as a hypothesis, not a finding

The identical 75/931 totals across all three real runs — including the run where the
renamed file's line DID print — argue that the integration file's tests were very likely
**counted correctly in every run**, including the two where its own line didn't print. If
so, this was never a "tests don't execute" bug; it was a "this one file's own per-file
summary line didn't get printed by the reporter" quirk. The scratch-file repro's fast
runtime (~1ms) versus the real integration file's slow one (~45s, dominated by real
Postgres round-trips) is the most plausible remaining confound — a slow file's own reporter
line failing to flush/print correctly under a large suite's worker-thread scheduling — but
this was NOT specifically tested (doing so would need a slow scratch file, not attempted
here) and should not be asserted as confirmed either.

## Consequence, narrowed to what's actually defensible

**Do not trust a full-suite run's printed file list as proof a file's tests didn't run or
weren't counted** — the total test count is the more reliable signal, and this project's
own totals suggest tests can be counted correctly even when a specific file's own summary
line is inexplicably absent. If a file you expect to see is missing from the printed
list, check the total count against a known baseline before concluding anything, and when
in doubt, run that file standalone to confirm its own content and pass count directly.

**The rename to `test/owner-deliver-job.test.ts` is kept** — it's harmless, the file
displays correctly now, and distinct basenames for a unit/integration pair is reasonable
hygiene regardless of whether it was the actual fix here. It is NOT asserted as a
confirmed fix for a confirmed mechanism — both remain open.

## Evidence trail

- Run 1 (`bccf0kost`): 75/931, integration file's line absent.
- Run 2 (`b1abg4jmq`, immediately after, no changes): identical totals, same file still absent.
- Rename to `test/owner-deliver-job.test.ts`.
- Run 3 (`b44xcoxxp`): line now present (grepped directly from the full log, not the
  truncated terminal tail), totals still 75/931 — unchanged, which is the fact that
  disconfirms "renaming fixed a counting problem."
- Isolated repro (`bsntks6sx`): same-basename, fast files, one deliberately failing —
  both lines printed, failure correctly reported, total correctly up by 2. Basename
  collision, alone, does not reproduce the anomaly.
