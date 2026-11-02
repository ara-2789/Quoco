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
