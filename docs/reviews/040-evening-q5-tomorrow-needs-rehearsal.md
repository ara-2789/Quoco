# Migration 040 — Stage 1 rehearsal record

Evening Q5 replaced (forward-looking "extra needed tomorrow" question) + `evening_schedule_miss_reason`
retired to a new, honestly-named `evening_tomorrow_needs` column. Full design reasoning lives in this
session's own conversation record; this document is the rehearsal evidence only, per CLAUDE.md's own
dry-run/rehearsal discipline (§7) and DOWN-block rehearsal rule.

Migration file: `docs/reviews/040_evening_q5_tomorrow_needs.sql` (held, unapplied — per CLAUDE.md's
"migration file enters `supabase/migrations/` when applied, not when written" rule).

Number reservation: `040`, added to `scripts/migration-number-reservations.json`. Confirmed against
`origin/main` (`9c34be8`) — `039_hindrance_acknowledgement.sql` is already live in
`supabase/migrations/` there, and the prior reservation entry describing it as "still held in
docs/reviews/" is stale, corrected in the new reservation's own note. Confirmed against test-db's own
ledger (`supabase migration list`, local/remote both list 001–039, no gap). Scanned every sibling
`.claude/worktrees/*/supabase/migrations/` and `*/scripts/migration-number-reservations.json` — nothing
claims 040 or higher anywhere.

Linked project for this entire rehearsal: **test-db (`exfccwlrhoutkgrlikod`)**, confirmed via
`cat supabase/.temp/project-ref` before the first write. Prod (`jvxwqignooseazzmwhvl`) was never
linked or touched in this worktree.

## PITR — verified by observation, gap disclosed plainly

`supabase backups list --project-ref exfccwlrhoutkgrlikod`:

```json
{"region":"ap-southeast-2","walg_enabled":true,"pitr_enabled":false,"backups":[
  {"id":1636625150,"is_physical_backup":true,"status":"COMPLETED","inserted_at":"2026-09-10T18:35:46.644Z"},
  ...six more nightly physical backups, one per day back to 2026-09-04...
]}
```

**`pitr_enabled: false` on test-db, confirmed today (2026-09-11), matching this project's own
standing 2026-08-20 finding — the gap has not closed.** There is no point-in-time restore mechanism to
snapshot before this rehearsal. The only real safety net is the most recent nightly physical backup
(2026-09-10, ~18h old at rehearsal time) plus this rehearsal's own transactional discipline (rolled-back
pass first, real forward-apply only after that passed clean, explicit teardown verified byte-identical
afterward). Stated here rather than silently substituted — the instruction asked for a PITR snapshot and
one could not be taken because the mechanism does not exist on test-db.

## A real finding, caught mid-rehearsal, fixed before this went to Aravind

The first draft of Migration 040's `apply_evening_flow_turn` `CREATE OR REPLACE` was built from migration
035's body alone (verified only against 035's own file text). **Migration 038 also redefines this same
function** — a live, externally-reviewed branch (`ELSIF v_session.current_flow = 'hindrance' THEN`, two
`DECLARE` variables, two extra `RETURN` keys) that force-resets an abandoned ad-hoc hindrance session when
a scheduled evening trigger fires. The first draft's `CREATE OR REPLACE` would have **silently deleted
that entire branch** on apply.

Caught by comparing a `pg_get_functiondef` hash taken *before* touching anything (`ec80f682...`, 21445
chars) against the hash produced by reconstructing from the file text alone (`9b17ac73...`, 19878 chars)
— the mismatch was chased down rather than dismissed as formatting noise. Root cause: `correct_daily_log`
was grep-checked against every migration 001–039 for a second toucher before this file trusted 019's text
alone; `apply_evening_flow_turn` was not given the same check on the first pass.

Fix: STEP 7's body was rebuilt from a **verified `pg_get_functiondef` capture of the actual live
function** (035 + 038 combined, captured immediately before this migration was authored), with only the
intended step-5 change applied via three exact-match string substitutions (each asserted to match exactly
once, via a small Python script, not hand-edited a second time). The corrected migration file's own header
records this finding in full. The entire rehearsal below was re-run from a clean baseline against the
corrected file — nothing below reflects the flawed first draft.

## Pass A — rolled-back case

Migration file executed with its final `COMMIT;` swapped for `ROLLBACK;`.

```
$ supabase db query --linked -f .tmp/pass_a_rollback_v2.sql
{"rows":[],"warning":"..."}
```

