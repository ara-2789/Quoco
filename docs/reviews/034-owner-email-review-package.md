# Migration 034 review package — owner-email delivery (BLOCKED half)

**RENUMBERED 030 → 034 (2026-08-31) — a real collision, not a cosmetic rename.** This
package and its migration were drafted and named under 030 on 2026-08-20. A different,
concurrently-drafted migration — `030_morning_flow_attendance.sql`, an unrelated
workstream — applied under that number on 2026-08-25, six days before this correction.
This file sat correctly held out of `supabase/migrations/` the whole time (see the
RELOCATED note below), so there was never a live on-disk collision — but nothing checked
its filename against the numbers being consumed around it: 031, 032, and 033 were each
claimed by other work in the meantime. Caught 2026-08-31 while making the delivery_status
revision below. Full account, including why this happened and a candidate migration-lint
check for the collision class, is in **§12** of this document.

**Status: WRITTEN, NOT APPLIED, NOT REHEARSED, BLOCKED.** This package accompanies
`docs/reviews/034_owner_email_delivery.sql` — RELOCATED here from
`supabase/migrations/030_owner_email_delivery.sql` (2026-08-20, BB2; the original,
now-superseded number — see the renumbering note above): a file sitting unapplied, on no
ledger, in the scanned migrations directory is a hazard on any branch that has it checked
out, not just on `main`. It moves back to `supabase/migrations/` (under its current name,
`034_owner_email_delivery.sql`) when it is actually being applied, per the same convention
CLAUDE.md's Database section now states. The `git show` command below is pinned to the
commit where the file WAS at the old path, under its original 030 name — historically
accurate, not updated, per this project's own provenance discipline (never retyped, never
silently moved; this applies even more so now that the number itself has changed —
rewriting a historical pin to say 034 would misrepresent what actually existed at that
SHA). Originally pinned at commit `e6a06826ad17df6c27f73db5584f97896d5c0ef2` (branch
`docs/dpr-delivery-versioning-plan`). Design record: `docs/dpr-delivery-versioning-plan.md`
§2j (frozen).

**Sequencing (external review, split-package decision):** BLOCKED on the trigger-cron
workstream — no cron exists yet for `ownerSend` (`lib/daily-logs/cutoffs.ts`'s own header:
"the `ownerSend` cron entry is NOT yet in `vercel.json`"), and no code path exists to
populate or read `notification_email`/`notification_email_verified_at` until it does.
Applying this schema now would add live PII columns and a public verification surface with
nothing consuming them. Written now so the package is complete and the next artifact, once
trigger-cron lands, is a go-ahead to apply, not another design pass.

---

## 1. Full SQL, pinned

```
$ git show e6a06826ad17df6c27f73db5584f97896d5c0ef2:supabase/migrations/030_owner_email_delivery.sql
```
Full file at that path/SHA, per CLAUDE.md §0's provenance rule.

---

## 2. §0 gate evaluation

Carried over from the migration file's own header (`034_owner_email_delivery.sql:9-30`):

- **(a) does not trip** — no Postgres function created or modified (the verification write
  is a service-role application route, not an RPC — §5 below states why).
- **(b) trips** — widens `delivery_status`'s `CHECK` on the live `dprs` table; adds two new
  PII columns to the live `users` table.
- **(c) TRIPS, named explicitly, per direct instruction — not left to ride in on (b)'s
  coattails.** `owner_email_verifications` is a PUBLIC, UNAUTHENTICATED write path into
  `users`' verification state, keyed by a bearer token, for a person with no login and none
  ever planned (`auth_id NULL` by design, CLAUDE.md §5). This is the first
  identity-verification surface this codebase has built outside Supabase Auth's own managed
  magic-link mechanism — a token-gated write path is at minimum a judgment call worth
  recording here, matching the discipline #69's own plan applies to its (c) entry for
  phone-number identity.
