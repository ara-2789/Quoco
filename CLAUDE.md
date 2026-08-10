# QUOCO — Claude Code Instructions
# Read this file at the start of every session before writing any code.
# Last updated: 7 August 2026 — v2.1 (P1 correction pass, process-hardening
# work order — factual corrections only; restructuring is P3, deliberately
# separate)

# This is the CORE file. Detailed reference lives in two linked files —
# read them WHEN the task touches them, not every session:
#   - docs/schema.md     → full database schema, migration order
#   - docs/bot-flows.md  → full WhatsApp flow specs, DPR generation, templates
#   - docs/design-principles.md → UX rules, persona rules, copy tone, visual system
#     Read this when a task touches any user-facing surface: WhatsApp bot
#     copy/flow structure, PM dashboard, or DPR/owner content.
# When a task touches the schema or a bot flow, open the relevant doc first.

---

## 0. HOW WE WORK (read every time)

- ONE feature per session. Never build multiple features in one prompt.
- PLAN FIRST: before writing code, list the files you will touch and the
  approach. Wait for my confirmation before writing.
- Use /clear between every task to keep context clean.
- Commit after every working, tested feature before starting the next.
- If you give me code I do not fully understand, explain it until I do
  before I accept it. I am solo and the only person who will ever debug this.
- If anything I ask CONFLICTS with a rule in this file or the docs, STOP and
  flag the conflict. Do not silently resolve it or pick one side.
- If a fact you need (a model name, a library version, an API shape) might
  have changed since your training, SAY SO and ask me to verify rather than
  guessing. Wrong version strings and API shapes are silent runtime failures.
- ROLLBACK MECHANISMS ARE VERIFIED BY OBSERVATION, NEVER BY CHECKLIST STATUS.
  Before any migration that depends on a backup, PITR, or restore path,
  verify the mechanism exists by directly observing it (dashboard state,
  restore-point UI, or an actual test restore) — never by trusting a "DONE"
  in a checklist. Origin: the 007 apply (2026-07-10), where "PITR provisioned
  — DONE" had been false for weeks and was caught only by direct dashboard
  inspection on apply day. A record of a thing is not the thing.
- ARTIFACT PROVENANCE IS PINNED, NOT PARAPHRASED (standing rule since 2026-07-13,
  per the 016 sign-off round). From migration 017 onward, every reviewer-package
  artifact is pinned to the exact source, never retyped or summarised:
    * file contents via `git show <sha>:path` (the SHA is what gets pasted to
      prod — the terminal frame, commands visible, goes into the PR record);
    * probe captures with the query text visible above its result;
    * suite output with the commit SHA echoed at the top of the run — AND, since
      the 017 round (2026-07-16, reviewer round 2), an empty `git status --porcelain`
      line captured alongside that SHA. Rationale: the SHA alone names the commit but
      not the working tree; a dirty tree can run code that differs from the named SHA.
      SHA echo + empty `--porcelain` together prove the run used exactly the committed
      artifacts. Both lines are part of every future suite capture, not just this one.
  Rationale: paraphrase drifts and GitHub can serve a stale branch cache to the
  reviewer; a pinned `git show`/probe frame is verifiable and cache-proof. The
  canonical apply skeleton lives in docs/migration-runbook-template.md.
