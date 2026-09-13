# Stage 1 — Photo intake during check-ins — implementation plan

STATUS: PLAN ONLY, NOT BUILT, NOT APPROVED. No code, no migration, no
migration number reserved, no changes to `media-reply.ts` or
`app/api/whatsapp/webhook/route.ts` in this pass. This plan implements
stage 1 of `docs/plans/media-capture-design.md` item 20's build sequence
("Photo intake during check-ins. Requires item 18's interceptor move
(downstream, flow-aware).") against the 22 decided items in that doc.
Written on a fresh branch off `main`, post-merge of PR #255.

Read `docs/plans/media-capture-design.md` first — every reference below
("item N") points at that doc's decided items.

**DATED UPDATE (2026-09-13, same-day review pass).** Two decisions from
review, both recorded in the design doc:
1. **Item 23, "a photo is never an answer"** (Aravind) — a photo with no
   accompanying text never satisfies a question; the question stays open
   and re-asks. This closes the "real, unsolved interaction" §4 originally
   flagged (an empty `Body` landing on an ungated free-text step silently
   recording a blank answer) — struck through and corrected in place
   below, not left standing as an open gap.
2. **Stage 0 (storage setup) split out** as its own prerequisite stage,
   ahead of this one — see `docs/plans/stage0-storage-setup-plan.md`.
   Stage 1 now explicitly **requires stage 0 complete**, in addition to
   item 18's interceptor move.

---

## 1. Scope, precisely

**In scope for stage 1:**
- A photo sent while a morning or evening flow is **active** (a session row
  exists with `current_flow` set) is downloaded from Twilio and stored to
  Supabase Storage, tenant-scoped.
- Storage happens via a queued job (`media_ingest`), never inline in the
  webhook (item 4).
- Intake is uncapped (item 14, reversed) — every photo sent is stored, no
  count limit.
- Every stored photo row carries its retention class and a computed
  `expires_at`, stamped at the moment the row is written (not computed
  later) — attendance (morning) 7 days, evening progress 60 days (item 11,
  item 15).
- The media interceptor moves downstream (item 18): the accept/reject
  decision for a photo during an active flow is made at the point flow
  state is already known (`routeInboundMessage`'s active-flow branch /
  `dispatchInboundTurn`), not upstream of it.
- Captions accompanying a photo reach the normal answer parser for
  whichever question is open, and are also stored on the photo row (item
  12). A **photo with no accompanying text never satisfies a question**
  (item 23, new this pass) — the question stays open and re-asks.
- In-flow bursts (multiple photos, one per message) generate no
  photo-specific reply — whatever the underlying turn would already say is
  what the engineer sees (item 13).
- **Requires stage 0 (storage setup) complete** — bucket, path convention,
  and access rules must exist before intake can store anything (added this
  pass; see `docs/plans/stage0-storage-setup-plan.md`).

**Explicitly NOT in scope for stage 1** (later stages, per item 20):
- The off-step nudge (stage 3) — a bare photo with **no active flow**
  continues to get today's existing `PHOTO_REPLY` ("Photos aren't used yet.
  Please send your message as text.") unchanged. See Recommendation 1
  below for why this is now a known-stale string for two stages, not a
  contradiction stage 1 needs to resolve.
- Hindrance photo capture (stage 2).
- Email attachments, PM/dashboard surfaces, the retention deletion job
  (stages 4–6).
- Voice notes. `classifyMediaReply`'s voice branch is **unaffected** by
  this plan — voice stays rejected unconditionally, upstream, exactly as
  today. Nothing in items 1–22 changes voice handling; only the **photo**
  branch needs to move downstream. This is a load-bearing simplification
  for stage 1 and is called out explicitly so it isn't missed mid-build.

**SCOPE QUESTION I AM FLAGGING, NOT DECIDING:** `docs/plans/media-capture-
design.md` item 1 says "Evening goes 5→6 with the new photo Q2" and item 4's
original architecture assumed a **new, dedicated** evening question that
explicitly asks for photos (with "none" as a valid reply). I read the
**current, live** evening flow (`lib/whatsapp/flows/evening.ts`, migration
035/040) and confirmed it has exactly five questions (Q1–Q5), **none of
which asks for photos** — this dedicated Q2 has never been built. Item 11
(round 3) widened the design so photos are accepted at **every** question,
not only a dedicated one, but item 11's own text still refers to "evening
Q2" as if it exists ("A 'none' reply at evening Q2 is not final..."), and
item 1's ceiling note is written as settled fact. **Given SCOPE OF STAGE 1
as specified for this pass does not mention adding a new question, bumping
the flow's step count, or touching `apply_evening_flow_turn`'s/
`apply_morning_flow_turn`'s step order at all**, I have planned stage 1 to
need **no RPC step-order changes**: retention class is derived from which
**flow** is active (morning vs. evening) when a photo arrives, not from
which **step**. This satisfies items 11's storage/retention requirements
without touching the RPCs. If a dedicated "please send photos" question
(with its own prompt text, occupying a real step slot, bumping evening to
six questions) is intended to ship as *part of* stage 1 rather than a
separate, later piece of work, that is not covered by this plan and needs
its own decision — I have not assumed either answer.

---

## 2. Corrected facts (fold into design doc, done this pass)

Already applied to `docs/plans/media-capture-design.md` (item 19) as part
of this planning pass — a documentation-only correction, not code:

- A captioned photo **confirmed** to populate `Body` — verified live
  against Twilio's inbound message log (SID
  `MM1b568a6b25d047a6c302851d36102784`, body "This is a fan").
  `media-reply.ts`'s header comment claiming a mid-flow photo "would reach
  `dispatchInboundTurn` with an empty Body" is **wrong** for the captioned
  case, as currently written. The comment needs correcting when the
  interceptor move (item 18 / this stage) actually lands in code — not
  fixed in the source file by this planning pass.
