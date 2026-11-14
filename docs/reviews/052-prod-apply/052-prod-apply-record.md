# 052 MI-KIND-REMOVAL: prod apply record

Date 14 Nov 2026. Target: **prod `jvxwqignooseazzmwhvl` ONLY**, printed in every database frame (from the throwaway workdir's `supabase/.temp/project-ref`, no `supabase link`). FULL tier. Block A1. Executed by Claude Code (background job) on main at `8e90cb5a357f1a41074874203a6f8c4a8d4f0448`; the `go` and the ledger repair were by Aravind. The 052 DOWN was **never run**, the apply was **never re-run**. No Vercel, env var, test-db write or app-code change was made in this block.

Legend: **[O]** observed by a query or command in this block, raw output in `raw/`. **[R]** reported by Aravind, not observed here ("per Aravind").

Authority: the reviewer's Apply GO ruling (conditional), saved verbatim as `052-apply-go-ruling.md`, sha256 `fb3011b4153591742b48a23624d1af4e11477df064db90725ef231e9fc4e49d5` (the file as saved from Aravind's paste; the copy in this directory has the same hash). Package the reviewer could not open (third time) is committed in `apply-go-package/`.

## Timeline and results

| Step | What | Result | Basis |
|---|---|---|---|
| 0 | Ruling saved verbatim | sha256 above | [O] |
| start | `git switch main && git pull --ff-only` | HEAD `8e90cb5a357f1a41074874203a6f8c4a8d4f0448` = expected | [O] |
| 1 | Gates, one frame (`raw/step1-gates.txt`) | 13:11 IST (outside 08:25-08:40, 18:25-18:40, 23:15-00:15); CI in_progress 0, queued 0; workdir ref `jvxwqignooseazzmwhvl`; apply file from `git show origin/main:docs/reviews/052_mi_kind_deferred.sql`, sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e` = expected | [O] |
| 2 | External probe, `BEGIN READ ONLY ... ROLLBACK`, `transaction_read_only = on` (`raw/step2-external-probe.txt`, 07:42Z) | md5s `cecc170b26208d4b820402879e020271`, `b5467b20392b7e26449602acb9da2d00`, `4a7f470362e0bc7b7687737860d112f4`, each 32 chars, equal to the header; invoice sessions 0; `to_regnamespace('private')` NULL, `capture_apply_classification` and `pm_classify_document` in 0 `pg_proc` rows in every schema; `quoco_test_*` functions 0; ledger tail 051/050/049; 5 documents (3 dc, 2 invoice), each 1 delivery; 5 delivery `received_at` equal row by row to `apply-go-package/p0-capture-documents.txt`; deliveries 5, delivery_invoice_links 4 | [O] |
| 3 | Summary printed, Aravind typed `go` (after one non-matching reply `gi`, which did not apply) | | [O] for the exchange |
| 4 | Apply (`raw/step4-apply.txt`): date window and CI 0 running re-checked, ref and sha256 printed and enforced in the same frame; `supabase --workdir <workdir> db query --linked -f <workdir>/052-apply.sql`, foreground, once. **START 2026-11-14T07:44:50Z, END 07:44:54Z (13:14 IST), exit 0**, output `{"rows": []}` | applied | [O] |
| 5 | Ledger: `supabase --workdir <workdir> migration repair --status applied 052 --linked`, **run by Aravind**; output "Repaired migration history: [052] => applied" (`raw/step5-repair.txt`, written by Aravind, no timestamp header). Ledger query afterwards (`raw/step5-ledger-query.txt`): top three `052 mi_kind_deferred`, `051`, `050` | repaired | repair [R]; ledger [O] |

Ledger note (per Aravind): the repair needed a copy of the apply file at `<workdir>/supabase/migrations/052_mi_kind_deferred.sql`, same bytes, sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`, verified before the repair. Observed by me after the repair: the copy's sha256 is the same value.

## Step 6: post-apply read-back (prod ref printed in each frame)

`raw/step6c-readback-compare.txt` re-ran the **exact SQL of the 13 Nov rehearsal read-back** (`docs/reviews/052-sql-evidence/rehearsal-step3-readback.txt`, test-db `exfccwlrhoutkgrlikod`, 17:07:37Z, HEAD `1901be5`) on prod, each statement inside `BEGIN READ ONLY ... ROLLBACK`, and compared the returned rows with the rows recorded in that file. Both sides are printed in the raw file.

