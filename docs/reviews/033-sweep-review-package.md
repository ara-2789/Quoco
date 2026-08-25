# Migration 033 — B3 morning cutoff sweep — external review package

Companion to `docs/reviews/morning-flow-migration-review-package.md` §4 (the
original B3 spec) and §11.4 (the `attendance_defaulted`/`attendance_raw`
inheritance requirement B3 must satisfy). That document is the spec half;
this one is the evidence half — rehearsal, executed rollback, apply runbook
— built the same way migration 030's own package was.

**Status: PR open (#111), CI green, NOT merged, NOT applied to prod.**
Merges only after reviewer GO + the prod apply, per this package's own S4.

## 0. Repo-state header

- `main @ 15e0ed2` (`origin/main`)
- This PR's HEAD: `e2e2b39` on `feat/b3-morning-cutoff-sweep-2026-08-25`,
  PR #111, targeting `main`, CI green (below).
- `supabase migration list --linked` (test-db, `exfccwlrhoutkgrlikod`),
  captured after this package's own rollback proof and ledger repairs
  (§8, §9):
  ```
  local/remote agree through every entry: 001-007, 011-030, 032, 033.
  ```
  (`{"local":"032","remote":"032"}` and `{"local":"033","remote":"033"}` —
  both now ledgered; §9 covers the 032 gap this session closed.)
- Last runbook executed: migration 030's production apply,
  `docs/reviews/030-apply-record.md` (2026-08-25).

## 1. The function in full

Pinned via `git show e2e2b39:supabase/migrations/033_sweep_stale_morning_sessions.sql`
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