- Item 19 moves from "payload-agnostic by design, unverified" to "verified
  for captions, partially" — the caption path is live code once stage 1
  ships, not a branch that may never fire.
- The uncaptioned case (`Body` for a photo with **no** caption — empty
  string vs. key absent) remains **genuinely unknown**. See §8 below.

---

## 3. Where the interceptor moves

**Today** (`app/api/whatsapp/webhook/route.ts:250-261`): `classifyMediaReply`
runs unconditionally, before `routeInboundMessage` is ever called. Any
`NumMedia > 0` message — active flow or not — gets a canned reply
(`PHOTO_REPLY` / `VOICE_REPLY`) and nothing else happens. This is what item
18 reverses.

**Planned:**

1. **Remove** the unconditional media check from `route.ts` (both `photo`
   and `voice` branches currently return early there).
2. **Voice stays exactly where it is, conceptually** — re-add an
   unconditional voice check somewhere upstream (route.ts is fine, since
   voice never depends on flow state and nothing in this design changes
   that). This can stay in `route.ts` or move into `media-reply.ts`'s own
   caller; either is fine since voice is flow-state-independent by design
   and always will be per this doc's own items.
3. **Photo detection moves into `routeInboundMessage`**, split by its two
   existing branches:
   - **Active flow branch** (`currentFlow !== null`, delegates to
     `dispatchInboundTurn`): this is where stage 1's real work happens —
     see §4.
   - **Idle branch** (`currentFlow === null`): keep returning today's
     `PHOTO_REPLY` for a bare photo at idle, **unchanged**, per §1's scope
     boundary. `classifyAdhocInput` never needs to see raw media params —
     media classification happens **before** the existing
     `classifyAdhocInput(params.message)` call, and short-circuits to
     `PHOTO_REPLY` exactly as `route.ts` does today, just one layer down.

This satisfies item 18's own decided approach ("move the media decision
downstream... rather than adding a second `readCurrentFlow` lookup
upstream") — `routeInboundMessage` already calls `readCurrentFlow` once;
photo classification piggybacks on that single read, no second lookup
added.

**Open implementation question item 18 itself already named, restated
here, not resolved:** the original upstream placement existed specifically
so a mid-flow photo never reached `dispatchInboundTurn` with an
unparseable/empty `Body`. Moving the check downstream means a mid-flow
photo **now does** reach the RPC layer (deliberately — that's how it gets
recorded/stored, see §4). Whether that produces an acceptable reply in
every case needs the walk-through in §4 to be checked against real
`EVENING_QUESTIONS`/`MORNING_QUESTIONS` gating, not assumed correct because
"the check moved."

---

## 4. What happens on an active-flow photo (the core mechanism)

**Decided in the design doc, restated as the mechanism this plan
implements:** a photo arriving mid-flow does **not** short-circuit the
turn. It does two things, in this order, inside the same webhook request:

1. **Enqueue a `media_ingest` job** (fast DB insert, well inside the
   15-second budget — same reasoning as item 4's own turn-taking shape),
   carrying everything needed to attribute and store the photo(s) later:
   tenant_id, project_id, phone_number, `daily_log_id`, `log_date`,
   `phase` (`'morning'` or `'evening'` — from `currentFlow`, not from which
   step), every `MediaUrl{i}`/`MediaContentType{i}` pair for `i` in
   `0..NumMedia-1`, the caption text (`Body`, possibly empty), and the
   Twilio `MessageSid` (for tracing, not for idempotency — see §7).
2. **Let the turn proceed exactly as it does today** — call
   `dispatchInboundTurn` (or, from the idle branch, nothing changes) with
   `message: params.Body` unchanged. **No changes to `apply_morning_
   flow_turn` / `apply_evening_flow_turn` are needed** — they already parse
   whatever text arrives, on whatever step is active, and already have a
   defined reask/advance/accept behavior for an empty or unparseable
   answer (Rule 3.5). The photo's caption (if any) is just today's `Body`,
   parsed exactly as if the engineer had typed it without a photo attached
   (item 12 — this is not new work, it already falls out of the existing
   architecture once the interceptor stops eating the message first).

**Resolving `daily_log_id` for the job payload:** neither
`applyEveningFlowTurn` nor `applyMorningFlowTurn` currently returns a raw
`daily_log_id` — only `log_date`. Two options, no RPC change required for
either:
- **(a) Recommended:** a secondary `daily_logs` lookup keyed on
  `(project_id, engineer_id, log_date)` — the same UNIQUE constraint
  `evening.ts`'s own `fetchMorningEquipmentEcho` already uses for a
  different field. Zero RPC changes, zero migration-number risk to the
  existing flow functions.
- **(b)** Extend `apply_evening_flow_turn`/`apply_morning_flow_turn`'s
  return payload to include `id`. Additive to a `RETURNS` shape via
  `CREATE OR REPLACE FUNCTION` with an **unchanged argument list** — safe
  per this project's own standing rule (the grant-loss hazard is specific
  to argument-list changes, not return-shape changes) — but touches two
  live, `SECURITY DEFINER` functions that already trip CLAUDE.md §0's
  external review gate condition (a) the moment their body changes at all,
  even for an additive return field. **(a) avoids that gate entirely for
  stage 1**; I recommend it for that reason, not decided here.

**Worked example — mid-flow photo, no caption, at a gated question**
(the exact case `test/webhook.test.ts`'s existing T-WH-13 seeds: morning,
step 2, "Plan of action"):
- A `media_ingest` job row is created (assertable in a test).
- Per item 23 ("a photo is never an answer"), the photo's `Body` — whatever
  it turns out to contain for the uncaptioned case (§8, still unresolved
  but no longer load-bearing here) — is **never passed to the answer
  parser** when there's no non-empty typed text alongside it. Step 2's
  question **stays open and re-asks**, exactly as an empty/whitespace text
  message already does today (Rule 3.5) — this is confirmed the same
  mechanism, not a new one (see the live-SQL confirmation below).
- The reply the engineer sees is the normal re-ask for step 2 — **not**
  `PHOTO_REPLY` any more, and **not** a silently-recorded blank answer
  either.

**Worked example — mid-flow photo WITH a caption that parses as a valid
answer** (e.g., evening Q2/Q3, "workers by trade," captioned "8 masons"):
- A `media_ingest` job row is created, `caption: "8 masons"`.
- `Body = "8 masons"` is non-empty typed text, so it reaches
  `parseLabourCount` exactly as an ordinary text-only answer would (item
  23 only withholds an *empty* `Body` from the parser). The step advances
  normally. The photo's own `caption` field also gets `"8 masons"` once the
  job runs (item 12: stored in **both** places).

