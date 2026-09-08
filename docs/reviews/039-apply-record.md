# Migration 039 — production apply record (2026-09-08)

Companion to `docs/reviews/039-review-package.md` (the external review
package — round 2, column-privilege fix, all raw rehearsal output) and
`supabase/migrations/039_hindrance_acknowledgement.sql` (the applied file
itself, carrying both rounds' full rehearsal records inline). **Applied by
Claude Code, `supabase db query --linked -f`, per Aravind's explicit
go-ahead in the same exchange (CLAUDE.md's PROD APPLIES condition (c)).**

## Sequence followed, in order

1. **PITR observed live**, before anything else. `supabase backups list
   --project-ref jvxwqignooseazzmwhvl`:
   `{"region":"ap-southeast-2","walg_enabled":true,"pitr_enabled":true,"backups":[],"physical_backup_data":{"earliest_physical_backup_date_unix":1788280299,"latest_physical_backup_date_unix":1788860012},"message":""}`
   — decoded: earliest backup Tue Sep 1 22:01:39 IST 2026, latest Tue Sep 8
   15:03:32 IST 2026 (~1h43m before the apply). Live continuous restore
   window confirmed by direct observation, not a checklist line.
2. **Reservation re-verified at current `origin/main` HEAD**, not just at
   the branch-cut commit. `git fetch origin` → `origin/main` unchanged at
   `d137bbf`. `git show origin/main:scripts/migration-number-
   reservations.json` → entries 026/034/035 only, no `039` (expected — that
   reservation lives on the feature branch, not yet merged). `git ls-tree
   -r --name-only origin/main -- supabase/migrations/` tops out at `038`.
   No collision. Also re-scanned every sibling worktree under
   `.claude/worktrees/` for a competing `039` file — none found.
3. **Promoted** `docs/reviews/039_hindrance_acknowledgement.sql` →
   `supabase/migrations/039_hindrance_acknowledgement.sql` via `git mv`,
   its own commit (`0e4bc3d`), zero content changes (`0 insertions(+),
   0 deletions(-)`, confirmed a clean rename by `git status --porcelain`
   before committing).
4. **Pre-apply baseline captured on PROD directly** (the rehearsal was
   against test-db; prod's own state was not assumed to match without
   checking) — `jvxwqignooseazzmwhvl` printed immediately before each
   probe:
   - `hindrances` row count: **1** (matches DASH-07 Phase 1's own account
     of the table's real history — one row from the first real end-to-end
     test, 2026-09-07).
   - Column list: 18 columns, byte-identical to test-db's own
     pre-migration baseline (same names, types, defaults, nullability).
   - Policy set: 4 PERMISSIVE policies (`hindrances_delete/_insert/_select/
     _update`), byte-identical to test-db's pre-migration baseline.
   - Table-level grants: `authenticated` held DELETE/INSERT/REFERENCES/
     SELECT/TRIGGER/TRUNCATE/UPDATE (blanket, all-columns) — byte-identical
     to test-db's pre-migration baseline.
5. **Applied.** `supabase db query --linked -f supabase/migrations/
   039_hindrance_acknowledgement.sql`, linked ref `jvxwqignooseazzmwhvl`
   printed immediately before, single foreground command, nothing else
   batched in. Exit 0, `"rows": []` (expected — the file's own last
   statement is `COMMIT`, no SELECT).
6. **Post-apply readback, live, immediately after** (all four items):
   - `pg_policies` for `hindrances`: 5 rows now (the original 4 PERMISSIVE
     ones, byte-unchanged, PLUS `hindrances_update_project_scoped`,
     RESTRICTIVE, `USING`/`WITH CHECK` both the exact
     `EXISTS (... JOIN project_members pm ON pm.project_id =
     hindrances.project_id AND pm.user_id = u.id WHERE u.auth_id =
     auth.uid() AND pm.role = 'pm'::text)` clause that was reviewed).
   - `information_schema.column_privileges` for `authenticated`/`UPDATE`
     on `hindrances`: exactly 2 rows, `acknowledged_at` and
     `acknowledged_by` — nothing else. Table-level grants re-checked
     separately: `authenticated`'s table-wide privilege list no longer
     includes `UPDATE` at all (confirms the REVOKE took effect, not just
     that the two columns are granted).
   - `hindrances_acknowledged_by_fkey`: `contype='f'`, `confupdtype='a'`,
     `confdeltype='a'` (NO ACTION on both, as documented and reviewed).
   - `hindrances_ack_pairing_check`: `contype='c'`,
     `CHECK (((acknowledged_at IS NULL) = (acknowledged_by IS NULL)))` —
     exact text match to what was reviewed.
   - Row count re-checked: still **1**, unaffected.
7. **Ledger repaired.** `supabase migration repair --status applied 039
   --linked` → `{"versions":["039"],"status":"applied","repairAll":false,
   "message":"Migration history repaired"}`. Re-queried
   `supabase_migrations.schema_migrations` directly: `039` present
   (absent before the repair, confirmed both ways — `supabase db query`
   never touches this table by construction, matching every prior
   migration's own apply record). `supabase migration list --linked`
   afterward: local and remote match exactly through `039`, no gaps.
8. Link switched back to test-db (`exfccwlrhoutkgrlikod`) immediately
   after, so no prod-linked state lingers in this worktree session.

## What this apply does NOT include

**The file is not yet on `main`.** It exists in `supabase/migrations/` on
`worktree-dash-07-phase2-ack` (commit `0e4bc3d`), applied and ledgered on
prod, but the branch is not merged. Per CLAUDE.md's own named lesson
("A MIGRATION IS NOT DONE WHEN APPLIED AND LEDGERED -- IT IS DONE WHEN THE
FILE IS ON `main`", migration 029's own incident) this gap should be closed
promptly, not left open for an extended stretch — matching migration 038's
own precedent (`ac99aec` held pending review → `83c1be8` "land... on main,
ledger repaired", same apply-then-land shape, closed the same working
session). **Not done as part of this record** — a PR is the natural next
step, and Aravind's own step 7 in this apply's instructions was to stop and
wait before Stage 2, which this record does.

**No application code was written or changed.** Stage 2 (the dashboard
Acknowledge/Un-acknowledge write) does not exist yet. The one hindrance row
on prod remains fully unacknowledged (`acknowledged_at`/`acknowledged_by`/
`ack_notified_at` all NULL) — nothing writes these columns until Stage 2
ships.
