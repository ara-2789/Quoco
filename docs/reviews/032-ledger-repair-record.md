# Migration 032 — ledger repair record (2026-08-31)

Metadata-only fix. No schema change, no DDL, no data write — this record
covers exactly one command: repairing `032_session_transition_lock_probe_
nowait.sql`'s missing `supabase_migrations.schema_migrations` row on
production. First flagged while fingerprinting production for migration
034's own apply (`docs/reviews/034-apply-record.md`'s "Separate finding"
section); repaired here, on direct instruction, as its own item.

## Repair, executed

Breadcrumb-then-relink discipline followed throughout — project ref printed
immediately before each command, never assumed from earlier in the session.

1. Confirmed `032_session_transition_lock_probe_nowait.sql` is already a
   real, merged file in `supabase/migrations/` (`ls supabase/migrations/ |
   grep 032` → present) — **not** a held file per the BB2 convention, so
   the copy-temp-remove workaround 031/033/034 all needed does not apply
   here. `supabase migration repair` could resolve the version directly
   against the working tree with no extra step.
2. `supabase link --project-ref jvxwqignooseazzmwhvl` → breadcrumb probe
   (`SELECT current_database(), now()`) confirmed live against production
   before proceeding.
3. `supabase migration repair --status applied 032 --linked` →
   `Repaired migration history: [032] => applied`.
4. Post-repair probe, production: `ledger_count: 30`, `ledger_has_032: 1`.
   Full version list: `001-007, 011-025, 027-034` (030 rows total — every
   prior version plus 032 and 034, matching the state after this session's
   two ledger repairs).
5. Re-linked to test-db (`exfccwlrhoutkgrlikod`) — breadcrumb probe
   confirmed. Checked test-db's own ledger for the same gap:
   **test-db already had 032 correctly ledgered** (`ledger_count: 30`,
   `ledger_has_032: 1`, identical version list to production post-repair).
   No test-db-side repair was needed — the gap was production-only.

## Why this happened

Root cause, stated plainly, not guessed at: **this project's sanctioned
apply path and its ledger-writing path are two independent operations with
no automatic link between them, and nothing before this session checked
that the second one actually happened.**

`supabase db query --linked -f <file>` (or a manual SQL Editor paste, the
other sanctioned path per CLAUDE.md's PROD APPLIES rule) sends raw SQL
directly to Postgres. It has no awareness of, and makes no write to,
`supabase_migrations.schema_migrations` — that table is the Supabase CLI's
own bookkeeping, and the *only* thing that writes to it under this
project's rules is a separate, manually-run `supabase migration repair`
command (`supabase db push` is banned outright, project-wide, precisely
because its own ledger-diffing logic is what caused the 026-adjacent
incident recorded elsewhere in CLAUDE.md). Applying a migration's SQL and
recording that it was applied are consequently two distinct human actions,
and until this session, nothing ever verified that the second one followed
the first. Migration 034's own apply — completed earlier this same
session — needed the exact same explicit repair step for the identical
reason; the difference is that 034's runbook (`docs/reviews/034-owner-
email-review-package.md` §11, step E) was written with that step named
in advance, so it wasn't missed. 032 predates that runbook structure
having a named ledger-repair step at all, and evidently nothing else was
watching for the gap at the time it was applied.

This is not a per-migration mistake to assign to one apply — it's a
structural gap in the apply *process* itself: any migration applied via
either sanctioned path can silently end up in this exact state, for as
long as verifying the ledger stays a manual, easy-to-skip afterthought
rather than a checked step.

## Can migration-lint catch this? No — stated precisely, not assumed

`scripts/lint-migrations.mjs` is a static, file-only tool: it reads
`supabase/migrations/*.sql`, `docs/reviews/^\d+_.*\.sql`, and the two JSON
manifests (`migration-lint-exceptions.json`,
`migration-number-reservations.json`). It runs in CI with no database
connection, no credentials, and (by design — CI must not hold prod
secrets) no network path to Supabase at all. `schema_migrations` is a
runtime fact of a specific live database; a tool that never connects to a
database cannot know it, structurally, not just by omission. **This is not
a gap lint failed to close — it's a category of check lint cannot perform
at all, regardless of how many rules are added to it.**

What this needs is a genuinely different check: a **live reconciliation
probe**, credentialed and DB-connected, that does for a real database what
this session did by hand twice now (against 034, then against 032) — read
`supabase_migrations.schema_migrations`, compare it against the version
numbers present as real files in `supabase/migrations/`, and print any
mismatch in either direction (file-but-no-ledger-row, or ledger-row-but-
no-file). Such a check would need to run against both prod and test-db,
requires the same credential-handling discipline as every other prod-
touching command in this project (breadcrumb, never backgrounded, printed
project ref before the query), and — because it needs live credentials —
cannot run in ordinary CI the way `lint-migrations.mjs` does. It would be
a manually-triggered script or a separately-secured scheduled job, not an
addition to the existing lint pass. **Not built in this pass** — this
section answers the question asked (can lint catch it, and if not, what
would), it does not implement the different check it describes.

## Scope check — is this the last one?

The item-2 sweep run alongside this repair (`docs/reviews/034-apply-
record.md`'s companion sweep, this session) compared every file in
`supabase/migrations/` against both ledgers post-repair and found no
further file-present-but-unledgered case, on either database. 032 was the
second instance of this class (after 033's own apply-time friction, which
did *not* leave a gap — 033's own row landed correctly) and, as far as a
full sweep of the current file set can confirm, is now closed.