| Section | Prod vs test-db rehearsal file |
|---|---|
| (a) three function md5s: `e32797b63fee8fceca1934be700609c3` / `4f83a28f16956ebae830361c4f898899` / `cfcd59258a5039acc395dd8136328ca5` | EQUAL |
| new functions (schema, owner, SECURITY DEFINER, search_path, ACL) | EQUAL |
| (c) EXECUTE matrix | EQUAL |
| (c) `private` schema privileges | EQUAL |
| capture_documents columns | EQUAL |
| capture_documents 052 constraints | EQUAL |
| (c) capture_documents table grants per role (relacl `{postgres=arwdDxtm/postgres,authenticated=r/postgres,service_role=r/postgres}`) | EQUAL |
| schema fingerprint | EQUAL |
| comments hash | EQUAL |

The rehearsal's own ledger-tail section was excluded (it recorded the pre-ledger state). (b) `pg_proc` count is exactly 1 for each of the five names, in one schema each: `public.apply_material_inward_turn`, `private.capture_apply_classification`, `public.pm_classify_document`, `public.trg_capture_documents_before_insert`, `public.trg_capture_documents_before_update` (`raw/step6-readback-raw.txt`). (d) the 5 rows: kind unchanged (dc, dc, invoice, invoice, dc, same ids as step 2), `kind_source = engineer_declared`, `kind_set_by` NULL, `kind_set_at` NULL, `received_at` equal to the step 2f values and `received_at = delivery.received_at` true for all 5. (e) deliveries 5 and delivery_invoice_links 4, equal to step 2g. All [O].

## Step 7: prod API refusals (`raw/step7-api-refusals.txt`)

Key: the anon-role key from the main checkout's `.env.local` (its `NEXT_PUBLIC_SUPABASE_URL` host-ref is `jvxwqignooseazzmwhvl`); the workdir has no env file. Never printed; the saved file was grepped for it, 0 hits. Calls used the nil uuid, so a surprising success could not touch a document.
- anon `POST /rest/v1/rpc/pm_classify_document`: **HTTP 401**, `42501` "permission denied for function pm_classify_document".
- `capture_apply_classification` without a profile: **HTTP 404**, `PGRST202`.
- same with `Content-Profile: private`: **HTTP 406**, `PGRST106` "Only the following schemas are exposed: public, graphql_public". [O]

## Ruling conditions

| # | Condition | Status |
|---|---|---|
| 1 | Window, one foreground run, no retry | met [O] |
| 2 | External probe before apply | met [O]; run 07:42Z, apply 07:44:50Z (about 2.5 minutes apart); the md5s were not re-read in the seconds before the run, the window and CI were |
| 3 | No Vercel change between probe and apply | none made by me; not observed by a query of Vercel, which was out of scope |
| 4 | Non-zero exit handling | not triggered (exit 0) |
| 5 | Ledger row straight after exit 0 | done (repair [R], row [O]) |
| 6 | Post-apply read-back | met [O] |
| 7 | Two refused calls through the prod API | met [O] (three calls) |
| 8 | Promotion | this PR |
| 9 | Rollback order | not used |

## Promotion (this PR, branch `chore/052-prod-apply`)

- `git mv docs/reviews/052_mi_kind_deferred.sql supabase/migrations/052_mi_kind_deferred.sql`; `supabase/migrations/` topped out at 051 when re-checked.
- Header note added: three comment lines at the top. sha256 old `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`, new `24496849ffbcfe0e19faad05ef6f1046893b69e4275e2c752c5a3682cab8ef0a`; `diff` against `origin/main`'s copy shows only those 3 added lines. The applied bytes are the old sha; the repo file now carries the note.
- `types/database.ts` regenerated from test-db (ref `exfccwlrhoutkgrlikod` printed first, read-only): diff against the merged file is **empty** (exit 0, 0 lines).
- `scripts/migration-number-reservations.json`: `claimedBy` updated, dated correction appended (the 051 precedent). `node scripts/lint-migrations.mjs`: clean, 107 known violations all exempted.

## Not done here, or not established

- PITR was not observed (substituted by the pre-apply read-back in `apply-go-package/p0-readback.txt`, sha256 `1b4e4acf964dd39b68be4d58dc3036161daaa18ef1a3f1b38b8e11f0a4e9e4f0` per the request, and `052-down-prod.sql`, never run).
- The dark control's deployment id and Vercel env listing were waived by Aravind (`apply-go-package/p1-notes.md`, [R]); the reviewer accepted the waiver.
- Closing artifact still open: the first PM classification of a real unclassified document on prod after PR-D2.
- Named finding carried from `p1-notes.md` (not 052): "Automatically expose new tables" is ON in prod, a blocker before the switch trigger. Not changed.
