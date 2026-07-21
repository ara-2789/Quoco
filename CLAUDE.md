# QUOCO — Claude Code Instructions
# Read this file at the start of every session before writing any code.
# Last updated: 3 July 2026 — v2.0 (restructured for Claude Code)

# This is the CORE file. Detailed reference lives in two linked files —
# read them WHEN the task touches them, not every session:
#   - docs/schema.md     → full database schema, migration order
#   - docs/bot-flows.md  → full WhatsApp flow specs, DPR generation, templates
#   - docs/design-principles.md → UX rules, persona rules, copy tone, visual system
#     (once §6 is filled in). Read this when a task touches any user-facing
#     surface: WhatsApp bot copy/flow structure, PM dashboard, or DPR/owner content.
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
  Use 'owner' everywhere. (Rename lands in migration 007 — the auth
  surgery migration. Migration 006 is the jobs queue table, applied first.)
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
- Migrations in supabase/migrations/ as numbered files. 001–006 are LIVE —
  do not edit them. New changes go in 007, 008, 009 in order.
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

VERCEL PREVIEW ENV-VAR SCOPING — RESOLVED 2026-07-21. The Preview-scoped
NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY (and related Supabase vars)
had been pinned to ONE branch — feat/migration-007-auth-surgery (a leftover from
that migration's review) — instead of "All Preview branches." So every OTHER
branch's preview deploy got NO Supabase config, and proxy.ts's middleware
(createServerClient + getUser on every request) threw → "Internal Server Error"
on EVERY route of that preview, even though the build was green (these vars are
read at request time, not build time). Symptom bit the
feat/bot-27-reactivation-clear preview and was easy to misread as a code bug.
FIXED by re-scoping those Preview vars to "All Preview branches" in Vercel →
Project → Settings → Environment Variables; verified 2026-07-21 (redeployed
ad724f1, /login loads instead of 500ing). Kept here as a landmine marker: if a
future branch's preview 500s on every route with a green build, check this
scoping FIRST.

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
│   ├── supabase/{client,server}    ← done
│   ├── whatsapp/{session,normalise,flows/{morning,evening}}
│   ├── dpr/{generate,render}       ← Week 4
│   └── queue/jobs                  ← Week 2
├── supabase/migrations/            ← 001–006 live; 007–009 pending
└── proxy.ts                        ← done
# DATED CORRECTION (2026-07-13, per 016 round-3 review): a `types/database.ts`
# entry was listed here but the file NEVER EXISTED (git log --all -- confirms
# empty). Struck to stop it reading as a real artifact. Generated DB types are a
# deferred milestone — see the dated note under §6.

---

## 10. CURRENT BUILD STATUS

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

Full milestone plan lives in the ARD §12 (milestone-framed, not calendar).
"Week N" = sequence + estimate, not a deadline. A block is done when its
EXIT GATE is green on a real handset.
