# 051 prod apply record — COMPLETE

Date 28 Oct 2026. Target: **prod `jvxwqignooseazzmwhvl` ONLY** for every prod command, named by the instruction and printed (via the workdir's `project-ref`) before each database command. Test-db: no writes in this block. FULL tier. Executed by Claude Code (background job) in the throwaway workdir `/tmp/quoco/cli-prod-051` (deleted at the end); the ledger repair was run by Aravind. Method and shape follow `docs/reviews/050-prod-apply-record.md` (workdir with a written `supabase/.temp/project-ref`, no `supabase link`; the ledger repair by Aravind; verification by query). The 051 DOWN was **never run** in this block.

Marks: **[O]** observed by Claude Code. **[R]** reported by Aravind (he ran it in his own terminal and pasted the output).
Raw log of every command and output: `/tmp/quoco/c2-prod-apply.txt` on Aravind's machine (not committed; the quoted lines below come from it). Committed evidence: `docs/reviews/051-sql-evidence/P0-prod-preapply.txt`, `PITR-substituted-prod-readback.txt`, `P1-prod-postapply.txt`.

**APPLY GO:** Aravind, 2026-10-28 09:13 IST ("Go for C2"), given in the same exchange as the block. [R]
**External review:** prod GO conditional (apply-gate verification 2026-10-27 23:58 IST) plus additions A and B (2026-10-28 00:01 IST). [R]

## Final state (observed after the apply and the ledger row)

- 051 rev 3 is applied to prod. The in-file post-condition block passed (exit 0). [O]
- Function `trg_capture_files_before_update`: one row, `prosecdef` true, owner `postgres`, `proconfig {search_path=""}`, ACL `{postgres=X/postgres}`; `EXECUTE` false for `anon`, `authenticated`, `service_role`. [O]
- Trigger: `BEFORE INSERT OR UPDATE`, row-level, `tgtype` 23, enabled (`O`), not DELETE or TRUNCATE. [O]
- Five constraints present and validated; column `ingested_at` (`timestamptz`, nullable, no default). [O]
- `service_role` can UPDATE exactly `ingest_status, content_type, byte_size, sha256, storage_path, reject_reason, preview_state` (17 columns walked); `anon` and `authenticated` none; table privileges for `service_role` = `SELECT`. [O]
- `capture_files` has 0 rows. [O]
- Ledger: `051 capture_files_immutability`, 15 statements, on top of `050`; 47 rows in total. [O]
- Fingerprint **`19102bc8020867d2650e13c6fddd13c0`**, comments hash **`b97d2e3b734f6c002fd5c0a57a06e643`**: equal to test-db's and the local scaffold's post-apply values. [O]

## Observed vs reported

| Step | Result | Mark |
|---|---|---|
| **A. Merge check** | `gh pr view 339`: `MERGED`, merge commit **`9f3cfb51ccab3fc68a0714f459e70ce47c8f944a`** (merged 2026-10-27T18:26:18Z). Parents `10cd3a3047d281c34a5e34cbae13d016dd0aa276` (main before the merge) and `e8a6218420b145467bfe739cb9732be0ede6ee7f` (the PR head): **PASS**. `git rev-parse <merge>^{tree}` = `e8a6218^{tree}` = `d80babe4609dd4ddb0e6df83da8426f872c99e80`: **trees equal, PASS**. **`origin/main` is the #339 merge commit `9f3cfb51` itself, not a later commit**, so no later commits needed checking | [O] |
| **B. Applied bytes** | workdir `/tmp/quoco/cli-prod-051`, `project-ref` = `jvxwqignooseazzmwhvl`; `git show origin/main:docs/reviews/051_capture_files_immutability.sql` copied to its `supabase/migrations/`; sha256 **`debe97f051f4414c72f2bb1f6c45ca37ee59dd1bec43e5cefecca8a74ce22df9`** (equals the test-db-applied bytes). `git show origin/main:docs/reviews/051-down-prod.sql` sha256 `288dc847cb66336a9b2574bfc227a0f54c4858854f3e606d71c584f744596046` = its `SHA256.txt` entry. All printed in one frame. The main tree's link still read `exfccwlrhoutkgrlikod` (untouched) | [O] |
| **1. Gates**, 03:46 UTC = 09:16 IST | outside 08:25–08:40 and 18:25–18:40 IST; `gh run list --status in_progress` and `--status queued` both empty; ref `jvxwqignooseazzmwhvl`. Re-checked in the apply frame | [O] |
| **2. Prod P0** (read-only; the same 21 probe queries as `P0-testdb-preapply.txt`, checked identical by script; only the ref and workdir path differ) | `capture_files` **0 rows**; terminal rows 0; rows with any detail set 0; rows with `content_type` or `byte_size` set 0; `SHOW default_transaction_isolation` = `read committed`; isolation settings in `pg_roles.rolconfig` and `pg_db_role_setting` = 0 and 0; ledger top three `050`, `049`, `048`; function, five constraints, `ingested_at`, user triggers all absent; table ACL `{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}` (equals test-db's); no column ACLs; **fingerprint `91a1865dd1fd0b98de6a9d9333008593`**, **comments hash `80b77da945cc55890da3acee8182eca2`** (both equal test-db's pre-apply values). 19 of 19 checks PASS. Raw: `P0-prod-preapply.txt` | [O] |
| **3. PITR substituted** | PITR **not observed**; substituted by the prod readback of `capture_files` (constraints, columns, table and column ACLs, triggers, comments, indexes, RLS policies, row count), sha256 **`adf1d2698cbabde17d64984e3025a78dea8014eb15c8b858d91505dd05dbfc08`**, `PITR-substituted-prod-readback.txt`, plus `docs/reviews/051-down-prod.sql` (sha256 `288dc847…6046`) | [O] |
| **4. Apply** | ref and file sha256 printed in the same frame; `supabase --workdir /tmp/quoco/cli-prod-051 db query --linked -f /tmp/quoco/cli-prod-051/supabase/migrations/051_capture_files_immutability.sql`, foreground, once, never `db push`. **START 2026-10-28T03:50:27Z, END 03:50:32Z (09:20 IST), exit 0**, output `{"rows": []}`. The in-file post-condition block passed (a failure aborts the transaction) | [O] |
| **5. Post-apply readback** | as in "Final state"; the same 14 probe queries as `P1-testdb-postapply.txt`, checked identical by script; 13 of 13 checks PASS, including both hashes. Raw: `P1-prod-postapply.txt` | [O] |
| 5. Anon probe | the prod anon key was in the env setup; its claims were checked first (host `jvxwqignooseazzmwhvl.supabase.co`, key claims ref `jvxwqignooseazzmwhvl`, role `anon`). **One** anon UPDATE on `capture_files` filtered by a random uuid (matches nothing): **`error.code` 42501**, "permission denied for table capture_files". The key was never printed | [O] |
| **6. Ledger** | Printed for Aravind (ref and copy sha256 first, then the command): `supabase --workdir /tmp/quoco/cli-prod-051 migration repair --status applied 051 --linked`. **Run by Aravind**, one attempt, pasted output: "Initialising login role… Connecting to remote database… Repaired migration history: [051] => applied. Finished supabase migration repair." | [R] |
| 6. Ledger verified (03:59:08Z) | `051 capture_files_immutability`, **15 statements**, on top; previous row `050 material_inward_functions` 31; **47 rows**; `rows_051` = 1 | [O] |
| 6. Workdir | `/tmp/quoco/cli-prod-051` **deleted** after the types regeneration (which needed it); `ls` confirms it is gone | [O] |
| 7. Types | see the dated correction below. Final diff of `types/database.ts` against `origin/main`: **only** `ingested_at: string \| null` (Row) and `ingested_at?: string \| null` (Insert, Update) on `capture_files`; 3 lines added, 0 removed | [O] |

## DATED CORRECTION to the block (2026-10-28): types source

The block said to regenerate `types/database.ts` "against prod". **That was wrong.** Per Aravind's decision of 2026-10-28, the types were regenerated **from test-db, per D-16**, the repo's practice (precedent: PR #334, "types regenerated from test-db (D-16)"; commits `693de26` and `00339a7`). Why: the committed file carries the type entries of test-db-only helper functions, and prod does not have those functions.

- **Prod-sourced attempt** (`npx supabase --workdir /tmp/quoco/cli-prod-051 gen types typescript --linked --schema public`, exit 0, empty stderr, 2855 lines): the diff against the committed file was **+3 lines** (`ingested_at` in Row, Insert, Update) **and −8 entries**: the types of `quoco_test_047_unused_rights_check`, `quoco_test_capture_acl`, `quoco_test_capture_cleanup`, `quoco_test_capture_fixture_tenant_ok`, `quoco_test_capture_helpers_present`, `quoco_test_capture_insert`, `quoco_test_capture_update`, `quoco_test_row_is_locked`. This failed the block's "only `ingested_at`" condition, so it was **discarded** (not committed). Its diff summary is in the log; the discarded file is `/tmp/quoco/types-prod-051.ts` on Aravind's machine.
- **Test-db-sourced** (`npx supabase --workdir <main checkout> gen types typescript --linked --schema public`, ref `exfccwlrhoutkgrlikod` printed first, read-only, exit 0): the diff is **only the same 3 `ingested_at` lines**. This is what is committed. The two sources agree on `capture_files` itself (the structure fingerprints are equal on both databases).

## Not done / not observed

- **PITR state** (not observed; substituted as above).
- **The DOWN on prod:** deliberately not run. The incident rule stands: if C5 misbehaves, stop C5 and leave 051 in place (`docs/reviews/051-apply-runbook.md`, section e; carry-forward item 12).
- **CI on the apply commit** is not part of this record; the PR for it is opened and not merged.
- `docs/reviews/051-sql-evidence/SHA256.txt` still lists the SQL under its old path `docs/reviews/051_capture_files_immutability.sql`; the file now lives at `supabase/migrations/051_capture_files_immutability.sql` with the same sha256. Not edited in this block (outside its file list).

## Unknowns

- The exact time of Aravind's ledger command (the verification query ran at 03:59:08Z, after the repair). [R]
- Whether the Supabase CLI's "Initialising login role…" step changed anything in the prod database. Not inspected.
- Whether CI on `main` at the merge commit was green; the gates only checked that no run was in progress or queued.
- While preparing the post-apply script, a read-only ledger query was run against **test-db** by mistake (my test-db verification script); its output was discarded. No write.
