052 MI-KIND-REMOVAL: diff confirmation, PR #355
Confirmed. GO to merge at `a077bd05679cd0a91d838032361204f85980aa56`. This is not an Apply GO.
Pins

* `feat/052-mi-kind-removal` and `pull/355/head` both resolve to `a077bd05679cd0a91d838032361204f85980aa56`. `main` is still `f007f61dc900b0d6c3ba997c5c93c628fb7f6c93`.
* I read the delta `6634da3..a077bd0`: six commits, 22 files.
* No file under `supabase/`, `app/`, `lib/capture`, `scripts/` or `.github/` changed, and the held SQL and both DOWN files are untouched (`2c4ee3bc…`).
* `09de1aa..a077bd0` is four files, all under `docs/reviews/`. A CI run on `09de1aa` therefore covers the code at the head.
* I could not open run 43561407757 from here. What I read is the saved run JSON (`headSha 09de1aa…`, conclusion success) and the log excerpt in `b2f/`.

Findings closed

1. Dark control: closed for merge.
   * The record shows the previously allowlisted phone getting "That option isn't available yet. Nothing was recorded." after the redeploy. That is the behaviour the gate exists for.
   * The record rests on your report and says so. It has no Vercel listing and no times for the redeploy or the reply. Plan R step 1 asks for both, so they move to the pre-apply list below.
2. T-C-4: closed.
   * The two callers are now `pm1` and `admMem`, and `kind_set_by` is asserted equal to the caller that got `already_classified=false` (and to the non-QE011 caller in the different-kinds case).
   * The control went RED on the planted loser id, then GREEN.
   * The control transcript prints HEAD `30a9c23`, which is before the test commit, so it ran on an uncommitted tree. The printed file sha256 (`cd2151ca…`) matches the committed file, so the evidence holds.
   * The CI lines show `admMem` winning rounds 0 to 2 and `pm1` winning round 3, in both the same-kind and different-kinds cases.
3. T-K-4: closed. The code is pinned to `QE015`. The control with `QE014` planted went RED. The file sha256 matches the commit (`65caab5b…`).
4. T-P-1: closed. The test now asserts 0 deliveries on the unclassified document before the calls. The control that counts on a classified document went RED ("got 1").
5. Package corrections: closed.
   * The "unchanged since" line is now a dated addendum.
   * The controls are renamed assertion controls.
   * The string comments read "English approved 14 Nov 2026; Tamil owed", and no string value changed.
   * The two vacuity patterns are appended to the inventory.

Findings 5, 6 and 7 are recorded as deferred, with the PR-D2 rider on 5. That is as ruled.
Owed before prod apply
Your list is unchanged, with three additions:

* Dark-control evidence. The Vercel Production env listing showing `CAPTURE_DIGIT4_TEST_PHONES` absent, plus the times of the redeploy and the reply, as a dated addendum to `052-dark-control.md`.
* A second "4" after the merge deploy. The merge creates a new Production deployment, so the dark reply should be observed once on the merged code. Record the new deployment id with it.
* The two items from round 1. The one-off frozen-row call on test-db, and my verification pass on the 13 Nov rehearsal record.
