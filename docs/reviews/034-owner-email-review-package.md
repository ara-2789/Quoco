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
- **(b) trips** — widens `delivery_status`'s `CHECK` on the live `dprs` table; adds three
  new columns to the live `users` table (two PII, plus `whatsapp_declined_at`, a
  consent-state signal added this round — §12b).
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

`users.notification_email`/`notification_email_verified_at`/`whatsapp_declined_at` — no
new RLS policy; inherits `users_select`'s existing (column-agnostic, tracked-open) policy.
See S4, below.

**GRANT LAYER, UPDATED 2026-08-31 (§12d):** `REVOKE ALL ... FROM PUBLIC, anon,
authenticated, service_role`, then `GRANT SELECT, INSERT, UPDATE ... TO service_role` —
matching `031`'s own two-step shape exactly (the prior draft's separate per-role REVOKEs,
still missing `PUBLIC` and `INSERT`, are superseded, not layered on top of).

---

## 5. Composite FK convention (5)

`owner_email_verifications.user_id` → `users(id, tenant_id)`, `ON DELETE CASCADE` — a
verification token has no meaning once its target user row is gone (unlike `dpr_versions`'
`RESTRICT` on an archival author reference, this is disposable state, correctly `CASCADE`).
**ARGUED EXPLICITLY, 2026-08-31 (§12g nit):** contrasted directly with `031`'s own
`RESTRICT` choice so the divergence reads as deliberate, not inconsistent — a verification
token is a DERIVATIVE artifact of its user with no independent retention claim, unlike
`outbound_sends`, a durable billed record that must outlive the user row it references.

**Also added this round (§12g):** a direct `tenant_id REFERENCES tenants(id) ON DELETE
RESTRICT` FK, alongside the composite above — matching `031`'s own declared shape (both a
direct tenant FK and composite FKs), not a correctness fix for a real gap (the composite
already validated `tenant_id` transitively, since `users.tenant_id` is itself FK'd to
`tenants`). Plus two named lifecycle CHECK constraints, the `027` habit applied to an
ordering claim: `expires_at > created_at`, `used_at IS NULL OR used_at >= created_at`.

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

## 12. Delta (2026-08-31) — TWO ROUNDS. A security fix, a value-set decision, a
renumbering, and a full read's worth of follow-on findings

