# PR #350 — manual browser run (per Aravind, 2 Nov 2026)
Environment: local production build (`npm run build && npm start`) on Aravind's Mac against PROD Supabase (.env.local). Preview deployments were not usable: their Supabase URL points to an unknown project (UNKNOWN_EMAIL for both a prod and a test-db account). Chrome Incognito. Real emails to Aravind's inbox. Results are per Aravind (reported in chat with screenshots), not observed by Claude.

## Run 1 — head ba3dd3d (12:40 IST)
- Row 1, double tap Send code: one email (N+1), landed on the code step. PASS.
- Row 6 (S2), Sign in then Send a new code inside the pending window: no extra email. PASS.
- Row 2, Back + Send within 60 s: rate-limit error shown, have-code button shown and enabled. PASS. Email field EMPTY -> have-code showed "Please fill in this field." FAIL -> fixed in a5f2b0f (plan §14).

## Run 2 — head a5f2b0f (by 12:56 IST)
- Row 2 re-run: rate-limit error shown with the typed email kept in the field (screenshot: /login?error=RESEND_RATE_LIMITED, field "ar.rcpl@gmail.com"); have-code -> code step; sign-in completed. PASS.
- Rows 2b, 3 (wrong code then correct code -> Today), 4 (signed in, open /login -> Today), 5 (after 60 s, Send code -> exactly one new email), 7 (throttled double tap -> one email): reported "all passed" by Aravind. Which of these ran at ba3dd3d vs a5f2b0f was not separated.

## Earlier crash (found by this run)
- At b1ed980 every GET /login crashed (loginFormKey called from the server on a client module). Fixed in ba3dd3d; smoke gate added (plan §13).

## Owed
- S1 residual: /login DOMContentLoaded and Load times on a throttled 3G profile — not yet supplied.

## Observation (not a PR #350 defect)
- Sign-in -> Today felt slow on the local build. The local server runs in Chennai; the database is in Sydney, so every query crosses that distance. Prod functions run in syd1 since 2 Nov. To be measured on prod after merge.

## Run 3 — head 15e83ea (13:10–13:19 IST, per Aravind)
- S1 residual: /login with DevTools throttle 3G: DOMContentLoaded 2.12 s, Load 2.12 s, Finish 5.69 s, 20 requests, 31.5 kB transferred. Scripts served from disk cache, so a first-ever visit is slower than this.
- Row 6 (S2) at 15e83ea, first attempt: no new email, but the final URL ended error=RESEND_RATE_LIMITED, i.e. the resend action ran and was stopped only by Supabase's 60 s cooldown. Inconclusive.
- Row 6 (S2) retest: 70 s after the last send, throttle 3G, 000000 + Sign in, then Send a new code within 1 s. Network: two server-action POSTs (303, 2.10 s from step=code; 303, 3.05 s from step=code&error=WRONG_CODE). Final URL without error = resend succeeded. FAIL. The earlier row 6 PASS at ba3dd3d is withdrawn (masked by the cooldown).
- Fix: verify and resend in one form with one latch (plan §15). Retest pending.

## Run 4 — head ae95bbf (13:59 IST, per Aravind)
- S2 retest with a nonexistent address (no email, no cooldown): /login?step=code&email=s2probe%40example.com, DevTools throttle 3G, 000000 + Sign in, then Send a new code within 1 s.
- Network (filter "login"): document 200; then TWO server-action fetches, 303 (2.10 s) and 303 (2.09 s). Final URL: /login?step=code&email=s2probe%40example.com&error=UNKNOWN_EMAIL = resendCode ran. FAIL.
- The one-form design (plan §15) did not stop the second action. Root cause unknown (code reading in docs/reviews/login-otp-ux-s2fix-log.txt found none).
- Evidence the email-step guard works: Run 1 row 1 (double tap Send code) ended on the code step; a second action would have redirected to /login?error=RESEND_RATE_LIMITED.

## Run 5 — head d484fb935b738125a6aa3e03e5c37cbc9c7d73bc (per Aravind, 2 Nov 2026, 22:30–22:37 IST)
Local production build via scripts/login-manual-check.sh against prod Supabase. .next/BUILD_ID = nzjMEyP6Z_hPoIai6w6OW; served page BUILD_ID MATCH (script output pasted in chat).
All PASS, per Aravind (no screenshots):
1. Double tap Send code -> one email, code screen.
2. Wrong code 000000 -> wrong-code message; correct code -> Today.
3. Sign out -> /login email field empty (N1).
4. Rate limit -> email kept -> have-code -> code screen -> sign in -> Today.
5. Send a new code with empty code field -> exactly one email.
Not captured: the have-code URL (review round 2 N3).
Review condition 2 (S2 probe with logger): not run; moved to the S2 follow-up (owner Aravind, by 9 Nov 2026, plan §17).
Also posted as a comment on PR #350.
