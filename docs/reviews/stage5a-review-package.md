# Stage 5a review package — PM photos in the dashboard

## Review status (2026-09-17)

**Verdict: GO (design tier).** Full text: `docs/reviews/stage5a-review-verdict.md`.

Build conditions, each citing the verdict paragraph it comes from:

- **C1.** One shared `lib` function, `isProjectPm(userId, projectId)`
  (`project_members.role = 'pm'`), used by D3, D6, and the later
  correction-gate fix. A test fixture shaped like a real prod PM
  (`users.role = 'admin'`, `project_members.role = 'pm'`) MUST see photos.
  (Verdict Q7.)
- **C2.** Extend `test/photo-access-boundary-agreement.test.ts` to
  hindrance photos and re-target its TS side at the route's authorization
  function (not `getSignedPhotoUrl`). First artifact: this run, green on
  real test-db, before any UI. (Verdict Q4, closing paragraph.)
- **C3.** D7: the email wrapper checks readiness BEFORE calling the
  shared selector; the selector itself has no readiness logic. (Verdict
  Q3.)
- **C4.** Retire `getSignedPhotoUrl` (delete or reduce to an internal
  helper of the route). Its isolation tests move onto the route; they are
  not deleted. (Verdict Q4.)
- **C5.** Per-user fixed-window rate limit (order of 100+/min), reusing
  the confirm-email in-memory pattern and its stated per-instance
  limitation. No batch signing. A rate-limited image shows the approved
  "Photo unavailable. Refresh to try again." string. (Verdict Q5.)
- **C6.** Every failure response identical in status, body, AND headers
  (including `cache-control`). Timing need not be uniform. (Verdict Q2.)
- **C7.** D3's "no photo section" asserted on all three pages. (Verdict,
  "Asserted-vs-verified flags" paragraph.)
- **C8.** No new user-facing strings beyond the six approved. (Verdict,
  "Asserted-vs-verified flags" paragraph.)

**Build split (approved by Aravind, 2026-09-17):**
- **B1** = `isProjectPm` + the photo route (D6) + retire
  `getSignedPhotoUrl` (C4) + extended boundary matrix (C2). No UI.
- **B2** = the D7 selector split.
- **B3** = the three pages (daily log detail, DPR detail, hindrances
  queue).

B1's test-db run goes to the external reviewer before B2 starts.

---

Every factual claim in this package was verified by reading the cited file
on `origin/main` in a fresh worktree branched directly from it (no local
edits between fetch and read). Anything not independently confirmed this
way is listed in the **UNVERIFIED** section at the end, never stated as
fact above it.

## Repo-state header (per CLAUDE.md's "REVIEW REQUESTS AT THIS TIER OPEN WITH A REPO-STATE HEADER" rule)

- `main @ 2f7adc893e557e255fdb04bd3a8e39d14f7f4c30` (verified: `git rev-parse HEAD` in a worktree branched from `origin/main` immediately after `git fetch origin`, this same session).
- `supabase migration list` (local/remote): **NOT RUN.** This is a docs-only
  package and the task instructions that produced it explicitly exclude
  Supabase commands. Highest-numbered file present in
  `supabase/migrations/` is `047_revoke_unused_table_rights.sql` (`ls
  supabase/migrations/`, verified). That file's own header comment records
  `DATED CORRECTION (2026-09-17): APPLIED TO PROD (jvxwqignooseazzmwhvl)`
  (`supabase/migrations/047_revoke_unused_table_rights.sql:12`) — a
  repo-based record of a claimed prod-apply, not a live probe. Per
  CLAUDE.md's own "a record of a thing is not the thing" standard, this
  should be re-confirmed by an actual `supabase migration list --linked`
  before this package is treated as reflecting current prod schema state.
- Last runbook executed: not established by this pass (out of scope — see
  above). The most recent dated apply record in `docs/reviews/` is
  `047-prod-apply-record.md` (file exists; not read for this package).

---

## 1. Purpose and tier

**Stage 5a**: the PM sees photos (morning, evening, hindrance) in the
dashboard — daily log detail, DPR detail, and the hindrances queue. This is
the first PM-dashboard-facing photo reader; today `getSignedPhotoUrl`
(`lib/storage/photo-access.ts:85`) exists but has **zero production
callers** (verified: `grep -rn "getSignedPhotoUrl" app lib` matches only its
own definition, `lib/storage/photo-access.ts:85`, and one comment
mentioning it without calling it, `lib/hindrance/pm-notify.ts:347`; the only
other matches are in `test/storage-photo-access.test.ts` and
`test/photo-access-boundary-agreement.test.ts`).

**Tier: FULL**, per CLAUDE.md's own PRE-LAUNCH TWO-TIER CHANGE PROCESS
(`CLAUDE.md:625-646`). Full tier is triggered by "tenant isolation"
(`CLAUDE.md:629`), named explicitly as one of the FULL-tier conditions —
D5/D6 below are exactly a tenant-isolation control (a new, explicit tenant
check gating photo access; see §3, §4). This package itself is the
"external review" step FULL tier's order opens with (`CLAUDE.md:631`).

**Expected: no migration.** Every decision in §4 is app code only:
- D5 (tenant check) is a code change to `lib/storage/photo-access.ts`'s own
  logic (or its replacement, D6), not a schema change.
- D6 (the new photo route) reads columns and tables that already exist:
  `daily_logs`/`hindrances` for ownership resolution, `daily_log_photos`/
  `hindrance_photos` for the row and `photo_url`/`expires_at` (both already
  live per `supabase/migrations/043_daily_log_photos.sql:113-199` and
  `supabase/migrations/044_hindrance_photos.sql:182-229`).
- D4's "Kept until {date}" reads the existing generated `expires_at` column
  directly — no new column needed.
- D7 is a pure TypeScript refactor of `lib/dpr/select-photos.ts`.

No RLS, grant, or table change is required by anything in this package. If
a reviewer disagrees and believes a migration is in fact needed for some
part of this design, that belongs in **Open Questions** (§9) — this package
does not design one.

---

## 2. Scope / non-scope

