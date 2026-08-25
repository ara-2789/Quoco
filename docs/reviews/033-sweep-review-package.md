# Migration 033 — B3 morning cutoff sweep — external review package

Companion to `docs/reviews/morning-flow-migration-review-package.md` §4 (the
original B3 spec) and §11.4 (the `attendance_defaulted`/`attendance_raw`
inheritance requirement B3 must satisfy). That document is the spec half;
this one is the evidence half — rehearsal, executed rollback, apply runbook
— built the same way migration 030's own package was.

**Status: PR open (#111), round 1 review returned STOP (§13), fixes below,
NOT merged, NOT applied to prod.** Merges only after reviewer GO + the prod
apply, per this package's own S4.

## 0. Repo-state header

- `main @ 15e0ed2` (`origin/main`)
- **Round history, not a single self-referential hash** — a commit cannot
  cite its own SHA inside its own content, and hardcoding "this PR's HEAD"
  as a bare hash is exactly what went stale last round (§13's small item,
  the reviewer's own finding: this section cited `e2e2b39` while the
  CI-green submitted SHA was already `b262c3c`, one commit further, because
  the doc describing a commit is necessarily written before that commit
  exists). Instead:
  - **Round 1 submission:** `b262c3c` on `feat/b3-morning-cutoff-sweep-2026-08-25`,
    PR #111, targeting `main`. CI green, all 7 checks (§10). Reviewer
    returned STOP: B1, B2 (blocking), three small items, three notes to
    record (§13, in full).
  - **Round 2 (this content):** the fixes in §13, committed on top of
    `b262c3c`. This document does not hardcode that commit's own SHA for
    the same reason it no longer hardcodes round 1's — see the PR's own
    commit history, or the delta report accompanying this round's push,
    for the exact value.
- `supabase migration list --linked` (test-db, `exfccwlrhoutkgrlikod`),
  captured after this package's own rollback proof and ledger repairs
  (§8, §9), and reconfirmed unchanged after round 2's re-apply (§13):
  ```
  local/remote agree through every entry: 001-007, 011-030, 032, 033.
  ```
  (`{"local":"032","remote":"032"}` and `{"local":"033","remote":"033"}` —
  both now ledgered; §9 covers the 032 gap this session closed.)
- Last runbook executed: migration 030's production apply,
  `docs/reviews/030-apply-record.md` (2026-08-25).

## 1. The function in full

**Round 1 snapshot — superseded by §13's fixes (B1, q2_reask, the
transaction-scope header note).** Kept as-is below rather than silently
rewritten, per this project's own "artifact provenance is pinned, not
paraphrased" rule — §13 carries the current, post-fix function in full;
this section is the historical record of what round 1 actually submitted
and what the reviewer's STOP was issued against.

Pinned via `git show b262c3c:supabase/migrations/033_sweep_stale_morning_sessions.sql`
(294 lines; header trimmed here to the load-bearing paragraphs — the file
itself is the source of record):

```sql
CREATE OR REPLACE FUNCTION sweep_stale_morning_sessions(p_now TIMESTAMPTZ DEFAULT now())
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_ist_minutes     INTEGER;
  v_row             whatsapp_sessions%ROWTYPE;
  v_log_date        DATE;
  v_project_id      UUID;
  v_project_count   INTEGER;
  v_swept_count     INTEGER := 0;
  v_swept_phones    TEXT[]  := '{}';
  v_rows_affected   INTEGER;
  v_missing_rows    JSONB   := '[]'::jsonb;
  v_skipped_count   INTEGER := 0;
  v_skipped_sessions JSONB  := '[]'::jsonb;
BEGIN
  -- CUTOFF GATE -- see file header.
  v_ist_minutes := EXTRACT(HOUR FROM (p_now AT TIME ZONE 'Asia/Kolkata'))::int * 60
                 + EXTRACT(MINUTE FROM (p_now AT TIME ZONE 'Asia/Kolkata'))::int;
  IF v_ist_minutes < 900 THEN  -- 15:00 IST = 15*60
    RETURN jsonb_build_object(
      'swept_count', 0, 'swept_phone_numbers', '[]'::jsonb,
      'missing_daily_logs_rows', '[]'::jsonb,
      'skipped_count', 0, 'skipped_sessions', '[]'::jsonb,
      'reason', 'before_cutoff'
    );
  END IF;

  FOR v_row IN
    SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning' FOR UPDATE SKIP LOCKED
  LOOP
    v_log_date := (v_row.updated_at AT TIME ZONE 'Asia/Kolkata')::date;

    -- (array_agg(...))[1], not min(project_id) -- uuid has no min() aggregate
    -- in Postgres (caught by this file's own dry-run scaffold, not assumed).
    SELECT count(*), (array_agg(project_id))[1] INTO v_project_count, v_project_id
    FROM project_members
    WHERE user_id = v_row.user_id;

    IF v_project_count != 1 THEN
      v_skipped_count    := v_skipped_count + 1;
      v_skipped_sessions := v_skipped_sessions || jsonb_build_object(
        'phone_number', v_row.phone_number,
        'current_step', v_row.current_step,
        'project_membership_count', v_project_count,
        'reason', CASE WHEN v_project_count = 0 THEN 'zero_project_memberships' ELSE 'multiple_project_memberships' END
      );
      CONTINUE;  -- next v_row -- no write of any kind for this session.
    END IF;

    IF v_row.current_step IN (2, 3, 4) THEN
      UPDATE daily_logs
         SET morning_submitted_at = p_now
       WHERE project_id  = v_project_id
         AND engineer_id = v_row.user_id
         AND log_date    = v_log_date;

      GET DIAGNOSTICS v_rows_affected = ROW_COUNT;
      IF v_rows_affected = 0 THEN
        v_missing_rows := v_missing_rows || jsonb_build_object(
          'phone_number', v_row.phone_number,
          'current_step', v_row.current_step,
          'reason', 'no_daily_logs_row_found'
        );
      END IF;

    ELSIF v_row.current_step = 5 THEN
      INSERT INTO daily_logs AS d
        (tenant_id, project_id, engineer_id, log_date, attendance, attendance_defaulted, attendance_raw, is_holiday, morning_submitted_at)
      VALUES
        (v_row.tenant_id, v_project_id, v_row.user_id, v_log_date, 'absent', true, NULL, false, p_now)
      ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
        SET attendance           = EXCLUDED.attendance,
            attendance_defaulted = EXCLUDED.attendance_defaulted,
            attendance_raw       = EXCLUDED.attendance_raw,
            is_holiday           = EXCLUDED.is_holiday,
            morning_submitted_at = EXCLUDED.morning_submitted_at;
    END IF;
    -- current_step = 1 falls through here with no daily_logs write at all.

    v_swept_count  := v_swept_count + 1;
    v_swept_phones := v_swept_phones || v_row.phone_number;

    UPDATE whatsapp_sessions
       SET current_flow = NULL,
           current_step = 0,
           context      = (context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                           || CASE WHEN v_row.current_step != 1
                                THEN jsonb_build_object('morning_submitted', true)
                                ELSE '{}'::jsonb
                              END,
           updated_at   = p_now
     WHERE id = v_row.id;
  END LOOP;

  RETURN jsonb_build_object(
    'swept_count', v_swept_count,
    'swept_phone_numbers', to_jsonb(v_swept_phones),
    'missing_daily_logs_rows', v_missing_rows,
    'skipped_count', v_skipped_count,
    'skipped_sessions', v_skipped_sessions
  );
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.sweep_stale_morning_sessions(timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.sweep_stale_morning_sessions(timestamptz) TO service_role;
```

