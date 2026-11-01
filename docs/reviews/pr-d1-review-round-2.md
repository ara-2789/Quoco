# PR #348: disposition check (round 1 → round 2)

Your dispositions are accepted, and so is your change to condition 2. Two sequencing gaps in the planned push are below; close them before the next round.

## Dispositions

| Item | Disposition | Ruling |
|---|---|---|
| S1 | in this PR | accepted; evidence per G1 below |
| S2 | in this PR | accepted; T-NOBUCKET-1 with the four planted verbs RED |
| S3 | retitle + grant layer now; wider walk deferred | accepted. The deferral names an owner (backend chat), a deadline (before digit 4 goes beyond your number, C6) and a record (`pr-d-plan.md`). Also add it as a line on the C6 gate list in the 052 plan (4b), so the gate that enforces it lists it. |
| N1, N2, N4, N6 | in this PR | accepted |
| N3, N5 | known risks | accepted |

**Condition 2: your correction is right.** I named `b854dde` because I did not foresee a code commit landing between it and the strings commit. The strings-only check is now `git diff --stat <fix-sha> <strings-sha>`. It must show only `lib/capture/pm-copy.ts`, plus any test that pins the strings, with the `PM_ERR_MESSAGES` keys unchanged.

**CI record for `b854dde`: recorded as observed.** You pasted raw lines from the run. They show conclusion success, `headSha` equal to the PR head, 162/162 files, 2578 passed, 7 skipped, 1 todo, and the T-CONC-1 line at 4636 ms. That closes condition 3 for `b854dde` only; it does not carry forward to the new head.

## Two gaps in the planned push

**G1. One push of three commits gives CI only the tip.**
- CI runs on the head of the push, so the RED commit never gets a CI run of its own.
- The RED evidence therefore has to be a local run at that SHA. Capture:
  - `git rev-parse HEAD` (the RED commit)
  - the sha256 of `pm-file-route.test.ts` and `pm-file-access.ts`
  - empty `git status --porcelain`
  - the failing T-FILE-CTRL deactivated case, run with `PM_CONTROL=service`, showing the 302 it received
- Then capture the same case GREEN at the fix SHA.
- Also run the deactivated case at the fix SHA without the swap. It must still return 404, so RLS is still the first layer.
- If you would rather have a CI-hosted RED, push the RED commit on its own first. Either is acceptable; a RED claim with no transcript is not.

**G2. Merging `main` for #349 changes the head after the strings commit.**
- The merge commit becomes the reviewed and deployed head. Condition 3 applies to that final head: `headSha` equal to the post-merge tip.
- The strings check stays `fix..strings`, not `fix..final`, because the merge will legitimately bring in other files.
- Paste `git diff --stat <strings-sha> <merge-sha>` and confirm none of these were touched by the merge:
  - `test/capture-handler.test.ts`
  - `lib/capture/**`
  - `app/api/capture-files/**`
  - `lib/media/capture-ingest.ts`
  - `supabase/**`
- If any of them was touched, I review that delta before merge, because it lands on the guard or the file wall.

## Next round

Send:
- the three or four SHAs
- the G1 transcripts
- the T-NOBUCKET-1 RED and GREEN results
- the two `--stat` outputs
- the CI conclusion pasted for the final head

If those match, it is GO and you can merge.
