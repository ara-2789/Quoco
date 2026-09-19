# Engineer lifecycle — build plan, LIFECYCLE ACTIONS (slice 2, part 1 of 2) (rev11)

> **Split (rev11, 19 Sep 2026).** This document is **part 1 of slice 2**. Slice 2 was split out of the add-engineer plan at `eb8a9c2` after external review (rev10) and, in rev11, split again by content into **this document (the lifecycle actions)** and `docs/plans/engineer-episodes-plan.md` (the episodes record and everything reading from it). **Nothing was redesigned, no decision was resolved by the split, and nothing was dropped.** **The episodes design (D15) reverses D10 and has NOT been externally reviewed in this shape** — the functions in this document write it, so they inherit that status. Slice 1 is `docs/plans/add-engineer-plan.md`.
>
> **What this document contains.** **Deactivate** (§2.9) and **reactivate** (§2.10); the classifier outcome **`deactivated_on_this_project`** (Edge 2) (§2.1 row, §2.10, §4 R5b); the **unreachability report** (§2.11); findings **F1, F2, F3** and the inbound trace; decision **D17**; tests **T11, T16, T31, T32, T34, T35, T36, T37, T38, T42**; the lifecycle strings (§9); the lifecycle probes and prod queries (§10, §11).
>
> **What it explicitly does NOT contain.** The `engineer_episodes` table, its index, RLS and backfill; the D13 dated board rule and its query cost; the half-status / evening-chip change (Edge 1); F4 and F5; D10, D13–D15, D18–D20, D22; tests T23–T30c, T33, T40, T41, T43, T45 — **all of that is the episodes plan.** The add screen, the shared helper, the `users` columns, phone validation, the D12 rider, the engineers list page — **slice 1.**
>
> **Dependencies, in both directions.** **This document depends on:** (1) **slice 1** — its `users` columns (`registered_by`, `registered_at`, `consent_attested`), its **shared internal authorisation helper** (§2.7 of slice 1, reused unchanged by `deactivate_engineer` and `reactivate_engineer`), `add_engineers_to_project`, and the engineers list page (slice 1 §5.1), which hosts this document's controls; (2) **the episodes plan** — `deactivate_engineer` closes an episode, `reactivate_engineer` opens one, and both materialise legacy episodes, so they write a table, an index and an invariant (I1) that the episodes plan defines (§2.8). **What depends on this document:** the episodes plan's integration tests (T24a, T24b, T24d, T33) create episodes **by calling** these functions. **The two plans are one migration and one review** (ASSUMED; splitting the migration too would be a separate decision, UNKNOWNS #55). **Review order suggested: episodes plan first (the foundation), this document second.** **This document must not merge or apply before slice 1.**
>
> ## Review gate (a) is tripped up front — stated here so the reviewer meets it, not discovers it (rev11)
> **This document redefines the classifier that slice 1 ships.** `add_engineers_to_project` classifies every pasted number (§2.1, R5–R7a); slice 1 ships that classification with no `deactivated_on_this_project` outcome, and this document adds it (§2.10, §4 R5b). **Changing the logic of a live SECURITY DEFINER function trips review gate (a)** (`CLAUDE.md` §0, EXTERNAL REVIEW GATE — "CREATES OR MODIFIES a live function's LOGIC"): it needs the full review package, a rehearsal and a DOWN rehearsal, even though slice 1's version of the function will already have been reviewed and shipped.
> **Why, honestly:** it is **the unavoidable cost of the split.** The new outcome only makes sense once reactivate exists (§2.10), and reactivate is a lifecycle action; slice 1 cannot ship an outcome that offers an action it does not have. The single plan avoided this by shipping the function once; the split makes it two edits to one function. Same argument list → `CREATE OR REPLACE` preserves the function's grants (`CLAUDE.md` §0, the signature rule); a signature change would not. **The episodes plan makes a second edit to the same function** (it opens an episode on add, episodes plan §2.6) — **one redefinition, one review, one migration**, not two.
>
> ## Consequences of the split for slice 2 — recorded as consequences, NOT as new decisions (rev10, kept)
> 1. **Slice 2 redefines a function slice 1 has already shipped** — stated up front above. 2. **Engineers added by slice 1 are legacy-shaped: they have no episode** — and (rev11) the episodes plan now **backfills them** as a required step of its migration (episodes plan §2.8 R1). 3. **Slice 2 is its own migration** (slice 1's is `048`; slice 2's ASSUMED `049`). 4. **The board behaves two ways** for engineers with and without episodes — accepted (D18, episodes plan), now narrowed to legacy engineers by R1.

**Reading rule.** Moved passages say "this slice", "the slice", "slice 2" and "the plan"; they are verbatim from the single plan at `eb8a9c2` (and, after the rev10 split, `2f1b098`). **"Slice 2" now means the lifecycle plan and the episodes plan together**; "this slice" means the document that holds the passage. Section numbers, decision numbers (D1–D22), finding labels (F1–F5, N1, the S1 lint), test numbers (T1–T45) and UNKNOWN numbers are **unchanged** — nothing is renumbered; the section index above says which document holds each.

**Evidence (rev11).** This pass moved and re-split text and added the items named in its correction block; it ran no command against the repo's code and no database query. Every cited fact still rests on the logs named in the banner below (`add-engineer-plan-rev9.txt`; the read-only test-db probes in `add-engineer-plan-rev7.txt`). The rev11 log (`add-engineer-plan-rev11.txt`) holds the item-by-item mapping from the `2f1b098` slice 2.

**Section index (which document holds what):**
| Section | Lives in |
|---|---|
| Banner, Scope, dated corrections, §0 findings | **every document** (each keeps only its own items; shared items are in each that needs them) |
| §1 Authorisation; §2.1–§2.7 (add function, dry-run, helper); §2.8 (`registered_*` columns); §3; §4 R1–R8; §4.5–§4.8 (D12); §4.10 (S1 lint, D12 rider, N1); §5 and §5.1 (engineers list page, D21); §6 and §6.1 (deploy order); §7.1 T1–T22, T39, T44; §7.2; §7.3; §8; §9 (add and list strings) | **slice 1** — `add-engineer-plan.md` |
| §2.1 (the `deactivated_on_this_project` payload row); §2.9 Deactivate; the inbound trace and F1–F3; §2.10 Reactivate incl. the classifier outcome (Edge 2); §2.11 Unreachability report; §4 R5b; §4.9 lifecycle tests (T31, T32, T34, T35, T36, T37, T38, T42); §6 (functions); §7.1 T11, T16; §8 (functions); §9 (lifecycle strings); §10 (d, pg_3, pg_4); §11 (w, y) | **lifecycle plan** — `engineer-lifecycle-plan.md` |
| §2.6 (the episode row); §2.8 (the `engineer_episodes` table, lifecycle, index, RLS, **R1 backfill**); F4, F5; §4.8 (D13 part); §4.9 (the D13 board rule, query cost, Edge 1, D14, tests T23–T30c, T33, T40, T41, T43, T45); §6 (table, backfill); §7.1 T10b; §8 (episodes); §9 (marker); §10 (pg_1, 2, 5, 6, 7); §11 (v2, n3, u2, e1, b1, b2) | **episodes plan** — `engineer-episodes-plan.md` |
| Decisions, UNKNOWNS | split by item; every number and label is unchanged, nothing renumbered |

> PLAN ONLY. rev1 `c86c5b6` (2026-09-18 23:06 IST), rev2 `e67e297` (2026-09-18 23:41 IST), rev3 `9b9187c` (2026-09-19 00:15 IST), rev4 `dba9cfc`, rev5 `fad98e3`, rev6 `eff12a0`, rev7 `f407ba1`, rev8 `1765d21` — each pinned
> (`git show <sha>:docs/plans/add-engineer-plan.md`). rev9 written 2026-09-19 (IST) on `feat/add-engineer-plan`, base `origin/main` @ `0744110` (re-fetched; unchanged).
> No application code, no migration file, no SQL intended to ship. Tier: FULL.
>
> **Evidence rule.** Every claim cites source printed in `~/Desktop/add-engineer-plan-rev9.txt` ("the log"; older logs are named where a claim rests on them). **Database claims (`probe <letter>`, `pg_1`–`pg_7`) cite the read-only test-db probes printed in `~/Desktop/add-engineer-plan-rev7.txt`. rev8 and rev9 ran no database query: every rev9 fact is in a repo file, and no Supabase CLI command was run.** Citations are `path:line`; database claims cite `probe <letter>` (rev7 adds probes `pg_1`–`pg_7`, named as such); throwaway scripts
> (not in the repo, not shipping) are printed with their output. Anything not printed is **ASSUMED** or under UNKNOWNS. **Correction discipline.** Retracted claims stay visible as ~~strikethrough~~.
>
> **Settled by Aravind, applied without re-raising (this document's items):** **rev8: reactivate ships in this slice (§2.10).** *(D10 reversed, D13 and D15 are in the episodes plan; D1–D9, D11, D12 in slice 1.)*
>
> ## rev8 review conditions that live here
> **reactivate ships** as the third definer function, with the classifier fix (§2.10) · unreachability report (§2.11). *(Edge 1, F5 and the deploy-order dependency are in the episodes plan; the S1 lint, the D12 rider and N1 are in slice 1.)*

## Scope

**In scope (lifecycle plan):** a **deactivate** control (§2.9) and a **reactivate** control (§2.10); the classifier outcome `deactivated_on_this_project` (Edge 2); the unreachability report (§2.11).
**Deferred, named:** **freeing a number** (deactivate does not, §2.9); ~~reactivating from the dashboard~~ (rev8: **ships in this slice**, §2.10).

## Dated corrections, 19 Sep 2026 (rev11) — every change in this pass

| # | Earlier text (retracted / added) | rev11 result | Where |
|---|---|---|---|
| 1 | ~~the single slice-2 document `engineer-lifecycle-plan.md` at `2f1b098` (593 bytes under the size warn threshold; unreviewed episodes design, so it would grow)~~ | **Split by content into this document (the lifecycle actions) and `engineer-episodes-plan.md`.** The seam: lifecycle actions against the episodes record and its readers. Each header states what it contains, what it does not, and its dependencies both ways. Nothing redesigned, no decision resolved, nothing dropped (mapping in the rev11 log). | header |
| 2 | ~~UNKNOWNS #51 as the only statement of the gate trip~~ | **Stated up front** in this document's opening section: it redefines the classifier slice 1 ships, tripping review gate (a); the reason is the unavoidable cost of the split; one redefinition shared with the episodes plan. #51 kept as a pointer. | header |
| 3 | ~~rev10 "Consequences of the split" item 2: engineers added by slice 1 have no episode~~ | Now a required backfill step in the episodes plan (§2.8 R1). | header |
| 4 | (added) UNKNOWNS #55, #56 | One migration or two; review/merge order. Both assumed, neither decided. | UNKNOWNS |
| 5 | ~~§13 "DONE (rev10)" describing one split~~ | Updated: slice 2 split again (rev11), with the seam and the reason. | §13 |
| 6 | (info) | Everything else here is moved verbatim from the `2f1b098` slice 2; the rows of §4.9's test table, §6, §7.1, §9, §10, §11, §12, Decisions and UNKNOWNS were divided by item. | — |

## Dated corrections, 19 Sep 2026 (rev10) — kept (`git show 2f1b098:docs/plans/engineer-lifecycle-plan.md`)

| # | Earlier text (retracted / added) | rev10 result | Where |
|---|---|---|---|
| 1 | ~~the single add-engineer plan at `eb8a9c2`~~ | **Split out of the add-engineer plan at `eb8a9c2` after external review**, by content only. **The episodes design (D15) reverses D10 and has NOT been externally reviewed in this shape.** Header states contains / does not contain / dependency (slice 2 depends on slice 1's `users` columns and authorisation helper). | header |
| 5 | ~~T35 (the classifier offers reactivation) — dropped by the rev9 rewrite of §4.9~~ (found while inventorying `eb8a9c2` against `1765d21`) | **Restored verbatim from rev8 (`git show 1765d21`).** It names no removed column, so it needed no adaptation. | §4.9 |
| 6 | ~~§13 "REQUIRED BEFORE THE BUILD PACKAGE — split this plan"~~; ~~UNKNOWN #44~~; ~~§12 "The plan split (§13) creates files under `docs/plans/add-engineer/`"~~ | Done as two documents; §13 and #44 closed; §12 sentence struck. | §13, §12 |
| 7 | (added) header "Consequences of the split for slice 2" | (i) slice 2 **redefines** slice 1's `add_engineers_to_project`; (ii) engineers added by slice 1 have **no episode**; (iii) slice 2 is its own migration (ASSUMED `049`); (iv) the board behaves two ways (D18). Recorded as consequences, not decisions. UNKNOWNS #51–#53. | header |
| 8 | (added) UNKNOWNS #50–#54 | T43 seeding mechanism; add-function redefinition gate; slice-1-added engineers; episodes not externally reviewed in this shape; T35 restoration. | UNKNOWNS |
| 9 | ~~§12 "This revision's diff: exactly `docs/plans/add-engineer-plan.md`"~~ | The split's diff is both plan files. | §12 |

## Dated corrections, 19 Sep 2026 (rev9) — every change in this pass

| # | Earlier text (retracted) | rev9 result | Where |
|---|---|---|---|
| 3 | ~~rev8 §2.10 "What happens to `deactivated_by`/`deactivated_at` … keep them and add `reactivated_*`"; "the limit this leaves: one episode only"~~ | A reactivation **opens a new episode and touches no earlier one**; the one-episode limit **no longer exists**. The reactivation-day morning chip (leave-side twin of Edge 1) stays named, not built. | §2.10 |
| 4 | ~~rev8 §2.11 "no `daily_logs` row with a submitted timestamp" as the "no inbound" predicate~~ | **No `whatsapp_sessions` row for the number.** Every per-inbound record examined (table in §2.11): `processed_messages` has no phone; delivered/read are not recorded; `messaging_blocked` is never set. Hindrance-only repliers are no longer false positives. **Residual classes recorded:** FP-1 (static-ack-only inbound), FN-1 (a replying stranger hides a typo), FN-2 (fragile if a cron ever starts a session — T37 (iv)). | §2.11 |
| 7 | ~~rev8 §13-less: plan-size WARN noted only in a commit message~~ | **Split recorded as a required step before the build package** (§13): themes and files named; **not done here**; the WARN stays. | §13 |
| 9 | ~~rev8 tests T33/T34 (fixtures via `deactivated_at`/`reactivated_at`); rev7 T23/T24c (IST edge on `deactivated_at`)~~ | Rewritten on episodes. Integration tests create episodes by calling the real functions (`service_role` holds `SELECT` only); multi-day gaps and IST edges are proven in the pure T23. New: T24f, T40–T42. A back-dating seed helper is **not** specified (D20). | §4.9 |

## Dated corrections, 19 Sep 2026 (rev8) — kept (`git show 1765d21:docs/plans/add-engineer-plan.md`)

| # | Earlier text (retracted) | rev8 result | Where |
|---|---|---|---|
| 1 | ~~rev7 §4.9, §6 and the banner: "048 must be applied … **before the app change deploys**"~~ | **Merge is the deploy** (printed: `035-lockstep-runbook.md:162-164`, `2026-q3-week-4-migrations.md:519-523`; no deploy step in `ci.yml`/`vercel.json`). Order: 048 → test-db → CI green (pinned run URL, `headSha` = PR HEAD) → 048 → prod → **THEN merge**. DOWN: **revert commit (merged) first, then the DOWN.** | §4.9, §6 |
| 3 | ~~rev6/rev7: "reactivating from the dashboard" deferred; "no reactivation path is designed" (UNKNOWNS #24); D10 "one slot; no history"~~ | **Reactivate ships in this slice** (Aravind): third SECURITY DEFINER function. Because neither "clear" nor "keep the first record" preserves "past dates unchanged", the migration gains **`reactivated_by`/`reactivated_at` (five columns become seven)** and the board rule becomes an interval. Departure from settled D10 flagged as **D15**. | §2.10, §4.9, §6 |
| 4 | ~~rev7 R5: any same-project engineer classifies `already_on_this_project`~~ | A **deactivated** same-project engineer gets its own outcome `deactivated_on_this_project` (`{idx, status, user_id}`, same tenant and project only) and the flow offers reactivation. Cross-tenant stays generic. | §2.1, §2.10, §4 |
| 9 | ~~rev7 §9 / UNKNOWNS #11 framing of `DEACTIVATE_CONFIRM`~~ | The plan never stated irreversibility (grep: none). Because reactivate ships, `DEACTIVATE_CONFIRM` needs **no irreversibility fact** — recorded for whoever writes the wording. | §9 |
| 10 | ~~rev7 T16 "all three functions"; §8 "The three functions bypass RLS"; §6 "(1)–(6)"~~ | Four functions (helper + `add` + `deactivate` + `reactivate`). | §6, §7, §8 |

## Dated corrections, 19 Sep 2026 (rev7) — kept (`git show f407ba1:docs/plans/add-engineer-plan.md`)

| # | Earlier text (retracted) | rev7 result | Where |
|---|---|---|---|
| 3 | ~~rev6 §2.9 F1 "RECORDED, NOT FIXED, ACCEPTED LIMIT", its "Exposure" sentence and its "Why not fixed" paragraph; Scope "F1 deferred"~~ | **F1 is CLOSED, not accepted.** Step 5 exists only when the morning answer was NO; a NO writes no `daily_logs` row (`033:61-65`), so the `ON CONFLICT DO UPDATE` has no recorded attendance to overwrite; steps 2–4 never touch attendance and a sweep test asserts it is preserved. Only the **unproven** remainder is in UNKNOWNS #5. | §2.9, UNKNOWNS |

## Dated corrections, 19 Sep 2026 (rev6) — kept

| # | Earlier text (retracted) | rev6 result | Where |
|---|---|---|---|
| 6 | ~~rev5 §2.9 "the membership keeps the partial-index slot"~~ | Struck: there is no index. The membership row simply stays. | §2.9 |
| 9 | ~~rev5 §2.9 F1 (step 5 described as "an INSERT … or overwrite")~~ | Extended (Part C): what the overwrite means for an already-recorded attendance, from the printed writers. | §2.9 |

## Dated corrections, 19 Sep 2026 (rev5) — kept

| # | Earlier text (retracted) | rev5 result |
|---|---|---|
| 4 | ~~rev4 §2.9 F1 "yields a `daily_logs` write attributed to a deactivated engineer"~~ | Precise blast radius; accepted limit; `ON CONFLICT DO UPDATE` nuance. |

## Dated corrections, 19 Sep 2026 (rev4) — kept

| # | Earlier text (retracted) | rev4 result |
|---|---|---|
| 1 | ~~rev3 heading "Dated corrections, 18 Sep 2026 (rev3)"~~ | Wrong date: rev3's log starts `Sat Sep 19 00:01:34 IST 2026`, commit `2026-09-19 00:15:46 +0530`; 18 Sep only in UTC. |
| 3–5 | ~~rev3 D8/D9/D10 "open"; "the action refuses if attestation absent"; three-parameter signature~~ | CHECK settled (RLS insert policy places no restriction on the inserted row's `role`); D9 record-not-enforce (`consent_attested`, fourth parameter); D10 `deactivated_by/at`. |
| 6 | ~~rev3 T12 "the repo already uses `it.fails`"~~ | **Wrong**: no executable `it.fails` in `test/`; behaviour **verified by running it** on vitest 3.2.7 (re-run in the rev6 log). |
| 7–14 | session cleanup untraced; `pg_temp`; §7.3 "assumed no cron"; R7 split; matrix rows fixture-only; CHECK optional; digit strings; new items | Traced (F1–F3); `search_path=public` only; shown/not-shown breakdown; `registered_no_project`; rows 3–8 fixture-only; CHECK definite; residual-risk statement (§4.6). |

## Dated corrections, ~~18 Sep 2026~~ **19 Sep 2026** (rev3) and 18 Sep 2026 (rev2) — kept (dates verified)

| # | Earlier text (retracted) | Result |
|---|---|---|
| rev3 1 | ~~rev2 §9 "`// Tamil owed, NOT approved`" citing `lib/photos/copy.ts:13-20`~~ | Mis-citation: that comment marks *approved English awaiting Tamil* (`copy.ts:3-6`); unapproved wording uses `// Wording owed, NOT approved`. |

## 0. Findings that shape the plan — read first

3. **`users.status` is `NOT NULL DEFAULT 'active'`** (probe d; `012_…sql:45-46`); the gate is `route.ts:159` → `reactivation.ts:29-33`.
4. **`authenticated` cannot write `users`**: no INSERT (probe k, `015:114`), UPDATE only on `full_name, avatar_url` (`015:105`), only UPDATE policy is own-row (probe j). Add and deactivate both need definer functions; no service client (g4).
6. **Migration number 048** is free (`origin/main` migrations end at 047; reservations end at 048, "RELEASED, NEVER USED … 048 is free").
7. **Deactivation propagates through `users.status`** (§2.9); findings F1–F4.

## 1. Authorisation — lives in slice 1

The D6 role/authority gate (§1 of slice 1) and the internal helper (§2.7 of slice 1) are reused **unchanged** by `deactivate_engineer` and `reactivate_engineer`; they are not restated here. See slice 1 §1 and §2.7.

## 2. The lifecycle functions

### 2.1 (payload row for the classifier outcome — the rest of §2.1 is in slice 1)

| status | fields | note |
|---|---|---|
| `deactivated_on_this_project` | `idx, status, user_id` | **same tenant AND same project only** (§2.10); the `user_id` is what the reactivate control calls |

### 2.9 Deactivate — the SECOND SECURITY DEFINER function (`deactivate_engineer`)
**Contract.** `(p_project_id uuid, p_user_id uuid) → jsonb` `{ status: 'deactivated' | 'already_deactivated' }`. Same helper, gate, tenant binding and grants. Target: `users u JOIN project_members pm` with `u.id = p_user_id`, `u.role='engineer'`, `u.tenant_id` = derived tenant, `pm.project_id = p_project_id`, `pm.role='engineer'`; **not found → `no_data_found`**. In **one transaction** (the target `users` row locked `FOR UPDATE`): `UPDATE users SET status = 'deactivated'` **and close the engineer's open episode on this project** (`closed_at = now()`, `closed_by` = the caller, `closed_via = 'deactivated'`; a legacy engineer with no episode first gets one materialised from `project_members.created_at`, §2.8) — ~~rev8: one UPDATE writing `deactivated_by`/`deactivated_at`~~;
already deactivated → no write, no overwrite. `'deactivated'` is permitted by `users_status_check` (probe h). **Does NOT:** delete; touch `whatsapp_number`, `messaging_blocked`, `project_members`, or `whatsapp_sessions`; send; reactivate (§2.10 is its own function); use dynamic SQL.
**KNOWN LIMIT — the number stays held** (`UNIQUE (whatsapp_number)`, `001:44`, probe h). ~~and the membership keeps the partial-index slot~~ (rev6 #6: no index). **A mistyped number cannot be corrected from the dashboard; the only repair is manual SQL.**
**Deactivation takes effect with no further change — printed source.** Webhook: `decideInboundGate` returns `gated_noop` for `status !== 'active'` (`reactivation.ts:29-33`), header forbids silent reactivation (`:11-14`), clear-half re-asserts `status='active'` (`:64`); `route.ts:159`, `twimlEmpty()` at `:161-163`. Outbound: `fetchActiveEngineers` filters `.eq('users.status','active')` (`roster.ts:168`), used by both exported rosters (`:203`, `:248`). Also filtering: `checkin-escalations/roster.ts:65`, `dpr-generate/route.ts:80`, `accountability.ts:159`, `dpr/dispatch.ts:417-418`. Why `status`, not `messaging_blocked`: the flag would make the gate return `reactivate` (`:36-38`).

### Session trace and PM-visible findings — named, not fixed (except D13 pending)
- **Inbound from a deactivated engineer:** `route.ts:159-163` returns `twimlEmpty()` before idempotency, project resolution and any session call.
- **F1 — the morning sweep never reads `users` — CLOSED (rev7), ~~RECORDED, NOT FIXED, ACCEPTED LIMIT~~.**
  **Why it is closed, in four sentences.** Step 5 exists **only when the morning answer was NO**; the file header says a NO "advances straight to step 5 with no write" (`033:61-65`), so **no `daily_logs` attendance row exists** for the `ON CONFLICT … DO UPDATE` to overwrite; steps 2–4 **never touch attendance** (`033:235-245`) and `test/unit/morning-cutoff-sweep.test.ts:209-224` asserts a step-2 attendance "already present is preserved untouched"; and the only two writers of attendance are `apply_morning_flow_turn` and this sweep (grep `a1`). So the sweep cannot destroy a recorded attendance by any path I printed. **What is NOT closed is one unproven premise, held in UNKNOWNS #5 only:** whether any path can put a *recorded* attendance beside a step-5 session — and that, if one existed, the loss would be silent (the sweep writes no audit row). A closed risk is not filed as an open one; an unproven premise is not filed as closed. The sweep's ordinary output — one `'absent'`, defaulted row for a session already parked at step 5 — is unchanged by deactivation and, on the deactivation day, is **visible** under §4.9 (a log exists, so the card is kept), not hidden.
  *The detail below is the trace that closes it; its earlier labels are kept struck.* Verified from `033`: the sweep loops `SELECT * FROM whatsapp_sessions WHERE current_flow = 'morning'` (`033:198-200`); the printed body reads only `whatsapp_sessions`, `project_members`, `daily_logs` — grep `u1`: zero non-comment lines mention `users`; `u2`: the only targets.
  **Blast radius, precisely.** (1) It acts **only on an existing session**; a deactivated engineer gets **no new morning trigger** (`roster.ts:168`). (2) Only an engineer with **exactly one** membership is processed (`033:220-233`). (3) Steps 2–4 only **UPDATE `morning_submitted_at` on a row that already exists** (`033:235-245`). (4) **Only step 5 writes attendance** (`033:265-283`). (5) The session then closes (`033:306-316`), so it cannot repeat.
  **The nuance rev4 missed — step 5 can OVERWRITE.** It is `INSERT … ON CONFLICT (project_id, engineer_id, log_date) DO UPDATE SET attendance = EXCLUDED.attendance, attendance_defaulted = …, attendance_raw = …, is_holiday = …, morning_submitted_at = …` (`033:273-282`). So if a row already exists for that `(project, engineer, day)`, its attendance fields are **replaced** by `'absent'`, `attendance_defaulted = true`, `attendance_raw = NULL`, `is_holiday = false`, and the submission time.
  **What that means for a real engineer's already-recorded attendance on the day of deactivation** (from the printed writers): attendance is written only by `apply_morning_flow_turn` (`030:550-557,565-570`, redefined `035:226-495`, upserts at `035:383-395`) and by this sweep — grep `a1`: no `app`/`lib` code writes it and the evening RPC has no attendance write. (a) An engineer who **answered YES** has `'present'` recorded and a session at steps 2–4 or complete: steps 2–4 **never touch attendance** (`033:235-245`; the sweep test `:209-224` asserts "already present is preserved untouched"), so **their recorded attendance is preserved.** (b) Step 5 means the morning answer was **NO**, and the header says a NO "advances straight to step 5 with no write" (`033:61-65`), so **no attendance row exists to lose** — the sweep creates one. (c) The only route to overwriting a *real recorded value* is a row **and** a step-5 session on the same log day; the header names one route (evening wrote the row first, `033:65-67`), but the evening RPC writes no attendance, so that row would hold NULL attendance. I found **no path** that puts a recorded `'present'`/`'site_holiday'` beside a step-5 session and did **not prove none exists** (UNKNOWNS #5).
  **If it did happen, the loss would be silent:** the sweep writes no audit row (targets in `u2` exclude `daily_log_edits`, which only the PM-correction RPC writes, `019`). ~~**Exposure: one phantom log — or, in the unproven case, one overwritten attendance — on one day, for an engineer deactivated while parked at step 5.**~~ ~~**Why not fixed:** … a full package and rehearsal — out of proportion to that exposure. **Accepted limit.**~~ — struck (rev7 #3): nothing is being accepted, because on the printed evidence nothing is at risk; no fix to `033` is proposed or needed.
- **F2 — evening and hindrance sessions are parked indefinitely.** The sweep covers `'morning'` only (`033:199`); `expires_at` is read by nothing (grep s3; `033:32-34` calls it dead); nothing deletes session rows (grep s4); the only reset is BOT-07's next-day wipe inside `acquire_and_transition_session` (`012:115-121`), reachable only by an inbound past the gate or a cron send — neither can happen for a deactivated engineer.
- **F3 — the engineer with no membership.** Cannot be deactivated from the dashboard (the function needs an engineer-role membership; the list is membership-based, `projects/[id]/page.tsx:56-58`), so **the admin sees nothing to click**. If `active`, that engineer texts in and gets `ZERO_MEMBERSHIPS_REPLY` (`route.ts:244-247`, `project-resolution.ts:71-72`: ask your Project Manager to add you) — but the PM cannot add them (R7a) or deactivate them: a dead end until the reassign slice or manual SQL. Test-db holds **1,870** such engineers (probe z; fixtures); prod unread (§11 `w`).

### 2.10 Reactivate — the THIRD SECURITY DEFINER function (`reactivate_engineer`) — ships in this slice (Aravind, rev8; rewritten on episodes, rev9)
**Contract.** `(p_project_id uuid, p_user_id uuid) → jsonb` `{ status: 'reactivated' | 'already_active' | 'not_deactivated' }`. **Same family as `deactivate_engineer`:** the §2.7 helper (caller resolved by `users.auth_id = auth.uid()`, tenant bound NULL-safely with `IS DISTINCT FROM`), the D6 gate (`admin`, or `pm` with a `pm` membership on this project), `SET search_path = public`, grants `REVOKE EXECUTE … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`. Target: `users u JOIN project_members pm` with `u.id = p_user_id`, `u.role = 'engineer'`, `u.tenant_id` = the tenant derived from the project, `pm.project_id = p_project_id`, `pm.role = 'engineer'`; **not found → `no_data_found`**, indistinguishable from a foreign id. The target `users` row is locked `FOR UPDATE`. `status = 'active'` → `already_active`, no write. `status = 'pending'` → `not_deactivated`, no write (activating a pending user is ENG-01's job). `status = 'deactivated'` → **one transaction, two writes: `UPDATE users SET status = 'active'` and `INSERT` an episode** (`opened_by` = the resolved caller's `users.id`, `opened_via = 'reactivated'`, `opened_at = now()`; §2.8). A legacy-deactivated engineer with no episode first gets the closed `'backfill'` episode of §2.8.
**Does NOT:** delete; touch `whatsapp_number`, `messaging_blocked`, `project_members`, `whatsapp_sessions`, `consent_attested`, any earlier episode; send a message; use dynamic SQL. **It does not clear `messaging_blocked`:** an engineer who was blocked *and* deactivated comes back still blocked, and the gate returns `reactivate` (`reactivation.ts:36-37`), so they must text START themselves — BOT-27's principle (the flag is the engineer's opt-out, "NOT PM-clearable", `status.ts:103-110`) is not weakened by an admin action. **Naming collision, noted:** "reactivation" in `lib/whatsapp/reactivation.ts` is BOT-27's clearing of `messaging_blocked` for an *active* engineer (`:3-14`, `:29-40`); this function is the admin's un-deactivation, and its header states why it must be explicit: "a deactivated engineer must NEVER be silently reactivated by texting in" (`:13-14`).
**~~rev8: what happens to `deactivated_by`/`deactivated_at`~~ — superseded (rev9, §2.8).** rev8 showed that neither "clear" nor "keep the first record" preserves "past dates stay unchanged" and proposed `reactivated_by/at`. **Aravind chose episodes:** a reactivation **opens a new episode and touches no earlier one**, so every earlier interval — the gap included — stays exactly as recorded. rev8's stated limit ("one episode only; a second cycle overwrites the first") **no longer exists** and is struck.
**Reactivation day — the mirror of Edge 1, named and not built.** The rule is day-granular: the day an episode opens is an expected day. An engineer reactivated at 14:00 was not sent the 08:30 morning message (`roster.ts:168` excluded them), so a morning half with no submission would read amber after the cutoff for a check-in never sent. The exact fix is Edge 1's branch keyed on `istParts(opened_at).minutes` against `CHECKIN_CHECKPOINTS.morningSend`/`eveningSend` (`cutoffs.ts:49,62`) — the leave-side twin of `dispatch.ts:427`. **Not specified as required; D15 (ii)** for Aravind.
**The classifier offers it instead of a dead end (Edge 2).** A deactivated engineer **keeps their `engineer` membership** (§2.9), so re-pasting their number would classify `already_on_this_project` (R5) — the opposite of what the admin needs. **New outcome `deactivated_on_this_project`**, produced in step 5 only for a number that resolves, **inside the caller's tenant**, to a `users` row **with a membership on this project** whose `status = 'deactivated'`. Payload `{ idx, status, user_id }` — safe here (same tenant, same project; the caller can already see both through RLS, probe j) and what the flow passes to `reactivate_engineer`. An **active** same-project engineer stays R5 (`{idx, status}`); a same-tenant deactivated engineer on **another** project stays `on_another_project`; one with **no** membership stays `registered_no_project` (reassignment stays deferred); **cross-tenant stays the generic `number_registered`, exactly `{idx, status}`** — status is read only after the tenant/project scope has matched, so another tenant's user status is never observable (T5's payload rule unchanged). Preview shows the row as its own state (`DEACTIVATED_ON_THIS_PROJECT`) with a `REACTIVATE_CONTROL` calling `reactivate_engineer` (confirm → `REACTIVATE_CONFIRM`; result → `REACTIVATE_RESULT`; failure → `REACTIVATE_ERROR_NOT_FOUND`); an apply aborts while that row stands (any non-`ok` row, §2.3 step 6), so the admin reactivates, re-previews, sees R5 and removes the line.
**Deactivation takes effect with no further change, so reactivation needs none either** — `fetchActiveEngineers` filters `.eq('users.status','active')` (`roster.ts:168`) and `decideInboundGate` returns `proceed` for `status = 'active'` and `messaging_blocked = false` (`reactivation.ts:29-40`); both flip back on the one `status` UPDATE (T32).

### 2.11 Unreachability report — IN SLICE, a report and never a gate (Aravind, rev8; predicate revised, rev9)
**Why.** §4.6: the validator catches malformed numbers, not wrong ones, and a one-digit typo is a **live stranger's handset that receives the production templates and never replies**. Nothing today would notice. **What it is:** a **derived read** — no new table beyond §2.8. **What it is not:** it **never blocks, delays or alters an add** — it runs from a separate scheduled route after the fact, shares no code path with `add_engineers_to_project`, and a failure inside it is caught and reported, never raised into anything else (T37).
**The predicate** (per engineer): `users.role = 'engineer'` **and** `status = 'active'` **and** `registered_at IS NOT NULL` **and** `registered_at <= now() − N days` **and** at least one `outbound_sends` row with `recipient_user_id` = the engineer **and** `to_phone_number` = their current `whatsapp_number` (any `status`; the latest one's `status` and `error` are carried as context) **and** ~~rev8: no `daily_logs` row with a submitted timestamp~~ **rev9: NO `whatsapp_sessions` row whose `phone_number` equals `users.whatsapp_number`.** Legacy engineers have `registered_at` NULL and are out of scope by construction.
**Schema it reads (printed, log):** `outbound_sends` (`031:436-499`) — `id, created_at, updated_at, tenant_id, project_id, recipient_user_id, event_key, status ('sending'|'sent'|'failed'), content_sid, to_phone_number, twilio_sid, error`; **grants `service_role` only — `SELECT, INSERT, UPDATE` (`031:557-558`)**, so the report runs server-side on the service client and is **not** a PM-facing screen.
**"This number has never sent us anything" — every per-inbound record, examined (rev9).**
| Source | Per number? | Verdict |
|---|---|---|
| `processed_messages` (`011:8-13`) | **No** — `message_sid` and timestamps only; prunable (`011:19-22`); an unregistered or gated number leaves "ZERO storage footprint" (`route.ts:114-115`) | unusable |
| **`whatsapp_sessions`** (`001:86-97`) | **Yes** — `phone_number`, `user_id`, `updated_at`; one row per phone (both sides unique, `reachability.ts:26-38`) | **best available** |
| `daily_logs`, `daily_log_photos` (`ingest.ts:135`), `hindrance_photos` (`hindrance-ingest.ts:127`), hindrances | per engineer, but **downstream of a session** | strictly narrower |
| `outbound_sends` delivered / read | **not recorded** — `lib/whatsapp/outbound/status-callback.ts` header: delivered/read are a NO-OP; only `failed` is written (status-callback `route.ts:115-116`) | no live-handset signal |
| `users.messaging_blocked` | **no non-test code ever sets it `true`** (grep, log) | no opt-out signal |
**Why `whatsapp_sessions` is the truer signal.** A row appears only through the flow RPCs (`INSERT INTO whatsapp_sessions` at `012:99`, `014:70`, `022:131,384`, `024:324`, `025:202`, `030:362`, `035:259,535`, `038:251,443,769`), and those are called only from the webhook path — `applyMorningFlowTurn` (`webhook/route.ts:7,300`), `routeInboundMessage` (`:8,324`) and the flow modules it calls; **the send path never touches the table** (grep: zero hits for `whatsapp_sessions`, `acquireAndTransition` or the flow RPCs under `lib/whatsapp/outbound/` and `app/api/cron/`); nothing deletes rows (grep s4). So a row means **an inbound from that number reached the flow layer at least once** — and a **hindrance-only replier is no longer a false positive** (the hindrance RPC inserts a session, `038:251`), which was the rev8 defect.
**Residual classes, recorded explicitly — this is the best signal available, not a perfect one.**
- **FP-1 (still flagged though they did write):** an inbound that received only the static "no active session" acknowledgement (`design-decisions/check-in-architecture-and-triggers.md` §38) may leave no session row; whether a bare first message creates one depends on the flag-gated branch at `webhook/route.ts:290-300`, which I did not resolve (UNKNOWNS #29).
- **FN-1 (not flagged though wrong):** a **stranger at a mistyped number who replies at all** — even "wrong number" — creates a session and hides the typo. The report catches **silent** strangers, the common case, not all.
- **FN-2 (fragility):** the predicate is true only while **the send path never writes sessions**. `SessionCaller` already reserves `'scheduled_trigger'` (`session.ts:10`) for a cron-started flow, with **zero call sites today** (grep). The day a trigger calls `acquireAndTransition`, "a session exists" would mean "we sent", and the report would silently stop reporting. **T37 (iv) is a source guard** on exactly today's grep.
**Follows the existing Sentry dedup shape** (`roster.ts:132-148`, "same convention as `reportMorningSweepAnomalies`"): `Sentry.captureMessage(<developer-facing title in the `'<feature>: <what happened>'` shape the two existing reporters use — written in the build slice, not drafted here>, { level: 'warning', fingerprint: ['engineer-registration', 'no-inbound-since-registration', <engineerId>, <IST date>], tags: { feature: 'engineer-registration', reason: 'no_inbound_since_registration' }, extra: { engineer_id, project_id, registered_at, sends: <count>, last_send_status, last_send_error, log_date } })` — one growing issue per engineer per day. **No phone number in the payload.**
**Where it runs:** a new daily route (`app/api/cron/engineer-reachability-report/route.ts`, ASSUMED name) behind `CRON_SECRET`, with one new `vercel.json` cron entry — **merging it is a deploy** (`vercel.json:1-24`). **ASSUMED time:** 05:00 UTC (10:30 IST), after the 08:30 IST send and its retries; not inside `jobs/tick` (every minute) nor the morning-trigger route (critical send path).
**N — the threshold — is a DECISION FOR ARAVIND. Recommend N = 3 days.** Two sends a day (`vercel.json:12-19`) means ≥ 6 unanswered sends by day 3; a weekend or a one-day closure does not trip it. N is one named constant (`lib/engineers/unreachable-report.ts`, ASSUMED). The join is by value on two unique indexes (`reachability.ts:26-38`); no index proposed, none measured (UNKNOWNS #30). **Tests** T36–T38 (§4.9).

## 4. Rejection cases — row R5b only (the rest of §4 is in slice 1)

| # | Reason | Detected by | Preview? | Apply? | Shown by |
|---|---|---|---|---|---|
| R5b | **Deactivated** engineer already on **this** project (rev8) | `deactivated_on_this_project` + `user_id` | yes | yes | `DEACTIVATED_ON_THIS_PROJECT`; the flow offers `REACTIVATE_CONTROL` (§2.10) — not a dead end |

### 4.9 (the lifecycle tests, split out of the single §4.9 — the board rule, its cost, Edge 1 and the other tests are in the episodes plan §4.9)

**Conventions** (identical to the episodes plan §4.9): each row states how it is shown to FAIL first; integration tests run on the real test-db and need the migration applied there; fixture numbers are `+1…`-shaped or NULL — **no `+91` value is minted** (T21 of slice 1 stays true); **episodes are only ever written by the definer functions**, so integration tests create them by calling the functions, at real `now()`.
| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T31** | **`reactivate_engineer` gate and tenant.** Tenant-A admin cannot reactivate a tenant-B user: `no_data_found`; read-back shows B's user **unchanged and no episode opened**. `pm` without a membership, and `qs`/NULL role with a `pm` membership → `insufficient_privilege`. The shared T6 matrix runs against it too. | Drop the tenant binding → B's user is reactivated → fails. Skip the role gate → the `qs` row reactivates → fails. |
| **T32** | **A reactivated engineer is live again.** Positive control: deactivated → **absent** from the outbound roster (`roster.ts:195-205`, `:168`) and `decideInboundGate` = `gated_noop`. After reactivate: **present**, `proceed`. A `messaging_blocked` + deactivated engineer → after reactivate the gate is **`reactivate`, not `proceed`**. | Function absent → still excluded. Mutation: also clear `messaging_blocked` → `proceed` → fails. Mutation: `status = 'pending'` → `gated_noop` → fails. |
| **T34** | **Episode lifecycle and I1.** Add → **one open** episode (`opened_via 'added'`, `opened_by` = caller's `users.id`, `opened_at` = `users.registered_at`). Deactivate → that episode closed (`closed_by`, `closed_via 'deactivated'`), `status 'deactivated'`, none open. Deactivate again → `already_deactivated`, no writes. Reactivate → a new open episode `'reactivated'`, the old one **untouched**. Reactivate again → `already_active`, still **exactly one** open. Legacy: first deactivate materialises a `'backfill'` episode from `project_members.created_at`. **I1 asserted after every step.** | Mutations: skip the close; skip the open; write `users` only; overwrite the old episode → each fails. |
| **T35** | **The classifier offers reactivation.** A same-tenant, same-project **deactivated** engineer's number, dry-run → `deactivated_on_this_project` with `user_id` = that engineer's id and **not** `already_on_this_project`; an **active** one → still `already_on_this_project`; a **cross-tenant** deactivated engineer → generic `number_registered`, **exactly `{idx, status}`**, no `user_id`; deactivated on **another** project → `on_another_project`. | Natural red: today's classifier returns R5 for the deactivated one. Mutation: read `status` before the tenant/project scope → cross-tenant `user_id` leaks → fails. |
| **T42** | **Concurrent reactivates / deactivates serialise** — exactly one wins; the index is the backstop. | **NOT VERIFIED LOCALLY, CI-ONLY** (`CLAUDE.md` §0). |
| **T36** | **Unreachability classifier** (pure), N = 3: flagged — `registered_at` N days ago, ≥1 send to the current number, **no session row**; **not** flagged — N−1 days; a **session row exists** (including a hindrance-only replier); **zero sends**; `deactivated`; `registered_at` NULL. | One mutation per row: `>` for `>=`; drop the session clause; drop the send clause; drop the status clause; count `daily_logs` instead of sessions (the rev8 defect — the hindrance-only row fails). |
| **T37** | **Never a gate, and the fragility guard.** (i) no file under `app/(dashboard)/projects/[id]/engineers/` or `lib/engineers/{add-engineers,deactivate,reactivate}.ts` imports the report; (ii) the route catches a thrown read, reports to Sentry, returns without raising; (iii) the fingerprint is exactly `['engineer-registration','no-inbound-since-registration', engineerId, istDate]` and `extra` has **no phone number**; **(iv) source guard: no file under `lib/whatsapp/outbound/` or `app/api/cron/` references `whatsapp_sessions`, `acquireAndTransition` or a flow RPC** (FN-2). | Import the report from the add path → (i) fails; remove the try/catch → (ii); add `to_phone_number` to `extra` → (iii); make a trigger call `acquireAndTransition` → (iv). |
| **T38** | **Integration on test-db** (`+1…` numbers, no real send): E1 registered N+1 days ago with a ledger row and no session → flagged; E2 the same with a `whatsapp_sessions` row → not; E3 registered N−1 days ago → not. `registered_at` set by the service role; `outbound_sends` rows inserted directly (`service_role` holds `INSERT`, `031:558`). | Natural red: module absent. |

## 6. The migration

*(Lifecycle plan part — the migration is ONE file shared with the episodes plan, ASSUMED.)*
- **Migration number (consequence of the split):** slice 1 carries `048`; slice 2's number is whichever is free when it is drafted (**ASSUMED `049`**), reserved then in `scripts/migration-number-reservations.json` (`CLAUDE.md` §0). It is held in `docs/reviews/` until applied and **applies after slice 1's**.
- **What the lifecycle plan's part of slice 2's migration contains (from the single-plan list at `eb8a9c2`, items (5), (5b), (6)):** (5) `deactivate_engineer`, (5b) `reactivate_engineer` (§2.10), (6) their ACLs (§2.7 of slice 1) — **plus the classifier outcome: a redefinition of the classification step of slice 1's `add_engineers_to_project` (review gate (a), stated up front at the top of this document).** **The reviewer signed off on the five-column design; the episode writes in (5)/(5b) are new since then and need the full package.**
- **Review gate (`CLAUDE.md:192-205`) clearly tripped** (a, b, c; a `DROP COLUMN` in the DOWN is destructive (d)). Required evidence: anon-key call refused `42501` (`CLAUDE.md:934-942`); `service_role` denial on the **real** database; ACL / `proowner` / `proconfig` for **all four** functions (helper + `add` + `deactivate` + `reactivate`); disposable local dry-run first (`CLAUDE.md:1020-1030`); rehearsal on the cleaned test-db (`CLAUDE.md:74-78`).
- **Deploy order (rev8, §4.9): MERGE is the deploy.** 048 → **test-db** → CI green (pinned run URL, `headSha` = PR HEAD) → 048 → **prod** → **THEN merge**; rollback = **revert commit (merged) first, then the DOWN**. ~~rev7: "048 lands on test-db and prod BEFORE the app change deploys"~~ — the event is the merge, not a deploy step this repo can show.
- **After apply:** regenerate `types/database.ts` (`CLAUDE.md:853-858`); one file at a time via `supabase db query --linked -f`, foreground, never `db push` (`CLAUDE.md:156-160`); confirm the file is on `origin/main` and test-db carries it (`CLAUDE.md:142-146`).

## 7. Positive controls (lifecycle plan rows)
"Shown to fail" = a captured red run, then the fix, then green. Red variants of the function run on the **disposable local scaffold** (`CLAUDE.md:1020-1030`), never on test-db or prod.

### 7.1 Tests (lifecycle rows; the rest of the lifecycle tests are in §4.9)

| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T11** | **Deactivate.** (i) Tenant-A admin cannot deactivate a tenant-B user (`no_data_found`), zero writes. (ii) `pm` without membership, and `qs`/NULL role with a membership: `insufficient_privilege`. (iii) Positive control: the engineer **is** in `fetchMorningRoster`, gate `proceed`; after deactivation **excluded** (`roster.ts:150,203`) and `gated_noop` (`reactivation.ts:29-33`); number and membership untouched. (iv) ~~`deactivated_by`/`deactivated_at` set~~ the engineer's open episode is **closed** (`closed_by` = caller, `closed_via = 'deactivated'`); a **second call returns `already_deactivated` and writes nothing** (full lifecycle: T34). | (i) drop tenant binding → fails; (iii) function absent → fails; set `messaging_blocked` instead → gate returns `reactivate` → fails; (iv) always-write mutation → `closed_at` moves → fails; close without updating `users` (or the reverse) → I1 fails. |
| **T12** | **Copy is filled.** Every export of `lib/engineers/copy.ts` is non-empty. | **Expected-fail at commit** (`it.fails`): blank → assertion fails → test passes; when the copy PR fills them the wrapper goes red. **Verified** on vitest 3.2.7 (scratch dir, re-run in this log): blank → PASS, filled → FAIL, control PASS. No live `it.fails` exists in `test/` (grep f2). |
| **T16** | **ACL evidence** on the real test-db for **all four** functions (rev8: ~~three~~ — + `reactivate_engineer`): anon → `42501`; `service_role` denied; `authenticated` may call the three public functions and **not** the helper; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` = `search_path=public`. | Before the REVOKEs, `service_role`/PUBLIC hold EXECUTE (probe n, `correct_daily_log`). |

## 8. RLS (lifecycle plan)

Live (probes j, k, o): `users` — `users_select` (own or same tenant), `users_update` (own row; column grant `full_name, avatar_url`, `015:105`); no INSERT/DELETE policy, `authenticated` lacks both (`015:114`). `project_members` — select tenant-scoped; insert/update require tenant match AND `users.role IN ('pm','admin')` **with no condition on the inserted row's `role`** (§4.5); no DELETE policy (`047:230`). Both tables owned by `postgres`, RLS on, **not forced**. **The four functions (helper + three public) bypass RLS**; the gate is re-stated inside (§1). Still enforced regardless of RLS: composite FKs (`017:94-106`), `UNIQUE (whatsapp_number)`, `UNIQUE (project_id, user_id)` (`001:79`), `users_role_check`, `users_status_check`, the new CHECK, the pairing CHECKs. Cross-tenant: tenant is never an input (§2.4).

## 9. Strings (lifecycle plan) — every value blank; Aravind writes all wording

**rev8 adds exactly five constants, all blank with `// Wording owed, NOT approved`, all required by §2.10:** `DEACTIVATED_ON_THIS_PROJECT` (the preview state for a deactivated same-project engineer), `REACTIVATE_CONTROL`, `REACTIVATE_CONFIRM`, `REACTIVATE_RESULT`, `REACTIVATE_ERROR_NOT_FOUND` (mirroring the `DEACTIVATE_*` set). **The unreachability report adds none** — its only text is a developer-facing Sentry title, not user copy. **`DEACTIVATE_CONFIRM` (rev8 note):** it no longer needs to state that deactivation is irreversible, because reactivate ships (§2.10); the plan never asserted irreversibility (grep: none), and what remains true for the wording author is that deactivation **does not free the number** (§2.9). Whether it must name the engineer is still UNKNOWNS #11.

**Formatter (lifecycle plan):** `formatDeactivatedLine(deactivatedByName, deactivatedAt)` (the other formatters are in slice 1 §9).
**Constants (blank, lifecycle plan):** `DEACTIVATE_CONTROL`, `DEACTIVATE_CONFIRM`, `DEACTIVATE_RESULT`, `DEACTIVATE_ERROR_NOT_FOUND`, **`DEACTIVATED_ON_THIS_PROJECT`, `REACTIVATE_CONTROL`, `REACTIVATE_CONFIRM`, `REACTIVATE_RESULT`, `REACTIVATE_ERROR_NOT_FOUND` (rev8)**. *(The add-screen and list-page constants are in slice 1 §9; `ENGINEER_STATUS_DEACTIVATED` is in the episodes plan.)* **T12** asserts every export is non-empty (expected-fail at commit).

## 10. Pre-flight result — lifecycle plan rows (test-db `exfccwlrhoutkgrlikod`; the `pg_*` probes are printed in `add-engineer-plan-rev7.txt`)

The log prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. All read-only.
| Probe | Result |
|---|---|
| (d) `users.status` | `text`, default `'active'::text`, NOT NULL |
| **pg_3** `users` role × status | 10 admin, 1,872 engineer, 3 NULL-role — **all `active`**; no `pending`, no `deactivated` |
| **pg_4** `users` CHECKs | `users_status_check` = `('pending','active','deactivated')`; `users_role_check` = the six roles; `users_notification_email_check` |

## 11. For Aravind — run against PROD (not run by me) — lifecycle plan queries

Read-only; confirm the project ref first. *(Queries `g`, `n`, `n2`, `r`, `u`, `v` are in slice 1; `w` is in slice 1 as well; the episode queries are in the episodes plan.)*
```sql
-- (w) engineers on prod with NO project membership (the F3 dead-end population)
SELECT count(*) AS orphan_engineers FROM users u
WHERE u.role = 'engineer' AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id);

-- (y) in-flight sessions belonging to deactivated users on prod (F1/F2 population)
SELECT s.current_flow, count(*) AS n FROM whatsapp_sessions s JOIN users u ON u.id = s.user_id
WHERE u.status = 'deactivated' GROUP BY 1 ORDER BY 1;
```

## 12. File list (lifecycle plan)

**Created (lifecycle plan):** `lib/engineers/deactivate.ts` (the other lifecycle files are named below).
**rev8 — created:** `supabase` side: `reactivate_engineer` in `048` (held in `docs/reviews/` until applied); `lib/engineers/reactivate.ts`; `lib/engineers/unreachable-report.ts` and `app/api/cron/engineer-reachability-report/route.ts` (names **ASSUMED**); `test/` files for T30–T39 (names **ASSUMED**). 
**rev8 — modified (lifecycle plan):** **`vercel.json`** (one cron entry — **merging it is a deploy**) `docs/reviews/048-review-package.md` is shared with slice 1 and the episodes plan.
**Not touched by this plan or the slice:** anything under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/auth/`, or any existing migration; **under `lib/daily-logs/`, only `query.ts` and `status.ts`** (D13); `is-project-pm.ts` and `normalise.ts` are imported, not edited. ~~**This revision's diff:** exactly `docs/plans/add-engineer-plan.md`.~~ (rev10: the split's diff is exactly `docs/plans/add-engineer-plan.md` and `docs/plans/engineer-lifecycle-plan.md`.)

## 13. Plan split — DONE (rev10), and slice 2 split again (rev11)

~~**REQUIRED BEFORE THE BUILD PACKAGE — split this plan (rev9)**~~ **Done in rev10** (slice 1 / slice 2) **and, in rev11, slice 2 was split again** into the lifecycle plan and the episodes plan, because `engineer-lifecycle-plan.md` was 593 bytes under the size warn threshold and its episodes design is unreviewed, so it would grow. **The seam:** the **lifecycle actions** (deactivate, reactivate, the classifier outcome, the unreachability report) against the **episodes record and everything reading from it** (the table, index and RLS, the D13 board rule, the half-status change, D18–D20, T43). **Why this seam:** the episodes record is the unreviewed, highest-risk part (a new table with grants, a changed board query, a backfill) and the part most likely to grow under review; the actions are four small functions and a report that need only the table's contract. Each can be read, reviewed and reported on its own, with the dependency stated both ways in its header. See the mapping table in the rev11 log.

## Decisions (lifecycle plan)

| | Status |
|---|---|
| **D17** (rev8) unreachability threshold **N** | **recommend N = 3 days**; **decision for Aravind** (§2.11). |

## UNKNOWNS (lifecycle plan)

**Not determinable from printed source or the test database:**
1. **Prod state.** Queries n/n2 (roles; CHECK violations); prod phone shapes (Aravind reports one row, `+91`, n=1 — not in this log, unverified by me); users by role; orphans (w); deactivated-user sessions (y); whether prod already has the new columns (u).
5. **F1's one unproven premise (F1 itself is CLOSED, §2.9):** whether any path can put a **recorded** attendance beside a step-5 session on the same log day. I found no path (writers grep `a1`; `033:61-67`) but did not prove none exists — and **if one existed, the loss would be silent** (the sweep writes no audit row). Nothing else about F1 is open.
9. **Apply-time owner.** That the apply role yields `postgres`, as all 15 existing functions.
11. **Whether `DEACTIVATE_CONFIRM` must name the engineer** (would become a formatter).
24. ~~**Reactivation** (rev8: one-episode limit; second cycle overwrites the first)~~ — **that limit is gone** (episodes, §2.8). **Open:** (a) whether reactivate should require a **fresh consent attestation** (D9 analogue) — none specified, only who/when is recorded on the episode; (b) the reactivation-day morning chip (D15 ii).
29. **The "has never sent us anything" predicate (§2.11).** Best available source: a `whatsapp_sessions` row for the number (inbound-only writers, printed). **Not established:** whether a bare first message creates a session — the flag-gated branch at `webhook/route.ts:290-300` was not resolved; so **FP-1** (static-ack-only inbound stays flagged) and **FN-1** (a replying stranger hides a typo) are recorded classes, and **FN-2** (fragile if a cron ever starts a session) is guarded by T37 (iv).
30. **The report's query cost** — no index proposed, none measured.
31. **N (D17)** is a recommendation, not data; no observed reply-latency distribution was consulted.
32. **`reactivate_engineer` and in-flight sessions.** A parked evening or hindrance session (F2) becomes processable again on the next inbound; BOT-07's next-day wipe (`012:115-121`) should reset a stale one — read, not run.
35. **Prod state, still unread:** query `(v2)`; whether any prod engineer would trip the report on day one (only those with `registered_at`, so none before 048).
37. **No database query was run in rev8 or rev9**; every database statement cites the rev7 probes. Nothing about `reactivate_engineer`, the classifier, the report or the episodes table was executed.
51. **Slice 2 changes a live function slice 1 shipped** (`add_engineers_to_project` opens an episode) — a logic change to a reviewed SECURITY DEFINER function; gate (a); its grants survive only if the signature is unchanged (`CLAUDE.md` §0). **rev11: stated up front, in this document's opening section, with the reason (the unavoidable cost of the split).**
54. **T35 was dropped by the rev9 rewrite and is restored here** (rev10 correction) — the only test found missing between `1765d21` and `eb8a9c2` besides those rev9 replaced by design (T24c, the rev8 forms of T33/T34).
55. **Whether the lifecycle and episodes plans ship as ONE migration** (ASSUMED, as in the single-plan list); splitting the migration too would be a separate decision with its own ordering (table first) and its own review package.
56. **Review and merge order between the two plans** — suggested: episodes first (the foundation), lifecycle second; not decided.
**Assumed:** migration number 048 still free and the file name; routes `projects/[id]/engineers[/new]`; TypeScript gate and SQL function stay in agreement (T6 tests, does not prove); `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege`; T15 un-testable here; no in-flight bot session depends on the new functions; colliding CI runs on the boundary literal are tolerable; the default `ON DELETE` on attribution FKs is right.
**Decisions still open:** ~~**D13** (product; not blocking)~~ — settled (rev7). **Flagged for confirmation:** **D17** (none blocking the plan; ~~D15~~ is settled). *(D16 is slice 1.)*
