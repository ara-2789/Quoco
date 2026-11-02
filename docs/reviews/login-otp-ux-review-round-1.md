**Review: PR #350, login OTP UX fix (B1/B3/B4/B6)**

**Pins and scope**

- `origin/main` = `408a35c042444816cf10733ea66811876da2efbd`, resolved via ls-remote today. This matches the plan's base.
- PR head = `717863208833f2bf4ecdf41f8f7853abedfbfbde`. It has two commits: `f2a067c22c0ee202931631d807269e03a9c80271` (code) and `7178632` (docs).
- Read in full at head: `page.tsx`, `pending-controls.tsx`, `submit-latch.ts`, the `copy.ts` diff, both new test files, the plan with its §10 addendum, and the build log.
- Also read at head: `proxy.ts`, `lib/auth/profile.ts`, `lib/auth/profile-query.ts`, `app/(dashboard)/layout.tsx`, `app/(onboarding)/onboarding/page.tsx`, the T-OTP-07/08 region of `test/login-otp.test.ts`, and `ci.yml`.
- Pin drift: the build log's Step 5 proofs are pinned to `f2a067c`, one commit behind head. I checked `git diff --stat f2a067c 7178632`: it touches only the plan and the build log, so the code proofs carry over. The log still needs a dated line saying so (N3).
- I could not see CI status for the head SHA from here.

---

**Answers to the plan's open framework questions (U6 / R5)**

- **R5(ii): `preventDefault` in `onSubmit` suppresses the action. Confirmed at source.**
  - In react-dom 19.2.4, the form-action dispatch listener checks `nativeEvent.defaultPrevented` first.
  - When it is set, React only starts a host transition if some other transition is already scheduled. It never calls the action.
  - So the latch mechanism is sound at the React layer.
- **R5(i): the addendum's reason for dropping the GET submit button is wrong.**
  - In the same listener, a submitter's string `formAction` replaces `action`.
  - The `typeof action === 'function'` branch is then skipped, and React neither calls `preventDefault` nor runs the action. The browser submits natively.
  - The original design would have sent nothing. It would also have worked before hydration. See S1 for the ruling.
- **Still unverified:** whether `useFormStatus().pending` falls after a server action `redirect()` to the same route (`/login?error=…`). This is the hinge for B1 below.

---

**Findings**

**B1. The core fix has zero behavioural evidence, and its failure mode is a dead end on exactly the screen B4 exists to rescue.**

- The plan made the §7 preview checklist the owner of U4/U6. The build log has no §7 rows: no screenshots, no email counts, no timestamps. The addendum does not defer them either. That is a silent drop.
- The unit tests prove only two things:
  - the pure latch, and
  - that the `*View` components render `disabled` when told to.
- The hook wiring (`PendingWatcher` → `createPendingObserver` → `release`) is untested anywhere. On this page that wiring is load-bearing:
  - Rate-limited `requestCode` redirects to `/login?error=RESEND_RATE_LIMITED`.
  - That is the same route with the same tree position, so the email-step `LatchedForm` instance survives with its latch held.
  - The latch is released only if `pending` is observed going true→false on that instance.
- If `pending` does not fall across a same-route redirect, both `SubmitButton` and `HaveCodeButton` stay disabled under the error message. "Sending code…" shows forever, and the PM has no path forward except a reload.
- If `pending` falls but the effect never observes `true` (React batches both values), the buttons look enabled and every tap is silently eaten by `preventDefault`. That is worse, because nothing on screen shows it.
- Merge is deploy, so this cannot be settled in production.
- **Fix:** run §7 on a preview and record the raw results in the build log, with screenshots and inbox counts. Add these rows:
  - (a) After the rate-limit error appears, wait out the cooldown and tap "Send code" again. Expect exactly one new email.
  - (b) After the rate-limit error appears, tap have-code. It must be enabled and must navigate.
  - (c) After a `WRONG_CODE` redirect, tap "Sign in" again. It must submit.
  - (d) Double-tap "Send code" on a throttled phone connection. Expect one email.

**B2. B6 creates an exit-less trap for signed-in users with no tenant. This falsifies the plan's own R1 claim.**

- B6 sends a session with `tenant_id = null` to `/onboarding` (`page.tsx:175`).
- `/onboarding` has no sign-out. It contains only `createCompany`; the onboarding page and layout have no sign-out form or link. The only `signOut` in `app/` is in `(dashboard)/layout.tsx:7`.
- Before this PR, that user could open `/login` and sign in with a different address. `verifyOtp` replaces the session.
- After this PR, `/login` bounces them straight back to `/onboarding`. Their choices are to clear cookies or to create a company. A wrong-address or not-yet-assigned PM will mint a junk tenant, on top of the open double-call tenant-minting backlog item.
- The R1 comment and the in-code note both claim "/login can never become unusable." For this population, that is no longer true.
- **Fix, either of:**
  - Redirect only when `tenant_id` is present, and render the form otherwise. This stays inside the file list.
  - Add a sign-out to onboarding. That is outside the declared file list, so it needs a plan line.
