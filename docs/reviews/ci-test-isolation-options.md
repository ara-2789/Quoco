# CI test isolation options — costs, and a recommendation (J7b)

**Status: write-up only, per the governing instruction. No option below has been
implemented. This document proposes; it does not decide or execute.**

**DISCREPANCY, RECORDED NOT RESOLVED (external review on migration 029, round 2, 2026-08-20):**
`test-db-reliability-workstream.md`'s K3 section counted **at least 12** test files matching
the fixed-UUID-fixture pattern (`00000000-0000-4000-a000-...` literals). The external
reviewer's own grep for `TEST_TENANT_ID|ensureTestTenant` under `test/` returned **9**.
Most likely explanation, NOT confirmed: pattern scope — K3's count searched for the
BROADER `00000000-0000-4000-a000-...` UUID-namespace literal (which also catches files
using their own distinct, self-namespaced fixed UUIDs, e.g. `migration-023.test.ts`'s
`...0230a1`/`...0230a2` suffixes, not just `TEST_TENANT_ID` itself), while the reviewer's
narrower pattern only catches files that reference `TEST_TENANT_ID` or `ensureTestTenant`
by name — a real, meaningful distinction (K3 itself already separated these into two risk
tiers: cross-file collision on the literal shared `TEST_TENANT_ID`, vs. self-namespaced-
but-still-fixed files that only collide with a concurrent run of themselves). **Do not
guess which count is "right"** — they may both be correct answers to two different
questions. Pin the exact file list (not just a count) when this CI-isolation workstream
actually opens, so whichever option gets implemented is scoped against a verified list,
not a re-derived grep that could disagree a third time.

## The problem this addresses