- **(d) does not trip** in the schema sense — additive only.
- **(e) does not trip** — no billing surface touched by this file (the eventual email-send
  cost is #67's §2g dependency, application-layer, not this migration).

**Net: (b) and (c) trip — full external-review package required. This document is that
package.**

---

## 3. S2 — the verification endpoint, fully specified (not restated from the plan; see
`034_owner_email_delivery.sql`'s own trailing APPLICATION-LAYER SPEC comment block for the
complete route/re-click/expired/rate-limit specification, pinned via the `git show` above,
not retyped here per the provenance rule).**

Summary only, for the package record:
- Token: random, generated in application code (not SQL — no `pgcrypto` dependency
  introduced for one column), SHA-256 hashed before storage, raw token never persisted.
- Storage: `owner_email_verifications` (§4 below), `token_hash UNIQUE`, `expires_at`,
  `used_at`.
- Route: `app/api/owner/confirm-email/route.ts`, public, service-role write, generic
  expired/used/not-found response (enumeration-resistant).
- Rate limiting: named as a required part of the route's own build, not implemented in
  this migration.

---

## 4. Table/RLS audience statement

`owner_email_verifications` — **RLS ENABLED, ZERO policies, for both `authenticated` and
`anon`.** Deliberate, not an oversight (migration file's own comment, §5): a bearer token
is not an `auth.uid()` session, so there is no RLS predicate that could correctly express
"possession of this token" — the boundary is enforced entirely in the service-role route
handler. Default-deny via RLS-enabled-zero-policies is the correct state here, the same
shape CLAUDE.md's own `jobs`/`processed_messages` F6 finding (017 review) confirms is
fail-CLOSED, not fail-open, once understood correctly.

`users.notification_email`/`notification_email_verified_at` — no new RLS policy; inherits
`users_select`'s existing (column-agnostic, tracked-open) policy. See S4, below.

---

## 5. Composite FK convention (5)

`owner_email_verifications.user_id` → `users(id, tenant_id)`, `ON DELETE CASCADE` — a
verification token has no meaning once its target user row is gone (unlike `dpr_versions`'
`RESTRICT` on an archival author reference, this is disposable state, correctly `CASCADE`).

---

## 6. S3 — CLOSED by migration 017. Raw output, both databases, not a claim.

**Status: settled, not open.** Round 4's escalation of this as a cross-tenant delivery risk
is withdrawn by the escalator himself, on this exact evidence — recorded here so the pin
carries proof, not two conflicting summaries. The composite same-tenant FK on
`projects.owner_user_id` this package might otherwise be expected to add in
`034_owner_email_delivery.sql` **already exists**, shipped by
`017_rls_column_bounding.sql:82-91` (`projects_owner_user_id_fkey`), which `DROP`s the
plain FK migration 016 originally added and re-adds it composite, over the
`UNIQUE(id, tenant_id)` parent index that same migration also creates.

**Raw output, test-db** (`exfccwlrhoutkgrlikod`), captured 2026-08-19:
```sql
SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
WHERE conrelid = 'public.projects'::regclass AND contype = 'f'
  AND conname LIKE '%owner_user_id%';
```
```
projects_owner_user_id_fkey | FOREIGN KEY (owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT
```

**Raw output, PROD** (`jvxwqignooseazzmwhvl`), captured 2026-08-19, the higher-consequence
database, checked directly rather than inferred from test-db alone:
```sql
SELECT conname, contype, confrelid::regclass AS references, pg_get_constraintdef(oid) AS definition
FROM pg_constraint WHERE conrelid = 'public.projects'::regclass ORDER BY conname;
```
```
projects_created_by_fkey    | f | users   | FOREIGN KEY (created_by) REFERENCES users(id)
projects_id_tenant_id_key   | u | -       | UNIQUE (id, tenant_id)
projects_owner_user_id_fkey | f | users   | FOREIGN KEY (owner_user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT
projects_pkey                | p | -       | PRIMARY KEY (id)
projects_status_check        | c | -       | CHECK (status = ANY (ARRAY['active','completed','on_hold','in_bidding','bids_submitted']))
projects_tenant_id_fkey      | f | tenants | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE CASCADE
```
Parent index, PROD:
```sql
SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'users' AND schemaname = 'public';
```
```
users_id_tenant_id_key | CREATE UNIQUE INDEX users_id_tenant_id_key ON public.users USING btree (id, tenant_id)
```
(full 5-row result also includes `users_pkey`, `users_whatsapp_number_key`,
`idx_users_tenant_id`, `uq_users_auth_id` — omitted here as not relevant to this FK's parent)

Both databases: `confupdtype='a'` (NO ACTION), `confdeltype='r'` (RESTRICT), matching
017's own comment exactly. **Nothing shipped for this in `034_owner_email_delivery.sql`;
the argument for not shipping it is that it already exists, proven above, not that it was
judged unnecessary.** `016_corrections.sql:32-34`'s own warning comment — the passage that
led the external reviewer to request this FK, reasonably, since it reads as an open gap —
is stale and has been struck-through-and-dated in place, citing this same evidence
(`016_corrections.sql`, dated correction at that line).

---

## 7. S4 — PII exposure recorded against the open item

`notification_email` inherits `users_select`'s (`007_auth_surgery.sql:214-216`)
column-agnostic exposure — any authenticated tenant member sees it, same class of finding
already tracked for `whatsapp_number` (`docs/reviews/017-review-package.md` §7, primary
tracking **007 review §11d**; live client surface: `lib/daily-logs/query.ts:92-96,133` →
`app/(dashboard)/daily-logs/page.tsx:150-152` → `app/(dashboard)/daily-logs/reactivate-
cta.tsx`, a `'use client'` component). **Recorded here and in the column's own `COMMENT`
(migration file, pinned above) — column-bounding `users_select` remains the distinct F5
least-privilege workstream that item already scopes this to, not fixed by this migration.**
A follow-up line should be added to `docs/reviews/017-review-package.md`'s own §7 residual
noting the second column, at whichever future pass actually touches that file — not done in
this commit, to avoid editing a frozen historical review package casually.

---

## 8. Undocumented dependency, cited

`role = 'owner'` (§2j/A1's operator `INSERT`) is legal only because
`016_corrections.sql:71-72`'s `users_role_check` — `CHECK (role IN ('pm', 'qs', 'engineer',
'owner', 'subcontractor', 'admin'))` — includes it. Cited in the migration file's own
header; restated here for the package record.

---

## 9. Retention-ledger lines

- **`users.notification_email`/`notification_email_verified_at`** — not a new table, no
  independent retention posture; inherits `users`' own (no retention policy has ever been
  defined for `users` rows themselves — out of scope here, unchanged by this migration).
- **`owner_email_verifications` — PRUNABLE HYGIENE, same classification as `checkin_
  escalations`, not a compliance record.** Grain: one row per confirmation-send attempt
  (beta: one per manually-seeded owner, occasionally more on a re-trigger after an expired
  link). A token past its `expires_at` has no further use to anyone — it cannot be
  verified, cannot be un-expired, and carries no historical claim on permanence the way
  `daily_log_edits` does. No prune mechanism built in this migration — a future pass could
  safely `DELETE WHERE expires_at < now() - interval '30 days'` — this is a classification,
  not an implementation, matching this project's own "posture nothing yet enforces" pattern
  for its other retention-ledger lines.

---

## 10. Rehearsal plan + pre-apply probes

**Not run — this package is BLOCKED, not merely unrehearsed.** Rehearsal against test-db
is deliberately deferred until trigger-cron lands and there is real code to exercise this
schema against — rehearsing a schema nothing reads or writes yet would prove only that the
`CREATE TABLE`/`ALTER TABLE` statements parse, not that the design is correct in practice.
Probe queries (pre-apply column/constraint absence checks, mirroring 029's package §7
shape) will be written and run at that time, not sketched prematurely here.

---

## 11. Apply runbook

Per `docs/migration-runbook-template.md`. **Not scheduled.** The next artifact for this
migration is a go-ahead to apply, gated on trigger-cron's own workstream landing first —
named here as the explicit trigger condition, not a date.

---

## 12. Delta (2026-08-31) — four decisions, the renumbering, and what's still out of scope

This section documents everything changed in this pass, as a **delta against round 4's
sign-off**, not a fresh review — round 4's own findings (§§1-11 above) stand unless a
subsection below says otherwise.

### 12a. `delivery_status` — two new failure values, `failed` re-scoped, no cross-product

**DECIDED (Aravind, 2026-08-31).** The three values already in this migration's CHECK
(`pm_notified`, `skipped_no_template`, `skipped_unverified`) were written before
`design-decisions-beta-feedback.md` §37(c)/(d) existed (2026-08-27). §37(c) adds a real,
distinct owner-facing outcome — the no-report notice — that the CHECK had no slot for.
Widened to add **`no_report_sent`** (success: the no-report notice reached the owner) and
two new failure values, **paired with the two owner-facing success outcomes rather than
lumped into the existing `failed`**:

| Value | Pairs with | Written by |
|---|---|---|
| `owner_send_failed` | `delivered` | The email delivery-status webhook (§2g's own named dependency — not built) |
| `no_report_failed` | `no_report_sent` | `/api/whatsapp/status-callback` — **already built** (item D, PR #120/#126), same mechanism the four engineer checkpoints already use |
| `failed` (existing, re-scoped in meaning, no DDL) | `pm_notified` | Stage 1 (PM-notify) only, going forward |

**Argued, not merely asserted:**
1. **Symmetry with the success side.** `no_report_sent` exists so a reader can tell "did
   the owner get real content" from the column alone, without opening Sentry. A single
   shared failure value would reintroduce that exact ambiguity on the failure side — the
   column would say `failed` whether a real report was lost or a mere notice was lost,
   defeating the reason the success split exists.
2. **The two failures are not equally severe, and the column is queried.** `owner_send_
   failed` means real site data never reached the paying customer — `no_report_failed`
   means the owner wasn't told there was nothing to report, a materially smaller harm.
   Any alert built on this column (matching the §2g item 5 "N consecutive nights"
   pattern already used for `skipped_unverified`) needs to prioritise these differently
   without re-deriving severity from log context each time.
3. **They are already two separate handlers reading two separate provider signals** —
   the WhatsApp failure is caught by machinery that already exists; the email failure
   needs a webhook that doesn't. Two values map onto two real, independent
   implementations; one shared value would force both to agree on a string neither has
   reason to share.
4. **Restraint, not just addition:** `owner_send_failed` is NOT split further by
   sub-cause (bounce / complaint / API rejection) — all three currently lead to the same
   remediation (check the email provider's dashboard), so a further split would be a
   value nothing downstream queries differently. Same bar this migration's plan already
   applies elsewhere ("not cross-producted").

`failed` itself needed no DDL — it already exists in the live CHECK (023) and is simply
re-scoped, in prose, to stage 1 only, the same treatment `delivered` already got when
owner delivery moved from WhatsApp to email (§2e). Applied in the migration body, §12d
below.

### 12b. WhatsApp is optional for owners — DECIDED, and its schema follow-up named, not built

**DECIDED (Aravind, 2026-08-31).** Per §28(bb), WhatsApp is the owner's push channel only
until the app replaces it — not because the app notifies better, but because a push
notification is free where a WhatsApp conversation is billed, and the deep link stops
needing a message to carry it. Until the app exists, WhatsApp is the only push channel,
but an owner may decline to give a number (personal number, SMB owners are often private
about it). **The no-report notice falls back to email when the owner has no WhatsApp
number** — same content, the channel he already receives reports on. Rationale: §37(d)
exists because silence is ambiguous ("the engineer didn't report" vs. "delivery failed"
look identical to the owner) — declining WhatsApp doesn't make that reasoning stop
applying.

**Provisioning must record the choice explicitly, not infer it from a null number** —
"declined WhatsApp" and "we forgot to ask" are different states and must stay
distinguishable. **Named here, not designed into this migration:** the shape this needs
is a nullable timestamp on `users`, e.g. `whatsapp_declined_at TIMESTAMPTZ NULL` — NULL
means "not asked / unknown" (the default, including every legacy row), a timestamp means
"asked and explicitly declined at this moment." This is the identical shape this
migration already uses for `notification_email_verified_at` (§1 of the SQL file) —
proven, not a new pattern. **Explicitly rejected: overloading `whatsapp_number` itself**
with a sentinel value like the literal string `'declined'` — this would need no schema
change, but it corrupts the column's own type (a phone-number column holding a
non-phone string), and any future code path that reads `whatsapp_number` expecting a
dialable number (a reminder flow, an accountability escalation reusing this column) would
silently try to act on the sentinel. A real column, not a string trick, matching this
project's own repeated lesson about reusing a column for something its type doesn't
support.

**Why this isn't in this migration's DDL:** per direct instruction ("do not design the
migration for it yet") and because it's a genuinely separate concern from what 034
actually ships — 034 is the email/verification schema; the WhatsApp-decline column is a
provisioning-flow concern that belongs with whatever migration actually builds §2j/A1's
operator script and the `eveningClose`/`ownerSend` application code, since that is the
first code that would ever read or write it. Adding it here with nothing to consume it
would repeat the exact reasoning this migration's own header already gives for staying
BLOCKED in the first place (PII/verification surface with no consuming code path).
Tracked here as a named requirement for that later migration, not designed further.

### 12c. Copy drift between the WhatsApp template and its email fallback — single source, not a test

**Question:** §37(d)/12b's email fallback and the Meta-approved WhatsApp template
(`docs/whatsapp-templates.md` template 14, `quoco_dpr_owner_no_report`) now carry the
same "no report today" content on two channels with very different edit costs — the
WhatsApp body is frozen the moment Meta approves it (a wording fix requires a whole new
template + re-approval cycle); the email copy can be edited and deployed in a minute.
**Argued and decided: one shared source string, not a recorded-constraint-plus-test.**

This codebase already has the identical problem one level up, and already chose a test
over a shared source there: `scripts/submit-templates.ts`'s `checkBodyDriftAgainstMarkdown`
compares `docs/whatsapp-templates.json` (what actually gets submitted to Meta) against
`docs/whatsapp-templates.md` (human-edited prose) and fails loudly on any normalised
mismatch. That choice was correct FOR THAT PAIR, for a structural reason that doesn't
apply here: the markdown file is legitimately independent prose — human documentation,
review commentary, sample-value history — that can't be collapsed into the JSON without
losing its own purpose. A test is the right tool when two representations have
independent reasons to exist as separate, human-authored artifacts.

**The email no-report copy has no such independent reason to exist as a second,
separately-authored string.** It is not documentation, review commentary, or anything
with its own audience — it is the same two sentences, rendered on a channel with looser
formatting rules, wrapped in whatever subject line/greeting the email needs around it.
Nothing is lost by making the email renderer import `docs/whatsapp-templates.json`'s
template-14 `body` field directly (substituting `{{1}}`/`{{2}}` the same way) rather than
re-authoring the sentence as a second literal. Doing so makes the two channels' body text
impossible to diverge locally, by construction — not merely caught by a test that could be
skipped, forgotten, or run after the divergence has already shipped.

**What a shared source does NOT solve, named so it isn't oversold:** the residual risk is
identical either way — a local edit (shared string or not) never retroactively changes
what's already approved and live at Meta under an HX SID; that still requires a real
re-submission + re-approval cycle, tracked the same way every other template re-cut in
this project already is (`docs/reviews/whatsapp-template-submission-status.md`, the
1v2/1v3-style versioning precedent). A shared source eliminates the "two local copies
silently disagree" failure specifically — the one the drift concern is actually about —
not the separate, unavoidable Meta-approval lag.

**Recorded, not built:** no email renderer exists yet (§2h of the plan, still open). This
is a build-time requirement for whoever writes it — import the JSON, don't retype the
sentence — cross-referenced from `whatsapp-templates.md`'s own template 14 entry so it
isn't discovered independently later.

### 12d. The three requested SQL edits, applied

- **12a's three new `delivery_status` values** added to the widened CHECK (§2 of the SQL
  file).
- **`owner_email_verifications`' missing `service_role` REVOKE**, added with reasoning:
  `service_role` legitimately needs SELECT + UPDATE on `used_at` (the confirm route's own
  service-role client, per §5 of the SQL file) — DELETE, TRUNCATE, REFERENCES, and TRIGGER
  are explicitly revoked, none of them used by the one legitimate caller. **This is the
  FOURTH confirmed instance of the pattern CLAUDE.md's standing rule (2026-08-26) now
  names** — `dpr_versions` (029, live), `031_outbound_send_ledger.sql` (caught pre-apply
  by its own rehearsal), and this file's own first draft, now fixed here before any
  rehearsal ever ran against it. **Worth recording as a real limit of the 2026-08-26 grep
  sweep, not just a fourth data point:** that sweep would have scanned
  `supabase/migrations/`, the directory every apply/rehearsal tool reads — this file sat
  in `docs/reviews/` the entire time (correctly, per BB2), which is exactly why a
  migrations-directory grep missed it. A future sweep for this pattern needs to also
  cover `docs/reviews/*.sql` — held-but-unapplied migrations are not exempt from a defect
  class just because they haven't shipped yet.
- **The `whatsapp_number` provisioning gap (12b) is NOT addressed in this migration's
  DDL** — named above as a requirement for whatever migration builds the provisioning
  script/application code that would actually consume it, per direct instruction not to
  design it in here.

### 12e. Why the renumbering happened, and whether tooling should catch it

**Root cause, stated once, not re-derived per future instance:** this file was drafted
and named under 030 on 2026-08-20, the same day BB2's own convention (a held migration
lives in `docs/reviews/`, not `supabase/migrations/`, until it's actually being applied)
was written. That convention correctly kept this file out of the directory every
apply/rehearsal tool scans — so it never posed a live collision risk — but it also meant
nothing about this file's own FILENAME was ever checked again against what was happening
in `supabase/migrations/`. A different, concurrently-drafted migration claimed and
applied under 030 on 2026-08-25; 031, 032, and 033 were each claimed by other work in the
six days after that. The file's name drifted three numbers out of date, silently,
because the one convention that protects against a live collision (BB2) has no companion
convention that protects against a NAME going stale while held.

**A second file in the same position, flagged, not touched:** `docs/reviews/026_dpr_
generation_stale.sql` — relocated the same way, same day (2026-08-21), for the same
reason. Its number (026) is a genuine, still-open gap in `supabase/migrations/` today —
not currently colliding — but it carries the identical latent risk this section
describes: nothing prevents a future migration from being numbered 026 by someone who
doesn't know a held draft already claims it, the same way nothing prevented 030 from
being reused out from under this file. Left as-is in this pass — renumbering it is a
separate migration's own workstream, not requested here — but recorded so it isn't
rediscovered as a surprise the way this file's own collision was.

**Should migration-lint check this? Argued, not built.** A check of the shape "any file
in `docs/reviews/` matching `^[0-9]{3}_` whose number already exists in
`supabase/migrations/` fails the build" would have caught this exact defect the day
`030_morning_flow_attendance.sql` applied, rather than six days and three more migrations
later. It's cheap to write (`scripts/lint-migrations.mjs` already exists and already
walks `supabase/migrations/`; this only adds a second glob and a set-intersection check)
and it fires on exactly the condition that matters — a number collision — not on staleness
in general, so it wouldn't nag about `026` sitting on an unclaimed number. The honest
counter-consideration: this defect class requires a SECOND concurrently-drafted migration
to claim the same number while the first sits held — this is the first time it's
happened in this project's history (026 has never collided, only 030 has), so the base
rate is genuinely low, and a lint rule earns its keep on frequency as much as on
plausibility. On balance the check is worth adding — it is cheap, precise, and the one
time this DID happen, it went unnoticed for six days and three migrations, which is a
worse outcome than a one-time authoring cost for a rule that fires rarely. **Not built in
this pass**, per direct instruction — named here as a candidate addition to
`scripts/lint-migrations.mjs` for whoever next touches that file.