Callers, pinned the same way — `git show e2e2b39:app/api/jobs/tick/route.ts`
(`runJobsTick`, lines 37-51) and `git show e2e2b39:lib/daily-logs/morning-cutoff-sweep.ts`:

```ts
export async function runJobsTick(client: SupabaseClient) {
  let morningSweep: MorningCutoffSweepResult | { error: string }
  try {
    morningSweep = await sweepStaleMorningSessions(client)
  } catch (err) {
    morningSweep = { error: err instanceof Error ? err.message : String(err) }
  }

  const jobs = await claimJobs(3, client)
  // ... job claim/dispatch unchanged, morningSweep folded into the response
}
```

This exact shape — the sweep is called unconditionally, first, wrapped in
its own try/catch — is the mechanism behind §11's lockstep clause below.

## 2. Per-step behaviour table

| `current_step` (morning) | daily_logs write | attendance | attendance_defaulted | attendance_raw | is_holiday | Session outcome |
|---|---|---|---|---|---|---|
| 1 — attendance unanswered | none | — | — | — | — | closed, `context.morning_submitted` **not** set (nothing real to mark) |
| 2 — attendance answered, plan unanswered | `UPDATE ... morning_submitted_at` only | untouched (already `present`, written at step 1's own site) | untouched | untouched | untouched | closed, `morning_submitted=true` |
| 3 — plan answered, workers unanswered | `UPDATE ... morning_submitted_at` only | untouched | untouched | untouched | untouched | closed, `morning_submitted=true` |
| 4 — workers answered, equipment unanswered | `UPDATE ... morning_submitted_at` only | untouched | untouched | untouched | untouched | closed, `morning_submitted=true` |
| 5 — attendance=NO, holiday follow-up unanswered | `INSERT ... ON CONFLICT DO UPDATE` | `'absent'` | `true` | `NULL` | `false` | closed, `morning_submitted=true` |

Steps 2-4 additionally carry the missing-row guard (§6): if the expected
`daily_logs` row is absent, the `UPDATE` silently affects zero rows —
detected via `GET DIAGNOSTICS ... ROW_COUNT` and surfaced in
`missing_daily_logs_rows`, not raised. The session still closes either way.

Evidence: `test/unit/morning-cutoff-sweep.test.ts`, one test per row above
(`step 1 — attendance unanswered...` through `step 5 — holiday follow-up
unanswered...`), all passing in both the rehearsal (§7) and CI (§10).

## 3. Context write — compared against the RPC's own completion write

033's session-close write, byte-for-byte from §1:

```sql
context = (context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
           || CASE WHEN v_row.current_step != 1
                THEN jsonb_build_object('morning_submitted', true)
                ELSE '{}'::jsonb
              END,
```

`apply_morning_flow_turn`'s own completion write, migration 030
(`supabase/migrations/030_morning_flow_attendance.sql:489-490` and
`:519-520`, both completion sites — step 4 and step 5 respectively,
identical text at both):

```sql
v_session.context      := (v_session.context - 'q1_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
                            || jsonb_build_object('morning_submitted', true);
```

Same merge-not-replace discipline (`-` then `||`, never a bare replace —
the discipline 022's own comment calls out explicitly: a bare replace would
wipe `evening_submitted` if evening ran earlier the same day, T-022-13's
regression), same four reask keys stripped. The only difference is
033's `CASE`: the RPC's own write always sets `morning_submitted=true`
because it only ever reaches this line on a real completion (something was
answered); 033 reaches this line for step-1 sessions too, where nothing was
ever answered, and deliberately withholds the marker there — see §2's row 1.
Everywhere the RPC's own write would fire, 033's write matches it exactly.

## 4. Grants and SECURITY DEFINER evidence

Probed on test-db post-rehearsal-apply and again post-rollback-reapply
(§7, §8) — identical both times:

```sql
SELECT proname, prosecdef AS security_definer,
       has_function_privilege('anon', 'public.sweep_stale_morning_sessions(timestamptz)', 'EXECUTE') AS anon_can_exec,
       has_function_privilege('authenticated', 'public.sweep_stale_morning_sessions(timestamptz)', 'EXECUTE') AS authenticated_can_exec,
       has_function_privilege('service_role', 'public.sweep_stale_morning_sessions(timestamptz)', 'EXECUTE') AS service_role_can_exec
FROM pg_proc WHERE proname = 'sweep_stale_morning_sessions';
```
```json
{"anon_can_exec": false, "authenticated_can_exec": false, "proname": "sweep_stale_morning_sessions", "security_definer": true, "service_role_can_exec": true}
```

Matches the migration's explicit `REVOKE ... FROM PUBLIC, anon,
authenticated` / `GRANT ... TO service_role` (§1) — no reliance on a bare
`FROM PUBLIC` to cover the per-role default grants Supabase attaches to
every new `public`-schema function (the migration-020/029 class of gap;
CLAUDE.md §6's "EVERY NEW FUNCTION ... REQUIRES AN EXPLICIT PER-ROLE
REVOKE" rule). `sweep_stale_morning_sessions` has no `anon`-reachable
PostgREST path to prove the refusal against the way 029's follow-up
required (it isn't called via PostgREST at all, only `client.rpc(...)`
from `service_role`-authenticated server code) — the `has_function_privilege`
probe above is the applicable evidence shape here.

## 5. Multi-project skip — the three tests

Do-not-guess fix (§ the migration's own header, "PROJECT MEMBERSHIP —
COUNTED, NOT GUESSED"), replacing an earlier `LIMIT 1` draft that could
silently pick an arbitrary project for a multi-project engineer. Three
tests, `test/unit/morning-cutoff-sweep.test.ts`'s own `describe`
block `project-membership count — do not guess a project`:

1. **`multi-project engineer is SKIPPED and counted, nothing written,
   session untouched`** — an engineer seeded with two `project_members`
   rows (`PROJECT_ID`, `PROJECT_ID_2`). Sweep leaves `daily_logs`
   untouched, `whatsapp_sessions.current_flow` still `'morning'`,
   `skipped_count` incremented, `skipped_sessions` carries
   `project_membership_count: 2, reason: 'multiple_project_memberships'`.
2. **`zero-membership engineer is SKIPPED and counted, nothing written,
   session untouched`** — same shape, `project_membership_count: 0,
   reason: 'zero_project_memberships'`.
3. **`single-project engineer sweeps normally -- the count check does not
   regress the normal case`** — the ordinary path (exactly one
   membership) still sweeps and writes correctly; proves the guard doesn't
   collaterally break the common case.

All three passed in the rehearsal (§7) and in CI (§10).

## 6. Zero-row guard

`test/unit/morning-cutoff-sweep.test.ts`'s `missing-row guard — a step
2-4 session with no daily_logs row surfaces it, still closes, does not
fail the sweep`: a step-2 session seeded with no corresponding
`daily_logs` row. The `UPDATE ... morning_submitted_at` affects zero
rows; `GET DIAGNOSTICS` catches it; the session still closes (matching
every other step-2-4 session); `missing_daily_logs_rows` in the RPC's
return carries `{phone_number, current_step, reason:
'no_daily_logs_row_found'}`. Sweep does not raise — one bad row must not
block every other engineer's session from closing the same tick.

## 7. Idempotency proof

`test/unit/morning-cutoff-sweep.test.ts`'s `idempotency — a second sweep
after the first is a genuine no-op, does not re-stamp`: running the sweep
twice in succession over the same seeded state. First run sweeps and
stamps as expected; second run's `swept_count` is `0` and
`morning_submitted_at` is unchanged — the mechanism is structural, not a
flag: sweeping sets `current_flow := NULL`, so the second run's own `WHERE
current_flow = 'morning'` cursor simply never matches that row again
(migration header, "IDEMPOTENCY").

## 8. Rehearsal — test-db, applied and ledgered (2026-08-25)

Migration 033 applied for real to test-db (`exfccwlrhoutkgrlikod`,
confirmed via `cat supabase/.temp/project-ref` immediately before, per the
PROD-APPLIES-path discipline extended to test-db here) via `supabase db
query --linked -f supabase/migrations/033_sweep_stale_morning_sessions.sql`,
then ledgered: `supabase migration repair --status applied 033 --linked`.
Breadcrumb + fingerprint (§4) confirmed before proceeding.

`test/unit/morning-cutoff-sweep.test.ts` — all 13 tests green against the
real RPC (§2, §5, §6, §7 above are its contents).

**Full suite, same test-db state — NOT all green, and why that's not
disqualifying:** 3 files / 4 tests failed (48 files / 714 tests passed, 1
todo), run duration ~1793s (~30 min) versus a normal ~5-10 min for this
suite. Per standing instruction, not re-run locally. The four failures:

1. `test/session-transition.test.ts` > B — the test's own error text
   names the cause: *"caller 1's row lock was never observed within
   3000ms via quoco_test_row_is_locked -- caller 1 never appeared to
   reach Postgres at all in that window."* The already-documented sandbox
   concurrency limitation (`docs/reviews/sandbox-cannot-test-concurrency.md`;
   CLAUDE.md's "CONCURRENCY, LOCK, AND RACE VERIFICATION IS CI-ONLY" rule).
2. `test/migration-007.test.ts` > T-007-03 — `Test timed out in 30000ms`
   (reported wall time 135753ms).
3. `test/migration-024.test.ts` > T-024-14 — `Test timed out in 30000ms`,
   its own `afterEach` hook *also* timing out at 30000ms (reported wall
   time ~1241047ms, ~20 min).
4. `test/migration-024.test.ts` > T-024-15, immediately after #3 —
   `TypeError: fetch failed` inside `applyMorningFlowTurn`.

No failed assertion anywhere in #2-#4 — only timeouts, a hook timeout, and
a cascading raw fetch failure, matching this sandbox's own recorded
history against test-db: a ~48-minute gap between two `vitest` process
starts and three consecutive full-suite hangs, both recorded 2026-08-25 in
`docs/build-status.md` ("LOCAL FULL-SUITE VERIFICATION AGAINST TEST-DB HUNG
THREE TIMES IN A ROW..."), which concludes: *"CI is the authority for
full-suite runs against test-db, not local."* Neither `migration-007.test.ts`'s
RLS tests nor `migration-024.test.ts`'s ordering tests reference
`sweep_stale_morning_sessions` or scan `whatsapp_sessions`.

## 9. Rollback — executed, not asserted (2026-08-25)

For a brand-new function, the rollback is a `DROP FUNCTION`. Run for real
against test-db, every step's raw output captured:

**R1 — pre-DROP state.**
```sql
SELECT count(*) FROM pg_proc WHERE proname = 'sweep_stale_morning_sessions';
```
```json
{"pg_proc_count": 1}
```
Ledger: `{"name": "sweep_stale_morning_sessions", "version": "033"}` present.

**R2 — DROP (write).**
```sql
DROP FUNCTION public.sweep_stale_morning_sessions(timestamptz);
```
Executed via `supabase db query --linked -f`, empty result (`"rows": []`),
no error — succeeded.

**R2a — confirmed gone.**
```sql
SELECT count(*) FROM pg_proc WHERE proname = 'sweep_stale_morning_sessions';
```
```json
{"pg_proc_count": 0}
```
Ledger, same query as R1: still shows `version 033` present — confirms the
ledger is genuinely agnostic to the function's live existence, same as
migration 030's own rollback observed (`docs/reviews/morning-flow-
migration-review-package.md` §10.3: "neither 030's apply nor this
rollback ever touched the ledger").

**R2b — sweep tests fail correctly.** `npx vitest run
test/unit/morning-cutoff-sweep.test.ts` against the dropped function:
```
Test Files  1 failed (1)
     Tests  13 failed (13)
  Duration  15.64s
```
Every one of the 13 failures carries the identical, single error:
```
Error: sweep_stale_morning_sessions failed: Could not find the function public.sweep_stale_morning_sessions(p_now) in the schema cache
```
(PostgREST's schema-cache-miss wording for "could not find the
function.") No other error shape appeared — nothing else broke; the
failure is contained to exactly the tests that call the dropped function,
in the one file that calls it.

**R3 — re-apply.**
```
supabase db query --linked -f supabase/migrations/033_sweep_stale_morning_sessions.sql
```
Empty result, no error — succeeded.

**R3a — confirmed restored.**
```sql
SELECT count(*) FROM pg_proc WHERE proname = 'sweep_stale_morning_sessions';
```
```json
{"pg_proc_count": 1}
```
```sql
SELECT proname, prosecdef, has_function_privilege('anon', ...), has_function_privilege('authenticated', ...), has_function_privilege('service_role', ...) FROM pg_proc WHERE proname = 'sweep_stale_morning_sessions';
```
```json
{"anon_can_exec": false, "authenticated_can_exec": false, "proname": "sweep_stale_morning_sessions", "security_definer": true, "service_role_can_exec": true}
```
Byte-identical to §4's original fingerprint.

**R3b — sweep tests pass again.**
```
Test Files  1 passed (1)
     Tests  13 passed (13)
  Duration  20.39s
```

**R4 — re-ledger.**
```
supabase migration repair --status applied 033 --linked
```
```json
{"versions": ["033"], "status": "applied", "repairAll": false, "message": "Migration history repaired"}
```
```sql
SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('032','033');
```
```json
[{"name": "session_transition_lock_probe_nowait", "version": "032"}, {"name": "sweep_stale_morning_sessions", "version": "033"}]
```
(032's row is the collateral fix from §9.1 below, already present by the
time this final probe ran.)

**End state: 033 applied, ledgered, all 13 sweep tests green — identical
to the state before the rollback proof began.** Left applied deliberately
(per standing instruction: test-db moving ahead of `main` is correct while
this PR is under review — the tests cannot run without it).

### 9.1 Collateral fix — migration 032's ledger gap

While capturing this package's repo-state header (§0), `supabase migration
list --linked` showed `{"local":"032","remote":""}` — 032
(`session_transition_lock_probe_nowait`) present in the local migrations
directory but with no ledger row on test-db. Second instance of
"applied-but-unledgered" after migration 030's own gap
(`docs/reviews/030-apply-record.md`).

Confirmed the function was genuinely live before touching the ledger (not
assumed):
```sql
SELECT count(*) FROM pg_proc WHERE proname = 'quoco_test_row_is_locked';
```
```json
{"pg_proc_count": 1}
```
Then repaired:
```
supabase migration repair --status applied 032 --linked
```
```json
{"versions": ["032"], "status": "applied", "repairAll": false, "message": "Migration history repaired"}
```
`supabase migration list --linked` afterward: local and remote agree
through every entry, including 032 and 033. Unrelated to 033's own logic
— fixed here because it was found here, and because it exercises this
package's own runbook §S6 (below) on a real case rather than leaving that
step only theoretical.

## 10. CI evidence — local-vs-CI comparison, same code, same test-db

PR #111, HEAD `e2e2b39`, all 7 checks green:

| Check | Result | Duration |
|---|---|---|
| File Size Lint | pass | 28s |
| Lint | pass | 31s |
| Migration Lint | pass | 28s |
| Typecheck | pass | 33s |
| **Test (real test-db)** | **pass** | **12m20s** |
| Vercel | pass (deployment completed) | — |
| Vercel Preview Comments | pass | — |

The comparison that actually settles §8's local failures: **identical
code, identical test-db, two different environments.**

| | Local (this sandbox) | CI |
|---|---|---|
| Duration | ~1793s (~30 min) | 12m20s |
| Result | 3 files / 4 tests failed | 0 failures |
| Failure shape | 2 timeouts, 1 hook timeout, 1 cascading fetch failure — zero failed assertions | — |

CI running clean, in under half the local wall-clock time, on the exact
same commit against the exact same test-db, confirms the local failures
were this sandbox's own degradation (§8's cited `docs/build-status.md`
incidents), not a regression migration 033 introduced.

## 11. Apply runbook — S0-S6

Instantiates `docs/migration-runbook-template.md`'s canonical A-E
skeleton, same numbering convention as migration 030's own S-step runbook
(`docs/reviews/morning-flow-migration-review-package.md` §11.3).

### Session probe — argued, not adopted as a gate

030's S1/S2 gated on `count(*) FROM whatsapp_sessions WHERE current_flow
IS NOT NULL` because applying 030 REPLACED `apply_morning_flow_turn`'s
own body — a session already parked mid-flow had its `current_step`
reinterpreted under new logic the instant the new body went live. That is
a genuine correctness hazard: renumbering step semantics under an
in-flight session.

033 shares none of that shape:

- It is **purely additive** — a brand-new function. Applying it changes
  nothing about how `apply_morning_flow_turn`, or anything else, treats
  any existing `whatsapp_sessions` row. There is no semantic-drift window
  for an in-flight session to fall into, because nothing consumes
  `sweep_stale_morning_sessions` until the TS wrapper's caller (§S4) is
  live.
- Even once live, **a nonzero parked-session count is not a hazard, it is
  the expected and desired condition** — the function exists specifically
  to act on parked sessions past 15:00 IST. A `PROCEED only if count=0`
  gate, copied from 030 without adjustment, would be actively wrong here:
  it would block the sweep from ever doing the one thing it's for.
- The real safety property — does the sweep do the right thing to a
  parked session on its first live invocation — is exactly what §2
  (per-step table) and §7 (idempotency) already prove, against real
  fixture data, independent of how many parked sessions happen to exist
  at apply time.
- `FOR UPDATE SKIP LOCKED` already protects the one race a probe like
  030's would otherwise be defending against (a session transitioning
  from parked to actively-mid-turn between probe and apply) — a
  concurrent real `apply_morning_flow_turn` call holding the row lock is
  simply skipped this tick, not blocked on or corrupted.

**Conclusion: no session-probe gate.** S1 below is an identity/fingerprint
probe only (confirms target + pre-state), not a PROCEED/STOP session
count — there is no session count whose value should change what happens
next.

### The lockstep clause — CONFIRMED: SQL first, merge second

This PR bundles the SQL migration reference *and* the TS caller
(`lib/daily-logs/morning-cutoff-sweep.ts`, hooked into `runJobsTick`,
§1) in one commit set. §1's pinned `runJobsTick` calls
`sweepStaleMorningSessions(client)` **unconditionally, first, every
tick** — wrapped in its own `try/catch`, so a missing function does not
crash the route or block job claiming, but it does mean: if this PR
**merges before the SQL is applied to prod**, every 60-second tick
(NFR-16) calls an RPC that does not exist yet. The tick response's
`morningSweep` field carries `{error: "sweep_stale_morning_sessions
failed: ... Could not find the function ..."}"` on every single
invocation until the SQL lands — not fatal, but real: noisy, and the
sweep's actual job (closing stale sessions) silently does not happen
during that window.

This sharpens, not contradicts, the original framing from the build
phase ("033 is a new function with no caller until the TS wrapper
ships, so the SQL can land before the merge without an old-TS window") —
that was true about `main`'s *current* state (no existing caller
today) but understated the mechanism for the *deploy* itself, since the
caller ships in this same PR. **Confirmed order: apply SQL to prod
first, merge second, no gap between them** — same operational shape as
030's S3→S4 (apply then merge immediately), different underlying reason
(030: semantic drift for an in-flight session; 033: a real caller
hitting a genuinely missing function).

### S0-S6

- **S0. PITR window observation (no SQL).** Dashboard → Database →
  Backups → Point in Time. Observe an active restore window ending ~now,
  record the timestamp (§0 of CLAUDE.md: verified by observation, never a
  checklist "DONE").

- **S1. Pre-apply identity + fingerprint probe (read-only), pinned raw.**
  Confirm the linked project ref is **prod**
  (`jvxwqignooseazzmwhvl`), pasted immediately before, in the same output
  — never recalled from earlier in the session. Then:
  ```sql
  SELECT count(*) FROM pg_proc WHERE proname = 'sweep_stale_morning_sessions';
  ```
  **Expected: 0** (not yet applied to prod). Not a PROCEED/STOP gate on a
  session count — see the argument above; this step exists to confirm
  identity and pre-state, not to block on parked sessions.

- **S2. Apply (write).** `supabase db query --linked -f
  supabase/migrations/033_sweep_stale_morning_sessions.sql` (never `db
  push`, per the standing rule). Paste the result.

- **S3. Post-apply probes (read-only).** Same fingerprint as §4/§9's R3a:
  `pg_proc` count = 1, `security_definer = true`, `anon`/`authenticated`
  denied, `service_role` granted. Paste each.

- **S4. Merge — THE LOCKSTEP CLAUSE, per the argument above. Immediately
  after S3 confirms, no gap.** Merging deploys the TS wrapper whose
  caller is now live in `runJobsTick`, unconditional, every tick. A gap
  here is a window of real, repeated, caught-but-visible errors on every
  tick — merge right away, not "sometime after."

- **S5. Confirm live — the FIRST real production observation.** The next
  tick's response (`GET /api/jobs/tick`, or its logged/Sentry-visible
  equivalent) carries a `morningSweep` value with **no `error` key** —
  either `{reason: 'before_cutoff', swept_count: 0, ...}` if invoked
  before 15:00 IST, or a real sweep result after. This is the first
  moment the SQL+TS pairing is proven end-to-end against production
  traffic, not a rehearsal or CI run — same spirit as 030's own S5.

- **S6. Ledger repair (write) + verify.** `supabase migration repair
  --status applied 033 --linked` (breadcrumb confirmed first), then
  `SELECT count(*)` and the full version list from
  `supabase_migrations.schema_migrations`. Learned directly from 030's
  own gap (`docs/reviews/030-apply-record.md`'s "Ledger state" section)
  and exercised for real in this package on migration 032 (§9.1) — this
  step is not theoretical, it was already run once, successfully,
  earlier in this same session.

  **KNOWN FRICTION, hit for real on the 033 prod apply (2026-08-25) —
  `migration repair` globs the LOCAL `supabase/migrations/` directory to
  resolve a version to its file name for the ledger row; it does not
  operate on a bare version number alone.** If the checkout `migration
  repair` runs from does not have the migration's file present locally —
  here, the shared main checkout was on a different branch
  (`feat/morning-flow-attendance-migration`) at apply time, with 033's
  file living only on the now-merged feature branch's own worktree — the
  command cannot resolve the name. Workaround used: copy the
  hash-verified paste file (`/tmp/033-to-paste.sql`, the same file
  pasted into the SQL Editor for S2, sha256-pinned against the reviewed
  commit) into `supabase/migrations/033_sweep_stale_morning_sessions.sql`
  in that checkout **temporarily**, run the repair command, then **delete
  it again immediately** — leaving it in place is itself a hazard,
  matching this project's own 026 incident class (`db push` — never used,
  but any tool that globs `supabase/migrations/` — decides what's pending
  by diffing that directory against the ledger; an untracked stray file
  there is exactly the shape that class of incident starts from). Two
  correct alternatives if this recurs: run the repair from a checkout
  that already has the file tracked (`main`, post-merge, or the feature
  branch's own worktree), or use this temporary-copy-then-delete
  workaround if switching checkouts isn't convenient in the moment —
  either way, never leave the copied file sitting untracked once the
  repair command has run.

**After apply:** `docs/schema.md`'s `033` entry, written only after S6
confirms (§0 of CLAUDE.md — no "applied" line asserted before it's true).
Record the applied SHA + probe frame in this package's own apply-record
addendum, matching `docs/reviews/030-apply-record.md`'s shape.

## 12. Known defect caught pre-apply

`min(project_id)` — Postgres has no `min()` aggregate for `uuid`. Caught
by the dry-run scaffold's own apply step failing (`ERROR: function
min(uuid) does not exist`) before this migration ever touched test-db,
not by reading the SQL. Fixed with `(array_agg(project_id))[1]` (§1,
line 186 of the pinned file). Second real defect this project's dry-run
scaffold has caught in two migrations — the first was migration 030's
own function-overload finding (`docs/reviews/morning-flow-migration-
review-package.md` §10).

## 13. External review round 1 — STOP, all items fixed and verified (2026-08-25)

Reviewer verdict on §0-§12 (submitted at `b262c3c`, CI green): **STOP**,
two blocking items (B1, B2), three small items, three notes to record
against future work. All fixed below; §0/§1 already reflect the outcome
(round-history header, §1 marked superseded by this section).

### 13.1 B1 — prior-day sweep locks the engineer out of today (BLOCKING, fixed)

**Finding.** A session parked YESTERDAY, swept TODAY at 15:00, correctly
stamps yesterday's `daily_logs` row (`log_date` derivation was always
right — LOG_DATE, from the file header, was never in question). But the
session write set `context.morning_submitted = true` AND
`updated_at = p_now` unconditionally. The engineer messages at 16:00:
`apply_morning_flow_turn`'s own BOT-07 next-day reset
(`quoco_same_ist_day(p_now, v_session.updated_at)`, migration
030:376) compares `updated_at` against TODAY, sees the SAME day (because
the sweep itself just stamped it TODAY), does not wipe context, and the
stale `morning_submitted=true` survives into step (3)'s idle-branch check
→ `outcome='already_complete'`, for a day the engineer submitted nothing
on. Not an edge case — the reviewer's own framing, correct: the FIRST
production run sweeps the accumulated backlog by definition, and every
sweep outage recreates it.

**Fix.** The flag is now gated on the swept row's own day matching
`p_now`'s day, not merely on which step it was parked at:
```sql
context      = (context - 'q1_reask' - 'q2_reask' - 'q3_reask' - 'q4_reask' - 'q5_reask')
               || CASE WHEN v_row.current_step != 1
                         AND quoco_same_ist_day(p_now, v_row.updated_at)
                    THEN jsonb_build_object('morning_submitted', true)
                    ELSE '{}'::jsonb
                  END,
```
Reuses `quoco_same_ist_day` (migration 012, the same helper
`apply_morning_flow_turn`'s own BOT-07 reset calls) rather than
re-deriving the day comparison by hand — one date-comparison convention,
not two. A prior-day sweep still closes the session and stamps the
correct historical `daily_logs` row (unchanged); it now leaves TODAY's
context clean, so a fresh flow starts normally. `updated_at` is still set
to `p_now` unconditionally (the row needs a fresh timestamp regardless of
which day it's attributed to) — the fix is scoped to the flag alone, per
the reviewer's own framing, not to `updated_at`.

**Test** (`test/unit/morning-cutoff-sweep.test.ts`, new): *"B1 (external
review round 1, BLOCKING) — a session parked YESTERDAY, swept TODAY:
stamps the correct historical row, leaves TODAY clean, engineer starts a
fresh flow"*. Seeds a step-2 session with `updated_at` on a prior IST day
and a matching prior-day `daily_logs` row, sweeps TODAY, then asserts
THREE things: (a) the prior day's `daily_logs` row gets
`morning_submitted_at` stamped (log_date attribution was never broken,
confirmed as the test's own baseline); (b) `context.morning_submitted` is
`undefined` after the sweep, not `true`; (c) the actual proof, not just
the flag's absence — `applyMorningFlowTurn({startFlow: true, ...})`
called afterward returns `outcome: 'start'`, `current_step: 1`, the exact
scenario the reviewer named ("the engineer messages at 16:00"). Green
(§13.5).

### 13.2 B2 — the visibility the skip decision leans on does not exist (BLOCKING, fixed)

**Finding (the reviewer's own, against his own earlier argument).**
Skip-over-guess for ambiguous project membership was justified on the
grounds that the failure must be visible rather than silent — but it was
not. `runJobsTick` returns `morningSweep` in the cron's HTTP response
body, which nobody reads. No Sentry call existed anywhere in the sweep
path. A zero-membership engineer parks FOREVER by design (no inbound ever
arrives to re-trigger anything, BOT-07's own reset never fires for a
session whose `current_flow` never returns to `NULL`), surfacing into the
void every sixty seconds.

**Fix.** `lib/daily-logs/morning-cutoff-sweep.ts` gains two exported
functions:
- `reportMorningSweepAnomalies(result, now)` — one `Sentry.captureMessage`
  per entry in `skippedSessions` and `missingDailyLogsRows`, called from
  `runJobsTick` right after every successful sweep.
- `reportMorningSweepError(err)` — extracted from `runJobsTick`'s
  try/catch (the "sweep's own error branch" the reviewer named); calls
  `Sentry.captureException` and returns the same `{ error: string }`
  shape the route already carried, so `runJobsTick`'s own behaviour is
  unchanged, only the capture is new.

**Dedup.** A permanently-parked session gets re-evaluated and re-skipped
every tick (60s) for as long as the underlying `project_members` data
stays wrong — without dedup this alerts every minute, forever.
`Sentry.captureMessage`'s `fingerprint` option groups every event sharing
the same fingerprint into ONE issue instead of creating a new one per
call; scoped here to `(feature, reason, phone_number, IST calendar date)`
— same-day recurrences collapse into one growing issue (no per-minute
spam), while a session still stuck the NEXT day surfaces as a fresh issue
instead of silently vanishing into an old, already-triaged one. No new
DB state — the dedup key is entirely derived from data the RPC already
returns plus the current IST date (`istDateString`, already used
elsewhere in this codebase — `app/api/cron/dpr-generate/route.ts`).

**Tests** (`test/unit/morning-cutoff-sweep-sentry.test.ts`, new file, 8
tests, no database — pure logic over an already-known
`MorningCutoffSweepResult` / a synthetic `Error`; `@sentry/nextjs`'s ESM
namespace exports are not `vi.spyOn`-able directly, so the module is
`vi.mock`'d instead):
1. empty result → Sentry never called.
2. a skipped session → one `captureMessage`, exact fingerprint/tags/extra
   shape asserted.
3. a missing-row anomaly → its own message + fingerprint shape.
4. two anomalies in one result → two calls, neither dropped.
5. the SAME session, reported twice the SAME IST day → identical
   fingerprint (the dedup property).
6. the SAME session, reported the NEXT IST day → DIFFERENT fingerprint
   (stays visible, not muted forever).
7. a real `Error` → captured as-is, `{error: message}` returned.
8. a non-`Error` throw (a string) → wrapped in a real `Error` before
   capture, never dropped.
All 8 green (§13.5).

### 13.3 Small items — all fixed

- **Legacy `q2_reask` stripped.** Added to the session-reset `context -`
  chain alongside the four current keys, matching the runbook's own S1
  resolution `UPDATE` (§11, which already stripped five keys, not four).
  Test: *"legacy q2_reask is stripped alongside the four current reask
  keys, an unrelated key survives"* — seeds a stray `q2_reask` plus a
  genuinely unrelated key, confirms the strip removes only the former.
  Green (§13.5).
- **Transaction-scope header note.** The file header's "one SECURITY
  DEFINER function, one transaction per session" phrasing (describing the
  RPC family: `apply_morning_flow_turn` et al.) was directly inapplicable
  to this function, which is called once per TICK and loops over every
  stale session inside ONE transaction — a mid-loop failure rolls back
  every session that tick, not just the one that failed. Acceptable (the
  next tick retries the lot), now stated explicitly in the header (§1's
  historical pin does not carry this; the current file, §1's own note
  says, is authoritative).
- **Package header re-pinned.** §0 no longer hardcodes a self-referential
  commit SHA — see §0's own explanation of why that class of staleness
  (cite a commit before it exists) recurs by construction, not by
  carelessness, and the fix is to stop hardcoding it, not to hardcode it
  more carefully.

### 13.4 Recorded, per the reviewer's request — not code changes

**The tie-breaker argument, sharpened, in the reviewer's own framing.**
The earlier build phase argued skip-over-guess on grounds of
non-determinism (a `LIMIT 1` with no `ORDER BY` could pick a different
project across runs). The reviewer's sharper version, recorded here as
the one to cite going forward: **a stable tie-breaker converts
non-deterministic fabrication into DETERMINISTIC fabrication — the same
wrong absence against the same wrong project, reliably, every day.
Consistency is a property of good data and of thoroughly corrupted data
alike.** A tie-breaker does not make a guess safe; it makes a guess
*repeatable*, which is a different property and not the one that
matters here.

**The real closer for the multi-project gap, named so the skip reads as a
bridge, not an end-state.** The skip-and-surface fix (§0 finding, item
2 of the original review round; §13.2 above makes it actually visible)
is a mitigation, not a resolution — it prevents fabrication but does
not let a multi-project engineer's sessions ever sweep normally. The
actual closer: **capture `project_id` INTO THE SESSION at flow start**
(`whatsapp_sessions` gains a column, written once when
`apply_morning_flow_turn`'s `p_start_flow=true` branch fires — that RPC
already receives `p_project_id` as a parameter, per its own signature;
this is a column write, not a new lookup) — not a smarter guess at sweep
time. Once the session itself carries the project it was actually
started against, the sweep's own `project_members` COUNT becomes
unnecessary for any session that has this column populated; the skip
path remains only for the OLD-shape sessions and the genuinely-ambiguous
ones. Named here as future work — **not built in this round**: it
requires a schema migration modifying `apply_morning_flow_turn`'s own
logic (a NEW column write inside an existing `SECURITY DEFINER`
function), which trips CLAUDE.md §0's EXTERNAL REVIEW GATE condition (a)
on its own and deserves its own review cycle, not a rider on this one.

**§34's designated closers — recorded so it is never re-solved in
`daily_logs`, where it does not belong.** `design-decisions-beta-
feedback.md` §34 (`checkin_escalations` cannot distinguish "asked, no
answer" from "never asked," OPEN, 2026-08-25) currently points at
`whatsapp_sessions`/`daily_logs` shapes (a parked session, or B3's own
`attendance_defaulted=true` sweep-stamp) as "the evidence [that] already
exists" for detecting an asked-and-unanswered engineer. That evidence is
real today only because nothing better exists yet — it is not where the
eventual fix belongs. The reviewer's designated closers, recorded here as
the answer for whoever picks up §34: **the migration-027 escalation row
itself IS the asked-and-unanswered record** (once `checkin_escalations`
rows are actually being written per Pass 2's own escalation work, an
`awaited`/`escalated` row already states "asked, no answer" as its native
shape — no inference from `daily_logs` columns needed), and **the
#69/031 outbound-send primitive's own send ledger IS the reached-at-all
record** (a confirmed Twilio accept, or its absence, is the actual
delivery signal — a `whatsapp_sessions` row existing is a proxy for
"reached," the send ledger is the real thing). §34's own text should be
resolved against those two objects when they exist, not by adding more
inference logic to `daily_logs`.

### 13.5 Re-rehearsal — round 2

Migration 033 (B1 fix + `q2_reask` strip + header note) re-applied to
test-db (`exfccwlrhoutkgrlikod`) via `supabase db query --linked -f`,
same signature as round 1 — `CREATE OR REPLACE` therefore preserved
grants automatically (confirmed, not assumed): `security_definer=true`,
`anon`/`authenticated` denied, `service_role` granted, byte-identical to
round 1's own fingerprint (§4). No re-ledger needed (the ledger tracks
the migration file, not the function body; version 033 was already
`applied` and stayed so through this body-only re-apply).

`test/unit/morning-cutoff-sweep.test.ts` — **15/15 green** (13 from
round 1, plus B1's own test and the `q2_reask` test, §13.1/§13.3).
`test/unit/morning-cutoff-sweep-sentry.test.ts` — **8/8 green** (new
file, §13.2). `tsc --noEmit` clean.

### 13.6 Rollback proof — still valid, not re-executed this round

§9's executed rollback (`DROP FUNCTION public.sweep_stale_morning_
sessions(timestamptz)`, confirmed gone, tests fail correctly, re-applied,
restored, re-ledgered) targeted the function by NAME + SIGNATURE, which
this round's fixes did not change (body-only edits: the B1 gating
condition, the `q2_reask` key, two header comments). The rollback
mechanism is therefore unaffected by this round and was not re-executed
— re-running an identical mechanical proof against an unchanged signature
would not exercise anything §9 didn't already prove. It would need
re-proving only if a future round changed the function's argument list
(CLAUDE.md §0's `CREATE OR REPLACE` + appended-parameter rule) or its
name.
