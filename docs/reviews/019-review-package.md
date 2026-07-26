# Migration 019 — daily_log_corrections — review package (round 2)

Rehearsal evidence for **019** (Rule 4.3 inline correction: `daily_log_edits` audit
table + `correct_daily_log` SECURITY DEFINER RPC). This is the **round-2** rehearsal
on a fresh branch off `main` (which includes 020), **supersedes the stale draft PR
#14**, and follows the 017/020 review-package pattern.

- Migration: `supabase/migrations/019_daily_log_corrections.sql`
- Tests: `test/migration-019.test.ts` (8 tests, T-019-01→08)
- Types: `types/database.ts` (regenerated post-apply; +75 lines, `daily_log_edits`
  + `correct_daily_log`)

## Provenance / pinning
- **Commit reviewed:** `9a4016138804611301980326be37de7b264baa21`
- **`git status --porcelain`:** *(empty — clean tree)*
- The migration file is **byte-identical** to the round-1 reviewed/approved version
  (git-verified: last & only change was the original `136d78b`; never revised after).

## Design decision set (what to verify against)
Not a fabricated N-item review — these are the decisions actually made in planning
and encoded in the migration:
1. **Scalar-only v1** — the 9 text/boolean/integer columns; the 8 JSONB deferred
   (enforced by the RPC column whitelist **and** the `column_name` CHECK).
2. **SECURITY DEFINER RPC** — `daily_logs` UPDATE + audit INSERT in one transaction.
3. **Scope-gap closed in the RPC** — `project_members` membership re-check for the
   target row's project (RLS `daily_logs_update` is tenant-wide → broader than DASH-03).
4. **PM-only v1, membership-gated** (admin/qs deferred).
5. **TOCTOU** — `SELECT … FOR UPDATE` before reading the old value.
6. **Plain FKs + pinned WHY-safe comment** (only the definer RPC writes; it copies
   `tenant_id` from the verified target — no client write path).
7. **No-op skip** — `new == old` → no write, no audit row.
8. **`daily_log_edits` as source of truth; DPR hook is doc-only; RLS SELECT-only,
   project-scoped; writes revoked.**
9. **Past-date corrections allowed** — rationale in design-decisions §3.3.

---

## Rehearsal sequence — and why it was necessary

The round-1 rehearsal ran on the standing test-db; round 2 needed a clean pre-019
state. The **originally-decided fresh Supabase branch was abandoned** because a fresh
branch is not a faithful prod clone: **two independent fresh branches both came up
missing `users.auth_id`** (007's `ADD COLUMN IF NOT EXISTS … REFERENCES auth.users(id)`
is silently no-op'd by Supabase's fresh-branch replay). Full finding + the resulting
§0 standing rule: **PR #17** / CLAUDE.md §0 ("REHEARSE ON A CLEANED EXISTING BRANCH").

So round 2 used **teardown-and-reuse of the schema-complete test-db** instead:

**teardown → prove-open → apply → prove-closed → types-regen**

1. **Teardown** (test-db `exfccwlrhoutkgrlikod`): `DROP TABLE daily_log_edits;
   DROP FUNCTION correct_daily_log(uuid,text,jsonb);` + `DELETE … schema_migrations
   WHERE version='019'`. Returned test-db to `…018, 020` applied / **019 pending** —
   matching prod's actual eventual state.
2. **prove-open** (before apply): all **8/8 tests fail with `PGRST202` (function not
   found)** — `correct_daily_log` genuinely absent — **and no fixture-setup errors**
   (confirming the schema-complete test-db has `auth_id`/`status`/`messaging_blocked`,
   unlike the fresh branches).
3. **apply**: `supabase db push` of 019 (out-of-order vs the already-applied 020 —
   `--include-all` territory; faithful to 019's eventual prod apply).
4. **prove-closed** (after apply): **8/8 pass** — see raw output below.
5. **types-regen**: `supabase gen types` → `types/database.ts` +75 lines, byte-identical
   to the round-1 regen; `Args {p_column, p_daily_logs_id, p_new_value: Json}`,
   `Returns: string`. (Gotcha: `Returns` is `string`, not `string | null`, though the
   no-op path returns NULL — handle null in the future Server Action.)

### prove-closed — raw output (test-db, post-teardown, post-apply)
```
✓ test/migration-019.test.ts (8 tests) 16161ms
   ✓ T-019-01: PM corrects a scalar on a member-project row → updated + one audit row (atomic)  1283ms
   ✓ T-019-02: boolean and integer casts work  1380ms
   ✓ T-019-03: SCOPE GAP — same-tenant NON-member project is rejected, no write  1221ms
   ✓ T-019-04: cross-tenant target is rejected, no write  1248ms
   ✓ T-019-05: disallowed columns (JSONB col + identity col) are rejected  1219ms
   ✓ T-019-06: no-op (new == old) returns null and records NO audit row  1120ms
   ✓ T-019-07: PM-only — a non-pm member is rejected  1377ms
   ✓ T-019-08: correction on a PAST date is allowed (§3.3, no date gate)  1226ms

 Test Files  1 passed (1)
      Tests  8 passed (8)
```
**Reading:** the whole invariant set holds on a real DB — the happy path writes +
audits atomically (T-019-01), **the scope-gap closure rejects a same-tenant
non-member with the RPC's own guard (T-019-03)** — the single most important test —
and cross-tenant / disallowed-column / no-op / PM-only / past-date all behave.

## Outstanding (before prod)
1. **Developer-friend review** — 019 carries a SECURITY DEFINER RPC + a genuine write
   path, so it's the same review tier as 007/015/017/020.
2. **Prod apply** (out-of-order vs 020 → `--include-all`, like the rehearsal), observe
   the PITR window first (§0), then **regenerate types against prod** and commit.
