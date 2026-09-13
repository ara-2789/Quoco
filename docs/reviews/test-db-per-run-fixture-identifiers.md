# Per-run fixture identifiers — design, decisions, and batch progress

**Recorded 2026-09-13.** This is the build log for option (a) from
`docs/reviews/test-db-fixture-collision-inventory.md` §5 — per-run randomised
fixture identifiers, approved by Aravind after a design pass. That design pass
is not reproduced here; read it (the design-pass chat turn, and the inventory
doc's own §5) before this document. This file tracks the five decisions made,
the two non-negotiable guards, and batch-by-batch progress/results.

## The five decisions

1. **Run id via Vitest's `globalSetup` + `provide()`/`inject()`, not
   `process.env`.** Idiomatic, and does not depend on fork-vs-thread
   env-inheritance semantics staying true if the pool is ever reconfigured.
   Verified empirically before building anything (three throwaway Vitest
   experiments, deleted, never part of this repo): a plain module-level
   `crypto.randomUUID()` in a shared helper re-evaluates to a *different*
   value per test file — Vitest resets the module graph per file
   (`isolate: true`, the default) even with `fileParallelism: false`.
   `provide()`/`inject()` returned the identical value across files under
   both `fileParallelism: false` and `fileParallelism: true`, including when
   read at plain module top-level (not wrapped in a function) — so call
   sites don't need to become function calls. A fourth experiment (mutating
   `process.env` inside one test file, reading it unset from another) showed
   each file already runs in its own forked OS process today, proving
   `process.env`-based propagation would *also* have worked in this exact
   config — but that's an implementation detail of the `forks` pool, not a
   documented Vitest contract, so `provide()`/`inject()` is the one built.

2. **The outbound suite's own dedicated tenant/project
   (`OUTBOUND_TEST_TENANT_ID`/`OUTBOUND_TEST_PROJECT_ID`,
   `test/helpers/outbound-fixtures.ts`) are EXCLUDED from randomisation.**
   Stated explicitly so it reads as a decision, not an oversight: that
   namespace already doesn't collide with anything — it was carved out
   specifically to avoid the morning-flow shared tenant. Randomising it would
   not close a real risk; it would multiply an already-accepted debt item
   (`docs/reviews/outbound-sends-test-accretion.md`) onto a new axis. Today,
   one tenant + one project accumulate forever, because `outbound_sends`'
   `RESTRICT` FK into both makes them permanently undeletable the moment any
   row references them. Under per-run randomisation, every run would mint a
   *new* permanently-undeletable tenant + project pair instead of reusing the
   one that exists today. This suite's fixtures stay exactly as they are.

