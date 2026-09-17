# Environment Variables & Tech Stack — Decision History

This file holds history moved verbatim out of CLAUDE.md during the
2026-09-17 CLAUDE.md/build-status.md size split (docs/split-claude-md-build-status).
Each entry below is the exact original text of a rule's evidence/incident
paragraph(s), moved byte-for-byte, never reworded. The still-active rule
statement each entry supports remains in CLAUDE.md §0 (or the section noted),
with a one-line pointer back to this file at the point of removal.

---

## Resend decision rationale and history (2026-09-03)

DATED NOTE (2026-09-03) — RESEND IS NOW DECIDED, NOT INHERITED, STATED
  PLAINLY. It has named Resend since the very first commit to touch this
  file (`c9fbc85`, 2026-06-28, day one — a 687-line bulk paste, no
  rationale given). The one round that ever engaged with the email channel
  (`61a7974`, "#67 revision 3 — owner receives DPR by email, not
  WhatsApp," 2026-08-15) explicitly declined to re-litigate the provider —
  its own words: "Resend, per the stack doc's own existing naming — not
  re-litigated here, just noted as already the project's stated intent,
  not a new choice." Honest, but it meant no comparison against an
  alternative (SES, SendGrid, Postmark) ever actually happened, at any
  point in this project's history, until now.
  DECIDED, 2026-09-03, on these grounds: `lib/email/send.ts` (PR #159) is
  already a raw `fetch`, no SDK — the entire provider-specific surface is
  one URL, one Bearer auth header, one JSON payload shape, one response
  shape, roughly 50 lines total. A swap to any other bearer-token JSON
  provider would stay a same-size diff, so the switching cost this
  decision forecloses is genuinely small, not a lock-in. Checked against
  Resend's own current docs (not memory): a new account can send TODAY,
  with zero DNS/domain-verification lead time, from the shared
  `onboarding@resend.dev` test domain. Revisiting the provider choice now
  costs more (an unforced comparison exercise) than it saves (a marginal
  chance a different bearer-token JSON provider would have been slightly
  better). Account created under `ar.rcpl@gmail.com`; `RESEND_API_KEY` and
  `RESEND_FROM_EMAIL=onboarding@resend.dev` added to Vercel Production as
  Secret type, same session.

## Env var incidents — CRON_SECRET, Vercel Preview gap, Supabase Auth Site URL gap (all resolved)

CRON_SECRET — ADDED 2026-08-12, MANUAL STEP STILL OUTSTANDING (this
environment has no Vercel dashboard/authenticated-CLI access to complete
it; `vercel env ls` requires a login this session cannot provide). Both
`/api/jobs/tick` and `/api/cron/dpr-generate` now check
`Authorization: Bearer <CRON_SECRET>` on every request and fail closed
(401) if `CRON_SECRET` is unset — see lib/cron/auth.ts for the incident
this closes (jobs/tick previously had NO auth at all, live in
production) and lib/cron/auth.ts's own header comment for the exact
mechanism, verified directly against Vercel's current "Securing cron
jobs" docs, not assumed from training. TO FINISH THIS: (1) generate a
random string of at least 16 characters (a password generator is fine —
this is Vercel's own recommendation); (2) add it to `.env.local` as
`CRON_SECRET=<value>` for local testing; (3) add the SAME value to the
Vercel project's Environment Variables (Production AND Preview) via the
dashboard or an authenticated `vercel env add CRON_SECRET` — Vercel
automatically attaches it as the `Authorization` header on every
cron-triggered request once it's set there, no other configuration
needed. ~~Until step 3 is done, BOTH routes will 401 every real cron
invocation in production, not just unauthorized requests — this is a
deliberate fail-closed default, not a bug, but it means these routes
will not actually run until the secret is provisioned.~~

RESOLVED (observed 2026-08-12, ~22:15 IST, not asserted from a dashboard
check — §0's observation rule). Step 3 has been done: `CRON_SECRET` is
provisioned in Vercel Production and a deploy has happened since PR #55
merged (2026-08-11). Evidence: `public.dprs` — confirmed EMPTY at 13:44 IST
today (see §10's `DATED UPDATE` under the JOBS TABLE HAS NO CLAIMED-AT
entry) — had exactly one new row by 22:15 IST, for `log_date = 2026-08-12`,
with `delivery_status = 'skipped_no_data'`. That value has exactly ONE
writer in this codebase (grepped, confirmed, not assumed):
`runDprGenerateTrigger` in `app/api/cron/dpr-generate/route.ts` (line ~70),
the 8:00 PM cron route's own DPR-17 zero-data check — it is written
directly by the TRIGGER route, before any job is enqueued, never by
`handleDprGenerateJob` (the job handler) or `scripts/generate-one-dpr.ts`
(neither writes it — grepped, zero hits in either file). Reaching that
write path requires `isCronRequestAuthorized` to have passed first (route.ts
line 106) — the exact check this CRON_SECRET section describes — so this
row could not exist unless the secret check succeeded. Distinguished from
stale/leftover test data deliberately, not assumed: the row's `project_id`
matches a project used in earlier manual smoke-testing, which could look
like a false signal on its face, but `log_date = 2026-08-12` (today, not an
old test date) plus the single-writer trace above rules out any other
origin — a leftover test row could not carry today's date with this exact
value written by this exact code path.

**INFERENCE TRAP, recorded for the next reader**: on the zero-data path, an
ABSENT `dpr_generate` job in `public.jobs` is the SUCCESS signal, not a
failure signal — the whole point of the DPR-17 check running before
enqueueing (see the route's own header comment) is that nothing gets queued
for a project with no data that day. Checking `jobs` alone and seeing zero
rows is not evidence the cron never ran; check `dprs` for a
`skipped_no_data` row (or a real `generated_at`) first. This mistake was
made once already this session — recorded here so it isn't made again.

~~KNOWN VERCEL CONFIG GAP (2026-07-21, non-urgent, track + fix separately): the
Preview-scoped NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (and related
Supabase vars) are pinned to ONE branch — feat/migration-007-auth-surgery (a
leftover from that migration's review) — instead of "All Preview branches." So
every OTHER branch's preview deploy gets NO Supabase config, and proxy.ts's
middleware (createServerClient + getUser on every request) throws → "Internal
Server Error" on EVERY route of that preview, even though the build is green.
This bit the feat/bot-27-reactivation-clear preview and is easy to misread as a
code bug. FIX: in Vercel → Project → Settings → Environment Variables, re-scope
those Preview vars to "All Preview branches." (Build-time is unaffected — these
vars are only read at request time.)~~

RESOLVED (2026-07-24): confirmed in Vercel → Settings → Environment Variables
that NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (Preview) are both
scoped to "All Preview Branches," not a single branch. Gap was apparently
fixed same-day as discovery (2026-07-21) but never marked resolved here.

KNOWN SUPABASE AUTH CONFIG GAP (2026-07-25): magic-link signup emails baked a
redirect_to pointing at the DEAD feat/migration-007-auth-surgery branch preview
URL (quoco-git-feat-migration-007-auth-surgery-quoco.vercel.app → 404). NOT a
code bug — login/page.tsx + auth/callback/route.ts derive the domain dynamically
from request headers (origin/host) and are correct. The dead URL comes from
Supabase Auth's dashboard SITE URL, still pinned to that 007 branch: Supabase
falls back to the Site URL whenever the code-supplied emailRedirectTo is NOT in
the Redirect URLs allowlist, and branch-preview URLs weren't allowlisted — so
every preview's magic link fell back to the stale Site URL. FIX (Supabase
Dashboard → Authentication → URL Configuration): Site URL → the real prod domain
(https://quoco-six.vercel.app — confirm this is the canonical/custom domain);
Redirect URLs → add https://quoco-six.vercel.app/** AND a preview wildcard
https://quoco-git-*-quoco.vercel.app/** (+ http://localhost:3000/** for local) so
each preview's dynamic emailRedirectTo is honored instead of falling back. VERIFY
BY OBSERVATION (§0), not dashboard-said-so: request a magic link from a preview
and confirm the email's redirect_to is that preview, not the Site URL.
RESOLVED (observed 2026-07-25): after the Site URL fix, the magic-link redirect
from the test-db signup landed correctly (no 404) — the same signup that produced
the 020 review package's §6 evidence. Observed on test-db; the PROD-side
confirmation rides with the real prod magic-link signup on the 020 runsheet
(020-review-package.md §7 item 5).

SAME DEAD BRANCH, BITTEN TWICE: feat/migration-007-auth-surgery has now been the
stale pin behind TWO real bugs this session — the Vercel Preview Supabase env
vars (note above) and this Auth Site URL — both leftovers from that migration's
review era. Assume more may be lurking: grep every prod config surface (Vercel
env scopes, Supabase Auth URLs, any dashboard setting or hardcoded string) for
that branch name and purge it wholesale, rather than fixing one surface at a time
as each bug surfaces.

SWEEP COMPLETE (2026-07-25): a full Vercel + Supabase dashboard sweep for that
branch name was done and is CLEAN — no additional stale references beyond the two
above. Checked: Vercel Environment Variables (all envs), Deployment Protection,
Domains; Supabase (BOTH main AND test-db) Auth email templates (Magic Link uses
{{ .ConfirmationURL }}, no hardcoded URLs), Database Webhooks (none configured),
Edge Functions (none deployed — empty "deploy your first function" screen). Repo
code/config is also grep-clean. So the pattern is closed at two instances; the
standing rule above still holds if a THIRD surface ever appears.

