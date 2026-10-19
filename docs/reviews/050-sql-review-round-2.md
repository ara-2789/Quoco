Both hashes match yours. There's also a new, unrun TypeScript test suite (`4972f40`), which wasn't part of the request. I'll note it but not review it. The SQL and DOWN diffs:

# 050 SQL delta: PR #333 @ `ed7852f`

**Verdict: confirmed. Cleared for test-db.** One new item, S-4, is a probe to run first, on both databases. It doesn't change the SQL unless the probe finds rows.

**Pins**
- PR head `ed7852fd9f57d73cdb5bba157de19cb891fbee95`; `main` still `4b419f6`.
- SQL `1e09730d…0fade` and test-db DOWN `c7f13299…83bd6` match what you gave.

**What I checked**
- **The SQL diff from `a524eb2`.** It contains S-1, S-2 and N-1 to N-5, and nothing else.
- **Transcripts.** All seven are headed artifact `f25b49f`, porcelain is empty (N-6 done), and the UP sha is `1e09730d…`.
- **Results:** S1 35/0, S2 9/0, S3 11/0, S4 61/0, S5 10/0, and the swallow mutant still fails exactly its two assertions.

**Each fix, confirmed**
- **S-1.** The check sits inside `IF v_create`, before both the `processed_messages` read and the document insert (`:305-322`), so nothing is written on refusal. The P2 engineer is refused QE012 with no rows. The same engineer into P2 succeeds. Good.
- **S-2.** The ledger row is deleted inside the DOWN transaction, the closing assertion checks it, and S5 shows the 049 row untouched.
- **N-1.** One normalisation, `v_norm`, now feeds both S1 and S3. `1.`, `2)`, keycap and `Invoice.` all work, and `12` is still re-asked. Good.
- **N-2.** Both the ack UPDATE and the note UPDATE check `ROW_COUNT = 1`. The missing-`mi_document_id` case now raises QE012 and the session rolls back.
- **N-3.** The delivery lock (`FOR NO KEY UPDATE`) comes **after** the invoice lock for an automatic delivery, so path 6's order holds. A rejected delivery is refused QE011, with a passing control.
- **N-4.** 1001 characters → QE017; 1000 → accepted.
- **N-5.** The comment is reworded, and the before-reading of the ACL is moved to the runbook.

## S-4. Run before the test-db apply and again in the prod pre-checks: are there engineers whose membership role isn't `engineer`?

The router and S-1 don't agree on what makes an engineer routable:
- `resolveEngineerProject` picks the project from **any** `project_members` row for the user, with no role filter (`lib/whatsapp/project-resolution.ts:37`).
- S-1 requires `role = 'engineer'`.
- 048 writes `'engineer'` (`048:366-367`), so newly registered engineers are fine. But an engineer created before 048 whose only membership row has a different role would get routed to a project, then be refused QE012 on **every** capture.

The S1 case labelled "only a QS/other-role membership" (`S1-engineer.txt:514`) actually tests a non-member (ENG1 into P2), not an other-role membership. So this case isn't covered.

**Probe**, read-only, on test-db now and on prod in the §13 pre-checks:

```sql
SELECT u.id, m.project_id, m.role
FROM public.users u
JOIN public.project_members m ON m.user_id = u.id
WHERE u.role = 'engineer' AND u.status = 'active' AND m.role <> 'engineer';
```

Expect 0 rows. Any row is a legacy membership to fix in the data, or a reason to widen S-1, and that's Aravind's call.

**Fix the label** at `S1-engineer.txt:514`. Better: plant a QS-role membership for an engineer and show the refusal, so the case the label describes is actually tested.

## Not reviewed here

The new TypeScript suite (`test/capture-*.test.ts` and `test/helpers/capture-fixtures.ts`, commit `4972f40`) wasn't part of this request and hasn't run. I'll review it together with its first CI run on test-db, where its race tests count as the CI-only evidence still owed (N-7).

## Next

1. Run the S-4 probe on test-db.
2. Apply to test-db per plan §12: link printed, `supabase db query -f`, foreground. Then the readbacks: catalog fingerprint, ACL matrix, a real anon-key call, and the 050 ledger row.
3. Run the DOWN rehearsal on test-db using `050-down-testdb.sql` (sha `c7f13299…`), then re-apply.
4. Run CI with the new suite, and pin the run URL.
5. Prod pre-checks per §13 with S-4 added, then `050-down-prod.sql` built from the captured prod bodies. Send that back to me before the prod apply.