3. **The phone registry (`test/helpers/db.ts`'s `TEST_PHONE_PREFIX` +
   hand-registered slots) gets a run-scoped prefix nested on top of it — it
   is NOT fully randomised per mint, and the registry does not go away.**
   The registry protects against a different problem than cross-run
   collision: it exists so two *files in the same checkout* don't pick the
   same 3-digit slot without knowing about each other (the actual incidents
   recorded in `db.ts`'s own comments: `checkin-escalations-sweep.test.ts`
   vs. `outbound-trigger.test.ts`, both hand-picking `03XX`). Per-run
   randomisation does not touch that axis at all — it only closes the
   *cross-run* axis (two separate process invocations both hardcoding the
   same fixed slot, today's actual live incident class). Nesting the
   existing slots under a run-scoped prefix closes the cross-run axis with
   effectively zero added collision risk, without discarding the registry's
   real, permanent job. Fully randomising every mint independently was
   considered and rejected: `mintOutboundEngineer()`'s retry-on-collision
   pattern (`test/helpers/outbound-fixtures.ts`) only works because
   `users.whatsapp_number` carries a real `UNIQUE` constraint (confirmed,
   `001_core_schema.sql:44`) that raises Postgres `23505` on a genuine
   collision.

   **Correction, 2026-09-13, found live during batch 2.** This decision
   originally claimed `whatsapp_sessions.phone_number` "has no unique
   constraint at all," checked only against `001_core_schema.sql`'s original
   `CREATE TABLE`. **That check was incomplete, not wrong about what it
   looked at** — a later migration adds one: `uq_whatsapp_sessions_phone_
   number`, an unconditional `CREATE UNIQUE INDEX` on `phone_number` with no
   `WHERE` clause (`012_whatsapp_session_transition.sql:33-34`, added
   specifically so `ON CONFLICT (phone_number)` has an arbiter to satisfy).
   Found the hard way, not by re-auditing: batch 2's own
   `cleanupTestSessions()` fix (see that batch's own section below) exposed
   `test/webhook.test.ts` hitting this exact constraint on a re-seed attempt.
   **Consequence for this decision:** a genuine random collision on
   `phone_number` WOULD now error (a real `23505`, not silent corruption) —
   the collision-detection argument against full per-mint randomisation is
   weaker than originally stated. The decision to nest under a run-scoped
   prefix rather than fully randomise still stands, but for a narrower
   reason than "no way to detect a collision at all": the registry's real,
   permanent job (intra-run/intra-codebase slot coordination, not detection)
   is the actual reason it stays, argued correctly elsewhere in this same
   decision; the detection-gap argument should not have been load-bearing
   and is retracted as stated.

4. **Skip Vitest's `projects`/workspace partial-parallelism idea.**
   Unverified in this exact setup, and the migration (4 batches) is short
   enough not to need a mid-flight speed win badly enough to justify
   building and proving a second mechanism just for the transition window.

5. **Connection/request-load capacity against test-db gets a live check
   after batch 1, before the parallelism flag is ever touched** — not
   assumed. Test-db's actual plan-level capacity is not something this
   project has previously measured under concurrent load.

## The two non-negotiable guards

Built in batch 1, before any fixture family migrates. The danger they exist
for: a straggler call site keeps resolving to an old, shared, fixed literal
after its family is declared migrated. That call site's own assertions are
scoped by the same wrong identifier, so the suite goes green anyway — for the
wrong reason. A green suite cannot detect this by construction; only a
mechanical, independent check can.

**Guard (a) — a lint rule with no exceptions mechanism.**
`scripts/lint-retired-fixture-literals.mjs` + `scripts/retired-fixture-
literals.json`. The JSON file lists every literal a fixture family's
migration has retired; the script scans every `.ts`/`.tsx` file under
`test/` (comments stripped) and fails, listing every hit, if a retired
literal still appears anywhere. Wired into CI as its own job
(`fixture-literal-lint`, `.github/workflows/ci.yml`) and its own npm script
(`lint:fixture-literals`), matching `lint-migrations.mjs`'s own Rule 9
precedent exactly — same "no exceptions, a finding means fix the call site"
philosophy.

Ships in batch 1 with the retired-literals list **empty** — nothing has
migrated yet, so there is nothing to retire. The mechanism itself was proven
before shipping: temporarily added `TEST_TENANT_ID`'s real, currently-live
value to the list, ran the script, confirmed it found **two** real hits —
`test/helpers/db.ts` (the constant's own definition, expected) and
`test/unit/morning-dispatch.test.ts` (unexpected, and a genuinely useful
find: a pure-function unit test that embeds the identical UUID as inline
mock data for a fake session object, never touching real test-db at all, and
therefore never surfaced by the original inventory's constant-import-based
grep methodology). Reverted the list to `[]` afterward and confirmed clean
again. This is direct, working evidence that literal-string scanning finds
call sites that "which files import which constants" scanning cannot —
`morning-dispatch.test.ts` was never on the "32 files touching a shared
identifier" list in the inventory doc, because it doesn't import
`TEST_TENANT_ID`; it just happens to contain the identical raw string. It
poses no real isolation risk (no database is involved), but batch 2's actual
migration work will need to touch it too, once `TEST_TENANT_ID`'s literal is
retired for real, or this guard will correctly, and rightly, block on it.

**Guard (b) — a row-count assertion inside the fixture helper itself.**
`assertExactRowCount()`, `test/helpers/run-scoped-fixtures.ts`. After a
fixture helper seeds a row under this run's identifier, it calls this to
assert `count(*)` under that exact identifier equals precisely what this run
itself created — no more, no less. This is the check that catches silent
isolation failure, because it does not rely on the suite's own downstream
assertions (which are scoped by the same possibly-wrong identifier and
cannot tell the difference on their own). A mismatch means either a genuine
collision with another run, or a leftover row nobody cleaned up — the
function's own error message says explicitly not to treat either as flaky
and re-run.

Not yet wired into any real fixture helper — `ensureMorningFixtures()`,
`ensureTwoTenantFixtures()`, etc. all keep calling nothing new this batch.
It is exported, unit-tested (a fake minimal client implementing just the
`.from().select().eq()` chain it needs, covering the match/over-count/
under-count/query-error cases), and ready for batch 2 to call.

## Batch 1 — mechanism only

**Scope:** `test/setup/run-id.ts` (new `globalSetup` module, mints one
`crypto.randomUUID()` per `vitest run` invocation and `provide()`s it),
wired into `vitest.config.ts`'s `globalSetup` array alongside the existing
`guard.ts` (untouched). `test/helpers/run-scoped-fixtures.ts` (new):
`getRunId()` (wraps `inject()`), `deriveRunScopedUuid(runId, label)` (a
pure, deterministic SHA-256-based derivation — explicitly documented as
*not* real UUID v5, just a stable 128-bit hash formatted into UUID syntax,
since Postgres only cares about the 8-4-4-4-12 hex shape), and
`assertExactRowCount()` (guard (b), above). Both guards, plus unit tests for
all three exported functions in `test/helpers/run-scoped-fixtures.ts`
(`test/unit/run-scoped-fixtures.test.ts`, 10 tests).

**Explicitly NOT in scope:** `TEST_TENANT_ID` and every other constant in
`test/helpers/db.ts` keep their current literal values. Zero behaviour
change to any existing fixture. Nothing calls `deriveRunScopedUuid()` or
`assertExactRowCount()` from real fixture code yet.

**Results — reported as raw output, not narrated, per Aravind's own
instruction; see the PR description / chat report for the literal command
output.** `tsc --noEmit` clean; `lint-retired-fixture-literals` proven RED (2
hits) with a real literal temporarily registered, GREEN (0 registered) in
its real batch-1 state; `lint-migrations` and `check-file-sizes` both still
clean; `eslint` clean on every new file. Full suite before this batch: 1103
passed / 1 failed (92 files). Full suite after: **1113 passed / 1 failed (93
files)** — the +10 tests/+1 file is exactly `test/unit/run-scoped-
fixtures.test.ts`, the only new test file this batch adds; every
pre-existing test's pass/fail outcome is unchanged, including the one
failure (`session-transition.test.ts`'s pre-existing, already-documented
lock-wait flake — same test, same error text, both runs).

**Connection-capacity check — method and result.** Not a proof of
concurrent-load capacity under this project's own standing sandbox
limitation (`docs/reviews/sandbox-cannot-test-concurrency.md`) — that
finding is about this sandbox's inability to guarantee precise interleaved
RPC *dispatch* for a race condition; firing N independent, uncorrelated
*read* requests via `Promise.all` is a different, weaker claim this sandbox
can genuinely exercise (ordinary concurrent HTTP request pipelining, not a
race). Method: `createClient` against `SUPABASE_TEST_URL` (same client shape
as `testClient()`), fire N concurrent `tenants.select('id').limit(1)`
requests via `Promise.all`, measure wall clock vs. the sum of individual
latencies (a large gap between the two is itself evidence the requests
genuinely overlapped, not just that they all eventually returned).

- N=30: `{"successCount":30,"failureCount":0,"overallWallClockMs":1016,"sumOfIndividualLatenciesMs":22857}`
- N=80: `{"successCount":80,"failureCount":0,"overallWallClockMs":1100,"sumOfIndividualLatenciesMs":58398}`

Zero failures at either N; wall clock barely moved between 30 and 80
concurrent requests (1016ms → 1100ms) while the sum of individual latencies
nearly tripled (22.9s → 58.4s) — strong evidence the requests were genuinely
overlapping, not serialised. **This clears the read-request axis with real
margin.** It does **not** clear the actual question batch 5 needs answered:
sustained concurrent *write* load from two full parallel Vitest suites (many
inserts/updates/deletes per file, held connections across a whole test's
lifetime, not one-shot reads) is a different load shape this probe does not
exercise. Recorded as a real result, not a substitute for re-checking before
batch 5 flips `fileParallelism: true`.

## Batch 2 — morning-fixture family (closed, 2026-09-13)

**Scope:** `TEST_TENANT_ID`, `TEST_PROJECT_ID`, and `TEST_ENGINEER_PHONE`
(`test/helpers/db.ts`) migrated to per-run derived values, using batch 1's
mechanism. Every file that merely *imports* these constants (rather than
hardcoding a literal) needed zero code changes — the moment `db.ts` changed,
every importer picked up the new derived value automatically. Actual edits
landed only in `test/helpers/db.ts`, `test/helpers/run-scoped-fixtures.ts`
(a new `deriveRunScopedPhone()`, and a signature change to
`assertExactRowCount()` — see below), and the one straggler the lint found.

**`TEST_ENGINEER_PHONE` was included, deliberately, beyond the letter of
"migrate the tenant and project."** Read as "the shared engineer... derived
from that fixture," not as part of the general phone-slot registry deferred
to batch 4 — because leaving it as a fixed literal would have silently
defeated the whole point of randomising the tenant/project: `users.
whatsapp_number` is `UNIQUE`, so a second run's `ensureMorningEngineer()`
would find and reuse the FIRST run's still-existing engineer row (and its
now-stale `tenant_id`) instead of creating its own — the exact collision
this migration exists to remove, just moved from the tenant/project axis to
the engineer-identity axis. Given a dedicated, disjoint prefix
(`+19995552NNNNNN`, `deriveRunScopedPhone()`) so it can never collide with
the batch-4 registry (`+19995550NNN`) or the outbound suite's own range
(`+19995551NNNNNN`) — reserved in `test/helpers/db.ts`'s own comment block
alongside the outbound suite's reservation.

**The full red list, before the fix, exactly as requested — 2 hits, one
file:**
```
lint-retired-fixture-literals: 2 retired literal(s) still referenced under test/:

  test/unit/morning-dispatch.test.ts: "00000000-0000-4000-a000-00000000d013" (TEST_TENANT_ID ...)
  test/unit/morning-dispatch.test.ts: "+19995550200" (TEST_ENGINEER_PHONE ...)
```
Exactly the file batch 1's own sensitivity check had already flagged as a
non-obvious catch. Confirmed harmless on inspection: a pure-function test for
`dispatchMorningFlow` (no `testClient()`, no database), building a fake
`WhatsAppSession` mock object that happened to embed the same literal
strings as real fixture values, coincidentally, not by dependency. Fixed by
swapping both to arbitrary, clearly-non-colliding placeholder values (a
comment now explains why) — not derived from a run id, because this file
never touches a database for that to matter. Lint went green afterward: `3
retired literal(s) checked, 0 stragglers under test/`.

**Guard (b), first real use — confirmed to fire, not just built.**
`assertExactRowCount()` needed a signature change during this wiring:
passing the real `SupabaseClient` against the batch-1 `CountableClient`
interface triggered TypeScript's "Type instantiation is excessively deep and
possibly infinite" against Supabase's own generic query-builder chain.
Fixed by having the function take a pre-built `query: () => PromiseLike<...>`
callback instead of `{client, table, column}` pieces — the caller builds the
actual (correctly-typed) query itself, keeping Supabase's client type
entirely out of the guard's own signature. Wired into `ensureMorningFixtures()`
twice: once for the engineer (`users.whatsapp_number = TEST_ENGINEER_PHONE`,
expected 1) and once for the project (`projects.tenant_id = TEST_TENANT_ID`,
expected 1). **Proven to actually fire against real test-db**, the same
"break it on purpose, observe the failure, revert" discipline used for the
lint's own sensitivity check: temporarily set the project check's
`expected` to `999`, ran `test/morning-flow.test.ts`, and got —

```
Error: assertExactRowCount FAILED (ensureMorningFixtures, run e3040e61-53af-4610-be2c-84cd586a4e88):
expected exactly 999 row(s) in projects where tenant_id = 0fe6dbd2-00e5-4fe6-8e70-301152f82fd0, found 1.
This means the identifier is not actually isolated -- either it collided with another run's data, or a
stale/leftover row already exists under this exact value. Investigate before re-running; do not treat
this as flaky.
```

All 19 tests in that file were skipped — `beforeAll` aborted before any test
body ran, rather than letting 19 tests execute against a fixture the guard
had just proven was not what it claimed to be. Reverted to `expected: 1`
immediately after; re-ran clean. **What it would do if a real straggler
survived:** exactly this — a specific, named, immediate failure at fixture
setup, naming the run id, the exact identifier, and the expected-vs-found
counts, instead of 19 tests quietly passing or failing for reasons unrelated
to what they claim to test.

**Two real bugs found and fixed, both direct, unavoidable consequences of
`TEST_TENANT_ID` becoming genuinely different every run instead of one
eternal literal — not found by inspection, found by the full suite actually
failing:**

1. **`cleanupTestSessions()` stopped clearing the engineer's own session
   rows.** It deletes by `.like('phone_number', TEST_PHONE_PREFIX + '%')`
   — but `TEST_ENGINEER_PHONE` now lives under a *different* prefix
   (`+19995552...`, deliberately disjoint from `TEST_PHONE_PREFIX`'s
   `+19995550...`). Surfaced as `test/webhook.test.ts` hitting
   `uq_whatsapp_sessions_phone_number` (a real UNIQUE index — see the
   correction to decision 3, above) on a re-seed attempt within the same
   file. Fixed: the delete now also matches `TEST_ENGINEER_PHONE` exactly,
   via `.or(...)`, alongside the existing LIKE pattern.
2. **`ensureTestTenant()`'s `slug` column was still one fixed literal.**
   `tenants.slug` carries its own independent `UNIQUE` constraint
   (`tenants_slug_key`). Before this batch, `TEST_TENANT_ID` was one fixed
   literal, so this `upsert`'s `onConflict: 'id'` always matched the same
   existing row and was an UPDATE, never a fresh INSERT — the fixed slug
   never had a chance to collide with itself. The moment `TEST_TENANT_ID`
   became per-run, every run's first call became a genuine INSERT (that id
   has never existed before), and a fixed slug string meant every run after
   the first would collide on `tenants_slug_key` the instant any earlier
   run's row survived its own teardown — concretely, how this was actually
   found: a tenant row orphaned by this batch's OWN guard-(b) sensitivity
   check above, which deliberately threw before `removeTestTenant()` could
   run. Fixed: the slug is now `zz-test-session-transition-${getRunId()}`,
   varying with the run for the same reason the id does. The orphaned row
   this incident itself created (`id 07c8eff1-e44b-4e58-af7b-0b1ec90d6181`,
   confirmed zero references from any table with a non-cascading FK into
   `tenants` before deleting) was cleaned up directly, pinned to its exact
   id and slug.

**Flagged for batch 3, not fixed now — out of scope, but the identical shape
of bug 2 above already exists there too, waiting:** `ensureTwoTenantFixtures()`
(`test/helpers/db.ts`) upserts `tenants` with hardcoded `slug` values
(`'zz-007-tenant-a'`/`'zz-007-tenant-b'`) the same way `ensureTestTenant()`
used to. It is not a live bug today, because `TEST_TENANT_A_ID`/`B_ID` are
still fixed literals — but the moment batch 3 migrates those to per-run
values, this will need the identical fix (a run-scoped slug) or it will fail
the same way, on the first run after the first.

**Verified — full raw results:**
- `tsc --noEmit`, `lint-migrations`, `check-file-sizes`, `eslint`: all clean.
- `lint-retired-fixture-literals`: **RED** (2 hits, listed above) before the
  `morning-dispatch.test.ts` fix, **GREEN** (`3 retired literal(s) checked, 0
  stragglers`) after.
- Targeted re-run of all 20 morning-fixture files (after both bug fixes):
  **20/20 files, 218/218 tests green.**
- Full suite: **1117 passed / 1 failed (93 files)** — the +4 tests over
  batch 1's 1113 is exactly `deriveRunScopedPhone()`'s own unit tests; every
  pre-existing test's outcome unchanged, including the one failure (the same
  pre-existing, already-documented `session-transition.test.ts` lock-wait
  flake, unrelated, identical error text to batches 1 and the pre-batch-1
  baseline).

