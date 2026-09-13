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

## Batch 3 — two-tenant family (closed, 2026-09-13)

**Scope:** `TEST_TENANT_A_ID`, `TEST_TENANT_B_ID`, `TEST_PROJECT_A_ID`,
`TEST_PROJECT_B_ID`, `TEST_007_USER_A_EMAIL`, `TEST_007_USER_B_EMAIL`
(`test/helpers/db.ts`, the migration-007 two-tenant RLS harness) migrated to
per-run derived values. `TEST_007_PASSWORD` stays a fixed literal,
deliberately — see below.

**The auth-user emails needed migrating too, and the reasoning is identical
to `TEST_ENGINEER_PHONE` in batch 2, one identity axis over.**
`auth.users.email` is `UNIQUE` (standard Supabase Auth schema). Before this
batch, `TEST_007_USER_A_EMAIL`/`B_EMAIL` were fixed literals, so
`ensureAuthUser()`'s lookup-by-email always found the same existing auth
user and updated it — an idempotent no-op across runs. The moment
`TEST_TENANT_A_ID`/`B_ID` became per-run while the emails stayed fixed, a
second run would find and reuse the FIRST run's already-existing auth user
(and the `public.users` profile `claimProfile()` had already claimed under
that first run's tenant) instead of creating its own — the exact collision
this migration exists to remove, just moved to the auth-identity axis.
Added `deriveRunScopedEmail()` (same SHA-256-derivation pattern as
`deriveRunScopedUuid()`/`deriveRunScopedPhone()`, formatted as
`zz-test-<12 hex chars>@quoco.test`) to close it.

**`TEST_007_PASSWORD` was NOT migrated, deliberately.** It carries no
uniqueness constraint anywhere and is never looked up by value — only used
to authenticate against an email that is now itself unique per run. There
is nothing for a shared literal password to collide on; migrating it would
be motion without a corresponding risk closed.

**The full red list, before the fix — there wasn't one.** Registered all six
retired literals (the four UUIDs, both emails), ran the lint, and it was
**green immediately**: `9 retired literal(s) checked, 0 stragglers under
test/`. Different outcome from batch 2's one straggler
(`test/unit/morning-dispatch.test.ts`), and worth stating plainly rather
than manufacturing a red list that didn't exist: no file in this family
hardcodes any of these six literals as a raw string outside
`test/helpers/db.ts` itself. Confirmed independently, not just trusting the
lint script's own claim: a direct `grep -rl` for all six literal values
across `test/**/*.ts`, excluding `db.ts`, returned zero matches.

**`ensureTwoTenantFixtures()`'s hardcoded slugs — the bug flagged ahead of
time in batch 2, fixed here as promised.** `tenants.slug`'s independent
`UNIQUE` constraint (`tenants_slug_key`) applied to this function the exact
same way it did to `ensureTestTenant()`: fixed `'zz-007-tenant-a'`/
`'zz-007-tenant-b'` literals, safe only as long as `TEST_TENANT_A_ID`/`B_ID`
stayed fixed (every call an UPDATE via `onConflict: 'id'`), broken the
moment they became per-run (every call a fresh INSERT, colliding on the
fixed slug after the first surviving row). Fixed the same way: both slugs
now include `getRunId()`.

**Guard (b) wired into `ensureTwoTenantFixtures()`, and proven to fire
again — same discipline as batch 2, not assumed to still work just because
it worked once.** Two `assertExactRowCount()` calls, one per tenant, both
checking `projects.tenant_id` after the project upserts (the same check
shape as `ensureMorningFixtures()`'s project check). Broke it the same way:
set `expected` to `999` for both, ran a real integration test
(`test/migration-015.test.ts`), got:

```
Error: assertExactRowCount FAILED (ensureTwoTenantFixtures, run 228b226d-4713-4df8-b4ce-f6a1f42be9ff):
expected exactly 999 row(s) in projects where tenant_id = 7392c346-0972-413b-9c7a-a82fb3701786, found 1.
This means the identifier is not actually isolated -- either it collided with another run's data, or a
stale/leftover row already exists under this exact value. Investigate before re-running; do not treat
this as flaky.
```

All 6 tests in that file skipped. Reverted immediately after.

**No orphan this time — a different, informative result from batch 2's
same check, not assumed clean.** Checked directly rather than skipped: after
reverting, queried for any `tenants` row whose slug contained this run's id,
and separately listed every `auth.users` row for a leftover `zz-test-`
email from this run. Both came back empty — `removeTwoTenantFixtures()`'s
own `afterAll` ran to completion despite the deliberate `beforeAll` throw,
cleaning up everything the broken guard call had already created (both
tenants, both auth users, both profiles, both projects) before the run
ended. Batch 2's own sensitivity check left a real orphaned tenant row
under the same shape of deliberate failure; this one didn't. Both are
genuine, observed outcomes — recorded as different results from the same
class of check, not reconciled into a single claim about whether `afterAll`
always runs after a failed `beforeAll` here, since the two files' hook
structures were not compared closely enough to explain the difference.

**Auth-user cost and rate limits — researched, not assumed, per the
explicit "do not assume either way" instruction.**

- **No documented rate limit exists specifically for the Admin API's
  `createUser`/`deleteUser`/`listUsers`.** Checked directly against
  Supabase's own current rate-limits documentation
  (`supabase.com/docs/guides/auth/rate-limits`, fetched 2026-09-13): every
  limit listed there is for the *public* auth endpoints (`/auth/v1/signup`,
  `/auth/v1/token`, `/auth/v1/otp`, etc.) — service-role-authenticated Admin
  API calls are a different surface and none of the documented limits apply
  to them by name. This is not the same claim as "unlimited" — no capacity
  ceiling being documented is different from one being confirmed absent —
  but there is nothing on record today that would throttle this batch's new
  behaviour (2 `createUser` + 2 `deleteUser` calls per run, versus the old
  behaviour of 2 total, ever, across the project's whole history).
- **A real, documented ceiling exists one level up: the project's MAU quota.**
  Checked against Supabase's current billing docs
  (`supabase.com/docs/guides/platform/billing-on-supabase`): Free plan
  includes 50,000 MAU/month, Pro/Team 100,000 before per-MAU overage
  charges begin. `jwtClient()` calls `signInWithPassword()` for both
  fixture users every run, which plausibly counts toward MAU if Supabase
  defines it by authentication activity (the standard industry definition)
  — the fetched page did not state its own counting methodology explicitly,
  so this is a plausible mechanism, not a confirmed one. **Not a blocking
  concern at today's scale** (even several hundred suite runs a day stays
  two orders of magnitude under the free-tier quota) but a real, monitorable
  cost this batch introduces where none existed before — worth a periodic
  glance at the project's own Auth usage dashboard, not something to assume
  is fine indefinitely as run volume grows.
- **The steady-state row count on `auth.users` should stay low** in the
  normal case (every run creates 2, deletes 2), but is now subject to the
  identical orphan-on-failure risk as every other fixture identity this
  migration touches — an interrupted run leaves 2 auth users behind instead
  of 0, the same shape as the tenant-slug orphan risk above, just not
  triggered this particular time.

**Verified — full raw results, batch 3:**
- `tsc --noEmit`, `eslint`: clean.
- `lint-retired-fixture-literals`: green immediately (`9 retired literal(s)
  checked, 0 stragglers`) — no red-to-green fix cycle needed this batch,
  confirmed independently via direct grep.
- Targeted re-run of all 10 two-tenant files: **10/10 files, 68/68 tests
  green** (first attempt, no fixes needed after the guard-b revert).
- Full suite: **1121 passed / 1 failed (93 files)** — the +4 over batch 2's
  1117 is exactly `deriveRunScopedEmail()`'s own unit tests; the one failure
  is the same pre-existing, already-documented `session-transition.test.ts`
  lock-wait flake, identical error text to every prior batch and the
  pre-batch-1 baseline.

## Batch-4 reassessment — requested explicitly, answered directly

**The corrected fact (batch 2): `whatsapp_sessions.phone_number` DOES carry
a real `UNIQUE` index (`uq_whatsapp_sessions_phone_number`, migration 012),
contradicting both design docs' original claim that no such constraint
existed.** Re-examined here, specifically for whether it changes what batch
4 should actually do, not just whether the earlier prose needed a footnote.

**The nest-under-a-run-scoped-prefix recommendation still holds.** Its
primary justification was never the (wrongly claimed) absence of a
constraint — it was that the phone-slot registry solves a *different*
problem than cross-run collision: two files in the *same* checkout picking
the same 3-digit slot, a coordination problem a per-mint `UNIQUE` constraint
does nothing to prevent, corrected fact or not. Two files in one run sharing
a slot would collide via the constraint too now (a real `23505` on the
second `seedSession()`/insert) — which is arguably an *improvement* on the
original silent-corruption framing for that failure mode, not a reason to
prefer a different design.

**What the correction genuinely does change: "fully randomise every phone
mint independently, discard the registry" is now a safer alternative than
originally assessed, if anyone wants to revisit it later.** The original
rejection leaned on "a random collision would corrupt silently, not error"
— that argument is retracted; a real collision now raises a real,
detectable error. But detectability alone doesn't make full randomisation
free: every phone-minting call site would still need explicit
retry-on-`23505` logic (the exact pattern `mintOutboundEngineer()` already
uses for `users.whatsapp_number`) to turn a now-detected collision into a
handled one rather than a hard test failure — that's real, non-trivial work
across roughly a dozen call sites, not a consequence of the corrected fact
either way.

**Recommendation for batch 4, unchanged:** nest the existing registry under
a run-scoped prefix. The corrected constraint fact removes one (weak, as it
turns out) argument that happened to point the same direction as the
recommendation already reached for a stronger, still-valid reason. Full
independent randomisation remains a legitimate future alternative — now
genuinely safer than this document previously implied — but is a larger
change than batch 4's current scope, not something this correction obliges
anyone to switch to.

## Batch 4 — phone registry, nested under a run-scoped prefix (closed, 2026-09-13)

**Scope:** `testPhone()` (`test/helpers/db.ts`) now inserts a run-scoped
5-digit block between the existing `TEST_PHONE_PREFIX` and the caller's own
3-digit slot — `${TEST_PHONE_PREFIX}${RUN_SCOPED_PHONE_BLOCK}${slot}` — via
a new `deriveRunScopedPhoneBlock(runId)`. Exactly the shape the batch-4
reassessment above confirmed: the ~98 hand-registered slots keep their
existing numbers and their existing job (telling two files in the *same*
run apart); only a run-scoped block gets nested in front of them, closing
the *cross-run* axis. Unlike every other constant this migration has
touched, there is no single named literal to "retire" here —
`TEST_PHONE_PREFIX` itself (`+19995550`) is unchanged and stays fixed
(it's the shared, recognisable, obviously-fake NANP space, not an
identity), and every one of the ~98 slot *numbers* (`'301'`, `'999'`, etc.)
is unchanged too. Nothing was added to `scripts/retired-fixture-
literals.json` this batch for that reason — there is no old literal value
that stops being valid; the function that combines the pieces changed, not
any of the pieces themselves.

**`TEST_ENGINEER_PHONE` (batch 2) is untouched by this change** — it never
went through `testPhone()`/`TEST_PHONE_PREFIX` at all, using its own
dedicated `+19995552` prefix via `deriveRunScopedPhone()` directly. The two
mechanisms remain independent, as designed since batch 2.

**Confirmed safe to lengthen the phone string before making the change, not
assumed:** checked `lib/whatsapp/normalise.ts` (the only place inbound
phone numbers get parsed) — it returns any string already starting with
`+` completely unchanged, no length or format validation that would reject
a longer value. Checked every `test/**/*.ts` file for code that slices or
measures a `testPhone()`-produced string expecting an exact length —
none found. Checked `cleanupTestSessions()`'s own `TEST_PHONE_PREFIX`
`LIKE` pattern (the batch-2 fix) — a trailing `%` matches any suffix length,
so it keeps correctly clearing the new, longer values with no changes
needed.

**No guard (b) wiring this batch, and that's a difference from batches 2/3
worth naming, not an oversight.** The phone registry has no single
fixture-seeding function the way `ensureMorningFixtures()`/
`ensureTwoTenantFixtures()` do — `testPhone()` is called ad hoc, per test,
across 13 files, each constructing its own session/user rows independently.
There is no one place to assert "this run's phone identity is exactly
right" the way there was a single tenant or a single engineer to check.
Verification here is necessarily behavioural (does the whole suite still
pass with the new, longer values) rather than a single assertion this
migration can point to.

**Verified — full raw results:**
- `tsc --noEmit`, `eslint`: clean.
- Targeted re-run of all 13 `testPhone()`-using files (re-verified fresh via
  `grep`, not the earlier research pass's count, since that list has drifted
  before — 001-count files this time): **12/13 files, 161/162 tests green.**
  The one failure is `test/session-transition.test.ts`'s pre-existing,
  already-documented lock-wait flake — the same flake every prior batch's
  *full-suite* run has hit, appearing here for the first time in a
  *targeted* run only because this is the first batch where that file is
  legitimately part of the target set (it calls `testPhone()`), not a new
  failure this batch introduced.
- Full suite: **1124 passed / 1 failed (93 files)** — the +3 over batch 3's
  1121 is exactly `deriveRunScopedPhoneBlock()`'s own unit tests; the one
  failure is the same pre-existing, already-documented
  `session-transition.test.ts` lock-wait flake, identical error text to
  every prior batch and the pre-batch-1 baseline.

## Batch 5 — CANCELLED, 2026-09-13 (not deferred — see below for why that distinction matters)

**Scope as planned:** a live check of sustained concurrent *write* load
(batch 1's read-only probe explicitly didn't cover this), then flipping
`fileParallelism: true` if it passed. **Part 1 ran; its result cancels Part
2 outright, not just postpones it.** Recorded here in full so the next
person who wonders "why isn't `fileParallelism` on" finds the reason
immediately, not a probe result buried in a chat transcript.

### Part 1 — sustained concurrent write probe, raw results

Two scenarios, both run against real test-db, both cleaned up after (checked
directly — zero leftover rows under either probe's own tenant/user prefix).

**Scenario A — independent concurrent lifecycles** (N workers, each running
its own full seed → two real `apply_morning_flow_turn` RPC calls → readback
→ teardown, against disjoint throwaway identities):

```
N=10:  {"successCount":10,"failureCount":0,"overallWallClockMs":16629,"sumOfIndividualLatenciesMs":164326}
N=20:  {"successCount":20,"failureCount":0,"overallWallClockMs":29035,"sumOfIndividualLatenciesMs":575221}
N=30:  {"successCount":30,"failureCount":0,"overallWallClockMs":41581,"sumOfIndividualLatenciesMs":1227427}
```

Zero failures at every N. **But latency grows roughly linearly with
concurrency, not flat**: median per-session time went 16.4s → 28.8s → 40.9s
as N went 10 → 20 → 30. N independent workers running "in parallel" each
took roughly N times as long as one worker alone would — the database's own
throughput ceiling (most likely a bounded connection pool; nothing errored
to name the exact mechanism, so this is the shape of the data, not a
confirmed cause) eats most of the parallel win before it reaches the test
suite. Graceful degradation, not failure — but not free capacity either.

**Scenario B — shared-identity lock contention** (one shared engineer/
session, N concurrent `apply_morning_flow_turn` calls all trying to start a
flow against the *same* phone number):

```
N=10: {"errorCount":0,"outcomeCounts":{"start":1,"reask":9},"overallWallClockMs":3889,"sumOfIndividualLatenciesMs":21140}
N=20: {"errorCount":0,"outcomeCounts":{"start":1,"reask":19},"overallWallClockMs":5580,"sumOfIndividualLatenciesMs":59478}
```

Per-caller latencies form a clean staircase (N=10: 398, 710, 1086, 1491,
1900, 2339, 2704, 3057, 3567, 3888ms) — `acquire_and_transition_session`'s
row lock serialises every concurrent caller into a strict queue. Zero
errors, zero deadlocks — this is graceful, correct locking behaviour, not a
bug in that RPC. It is, however, the decisive result for this batch.

### The finding, stated plainly: this is a correctness gap, not a speed gap

Batches 2-4 randomised **per RUN, not per FILE** — a deliberate, load-bearing
design choice (§ "The five decisions" above, and every batch's own "same
value across every file in the run" reasoning): all 20 morning-fixture files
within one run still share one derived engineer and one session row,
exactly as they did before this migration, so their existing cross-file
coordination stays intact. Sequentially (`fileParallelism: false`, today's
setting) that is entirely correct — one file's turn always fully commits
before the next file's `beforeAll` runs.

**Under `fileParallelism: true`, those 20 files become genuinely concurrent
OS processes that can interleave real RPC calls against that identical
session row.** Scenario B proves the row lock serialises rather than
corrupts that interleaving — no data gets silently mixed up. But
serialisation is not the same as isolation: two files whose calls happen to
overlap in time will each observe `current_step`/`current_flow` values that
reflect the *other* file's in-flight turn, not just their own. A test
asserting "after my own call, `current_step` is 2" can start failing (or
worse, start passing for the wrong reason) depending on unrelated timing
from a completely different file — **tests would pass or fail for reasons
unrelated to what they assert, which is exactly the green-but-meaningless
outcome this entire migration's two guards were built to catch.** Guard (a)
and guard (b) both operate on *identifier* correctness (is this run's value
actually this run's own); neither one, nor anything else built in batches
1-4, detects or prevents *inter-file* interleaving on a *shared* identity
within one run — that was never in scope, because `fileParallelism: false`
made it structurally impossible until this probe considered turning it on.

**The prerequisite this reveals, named for whoever revisits this:**
`fileParallelism: true` is only safe once every fixture family gives each
*file* — not each *run* — its own engineer/session identity. That is a
different, larger design than per-run randomisation: it means the 20
morning-fixture files can no longer coordinate through one shared row at
all, which several of them currently rely on intentionally (the very
"shared fixture" pattern this whole workstream started from). Scoping that
properly — which files actually need a shared identity versus which merely
inherited one because the registry was global, and what a per-file identity
scheme would need to preserve — is real, separate design work. **Not
attempted here, per explicit instruction**, and not something batches 1-4's
own guards were ever positioned to catch, since they weren't asked to.

### What batches 1-4 delivered, and what still stands

The primary goal was: two agents, or an agent and CI, can run the suite
simultaneously without collision or coordination. **That goal is met and is
unaffected by batch 5's cancellation.** Every fixture identifier that used
to be a single fixed literal shared forever now derives from a per-run id;
guard (a) proved it catches a straggler literal before it ships; guard (b)
proved it catches a broken derivation at fixture-setup time, twice, on real
integration tests, not just in unit tests. `fileParallelism` was always the
*second*, secondary win this workstream might unlock — cross-run isolation
was the first and the one actually asked for. Batch 5's cancellation costs
the speed win this document's own earlier sections flagged as "not yet
proven"; it does not undo anything batches 1-4 actually shipped.

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

## Acceptance test — attempted, blocked for a real structural reason, not run as a local approximation

**What it now proves, post-batch-5-cancellation:** cross-run isolation
specifically — two independent `vitest run` invocations, each getting its
own randomised identifiers, neither one's data appearing in the other's
counts. This is exactly the claim batches 1-4 actually make (§ "What
batches 1-4 delivered," above) — it does not, and was never going to, touch
the batch-5 finding (that's an *intra-run*, cross-*file* question, and this
test is about *inter-run* isolation).

**Per this project's own standing rule, this cannot be verified locally, and
this document does not pretend otherwise.** `docs/reviews/sandbox-cannot-
test-concurrency.md` already established, directly and empirically, that
this sandbox cannot sustain genuinely concurrent RPC dispatch against
test-db — by the time one probe request reaches Postgres, a second one fired
"at the same time" has often already finished. This needs two real,
independent CI runners.

**Investigated how to actually trigger two simultaneous CI runs — and found
a real, structural reason today's CI configuration cannot do it, checked
directly against the current workflow file, not assumed.**
`.github/workflows/ci.yml`'s `test` job carries:

```yaml
concurrency:
  group: ci-test-db-suite
  cancel-in-progress: false
```

The group's own comment states its reasoning explicitly and deliberately:
*"DO NOT add `${{ github.ref }}` ... to the group below ... The fixed
literal name below is what makes every run of this job, from every branch
and every trigger, queue behind whichever is already running,
project-wide."* This is not an accident or an oversight to route around —
it is a hardcoded, project-wide, trigger-agnostic serialisation, and it does
exactly what it says: two pushes, two PRs, any two triggers of this job at
the same moment queue, they do not overlap. **As currently configured,
GitHub Actions itself will never let two `Test (real test-db)` jobs run at
the same instant, regardless of what identifiers this migration uses.**

**This comment's own stated justification is now partly stale — worth
naming precisely, not silently acted on.** It cites "the fixtures this suite
writes to (`TEST_TENANT_ID`, `TEST_PROJECT_ID`, `TEST_ENGINEER_PHONE` —
fixed, deterministic UUIDs ... shared PROJECT-WIDE)" as the reason two
concurrent runs would collide — that description is no longer accurate;
those are exactly the identifiers batches 2 and 4 made per-run. But the
group has a second, independent justification that batches 1-4 don't touch
at all: `cancel-in-progress: false`'s own comment — *"queuing costs CI
minutes; cancelling costs test-db integrity"* — and, newly relevant, **Part
1's own probe result above**: sustained concurrent write load against this
same test-db shows real, roughly-linear latency growth even with zero
identifier collisions possible. Loosening this group wouldn't just enable
the acceptance test — it would let every future PR's CI run degrade every
other concurrent one's runtime, the exact cost Part 1 just measured
directly. The group is doing at least one job this migration didn't
obsolete.

**Not changed here.** Actually running two concurrent CI jobs would require
either a scoped, temporary override of this group (e.g., a one-off
differently-keyed group for exactly this test) or a second, separate
workflow definition outside this concurrency domain — either way, a real
change to shared CI infrastructure, which is exactly the kind of action this
project's own standing practice reserves for an explicit go-ahead, not a
default I should reach for while writing this section. **Reported, not
executed:** if a one-off unblock is wanted, say so and name which of the two
shapes above to use; until then, this is the plain structural reason the
acceptance test has not been run, in CI or otherwise.
