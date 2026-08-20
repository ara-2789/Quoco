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

---

## K2 — the writer, formally identified and directly re-confirmed (2026-08-20)

J1's finding (narrated only in commit `6c2cabf`'s message, never reported directly) is
re-derived here from fresh commands, plus one piece of evidence stronger than anything
available at the time: **a live, currently-running collision, caught in the act.**

**Q1 — is CI pointed at `exfccwlrhoutkgrlikod`?** Yes, confirmed two ways. `ci.yml`'s
`test` job injects `SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY`/
`SUPABASE_TEST_PROJECT_REF` from GitHub secrets (`ci.yml:118-121`). `test/setup/guard.ts`
(read in full) is a Vitest `globalSetup` hard allowlist — `ALLOWED_TEST_REF =
'exfccwlrhoutkgrlikod'`; it throws before any test runs if the resolved ref doesn't match,
covering both a misconfigured secret and a missing one. Not merely asserted by a comment —
the guard's actual source was read and it does what the comment claims.

**Q2 — was a run in flight during the observed churn window? Directly re-confirmed, live,
during this very investigation (2026-08-20):** `gh run list` showed run `32328979193`
(triggered by this session's own K1 push) with its `Test (real test-db)` job
**`in_progress`**, started `2026-08-20T03:42:49Z` — squarely inside K1's own fixture
window (setup ~03:35–03:41, edits at `03:45:12`/`03:45:31`). K1's isolated, freshly-
generated UUIDs meant this posed no risk to that exercise — but it is a first-hand,
real-time demonstration of the exact mechanism this workstream describes, not an
inference from logs after the fact.

**Q3 — does any workflow step apply migrations? No.** Read `ci.yml` in full: four jobs
(`typecheck`, `lint`, `migration-lint`, `test`), and not one of them runs
`supabase db push`, `supabase migration`, or any schema-applying command — `migration-lint`
only lints, the `test` job runs exactly `npm ci` then `npm test`. **This closes the
question directly: CI does not explain the 023/024/025/027/028 ledger-lag pattern.** That
remains fully attributable to the manual `supabase db query --linked -f` sessions this
project's own CLAUDE.md already documents — confirmed by absence, not merely re-asserted.

**Q4 — any other writer?** `.github/workflows/` contains exactly one file (`ci.yml`) — no
separate deploy/cron workflow exists. `vercel.json` and Vercel's own build process carry
no `SUPABASE_TEST_*` reference (grepped) — Vercel builds against prod env vars only, per
this project's own established `.env.local`-points-at-prod fact. `package.json`'s `test`
script is `vitest run` (single pass, not `--watch`) — no standing local-watch process is
baked into the repo. Residual risk not fully closed by this check: a developer manually
running `vitest --watch` locally, or any script (like `generate-one-dpr.ts`,
J7c) redirected at test-db by hand — neither is discoverable by grep, both are real per
this session's own history.

## K3 — sharper root-cause candidate: DETERMINISTIC same-row collision, not just interleaving

The surviving row from an earlier live check this session was CI's own fixture —
`tenants.id = 00000000-0000-4000-a000-00000000d013`, name **"ZZ Test Tenant
(session-transition suite)"**. That name is not a leftover label — it is `test/helpers/
db.ts`'s `ensureTestTenant()` writing the SAME literal name, via `upsert(..., {onConflict:
'id'})`, every single time any suite calls it. Checked, not assumed: `ensureTestTenant()`
is called by `ensureMorningFixtures()` (the morning-flow suite's own setup) — meaning at
least **two different test files independently `upsert` the identical row** as part of
their own `beforeAll`, and `test/productivity-reconciliation-mirror.test.ts` references
the same literal `TEST_TENANT_ID` constant directly (line 112) as a third.

**This is a sharper mechanism than generic "interleaved writes," and worth naming as its
own candidate, distinct from the general contention finding above:** an `upsert` with
`onConflict: 'id'` on a FIXED id means two overlapping suites don't merely observe each
other's transient state (the read-only-probe symptom this session's own row-churn
surprise showed) — they **write the identical row**, and whichever `afterAll`/teardown
runs last deletes or resets state the OTHER suite's own test assertions may still be
mid-flight on. This is deterministic collision on identity, not probabilistic timing
overlap — a stronger and more specific claim than "contention."

**Honest limit, not overclaimed:** this session's own J7a check (above) found NO concurrent
CI run active during incident #4's actual failure window, and found the "-732ms
session-transition" incident **unverifiable — it does not exist anywhere in this repo's
committed record.** This sharper mechanism does not retroactively confirm that incident
happened, or explain it, because there is nothing on record to explain. It IS a stronger
candidate mechanism than plain interleaving for *any future* incident matching that shape
(a session-transition or morning-flow suite failing in a way that looks like state was
pulled out from under it) — recorded here as a named, ready-to-check hypothesis for next
time, not as a solved case this time.

**Blast radius — checked, not assumed to be limited to one suite.** Grepped every
`test/*.test.ts` and `test/unit/*.test.ts` file for the `00000000-0000-4000-a000-...`
literal-UUID pattern this fixture family uses: **the pattern appears in at least 12
distinct test files**, not just `test/helpers/db.ts`:
`migration-016`, `migration-017`, `migration-019`, `migration-020`, `migration-023`,
`dpr-detail`, `dpr-generate-job`, `reactivation-db`, `checkin-escalations-sweep`,
`productivity-reconciliation-mirror`, plus `db.ts`'s own `TEST_TENANT_A_ID`/
`TEST_TENANT_B_ID`/`TEST_PROJECT_A_ID`/`TEST_PROJECT_B_ID` (the cross-tenant isolation
fixtures). **Two distinct risk tiers, not one, worth keeping separate:**
- **Cross-file collision (the sharper, worse tier):** `TEST_TENANT_ID` specifically is
  shared verbatim across at least three files (`db.ts`'s own morning-flow fixtures,
  `productivity-reconciliation-mirror.test.ts`, and whatever suite "session-transition"
  in its name originally referred to) — any two of these running concurrently
  (two different Vitest processes, a local run overlapping CI, or two CI runs from
  different PRs racing the `ci-test-db-suite` concurrency group at its boundary) collide
  on the identical row.
- **Self-namespaced-but-still-fixed (the broader, milder tier):** the other ~9 files each
  define their OWN distinct UUID suffix (e.g. `migration-023.test.ts`'s
  `...0230a1`/`...0230a2`/`...0230b1`), so they don't collide with EACH OTHER — but each
  one is still a fixed literal, identical on every invocation, so two overlapping runs of
  the SAME file (a local run of `migration-023.test.ts` overlapping a CI run of that same
  file) would collide exactly the way `TEST_TENANT_ID` did. This is the exact shape of
  this session's own original row-churn incident, just narrowed to single-file scope
  instead of the shared morning-flow tenant.

**Concrete fix, named, not implemented:** replace fixed literal UUIDs with per-run-derived
ones (e.g. seeded from `process.env.GITHUB_RUN_ID` in CI, or a random UUID generated once
per test process locally) across all ~12 files, not just `test/helpers/db.ts`. This is the
same shape as Option 4 in `ci-test-isolation-options.md` (J7b) — already evaluated there
as a partial fix (it doesn't address connection/lock-level contention) but now shown to
have a **larger surface than J7b described**: J7b evaluated it against `test/helpers/
db.ts` alone; this check shows the same fixed-ID pattern recurring independently in most
of the suite's other integration test files, so a real fix would be a wider migration
than J7b's write-up implied. **Not implemented here — write-up only, per instruction.**