## Known limit, recorded plainly, not overlooked

Four production queries scan every `status = 'active'` project with **no
tenant filter at all**:

| Function | File |
|---|---|
| `runDprGenerateTrigger` | `app/api/cron/dpr-generate/route.ts:66-68` |
| `runOwnerSendTrigger` | `app/api/cron/owner-send/route.ts:91-93` |
| `runCheckinEscalationTickSweep` | `lib/checkin-escalations/sweep.ts:185-187` |
| `fetchActiveProjects` (feeds `runCheckpointTrigger`, called by both morning- and evening-trigger crons) | `lib/whatsapp/outbound/roster.ts:285-286` |

Three test files exercise these against real test-db: `dpr-generate-
trigger.test.ts`, `owner-send-trigger.test.ts`, `unit/checkin-escalations-
sweep.test.ts` (`fetchActiveProjects` has zero real-test-db coverage today —
`unit/outbound-checkpoint-trigger.test.ts` and `unit/outbound-roster.test.ts`
are both fully mocked).

**Randomising the tenant or project identifier does not isolate these three
files, and cannot.** None of the four queries filter by tenant at all — they
scan the whole table. Two concurrent runs, each with its own randomised
tenant/project, still see each other's active projects the instant either
query runs, because the scan has no identity boundary to randomise against.
This is a structural limit of option (a), not a bug in these test helpers —
the scan behaviour is real, intentional production logic (a small-tenant-
count beta scanning the whole table rather than per-tenant). Only full
database isolation (option (b), a per-run/per-CI-run ephemeral Postgres
instance) removes the shared table these three files' assertions could ever
be corrupted by. **These three files remain collision-prone after this
entire migration lands — accepted, not overlooked, and not something batch
2/3/4 will attempt to fix.**

