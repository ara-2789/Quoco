# 051 test-db apply record — COMPLETE (test-db only)

Date 27 Oct 2026. Target: **test-db, ref `exfccwlrhoutkgrlikod` ONLY**, printed before every database command. **Prod (`jvxwqignooseazzmwhvl`) was never touched and is not applied: no prod GO exists.** FULL tier. Branch `feat/c2-capture-files-lock`, PR #339 (draft), head at the time `38c0b21fdf6c5a75860099bfa8989413924edf8a`.

Marks: **[O]** observed by Claude Code in this block (raw output in the log). **[R]** reported by Aravind (he ran it in his own terminal and pasted the output).

Raw log of every command and its output: `docs/reviews/051-test-db-apply/raw-log.txt` (copied from `/tmp/quoco/c2-testdb-apply.txt`). The probe script is `docs/reviews/051-test-db-apply/postgrest-probes.cjs.txt` (no key in it; keys are read from the environment and never printed). 2026-10-27: renamed to `.cjs.txt` so the linter does not treat evidence as code (CI run 40527531487 Lint failure). Content unchanged, sha256 `c2f94897775e357929353722914b98d0ad518a7b7c5c244d079e2a04b047f0bd`. Readbacks: `docs/reviews/051-sql-evidence/P1-testdb-postapply.txt`, `P2-testdb-afterdown.txt`, `P3-testdb-afterreapply.txt`. Pre-apply probes (Part A, 27 Oct 13:39 UTC): `P0-testdb-preapply.txt`.

**APPLY GO:** Aravind, 2026-10-27, given by sending the Part B block. Scope of the GO: test-db only. [R]
**Design GO:** external review round 3, unconditional (`docs/reviews/051-external-review-round-3.md`, sha256 `b4f707c5934e9b3e88b9dd4d7f218574fe8897e6655c019300bd9a33ff1e6168`). [R]

## Final state (observed after the re-apply and the second ledger row)

- 051 rev 3 is applied to test-db. The in-file post-condition block passed twice (first apply, re-apply), each with exit 0. [O]
- Function `trg_capture_files_before_update`: one `pg_proc` row, `prosecdef` true, owner `postgres`, `proconfig {search_path=""}`, ACL `{postgres=X/postgres}`; `EXECUTE` false for `anon`, `authenticated`, `service_role`. [O]
- Trigger: `BEFORE INSERT OR UPDATE`, row-level, `tgtype` 23, enabled (`O`), not DELETE or TRUNCATE. [O]
- Five constraints present and validated: `capture_files_reject_reason_iff_chk`, `capture_files_stored_only_chk`, `capture_files_storage_path_row_chk`, `capture_files_ingested_at_iff_chk`, `capture_files_details_terminal_only_chk`. [O]
- Column `ingested_at`: `timestamptz`, nullable, no default (column 17). [O]
- Grants: `service_role` can UPDATE exactly `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state`; `anon` and `authenticated` none; `ingested_at` writable by no role; table privileges for `service_role` = `SELECT`. [O]
- `capture_files` has 0 rows (before, after each step, and at the end). [O]
- Ledger: `051 capture_files_immutability 15`, `050 material_inward_functions 31`, `049 capture_tables 59`. [O]

## Observed vs reported