`test/helpers/db.ts` seeds fixtures under fixed, deterministic UUIDs
(`TEST_TENANT_ID`, `TEST_PROJECT_ID`, `TEST_PHONE_PREFIX = '+19995550'`), shared across
every branch, every PR, and any manual script pointed at test-db. `.github/workflows/
ci.yml`'s `test` job carries a project-wide `concurrency: {group: ci-test-db-suite,
cancel-in-progress: false}` specifically to serialize CI runs against each other — but
that only protects CI-vs-CI. It does nothing for CI-vs-anything-else (a local rehearsal
script, `generate-one-dpr.ts` misdirected at test-db, a future second CI workflow). This
session's own Phase 5 rehearsal collided with a live CI run for exactly this reason —
confirmed live, not hypothesized (see `test-db-reliability-workstream.md`, J7a).

Four options, evaluated on what each actually fixes and what it costs.

## Option 1 — Postgres service container from a structure-only schema dump

**Mechanism:** spin up an ephemeral Postgres instance per CI run (GitHub Actions'
`services:` block, a standard Postgres image), load it with a structure-only dump of the
real schema, run the suite against that instance instead of the shared test-db project.

**This reuses the exact methodology already proven this session (G1's corrected §7
dry-run rule):** `supabase db dump --linked --schema public --dry-run -f <file>` to
obtain the real `pg_dump` invocation, load it into a fresh instance, stub `auth.users`/
`auth.uid()` and the five roles (`postgres`, `anon`, `authenticated`, `service_role`,
`supabase_auth_admin`), install the `pgvector` extension. **One artifact — the
structure-only dump — now solves two problems: it's already required for the §7
pre-review dry-run, and it would be the seed for this CI container too.** No new
mechanism to invent; the dry-run pipeline built this session already produces exactly
what this option needs.

**What it fixes:** completely eliminates the shared-writer risk — every CI run gets its
own throwaway database, nothing to collide with, ever. Also removes CI's dependency on
the real test-db project being reachable/healthy at all (a separate, if smaller,
reliability win — test-db itself has no PITR and no accessible branching, per
CLAUDE.md's own "TEST-DB IS NOT CONFIDENTLY REBUILDABLE" entry).

**What it costs:**
- Setup: the GitHub Actions `services:` block plus a schema-load step in the workflow —
  moderate, one-time.
- Ongoing maintenance: the structure-only dump needs regenerating whenever the schema
  changes — but this is **already** a required step under the new §7 rule (every new
  migration needs a dry-run before entering a review package), so this is not new
  ongoing work, it's the same artifact serving a second purpose.
- Fidelity gap, named explicitly, not glossed: a fresh container built from a dump will
  NOT reproduce prod/test-db's actual data-dependent bugs (the fresh-branch `auth_id`
  replay bug CLAUDE.md already documents is exactly this class of gap — schema replay
  from scratch behaves differently from an incrementally-migrated real database in ways
  that are not fully understood). This option protects against fixture collision; it does
  NOT substitute for the "rehearse on a cleaned existing branch" discipline CLAUDE.md
  already mandates for migration rehearsals specifically. The two serve different
  purposes and both remain necessary.
- Postgres version parity must be maintained deliberately (G2's finding this session:
  local tooling was silently on PG16 while both real databases are PG17.6) — the service
  container image tag needs to be pinned and kept in sync, or this option quietly
  reintroduces the exact version-mismatch risk G2 just closed for the dry-run path.

## Option 2 — Supabase branching

**Mechanism:** each CI run provisions its own ephemeral Supabase branch, fully isolated.

**Status: BLOCKED.** `supabase branches list --project-ref <ref>` returned `403` on this
account this session — confirmed insufficient account privileges, not a transient error.
Even setting privileges aside, CLAUDE.md's own "REHEARSE ON A CLEANED EXISTING BRANCH, NOT
A FRESH PROVISION" rule documents that a freshly-provisioned branch has been directly
observed coming up **missing `users.auth_id`** despite `schema_migrations` recording the
migration that adds it as applied — an open, unconfirmed-mechanism defect filed with
Supabase. Using fresh branches for CI would inherit that same unconfirmed risk on every
single run, not as a rare rehearsal event but as routine CI behavior. **Not viable today
on two independent grounds — account access and a known, unexplained defect.**

## Option 3 — Serialization lock (an extension of the existing `cancel-in-progress: false` band-aid)

**Mechanism:** extend the existing CI-internal serialization to also gate any
non-CI writer (a local rehearsal, a script) — e.g. an advisory Postgres lock acquired
before any test-db write, checked by both CI and any manual tooling.

**What it fixes:** would have prevented this session's specific collision, if every
writer (including ad hoc local scripts) reliably acquired the lock first.

**What it does not fix, stated plainly:** this is opt-in enforcement, not structural
isolation — it only protects against a collision if every writer, present and future,
remembers to take the lock. A one-off script (exactly what triggered this session's
collision) is the failure mode most likely to skip it. It also does nothing for the
fidelity/rebuildability concerns Option 1 addresses as a side effect. This is a
band-aid, not a fix — worth doing as defense-in-depth if Option 1 is deferred, not as a
substitute for it.

## Option 4 — Unique-prefixed fixtures per run

**Mechanism:** replace `test/helpers/db.ts`'s fixed UUIDs with run-scoped identifiers
(e.g. derived from `GITHUB_RUN_ID`), so concurrent runs never touch the same rows.

**What it fixes:** row-level collision between concurrent writers using this pattern.

**What it does not fix:** database-level or lock-level contention is untouched — two
concurrent test runs against the same physical test-db instance still compete for the
same connection pool, the same WAL, the same resource limits; the "TEST-DB INCIDENT #4"
`ensureMorningEngineer` "no row returned" mechanism (a suspected RLS/RETURNING-visibility
gap, or a possible response-truncation under contention — see CLAUDE.md's own
classification) would not necessarily go away just because the fixture IDs stopped
colliding, since the suspected mechanisms are session/connection-level, not row-identity-
level. Also a wider migration than it first sounds: every test file, not just the
morning-flow helpers, would need auditing for any other place a fixed ID is assumed
(e.g. `test/migration-023.test.ts`'s dedicated fixtures, cross-referenced in
`029-dpr-versioning-review-package.md`'s own test list). **Partial fix, real migration
cost, does not address the deeper contention question.**

## Recommendation

**Option 1 (Postgres service container from the structure-only dump) is recommended.**
It is the only option that removes the shared-writer risk structurally rather than by
convention (unlike Option 3) or partially (unlike Option 4), it is not blocked (unlike
Option 2), and — the strongest practical argument — **it is not new work**: the exact
schema-dump pipeline it needs was already built and proven this session as the §7
dry-run mechanism. Building the CI container step is the second consumer of an artifact
that already has to exist and already has to be kept current.

**Named honestly, not a full substitute:** Option 1 does not replace the "rehearse
migrations on a cleaned existing test-db branch" discipline CLAUDE.md already requires —
those two protect against different things (unit/integration test contention vs.
migration-specific schema-replay fidelity) and should both stand. Option 3 is worth
adding as a cheap secondary guard for any writer that, for whatever reason, doesn't go
through Option 1's container — cheap, and it would have caught this session's specific
collision too.

This is a recommendation for Aravind's decision, not an authorization to build it — no
workflow file has been touched by this document.
