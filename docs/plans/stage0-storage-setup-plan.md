# Stage 0 — Storage setup — implementation plan

STATUS: APPLIED (2026-09-13). This is stage 0 of `docs/plans/media-capture-
design.md` item 20's build sequence — inserted ahead of stage 1 (photo
intake); stages 1–6 keep their existing numbers unchanged (see the
renumbering note near the end of this doc for why). Scope is **storage
setup only**: bucket, path convention, access rules. No ingestion, no
webhook changes, no flow changes, no `daily_log_photos`/`hindrance_photos`
rows — those are stage 1 (`docs/plans/stage1-photo-intake-plan.md`), which
depends on this stage existing first (and now can — this stage is live).

**DATED NOTE (2026-09-13): migration 042 is applied to prod
(`jvxwqignooseazzmwhvl`) and test-db, ledger repaired on both.** Full
sequence: `docs/reviews/042-apply-record.md`. The read helper
(`lib/storage/photo-access.ts`) and its cross-tenant isolation test
(`test/storage-photo-access.test.ts`) are real code with a real 5/5 pass
against test-db — see §9 item 1 below for the previously-open apply-path
privilege question, now resolved.

Split out from stage 1's own plan per Aravind's 2026-09-13 decision: stage
1 found that no Supabase Storage bucket has ever existed in this project —
this would be the first object write in the product's history, and a
mistake in its access rules exposes one tenant's photos to another. That
risk profile earns its own review, separate from ingestion mechanics.

**DATED NOTE (2026-09-13, same day, second decision):** the original plan
below proposed Storage RLS as the access-control mechanism. That is
**superseded** — see §4's own dated correction. No Storage RLS is built;
`service_role` plus an application-code membership check is the entire
access-control boundary. Struck through in place where superseded, not
silently rewritten.

---

## 1. Bucket creation — migration, not dashboard, with evidence

**Verified live against Supabase's current docs this pass** (not assumed,
not carried over from training):

- `supabase.com/docs/guides/storage/buckets/creating-buckets` documents
  **five** supported creation methods: Dashboard UI, and four SDKs
  (JS/Dart/Swift/Python/C#) — **and a plain SQL statement**:
  ```sql
  insert into storage.buckets
    (id, name, public)
  values
    ('avatars', 'avatars', true);
  ```
  `storage.buckets` is an ordinary table in the `storage` schema, in the
  same Postgres database as every other table this project migrates —
  inserting into it is DML, not special DDL, and needs no capability a
  migration file doesn't already have.

**Recommendation: create the bucket via a `INSERT INTO storage.buckets`
statement inside this stage's own migration file — not the dashboard.**
Reasoning: this project's own standing culture (the OUT-OF-BAND DB OBJECTS
registry, CLAUDE.md §10; the repeated "sweep for stale out-of-band drift"
incidents already on record for this project) treats anything created
outside the migration flow as a tracked exception requiring its own
recording discipline — extra process, one more thing that can silently
drift from what the migration history says exists. A bucket created via
SQL migration needs **no such exception**: it's provenance-traceable the
same way every other schema object in this project already is, through
`supabase migration list` and `git show <sha>:supabase/migrations/...`,
with no separate out-of-band note required.

**If the dashboard route is chosen instead** (e.g. because a live
Management API constraint makes the SQL insert impractical — not expected,
but not independently load-tested this pass either — see §9): it must be
recorded exactly the way this project already records every other
out-of-band object — a new entry in the OUT-OF-BAND DB OBJECTS registry
(CLAUDE.md §10 / `docs/build-status.md`), naming the bucket id, when it was
created, by whom, and why it bypassed the migration flow, per that
registry's existing convention (e.g. RLS enabled out-of-band on
`processed_messages`).

