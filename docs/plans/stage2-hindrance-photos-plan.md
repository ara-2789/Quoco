# Stage 2 — Hindrance photo capture + email attachments — implementation plan

STATUS: ALL OPEN DECISIONS SETTLED (Aravind, 2026-09-14) — BUILT, this same
pass. See "DECISIONS, 2026-09-14" immediately below for what was decided and
how each open item from the first pass resolved. The original plan-only
pass's own reasoning is kept in place (struck through where superseded, per
this project's own correction discipline), not deleted, since the tradeoffs
it weighed are still the reason the decisions came out the way they did.

This plan implements stage 2 of `docs/plans/media-capture-design.md` item
20's build sequence ("Hindrance photo capture — HARD GATE: must ship before
stage 3"), plus the attachment half of stage 4 (pulled forward: the
hindrance email is the archive that justifies 60-day retention).

---

## DECISIONS, 2026-09-14 — every open item from §11 resolved

1. **§0 buffering — NOT TAKEN.** No session-context buffering. A photo
   arriving before the `hindrances` row exists (Q1 or Q2 open) is **not
   stored at all** — the engineer is told and the question re-asks.
   **APPROVED COPY:** `"Photo not saved yet. Answer the question, and I'll
   ask for photos at the end."` **Rationale (Aravind):** the new Q3 asks for
   photos explicitly moments later, so the only case buffering would ever
   help is a photo sent before the engineer has even described the problem
   — a narrow window. One re-send in that rare case is a smaller cost than
   building new machinery plus an abandonable-state class (§0's own
   rejection of option C already named the abandonment risk; this decision
   avoids introducing a different abandonable state — an orphaned buffer —
   in its place). **This narrows item 11 ("photos at any question") for the
   hindrance flow specifically** — recorded as a scoped exception with its
   reason, not a general reversal of item 11 for morning/evening.
   Photos arriving **after** the row exists (Q3, or any later turn) are
   stored normally, per the stage-1 rule already live in `inbound-start.ts`:
   a photo never answers a question, the caption is stored on the photo
   row, and the question re-asks with `"Photo saved. Type your reply for
   this question."`
2. **§3 bucket — REUSE `daily-log-photos`.** No second bucket.
   `lib/storage/photo-access.ts` is the entire access barrier for that
   bucket; a second bucket would duplicate that same risk surface rather
   than share it. Path convention extended for the hindrance parent,
   stated explicitly in §3 below and in the migration's own comment.
3. **§6 exhaustion — send without photos.** "A blocker the PM learns about
   late is worse than one without a picture" (Aravind) — the email is
   **never withheld**. If retries exhaust while `photos_status` is still
   `pending`/`failed`, the email sends anyway, with the copy in decision 4.
4. **§6 email copy — approved.** Unchanged when there are no photos. One
   line appended when photos are attached: `"2 photos attached."` /
   singular `"1 photo attached."`. When photos exist but retries exhausted
   before they finished uploading: `"Photos are still uploading — they'll
   be in the dashboard shortly."` Tamil pairs owed for all three, not
   drafted here, **not invented**.
5. **§1 point 2 (Q3 parsing) — settled by construction, not by a rule.**
   Not directly decided in these instructions, but resolved during build
   (§1 below): the RPC's step-3 branch treats any non-empty text as
   completion (my original recommendation), since there is still nothing
   for Q3 to validate beyond "the engineer is done."
6. **§4 job naming — `hindrance_media_ingest`**, a sibling job type, per
   the original recommendation ("reuse the media_ingest job path" is read
   as reusing the **architecture** — the jobs-table queue, `claimJobs`/
   `completeJob`/`failJob`, the download→upload→insert shape, the
   dead-letter/Sentry pattern — not the literal same `JobType` value, since
   the payload/target-table shape still differs as originally argued).
7. **§5 Resend attachments API — verified live, this pass** (WebFetch
   against `resend.com/docs/api-reference/emails/send-email` and
   `resend.com/docs/dashboard/emails/attachments`, 2026-09-14): the wire
   shape is `attachments: [{ content, filename, path?, content_type? }]`
   — `content` is a **Base64 string** (or a raw buffer; this codebase
   sends JSON, so Base64 string), `filename` required, `content_type`
   **snake_case on the wire** (optional — Resend derives it from
   `filename` if omitted; supplied explicitly here since the real
   content-type is already known from the Storage download).
   `path` (a remote URL) is a documented alternative **never used here** —
   the whole point of this stage is a durable copy independent of Storage
   retention, and email content is fetched via `service_role` bytes, never
   a URL, per `stage0-storage-setup-plan.md` §5's own already-decided
   split. **Size limit, documented directly: 40 MB per email, after
   Base64 encoding** — several orders of magnitude above what this stage's
   own real-send gate (§5) will actually measure.

---

Read `docs/plans/media-capture-design.md` first (22 decided items — "item N"
below cites that doc), then `supabase/migrations/043_daily_log_photos.sql`
and `docs/plans/stage1-photo-intake-plan.md`/`stage0-storage-setup-plan.md`
— stage 2 reuses their reasoning wherever it applies and says explicitly
where it deviates, per this pass's own instruction not to re-derive from
scratch.

Written on `worktree-evening-q5-caption-reversal`, after item 12's reversal
(2026-09-14, PR #274) — the live code today (`lib/whatsapp/inbound-start.ts`,
`lib/media/ingest.ts`) already reflects that reversal, and this plan is
built against that live code, not the (partially stale) stage-1 plan
document's own pre-reversal worked examples.

