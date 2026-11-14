# 052 MI-KIND-REMOVAL: confirmation pass on the prod apply record

## Verdict

**Confirmed. The record matches what the Apply GO required.** 052 is applied to prod `jvxwqignooseazzmwhvl`, and nothing in the raw output contradicts the record. One artifact stays open: the first PM classification of a real unclassified document after PR-D2.

## Pins

- PR #356 head is `0bc41e529c15c6eb1763fc9ac86f1f9b25e56a24`. It is one commit on top of `8e90cb5`.
- #356 is already merged: `main` is `900255665d5a2875f9f66cf095740eac6350686b`, with the same tree as `0bc41e5`. The merge came before this pass. That is acceptable here, because the PR only moves the file and adds records.
- I could not open CI run 43572996649.
- This time I read the whole package from the repo, including the files I had not seen at the Apply GO.

## Conditions, checked against the raw files

1. **Window and single run: met.** Gates at 13:11 IST, apply from 07:44:50Z to 07:44:54Z, exit 0, one run. The ref and sha256 `2c4ee3bc…357e` were printed in the apply frame.

2. **External probe: met.** It ran at 07:42Z inside a read-only transaction.
   - The three md5s are the header values on all 32 characters. This closes the gap I left open at the Apply GO.
   - 0 invoice sessions, no `private` schema, 0 functions of the two new names, 0 `quoco_test_*` functions.
   - 5 documents (3 dc, 2 invoice), one delivery each.
   - The P0 file does hold each document's delivery `received_at`, as I asked.

3. **No Vercel change: not observed, accepted.** The apply's own A0 check would have aborted on any invoice session, and the exit was 0.

4. **Non-zero exit handling:** not triggered.

5. **Ledger row: met.** The repair is your report. The row itself is observed by query: 052, 051, 050.

6. **Read-back: met.**
   - The post-052 md5s are `e32797b6…09c3`, `4f83a28f…8899` and `cfcd5925…28ca5`, equal to test-db.
   - Fingerprint `6c69c545…` and comments hash `7505c3a4…` are equal to test-db.
   - Each of the five function names appears once, in one schema.
   - All 5 rows are `engineer_declared` with NULL `kind_set_by` and `kind_set_at`. Kinds are unchanged, and `received_at` equals the delivery value row by row against both the P0 file and the probe.
   - Deliveries 5 and links 4, unchanged.

7. **Prod API refusals: met.** Anon gets 401 with 42501. The helper gets 404 `PGRST202` without a profile and 406 `PGRST106` with `private`. Prod exposes `public` and `graphql_public` only.

8. **Promotion: met, with one note.**
   - The promoted file differs from the applied bytes by the three dated header lines only (`2c4ee3bc…` to `24496849…`).
   - The reservation entry is updated.
   - Types were regenerated from test-db, not prod. I accept that, because the read-back shows the two schemas equal on everything 052 touches. Say "from test-db" wherever the record is quoted.

9. **Rollback:** not used. `052-down-prod.sql` is still `344f4b2e…`.

## Also closed

- **Frozen-row call (code review answer 2).** On test-db, setting `kind_set_by` on an `engineer_declared` row raised QE009 from the update trigger, and the row was identical before and after.
- **Dark control on merged code.** Recorded as your report with the waiver stated. I accepted it at the Apply GO.

## Notes, no action on 052

- **N-1.** The `052-down-prod.sql` header still says the md5s' prod origin "is not established". The probe has now established it. Do not edit the DOWN file, because its hash is the pinned rollback artifact. The apply record already carries the correction.
- **N-2.** The md5s were read 2.5 minutes before the apply, not in the same frame. The post-apply md5s make this moot.
- **N-3.** The prod lock hold was not measured. It was not a condition; the test-db bound of about 200 ms stands as the only figure.

## Still open, with owners

- **Closing artifact (you):** the first PM classification of a real unclassified document on prod, after PR-D2.
- **PR-D2 (you):**
  - a render test on a literal `engineer_declared` row with NULL stamps (code review finding 5);
  - the rollback order starts with reverting its deploy;
  - `CAPTURE_DIGIT4_TEST_PHONES` stays absent until it is live.
- **Next migration that touches `apply_material_inward_turn`:** drop the `delivery_id` result key and the dead `v_delivery_id`.
- **Next edit of the tripwire test:** add the `GRANT … ON … capture_documents` matcher (finding 7).
- **"Automatically expose new tables" is ON in prod.** This is not a 052 defect, since 052 creates no table. It is a blocker for the next migration that creates one, because the platform will grant on it by default. Put it in the review package for that migration.
- **Tamil** for `MI_ASK_FILE` and `MI_ACK_QUESTION`.