**Dependency flagged, not verified this pass:** whether this project's
approved apply path (`supabase db query --linked -f <file>`, per
CLAUDE.md's own standing rule) runs with sufficient Postgres privilege to
insert into `storage.buckets` and create policies on `storage.objects` —
both are owned by Supabase's managed `storage` schema, not this project's
own `public` schema. This needs confirming with a real dry-run against
test-db (this project's own standing "disposable dry-run" / "rehearse on a
cleaned test-db" discipline, CLAUDE.md §7) before assuming the migration
will apply cleanly — not assumed here.

---

## 2. Public or private — recommend PRIVATE

**Recommendation: private.** Reasoning:

- Photos are PM-only per the design (`docs/plans/media-capture-design.md`
  item 14: "This preserves PM-only access"; item 10: attachments/links are
  built specifically to avoid an unauthenticated party reaching a photo).
  A **public** bucket means any URL, once known or guessed, is fetchable by
  anyone, forever — the opposite of PM-only, and irrecoverable the moment
  a single URL leaks (forwarded email, browser history, a proxy log).
- Per Supabase's own docs (verified this pass): "public buckets are
  already publicly accessible" **without requiring any policy at all** —
  meaning a public bucket has no RLS enforcement point to reason about, by
  design. A private bucket requires explicit RLS policies granting SELECT
  for read access — this is the correct default for anything this project
  calls PM-only, matching CLAUDE.md §4's general stance ("Never rely on
  app-layer filtering alone... RLS enforced at the DB layer") applied to
  object storage, not just Postgres rows.
- The retention/tombstone design (item 9) already depends on objects being
  genuinely deletable and genuinely gone once expired — a public bucket
  doesn't change that, but a private bucket is the consistent default for
  a store class this project has already decided is not for public
  consumption at any point in its lifecycle.

---

## 3. Object path convention — proposed, not decided

**Proposed:** one bucket, `daily-log-photos`, tenant-scoped by path prefix:

```
{tenant_id}/{daily_log_id}/{photo_id}.{ext}
```

and, for the second per-parent class item 7 already decided
(`hindrance_photos`), the same bucket, a parallel prefix:

```
{tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext}
```

**Reasoning:**
- `tenant_id` **first**, always — this is the segment every RLS policy and
  every cross-tenant isolation test (§6) keys off. Supabase's own
  documented pattern for path-scoped policies (`storage.foldername()`
  against `name`) assumes the scoping value is a leading path segment, not
  buried mid-path.
- One bucket rather than two (`daily-log-photos` + `hindrance-photos`
  separately): simpler to provision and administer (one bucket to create,
  one set of bucket-level settings), and the two DB tables item 7 already
  decided (`daily_log_photos`, `hindrance_photos`) already carry the real
  type distinction — the bucket doesn't need to duplicate it. Not a strong
  requirement either way; flagged as my own recommendation, not a
  re-litigation of item 7 (which decided the *table* split, not the
  *bucket* split — this is a genuinely separate, smaller question).
- `{photo_id}` as the filename (a UUID, matching every other PK in this
  schema) rather than the engineer's original filename — avoids collision,
  avoids leaking anything from the original filename, matches this
  project's general "never trust external naming" posture (e.g. never
  persisting a Twilio media URL, `docs/plans/media-capture-design.md`
  item 4's own repeated point).

**Not decided here:** the exact bucket name, and whether `daily_log_id`
vs. `{project_id}/{log_date}/{engineer_id}` (or some other decomposition)
is the better second segment. `daily_log_id` is proposed because it's
already the FK target `daily_log_photos` carries (item 7) — no extra join
needed to construct or validate a path.

---

## 4. Access rules — ~~private bucket + Storage RLS, PM-scoped~~ SUPERSEDED: service_role only, NO Storage RLS (2026-09-13)

~~**Mechanism: Postgres Row Level Security on `storage.objects`.** Verified
this pass against Supabase's current docs: "Supabase Storage leverages
Postgres Row Level Security on the `storage.objects` table to restrict
file operations... By default Storage does not allow any uploads to
buckets without RLS policies." Policies can reference **custom tables via
subqueries** — confirmed directly, this is exactly what a PM-membership
check needs.

**Proposed policy shape** (described, not written as SQL this pass):

- **SELECT** (read) — allowed when: `bucket_id = 'daily-log-photos'` AND
  the object's tenant path-segment matches a tenant the requesting user
  belongs to AND that user is a **PM** on the specific project the
  object's `daily_log_id` (or `hindrance_id`) resolves to. Concretely, a
  subquery joining `storage.foldername(name)`'s tenant/parent-id segments
  against `daily_log_photos`/`hindrance_photos` → `daily_logs`/
  `hindrances` → `project_members` (`role = 'pm'`) → `auth.uid()`. This is
  the same **shape** of membership check `resolveProjectPMEmails`
  (`lib/hindrance/pm-notify.ts`) already performs at the application layer
  for email recipients — reused here as a **database-enforced** version of
  the identical rule, not a new policy invented from scratch.
- **INSERT** — `service_role` only (the `media_ingest` job is the sole
  writer; no end-user client ever uploads directly).
- **UPDATE/DELETE** — `service_role` only (only the stage-6 retention job
  and the ingest job's own failure-cleanup path ever mutate/remove an
  object).~~

**DATED CORRECTION (2026-09-13) — DECIDED (Aravind): NO STORAGE RLS.**
Struck through, not deleted. The three-read-path design this section and
§5 originally proposed (Storage RLS + a server-minted signed URL for the
dashboard + direct `service_role` reads for stage 4) was **more surface
than this stage needs, and every path was a place tenant isolation could
leak.** Replaced with a single mechanism: **`service_role` only. No
Storage RLS policies on `storage.objects` at all.**

- The bucket stays **private** (§2, unaffected by this correction).
- **Every** read goes through the server. The server checks the caller's
  session **and** project membership itself, in application code, then
  mints a **short-lived** signed URL — minutes, not hours or days.
- Stage 4's email attachment job reads object bytes directly via
  `service_role`, unchanged from what §5 already said (that half of §5
  was never wrong, only the "Storage RLS as a second layer" framing was).
- **Signed URLs are bearer tokens** — recorded plainly: anyone holding the
  link can open the object until it expires, logged in or not. This is
  exactly why they must **never** be placed in email: stage 4 attaches
  raw bytes (no link at all), and item 14's overflow links point at the
  **dashboard** (which performs its own check before ever minting a URL),
  never directly at a Storage signed URL baked into a message.

**CONSEQUENCE, RECORDED PLAINLY, NOT SOFTENED:** the server-side
membership check inside the read helper (§4a below) is now the **only**
barrier between tenants. There is **no second, database-level barrier
behind it** — no Storage RLS to fall back on if the application check has
a bug. **The cross-tenant isolation test (§6) is therefore not a
checkbox — it is the deliverable that verifies tenant isolation exists at
all**, not a confirmation of a second layer already believed sound.

**auth.uid() / auth.users coupling — still real, moved into application
code, not removed by this correction.** The read helper's own membership
check (§4a) still resolves the caller's identity through the same
`users.auth_id` → `auth.users` seam migration 007 built, and the same
seam `resolveProjectPMEmails` already depends on for the hindrance/DPR
emails — this correction changes **where** that check runs (application
code, not a Postgres policy), not **whether** the 007 coupling exists.
Still checked directly this pass: migration 007 is **not** currently
mid-apply (it's #7 of 41, long since landed) — no live sequencing blocker
today, only the same structural note as before: if that identity seam is
ever re-touched, this helper is affected alongside every other consumer
of it.

**MOOT, not deleted: the `service_role` default-ACL question.** §9's own
open dependency — whether Supabase Storage has a `service_role`
default-ACL surprise analogous to the `dpr_versions` gap — is now **moot**
for this design: nothing here relies on Storage's own access rules at
all, RLS or otherwise. `service_role` is expected, by design, to have
unrestricted access to this bucket — that was never in question. Recorded
as moot rather than removed, per this project's own correction
discipline; see §9 below, kept, not deleted.

### 4a. The read helper — the entire access-control boundary

Built this pass: `lib/storage/photo-access.ts`, `getSignedPhotoUrl()`. See
the code itself (pasted in the build report) for the exact logic. Shape,
described here:

1. Parse `{tenant_id}/{daily_log_id}/{photo_id}.{ext}` to extract
   `daily_log_id`. Malformed path → refuse (return `null`), no query
   attempted.
2. Look up `daily_logs.project_id` for that `daily_log_id`
   (`service_role`, bypasses RLS by design — there is nothing else to
   bypass, since this project's own Postgres RLS on `daily_logs` was
   never the boundary being tested here). Not found → refuse.
3. Look up `project_members` for `(project_id, caller_user_id, role='pm')`.
   Not found → refuse.
4. **Only then**, mint a signed URL via `service_role`, TTL in minutes.
5. **Any** failure at any step returns `null` — never a partial result,
   never an error message that would let a caller distinguish "wrong
   tenant" from "wrong role" from "object doesn't exist" from "malformed
   path." One failure shape, always.

**Deliberately does not trust the path's own tenant segment for
authorization** — the tenant segment exists for human-readable bucket
organization only. Authorization is derived **only** from the real FK
chain (`daily_log_id → daily_logs.project_id → project_members`), never
from what the path claims. A path with a mismatched or fabricated tenant
segment gains nothing — the real project (and therefore the real tenant)
is resolved from the database, not parsed off the string.

---

## 5. How the PM dashboard reads an object, vs. the email attachment path — DIFFERENT mechanisms, named now

These need different mechanisms, confirmed this pass — not discovered
later at stage 4. **Updated 2026-09-13** to match §4's correction — the
dashboard path below no longer describes a "second, RLS-backed layer,"
because there isn't one; the signed URL is the only layer.

**PM dashboard (a browser, a real Supabase Auth session):** a Next.js
server route (or server component, per CLAUDE.md §4's own "Use the
Supabase SSR client in server components + API routes") resolves the
caller's `users.id` from their session, then calls `getSignedPhotoUrl()`
(§4a) with the object path. If it returns a URL, that's what appears in
the dashboard's `<img src>`; if it returns `null`, the dashboard shows
nothing for that photo — never a broken-image fallback that leaks whether
the object exists.

**Email attachment (stage 4, a queued job, `service_role`):** the job
handler downloads the object's bytes **directly**, server-side, with the
same `service_role` client the `media_ingest` job already uses to
**upload** it — no signed URL, no membership check via `getSignedPhotoUrl()`
at all (the job already knows which project/tenant it's attaching for,
from its own payload) — the bytes are embedded as a MIME attachment,
never linked, so there's no URL for a recipient to ever hold or forward
independent of the email itself. **Signed URLs must never be placed in
email** — restated from §4's own new language, since this is exactly the
path that could tempt it (an attachment job could, in principle, mint a
URL instead of reading bytes directly — explicitly rejected here).

**Overflow dashboard links (item 14, photo 11+):** same mechanism as the
PM dashboard case above — a link into the app that, on click, calls
`getSignedPhotoUrl()` itself and either redirects to the resulting URL or
refuses — never a raw Storage URL ever placed in an email or a rendered
page, consistent with item 14's own "never as raw storage URLs, and never
as signed public links" language.

---

## 6. Cross-tenant isolation test (CLAUDE.md §7)

**DATED CORRECTION (2026-09-13) — mechanism updated to match §4's "no
Storage RLS" decision; the test's own centrality is unchanged, if anything
stronger.** The original version of this section (struck through below)
described asserting isolation via real JWT-authenticated Supabase clients
hitting RLS. There is no RLS to hit any more — the test now calls
`getSignedPhotoUrl()` (§4a) directly, with different `callerUserId`
values, and asserts what it returns. This is, if anything, a **more
direct** test of the thing that actually matters now: per §4's own
"consequence, recorded plainly," this helper's own logic is the entire
isolation boundary, so a test of the helper **is** the isolation test, not
a proxy for one enforced somewhere else.

~~Two-tenant fixture, described:

1. Seed two tenants (A, B), each with a real PM user (`project_members`,
   `role='pm'`, a genuine `auth_id`/`auth.users` row — not a service-role
   bypass) and one project each.
2. Seed one object per tenant in the bucket, at
   `{tenant_A_id}/{daily_log_id_A}/{photo_id}.jpg` and the equivalent for
   B (via `service_role`, matching how the real ingest job would write
   them — this fixture never uses an end-user client to write).
3. **Assert, as tenant A's PM (a real authenticated client, not
   service_role):**
   - A read of tenant A's own object succeeds.
   - A read of tenant B's object — by its known/guessed exact path —
     **fails** (RLS denies it; not merely "the dashboard doesn't show a
     link to it," which is an app-layer convenience, not a security
     boundary).
4. **Assert, as an authenticated non-PM (an engineer or a PM on a
   different, unrelated project within tenant A):** read of tenant A's own
   object **also fails** — PM-only means PM-only, not tenant-only. This is
   the same "role-blind RLS" failure shape migration 027's external review
   round 1 caught once already in this project (a different table) — the
   fixture should specifically include a same-tenant, wrong-role caller,
   not only a cross-tenant one.
5. **Assert, as `anon`:** every read attempt fails, unconditionally.
6. **Assert, as `service_role`:** every read/write/delete succeeds —
   confirming the ingest and retention jobs are not accidentally blocked
   by the same policy meant to restrict everyone else.~~

**Current design, built this pass** (`test/storage-photo-access.test.ts`):
uses the project's existing two-tenant fixture (`test/helpers/db.ts`'s
`ensureTwoTenantFixtures`/`removeTwoTenantFixtures`, built originally for
migration 007's own RLS tests) for the tenant/project scaffolding, plus a
`daily_logs` row and `project_members` rows seeded directly per case:

1. **Same tenant, correct PM** → `getSignedPhotoUrl()` returns a real URL
   (string, non-null).
2. **Cross-tenant** — tenant B's PM requests tenant A's object path →
   returns `null`. This is the core isolation assertion.
3. **Same tenant, wrong role** — an `engineer` (not a `pm`) on tenant A's
   own project requests tenant A's own object → returns `null`. Included
   deliberately, not as an afterthought — this is the same "role-blind
   access" shape migration 027's external review round 1 caught once
   already in this project (a different table): a cross-tenant-only test
   would have missed it, since a same-tenant caller can look identical to
   a legitimate one until the role is actually checked.
4. **Malformed path** — an object path that doesn't parse into a
   `daily_log_id` (wrong segment count) → returns `null`, no query
   attempted (defensive, not reachable via any real caller, but the
   contract is "never throw, never leak a distinguishing error").
5. **Non-existent `daily_log_id`** — a syntactically valid path pointing
   at a `daily_logs` row that doesn't exist → returns `null`.

**`service_role` default-ACL question — now MOOT, recorded not deleted
(§4's own note, restated here since this section is where it would have
been tested):** the grant-probe this section originally flagged as needed
(whether Storage has a `service_role` default-ACL surprise analogous to
the `dpr_versions` gap) no longer applies — nothing in this design relies
on Storage's own access rules at all. `service_role` is *expected* to
bypass everything; that was never in question, and this correction
removes the one thing (RLS) that question would have been about.

---

## 7. Cost and lifecycle — verified live against current Supabase docs

**Re-verified this pass** (not reused from the design doc's own
2026-09-12 finding without a fresh check, since this is a load-bearing
fact for stage 0's own scope): fetched `supabase.com/docs/guides/storage`
directly — the general Storage guide makes **no mention** of any native
object lifecycle, TTL, or automatic-expiration mechanism. This is
consistent with, not merely repeated from, `docs/plans/media-capture-
design.md` item 5's own earlier finding (Supabase GitHub discussion #20171
tracking native lifecycle expiration as a still-open, unimplemented
feature request as of September 2026).

**Consequence, unchanged from item 5's own conclusion:** stage 6's
retention job must delete objects itself — there is no bucket-level TTL
setting, no lifecycle policy, nothing S3-style to configure once and
forget. This is not a new finding; it's confirmation that nothing has
changed since item 5 was written one day earlier, checked freshly rather
than assumed still true.

**Pricing:** unchanged from item 5's own already-verified figures (100 GB
storage / 250 GB egress included on the Pro plan, `$0.0213`/GB storage and
`$0.09`/GB egress — `$0.03`/GB cached — beyond that) — not re-fetched this
pass since nothing in stage 0's own scope changes the volume assumptions
item 5 already flagged as needing re-derivation once real engineer
behavior under uncapped intake is observed.

---

## 8. Also reported, as requested

### 8.1 Twilio uncaptioned-photo `Body` — still undetermined

**No Twilio credentials are available in this planning environment**,
unchanged from the stage 1 plan's own finding: `TWILIO_ACCOUNT_SID` /
`TWILIO_AUTH_TOKEN` are not set in this sandbox's shell environment, and no
`.env.local` exists inside this worktree (one exists at the shared repo
root, outside this session's isolation boundary, and per this project's
own standing rule a script must never re-derive credentials by reading an
env file independently). **I have not attempted to infer or guess this
value.** Aravind will need to read it directly from the Twilio Console for
the ~10:20 2026-09-13 uncaptioned photo, from the same sending number.

**Note, given the new decision this same pass (a photo is never an
answer):** this fact is no longer a *blocker* for stage 1 — see
`docs/plans/media-capture-design.md`'s newly-added item on that decision —
but it should still be resolved, since it affects exactly how "no
accompanying text" is detected in code (an empty string and a genuinely
absent `Body` key may need different handling depending on what Twilio
actually sends).

### 8.2 Live RPC SQL — empty-answer gating, verified directly (not from TS comments)

Stage 1's own plan flagged this as unverified — read from `morning.ts`'s
comments, which that file's own header says are documentation, not
authority. **Read directly from the live SQL this pass**, not inferred:

**Morning, step 2 ("Plan of action") — the live function is
`038_hindrance_flow_and_collision_fix.sql`** (the latest
`CREATE OR REPLACE FUNCTION apply_morning_flow_turn`, confirmed by
checking every migration touching this function and finding no later
redefinition):

```sql
ELSIF v_session.current_step = 2 THEN
  v_session.current_step := 3;
  v_outcome := 'advance';
  v_col     := 'plan';
```
and the write:
```sql
ELSIF v_col = 'plan' THEN
  INSERT INTO daily_logs AS d
    (tenant_id, project_id, engineer_id, log_date, morning_plan)
  VALUES
    (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text)
  ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
    SET morning_plan = EXCLUDED.morning_plan;
```
where `v_text := btrim(COALESCE(p_message, ''))`, computed once near the
top of the function, unconditionally. **Confirmed: zero gating.** Step 2
always advances and always writes `v_text` verbatim — including an empty
string — regardless of content. This is the exact silent-blank gap the
stage 1 plan identified, now confirmed at the SQL level, not just inferred
from TypeScript comments.

**Evening, step 1 ("Work completed + quantity") — the live function is
`040_evening_q5_tomorrow_needs.sql`** (the latest `CREATE OR REPLACE
FUNCTION apply_evening_flow_turn`, confirmed the same way):

```sql
ELSIF v_session.current_step = 1 THEN
  -- Q1 (free text + enrichment) -> evening_output + quantities.
  -- BYTE-IDENTICAL to the pre-migration step 1 (plan §2: "unchanged").
  v_session.current_step := 2;
  v_outcome := 'advance';
  v_col     := 'output';
```
and the write:
```sql
IF v_col = 'output' THEN
  INSERT INTO daily_logs AS d
    (tenant_id, project_id, engineer_id, log_date, evening_output, evening_output_quantities)
  VALUES
    (p_tenant_id, p_project_id, p_user_id, v_log_date, v_text, p_parse->'1')
  ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE
    SET evening_output            = EXCLUDED.evening_output,
        evening_output_quantities = EXCLUDED.evening_output_quantities;
```
**Confirmed: same shape, zero gating.** `evening_output` gets `v_text`
verbatim, empty or not, and the step always advances. Both live functions
match the TS-side documentation's own description exactly — the earlier
"needs confirming, not assumed" flag in stage 1's plan is now resolved:
the TS comments were accurate, verified independently against the SQL
that actually runs.

This confirms the "photo is never an answer" decision (recorded this pass
in `docs/plans/media-capture-design.md`) genuinely closes a real, live gap
in the current production RPCs — not a hypothetical one.

### 8.3 Current completion message strings, exact, for wording reference

**Morning** (`lib/whatsapp/flows/morning.ts`):
```
MORNING_COMPLETE_REPLY =
  '✅ Morning check-in complete. Have a productive day on site!'

MORNING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's morning check-in. ✅ Nothing more needed."

MORNING_SITE_HOLIDAY_REPLY =
  '✅ Got it — site holiday recorded. No further check-ins needed today.'

MORNING_ABSENT_REPLY =
  "✅ Got it, thanks for letting us know. We'll still check in this evening."
```

**Evening** (`lib/whatsapp/flows/evening.ts`):
```
EVENING_COMPLETE_REPLY =
  '✅ Evening check-in complete. Thanks — rest well!'

EVENING_ALREADY_COMPLETE_REPLY =
  "You've already sent today's evening check-in. ✅ Nothing more needed."
```

Pasted verbatim from source, unmodified — for Aravind to match photo-count
wording (stage 2's own completion-message recommendation) against the
real strings rather than a paraphrase.

---

## 9. Dependencies I could not verify — named, not assumed

1. ~~Whether `supabase db query --linked -f <file>` (this project's
   approved apply path) has sufficient Postgres privilege to `INSERT INTO
   storage.buckets`.~~ **RESOLVED (2026-09-13): it does.** Migration 042
   applied to prod (`jvxwqignooseazzmwhvl`) and test-db via exactly this
   command, no error — see `docs/reviews/042-apply-record.md` for the full
   sequence. No dashboard exception was needed, for this migration or for
   future Storage work. This also answers the pre-apply fact worth
   recording on its own: `SELECT count(*) FROM storage.buckets` on prod
   returned **0** immediately before the apply — this product had never had
   a Storage bucket before migration 042. It is the first object storage
   this product has ever built, confirmed directly, not inferred from "no
   migration creates one."
2. ~~Whether Supabase's Storage layer has a `service_role`-default-ACL
   surprise analogous to the one already found twice on `public`-schema
   tables (`dpr_versions`, `outbound_sends`)~~ — **MOOT, per §4's "no
   Storage RLS" decision, not deleted.** This question only mattered if
   Storage's own access rules were part of the design; they no longer are.
   `service_role` is expected, by design, to bypass everything in this
   bucket — recorded here as resolved-by-becoming-inapplicable, not as
   "checked and found clean" (it was never checked; it stopped being a
   question worth checking).
3. **The exact full `storage.buckets` schema** (whether `file_size_limit`
   and `allowed_mime_types` are real columns settable at creation, versus
   options layered on top by the client SDKs only) — the fetched
   documentation confirmed `id`/`name`/`public` explicitly but did not
   fully detail the rest. Worth confirming before writing the actual
   migration, not load-bearing for this plan's core decisions.
4. **Whether the Management API or dashboard bucket-creation path has any
   constraint that would make the SQL-insert method impractical in
   practice** (e.g. a required companion API call this project's tooling
   doesn't yet make) — not tested live; the documentation presents the SQL
   method as valid but I have not exercised it against a real project.
5. **Twilio's uncaptioned-photo `Body` content** — §8.1, unresolved, no
   credentials available in this environment.

---

## Renumbering applied to `docs/plans/media-capture-design.md` item 20

Recorded in that doc this pass (see the dated note there): this stage is
inserted as **stage 0**, ahead of stage 1. Stages 1 through 6 **keep their
existing numbers** — deliberately: item 20's list has internal
cross-references by number (e.g. stage 2's own "HARD GATE: must ship
before stage 3"), and renumbering every one of those to stay correct would
be exactly the kind of cascading-cross-reference hazard this project's own
standing rule warns about (audit every reference before trusting it, don't
let a renumbering silently orphan one). "Stage 0" is the label that avoids
that cascade entirely — it occupies the slot before stage 1 without
requiring stages 1–6 to move. Stage 1's own plan document
(`docs/plans/stage1-photo-intake-plan.md`) is unaffected in content and
keeps its name and number — the only addition is a new prerequisite note
("requires stage 0 complete") reflecting that storage must exist before
intake can write anything to it.

## Sources

- `supabase.com/docs/guides/storage`, `.../storage/buckets/fundamentals`,
  `.../storage/buckets/creating-buckets`, `.../storage/security/access-
  control` — fetched directly this pass.
- `supabase/migrations/007_auth_surgery.sql`, `038_hindrance_flow_and_
  collision_fix.sql`, `040_evening_q5_tomorrow_needs.sql` — read in full
  (relevant sections) this pass to verify §8.2 and the 007 coupling in §4.
- `lib/whatsapp/flows/morning.ts`, `lib/whatsapp/flows/evening.ts` — read
  for the exact completion strings in §8.3.
- `docs/plans/media-capture-design.md`, `docs/plans/stage1-photo-intake-
  plan.md` — this stage's own prerequisites.
- `docs/reviews/service-role-table-grants-gap.md` — cited for the §6/§9
  grants-probe analogy.
