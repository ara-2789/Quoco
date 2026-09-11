# Migration 040 apply runbook — evening Q5 replaced, evening_schedule_miss_reason retired

Prepared 2026-09-11, folding in external review round 1's three fixes. Not executed — **do not apply**.
Aravind routes the re-review of the delta before this runbook is ever followed for real. Skeleton per
`docs/migration-runbook-template.md`; numbering follows `docs/reviews/035-lockstep-runbook.md`'s S0–S6
precedent, the closest prior evening-flow lockstep apply.

Migration file: `docs/reviews/040_evening_q5_tomorrow_needs.sql`. Rehearsal record:
`docs/reviews/040-evening-q5-tomorrow-needs-rehearsal.md`.

## PITR observation (no SQL)

Per `docs/migration-runbook-template.md`'s own step A and CLAUDE.md §0's "rollback mechanisms are
verified by observation, never by checklist status": Supabase Dashboard → **prod** project → Database →
Backups → Point in Time. Observe an active restore window ending ~now, record the timestamp. **Verify by
observation at apply time — do not trust this document's own PITR note from the rehearsal round**, which
was about test-db (confirmed `pitr_enabled: false` there) and says nothing about prod's own PITR state.
→ confirm before S0.

## S0 — Pre-flight

- Confirm `main`'s current HEAD fresh (not this document's header date).
- Re-read `supabase/migrations/` + `docs/reviews/*.sql` directly — re-confirm migration number 040 is
  still free at the actual apply moment, the same way 035's own S0 re-confirmed 035 (days can pass
  between drafting and applying; "checked clean once" is not "checked clean now").
- Re-run `npm run lint:migrations` fresh.
- Confirm the Stage 2 TypeScript PR (the `EngineerHindranceFacts` → `EngineerTomorrowNeedsFacts` rename,
  the "Dependency" label, the `public.hindrances` join) is open, reviewed, and ready to merge on a
  keystroke — **not already merged, not still unbuilt**. See S3's own lockstep clause below for why this
  gate matters here specifically.

## FIX 1 (B1, blocking) — pre-apply probe: has this column ever been corrected in prod?

**The fact this answers:** `daily_log_edits` has never been checked for a `column_name =
'evening_schedule_miss_reason'` row. Migration 040's STEP 5 originally dropped that value from
`daily_log_edits_column_name_check` — an `ADD CONSTRAINT` without `NOT VALID` validates every *existing*
row, not just future inserts, so a single historical correction row against that column would fail the
apply at `23514` (check_violation). **Fixed structurally** — the migration file's STEP 5 now *retains*
`evening_schedule_miss_reason` in the CHECK (history included; write-prevention moved to STEP 6's CASE
removal, which controls only future corrections) — so this probe is no longer apply-blocking. It is run
anyway, on both databases, because **the fact should be known, not survived**:

```sql
SELECT count(*) FROM public.daily_log_edits WHERE column_name = 'evening_schedule_miss_reason';
```

Run against test-db first, then prod, immediately before S1. **Record the raw output in the apply record
either way** — zero or non-zero, both are fine under the fixed STEP 5, but a non-zero count is real
history worth knowing about regardless (e.g. it says something about how much PM correction traffic this
column actually saw before this migration retires it).

## S1 — Apply window: dead-zone timing + the extended session probe

**FIX 3's cutover ruling, dissolving the hazard rather than accepting it:** apply in the post-cutoff dead
zone — after evening close, before the next 18:30 IST `eveningSend` trigger. No session can be mid-reply
at step 5 in that window, because no evening flow is active in it at all. This closes the cutover hazard
named in the migration's own header (a session already holding the old Q5 prompt, replying after deploy)
structurally, not by accepting the residual risk.

