# PLAN ONLY — two-stage DPR delivery and versioning (2026-08-15)

**Status: PLAN ONLY. No implementation. No migration written. No code touched.** This
document is Part 2 of tonight's session (Part 1: MVP schedule freeze + restart semantics,
PR #66; Part 3: outbound send primitive, separate plan doc). Read alongside
`docs/dpr-engineer-report-spec.md` (Aravind's same-day edits, §4/§4b) and
`lib/daily-logs/cutoffs.ts` (`eveningClose` 19:45, `ownerSend` 20:30, FROZEN FOR MVP).

**REVISION 3 (2026-08-15, same day, review round 2) — decision handed down, not proposed
here: the owner receives the DPR by EMAIL for MVP, not WhatsApp.** This resolves THE
ENTANGLEMENT section's own fork (below, rewritten this revision) via a path neither of its
two named options anticipated — not "§8 revised to a WhatsApp link" and not "§8 stands,
unsendable" — the report leaves WhatsApp for the owner-send entirely. Changes: the DECISION
block immediately below; 2e's `delivered`/`skipped_no_template` semantics narrowed to the
stage they actually apply to; two new dependencies named (2g email provider/deliverability,
2h a second renderer); an option recorded, not decided (2i, a companion WhatsApp ping); a
roadmap note (mobile/PWA, explicitly not scope); THE ENTANGLEMENT and the Summary both
rewritten to match. Stage 1 (PM-notify) is untouched by this revision — still WhatsApp,
still template-gated, still entangled with #69 exactly as before.

---

## DECISION (2026-08-15): the owner receives the DPR by email, not WhatsApp

**Reasoning, recorded as given, not re-derived:** owners never message the bot, so their
WhatsApp window is always closed, so every WhatsApp send to them is necessarily a template
— and a template body cannot carry a variable-length report (fixed slots, per-parameter
character limits, no "however many lines this report needs today"). `dpr-engineer-report-
spec.md` §8's inline-full-report commitment is incompatible with that, which is exactly
the fork THE ENTANGLEMENT (below) left unresolved last revision. Email has no length
limit, needs no Meta template approval, carries no per-message template cost, and takes
owner web-authentication off the critical path entirely (no dashboard login needed to read
a nightly email) — §26's AUTH DECISIONS workstream stops being a dependency of the owner
receiving their report at all, though it remains one for the PM's dashboard link (2b).

**What this changes, precisely — stage 1 and stage 2 are no longer symmetric:**
- **Stage 1 (19:45, PM-notify) is UNCHANGED — still WhatsApp, still template-gated,** still
  entangled with #69's Meta-approval dependency exactly as the prior revision described.
- **Stage 2 (20:30, owner-send) is NO LONGER A WHATSAPP SEND AT ALL.** It does not wait on
  Meta template approval, is not part of #69's outbound-send primitive, and needs a
  different sender built for a different transport. 2a's "automatic and unconditional"
  framing is unchanged in substance — the owner still receives the report exactly as
  generated at 20:30 with no PM gate — only the channel changes.
- This is a **material change** to the previous revision's THE ENTANGLEMENT conclusion
  ("both stages skip until Meta approves") — that conclusion no longer holds for stage 2,
  rewritten below.

**Not decided here, and not part of this revision:** which email provider, or whether/how
`dpr-engineer-report-spec.md` §8 itself gets edited to say "email" instead of "WhatsApp" —
named as an open follow-up in the Summary, not resolved in this pass.

---

## 2a. LOAD-BEARING — the 20:30 owner send is automatic and unconditional

Restated because it constrains everything below, not because it needs justifying further:
**if the PM does nothing between 19:45 and 20:30, the owner receives the report exactly as
generated — by email now (DECISION, above), not WhatsApp.** The PM's window is an
opportunity, never a gate. Any design in this plan where the owner-send code path checks
"has the PM finished editing" or waits on a PM action is wrong by construction — the 20:30
cron fires and sends whatever `dprs` currently holds as its delivered content, full stop.
This shapes 2d/2e directly: versioning exists so an edit made in-window is captured, not so
the send can be gated on one existing.

## 2b. The 19:45 PM message and the edit surface — no mobile app, the dashboard already exists

**The 19:45 PM message is a notification with a link, not an editing session.** It fires
from the same trigger as DPR generation (one moment, per `cutoffs.ts`'s `eveningClose`) and
should read, in substance, "tonight's report for [project] is ready — review before 20:30:
[link]." Editing happens entirely on the existing web dashboard
(`app/(dashboard)/dprs/[id]/page.tsx`), which is already responsive and already opens on a
PM's phone via that link. **There is no mobile app to build, and none is scoped here.**

**What exists today** (read in full, not assumed): `getDprDetail` selects `id, log_date,
content, engineer_id, projects(name)` — it does NOT select `structured`, and the page
renders `content` (the pre-rendered string) directly in a `<pre>` block. Zero
interactivity — no client component, no form, no edit affordance, no role check beyond
whatever `dprs_select`'s RLS already enforces at the row level.

**What an edit mode needs on top of this, concretely:**
1. **Select `structured`, not just `content`.** The edit form must be built from
   `dprs.structured.facts` (the actual Fact values: `work.planned`, `work.done_text`,
   `schedule.met`, `manpower.on_site`, etc.) — never from the rendered `content` string.
   Editing rendered text and re-deriving Facts from it would invert the traceability this
   whole design exists to protect (spec's own Rule in 2c, below).
2. **A Client Component island**, not a full client page — the current page is a Server
   Component for good reason (RLS-scoped fetch, no client bundle needed for read-only
   viewing). An `<EditDprForm>` island, hydrated only for viewers whose role permits
   editing (see the role-check gap named below), keeps the read path exactly as fast and
   simple as it is today.
3. **A role check that does not exist yet.** `dprs_select`'s RLS (023) scopes by
   `project_members` membership, not by role — confirmed by reading the policy: any project
   member who can SEE the row today (including, structurally, an `engineer` or `owner` role
   if either ever gained a web login) is not currently distinguished from a `pm`. Correction
   (`correct_daily_log`) is already PM-only at the RPC layer (019's own `IF v_editor_role <>
   'pm'` guard) — the edit UI must gate on the SAME check client-side (to not render an edit
   affordance nobody's allowed to use) but the RPC's own guard remains the real boundary,
   not the UI.
4. **A "submit for regeneration" action**, not autosave-per-field — matches 2c/2d below:
   edits accumulate as `daily_log_edits` (or its equivalent widened mechanism) rows, and a
   single explicit "Regenerate" action is what actually produces a new version, calling the
   same `dpr_generate` job machinery that already exists (`lib/dpr/dispatch.ts`), not a new
   parallel path.
5. **A comment field per edit** — see 2c: no home for this exists in the schema today.

**Who actually receives the 19:45 message — not resolved, named precisely rather than
assumed:** `pm_notified` (2e) presupposes a single PM WhatsApp identity to notify, and none
of the three assumptions behind that hold without checking:
- **`users.whatsapp_number` is nullable.** A PM registered through the (existing, §26-
  adjacent) web onboarding flow may never have supplied one at all — engineers are the
  WhatsApp-first role in this product; PMs are described as web-first throughout this
  session's own record. A PM with `whatsapp_number IS NULL` cannot receive a WhatsApp
  notification by definition, and nothing here names what happens in that case (email
  fallback? rely on them checking the dashboard unprompted? — not decided).
- **A project can have several PMs**, via multiple `project_members` rows with
  `role='pm'`. "The PM" is not a well-defined singular recipient — this plan needs to
  decide whether ALL PMs on the project get notified, or one designated one (project
  creator? first added?), and name the criterion, not assume it away.
- **The dependency on §26 (AUTH DECISIONS, tonight's Part 1) is real and worth stating
  explicitly:** §26 sends every login-after-the-first as an OTP over WhatsApp — meaning a
  PM with no `whatsapp_number` cannot complete that OTP flow AT ALL, not just miss the DPR
  notification. **A PM who never registered a WhatsApp number is, under §26's own design,
  unable to log in to click the dashboard link this section's notification would have sent
  them anyway** — the two gaps compound rather than one working around the other. Not
  solved here; named so whoever scopes §26's own workstream inherits this as a known
  connection, not a surprise found independently later.

## 2c. PM edits DATA, never report text — checked against the real correctable-column set, not assumed sufficient

**Confirmed by reading `daily_log_edits`'s CHECK constraint and `correct_daily_log`'s own
CASE whitelist (both, migration 019, deliberately double-gated so they must agree) — the
correctable set is 9 SCALAR columns:** `is_holiday`, `holiday_reason`, `weather`,
`morning_plan`, `morning_execution_plan`, `evening_output`, `evening_schedule_met`,
`evening_schedule_miss_reason`, `evening_workers_on_site`. Nothing else. No JSONB column is
correctable at all — v1 was deliberately scalar-only.

**Mapped against the per-engineer report's actual Facts** (`EngineerDprFacts`, `schema.ts`,
cross-checked against `assemble.ts`'s real field sourcing, not the type alone):

| Fact | Sourced from | Correctable today? |
|---|---|---|
| `work.planned` | `morning_plan` | ✅ yes |
| `work.done_text` | `evening_output` | ✅ yes |
| `work.done_quantity` / `unit` | `evening_output_quantities` (JSONB) | ❌ no |
| `schedule.met` | `evening_schedule_met` | ✅ yes |
| `manpower.on_site` | `evening_workers_on_site` | ✅ yes |
| `manpower.planned` | `morning_manpower_planned` (JSONB) | ❌ no |
| `manpower.working` | `evening_productive_manpower.productive_count` (JSONB) | ❌ no |
| `equipment.items[].*` (all fields) | `morning_equipment` + `evening_equipment_utilisation` (both JSONB) | ❌ no |

**This is the finding, stated plainly: `daily_log_edits` and `correct_daily_log` do NOT
carry what §4b needs — they carry less than half of it.** And it's not an abstract gap —
**§4b's own worked example, written today, edits exactly the two fields that are NOT
correctable:** `manpower.working` ("15 working" → "19 working") and `work.done_quantity`
("780 sq m" → "850 sq m"). The spec's own sample cannot be performed by the mechanism that
exists. Either the JSONB-correctable-column gap (already tracked as an open item in
CLAUDE.md's build-status history, pre-dating tonight) gets closed as PART of this
workstream, or §4b's example needs to be rewritten to only demonstrate what's actually
buildable (`work.planned`, `work.done_text`, `schedule.met`, `manpower.on_site`) until it
is. **Not resolved here — named for the next decision.**

**Correction accepted: "widen the whitelist" understated what closing this gap actually
is.** It is not adding entries to a list — it is a **design extension** to a mechanism that
was scalar-only BY DESIGN (019's own comment: "enforces scalar-only-v1 at the DB"). Three
separate things, not one:
1. **Both gates, not one.** `daily_log_edits.column_name`'s CHECK and `correct_daily_log`'s
   CASE whitelist are DELIBERATELY double-gated so a future edit that widens one but not
   the other fails closed (019's own review-item-8 comment, quoted in full in that
   migration: "the redundancy IS the safety; do not simplify it away"). Any widening
   touches both, in the same migration, or the safety property it exists for is broken.
2. **JSONB-path semantics don't exist yet and have to be designed, not assumed.** The
   current mechanism corrects a whole SCALAR column value in one shot
   (`old_value`/`new_value` as the column's own type). Correcting `manpower.working`
   means correcting ONE KEY inside `evening_productive_manpower`'s JSONB, leaving its
   siblings (`idle_count`, `confidence`) untouched — a genuinely different operation
   (a JSONB path + merge, not a column replace) that `correct_daily_log`'s current CASE
   structure has no shape for at all. This is real design work, not a whitelist entry.
3. **It re-touches a debt this project already has an open, named finding for.**
   CLAUDE.md's "EQUIPMENT `daily_hire_cost` — A COUNT IN A MONEY FIELD" entry documents a
   parser bug where equipment answers can silently store a count where a rupee rate was
   expected — currently invisible because nothing downstream lets a human correct it, only
   observe it. **The moment a PM can edit equipment facts, that entry's own finding
   becomes directly actionable — and directly risky the same way:** a PM "correcting" a
   miscaptured count into what they believe is the real rate is now writing a NEW
   authoritative money value through a UI, with no existing validation that the mechanism
   this gap already flagged as fragile becomes safer just because a human is now the one
   typing the number. Named here so equipment-field correctability isn't scoped in without
   also reopening that entry's own unresolved question (should an implausible rate be
   flagged — not answered here, same as CLAUDE.md left it).

**Separately, no comment field exists anywhere in the correction mechanism.**
`daily_log_edits` has `old_value` / `new_value` / `edited_by` / `source` — no `comment` or
`note` column. §4b's sample shows a PM comment attached to every edit
("Two extra masons joined after lunch..."). This needs a new column
(`daily_log_edits.comment TEXT NULL`, most likely) — additive, but still a schema change,
folded into 2d's own migration since both touch the same review-gated territory.

**`last_regenerated_at`** — the column exists on `dprs` (023) but is written by **nothing**
anywhere in the current codebase (grepped `lib/`, `app/`, `scripts/` — zero writers). It's
exactly the kind of column this project's own §0 history warns about: present, typed, and
silently never populated. The regeneration flow this plan proposes is what would finally
give it a real writer.

## 2d. Versioning — recommendation reviewed, not reflexively accepted; I agree with it

**The reviewer's recommendation (do NOT widen migration 028's `UNIQUE(project_id,
engineer_id, log_date)` to include version; keep `dprs` as one current-version row per
engineer-day, add an append-only history table instead) — evaluated on its own merits, not
rubber-stamped. I agree with it, for three independent reasons, not one:**

1. **Every existing `dprs` reader assumes one row per engineer-day.** The claim/final
   upserts in `dispatch.ts` both target `onConflict: 'project_id,engineer_id,log_date'`;
   both dashboard pages `.select()` without an explicit version filter. Widening the key to
   include version would make every one of those a latent multi-row bug — the identical
   failure class 028's own B2 inventory caught and fixed (a widened key silently breaking
   call sites built for the narrower one), reintroduced deliberately if this path is taken.
2. **This exact constraint was migrated yesterday**, went through a full external-review
   cycle, and was applied under real production pressure (the merge/deploy incident, §20 of
   the 028 package). Re-touching it again immediately for an unrelated reason (versioning,
   not the engineer-id reformat) costs a second full apply-gate cycle for something the
   alternative design avoids needing at all.
3. **An append-only history table is the more honest shape for what's being modeled** — a
   generation event log, not a second dimension of the primary key. This project already
   has the identical pattern one migration away: `daily_log_edits` is exactly this shape
   relative to `daily_logs` (current values in the row, every correction as an append-only
   audit entry). Versioning `dprs` the same way is consistent with, not a new pattern
   alongside, what's already built.

**Concrete shape, revised — the first draft repeated 028's own B1 finding (plain FKs, no
`tenant_id`, no RLS on a table carrying full report bodies) instead of applying it. Fixed
below, not sketched twice:**

```
dprs (existing table, minimal additions):
  + current_version   INT NOT NULL DEFAULT 1
  + generated_by       TEXT CHECK (generated_by IN ('system','pm'))  -- who produced the CURRENT version
  + generated_by_user  UUID NULL REFERENCES users(id)                -- set only when generated_by = 'pm'
  (delivered_owner_at, generated_at, last_regenerated_at: existing columns, finally get real writers)

dpr_versions (NEW, append-only):
  id                    UUID PK DEFAULT gen_random_uuid()
  tenant_id             UUID NOT NULL                                -- Convention 5 (below), NOT omitted this time
  dpr_id                UUID NOT NULL
  version               INT NOT NULL
  generated_by          TEXT NOT NULL CHECK (generated_by IN ('system','pm'))
  generated_by_user     UUID NULL                                    -- composite FK, see below
  content               TEXT NOT NULL
  structured            JSONB NOT NULL
  generated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
  delivered_to_owner_at TIMESTAMPTZ NULL   -- set on EXACTLY the one version actually sent at 20:30
  UNIQUE (dpr_id, version)

  -- Composite same-tenant FKs (017's pattern, 027's precedent, 028's own B1 fix applied
  -- from the start this time rather than found by a second reviewer pass):
  CONSTRAINT dpr_versions_dpr_id_fkey
    FOREIGN KEY (dpr_id, tenant_id) REFERENCES dprs (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE CASCADE   -- versions have no meaning without their parent
  CONSTRAINT dpr_versions_generated_by_user_fkey
    FOREIGN KEY (generated_by_user, tenant_id) REFERENCES users (id, tenant_id)
    ON UPDATE NO ACTION ON DELETE RESTRICT  -- archival, matches dprs' own RESTRICT reasoning
```

**RLS, named rather than left implicit:** audience-scoped, matching `dprs_select`'s own
existing shape (023) — `tenant_id = get_user_tenant_id() AND EXISTS` a `project_members`
row for this PM on the version's project. Not tenant-wide. Owners are NOT given dashboard
access to version history at all in this design — they only ever see the one version
actually delivered, via the WhatsApp send itself, never the dashboard — so no
owner-readable policy is proposed here; if that's wrong, it's a decision to make in the
review package, not an oversight in this sketch.

**`dprs.current_version` + `dprs.content`/`dprs.structured` stay a denormalized "latest"
projection** (fast reads for the dashboard list/detail pages, unchanged query shape) while
`dpr_versions` is the source of truth for history. "Which version was delivered to the
owner" is answered by whichever `dpr_versions` row has `delivered_to_owner_at` set.

**The version write is TRANSACTIONAL — stated explicitly, not left implied.** `dprs.
content` + `dprs.current_version` + the new `dpr_versions` row must land atomically: a
regeneration that updates `dprs` but fails to insert the history row (or the reverse)
leaves the two permanently inconsistent, and nothing downstream would ever detect it.
**`supabase-js` cannot express a multi-statement transaction from application code** — this
requires a new `SECURITY DEFINER` RPC (e.g. `write_dpr_version(p_dpr_id, p_content, p_structured, p_generated_by, ...)`) that does the `UPDATE dprs` and `INSERT INTO dpr_versions` inside one function body, same shape as `correct_daily_log`'s own single-transaction guarantee. **This is
its own, separate trip of §0(a)/(b)** (creates a new SECURITY DEFINER function with real
write authority over report content) — named here explicitly rather than left to be
discovered when the migration is actually drafted, matching the same correction #69's own
plan applies to its own workstream.

**The 20:30 owner-send has the identical transactional requirement, not a separate one:**
it must READ `dprs.content` (or the version it actually intends to send) and STAMP
`delivered_to_owner_at` on THAT SAME version, in one statement or one locked transaction —
a read-then-later-write done as two separate round trips risks stamping the wrong version
if a PM regenerates in the gap between them (a real race, not a hypothetical one, given the
whole point of the 19:45-20:30 window is that a regeneration can land at any point inside
it). This likely means the owner-send job also goes through a small RPC, or at minimum a
single `UPDATE ... WHERE ... RETURNING` on `dpr_versions` keyed by `dpr_id` and the
CURRENT `dprs.current_version` read in the same statement — not sketched to final SQL here,
named as a requirement the review package must satisfy.

**The history table reverses a dated decision — recorded as a supersession, not silently
overridden.** `023_dpr_reports.sql`'s own `COMMENT ON TABLE public.dprs` (023:146-151),
read directly: *"UPSERT target for regeneration (silent replace, never a new version row
per bot-flows.md)."* `bot-flows.md`'s own "Late data before 9 PM owner send" section
(currently: *"Regenerate via UPSERT. Silent replace. last_regenerated_at updated."*) is the
design decision that comment points at. **This plan reverses it — a new version row is
exactly what regeneration now produces.** A dated supersession note is being added to
`bot-flows.md` at that section in this same pass (documentation only, matching this
project's own "record the decision, don't silently rewrite" discipline — see the commit
this plan ships with). **The migration itself must update `023`'s `COMMENT ON TABLE`
text** when it ships — and while touching it, fix the SEPARATE, already-stale claim in the
same comment: "One row per (project_id, log_date)" has been wrong since migration 028
widened the key to `(project_id, engineer_id, log_date)`, and nobody updated this comment
when that happened. Two corrections to the same comment, one migration, named together so
the second doesn't get missed while fixing the first.

**This touches the schema — it goes through the same review path 028 went through**, per
direct instruction, and now more clearly than the first draft stated: two SECURITY DEFINER
functions (version-write, and likely the owner-send race guard), composite FKs and RLS on
a new table carrying full report content, and a reversed table-comment decision are all in
scope for that one review package. Not written as a migration file in this pass.
`daily_log_edits`'s new `comment` column (2c) rides in the same migration, since both are
part of the same delivery-versioning feature and both need the same review pass regardless
of being split or combined.

## 2e. `delivery_status` cannot express the two-stage state — proposed states

Current CHECK (023): `pending / delivered / paused / skipped_no_data / failed`. None of
these distinguish "PM has been notified, owner has not" from either endpoint. **Proposed,
additive (existing values kept, meanings tightened where the two-stage flow requires it):**

- `pending` — unchanged: no delivery action taken yet (should be near-instantaneous now,
  since PM-notify fires atomically with generation at `eveningClose`).
- **`pm_notified`** *(NEW)* — the PM has been sent the 19:45 notification+link; this is the
  state for the entire 19:45→20:30 window, edited or not.
- `delivered` — re-scoped, not renamed: now specifically means "delivered to the **owner**
  by email" (the terminal success state; channel per the DECISION above), set at or after
  `ownerSend` (20:30). No longer implies WhatsApp, and no longer implies anything about
  template approval — an email delivery has its own success/failure shape (2g), unrelated
  to Meta's.
- `failed` — unchanged, NFR-17 dead-letter, still covers BOTH stages. Deliberately NOT
  split into `pm_notify_failed`/`owner_send_failed` sub-states — which stage failed is
  Sentry/log context (`extra: {stage: 'pm_notify' | 'owner_send'}`), not a new CHECK value;
  keeps the state machine small and matches this project's existing preference
  (`generation_status`/`delivery_status` are already kept orthogonal and minimal rather
  than cross-producted). **The two stages now fail for genuinely different reasons** —
  `pm_notify` fails the way a WhatsApp template send fails (3e-style, #69); `owner_send`
  fails the way an email send fails (bounce, provider rejection, spam-folder silent
  non-failure that never even reaches this state — see 2g's deliverability risk) — the
  `stage` context tag is what keeps those distinguishable without a new CHECK value.
- `paused` — unchanged, out of scope for this plan (whatever its existing semantics are).
- `skipped_no_data` — kept for the record, likely DEAD going forward under the per-engineer
  pipeline (its only writer was the old project-level trigger; Q8's zero-roster case
  writes no row at all instead) — same "leave retained-but-unused logic in place" pattern
  `archive-status.ts` already uses for this exact status value. Not removed.
- **`skipped_no_template`** *(NEW, added last revision — SCOPE NARROWED this revision, see
  THE ENTANGLEMENT below)* — **applies to stage 1 (`pm_notify`) only, now that stage 2 is
  email.** Still real and still necessary: the PM is never reachable free-form (never
  messages the bot), so `pm_notify` has no fallback and is `skipped_no_template` on every
  attempt until Meta approves the relevant template — exactly the prior revision's finding,
  just no longer describing the owner-send too. Without this value, a PM-notify blocked on
  template approval would leave `delivery_status` at `'pending'` forever with nothing
  anywhere explaining why — the same silent-failure shape #69's own `skipped_no_template`
  outcome (its 3c) exists to prevent. Mirrors #69's vocabulary deliberately, not an
  independently-invented parallel name for the same thing. **Never applies to `owner_send`
  — an email send either succeeds (`delivered`), fails (`failed`), or hasn't run yet
  (`pending`); there is no template-approval axis for it to be skipped on.**

## 2f. PM escalation persistence — confirmed sufficient, no schema change needed

**Checked, not assumed.** `checkin_escalations` (migration 027) already models this
correctly for the purpose named in 1a: `status` (`awaited/nudged/escalated/submitted/
not_submitted`) is a real column on a real row that **persists** until an explicit
transition — there is no ephemeral notification, no expiring flag, nothing that needs a
cron to "re-show" it. `determineTargetStatus` (checked against the live logic, not assumed)
computes the target fresh from wall-clock time on every sweep invocation and converges to
the correct state regardless of how many checkpoints were missed — exactly "persistent
until submit or cutoff," already built, already correct for the frozen 10:30-appears/
15:00-closes schedule (§1a). **No schema change needed. Not stopping here — confirmed
sufficient as designed.**

## 2g. NEW DEPENDENCY — transactional email does not exist in this codebase

**Named as its own item, with its own risk stated, per direct instruction — not folded
quietly into "pick a provider later."**

**What exists today, checked, not assumed:** Supabase Auth sends magic-link emails
(`login/page.tsx`, `auth/callback/route.ts` — see CLAUDE.md §8's own Auth Site URL
history). **This is not the same capability.** Supabase Auth's email sending is Supabase's
own managed auth-template delivery, scoped to auth flows (magic links, password resets) —
it is not a general-purpose transactional email API this codebase can call to send an
arbitrary nightly report with real content to an arbitrary owner address. Grepped `lib/`,
`app/` for any existing email-sending capability beyond Auth's own: none. `RESEND_API_KEY`
is already listed in CLAUDE.md §8's environment variable table ("Email: Resend — DPR
delivery to owner") — **named in the stack doc, never actually wired.** This decision is
what finally makes that line load-bearing.

**The dependency, stated precisely:**
1. **A transactional email provider** (Resend, per the stack doc's own existing naming —
   not re-litigated here, just noted as already the project's stated intent, not a new
   choice this decision introduces) needs an account, an API key, and a real integration
   point in `lib/dpr/` or similar — not sketched here, out of scope for a plan document.
2. **A verified sending domain** — SPF, DKIM, and DMARC records on whatever domain the
   report is sent FROM. This is not optional infrastructure to defer: an unverified sending
   domain is the single most common reason transactional email lands in spam or is
   rejected outright by receiving mail servers (Gmail, Outlook, and most corporate mail
   gateways all check these records before accepting mail from an unfamiliar sender).
3. **Deliverability is the risk, not sending — stated as the actual failure mode, not a
   generic caveat.** A misconfigured or unverified domain does not produce a visible error
   this project's own §0 discipline would catch on an apply-day dashboard check — it
   produces a `202 Accepted` from the provider's API (the send technically "succeeded") and
   then silent, invisible delivery into a spam folder the owner never opens. **This is the
   email equivalent of #69's own B4 finding** (a WhatsApp send accepted synchronously and
   failed asynchronously, invisibly, unless a status-callback route is built to catch it) —
   the same shape of risk, one layer over, on a different transport. The product would
   appear to be working (every night, `delivery_status = 'delivered'`, a real send logged)
   while silently not reaching the paying customer at all. **Whatever provider is chosen
   needs its own equivalent of #69's status-callback route** (most providers — Resend
   included — offer webhook delivery-status events: `delivered`, `bounced`, `complained`)
   before `delivered` can be trusted as meaning what it says, not merely "the provider
   accepted the request." Not built here — named as the same-shaped dependency #69 already
   had to solve for WhatsApp, now recurring for email.

**Not choosing a provider or building anything here** — recording the dependency and what
verifying the domain involves, per direct instruction.

## 2h. Email needs its own rendered form — a second renderer, not a change to the existing one

**The report is currently plain text, shaped for a WhatsApp message body** (`render.ts`'s
existing output — inline `|` pair lines specifically because "aligned columns... collapse
on mobile" inside a WhatsApp bubble, per spec §8's own stated reasoning). **Email has none
of WhatsApp's constraints and some of its own:**
- **Plain text** — the cheapest option, reuses the existing rendered `content` string
  as-is (an email client renders a plain-text body fine); loses nothing functionally, gains
  nothing visually either.
- **HTML** — a real second render target: headers, bold section labels, maybe a simple
  table instead of the `|`-pair-line mobile workaround `render.ts` exists specifically to
  avoid — email has no "collapses on mobile" constraint the way a WhatsApp bubble does, so
  HTML email could use the aligned-table layout the WhatsApp render deliberately rejected.
- **PDF attachment** — the most report-like presentation, but the most new surface area
  (a PDF-generation dependency this codebase does not have either, on top of the email
  dependency itself).

**Which of these three is not decided here — the point being recorded is the PATTERN, not
the choice:** per `dpr-engineer-report-spec.md` §8's own established precedent, this
codebase already builds multiple renderers off the same `DprFacts`/`structured` data (the
WhatsApp-shaped `render.ts` is itself evidence of exactly this pattern — Facts assembled
once, rendered per-surface). **A second, email-shaped renderer reading the same
`dprs.structured` this plan's versioning (2d) already stores is the established pattern
applied again, not a change to the existing WhatsApp renderer** — `render.ts` is untouched
by this decision; a new `render-email.ts` (or equivalent) is additive.

## 2i. Option, recorded not decided: a companion WhatsApp ping alongside the email

**Recorded per direct instruction — not chosen, not built.** A short WhatsApp template to
the owner — e.g. "Today's report for [site] has been sent to your email" — sent alongside
the email at 20:30, keeping a WhatsApp presence for the product (owners already expect a
WhatsApp touchpoint, per this project's whole design) while the actual document ships
where it can carry unlimited content. **Cost/dependency shape, named so the option is
evaluable later without re-deriving it:** this WOULD be a real WhatsApp send (one cheap,
fixed-content template — no data-driven slots, no Q5-style variable-list problem) and
WOULD therefore re-enter #69's template-approval dependency and its `skipped_no_template`
vocabulary for this one narrow case, even though the report content itself no longer does.
Not a blocker either way — the email send is fully independent of whether this option is
ever built — just a real dependency to weigh if it is.

---

## ROADMAP NOTE (not scope, not scheduled) — mobile app, PWA as the checkpoint

**Recorded in the roadmap notes, explicitly NOT as scope for this or any current
workstream, per direct instruction.** This decision's own reasoning — owners read a
document, not a chat window — nudges toward mobile app as a near-future direction, more
so for owners than any other role in this product (engineers are WhatsApp-first by design;
owners, reading a nightly report, are plausibly app-readers first). **Not scheduled, not
scoped, nothing here commits to building it.**

The note worth keeping for whenever this is revisited: a **Progressive Web App (PWA)** is
the natural checkpoint before native app investment is justified, not a detour before it —
home-screen install, push notifications (supported on iOS since 16.4, closing what used to
be the platform gap that made PWA a second-class option), and app-like reading, all
buildable from the existing Next.js codebase with no app-store submission and no second
platform/codebase to maintain. Native (App Store/Play Store) is the step to take only once
a PWA's own limits are actually felt in practice, not a starting assumption.

---

## THE ENTANGLEMENT with #69 — REWRITTEN this revision; no longer symmetric between stages

**Previous revision's conclusion — "both of this plan's sends are `skipped_no_template`
on every attempt until Meta approves" — no longer holds.** The DECISION above (owner
receives the DPR by email) breaks the symmetry that conclusion depended on. Restated
precisely, stage by stage, not as a blanket claim:

**Stage 1 (19:45, PM-notify) — UNCHANGED, still fully entangled with #69.** The PM never
messages the bot, so their WhatsApp window is always closed, so `pm_notify` is
unconditionally a template send, and is `skipped_no_template` on every attempt until Meta
approves the relevant template — exactly as the prior revision found. `delivery_status`'s
`skipped_no_template` value (2e, narrowed this revision to stage 1 only) exists
specifically so this doesn't read as `'pending'`-forever with no explanation. This part of
the entanglement is real, unresolved, and identical to what #69's own plan already
describes for its trigger sends generally.

**Stage 2 (20:30, owner-send) — NO LONGER ENTANGLED WITH #69 AT ALL.** It is not a
WhatsApp send, does not go through #69's primitive, does not wait on Meta template
approval, and cannot be `skipped_no_template` (2e) — it has its own, unrelated
dependency and risk (2g's email-provider/deliverability chain), not #69's. **This
resolves the fork the prior revision left open** — #69 had named `eveningClose`/
`ownerSend` as a single "fifth send... structurally different... same transport concern"
and asked this plan to specify its content contract, framing the resolution as a binary
choice between revising spec §8 to a WhatsApp-template-with-link, or leaving the
owner-send un-sendable. **Neither.** The report leaves WhatsApp for the owner entirely —
a third path, not one of the two named. `dpr-engineer-report-spec.md` §8 ("WhatsApp is
the delivery surface") is now stale for the owner-send specifically and needs its own
edit (channel: email, not WhatsApp) — **not made in this pass**, named as a required
follow-up in the Summary below, same as it was left open (differently) last revision.

**What this means for #69's own scope, stated so that plan's revision doesn't have to
re-derive it:** `ownerSend` (20:30) drops out of #69's outbound-send primitive entirely —
it is not one of the WhatsApp trigger sends that primitive's roster/template/idempotency
machinery needs to cover. `eveningClose` (19:45, PM-notify) remains the one non-engineer
WhatsApp send in scope for that primitive, carrying the same template-gated, `skipped_
no_template`-capable shape as the four engineer-facing checkpoints. #69's own plan should
reflect `eveningClose` as its actual "fifth send," not `eveningClose`/`ownerSend` bundled
together as it was described previously.

---

## Summary of what this plan requires before it can ship

1. Decide §4b's example vs. the JSONB-correction design extension (2c) — these are not
   independent; the example can't ship as written without it, or needs rewriting. The
   design extension is three things (both gates, JSONB-path semantics, the equipment
   money-field debt it reopens), not a whitelist edit.
2. A migration (2d + 2c's `comment` column + `dpr_versions`' composite FKs/RLS) — full
   external-review path, same as 028, now carrying at least one new SECURITY DEFINER
   function (transactional version-write) as its own named (a)/(b) trip.
3. `bot-flows.md`'s "Late data before 9 PM owner send" section needs its own dated
   supersession note (added tonight, prior revision) — the migration updates `023`'s
   `COMMENT ON TABLE dprs` to match, fixing both the reversed decision and the
   already-stale key description in the same pass.
4. `delivery_status`'s CHECK widened by TWO values now (`pm_notified`, `skipped_no_template`
   — the latter now scoped to stage 1/`pm_notify` only, per this revision's DECISION).
5. The dashboard edit surface (2b) — new Client Component, role-gated, built against
   `structured`, not `content`.
6. A "regenerate" action wired to the existing `dpr_generate` job machinery, now versioned
   and transactional (its own RPC, not a plain `supabase-js` write).
7. **Stage 1 only now:** resolve the entanglement with #69 (PM-notify remains
   template-gated, still blocked on Meta approval). **Stage 2's entanglement is resolved
   by this revision's DECISION** — the owner-send no longer depends on #69 or Meta at all.
8. Decide who receives `pm_notified` (2b) — all PMs vs. one, and the fallback when
   `whatsapp_number IS NULL`, which under §26 also blocks that PM's own login.
9. **NEW (this revision) — the email dependency (2g):** pick a transactional email
   provider (Resend, per CLAUDE.md §8's own stated-but-unwired intent), verify a sending
   domain (SPF/DKIM/DMARC), and build a delivery-status webhook so `delivered` means
   confirmed delivery, not merely "the provider accepted the API call" — the same shape of
   risk as #69's own B4, one layer over.
10. **NEW (this revision) — email rendering (2h):** a second renderer off the same
    `dprs.structured`, additive to `render.ts`, not a change to it. Plain text / HTML / PDF
    not decided here.
11. **NEW (this revision) — `dpr-engineer-report-spec.md` §8 needs its own edit** (channel:
    email for the owner-send, not WhatsApp) — named as a required follow-up, not made in
    this pass; this plan document does not edit the spec.
12. **Recorded, not decided:** 2i's companion WhatsApp ping alongside the email — an
    option for later, own dependency shape named, not chosen.
13. **Recorded in the roadmap, not scope:** mobile app / PWA as the checkpoint before
    native, per the ROADMAP NOTE above — not scheduled, nothing here commits to it.

None of this is built in this pass. Branch/PR for this document only — no code, except the
dated `bot-flows.md` supersession note (documentation, matching item 3 above).