No error. Post-state probe (new column existence, `daily_log_edits` CHECK definition, both function
hashes, old column's comment text) compared byte-for-byte against the pre-pass baseline:

| field | pre-Pass-A | post-Pass-A |
|---|---|---|
| `evening_tomorrow_needs` exists | 0 | 0 |
| `correct_daily_log` md5 | `61892c8d09fa3252d4d7d24e407876d3` | `61892c8d09fa3252d4d7d24e407876d3` |
| `apply_evening_flow_turn` md5 | `ec80f6821a4bf73adadb1c172e8eaef3` | `ec80f6821a4bf73adadb1c172e8eaef3` |
| whitelist CHECK | `...evening_schedule_miss_reason...` | `...evening_schedule_miss_reason...` (unchanged) |

Identical on every field. Rollback left zero trace.

## Pass B — real, committed forward-apply

```
$ supabase db query --linked -f docs/reviews/040_evening_q5_tomorrow_needs.sql
{"rows":[],"warning":"..."}
```

No error. Post-apply verification:

- `evening_tomorrow_needs` column exists, comment text matches the migration's own STEP 3.
- `evening_schedule_miss_reason`'s comment matches STEP 4's retirement text exactly.
- `daily_log_edits_column_name_check` now lists `evening_tomorrow_needs` in place of
  `evening_schedule_miss_reason`.
- `correct_daily_log` md5 changed (`7c18227f07239fde8b931324dc6c77aa`) — CASE swap took effect;
  precise check confirmed a live `WHEN 'evening_tomorrow_needs'` branch and confirmed **no**
  `WHEN 'evening_schedule_miss_reason'` branch remains (the earlier blunter substring check falsely
  flagged a hit — it was matching this migration's own explanatory *comment*, not a live CASE branch;
  re-checked with a branch-specific pattern to be sure).
- `apply_evening_flow_turn` md5 changed (`d19d07507abccdaf7d54ee1d74419af7` this round). Confirmed
  textually AND behaviourally (below) that migration 038's hindrance-collision branch survived.
- Grants re-verified via `has_function_privilege`/`has_column_privilege`: `anon` has EXECUTE on
  neither function; `authenticated` can call `correct_daily_log` only; `service_role` can call
  `apply_evening_flow_turn`; `authenticated` holds the new column's UPDATE grant. All as designed —
  unchanged from the pre-existing pattern (signature unchanged on both functions, so `CREATE OR REPLACE`
  preserved every grant by construction; nothing here depended on the REVOKE/GRANT reassertion actually
  firing, but it fired anyway, matching this project's own defence-in-depth convention).

### Functional test — full Q1→Q5 flow, disposable engineer

Five sequential `apply_evening_flow_turn` calls (start, Q1, Q2, Q3-with-auto-skip-to-Q5 since the
disposable engineer had no `morning_equipment` row, Q5), then a direct read of the resulting `daily_logs`
row:

```
{"evening_schedule_miss_reason": null,
 "evening_submitted_at": "2026-09-11 12:04:00+00",
 "evening_tomorrow_needs": "2 masons, cement"}
```

Session reached `current_flow: null, current_step: 0, evening_submitted: "true"` — clean completion.
Q5's answer landed on the new column; the old column stayed untouched.

### Behavioural proof the migration-038 branch survived — not just textual

Seeded a session at `current_flow='hindrance', current_step=2, context={"description": "..."}`
(simulating an engineer mid-way through the ad-hoc hindrance flow), then fired a scheduled evening
trigger (`p_start_flow=true`) against it:

```
{"current_flow": "evening", "current_step": 1, "hindrance_discarded": true,
 "hindrance_had_description": true, "outcome": "start"}
```

Exactly the collision-handling behaviour migration 038's own external review round 2 requires. Proven
live against the forward-applied 040, not merely present in the function's text.

## DOWN rehearsal

A second disposable engineer was advanced through Q1–Q3 (with the same auto-skip) to land a real session
at `current_step=5`, simulating an in-flight session at the exact deploy instant named in this migration's
own cutover-hazard note.

The DOWN was executed for real — **using the verified `pg_get_functiondef` capture taken before Pass A**,
not a hand-merge of migration files a second time (the same discipline that caught the 038 finding above,
applied to the DOWN direction too):

```
$ supabase db query --linked -f .tmp/real_down_v2.sql
{"rows":[],"warning":"..."}
```

No error. The seeded step-5 session was then given a free-text reply:

```
{"evening_schedule_miss_reason": "materials delayed 2 hours r2", "evening_tomorrow_needs": null}
```

**Not stranded** — the session processed the reply cleanly and wrote it to the *reverted*
`evening_schedule_miss_reason` column, reaching `current_flow: null, current_step: 0,
evening_submitted: "true"`. Unlike migration 038's own DOWN incident, this DOWN cannot strand a step-5
session in principle: it only changes one branch's write target inside a function that continues to exist
and continues to handle every step — there is no function removal for a session to call into the void.

The hindrance-collision behavioural test was repeated post-DOWN with a fresh seeded session and produced
the identical result (`hindrance_discarded: true`, `current_flow: 'evening'`, `outcome: 'start'`) —
migration 038's branch is intact on both sides of the DOWN, not just forward.

### Byte-identical verification

| field | true original baseline | post-DOWN |
|---|---|---|
| `correct_daily_log` md5 | `61892c8d09fa3252d4d7d24e407876d3` | `61892c8d09fa3252d4d7d24e407876d3` |
| `apply_evening_flow_turn` md5 | `ec80f6821a4bf73adadb1c172e8eaef3` | `ec80f6821a4bf73adadb1c172e8eaef3` |
| whitelist CHECK | `...evening_schedule_miss_reason...` | `...evening_schedule_miss_reason...` |

Both function bodies byte-identical to the true pre-migration state. `evening_tomorrow_needs`
column and `evening_schedule_miss_reason`'s new comment are left in place by design (see the migration
file's own DOWN header: columns are never dropped by this project's convention, and a comment revert
would erase the record of the migration having been attempted) — not a discrepancy.

## Final cleanup

Schema reverted to fully pristine (column dropped, original comment restored) since Stage 1 is not yet
approved — nothing from this rehearsal is meant to persist on test-db until Aravind reviews it. Every
disposable fixture row (2 tenants→1 tenant/3 users/1 project, 5 `whatsapp_sessions` rows, all `daily_logs`
rows under the disposable project) deleted. Final probe confirms zero disposable rows remain and both
function hashes plus the whitelist CHECK match the true original baseline exactly.

## What Stage 1 does NOT include

- No external review has been requested or sent — Aravind routes that, per his own instruction.
- No code-side mitigation for the cutover hazard (named in the migration's own header) has been built.
- Stage 2 (TypeScript rename, DPR label, `public.hindrances` join) has not been started.
