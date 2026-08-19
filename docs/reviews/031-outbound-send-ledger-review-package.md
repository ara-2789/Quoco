# Migration 031 review package — outbound-send ledger (BLOCKED)

**Status: WRITTEN, NOT APPLIED, NOT REHEARSED, BLOCKED.** This package accompanies
`supabase/migrations/031_outbound_send_ledger.sql`, pinned at commit
`597212060c5a7b1dc91430bf347db37d15c541e0` (branch `docs/outbound-send-primitive-plan`).
Design record: `docs/outbound-send-primitive-plan.md` (frozen — no further plan revisions
per the external reviewer's graduation verdict, 2026-08-19).

**Sequencing (external review, split-package decision):** BLOCKED, on two dependencies
named separately, not conflated:
1. **The trigger-cron workstream** — no cron exists yet to call the sender this table
   supports (§S of the frozen plan document, unchanged).
2. **B3's cross-flow RPC fix (§3b of the frozen plan document)** — this primitive's roster
   logic (`sendTriggerMessage`, engineer-checkpoint sends) assumes the morning/evening
   cross-flow interference bug is already fixed; applying this table before that RPC change
   ships would let the primitive send against session state B3 already found unreliable.

---

## 1. Full SQL, pinned

```
$ git show 597212060c5a7b1dc91430bf347db37d15c541e0:supabase/migrations/031_outbound_send_ledger.sql
```
Full file at that path/SHA, per CLAUDE.md §0's provenance rule.

---

## 2. §0 gate evaluation

Carried over verbatim from the frozen plan document's own §3g, WITH S2's addition folded
in at (c) per direct instruction — not re-derived:

- **(a) does not trip** for this table in isolation (a plain `INSERT`/`UPDATE` table, no
  new Postgres function in this file) — **DOES trip for the workstream as a whole**, via
  B3's own RPC change, which is its own separate migration (not yet numbered — B3's own
  package, when it ships) reviewed on its own terms. Scoped in, not scoped out, per §0's
  "SUBJECT MATTER, NOT DDL SHAPE" line — the plan document's own reasoning, carried over
  unchanged.
