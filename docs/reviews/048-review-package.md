# 048 — engineer registration (add-engineer slice 1): review package

**FULL tier. HELD. No apply GO exists. Nothing in this package was applied to any database.** The migration lives in
`docs/reviews/`, never in `supabase/migrations/` (`CLAUDE.md` §6); it moves only in the commit that applies it.

This package implements `docs/plans/add-engineer-plan.md` (rev13, `git show caab70b:docs/plans/add-engineer-plan.md`; the
commit is on `feat/add-engineer-plan`, **not on `main`**). Where this package and the plan disagree, the disagreement is
named in section 10, never resolved silently.

## 0. Repo-state header (pinned inputs — a reviewer checks these, not memory)

| Input | Value |
|---|---|
| `main` | `origin/main` @ `c0b20782f05cb4d9bf1942a5ed7fab04e8ada3de` (fetched fresh 2026-09-19) |
| **S1 lint (rule 11, `no-auth-uid-as-users-id`)** | **MERGED as `c0b2078`** (PR #306); rule commit **`9887f7e`**. The package's lint captures ran with the rule live. |
| Plan | `caab70b` (rev13) on `feat/add-engineer-plan` |
| **Artefact commit — everything below is pinned to this** | **`faaa8d4753d775829992818f4eee6998c7c1b458`** on `feat/048-engineer-registration` |
| `supabase migration list --linked` | target **test-db `exfccwlrhoutkgrlikod`** (ref printed from `supabase/.temp/project-ref` and compared first). Local `001`–`007`, `011`–`025`, `027`–`047`. Remote identical **except `042`, `043`, `044`, `046` have no remote row** (test-db ledger lag; unrelated to 048, not touched). **`048` is on neither side.** **Prod's ledger was not probed** (only test-db was authorised). |
| Last runbook executed | 047's prod apply, 2026-09-17 — `docs/reviews/047-prod-apply-record.md` |

## 1. What 048 is

| Object | Plan | What it is |
|---|---|---|
| `users.registered_by`, `registered_at`, `consent_attested` | §2.8 | three nullable columns, no default |
| `users_registered_pairing_chk` | §2.8 | all three NULL together (every legacy row) or all three set |
| `users_registered_by_fkey` | §2.8a | composite `(registered_by, tenant_id) → users (id, tenant_id)`, `ON UPDATE NO ACTION ON DELETE RESTRICT`, both written out |
| `project_members_role_check` | §4.5 | `role IN ('pm','qs','engineer','owner','subcontractor','admin')`, mirroring `users_role_check` |
| `engineer_admin_gate(uuid)` | §2.7 | the shared authorisation helper — SECURITY DEFINER, callable by **no role but its owner** |
| `add_engineers_to_project(uuid, jsonb, boolean, boolean) → jsonb` | §2.1–§2.6 | the SECURITY DEFINER add function with its dry-run flag; `authenticated` only |
| DOWN | §6 | every line commented (`down-section-must-be-commented`); order = **revert commit first, then DOWN** |

**Review gate (`CLAUDE.md` §0) tripped on (a)** new SECURITY DEFINER logic, **(b)** grants + SECURITY DEFINER status + a
CHECK on an RLS-governed table, **(c)** auth/identity, **(d)** the DOWN drops columns holding attribution data.
**Not tripped: (e)** — nothing moves money. Not one condition is a judgement call.

## 2. External-review conditions (round 2, "Design GO (conditional)") — where each stands in THIS PR

Label collision, stated: these are the *second* round's labels; rev8's "S1" (the lint) and "N1" (`anon` `SELECT` on `users`)
are different items.

| Item | Where it is closed | Status |
|---|---|---|
| **S1** typo-repair runbook | `docs/reviews/048-typo-repair-runbook.md` | **Written, NOT rehearsed.** Rehearsal is a gate on the merge (section 4). |
| **S2** list page shows non-active rows, label derived from `users.status` | plan §5.1; **T44(iii)** | App code — **not in this PR** |
| **S3** confirm→apply is a SET check | plan §5.2; **T46** | App code — **not in this PR** |
| **S4** NULL `p_consent_attested` raises, never defaulted | `048` SQL; **T20** | **In the SQL; executed on the scaffold** |
| **S5** attribution FK actions explicit | `048` SQL; **T47**; fingerprint F5 | **In the SQL; executed on the scaffold** |
| **S6** function identity pinned | `048-scaffold/fingerprint.sql`; **T48** | **Queries written and run on the scaffold;** values are captured at apply |
| N1 (round 2) — lint matches both operand orders | merged lint `c0b2078` | Closed |
| N2 (round 2, D16) — lint extension (b), `<x>_id = auth.uid()` | merged lint `c0b2078` | Closed |
| N3 (round 2) — list page's gate | plan §5.1; **T44(iv)**; **D23 — not yet confirmed by Aravind** | App code — **not in this PR** |
| **Condition 3** — file the D12 rider and N1 as tracked backlog | `docs/build-status.md`, two entries + two index rows, each with path:line and an owner | **Filed in this PR** (all cited lines re-verified against the tree; one of the plan's citations did not hold — section 10, F8) |

## 3. Artefacts (all pinned to `faaa8d4753d775829992818f4eee6998c7c1b458`; view each with `git show faaa8d4753d775829992818f4eee6998c7c1b458:<path>`)

| Path | Purpose |
|---|---|
| `docs/reviews/048_engineer_registration.sql` | the held migration (sha256 `3b404a29b26eccf7b54a3ec1d7863ae0ce793a9f2002d80c59fbefafc762ec41`) |
| `docs/reviews/048-review-package.md` | this file |
| `docs/reviews/048-typo-repair-runbook.md` | review condition S1 |
| `scripts/shared-fixture-fk-coverage.json` | **+1 entry** `{table:'users', column:'registered_by', parent:'users', action:'delete'}` — **same commit as the 048 file** (Rule 9 has no exceptions mechanism and scans held files) |
| `scripts/migration-number-reservations.json` | 048's entry re-pointed at this file, dated correction appended — **forced by Rule 8** (section 10, F1) |
| `docs/build-status.md` | the D12 rider and N1 backlog entries (condition 3) |
| `docs/reviews/048-scaffold/{stubs.sql,tests.sql,mutate.py,run.sh,lintvar.py,fingerprint.sql}` (commit `faaa8d4`) and `down.sh` (commit `3e5457e`) | the disposable dry-run scaffold, its 57 checks, the red-variant generator, the lint-proof script, the apply-record queries and the scaffold DOWN rehearsal. Not migrations; no number. |

**Not touched:** anything under `app/`, `lib/`, `supabase/migrations/`. No test file was written or modified.

## 4. Deploy order — MERGE is the deploy

The repo has no deploy step: **merging to `main` deploys** (plan §6.1). An app merged before 048 fails on the missing
`add_engineers_to_project` function and the three `users` columns. Order:

1. **048 → test-db** — one file, foreground, `supabase db query --linked -f`, **never `db push`**, ref named and
   `supabase/.temp/project-ref` printed and compared first. **Requires a GO no review round has given.**
2. **CI green on the app PR against that test-db** — **pinned run URL, `headSha` = the PR's current HEAD** (a green run certifies a SHA, not a branch). **Prerequisite: the stranded test-db fixture rows from this PR's own red runs are cleaned (section 8.5)**, or `owner-deliver-job` fails for a reason unrelated to 048.
3. **048 → prod** — Aravind's go-ahead in the same exchange; **PITR observed, not assumed**.
4. **THEN merge** — only once the typo-repair runbook is **rehearsed** and its record cited. Use a regular merge commit, not squash, for a branch that keeps being worked on (`CLAUDE.md` §0).
5. Verify on the **production deployment**, never a Preview (which database a Preview reads is undeterminable from the repo — plan §6.1, UNKNOWN #33).

Steps 1–3 are safe with the old app serving: the migration is additive and its objects are unused until the app lands.

**Rollback: revert commit first (merged, deployed), THEN the DOWN.** DOWN first drops the function and columns the deployed
app still calls, and **destroys attribution data** for every engineer added since apply — there is no other record of who
created them. DOWN is rehearsed with captured output before any prod apply (full tier).

**Gate order (full tier, `CLAUDE.md` §0):** external review → test-db apply → **DOWN rehearsal with captured output** → CI
green with pinned run URL → merge → PITR observed → prod apply → verify by observation → ledger → apply record.

## 5. The apply record's pinned fingerprint (review condition S6; plan §2.8a)

The apply record carries, **on test-db and on prod, query text printed above each result**, the output of
`docs/reviews/048-scaffold/fingerprint.sql`. Its six queries pin, in the record:

| # | Pins |
|---|---|
| F1 | the exact parameter list as a string — `add_engineers_to_project(uuid, jsonb, boolean, boolean)`, compared on the **type list** (the catalog's own rendering has no space after commas); `engineer_admin_gate(uuid)` |
| F2 | `pg_proc` count per name in `public` — **1 each** |
| F3 | `md5(prosrc)` + length; **`md5(pg_get_functiondef)`** + length (beyond the ask: `prosrc` alone misses `SECURITY DEFINER`/`search_path`); owner; SECURITY DEFINER; `proconfig`; ACL (`proacl`) |
| F4 | `has_function_privilege` per role **by name** (`anon`, `authenticated`, `service_role`, `postgres`) and whether `PUBLIC` holds EXECUTE |
| F5 | for `users_registered_by_fkey`: **`confdeltype = 'r'`, `confupdtype = 'a'`**, `confmatchtype`, `conkey`, `confkey`, `pg_get_constraintdef`; plus the two CHECKs |
| F6 | the three columns' type / nullability / default and `col_description` (048 adds no `COMMENT ON`, so all read NULL) |

The values are **captured at apply and never typed in advance**. The scaffold's own readback of the same queries is in
section 7 as proof that the queries run; it is **not** the record. Slice 2's package re-runs the same queries after its
`CREATE OR REPLACE` and shows count still 1, an identical type list and grants, and the body delta — re-probing live first,
because a recorded hash is a baseline, not the thing.

| Field | test-db `exfccwlrhoutkgrlikod` | prod `jvxwqignooseazzmwhvl` |
|---|---|---|
| ref printed and confirmed | ______ | ______ |
| F1 type list / F2 counts | ______ | ______ |
| F3 `md5(prosrc)`, `md5(pg_get_functiondef)`, owner, `proconfig`, ACL | ______ | ______ |
| F4 per-role EXECUTE | ______ | ______ |
| F5 `confdeltype`/`confupdtype` etc. | ______ | ______ |
| F6 columns and comments | ______ | ______ |
| real **anon-key** call to `/rpc/add_engineers_to_project`, refusal `42501` observed | ______ | ______ |
| `service_role` call refused | ______ | ______ |

## 6. Tests — what each asserts, and how it is shown to FAIL before the fix exists

"Shown to fail" = a captured red run against a variant that lacks the fix (`CLAUDE.md` §7). Red variants run on the
**disposable local scaffold** (a schema-only dump of test-db, loaded into a throwaway local Postgres 17), never on test-db or prod.

**Status legend.** **SCAFFOLD** = the SQL side is executed on the scaffold: green on the real file *and* red on a named
variant (section 7). **SPEC** = specified here, **not built** in this pass: it exercises `app/`/`lib/` code this pass may not
touch, or needs 048 on test-db, which has no apply GO. **CI-ONLY** = cannot be verified locally.

| # | Asserts | Shown to FAIL first | Status |
|---|---|---|---|
| **T1** | A caller with `users.tenant_id` NULL (`role='admin'`, real `auth_id`) is refused `no_data_found` in **both** modes; nothing written. | Variant `lt_tenant` (`<>` for `IS DISTINCT FROM`; `NULL <> uuid` is NULL, the guard never fires). **Red: T1 dry-run, T1 apply, T6 row 10.** | **SCAFFOLD** |
| **T5** | A tenant-B engineer's number seen by a tenant-A admin is `number_registered` with **exactly `{idx,status}`**; the serialised payload holds no tenant-B project id / project name / full name / tenant id; a tenant-B engineer with **no membership** is also `number_registered`. In-tenant: `on_another_project` (`other_project_name`), `registered_no_project`, `already_on_this_project`. | Variants `leak_name`, `no_cross_tenant`, `cross_no_project` — one per plan mutation (i)/(ii)/(iii). | **SCAFFOLD** |
| **T6** | The shared §7.2 matrix, run against the **SQL** function: 11 rows + 2 (unknown auth uid, NULL auth uid). The **TypeScript** half and the agreement assertion need `lib/engineers/gate.ts`. | `gate_soft` (rows 4–8 go red), `foreign_42501` (rows 9–10), `lt_tenant` (row 10). | **SCAFFOLD (SQL half)**; TS half **SPEC** |
| **T7** | A dry run writes nothing (`users`, `project_members` counts unchanged) and returns ≥1 `ok`. **Uses numbers no other check touches**, so an earlier check cannot mask a wrongful write. | `dry_writes` (falls through to step 7). **Red: both T7 checks.** | **SCAFFOLD** |
| **T8** | An unauthorised caller's dry run gets an **error, not statuses**. | `gate_soft` — the gate is made soft, statuses leak. **Red: T8.** | **SCAFFOLD** |
| **T9** | SQL half: the function accepts the generic shape `^\+[1-9][0-9]{1,14}$` and rejects malformed numbers, blank/over-100 names, non-array / non-object / missing-key / non-string / duplicate rows (`22023`) and 0 / 51 rows (`54000`). TS half: the validator over the §3.3 corpus generated from the boundary constant. | Natural red: with no 048 the function is absent. | **SCAFFOLD (SQL half)**; TS half **SPEC** |
| **T10** | (a) read-back: `tenant_id`, `role='engineer'`, `status='active'`, `messaging_blocked=false`, `auth_id IS NULL`, **`registered_by` = the caller's `users.id`**, one shared `registered_at`, `consent_attested` = the value passed; membership `role='engineer'`, same tenant. (b) **source guard**: the `INSERT INTO public.users` column list contains all of them. | `drop_registered_by` (pairing CHECK refuses the row). **Red: 4 × T10, T20, T18, T47(ii).** | (a) **SCAFFOLD**; (b) source guard **SPEC** (a grep, in section 7, shows the column list) |
| **T12** | Every export of `lib/engineers/copy.ts` is non-empty (`it.fails` at commit). | Verified on vitest 3.2.7 in the plan. | **SPEC** — `lib/` barred |
| **Boundary test (T13)** | One literal **`+919176861156`**, held in **one named constant `TEST_BOUNDARY_PHONE_LITERAL` in one file, `test/helpers/boundary-phone.ts`** and swappable in one edit, driven through the function in **apply mode**, read back, cleaned up. Its fixture project has **`status <> 'active'`** so the roster never loads it and no message can leave. No other `+91` value is minted anywhere. | Function absent → fails (the baseline run shows `42883`). | **SPEC** — needs 048 on test-db. **This section is the only place this package states the literal.** |
| **T14** | End state: after adding one engineer, `resolveEngineerProject` returns `resolved` and the morning roster includes them. | Function absent → `zero_memberships`. | **SPEC** — needs 048 on test-db |
| **T15** | Two concurrent adds of one number: exactly one wins. | — | **CI-ONLY — NOT VERIFIED LOCALLY** (`CLAUDE.md` §0: this sandbox serialises concurrent RPCs, so a local pass proves nothing) |
| **T16** | ACL evidence: `authenticated` may call the public function and **not** the helper; `anon` and `service_role` refused (`42501`) on both; PUBLIC holds nothing; owner `postgres`; `proconfig` exactly `search_path=public`; **the helper's ACL is exactly `{postgres=X/postgres}`.** | `no_revokes` — default privileges leave EXECUTE with `anon`/`authenticated`/`service_role`. **Red: 5 × T16.** | **SCAFFOLD**; the real **anon-key PostgREST** refusal and the test-db catalog readback are owed at apply (section 5) — the scaffold has no PostgREST |
| **T17** | A tenant-A admin with a tenant-B `p_project_id` gets `no_data_found` **identical in code and message** to a nonexistent id; zero writes. | `foreign_42501`. **Red: T17, T6 rows 9–10, T1.** | **SCAFFOLD** |
| **T18** | Atomicity: row K fails after classification → **zero** new rows. (The scaffold forces the failure with a scratch trigger on the third insert.) | `atomic_subblocks` — per-row `EXCEPTION` blocks, earlier rows persist. **Red: T18.** | **SCAFFOLD** |
| **T19** | The CHECK: `'Engineer'`, `'engineer '`, `'ENGINEER'` and a value outside the six are rejected `23514`; each of the six valid roles succeeds. | Natural red: with no 048 the four invalid inserts **succeed**. | **SCAFFOLD** |
| **T20** | `p_consent_attested = false` does not block apply and **stores `false`**; **NULL raises `22023` in apply AND dry-run, zero rows written**; the pairing CHECK backstops a direct `INSERT` with `registered_by` set and `consent_attested` NULL (`23514`); a source guard asserts `coalesce(p_consent_attested` appears **nowhere** in the 048 file. | `coalesce_consent` — the **natural red against the rev11 spec**: NULL is silently stored as `false`. **Red: 3 × T20.** | **SCAFFOLD**; source guard: grep in section 7 |
| **T21** | Boundary-literal source guard: in `test/`, `+91` followed by a digit appears only in `test/helpers/boundary-phone.ts`; the boundary test imports `test/helpers/db.ts`, imports **no** module under `lib/whatsapp/outbound/` or `app/api/cron/`, and creates its fixture project `status <> 'active'`. | Mutation: a second `+91` literal / import of `send.ts` / an `active` project. | **SPEC** |
| **T44** | The engineers list page is read-only, shows what landed, shows non-active rows labelled from `users.status`, and is gated by `decideEngineerAdminAccess` before any read. | Per plan §7.1. | **SPEC** — `app/` barred |
| **T46** | **Confirm → apply is a SET check, not a count.** (i) pure `sameConfirmedSet(carried, reparsed)`: `[A,B]` vs `[B,A]` equal; **`[A,B]` vs `[A,C]` — same count, one number swapped — mismatch**; `[A,B]` vs `[A]`, `[A,B,C]`, and a one-digit change mismatch. (ii) on test-db: preview a 2-row paste, apply with one number swapped for another valid unregistered number (**count unchanged, 2 = 2**) → **refused**, `add_engineers_to_project` **not called** (spy), counts unchanged. (iii) the unedited paste applies and what lands is exactly the carried list. | **A swap that preserves the count must be refused.** Natural red against the rev11 (count-only) spec: (ii) applies the swapped set. Mutations: compare lengths only → (i) swap case and (ii) fail; compare unsorted → the reorder case fails; skip the check → (ii) fails. | **SPEC** — needs `lib/engineers/confirm-set.ts` (barred) |
| **T47** | The attribution FK: `confdeltype='r'`, `confupdtype='a'`, `confmatchtype='s'`; deleting the registering admin while an engineer they registered stands is **refused with SQLSTATE `23503`** and both rows are unchanged. | `fk_bare` (a bare `REFERENCES`: `confdeltype='a'`) — **only (i) goes red; (ii) stays green**, which is the proof that **(ii) alone cannot tell RESTRICT from NO ACTION** and (i) is the discriminating assertion. `fk_cascade` — both go red (the engineer is deleted). | **SCAFFOLD**; pinned again on test-db and prod at apply |
| **T48** | The function's identity: `pg_proc` count for `add_engineers_to_project` in `public` **= 1**; the type list is exactly `uuid, jsonb, boolean, boolean`; `md5(prosrc)` non-null and equal to the apply record. | `overload5` — a `CREATE OR REPLACE` adding a fifth (defaulted) parameter makes a **second overload**: **count = 2**, and a four-argument call becomes **ambiguous**, so the whole suite goes red (42 fails). That is the exact `CLAUDE.md` §0 hazard slice 2 must avoid. | **SCAFFOLD**; re-run after slice 2's redefinition |
| **T49** | **The roster status filter is pinned.** The typo-repair statement removes the engineer from **both** rosters: a fixture engineer on a **neutralised** (non-active) project appears in `fetchMorningRoster` and `fetchEveningRoster`; after the runbook's `UPDATE` (via the service client) it appears in **neither** and every other column is unchanged. No Twilio module is imported; no send. **`test/unit/outbound-roster.test.ts` has no `status` assertion today.** | Natural red: before the `UPDATE` the engineer is on both rosters. Mutation (scratch copy of `roster.ts`): remove `.eq('users.status','active')` → the row stays on both → **fails**. | **SPEC** — needs 048 on test-db to create the engineer through the function |

**Four checks pass vacuously against the baseline (no 048)** and are therefore *not* claimed as red there: T7 "wrote
nothing", T8 "error, not statuses", T5 "payload holds no tenant-B data" and T19 "six valid roles accepted" — each is a
negative or "nothing happened" assertion that an absent function satisfies trivially. Each is paired with a positive check
that **does** go red on the baseline, and has its own variant above (`dry_writes`, `gate_soft`, `leak_name`).

## 7. Captured evidence

**Provenance.** Every capture below ran at a **clean tree**: the commit SHA and an **empty `git status --porcelain`** were
captured at the top of the run (`fde3ffb444385357ad9dd63b504b3f186fcb6949` for the scaffold, lint and test runs;
`3e5457e31634bd61d9cbb01cb0b8fd95b5085311` for the DOWN rehearsal and the lint-variant table), so the SHA names the commit *and* the
working tree matched it. The artefacts under test — the 048 file, the scaffold, both JSON files — are **blob-identical**
between the artefact commit `faaa8d4` and both run SHAs (`git rev-parse <commit>:<path>` equal for all nine paths; captured in the build log).

| Artefact | git blob id (identical at `faaa8d4`, `fde3ffb`, `3e5457e`) |
|---|---|
| `docs/reviews/048_engineer_registration.sql` | `32f7a9c87e77820f51b5580cd6d6858fd6126406` (sha256 `3b404a29b26eccf7b54a3ec1d7863ae0ce793a9f2002d80c59fbefafc762ec41`) |
| `docs/reviews/048-scaffold/tests.sql` | `b520b8573a490296692e165b709bded0ba6b8cd1` |
| `docs/reviews/048-scaffold/mutate.py` | `0a6870076ea2c57a34aea34f4d61a165f06483a4` |
| `docs/reviews/048-scaffold/run.sh` | `26f24bbdc87dcda359946c899cb0a8231ff06388` |
| `docs/reviews/048-scaffold/stubs.sql` | `bdcc657e588521530213d846e6c38839b48974e9` |
| `docs/reviews/048-scaffold/fingerprint.sql` | `c5116637b77901c9da82af92c4585f4b6e3a24fb` |
| `docs/reviews/048-scaffold/lintvar.py` | `ff06bdf5c00ece152dae80055557ff7ed15cc2fe` |
| `scripts/shared-fixture-fk-coverage.json` | `74caab68eaf2e694d2045dbe990b5057972ba343` |
| `scripts/migration-number-reservations.json` | `bdfec592d23c97f69440aaa5cb893a3fb3d0db61` |

The full command-and-output record of this build is `~/Desktop/048-build.txt` (outside the repo). Every result below is
reproducible from the pinned scripts; the run commands are shown.

### 7.1 How the scaffold was built — the SQL is EXECUTED, not only linted

| Step | Observed |
|---|---|
| link | `supabase link --project-ref exfccwlrhoutkgrlikod` (the ref named in the instruction) → `{"project_ref":"exfccwlrhoutkgrlikod","message":""}`; `supabase/.temp/project-ref` printed and equal: **`CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`** |
| dump | `supabase db dump --linked --schema public --dry-run` printed a `pg_dump --schema-only` script that embeds a live `PGPASSWORD`. It was **redirected to a file, never displayed unmasked**, run once as a **read-only** `pg_dump`, and **deleted**. Result: 4,370 lines, 32 tables, 16 functions in `public`. |
| **live pre-state of test-db, read from that dump** | `registered_by`: 0 hits; `consent_attested`: 0; `add_engineers_to_project`: 0; `project_members_role`: 0 (no role CHECK); `users_id_tenant_id_key UNIQUE (id, tenant_id)` **present**; `users_role_check` and `users_status_check` as the plan states. **The 048 objects do not exist on test-db today.** |
| local server | PostgreSQL 17.11 (Homebrew), private unix socket, no TCP listener, in the build's temp directory; test-db and prod are 17.6 (same major, `CLAUDE.md` §7) |
| named stubs | roles `anon`, `authenticated`, `service_role` (BYPASSRLS), `supabase_auth_admin`; schema `auth` with `auth.users(id)` and an `auth.uid()` that reads the same request JWT settings Supabase's does; `USAGE` on `public`/`auth`. **`vector(1536)` stubbed as `text`** in a local copy (three columns, all unused by 048) because pgvector is not installed locally — the exact transform is in the log. |
| load | the dump loaded into a fresh database with **0 errors**; 32 tables, 16 functions, `users_id_tenant_id_key` present |
| observation | `public` holds **14** SECURITY DEFINER functions of 16 — **which matches the plan's own recorded probe `n` (14 rows); the plan's prose "15" is the miscount (section 10, F11)** |

### 7.2 The 57 checks — the committed file, and every red variant

`docs/reviews/048-scaffold/run.sh <mode>` clones the pristine pre-048 baseline database, applies the file (or a variant from
`mutate.py`, which errors if its target text does not occur **exactly once**), and runs `tests.sql`. Every check is wrapped: an
unexpected error is a recorded FAIL, never a silently missing test. **stderr of the real run was empty (0 bytes); 31 fixture rows built.**

**The committed file: 57 pass, 0 fail** (`real`).

| Run | Variation | Targets | pass / fail | Checks that went red |
|---|---|---|---|---|
| `real` | the committed 048 file, unmodified | — | 57 / 0 | — |
| `base` | **no 048 applied** (the natural red: function and columns absent) | everything that asserts a positive; 4 checks pass vacuously (section 6) | 4 / 53 | 53 of 57 (list in the build log) |
| `lt_tenant` | `<>` instead of `IS DISTINCT FROM` in the tenant bind | T1 | 54 / 3 | `T6 row10 admin/caller tenant NULL -> P0002`; `T1 tenant-NULL admin: dry-run -> P0002`; `T1 tenant-NULL admin: apply -> P0002, nothing written` |
| `dry_writes` | a dry run falls through to the writes | T7 | 48 / 9 | `T6 row1  admin/same/no membership -> allow`; `T6 row2  admin/same/pm membership -> allow`; `T6 row3  pm/same/pm membership -> allow`; `T7 dry-run returns ok verdicts (>=1) and applied=false`; `T7 dry-run wrote nothing (users + project_members counts unchanged)`; `T5 statuses: B-engineer, B-no-membership, on-another, no-project, already,`; `T9 generic shape accepted: +12 and a 15-digit number`; `T9 name rules: blank and 101 chars -> 22023, exactly 100 accepted`; `T16 real call as authenticated on the PUBLIC function succeeds (dry-run ok` |
| `gate_soft` | authorisation not enforced before the number lookups | T8, T6 | 49 / 8 | `T6 row4  pm/same/no membership -> 42501`; `T6 row5  pm/same/engineer-only membership -> 42501`; `T6 row6  qs/same/pm membership -> 42501`; `T6 row7  engineer/same/pm membership -> 42501`; `T6 row8  NULL role/same/pm membership -> 42501`; `T6 extra unknown auth uid -> 42501`; `T6 extra NULL auth uid (anon-shaped) -> 42501`; `T8 unauthorised dry-run gets an error, not statuses` |
| `atomic_subblocks` | per-row `EXCEPTION` sub-blocks around the inserts | T18 | 56 / 1 | `T18 row 3 of 3 fails after classification: error returned AND zero new use` |
| `coalesce_consent` | NULL consent silently becomes `false` (the rev11 spec) | T20 | 54 / 3 | `T20 consent=NULL raises 22023 in APPLY mode, zero rows written`; `T20 consent=NULL raises 22023 in DRY-RUN mode too, zero rows written`; `T20 dry-run flag NULL raises 22023 (a NULL would otherwise read as not-a-d` |
| `drop_registered_by` | `registered_by` not written | T10 | 50 / 7 | `T10 apply: applied=true, both rows added, each with a user_id`; `T10 read-back: tenant, role, status, messaging_blocked, auth_id NULL, regi`; `T10 membership: role engineer, caller's tenant, this project, user_id matc`; `T10 re-adding the same numbers now reports already_on_this_project (apply `; `T20 consent=false does not block apply and stores false (not NULL)`; `T18 row 3 of 3 fails after classification: error returned AND zero new use`; `T47(ii) deleting the registering admin while engineers stand is refused 23` |
| `leak_name` | a cross-tenant row carries a full name | T5 (i) | 54 / 3 | `T5 cross-tenant rows carry EXACTLY {idx,status}`; `T5 payload text contains no tenant-B project name, full name, project id o`; `T5 registered_no_project / already / owner rows carry EXACTLY {idx,status}` |
| `no_cross_tenant` | classify only within the caller's tenant | T5 (ii) | 56 / 1 | `T5 statuses: B-engineer, B-no-membership, on-another, no-project, already,` |
| `cross_no_project` | `registered_no_project` returned cross-tenant | T5 (iii) | 56 / 1 | `T5 statuses: B-engineer, B-no-membership, on-another, no-project, already,` |
| `foreign_42501` | a foreign project id raises a different code than a nonexistent one | T17 | 52 / 5 | `T6 row9  admin/other tenant project -> P0002`; `T6 row10 admin/caller tenant NULL -> P0002`; `T1 tenant-NULL admin: dry-run -> P0002`; `T1 tenant-NULL admin: apply -> P0002, nothing written`; `T17 tenant-A admin + tenant-B project: same code AND message as a nonexist` |
| `fk_bare` | a bare `REFERENCES` (`confdeltype` `a`) | T47 (i) only | 56 / 1 | `T47(i) FK actions: confdeltype = r, confupdtype = a, confmatchtype = s, on` |
| `fk_cascade` | `ON DELETE CASCADE` | T47 (i) and (ii) | 55 / 2 | `T47(i) FK actions: confdeltype = r, confupdtype = a, confmatchtype = s, on`; `T47(ii) deleting the registering admin while engineers stand is refused 23` |
| `no_revokes` | the two `REVOKE` statements removed | T16 | 52 / 5 | `T16 catalog: add fn -- authenticated may EXECUTE; anon, service_role and P`; `T16 catalog: helper -- no role but the owner may EXECUTE (anon, authentica`; `T16 catalog: the helper's ACL is exactly {postgres=X/postgres} (the explic`; `T16 real call as service_role -> 42501, even with a valid admin auth uid`; `T16 real call to the HELPER as authenticated, anon and service_role -> 425` |
| `overload5` | `CREATE OR REPLACE` adding a fifth defaulted parameter (a second overload) | T48 | 15 / 42 | 42 of 57 (list in the build log) |

**What the red runs show, beyond "it goes red":**

- **`fk_bare` — only T47(i) goes red; T47(ii) stays green.** A bare `REFERENCES` still refuses the delete (`NO ACTION` refuses too), so the delete-refusal check **cannot tell RESTRICT from NO ACTION**. The catalog pin — `confdeltype = 'r'`, `confupdtype = 'a'` — is the discriminating assertion, exactly as plan §2.8a says. `fk_cascade` turns both red.
- **`overload5` — 42 of 57 fail, not just T48.** Adding a fifth *defaulted* parameter via `CREATE OR REPLACE` does not replace: it creates a **second** function, and every four-argument call becomes **ambiguous**. This is the `CLAUDE.md` §0 signature hazard reproduced on the scaffold, and it is why T48 pins the count and the type list, and why slice 2 must re-run it.
- **`lt_tenant` — the caller with a NULL tenant is caught on the dry-run path**, where the plan's T1 shows the engineer would be written into the *project's* tenant. (On the apply path the composite attribution FK would also refuse that write, `23503`; T1 is red on the dry-run and apply checks regardless.)
- **`gate_soft` — T8 and the matrix rows 4–8 (plus the unknown-uid and NULL-uid rows) go red together**, which is the point of T6 running the whole matrix.
- **Four checks pass vacuously against the baseline** — listed in section 6 — and are proved by their variants, not by the baseline.
- **One harness defect was found and fixed by these runs, not by inspection:** T7's dry-run numbers had first been shared with the matrix rows, so under `dry_writes` an earlier check had already registered them and T7's own "wrote nothing" check *passed*. Its numbers are now unique to it; the table above is from the corrected file. The first attempt also missed the `auth.users` FK on `users.auth_id` (a fixture defect, 32 of 57 spuriously failing) — a reminder that an all-green count needs the stderr and fixture count checked, which is why both are captured.

### 7.3 Fingerprint readback — on the SCAFFOLD (proof the queries run; not the apply record)

`docs/reviews/048-scaffold/fingerprint.sql` (blob `c5116637…`), run against the scaffold database that carries the committed file:

```
         proname          |         arg_type_list         |                     regprocedure                     
--------------------------+-------------------------------+------------------------------------------------------
 add_engineers_to_project | uuid, jsonb, boolean, boolean | add_engineers_to_project(uuid,jsonb,boolean,boolean)
 engineer_admin_gate      | uuid                          | engineer_admin_gate(uuid)
(2 rows)

         proname          | n 
--------------------------+---
 add_engineers_to_project | 1
 engineer_admin_gate      | 1
(2 rows)

         proname          |            md5_prosrc            | len_prosrc |         md5_functiondef          | len_functiondef |  owner   | security_definer |      proconfig       |                     proacl                     
--------------------------+----------------------------------+------------+----------------------------------+-----------------+----------+------------------+----------------------+------------------------------------------------
 add_engineers_to_project | 85ec32ab5959613e6ac9932740e3ad1a |       6240 | 97dacf3ce23f8f3ac906209a1e2de35b |            6488 | postgres | t                | {search_path=public} | {postgres=X/postgres,authenticated=X/postgres}
 engineer_admin_gate      | 968a53c5260d7fda4d7fcc53552d3671 |       1661 | f7e9ff1f407e90b4741d7629e4802128 |            1874 | postgres | t                | {search_path=public} | {postgres=X/postgres}
(2 rows)

         proname          | anon | authenticated | service_role | postgres | public_pseudo_role 
--------------------------+------+---------------+--------------+----------+--------------------
 add_engineers_to_project | f    | t             | f            | t        | f
 engineer_admin_gate      | f    | f             | f            | t        | f
(2 rows)

    on_table     |           conname            | contype | confdeltype | confupdtype | confmatchtype |   conkey   | confkey |                                                         definition                                                          
-----------------+------------------------------+---------+-------------+-------------+---------------+------------+---------+-----------------------------------------------------------------------------------------------------------------------------
 project_members | project_members_role_check   | c       |             |             |               | {6}        |         | CHECK ((role = ANY (ARRAY['pm'::text, 'qs'::text, 'engineer'::text, 'owner'::text, 'subcontractor'::text, 'admin'::text])))
 users           | users_registered_by_fkey     | f       | r           | a           | s             | {18,3}     | {1,3}   | FOREIGN KEY (registered_by, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT
 users           | users_registered_pairing_chk | c       |             |             |               | {18,19,20} |         | CHECK ((((registered_by IS NULL) = (registered_at IS NULL)) AND ((registered_by IS NULL) = (consent_attested IS NULL))))
(3 rows)

     attname      |           type           | attnotnull | default_expr | comment 
------------------+--------------------------+------------+--------------+---------
 consent_attested | boolean                  | f          |              | 
 registered_at    | timestamp with time zone | f          |              | 
 registered_by    | uuid                     | f          |              | 
(3 rows)
```

Read as designed: one function per name; type list `uuid, jsonb, boolean, boolean`; helper ACL exactly `{postgres=X/postgres}`;
public function `{postgres=X/postgres,authenticated=X/postgres}`; both owned by `postgres`, SECURITY DEFINER, `proconfig`
`{search_path=public}`; the FK reads `confdeltype = r`, `confupdtype = a`, `confmatchtype = s`; the three columns are
nullable with no default and **no comment** (048 adds no `COMMENT ON`). `pg_get_constraintdef` omits `ON UPDATE NO ACTION`
because it is the default — the pin is `confupdtype`, not the rendered text.

### 7.4 DOWN rehearsal — on the SCAFFOLD (the test-db rehearsal is still owed)

`docs/reviews/048-scaffold/down.sh` (commit `3e5457e`): clone the baseline, apply UP, extract the commented DOWN block
(`-- BEGIN;` … `-- COMMIT;`, prefix stripped), run it, and diff a **schema-only `pg_dump`** — which includes `COMMENT ON`
statements, ACLs, constraints, defaults and functions — against the baseline; then re-apply UP.

```
dump BEFORE (baseline, pre-048): 5666 lines
UP applied, exit 0            → dump differs from baseline by 257 lines
DOWN applied, exit 0
diff baseline vs after-DOWN:  exit 0 ; differing lines: 0
UP re-applied on the reverted database, exit 0 ; functions after re-UP: 2
```

The extracted DOWN was: two `DROP FUNCTION IF EXISTS` with the exact type lists, `DROP CONSTRAINT IF EXISTS` for the role
CHECK, the FK and the pairing CHECK, then `DROP COLUMN IF EXISTS` for the three columns. **After DOWN the schema is
byte-identical to the baseline, including comments and grants** (`CLAUDE.md` §7: a teardown verifies comments too).
**Not shown here, and owed:** the same rehearsal on the cleaned test-db with captured output; and the
"live in-flight session is still processable after DOWN" check, which is **not applicable before the merge** — no
application code calls either function until the app lands, and the deploy order (revert first, then DOWN) is what protects it afterwards.

### 7.5 Lint — the real run, and each rule shown to bite

The real `scripts/lint-migrations.mjs`, run at the clean pinned tree with the **S1 rule (`c0b2078`) live**:

```
$ node scripts/lint-migrations.mjs
migration-lint: clean. 107 known violation(s), all exempted.        [exit 0]
```

107 is the number of entries already in `migration-lint-exceptions.json`: **048 adds no violation and needs no exception.**
Each rule below was then shown to bite by running the **same real lint** against a scratch copy of its inputs
(`docs/reviews/048-scaffold/lintvar.py <variant>`; nothing in the repo is touched; every edit asserts its anchor occurs once):

| Variant (scratch copy of the lint's inputs) | Expected | exit | What the real lint reported |
|---|---|---|---|
| `baseline` | clean | 0 | `migration-lint: clean. 107 known violation(s), all exempted.` |
| `no_reservation` | FAIL (Rule 8) | 1 | `docs/reviews/048_engineer_registration.sql: reservation-mismatch-048  [held-migration-reservation-required]` |
| `no_coverage` | FAIL (Rule 9) | 1 | `docs/reviews/048_engineer_registration.sql: users.registered_by -> users  [shared-fixture-fk-coverage]` |
| `no_postgres_grant` | FAIL (Rule 1) | 1 | `docs/reviews/048_engineer_registration.sql: engineer_admin_gate  [no-orphan-security-definer]` |
| `fwd_in_second_stmt` | FAIL (Rule 11) | 1 | `docs/reviews/048_engineer_registration.sql: L278  [no-auth-uid-as-users-id]` |
| `rev_in_second_stmt` | FAIL (Rule 11) | 1 | `docs/reviews/048_engineer_registration.sql: L278  [no-auth-uid-as-users-id]` |
| `col_in_second_stmt` | FAIL (Rule 11) | 1 | `docs/reviews/048_engineer_registration.sql: L278  [no-auth-uid-as-users-id]` |
| `auth_id_in_second_stmt` | clean (control) | 0 | `migration-lint: clean. 107 known violation(s), all exempted.` |
| `block_comment_prose` | clean | 0 | `migration-lint: clean. 107 known violation(s), all exempted.` |
| `block_comment_in_users_stmt` | FAIL (F5) | 1 | `docs/reviews/048_engineer_registration.sql: L143  [no-auth-uid-as-users-id]` |
| `string_literal_in_users_stmt` | FAIL (F5) | 1 | `docs/reviews/048_engineer_registration.sql: L146  [no-auth-uid-as-users-id]` |

**F3, answered.** The three Rule 11 shapes — forward, reversed and `<x>_id` — are each caught **after the first `;` inside
the `$$` body** of `add_engineers_to_project`, and each is keyed **`L278`**, not the function's name: UNKNOWNS #4, observed. The correct
column (`auth_id`) in the same position stays clean, so the rule is not simply refusing `auth.uid()`. The 048 file contains no such hit, so **no exception is
needed** — and an exception would be line-number-fragile. **F5, shown:** block-comment and string-literal prose trips
the rule only when the statement also mentions the `users` table (`L143`, `L146`); the same prose in a statement that does not is clean.

### 7.6 Source guards

- **T20** — `grep -c "coalesce(p_consent_attested" docs/reviews/048_engineer_registration.sql` → **`0`**.
- **T10(b)** — the insert lists every explicit column: `INSERT INTO public.users (tenant_id, role, status, full_name, whatsapp_number, messaging_blocked, auth_id, registered_by, registered_at, consent_attested)` (`048_engineer_registration.sql:342-345`).
- **`+91` scan** — no `+91<digit>` literal in the 048 file, the scaffold, the runbook or the coverage JSON. The boundary literal is stated once in this package (section 6, "Boundary test").
- **Lint rule's own unit test** — `npx vitest run test/unit/lint-no-auth-uid-as-users-id.test.ts`: **1 file, 30 tests, 30 passed** (static; no database).
- **No TypeScript changed** in this pass, so `tsc --noEmit` and ESLint are unaffected and were not re-run.


## 8. The expected red — characterised (F2)

**The entry that Rule 9 forces into this commit breaks fixture teardown on any test-db that does not yet carry 048.**
`test/helpers/db.ts:348-397` reads `scripts/shared-fixture-fk-coverage.json` at teardown. The new entry is self-referential
(`table == parent`), so `sweepSharedFixtureReferences('users', id)` — reached only from `removeMorningFixtures`
(`db.ts:557`) — first runs `db.from('users').select('id').eq('registered_by', id)`. test-db has no `registered_by` column
until 048 is applied there (observed from the fresh dump, section 7.1), so the select errors and the sweep throws:

```
sweepSharedFixtureReferences: users select (child-first cascade before delete) failed: column users.registered_by does not exist
```

Rule 9 has no exceptions mechanism and scans held files, so the entry cannot land later. **Consequence, stated as three facts for the PR:**

1. **(a) This PR cannot go green until 048 is applied to test-db.**
2. **(b) That apply requires a GO no review round has given.** None exists.
3. **(c) After the apply, the re-run must be FULLY green — anything still failing is new, not known.**

Option (B) — make the sweep tolerate a missing column — was **not** taken: it edits `test/helpers/db.ts`, weakens a safety net, and is beyond the plan.

### 8.1 What was run

The 22 test-db-backed files that call `removeMorningFixtures` (the complete set that reaches the users sweep: the new entry is the only
registry entry with `table == users`; `migration-023.test.ts`'s mention of the coverage file is a comment), on **test-db `exfccwlrhoutkgrlikod`**
via the harness's own `.env.test`, whose `globalSetup` guard aborts unless the ref is test-db. `vitest 3.2.7`, **JSON reporter** (so no printed line can be missing —
`CLAUDE.md` §7). The credentials file was copied from the primary checkout (it is gitignored and absent from worktrees), never printed, and deleted afterwards.

| Run | Registry | Result |
|---|---|---|
| **Baseline** (before) | `origin/main`'s registry, 34 entries — *without* the 048 entry | **22 files, 234 tests, 234 passed, 0 failed** |
| **With the 048 entry** (clean tree `fde3ffb`, empty porcelain) | 35 entries | **234 tests: 196 passed, 38 failed; 21 of 22 files failed.** The only passing file: `test/outbound-trigger.test.ts` (10 tests). |
| Baseline **again**, after the red run | 34 entries | **22 files, 234 tests: 213 passed, 21 failed — all 21 in `owner-deliver-job`** (stranded fixture rows, section 8.5). The other **21 files: fully green.** |

### 8.2 The exact failing files and error text

There are **two mechanisms**, and only the first is the one this section predicted. Both were traced; neither is unexplained.

**M1 — the expected one, deterministic: 21 files, one error, in the teardown hook.** In every one of the 21 files the *file-level* failure is exactly
the error above, thrown from `removeMorningFixtures`'s users sweep in an `afterAll`. (`reactivation-db.test.ts` printed an empty `message` in the JSON reporter; its error text was read
with the default reporter and is the same string.)

**M2 — secondary, non-deterministic: 38 failed *tests* in 7 of those files.** These are *not* independent defects. They vanish when each file runs alone (below), and they are caused by a failed teardown in
one file leaving shared fixture state behind for the file that runs next. Error texts in the full run, with counts:

| Count | First line of the error |
|---|---|
| 21 | `Error: makeProject failed: insert or update on table "projects" violates foreign key constraint "projects_owner_user_id_fkey"` (all in `owner-deliver-job`) |
| 4 | `AssertionError: expected 'idle' to be 'reask'` |
| 3 | `AssertionError: expected 'idle' to be 'advance'` |
| 2 | `AssertionError: expected 'I didn't understand that. Nothing wa…' to be '✅ Hindrance recorded. Your Project Ma…'` |
| 1 each | `expected 'idle' to be 'already_complete'`; `expected +0 to be 5`; `expected +0 to be 4`; `expected +0 to be 2`; `expected undefined to be null`; `expected undefined to be 'hindrance'`; `expected undefined to be 3`; `expected null not to be null`; `expected '' to be 'How many *workers* today? …'`; `expected '' to be 'How many *workers* were on site today…'`; `expected 'Photo not saved. Please send it throu…' to be '1 photo saved. Send more, or reply do…'`; `expected undefined to match object { q1_reask: +0 }`; `TypeError: Cannot read properties of null (reading 'morning_equipment')` |

**Proof that M2 is a consequence of M1, not a second bug:**

- Run **alone, each in its own vitest process**, all **seven** files that had test-level failures show **every test passing** and only the one M1 teardown error:
  `owner-deliver-job` 21/21, `evening-flow` 19/19, `hindrance-photos-flow` 10/10, `inbound-start` 37/37, `media-ingest` 6/6, `morning-flow` 19/19,
  `section-42-write-boundary-distinctness` 1/1 — and `reactivation-db` 3/3 (it fails at file level only).
- Run **sequentially in one process** (`--no-file-parallelism`), the six of those files other than `owner-deliver-job`, plus `reactivation-db`, still showed **6 failed tests** — so parallelism is not the whole story; the contamination rides on the state a failed teardown leaves on the shared database.

The 38 is one run's number. **Which tests fail under M2 depends on interleaving and will differ between runs**; M1 will not.

**Per file** (the full parallel run vs. the same file alone):

| # | File | Tests | Failed **tests** in the full parallel run | Alone, in its own process |
|---|---|---|---|---|
| 1 | `test/dispatch.test.ts` | 8 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 2 | `test/dpr-generate-job.test.ts` | 7 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 3 | `test/dpr-generate-trigger.test.ts` | 6 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 4 | `test/dpr-stage1-plumbing.test.ts` | 9 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 5 | `test/evening-flow.test.ts` | 19 | 6 | 19/19 tests pass; only the teardown error |
| 6 | `test/hindrance-media-ingest.test.ts` | 4 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 7 | `test/hindrance-photos-flow.test.ts` | 10 | 1 | 10/10 tests pass; only the teardown error |
| 8 | `test/hindrances-report-date.test.ts` | 2 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 9 | `test/inbound-start.test.ts` | 37 | 4 | 37/37 tests pass; only the teardown error |
| 10 | `test/media-ingest.test.ts` | 6 | 1 | 6/6 tests pass; only the teardown error |
| 11 | `test/migration-016.test.ts` | 8 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 12 | `test/migration-017.test.ts` | 12 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 13 | `test/morning-flow.test.ts` | 19 | 4 | 19/19 tests pass; only the teardown error |
| 14 | `test/owner-confirm-email.test.ts` | 7 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 15 | `test/owner-deliver-job.test.ts` | 21 | 21 | 21/21 tests pass; only the teardown error |
| 16 | `test/owner-send-trigger.test.ts` | 4 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 17 | `test/reactivation-db.test.ts` | 3 | 0 | 3/3 tests pass; only the teardown error |
| 18 | `test/section-42-row-readback.test.ts` | 5 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 19 | `test/section-42-write-boundary-distinctness.test.ts` | 1 | 1 | 1/1 tests pass; only the teardown error |
| 20 | `test/unit/morning-flow-mirror.test.ts` | 20 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |
| 21 | `test/webhook.test.ts` | 16 | 0 | tests pass; only the teardown error (not re-run alone; its tests all passed in the full run) |

### 8.3 How to read a red CI run on this PR — known versus new

A failure is **known** only if it is one of:

1. the exact M1 error, at **file level**, in one of the 21 files above; or
2. a **test-level** failure in one of those files that **disappears when that file is run alone** (M2).

Anything else — a failing file not in the list, a test-level failure that **persists when its file runs alone**, an error text that is neither M1 nor an M2 consequence, or **any** failure at all after 048 is applied to test-db —
is **new**, not known. The PR body carries the same rule.

### 8.4 What this red run shows about #69, and what it does not

UNKNOWNS #69 (the JS sweep has never run on a self-referential edge) is **not** observed here: the sweep dies at its own `SELECT` before it can recurse. It is observed on the first CI run **after** the
test-db apply, where the pass condition is that every teardown completes and leaves zero rows. The reverse is also worth stating: this red run is evidence about *test-db's current schema*, not about the sweep's logic.

### 8.5 State my red runs LEFT on test-db — a side effect of this work, found by the re-check, ~~NOT yet cleaned~~ CLEANED (dated correction below)

> **DATED CORRECTION (2026-09-19, after Aravind's approval; LIGHT tier — test-db only, rows nothing references, no real data). The cleanup below was RUN.** Full record: `~/Desktop/048-cleanup.txt` (outside the repo). Target ref printed from `supabase/.temp/project-ref` and confirmed to read exactly `exfccwlrhoutkgrlikod` before **every** statement (a guard stops the run for any other ref; `jvxwqignooseazzmwhvl` was never touched).
> 1. **Pre-probe:** both rows printed in full (ids, tenant `e2003340-15a9-4e0b-9c5a-289a72e3d3db`, roles `owner` / `engineer`, both `active`). **Reference check from test-db's LIVE catalog** (not the scaffold copy): 20 foreign keys reference `users`; one `SELECT count(*)` per referencing column, all printed — **0 rows in every one of the 20.**
> 2. **DELETE:** the statement exactly as written below, extracted programmatically from this package (blob `9cc95513…`); exit 0, and the block raises unless exactly 2 rows are deleted, so **`n = 2`**.
> 3. **Post-readback:** the same pre-probe query returns **0 rows**.
> 4. **The cause is proven, not inferred: `owner-deliver-job` alone, on the baseline registry, is 21/21 passed (`success=True`).** The diagnosis in this section was right. (It ran on the baseline registry deliberately: with the 048 entry its teardown would fail and strand a new tenant and owner.) Registry restored to 35 entries and the credentials copy deleted by a trap; tree clean.
> 5. **The 13 stranded tenants were not touched** (13 still present). After the run no by-name fixture users remain. One more `zz-test-session-transition-*` tenant (`5fe52fc7-…`, created 17:25:56 UTC, 1 user, 1 project) appeared in the window; it predates the step-4 run (started 17:29:35), and two other tenants seen in the same query were gone minutes later — so **other runs are using test-db** and that one is not attributable to this cleanup. Left alone.
> The text below is kept as written (the proposal), not rewritten.

The red runs made teardown fail, so run-scoped fixtures were **stranded**. I expected fixtures to be idempotent and re-checked rather than assumed: the baseline re-run (8.1) is **not** fully green.

**Observed (read-only probes on test-db `exfccwlrhoutkgrlikod`, ref printed and confirmed before each):**

- **The post-red baseline: 213 of 234 tests pass; the 21 that fail are all of `owner-deliver-job`,** with `makeProject failed: … violates foreign key constraint "projects_owner_user_id_fkey"`. The other **21 files are green** on the baseline registry.
- **Cause, consistent with everything observed:** `owner-deliver-job` finds its owner and a second engineer **by `full_name` in any tenant**, and by design they persist across runs (`test/owner-deliver-job.test.ts:366-371`). Exactly one row of each exists, both created at 16:49 UTC under a **stranded run-scoped tenant** (`e2003340-15a9-4e0b-9c5a-289a72e3d3db`) whose teardown threw before the tenant was removed. Every later run has its **own** tenant id (`TEST_TENANT_ID` is per-run, `db.ts:178`), so its `makeProject` pairs a new-run tenant with an old-run owner and the composite `(owner_user_id, tenant_id)` FK refuses it.
- **Consequence beyond this PR: until those two rows are gone, `owner-deliver-job` fails on test-db for *any* run — including `main`'s CI and other PRs' — not only this one.**
- **Nothing references either user:** all 20 columns with an FK to `users` (taken from the scaffold's catalog, i.e. test-db's real one) were counted for both ids: **0 rows**. So deleting them cannot cascade or be blocked.
- **13 tenants were created since this session's first test run** and are still there: 11 `zz-test-session-transition-<run id>` (one per non-clean run of mine — 1 full run, 8 alone, 1 sequential, 1 default-reporter — matching exactly) and 2 `zz-007-tenant-{a,b}-<run id>`; each holds 1 leftover user (`e2003340…` holds 3), 0 `daily_logs`, 0 `dprs`. This is the orphan-on-failure shape `docs/reviews/test-db-per-run-fixture-identifiers.md` already documents. They are clutter and did not break the baseline; they are listed for the record.

**Proposed cleanup — NOT RUN.** It is a write to a shared database, outside what this pass was authorised to do, so it awaits Aravind. Precedent: that same document's orphaned tenant was "cleaned up directly, pinned to its exact id and slug" after checking references. Extensional, one transaction, aborts unless exactly two rows go:

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  DELETE FROM public.users
   WHERE id IN ('0d690a4d-5397-4884-8774-ac7d975e230c', 'ce71c4fe-baf9-4778-933d-5b6fe797d9a9')
     AND tenant_id = 'e2003340-15a9-4e0b-9c5a-289a72e3d3db'
     AND full_name IN ('ZZ Test Owner (owner-deliver suite)', 'ZZ Test Engineer 2 (owner-deliver suite)');
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 2 THEN RAISE EXCEPTION 'orphan cleanup: expected exactly 2 rows, deleted %', n; END IF;
END $$;
COMMIT;
```

Target ref must be named and `supabase/.temp/project-ref` compared first; foreground, one file, Aravind's go-ahead in the same exchange. **After it, re-run `owner-deliver-job` on the baseline registry and expect 21/21** — that confirms the cause instead of leaving it inferred. The 13 stranded tenants (11 + 2) can be removed the same way, by exact id, if Aravind wants the clutter gone; that is a separate, larger decision and is not proposed here.

**A note on the first red run's 21 `owner-deliver-job` failures:** they had the same error text, but the stranded rows above were created later (16:49), so the *mechanism* for that first occurrence is **not fully traced** — only that those tests pass alone and that the failures were contamination. Nothing in the rule in 8.3 depends on it.


## 9. Additions beyond the plan text — named, so none is discovered later

1. **`p_dry_run IS NULL` raises `22023`.** The plan lists the NULL-consent raise (S4) but not the dry-run flag. A NULL there
   would read as "not a dry run" and **write**. Same class as S4; covered by a T20 check, and by the `coalesce_consent`
   variant going red on it.
2. **`idx` is the zero-based position** in `p_engineers`. The plan does not fix the base; the TypeScript consumer must use it.
3. **The helper's name (`engineer_admin_gate`) and the `project_members` CHECK's name (`project_members_role_check`) are
   ASSUMED** — the plan fixes neither. `users_registered_pairing_chk` is the name the plan's observed `23514` carries;
   `users_registered_by_fkey` follows 027's pattern.
4. **`GRANT EXECUTE … TO postgres` on the helper** satisfies lint Rule 1 (every SECURITY DEFINER function needs a `REVOKE` *and*
   a `GRANT`) and changes the effective ACL **not at all** — `postgres` owns the function. The scaffold pins the helper's
   ACL as exactly `{postgres=X/postgres}` (T16), so the grant cannot be read as the helper being callable. A comment in the SQL says so.
5. **Helper vs public function grants follow the PLAN (§2.7), not the build instruction's shorthand.** The helper is
   revoked from `authenticated` as well; only `add_engineers_to_project` is granted to `authenticated`. Aravind confirmed
   the plan is correct.
6. **Ordering when several rows collide:** a number held by an engineer on **this** project reads
   `already_on_this_project` even if they also hold another membership; `on_another_project` reports one project name,
   chosen `ORDER BY name, id`.
7. **No in-file assertions.** Unlike 047, the file has no closing `DO` block; verification is the fingerprint queries and
   the scaffold checks, not an in-transaction abort. (An addition beyond the plan; not made.)

## 10. Findings that change the plan's picture — flagged, not fixed here

- **F1 — a fifth file is forced.** Lint Rule 8 (`held-migration-reservation-required`) fails a held `048_*.sql` unless
  `migration-number-reservations.json` names it; 048's entry named a released helper. Edited with a dated correction.
  **Shown, not asserted:** with the entry reverted the real lint fails `reservation-mismatch-048`.
- **F2 — the coverage entry breaks fixture teardown on test-db until 048 is applied there.** Section 8.
- **F3 — UNKNOWN #4 (lint build): does the 048 helper need an exception? No.** The helper resolves `auth_id = auth.uid()`,
  which the rule excludes by construction, so there is no hit to key. **Shown:** the real lint is clean over the file; and
  with the wrong-column compare planted **after the first `;` inside the `$$` body** — forward, reversed and `<x>_id`
  shapes — the rule fails each one, keyed **`L<line>`**, exactly as UNKNOWN #4 predicted. Any hit inside either 048 function
  keys by line, because the `;` after each `DECLARE` variable cuts the fragment before the `SELECT`. So an exception for
  this file would be line-number-fragile, and is not needed. **A hit in a new or held file is a defect to fix, not to except.**
- **F4 — UNKNOWN #69 (the JS sweep has never run on a self-referential edge; this is the first of 34):** it is first
  **observed** at the first teardown that calls `sweepSharedFixtureReferences('users', …)` **on a test-db that carries
  048** — i.e. the first CI run **after** the test-db apply. Before that it fails at its own `SELECT` (section 8), so it
  cannot be observed earlier. Cycle looping (the sweep keeps no visited set) stays **inferred**. Pass/fail when it is
  observed: every teardown completes and leaves zero rows.
- **F5 — the rule strips only `--` comments.** Prose about the bug class in a **block comment** or **string literal**
  trips it **when the statement also mentions the `users` table**. **Shown** (both). The 048 file keeps such prose in `--` comments.
- **F6 — the plan's lint-hosting assumption is stale.** Plan §4.10 / UNKNOWN #28 still say the lint would *guard `main()`
  and export the rule* from `lint-migrations.mjs`. **Extraction shipped:** the rule is its own module,
  `scripts/lint-rules/no-auth-uid-as-users-id.mjs`, and `main()` is still unguarded (`scripts/lint-migrations.mjs:782`).
  That correction belongs to a plan pass, not this branch.
- **F7 — Rule 1 needs a `GRANT` on the helper** (item 4 above). **Shown:** without it the real lint fails
  `engineer_admin_gate [no-orphan-security-definer]`.
- **F8 — one plan citation does not hold.** Plan §4.8 / §4.10 cite `docs/migration-runbook-template.md:34` for "not
  `CONCURRENTLY`"; that line does not say so, and no `CONCURRENTLY` guidance appears in `docs/*.md` or `CLAUDE.md`. The D12
  rider entry records it as **unverified** for that slice's author to re-derive.
- **F9 — a stale claim this PR does not correct.** `docs/build-status.md` (2026-09-16 entry, "Backlog: function EXECUTE
  default for new public-schema functions") says that future migration should **reuse released 048**. 048 is now held for
  this migration, so that entry will need the next free number. **Not edited here** (the authorisation for
  `docs/build-status.md` covers the D12 and N1 entries only) — **owed as a follow-up.**
- **F11 — the definer count: the plan's "15" is wrong; it is 14. It does not change the grant argument (dated addition, 2026-09-19).** The plan (§2.5 "all 15 definer functions", §2.7 "all **15** existing definer functions have `config = {search_path=public}`") argues the new functions' posture from that count. Its **own recorded probe `n` has 14 rows**, and the **live test-db set today is those same 14, name for name** (`acquire_and_transition_session`, `apply_{evening,hindrance,morning}_flow_turn`, `claim_media_nudge`, `complete_onboarding`, `correct_daily_log`, `drain_next_pending_flow`, `get_user_tenant_id`, `handle_new_user`, `quoco_test_047_unused_rights_check`, `quoco_test_row_is_locked`, `sweep_stale_morning_sessions`, `write_dpr_version`). **All 14: owner `postgres`, `proconfig = {search_path=public}`, and nothing else** — so the argument as *worded* ("all existing definer functions carry exactly that") is true; only the number was wrong. What the reviewer should also see, from the live ACLs: **every function callable by `authenticated` (`complete_onboarding`, `correct_daily_log`, `get_user_tenant_id`, `write_dpr_version`) also holds `service_role` EXECUTE — none revokes it.** 048's public function does (`service_role` revoked by name, per `CLAUDE.md` §6), so it is the **first** authenticated-callable definer function without `service_role`; that is the rule's intent, not a drift from house style, but it *is* a departure from every precedent. The other ten (all `service_role`-only or platform-shaped, `handle_new_user` also `supabase_auth_admin`) are unaffected. **Two caveats:** (1) the evidence is **test-db only** — prod's set is unprobed and likely differs (`quoco_test_*` are test-db objects; the 046 apply already noted `quoco_test_row_is_locked` is absent from prod's types); (2) the live catalog also holds three platform-owned definers (`pgbouncer.get_auth`, `vault.create_secret`, `vault.update_secret`; owner `supabase_admin`, `search_path=""`) outside `public` — not ours, not in the count. **Not found: where "15" came from.**
- **F10 — the plan is not on `main`.** `caab70b` lives on `feat/add-engineer-plan`. The plan's own status is "closed pending the build".

## 11. What this package does NOT cover — the review surface is bounded

- **No application code:** none of `app/`, `lib/engineers/*`, the add screen, the list page (§5.1), the confirm-form mechanics (§5.2, UNKNOWN #62), the phone validator's TypeScript. T12, T21, T44, T46 and the TS halves of T6/T9 are **specified, not built**.
- **No test file was written or modified**, including the boundary test, T49, T14, T13. Every DB-backed test needs 048 on test-db.
- **No user-facing wording anywhere.** Every string constant stays named and blank, `// Wording owed, NOT approved` (plan §9). Three strings are new and need Aravind's wording: `ERROR_CONFIRMED_LIST_CHANGED`, `ENGINEER_STATUS_DEACTIVATED`, `ENGINEER_STATUS_PENDING` (plan UNKNOWN #68). **No slice-1 string may imply a removal, edit or undo path — none exists.**
- **No apply, anywhere; no DOWN rehearsal on test-db.** The DOWN block is **written and inert**, and executed only on the scaffold's disposable database (section 7). The full-tier DOWN rehearsal on the cleaned test-db, with captured output, is **owed**.
- **The runbook is not rehearsed** (gate on the merge).
- **The test-db orphan cleanup (section 8.5) is proposed, not run** — a write outside this pass's authorisation. Until it is, test-db is not clean for `owner-deliver-job`.
- **Concurrency (T15) is CI-only.** Nothing here claims it.
- **Prod state:** prod's phone shapes, roles, the six-role CHECK's fit on prod data (plan §11 query `n2`), orphans and the ledger were **not probed** (UNKNOWNS #1, #3). Test-db held 0 violations of the CHECK in the plan's probe; that is weak evidence alone.
- **Deferred, named, unchanged from the plan:** deactivate/reactivate/the episodes table (slice 2); the one-project-per-engineer index and role-scoping of the two count sites (backlog, now filed); the `<>` tenant comparison at `019:230`; rate limiting across calls; file upload; duplicate-name detection.
- **`anon` holds table-level `SELECT` on `users`** (N1) — **a known gap this PR widens by three columns and does not close.** Filed as a backlog entry.
- **`types/database.ts` is not regenerated** — that is a post-apply step, once the columns exist on a database.
- **The scaffold is not test-db.** It is a schema-only dump of test-db's `public` schema plus three **named stubs** (roles; an `auth` schema with `auth.users(id)` and a JWT-claims-reading `auth.uid()`; the `vector` column type stubbed as `text` because pgvector is not installed locally). Anything platform-specific beyond them is not covered. The local server is PostgreSQL 17.11; test-db and prod are 17.6 (same major).
- **PostgREST behaviour** — that `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege`, and the real anon-key refusal — is assumed here and observed at apply.

## 12. Apply-record checklist (blank — filled at apply, never in advance)

- [ ] external review of this package (round, verdict, folded items carried forward item-by-item)
- [ ] test-db apply: ref named, `project-ref` printed and equal; pre- and post-apply hash of the affected objects
- [ ] fingerprint F1–F6 captured on test-db (section 5)
- [ ] **DOWN rehearsed on test-db with captured output**, and a live in-flight session confirmed still processable after DOWN (plan §7 / `CLAUDE.md` §7)
- [ ] test-db carries 048 **for real** (`CLAUDE.md` §0(e)); ledger repaired
- [ ] **test-db orphan cleanup (section 8.5) approved and run; `owner-deliver-job` re-run on the baseline registry = 21/21** — a prerequisite for "fully green" below
- [ ] CI green on the PR head — **pinned run URL, `headSha` = PR HEAD**, **fully green** (section 8); every failure after apply is **new**
- [ ] **typo-repair runbook rehearsed on test-db at `<path>`** — before the merge
- [ ] PITR observed live (not assumed); prod ref named; fingerprint F1–F6 on prod
- [ ] prod pre-apply check: `n2` (six-role CHECK fit) and `u` (columns absent) from plan §11
- [ ] anon-key REST call refused `42501`; `service_role` refused
- [ ] **D12 rider filed at `docs/build-status.md:399`** and N1 at `:448` (filed in this PR)
- [ ] the add screen is now the app logic behind `docs/schema.md:129-130` — and only that; RLS still permits a direct membership insert
- [ ] migration file moved into `supabase/migrations/` **in the applying commit**, `types/database.ts` regenerated, file confirmed on `origin/main` (`git show origin/main:<path>`)
- [ ] `scripts/migration-number-reservations.json` updated **as part of the apply** (Step H)
- [ ] a mistyped number stays held: no slice-1 path frees it (runbook step 4)

## 13. UNKNOWNS

Not determinable from what this pass could read or run. Numbered `U-…` so they cannot be confused with the plan's own
UNKNOWNS (`#1`–`#69`), which remain as recorded there.

1. **U-1 — Prod.** Nothing about prod was probed: its ledger, role and phone-shape distributions, whether the six-role CHECK fits its `project_members` rows (plan §11 `n2`), whether the three columns exist (`u`), orphan engineers. Plan #1, #3, #10.
2. **U-2 — The scaffold is not test-db.** Named stubs (roles, `auth`, `vector`→`text`); local PostgreSQL 17.11 vs 17.6; the local `postgres` role is a **superuser** (Supabase's is not), so owner-level behaviour is equivalent for RLS bypass but not for every privilege; **no PostgREST**, so the real anon-key `42501` refusal and `supabase-js`'s mapping of `P0002`/`42501` are unobserved.
3. **U-3 — The apply role.** Whether `supabase db query --linked -f` yields owner `postgres` for both functions (plan #9). The fingerprint pins it at apply; this pass asserts nothing about it.
4. ~~**U-4 — Definer-function count.** The live `public` schema has 14 SECURITY DEFINER functions; the plan says 15. Not reconciled.~~ **RESOLVED (dated correction, 2026-09-19): no function is missing — the plan's "15" is a miscount.** The plan's own recorded probe `n` (rev7 log) has **14 rows** and the live set today is those same 14, name for name; every plan revision's inventory (rev2–rev6) is also 14. The "15" appears only in prose (plan §2.5, §2.7). Not derivable from the migrations either: 13 applied definers + 1 test-only function (`quoco_test_047_unused_rights_check`, not a migration) = 14. **Finding F11, section 10.** Still unknown: where the 15 came from.
5. **U-5 — Test-db ledger.** `042`, `043`, `044`, `046` have no remote row on test-db. Whether those migrations are physically applied there was not investigated; unrelated to 048.
6. **U-6 — Is the 22-file set the whole affected set?** By reading `db.ts` it is exactly the callers of `removeMorningFixtures`; the baseline/changed pair shows what those 22 do. A file reaching the users sweep by a path I did not find would be missed — **CI is the gate**, and section 8 states the rule for that.
7. **U-7 — Shared test-db.** The 22-file runs used a database other sessions and CI also use; a fixture collision would look like a failure. Failures were re-run (section 8) to separate deterministic from flaky.
8. **U-8 — #69, still unobserved.** The JS sweep on a self-referential edge; the first observation is the first CI run after the test-db apply. A `registered_by` **cycle** (manual SQL only) would loop the sweep — inferred from reading, never run.
9. **U-9 — Assumed names and a base.** The helper's name, the `project_members` CHECK's name, and `idx` being zero-based are my choices; the plan fixes none of them (section 9). Aravind's confirmation is owed before the TypeScript consumer is written.
10. **U-10 — `packed-refs.lock`.** Every commit on this branch printed `error: Unable to create '…/.git/packed-refs.lock': File exists … Another git process seems to be running` — the commits themselves landed (SHAs and `git log` confirm) but the cause (another session sharing the repository, or a stale lock) is unknown and was not investigated or removed.
11. **U-11 — A plan citation that did not hold** (`docs/migration-runbook-template.md:34`, section 10 F8): whether the "not `CONCURRENTLY`" constraint is real is unverified.
12. **U-12 — Stale claim left in place** (section 10 F9): the 2026-09-16 backlog entry that expects to reuse 048.
13. ~~**U-13 — test-db is currently not clean, and I caused it.** … The cause is consistent with all observations but not confirmed by a rerun.~~ **RESOLVED (dated correction, 2026-09-19):** the two rows were deleted with approval and `owner-deliver-job` is 21/21 alone on the baseline registry (section 8.5) — cause confirmed. **Still unknown:** whether *other* users of test-db (CI on other PRs, other sessions) ran in the window and were affected — there is evidence others *are* using it (section 8.5, item 5); and the 13 stranded tenants remain, by decision.
14. **U-14 — The plan-level items, unchanged and not mine to close here:** **D23** (the list page's gate is the plan's specification, not Aravind's decision), plan **#62** (confirm-form mechanics), **#68** (three new strings need Aravind's wording), **#46** (slice-2 timing), **#33/#34** (Vercel dashboard), **#7** (rate limiting), **#4** (`projects.status` gate).