This section documents everything changed across both delta passes on this same date, as
a **delta against round 4's sign-off**, not a fresh review — round 4's own findings (§§1-11
above) stand unless a subsection below says otherwise. §§12a-12e are the first pass
(delivery_status values, WhatsApp-optional decision, copy-drift argument, the SQL edits,
and the renumbering). §§12f-12h are a SECOND external-review pass over that first delta —
a full read of the revised file, not a spot check — and are where the priority finding of
this whole document lives: §12f, the confirm-route security defect.

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
| `no_report_failed` | `no_report_sent` | **CORRECTED, see below** — the WhatsApp *transport* signal exists (`/api/whatsapp/status-callback`, item D, PR #120/#126), but the write to *this column* does not — no propagation logic connects the two. |
| `failed` (existing, re-scoped in meaning, no DDL) | `pm_notified` | Stage 1 (PM-notify) only, going forward |

**CORRECTION (external review, 2026-08-31, same round as the value set itself) — the
`no_report_failed` row above originally read "already built... same mechanism the four
engineer checkpoints already use," which overclaims an end-to-end path. Checked directly
against `lib/whatsapp/outbound/status-callback.ts`: that route's entire mapping logic
targets `outbound_sends.status` and nothing else — it has zero knowledge `dprs` exists.
Two gaps close the distance, neither built:**
1. **No mapping exists from an `outbound_sends` row back to a `dprs` row at all** —
   `outbound_sends`' own `event_key` scheme (031) has no checkpoint name for a no-report
   send yet either.
2. **The relationship is not one-to-one.** The no-report notice is sent once per owner
   per project-day; `dprs` rows are per engineer (028's key widening). One WhatsApp
   outcome for one project-day corresponds to N `dprs` rows, and something must resolve
   which N before any `UPDATE` runs.

Named as an unbuilt requirement sitting *beside* the email webhook, not solved by the
transport route already existing. Full text: `034_owner_email_delivery.sql`'s own
PROPAGATION GAP comment, same wording, pinned there since that's where a future builder
will actually be reading when this matters.

**A second gap in this same subsection, also closed this round — WHEN is `delivered`
stamped?** Previously undecided, and undecided is exactly what produces a row claiming
delivery for a bounced email. **DECIDED: at provider-ACCEPT, not confirmed delivery** —
matching this codebase's own existing precedent for the structurally identical WhatsApp
case (`031`/`outbound_sends`: `status='sent'` is written on Twilio's 2xx, not a later
delivery receipt). Consequence, named rather than left implicit: `delivered ->
owner_send_failed` (and `no_report_sent -> no_report_failed`) is a **legal, expected**
transition, not an edge case — email bounce classification normally arrives minutes to
hours after accept — so a consumer of this column must not treat `delivered` as
permanently final. Full transition table, and the resulting documentation-only
implication for `dpr_versions.delivered_to_owner_at` (029, already live, not altered by
this migration — that column will mean "handed to the provider," matching 031's own
precision for WhatsApp, not "confirmed reached the inbox"): `034_owner_email_delivery.sql`'s
own TRANSITION TABLE comment block, section 2.

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

### 12b. WhatsApp is optional for owners — DECIDED, and its schema follow-up landed in this migration

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
distinguishable. The shape: a nullable timestamp on `users`, `whatsapp_declined_at
TIMESTAMPTZ NULL` — NULL means "not asked / unknown" (the default, including every legacy
row), a timestamp means "asked and explicitly declined at this moment." Identical shape
this migration already uses for `notification_email_verified_at` (§1 of the SQL file) —
proven, not a new pattern. **Explicitly rejected: overloading `whatsapp_number` itself**
with a sentinel value like the literal string `'declined'` — this would need no schema
change, but it corrupts the column's own type (a phone-number column holding a
non-phone string), and any future code path that reads `whatsapp_number` expecting a
dialable number (a reminder flow, an accountability escalation reusing this column) would
silently try to act on the sentinel. A real column, not a string trick, matching this
project's own repeated lesson about reusing a column for something its type doesn't
support.

**REVERSED, 2026-08-31, same review round — LANDED IN 034, not deferred.** This
subsection previously argued the column shouldn't be added yet ("no reader yet" / "do not
design the migration for it yet"). **That argument doesn't survive its own logic, and the
external review took it off the table directly:** "no reader yet" does not distinguish
this column from `notification_email` two lines above it — the WHOLE migration is already
blocked on exactly that reason (its own header: "no code path that ever populates or
reads them"). What "no reader yet" actually leaves undecided is not whether to add the
column, but WHEN the first real owner rows get provisioned relative to when this file
applies — and this IS the migration that makes an owner row provisionable at all (§2j/A1's
operator `INSERT` depends on this file's own columns already existing). Provisioning runs
against whatever schema is live at that moment, not against whatever this package argued
was sufficient in August. Without the column, the first real owner rows collapse
"declined" and "never asked" into one indistinguishable NULL, recoverable only by asking
the owner again — the exact conflation this entry exists to prevent. **Same principle
already established in this codebase for `daily_logs.attendance_defaulted`:** capture the
distinction AT WRITE TIME even when nothing renders or reads it yet — render logic is
cheap to add whenever it's needed; a distinction never captured cannot be reconstructed
after the fact. Added to the migration body — `034_owner_email_delivery.sql`, §1.

### 12c. Copy drift between the WhatsApp template and its email fallback — a shared source, tested against what was actually approved

**Question:** §37(d)/12b's email fallback and the Meta-approved WhatsApp template
(`docs/whatsapp-templates.md` template 14, `quoco_dpr_owner_no_report`) now carry the
same "no report today" content on two channels with very different edit costs — the
WhatsApp body is frozen the moment Meta approves it (a wording fix requires a whole new
template + re-approval cycle); the email copy can be edited and deployed in a minute.

**REFINED, 2026-08-31, same review round — a shared source ALONE was insufficient, taken
directly, not softened.** The original argument here (below, kept for the reasoning that
still holds) proposed one shared constant. **The gap in that alone:** a shared constant
prevents the two channels DISAGREEING inside this repo, but it does not prevent the
constant itself DRIFTING from what is actually live and immutable at Meta under an HX
SID — one rendering (WhatsApp) is frozen the moment it's approved, the other (the
constant) is not, so "shared source" only holds the guarantee at the instant the constant
is first written, not afterward. Someone can edit the constant to improve the email
wording eleven months from now, and nothing stops them — the constant still renders
identically on both channels, which is exactly the false confidence that lets it drift
from the WhatsApp side actually deployed.

**The correct shape, argued from that gap, not asserted:**
1. The constant **IS** the approved template body — not a paraphrase of it, the literal
   string recorded as approved for this template's current HX SID
   (`docs/reviews/whatsapp-template-submission-status.md`'s own log row).
2. The email renderer renders FROM that constant (unchanged from the original proposal —
   still eliminates in-repo disagreement between the two channels).
3. **A test asserts the constant still equals the recorded-approved body for that HX SID**
   in the submission-status doc — not against `docs/whatsapp-templates.json`'s current
   draft body (which could itself be mid-edit, pre-resubmission), against the doc that
   records what Meta actually approved.

This makes the only honest workflow the only POSSIBLE one: editing the constant to change
the wording fails the test immediately, unless the edit also comes with a new template
version submitted and recorded in the submission-status doc (the existing 1v2/1v3-style
versioning precedent — a new HX SID, a new log row) in the SAME change. A wording change
becomes "new template version + constant change," together, or it doesn't ship — never a
silent constant edit that quietly stops matching what Meta actually serves.

**Why this still isn't the `checkBodyDriftAgainstMarkdown` shape, restated against the
sharper design:** that check compares two DRAFT representations (JSON vs. markdown,
pre-submission) and exists because the markdown is legitimately independent, human-authored
prose with its own purpose (documentation, review commentary, sample-value history) that
can't be collapsed into the JSON. The email copy has no such independent purpose — point
2 above still holds unchanged. What's sharper this round is WHAT the constant is checked
against: not another draft, but the recorded ground truth of what was actually approved —
closer in spirit to comparing against reality than to comparing two authored copies of an
intention.

**Recorded, not built:** no email renderer exists yet (§2h of the plan, still open). Both
the shared-constant mechanism and its test are build-time requirements for whoever writes
it — cross-referenced from `whatsapp-templates.md`'s own template 14 entry so neither is
discovered independently later.

### 12d. The SQL edits from the first delta pass, applied (§12f/§12g cover the second pass's own edits)

- **12a's three new `delivery_status` values** added to the widened CHECK (§2 of the SQL
  file).
- **`owner_email_verifications`' missing `service_role` REVOKE**, added — **REWRITTEN A
  SECOND TIME, 2026-08-31, same round, to MATCH `031`'s OWN SHAPE** (external review nit:
  031's REVOKE names `PUBLIC` alongside the three roles; the first fix in this same round
  did not). Now: `REVOKE ALL ... FROM PUBLIC, anon, authenticated, service_role;` then
  `GRANT SELECT, INSERT, UPDATE ... TO service_role;` — same two-step shape `031` already
  established, not a third variant of the same idea. **`service_role`'s real need was also
  corrected while matching the shape**: TWO legitimate callers, not one — the
  confirmation-send operator script (§2j/A1 step 3, mints the token/row) needs INSERT; the
  confirm route (§5) needs SELECT + UPDATE. The prior fix's own comment named only
  SELECT/UPDATE and omitted the minting script's INSERT need entirely. **This is the
  FOURTH confirmed instance of the underlying default-ACL pattern CLAUDE.md's standing
  rule (2026-08-26) now names** — `dpr_versions` (029, live), `031_outbound_send_
  ledger.sql` (caught pre-apply by its own rehearsal), and this file's own two earlier
  drafts, now fixed before any rehearsal ever ran against either. **Worth recording as a
  real limit of the 2026-08-26 grep sweep, not just a fourth data point:** that sweep
  would have scanned `supabase/migrations/`, the directory every apply/rehearsal tool
  reads — this file sat in `docs/reviews/` the entire time (correctly, per BB2), which is
  exactly why a migrations-directory grep missed it. A future sweep for this pattern
  needs to also cover `docs/reviews/*.sql` — held-but-unapplied migrations are not exempt
  from a defect class just because they haven't shipped yet. §12h below closes this
  mechanically, not just as a recorded lesson.
- **The `whatsapp_number` provisioning gap (12b) — LANDED IN THIS MIGRATION**, reversing
  the prior round's deferral. `users.whatsapp_declined_at TIMESTAMPTZ NULL` added to §1 of
  the SQL file. Full argument for the reversal: §12b above.
- **`delivery_status`'s transition table and the `no_report_failed` writer correction —
  both closed this round.** §12a above; full text in `034_owner_email_delivery.sql`'s own
  TRANSITION TABLE and PROPAGATION GAP comment blocks, section 2.
- **The confirm-email route's GET-verifies defect — fixed as prose, before any route
  exists.** §12f below (security finding S, the priority item this round).
- **Three schema nits — all fixed in §3's `CREATE TABLE owner_email_verifications`
  block:** a direct `tenant_id REFERENCES tenants(id)` FK alongside the composite one
  (matching `031`'s own declared shape); an explicit one-sentence argument for why
  `ON DELETE CASCADE` is correct here where `031` uses `RESTRICT` (a verification token is
  a derivative artifact of its user, no independent retention claim — contrasted with
  `031`'s durable billed record); two named lifecycle CHECK constraints
  (`expires_at > created_at`, `used_at IS NULL OR used_at >= created_at`), the `027`
  (`checkin_escalations`) habit of one named CONSTRAINT per timestamp fact, applied here
  to an ordering claim for the first time. §12g below.

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

**Should migration-lint check this? Argued in the prior round; BUILT this round, as its
own small PR — §12h below.** The prior round argued a check of the shape "any file in
`docs/reviews/` matching `^[0-9]{3}_` whose number already exists in
`supabase/migrations/` fails the build" was worth adding, cheaply, and left it unbuilt.
External review went further this round — detection alone is the weaker half of a real
fix — and asked for it built, plus two things the prior argument didn't cover at all: (a)
held numbers checked against EACH OTHER, not only against `supabase/migrations/` (026 and
034 both sit in `docs/reviews/` today — nothing compared them to each other, only each to
the applied directory); (b) a reservation manifest the lint reads, so a number claimed at
PLAN TIME is protected before any file exists — formalising what `CLAUDE.md §3`'s own
prose already did informally once (`session-transition-lock-wait-flake.md`'s "031 already
informally reserved by CLAUDE.md §3's own text" — it worked precisely because it was
written down somewhere a later author actually read); (c) every existing lint rule — not
just the collision check — run over `docs/reviews/*.sql` too, the mechanical fix for the
sweep-scope limit `service_role`'s own fourth-instance finding (§12d above) exposed.
Delivered as `docs/prod-hardening-backlog` (or wherever it lands) — a separate small PR,
not folded into this migration's own diff, since it touches tooling that applies to every
migration, not just this one. Full design, including the recorded-but-not-implemented
number-at-promotion / slug-while-held design change that would make the whole collision
CLASS structurally impossible: §12h.

### 12f. THE PRIORITY FINDING — the confirm route verified on prefetch, a real double
opt-in bypass, fixed while it is still prose

**Found on a full external-review read of this file after the first delta pass, not on a
spot check — this is the finding that made a second review pass worth doing.**

**The defect, as originally specified (now superseded, kept here so the fix's reasoning
survives alongside it):** a single GET to `app/api/owner/confirm-email/route.ts?token=...`
both looked up the token AND, if valid, wrote `used_at`/`notification_email_verified_at`
in the same request — verification happened on GET.

**Why this is a real bypass, not a hardening nice-to-have.** Corporate mail gateways
(Microsoft Safe Links and equivalents) fetch every link in an email automatically, on
arrival, before a human ever opens the message — a GET indistinguishable, at the HTTP
layer, from the owner's own click. Under the original design, the SCANNER'S prefetch
confirms the owner's email address, with zero human intent involved — a double opt-in
bypassed by the exact automated-fetch mechanism double opt-in exists to defeat. The milder
failure is also real and would have shipped invisibly: the token burns on the scanner's
prefetch, the real owner clicks later, sees "link expired or already used," and nothing
distinguishes that outcome from a genuinely stale link — same row state either way
(`used_at IS NOT NULL`), wrong actor.

**FIX, applied to the SQL file's own trailing APPLICATION-LAYER SPEC comment (§3 above,
"not restated from the plan" — full text lives there, not duplicated here per this
document's own provenance discipline): GET renders, POST consumes.** GET looks up the
token and, if valid, renders an HTML confirmation page CARRYING the token (a hidden form
field, not a second query-string round trip) with a single visible confirm button — the
GET handler itself never writes anything. A human's POST from that page's own form is the
only path that runs the write (hash, re-validate, `UPDATE users`/`UPDATE
owner_email_verifications` in one transaction, unchanged from the original spec). A
scanner's automated GET fetches a page and stops; there is no button for it to click, and
fetching performs no write.

**Named, not solved further (per direct instruction) — the token still transits the URL
on the GET.** A link is the only thing an email can carry, so the raw token necessarily
appears in the GET's own URL, which lands in ordinary places a request body does not
(server/proxy/CDN access logs, browser history). Two things already bound this, not
eliminate it: `token_hash` is what's stored (a logged raw token can't be reconstructed
from the database), and `used_at` makes the token single-use (a logged token is worthless
once the real POST has run). The fix above removes the token from the CONSUMING write's
own request; it cannot and does not remove it from the GET's URL. Accepted as a residual,
bounded risk.

### 12g. Three schema nits, closed

All three landed directly in `034_owner_email_delivery.sql`'s `CREATE TABLE
owner_email_verifications` block (§5 above carries the summary against each existing
finding; full reasoning lives in the SQL file's own comments, not duplicated twice):
- Direct `tenant_id REFERENCES tenants(id) ON DELETE RESTRICT` FK, matching `031`'s own
  declared shape (a direct FK alongside the composite), not a correctness fix for a real
  gap — the composite already validated `tenant_id` transitively.
- One-sentence argument for `ON DELETE CASCADE` on the `user_id` FK, contrasted explicitly
  with `031`'s own `RESTRICT`: a verification token is a derivative artifact of its user
  with no independent retention claim, unlike a durable billed send record.
- Two named lifecycle CHECK constraints (`expires_at > created_at`, `used_at IS NULL OR
  used_at >= created_at`) — the `027` (`checkin_escalations`) habit of one named
  CONSTRAINT per timestamp fact, applied here to an ordering claim for the first time in
  this codebase (027's own four checks are all "this status implies that timestamp is
  set," a related but different shape).

### 12h. The migration-lint enhancement — built, its own small PR; and the design change
that would make the collision class structurally impossible, recorded, not built

**Delivered as its own PR, not folded into this migration's diff** — the lint script
applies to every migration, held or applied, not specifically to this one, and this
migration's own diff should stay reviewable as "the owner-email schema," not entangled
with unrelated tooling.

**What was built, matching the three asks exactly:**
- **(a) Held numbers compared against each other, not only against
  `supabase/migrations/`.** `026_dpr_generation_stale.sql` and `034_owner_email_
  delivery.sql` both sit in `docs/reviews/` today — nothing before this compared them to
  EACH OTHER, only each independently against the applied directory. `scripts/lint-
  migrations.mjs`'s existing `ruleUniqueMigrationPrefix` already does the right thing
  once given the right input: it was scoped to `supabase/migrations/`'s own file list
  alone. Widened to take the UNION of applied (`supabase/migrations/*.sql`) and held
  (`docs/reviews/^[0-9]+_.*\.sql$`) filenames — a held-vs-applied collision (030's own
  defect class) and a held-vs-held collision are now the SAME check, not two, since both
  are just "does a prefix repeat across the combined set."
- **(b) A reservation manifest the lint reads.** New `scripts/migration-number-
  reservations.json` — `{number, claimedBy, note}` triples, human-maintained, checked in.
  Formalises what `CLAUDE.md §3`'s own prose already did once, informally
  (`docs/reviews/session-transition-lock-wait-flake.md`: "031 (already informally
  reserved by CLAUDE.md §3's own text for the '#69/031 outbound-send primitive')" — this
  worked only because a later author happened to read that specific paragraph before
  numbering their own file; nothing checked it automatically). New rule: every held file
  (`docs/reviews/^[0-9]+_.*\.sql$`) MUST have a manifest entry whose `number` matches its
  filename prefix and whose `claimedBy` matches its actual path — a held file with no
  entry, or an entry pointing at a different file than the one actually using that
  number, both fail. `026` and `034` both seeded with entries as part of this same PR, so
  the rule starts clean, not immediately red.
- **(c) Every existing lint rule run over `docs/reviews/*.sql` too**, not just the new
  collision/reservation checks. `main()`'s file-reading loop now reads BOTH directories
  and runs all eight rules (the original six content rules, unchanged; rule 7 widened
  in place for (a) above, not counted as new; the reservation check as a genuinely new
  rule 8 for (b)) against the union — the mechanical fix for the exact sweep-scope limit
  `service_role`'s own fourth-instance finding (§12d) exposed: a migrations-directory-only
  sweep cannot catch a defect in a file that, correctly, doesn't live there yet.

**Recorded, NOT implemented this pass, per direct instruction — the design change that
makes the collision CLASS vanish, not just get caught faster.** A migration's number is
fundamentally an APPLY-ORDER fact — and apply order is unknowable while a file is still
held, by definition (that's what "held" means: not yet scheduled against the sequence of
everything else that might apply first). The current convention asks an author to pick a
number AT WRITE TIME, when that fact doesn't exist yet — which is exactly the condition
that let 030's collision happen at all. The alternative: a held file carries a SLUG (a
short descriptive name, no number) while it lives in `docs/reviews/`, and receives its
actual number ONLY at promotion — the same commit/session that moves it into
`supabase/migrations/` to be applied (already this project's own BB2 convention for WHEN
a file moves; this extends the same convention to WHEN it gets numbered). Under this
design, two held files can never collide with each other or with a not-yet-existing
future migration, because neither has claimed a number until the moment apply order is
actually being decided. **Not implemented in this pass — `026` gets the same treatment
only when its own don't-touch status lifts** (it is not this migration's workstream to
touch), and converting the CONVENTION itself (updating `docs/migration-runbook-template.md`,
deciding whether already-held files like `026` get grandfathered or migrated) is real,
separate design work, named here so it has somewhere durable to live, not designed
further in this pass.