---

## 0. The one finding that shapes everything else

**Photos "at any question" (item 2) collides with how `hindrances` rows are
created today, and stage 1's own resolved-parent pattern does not transfer.**

For morning/evening, a photo at any step can always be stored immediately,
because `daily_logs` has a natural key that exists independent of the
photo — `(project_id, engineer_id, log_date)` — and `resolveOrCreateDailyLogId`
upserts a row on that key the moment the *first* photo of the day arrives,
before any question has even been answered (`lib/whatsapp/inbound-start.ts:441-455`).

`hindrances` has no equivalent key. Read directly against the live RPC
(`038_hindrance_flow_and_collision_fix.sql:357-368`): **the row is inserted
exactly once, atomically, at Q2's resolution**, with `description` (Q1) and
`timing`/`timing_raw` (Q2) supplied together in one `INSERT`. There is
nothing to upsert against before that point — an engineer could report
several hindrances in a day, so there is no per-day uniqueness the way
`daily_logs` has, and `description`/`timing` are the very thing each
question is collecting, not a pre-existing identity to key off of. A photo
sent while Q1 or Q2 is open has **no `hindrance_id` to attach to**.

This is not a new problem this plan is inventing — `docs/plans/adhoc-menu-
spec.md` (§28(aa) point 3, 2026-09-03, written before migration 038 existed)
already reasoned through exactly this and deliberately kept item 1 to two
questions specifically to avoid "coupling the flow's own completion to
infrastructure that doesn't exist," planning instead for photo capture to
land as a **free-standing message sent after confirmation** (an `UPDATE` on
`hindrances.photo_url`). Item 7/8 of the current design doc has since
superseded that plan — per-parent table, `photo_url` left dead — and this
task's own item 3 now asks for photo capture to be a **step inside the
flow**, which reopens exactly the coupling point 3 originally sidestepped.
That's not a mistake in this task's instructions; it just means the
sidestep is no longer available, and the plan below has to actually resolve
it.

**Three options, evaluated. DECIDED (Aravind, 2026-09-14): none of the three
— a fourth option, added at decision time: a photo before the row exists is
simply not stored, the engineer is told, the question re-asks.** APPROVED
COPY: `"Photo not saved yet. Answer the question, and I'll ask for photos
at the end."` This is cheaper than any of (A)/(B)/(C) below — it needs
neither new buffering machinery nor an RPC-side data-integrity argument —
at the cost of one possible re-send in the narrow case of a photo sent
before Q1/Q2 resolve. (A)/(B)/(C) are kept below exactly as evaluated, since
the same tradeoffs they weighed are why the simpler fourth option won.

- **(A) Buffer, then flush at row creation.** ~~RECOMMENDED.~~ **NOT
  TAKEN** — new machinery for a narrow case, and it introduces an
  abandonable state (a buffered photo whose flow is never completed) that
  option (C) below was already rejected for creating a version of. A photo
  sent
  while `current_step` is 1 or 2 (row doesn't exist yet) is appended, as
  small JSON metadata (Twilio `MediaUrl`/`MediaContentType`/caption — never
  the image bytes), to a new key in `whatsapp_sessions.context`
  (`pending_hindrance_photos`, an array) — the exact same "context is
  flow-scoped ephemeral storage" precedent item 13 already established for
  `last_media_nudge_at`. The moment Q2 resolves and the row is inserted
  (same RPC turn, same transaction, same row lock), the newly-known
  `hindrance_id` is used to flush every buffered item into real
  `hindrance_media_ingest` jobs (see §3), and the buffer key is cleared.
  From Q2's resolution onward (Q2's own resolving turn, and all of Q3), a
  `hindrance_id` already exists and photos are enqueued directly — no
  buffering needed past that point.
- **(B) Create the row early (right after Q1), with a placeholder state,
  and `UPDATE` it once Q2 resolves.** Rejected. `036_hindrance_timing_
  column.sql`'s own documented invariant (`timing = NULL` means
  **exclusively** "pre-menu legacy row, predates this column" — see that
  migration's own `COMMENT ON COLUMN hindrances.timing`) would collide with
  an in-progress row that also has `timing IS NULL`. Making this safe would
  require its own schema change (a new value in `timing`'s CHECK, or a
  separate `capture_status` column, or a `NOT NULL`-with-sentinel rework of
  `timing`) purely to make room for a state this project didn't previously
  need to represent — a bigger, riskier change than (A), and it touches the
  same invariant 036's reviewer round spent real effort making structural
  (`hindrances_timing_raw_pairing_check`). Not chosen.
- **(C) Enqueue immediately at Q1/Q2 using a "most recent hindrance for this
  reporter" lookup at job-run time**, mirroring `enqueueHindrancePmNotify`'s
  own `.order('created_at', desc).limit(1)` pattern. Rejected: that lookup
  is safe **only** because it runs synchronously, in the same request, right
  after the row it's looking for was just written — there is no window for
  a second hindrance to exist yet. A photo enqueued at Q1 sits in the job
  queue for an *unbounded* time if the engineer never finishes Q2 (session
  TTL, BOT-07 next-day reset, or he simply abandons the report) — by the
  time such a job ran, "most recent hindrance for this reporter" could
  resolve to a **different, unrelated, later** hindrance, silently
  misattributing the photo. This is a real data-integrity risk, not a
  theoretical one, and the whole point of this design pass (item 12's
  reversal) is a project that has just been burned once by exactly this
  class of silent misattribution. Not chosen.

