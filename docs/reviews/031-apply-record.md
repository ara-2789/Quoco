# Migration 031 — production apply record (2026-08-27)

`outbound_sends` — the idempotency ledger for Pass 1's outbound WhatsApp send
primitive. Applied to production by hand via the Supabase SQL Editor.
Companion to `docs/reviews/031-outbound-send-ledger-review-package.md` (the
full review package — spec, external review rounds 1-4, the service_role
grant-bug fix and its own dry-run/rehearsal, S0-S6 runbook). This file is the
apply record, same shape as `docs/reviews/030-apply-record.md` and
`docs/reviews/033-apply-record.md`.

## SHA provenance

- Reviewer GO issued against PR #114 head `c52b11908c30c1b44c11925ddffbbc07ef6f701b`
  (`c52b119`) — all 6 CI checks green at commit-level granularity (Typecheck,
  Lint, Migration Lint, File Size Lint, Test (real test-db), Vercel), and
  `mergeStateStatus: CLEAN` confirmed immediately before apply.
- Pasted SQL: `git show c52b119:supabase/migrations/031_outbound_send_ledger.sql`
  → `/tmp/031-to-paste.sql`, 570 lines, sha256
  `c8ce0cef737a676ebef639d30cbc9742a9d93a24c6e7572fa0b1a628fa02ef2b`
  (recomputed and length-verified at 64 characters before pasting).
- PR #114 was **not yet merged** at apply time — applied ahead of merge, per
  the review package's own lockstep argument (§9, "The lockstep clause — NOT
  critical this time, unlike 033's own"): this migration ships alone, no
  caller exists in `main` yet (`grep -rn "outbound_sends" lib/ app/` on `main`
  returns nothing), so apply/merge order does not affect correctness. Merge
  follows as its own step below.
- **Merged** (squash) as `0fd2734` on `origin/main`: `docs: Pass 1 freshness
  check + migration 031 (outbound_sends ledger) (#114)`, merged
  2026-08-27T13:32:47Z. **Confirmed byte-identical to what's on `main`
  post-merge**: `git show origin/main:supabase/migrations/031_outbound_send_ledger.sql
  | shasum -a 256` → the identical hash
  (`c8ce0cef737a676ebef639d30cbc9742a9d93a24c6e7572fa0b1a628fa02ef2b`). What
  was reviewed, what was pasted into the SQL Editor, and what now sits on
  `main` are the same 570 lines, bytes-for-bytes.

## APPLY METHOD — divergence from the reviewed runbook, recorded explicitly

The reviewed runbook (`031-outbound-send-ledger-review-package.md` §10, S2)
specifies `supabase db query --linked -f`. **The actual apply used the SQL
Editor instead** (fresh tab, full paste, deselect before Run — the
convention originating from migration 016's `42710` incident,
`docs/reviews/016-review-package.md`), for consistency with migrations 030
and 033, both of which used the SQL Editor. Both methods are sanctioned
under CLAUDE.md §0's PROD APPLIES rule, which states the SQL Editor "remains
acceptable; it is no longer required." The reviewed package's own S2 text is
left byte-identical, not rewritten after GO — this record is where the
actual chosen method and the reason are made auditable.

Result: **"Success. No rows returned."**

## S0 — PITR window, observed