- **(b) trips.** A new table with wrong RLS/grants from day one is at least as dangerous as
  a bad change to an existing one (§0's own text, quoted in the frozen plan).
- **(c) judgment call, recorded, not silently assumed clear** — this primitive touches
  WhatsApp reachability and phone-number identity, not web-auth/login identity (§26's own
  scope is magic-link/OTP/session auth, a different surface). Reading: does not trip (c) on
  that basis, but the adjacency (phone numbers, `messaging_blocked` as an identity-adjacent
  gate, and — S2's addition, cross-referenced from #67's own migration 030 package — this
  same session also built a first-of-its-kind token-gated identity-verification surface for
  owner-email confirmation, a related but distinct (c) surface on a sibling migration) is
  real enough to name rather than wave past.
- **(d) trips.** A delivered WhatsApp message cannot be unsent.
- **(e) trips.** Every template send this table tracks is billed — A2's own economics
  finding (frozen plan §3g condition (e)): 4 templates + ~10 service replies/engineer/day,
  `PER_MESSAGE_RATE_INR` still an open, named variable pending Meta's India rate card, not
  guessed here or anywhere in this arc.

**Net: (b), (d), (e) trip on this table alone; (a) trips for the workstream via B3. Full
external-review package required — this document is that package.**

---

## 3. RLS audience statement

`outbound_sends_select` — mirrors `checkin_escalations_select` (027) exactly:
`authenticated`, `tenant_id = get_user_tenant_id() AND EXISTS` a `users`/`project_members`
join requiring `role IN ('pm', 'admin')` on the send's `project_id` — narrower than
`dprs_select`'s "any project member," matching `checkin_escalations`' own precedent since
this table carries the same operational-tracking character (per-send outcomes, retry
state), not archival report content. `'qs'` deliberately excluded, same precedent. All
writes revoked from `authenticated`/`anon` — the send primitive itself (`service_role`)
is the only writer, at three points in a send's lifecycle: claim (`'sending'`), the
Twilio-call outcome (`'sent'`/`'failed'`/`'skipped_*'`), and the async status-callback
route's later update (B4, `pricing` column).

---

## 4. Composite FK convention (5)

- `outbound_sends.project_id` → `projects(id, tenant_id)`, `ON DELETE CASCADE` — a send
  record has no meaning once its project is gone, mirroring `checkin_escalations_project_
  id_fkey`'s own `CASCADE` reasoning exactly (027).
- `outbound_sends.recipient_user_id` → `users(id, tenant_id)`, `ON DELETE CASCADE` — same
  reasoning, mirroring `checkin_escalations_engineer_id_fkey`.
- Both FKs deliberately have no inline single-column FK, composite-only — mirroring
  `checkin_escalations`' own end-state shape (`027_checkin_escalations.sql:295-301`), not
  023's older plain-FK pattern this project has separately flagged as a documented,
  unfixed gap on `dprs` (migration 029's own package, §4, names this same distinction for
  a sibling table).

---

## 5. C2 sharpening — skip-row transparency, restated in one sentence

**As specified, `computeUnreachable()` must treat `skipped_no_template` rows as
TRANSPARENT — excluded from the consecutive-failure sequence entirely, neither breaking it
nor counting toward it — while `skipped_already_submitted` rows remain genuinely
chain-breaking, since only the latter implies any evidence of recent reachability.** Full
reasoning and the worked example (`failed, skipped_no_template, failed, failed` must read
as 3 consecutive failures) is in the table's own `COMMENT ON TABLE` (pinned SQL, §1 above)
— not restated twice.

---

## 6. Retention-ledger line

**`outbound_sends` — PRUNABLE HYGIENE, same classification as `checkin_escalations`
(CLAUDE.md's own precedent entry for that table, `CLAUDE.md:960-974`), not a compliance
record.** Grain: one row per trigger-send attempt per recipient per checkpoint per day —
roughly 4-5x `checkin_escalations`' own growth rate (one row per SEND attempt, not one per
half-day-status), since a single `checkin_escalations` row can correspond to multiple
`outbound_sends` rows across a send + its retries/nudges. DASH-03/PM-facing surfaces (the
only planned readers, per §3 above) care about recent/current reachability, not indefinite
history — a future 7/30-day pattern view, if ever built, is a new, separate design
question, not a reason to retain every row by default. No prune mechanism built in this
migration — classification only, matching this project's own standing pattern for every
other retention-ledger line.

---

## 7. Rehearsal plan + pre-apply probes

**Not run — BLOCKED, not merely unrehearsed**, for the same reason migration 030's package
states: rehearsing a schema nothing reads or writes yet (no trigger-cron, no B3-fixed RPC
to call it) would prove only that the DDL parses, not that the design holds under real
traffic shapes. Deferred to when both blocking dependencies land. At that time:

```sql
-- Pre-apply: confirm the table does not exist yet.
SELECT to_regclass('public.outbound_sends');
```

**PROCEED condition:** `NULL`. **STOP on anything else.**

---

## 8. Test plan (named now, run at rehearsal time)

- **Idempotency negative control**: two concurrent claim attempts for the identical
  `(tenant_id, recipient_user_id, event_key)` — the second must hit the `UNIQUE` violation
  and read the first's existing row rather than proceeding to a second Twilio call (3d's
  own claim-before-send reasoning, proven with a real concurrent-insert test, not asserted
  from the constraint alone).
- **RLS negative control** (015 model, `error.code`-keyed): a `qs`-role authenticated
  client must be rejected from `SELECT`, matching `checkin_escalations_select`'s own
  deliberate exclusion — a real authenticated JWT client, never `service_role`.
- **`computeUnreachable()` unit tests** (once implemented, application-code, not this
  migration): the exact `failed, skipped_no_template, failed, failed` sequence from §5,
  asserting `unreachable = true`; a sibling case with `skipped_already_submitted` in the
  same position asserting the chain resets and `unreachable = false`.

---

## 9. Apply runbook

Per `docs/migration-runbook-template.md`. **Not scheduled.** Trigger conditions, both
required: trigger-cron workstream lands, AND B3's cross-flow RPC fix ships. Named here so
the next artifact for this migration is a go-ahead once both are true, not another design
pass.
