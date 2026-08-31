# Migration 034 review package — owner-email delivery (sequencing block LIFTED 2026-08-31 — §12i; own pre-apply checklist remains, §11)

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

**Status: WRITTEN, NOT APPLIED, NOT REHEARSED.** ~~BLOCKED~~ — the sequencing block is
LIFTED, 2026-08-31, deliberately, on the record (§12i) — this package now accompanies
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

**Sequencing (external review, split-package decision, 2026-08-19) — LIFTED 2026-08-31,
§12i, not silently dropped:**

~~BLOCKED on the trigger-cron workstream — no cron exists yet for `ownerSend`
(`lib/daily-logs/cutoffs.ts`'s own header: "the `ownerSend` cron entry is NOT yet in
`vercel.json`"), and no code path exists to populate or read
`notification_email`/`notification_email_verified_at` until it does. Applying this schema
now would add live PII columns and a public verification surface with nothing consuming
them. Written now so the package is complete and the next artifact, once trigger-cron
lands, is a go-ahead to apply, not another design pass.~~

Correct when written; **NOT circular, corrected 2026-08-31 (external review, second
pass)** — the consumer can be written and held on a branch, merged the moment this file
applies, ordinary apply-then-merge sequencing (033's own pattern), not a rewrite. The
actual reason it lifts: the 2026-08-19 guard conflated the SCHEMA with the SURFACE — this
file alone creates inert, empty, unreachable objects; the real exposure is born when the
confirm route deploys, and the guard relocates to THAT PR's own merge gate, not this
one's apply. Full reasoning: §12i. **Lifting sequencing does not clear this migration to
apply** — §11's own pre-apply checklist (disposable scaffold, written-and-executed
rollback — both done, §12i — a fresh external-review round, test-db rehearsal, an apply
runbook) is the gate now.

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

**TEST-DB rehearsal: DONE, 2026-08-31 — §14.** This section originally distinguished §13's
disposable LOCAL scaffold evidence (proves the file parses and applies cleanly against a
real structural dump) from an actual test-db rehearsal (§7's own standing "this is NOT the
test-db rehearsal" rule) and left the latter as future work. It is no longer future work —
§14 has the full account: apply, ledger, the complete structural probe including the
`service_role` negative-capability check, both rollback branches (guard fires on a seeded
row, clean path succeeds once resolved), re-apply, and the migration left live on test-db
per direct instruction (the consumer's integration tests need it there).

---

## 11. Apply runbook

Per `docs/migration-runbook-template.md`, adapted below in full for this migration.
**Status of the checklist §12i named: (a) and (b) done, §13. (c) — this package has now
been through a design-GO round with two blocking findings fixed (§12i itself: the lift's
own reasoning corrected in place; §13b: the rollback's blocking gap fixed and re-verified)
— treated as the fresh external-review round this checklist required. (d) — test-db
rehearsal complete, §14. (e) — this section, now written in full, including the
ledger-repair workaround and
the promotion-time number re-verification (§12m).** Prod apply itself remains a SEPARATE,
Aravind-executed action (SQL Editor, by hand) — writing this runbook is not authorization
to run it.

### Strict-alternation apply checklist — PROD (mirrors the template's A–E exactly)

Point the SQL Editor at **prod** (`jvxwqignooseazzmwhvl` — confirm the project ref
selector visually, not the test-db branch) before any write step. Wait for owner confirm
at each lettered step, per the template's own discipline.

**A. PITR window observation (no SQL).** Dashboard → Database → Backups → Point in Time.
Observe an active restore window ending ~now. Record the timestamp. **Verified by
observation, per CLAUDE.md §0 — a "PITR provisioned" checklist line is not evidence; the
dashboard state is.** → confirm before B.

**B. Pre-apply state probe (read-only).** Confirms prod has never seen this migration —
mirrors the probe already run clean against test-db pre-apply (§14):
```sql
SELECT
  (SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
     AND table_name='users' AND column_name IN
     ('notification_email','notification_email_verified_at','whatsapp_declined_at')
  ) AS users_new_columns_expect_0,
  (SELECT count(*) FROM pg_tables WHERE tablename='owner_email_verifications'
  ) AS token_table_expect_0,
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname='dprs_delivery_status_check') AS current_check_expect_5_values,
  (SELECT version FROM supabase_migrations.schema_migrations WHERE version='034'
  ) AS ledger_row_expect_null;
```
PROCEED only if: `users_new_columns_expect_0 = 0`, `token_table_expect_0 = 0`,
`current_check_expect_5_values` is the bare 023 five-value CHECK, `ledger_row_expect_null`
is NULL. **STOP on anything else** — any non-zero/non-null result means this migration (or
something claiming its objects) already touched prod, and applying again would not be a
first apply. → confirm before C.

**C. Apply (write).** Fresh SQL Editor tab, full paste of the PINNED SQL —
`git show <sha-of-this-commit>:docs/reviews/034_owner_email_delivery.sql` — deselect (a
stray highlight runs "only this"), Run. Paste the result. → confirm before D.

**D. Post-apply probes (read-only) — THE FINGERPRINT SPEC, per direct instruction. Every
line below is the exact probe already run and matched against real test-db, §14 — not a
first-time spec, the proven one, re-pointed at prod.** One query, one result set, every
line individually checkable against the design, not summarised:**
```sql
SELECT
  (SELECT pg_get_constraintdef(oid) FROM pg_constraint
     WHERE conname = 'dprs_delivery_status_check') AS delivery_status_check,
  (SELECT jsonb_agg(jsonb_build_object('column_name', column_name, 'data_type', data_type,
     'is_nullable', is_nullable) ORDER BY column_name)
     FROM information_schema.columns WHERE table_schema='public' AND table_name='users'
     AND column_name IN ('notification_email','notification_email_verified_at','whatsapp_declined_at')
  ) AS users_new_columns,
  (SELECT jsonb_agg(jsonb_build_object('conname', conname, 'contype', contype,
     'def', pg_get_constraintdef(oid)) ORDER BY conname)
     FROM pg_constraint WHERE conrelid = 'public.owner_email_verifications'::regclass
  ) AS owner_email_verifications_constraints,
  (SELECT relrowsecurity FROM pg_class WHERE relname='owner_email_verifications') AS rls_enabled,
  (SELECT count(*) FROM pg_policies WHERE tablename='owner_email_verifications') AS policy_count,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'DELETE') AS service_role_can_delete,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'TRUNCATE') AS service_role_can_truncate,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'REFERENCES') AS service_role_can_references,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'TRIGGER') AS service_role_can_trigger,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'SELECT') AS service_role_can_select,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'INSERT') AS service_role_can_insert,
  has_table_privilege('service_role', 'public.owner_email_verifications', 'UPDATE') AS service_role_can_update,
  has_table_privilege('anon', 'public.owner_email_verifications', 'SELECT') AS anon_can_select,
  has_table_privilege('authenticated', 'public.owner_email_verifications', 'SELECT') AS authenticated_can_select;
```
Expected values, stated so a PROCEED/STOP decision does not require re-deriving them from
the design at apply time:
- `delivery_status_check` — all 11 values: `pending, pm_notified, delivered, paused,
  skipped_no_data, skipped_no_template, skipped_unverified, failed, no_report_sent,
  owner_send_failed, no_report_failed`.
- `users_new_columns` — exactly 3 rows, all `is_nullable: YES`.
- `owner_email_verifications_constraints` — exactly 6 rows: `_pkey` (p), `_token_hash_key`
  (u), `_expires_after_created` (c, `expires_at > created_at`), `_used_after_created` (c,
  `used_at IS NULL OR used_at >= created_at`), `_tenant_id_fkey` (f, direct, `REFERENCES
  tenants(id) ... ON DELETE RESTRICT`), `_user_id_fkey` (f, composite, `REFERENCES
  users(id, tenant_id) ... ON DELETE CASCADE`).
- `rls_enabled` — `true`; `policy_count` — `0`.
- `service_role_can_{delete,truncate,references,trigger}` — all `false`.
- `service_role_can_{select,insert,update}` — all `true`.
- `anon_can_select` / `authenticated_can_select` — both `false`.

→ confirm before E.

**E. Ledger repair (write) + verify.** `supabase migration repair --status applied 034
--linked`, breadcrumb confirmed first (project ref printed in the same output as the
command, per CLAUDE.md's standing rule). **Named as its own step, not optional
scaffolding, per the template's own post-030 correction.**

**KNOWN FRICTION, hit for real during test-db rehearsal (§14), documented here so prod
apply does not rediscover it:** `migration repair` globs the LOCAL `supabase/migrations/`
directory to resolve a bare version number to a filename — it does not operate on the
number alone. Since `034_owner_email_delivery.sql` correctly lives in `docs/reviews/`
until this exact moment (BB2), the repair command has nothing to resolve `034` against
unless the file is present there. Workaround, same as 031/033's own apply records:
1. `cp docs/reviews/034_owner_email_delivery.sql supabase/migrations/034_owner_email_delivery.sql`
   (working tree only — **do not commit this copy**).
2. `supabase migration repair --status applied 034 --linked`.
3. `rm supabase/migrations/034_owner_email_delivery.sql` **immediately** — leaving it in
   place is a live hazard the same shape as the 026 incident (any tool that globs
   `supabase/migrations/` decides what's pending by diffing that directory against the
   ledger).
4. Confirm clean: `git status --porcelain supabase/migrations/` returns nothing.

Follow with `supabase migration list --linked` and confirm `034` now appears with
`remote: 034`. **This is the moment 034 is actually promoted** — per CLAUDE.md's own
"a migration is not done when applied and ledgered, it is done when the file is on `main`"
rule, the REAL promotion (moving `034_owner_email_delivery.sql` from `docs/reviews/` to
`supabase/migrations/` as a real, committed change, in the same commit/session as this
apply) is Aravind's own next action after E confirms — not before, and not silently
deferred past this session.

### Promotion-time number re-verification (§12m — item 3, run now, not assumed)

**Checked 2026-08-31, same session as this runbook, not carried over from an earlier
check:** `supabase/migrations/` on `origin/main` runs through `033`; `docs/reviews/`'s own
numbered `.sql` files are `026` and the two `028` historical entries — **034 remains
free**, confirmed by direct listing, not inferred from the reservation manifest alone.
`scripts/migration-number-reservations.json` on `origin/main` still carries `034 ->
docs/reviews/034_owner_email_delivery.sql`, matching the actual file.

**The new migration-lint rule's first real use, tested for real, not asserted:** copied a
throwaway file into `supabase/migrations/034_fake_collision_test.sql` (content borrowed
from `026_dpr_generation_stale.sql`, irrelevant to the test) to simulate the exact 030-style
incident — a different migration claiming 034's number while this file sits held. Result:
```
migration-lint: 2 violation(s) not covered by scripts/migration-lint-exceptions.json:

  034_fake_collision_test.sql: duplicate-prefix-034  [unique-migration-prefix]
  docs/reviews/034_owner_email_delivery.sql: duplicate-prefix-034  [unique-migration-prefix]
```
**It catches it — both files flagged, immediately, no exceptions entry to hide behind.**
Confirmed clean again after removing the throwaway file. **Re-run this exact check at the
moment of actual promotion, not trusted from this session's own result** — a genuine
collision could still land between now and the real apply, which is precisely the failure
mode this whole rule exists to catch.

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

### 12i. The sequencing BLOCK is LIFTED — DECIDED, recorded as a deliberate lift, not a lapse

**CORRECTED 2026-08-31, external review, second pass over this same entry — the
"CIRCULAR" framing below was wrong, not just imprecise, and the entry is corrected in
place rather than left standing (this project's own audit discipline: a document
submitted for review is checked for the CLAIM, not just the conclusion). The conclusion
(lift the block) survives; the reasoning that got it there is replaced below.**

**DECIDED (Aravind, 2026-08-31).** The "BLOCKED on the trigger-cron workstream" sequencing
decision (external review, 2026-08-19 — §12/status block above, and the SQL file's own
header) is lifted. Recorded as a lifted block WITH reasoning, on purpose: a standing rule
quietly stopped once, with no record of why, reads as noise the next time it fires — this
project's own history (the CRON_SECRET section of CLAUDE.md, the migration-lint sections
above) is full of exactly that failure shape. This entry is the record.

**Why the original guard was right when it was written.** Applying live PII columns
(`notification_email`, `notification_email_verified_at`, and this session's
`whatsapp_declined_at`) and a public, unauthenticated verification surface
(`owner_email_verifications`) with genuinely nothing consuming either would have left dead
schema sitting in production for weeks — real attack surface, real PII exposure, zero
offsetting benefit. The guard was doing its job.

**What actually changed is the DISTANCE to the consumer, not the principle behind the
guard.** Checked against live code, not the plan, in the immediately preceding turn of
this session:
- **#69's outbound-send primitive now exists and is proven end-to-end** — `lib/whatsapp/
  outbound/{send,templates,roster,trigger,checkpoint-trigger,coverage-sweep,
  status-callback}.ts` are all real, and `docs/reviews/first-successful-delivery-record.md`
  (2026-08-31) confirms a real WhatsApp send/receive round trip. This is the half of the
  original guard's two named conditions that has genuinely resolved.
- **The `ownerSend` cron entry does not exist, and correctly should not yet** —
  `vercel.json` carries no such entry; `lib/daily-logs/cutoffs.ts`'s own header is
  unchanged: "deliberately deferred to the PR that ships the owner-deliver route... a cron
  pointing at a route that doesn't exist yet would 404 nightly." This is right, not a gap
  to force closed — a cron ships WITH its route, never ahead of it.

**NOT CIRCULAR — corrected. The consumer can be written and held on a branch, merged the
moment this file applies.** That is ordinary apply-then-merge sequencing, the exact
pattern migration 033 already used for its own function — write, review, hold, merge once
the dependency is live. Nothing about "the schema doesn't exist yet" prevents the
`eveningClose`/`ownerSend` trigger routes or the confirm-email route from being written,
code-reviewed, and unit-tested today. **The real coupling, stated at its actual size, not
inflated to a cycle: the consumer's INTEGRATION TESTS cannot run against test-db until
this migration is applied there** — the identical test-schema dependency migration 030's
own mirror tests had on that migration before it applied. That is a real, ordinary
sequencing cost (hold two artifacts in loose step for the length of a review cycle), not
a dependency cycle — and the actual hazard it creates is narrower too: not "the code gets
rewritten," but "holding a written-and-tested-at-the-unit-level consumer on a branch for
days is exactly the kind of gap where someone forgets to finish wiring it up," the
ordinary remember-to-revisit hazard, not a structural impossibility.

**THE ACTUAL REASON THE GUARD LIFTS — the reviewer's own correction, adopted here: the
2026-08-19 guard conflated the SCHEMA with the SURFACE.** This migration, applied alone,
creates:
- Two nullable PII columns (`notification_email`, `notification_email_verified_at`) —
  populated by NOTHING; no code path writes them.
- One nullable consent-state column (`whatsapp_declined_at`) — same, empty.
- One EMPTY table (`owner_email_verifications`) — RLS enabled, ZERO policies, and (§4,
  §12d) no grant to `anon`, `authenticated`, or `PUBLIC` at all. Nothing that can reach
  this table exists yet, because the ONE thing that could reach it — the confirm-email
  route — has not been written.

None of this is exploitable on its own. An empty table nothing can query, and null
columns nothing has populated, carry no real PII exposure and no real attack surface —
the ACTUAL public, unauthenticated write surface the original guard was protecting
against is born the moment the CONFIRM ROUTE deploys (real application code, a real
reachable endpoint), not the moment this migration applies. **Applying this schema inert
is the exact shape migration 029 already used** — `dpr_versions` and `write_dpr_version()`
shipped and went live before the DPR regenerate-action UI that would ever call them
existed, and that was correctly not treated as premature exposure, because a mechanism
with no caller is not a surface. The same reasoning applies here, one migration later —
recognized this round, not a new precedent invented for it.

**THE GUARD DOES NOT DISAPPEAR — IT RELOCATES, to the confirm-route PR's own merge gate.**
Stated explicitly so it's a checkable condition, not a vibe: that PR
- ships WITH rate limiting and the GET-renders/POST-consumes split (§12f) as gate
  conditions, not optional hardening to add later;
- carries its OWN §0(c) gate evaluation (it is the piece that actually touches identity in
  a live, reachable way — this migration's own §0(c) trip was about the SCHEMA existing
  for that surface, the route PR's trip is about the surface itself going live);
- does NOT merge before this migration is confirmed live on prod — CONFIRMED, per
  CLAUDE.md's own standing rule, meaning observed directly (a live catalog probe), never
  assumed from an "applied" label or a ledger row alone.

**Owner delivery is now the immediate next build, not an indefinite one — this is what
actually makes lifting the block safe, not merely convenient.** In August, applying this
schema early would have meant weeks of unused PII surface with nothing scheduled to touch
it. Today, per the independent-slice work starting in parallel (email renderer, §37(c)'s
gating decision) and the trigger-route/confirm-route work this migration directly
unblocks, the distance from "schema applied" to "schema consumed" is days, not an
open-ended wait. **The rationale expired; the sentence describing it did not, until this
entry.**

**What lifting the block does NOT do — stated so it isn't overclaimed.** This migration is
not cleared to apply. Sequencing was the ONE gate this entry addresses; the migration's
own remaining pre-apply work (§11's ordered list — disposable scaffold, written-and-
executed rollback, a fresh external-review round over the consolidated file, test-db
rehearsal with the `service_role` negative-capability probe, an apply runbook with the
number re-verified at promotion) is unchanged and un-skippable. Lifting sequencing moves
this file from "blocked on a workstream that hasn't started" to "blocked on its own
remaining checklist" — a real change in status, not a green light to apply.

---

## 13. Pre-apply checklist items (a) and (b) — executed, raw evidence, not asserted

**Both run 2026-08-31, same session as §12i's block-lift decision.** Per CLAUDE.md §7's
disposable-dry-run rule and this project's own standing "verified by direct observation,
never by trusting a checklist status" discipline — commands and output pinned below, not
paraphrased.

### 13a. Disposable local scaffold — the WHOLE consolidated file, run for the first time

**Never run as a whole before this pass** — this session's entire delta (transition table,
`whatsapp_declined_at`, the REVOKE rewrite, the GET/POST security fix, three schema nits)
had only ever been read, never executed. The last two migrations to skip this step each
found a real defect at exactly this point (029's inline-FK ordering bug, 031's first-draft
`service_role` grant gap) — treated with the same seriousness here, not as a formality.

**Environment, matched to the standing rule, not assumed:** local Postgres 17.11
(Homebrew) — the linked project's own cached `postgres-version` reads `17.6.1.127`, same
major version, per CLAUDE.md §7's `POSTGRES VERSION MUST MATCH THE SERVER` requirement.
`pgvector` confirmed installed locally (required — the real structural dump references
`public.vector(1536)` on three tables: `boq_items`, `rate_catalog`,
`tender_document_chunks`).

**1. Real structural dump, not hand-built** (CLAUDE.md §7's own requirement — a hand-built
scaffold can only ever agree with the file being tested):
```
$ supabase db dump --linked --schema public --dry-run   # script only, redirected straight
                                                          # to a file per CLAUDE.md's own
                                                          # credential-safety rule (this
                                                          # exact command embeds a live
                                                          # PGPASSWORD line) -- never printed
$ bash <dry-run script> > schema.sql
```
Result: `schema.sql`, 171,923 bytes, 29 `CREATE TABLE` statements, zero `ERROR` lines in
the load log — grepped for `PGPASSWORD`/`postgres://`/`postgresql://` before this package
was written to confirm the dump output itself carries nothing sensitive (0 matches; the
credential lives only in the invocation script, never in the dump it produces).

**2. Named stubs, per CLAUDE.md §7's own list, nothing beyond it:**
```sql
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE ROLE supabase_auth_admin NOLOGIN CREATEROLE;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE FUNCTION auth.uid() RETURNS uuid AS $$ SELECT NULL::uuid $$ LANGUAGE sql STABLE;
```
All eight statements: `CREATE ROLE` x4, `CREATE EXTENSION`, `CREATE SCHEMA`, `CREATE
TABLE`, `CREATE FUNCTION` — no errors.

**3. Load the real dump** — `psql -f schema.sql`, `ON_ERROR_STOP=1`: **exit 0, zero
`ERROR` lines.** The full, real prod/test-db structure (functions, RLS policies, grants,
all 29 tables) now exists in the disposable cluster.

**4. Apply `034_owner_email_delivery.sql` itself** — `psql -f
docs/reviews/034_owner_email_delivery.sql`, `ON_ERROR_STOP=1`:
```
BEGIN
ALTER TABLE
COMMENT
ALTER TABLE
ALTER TABLE
CREATE TABLE
CREATE INDEX
ALTER TABLE
REVOKE
GRANT
COMMENT
COMMIT
```
**Exit 0. Every statement in the file — parses, ordering, referenced objects — succeeded
against the real structure, for the first time.**

**5. Structural verification, not just "it applied":**
```sql
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'dprs_delivery_status_check';
```
```
CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'pm_notified'::text, 'delivered'::text,
'paused'::text, 'skipped_no_data'::text, 'skipped_no_template'::text,
'skipped_unverified'::text, 'failed'::text, 'no_report_sent'::text, 'owner_send_failed'::text,
'no_report_failed'::text])))
```
All 11 values present, matching §12a's design exactly.
```sql
SELECT column_name, data_type, is_nullable FROM information_schema.columns
WHERE table_schema='public' AND table_name='users'
  AND column_name IN ('notification_email','notification_email_verified_at','whatsapp_declined_at');
```
```
          column_name           |        data_type         | is_nullable
---------------------------------+---------------------------+-------------
 notification_email             | text                     | YES
 notification_email_verified_at | timestamp with time zone | YES
 whatsapp_declined_at           | timestamp with time zone | YES
```
```sql
SELECT conname, contype, pg_get_constraintdef(oid)
FROM pg_constraint WHERE conrelid = 'public.owner_email_verifications'::regclass;
```
```
 owner_email_verifications_expires_after_created | c | CHECK ((expires_at > created_at))
 owner_email_verifications_pkey                  | p | PRIMARY KEY (id)
 owner_email_verifications_tenant_id_fkey        | f | FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT
 owner_email_verifications_token_hash_key        | u | UNIQUE (token_hash)
 owner_email_verifications_used_after_created    | c | CHECK (((used_at IS NULL) OR (used_at >= created_at)))
 owner_email_verifications_user_id_fkey          | f | FOREIGN KEY (user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE
```
Both nits' constraints (§12g) present exactly as designed: the direct `tenant_id` FK, and
both lifecycle CHECKs.
```sql
SELECT grantee, privilege_type FROM information_schema.role_table_grants
WHERE table_schema='public' AND table_name='owner_email_verifications'
  AND grantee IN ('service_role','anon','authenticated','PUBLIC');
```
```
   grantee    | privilege_type
--------------+----------------
 service_role | INSERT
 service_role | SELECT
 service_role | UPDATE
```
**Exactly** `service_role`: INSERT, SELECT, UPDATE — no DELETE/TRUNCATE/REFERENCES/TRIGGER,
and `anon`/`authenticated`/`PUBLIC` hold **zero** rows in this result — confirms the §12d/
§12g REVOKE rewrite (matching `031`'s own shape) actually produced the intended privilege
set on a real Postgres instance, not just in the SQL text.
```sql
SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE relname='owner_email_verifications';
-- t | f
SELECT count(*) FROM pg_policies WHERE tablename='owner_email_verifications';
-- 0
```
RLS enabled, zero policies — default-deny, exactly as designed (§4).

**LIMIT, named per this rule's own standing caveat, not overclaimed:** this scaffold
proves intra-file ordering, real-object references, and grant/constraint TEXT correctness
against a genuine structural dump. It does NOT and cannot prove the `service_role`
negative-capability result would hold against Supabase's own project-level default ACL
mechanism (vanilla Postgres has no analogue) — that is test-db rehearsal's own job, item
(d). The privilege-grant table above shows what THIS migration's own REVOKE/GRANT
statements produce textually; it is not a substitute for the `has_table_privilege` probe
against Supabase's real ACL layer. **That probe has since been run for real, against
`exfccwlrhoutkgrlikod` — §14 — and matches this scaffold's own result exactly.**

### 13b. Rollback — written AND executed, same standard as 031/033

`docs/reviews/034-rollback.sql` — full file, this same commit. Reverses 034 in mirror
order of its own forward steps (§3's `owner_email_verifications` first, back through §2's
CHECK, to §1's columns) — simpler than 030's own rollback since 034 is purely additive
(no renames, no data transform).

**CORRECTED, external review, blocking finding (2026-08-31) — the original claim here was
WRONG, not just incomplete, and is corrected rather than restated more carefully:** this
section previously argued the rollback was "safe by construction... because no such row
exists" — true only about the SPECIFIC databases this file had touched up to that point
(034 has still never applied to prod or test-db), but stated as if it were a property of
the rollback ITSELF, which it is not. Nothing about `ADD CONSTRAINT`'s own validation
behaviour depends on this migration's apply history — the moment a real `dprs` row exists
carrying one of the six new `delivery_status` values (which will start being true the
day the application code this migration unblocks actually ships), `ADD CONSTRAINT` fails
with `23514` against that row, same as it would against any table with real data. The
rollback's OWN first execution (§13b below) never exercised this branch because the
scaffold had zero `dprs` rows at all — the clean path was the only one ever run, and the
"safe by construction" line generalised from that single, unrepresentative case. Fixed:
`034-rollback.sql`'s own PRECONDITION and STEP 2 GUARD sections (a named `DO` block, not a
silent remap — argued in full there). Re-executed below with a seeded offending row so the
guard branch is verified, not assumed.

Executed against the SAME disposable scaffold §13a just built (034 still applied there):

**R1 — pre-rollback state:**
```sql
SELECT count(*) FROM pg_tables WHERE tablename = 'owner_email_verifications';        -- 1
SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND table_name='users' AND column_name IN
  ('notification_email','notification_email_verified_at','whatsapp_declined_at');    -- 3
SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'dprs_delivery_status_check';
-- CHECK (... 11 values, per §13a's own result above ...)
```

**R2 — the rollback itself (write):**
```
$ psql -v ON_ERROR_STOP=1 -f docs/reviews/034-rollback.sql
BEGIN
DROP TABLE
ALTER TABLE
ALTER TABLE
ALTER TABLE
COMMIT
```
Exit 0. Every statement succeeded.

**R3 — post-rollback state, each value the exact inverse of R1:**
```sql
SELECT count(*) FROM pg_tables WHERE tablename = 'owner_email_verifications';        -- 0
SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND table_name='users' AND column_name IN
  ('notification_email','notification_email_verified_at','whatsapp_declined_at');    -- 0
SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname = 'dprs_delivery_status_check';
-- CHECK ((delivery_status = ANY (ARRAY['pending'::text, 'delivered'::text,
--   'paused'::text, 'skipped_no_data'::text, 'failed'::text])))
```
**Byte-identical to `023_dpr_reports.sql`'s own original CHECK, confirmed by reading that
file directly.** Sanity check — `users` itself was not damaged, only the three added
columns removed: `information_schema.columns` count for `users` returns 14 post-rollback.
**Checked against the real dump, not left as an open flag:** `schema.sql`'s own
`CREATE TABLE "public"."users"` (line 2376) lists exactly 14 columns pre-034 — `id,
created_at, tenant_id, full_name, avatar_url, role, whatsapp_number, hierarchy_level,
reporting_manager_id, delegation_active, employee_id, status, messaging_blocked, auth_id`
— counted directly, not estimated. 14 pre-034, 17 with 034 applied (14+3, matching §13a's
own R1), 14 post-rollback — exact match, not a discrepancy. The original guess of "11"
above was wrong on arrival (an unchecked assumption, not a verified figure) and is
corrected here rather than left standing.

**Rollback proof: complete and exact for all three touched objects** — the new table
(existence, R1/R3), the CHECK constraint (byte-identical to 023's original), and `users`'
column set (14 → 17 → 14, verified against the real dump, not assumed).

**R1-R3 above is the CLEAN path only — exactly the gap the blocking finding names.** The
guard branch is exercised below, for real, against a genuinely seeded offending row —
not asserted, not inferred from the clean path's own success.

**R4 — 034 re-applied to the scaffold (fresh forward apply, same clean result as §13a).**

**R5 — seed one `dprs` row carrying a post-034 status**, plus the minimal parent rows it
needs (`tenants`, `projects`, `users`, all FK-required):
```sql
INSERT INTO public.tenants (id, name, slug) VALUES (..., 'Test Tenant', 'test-tenant');
INSERT INTO public.projects (id, tenant_id, name) VALUES (..., 'Test Project');
INSERT INTO public.users (id, tenant_id, full_name, role, status)
  VALUES (..., 'Test Engineer', 'engineer', 'active');
INSERT INTO public.dprs (id, tenant_id, project_id, engineer_id, log_date, delivery_status)
  VALUES ('44444444-4444-4444-4444-444444444444', ..., '2026-08-31', 'no_report_sent');
```
```
--- seeded row, confirmed present ---
                  id                  | delivery_status
--------------------------------------+-----------------
 44444444-4444-4444-4444-444444444444 | no_report_sent
```

**R6 — run `034-rollback.sql` against the seeded database. Literal output, not
paraphrased:**
```
$ psql -f docs/reviews/034-rollback.sql
BEGIN
DROP TABLE
psql:034-rollback.sql:150: ERROR:  Rollback aborted: 1 dprs row(s) carry a delivery_status
value the restored CHECK cannot accept (pm_notified / skipped_no_template /
skipped_unverified / no_report_sent / owner_send_failed / no_report_failed). First 1 row
id(s): 44444444-4444-4444-4444-444444444444. Resolve each row -- update it to a pre-034
status by hand, or defer this rollback -- before re-running this file. This is the correct
failure: a silent restore would strand these rows in a value the live constraint no longer
recognises.
CONTEXT:  PL/pgSQL function inline_code_block line 25 at RAISE
psql:034-rollback.sql:152: ERROR:  current transaction is aborted, commands ignored until end of transaction block
psql:034-rollback.sql:157: ERROR:  current transaction is aborted, commands ignored until end of transaction block
psql:034-rollback.sql:165: ERROR:  current transaction is aborted, commands ignored until end of transaction block
ROLLBACK
```
**Exit 0 at the shell level (psql's own convention — it does not exit non-zero on a SQL
error within a script), but the transaction itself aborted and rolled back, atomically —
confirmed, not assumed:**
```sql
SELECT count(*) FROM pg_tables WHERE tablename='owner_email_verifications';  -- 1, NOT dropped
SELECT pg_get_constraintdef(oid) FROM pg_constraint
  WHERE conname='dprs_delivery_status_check';  -- still all 11 values, NOT restored
SELECT delivery_status FROM public.dprs;  -- still 'no_report_sent', untouched
```
**The guard did exactly its job: named the exact offending row, explained why, and
protected the ENTIRE transaction — `DROP TABLE` (step 1, which ran before the guard) did
not survive either, since the abort unwound the whole `BEGIN...COMMIT` block, not just
the failing statement.** A rollback that partially applied (table dropped, CHECK left
widened) would have been a worse outcome than the guard blocking outright.

**R7 — resolve the row, confirm the CLEAN path still succeeds** (the guard must not block
a legitimate rollback once nothing offends it):
```sql
UPDATE public.dprs SET delivery_status = 'delivered'
  WHERE id = '44444444-4444-4444-4444-444444444444';
```
```
$ psql -v ON_ERROR_STOP=1 -f docs/reviews/034-rollback.sql
BEGIN
DROP TABLE
DO
ALTER TABLE
ALTER TABLE
ALTER TABLE
COMMIT
```
Exit 0, real success this time — the `DO` step appears and completes without raising.
Post-state, same three probes as R3, all confirmed reverted:
```
owner_email_verifications table count: 0
dprs_delivery_status_check: CHECK ((delivery_status = ANY (ARRAY['pending', 'delivered',
  'paused', 'skipped_no_data', 'failed'])))
users new-columns count: 0
```

**Rollback proof, restated with both branches now covered, not just the clean one:** the
guard blocks correctly, names the right row, protects the whole transaction atomically,
and does not block a legitimate rollback once the precondition genuinely holds. Both
outcomes verified by direct execution, neither asserted.

---

## 14. Test-db rehearsal — executed 2026-08-31, against `exfccwlrhoutkgrlikod`, not a fresh branch

**Per the standing rule (CLAUDE.md's REHEARSE ON A CLEANED EXISTING BRANCH rule) — the
EXISTING, schema-complete test-db, never a fresh Supabase branch (the confirmed platform
bug: a fresh provision has come up missing `users.auth_id` twice, mechanism unconfirmed).**
Full raw logs (every command, literal output, nothing summarised) live at
`/Users/aravindanrajamani/.claude/jobs/48655f83/tmp/testdb-rehearsal/` — 18 numbered files,
one per step. This section is the durable, committed record; that directory is the
unabridged one.

**0. Breadcrumb, then re-link — in that order, per direct instruction.** `cat
supabase/.temp/project-ref` → `exfccwlrhoutkgrlikod`. SQL breadcrumb (`SELECT
current_database(), now()`) run against whatever was linked at the time, confirmed live
and responsive, THEN `supabase link --project-ref exfccwlrhoutkgrlikod` run explicitly —
`{"project_ref":"exfccwlrhoutkgrlikod","message":""}`. Pre-apply ledger checked before
anything else: local/remote agree exactly through `001`–`033`, no `034` row — confirmed,
not assumed.

**1. Apply.** `supabase db query --linked -f docs/reviews/034_owner_email_delivery.sql` —
exit 0, empty result set (pure DDL). Project ref printed immediately before, in the same
command sequence, per the PROD-APPLIES discipline extended here to test-db.

**2. Ledger — the copy-temporarily-remove-immediately workaround, same as 031/033.**
`cp docs/reviews/034_owner_email_delivery.sql supabase/migrations/034_owner_email_delivery.sql`
→ `supabase migration repair --status applied 034 --linked` → `Repaired migration history:
[034] => applied` → `rm supabase/migrations/034_owner_email_delivery.sql` immediately,
confirmed absent (`git status --porcelain supabase/migrations/` empty). `supabase
migration list --linked` afterward: `{"local":"","remote":"034","time":"034"}` — ledgered,
`local` blank because the file correctly does not live there yet (BB2).

**3. Full structural verification — one combined query (see §11 step D for the exact SQL;
same query, this is where it was first run), every result matching design exactly:**
```json
{
  "delivery_status_check": "CHECK ((delivery_status = ANY (ARRAY['pending', 'pm_notified',
    'delivered', 'paused', 'skipped_no_data', 'skipped_no_template', 'skipped_unverified',
    'failed', 'no_report_sent', 'owner_send_failed', 'no_report_failed'])))",
  "users_new_columns": [
    {"column_name": "notification_email", "data_type": "text", "is_nullable": "YES"},
    {"column_name": "notification_email_verified_at", "data_type": "timestamp with time zone", "is_nullable": "YES"},
    {"column_name": "whatsapp_declined_at", "data_type": "timestamp with time zone", "is_nullable": "YES"}
  ],
  "owner_email_verifications_constraints": [
    {"conname": "owner_email_verifications_expires_after_created", "contype": "c", "def": "CHECK ((expires_at > created_at))"},
    {"conname": "owner_email_verifications_pkey", "contype": "p", "def": "PRIMARY KEY (id)"},
    {"conname": "owner_email_verifications_tenant_id_fkey", "contype": "f", "def": "FOREIGN KEY (tenant_id) REFERENCES tenants(id) ON DELETE RESTRICT"},
    {"conname": "owner_email_verifications_token_hash_key", "contype": "u", "def": "UNIQUE (token_hash)"},
    {"conname": "owner_email_verifications_used_after_created", "contype": "c", "def": "CHECK (((used_at IS NULL) OR (used_at >= created_at)))"},
    {"conname": "owner_email_verifications_user_id_fkey", "contype": "f", "def": "FOREIGN KEY (user_id, tenant_id) REFERENCES users(id, tenant_id) ON DELETE CASCADE"}
  ],
  "rls_enabled": true, "rls_forced": false, "policy_count": 0,
  "service_role_can_delete": false, "service_role_can_truncate": false,
  "service_role_can_references": false, "service_role_can_trigger": false,
  "service_role_can_select": true, "service_role_can_insert": true, "service_role_can_update": true,
  "anon_can_select": false, "anon_can_insert": false,
  "authenticated_can_select": false, "authenticated_can_insert": false,
  "ledger_row": "034"
}
```
**All 3 columns, all 6 constraints, RLS+zero-policy, the four-way service_role negative
probe, the three-way positive probe, and both anon/authenticated denials — every one
matching §12a/§12d/§12g's design exactly, on the real database, not the local scaffold.**

**4. Rollback, guard branch — seeded, not assumed.** Throwaway tenant/project/user/dprs
row inserted under a clearly-marked, single-purpose UUID prefix
(`99999999-0000-0000-0000-...`, slug `rehearsal-034-throwaway`), the `dprs` row carrying
`delivery_status = 'no_report_sent'`. Ran `docs/reviews/034-rollback.sql` against test-db:
```
ERROR:  P0001: Rollback aborted: 1 dprs row(s) carry a delivery_status value the restored
CHECK cannot accept (pm_notified / skipped_no_template / skipped_unverified /
no_report_sent / owner_send_failed / no_report_failed). First 1 row id(s):
99999999-0000-0000-0000-000000000004. Resolve each row -- update it to a pre-034 status by
hand, or defer this rollback -- before re-running this file. This is the correct failure:
a silent restore would strand these rows in a value the live constraint no longer
recognises.
```
Exit 1 at the `supabase db query` level this time (stronger than the local `psql` run's
exit 0 — `supabase db query` surfaces a SQL error as a hard failure, `psql` does not by
default). **Atomicity confirmed, not assumed:** post-attempt probe shows the token table
still exists (`DROP TABLE`, step 1, did not survive either — the abort unwound the whole
transaction), the CHECK still has all 11 values, the seeded row's status unchanged.

**5. Rollback, clean branch.** Resolved the seeded row (`UPDATE ... SET delivery_status =
'delivered'`), re-ran the rollback: exit 0, empty result set, real success. Post-state: 0
rows in `pg_tables` for `owner_email_verifications`, CHECK restored to the bare 023 five
values, 0 new `users` columns, the resolved `dprs` row survived intact
(`delivery_status: 'delivered'`) — the rollback touches schema only, never ordinary data.
**Ledger, separately** (the rollback SQL itself never touches
`supabase_migrations.schema_migrations` — confirmed the ledger still read `034` immediately
after this clean rollback, a real schema/ledger mismatch until repaired): `cp` the file
back temporarily, `supabase migration repair --status reverted 034 --linked` →
`Repaired migration history: [034] => reverted`, `rm` immediately.

**6. Re-apply, final, and LEAVE APPLIED — per direct instruction, the consumer's
integration tests need it there.** `supabase db query --linked -f
docs/reviews/034_owner_email_delivery.sql` again — exit 0, clean. Ledger re-repaired to
`applied` (same copy/repair/remove workaround). Throwaway rehearsal data (tenant, project,
user, dprs row) explicitly `DELETE`d afterward — test-db is shared with real CI runs; fake
data does not stay. **Final state reconfirmed** with the identical structural-verification
query from step 3 — byte-identical result, confirming the leave-applied state is correct
and the cleanup didn't disturb anything it shouldn't have.

**7. Full test suite — NOT run in this session, honestly, not silently skipped.** This
sandbox has no `.env.test` (`SUPABASE_TEST_URL`/`SUPABASE_TEST_SERVICE_ROLE_KEY`/
`SUPABASE_TEST_ANON_KEY`/`SUPABASE_TEST_PROJECT_REF`), so `test/setup/guard.ts`'s own
project-wide global-setup guard refuses to run ANY test file locally, the identical
constraint already recorded against PR #151 (§12, this same package's own prior round).
Not bypassed. **Real verification comes from CI on this commit** — pushing this section's
own commit re-triggers the full suite (`Test (real test-db)`) against test-db in its
CURRENT, post-034 state, which is the actual, live signal "did anything else break" needs
— checked and reported once that run completes, not asserted here.
