# Migration 035 — production apply record (2026-09-03)

Companion to `docs/reviews/035-evening-flow-review-package.md` (the full review
package — spec, security assessment, disposable scaffold, written-AND-executed
rollback, test-db rehearsal, apply runbook §14.2's own S0–S6 sequence). Same
shape as `docs/reviews/030-apply-record.md`/`033-apply-record.md`/
`034-apply-record.md`. **Applied by Aravind, SQL Editor, by hand, ~09:05 IST —
this record documents the apply and the post-apply verification (S4–S6), it
did not perform the apply itself.**

## SHA provenance

- PR #157 (`worktree-evening-flow-plan-commit`) head at apply time:
  `d5d428266aad1c94b0325c25775a7570e5315d58` — all 7 CI checks confirmed
  `SUCCESS` on this exact head (re-verified via `gh pr view 157` immediately
  before the apply, not a stale rollup).
- Pasted SQL: `git show d5d4282...:docs/reviews/035_evening_flow_restructuring.sql`
  → `/tmp/035-to-paste.sql`, 945 lines, sha256
  `cae77de9bed877951cf34c35f9bb373d2c6ef281e219df46697d49f2a561cb6d`.
- **Hash re-verified at the ledger-repair step, same value** — the copy used
  for the SQL Editor paste and the copy placed for `migration repair` are
  byte-identical, confirmed both at generation and again at repair time.
- Aravind's own apply result: `"Success. No rows returned."` — consistent
  with the file's shape (function replacements, one `ALTER TABLE ADD COLUMN`
  pair, a grant re-declaration, a one-time session sweep — no `SELECT`).

## PITR observation (runbook step, before S0)

**Observed live, by Aravind, before any write step** — 7-day restore window,
latest restore point **03 Sep 2026 09:02:37 IST**. Per CLAUDE.md §0: verified
by direct observation, not a checklist line.

## S1 — apply window, run fresh at time of verification (not inherited)

- Linked project ref pasted immediately before each probe round, same output
  each time: `jvxwqignooseazzmwhvl` for the two production rounds below,
  `exfccwlrhoutkgrlikod` for the test-db check, switched back to test-db
  immediately after each production round.
- `SELECT current_flow, current_step, count(*) FROM whatsapp_sessions WHERE
  current_flow IS NOT NULL GROUP BY 1,2;` against production, run fresh
  ahead of the apply: **zero rows.** PROCEED condition met — Aravind's own
  morning-check-in session had closed, confirmed rather than assumed.
- Today's `daily_logs` (production): one row, `log_date: 2026-09-03`,
  `attendance: absent`, `morning_submitted_at: 2026-09-03 03:21:48 UTC`
  (08:51 IST), `evening_submitted_at: null` — morning check-in landed before
  the apply.
- `gh run list` immediately before the apply: all runs `completed`, nothing
  `in_progress`/`queued` — no CI contending for test-db at apply time.

## S4 — confirm live and tests green

**Vercel deployed the merge.** `gh api repos/ara-2789/Quoco/commits/e922847.../status`
→ `state: success`, Vercel context `"Deployment has completed"`, timestamped
`2026-09-03T03:35:29Z` (immediately after the `03:34:30Z` merge). The merge
commit's own CI run (`33711855779`) is fully green: File Size Lint, Migration
Lint, Typecheck, Lint, Test (real test-db) — all `success`.