**RESOLVED, 2026-09-13 (this same pass) — was: "a real, unsolved
interaction found while planning this, flagged not fixed here."** Struck
through in spirit, not left standing: the gap this plan originally flagged
— morning/evening's **ungated** free-text steps (morning Q2, evening Q1)
accept **any** `Body`, including an empty one, and unconditionally
advance, writing the empty string verbatim — is now **closed by item 23**,
decided this same pass specifically in response to this finding. Read
directly against the **live RPC SQL** (not inferred from TypeScript
comments, which was this plan's own earlier caveat) as part of this same
pass — see `docs/plans/stage0-storage-setup-plan.md` §8.2 for both
functions' relevant bodies, pasted verbatim:
- `apply_morning_flow_turn` (live in `038_hindrance_flow_and_collision_
  fix.sql`), step 2: `v_session.current_step := 3; v_outcome :=
  'advance'; v_col := 'plan';` — **zero gating**, confirmed.
- `apply_evening_flow_turn` (live in `040_evening_q5_tomorrow_needs.sql`),
  step 1: `v_session.current_step := 2; v_outcome := 'advance'; v_col :=
  'output';` — **zero gating**, confirmed, same shape.
Both write `v_text := btrim(COALESCE(p_message, ''))` verbatim regardless
of content. This confirms the gap was real, not hypothetical — and item
23 now means the **TS layer never sends an empty `Body` into these RPCs as
if it were the answer** in the first place, for a photo-with-no-text: the
RPC call for that turn either doesn't fire at all, or fires with a
mechanism that reasks rather than advances (see the implementation note
below). Either way, the RPC's own lack of gating stops being reachable
by this specific path.
**Implementation detail still open, not decided here (mirrors item 23's
own "not a new decision" note):** whether "photo, no text" is implemented
as (a) never calling the RPC for that turn at all when there's no
non-empty text to send, and instead directly composing the step's own
reask reply in the TS layer, or (b) still calling the RPC but with a
signal that forces its existing reask branch regardless of step-gating.
(a) requires no RPC changes; (b) would require touching two live
`SECURITY DEFINER` functions (the external-review-gate cost item 4's
`daily_log_id` discussion already avoided for a different reason, §4
above). **I recommend (a)** for the same reason I recommended avoiding RPC
changes there — not decided here.

---

## 5. Storage: schema and upload mechanism (described, not written)

**No migration is written in this pass.** Described here for review before
any SQL exists.

**New table, per item 7's already-decided per-parent shape** (extends
`design-decisions-beta-feedback.md` §6's `daily_log_photos`, which was
specified but — confirmed by grep this pass — never actually built:
zero hits for `daily_log_photos` anywhere in `supabase/migrations/*.sql`,
`lib/`, `types/database.ts`):

```
daily_log_photos
  id             UUID PK DEFAULT gen_random_uuid()
  created_at     TIMESTAMPTZ DEFAULT now()
  tenant_id      UUID NOT NULL REFERENCES tenants(id)
  daily_log_id   UUID NOT NULL REFERENCES daily_logs(id)
  phase          TEXT NOT NULL CHECK (phase IN ('morning', 'evening'))
  photo_url      TEXT              -- Supabase Storage path, NEVER a Twilio URL
  caption        TEXT              -- item 12: the answer-parser's raw Body, if any
  retention_class TEXT NOT NULL CHECK (retention_class IN ('attendance', 'evening_progress'))
  expires_at     TIMESTAMPTZ NOT NULL   -- STAMPED AT INSERT, per this task's own requirement
  received_at    TIMESTAMPTZ NOT NULL DEFAULT now()
```

