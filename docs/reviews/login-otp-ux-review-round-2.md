**Review: PR #350, round 2**

**Pins and scope**

- `origin/main` = `408a35c042444816cf10733ea66811876da2efbd`, unchanged since round 1.
- PR head = `910da621bbf5825d14d1fc964d58e999bd59db5b`, resolved today.
- The last code commit is `ae95bbf`. `910da62` adds only docs on top of it (plan §16 and Run 4).
- The s2fix log's file hashes match the head blobs: `page.tsx 6fd4ec2c…`, `pending-controls.tsx 09404444…`, `submit-latch.ts 013ead1d…`, `smoke-login.sh 1bfcc38a…`. The smoke PASS and the T-UX runs in that log therefore apply to the head code.
- Read in full at head:
  - code: `page.tsx`, `pending-controls.tsx`, `submit-latch.ts`, `login-form-key.ts`, `saved-email.ts`, `smoke-login.sh`, the `login-otp.test.ts` diff
  - docs: plan §10–§16, the round-2 build log, the crashfix log (start), the s2fix log, the manual-run record
- The nine server blocks hash identical to `origin/main`. The byte-unchanged path list diffs empty.
- I could not see CI status for `910da62` from here.

**Round-1 R5(ii), re-checked.** The s2fix log notes my round-1 claim was not re-verified, so I checked it again in react-dom 19.2.4. The form-action listener is appended last to the dispatch queue (`extractEvents$1` runs after the simple-event plugin), and the queue runs in order. So `onSubmit`'s `preventDefault` always runs before React decides whether to call the action, and a submit the latch refuses cannot invoke `resendCode` at the React layer. The leak has to come from somewhere else (see the S2 ruling).

---

**Prior-round ledger**

| Item | Status |
|---|---|
| B1 | Design landed: keyed forms plus a 20 s safety release (T-UX-8 with control C6, T-UX-9 with control C7). **Evidence not at head.** Runs 1–2 were on `ba3dd3d`/`a5f2b0f`. `ae95bbf` then rebuilt `LatchedForm` (dropped `LatchScope`, added `decideSubmit` and `activeSubmitId`) and restructured the code step into one form. No successful sign-in has been observed on that code. See Condition 1. |
| B2 | Landed. B6 now redirects only users who have a tenant. Control C4c reproduces the round-1 behaviour. The prod count is pasted raw: 4 accounts / 0 with no profile row / 2 with no tenant. Without this fix, 2 of 4 prod accounts would have been trapped. |
| S1 | Landed. The have-code control is a GET submitter again (T-UX-3, control C3). The 3G residual is recorded; it is a warm-cache figure, so treat it as a lower bound. |
| S2 | Not fixed. Ruling below. |
| S3 | Landed. Sentry reports the error name only, and control C5 proves the report fires. |
| S4 | Landed. The real file runs only in CI, so see Condition 4. |
| N1–N3 | Landed. |

---

**S2: do I accept the residual? Yes, but I don't accept two of the claims in §16 as written.**

The case for accepting rests on consequence class, not on "not a regression":

- **Wrong code typed:** the leaked resend sends a new code. That is what the PM was about to need anyway.
- **Correct code typed:** the PM is already signed in, so an invalidated old code (U2) costs nothing.
- **Net cost:** one stray email, which also counts against the project's send cap. Bounded, visible, and reversible.

"main has no guard" is true, but it does not justify the residual by itself. Change §16 as follows:

1. **The effect statement covers only the wrong-code case.** Add the correct-code case:
   - Tenant user: verify succeeds and lands on Today. The queued resend then sends a code email to a signed-in user, redirects to `/login?step=code`, and B6 bounces back to Today.
   - No-tenant user (2 of 4 in prod): verify lands on `/onboarding`. The queued resend then pulls them onto the code screen while they are signed in, because B6 now renders the form for them. That is confusing, not harmful, but it must be written down.
2. **"The one-form design did not stop the second action" is not proven.** Run 4 does not record which build the browser executed.
   - This session already hit stale listeners on :3000 twice: PID 57855 in the crashfix log and PID 60579 in the s2fix log.
   - Run 4 does not show the code step's form count in the browser DOM, or whether "Send a new code" carried `disabled` when it was tapped.
   - Either pin it (Condition 2) or strike the sentence with a dated correction.

