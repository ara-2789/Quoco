# Migration 051 — apply runbook (test-db first, prod later)

**Status: PREPARED, NOT RUN. No apply GO exists.** Nothing here may be run until Aravind gives an explicit go-ahead in the same exchange (CLAUDE.md §0, `PROD APPLIES` rule (c)). This file is the plan. It is not a record.

**Tier: FULL.** Design GO: external review round 3, unconditional (`docs/reviews/051-external-review-round-3.md`, sha256 `b4f707c5934e9b3e88b9dd4d7f218574fe8897e6655c019300bd9a33ff1e6168`).

**The files.** The held migration is `docs/reviews/051_capture_files_immutability.sql`, sha256 `debe97f051f4414c72f2bb1f6c45ca37ee59dd1bec43e5cefecca8a74ce22df9`. DOWN for test-db: `051-down-testdb.sql`, sha256 `672a422f895bc7b1425e21ae274ad9792c12ed4b1b2d12f334540b06a721da3a`. DOWN for prod: `051-down-prod.sql`, sha256 `288dc847cb66336a9b2574bfc227a0f54c4858854f3e606d71c584f744596046`. Check each hash in the same frame as the command that uses it. If a hash differs, STOP.

Precedent: `docs/reviews/050-test-db-apply-record.md` (the 050 test-db apply, 19 Oct 2026) and `docs/migration-runbook-template.md`.

---

## b. Rules that apply to every step (read first)

1. **Time windows.** Do not apply, and do not run the DOWN, between 08:25 and 08:40 IST or between 18:25 and 18:40 IST. Those are the cron trigger windows.
2. **No CI run on test-db during the apply or the DOWN rehearsal.** CI run 843 was void because it overlapped the 050 apply and DOWN (`050-test-db-apply-record.md`, "CI run 843 is VOID"). Start CI only after the last ledger row is written and the readbacks are done.
3. **One file, one run, foreground.** `supabase db query --linked -f <file>`. Never `supabase db push`. Never backgrounded. No SQL Editor needed.
4. **Print the target before every database command.** `cat supabase/.temp/project-ref` must print `exfccwlrhoutkgrlikod` for test-db (and `jvxwqignooseazzmwhvl` for prod, later block). If it prints anything else, or the file is missing, STOP.
5. **Claude Code never issues an apply command without Aravind's go-ahead in the same exchange.**
6. **Do not paste secrets.** Redirect long output to a file first (CLAUDE.md §0, output handling rule). The dump script's own output is safe to show (it prints counts, not the script).

---

## a. Test-db apply

### Step 0 — before anything
- `git fetch origin`. Check the PR head and that the five files above have the hashes above.
- `ls supabase/migrations/` and `scripts/migration-number-reservations.json` on `origin/main`: 051 must still be unused on `main`, and `supabase/migrations/` must end at 050.
- Tell Aravind the time in IST and confirm it is outside the two windows.

### Step 1 — pre-apply probes (read-only)
Run the probes in `docs/reviews/051-sql-evidence/P0-testdb-preapply.txt` again, in the same frame as the apply (they are `SELECT` and `SHOW` only). They were last run on **27 Oct 2026, 13:39 UTC** and gave:

| Probe | Result then | STOP if |
|---|---|---|
| ref | `exfccwlrhoutkgrlikod` | anything else |
| `capture_files` rows by status | none (0 rows in total) | any row with `stored` or `rejected` |
| terminal rows | 0 | > 0 |
| rows with any detail column set | 0 | > 0 |
| rows with `content_type` or `byte_size` set | 0 | > 0 |
| `SHOW default_transaction_isolation` | `read committed` | anything else |
| `pg_roles.rolconfig` for `authenticator`, `service_role`, `postgres`, `authenticated`, `anon` | only `statement_timeout`, `lock_timeout`, `search_path`, `session_preload_libraries`; **no isolation setting** | any entry that sets isolation |
| `pg_db_role_setting` | same; **no isolation setting** | any entry that sets isolation |
| ledger, latest three | `050`, `049`, `048` | max not `050` |
| function, five constraints, `ingested_at`, user triggers | all absent (0) | any present |
| pre-apply fingerprint of `capture_files` | `91a1865dd1fd0b98de6a9d9333008593` (equals the local scaffold's baseline) | differs from the last run without an explained cause |
| pre-apply comments hash | `80b77da945cc55890da3acee8182eca2` | differs without an explained cause |

Note on `SHOW default_transaction_isolation`: through the Management API it reports the session of the `postgres` login role. The roles PostgREST uses are covered by the `rolconfig` and `pg_db_role_setting` probes. Both are needed (external review round 3, R3-1).

The count of terminal rows is an **early warning, not the guard**. Today only the table owner can UPDATE `capture_files` (049 grants SELECT only), so a stored or rejected row cannot exist short of a hand edit. If one did exist, 051 would abort whole (scaffold proof: `G1b-postcondition-negative-rev3.txt`, case D).

If any STOP condition fires, stop and report. Do not apply.

### Step 2 — apply
In one frame, in this order:
1. `cat supabase/.temp/project-ref` → `exfccwlrhoutkgrlikod`.
2. `shasum -a 256 docs/reviews/051_capture_files_immutability.sql` → `debe97f0…2df9`.
3. `supabase --workdir <main checkout> db query --linked -f <absolute path of the held file>` — foreground, one run. Note the start and end time (UTC).
4. The file has its own post-condition block (`POSTCONDITION_051`). Exit 0 means it passed. Any error means the whole file rolled back (it is one transaction); report it, change nothing, do not retry blindly. A `lock_timeout` (3 s) failure means something held a lock on `capture_files`; wait and retry in a quiet moment, with a new go-ahead.

### Step 3 — post-apply readback (read-only)
Same shape as the pre-apply probes. Expected after the apply:
- the function exists: one row, `prosecdef` true, owner `postgres`, `proconfig {search_path=""}`, ACL `{postgres=X/postgres}` and nothing else;
- the trigger exists, enabled, `BEFORE INSERT OR UPDATE`, row-level;
- the five constraints exist and are validated; the column `ingested_at` exists;
- `service_role` can UPDATE exactly the seven columns and nothing else (column walk), no role can UPDATE `ingested_at`, `service_role` has no DELETE, no TRUNCATE;
- the fingerprint equals the scaffold's post-apply fingerprint `19102bc8020867d2650e13c6fddd13c0` (function body, ACL, trigger, constraints, columns all match the scaffold). If it differs, explain before going on;
- a real anon-key call (host `exfccwlrhoutkgrlikod.supabase.co`, the anon key's ref claim checked first, as in the 050 record): an UPDATE on `capture_files` returns HTTP 401 / `42501`, and an RPC call to `trg_capture_files_before_update` is refused. Keys are never printed.

### Step 4 — the ledger row (part of "apply done", review N4)
The apply is **not done** until the ledger row exists. The DOWN refuses without it.

Aravind runs this **in his own terminal** (the classifier denied the same command from Claude Code during 050), as 050 did (`050-test-db-apply-record.md`, step 4):
1. make a throwaway workdir, for example `/tmp/quoco/cli-wd`, containing `supabase/migrations/051_capture_files_immutability.sql` (a sha-identical copy; check `shasum -a 256`) and a copy of `supabase/.temp/project-ref`;
2. `cat <workdir>/supabase/.temp/project-ref` → must print `exfccwlrhoutkgrlikod`;
3. `supabase --workdir <workdir> migration repair --status applied 051 --linked`;
4. paste the output back; Claude Code then verifies (read-only): the `051` row is present in `supabase_migrations.schema_migrations`, `supabase migration list` shows the last `remote` as `051`;
5. delete the throwaway workdir.

### Step 5 — DOWN rehearsal (test-db)
The DOWN refuses over terminal rows, so the rehearsal has two parts.

**5a. Seed and watch it refuse.** Under a fresh `zz-test-capture-down-<run id>` tenant, via the real PostgREST path as `service_role`: a real engineer file turn through `apply_material_inward_turn` (a pending row and its queued `capture_ingest` job), then move one row to `stored` with full details in one UPDATE (the grant allows it). Then run `051-down-testdb.sql` (hash checked first): it must be **refused** with `DOWN_PRECONDITION_051 … terminal_rows=1` and change nothing. Read back that the fingerprint is unchanged.

**5b. Clean and run it.** Remove the stored row with the test cleanup helper (`quoco_test_capture_cleanup`, test-db only). Keep the pending row and the queued job. Run `051-down-testdb.sql`: exit 0. Read back: the function, trigger, five constraints and the column are gone; `service_role` has no UPDATE on `capture_files`; the ledger row is gone; the fingerprint equals the **pre-apply** fingerprint `91a1865dd1fd0b98de6a9d9333008593` and the comments hash equals `80b77da945cc55890da3acee8182eca2`; the pending row and the job are intact; a new file turn still works. Then run the DOWN a second time: it must be refused (`DOWN_PRECONDITION_051: ledger_051=f …`) and change nothing.

Run the DOWN only outside the two windows. C5 does not exist yet, so the "roll back C5 first" rule is trivially met; state that in the record.

### Step 6 — re-apply and ledger again
Re-apply the same file, same frame checks, foreground, one run: exit 0. Aravind runs the ledger command again (Step 4). Read back as in Step 3. Delete any rehearsal rows with the cleanup helper.

### Step 7 — CI, and only now
Start CI **after** the last ledger row is written and the readbacks are done. The apply GO needs a **pinned green CI run URL** (and its `headSha` equal to the PR head, CLAUDE.md §0) in which **QE011 and 23514 both appear as `error.code`**. Today those codes are inferred, not observed.

### Step 8 — the record
Write `docs/reviews/051-test-db-apply-record.md` in the 050 style: observed vs reported, every raw output, the throwaway workdir deleted, the CI run URL. Apply is not done until the file named in `scripts/migration-number-reservations.json` is on `main` and the test-db ledger carries 051 (CLAUDE.md §0, `PROD APPLIES` rules (d) and (e)).

---

## c. Prod (a later block, after test-db and CI are done)

Same probes, on prod (`jvxwqignooseazzmwhvl`, ref printed first). All the STOP conditions in Step 1 apply. Prod has had **no** access in this block; nothing about prod has been observed.

**"PITR substituted"** (PITR is OFF until launch). Before the apply, save a prod readback of `capture_files`: constraints (name, definition, validated), columns, column ACLs, table ACL, triggers, with its sha256, next to `051-down-prod.sql` (hash checked). Record the word "substituted". Then: apply (one file, foreground, ref and sha in the same frame, outside the two windows, Aravind's go-ahead in the same exchange), post-apply readback, ledger row by Aravind (Step 4), then the record `docs/reviews/051-prod-apply-record.md`. The `scripts/migration-number-reservations.json` entry is updated in the apply commit (CLAUDE.md §0, Step H), and the file moves into `supabase/migrations/` in that same commit. Types are regenerated after the apply (`ingested_at` is a new column).

---

## d. Restore warning (external review round 3)

> A data-only restore of `capture_files` (for example a prod-to-test-db data copy) fails under 051's INSERT lock. Run it with triggers disabled (owner or superuser, `session_replication_role = replica` or `--disable-triggers`), and the restore record must say so. A full logical restore works unchanged.

Why: the INSERT lock wants `ingested_at` NULL and the stamp CHECK wants it set, so no path that fires triggers can INSERT a terminal row. A full logical dump puts triggers after the data, so rows load before the trigger exists. A data-only restore into an existing schema fails the whole `COPY` for that table. With PITR off until launch, this is the restore path most likely to be needed.

## e. Incident note (review round 3, R3-4)

> If C5 misbehaves, stop C5 and leave 051 in place. Do not reach for 051's DOWN first. Rolling back over live terminal rows needs its own reviewed artifact (carry-forward item 12).

The 051 DOWN refuses over any `stored` or `rejected` row by design (`terminal_rows=N`). The alternative depends on a decision that can only be made at that moment: what happens to the `ingested_at` values.

---

## What this runbook has NOT done

It has run no apply, no ledger command, no DOWN and no seed on any database. The only database access in the preparation block was the read-only probes in `P0-testdb-preapply.txt` (test-db, SELECT and SHOW). The Supabase CLI prints "Initialising login role…" on each query: that is the CLI's own login-role provisioning, not SQL from this work. [observed in the transcript; its effect on the database was not inspected]