`retention_class`/`expires_at` are **computed once, at the moment the job
successfully uploads and inserts the row** — `expires_at = received_at +
INTERVAL '7 days'` for `phase = 'morning'` (attendance), `+ INTERVAL '60
days'` for `phase = 'evening'` (evening progress, item 15's extended
window). This is the explicit, load-bearing requirement this task calls
out: stage 6's retention job scans `expires_at`, not a recomputation from
`phase` + a hardcoded window at delete time — if the window changes later
(item 15's own "may extend later" note), rows already stamped keep their
original expiry, which is the intended forward-only behavior (item 15).

**Storage bucket:** no Supabase Storage bucket exists anywhere in this
project today — confirmed by grep (`storage.buckets`, `CREATE ... BUCKET`)
across every migration; zero hits. Zero existing Storage upload code
anywhere in `lib/`/`app/` either. **This is the first Storage write this
project has ever built.** A bucket (tenant-scoped path convention, e.g.
`daily-log-photos/{tenant_id}/{daily_log_id}/{photo_id}.jpg`) needs
provisioning — via migration (`storage.buckets` insert) or dashboard —
before any upload code can run. Named here; not something I can confirm
already exists from this sandboxed environment (see §9).

**New `JobType`:** `'media_ingest'` added to `lib/queue/jobs.ts`'s union —
purely additive, no signature hazard.

**Media completion status, my recommendation (not one of the 22 decided
items, but required to fulfill item 4's already-decided intent of
"a separate status... asynchronous... the thing everything downstream
needs to check"):** two independent columns on `daily_logs` —
`morning_photos_status` and `evening_photos_status`, each
`TEXT CHECK (... IN ('pending','complete','failed'))`, defaulting to
`NULL` (no photos sent this phase) or `'pending'` the moment the first
`media_ingest` job is enqueued for that phase. Two columns, not one,
because morning and evening are independent completion events on the
*same* `daily_logs` row (item 7's shared-row precedent) — evening's photos
finishing has nothing to do with morning's. This is a plan-time judgment
call, flagged for review, not a re-litigation of any of the 22 decided
items.

**Migration-gate note, not a build blocker for this planning pass:** a new
table with its own RLS policies and grants trips CLAUDE.md §0's external
review gate by that document's own broadening clause ("a new table with
wrong RLS from day one... is at least as dangerous as a bad change to an
existing one") — whoever builds this migration needs the full review
package before it applies, same as every other schema change in this
project's recent history (029, 031, 038, ...).

---

## 6. The `media_ingest` job handler (described)

Follows the existing `jobs/tick` dispatch pattern
(`app/api/jobs/tick/route.ts`'s `dispatchJob` switch) exactly:

1. Claimed via the existing `claimJobs`/`completeJob`/`failJob` lifecycle —
   no changes needed to `lib/queue/jobs.ts` beyond the new `JobType` entry.
2. For each `MediaUrl{i}` in the payload: download from Twilio (needs
   Twilio Basic Auth — same credentials `lib/whatsapp/outbound/send.ts`
   already reads via `readCredentials()`-shaped access, not re-derived
   independently — this project's own standing rule against a script
   re-implementing credential loading, `CLAUDE.md` §0, applies here too:
   reuse an existing credential-reading path, don't hand-roll a second
   one), upload to Supabase Storage under the tenant-scoped path, insert
   one `daily_log_photos` row per photo with `expires_at` stamped (§5).
3. On any failure (Twilio download error, Storage upload error): `failJob`
   — existing exponential backoff (NFR-17) applies unchanged. On final
   exhaustion: mark the relevant `daily_logs.{phase}_photos_status =
   'failed'`, Sentry alert (matching the dead-letter shape item 4 already
   specifies: "Evening photos failed to upload — [engineer], [project],
   today — [Ask him to resend]").
4. On success: `completeJob`, set `daily_logs.{phase}_photos_status =
   'complete'`.

**Cron placement, restating item 4's own open flag, not resolved here:**
item 4 flags that `media_ingest` "likely wants its own cron entry" rather
than sharing `jobs/tick`'s 3-per-tick budget. For stage 1, I'd recommend
starting inside `jobs/tick` (simplest, matches how `hindrance_pm_notify`
and `dpr_generate` both started) and splitting out a dedicated cron only if
real volume justifies it — but this is exactly the kind of call item 4
already deferred to "whoever scopes the actual job handler," and I'm
deferring it the same way, not deciding it here.

---

## 7. Burst handling (item 13, restated for stage 1's mechanism)

Each photo in a burst arrives as its **own webhook call** with its own
`MessageSid` — `processed_messages` idempotency already dedupes a true
Twilio retry of the *same* SID; it does nothing for a burst (different
SIDs), which is correct and expected (item 13: "a fact about delivery, not
a defect to fix"). Under this plan's mechanism, each burst message:
- Enqueues its own `media_ingest` job (one row → one photo, or one row
  covering that message's own `MediaUrl0..N` if WhatsApp batches an
  album into one message — both cases handled by the same per-message
  enqueue).
- Runs its own turn through `dispatchInboundTurn` exactly as any other
  inbound message would, producing whatever reply that turn's outcome
  naturally produces (reask, advance, or nothing extra) — **no
  photo-specific acknowledgment is ever added**, satisfying item 13's "no
  per-photo acknowledgement" directly, because nothing in this design adds
  one.

The out-of-flow burst nudge-throttling mechanism (`last_media_nudge_at` in
`whatsapp_sessions.context`) is **stage 3 work** (item 6), not needed for
stage 1's idle-branch behavior, which stays exactly as it is today
(`PHOTO_REPLY`, no throttling, since it's unchanged).

---

## 8. Twilio uncaptioned-photo `Body` finding

**Requested:** check Twilio's inbound log for the uncaptioned photo
received at approximately 10:20 the same morning, from the same number,
and report what `Body` shows.

**Result: undetermined. Not assumed.** This planning session has no way to
query Twilio's Messages API directly:
- `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` are not set in this
  sandbox's shell environment (checked directly, not assumed).
- No `.env.local` exists inside this git worktree (checked directly) — one
  exists at the shared repo root (`/Users/aravindanrajamani/Desktop/
  quocoai/.env.local`), but this session is isolated to its own worktree
  and does not read files outside it, and per this project's own standing
  rule, a script must never re-derive credentials by reading an env file
  independently rather than reusing the real credential path anyway.
- No script in this repo already wraps "look up a message by SID/time" —
  `scripts/verify-email-delivery.ts` and `scripts/verify-pm-resolvability.ts`
  are the closest existing precedent for this shape of one-off
  verification script, but neither touches Twilio's Messages API.

**What would resolve this:** from an environment with real Twilio
credentials, `GET https://api.twilio.com/2010-04-01/Accounts/{AccountSid}/
Messages.json?From=whatsapp:{number}&To=whatsapp:{quoco_number}&DateSent=
{date}` (Basic Auth), inspect the uncaptioned photo's own `Body` field in
the returned JSON, or check the Twilio Console's own message log UI
directly for that timestamp. I have not attempted to fabricate or infer an
answer from the captioned case — an uncaptioned message is a materially
different Twilio payload shape (no per-item `Body` guarantee generalizes
from the captioned case to the uncaptioned one).

**Consequence for the plan:** §4's worked examples and the flagged
ungated-empty-answer interaction are both written to be correct **either
way** this resolves, per item 19's payload-agnostic design — but the
ungated-empty-answer interaction specifically **cannot even occur** if the
answer turns out to be "Body is absent/undefined" rather than an empty
string, since `dispatchInboundTurn`/the RPCs would then need to handle
`undefined` instead of `''`, a different (and currently unverified — see
§9) code path. This must be confirmed before stage 1 ships.

---

## 9. Three open questions — recommendations, not decisions

### 9.1 Interim off-step copy

**The problem:** the off-step nudge is stage 3, and hindrance capture is
stage 2. Through both of those stages, an off-step (idle, no active flow)
photo still gets today's `PHOTO_REPLY`: "Photos aren't used yet. Please
send your message as text." The moment stage 1 ships, this becomes false
for the **in-flow** case (photos now ARE used) — but §1 already scopes the
idle-branch reply as unchanged for stage 1, so the string only becomes
misleading for an engineer who sends a bare photo **at idle**, which was
already true before stage 1 and remains true after it. Stage 1 does not
make this string *more* wrong than it already was; the string was written
for a codebase with zero photo handling, and it will remain not-fully-true
until stage 3's real nudge ships regardless of when stage 1 lands.

**Recommendation: leave the string as-is through stages 1–2, do not ship
an interim line.** Reasoning:
- The string is only reachable from the **idle** branch, which stage 1
  does not touch at all — nothing about stage 1 shipping changes what an
  idle engineer experiences.
- An interim line drafted now would need to be re-drafted again for stage
  3's real nudge once hindrance capture (stage 2) actually exists — item
  16's own hard ordering constraint already establishes that a nudge
  pointing at hindrance capture must not ship before that capture exists.
  Shipping a *second* interim string between now and stage 3 adds a
  string-churn cost (draft, review, Tamil pair, ship, then redraft, review,
  Tamil pair, ship again) for a message only reachable by an engineer who
  is idle and sends an unprompted photo — a narrow, low-frequency path.
- If Aravind disagrees and wants the string to at least stop claiming
  "aren't used yet" once stage 1 ships (even though it's technically still
  true for the idle case specifically), I'd suggest the narrowest possible
  patch rather than a new nudge: something like *"Photos aren't used
  outside a check-in yet. Please send your message as text."* — DRAFT, NOT
  APPROVED, only if the recommendation above is rejected.

### 9.2 Failed-upload surfacing

**The problem:** the design says failures surface to the PM (item 4's own
dead-letter shape), but no PM surface exists until stage 5. What does
stage 1 do with a failed ingest in the meantime?

**Recommendation:** build the failure path fully (Sentry alert on
exhaustion, `daily_logs.{phase}_photos_status = 'failed'` written, per §6)
— **do not skip building it just because nothing displays it yet.** The
alternative (deferring the failure-handling code to stage 5) would mean a
real upload failure today silently vanishes with no record at all until
someone builds the display layer, at which point there's no way to
retroactively know how many failures happened in between. Sentry is the
interim PM surface — an engineer, Aravind, or whoever monitors Sentry sees
the alert; the *engineer* sees nothing different (per item 4's own
explicit design: "the engineer-facing completion message is unconditional
... failures surface to the PM, not the engineer, because by completion
time he has moved on").

**State plainly, what the customer can and cannot see until stage 5:**
- **Can see:** nothing. No dashboard photo count, no "photo failed" note
  anywhere in the product. The engineer's completion message (§9.3) is
  worded to be true regardless of job outcome, per item 4's own design —
  it does not promise "your photos are safely stored," only that they were
  received.
- **Cannot see:** whether a specific photo actually made it to Storage,
  whether it's still pending, or whether it permanently failed. That gap
  is the entire reason stage 5 exists, and stage 1 does not attempt to
  close it early — it only makes sure the underlying *data* (status
  columns, Sentry alerts) exists so stage 5 has something real to surface
  once it's built, rather than needing its own retroactive audit.

### 9.3 Completion message wording

**The problem:** the final check-in message must reflect real storage
state (item 4), covering: photos stored, some failed, and none sent.

**Constraint carried over from item 4, restated:** "The engineer-facing
completion message is unconditional and identical regardless of media job
state... The completion text does not query or wait on job status at all."
This means the completion message **cannot** actually say "3 stored, 1
failed" at send time — the job runs asynchronously, often well after the
completion message is already sent (item 4: "he has moved on"). So "some
failed" is not a state the completion message itself can ever correctly
report live; it's a state stage 5's dashboard reports **later**, once the
async job has actually resolved.

**Recommendation — the completion message can only meaningfully report
what it can know at Q6 time: how many photos the flow *received* this
session, not how many are *durably stored*.** Draft wording — **DRAFT, NOT
APPROVED**:

- **Photos received (one or more):**
  > ✅ Evening check-in complete. 4 photos received. Thanks — rest well!
- **None sent (today's existing copy, unchanged — no photos means nothing
  new to say):**
  > ✅ Evening check-in complete. Thanks — rest well!
- **NOT proposed: any "some failed" variant in the completion message
  itself** — per the constraint above, the flow genuinely does not know
  this yet at completion time. A failure surfaces later, to the PM, via
  stage 5's dashboard/Sentry — never retroactively edited into a WhatsApp
  message the engineer already received.

This extends `EVENING_COMPLETE_REPLY`/morning's own completion string
analogously, parameterized on the **received** count tracked during the
turn (not the job's eventual outcome) — a count the webhook layer already
has, since it's the one enqueueing the jobs.

---

## 10. Test coverage required (CLAUDE.md §7)

- **T-WH-13, rewritten** (`test/webhook.test.ts`): a photo sent mid-flow no
  longer returns `PHOTO_REPLY` — assert a `media_ingest` job row now
  exists (payload correct: tenant/project/phone/daily_log_id/log_date/
  phase), assert the session/turn outcome matches what an equivalent
  text-only message would have produced for that step (this is the exact
  case the interceptor move puts at risk, named explicitly in this task).
- **New: captioned photo, caption parses as a valid answer** — mid-flow,
  assert the RPC records the parsed answer normally (step advances) AND a
  `media_ingest` job is enqueued with the caption text in its payload.
- **New: captioned photo, caption fails to parse** — assert the standard
  reask fires (unchanged from today's text-only reask), AND the job is
  still enqueued (the photo is never dropped just because its caption
  didn't parse — item 12).
- **New: burst of two photos mid-flow** — two separate webhook calls, two
  distinct `MessageSid`s, assert two distinct `media_ingest` jobs, and that
  neither produces a photo-specific acknowledgment beyond each turn's own
  natural reply (item 13).
- **T-WH-14/T-WH-15, unchanged** (idle photo/voice) — assert these still
  pass with zero code changes, proving the idle branch is genuinely
  untouched by this stage.
- **New: media_ingest job handler unit tests** — successful download+
  upload+insert path; Twilio-download-failure path (retries, eventual
  dead-letter + Sentry); Storage-upload-failure path (same); `expires_at`
  computed correctly for both `phase` values at insert time (7d vs. 60d).
- **New: retention-class/expiry stamping** — a `daily_log_photos` row
  inserted for `phase='morning'` has `expires_at` exactly `received_at +
  7 days`; `phase='evening'` exactly `+60 days` — asserted directly against
  the stored value, not recomputed at read time.
- **New: JobType/dispatch wiring** — `media_ingest` claimed and dispatched
  correctly by `jobs/tick`'s existing `dispatchJob` switch.
- **RLS / cross-tenant isolation** (CLAUDE.md §7's own standing requirement
  for any new table): a two-tenant fixture proving `daily_log_photos` rows
  are invisible cross-tenant, and (per the service-role grants gap this
  project has already been bitten by twice — `dpr_versions`, migration 031
  round 1) an explicit `service_role` DELETE/TRUNCATE-denied probe if this
  table is meant to be append-only, not just an `anon`/`authenticated`
  probe.
- **Concurrency note, per CLAUDE.md's own standing rule:** if any test here
  depends on two genuinely concurrent webhook calls (e.g., a burst racing
  the RPC's row lock), that class of test is CI-only — this sandbox cannot
  sustain real concurrent RPC calls (confirmed project-wide finding,
  `docs/reviews/sandbox-cannot-test-concurrency.md`). Any such test must be
  reported as "not verified locally, CI-only," never as a local pass.

---

## 11. Dependencies I could not verify — named, not assumed

1. **Uncaptioned photo `Body` content** — §8. Undetermined from this
   sandbox; needs a real Twilio credential environment. No longer a design
   blocker per item 23 (§4 above), but still needed to implement "no
   accompanying text" detection correctly in code.
2. ~~Q2's actual gating in the live `apply_morning_flow_turn` SQL~~ —
   **RESOLVED this pass.** Read directly against the live SQL (not
   inferred from `morning.ts`'s TS-side comments, as this plan originally
   flagged) — see §4's rewritten worked example and
   `docs/plans/stage0-storage-setup-plan.md` §8.2 for both live functions'
   relevant bodies, pasted verbatim. Confirmed: zero gating on morning
   step 2 and evening step 1, exactly as the TS comments described.
3. **Whether a Supabase Storage bucket already exists out-of-band** — now
   stage 0's concern, not stage 1's; see `docs/plans/stage0-storage-setup-
   plan.md` §1 and its own dependencies list. Not re-verified here to
   avoid the two plans drifting on the same fact.
4. **Twilio's actual per-message media limit** (how many `MediaUrl{i}` can
   arrive in one inbound webhook call) — assumed up to 10 based on Twilio's
   general WhatsApp media documentation as understood at design-doc-writing
   time (`§41(e)`'s own cap language), not re-verified live this pass.
5. **Whether `apply_evening_flow_turn`/`apply_morning_flow_turn`'s
   existing empty-Body handling treats a missing key and an empty string
   identically** — the TS wrapper always sends `params.message` as a
   string (defaulting to `''` in `route.ts` today via `params.Body ?? ''`),
   so in practice the RPC never sees `undefined` — but whether Twilio ever
   sends the `Body` FIELD entirely absent (vs. present-but-empty) for
   media-only messages was not independently confirmed this pass, only
   inferred from `route.ts`'s own defensive `?? ''`. Lower-stakes now than
   when this plan first named it, per item 23 (dependency 1 above), but
   still worth resolving for the implementation-detail choice §4 flags
   (composing a reask directly in TS vs. still calling the RPC).

---

## Sources

- `docs/plans/media-capture-design.md` — all 22 decided items, read in full
  this pass.
- `lib/whatsapp/media-reply.ts`, `app/api/whatsapp/webhook/route.ts`,
  `lib/whatsapp/inbound-start.ts`, `lib/whatsapp/dispatch.ts`,
  `lib/whatsapp/flows/{morning,evening}.ts`, `lib/whatsapp/session.ts`,
  `lib/queue/jobs.ts`, `app/api/jobs/tick/route.ts` — read in full this
  pass.
- `test/webhook.test.ts` (T-WH-13/14/15), `test/unit/media-reply.test.ts` —
  read this pass to confirm exact current coverage and behavior.
- `docs/schema.md` (`daily_logs` column list), `docs/bot-flows.md` (ASYNC
  QUEUE / NFR-16/17) — read this pass.
- Grep evidence, this pass: zero hits for `daily_log_photos`,
  `hindrance_photos`, `media_ingest` anywhere in migrations/lib/types; zero
  hits for any `storage.buckets`/Storage-upload code anywhere in the
  codebase.
- `docs/plans/stage0-storage-setup-plan.md` — this stage's prerequisite,
  including the live-SQL verification (§8.2) this update above relies on.
