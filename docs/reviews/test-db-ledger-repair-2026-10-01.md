# Test-db ledger repair: 042, 043, 044, 046 (2026-10-01)

Resolves `docs/reviews/048-review-package.md`'s U-5 finding ("042, 043, 044,
046 have no remote row on test-db") — referenced from here, not edited there,
per that document's own frozen-review-package handling.

Scope: test-db (`exfccwlrhoutkgrlikod`) `supabase_migrations.schema_migrations`
ledger ONLY, via `supabase migration repair --status applied`. No migration
SQL was executed. Prod (`jvxwqignooseazzmwhvl`) was never linked, queried, or
touched. Full raw command transcript: `~/Desktop/ledger-repair-042-046.txt`.

All steps below are **OBSERVED** (run live against test-db in this session)
unless explicitly labelled otherwise. The four function/schema hashes named
as targets to match (`09b4e083638d` for `apply_hindrance_flow_turn`,
`0b27674f3e9c` for `claim_media_nudge`) are **prod baseline per Aravind,
2026-10-01** — supplied as the comparison target, not independently
re-derived against prod in this session (prod was off-limits for this task).

## Step 1 — target

```
$ supabase link --project-ref exfccwlrhoutkgrlikod
{"project_ref":"exfccwlrhoutkgrlikod","message":""}

$ cat supabase/.temp/project-ref
exfccwlrhoutkgrlikod
```
Matches the required ref exactly. OBSERVED.

## Step 2 — positive control + presence

**2a — positive control** (`service_role` DELETE on `daily_log_photos`,
expected TRUE per the test-db-only grant exception in CLAUDE.md §6/§7):

```sql
select has_table_privilege('service_role','public.daily_log_photos','DELETE') as grant_delete;
```
Result: `grant_delete: true`. OBSERVED.

**2b — presence + hash query**, all 9 rows, run before any repair:

| m | ok | h |
|---|----|----|
| 042 | true | — |
| 043 | true | — |
| 043 | true | — |
| 043 | true | — |
| 044 | true | — |
| 044 | true | — |
| 044 | true | `09b4e083638d` |
| 045 | true | `0b27674f3e9c` |
| 046 | true | — |

All `ok = true`. The `apply_hindrance_flow_turn` hash (`09b4e083638d`) and
the `claim_media_nudge` hash (`0b27674f3e9c`) both matched the prod baseline
(per Aravind, 2026-10-01) exactly. Per the ledger-gap-check methodology
(`~/Desktop/ledger-gap-check.sql`, probe-3), presence alone proves nothing
for a `CREATE OR REPLACE FUNCTION` — the hash match is the actual check
here, and it passed. OBSERVED.

Since every row passed, the repair proceeded per the task's own gate
("Any false, any hash mismatch, or (a) false → STOP, write nothing,
report" — none of those conditions were hit).

## Step 3 — ledger before

```sql
select version from supabase_migrations.schema_migrations where version >= '040' order by version;
```
Result: `040, 041, 045, 047, 048` — exactly the expected set, confirming
the gap at 042/043/044/046 named in U-5. OBSERVED.

## Step 4 — repair, one at a time

Ran `supabase migration repair --status applied <N> --linked` for `042`,
then `043`, then `044`, then `046`, reading the ledger back after each.
No `28P01` or other error on any of the four; no fallback to manual
`INSERT` was needed. Ledger after each step:

- after 042: `040, 041, 042, 045, 047, 048`
- after 043: `040, 041, 042, 043, 045, 047, 048`
- after 044: `040, 041, 042, 043, 044, 045, 047, 048`
- after 046: `040, 041, 042, 043, 044, 045, 046, 047, 048`

All OBSERVED, all exit code 0.

## Step 5 — ledger after + schema-unchanged re-check

Final ledger query returned exactly nine rows, `040` through `048`
inclusive, no gaps. OBSERVED.

Step 2b's presence/hash query was re-run in full afterward: all 9 rows
still `ok = true`, both hashes (`09b4e083638d`, `0b27674f3e9c`) unchanged
from the pre-repair run. `supabase migration repair` only writes the ledger
table — this re-check confirms the schema itself was not touched by the
repair, as expected. OBSERVED.

## Records corrected in the same change

- `docs/reviews/042-apply-record.md` — struck through the stale "Ledger
  repaired the same way as prod" claim; it was not, until this repair.
- `supabase/migrations/045_media_nudge_throttle.sql` header — struck
  through the stale HELD/not-applied/not-reviewed claims (045 was in fact
  applied to both test-db and prod on 2026-09-15, per
  `docs/reviews/045-test-db-apply-record.md` and
  `docs/reviews/045-prod-apply-record.md` — unrelated to this repair, just
  a stale comment caught in the same pass).
- `lib/whatsapp/inbound-start.ts` (two locations) and `lib/whatsapp/session.ts`
  (one location) — same 045 HELD/not-applied correction, comment-only.

All four are dated corrections (struck through, not rewritten), per
CLAUDE.md's standing correction discipline.

## Scope proof

`git diff --stat origin/main` and the two `.ts` files' `git diff -U0` (both
showing comment-only changes) are in the raw transcript,
`~/Desktop/ledger-repair-042-046.txt`.

## UNKNOWNS

- Why the test-db ledger was missing these four rows in the first place
  (whether the objects were created by hand, by an earlier interrupted
  apply, or some other path) was not investigated — out of scope for this
  repair, which only corrects the ledger to match observed reality.
- Whether any other migration number besides 042/043/044/046 has a similar
  test-db ledger gap was not swept in this pass; U-5 named only these four.
