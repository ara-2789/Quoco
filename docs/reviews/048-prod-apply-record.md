# Migration 048 — PROD apply record (2026-09-21)

**Target: prod `jvxwqignooseazzmwhvl`.** One file, one run, foreground, never `db push`, no retry, no DOWN. Pattern: `docs/reviews/048-test-db-apply-record.md`; gate: `docs/reviews/048-review-package.md` section 12.
Markers as in the test-db record: **[O]** = observed by the applying session and printed in its capture; **[R]** = reported to it (Aravind's words, or a written record), not re-observed.
The full raw capture is `~/Desktop/048-prod-apply.txt` (outside the repo; not committed).

## 0. Inputs, verbatim

```
PITR_LATEST_RESTORE_IST=21 Sep 2026, 11:08:12
GO: given by Aravind, 21 Sep 2026, by pasting this block, for 048 on prod jvxwqignooseazzmwhvl only.
```

- **GO** — [R] Aravind's, in the same exchange as the apply (`CLAUDE.md` section 0: an apply never runs without an explicit go-ahead in that exchange).
- **PITR** — [R] **per Aravind, read from the Supabase dashboard**: latest restore point 21 Sep 2026, 11:08:12 IST. The applying session did not observe the dashboard. Timing, from the session's own clock [O]: the session started at 11:20:21 IST (05:50:21Z) and the apply began at 11:23:21 IST (05:53:21Z), so the reading is **before** the apply, by 15 minutes. Earlier the same day the CLI's `supabase backups list` (read-only pre-check pass) returned `pitr_enabled: true` and a physical backup range ending 2026-09-21T05:16:12Z [O]; that listing is **not** the PITR observation and is not offered as one.
- **Pinned source** — [O] `git fetch origin` then `origin/main` = `4516e5c3f82aca235aa6b14326d71e659e868fbf`. `git show origin/main:supabase/migrations/048_engineer_registration.sql` = 20138 bytes, **sha256 `1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873`**, git blob `b7fec7af1550d434b041c75a93907851a631d565` — both equal the pins in the test-db record; sha256 re-checked inside the apply frame, which refused on any mismatch.

## 1. Provenance and the apply — [O]

| Step | UTC | Detail |
|---|---|---|
| link to prod | 2026-09-21T05:50:45Z | `supabase link --project-ref jvxwqignooseazzmwhvl`; `supabase/.temp/project-ref` before = `exfccwlrhoutkgrlikod`, after = `jvxwqignooseazzmwhvl` |
| pre-apply snapshot | ~05:51-05:53Z | section 2 |
| **apply** | **2026-09-21T05:53:21Z -> 05:53:27Z** | `supabase db query --linked -f /tmp/048.sql`, foreground, stdin closed, **CLI exit 0**, `"rows": []`, no error |
| post-apply verification | ~05:54-05:55Z | sections 3-4 |
| ledger repair | 2026-09-21T05:56:13Z -> 05:56:26Z | `supabase migration repair --status applied 048 --linked`, **exit 0** |
| relink to test | after the ledger | `supabase link --project-ref exfccwlrhoutkgrlikod`, project-ref printed = `exfccwlrhoutkgrlikod` |

The apply frame (script refused unless both checks passed, in the same frame as the apply):

```
--- cat supabase/.temp/project-ref:
jvxwqignooseazzmwhvl
REF CONFIRMED: jvxwqignooseazzmwhvl (prod)
--- shasum -a 256 /tmp/048.sql:
1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873  /tmp/048.sql
SHA CONFIRMED: 1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873
--- date (UTC): 2026-09-21T05:53:21Z
--- supabase db query --linked -f /tmp/048.sql   (foreground):
{ "rows": [] }        <- the CLI's `boundary` and `warning` wrapper fields are omitted here; the capture has them
[exit 0]
--- date (UTC): 2026-09-21T05:53:27Z
```

The file is one `BEGIN ... COMMIT`, so a failure would have applied nothing; there was none. No DOWN was run, no retry was made, `db push` was not used.

## 2. Pre-apply state — [O]

- **Ledger** (`supabase migration list --linked`): remote = `001`-`007`, `011`-`025`, `027`-`047` (43 rows); `048` local only. `008`-`010` and `026` are absent from both the repo and the ledger.
- **F1-F6** (`docs/reviews/048-scaffold/fingerprint.sql`, one SELECT per file, each printed above its run): **zero rows each** — 048 absent.
- **Precondition `n2`** (plan section 11, six-role CHECK fit), re-run just before the apply: **0 rows**.
- **Query S** (test-db record section 3), pre: server `17.6`; row counts `users` 6, `tenants` 2, `projects` 3, `project_members` 4; users columns / users constraints / project_members constraints / public functions / ledger = **17 / 8 / 5 / 129 / 43**; `users_id_tenant_id_key` present as `UNIQUE (id, tenant_id)` (the composite FK's prerequisite). sha256 of the extracted snapshot JSON `719a3cdc9200f6facaf9a8e7b1d959441b5f56f3d0ba97cb29a503e7bf388879`.
- The test-db record's two "precondition probes" (project_members roles; `users_id_tenant_id_key`) have results but no query text in that record; `n2` and Query S's `users_constraints` are what this apply used for the same two facts.
- The earlier read-only pre-check pass (`~/Desktop/048-prod-precheck.txt`, 2026-09-21): `n2` 0 rows; 048's functions, columns and constraints absent; `quoco_test_047_unused_rights_check` absent; prod holds 6 users and 4 memberships.

## 3. Post-apply fingerprint, prod against the test-db record — [O]

Every query's text is above its result in the capture. md5 values must equal the recorded ones; F4 must read as below.

| item | test-db (record section 2) | prod | match? |
|---|---|---|---|
| F1 `add_engineers_to_project` | `uuid, jsonb, boolean, boolean` / `add_engineers_to_project(uuid,jsonb,boolean,boolean)` | identical | yes |
| F1 `engineer_admin_gate` | `uuid` / `engineer_admin_gate(uuid)` | identical | yes |
| F2 `pg_proc` count, each | 1, 1 | 1, 1 | yes |
| F3 `add_engineers_to_project` `md5_prosrc` | `85ec32ab5959613e6ac9932740e3ad1a` | `85ec32ab5959613e6ac9932740e3ad1a` | yes |
| F3 `add_engineers_to_project` `md5_functiondef` | `97dacf3ce23f8f3ac906209a1e2de35b` | `97dacf3ce23f8f3ac906209a1e2de35b` | yes |
| F3 `engineer_admin_gate` `md5_prosrc` | `968a53c5260d7fda4d7fcc53552d3671` | `968a53c5260d7fda4d7fcc53552d3671` | yes |
| F3 `engineer_admin_gate` `md5_functiondef` | `f7e9ff1f407e90b4741d7629e4802128` | `f7e9ff1f407e90b4741d7629e4802128` | yes |
| F3 lengths (prosrc / functiondef) | 6240 / 6488 and 1661 / 1874 | identical | yes |
| F3 owner, `SECURITY DEFINER`, `proconfig` (both) | `postgres`, true, `{search_path=public}` | identical | yes |
| F3 `proacl` | `{postgres=X/postgres,authenticated=X/postgres}` and `{postgres=X/postgres}` | identical | yes |
| **F4** `add_engineers_to_project` anon / authenticated / service_role / postgres / PUBLIC | false / true / false / true / false | false / true / false / true / false | **yes** |
| **F4** `engineer_admin_gate` anon / authenticated / service_role / postgres / PUBLIC | false / false / false / true / false | false / false / false / true / false | **yes** |
| F5 `users_registered_by_fkey` `confdeltype` / `confupdtype` / `confmatchtype` / `confkey` | `r` / `a` / `s` / `{1,3}` | `r` / `a` / `s` / `{1,3}` | yes |
| F5 `conkey` of the fkey / not-self CHECK / pairing CHECK | `{21,3}` / `{21,1}` / `{21,22,23}` | `{18,3}` / `{18,1}` / `{18,19,20}` | **no — benign, explained:** attnums differ because test-db has dropped-column gaps (the test-db record's own named difference); prod's 17 users columns are sequential, so the new columns are 18/19/20 |
| F5 constraint definitions (fkey, not-self, pairing, `project_members_role_check`) | as recorded | text-identical | yes |
| F6 columns | `boolean`, `timestamptz`, `uuid`; nullable; no default; comment NULL | identical | yes |
| Query S counts (users cols / users constraints / pm constraints / public functions / ledger) | 17/8/5/130/39 -> 20/11/6/132/39 (test-db carries one extra test-only function) | 17/8/5/129/43 -> **20/11/6/131/43** | pattern yes: +3 / +3 / +1 / +2 / 0 |
| Query S diff | 48 lines added, 0 removed | **48 lines added, 0 removed** | yes |
| row counts | unchanged | `users` 6, `tenants` 2, `projects` 3, `project_members` 4 — unchanged | yes |

Post-apply Query S sha256 (extracted snapshot JSON): `15d72eef32c654fcacf2a2fe6f68ddc29762a4de6a404b4f41acb234a9728e60`.
Re-run of the pre-check's exact-name checks: functions 2 rows, columns 3 rows, constraints 4 rows (all present); `quoco_test_047_unused_rights_check` **still absent** (0 rows).

**Note on plan section 11 query `u`** (`registered%` / `consent_attest%` / `deactivat%` columns): on prod it returns one row, **`tenants.registered_address`** — an unrelated existing column on a different table that the `ILIKE 'registered%'` pattern happens to match. The exact-name check (`users.registered_by`, `registered_at`, `consent_attested`) returned **0 rows** before the apply and **3 rows** after. It is not evidence that 048's columns pre-existed.

## 4. Refusal observations on prod, through PostgREST — [O]

`node` script, keys read from `.env.local` and **never printed** (last 4 characters only). Target proven before any call: URL host `jvxwqignooseazzmwhvl.supabase.co`, and both keys' JWT `ref` claims = `jvxwqignooseazzmwhvl` with `role` = `anon` / `service_role`. Dry-run arguments and a random project id, so even a wrongly granted call could not have written anything.

```
anon         /rpc/add_engineers_to_project HTTP 401  code=42501  message=permission denied for function add_engineers_to_project
anon         /rpc/engineer_admin_gate      HTTP 401  code=42501  message=permission denied for function engineer_admin_gate
service_role /rpc/add_engineers_to_project HTTP 403  code=42501  message=permission denied for function add_engineers_to_project
service_role /rpc/engineer_admin_gate      HTTP 403  code=42501  message=permission denied for function engineer_admin_gate
```

**4 of 4 refused `42501`**, every message the grant-level "permission denied for function" (not an error raised inside the function body). No authenticated call was made: the dry run as a real user is the manual add, done separately.

## 5. Ledger — [O]

```
Repaired migration history: [048] => applied
{"versions":["048"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
[exit 0]
```

`supabase migration list --linked` afterwards: 44 entries, **every one `local == remote`**; the 048 entry is `{"local":"048","remote":"048","time":"048"}`. Only `048` changed from the pre-apply list (43 remote rows -> 44). No other version was repaired. (`db query -f` does not write `schema_migrations`; only the repair did.)

## 6. State after — and what this record does NOT cover

- Prod now carries 048; `scripts/migration-number-reservations.json` records it (dated correction, this commit).
- **The app code that calls these functions is not merged.** Merge is the deploy (package section 4.2); PR A (`feat/add-engineer-slice1`) and the 048 typo-repair runbook are separate steps.
- **Not done here:** the authenticated dry run on prod; `types/database.ts` regeneration for prod (test-db's regenerated file already exists on `main`); any change to `docs/build-status.md`; the package section 12 checklist boxes.
- **Observed limits:** the PITR reading is Aravind's [R]; `supabase db query --linked` prints "Initialising login role..." on every run (the CLI's own temporary login role — its catalog writes were not inspected); the query files were single SELECTs each, screened by keyword and statement count and read before running.
- Rollback, if ever needed, is the package's rule: **revert the merged app commit first, then the DOWN** — and the DOWN destroys attribution data for every engineer added since this apply.

## Addendum — post-deploy manual add, 21 Sep 2026

- Code: PR #314 head aac5552, run locally with `next dev` against prod (`jvxwqignooseazzmwhvl`) before merge. CI run for aac5552: https://github.com/ara-2789/Quoco/actions/runs/35563359343 (Test (real test-db) SUCCESS).
- Observed (screenshot): the preview on prod rendered the singular confirm prompt and omitted the zero-rejected sentence (plan §9a(a), §9a(b)); apply stayed disabled until the attestation was ticked.
- Per Aravind: the first previewed line was edited and re-previewed before apply; the saved row is the second preview.
- Observed (prod SQL, counts): registered 1, attested 1, engineers 2.
- Observed (prod SQL, one row): consent_attested true, registered_at 2026-09-21 06:18:57Z, number last 4 digits 3902.
- Per Aravind: the number ending 3902 may receive check-ins.
- Observed (screenshot): after the #314 merge, app.quoco.co.in shows the "Add site engineers" link and the new engineer in the project's team list.
- Not yet observed: the first 18:30 IST check-in to that number.