**Consequence:** buffering is new machinery (nothing in this codebase
buffers pre-parent-row content today), and it requires one RPC change
beyond storing text answers: `apply_hindrance_flow_turn` needs to **return
the newly-inserted row's `id`** at the Q2→Q3 transition (currently the
function returns only `{outcome, current_flow, current_step}}` —
`038_hindrance_flow_and_collision_fix.sql:382-386`). This is an additive
change to the *return value*, not the *argument list* — no overload hazard
per `CREATE OR REPLACE FUNCTION`'s own signature rule — but it is still a
body edit to a live `SECURITY DEFINER` function and trips CLAUDE.md §0
condition (a) on its own broad reading ("CREATES OR MODIFIES a live
function's LOGIC — what it computes..."). Flagged for the external review
package (§9), not something this plan treats as free.

**DECIDED, 2026-09-14 — the fourth option above.** No buffer, no early row,
no recency lookup: a pre-row photo is rejected with the approved copy and
the question re-asks, unchanged otherwise. The RPC still needs to return
the new row's `id` at the Q2→Q3 transition (§1) — that requirement doesn't
depend on which pre-row-photo option was chosen, since Q3's own photos
still need a real `hindrance_id` the moment the row exists.

---

## 1. The flow becomes three questions, not two

**New sequence:** Q1 (description, unchanged) → Q2 (timing, unchanged,
**now inserts the `hindrances` row and advances to step 3 instead of
completing**) → Q3 (photo, new: "Send photos of the issue. Reply none to
skip.") → completion.

**RPC changes to `apply_hindrance_flow_turn` (038's live function),
itemized:**

1. Step 2's `v_complete := true` / `current_step := 0` branch (lines
   350-355) changes to `current_step := 3`, `v_outcome := 'advance'` — the
   `INSERT INTO hindrances` (lines 357-368) **stays exactly where it is**,
   unchanged in shape, just no longer coincides with flow completion.
2. New `ELSIF v_session.current_step = 3` branch: empty `v_text` reasks
   (unchanged convention); any non-empty text — `"none"` or anything
   else — completes the flow (`current_step := 0`, `v_outcome :=
   'advance'`). **DECIDED at build time: any non-empty text completes.**
   There is no column left to write at this step regardless of what was
   typed — "none" is the documented way to skip, but the flow does not
   reject or reask on other text, since there is nothing further to
   validate once the engineer has answered "done" in some form.
3. Return value gains the inserted row's `id`, per §0, threaded through
   only at the Q2→Q3 transition (every other outcome returns `hindrance_id:
   null` or omits the key).
4. **A photo never reaches this RPC at all**, at any step — this matches
   the live morning/evening mechanism exactly (`inbound-start.ts:496-501`:
   "Reask WITHOUT calling the RPC, in every case"). The TS wrapper
   (`applyHindranceFlowTurn`, `lib/whatsapp/flows/hindrance.ts`) is never
   called for a photo-only turn; a new sibling path (§2) handles it
   directly, mirroring `inbound-start.ts`'s existing morning/evening branch.

**This trips CLAUDE.md §0's external review gate, condition (a)** — it
modifies a live `SECURITY DEFINER` function's logic (step-completion point
moves, a new step is added, the return shape changes). Same tier as 038
itself. Full review package required before apply, not a same-session build.

**`CREATE OR REPLACE`, not DROP+CREATE** — the argument list is unchanged
(`text, uuid, uuid, uuid, text, boolean, text, boolean, timestamptz,
integer`), so this is a safe in-place replace per the project's own
signature rule; no re-grant needed, but the existing `REVOKE`/`GRANT`
statements (038's own, lines 390-395) should still be **re-asserted** in
the new migration for the same reason every prior `CREATE OR REPLACE` in
this project's history re-asserts them (defense against a future editor
assuming they persist automatically).

---

## 2. Question count vs. the six-question ceiling

**Finding, not assumed:** `design-principles.md:3`'s corollary reads "six
questions **per flow** is a hard ceiling" — the word "flow," on its own
text, does not visibly exclude ad-hoc flows. But every citation of this
ceiling anywhere in the repo (`design-decisions-beta-feedback.md` lines
866/1699-1709, `design-principles.md:216`, `docs/reviews/parser-digit-
misattribution-inventory.md:250`) is about morning or evening specifically —
grepped, confirmed, zero hits discussing the hindrance/ad-hoc flow's own
question count against this ceiling anywhere in `docs/`. **I could not find
either an explicit inclusion or an explicit carve-out for ad-hoc flows.**

My reading, offered as a recommendation, not a fact: the ceiling's own
stated purpose ("engineer-burden creep," rerouting *compulsory daily*
capture to PM/system-side) is about the mandatory, every-day check-in
surfaces. A hindrance report is engineer-*initiated* (he replies "1"
voluntarily) — structurally different from a compulsory daily flow the
ceiling was written to protect. **Recommend treating it as in-scope-but-
irrelevant here, not exempt-by-design** — irrelevant because of the number
itself, not the category:

**The concrete count makes this moot either way.** Hindrance goes from 2
questions to 3. Whether the ceiling covers ad-hoc flows or not, 3 is nowhere
near 6, and this is nowhere near evening's own already-spent one-time
append exception (item 1's "evening is AT the ceiling" — a different flow,
a different budget, on any reading where the exception is per-flow rather
than global). **No collision, either interpretation.** Confirm the
scope-of-the-ceiling reading with Aravind since I could not settle it from
the text alone, but nothing in this plan is blocked on the answer.

---

## 3. `hindrance_photos` — schema, deviating from 043 where it must

Follows `043_daily_log_photos.sql`'s proven shape (GENERATED `expires_at`,
real RLS, `REVOKE ALL` then narrow `GRANT`-back, `ON DELETE RESTRICT`,
argued tenant/parent pairing). Deviations, each named:

- **No `phase` column.** `daily_log_photos` needs `phase` because it serves
  two retention classes off one table. Hindrance photos have exactly one
  class. `retention_class` is kept anyway (not derived/omitted) — **my
  recommendation**, not one of the given decisions — so a future stage-6
  retention scan can treat both tables uniformly (`WHERE expires_at <
  now()`, iterating a fixed table list) without a schema-shape special
  case for the single-class table. If kept, it's `NOT NULL DEFAULT
  'hindrance' CHECK (retention_class = 'hindrance')` — a fixed value,
  explicit rather than implicit, matching this project's "no fabricated
  default that could silently mean something later" posture (036's own
  `submitted_via` fix is the precedent for why a fixed CHECK beats a bare
  default).
- **`expires_at` generated expression is simpler** — one interval, no
  `CASE`: `timezone('UTC', timezone('UTC', received_at) + INTERVAL '60
  days')`, same UTC-pin technique 043 had to adopt after Postgres rejected
  the bare `timestamptz + interval` form as non-immutable (043's own
  comment explains why; the fix transfers unchanged, only the `CASE` drops
  out since there's one duration, not two).
- **FK and RLS join is one hop shorter.** `hindrances` already carries
  `project_id` directly (unlike `daily_log_photos`, which has to join
  through `daily_logs.project_id` because `daily_log_photos` itself has no
  project column). RLS: `hindrance_photos.hindrance_id → hindrances.project_id
  → project_members(role='pm')` — two joins instead of three.
- **`ON DELETE RESTRICT` on `hindrance_id`**, same reasoning as 043
  (nothing in this codebase deletes a `hindrances` row today — grepped,
  confirmed at design-doc time, `docs/plans/adhoc-menu-spec.md` §28(aa)
  point 5 — so this is a free safety margin, not a behavior change).
- **Tenant/parent pairing argument, carried forward verbatim in spirit**:
  this table has exactly one writer (`lib/media/hindrance-ingest.ts` — see
  §5 — via `service_role`), which derives `tenant_id` and `hindrance_id`
  together from the same resolution, so a mismatched pairing is not
  reachable by construction. **Same expiry clause as 043's own comment**:
  this argument expires the moment a second writer is ever added.
- **Grants**: `REVOKE ALL` then `GRANT SELECT` to `authenticated`, `GRANT
  SELECT, INSERT, UPDATE` to `service_role` — **not** DELETE/TRUNCATE/
  REFERENCES/TRIGGER, identical reasoning to 043 (tombstoned, never hard-
  deleted, once stage 6 exists). `anon`: nothing.
- **Companion column, on `hindrances` itself (not this new table):**
  `hindrances.photos_status TEXT CHECK (photos_status IN ('pending',
  'complete', 'failed'))`, mirroring `daily_logs.{phase}_photos_status`
  exactly — needed by §6's PM-notify race fix. This is an `ALTER TABLE` on
  an existing, live table; additive and nullable, low structural risk, but
  still part of the same migration/review package since it's load-bearing
  for §6.

**Storage bucket — DECIDED (Aravind, 2026-09-14): reuse `daily-log-photos`.
No second bucket.** `lib/storage/photo-access.ts` is the entire access
barrier for that bucket (service_role only, no Storage RLS at all,
Aravind's stage-0 decision) — a second bucket would duplicate that same
risk surface rather than share it, for no real isolation benefit (both
buckets would carry the identical `service_role`-only, no-RLS posture
either way).

**Path convention, stated explicitly, per this decision's own requirement:**
`{tenant_id}/hindrance/{hindrance_id}/{photo_id}.{ext}` — four segments,
the literal string `"hindrance"` as the second segment disambiguating a
hindrance photo's path from a daily-log photo's own three-segment
`{tenant_id}/{daily_log_id}/{photo_id}.{ext}` convention. **Consequence for
`photo-access.ts`, named, not silently patched:** `extractDailyLogId`'s own
strict 3-segment parser is untouched — it is not used by the email
attachment path at all (§6 fetches bytes directly via `service_role`,
never through `getSignedPhotoUrl`), and no PM-dashboard signed-URL reader
for hindrance photos exists yet (§7), so nothing calls a 3-segment parser
against a 4-segment hindrance path this stage. If a signed-URL reader for
hindrance photos is ever built (stage 5), it needs its own path parser
(splitting on `/hindrance/` or checking segment count) — flagged here so
that future work doesn't assume `extractDailyLogId` already handles it.

---

## 4. Ingestion: a sibling job type, not an extension of `media_ingest`

**Recommend: `hindrance_media_ingest`, a new `JobType` value + a new
handler**, not branching inside `handleMediaIngestJob`. Reasoning:

- `jobs.type` is plain `TEXT NOT NULL`, no `CHECK` constraint
  (`006_jobs_queue.sql`) — adding a job type is a pure TypeScript change
  (`lib/queue/jobs.ts`'s `JobType` union + `app/api/jobs/tick/route.ts`'s
  dispatch switch), no migration required for the job type itself.
- The payload shape genuinely differs: `daily_log_id`/`phase` vs.
  `hindrance_id`, no phase concept, fixed retention class, a different
  target table, and (per §3) potentially a different bucket. Branching one
  handler on a discriminated payload adds conditional complexity for two
  things that don't actually share logic beyond "download from Twilio,
  upload to Storage, insert a row" — the same reasoning this codebase
  already applies elsewhere (`hindrance_pm_notify` is its own job type
  beside `dpr_generate`/`owner_deliver`, not a generalized "notify" job).
- `RETENTION_DAYS`/`RETENTION_CLASS` maps in `lib/media/ingest.ts` stay
  scoped to morning/evening; the hindrance handler hardcodes 60 (one
  value, one class) — no shared constant to keep in sync, avoiding the
  exact "two places compute the same duration" hazard 043's own generated-
  column comment already warns about (there, the fix was moving the
  computation into the DB; here, there's only one duration so there's
  nothing to keep in sync in the first place).

**Payload:** `{tenant_id, hindrance_id, caption, media}` — no `phase`.

**Handler** (`handleHindranceMediaIngestJob`, new file
`lib/media/hindrance-ingest.ts` or a second export from `lib/media/
ingest.ts` — naming not decided here): same download/upload/insert loop as
`handleMediaIngestJob`, targeting `hindrance_photos` instead of
`daily_log_photos`, no `phase` field to set. On completion, sets
`hindrances.photos_status = 'complete'`; on exhaustion,
`hindrances.photos_status = 'failed'` + Sentry alert (same dead-letter
shape as `markMediaIngestFailed`).

**Enqueue sites, per §0/§1:**
- Q1/Q2 (buffered): flushed by `applyHindranceFlowTurn` right after the RPC
  returns a non-null `hindrance_id` at the Q2→Q3 transition — one job per
  buffered item (or one job carrying all buffered items; either is fine,
  simplest is one job per original inbound message, matching how morning/
  evening enqueue one `media_ingest` job per webhook call rather than
  batching across turns).
- Q3 (direct): same pattern as morning/evening's active-flow branch
  (`inbound-start.ts:432-494`) — `hindrance_id` is already known (the
  session is at step 3, meaning the row exists), no buffering, enqueue
  immediately, set `photos_status = 'pending'`, reask without calling the
  RPC (per item 23, unconditionally — a photo is never a Q3 answer either).

**Cron placement:** same open flag item 4 already carries for
`media_ingest` — start inside `jobs/tick`'s existing dispatch, split to a
dedicated cron only if volume justifies it. Not decided here, same as
stage 1's own treatment.

---

## 5. `sendEmail` gains attachments

**Current shape** (`lib/email/send.ts`): `SendEmailParams = {to, subject,
text, html}`, one `fetch` to `POST https://api.resend.com/emails`.

**Planned change:** add an optional `attachments` field:

```ts
export interface EmailAttachment {
  filename: string
  content: string   // base64-encoded bytes
  contentType?: string
}

export interface SendEmailParams {
  to: string
  subject: string
  text: string
  html: string
  attachments?: EmailAttachment[]
}
```

`attachments`, when present, is included in the JSON body sent to Resend's
`/emails` endpoint. **VERIFIED live, 2026-09-14** (WebFetch against
`resend.com/docs/api-reference/emails/send-email` and `resend.com/docs/
dashboard/emails/attachments` — not a call against a real API response,
since this pass had no need to send a malformed request to discover the
shape, but the documentation itself, fetched fresh, not recalled from
training): the wire shape is `attachments: [{ content, filename, path?,
content_type? }]`. `content` is a **Base64-encoded string** (a raw buffer
is also accepted per the docs, not used here since this codebase sends
JSON over `fetch`). `filename` is required. `content_type` is **snake_case
on the wire** and optional (Resend derives it from `filename` if omitted)
— supplied explicitly here since the real content-type is already known
from the Storage download response. `path` (a remote URL) is a documented
alternative, **deliberately never used** — the entire point of this stage
is a copy independent of Storage retention, and `stage0-storage-setup-
plan.md` §5 already decided email content is fetched as bytes via
`service_role`, never a URL. **Size limit, documented directly: 40 MB per
email after Base64 encoding** — the TS interface below matches this wire
shape (`contentType` internally, mapped to `content_type` at serialization,
matching this codebase's usual camelCase-in/wire-shape-out convention).

**No change to the request/response shape discipline** — `describeResponseShape`,
the shape-only-never-content logging, `readCredentials`, the DI-injectable
`fetchFn` — all unchanged, additive only.

**Who calls this with attachments, in stage 2:** only `lib/hindrance/pm-
notify.ts`'s `handleHindrancePmNotifyJob` (§6). The DPR email's own
attachment work (item 22, first-10-by-arrival-order) is stage 4 in the
design doc's own sequencing and **out of this stage's scope** per the
task's own instructions — `sendEmail` is built generically so stage 4 can
reuse it without a second change to this file, but nothing wires it into
the DPR path this pass.

**Size/deliverability gate — REQUIRED, per the task's own instruction, not
assumed from the one measured sample.** One real photo measured 222 KB on
prod (given, not re-verified this pass) — base64 encoding inflates raw
bytes by roughly 4/3, so even a handful of photos stays under a megabyte
of encoded payload, comfortably under Gmail's ~25 MB attachment limit and
most corporate filters' thresholds. **This is not sufficient evidence on
its own** — a single sample says nothing about the actual size
distribution (photo resolution varies by device/network condition), and
"should be comfortable" is exactly the kind of claim this project's own
culture (CLAUDE.md's observation-over-checklist rule) requires backing
with a real send, not an estimate. **Plan for the gate:**
1. A one-off script (same shape as `scripts/verify-email-delivery.ts`) that
   sends a real email via `sendEmail` with N real photos attached (reusing
   already-uploaded test-db objects, downloaded via `service_role`, not
   fabricated bytes) to a real, already-confirmed test address (per
   CLAUDE.md's own WhatsApp-send confirmation rule, extended to email: use
   an address Aravind has already confirmed in chat, not inferred).
2. Confirm delivery via `getEmailStatus` (not just the synchronous 2xx —
   "queued is not delivered," this file's own standing rule).
3. Record the real encoded payload size and the delivery outcome in a
   `docs/reviews/` record before this ships, matching Phase A's own
   precedent for the hindrance email itself (`lib/hindrance/pm-notify.ts`'s
   header, "Phase A verified, 2026-09-07").
This gate blocks shipping attachments, not this plan.

---

## 6. The existing hindrance email: attach, don't link — and the async race

**Fetch mechanism**, per `stage0-storage-setup-plan.md` §5's own already-
decided split (dashboard = signed URL, email = direct `service_role`
bytes): `handleHindrancePmNotifyJob` downloads each `hindrance_photos.
photo_url` object directly via the `service_role` Storage client (the same
client `hindrance-ingest.ts`'s handler already holds — the job already
knows the tenant/hindrance it's attaching for, from its own query), never
minting a signed URL. **Signed URLs must never be placed in email** — this
was already decided for the DPR path in stage 0 planning and applies
identically here, restated so it isn't independently re-litigated for this
email.

**The async race, real, not hypothetical — the same shape item 4 already
named for DPR generation.** `enqueueHindrancePmNotify` fires **synchronously**,
the instant the flow completes (Q3's own resolving turn, per §1) — in the
same request, before any `hindrance_media_ingest` job has necessarily run.
`handleHindrancePmNotifyJob` itself runs on its own async poll cycle. If it
picks up the notify job before the photo job(s) have finished uploading,
attaching "whatever `hindrance_photos` rows exist right now" would silently
omit photos that are still mid-upload — the email would go out **without**
photos that were genuinely sent, defeating the entire justification for
this stage (item 10: "this is what makes the email a real archive").

**Fix, reusing existing infrastructure rather than building a new
hold-timer (unlike DPR-24's dedicated hold logic):** at the top of
`handleHindrancePmNotifyJob`, after loading the hindrance row, if
`row.photos_status === 'pending'`, **throw** a distinctly-tagged error
(e.g. `"hindrance-pm-notify: photos still uploading, will retry"`). This
job already retries on any failure via `lib/queue/jobs.ts`'s exponential
backoff (NFR-17, up to 5 attempts, matching this handler's own existing
per-PM-failure-throws-to-retry design) — reusing that budget as the "wait
for photos" mechanism costs nothing new to build, unlike DPR's own
dedicated timed hold.

**Exhaustion — DECIDED (Aravind, 2026-09-14): send without photos.** "A
blocker the PM learns about late is worse than one without a picture" — the
email is **never withheld**. If retries exhaust while `photos_status` is
still `'pending'` or is `'failed'`, `handleHindrancePmNotifyJob` sends the
email anyway, using the "still uploading" copy below, and logs a Sentry
anomaly (same shape as every other exhaustion path in this codebase —
`markMediaIngestFailed`'s own pattern — for someone to reconcile later,
not to block the send).

**Email copy — current text, and the approved change:**

Current (`buildHindrancePmNotifyEmail`, `lib/hindrance/pm-notify.ts:260-281`):
```
Subject: Hindrance reported — {project} — {date}
Text:    {engineer} reported a hindrance on {project}: "{description}".

         {timingLine}
```
No language anywhere about photos — the function has no parameter for a
photo count today.

**APPROVED (Aravind, 2026-09-14):**
```
Subject: Hindrance reported — {project} — {date}          (unchanged)
Text:    {engineer} reported a hindrance on {project}: "{description}".

         {timingLine}

         {photoLine}
```
Where `{photoLine}` is exactly one of, and unchanged when there are no
photos at all (the line is omitted entirely, matching the function's
existing posture of only ever stating true things):
- Photos attached: `"N photo(s) attached."` — plural template, rendered as
  `"1 photo attached."` (singular) or `"2 photos attached."` etc.
- Photos exist but exhaustion sent the email without them:
  `"Photos are still uploading — they'll be in the dashboard shortly."`
  (no count in this line — the exact count isn't the point once none of
  them made it in time).

`html` gets the equivalent paragraph, escaped through the file's own
existing `escapeHtml`. **Tamil pairs owed for all three lines above (the
attached-plural line, the attached-singular line, the still-uploading
line) — not drafted here, not invented, per Aravind's own instruction.**

---

## 7. PM dashboard signed-URL access — NOT built this stage, named so it isn't assumed

The task's stage 2 scope (items 1–5) does not include a PM dashboard view
for hindrance photos — that's stage 5 in the design doc's own sequencing,
same as the equivalent daily-log-photos dashboard surface. **Consequence:**
`hindrance_photos` gets real RLS (§3) from day one, matching this
project's "a new table's RLS/grants ship correct from day one" posture —
but **no `getSignedHindrancePhotoUrl` function is built this stage**,
because nothing calls it yet. This directly affects the test plan (§8):
the task's own instruction to include "the boundary-agreement shape 043
required... if this table gets a signed-URL read path" does not apply
this stage, since there is no TS-side access function to run the shared
fixture matrix against yet. RLS still gets its own isolation test (§8),
just not the dual-boundary-agreement shape 043 needed once
`getSignedPhotoUrl` existed to test against.

---

## 8. Test coverage required (CLAUDE.md §7)

- **RPC unit/integration tests** (mirroring 038/039's own test shape):
  Q1→Q2→Q3→completion happy path; Q2 exhausted-timing path still reaching
  Q3 (row written with `timing='unspecified'`, flow still asks for
  photos); Q3 empty-text reask; Q3 non-empty-text completion (whatever §1
  point 2 resolves to — "none" only, or any text); the RPC's new return
  field (`hindrance_id`) present exactly at the Q2→Q3 transition and
  absent/null otherwise.
- **Buffering mechanism** (§0/§4): a photo sent at Q1, another at Q2,
  neither creates a `hindrance_photos` row yet (no `hindrance_id`
  available) but both are recorded in `whatsapp_sessions.context.
  pending_hindrance_photos`; the moment Q2 resolves, both buffered items
  are enqueued as `hindrance_media_ingest` jobs against the real, just-
  created `hindrance_id`, and the buffer key is cleared. **Abandonment
  case**: a photo buffered at Q1, session then expires (BOT-07 TTL) or
  resets next-day without Q2 ever resolving — assert the buffered metadata
  is discarded along with the rest of the session's `context`, never
  silently attached to a later, unrelated hindrance report (this is the
  exact failure mode option (C) in §0 was rejected for; worth a test
  proving the chosen design doesn't reintroduce it by accident).
- **DOWN block, rehearsed against a live in-flight session** — per
  CLAUDE.md's own standing rule (migration 038's own DOWN rehearsal
  precedent): seed a session sitting at hindrance step 2 or 3, run the
  DOWN, confirm a subsequent turn against that session either completes
  cleanly or resets safely to idle, never calls a function the DOWN just
  removed.
- **RLS / cross-tenant isolation** for `hindrance_photos` (two-tenant
  fixture, PM sees only their own project's hindrance photos) — same
  standing requirement as every new table, independent of whether a
  signed-URL path exists yet (§7).
- **`service_role` negative-grant probe** — DELETE/TRUNCATE/REFERENCES/
  TRIGGER all denied, per the standing rule this project has now found
  gaps against twice (`dpr_versions`, `outbound_sends` round 1) — run
  directly against test-db, not the disposable dry-run scaffold (which has
  no analog to Supabase's own default ACL and would pass this probe
  regardless of whether the real REVOKE is complete — CLAUDE.md's own
  named limit on that scaffold).
- **`sendEmail` attachment tests**: unit test the request body shape
  (attachments array present/absent, base64 content correctly encoded);
  integration test against the real Resend API is the size/deliverability
  gate itself (§5), not a repeatable CI test (a real send with real
  credentials, run once as a gate, not part of the suite).
- **`handleHindrancePmNotifyJob` race fix**: `photos_status='pending'`
  throws (triggering retry) without sending; `photos_status='complete'`
  sends with attachments fetched from the real rows; **exhaustion
  behavior**, once §6's open question is resolved, gets its own test
  (either "sends without photos + Sentry anomaly" or "never sends,
  dead-letters" — whichever is chosen).
- **`hindrance-ingest.ts` handler unit tests** — same shape as
  `lib/media/ingest.ts`'s own tests: successful download+upload+insert;
  Twilio-download-failure (retry, dead-letter, Sentry); Storage-upload-
  failure (same); `expires_at` computed correctly at exactly `received_at
  + 60 days`.
- **Concurrency note, restated per CLAUDE.md's standing rule:** any test
  depending on two genuinely concurrent calls against the session row lock
  (e.g., a photo arriving at the exact instant Q2's turn is being
  processed) is CI-only in this sandbox — report as "not verified locally,
  CI-only," never as a local pass, per `docs/reviews/sandbox-cannot-test-
  concurrency.md`.

---

## 9. External review gate — what this stage trips, itemized

Per CLAUDE.md §0's trigger conditions, this stage (as a single PR, since
any one trigger means the whole PR needs the package):
- **(a) — modifies a live function's logic**: `apply_hindrance_flow_turn`
  (step-completion point moves, new step added, return shape changes).
- **(a) — creates a new function's logic**: the two new `SECURITY DEFINER`-
  or-`service_role`-only ingestion paths, if either ends up needing its own
  RPC rather than staying pure application code (not yet decided which —
  §4 describes a TS-only handler, no new RPC required for ingestion itself,
  only for the flow-turn change above).
- **(b) — creates a new table with its own RLS/grants**: `hindrance_photos`.
- **(b) — new bucket** (§3's open question, if the new-bucket option is
  chosen): additive infrastructure, same reading 042's own reservation
  entry already gave storage-bucket creation ("no function logic, no
  grants/RLS on an existing object... additive infrastructure, not a
  change to anything's access rules") — flagged for Aravind to confirm
  that reading again here, not re-asserted as settled.
- **Not (c)/(d)/(e)**: no auth/identity surface change, nothing
  irreversible beyond the same append-only/tombstone posture 043 already
  established, no money.

**Full external review package required**, same tier as 038/039/043 —
not a same-session build. Next available migration number, confirmed
against the current state of `supabase/migrations/` and `scripts/
migration-number-reservations.json` at the time this plan was written:
**044** — to be re-confirmed fresh at reservation time, not trusted from
this plan's own snapshot, per the standing "a local ref is not current
until re-checked" discipline.

---

## 10. Interim state, and the ordering gate this stage closes

**Before this stage ships (today):** a photo sent during an active
hindrance flow gets `PHOTO_REPLY` ("Photos aren't used yet..."), confirmed
directly against the live code (`inbound-start.ts:381-383`,
`media-reply.ts:55-59`). **Nothing interim is needed** — this is the same
honest, unchanged behavior stage 1 already left in place deliberately, and
stage 2 replaces it outright rather than patching an intermediate string
(matches stage 1's own §9.1 reasoning against interim copy churn).

**The ordering constraint this releases (item 16 / this task's own
callout):** stage 3's off-step nudge (item 6's approved copy, "reply 1,
then send the photo again") is only honest once hindrance capture actually
exists. **This plan, once built, closes that gate** — stage 3 can ship
after this stage lands, not before, exactly as item 16 already requires.
Nothing in this plan's own design changes that ordering; it's confirmed,
not re-derived.

---

## 11. Dependencies and open questions — resolution record

Every item from the first pass, and how each resolved (2026-09-14):

1. **§0 — buffering option?** DECIDED: none of A/B/C — reject-and-reask
   with the approved copy (see "DECISIONS, 2026-09-14" above).
2. **§1 point 2 — Q3 parsing?** DECIDED: any non-empty text completes.
3. **§3 — new bucket vs. reuse?** DECIDED: reuse `daily-log-photos`, four-
   segment path with a `"hindrance"` disambiguating segment.
4. **§3 — keep `retention_class` column despite one fixed value?** Kept,
   as originally recommended (uniform stage-6 retention scan across both
   tables) — not separately re-litigated by these instructions, carried
   forward.
5. **§5 — Resend's attachments API shape.** VERIFIED live this pass
   (WebFetch, 2026-09-14) — see "DECISIONS" item 7 above.
6. **§5 — the size/deliverability gate.** Run this pass — see §5's own
   updated real-send record below, or the review package
   (`docs/reviews/044-review-package.md`) for the full evidence.
7. **§6 — exhaustion behavior.** DECIDED: send without photos, Sentry
   anomaly, never withhold.
8. **§6 — email copy.** APPROVED (the three lines in "DECISIONS" item 4).
   Tamil pairs still owed, not invented.
9. **§2 — six-question ceiling's scope for ad-hoc flows.** Left
   unresolved as a general reading — still immaterial to this stage's own
   question count (3, nowhere near 6) — not addressed by these
   instructions, not re-litigated here.
10. **Naming.** `lib/media/hindrance-ingest.ts` as its own new file (built
    this pass) — cosmetic choice, stated for completeness.

---

## Sources

- `docs/plans/media-capture-design.md` — all 23 decided items, read in
  full this pass, including item 12's reversal.
- `supabase/migrations/038_hindrance_flow_and_collision_fix.sql`,
  `036_hindrance_timing_column.sql`, `037_hindrances_pm_notified_at.sql`,
  `039_hindrance_acknowledgement.sql`, `001_core_schema.sql` (`hindrances`,
  `jobs`) — read in full or targeted excerpt this pass.
- `supabase/migrations/043_daily_log_photos.sql` — read in full, the
  proven shape this plan extends.
- `lib/whatsapp/flows/hindrance.ts`, `lib/hindrance/pm-notify.ts`,
  `lib/whatsapp/inbound-start.ts`, `lib/whatsapp/media-reply.ts`,
  `lib/media/ingest.ts`, `lib/storage/photo-access.ts`, `lib/email/
  send.ts`, `lib/queue/jobs.ts` — read in full this pass.
- `docs/plans/stage0-storage-setup-plan.md`, `docs/plans/stage1-photo-
  intake-plan.md` — read in full this pass; §5 of stage0's own plan
  (dashboard-vs-email-attachment mechanism split) carries directly into
  §6 above.
- `docs/plans/adhoc-menu-spec.md` §28(aa) — read this pass; point 3's
  prior reasoning about photo capture and the row-write invariant is the
  direct precedent for §0's finding.
- `docs/design-principles.md` (§0 corollary + dated note),
  `docs/design-decisions-beta-feedback.md` (six-question-ceiling
  citations, grepped) — read this pass for §2.
- `scripts/migration-number-reservations.json` — read this pass; 043 is
  the highest reserved/applied number as of this plan.
- Grep evidence, this pass: zero hits for `hindrance_photos`,
  `hindrance_media_ingest`, `photos_status` (on `hindrances`) anywhere in
  migrations/lib/types; zero hits for any `attachments` field on
  `SendEmailParams`.