What the follow-up has to tell apart (the React layer is ruled out above):

- **H1, stale server or build.** Check `.next/BUILD_ID` against the served `/_next/static/<id>`, and count `<form>` elements on the code step in the DOM.
- **H2, taps before hydration (the S1 residual).** Look for Network Type = `document`, no `Next-Action` request header, and the first POST shown as canceled.
- **H3, latch released early.** Check whether the resend button was enabled at the moment of the tap.

The follow-up needs an owner and a date in the plan, not just "own PR, after merge."

---

**New findings**

**S-a. The smoke gate is a manual step, not a guard.**
- CI has no `next build`/`next start` job, and vitest cannot see the `'use client'` boundary. The crash class from §13 is therefore invisible to CI and caught only if someone remembers to run the script.
- It was shown RED on `b1ed980` and GREEN on the head tree, so it is proven. It is just not wired in.
- **Fix:** add it as a CI job before the next login change. This does not block this merge.

**S-b. Preview deployments point at a Supabase project nobody can identify.**
- This is outside the PR's scope. But it is the reason UI verification had to run a local build against production from a laptop, and it will recur on every UI review.
- If that project is not yours, every email typed into a preview's login form goes to it.
- **Fix:** identify the project, fix the preview env vars, and record it as a backlog item with an owner.

**N1.** `EmailInput` restores the saved address on every empty mount, not only after an error. After sign-out on a shared site-office laptop, in the same tab, `/login` shows the previous PM's address. Restore only when the form key carries an error, or clear the saved value when the code step mounts.

**N2.** The Sentry `errorName` is `"Error"` both for a missing profile row (PGRST116) and for an RLS denial, so the alert cannot tell them apart. Add a non-PII discriminator.

**N3.** The have-code GET puts the form's `$ACTION_*` hidden fields in the query string (build note 3). Record the real URL in the head re-run.

**N4.** The 2 no-tenant prod accounts are sent to `/onboarding` by `verifyCode`, and that page has no sign-out. This predates the PR and is outside its scope. Add a backlog line.

---

**Credit**

- Deviation 1 in the round-2 log: the spec'd form key would have rendered a raw `?error=` value into `data-latch-key`. T-UX-6 caught it before CI did, and the fix collapses unknown keys exactly as `errorMessageFor` does.
- Run 3 withdrew the earlier row-6 PASS as masked by the cooldown. The `s2probe@example.com` probe (no account, no email, no cooldown) is a test that cannot be masked that way.
- The s2fix diagnosis says "root cause NOT PROVEN" instead of claiming a fix.
- The crash was found by an actual browser run, and the gate was shown failing on the broken head before passing on the fix.

---

**Owned error**

My round-1 S2 fix told you to share one latch, on the theory that the two independent latches were the leak path. I never probed that mechanism, and the build that implemented it leaked anyway. Same class as the 026 instruction: an instruction built on behaviour I had not checked.

---

**Verdict: GO (conditional). Do not merge until conditions 1, 3 and 4 are recorded. Condition 2 must be run in the same session as 1, but its outcome does not block.**

1. **Re-run the browser rows on a build of `ae95bbf`/`910da62`, recording `.next/BUILD_ID`:**
   - correct code → Today
   - wrong code → error → correct code → Today
   - "Send a new code" with an empty code field → exactly one email
   - double tap "Send code" → one email
   - rate-limit → have-code (record the URL) → sign in
2. **Re-run the S2 probe in the same session**, capturing:
   - the resend button's `disabled` state at the tap
   - the Type column and `Next-Action` header for both POSTs
   - the waterfall start times

   It either closes S2 or gives the follow-up evidence that separates H1–H3.
3. **Dated amendment to §16:** add the correct-code effects (tenant and no-tenant), make the Run 4 claim pinned or struck, and name an owner and date for the follow-up.
4. **CI green at the final head**, including the real `test/login-otp.test.ts`. That is the only place T-OTP-07/08 run with the S4 mock.

**Merge protocol:** conditions 1, 3 and 4 recorded at the final head SHA → merge (merge deploys to production) → sign in once on production with your own account and record it.
