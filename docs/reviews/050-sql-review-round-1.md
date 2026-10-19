I'll pin `a524eb2`, then read the SQL, the hunk diff and the DOWN in full before looking at the evidence.

The SQL is 1954 lines, so I'll read it in parts, starting with the header and the shared helpers.

The engineer function is read in full. Next: `expire_stale_material_inward` and the five PM functions.

Whether these refusals mean anything depends on 049's `_fixture.sql`. I need to confirm that auth id `…0004` is a PM member of P1 with status `deactivated`, and that `…0005` is an admin.

# 050 SQL review: PR #333 @ `a524eb2`

**Verdict: cleared for test-db once two small items land: S-1 and S-2 below.**
- I found nothing blocking in the SQL. Locks, authorisation, grants, the four hunks and the DOWN all match the plan, and the evidence holds up when I check it.
- S-1 and S-2 are a few lines each. Send me the delta and the re-run S1 transcript; it doesn't need a full round.
- S-3 is a condition for PR-C, recorded now.

**Pins:** PR head `a524eb2b9e89c0fabc0203b487cb648785f04ce6`; `main` still `4b419f6`. The sha256 of the SQL (`0d5a8c14…46d6`), the hunk diff (`2e2cc80c…4b26`) and the test-db DOWN (`5338d448…9a52`) all match `SHA256.txt`.

**What I read:** every new function in full (`050_material_inward_functions.sql:63-983`), the grants and assertion block (`1826-1954`), the hunk diff in full, the test-db DOWN statements and its closing assertion, `run050.sh`, `_lib050.sql`, `S3-red.sql`, the S4 fixture, and 049's `_fixture.sql`. I didn't read the replaced bodies line by line; the hunk diff against the live text is the proof for those.

**What I checked in the evidence**
- Every transcript carries `sha256 UP: 0d5a8c14…`, the file under review.
- PASS counts equal the assertion calls in each source: 24, 9, 11, 56 and 3.
- The swallow mutant fails exactly the two T-E8-RERAISE assertions.
- S5 shows the restored md5s equal `707c10fe…` and `d19d0750…`, EXCLUSIVE commits cleanly, SHARE ROW EXCLUSIVE gives `deadlock detected`, and a 6-second turn makes the DOWN fail on `lock_timeout` instead of stalling.
- The B2 refusals aren't vacuous. In the fixture, DPM is a real PM member of P1 whose status is `deactivated`, PEND is a pending PM member, ADMN is an admin with no membership, and ADMP is an admin who is a PM member. Each differs from the succeeding PM1 in exactly one property.

## My error

When I stubbed the 049 plan, I wrote that the engineer's project membership "is the RPC's job (PR-B)". I then didn't carry that line into either 050 plan round. S-1 is the result.

## Non-blocking, fix before test-db

**S-1. `050_material_inward_functions.sql:287-301`: the engineer's project membership is never checked.**
- `apply_material_inward_turn` trusts `p_project_id` and `p_user_id`.
- The composite FKs on `sent_by`/`reported_by` catch a user from another *tenant*. Nothing catches the right tenant with the wrong *project*.
- A router bug would then put the delivery on another project's PM page, where that PM can approve it.

**Fix:** inside the `IF v_create` block, before the document insert, add `EXISTS (SELECT 1 FROM public.project_members WHERE project_id = p_project_id AND user_id = p_user_id AND role = 'engineer')`, and raise QE012 if it fails.

**Test (S1):** an engineer on P2 sends a file into a P1 session and gets QE012, with no rows written.

**S-2. `050-down-testdb.sql` (and the DOWN text at `050_material_inward_functions.sql:1938-1954`): the 050 ledger row isn't deleted.**
- 049's DOWN deletes its row from `supabase_migrations.schema_migrations` in the same transaction (049 R8). 050's doesn't.
- After a rollback, `migration list` would show 050 as applied with none of its objects.

**Fix:** add `DELETE FROM supabase_migrations.schema_migrations WHERE version = '050';` before the DOWN's closing assertion, and add `NOT EXISTS (… version = '050')` to that assertion.

**Rehearsal:** the scaffold stub already has the table. Insert the 050 row first, as T-DOWN did for 049.

## Non-blocking, a PR-C condition, record it now

