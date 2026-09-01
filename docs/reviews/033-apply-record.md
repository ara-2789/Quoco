# Migration 033 — production apply record (2026-08-25)

Companion to `docs/reviews/033-sweep-review-package.md` (the full review
package — spec, rehearsal, executed rollback, S0-S6 runbook, external
review round 1 fixes). This file is the apply record, same shape as
`docs/reviews/030-apply-record.md`.

## SHA provenance

- Reviewer GO issued against `2c29f92` (PR #111, all 7 CI checks green,
  confirmed at commit-level — not PR-rollup — granularity: every check
  run's own `head_sha` equalled `2c29f929fe6bbad04f1e8d08a0f73f25d88a62e7`
  via `gh api repos/ara-2789/Quoco/commits/2c29f92.../check-runs`).
- PR #111 merged (squash) as `828f143` on `origin/main`:
  `feat: B3 morning cutoff sweep — migration 033 (CI validation, review
  pending) (#111)`.
- Pasted SQL: `git show 2c29f92:supabase/migrations/033_sweep_stale_morning_sessions.sql`
  → `/tmp/033-to-paste.sql`, 334 lines, sha256
  `0c314891f35b1847a089e0c680bb462b49b51f4a041b1ee36f37cb9623c1a27a`.
- **Confirmed byte-identical to what's on `main` post-merge**:
  `git show origin/main:supabase/migrations/033_sweep_stale_morning_sessions.sql
  | shasum -a 256` → the identical hash. What was reviewed, what was
  pasted, and what now sits on `main` are the same 334 bytes-for-bytes.

## Pre/post fingerprint, side by side

Both captured via SQL probe against `jvxwqignooseazzmwhvl`, breadcrumb
(`supabase/.temp/project-ref`) confirmed immediately before each round,
link switched back to test-db (`exfccwlrhoutkgrlikod`) immediately after
each round — never left pointed at prod.