- REHEARSE ON A CLEANED EXISTING BRANCH, NOT A FRESH PROVISION — CONDITIONAL RULE
  (2026-07-26, from the 019 round-2 rehearsal; PR #17). A freshly-provisioned
  Supabase branch is NOT a faithful prod clone: its schema is built by REPLAYING the
  migration files linearly from scratch, which (a) omits prod's out-of-band objects
  (see the OUT-OF-BAND DB OBJECTS registry in §10), and (b) was observed to come up
  MISSING `users.auth_id` — two independent fresh branches both lacked the column even
  though `schema_migrations` recorded 007 (which adds it, 007:55-57) as applied.
  MECHANISM UNCONFIRMED — do not assert one: an earlier
  note guessed "`IF NOT EXISTS` degrades to a NOTICE," which is WRONG (`IF NOT EXISTS`
  only skips when the column already exists, so it can't explain a genuinely-absent
  column) and has been retracted. What IS established: standard linear `psql` replay
  DOES add the column (not a 007 logic bug), and it involves a cross-schema FK into
  `auth.users`; the real failure mode is an open question filed with Supabase
  (docs/reviews/supabase-fresh-branch-auth-id-bug.md). Prod never hit it because 007
  was applied out-of-order (after 011-014) via the SQL editor, not a clean linear
  replay. Evidence pinned in
  docs/reviews/019-review-package.md Appendix B2. UNTIL this fresh-branch behaviour is
  re-tested and confirmed FIXED, rehearse migrations by TEARING DOWN and reusing the
  schema-complete test-db, never on a fresh branch. This rule LAPSES once a fresh
  provision is observed to come up WITH `users.auth_id` present — it is a work-around
  for a live defect, not a permanent preference.
- SUPERSEDING PR CARRIES THE REVIEWER-ITEMS LIST FORWARD, ITEM-BY-ITEM (standing rule
  since 2026-07-26; origin: the 019 round-1→round-3 near-miss where eight
  reviewer-required revisions were briefly treated as non-existent because they lived
  only in the prior review, not the new PR). When a PR supersedes another (a fresh
  branch replacing a stale draft, a re-cut PR, a v2), the OPEN reviewer-items from the
  superseded PR do NOT get a clean slate: migrate them into the new PR's body as an
  EXPLICIT per-item checklist, each marked LANDED (with where it was folded) or
  DEFERRED (with why + where tracked). A superseding PR that silently drops the prior
  review's open items is not allowed — the checklist is the mechanism that makes a
  dropped item impossible to miss. Applies to the review package too: it must state
  which round was reviewed-WITH-CHANGES vs. approved, so "byte-identical to the
  reviewed file" can never be misread as "approved."
- REVIEW REQUESTS AT THIS TIER OPEN WITH A REPO-STATE HEADER (standing rule
  since 2026-08-07, from PR #22's B1 near-miss). A reviewer's context is a
  conversation, not a clone — between rounds the repo moves, and a reviewer
  working from memory or a cached GitHub diff can build an entire blocker on a
  premise that stopped being true days earlier. Origin: B1 flagged
  webhook-wiring PR #22 for a types-regen/merge-ordering hazard that had
  already been resolved and merged via migration 022's own PR; the reviewer
  caught it himself only because a stale GitHub page visibly contradicted
  itself, and explicitly noted his own verification was a weaker evidence
  class than a live catalog probe. From 2026-08-07, every review request at
  019/020/021/022-tier opens with a two-line repo-state header: `main @
  <sha>`; `supabase migration list` local/remote; and the last runbook
  executed, with its date. Costs ten seconds to produce. Converts "reviewer
  assumes state" into "reviewer checks a pinned input" — the header alone
  would have made B1 impossible to write, since it would have shown 022
  already merged and applied before the reviewer needed to derive that from a
  diff.

---

## 1. WHAT IS QUOCO

Multi-tenant SaaS for construction contractors in India. Each subscribing
company is a TENANT.

Two modules — build POST-CONTRACT first:

PRE-CONTRACT (Phase 2 — DO NOT build now): Tender Analyser, BOQ Estimator.

POST-CONTRACT — Phase 1 Spine (build this):
- WhatsApp bot: site engineers submit morning + evening check-ins.
- Claude API generates a Daily Progress Report (DPR) sent to PM + Owner nightly.
- PM web dashboard: projects, daily logs view, DPR archive.

---

## 2. SPINE vs FAST-FOLLOW

Build SPINE first. Fast-Follow ships live to the same betas after Spine launch.
When Claude Code asks what to build, answer from the SPINE list ONLY.

SPINE — build and ship:
- Auth, onboarding, engineer + owner registration
- Morning check-in (6 Q), evening check-in (6 Q)
- DPR generation (6 sections — see docs/bot-flows.md)
- PM dashboard: Daily Logs view, DPR Archive
- Scheduling, cron, jobs queue, RLS, E.164, Sentry, PITR
- Razorpay payment links

FAST-FOLLOW — fully specified, DO NOT build yet:
- Ad-hoc safety / invoice / hindrance flows
- DPR accountability engine (dependency roll-forward, escalation, resolve path)
- DASH-05 invoice queue, DASH-06 safety log, DASH-07 hindrance tracker,
  DASH-10 accountability view
- BOT-30 Q6→hindrance promotion
- resolutions table + source_key

The Fast-Follow TABLES exist in the schema (so migrations are stable), but
their FLOWS and dashboard views are not built in the Spine.

---

## 3. TECH STACK

- Framework: Next.js App Router + TypeScript — App Router conventions only.
  VERIFY the exact Next.js version in package.json; do not assume.
- Database: Supabase (PostgreSQL) — auth, DB, storage, pgvector (enabled, nullable)
- Auth: Supabase Auth — magic link only, no passwords, PKCE via @supabase/ssr
- Storage: Supabase Storage — site photos only in Spine
- AI: Claude API — DPR generation.
  MODEL STRING: verify the current model string against
  platform.claude.com/docs before Week 4 — model IDs change and a wrong
  string is a silent runtime failure. Do not trust a string carried over
  from an earlier session without checking.
- WhatsApp: Twilio WhatsApp Business API — webhook at /api/whatsapp/webhook
- Billing: Razorpay payment links — NOT Stripe (Stripe paused India onboarding)
- Deployment: Vercel Pro — required for 6 IST cron times + 60s function timeout
- Email: Resend — DPR delivery to owner
- Monitoring: Sentry — wire Week 2 Day 1, all environments
- UI: Tailwind CSS + shadcn/ui — VERIFY Tailwind major version in the repo
  DATED NOTE (2026-07-16, per the DASH-03 token proposal): shadcn/ui is NOT yet
  initialized (no components.json). Adopt it when a component needs its
  accessibility primitives (dialogs, dropdowns, comboboxes) — status chips/tokens
  don't require it. Tailwind is v4 (^4.3.1): CSS-first config via @theme in
  app/globals.css, no tailwind.config.js.

---

## 4. MULTI-TENANCY — CRITICAL, NON-NEGOTIABLE

- Every table has a tenant_id UUID column, EXCEPT rate_catalog and
  rate_catalog_history (Quoco-owned, shared across tenants).
- NEVER query the DB without filtering by tenant_id.
- Use tenant_id — NOT organization_id, org_id, or company_id.
- RLS enforced at the DB layer via get_user_tenant_id() (see docs/schema.md).
  Never rely on app-layer filtering alone.
- Use the Supabase SSR client in server components + API routes.
  NEVER the browser client on the server.
- NEVER use the service role key client-side, or in any route reachable
  without authentication.
- All RLS policies verify tenant membership through auth.uid().
- Cross-project scope: DASH views and DPR delivery are scoped to projects
  where the PM has a project_members row — NOT all tenant projects.
  Owner DPR content is strictly single-project scoped.

---

## 5. USER ROLES

Six roles, TEXT on users table:
CHECK (role IN ('pm','qs','engineer','owner','subcontractor','admin'))

- The role was named 'client' in early schema. Canonical name is 'owner'.
  Use 'owner' everywhere. Already true today — the CHECK constraint above
  is live. CORRECTED (2026-08-07, P1 pass): this previously said the rename
  "lands in migration 007." Wrong migration — 007's own header explicitly
  EVICTS it ("client -> owner role rename -> corrections migration") so a
  bug in a rename could never force rollback pressure on 007's irreversible
  auth-identity surgery. The rename actually lands in migration 016
  (016_corrections.sql — the corrections migration 007 evicted it to):
  drops the 001-era CHECK, `UPDATE ... SET role = 'owner' WHERE role =
  'client'`, adds the current CHECK. Applied on both test-db and prod
  (confirmed via `supabase migration list --linked`: 016 present on both
  local and remote). No sequencing risk to carry forward — role='owner' is
  a valid CHECK value now, not a future one.
- admin — tenant creation, invites, billing, settings
- pm    — projects, DPR review, engineer management
- qs    — invoice review, BOQ (Phase 2)
- engineer — WhatsApp bot user only. NO web login. auth_id = null.
- owner    — receives DPR via WhatsApp + email. No web login in Phase 1.
             auth_id = null.
- subcontractor — Phase 2

Engineer and owner rows have auth_id = null. Created by PMs, not via the
email-invite auth flow. Do NOT create auth.users entries for them.

---

## 6. CODING RULES

TypeScript
- Always TypeScript. No `any` under any circumstances.
- Generate DB types from the schema — do not hand-write them.
  DATED NOTE (2026-07-13, per 016 round-3 review) — SUPERSEDED 2026-07-13 by the
  generated-types PR (feat/generated-db-types), see the ACTIVE note below. The
  original note recorded the interim state: the pipeline did NOT yet exist,
  clients were untyped, no `types/database.ts` existed, and adoption was DEFERRED
  to the named milestone (a dedicated PR after 016 merges, before Morning Flow
  Pass 2 merges).
  DATED NOTE — ACTIVE (2026-07-13, feat/generated-db-types PR): the generated-types
  pipeline is now STOOD UP. `types/database.ts` exists, generated via
  `npx supabase gen types typescript --linked --schema public` against prod
  (`jvxwqignooseazzmwhvl`; prod and test-db are schema-identical post-016). The
  three Supabase clients (`client.ts`, `server.ts`, `service.ts`) now carry the
  `<Database>` generic. Call sites are migrated INCREMENTALLY: existing inline
  `.single<{...}>()` generics remain valid and stay until touched — the client
  generic is additive. The standing runbook-template line **"regenerate types
  after every schema migration"** is now ACTIVE (no longer inert): from this PR
  on, every schema migration re-runs the gen command and commits the diff.

Money
- Every amount/rate/cost/value column: DECIMAL(12,2). No exceptions.
- Never TEXT or FLOAT for money. invoices.amount is (12,2), not (10,2).

Status columns
- Always TEXT + CHECK constraint. Never ENUM types.
- Adding a status value later = update the CHECK only.

Database
- Migrations in supabase/migrations/ as numbered files. EVERY numbered file
  currently present in that directory is LIVE — do not edit any of them.
  Author new changes as the next UNUSED number; confirm the true next number
  with `ls supabase/migrations/` and `supabase migration list` (don't trust
  a number carried over from an earlier session — CORRECTED 2026-08-07, P1
  pass: this used to hardcode "001–006 live, new changes go in 007/008/009,"
  which was accurate in July but by design goes stale the moment migrations
  pass 009 — migrations are now through 022, with a gap at 008-010 that were
  never created. A number-listing rule can't go stale the same way; a
  hardcoded range can and did).
- Never edit schema directly in the Supabase dashboard.
- Every table: id UUID PK DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ DEFAULT now().
- Full schema + migration order: docs/schema.md.

API routes
- All /api/ routes require authentication.
- Validate ALL inputs with Zod before processing.
- WhatsApp webhook responds within 15 seconds.
- ALL Claude API calls go through the jobs table — NEVER called synchronously
  in the webhook handler (NFR-16). Queue detail: docs/bot-flows.md.

Webhook specifics (bot-flows.md has the full rules)
- Validate X-Twilio-Signature HMAC on every request; reject non-matching (403).
- Idempotency: dedupe on Twilio message SID. A repeated SID is a no-op —
  no duplicate rows, no duplicate replies.
- Media: download from Twilio, re-upload to Supabase Storage (tenant-scoped),
  store the SUPABASE url. NEVER persist a Twilio media URL — they expire.

Secrets
- NEVER hardcode a secret, key, token, or connection string in source.
- NEVER console.log a key, token, or full auth header — even while debugging.
- NEVER commit .env.local. Secrets come from env vars only (see Section 8).

Errors
- Wrap external calls in try/catch. Return structured errors — never expose
  raw DB errors to the client. Log to Sentry in production.

Session state
- WhatsApp state lives in whatsapp_sessions — NEVER in memory. Serverless
  functions have no persistent memory; all state is in the DB.
- SELECT FOR UPDATE on the session row before any state change.
- TTL + resume rules: docs/bot-flows.md (BOT-07).

---

## 7. TESTING & VERIFICATION — how "done" is defined

A feature is NOT done until it is verified. For a solo build, this section
is the safety net that replaces a second developer. Follow it every task.

Definition of done (per task)
- Code written AND its tests written AND tests green AND committed.
- No `any`, zero TypeScript errors (`tsc --noEmit` clean).

Tests are required, not optional
- State-machine change → ships with its T-SM unit tests.
- Parser change → ships with its T-PR tests.
- Webhook change → ships with the relevant T-WH integration test
  (including the forged-signature rejection, T-WH-01).
- DPR generation → the eval harness (docs/bot-flows.md) is a REQUIRED
  deliverable, not a nice-to-have. Golden-set cases must pass before DPR
  work is considered done.
- RLS change → a cross-tenant AND cross-project isolation test
  (two-tenant fixture; PM sees only their projects; owner DPR single-project).
- State-loss regression (a fix for data silently dropped/overwritten) → assert
  the END STATE of the full realistic sequence, not the mechanism the fix
  targeted. A test asserting the predicted mechanism goes green the moment
  that one fix lands and hides sibling defects upstream of it — origin:
  migration 022's reverse-order test, which drove the full realistic sequence
  (evening completes → morning starts → morning completes) and caught a
  second, unnamed instance of the bug a mechanism-targeted test would have
  missed (docs/reviews/022-review-package.md).

How to verify locally (ask me to run these; show me the command)
- DB change: run migrations against a Supabase BRANCH first, never prod.
  Confirm no errors, then I review before it touches the real database.
- Any change: `tsc --noEmit` clean + `npm test` green for the touched area.
- Bot flow: exercise it end-to-end against the Twilio SANDBOX on a real
  handset before calling it done. (Sandbox cannot send custom templates —
  template + cron tests wait for the production sender.)

If you cannot write a test for something, say so and explain why, so I can
decide whether to accept it. Do not quietly skip the test.

---

## 8. ENVIRONMENT VARIABLES

In .env.local — NEVER commit. NEXT_PUBLIC_ prefix ONLY for browser-safe values.

NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=       ← server-side only, never expose to client
ANTHROPIC_API_KEY=               ← server-side only
TWILIO_ACCOUNT_SID=              ← server-side only
TWILIO_AUTH_TOKEN=               ← server-side only
TWILIO_WHATSAPP_NUMBER=          ← e.g. whatsapp:+14155238886
RESEND_API_KEY=                  ← server-side only
RAZORPAY_KEY_ID=                 ← server-side only
RAZORPAY_KEY_SECRET=             ← server-side only
SENTRY_DSN=
NEXT_PUBLIC_APP_URL=             ← magic link redirect URL

All non-NEXT_PUBLIC_ keys are used ONLY in server-side API routes.

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

---

## 9. FILE STRUCTURE

quoco/
├── CLAUDE.md                       ← this file (core rules)
├── docs/
│   ├── schema.md                   ← full schema + migration order
│   └── bot-flows.md                ← full flows, DPR, templates, queue
├── app/
│   ├── (auth)/login, auth/callback ← done
│   ├── (onboarding)/               ← done
│   ├── (dashboard)/                ← shell, dashboard, projects done;
│   │                                  daily-logs (Wk3), dprs (Wk4)
│   └── api/
│       ├── whatsapp/webhook/       ← Week 2
│       ├── jobs/tick/              ← Week 2 (queue worker)
│       └── cron/{morning,evening,nudges,dpr-generate,owner-deliver}/
├── lib/
│   ├── supabase/{client,server,service} ← done (3 clients — client.ts,
│   │                                        server.ts, service.ts)
│   ├── whatsapp/{session,normalise,flows/{morning,evening}}
│   ├── dpr/{generate,render}       ← Week 4
│   └── queue/jobs                  ← Week 2
├── supabase/migrations/            ← every numbered file present is LIVE;
│                                      confirm the current set with
│                                      `ls supabase/migrations/` (§6)
├── types/database.ts               ← generated DB types, live (§6) —
│                                      regenerated after every schema
│                                      migration, most recently 022's step F
└── proxy.ts                        ← done
# CORRECTED (2026-08-07, P1 pass): this list previously (a) omitted
# service.ts (only client/server were named, contradicting §6's own "three
# Supabase clients"), and (b) carried a STRUCK note claiming types/database.ts
# "NEVER EXISTED" and calling generated types a deferred milestone — both
# stale since the generated-types PR (2026-07-13, same day as that struck
# note) stood the pipeline up; the file has existed and been regenerated on
# every schema migration since. §6 was already correct; this section
# contradicted it. Reconciled to match §6, not restated separately.

---

## 10. CURRENT BUILD STATUS

### [2026-07-24] next 16.2.11 security patch — postcss/sharp overrides
PR #11. next@16.2.11 still hard-pins vulnerable transitives: postcss@8.4.31,
sharp@^0.34.5. Added package.json overrides (postcss ^8.5.15, sharp ^0.35.0)
to force patched versions. Verified: fast-uri (only prod-reachable incidental
bump) confirmed absent from .next/ build output; prod builds on Turbopack so
the @sentry webpack-plugin path never executes.

Re-evaluate/remove these overrides when Next 16.3 goes stable — it's expected
to bundle patched postcss/sharp natively, making the overrides dead weight.

Known gap: sharp override is unverified at runtime — no next/image usage
exists yet, so the image-optimization path is currently inert. Add an
optimized-image smoke test to the Week-3 photos PR before that ships.

Week 1: COMPLETE
- Supabase client (client.ts, server.ts, proxy.ts)
- Magic link auth + PKCE callback working
- Onboarding: complete_onboarding() RPC creates tenant + admin user
- Dashboard shell: sidebar nav, welcome, project list
- Project CRUD: create, list, detail, members
- Migrations 001–005 live. TypeScript zero errors.
- GitHub: github.com/ara-2789/Quoco
- NOTE: sidebar shows Safety/Invoices/Hindrances nav items — those are
  Fast-Follow. Hide or disable them for the Spine so beta PMs don't click
  into empty sections.

Week 2: IN PROGRESS
Day 1 checklist:
1. Vercel Pro provisioned — DONE
2. ~~Supabase Pro + PITR provisioned — DONE~~
   DATED CORRECTION (2026-07-10): this was WRONG. Supabase **Pro** is confirmed,
   but **PITR was never actually enabled** — verified via the dashboard on
   2026-07-10; only nightly scheduled physical backups exist. The false "PITR —
   DONE" here is what the migration 007 rollback plan leaned on. See the dated
   correction under §5(a) of docs/migration-007-checkpoint-1-review.md for the
   consequence (reduced rollback granularity: hours-old snapshot vs near-instant
   PITR) and the decision to proceed on the 2026-07-10 16:34:44 UTC scheduled
   backup. To restore PITR granularity, enable PITR ~~(still not done as of this
   correction)~~.
   DATED UPDATE (2026-07-12): PITR is now ENABLED and observation-verified on
   prod — Database → Backups → Point in time shows an active restore window
   (05 Jul → present) at 2-minute granularity. The reduced-granularity caveat
   above applied to the 007 apply (2026-07-10) only; from 2026-07-12 the
   near-instant PITR rollback path is real and observed, per CLAUDE.md §0.
   FINAL (2026-07-12): enablement date was 2026-07-12 (observed same day). The
   2026-07-10 observation (not enabled) was correct — the restore window's
   retroactive reach to 05 Jul comes from Supabase exposing retained WAL/backup
   history at enablement, not from PITR having existed earlier. Chain closed.
   [Date-corrected: this FINAL entry was first committed (fe3bd85) mislabelled
   2026-07-13; actual date 2026-07-12. Corrected forward here, not by history
   rewrite, since the reviewer may have pulled fe3bd85.]
3. Sentry wired, all environments — DONE (tested end-to-end, error confirmed
   landing in Sentry dashboard)
4. NFR-16 jobs table — DONE (migration 006, live). Queue helper library,
   /api/jobs/tick worker, and Vercel cron config still pending.
5. Twilio production sender application — BLOCKED ~2 weeks on company
   registration. Cannot start until entity paperwork clears.
6. 12 WhatsApp templates submitted to Meta — BLOCKED, same dependency as #5.
7. Persona rename grep pass — DONE. Checked: only real 'client' role
   reference is the CHECK constraint in 001_core_schema.sql (live, do not
   edit directly — fixed via migration 007). All other 'client' hits in the
   codebase are legitimate (Supabase SDK client, or the unrelated
   projects.client_name/client_contact fields for Phase 2's external
   building client concept, which correctly stay as-is).

NOTE: Supabase CLI migration tracking was out of sync — 001-005 were
originally applied via the dashboard SQL editor, so the CLI had no local
record of them. Repaired with `supabase migration repair --status applied`
before pushing 006. Any future first-time `supabase db push` in a session
should run `supabase migration list` first to confirm Local/Remote match.

OUT-OF-BAND DB OBJECTS (tracked registry — 2026-07-25). Objects that exist on
PROD but have NO migration-file source (created via the dashboard SQL editor or
other out-of-band action). These are a standing liability: prod drifts from
test-db and from the migration set, so a DR restore / branch reset / rebuild
comes up WITHOUT them, and reviews can miss them (they aren't in the files).
RULE: catalogue every one here the moment it's found, and bring it under version
control (into a migration) the next time it's touched. Known entries:
  * `rls_auto_enable()` — SECURITY DEFINER, owner=postgres, broad default
    PUBLIC/anon/authenticated EXECUTE. On PROD only (absent on test-db); no
    migration history. Being brought under version control for the FIRST TIME via
    migration 020 (the function-EXECUTE hardening pass) — 020 is the first file to
    reference it. Invocation path confirmed during the 020 rehearsal (see 020).
  * `jobs` / `processed_messages` RLS-enabled state — `relrowsecurity=true` set
    out-of-band (017 review F6); default-deny holds on prod but a rebuild comes up
    RLS-DISABLED. Codify via its own migration before any environment rebuild.
  * (historical) 001-005 — applied via the dashboard SQL editor, later reconciled
    into the migration set (see the note above); listed for completeness.

SECURITY INCIDENT — anon-callable SECURITY DEFINER RPCs (migration 020, 2026-07-25).
All SEVEN public SECURITY DEFINER function grants were over-broad (PostgreSQL's
default PUBLIC EXECUTE, live since 012 / 2026-07-05); 020 closes all seven. But
the ACTUALLY-EXPLOITABLE surface was NARROWER than "seven" — do not overstate it:
  * EXPLOITABLE (the hole) — the THREE parameter-trusting fns
    (acquire_and_transition_session, apply_morning_flow_turn,
    drain_next_pending_flow): they take p_user_id/p_tenant_id as caller input,
    derive NO identity from auth.uid(), and return non-trigger types, so the
    public ANON key could call them via PostgREST /rpc/ and forge check-in /
    session data for any engineer — bypassing the webhook, Twilio HMAC, and
    idempotency.
  * BOUNDED — complete_onboarding: anon-invocable but self-guards on auth.uid()
    (016 zero-row RAISE rolls back), so an anon call achieves nothing.
  * NOT EXPLOITABLE, hardened for defense-in-depth only — handle_new_user
    (RETURNS trigger) and rls_auto_enable (RETURNS event_trigger): PostgREST does
    NOT expose trigger-returning functions as /rpc/ endpoints AT ALL, so their ACL
    was never a callable vector. get_user_tenant_id under anon just returns NULL
    (no auth.uid() → no row) — harmless. quoco_same_ist_day is a pure helper, out
    of scope.
Pinned evidence: docs/reviews/020-review-package.md. Log-retention exploitation
check: see that package (§ log-retention).

Then in Week 2 (remaining):
- NFR-16 queue helper library (enqueue/claim/complete/fail functions)
- /api/jobs/tick worker endpoint + Vercel cron config
- Migration 007 (auth surgery) — CHECKPOINT 1: booked second-pair-of-eyes
  review with the developer friend BEFORE running on the real database.
  007 decouples users.id from auth.users — irreversible if wrong. Rehearse
  on a Supabase branch snapshot first. Do not run 007 on prod before this
  review.
- Webhook /api/whatsapp/webhook (HMAC, SID idempotency, media pipeline)
- Session state machine (BOT-07 TTL resume, BOT-21 collision) — see bot-flows
- E.164 normalisation
- Morning flow Q1–Q6 incl. BOT-24 responsibility follow-up, BOT-20 site-closed
- Engineer registration ENG-01/02/05/06

BOT-27 reactivation CLEAR-HALF — DONE (2026-07-21, feat/bot-27-reactivation-clear).
Webhook clears messaging_blocked + TwiML-acks an active-but-blocked engineer's
inbound; pure decideInboundGate() + clearMessagingBlock() in
lib/whatsapp/reactivation.ts, unit-tested + a direct clear-half DB test. Opt-in
TEMPLATE re-send deferred (blocked on Twilio sender). See bot-flows.md BOT-27.

TESTING DEBT — WEBHOOK HTTP HARNESS (opened 2026-07-21, tracked, NOT fixed).
CLAUDE.md §7 requires every webhook change to ship with a T-WH integration test,
"including the forged-signature rejection, T-WH-01". That harness DOES NOT EXIST
today — T-WH-01 is referenced in §7 but was never built (no HTTP-level webhook
test in the repo; only the pure-decision + DB-IO layers are covered). The BOT-27
clear-half (feat/bot-27-reactivation-clear) shipped WITHOUT it — a conscious
deviation approved for that PR: it is inherited debt 2a does not fix but knowingly
adds to. Do not let this silently persist: the next substantive webhook change
should either build the harness (construct Twilio-signed formData; assert
signature rejection + the clear/idempotency behaviour) or consciously re-defer it
here. The rule stops applying only if someone decides so on the record.
  NAMED FUTURE TEST (deferred with the harness, recorded so the reasoning
  survives): a ROUTE-LEVEL test proving RETRY-AFTER-CLEAR cannot fall into the
  morning flow — i.e. an inbound from an active+blocked engineer clears the flag,
  and a Twilio RETRY of that SAME MessageSid (now an active+unblocked user) is a
  no-op, NOT a morning-flow turn. This is the exact scenario the "consume the SID
  BEFORE the clear" ordering in route.ts exists to prevent (see the ACCEPTED
  FAILURE WINDOW comment there); the ordering is currently only argued in comments
  and covered obliquely by the pure idempotency unit — the route-level proof waits
  on the harness.

CLOSED (2026-08-07): test/webhook.test.ts now exists (10 tests, committed
8a24399, feat/022-evening-flow-apply-turn) — the harness this entry tracked as
missing across two deferrals (BOT-27's clear-half took the first; migration
022's review noted the second and named the outstanding test below). It calls
handleWebhookPost (app/api/whatsapp/webhook/route.ts) directly with an
injected test-db client — the SAME function POST calls in production, not a
separate assembly — via genuinely Twilio-signed requests (an independent
HMAC-SHA1 re-implementation in the test file, not a stub or bypass).
  WHY IT STALLED TWICE: not neglect — the harness was structurally blocked
  until six functions in this path (readCurrentFlow, applyMorningFlowTurn,
  applyEveningFlowTurn, dispatchInboundTurn, handleWebhookPost, isNewMessage)
  each independently constructing its own createServiceClient() gained an
  injected-client parameter; the test env deliberately never configures that
  client, and the block was invisible until someone actually tried to test it.
  T-WH-01 is included; its claim is precise, not broader than earned: the
  .env.test TWILIO_AUTH_TOKEN is a fixed, obviously-fake value, so T-WH-01
  proves validateTwilioSignature's algorithm correctly REJECTS a non-matching
  signature — it does NOT prove production's real Vercel-configured token is
  itself correct. "Signature validation is tested" does not extend that far;
  that remains a separate, unverified claim.
  The NAMED FUTURE TEST above is also closed, not left to outlive this entry:
  T-WH-07 runs exactly that sequence — reactivate clears messaging_blocked,
  the SAME MessageSid retried now finds decideInboundGate returning 'proceed'
  (not 'reactivate'), and the ordinary path's own idempotency check catches it
  as a duplicate before it can reach a morning-flow turn. Verified three ways:
  response body, no session row created, no daily_logs row written.
Full test list and design rationale live in test/webhook.test.ts's own header
comment — not restated here.

PROD SMOKE CHECK RESOLVED (2026-07-26): migration 020's real webhook-driven
apply_morning_flow_turn end-to-end check is DONE — a full multi-turn morning flow
(Q1 plan → Q2 → Q3 → Q4 → "check-in complete") ran through the real webhook +
service_role on prod, stronger than the planned single-turn proof. daily_logs
write confirmed (engineer 3534756b…, 2026-07-26). The test engineer + session were
deactivated per the standing artifact discipline. Full evidence:
docs/reviews/020-review-package.md §8 Step 6. (Was DEFERRED 2026-07-25; closed
within the 1-2 day window.)

DATA RETENTION POSTURE — AUDITED 2026-07-27, NO POLICY EXISTS YET.
A read-only audit of the five WhatsApp-flow tables found that NOTHING deletes or
archives a row anywhere in the system: no DELETE/TRUNCATE in any migration, no
pg_cron job in the migration set, no TTL trigger, no archival table. The only
cleanup code in the repo is test-suite-only (test/helpers/db.ts, keyed on the
+19995550 fake-phone prefix, test-db only). vercel.json declares exactly one cron
(/api/jobs/tick, every minute) and that worker contains no deletion.
  * daily_logs, daily_log_edits, jobs, processed_messages — all grow unbounded.
  * whatsapp_sessions does NOT: uq_whatsapp_sessions_phone_number (012:34) caps it
    at ONE row per phone number, reused in place via ON CONFLICT. Its ceiling is
    distinct numbers ever seen, not messages or days. Needs no retention policy.
  * whatsapp_sessions.expires_at is WRITTEN AND NEVER READ — no WHERE, no
    comparison, in SQL or TypeScript. The real session lifecycle is
    quoco_same_ist_day(p_now, updated_at) (018:105), an IST calendar-day
    comparison. So BOT-07's "30-minute TTL" is not enforced today; that is not a
    bug (both same-day branches of the spec resume identically, so the TTL has no
    behavioural consequence to enforce) but it becomes load-bearing the moment a
    resume-specific message ships per Rule 3.6.
  * processed_messages is the fastest-growing table: one row per INBOUND message,
    ~13/engineer/site-day at full Spine (~195k/yr at 50 engineers). Rows are
    permanently useless after ~24h — Twilio retries within minutes, and the
    idempotency check never SELECTs (it inserts and catches 23505). 011:20-23
    already suggests a 7-day prune; nothing implements it. NOTE: there is no index
    on created_at, so that prune would seq-scan the whole table — BRIN on
    created_at is the right support (append-only, physically time-ordered), not a
    btree.
THREE DIFFERENT TREATMENTS, do not conflate: processed_messages is pure hygiene
(prune freely); jobs is hygiene with a caveat (prune 'succeeded', KEEP 'failed' —
the NFR-17 dead-letter record); daily_logs + daily_log_edits are NOT hygiene at
all — they are the business record behind every DPR ever sent, and 019 makes
daily_log_edits the SOURCE OF TRUTH the future generator must consult. Retention
there is a compliance question (how long a contractor must retain daily progress
records), never a storage one.
Migration 021 came out of this audit but removes INDEX OVERHEAD ONLY — it prunes
nothing. Full audit + growth model: docs/reviews/021-review-package.md.

PARSER DEBT — RULE 3.5's LOW-CONFIDENCE FLAG DOES NOT EXIST (opened 2026-07-28,
tracked, NOT fixed). Cross-cutting: affects EVERY future consumer of parsed
check-in data, not one flow. Rule 3.5 (docs/design-principles.md:31 — note:
design-principles, NOT bot-flows, where it is sometimes miscited) promises that an
unparseable reply gets one example, ONE re-ask, then "accept whatever comes and
flag it low-confidence for PM review."
  * The ACCEPT-AND-ADVANCE half IS implemented — morning's per-step re-ask budget
    (MORNING_PARSE_REASK_CAP; q2_reask/q3_reask counters in session context,
    mirrored in the 018 RPC).
  * The FLAG half is NOT. LabourParse is {planned_total, by_trade, raw_text} and
    EquipmentParse is {items, none, raw_text} — neither carries a confidence
    field, and no daily_logs column records one.
CONSEQUENCE: an answer accepted AFTER exhausting its re-ask is indistinguishable
from a cleanly-parsed one, and the PM has nothing to review — Rule 3.5's promise
is half-kept. Live since Pass 2 (migration 018). Until this is built, anything
consuming parsed data (DPR generation, dashboard, the §6 efficiency calculations)
MUST assume no confidence signal exists and treat every parsed value as equally
trusted, because that is the current reality. Do not design a consumer that reads
a confidence field expecting it to be populated. Origin + full reasoning:
docs/design-decisions-beta-feedback.md §9 (evening Q4 v1 scope), where this was
first written down before being promoted here as cross-cutting debt.

HIGH-1 (users_update self-privilege-escalation) — CLOSED by migration 015,
applied to prod 2026-07-12, dual-verified and externally reviewed. Full
record: docs/schema.md:497-517 + docs/reviews/015-review-package.md. Standing
regression guard: test/migration-015.test.ts (6 tests, real authenticated JWT
clients — never service-role, which bypasses both RLS and column grants and
would pass by construction). Independently re-confirmed on prod 2026-08-03:
authenticated holds column-level UPDATE on (full_name, avatar_url) only, no
table-level UPDATE. Full re-confirmation evidence: 015-review-package.md §7.
This entry exists because CLAUDE.md previously had zero reference to 015,
causing an external audit to flag it as possibly-unfixed — a cross-reference
gap, not a fix gap (P3 data point).

EQUIPMENT daily_hire_cost — A COUNT IN A MONEY FIELD (opened 2026-08-05,
tracked, NOT fixed). Pre-existing 018-era parser behavior, surfaced during
migration 022's review (R5 rehearsal, engineer C: "1 JCB, 2 mixers" parsed to
daily_hire_cost: 1 / daily_hire_cost: 2, count: null on both). equipment.ts's
parseChunk (018, unrelated to 022, deliberately left alone there — see
docs/reviews/022-review-package.md §10) reads the FIRST number in a chunk as a
daily hire RATE, never a count, by design ("the field gives rates ('JCB
1500'), not counts" — equipment.ts:50-54). A terse answer that leads with a
count rather than a rate ("2 mixers", "1 JCB") lands that count directly in a
field two future consumers will read as money:
  * design-decisions-beta-feedback.md §6 — "Machinery wastage ₹ = idle hours
    × hire rate," a weekly-review costing calculation.
  * bot-flows.md's DPR generation job — "Idle cost per machine = daily_hire_
    cost × (1 − actual_hours/available_hours)," computed IN CODE and injected
    as a FACT into the Claude prompt (bot-flows.md, "What the job does").
CONSEQUENCE: neither consumer has any signal that a given daily_hire_cost is a
miscaptured count rather than a real rate. The DPR path is the sharper risk —
a count masquerading as a rate becomes a stated currency figure in the
generated report itself, not a visible error a PM would catch and question.
Until this is fixed, any future consumer of morning_equipment MUST treat
daily_hire_cost as unverified and MUST NOT assume it is always a genuine rate.
Same class of finding as PARSER DEBT above (a downstream consumer inherits a
silent gap unless warned here first) — this entry exists so the next author
gets the warning, not the surprise. Full finding + citations:
docs/reviews/022-review-package.md §10.

CANDIDATE CI CHECK — NO createServiceClient() WHERE AN INJECTED CLIENT COULD
BE ACCEPTED (opened 2026-08-07, tracked, NOT built). Surfaced while building
the webhook HTTP harness (test/webhook.test.ts, CLOSED above): six functions
in the WhatsApp inbound path — readCurrentFlow, applyMorningFlowTurn,
applyEveningFlowTurn, dispatchInboundTurn, handleWebhookPost, isNewMessage —
each independently constructed its own createServiceClient() instead of
accepting one as a parameter, and the harness could not reach test-db through
ANY of them until all six gained an injected-client parameter. The fix
pattern was not new to invent: clearMessagingBlock (lib/whatsapp/
reactivation.ts) already took its client as a parameter, one directory over,
before any of the six were touched — the pattern existed and was simply not
applied consistently.
  WHAT IT WOULD FORBID: createServiceClient() called inside a function body
  where an injected-client parameter is a viable alternative (i.e. the
  function is reachable from application code that could pass one down) —
  flag the call at write time, not leave it to be rediscovered.
  WHY IT'S WORTH ENFORCING: the failure mode is invisible until someone tries
  to test the code — by which point the constructing function may already
  have several call sites, and the fix becomes a multi-function refactor
  instead of a one-line addition made at write time.
NOT a rule to follow by hand today. Writing this as prose for a human to
self-apply would BE the honour-system enforcement gap the process-hardening
work order's P2 (CI gates) exists to close — so this is captured strictly as
a CANDIDATE CHECK for when P2 is built, not a standing style rule. It belongs
in P2's stage 1 (tsc/lint/test) — it is a TypeScript/source rule, not a
migration-file rule, so it does NOT belong in that work order's stage-2
migration-linter table. The work order itself is NOT committed to this repo
as of 2026-08-07 — the only trace found is docs/reviews/015-review-package.md
§7, which refers to it as an external process audit, not a repo artifact.
Capture only; nothing here is enforced until P2 exists.
CLOSES WHEN: folded into the P2 stage-1 (tsc/lint/test) plan at kickoff.

P3 SCOPE CAPTURE — RULES-FILE STALENESS TRIAGE TEST (opened 2026-08-07,
tracked, NOT applied file-wide). Origin: the §6 migration-numbering fix in
the P1 correction pass (PR #23) replaced a hardcoded range ("001-006 live,
new changes go in 007/008/009") with a rule that names the check command
instead of a number — the reviewer generalized that single fix into a
reusable test during that PR's review, worth recording here rather than
letting it live only in a PR comment.
  THE TRIAGE TEST: any line in this file that will become false through the
  mere passage of normal work — a number, a "pending," a "not yet" — either
  becomes a SELF-VERIFYING rule (name the command, as the §6 fix did) or
  MOVES TO THE DATED LOG (§10, as every other correction in this file
  already does). Applied file-wide, this is most of P3's triage decided in
  advance: for every remaining line, the test itself says which bucket it
  falls into — P3 doesn't need to invent a sorting method, only run this one
  against the whole file.
  THE LENGTH OBSERVATION: P1 added 30 net lines to this file (43
  insertions, 13 deletions — commit 991cc8a), whose
  known failure mode (the reason §1-9 were split out into linked docs at
  all) is length-driven instruction loss — the more that's in front of a
  fresh session, the more of it can silently go unread or deprioritized.
  Each P1 correction correctly carries its dated history, per this file's
  own standing provenance discipline — right for a correction pass, since
  silently rewriting history is exactly what §0 forbids. But that means
  corrections ACCUMULATE length rather than shrink it, which makes evicting
  resolved dated history out of the live instructions (the heart of what P3
  is for) MORE necessary after this pass, not less.
NOT itself a P3 plan — a capture of two inputs P3 should start from, same
spirit as the CANDIDATE CI CHECK entry above: recorded so it's available
when that work starts, not requiring rediscovery from a PR thread.
CLOSES WHEN: folded into the P3 plan at kickoff.

DASH-04 DPR ARCHIVE SHIPS LIST-ONLY IN MIGRATION 023's PR (2026-08-07). The
page (`app/(dashboard)/dprs/page.tsx`) had a "View" link to a per-DPR detail
route that has never existed — `app/(dashboard)/dprs/[id]/page.tsx` was never
built, so bot-flows.md's DASH-04 spec ("list + full view") has only ever
shipped its list half. The link also predated the 023 repoint entirely (it
was broken in the original stub, confirmed via `git show` against the exact
commit that touched this file) and was wrong-shaped on top of being a dead
end: `/dashboard/dprs/${id}` — the `(dashboard)` segment is a Next.js route
GROUP and contributes no URL segment; every other link in this app already
omits it, this href was the one outlier. Removed (link + its `<th>`/`<td>`)
rather than fixed, since a corrected-but-still-dead link would still 404 and
there's no DPR content to view yet regardless (nothing populates `dprs`
until the generator ships — see the Claude API / DPR generation Phase 0-1
work). Whoever builds the detail route needs BOTH facts, not just that a
link is now gone: the route needs to be built from scratch (nothing to
resurrect), and the URL must NOT carry the `(dashboard)` prefix when it is.

DPRS PAGE SWALLOWS QUERY ERRORS (opened 2026-08-07, tracked, NOT fixed —
this instruction failed to land the first time it was sent, mid-session,
while another tool call was running; recorded here now on the retry so it
doesn't depend on a message actually arriving). `app/(dashboard)/dprs/page.tsx`
destructures only `{ data }` from the `dprs` query — `error` is never
read. `dprs = (data ?? []) as unknown as DprRow[]` collapses "genuinely
zero rows" and "the query failed" into the identical empty array, so a
failed read renders the SAME "No DPRs generated yet" state as a working
page with nothing in it yet. A PM has no way to tell "the system hasn't
generated anything" from "the system is broken" — the page actively hides
the exact failure that should make them escalate. NEEDS, before real PMs
are on this page: a distinct error state (visually different from the
empty state) and Sentry capture of the swallowed error — this route
currently violates CLAUDE.md §6's "log to Sentry in production" rule for
external calls.
  WHY THE 023 MERGE-BEFORE-APPLY WINDOW WAS HARMLESS, NOT JUST LUCKY —
  this same bug is the reason, worth recording rather than treating as a
  coincidence. Migration 023 (docs/reviews/023-review-package.md §7,
  option B) merged to `main` and deployed to prod BEFORE its own apply, so
  between merge and apply prod's live `page.tsx` queried a `dprs` table
  that did not exist there yet. That query genuinely errored on every
  request during that window (`relation "public.dprs" does not exist` or
  the PostgREST equivalent) — and because the error is swallowed, prod did
  NOT 500 or show a broken page: it silently rendered the ordinary
  empty-archive state, indistinguishable BY CONSTRUCTION OF THIS BUG from
  "no DPRs generated yet," which is also the page's true state before real
  generation exists regardless. The window was cosmetically silent, not
  functionally safe — the error was real and invisible to Sentry for the
  same reason this needs fixing, not because nothing went wrong.

MIGRATION 023 APPLIED TO PRODUCTION (2026-08-07, 20:44 IST). `public.dprs`
created — Phase 0 of the Claude API / DPR generation build — and
`daily_logs.dpr_content` dropped (0 rows, probe-backed both pre-apply and
again at apply time). `app/(dashboard)/dprs/page.tsx` was already repointed
at the new table and on prod since the PR merged ahead of this apply
(deliberate option-B ordering, docs/reviews/023-review-package.md §7 —
`types/database.ts` was regenerated against test-db BEFORE the apply and
confirmed BYTE-IDENTICAL against a fresh prod regen AFTER it, sha256
match, no drift). PITR observed by direct dashboard inspection before the
apply (CLAUDE.md §0, not a checklist entry); rollback target 20:43 IST, 7
Aug 2026. All six post-apply verification queries on prod matched the
test-db rehearsal exactly — columns, RLS state (`relrowsecurity=true`,
`relforcerowsecurity=false`), policy shape (`dprs_select`,
`roles={authenticated}`), `relacl`
(`{postgres=arwdDxtm,anon=rDxtm,authenticated=rDxtm,service_role=arwdDxtm}`),
constraints, `dpr_content`'s absence. `ensure_rls` (the prod-only event
trigger tracked in the OUT-OF-BAND DB OBJECTS registry above;
023-review-package.md §4) fired exactly as predicted and was a non-event.
Full record: docs/schema.md's own `dprs` entry and
docs/reviews/023-review-package.md §12 — fuller than this pointer, read
those for the complete evidence.
  NOT closed out by this apply: the DPR generator itself (Phase 1 — the
  Claude API client, the `dpr_generate` job handler) does not exist yet;
  `dprs` is schema-only until that ships. Migration 024 (the systemic
  `anon`/`authenticated` TRUNCATE/REFERENCES/TRIGGER grant sweep,
  023-review-package.md §3) stays deferred, not part of this apply. The
  DPRS PAGE SWALLOWS QUERY ERRORS gap above also stays open — unrelated to
  this apply, not fixed by it.

Week 4 (in progress): APPLIED TO PRODUCTION — migration 022, evening check-in
flow Pass 1 + CONTEXT DISCIPLINE, on 2026-08-05. apply_evening_flow_turn
(Q1-Q3) is live, hardened inline (020 discipline); apply_morning_flow_turn
gains 'wrong_flow' (was 018's 'idle') and — reviewer round 2 — both its
context-writing sites now merge instead of replace, closing a defect a
reverse-order regression test found that the original single-site fix did
not cover (full finding: docs/reviews/022-review-package.md §9). PITR
observed before apply (full 7-day window); pre-apply baseline pinned as the
rollback reference (morning's body was still 018's, md5(prosrc)
6a762d496bb0e49f3fc2f29728d154bd — not sha256, corrected per schema.md);
post-apply ACL + both body hashes
confirmed on prod, matching test-db exactly. Ledger entry (version '022')
was MISSING from the original runbook draft — added retroactively once
caught, row count observed 18 -> 19 across the manual INSERT (§0: observed,
not asserted), CLI still 28P01-blocked. Full record: docs/schema.md's own
022 entry (fuller than this pointer — read that one, not this one, for the
complete pre/post-apply evidence).
  NOT closed out by this apply: real webhook-triggered apply_evening_flow_turn
  proof stays OPEN, blocked on the webhook-wiring deliverable
  (022-review-package.md §10) — nothing on prod can reach evening's RPC via
  the real webhook until a cron or the webhook itself is wired to call it,
  which 022 does not do. Restart-semantics decision also stays OPEN
  (design-decisions-beta-feedback.md §10, DECIDE-BEFORE-CRON-PR) — whoever
  builds that wiring inherits both.

019's CORRECTABLE-COLUMN SET DOESN'T COVER WHAT IT NEEDS TO — TWO INSTANCES
(opened 2026-08-10, tracked, NOT fixed; surfaced while planning the DPR fact
assembler, lib/dpr/assemble.ts). Migration 019 made `daily_log_edits` the
source of truth for 9 SCALAR `daily_logs` columns; the 8 JSONB columns were
deliberately excluded ("a different UI problem, deferred pass" — schema.md's
daily_log_edits entry). That exclusion now has two concrete costs, not just
a UI gap:
  * The confidence:'low' flag (024, evening_productive_manpower / evening_
    equipment_utilisation — see lib/dpr/schema.ts's low_confidence field and
    the OPTION C reasoning next to it) lives entirely inside the excluded
    JSONB. A PM reading a low-confidence DPR figure has NO way to correct
    it — the flag points at something unactionable. An unactionable flag is
    worse than no flag: it tells the PM something is wrong without giving
    them a path to fix it.
  * Section 1 has the same shape, sharper: `evening_output` (the free-text
    narrative) IS correctable but feeds no DprFacts field today;
    `evening_output_quantities` (what the DPR actually shows) is NOT
    correctable. A PM who spots a wrong quantity in a generated report has
    no way to fix it at all — not even the indirect "the flag exists but
    can't be acted on" of the first instance; there's no flag either, just
    a wrong number with no correction path.
  Both belong against 019's correctable-column set, not against the
  assembler that surfaced them — recorded here, not solved. Do NOT add a
  field like `execution_narrative_source` to paper over the second instance
  without addressing the underlying JSONB-correctability gap; that would
  hide the problem behind a new Fact field while leaving the actual
  correction path (or lack of one) untouched.

REGENERATION-ON-CORRECTION DOES NOT EXIST (opened 2026-08-10, tracked, NOT
fixed; same origin as the entry above). bot-flows.md's "Late data before
9 PM owner send" section covers new SUBMISSIONS arriving before delivery
(silent UPSERT regen) — it says nothing about a PM CORRECTION arriving at
any time, before or after generation, and nothing in the codebase re-
triggers generation off a `daily_log_edits` write. State the consequence
precisely, because it is worse than it first sounds: this is not merely a
missed 9 PM send. A correction made AFTER a DPR has already generated (and
especially after it has already been delivered to the owner) leaves the
ARCHIVED DPR permanently wrong while `daily_logs`/`daily_log_edits` — the
actual source of truth — are right. A late send is a timing problem; this
is a standing discrepancy between the record a PM believes is correct and
the record an owner already received, with nothing watching for it. Whoever
wires cron/webhook-triggered regeneration (already tracked as OPEN against
migration 022, above) inherits this too — it is a third thing that trigger
needs to account for, not just new submissions and the existing late-data
path.
  FORWARD NOTE, added 2026-08-10: lib/dpr/assemble.ts's parseCorrectedBoolean
  / parseCorrectedInteger throw when a daily_log_edits.new_value's runtime
  type doesn't match its column — deliberately. Throwing means no DPR gets
  generated, which is VISIBLE and gets investigated; silently skipping a
  malformed correction would mean the owner reads a pre-correction number
  with nothing to flag it, which is invisible and wrong. That posture is
  correct today, where assemble.ts has no caller to catch anything. Once the
  `dpr_generate` job handler exists, this throw MUST land in DPR-24's
  failed-delivery path (delivery_status='failed', Sentry alert, PM + founder
  notified — bot-flows.md's own Failed delivery section), not crash a cron
  invocation silently. A fourth thing the dispatch/regeneration layer needs
  to account for, alongside the three above.

Full milestone plan lives in the ARD §12 (milestone-framed, not calendar).
"Week N" = sequence + estimate, not a deadline. A block is done when its
EXIT GATE is green on a real handset.