- Change T-UX-4's "user, no tenant" row to match. Its control is the current code, which goes red.
- Separately, state how many production auth users have `tenant_id IS NULL`, with the raw query output.

**S1. The have-code control is dead until hydration. That is the recovery path on a slow site connection, and it was traded for a risk that did not exist.**

- `type="button"` plus `window.location.assign` does nothing before the client bundle loads.
- The plan's GET submitter needs no JS. R5(i) is shown above to behave as the plan expected.
- **Fix, either of:**
  - Revert to `<button type="submit" formMethod="get" formAction="/login" name="step" value="code" formNoValidate={false}>`, keeping §7 step 3's email count as the guard.
  - Or keep the current control, and add a dated addendum line stating the no-JS cost and that a tap before hydration does nothing.
- Same class: the latch itself does not exist before hydration. A pre-hydration double tap is two native POSTs, which is the original B1. Record this as a residual with the measured `/login` time to interactive on a throttled 3G profile.

**S2. "Send a new code" is not disabled while "Sign in" is pending.**

- These are two `LatchedForm`s with independent latches (`page.tsx:209`, `:233`), and the buttons sit 16px apart on a phone.
- A fat-finger tap on resend during a slow verify queues a second server action behind it.
- Whether Next still runs that queued action after verify redirects to `/dashboard` is unverified.
- If it runs, it sends an email the user did not ask for, and possibly invalidates the code (U2 is still open). It may also navigate the user back to `/login?step=code`, where B6 then bounces them again.
- **Fix:** share one latch and one pending source across both code-step forms, or disable resend while verify is pending. Add a §7 row: tap "Sign in", then "Send a new code", inside the pending window.

**S3. The B6 catch silently swallows the invariant that `profileForAuthId` was built to make loud.**

- `profile-query.ts:41-55` throws on a missing row precisely so R1-class violations are not disguised. `page.tsx:177` discards that error with no log.
- A session with no `users` row, or an RLS denial, now looks identical to "signed out."
- Keeping the form is the correct fallback. Losing the signal is not.
- **Fix:** report the caught error through the same channel other server catch sites use, with the auth id scrubbed. Add a test asserting the reporter is called on the profile-throws row.

**S4. T-OTP-07/08 now pass in CI only through the B6 catch.**

- They render the real `LoginPage` without mocking `@/lib/supabase/server`.
- `createClient()` then throws outside a request scope, the catch eats it, and the form renders.
- The plan said to add mocks. The addendum dropped that without a reason.
- T-UX-6 restating them test-db-free is good. But the CI copies now depend on an environment failure being swallowed.
- **Fix:** add the two mocks the plan promised, or write in the addendum that T-OTP-07/08's B6 path is exercised via the no-request-scope throw, deliberately.

**N1.** T-UX-1's "released when the action THROWS" row proves nothing about React. It calls `observe(false)` by hand after a rejection. Rename it to what it tests ("observer releases on true→false regardless of cause"); the React half belongs to B1's preview rows.

**N2.** The plan header still reads "plan only; no code, no branch, no commits" and "proposed, NOT approved." The §10 addendum supersedes this correctly by date, but add a one-line pointer at the top so a reader of line 1 is not misled.

**N3.** The build log's "FINAL STATE" pins `f2a067c`, and its `--name-only` list omits the build log itself. Add a dated line: "PR head 7178632 = f2a067c + docs only", with the `git diff --stat f2a067c 7178632` output.

---

**Credit**

- B6 keeps `redirect()` outside the try (`page.tsx:180`), and control C4b proves the swallow bug is real by turning the dashboard row red. That is the right way to kill a v1 error.
- Name-based sha256 extraction of the nine pre-LoginPage blocks, identical on both sides, is a better proof than the line-range hash it replaced. The plan says honestly that it proves text, not behaviour.
- `haveCodeUrl` trims and uses `encodeURIComponent`, and the comment names the `+`→space failure. T-UX-3's URL-builder row pins it.
- `copy.ts` has zero removed lines and is printed raw.
- `createPendingObserver` ignores false→false. This prevents the latch releasing before the action has started, and T-UX-1 row 4 pins it.

---

**Verdict: STOP. One round short.**

To clear:

1. **B1:** the §7 preview run plus new rows (a)–(d), recorded raw in the build log against the head SHA. This includes the inbox count and the latch-release-after-error-redirect result.
2. **B2:** no-tenant sessions must keep reaching the form (or get a sign-out), with a T-UX-4 row and control, plus the production count of `tenant_id IS NULL` auth users.
3. **S1–S4:** each fixed, or recorded in a dated addendum with the stated residual before merge.

The next artifact is the updated build log at the new head, including every item above. Do not merge until it exists: merging to main deploys to production.