| Probe | Pre-apply (`/tmp/033-prod-preapply-fingerprint.txt`) | Post-apply |
|---|---|---|
| `pg_proc` count, `sweep_stale_morning_sessions` | `0` | `1` |
| `security_definer` | — (absent) | `true` |
| `anon` EXECUTE | — | `false` |
| `authenticated` EXECUTE | — | `false` |
| `service_role` EXECUTE | — | `true` |
| `schema_migrations` count | `26` | `27` |
| `schema_migrations` versions | `001-007, 011-030` | `001-007, 011-030, 033` — exactly `033` added, nothing else changed |
| Parked sessions (`current_flow IS NOT NULL`) | `0` | `0` (unchanged — not a gate for this migration, see §11's own argument in the review package; recorded as the baseline the first live sweep acts on) |

Every value matches expectation exactly. No anomaly.

Raw post-apply probe output:
```
=== sweep_stale_morning_sessions pg_proc count (expect 1) ===
{"pg_proc_count": 1}
=== SECURITY DEFINER + grants ===
{"anon_can_exec": false, "authenticated_can_exec": false, "proname": "sweep_stale_morning_sessions", "security_definer": true, "service_role_can_exec": true}
=== schema_migrations count ===
{"migration_count": 27}
=== schema_migrations version list ===
{"versions": ["001","002","003","004","005","006","007","011","012","013","014","015","016","017","018","019","020","021","022","023","024","025","027","028","029","030","033"]}
=== parked sessions baseline (current_flow IS NOT NULL) ===
{"parked_count": 0, "phone_numbers": null}
```

## Deploy confirmation

- Vercel status on merge commit `828f143`: `gh api repos/ara-2789/Quoco/commits/828f143/status`
  → `{"context":"Vercel","state":"success","description":"Deployment has
  completed","target_url":"https://vercel.com/quoco/quoco/6YVKD3RYqv85Enq4NreDGQq4Uxgd"}`.
- Tick route confirmed **from `origin/main` directly**, not the working
  tree — `git show origin/main:app/api/jobs/tick/route.ts`:
  - Line 55: `morningSweep = await sweepStaleMorningSessions(client)`
  - Line 59: `reportMorningSweepAnomalies(morningSweep, new Date())`
  - Line 61 (catch branch): `morningSweep = reportMorningSweepError(err)`
  All three present on `main` as merged — the sweep call and both Sentry
  reporting paths (B2, external review round 1) are live in the deployed
  code, not just in the reviewed PR diff.
- Also confirmed present on `origin/main`: `docs/reviews/033-sweep-review-package.md`,
  `test/unit/morning-cutoff-sweep-sentry.test.ts`,
  `test/unit/morning-cutoff-sweep.test.ts`.
- Note, not a blocker: `origin/main`'s own post-merge CI run
  (`gh api repos/ara-2789/Quoco/commits/828f143/check-runs`) still showed
  `Test (real test-db)` as `in_progress` at the time this record was
  written — a secondary main-branch trigger, separate from and downstream
  of PR #111's own pre-merge green ("SHA provenance" above), which is
  what actually gated the merge and the reviewer's GO. Not chased further
  here; if it comes back red, that is a `main`-state issue to investigate
  on its own terms, not a reason to doubt this apply.

## Ledger state

`supabase migration repair --status applied 033 --linked` run against
`jvxwqignooseazzmwhvl`. Post-repair ledger confirmed in the pre/post
fingerprint table above: `033` present, count `26 → 27`, nothing else
disturbed.

**KNOWN FRICTION, hit for real on this apply, now added to the runbook's
own S6 (`docs/reviews/033-sweep-review-package.md` §11) so the next apply
does not rediscover it from scratch:** `migration repair` globs the
LOCAL `supabase/migrations/` directory to resolve a bare version number
to the migration's file name for the ledger row — it does not operate on
the version number alone. The shared main checkout was on
`feat/morning-flow-attendance-migration` at apply time (not `main`, and
not the now-merged `feat/b3-morning-cutoff-sweep-2026-08-25` branch,
whose own worktree is where 033's file actually lived) — so `migration
repair` run from that checkout had no local file to resolve `033`
against. Workaround: the hash-verified `/tmp/033-to-paste.sql` (same
file pasted for S2, sha256-pinned against the reviewed commit — see SHA
provenance above) was copied into that checkout's
`supabase/migrations/033_sweep_stale_morning_sessions.sql`
**temporarily**, the repair command run, then the copied file **deleted
again immediately** — leaving it in place would itself have been a live
hazard, the same shape as this project's own 026 incident (any tool that
globs `supabase/migrations/` decides what's pending by diffing that
directory against the ledger; an untracked stray file there is exactly
where that class of incident starts). Confirmed clean afterward: this
checkout's `supabase/migrations/` directory has no untracked files
post-repair.

## Grants evidence

Covered in the pre/post fingerprint table above — `security_definer:
true`, `anon`/`authenticated` denied, `service_role` granted, matching
the reviewed function's own explicit `REVOKE ... FROM PUBLIC, anon,
authenticated` / `GRANT ... TO service_role` (review package §1, §4).
No `anon`-reachable PostgREST path exists for this function (it is only
ever called via `client.rpc(...)` from `service_role`-authenticated
server code, per the review package §4's own note) — the
`has_function_privilege` probe above is the applicable evidence shape.

## Open items — status

**PARTIALLY CLOSED, 2026-09-01 — the reviewer's own closing artifact,
first real run.** The first real 15:00 IST production run of
`sweep_stale_morning_sessions` happened today, on a genuinely parked
session (a real engineer's morning flow, truncated at step 4). Full
record: `docs/reviews/033-first-sweep-record.md` — not paraphrased here,
per this project's own "artifact provenance is pinned, not paraphrased"
rule. Status against this note's own three original asks:

- **The tick's `morningSweep` object exactly as returned — NOT obtained,
  still open.** This environment has no Vercel CLI/dashboard access; the
  raw tick response was never captured and is not recoverable
  retroactively. `033-first-sweep-record.md` §3 reconstructs the sweep's
  effect instead (the `daily_logs` stamp, the session close, the
  downstream reply behaviour) — a materially different, indirect evidence
  class, stated as such there, not conflated with the literal return
  value this item asked for.
- **Sentry events raised — reasoned closed, not directly queried.** No
  authenticated Sentry MCP session was available this record; instead,
  `033-first-sweep-record.md` §3 confirms neither of B2's two capture
  conditions (`skippedSessions`, `missingDailyLogsRows`) was met, from the
  data itself (single project membership; the `UPDATE` affected a real
  row) — a code-level deduction, weaker than a direct Sentry read, named
  as such.
- **A `whatsapp_sessions` before/after probe bracketing the run —
  NOT obtainable, window closed.** This record's own investigation began
  after 18:16 IST, by which point the row had already been overwritten
  once more by the same day's evening completion (18:32 IST). No live
  bracket around the 15:00 IST run was taken in real time, and the
  specific state that existed between 15:00 and 18:30 IST can no longer be
  reconstructed from the current row. `033-first-sweep-record.md` §1-§2
  substitutes a `daily_logs`-based reconstruction of the sweep's effect,
  explicitly distinguished from a live bracket rather than presented as
  one.

Everything else in this record remains CLOSED: SHA provenance pinned and
verified byte-identical end to end, pre/post fingerprint clean with no
anomaly, deploy confirmed live on `main` (both the Vercel status and the
actual tick-route code), ledger repaired and its friction documented for
next time, grants confirmed matching the reviewed spec.