Dashboard → Database → Backups → Point in Time (observed by Aravind
directly, per CLAUDE.md §0's "verified by observation, never by checklist
status" rule): **7-day retention window, latest restore point 2026-08-27
18:53:35 IST.** Confirmed active before the apply proceeded.

## Pre/post fingerprint, side by side

Both captured via SQL probe against `jvxwqignooseazzmwhvl`, breadcrumb
(`supabase/.temp/project-ref`) confirmed immediately before each round, link
switched back to test-db (`exfccwlrhoutkgrlikod`) immediately after each
round — never left pointed at prod.

| Probe | Pre-apply (`/tmp/031-prod-preapply-fingerprint.txt`) | Post-apply (`/tmp/031-prod-postapply-fingerprint.txt`) |
|---|---|---|
| `outbound_sends` in `pg_class` | `0` | `1` |
| table / index / constraint counts | — (table absent) | `1` / `4` / `8` — matches §9 R3a/R3b exactly |
| composite FK `outbound_sends_recipient_user_id_tenant_id_fkey` | — | `confupdtype='a'` (NO ACTION), `confdeltype='r'` (RESTRICT) |
| composite FK `outbound_sends_project_id_tenant_id_fkey` | — | `confupdtype='a'`, `confdeltype='r'` |
| single-column FK `outbound_sends_tenant_id_fkey` | — | `confupdtype='a'`, `confdeltype='r'` (same actions, for completeness) |
| `idx_outbound_sends_stuck` | — | `CREATE INDEX idx_outbound_sends_stuck ON public.outbound_sends USING btree (updated_at) WHERE (status = 'sending'::text)` |
| UNIQUE constraint | — | `outbound_sends_tenant_id_recipient_user_id_event_key_key`: `UNIQUE (tenant_id, recipient_user_id, event_key)` |
| RLS enabled / policy count | — | `true` / `0` |
| `service_role` DELETE/TRUNCATE/REFERENCES/TRIGGER | — | `false` / `false` / `false` / `false` — all four negative, as required |
| `anon` SELECT/INSERT/UPDATE/DELETE | — | `false` / `false` / `false` / `false` |
| `authenticated` SELECT/INSERT/UPDATE/DELETE | — | `false` / `false` / `false` / `false` |
| `service_role` SELECT/INSERT/UPDATE | — | `true` / `true` / `true` |
| `schema_migrations` count | `27` | `28` |
| `schema_migrations` versions | `001-007, 011-025, 027-030, 033` | `001-007, 011-025, 027-030, 031, 033` — exactly `031` added, nothing else changed |

Every value matches expectation exactly. No anomaly.

### Full service_role privilege matrix — pinned BEFORE/AFTER baseline

Dynamic query across every `public` table (`pg_class`/`pg_namespace`,
`relkind='r'`), not a hardcoded list — the same shape used to establish the
28-of-29 finding in `docs/reviews/service-role-table-grants-gap.md`.

**Before** (`/tmp/031-prod-preapply-fingerprint.txt`): 28 tables, all 28
showing `service_role` DELETE/TRUNCATE/REFERENCES/TRIGGER = `true`.

**After** (`/tmp/031-prod-postapply-matrix.txt`): 29 tables. `outbound_sends`
is the lone clean row — `delete_priv: false, truncate_priv: false,
references_priv: false, trigger_priv: false` — against the same 28 other
tables, all still `true/true/true/true`, unchanged by this apply (correct:
this migration only creates a new object, it does not touch any existing
grant). This is the pinned AFTER baseline the separate grants-fix migration
(scoped in `service-role-table-grants-gap.md`, not started) will diff
against.

## Ledger state

```
$ supabase migration repair --status applied 031 --linked   # jvxwqignooseazzmwhvl, breadcrumb confirmed first
Repaired migration history: [031] => applied
{"versions":["031"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
```

Full post-repair ledger, raw:

```
001, 002, 003, 004, 005, 006, 007, 011, 012, 013, 014, 015, 016, 017,
018, 019, 020, 021, 022, 023, 024, 025, 027, 028, 029, 030, 031, 033
```

`count(*) = 28`.

**Same friction as 033, workaround applied again, same shape:** `migration
repair` globs the local `supabase/migrations/` directory to resolve a bare
version number to the migration's file name. This worktree's `main`-based
checkout has no `031` file (PR #114 not yet merged), so the hash-verified
`/tmp/031-to-paste.sql` (same file pasted for the SQL Editor apply, sha256
`c8ce0cef737a676ebef639d30cbc9742a9d93a24c6e7572fa0b1a628fa02ef2b`, pinned
against `c52b119` above) was copied into
`supabase/migrations/031_outbound_send_ledger.sql` **temporarily**, the
repair command run, then the copied file **deleted immediately** — the same
026-shaped hazard 033's own record already named (an untracked stray file in
a directory tools glob to decide what's pending). `git status --porcelain`
confirmed empty immediately after removal.

## `quoco_test_row_is_locked` (migration 032) — location correction

Checked directly (`pg_proc`) against both databases during this apply
session: **exists on test-db (`exfccwlrhoutkgrlikod`) only.** It does
**not** exist on production. An earlier claim in this session's own
discussion ("already exists in production") was repeated uncritically from
an earlier note without independent verification and was wrong — corrected
here since it is directly relevant to tomorrow's `morning-flow.test.ts` fix
(`docs/reviews/session-transition-lock-wait-flake.md`'s SCOPE GAP section),
which adapts a polling block that calls this function. Migration 032 itself
is also not ledgered on production (`schema_migrations` above has no `032`
row on either the pre- or post-apply prod probe) — consistent with the
function's absence there.

## Open items — status

**Everything in this record is CLOSED**: SHA provenance pinned, apply
method divergence recorded, PITR observed, pre/post fingerprint clean with
no anomaly, full privilege matrix confirms `outbound_sends` as the lone
clean row against the pinned 28-table baseline, ledger repaired and its
(recurring) friction documented, `quoco_test_row_is_locked` location
corrected.

**PENDING — no analog to 030/033's own "first real production observation"
step.** Nothing calls this table yet — the send primitive itself (plan
items B/D/F) is still unbuilt. When it exists, its own apply runbook is
where the first real claim/send/activate row against this table gets
recorded, not here.

**Merge status: CLOSED.** PR #114 merged as `0fd2734` (see SHA provenance
above), byte-identical to what was pasted and applied.