**THE it.fails WRAPPERS HAVE NOT FLIPPED — FOUND, NOT ASSUMED AWAY, REPORTED
BEFORE ANYTHING ELSE.** Per direct instruction ("report anything that does
not match"): **035 was applied to production only. Test-db does not have
it.** Confirmed three independent ways, not inferred from one:

1. **Ledger.** `supabase migration list --linked` against test-db
   (`exfccwlrhoutkgrlikod`): ends at `034` (remote-only, the known pre-
   existing gap), no `035` entry anywhere.
2. **Live function body.** `SELECT md5(prosrc), length(prosrc) FROM pg_proc
   WHERE proname = 'apply_evening_flow_turn'` against test-db returns
   `6c4c486a09a0bd2906edbf1984b3d765` / `17137` chars — this is the review
   package's own §14.4 **POST-ROLLBACK** value from the 2026-08-31 rehearsal,
   not the post-apply value (`b2e53ed4...`/`19438`). Test-db is sitting
   exactly where the rehearsal's own rollback left it.
3. **Direct empirical run.** `test/evening-flow.test.ts` run against test-db
   on the merged code: all 19 tests report `✓ PASS`, including every
   `it.fails(...)`-wrapped case under "needs 035 applied" — read correctly,
   an `it.fails` reporting PASS means its own body FAILED as expected (the
   wrapper has not been removed and could not have been, since the
   underlying assertions about `evening_manpower`/`evening_idle_hours`
   genuinely cannot succeed against a database that doesn't have those
   columns or the new RPC body). This is exactly why the merge's own CI run
   is green: CI never tested the post-035 shape at all — it tested the
   pre-035 shape, correctly, because that is what test-db has always been
   throughout this apply.

**Consequence:** the `it.fails` suites named in S4 (`test/evening-flow.test.ts`,
`test/section-42-row-readback.test.ts`, the write-boundary-distinctness
cases) **cannot be run to demonstrate a flip today** — not "ran and failed,"
genuinely cannot demonstrate the thing S4 asks them to demonstrate, because
their one dependency (035 on test-db) does not exist. Not run further after
the first file confirmed the root cause — re-running the others would only
reconfirm the identical precondition gap. **Nothing altered on test-db to
try to fix this** — that decision is explicitly yours, per "do not fix
production without telling me first," extended here to test-db on the same
reasoning (a database write needs the same explicit go-ahead regardless of
which database).

## S5 — post-apply fingerprint, against production, live

| Check | Pinned expected (review package §1/§14.2) | Live result (production, this session) | Verdict |
|---|---|---|---|
| `apply_evening_flow_turn` body md5 | `b2e53ed4265f9ad215728c3a4ff081bc` (rehearsal's own post-apply value) | `b2e53ed4265f9ad215728c3a4ff081bc` | **PASS** |
| `apply_morning_flow_turn` body md5 | `5c1ad1403b8aad1b350b93d7cdb13c5c` | `5c1ad1403b8aad1b350b93d7cdb13c5c` | **PASS** |
| `apply_evening_flow_turn` signature | `p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_parse jsonb, p_parse_ok jsonb, p_now timestamptz, p_test_sleep_ms integer` | identical, `pg_get_function_identity_arguments` | **PASS** |
| `apply_morning_flow_turn` signature | `p_phone_number text, p_tenant_id uuid, p_user_id uuid, p_project_id uuid, p_message text, p_start_flow boolean, p_manpower jsonb, p_manpower_ok boolean, p_equipment jsonb, p_equipment_ok boolean, p_now timestamptz, p_test_sleep_ms integer` | identical | **PASS** |
| `daily_logs.evening_manpower` | `jsonb` | `jsonb` | **PASS** |
| `daily_logs.evening_idle_hours` | `jsonb` | `jsonb` | **PASS** |
| `authenticated` UPDATE grant, `evening_manpower`/`evening_idle_hours` | present | `has_column_privilege(...) = true` for both | **PASS** |
| `authenticated` UPDATE grant, prior columns unchanged | `evening_dependencies`/`morning_plan` still granted | both `true` | **PASS** |

**NOTE ON PRE-APPLY BASELINE, stated precisely so it isn't misread as
something checked here:** the pre-apply hashes cited in the review package's
own §14.2 (`9bd64d28.../35150`, `dfab64f6.../15106`) are the REHEARSAL's own
pre-apply capture, on TEST-DB, 2026-08-31 — not a value this session
re-probed on production before Aravind's apply, since this verification
round began after the apply had already happened. Production's own pre-apply
body was never independently re-captured by this session; its post-apply
state matching the rehearsal's own recorded post-apply value (above) is the
evidence this apply behaved identically to the rehearsed one, which is the
strongest available proof in the absence of a prod-specific pre-apply
snapshot.

**Every S5 check: PASS. No anomaly on either function's body, either
signature, either new column, or any of the four grant probes.**

## S6 — ledger repair

**Absent on production too, confirmed before assuming otherwise:**
`supabase migration list --linked` (production) before repair: ends at `034`
(remote-only), no `035` row — the SQL genuinely ran (S5's fingerprints prove
it), the ledger simply didn't follow, matching this project's own repeated
"applied-but-unledgered" pattern (032's own still-open gap, 033's and 034's
own apply records).

**Repair, explicitly instructed, run:**
```
git show origin/main:docs/reviews/035_evening_flow_restructuring.sql > supabase/migrations/035_evening_flow_restructuring.sql
supabase link --project-ref jvxwqignooseazzmwhvl
supabase migration repair --status applied 035 --linked
# -> "Repaired migration history: [035] => applied"
supabase migration list --linked
# -> {"local":"035","remote":"035", ...} confirmed
rm supabase/migrations/035_evening_flow_restructuring.sql   # temporary copy removed, git status clean
```
sha256 of the copy used for repair re-checked against the paste file's own
hash immediately before running the command: identical (`cae77de9...`).

**A migration is not done when applied and ledgered — it is done when the
file is on `main`. FOUND, NOT CLOSED:** `git show origin/main:supabase/migrations/035_evening_flow_restructuring.sql`
→ does not exist at that path. The file IS reachable from `main`, but only
at `docs/reviews/035_evening_flow_restructuring.sql` — PR #157's merge did
not move it. **Same class of gap this project has already named once for
034** (034's own file also still sits in `docs/reviews/`, never moved). Not
fixed here — moving the file and committing to `main` is a real repo change
this record surfaces rather than performs unasked; the temporary copy used
for the repair step above was removed immediately after, exactly as it would
be for a rehearsal, precisely because this permanent move has not been
authorized yet.

## Apply method divergence, recorded as agreed

The runbook's own S2 specifies `supabase db query --linked -f`. The actual
apply used the **Supabase SQL Editor, by hand** — the fresh-tab/full-paste/
click-to-deselect ritual exists specifically because of migration 016's own
partial-selection incident, and four applies of muscle memory (030, 031,
032/033, 034) is itself part of the safety margin here, matching exactly the
same divergence 034's own apply record documented. Not a deviation from the
runbook's intent; a documented alternate path CLAUDE.md's own PROD APPLIES
rule already accepts.

## Open items — status

**OPEN, both surfaced this session, neither fixed without asking first:**
1. **Test-db does not have 035** — the it.fails suites cannot demonstrate a
   flip until this is resolved. Applying to test-db is a real database
   write and needs the same explicit go-ahead as any other apply.
2. **The migration file has not moved to `supabase/migrations/` on `main`**
   — currently reachable only from `docs/reviews/`. A real commit, not
   performed here.

**CLOSED:** SHA provenance pinned and re-verified byte-identical at two
points; PITR observed live pre-apply by Aravind; S1's live session/daily-log
probes both run fresh and clean; Vercel confirmed deployed; S5's seven
fingerprint checks all PASS against production; S6's ledger repair run and
verified on production. PR #157 merged (`--merge`, matching repo
convention), not squashed.
