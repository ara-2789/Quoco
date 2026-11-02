# LOGIN OTP FIX — PLAN v2 (plan only; no code, no branch, no commits). Tier FULL (auth page). External code review of the PR only (per Aravind, 2 Nov).
Base: origin/main = 408a35c042444816cf10733ea66811876da2efbd (re-checked 2 Nov: unchanged; `git log 408a35c..origin/main` empty; worktree clean). Claims are READ from `git show origin/main:<path>` unless marked. Evidence: /tmp/quoco/login-otp-evidence.txt
Supersedes v1. v1 map of the code (v1 section 1) still stands; line numbers below are origin/main's `app/(auth)/login/page.tsx` unless stated.

## 1. RULE MAP (v1 -> v2)
| v1 item | v2 |
| s1 code map | KEPT as is |
| B1 latch + disabled button | KEPT (s3) |
| B1 fix (ii): rate-limit remaps to code step + `notices.recentSend` + "sent a moment ago" string | DROPPED (Aravind). Rate-limit keeps today's `RESEND_RATE_LIMITED` error on the email step; recovery = have-code button below it |
| B2 | REDUCED: only fewer sends (B1 + B4). Optional resend warning + `codeStep.resendWarning` DROPPED |
| B3 busy state | KEPT, narrowed (s4) |
| B4 have-code GET button | KEPT, plus must render below the rate-limit error (s3) |
| B5 return path, v1 s3 (algorithm), `return-path.ts`, `next` hidden fields, tests 5/6/8 | DROPPED. Own PR, design review, after U7 |
| B6 signed-in redirect | KEPT, CORRECTED (redirect() outside try; no `next`; s3) |
| D1 (move send actions) | MOOT: actions stay byte-identical in place |
| D2 (P1/P2 proxy/layout change) | REJECTED. proxy.ts and dashboard layout untouched |
| D3 (carry `next` in verify error branch) | MOOT |
| v1 strings table (6 rows) | CUT to 3 (s5) |
| v1 test 1 (latch) | KEPT (s6 test 1) |
| v1 test 2 (busy) | UPDATED: verify label unchanged, have-code disabled (s6 test 2) |
| v1 test 3 (rate-limit lands on code step) | REPLACED (s6 test 3) |
| v1 test 4 (have-code sends nothing) | UPDATED: control is a mutation, since requestCode is not callable (s6 test 4) |
| v1 tests 5, 6, 8 | DROPPED with B5 |
| v1 test 7 (signed-in) | UPDATED + redirect-in-try control (s6 test 6) |
| v1 test 9 (verify untouched) | KEPT, redefined as name-based hashes (s2) |
| v1 U1 | RESOLVED-BY-DESIGN (s9) |

## 2. FILES CHANGED / BYTE-UNCHANGED, AND HOW EACH IS PROVEN AT BUILD
Changed (and only these):
- `app/(auth)/login/page.tsx`: LoginPage render section (lines 152-265) + the B6 check at its top + ONE added import line for the new client components (inserted after line 5). `createClient` (:3), `profileForAuthId` (:4), `redirect` (:2) are already imported — no other import edits.
- NEW `app/(auth)/login/pending-controls.tsx` (`'use client'`): `LatchedForm`, `SubmitButton`, `HaveCodeButton`, plus presentational `*View` components for tests.
- NEW `lib/auth/submit-latch.ts` (pure, `createSubmitLatch()`).
- `lib/auth/copy.ts`: ADD-ONLY (3 constants, s5). Existing lines byte-identical (diff shows only `+` lines).
- Tests: NEW `test/login-ui.test.tsx` (test-db-free), NEW `test/submit-latch.test.ts`; EDIT `test/login-otp.test.ts` only to add mocks for T-OTP-07/08 (see s6).
Byte-unchanged (explicit): `proxy.ts`, `app/(auth)/auth/callback/route.ts`, `app/(auth)/layout.tsx`, `app/(dashboard)/layout.tsx`, `lib/auth/profile.ts`, `lib/auth/profile-query.ts`, `lib/supabase/*`, everything under `app/(dashboard)/` and `app/(onboarding)/`.
Proofs, all printed with `git rev-parse HEAD` + `git status --porcelain` (empty) at PR head:
a. `git diff --stat origin/main -- <every byte-unchanged path>` = empty; `git diff --name-only origin/main` equals exactly the changed list above, nothing else.
b. page.tsx pre-LoginPage code: line numbers WILL shift by the added import line, so a bare `lines 1-150` hash is not used. Instead extract by name from both sides (`ERROR_MESSAGES`, `errorMessageFor`, `HTML5_EMAIL_RE`, `isValidEmail`, `requestErrorKey`, `verifyErrorKey`, `requestCode`, `resendCode`, `verifyCode`) and compare sha256 per block: all identical. Also print `diff` of origin/main vs head restricted to lines 1-150 of the base: the only hunk is the one `+import` line.
c. copy.ts diff has zero `-` lines.
Limit stated: this proves the text is unchanged, not that behaviour is unchanged by a new caller; behaviour of the three actions is unchanged because nothing in them or their imports changes.

