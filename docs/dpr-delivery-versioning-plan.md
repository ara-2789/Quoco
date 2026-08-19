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

**REVISION 4 (2026-08-19, round 3 external review — verdict STOP, iterate as a diff against
this pin, not a rewrite) — diff against `61a7974`. Still nothing implemented; SQL is not
written here — this document remains plan-only, one round short of the review package.**

**Revision header — every finding, stable label, round of origin, status:**

| Label | Round of origin | Status this round | What changed |
|---|---|---|---|
| A1 (October date framing) | Round 3 (external review) | **N/A — checked, not applicable.** This document contains no mention of "October" anywhere and gates no control flow on that date; the finding applies entirely to #69's own plan, which does. Nothing to change here. |
| A2 (service-reply economics) | Round 3 (external review, NEW finding) | **Added, as a cross-reference.** #69 owns and quantifies this cost (its own §3g condition (e)); flagged here per direct instruction, since stage 1 (PM-notify) shares that template-billing exposure — see the note added to THE ENTANGLEMENT, below. |
| A3 (log Meta's `pricing` object) | Round 3 (external review, NEW finding) | **N/A.** The status-callback route this applies to is #69's own workstream (2g's own text already draws this line — "whatever provider is chosen needs its own equivalent of #69's status-callback route," for email, not WhatsApp). Not duplicated here. |
| A4 (IST/UTC day-key nits) | Round 3 (external review, NEW finding) | **N/A — checked, not applicable.** Grepped this document for "UTC" and any unpinned day-key computation: none found. Both sites the review names are in #69. |
| C-a (owner email has nowhere to live) | Round 3 (external review, NEW finding, BLOCKING) | **Answered this round.** Schema home, entry surface, confirmation gate, and §2g's fourth deliverability failure mode — all four required sub-items, below. |
| C-b (stale §2d sentence) | Round 3 (external review) | **Fixed.** §2d's RLS paragraph still said owners see their report "via the WhatsApp send itself" — a leftover from before this document's OWN revision 3 (above) moved owner delivery to email. Corrected; rest of the document swept for the same class of staleness (none found beyond this one instance). |
| C-c (§2e stage-collapse ordering) | Round 3 (external review) | **Fixed.** §2e's `pm_notified`/`delivered` bullets read as a strict linear sequence (`pending → pm_notified → delivered`) that 2a's own "unconditional" owner-send framing doesn't actually guarantee — corrected below. |

**On C-a's severity, reproduced because it sets the frame correctly and shouldn't be
paraphrased away:** *"A typo'd owner email means the full nightly operations report of a
construction site delivered to a stranger, silently, every night — irreversible per your
own (d) reasoning, and worse than a bounced send because it succeeds."* Wrong-recipient is
not a delivery failure. It is a delivery SUCCESS with the worst possible outcome, and no
error-handling path in this plan (or in 2g's existing three-item deliverability list) was
ever going to catch it — because nothing about it looks like an error.

**REVISION 5 (2026-08-19, round 4 external review — both plans "moved substantially,
neither ready to send back" — resubmit as a diff against this pin) — diff against
`6c8a3cd`. Still nothing implemented; still one round short of the review package.**

**Confirmed good, no further work this round (per direct instruction, not re-litigated):**
A1/A3/A4's not-applicable rulings (grep evidence stood).

**Revision header, this round:**

| Label | Round of origin | Status this round | What changed |
|---|---|---|---|
| A (beta provisioning is manual) | Round 4 (Aravind's decision — not open for re-litigation) | **Implemented in the plan.** New §2j subsection: exact operator steps (A1 — `users` INSERT + `projects.owner_user_id` UPDATE, corrected this round to the real association mechanism, not `project_members`), double opt-in still applies to seeded addresses (A2), member-management UI named and deferred post-beta with the onboarding-never-joins-a-tenant gap named alongside it (A3), and a stated-assumption risk-section line: no owner has ever used this product (A4). |
| B1 (constraints not stated) | Round 4 (external review) | **Fixed.** Global uniqueness: no. Per-tenant uniqueness: no. Format validation: both DB `CHECK` and app layer, named as a weak defense against the actual risk. All three reasoned, not asserted. |
| B2 (`whatsapp_number` precedent unverified) | Round 4 (external review) | **Fixed.** Verified against `001_core_schema.sql:44` — `TEXT UNIQUE`, no format `CHECK`, app-layer-only normalisation. Two deliberate divergences named and justified (uniqueness, format checking) rather than blindly matched. |
| B3 (`skipped_unverified` — what kind of thing) | Round 4 (external review) | **Fixed.** A `TEXT` value in `delivery_status`'s existing `CHECK` constraint — a real schema change (`DROP`/`ADD CONSTRAINT`), not an enum, not derived at read time; named explicitly for the gating assessment. |
| B4 (silent non-delivery, mirror of §2g item 4) | Round 4 (external review) | **Fixed.** Added to §2g as item 5. Surfacing mechanism picked, not left at "it's logged": a Sentry alert after N consecutive `skipped_unverified` nights, reasoned against A4's own "no owner has ever used this product" finding. |

**Correction of the prior round's own mistake, found while answering B2, not asked for —
flagged rather than silently fixed:** the prior §2j stated the natural home for an
owner-management surface was `app/(dashboard)/projects/[id]/page.tsx`, "which already
reads `project_members` for that project," implying owner association runs through
`project_members`. **That's wrong.** `023_dpr_reports.sql`'s own header states, three
independent ways, that owners are NOT associated via `project_members` at all — the real
link is `projects.owner_user_id` (`016_corrections.sql:88-89`), a plain FK. This round's
A1 provisioning steps and B2's precedent-check both now reflect the correct mechanism; the
prior round's inaccurate framing is not restated.

**REVISION 6 (2026-08-19, round 5 external review — "three residuals, then both go to the
reviewer") — diff against `5482173`. Per direct instruction, this is intended to be the
last plan revision before the review package — the next artifact after clearance should be
a migration, not another plan diff.**

**Accepted without further work this round (per direct instruction):** Part A's
`owner_user_id`/`project_members` correction being flagged as my own error rather than
silently fixed; the uniqueness reasoning; the `whatsapp_number` precedent check; format
validation named as weak against the real risk; `skipped_unverified` confirmed as a gated
schema change.

| Label | Round of origin | Status this round | What changed |
|---|---|---|---|
| R1 (Sentry is beta-only) | Round 5 (external review) | **Fixed.** §2g item 5 now states explicitly that Sentry-surfacing is correct only while operator and developer are the same person, and names a customer-facing operator surface as a required dependency before those roles separate — not designed here. |
| R2 (name N) | Round 5 (external review) | **Fixed.** N = 3, measured in consecutive nights (days of owner silence), not an abstract count — reasoned against the expected first-night skip every seeded owner has. |
| R3 (what fires the confirmation send) | Round 5 (external review) | **Fixed.** New §2j subsection: operator-triggered (option i), chosen for consistency with Part A's manual-beta decision over a DB-trigger-to-email-service design (option ii, rejected with reasons). Runbook location stated: A1's own three numbered steps, no separate doc. |

**Self-found and fixed while addressing R3, not asked for:** the `## ROADMAP NOTE` section
header was accidentally deleted during round 4's §2j rewrite (confirmed via `git show
6c8a3cd` — already missing at that pin, so this session's own round-4 edit caused it, not
an earlier round). The section's content survived; only the heading introducing it and the
Summary's own back-reference to it were left dangling. Restored in place, flagged inline
where it was restored, per this document's own provenance discipline — not silently
patched.

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
actually delivered, **via the email send itself (STALE FIXED, round 3 external review,
C-b: this previously said "via the WhatsApp send itself," a leftover from before this
document's own revision 3, above, moved owner delivery to email)**, never the dashboard —
so no owner-readable policy is proposed here; if that's wrong, it's a decision to make in
the review package, not an oversight in this sketch. Owners also have no web login at all
(`auth_id NULL`, CLAUDE.md §5) — `get_user_tenant_id()` has nothing to key off for an
owner even if a policy were proposed, which is a second, independent reason no
owner-readable RLS policy exists here, not just the channel choice.

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

**ORDERING FIXED (round 3 external review, C-c): the two bullets below previously read as a
strict pipeline — `pending → pm_notified → delivered`, in that order, always. That is not
what this design actually guarantees, and the sentence describing `pm_notified` stated it
as if it were.** `delivery_status` is a SINGLE column being written by TWO independent
sends (2a: the owner-send is unconditional, never gated on PM-notify's outcome), and a
single-value column cannot hold both stages' outcomes at once — whichever write lands last
wins, full stop, the same collapse the `failed` bullet below already concedes explicitly
for the failure case. Stated correctly, not sequentially:

- `pending` — unchanged: no delivery action taken yet (should be near-instantaneous now,
  since PM-notify fires atomically with generation at `eveningClose`).
- **`pm_notified`** *(NEW)* — the PM has been sent the 19:45 notification+link.
  **CORRECTED: this is ONE of two possible non-terminal states for the 19:45→20:30 window,
  not "the" state.** The other is `skipped_no_template` (below) — under THE ENTANGLEMENT's
  own finding (unchanged this revision), PM-notify is `skipped_no_template` on every
  attempt until Meta approves the template, which is the CURRENT, expected state
  pre-launch. A reader should not assume `pm_notified` is reliably reached at all today.
- `delivered` — re-scoped, not renamed: now specifically means "delivered to the **owner**
  by email" (the terminal success state; channel per the DECISION above), written at
  `ownerSend` (20:30) **UNCONDITIONALLY AND INDEPENDENTLY of whatever `delivery_status`
  currently holds** — per 2a, the owner-send does not check, wait for, or depend on
  `pm_notified` having happened. `delivered` can therefore overwrite `pending`,
  `pm_notified`, OR `skipped_no_template` with equal validity — there is no "correct"
  predecessor state it transitions from, because it is not a transition in a shared state
  machine, it is a second writer landing on the same column. **A late-arriving
  `pm_notify` retry is the concrete failure mode this creates, named so it's designed
  around rather than discovered live:** if a retried/delayed PM-notify send lands AFTER
  20:30 (a real possibility — nothing in this plan bounds how late a retry can run), its
  write of `pm_notified` would silently regress an already-`delivered` (terminal, correct)
  status back to a non-terminal one. The owner-send/version-write RPC (2d) should be the
  ONLY writer trusted to set a value that looks terminal, and any PM-notify write path
  should guard against overwriting a value it didn't itself produce — a concrete
  implementation requirement for whoever builds this, not solved to SQL here. No longer
  implies WhatsApp, and no longer implies anything about template approval — an email
  delivery has its own success/failure shape (2g), unrelated to Meta's.
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
4. **ADDED (round 3 external review, C-a item 4) — wrong recipient. The worst failure mode
   on this list, and the one none of the other three can ever catch.** Bounced, complained,
   and silently-spam-foldered (item 3, above) are all real risks — but every one of them is
   a deliverability PROBLEM, something the provider's status-callback webhook (item 3) can
   eventually surface. **Wrong recipient is not a deliverability problem — it is a
   deliverability SUCCESS.** A typo'd or stale `notification_email` (2j) means the full
   nightly operations report of a construction site is delivered, correctly, on time, with
   no bounce and no complaint, to a complete stranger — every single night, silently,
   forever, until someone notices by some means entirely outside this system. **This is
   invisible to every monitoring signal the other three items in this list rely on**: the
   provider reports `delivered` (true — it WAS delivered, just to the wrong person), no
   bounce fires, no complaint fires (the stranger receiving it has no reason to mark spam
   on a legitimate-looking business report), and `delivery_status` reads `'delivered'` in
   this project's own state machine, exactly as if everything worked — because, from this
   system's point of view, everything DID work. The only defense against this failure mode
   is upstream of delivery entirely — 2j's confirmed-delivery check (double opt-in) — not
   anything this section's own provider/webhook machinery can ever detect after the fact.
5. **ADDED (round 4 external review, B4) — silent non-delivery from a never-confirmed
   address. The mirror of item 4, same invisibility, different cause.** If an owner never
   clicks the confirmation link 2j's double opt-in requires, `delivery_status` writes
   `skipped_unverified` every night, indefinitely, and — unlike item 4 — this one doesn't
   even reach the "provider accepted it" stage, so there's no `delivered`/`bounced`/
   `complained` webhook event to ever fire in the first place. **Surfaced via a Sentry
   alert after 3 consecutive `skipped_unverified` nights for the same recipient — N NAMED
   (round 5 external review, R2), not left abstract.** Measured in DAYS the owner has
   silently received nothing, not as a generic retry count, per direct instruction: the
   natural cadence here is exactly one skip opportunity per night (one `ownerSend` run),
   so "3 consecutive skips" and "3 consecutive nights of silence" are the same number by
   construction. **Why 3, stated as a reason, not picked arbitrarily:** the FIRST night
   after seeding is EXPECTED to be `skipped_unverified` for every single owner — the
   recipient hasn't had time to open their inbox and click yet — so a 1-night threshold
   would fire routinely on every normal seeding, not just real problems, and be ignored the
   way any alert that fires on the expected case gets ignored. 3 consecutive nights is long
   enough to rule out "just seeded, hasn't checked email yet" as the explanation, and short
   enough that a real problem (bad address, provider outage) surfaces within the same week
   it started, not after a month of silent non-delivery.
   **R1 (round 5 external review) — this surfacing is BETA-SCOPED, stated explicitly, not
   left to be discovered as a defect later.** A Sentry alert reaching the operator is
   correct ONLY because, for beta, the operator (who seeds owner rows, 2j/A1) and the
   developer (who reads Sentry) are the same person. It stops being correct the moment
   those roles separate — the party who needs to know a specific customer's owner has gone
   silent is whoever holds that customer relationship, and that party does not read Sentry.
   **A customer-facing operator surface (a dashboard view, a scheduled digest, something a
   non-engineer can act on) is REQUIRED before operator and developer roles separate** —
   named as a dependency this plan does not design or schedule, per direct instruction, not
   a defect in the beta-scoped choice above.

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

## 2j. BLOCKING — the owner's email address has nowhere to live (C-a, round 3 external review)

**The plan sends the nightly report to the owner by email but never said where that
address is stored, who enters it, or how it is verified.** Checked, not assumed: `public.
users` has NO email column, and owners have `auth_id NULL` (CLAUDE.md §5) — there is no
`auth.users` row to borrow an email from either. The address this whole revision's DECISION
depends on does not exist anywhere in the schema today. **Confirmed directly against prod,
this same session (read-only check): zero `role='owner'` rows exist in `public.users` at
all, on any tenant.** This isn't a gap in an existing owner's record — there is no owner
in this system yet, for any project, and no path to create one that would also capture an
email address. **This last point turned out to be the most important finding in the prior
round, and round 3 review correctly named the gap it left: the address's schema location
was solved, the ROW it lives on was not. Both are answered below — the row via a DECIDED
beta-only provisioning path (A1-A4), the address's own constraints via B1-B4.**

**1. Schema home.** A new column on `users`: `notification_email TEXT NULL` (nullable —
only owner-role rows would populate it). **Not a separate recipients table** — rejected,
not just undecided: today's requirement is exactly one delivery address per owner-role row,
a 1:1 relationship `users` already models for every other contact channel this product has.
A separate table would earn its keep the day this product needs to send one report to
MULTIPLE recipients (a second owner, an accountant) — not decided or needed here, named as
the reason a future redesign might revisit this, not a flaw in today's choice. **This is a
schema change and therefore gated** — same review-package path as migration 028's own
additions, per this project's standing practice; not written as a migration in this pass.
Constraints, precedent-checked and justified — B1/B2 below, not asserted casually as before.

### B1 — constraints, stated with reasons, not left to the CHECK's own type

- **Global uniqueness: NO.** The same address is allowed on two different `users` rows. One
  person may legitimately own two projects — under different tenants (two separate `users`
  rows are required regardless, since `users.tenant_id` is a single FK with no cross-tenant
  identity) or, per B2's finding below, even within the same tenant. "Unique" is the default
  instinct for anything shaped like an identifier, and it would be wrong here — stated
  explicitly so a future migration author doesn't add it by reflex.
- **Per-tenant uniqueness: also NO, same reasoning one level down.** A single tenant
  ("Rajamani Constructions Pvt Ltd," prod's own real tenant) can run multiple projects: one
  real person could be the named owner-role row for several of that tenant's projects, each
  with its own `users` row (since `projects.owner_user_id` — B2, below — is a plain
  one-project-to-one-user-row FK, not a many-to-many). Constraining `notification_email` to
  be unique within a tenant would block that legitimate case for no correctness benefit —
  nothing downstream needs "one address, one row" to hold at either scope.
- **Format validation: BOTH layers, deliberately, unlike `whatsapp_number`'s precedent
  (B2 finds it has neither).** A DB-level `CHECK` (a basic
  `notification_email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'` shape, not a
  full RFC-5322 validator) catches obviously malformed data even if every application
  code path is somehow bypassed — cheap insurance, matching this project's general "TEXT +
  CHECK, not trusted to the app alone" posture for status/money columns. Application-layer
  validation too, for immediate UX feedback in whatever form eventually captures this (2j's
  provisioning path, A1, or a future UI). **Named honestly: neither layer is the real
  safety mechanism here.** A regex confirms an address is SHAPED like an email; it cannot
  confirm it's the RIGHT email — a syntactically valid but wrong address sails through both
  checks untouched. The actual defense against the failure mode this finding exists to
  prevent is B3's confirmed-delivery check, below, not format validation at either layer.

### B2 — the `whatsapp_number` precedent, checked, and where this deliberately diverges

**Verified against the actual column, not asserted:** `users.whatsapp_number` —
`supabase/migrations/001_core_schema.sql:44` — `TEXT UNIQUE`, nullable (no `NOT NULL`), no
`CHECK` constraint of any kind. Format handling (E.164 normalisation) happens entirely at
the application layer (`lib/whatsapp/normalise.ts`), never enforced by the database.

**Two deliberate divergences from this precedent, both justified, not accidental:**
1. **`whatsapp_number` is globally `UNIQUE`; `notification_email` is not (B1, above).**
   Different roles for the two columns, not an inconsistency: `whatsapp_number` is an
   INBOUND IDENTITY key — the webhook resolves exactly one `users` row per inbound number,
   and two rows sharing a number would make that resolution ambiguous, breaking the whole
   inbound flow. `notification_email` is OUTBOUND-ONLY — nothing in this system ever looks
   up "which user does this email belong to" the way the webhook looks up a phone number.
   Uniqueness exists to protect a lookup that doesn't exist here.
2. **`whatsapp_number` has no format `CHECK`; `notification_email` gets one (B1, above).**
   Also deliberate, not an inconsistency: E.164 phone format needs country-code-aware
   normalisation logic a simple `CHECK` regex can't express correctly (that's precisely why
   `normalise.ts` exists as application code), so a DB-level format check was never a good
   fit for that column. Email format is comfortably expressible in a simple `CHECK` regex —
   cheap to add, no reason not to, even though it's acknowledged above as a weak defense
   against the real risk.

**2. Who enters it, and the row it goes on.** There is no invite path today, for ANY role,
checked by grep across `app/`: no member-management, invite, or owner-creation surface
exists anywhere in the codebase. Onboarding (`app/(onboarding)/onboarding/page.tsx`)
creates a TENANT — it never joins a project or creates a second user. Every `users` row in
prod today was created directly against the database, not through any app UI. **Checked
further this round, correcting the prior draft's own inaccuracy: owner association does
NOT run through `project_members` at all.** `023_dpr_reports.sql`'s own header states this
explicitly, three independent ways, and it's confirmed by reading `016_corrections.sql:85-
89`: `projects.owner_user_id UUID REFERENCES public.users(id) ON DELETE RESTRICT` is the
actual link — a plain FK from `projects` to a single `users` row, not a `project_members`
row. **One tracked, pre-existing gap this seeding path inherits, not introduced by it:**
`016`'s own comment (line 32-34) already flags that `owner_user_id` has NO same-tenant
enforcement at the DB level — nothing stops a project pointing at an owner row in a
different tenant. The seeding operator (A1, below) is the thing responsible for getting
this right today; the DB will not catch a mistake.

### A. DECIDED (Aravind, not open for re-litigation in this plan) — beta provisioning is manual, not built as a UI

**For beta, owner rows and their verified `notification_email` are SEEDED MANUALLY, by an
operator, per project, during onboarding. Member-management/invite UI is explicitly NOT
built on this critical path.** This resolves item 2's own critical-path problem (a UI that
doesn't exist) without waiting on building one — at the cost of the manual steps below,
accepted deliberately for beta's scale.

**A1. The exact operator steps, stated concretely, not left to inference:**
1. `INSERT INTO public.users` — `id` (generated), `tenant_id` = the target project's
   tenant (read from `projects.tenant_id` for the project being provisioned — this is the
   step that has to get the same-tenant match right, since nothing enforces it, per B2's
   `owner_user_id` gap above), `full_name` = the real owner's name, `role = 'owner'`,
   `auth_id = NULL` (owners never get a web login, unchanged), `whatsapp_number = NULL`
   (not needed for this delivery path), `status = 'active'`, `notification_email` = the
   address the operator was given, **`notification_email_verified_at = NULL`** — never set
   at this step (A2, below).
2. `UPDATE public.projects SET owner_user_id = <the new user's id> WHERE id = <project id>`
   — the actual association, per B2's finding above. Not a `project_members` insert.
3. **Trigger the confirmation send.** Since no UI exists to fire this automatically, the
   operator invokes it directly — a small operator script (same pattern this codebase
   already uses for manual triggers, e.g. `scripts/generate-one-dpr.ts`), taking the new
   user's id, generating a verification token, and calling the email provider (2g) with the
   confirmation link. Not sketched to code here; named as the shape it takes.

**A2. Double opt-in STILL APPLIES to a manually seeded address — stated explicitly because
it would be easy to assume otherwise.** Manual entry by an operator is not verification.
The operator can mistype an address exactly as easily as a self-service form could, and
B3/§2g's wrong-recipient failure mode does not care who typed it or through which path.
**`notification_email_verified_at` is set ONLY by the recipient clicking through the
confirmation link — never by the seeding step, never by the operator, never by any
INSERT.** A2's own step 1 above deliberately leaves it `NULL` on creation for exactly this
reason. Until the real owner clicks, the row exists and the address is stored, but the
nightly send stays gated exactly as B3 (below) requires for any other unverified address.

**A3. Member-management/invite UI is a POST-BETA workstream — named and deferred, not
designed here.** One paragraph, per direct instruction: building a real PM-facing surface
for adding/editing project members (owners, and eventually the same gap for engineers,
ENG-01/02/05/06) is real, necessary work this plan does not schedule or scope. **The known
adjacent gap, named so it's on record as seen rather than missed:** onboarding creates a
tenant but never joins one — there is no path today for a SECOND person to enter an
EXISTING tenant at all, for any role, which is the more general problem this specific
owner-invite gap is one instance of. Not designed here.

**A4. Risk-section addition — stated as a fact on the record, not a defect.** No owner has
ever used this product. Confirmed this session: zero `role='owner'` rows have ever existed
in prod. Every owner-facing design decision in this document — the email channel itself,
the confirmation-click UX, the report's rendered form (2h), the manual seeding path above —
is unvalidated against a real user, because no real user in this role has ever interacted
with any part of it. This is a stated assumption this plan is built on, named explicitly so
it can be checked the first time a real owner is seeded, not discovered as a surprise if
the assumption turns out wrong.

**3. Confirmed-delivery check — required before an address goes live for nightly sends.**
Double opt-in: a confirmation email with a verification link (dependent on 2g's
transactional email provider being wired — verifying an address requires the ability to
send email at all, same provider/domain this whole revision depends on). Clicking it sets
`notification_email_verified_at TIMESTAMPTZ NULL`. **The nightly `ownerSend` job's own
query MUST filter on this being non-null** — an unverified address is treated exactly like
a missing one: no send, and a `delivery_status` outcome, `skipped_unverified` — **B3, below,
for exactly what kind of thing that value is.** **An unverified address must never receive
a report** — a hard requirement, per the severity this finding opens with, and per A2
above: this check applies with EQUAL force to a manually-seeded address as to any other.

### B3 — `skipped_unverified`: what kind of thing it is, stated so the reviewer doesn't infer it

**A TEXT value added to `delivery_status`'s existing CHECK constraint — NOT a Postgres
enum, and NOT computed/derived at read time.** `023`'s own `delivery_status` column is
`TEXT` with a `CHECK (delivery_status IN (...))` constraint (confirmed against the column
definition, matching this project's standing convention — CLAUDE.md §6: "Status columns —
Always TEXT + CHECK constraint. Never ENUM types"). Adding `skipped_unverified` is
therefore an `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT ... CHECK (...)` — cheaper
than a Postgres `ALTER TYPE ... ADD VALUE` would be, but still a real, named schema change,
and it needs to be counted as one in whatever gating assessment this revision's migration
goes through — not left for the reviewer to infer from "it's a status value." **It is
WRITTEN, not derived:** the `ownerSend` job writes this value explicitly, at send-decision
time, the moment it finds `notification_email_verified_at IS NULL` — unlike #69's own
`unreachable` status (a genuinely different design, computed fresh from a ledger on every
read), this is a stored fact about what a specific job run decided to do, same shape as
every other `delivery_status` value already on this column.

### B4 — the mirror of §2g's fourth item: silent non-delivery when the owner never confirms

**Same class of failure as wrong-recipient (§2g item 4), named as its mirror, not a
separate finding — full detail, including N=3 (R2) and the beta-only scoping of this
surfacing (R1), lives in §2g's own item 5, not restated twice here.** If an owner never
clicks the confirmation link, `skipped_unverified` is written EVERY NIGHT, indefinitely —
invisible to every monitoring signal that isn't specifically watching for it. Surfaced via
a Sentry alert after 3 consecutive `skipped_unverified` nights, chosen over a
PM-dashboard-only surface because A4 (above) establishes no owner has ever used this
product and provisioning is operator-driven (A1-A3) — an alert reaching that same operator
is the realistic path to anyone noticing, **for beta only**: §2g item 5 names the
customer-facing surface this needs the moment operator and developer are different people.

**Not decided here, named as required follow-ups (same discipline as 2g/2h's own
dependencies):** the exact confirmation-email copy/flow, and whether a PM (or operator) can
re-trigger verification after editing the address. **R3 (round 5 external review) answers
what fires the confirmation send in the first place** — new subsection below, not left
open any longer.

### R3 — what fires the confirmation email for a seeded address

**Gap, found by round 5 external review: 2j/A1 says the operator inserts the `users` row
and sets `notification_email`, and B3/2j says `notification_email_verified_at` is set only
by the recipient clicking through — but nothing said what SENDS the confirmation email for
a row created out-of-band.** Two shapes weighed, one chosen:

**(i) Operator-triggered — CHOSEN.** After A1's steps 1-2 (the `users` INSERT and the
`projects.owner_user_id` UPDATE), the operator explicitly fires the confirmation send as
its own, third step — already named in A1 as "trigger the confirmation send... a small
operator script." This revision makes explicit what was implicit: firing that script IS
the mechanism, not a placeholder for one. **Cost, named honestly rather than glossed over:**
this is a manual step whose omission is invisible at the moment it's skipped — the address
sits unverified, the nightly send quietly writes `skipped_unverified`, and the only signal
is §2g item 5's alert, 3 nights later (R2). Accepted anyway, for one reason: **consistency
with Part A's own decision.** Beta provisioning is deliberately manual end-to-end (A1-A3) —
introducing automation for JUST this one step, while every other step in the same sequence
stays a manual operator action, would be an inconsistent, partial fix that still requires
the operator to correctly execute two of three steps by hand.

**(ii) Automatic on INSERT/UPDATE of `notification_email` — REJECTED, reasoned, not just
dismissed.** This would need something to observe the column change and react — concretely,
a Postgres trigger that reaches an external email service (Resend, 2g) directly from the
database. **Stated explicitly because it's a materially different, and materially riskier,
gating question than (i):** this codebase has never made an outbound HTTP call from inside
Postgres (it would need `pg_net` or equivalent, a dependency this project doesn't use
anywhere today), and CLAUDE.md's own OUT-OF-BAND DB OBJECTS registry already tracks the
cost of DB-side mechanisms that live outside the normal migration-reviewed path — adding a
trigger that calls out to a third-party API is a new category of risk this project has
specifically been careful about, not a smaller version of (i)'s manual-step risk. Rejected
primarily because it contradicts Part A's own decision to keep beta manual, not because
it's unbuildable.

**Where the runbook lives: A1 itself, no separate document.** A1's own three numbered steps
(§2j, above) ARE the runbook — insert the `users` row, set `owner_user_id`, fire the
confirmation script, in that order. Not duplicated into a second procedure doc that could
drift from A1's own text. **One mitigation named, not built here:** the (not-yet-built)
confirmation-send script's own header comment should restate all three steps, not just its
own, so running the script in isolation still reminds the operator of the two DB steps that
precede it — cheap insurance against exactly the omission risk (i) accepts.

---

## ROADMAP NOTE (not scope, not scheduled) — mobile app, PWA as the checkpoint

**BUG FOUND AND FIXED (round 5, self-caught while addressing R3, not asked for): this
section header was accidentally deleted during round 4's §2j rewrite — the content below
survived, the heading introducing it did not, and the Summary's own "per the ROADMAP NOTE
above" reference (item 13) has been pointing at a header that didn't exist since 6c8a3cd.
Restored here, not silently — flagged the same way this document flags every other
self-found defect.**

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
describes for its trigger sends generally. **A2 (round 3 external review, NEW finding,
cross-referenced here per direct instruction — #69 owns the number, not this document):**
#69's own economics finding (its §3g condition (e)) applies to stage 1's PM-notify
template send the same as it applies to #69's own four engineer checkpoints — post-October,
every template send is billed, PM-notify included. This document doesn't own that cost
model or the `PER_MESSAGE_RATE_INR` variable it depends on; flagged here only so this
document's own cost picture isn't read as complete without it.

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
4. `delivery_status`'s CHECK widened by THREE values now (`pm_notified`,
   `skipped_no_template` — scoped to stage 1/`pm_notify` only — and **NEW this revision,
   `skipped_unverified` (2j)** for an owner-send blocked on an unconfirmed email address).
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
14. **The owner-email schema chain (2j):** `users.notification_email TEXT NULL` (own
    migration, gated, additive to item 2's migration or its own; constraints reasoned in
    B1/B2 — not globally or per-tenant unique, format-checked at both DB and app layers) +
    `notification_email_verified_at` + a double-opt-in confirmation send (sequenced AFTER
    item 9's provider/domain work) + the nightly `ownerSend` query filtering on
    verified-not-null + `skipped_unverified` (a real `CHECK`-constraint schema change, B3,
    not an enum, not derived). **SUPERSEDED this revision, not carried forward as written:**
    the prior round's "a PM-facing add/edit owner UI... this plan cannot ship without that
    surface" is replaced by item 16 below — beta does not wait on that UI at all.
15. **§2g's deliverability list is now five items, not three:** wrong recipient (round 3,
    a delivery SUCCESS, invisible to bounce/complaint/webhook monitoring, catchable only
    upstream by item 14's confirmation gate) and, **NEW this revision (B4),** silent
    non-delivery from a never-confirmed address — surfaced via a Sentry alert after N
    consecutive `skipped_unverified` nights, not left at "it's logged."
16. **NEW (round 4, Aravind's decision, not open for re-litigation) — beta provisioning is
    manual (2j, section A):** an operator directly inserts the owner's `users` row and sets
    `projects.owner_user_id` (the actual association mechanism — corrected this round from
    the prior draft's inaccurate `project_members` framing), triggers the confirmation send
    via a small script, and double opt-in still applies exactly as it would to a
    self-service address. Member-management/invite UI is POST-BETA, named and deferred
    (A3), not built on this critical path. A stated-assumption risk line is added: no owner
    has ever used this product (A4).

None of this is built in this pass. Branch/PR for this document only — no code, except the
dated `bot-flows.md` supersession note (documentation, matching item 3 above).