Live query, immediately before `BEGIN`, on the TARGET database, not carried over from an earlier check
(same discipline as 035's own S1):

```sql
SELECT current_flow, current_step, count(*)
FROM whatsapp_sessions
WHERE current_flow = 'evening'
GROUP BY 1, 2;
```

**PROCEED condition: zero rows.** This is the standing pre-apply session probe (035's own S1 shape),
extended by one clause per FIX 3: scoped specifically to `current_flow = 'evening'`, re-probed
immediately before `BEGIN`, not read from an earlier session or from the rehearsal round. A non-zero
result inside the dead zone would itself be a signal something is wrong with the assumption (a stuck
session, a clock skew) — stop and investigate rather than proceeding on the strength of the timing window
alone.

**Fallback, only for a genuine emergency in-hours apply:** hold outbound sends (the evening trigger cron)
before applying, confirm the same zero-rows probe, apply, then resume sends. This is the fallback path
only — the dead-zone window above is the normal path and should not need it.

## S2 — Apply, ONE sitting, no gap to S3

Fresh linked-project breadcrumb pasted immediately before the apply (CLAUDE.md §0's PROD APPLIES rule —
project ref printed in the same output as the apply, not recalled from earlier):

```
supabase db query --linked -f docs/reviews/040_evening_q5_tomorrow_needs.sql
```

— never `db push`. Against test-db first (a fresh apply, not trusting this round's rehearsal-and-DOWN
state as still current — that cycle was deliberately reversible, per its own record), then prod. By hand,
at the terminal — Claude Code does not issue this command without explicit go-ahead in the same exchange
(standing rule).

## FIX 2 (S1) — hash-pin both functions BEFORE the apply

**Formalizing the cross-check the rehearsal had implicitly.** Immediately before `BEGIN` (same moment as
S1's session probe), capture and record both functions' pre-apply state into the apply record:

```sql
SELECT
  'correct_daily_log' AS fn,
  md5(pg_get_functiondef('public.correct_daily_log(uuid,text,jsonb)'::regprocedure)) AS body_md5
UNION ALL
SELECT
  'apply_evening_flow_turn',
  md5(pg_get_functiondef('public.apply_evening_flow_turn(text,uuid,uuid,uuid,text,boolean,jsonb,jsonb,timestamptz,integer)'::regprocedure));
```

Paste the raw two-row result into the apply record, per database. This is what gives the DOWN
procedure's "capture current live, reverse the three edits" approach something concrete to verify
against later: if a rollback is ever run with no intervening migration, the reversed result should match
this pinned pair exactly; if a later migration has touched either function since, it won't match, and
that's expected, not a failure (the later migration's own changes must survive the rollback).

## S3 — Merge — THE LOCKSTEP CLAUSE (FIX 3: same-sitting, not merely sequenced)

**Stage 2 is same-sitting lockstep, not merely sequenced — the mismatch matrix is symmetric, unlike some
of this project's other lockstep hazards.** Old TypeScript against the new RPC mislabels one way (reads
`facts.hindrance` off a row whose Q5 answer is now forward-looking, prints it under "Hindrance —" — the
hazard already named in the migration's own cutover note). New TypeScript against the old RPC mislabels
the *other* way (expects `evening_tomorrow_needs` to be populated, reads a row that's still writing
`evening_schedule_miss_reason` under the pre-040 RPC, prints nothing or a stale value under the new
"Dependency" label). Neither direction is safe to leave open even briefly. Apply the migration (S2), then
merge the Stage 2 TypeScript PR **immediately**, no gap — the same shape as 035's own S3 ("merging is the
deploy; do not proceed to S4 until the merge/deploy is confirmed live"). Do not proceed to S4 until the
merge/deploy is confirmed live.

## S4 — Confirm live + behavioural check

Exercise the real evening flow's Q5 (or the closest available equivalent — a real end-to-end WhatsApp
sandbox turn, per CLAUDE.md §7's own verification standard) against the now-live RPC + deployed
TypeScript together. Confirm the new question text goes out, a reply lands on `evening_tomorrow_needs`,
and the DPR (once a report is generated) renders it under "Dependency," not "Hindrance." This is the
first real execution of the lockstep combination — a named, required step, not an assumed side effect of
S2/S3.

## FIX 2 (S1), continued — post-apply readback

Same probes as the standing template's step D, plus: `daily_log_edits_column_name_check`'s definition
(expect `evening_schedule_miss_reason` AND `evening_tomorrow_needs` both present), and
`correct_daily_log`'s live CASE (expect a `WHEN 'evening_tomorrow_needs'` branch, no
`WHEN 'evening_schedule_miss_reason'` branch — precise pattern match, not a blunt substring check, per
this migration's own rehearsal note on that exact false-positive).

## Ledger repair + test-db real apply + types regen

Per the standing template's steps E, F, G — not repeated in full here, folded forward unchanged. Step F
in particular: this migration's rehearsal round left test-db in a deliberately reverted (pristine) state,
so S2's test-db apply above is a REAL, permanent apply there, not a second rehearsal — no separate "F"
step is needed beyond what S2 already does, but the post-apply ledger repair and readback on test-db
still are, same as prod.

## POST-APPLY FINGERPRINT (for when the apply happens — not now)

**The same instrument that caught the near-miss, closing the loop as permanent proof of what's live.**
Match BOTH functions' `prosrc` hashes against STEP 6/7's bodies in the applied migration file (not
against the FIX-2 pre-apply pin above — this is a POST-apply check, confirming the live function matches
what the migration file says it should now contain). Any mismatch means the applied file and the live
database have diverged — investigate before considering the apply complete, the same discipline that
caught the 038 near-miss in the first place.

## After apply

- `docs/schema.md`'s 040 entry, written only after the ledger repair confirms on both databases.
- Apply record with the applied SHA, every probe frame (FIX 1's correction count, FIX 2's pre-apply hash
  pin, the post-apply fingerprint), per the standing provenance rule — pinned, never paraphrased.