## 3. FIXES IN SCOPE (root cause READ -> fix)
B1 Double tap. Cause: `<form action={requestCode}>` (:241) + plain button (:256-261); no pending state, two POSTs; 2nd hits the per-address cooldown -> `requestErrorKey` `over_email_send_rate_limit` -> `RESEND_RATE_LIMITED` (:54-55) -> `redirect('/login?error=...')` (:96) = email step + error though a code was sent. Fix: `LatchedForm` wraps each of the 3 forms: `<form action={serverAction} onSubmit=...>` keeps the server action directly as `action` (no-JS still works). `onSubmit` calls `latch.tryEnter()`; false -> `event.preventDefault()`. Released by an inner watcher: `useFormStatus().pending` true->false (`useEffect`). Submits whose `nativeEvent.submitter` carries `data-skip-latch` (the have-code button) bypass the latch. Residual: a double tap that still gets through yields today's error + have-code button (B4), not a dead end.
B3 Busy. See s4.
B4 Have-code. On the email step, inside the SAME form as "Send code", AFTER it in DOM order: `<button type="submit" formMethod="get" formAction="/login" name="step" value="code" data-skip-latch>` labelled `emailStep.haveCodeLabel`. Submits the typed email as GET `/login?step=code&email=..`: no server action, no send. Existing guard :171 re-validates the email and bounces bad ones to `/login`. Enter in the field triggers the first button (Send), as before. Position: the form is rendered below the error block (:235-240), so the button is below the `RESEND_RATE_LIMITED` message. Disabled while a send is pending: `HaveCodeButton` is a client component INSIDE the requestCode form and reads `useFormStatus().pending` (that hook reflects the enclosing form's action submission); `disabled={pending}`. Clicking it is a GET navigation, not an action, so it never sets pending itself. Same email-in-URL behaviour as today (:98).
B2 Addressed only by sending less (B1 + B4). No change to what any send does.
B6 Signed-in user on /login. In `LoginPage`, before any render branch:
```
let target: string | null = null
try {                                   // ONLY the lookups are inside try
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (user) { const p = await profileForAuthId(supabase, user.id); target = p.tenant_id ? '/dashboard' : '/onboarding' }
} catch { target = null }               // lookup failed -> fall through to the form
if (target) redirect(target)            // OUTSIDE any try: redirect() throws NEXT_REDIRECT
```
v1 wrapped the redirect in the try; that swallows the throw and the signed-in user still sees the form. Not repeated. The check is in page.tsx, not proxy (untouched). Applies to every step (email, code). No `next`; target is only `/dashboard` or `/onboarding` (same two targets as :149).

## 4. BUSY STATES
- "Send code" (`emailStep.submitLabel`): while pending -> disabled + `emailStep.submitBusyLabel`.
- "Send a new code" (`codeStep.resendLabel`): while pending -> disabled + `codeStep.resendBusyLabel`.
- "Sign in" (`codeStep.submitLabel`): while pending -> disabled, label UNCHANGED. No new string.
- Have-code button: disabled while the requestCode form is pending (B4). The resend/verify forms have no have-code button; they are separate forms.
Pending ends when the action settles (redirect or return). `SubmitButton` = thin `useFormStatus` wrapper over `SubmitButtonView({pending,label,busyLabel?})`.

## 5. STRINGS (proposed, NOT approved; each carries `// Tamil owed, NOT approved`; added to `lib/auth/copy.ts`)
`emailStep.haveCodeLabel` = "Already have a code? Enter it here" · `emailStep.submitBusyLabel` = "Sending code…" · `codeStep.resendBusyLabel` = "Sending code…"
No other user-facing text. `test/auth-copy.test.ts` iterates all exports, so the 3 new constants are covered automatically (must be non-empty strings). Nothing else seems to need text; if the build finds otherwise it STOPS and lists it.

## 6. TESTS, each shown RED first. Every control run prints `git rev-parse HEAD` + sha256 of the mutated/neutralised file and must go red AT the named row.
Env: node only, no jsdom (U4). UI tests use `renderToStaticMarkup` + `vi.mock('@/lib/supabase/server')`, `@/lib/auth/profile`; redirect() throws, assert `err.digest` matches `/^NEXT_REDIRECT;[a-z]+;<target>;/`.
1. Latch (`submit-latch.test.ts`): 2nd `tryEnter` while held = false; released after settle and after a thrown error. Control: always-true latch -> red.
2. Busy (`login-ui.test.tsx`): `SubmitButtonView pending` -> HTML has `disabled` and the busy label for Send code and for resend; verify view pending -> `disabled`, label still "Sign in"; `HaveCodeButtonView pending` -> `disabled`. pending=false -> none. Control: view ignores `pending` -> red on each row. Gap: hook-to-view wiring and the latch-release effect are NOT unit-testable here (U4/U6) -> manual s7.
3. REPLACES v1 test 3. (a) `LoginPage({error:'RESEND_RATE_LIMITED'})` HTML contains `errors.resendRateLimited` AND the have-code button, with the button index AFTER the error text. Control: neutralise the button -> red. (b) "requestCode with over_email_send_rate_limit still redirects to /login?error=RESEND_RATE_LIMITED" CANNOT be a call-the-action test: `requestCode` is a non-exported inline action in a page module and the decision forbids moving it. Its non-change is proven by s2b (sha256 of `requestCode` + `requestErrorKey` identical), and the mapping was READ (:54-55, :96). Stated openly as a proof-by-hash, not a behavioural test.
4. Have-code sends nothing: email-step HTML has the second button with `formmethod="get" formaction="/login" name="step" value="code"`, after the Send button, inside the same form; rendering email step and `{step:'code',email}` leaves a mocked `signInWithOtp` at 0 calls. Control (requestCode is not callable): temporary mutation of LoginPage to call `signInWithOtp` during render -> count 1 -> red.
5. (v1 5/6/8 dropped with B5.)
6. B6 / v1 test 7: user+tenant -> NEXT_REDIRECT `/dashboard`; user, no tenant -> `/onboarding`; no user -> form renders; `getUser` throws -> form; `profileForAuthId` throws -> form (lockout guard). Controls: (A) origin/main's LoginPage with a signed-in mock renders the form = red; (B) mutation wrapping `redirect()` inside the try -> the user+tenant row goes red (renders form, no NEXT_REDIRECT).
7. Verify untouched: s2 proofs (a)-(c), build-time, printed raw.
Family run before claiming green: `test/login-otp*.test.*`, `test/auth-copy.test.ts`, new files, JSON reporter (CLAUDE.md s7 missing-line note). T-OTP-07/08 re-run green with the added mocks.
TEST-DB: `test/login-otp.test.ts` hits test-db: T-OTP-01/01b/02/03/04 call Supabase Auth directly, T-OTP-04 sends ONE real email (to Aravind's address); and its describe-level `beforeAll` (:141) creates a test-db user, so even running only T-OTP-07/08 from that file touches test-db. Test-db belongs to the backend now: the file is run only after the backend says it is free. Test-db-free: `submit-latch.test.ts`, `login-ui.test.tsx`, `auth-copy.test.ts` (vitest globalSetup `test/setup/guard.ts` reads env vars only, no network, READ; `run-id.ts` not read -> U9). Until the backend frees test-db, T-OTP-07/08 are reported NOT RUN, never green.

## 7. MANUAL PREVIEW CHECKLIST (own address only; screenshot each marked step)
1. Double-tap "Send code" fast (phone and desktop). Expect: button disabled + "Sending code…" at once; ONE email in the inbox; page lands on code step. [screenshot busy state; screenshot landed step; note email count + timestamps]
2. Back, then "Send code" again within 60 s. Expect: email step with the rate-limit error AND the have-code button below it. [screenshot]
3. Type the code from step 1 into the have-code path: click it (email already typed) -> code step -> enter code -> lands on dashboard. Expect no new email sent. [screenshot code step; inbox count unchanged]
4. While a send is pending (throttle network), the have-code button is disabled. [screenshot]
5. "Send a new code" shows "Sending code…" and disables. "Sign in" disables on submit, label unchanged.
6. Signed in, open /login -> lands on Today (`/dashboard`); also /login?step=code&email=x. Signed out, /login shows the form. [screenshot]
7. Verifies the U6 items below (formAction GET vs action; preventDefault; pending across redirect).

## 8. RISKS
R1 Lockout: (a) B6 redirect-swallow bug (v1): redirect() throws NEXT_REDIRECT, a try around it hides it and B6 silently does nothing — fixed by structure + test 6 control B. (b) a session whose profile row is missing: `profileForAuthId` throws -> caught -> form renders, so /login always remains usable. (c) loop /login <-> a page bouncing to /login: every bounce site is `if (!user)` on `getUser()` (READ: dashboard layout :77, dprs/[id]:68, projects/[id]:48, onboarding:24, getProfile:26), same function B6 uses, so none fires for a user B6 redirects. (d) a stuck latch (action never settles) keeps one form dead until reload; other forms and the have-code GET stay usable.
R4 Valid code unusable: with the remap dropped, a rate-limited PM sees "Wait a minute before asking again" and may not notice the have-code button below it; copy for the error is unchanged by decision. Latch must release on error (test 1). Typo'd email on have-code -> normal wrong-code message; nothing sent, nothing invalidated.
R5 Framework behaviour assumed, not verified: (i) a submitter with a STRING `formAction` + `formMethod=get` inside a form whose `action` is a server action submits natively (does not invoke the action); (ii) `preventDefault` in `onSubmit` suppresses the action; (iii) Next runs queued server actions one after another, so `disabled` alone may not stop a second queued tap — hence the latch. All three = U6, checked on the preview (s7). If (i) fails the have-code button would send a code (bad): s7 step 3 counts emails for exactly this.
R6 Hidden-field/URL: email stays in the URL as today; nothing new carried.
R7 Scope: the file-list proof in s2a is the control; any need for an edit outside the changed list STOPS the build.

## 9. UNKNOWNS (owner)
U1 RESOLVED-BY-DESIGN: no remap, so the page never claims "a code was sent"; per-address cooldown and project-wide cap both show today's error + have-code button. No wording depends on which limit fired.
U2 Whether a new send invalidates the previous code (from Aravind's Supabase log only). Owner: deferred / build-time test-db probe once the backend frees test-db. The PR text must not assert it.
U3 Dashboard email template flipped to `{{ .Token }}`? Owner: Aravind (dashboard). Not blocking; matters for the deferred B5 PR (magic links bypass any return path).
U4 No jsdom/@testing-library; hook wiring untestable in unit tests. Owner: build-time -> manual checklist s7.
U5 Cross-tenant destination behaviour of a return path. Owner: deferred (B5 PR).
U6 React 19.2.4 / Next 16.2.11: R5 (i)-(iii), plus `useFormStatus` pending across `redirect()`. Owner: build-time, on the preview.
U7 Where PM notification deep links point (`lib/hindrance/pm-notify.ts` unread). Owner: deferred (gates the B5 PR).
U8 When test-db is free for UI-side runs of `test/login-otp.test.ts`. Owner: Aravind / backend.
U9 `test/setup/run-id.ts` globalSetup not read; assumed env-only like guard.ts. Owner: build-time (read before first run).