## Corrections to `docs/reviews/test-db-fixture-collision-inventory.md`

Recorded there as dated notes, cross-referenced here:

- The phone registry has **98** distinct `testPhone('NNN')` slot values in
  live use today, not "~40" — that figure was the compressed *range* list in
  `db.ts`'s own comment block, not a literal count of distinct values ever
  taken by that grep.
- That document's own §5 description of option (a) claimed randomisation
  "removes the need for the registry entirely, a genuine simplification."
  **That claim is wrong**, per decision 3 above — the registry's real job
  (intra-run/intra-codebase slot coordination) is untouched by per-run
  randomisation; only the cross-run axis closes.

## Acceptance test — not run here, deliberately

Two real, simultaneous `vitest run` invocations against the same test-db,
with an explicit post-hoc check that neither run's data appears in the
other's counts. This is the actual proof the whole migration exists to
deliver, and it belongs in CI, not this sandbox — `docs/reviews/sandbox-
cannot-test-concurrency.md` already established, directly and empirically,
that this sandbox cannot sustain genuinely concurrent RPC dispatch against
test-db (by the time one probe request reaches Postgres, a second one fired
"at the same time" has often already finished). A local claim of having
verified concurrency here would not be evidence; this document does not make
one. Scheduled for after batch 4, once every migrating fixture family is
actually using run-scoped identifiers.