**S-3. Plan §10: a file sent after the check-in reset becomes a check-in photo.**
- The deferral in hunk (2) (`hunk-diff:48-57`, `121-130`) only sees text that reaches the RPC.
- The most likely moment for an 08:30 or 18:30 reset is S2, when the engineer is about to send the DC photo, or S3, when D-11 lets them send more pages.
- Once N2 has started the check-in, the session is `morning`. Per plan §6 (`inbound-start.ts:786-888`), the media path then stores that photo as a **morning photo** and queues a `media_ingest` job. Evening isn't read.
- PR-B can't fix this in SQL. Add it to §10 as **PR-C blocking**: while `invoice_reset_guard` is set, the router must not take a media message as a check-in photo.
- **Test:** a photo right after N2 creates no `daily_log_photos` row.

## Non-blocking, small

- **N-1. `050_material_inward_functions.sql:187, 191`: S1 doesn't normalise like S3 does.** S3 strips a trailing `.`/`)` and the keycap forms (`:226`). S1 compares raw `lower(v_text)`. So `1.` is accepted as an ack but re-asked as a kind. Use the same normalisation, ideally the same expression.
- **N-2. `050_material_inward_functions.sql:237-240`: the ack UPDATE matches by `v_doc_id` taken from context.** If `mi_document_id` were ever missing, the UPDATE would touch 0 rows, no ack would be stored, and the flow would still answer `complete`. Check `GET DIAGNOSTICS … ROW_COUNT = 1` and raise QE012 otherwise. The deliveries UPDATE just after it can legitimately touch 0 rows (B1), so leave that one alone.
- **N-3. `050_material_inward_functions.sql:441-501`: `pm_set_delivery_details` still edits a `rejected` delivery.** D-23 locks content only while `approved` or `cancelled`. Nothing leaves `rejected`, but its type and DC number can still be rewritten after the fact. Decide: lock it, or record why not.
- **N-4. `050_material_inward_functions.sql:579-646`: `reject_reason` has no length bound.** 049's other PM-typed text columns are capped at 64 or 1000 characters. Cap it in the function. It costs nothing, and a CHECK can't be added without touching 049.
- **N-5. `050_material_inward_functions.sql:1861-1862`: the comment overclaims.** It says the live ACL is "READ BACK … (before == after)". The block compares against the expected matrix, not against a pre-apply reading. Either reword it, or put the before reading in the apply runbook, where it belongs.
- **N-6. `run050.sh:25`: no clean-tree check, and HEAD is one commit behind.** The header records HEAD (`4faf1c4`, the commit before the file under test) but not `git status --porcelain`. The `sha256 UP` line is what ties the transcript to the file, and it does match. For the test-db run, add the empty-porcelain check and the artifact commit, as 049's runner does. Also add the DOWN file's sha256 to the S5 header.
- **N-7. Concurrency coverage.** The six-path race tests and the "engineer S3 ack vs PM link on the same invoice" race are still CI-only and still owed. Nothing here claims otherwise. Keep them on the list for the CI run.

## What's good

- **`pm_link_invoice` (`:757-801`)** does exactly what the plan asked. The array shape and the per-id project check run before any lock, every failure is QE015 and names no id, and the ids are sorted before locking. T-S1-FOREIGN-ID proves QE015 rather than 23503.
- **Path 4 in `pm_reject_delivery` (`:649-724`)** is Q2-2 steps 1–8 almost line for line. The S-C re-read raises QE011 instead of locking the invoice after the delivery, and the restore puts the delivery back *before* inserting the new self-link.
- **The DOWN's closing assertion** checks itself: the restored md5s, no `invoice` rows, no flow keys or flag left on any row, the seven functions gone, and the ACL. A wrong restore aborts the DOWN instead of committing.
- **The B1 rule at `:243-246`** stores the ack no matter what, and moves the delivery only `WHERE status = 'incomplete'`. The warning against clearing `cancelled_*` survives as a comment next to it.

## Next

1. S-1 and S-2 in the file, plus the re-run S1 and S5 transcripts. I'll check that delta.
2. S-3 added to plan §10 as a PR-C blocking condition.
3. Then the test-db apply under the plan §12 order: the per-database DOWN for test-db, the prod bodies captured and pinned just before the prod apply, and `050-down-prod.sql` built from them.