| Step | Result | Mark |
|---|---|---|
| Gates (first try) | In-progress CI runs `40514683391` and `40511977522` were found, so the block **stopped before any write** and reported. Aravind confirmed both finished and restarted from the gates | [O] / [R] |
| Gates (restart), 14:45 UTC = 20:15 IST | outside 08:25–08:40 and 18:25–18:40 IST; head `38c0b21f…`; clean tree; CI in progress 0, queued 0; ref `exfccwlrhoutkgrlikod`; SQL sha256 `debe97f051f4414c72f2bb1f6c45ca37ee59dd1bec43e5cefecca8a74ce22df9`; DOWN sha256 `672a422f895bc7b1425e21ae274ad9792c12ed4b1b2d12f334540b06a721da3a` | [O] |
| P0 re-run | identical to Part A in every field: 0 rows, 0 terminal, 0 with details, isolation `read committed`, no isolation setting in any role or db-role setting, ledger max `050`, no 051 object, fingerprint `91a1865dd1fd0b98de6a9d9333008593`, comments hash `80b77da945cc55890da3acee8182eca2` | [O] |
| **1. Apply** | ref and sha256 printed in the same frame; `supabase --workdir <main checkout> db query --linked -f docs/reviews/051_capture_files_immutability.sql`, foreground, one run, **14:47:48 to 14:47:53 UTC (20:17 IST), exit 0** | [O] |
| 2. Post-apply catalog | as in "Final state". **Fingerprint `19102bc8020867d2650e13c6fddd13c0`** (before: `91a1865d…`), **equal to the local scaffold's post-apply value**. Comments hash `b97d2e3b734f6c002fd5c0a57a06e643`, equal to the scaffold's | [O] |
| 2. PostgREST probes (real keys, host and key claims checked = test-db; no key printed; every UPDATE filtered on a random uuid so no row could match) | `anon` UPDATE of `ingest_status`, `file_no`, `ingested_at`: **42501** each. `authenticated` UPDATE of `ingest_status` and `file_no`: **42501** each. `service_role` UPDATE of `file_no`: **42501**; of `ingested_at`: **42501**. Control: `service_role` UPDATE of `ingest_status` (granted): no error, 0 rows. `service_role` DELETE: **42501** | [O] |
| 2. RPC probes | `anon`, `service_role` and `authenticated` RPC to `trg_capture_files_before_update`: **`PGRST202`** (function not in the schema cache). My script expected 42501 and printed FAIL for these three lines. PGRST202 is a refusal (the function is not exposed at all) and the committed test T-D8-9 accepts either code. Output left unedited | [O] |
| 2. The "authenticated PM fixture" | Replaced by a **throwaway authenticated auth user** (signed in with a real password; JWT role `authenticated`). Not a PM: building a PM needs a tenant, project and membership, far more test-db writing, and the refusal is at the grant layer so the role does not matter. The user and its `public.users` stub were **deleted** (cleanup check: 0 rows left). These were the only writes besides the apply | [O] |
| 3. Ledger (first) | workdir `/tmp/quoco/cli-wd-051` (sha-identical copy of the held file `debe97f0…2df9` + `project-ref` copy, ref printed = `exfccwlrhoutkgrlikod`), the 050 method (`050-test-db-apply-record.md` step 4). **Run by Aravind** in his own terminal: `supabase --workdir /tmp/quoco/cli-wd-051 migration repair --status applied 051 --linked`. Output pasted: "Repaired migration history: [051] => applied" | [R] |
| 4. Ledger (first) verified | `051 capture_files_immutability`, **15 statements**, on top of `050` (31) and `049` (59); `rows_051` = 1 | [O] |
| **5. DOWN rehearsal**, 14:58 UTC = 20:28 IST | gates re-checked in the same frame (time, CI in progress 0 and queued 0, ref, DOWN sha256 `672a422f…da3a`); `supabase db query --linked -f docs/reviews/051-down-testdb.sql`, foreground, one run, **14:58:51 to 14:58:55 UTC, exit 0** | [O] |
| 5. After the DOWN | fingerprint **`91a1865dd1fd0b98de6a9d9333008593` = the pre-apply value**; comments hash **`80b77da945cc55890da3acee8182eca2` = the pre-apply value**; function, trigger, the five constraints and `ingested_at` all gone; `service_role` UPDATE false on all 7 columns (16 columns walked, none true); the 051 ledger row **gone** (`rows_051` = 0; top three `050`, `049`, `048`); 0 rows | [O] |
| **6. Change from the runbook** | **No stored row was seeded on test-db to watch the DOWN refuse.** The refusal over terminal rows is proven on the scaffold: `docs/reviews/051-sql-evidence/G3-down-rev3.txt` (DOWN refused with `terminal_rows=18`, then with `terminal_rows=1`, fingerprint unchanged, the stored row intact, then passing with no terminal rows). Reason: under the INSERT/UPDATE lock a seeded stored row may be impossible to remove with the test helpers, which would leave test-db with a frozen row and block every later DOWN | [O] (per Aravind's instruction) |
| **7. Re-apply**, 15:00 UTC = 20:30 IST | gates re-checked (all pass); same file, ref and sha256 `debe97f0…2df9` in the frame, foreground, one run, **15:00:41 to 15:00:46 UTC, exit 0** | [O] |
| 7. After the re-apply | **fingerprint `19102bc8020867d2650e13c6fddd13c0` = the first apply's value**; comments hash `b97d2e3b…` equal; function ACL, trigger `tgtype` 23, five validated constraints, `ingested_at`, the 7-column grant, `SELECT`-only table privileges, 0 rows: all as in "Final state". Ledger at that moment: no 051 row (the DOWN had deleted it) | [O] |
| 8. Ledger (second) | same workdir, same command. **Run by Aravind**. Output pasted: "Repaired migration history: [051] => applied" | [R] |
| 8. Ledger (second) verified | `051 capture_files_immutability`, **15 statements**, on top; `rows_051` = 1. Throwaway workdir `/tmp/quoco/cli-wd-051` **deleted** | [O] |

## Fingerprints (the same expression as the scaffold's `t.fp()`)

| When | Fingerprint | Comments hash |
|---|---|---|
| before the apply (P0, twice) | `91a1865dd1fd0b98de6a9d9333008593` | `80b77da945cc55890da3acee8182eca2` |
| after the first apply | `19102bc8020867d2650e13c6fddd13c0` | `b97d2e3b734f6c002fd5c0a57a06e643` |
| after the DOWN | `91a1865dd1fd0b98de6a9d9333008593` | `80b77da945cc55890da3acee8182eca2` |
| after the re-apply | `19102bc8020867d2650e13c6fddd13c0` | `b97d2e3b734f6c002fd5c0a57a06e643` |

The local scaffold's values were the same four (baseline and post-apply), so the scaffold is an exact stand-in for test-db's `capture_files` structure.

## The proof the apply GO needs: where `QE011` and `23514` are asserted

`test/capture-files-immutability.test.ts`, every assertion that checks `error.code` equals the code. All are in database tests that run in CI and none is skipped. A green CI run therefore shows both codes reaching the client as `error.code`.

**`QE011`** (T-D8-3, T-D8-4, T-D8-5):
- `:144` `expect(error?.code, JSON.stringify(patch)).toBe('QE011')` — T-D8-3, stored row: `sha256`, `storage_path`, `byte_size`, `content_type` rewrites (4 iterations)
- `:152` `expect(a.error?.code).toBe('QE011')` — T-D8-4, rejected row: `reject_reason` change
- `:154` `expect(b.error?.code).toBe('QE011')` — T-D8-4, rejected → stored
- `:160` `expect((await update(s, { ingest_status: 'pending' })).error?.code).toBe('QE011')` — T-D8-5, stored → pending
- `:162` `expect((await update(failed, { ingest_status: 'pending' })).error?.code).toBe('QE011')` — T-D8-5, failed → pending

**`23514`** (T-D8-12, T-D8-13, T-D8-14, T-D8-18):
- `:218` and `:220` — T-D8-12, failed row carrying `reject_reason`; failed → stored carrying it
- `:232` `expect(error?.code, JSON.stringify(extra)).toBe('23514')` — T-D8-13, rejected + `sha256` / `storage_path` / `preview_state` (3 iterations)
- `:235` pending + `sha256`; `:237` pending + `byte_size`; `:238` pending + `content_type` — T-D8-13
- `:246` — T-D8-14, another row's `storage_path`
- `:288` and `:290` — T-D8-18, failed carrying `content_type` / `byte_size`; pending carrying `byte_size`

(Also asserted in CI and not listed: `42501` in T-D8-2, T-D8-7, T-D8-8, T-D8-15; `42501` or `PGRST202` in T-D8-9.) The owner-only cases (QE009, QE011 on INSERT, QE014) are scaffold-only and skipped in CI with the 050 reason.

## Not done

- **Prod.** Nothing about prod has been observed or changed. The same probes, the "PITR substituted" readback, the apply and the ledger are a later block (`docs/reviews/051-apply-runbook.md`, section c).
- **CI.** No CI run exists against the applied test-db yet. The commit that carries this record starts it. The apply GO still needs a **pinned green run URL where QE011 and 23514 appear as `error.code`** (`headSha` equal to the PR head). Until then those codes are inferred, not observed.
- **Types regeneration** (`ingested_at` is a new column) and the move of the SQL into `supabase/migrations/` happen in the prod-apply commit, not here. The SQL stays in `docs/reviews/` (held).
- The database tests themselves (T-D8-1 to 9, 12 to 16, 18, 20) have still never run against any database.

## Unknowns

- The exact time of Aravind's two ledger commands (the verification queries ran at 14:58:16Z and 15:03:44Z, both after the repair). [R]
- Whether the Supabase CLI's "Initialising login role…" step on each query changed anything in the database. Not inspected.
- Whether the first failed CI run (`40514683391`, finished with `failure`, started before this block) left rows in test-db: the table had 0 rows at P0 and at every later check, so no `capture_files` rows; other tables were not checked.
