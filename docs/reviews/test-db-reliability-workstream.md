# Test-db reliability workstream — re-labeled (J7a)

**Status: write-up only, per the governing instruction ("J7 is write-ups only — no
implementation"). Nothing in this document was executed as a fix.**

## Origin

During migration 029's rehearsal (2026-08-19/20), Phase 5 read-only probes against
test-db (`exfccwlrhoutkgrlikod`) showed rows appearing and disappearing across
successive queries seconds apart, with no action taken by that session. Investigated
live (J1) rather than assumed: `.github/workflows/ci.yml`'s `test` job ("Test (real
test-db)") targets test-db directly via `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY`
secrets, and `test/helpers/db.ts` seeds/tears down fixtures under **fixed, deterministic
UUIDs** (`TEST_TENANT_ID = '00000000-0000-4000-a000-00000000d013'`,
`TEST_PROJECT_ID = '00000000-0000-4000-a000-00000000f014'`) shared across every branch
and PR — not per-branch, not randomized. A CI run for a *different, unrelated* PR was
mid-lifecycle (beforeAll seed → test → afterAll teardown) against those exact same rows
while this session's own read-only probes happened to land on the same IDs. The
workflow's own `concurrency: {group: ci-test-db-suite, cancel-in-progress: false}` exists
precisely because of this — confirmed by reading the comment beside it, not inferred.

**This mechanism is now CONFIRMED, not hypothesized: test-db has exactly one shared,
non-isolated fixture identity space, and any two concurrent writers against it — two CI
runs, or a CI run and a manual/local script — will observe or clobber each other's rows
mid-lifecycle.** This is a real, structural property of the current test setup, not a
one-off fluke.

## What this does and does not explain, checked against the actual incident record

CLAUDE.md carries a running claim, written in a fixed phrase, referenced identically in
two places (its own TEST-DB INCIDENT #4 entry and, before that, PR #64's commit message):
**"the fourth test-db CI incident in four days."** The instruction asked me to
cross-check incident timestamps against CI run history — "that turns hypothesis into
evidence" — and to mark this ROOT CAUSE CANDIDATE until it is, not to assert it.

Investigated, not assumed, before writing this document:

- **Incident #4 (2026-08-15, PR #64, `test/migration-024.test.ts`,
  `ensureMorningEngineer insert failed: no row returned`) is the ONLY one of the four
  with individually-findable detail anywhere in the repo's committed record.** Grepped
  `CLAUDE.md` and every file under `docs/reviews/` for the other three: they are referenced
  **only collectively**, in the identical summary phrase "test-db CI incidents," in both
  CLAUDE.md and the PR #64 commit that first coined the count. No individual failure
  message, timestamp, test name, or run ID exists anywhere for incidents #1–#3. A separate
  research pass (fork agent) confirmed this independently: nothing under either search term
  turns up individual detail for those three.
- **The "-732ms session-transition" incident, specifically, does NOT appear anywhere in the
  repo's committed record.** Grepped for `"732ms"`, `"-732"`, and `"session-transition"`
  across `docs/reviews/*.md` and `CLAUDE.md`: the only hits are normal, POSITIVE passing
  durations (e.g. `test/session-transition.test.ts (5 tests) 3755ms` in both
  `015-review-package.md` and `016-review-package.md`), never flagged as an incident, never
  negative. **This detail cannot be verified and should not be treated as established fact
  going forward** — it may have existed only in a prior session's spoken/unwritten
  reasoning, or may be a misremembering; either way, nothing in the repo backs it up today.
- **Incident #4's own two CI runs were cross-checked against the full run history for that
  day** (`gh run list --limit 100 --created 2026-08-15`, all branches). The failing run
  started `2026-08-15T06:42:29Z`, the retry-to-green run started `2026-08-15T07:01:37Z`.
  **No other workflow run — from any branch — was active in or overlapping either window.**
  The nearest other run that day started at `07:29:12Z`, nearly half an hour after the
  retry, on `main`. This is a direct, checked negative: **the shared-fixture-writer
  mechanism confirmed live during this session's own rehearsal does NOT explain incident
  #4** — there was no second concurrent writer present when incident #4 happened. Incident
  #4's actual cause remains what CLAUDE.md already recorded it as: UNRESOLVED, with the
  RLS/RETURNING-visibility-gap candidate ruled out only tentatively (see CLAUDE.md's own
  "TEST-DB INCIDENT #4, CLASSIFIED" entry — that classification stands unchanged by this
  check).

## Conclusion — stated at the strength the evidence actually supports

The shared-writer/fixed-fixture-collision mechanism is **real, confirmed, and a genuine
risk for test-db generally** — it is what caused this session's own Phase 5 row-churn
surprise, directly observed and directly traced to CI's own test job. It should be
labeled and tracked as exactly that: a **confirmed, standing collision risk between any
two concurrent test-db writers sharing the fixed fixture IDs in `test/helpers/db.ts`.**

It should **not** be retroactively applied as the explanation for the "four incidents in
four days" framing as a group. Checked directly: incident #4 shows no concurrent run at
the time it failed, and incidents #1–#3 have no individually-findable record to check
timestamps against at all. **Re-labeling verdict:**

- **Confirmed root cause, this session (2026-08-19/20 rehearsal row-churn):** shared-fixture
  concurrent-writer collision. Real, checked, closed.
- **Incident #4 (2026-08-15):** root cause remains UNRESOLVED per CLAUDE.md's existing
  classification. The shared-writer mechanism is a candidate that was checked and RULED
  OUT for this specific incident (no concurrent run existed). Do not carry it forward as
  the explanation for #4.
- **Incidents #1–#3:** no individual record exists to classify at all. They should not be
  assumed to share a cause with #4 or with this session's collision, and should not be
  cited as corroborating evidence for either — there is nothing to cross-check.
- **"-732ms session-transition" incident:** unverifiable from the repo as it stands. Flag
  as unconfirmed rather than repeat it as established history.

**Recommendation, not itself authorized here:** if the underlying "test-db CI incidents"
tracking is worth keeping precise (and given CLAUDE.md's own repeated emphasis on
"checked, not assumed," it should be), the four-incidents phrase should be split into what
is actually known — one classified-but-unresolved incident (#4), one confirmed-but-separate
collision risk (this session's), and a documented gap where three earlier incidents were
never recorded individually. This document is the record of that gap; closing it (writing
down what #1–#3 actually were, if anyone still remembers) is a separate, optional action,
not undertaken here.