**Source** (`docs/plans/media-capture-design.md:882-896`, the "Stage 5a
scope (decided 2026-09-17)" paragraph, quoted in full):

> **Stage 5a scope (decided 2026-09-17):** PM-only photos on the daily
> log, DPR, and hindrance dashboard pages, reusing the existing
> `project_members` `role = 'pm'` rule — the same rule `getSignedPhotoUrl`
> (`lib/storage/photo-access.ts`) and the `daily_log_photos`/
> `hindrance_photos` RLS SELECT policies (043/044) already enforce. Needs
> a hindrance-path (4-segment) access check: today's `getSignedPhotoUrl`/
> `extractDailyLogId` only parses the 3-segment `daily_log_photos` path
> convention (`{tenant_id}/{daily_log_id}/{photo_id}.{ext}`), not
> hindrance photos' 4-segment one
> (`{tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext}`). Show the
> retention date. No tombstone UI until stage 6 (the deletion job) exists
> — nothing expires before that job runs, so there is nothing to render a
> tombstone for yet. No Owner access. No email link. **Full tier**
> (CLAUDE.md §0's PRE-LAUNCH TWO-TIER CHANGE PROCESS), with its own
> external review.

Immediately preceding this paragraph, `docs/plans/media-capture-design.md`
records why Owner access and the "view all photos" link are explicitly
struck from scope (`docs/plans/media-capture-design.md:865-880`): an
earlier draft (Stage 4's PR #283, S3/S4) had proposed a "view all photos
from today" dashboard link plus Owner access to the photo page; Aravind's
2026-09-17 correction struck this, because owners have no dashboard login
by design — `scripts/provision-beta-owner.ts` hardcodes the new owner
row's `auth_id` to `NULL` (verified: `scripts/provision-beta-owner.ts:3`,
`scripts/provision-beta-owner.ts:137-143` — an explicit refusal to insert a
non-null `auth_id`) — "so the link would have had nowhere to go"
(`docs/plans/media-capture-design.md:876`). That Owner-access work moved to
a new backlog item, "How people log in" (`docs/build-status.md:130-171`),
not into Stage 5a.

**Non-scope** (per the task brief and consistent with the source above):
- Owner access to any photo surface.
- The "view all photos" / overflow email link (Stage 4's own overflow line
  stays link-free — `docs/plans/media-capture-design.md:879-880`).
- Tombstone UI — nothing expires before stage 6's deletion job exists, so
  there is nothing to render yet (`docs/plans/media-capture-design.md:892-893`).
  Confirmed no such job exists in code today: `lib/hindrance/pm-notify.ts:351`
  states directly, "stage 6's retention job doesn't exist yet."
- Stage 6, the retention deletion job itself
  (`docs/plans/media-capture-design.md:902-907`).
- Tamil strings — approved strings are English-only; Tamil is owed and not
  approved (§5).
- Any change to the Owner DPR email's behaviour, order, caps, overflow
  line, readiness gate, or Sentry fingerprint — see D7's hard condition
  (§4) and §7's D7 test-plan entry.

---

## 3. Current state (verified, cited)

**`lib/storage/photo-access.ts` — `getSignedPhotoUrl`.**
- `getSignedPhotoUrl` (`lib/storage/photo-access.ts:85-115`) is the entire
  access-control boundary for photo objects today (`lib/storage/photo-access.ts:4-17`).
- Its path parser, `extractDailyLogId` (`lib/storage/photo-access.ts:64-69`),
  accepts **only** a 3-segment path (`if (parts.length !== 3) return null`,
  line 66) — `{tenant_id}/{daily_log_id}/{photo_id}.{ext}`.
- Its authorization check is PM-only: `project_members` filtered to
  `role = 'pm'` (`lib/storage/photo-access.ts:100-106`).
- It has **no tenant check**: the function's own comment states this
  deliberately (`lib/storage/photo-access.ts:56-62`, "DELIBERATELY DOES NOT
  RETURN OR USE THE TENANT SEGMENT... the real tenant/project boundary is
  derived entirely from the database (`daily_logs.project_id ->
  project_members`), keyed on `daily_log_id` alone"). The boundary-agreement
  test file names this same asymmetry explicitly against the RLS policy,
  which does carry a `tenant_id` clause
  (`test/photo-access-boundary-agreement.test.ts:33-44`).
- It has **zero production callers** today (verified above, §1).

**Hindrance photo path is 4 segments.** `{tenant_id}/hindrance/{hindrance_id}/{photo}`,
constructed at `lib/media/hindrance-ingest.ts:112` and documented at
`lib/media/hindrance-ingest.ts:18-20` and again at
`supabase/migrations/044_hindrance_photos.sql:81-93`. The latter states
explicitly that "nothing in this stage parses this path with
`photo-access.ts`'s `extractDailyLogId` (a strict 3-segment parser)... a
future signed-URL reader for hindrance photos needs its own path parser"
(`supabase/migrations/044_hindrance_photos.sql:86-93`) — i.e. this gap was
anticipated and named as Stage 5's own work, not discovered new here.

**`daily_log_photos` / `hindrance_photos`: retention and no deletion job.**
- `expires_at` is `GENERATED ALWAYS AS ... STORED` on both tables:
  `supabase/migrations/043_daily_log_photos.sql:189-199` (morning/attendance
  7 days, evening/evening_progress 60 days, via a `CASE` on
  `retention_class`) and `supabase/migrations/044_hindrance_photos.sql:223-228`
  (hindrance, flat 60 days).
- `photo_url` is set to `NULL` once tombstoned, row retained, never a hard
  delete — stated in both tables' column comments
  (`supabase/migrations/043_daily_log_photos.sql:130`,
  `supabase/migrations/044_hindrance_photos.sql:196`) and table comments
  (`supabase/migrations/043_daily_log_photos.sql:232-233`,
  `supabase/migrations/044_hindrance_photos.sql:260-261`).
- **No deletion/tombstoning job exists yet.** `lib/hindrance/pm-notify.ts:351`
  states directly that tombstoned rows are "not reachable in practice this
  soon after a report, since stage 6's retention job doesn't exist yet."
  A targeted search for a scan/cleanup job (`grep -rn "stage 6\|stage6\|
  retention.*scan\|tombstone" lib app`) surfaces no implementation, only
  this same comment and the migration-file comments cited above.

**RLS SELECT on both photo tables is PM-only.**
- `daily_log_photos_select`: `tenant_id = get_user_tenant_id()` AND a PM
  membership check joined through `daily_logs.project_id`
  (`supabase/migrations/043_daily_log_photos.sql:259-271`).
- `hindrance_photos_select`: the same shape, one join shorter (`hindrances`
  carries `project_id` directly) (`supabase/migrations/044_hindrance_photos.sql:292-304`).
- Both policies restrict to `authenticated`; `anon` gets no grant at all on
  either table (`supabase/migrations/043_daily_log_photos.sql:287-297`,
  `supabase/migrations/044_hindrance_photos.sql:312-320`).

**`dprs` SELECT RLS (023) is project_members-scoped, not PM-only.**
`dprs_select` requires `tenant_id = get_user_tenant_id()` AND a
`project_members` row for the caller on that project — with **no
`role = 'pm'` filter** (`supabase/migrations/023_dpr_reports.sql:170-179`).
Any project member (pm, qs, etc.) can read a `dprs` row today.

**Daily-logs and DPR pages have no role gate; the dashboard layout checks
auth only.**
- `app/(dashboard)/daily-logs/page.tsx:17-20`: "NOT role-gated here: read
  access is preserved for every project_members role, only the edit
  affordances on the detail page itself are gated on `role === 'pm'`."
- `app/(dashboard)/daily-logs/[logId]/page.tsx:9-13`: "Read access is NOT
  role-gated (any project_members row, any role); only the edit affordances
  inside `LogDetailView`'s children are gated on `role === 'pm'`." The
  gating itself happens client-side in the component, via
  `canEditLog(viewerRole)` (`components/daily-logs/log-detail-view.tsx:41`,
  `viewerRole` passed in from `profile.role` at
  `app/(dashboard)/daily-logs/[logId]/page.tsx:42`
  (`viewerRole={profile.role}`)). `LogDetailView`
  (`components/daily-logs/log-detail-view.tsx`) currently renders only
  Day/Morning/Evening scalar-field sections — no photo section exists yet.

  **REVISION 2026-09-17 (per Aravind):** `canEditLog`
  (`lib/daily-logs/correction.ts:131-133`) reads exactly:
  ```
  export function canEditLog(role: string | null): boolean {
    return role === 'pm'
  }
  ```
  — a direct `=== 'pm'` comparison against whatever `role` string it's
  given, which today is `viewerRole` = `profile.role` = `users.role`
  (`app/(dashboard)/daily-logs/[logId]/page.tsx:42`,
  `lib/auth/profile-query.ts:17,35-39`) — **never**
  `project_members.role`. Per the D3 revision above, a real PM's
  `users.role` is `'admin'` on prod, not `'pm'`. This package makes no
  claim about whether that has actually broken edit affordances in
  production — only that the code, read as written, compares the wrong
  column for that purpose. See Open Questions.
- `app/(dashboard)/dprs/[id]/page.tsx:24-33`: relies entirely on the
  `dprs_select` RLS policy for access control — a `null` return from
  `getDprDetail` (no row, or a row RLS denies) renders the identical
  `notFound()` page either way, "so a PM must never be able to distinguish
  'this report doesn't exist' from 'it exists but you can't see it.'" The
  page itself contains no role/profile check at all.
- `app/(dashboard)/hindrances/page.tsx:15-19`: same convention, explicit —
  "no role gate, no redirect... open to any authenticated user, scoped by
  data." Here the *query* (`lib/hindrance/queue.ts`) does check for a
  `project_members` row with `role = 'pm'`
  (`lib/hindrance/queue.ts:171,176,290`) and returns a `not-a-pm` status
  when none exists, which the page renders as a dedicated empty-state
  string, "You're not the PM on any project..."
  (`app/(dashboard)/hindrances/page.tsx:47-48`) — **this is a visible
  empty state for a non-PM, not "no section at all."** Flagged as a
  precedent that diverges from D3's stricter requirement — see §8.
- `app/(dashboard)/layout.tsx:38-42`: `if (!user) redirect('/login')` is the
  entire gate — no role check anywhere in this file. Independently
  corroborated in `docs/build-status.md:160-163`: "The dashboard layout
  (`app/(dashboard)/layout.tsx`) has no role gate today, only an auth check."

**`lib/dpr/select-photos.ts` — `selectDprPhotos` both selects and
downloads.** The function (`lib/dpr/select-photos.ts:144-265`) does
everything in one pass: readiness gate (F1, lines 152-180), evening-photo
candidate query against `daily_log_photos` (lines 182-197), hindrance-photo
candidate query against `hindrance_photos` (lines 199-214), then a loop that
downloads bytes via Storage, applies the 10-photo/15 MB caps, and returns
`EmailAttachment[]` (lines 216-265). **Its only production caller** is
`lib/dpr/owner-deliver-dispatch.ts:446-450`:
```
const photoSelection = await selectDprPhotos(
  { tenantId: project.tenant_id as string, projectId: payload.project_id, engineerId: row.engineer_id, logDate: payload.log_date },
  { requireReady: !deps.forceSendWithoutPhotos },
  client,
)
```
keyed on `(tenantId, projectId, engineerId, logDate)` exactly as the task
brief states. Verified as the sole caller: `grep -rn "selectDprPhotos" app
lib` matches only this call site, the function's own definition/export,
and comments referencing it.

**Owners have no dashboard login.** `scripts/provision-beta-owner.ts:3`
("INSERT a `users` row: role='owner', auth_id=NULL...") and
`scripts/provision-beta-owner.ts:137-143` (an explicit runtime assertion
refusing any non-null `auth_id` for this row) confirm this is enforced, not
just documented. Independently corroborated by `docs/build-status.md:134-136`
("Owners currently have `auth_id = NULL` and `whatsapp_number = NULL`
(neither the web-login path nor the WhatsApp path can reach them today)")
and `CLAUDE.md:834` ("owner — receives DPR via WhatsApp + email. No web
login in Phase 1.").

**No photo API route exists today.** `find app/api -iname "*photo*"`
returns nothing; `ls app/api` shows only `cron`, `jobs`, `owner`,
`whatsapp`. D6 (§4) is entirely new.

---

## 4. Decisions

All approved by Aravind, 2026-09-17 (recorded here as the source — these
are new decisions for this package, not all independently pre-existing in
the repo; where one already appears elsewhere, that is cited above in §2/§3).

- **D1.** Daily log page shows morning (attendance) photos too, under
  their own heading.
- **D2.** DPR page shows the same photo set, same order, as the Owner DPR
  email (evening, then that day's hindrance photos for the same
  tenant+project+engineer+date), with no count or size cap.
- **D3.** A viewer who is not a PM on that project sees **no photo section
  at all** (not an empty state). Note the divergence from the existing
  hindrances-page convention (§3, §8): that page shows a visible "You're
  not the PM..." message for a non-PM; D3 is stricter — nothing renders.

  **REVISION 2026-09-17 (per Aravind):** the "is this viewer a PM" check
  for every photo decision in this package MUST use
  `project_members.role = 'pm'` **for the photo's own project** — it must
  **NEVER** use `users.role` / `profile.role`. This matters concretely:
  for a real PM on prod, `users.role` is `'admin'`, not `'pm'`. Chain of
  citations:
  - `app/(dashboard)/projects/new/page.tsx:49-54` — creating a project
    always inserts a `project_members` row with `role: 'pm'` for the
    creating user, regardless of that user's own `users.role`.
  - `supabase/migrations/016_corrections.sql:177-181` —
    `complete_onboarding` sets the caller's own `users.role` to
    `'admin'` on tenant creation (`role = 'admin'` at line 180).
  - So the person who actually manages a project day-to-day (creates it,
    is its `project_members.role = 'pm'`) is, on prod, the same person
    whose `users.role` is `'admin'` — the two columns disagree by
    construction, not by accident.
  - `profile.role` (the value a page would reach for instead) is sourced
    directly from `users.role`: `lib/auth/profile-query.ts:17` (`select
    'id, tenant_id, full_name, role'` against `.from('users')`) and
    `lib/auth/profile-query.ts:35-39`. It is never `project_members.role`.
  - The one existing consumer of a role value on these pages already gets
    this wrong in exactly this way — see the `canEditLog` finding below
    and the Open Questions entry it produces.
- **D4.** "Kept until {date}" shown per photo from `expires_at`, as an IST
  date; hidden once the date has passed (nothing deletes until stage 6).
- **D5.** Add a tenant check to the photo access check (defence in depth;
  it is the only barrier between tenants) — closing the gap named in §3
  (`lib/storage/photo-access.ts:56-62`).
- **D6.** One photo route (e.g. `/api/photos/[kind]/[photoId]`) that, on
  every request: requires a logged-in session; resolves the caller's
  `users` row (the codebase's existing pattern for this is `getProfile`,
  `lib/auth/profile.ts:21`); loads the photo row by id via `service_role`;
  checks tenant match, PM on the owning project (via `daily_logs` for
  daily-log photos, via `hindrances` for hindrance photos — ~~the exact join
  shapes already proven correct by the RLS policies in §3~~), and
  `photo_url` not null; mints a 5-minute signed URL (reusing
  `SIGNED_URL_TTL_SECONDS`, already defined at
  `lib/storage/photo-access.ts:25`); redirects to it. Every failure
  returns the SAME response (same status, same body) so a caller cannot
  tell "wrong tenant" from "not PM" from "doesn't exist" — this mirrors
  `getSignedPhotoUrl`'s own existing design principle, stated at
  `lib/storage/photo-access.ts:75-83` ("Deliberately ONE failure shape...
  never throws for an authorization failure"). No-store caching. Signed
  URLs never appear in page HTML or email. Pages render `<img>` pointing
  at this route.

  **REVISION 2026-09-17 (external review, Q4):** the RLS joins cited in §3
  are proven for RLS-as-user only. D6 re-implements those same joins in
  TS, under `service_role`, where RLS is bypassed entirely — that is a NEW
  copy of the join logic, not a reuse of the proven one, and it is proven
  only by the extended boundary-agreement matrix (C2, below), never by
  citing the RLS policy text. See `docs/reviews/stage5a-review-verdict.md`,
  Q4.
- **D7.** Split `selectDprPhotos` into (a) a shared "which photos"
  selector used by both the DPR page and the email, and (b) email-only
  download/cap/overflow logic. **HARD CONDITION:**
  `test/dpr-photo-selection.test.ts` and `test/owner-deliver-job.test.ts`
  pass with ZERO edits. Both files exist today (`ls test/` confirms) and
  both import the current public surface directly —
  `test/dpr-photo-selection.test.ts:5` imports `selectDprPhotos,
  buildDprPhotoOverflowLine, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES` from
  `@/lib/dpr/select-photos`, and exercises ordering, both caps, the
  readiness gate (F1), and the failed-download-skip behaviour (F2)
  end-to-end against real test-db/Storage
  (`test/dpr-photo-selection.test.ts:209-456`).
  `test/owner-deliver-job.test.ts` exercises the same behaviour through
  the full `handleOwnerDeliverJob` pipeline, not `selectDprPhotos` in
  isolation (`test/owner-deliver-job.test.ts:13-25`). Zero edits to either
  file means the split must preserve `selectDprPhotos`'s exact name,
  signature, and combined behaviour as the public entry point — most
  naturally, `selectDprPhotos` becomes a thin wrapper composing (a) and
  (b) internally. The email's order, 10-photo/15 MB caps, overflow line,
  readiness gate, and Sentry fingerprint are unchanged.

**NEW 2026-09-17 (per Aravind):**

- **D8. Empty states.** "No photos for this log." appears **only** on the
  daily log detail page (PM viewer, zero morning AND zero evening photos).
  DPR detail with zero photos: no photo section at all — no string, no
  placeholder. A hindrance card with zero photos: nothing rendered — no
  string, no placeholder. No new strings beyond the six in §5.
- **D9. Uploads in progress.** Dashboard pages (daily log detail, DPR
  detail, hindrances queue) show whatever photos exist right now — they
  never wait, and never hide the photo section because an upload is still
  pending. **Only the Owner email keeps its readiness gate**
  (`requireReady`, `lib/dpr/select-photos.ts:152-180`). The D7 shared
  selector must let the page-side consumer skip the readiness gate
  entirely while the email path's `selectDprPhotos` behaves exactly as it
  does today (`requireReady: !deps.forceSendWithoutPhotos`,
  `lib/dpr/owner-deliver-dispatch.ts:448`) — i.e. the shared "which
  photos" function itself should not hard-code F1's early-return; that
  gate belongs to the email-only wrapper, not the shared core, so the page
  consumer can call the shared core directly without it.

---

## 5. Approved user-facing strings

English only; each a named constant with the comment "Tamil owed, NOT
approved."

**REVISION 2026-09-17 (per Aravind):** per-page sections revised (R2, §6) —
the hindrance section is removed from the daily log detail page entirely,
and the hindrances queue gets no section heading at all. Changed cells
below show ~~the superseded value~~ followed by the current one; unchanged
rows are unmarked.

| String | Appears |
|---|---|
| "Kept until {date}" | ~~Daily log detail (per-photo, D4); DPR detail (per-photo, D4)~~ Daily log detail (per-photo, D4); DPR detail (per-photo, D4); hindrances queue (per-photo, D4) |
| "No photos for this log." | Daily log detail ONLY, empty state (PM viewer, zero morning AND zero evening photos for that engineer/date) — see D8 |
| "Morning photos" | Daily log detail, section heading (D1) |
| "Evening photos" | ~~Daily log detail, section heading~~ Daily log detail, section heading; DPR detail, section heading (D2) |
| "Hindrance photos" | ~~Daily log detail, section heading (if any hindrance that day); hindrances queue, per-card heading if grouped~~ DPR detail ONLY, section heading (D2, same set/order as the Owner email) — no longer appears on the daily log detail page, and never appears as a heading on the hindrances queue (cards show photos with no heading) |
| "Photo unavailable. Refresh to try again." | Any page rendering a photo, on a broken/failed `<img>` load |

Two of these six are already independently recorded as approved:
`docs/plans/media-capture-design.md:898-901` lists exactly "Kept until
{date}" and "No photos for this log." as the Stage 5a approved strings. The
remaining four ("Morning photos", "Evening photos", "Hindrance photos",
"Photo unavailable. Refresh to try again.") are not yet recorded in that
document as of `origin/main @ 2f7adc893e557e255fdb04bd3a8e39d14f7f4c30` —
they are new for this package, per the brief that produced it. No other
user-facing text may be added without approval.

---

## 6. Per-page behaviour

~~- **Daily log detail** (`app/(dashboard)/daily-logs/[logId]/page.tsx`,
  rendering via `components/daily-logs/log-detail-view.tsx`): morning +
  evening photo sections (D1), each under its own heading ("Morning
  photos" / "Evening photos"); a hindrance-photos section when the day has
  a hindrance with photos ("Hindrance photos"); "No photos for this log."
  when the PM has zero photos across all sections for this log; per-photo
  retention line (D4); same PM-only rule as every other section on this
  page today — except D3 requires the *entire photo section* to be absent
  for a non-PM viewer, a stricter rule than this page's existing "read
  access is preserved for every project_members role" convention
  (`app/(dashboard)/daily-logs/[logId]/page.tsx:9-13`) — see §8's risk on
  this.
- **DPR detail** (`app/(dashboard)/dprs/[id]/page.tsx`): the D2 photo set
  (evening then hindrance, same order as the email, no cap), same PM-only
  rule (D3). This page's *existing* access model is RLS-only, project-
  members-scoped, not PM-only (§3) — D3's photo-section gate is an
  *additional*, stricter check this page does not otherwise have anywhere
  in it today (no role check exists in `app/(dashboard)/dprs/[id]/page.tsx`
  at all, verified by reading the full 101-line file).
- **Hindrances queue** (`app/(dashboard)/hindrances/page.tsx`): photos on
  each card — no detail page exists for a hindrance today (confirmed: no
  `app/(dashboard)/hindrances/[...]` route found in the file tree this
  package inspected). Same PM-only rule; this page already computes
  PM-or-not today (`lib/hindrance/queue.ts:171,176`) so D3's stricter
  "no section" behaviour composes naturally with the existing `not-a-pm`
  branch (`app/(dashboard)/hindrances/page.tsx:47-48`) — for a genuine PM
  viewing a project they DO manage, no additional per-card check should be
  needed beyond what `getHindranceQueue` already scopes, provided that
  query is itself PM-scoped identically to the RLS policy (worth an
  explicit confirmation in review, not assumed here).~~

**REVISION 2026-09-17 (per Aravind):** per-page sections narrowed (R2), and
every PM check below is pinned to the R1 rule (§4 D3 revision) —
`project_members.role = 'pm'` for the photo's own project, never
`users.role`/`profile.role`.

- **Daily log detail** (`app/(dashboard)/daily-logs/[logId]/page.tsx`,
  rendering via `components/daily-logs/log-detail-view.tsx`): **"Morning
  photos" and "Evening photos" sections ONLY — no hindrance section on
  this page.** "No photos for this log." when the PM has zero morning AND
  zero evening photos for this log (D8); per-photo retention line (D4);
  D9 applies — whatever photos exist now render immediately, the page
  never waits on `evening_photos_status`/`photos_status` being anything
  other than what it currently is. Same PM-only rule as every other
  section on this page today — except D3 requires the *entire photo
  section* to be absent for a non-PM viewer (checked via
  `project_members.role = 'pm'` on this project, per the R1 revision —
  **not** `viewerRole`/`profile.role`, which is what this page currently
  threads through for the *edit* gate only,
  `app/(dashboard)/daily-logs/[logId]/page.tsx:42`,
  `components/daily-logs/log-detail-view.tsx:41`) — a stricter rule than
  this page's existing "read access is preserved for every
  project_members role" convention
  (`app/(dashboard)/daily-logs/[logId]/page.tsx:9-13`) — see §8's risk on
  this.
- **DPR detail** (`app/(dashboard)/dprs/[id]/page.tsx`): **"Evening
  photos" then "Hindrance photos" sections — the same set and order as
  the Owner email (D2), with "Kept until {date}" per photo (D4).** Zero
  photos: no photo section at all, no empty-state string (D8). D9
  applies — the page never adopts the email's `requireReady` gate; it
  shows whatever the shared selector currently returns. Same PM-only rule
  (D3), checked the same `project_members.role = 'pm'` way as above. This
  page's *existing* access model is RLS-only, project-members-scoped, not
  PM-only (§3) — D3's photo-section gate is an *additional*, stricter
  check this page does not otherwise have anywhere in it today (no role
  check exists in `app/(dashboard)/dprs/[id]/page.tsx` at all, verified by
  reading the full 101-line file).
- **Hindrances queue** (`app/(dashboard)/hindrances/page.tsx`): **photos
  shown on each card, with NO section heading, and "Kept until {date}"
  per photo (D4).** Zero photos on a card: nothing rendered — no string,
  no placeholder (D8). No detail page exists for a hindrance today
  (confirmed: no `app/(dashboard)/hindrances/[...]` route found in the
  file tree this package inspected). Same PM-only rule, checked via
  `project_members.role = 'pm'`; this page already computes PM-or-not
  today (`lib/hindrance/queue.ts:171,176`, itself filtered on
  `role = 'pm'`, not `users.role`) so D3's stricter "no section" behaviour
  composes naturally with the existing `not-a-pm` branch
  (`app/(dashboard)/hindrances/page.tsx:47-48`) — for a genuine PM viewing
  a project they DO manage, no additional per-card check should be needed
  beyond what `getHindranceQueue` already scopes, provided that query is
  itself PM-scoped identically to the RLS policy (worth an explicit
  confirmation in review, not assumed here).

---

## 7. Test plan (real test-db, per CLAUDE.md §7)

- **Route — identical failure response.** PM on the project gets a
  redirect (to a signed URL). The following all get the **identical**
  failure response (same status, same body): PM of another tenant, a
  non-PM member of the same tenant/project (the `qs` fixture pattern
  already established in
  `test/photo-access-boundary-agreement.test.ts:75-111,141-147`),
  logged-out, a nonexistent photo id, the wrong `kind` segment for a real
  id (e.g. requesting a `hindrance_photos` id via the `daily_log_photos`
  kind path or vice versa), and a tombstoned row (`photo_url IS NULL`) —
  this last case needs a new fixture (none of the current photo tests seed
  a tombstoned row; `daily_log_photos`/`hindrance_photos` rows are always
  seeded with a real `photo_url`, e.g.
  `test/photo-access-boundary-agreement.test.ts:177-189`).
- **3-segment and 4-segment paths.** Both conventions must resolve
  correctly through whatever path-parsing D6 uses (today's
  `extractDailyLogId` only handles 3 segments,
  `lib/storage/photo-access.ts:64-69`); a path/kind mismatch (e.g. a
  3-segment path requested under the hindrance kind) must be refused, not
  silently misparsed.
- **Tenant check (D5), proven by a case where membership would pass but
  tenant differs.** The existing "PM on another tenant's project"
  case in `test/photo-access-boundary-agreement.test.ts:247-254` does
  **not** exercise this: it uses a genuinely different PM (`pmBId`) who is
  correctly not a member of project A at all — `project_members` alone
  already denies them, so the tenant check specifically is never reached.
  To isolate D5, the fixture needs a `project_members` row that *would*
  satisfy `project_id` + `role = 'pm'` while the caller's own `tenant_id`
  differs from the photo's tenant — a state the real application never
  produces (every real `project_members` row is created for a user
  already in that project's tenant), but one a test fixture can construct
  directly: insert a synthetic `project_members` row pairing
  `TEST_PROJECT_A_ID` with a user whose own `users.tenant_id` is
  `TEST_TENANT_B_ID`. If this cannot be constructed against a real
  test-db (e.g. a constraint prevents it), state that explicitly and why,
  per the task's own instruction, rather than skip the case silently.
- **Boundary agreement, extended to hindrance photos.**
  `test/photo-access-boundary-agreement.test.ts` today only covers
  `daily_log_photos` against two boundaries (RLS, `getSignedPhotoUrl`).
  `hindrance_photos` currently has only **one** boundary under test — its
  RLS policy alone — because no TS-side reader existed before this stage;
  `test/hindrance-photos-rls.test.ts:18-27` states this explicitly ("
  `hindrance_photos` has no TS-side signed-URL reader this stage... that's
  stage 5... there is only ONE boundary to test"). Once D6 ships, this
  becomes the second boundary for `hindrance_photos` too, and the shared
  fixture-matrix idea in `test/photo-access-boundary-agreement.test.ts:226-291`
  should be extended (new cases, or a parallel `describe` block) to run
  every case through the new route/function AND the `hindrance_photos_select`
  RLS policy (`supabase/migrations/044_hindrance_photos.sql:292-304`)
  together, the same way it already does for `daily_log_photos`.
- **D2: DPR page selector and email selector agree.** For the same
  `(tenant_id, project_id, engineer_id, log_date)` key, the DPR page's
  photo list (built on D7's shared selector) and the email's own selection
  (built on the same shared selector, per D7) must return the same ids in
  the same order — this should fall out of D7's split by construction if
  both consumers call the same underlying function, but should be asserted
  directly as its own test, not merely inferred from the split's design.
- **D3: non-PM viewer.** Page render for a non-PM (same `qs`-in-tenant-A
  fixture shape as above) must show **no photo section markup at all** —
  not a hidden-but-present section, not an empty-state string — on the
  daily-log detail, DPR detail, and hindrances-queue pages.
- **D4: retention line.** A photo with `expires_at` in the future shows
  "Kept until {date}"; a photo with `expires_at` in the past shows nothing
  (no line at all, no tombstone — §2 non-scope). An IST date-boundary case:
  a photo whose `expires_at` falls on the IST calendar-date boundary
  (e.g. just before/after local midnight IST) should be exercised
  explicitly, since `expires_at` is stored/generated in UTC
  (`timezone('UTC', ...)`, `supabase/migrations/043_daily_log_photos.sql:189-199`)
  and the display rule is stated as an IST date.
- **D7: the two Stage 4 test files pass unmodified.** State the check
  explicitly: `git diff origin/main -- test/dpr-photo-selection.test.ts
  test/owner-deliver-job.test.ts` must be empty after the split.

**NEW 2026-09-17 (per Aravind):**

- **R1: the real-PM shape sees photos.** A caller whose `users.role` is
  `'admin'` (per the R1 revision, §4 D3) and whose `project_members.role`
  is `'pm'` on the photo's own project — the actual shape a real PM has on
  prod, per `supabase/migrations/016_corrections.sql:177-181` and
  `app/(dashboard)/projects/new/page.tsx:49-54` — **DOES** see photos on
  every page in scope. Note this is, precisely, the shape the *existing*
  `pmAId`/`pmBId` fixtures already have: `ensureTwoTenantFixtures` claims
  both via `claimProfile(..., 'admin', ...)`
  (`test/helpers/db.ts:1055-1056`, `claimProfile`'s 4th parameter being
  `role`, `test/helpers/db.ts:997-1001`) — `users.role = 'admin'` — and
  only gains `project_members.role = 'pm'` from a separate, later insert
  (`test/photo-access-boundary-agreement.test.ts:122-132`). So the
  existing "PM on the owning project" positive case in
  `test/photo-access-boundary-agreement.test.ts:239-246` already
  incidentally exercises this exact shape against `getSignedPhotoUrl` —
  this test-plan entry is about making that coverage **explicit and
  deliberate** for the new route (D6), not merely inherited by fixture
  accident, and about covering every page in §6, not just the one
  function this package's existing fixtures already touch.
- **D9: pending hindrance does not hide the DPR page's other photos.**
  Seed a DPR-page key where the evening photos are complete but a same-day
  hindrance's `photos_status` is `'pending'`
  (`supabase/migrations/044_hindrance_photos.sql:167-180`). The DPR
  detail page (via the shared, non-gated selector) must show the completed
  evening photos now, not wait for the hindrance. The email path
  (`selectDprPhotos` with `requireReady: true`) must still report
  `photosReady: false` and take its existing throw-for-retry branch
  (`lib/dpr/owner-deliver-dispatch.ts:451-455`) for the same key,
  unchanged from today.
- **NULL-tenant caller refused.** The route must refuse a caller whose own
  `users.tenant_id` is `NULL` — the `+smoke020` prod shape
  (`docs/build-status.md:253-255`) — with the same identical failure
  response as every other denial case above, not a crash or a different
  status from a null-vs-null tenant comparison.

---

## 8. Risks and what breaks (product terms)

- **Owner email regression via D7.** The Owner DPR email's photo
  attachment behaviour (order, caps, overflow line, readiness gate, Sentry
  fingerprint) is currently implemented as one function with one set of
  callers (§3). Splitting it risks a behavioural drift that the two
  existing Stage 4 test files are specifically relied on to catch (D7's
  hard condition) — but only for what those files already assert; any
  email behaviour those tests don't cover could silently drift.
- **Per-image request cost.** D6's design is one route call per photo,
  each doing its own row lookup, tenant/PM check, and signed-URL mint. A
  DPR with many photos (D2 has no cap, deliberately) means a
  proportionally large number of route calls, each with its own database
  round-trips, on a single page render — this is a real cost the current
  design does not amortize (no batch-signing, no shared verification
  across photos on the same page). See §9's question on this directly.
- **Signed URL visible in the browser after redirect.** D6 redirects to a
  signed URL rather than streaming bytes through the route; the final
  image request the browser makes is to the signed Supabase Storage URL
  itself, which is then visible in browser dev tools / network tab / (per
  `lib/storage/photo-access.ts:21-24`'s own reasoning about leaked URLs)
  potentially browser history, for the 5-minute TTL window. This is a
  narrower exposure than a page linking directly to a signed URL in HTML
  (D6 explicitly avoids that), but it is not zero exposure — see §9.
- **D3 depends on a PM check the layout doesn't have.** Every page in
  scope here (`app/(dashboard)/layout.tsx:38-42`) has no role gate at the
  layout level — only an authenticated-user check. D3's "no section at
  all for a non-PM" therefore has to be implemented independently, per
  page, inside each page/component (daily-log detail, DPR detail,
  hindrances queue) — there is no single choke point today that already
  knows "is this viewer a PM on this project" the way the layout knows "is
  this viewer logged in." The hindrances queue is the closest existing
  precedent (`lib/hindrance/queue.ts:171,176`) but even that produces a
  visible empty state today, not "no section," which is what D3
  specifically asks for as a *stricter* behaviour — a real, new behaviour
  to build and verify, not something inherited for free from an existing
  pattern.
- **NEW 2026-09-17 (per Aravind): wrong-column PM check would hide photos
  from real PMs, silently.** Because `canEditLog`
  (`lib/daily-logs/correction.ts:131-133`) already compares `role ===
  'pm'` against a value sourced from `users.role`
  (`app/(dashboard)/daily-logs/[logId]/page.tsx:42`,
  `lib/auth/profile-query.ts:17,35-39`) — and a real PM's `users.role` is
  `'admin'` (`supabase/migrations/016_corrections.sql:177-181`) — there is
  a proven-in-code precedent, one function over, for reaching for the
  wrong column when implementing "is this viewer a PM." If D3/D6's own PM
  check is written the same way (`profile.role === 'pm'` instead of
  `project_members.role === 'pm'` for the specific project), the failure
  mode is not a security hole but its mirror image: a real PM would see
  **no photos at all**, on every page, with no error — indistinguishable
  from D3 working exactly as designed for a genuine non-PM. This is the
  single highest-value thing to get right in review, precisely because it
  fails silently and looks correct.
- **REVISION 2026-09-17 (per Aravind):** now confirmed on prod, not just a
  risk (see the Open Questions revision above and `docs/build-status.md`'s
  new backlog item, same date) — `canEditLog` gating the daily-log
  correction RPC on `users.role` really does hide edit controls from a
  real PM today. 5a's shared "is this viewer a PM on this project" check
  (`project_members.role = 'pm'`, §4 D3/D6) is intended to be reused by
  that later correction-gate fix — it should therefore live in one `lib`
  function, not be written inline per page, so the fix has one place to
  call into rather than a second copy of the same logic.

---

## 9. Questions for the external reviewer

1. Is redirect-to-signed-URL acceptable for D6, versus streaming photo
   bytes through the route directly? A redirect exposes a real (if
   short-lived) Supabase Storage URL in the browser's network layer,
   which streaming bytes through the route itself would not.
2. Is the identical-failure-response requirement (D6) sufficient as
   specified — same status, same body — or does it also need identical
   *timing* (a fast DB-miss vs. a slower tenant/role check could be a
   timing side-channel), matching the spirit of
   `lib/storage/photo-access.ts:75-83`'s own "one failure shape" design?
~~3. Is D7's split of `selectDprPhotos` safe given
   `owner-deliver-dispatch.ts`'s own readiness/retry coupling (F1: a
   `requireReady=true` early return with zero Storage calls,
   `lib/dpr/select-photos.ts:152-180`, feeding a job-level retry-by-throw
   at `lib/dpr/owner-deliver-dispatch.ts:451-455`)? Does the shared
   "which photos" selector need to preserve the exact readiness-gate
   short-circuit for the DPR-page consumer too, or does the page need
   different readiness semantics than the email (e.g. showing photos that
   exist even while others are still uploading)?~~

   **REVISION 2026-09-17 (per Aravind):** the page's own readiness
   semantics are no longer an open question — D9 (§4) decides it: the
   page never adopts the readiness gate; it always shows whatever the
   shared selector currently returns. Q3 narrows to only the mechanical
   half:

3. Is D7's split of `selectDprPhotos` safe given
   `owner-deliver-dispatch.ts`'s own readiness/retry coupling (F1: a
   `requireReady=true` early return with zero Storage calls,
   `lib/dpr/select-photos.ts:152-180`, feeding a job-level retry-by-throw
   at `lib/dpr/owner-deliver-dispatch.ts:451-455`)? Specifically: can the
   shared "which photos" core be factored out with the F1 gate living
   only in the email-only wrapper (per D9's own requirement, §4), without
   changing the email wrapper's own observable behaviour at all — i.e. is
   there any part of F1's current early-return (zero Storage calls, zero
   candidate-row queries) that is actually load-bearing *inside* the
   shared core itself, rather than cleanly separable into the wrapper?
4. Should the new route (D6) share code with `getSignedPhotoUrl`
   (`lib/storage/photo-access.ts:85-115`), or replace it outright? Today
   `getSignedPhotoUrl` has zero production callers (§3) — is there any
   reason to keep it as a separate, still-3-segment-only function once D6
   exists, or should D6 absorb and retire it?
5. Rate limiting and per-request query cost for D6: given §8's per-image
   cost risk, should this route reuse the existing in-memory,
   per-warm-instance, fixed-window rate limiter pattern already used at
   `app/api/owner/confirm-email/route.ts:115-135` (with its own named
   limitation, `app/api/owner/confirm-email/route.ts:121-132`, that it is
   not distributed across Vercel instances)? Is per-IP rate limiting even
   the right axis for an authenticated, per-photo route, versus e.g.
   per-user or per-DPR?
6. Does anything here actually require a migration? This package's own
   position (§1) is no — confirm or dispute that conclusion, and if a
   migration is needed, name exactly what and why (this package
   deliberately does not design one).
7. **NEW 2026-09-17 (per Aravind):** Is the proposed shared project-PM
   check an appropriate single source for both 5a and the later
   correction-gate fix?

---

## 10. Rollout

**Light record only if no migration** — per §1's conclusion, expected. Note
that CLAUDE.md's FULL-tier order (`CLAUDE.md:631-634`) is written in
migration-shaped terms ("test-db apply", "DOWN rehearsal", "PITR observed",
"ledger"); for a FULL-tier change with no migration, those specific steps
are not applicable in their literal form — what still applies is: external
review (this package) → CI green → merge → prod deploy → verify by
observation → a short apply record (naming what shipped and how it was
verified, not a migration ledger entry, since there is none).

~~**Verify on prod by observation**: a PM sees their own photo; a second,
non-PM login cannot fetch it. This second part currently cannot be built
the normal way: Supabase Auth's "Allow new users to sign up" was disabled
on prod on 2026-09-17, verified by observation at the time — a new,
unregistered email at `/login` received "Signups not allowed for this
instance" (`docs/build-status.md:243-250`). There is no self-serve way to
create a second prod login to test D3/D6's non-PM denial today. See Open
Questions below for how to test this without re-enabling signups.~~

**REVISION 2026-09-17 (per Aravind): NO user creation on prod for 5a.**
The Admin-API disposable-user option below is struck, not pursued. Prod
verification by observation is instead:

  (a) Aravind's own PM login sees a real photo on each of the three pages
      in scope (daily log detail, DPR detail, hindrances queue).
  (b) A logged-out browser opening that photo's route URL (D6) directly
      gets the identical failure response (same status, same body) as
      every other denial case in §7.
  (c) Aravind's `+smoke020` login — which already exists on prod, has a
      login, `tenant_id` `NULL`, `role` `NULL` (`docs/build-status.md:253-255`)
      — opening that SAME photo route URL directly also gets the
      identical failure response.

  **Warning to include verbatim wherever this verification step is
  executed:** "Open the photo URL directly. Do not submit the
  /onboarding form this account lands on; it creates a new tenant." (The
  `+smoke020` login has `tenant_id IS NULL`, so `app/(auth)/auth/callback/route.ts:37`
  routes it to `/onboarding` on sign-in; submitting that form calls
  `complete_onboarding`, which unconditionally `INSERT`s a brand-new
  `tenants` row, per `supabase/migrations/016_corrections.sql:172-181` —
  this is exactly the "no check for an existing tenant_id" hazard already
  recorded at `docs/build-status.md:138-147`.)

The same-tenant non-PM case (a real `qs`/non-PM project member denied)
is proven on test-db only (§7). This package did not enumerate prod's
full user roster (out of scope, no Supabase commands run) and so does
not claim there is no existing non-PM prod identity that could serve
this case too — only that none was identified in what this package read,
and that it does not propose creating one either way. See UNVERIFIED.

**REVISION 2026-09-17 (per Aravind): prod DOES have a second tenant with
a real login, and the cross-tenant (D5) prod check was run.** Not
identified when this package was first written (the (a)/(b)/(c) list
above and the UNVERIFIED "full user roster" note both predate this):
`aravindanenator@gmail.com` is a real prod login, PM in a separate
tenant, "Ara con co" (`tenant_id`
`708c34a9-5139-4fb7-954a-5ad1992f2baa`). Full record:
`docs/reviews/stage5a-b1-b2-record.md`. Using that login, Aravind opened
the B1 photo route URL for a photo belonging to a DIFFERENT tenant
(`adaa7c70-aec8-43c3-ab4d-b47dd4c7cbd0`) directly on prod
(`app.quoco.co.in`) and got HTTP 404 — the same identical failure
response as every other denial case in §7/§10. ~~This is the D5 tenant~~
~~check itself verified on prod by observation, not merely inferred from~~
~~test-db coverage;~~ it does not change the same-tenant non-PM finding
above (that case still has no real prod identity to exercise it and
remains test-db-only, per §7's own coverage). This package did not find
any existing wording elsewhere stating a cross-tenant prod check is
impossible — the only related struck passage, above, was scoped to the
non-PM-login case (D3/D6), not the cross-tenant (D5) one, so nothing
further is struck here; this revision is additive.

**CORRECTION 2026-09-17 (per Aravind):** Check D is per Aravind (no
screenshot captured; see `docs/reviews/stage5a-b1-b2-record.md`). It
shows a PM from another tenant is refused on prod. It does not isolate
the D5 tenant comparison: that PM is also not a member of the photo's
project, so the project-PM check alone would refuse them too. D5
specifically is proven on test-db only (the photo row stamped with
another tenant while the caller is PM on the parent project).

---

## Open Questions

~~- **Testing the non-PM-login case on prod without re-enabling signups.**
  One option, not yet approved: mint a disposable test user directly via
  the Supabase Admin API (`auth.admin.createUser`, `service_role`),
  bypassing the public self-serve `/login` signup path entirely — this is
  exactly the mechanism `test/photo-access-boundary-agreement.test.ts:75-87`
  already uses against test-db (`ensureQsAuthUser`), just never pointed at
  prod. This still requires Aravind's explicit go-ahead before any prod
  write, and prod already carries two special-case `NULL`-role rows
  (`docs/build-status.md:253-255`) — worth deciding whether to mint a new
  disposable account or reuse an existing prod identity instead. Not
  decided here; flagged for Aravind's decision.~~

  **REVISION 2026-09-17 (per Aravind):** decided — no. See §10's revised
  prod-verification steps (a)/(b)/(c) above, which use Aravind's own
  existing PM login and the existing `+smoke020` login instead of
  minting anything new.
~~- **Existing edit controls may never render for real PMs.**
  `canEditLog` (`lib/daily-logs/correction.ts:131-133`) compares `role ===
  'pm'` against `viewerRole`/`profile.role`, which is sourced from
  `users.role` (`lib/auth/profile-query.ts:17,35-39`) — and a real PM's
  `users.role` is `'admin'` (`supabase/migrations/016_corrections.sql:177-181`).
  Read as written, this means the daily-log-detail edit affordances this
  function gates may never render for an actual PM on prod. **This
  package does not confirm that bug is live in production** — only that
  the code, read as written, compares `users.role` where the decision it
  gates (project-level PM-ness) is a `project_members`-scoped fact. Not
  fixed as part of Stage 5a (out of scope — Stage 5a's own PM checks are
  pinned to `project_members.role`, per the R1 revision, §4 D3, precisely
  to avoid repeating this); to be verified and, if confirmed, fixed
  separately.~~

  **REVISION 2026-09-17 (per Aravind):** CONFIRMED ON PROD BY OBSERVATION,
  2026-09-17 (Aravind): logged in as a real PM (`users.role = 'admin'`,
  `project_members.role = 'pm'`), the daily log detail page shows no
  edit/correction controls. Aravind could edit earlier only while his
  `users.role` was temporarily set to `'pm'` as a manual-walkthrough
  workaround; that has since been reverted. Out of scope for 5a; tracked
  in `docs/build-status.md` (new backlog item, this same revision).
- **If a migration turns out to be needed after all** (§1's own
  conclusion is that none is), that determination and its reasoning
  belongs here, not designed inline in this package.
- Whether `getHindranceQueue`'s existing PM-scoping (`lib/hindrance/queue.ts:171,176`)
  is provably identical in scope to `hindrance_photos_select`'s RLS
  join (`supabase/migrations/044_hindrance_photos.sql:292-304`), so that
  D3's per-card photo gate on the hindrances queue can rely on the page's
  existing PM check rather than needing its own independent verification
  per card (§6).

---

## UNVERIFIED

- Any numeric estimate of actual query/latency cost for D6 (per-photo
  round-trip count, page-render latency under many photos) — §8 describes
  the *shape* of the cost (verified: one route call per photo, each doing
  its own lookups) but no real measurement was taken or found in the repo;
  do not treat any specific number as established.
- Current production row counts for `daily_log_photos` /
  `hindrance_photos`, or how close any row is to its `expires_at` today —
  this package ran no database query against any environment (out of
  scope, per the task's own instructions).
- Whether a `project_members` row with a mismatched `tenant_id` (the
  fixture §7 proposes for isolating D5) can actually be inserted against
  real test-db without hitting some constraint not visible from reading
  the migration files alone — flagged as something to confirm at
  implementation/rehearsal time, not assumed here.
- Whether `supabase/migrations/047_revoke_unused_table_rights.sql`'s own
  "APPLIED TO PROD" header comment (line 12) still reflects prod's actual
  current state — this package did not run `supabase migration list
  --linked` or any other live probe (out of scope); see the repo-state
  header at the top of this document.
- Prod's full user roster beyond the two `NULL`-role rows named in
  `docs/build-status.md:253-255` (Aravind's Gmail address and
  `+smoke020`) — this package did not enumerate prod users (no Supabase
  commands run) and cannot confirm whether any other existing prod
  identity is a non-PM member of a real project, which would matter for
  §10's own note that the same-tenant non-PM case is proven on test-db
  only.
