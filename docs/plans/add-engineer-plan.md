# Add-engineer screen — build plan, SLICE 1 of 2 (rev11)

> **Split (rev10, 19 Sep 2026).** This document is **slice 1 of two**, split **by content only** from the single add-engineer plan at `eb8a9c2` after external review. **Nothing was redesigned, no open decision was resolved by the split (D18 and D19 are accepted and D20 is specified in slice 2 by Aravind's instruction, not by the split), and no finding, correction or UNKNOWN was dropped.** ~~Slice 2 is `docs/plans/engineer-lifecycle-plan.md`.~~ **Slice 2 is now two documents (rev11): `docs/plans/engineer-lifecycle-plan.md` (the lifecycle actions) and `docs/plans/engineer-episodes-plan.md` (the episodes record and everything reading from it).**
>
> **What this document contains.** The add screen (paste → preview → confirm → apply); the dry-run flag (D7); the `add_engineers_to_project` SECURITY DEFINER function and the **shared authorisation helper**; `users.registered_by`, `users.registered_at`, `users.consent_attested`; the six-role CHECK on `project_members.role`; the S1 lint extension; phone validation and normalisation (§3); the boundary-test literal (§7.3); the **read-only engineers list page (§5.1, D21)**; the strings those need (§9); the D12 decision and its rider; the residual-risk text; the **deploy-order rule with merge as the event, its rollback order and the Preview-database finding** (§6.1). Decisions here: D1–D9, D11, D12, D16, D21. Findings: N1, the S1 lint, the D12 rider. Tests: T1–T22 (T3, T4, T22 struck), T39 and T44.
>
> **What it explicitly does NOT contain.** Deactivate, reactivate, the `engineer_episodes` table and its index and RLS, the D13 dated board rule, the half-status / evening-chip change (Edge 1), the classifier's `deactivated_on_this_project` outcome (Edge 2), the unreachability report, and D10, D13–D15, D17–D20 and D22 with F1–F5 — **all of that is slice 2.**
>
> **Dependencies (rev11): NONE.** Slice 1 depends on nothing — not on deactivate, reactivate, the episodes table, the board rule, or anything in the two slice-2 documents. It stands alone and **ships first**. **The reverse is not true:** the lifecycle plan and the episodes plan both depend on slice 1 — on its `users` columns (`registered_by`, `registered_at`, `consent_attested`), the shared authorisation helper (§2.7), `add_engineers_to_project` (which they redefine — review gate (a), stated up front in the lifecycle plan), and the engineers list page (§5.1), which hosts slice 2's controls.
>
> ## Slice 1 ships with NO way to switch an engineer off (rev10)
> **In plain words: a mistyped number continues receiving check-ins from the production sender until slice 2 lands, or until it is fixed by manual SQL.** There is no deactivate, no undo, no removal and no way to free a number in this slice (`UNIQUE (whatsapp_number)`, `001:44`, holds it). The **confirm step** (§5) and the **attestation** (§2.8) remain: they **slow the mistake down and record who made it — they do not prevent it.** §4.6 (residual risk) and §3.6 say the same and stay as written. **Consequence for wording: no slice-1 string may imply that a removal or undo path exists, because none does** (§9).

**Reading rule.** Moved passages say "this slice", "the slice", "slice 2" and "the plan"; they are verbatim from the single plan at `eb8a9c2` (and, after the rev10 split, `2f1b098`). **"Slice 2" now means the lifecycle plan and the episodes plan together**; "this slice" means the document that holds the passage. Section numbers, decision numbers (D1–D22), finding labels (F1–F5, N1, the S1 lint), test numbers (T1–T45) and UNKNOWN numbers are **unchanged** — nothing is renumbered; the section index above says which document holds each.

**Evidence (rev11).** This pass added the items named in its correction block and re-split slice 2; it ran no command against the repo's code and no database query. Every cited fact still rests on the logs named in the banner below (`add-engineer-plan-rev9.txt`; the read-only test-db probes in `add-engineer-plan-rev7.txt`). The rev11 log (`add-engineer-plan-rev11.txt`) holds the item-by-item mapping.

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
> **Settled by Aravind, applied without re-raising:** D1 `status='active'` + attribution; D2/D5 SECURITY DEFINER function; D3 India-mobile only (TypeScript); D4 caps; D6 role-gate intersection;
> D7 dry-run flag; D8 CHECK on `project_members.role`; D9 consent attestation recorded, not enforced; D11 the CHECK mirrors `users_role_check`;
> D12 (rev6) Option D — the partial unique index leaves this slice; no test fixture is reshaped. *(D10 and D13 moved to slice 2.)*
>
> **rev8 review conditions that live here:** S1 lint (§4.10) · deploy order restated with **merge** as the event (§6.1) · D12 rider pinned and its reasoning corrected (§4.10) · N1 tagged (§4.10).

## Scope

**In scope (slice 1):** paste → preview (dry-run) → confirm → apply for adding site engineers to ONE project; attribution columns on `users` (`registered_by`, `registered_at`, `consent_attested`); the CHECK on `project_members.role`. ~~the partial unique index~~ — **removed from this slice (D12, rev6).** Also: the S1 lint extension (§4.10), phone validation and normalisation (§3), the boundary-test literal (§7.3), the strings these need (§9), and the deploy-order rule with merge as the event (§6.1).
**Deferred, named:** file upload/extraction; reassigning an existing number; **removing an engineer or freeing a number — slice 1 has no way to do either (see "Slice 1 ships with NO way to switch an engineer off"); deactivate is slice 2**; editing an engineer; duplicate-name detection; the ENG-01 opt-in flow;
rate limiting across calls; the `<>` tenant comparison at `019:230`; and **the one-project-per-engineer slice** (§4.8): the partial unique index, role-scoping of **both** unfiltered membership-count sites, and the fixture rework for the 7 affected test files — done once, together.


## Dated corrections, 19 Sep 2026 (rev11) — every change in this pass

| # | Earlier text (retracted / added) | rev11 result | Where |
|---|---|---|---|
| 1 | ~~UNKNOWNS #45 "whether slice 1 includes a read-only engineers list page (placement ASSUMED)"~~ | **SETTLED (Aravind): D21, §5.1.** Read-only, in slice 1; carries no actions because slice 1 has no deactivate; exists so an admin who pastes fifty names can confirm what landed; becomes the host for slice 2's controls. **No string on it may imply a removal, edit or undo path.** One new blank constant: `ENGINEERS_LIST_EMPTY`. Test T44. | §5.1, §9, §7.1, Decisions |
| 2 | ~~§12 "`projects/[id]/engineers/page.tsx` and `actions.ts`"~~ | Page only, read-only; no `actions.ts` in slice 1. | §12 |
| 3 | ~~header "Dependency. Slice 1 stands alone … Slice 2 depends on slice 1"~~ | **Dependencies: NONE**, restated; the reverse dependency (slice 2 on slice 1) is listed. | header |
| 4 | ~~header "Slice 2 is `engineer-lifecycle-plan.md`"~~ | Slice 2 is now two documents: lifecycle and episodes. Section index rebuilt for three documents. | header |
| 5 | ~~§2.8 "and the name `engineer_episodes` is unused …"; "who created, deactivated or reactivated an engineer"; the deactivated-then-reactivated / unreachability-report rationale for `registered_*`~~ | Struck: they assume slice 2. The `users` columns' justification stands without them. | §2.8 |
| 6 | ~~§6.1 sentences on the board reading `engineer_episodes`, the DOWN taking the boards down and destroying episode history, and the Preview "both boards' error state"~~ | Struck and replaced by slice 1's own dependency (the RPC and the three `users` columns). The struck text lives in the episodes plan §4.9. | §6.1 |
| 7 | ~~§4.10 N1 "the new `engineer_episodes` table does not (explicit grants, §2.8)"~~; ~~§11 (w) "the F3 dead-end population"~~; ~~UNKNOWNS #1 "(y) deactivated-user sessions"~~; ~~#37 "reactivate_engineer, the classifier, the report or the episodes table was executed"~~; ~~§4.5 "(F1)"~~; ~~#33 "(§4.9)"~~; ~~§13 "engineer-lifecycle-plan.md (slice 2)"~~ | Struck or re-pointed (to §6.1, the lifecycle plan, the episodes plan). **Slice 1 now contains nothing that depends on deactivate, reactivate or episodes;** what remains are pointers and dated history. | various |
| 8 | (added) UNKNOWNS #47 | How the list page shows a non-active row. | UNKNOWNS |

## Dated corrections, 19 Sep 2026 (rev10) — kept (`git show 2f1b098:docs/plans/add-engineer-plan.md`)

| # | Earlier text (retracted / added) | rev10 result | Where |
|---|---|---|---|
| 1 | ~~the single add-engineer plan at `eb8a9c2` (one document, ~170,000 characters)~~ | **Split into two by content:** this document (slice 1) and `docs/plans/engineer-lifecycle-plan.md` (slice 2). Nothing redesigned; no decision resolved by the split; no finding, correction or UNKNOWN dropped (mapping table in the rev10 log). Each document opens with what it contains, what it does not, and its dependency. | header |
| 2 | (added) | **Slice 1 ships with NO way to switch an engineer off** — a mistyped number keeps receiving check-ins from the production sender until slice 2 lands or manual SQL fixes it. The confirm step and the attestation slow and record; they do not prevent. **No slice-1 string may imply a removal or undo path** (§9). | header, §4.6, §9 |
| 3 | ~~§0 #4 "Add and deactivate both need definer functions"~~ | Add needs one (slice 1); deactivate and reactivate are slice 2. | §0 |
| 4 | ~~§2.7 "both public functions call it"~~ | The public function(s): slice 1 has `add_engineers_to_project` only. | §2.7 |
| 5 | ~~§4.6 "The confirm step, the attestation and deactivate (§2.9) are mitigations … deactivation does not free the number"~~ | Slice 1 has no deactivation; the residual-risk text otherwise stands unchanged. | §4.6 |
| 6 | ~~§4.8 heading "; D13 (F4) options"~~ | That paragraph moved to slice 2 §4.8; the heading points there. | §4.8 |
| 7 | ~~§6 review gate "all four functions"; §6 DOWN "the five columns" (stale since rev9); T16 "all four functions"; §8 "The four functions (helper + three public) bypass RLS"~~ | The helper and `add_engineers_to_project` (slice 1); DOWN drops **three** columns; slice 2 extends each. | §6, §7.1, §8 |
| 8 | ~~§12 "under `lib/daily-logs/`, only `query.ts` and `status.ts` (D13)" and "This revision's diff: exactly `add-engineer-plan.md`"~~ | Slice 1 touches nothing under `lib/daily-logs/`; the split's diff is both plan files. | §12 |
| 9 | ~~§13 "REQUIRED BEFORE THE BUILD PACKAGE — split this plan" (seven files, WARN left in place)~~; ~~UNKNOWN #44~~ | **Done as two documents** (Aravind decided the slice is too large to review or ship as one). §13 and #44 closed. | §13, UNKNOWNS |
| 10 | ~~§3.2 "no removal path in this slice (§2.9)"~~ | True of slice 1 as it stands; deactivate is slice 2 §2.9. | §3.2 |
| 11 | (added) §6.1 | The deploy-order rule with merge as the event is reproduced verbatim from §4.9 into §6.1 (slice 2 keeps its copy in §4.9). | §6.1 |
| 12 | (added) UNKNOWNS #45, #46 | Whether slice 1 has a read-only engineers list page (placement ASSUMED); how long a mistyped number persists depends on when slice 2 lands. | UNKNOWNS |

## Dated corrections, 19 Sep 2026 (rev9) — every change in this pass

| # | Earlier text (retracted) | rev9 result | Where |
|---|---|---|---|
| 1 | ~~rev8 D15 default: keep `deactivated_by/at` on `users`, add `reactivated_by/at` (five columns → seven), interval rule~~; ~~D10 "deactivated_by/at on `users`, one slot"~~ | **D15 settled by Aravind: an `engineer_episodes` table.** D10 is **reversed**: `deactivated_*` and `reactivated_*` are not created. **The attribution design changed after external review signed off on the five-column version**; the table re-enters the gate. Not both shapes. | §2.8, §6 |
| 5 | ~~rev8 UNKNOWN #33 "which database a Preview reads … a Preview built before 048 would error"~~ | **Not determinable from the repo** (evidence printed); consequence stated: production order unchanged, but a Preview visit is no evidence of 048 and step 5 must be verified on the production deployment; a possible prod service-role key in Preview is a security question. Dashboard checklist given. Kept in UNKNOWNS. | §4.9 |
| 7 | ~~rev8 §13-less: plan-size WARN noted only in a commit message~~ | **Split recorded as a required step before the build package** (§13): themes and files named; **not done here**; the WARN stays. | §13 |
| 8 | ~~rev8 N1 "widens the exposed surface by seven `users` columns"~~ | Three `users` columns, plus a **new table with its own explicit grants** (§2.8). | §4.10 |
| 10 | ~~rev8 `users` "not set" list including `deactivated_by, deactivated_at`~~ | Removed; §2.6 gains the episode row. | §2.6 |

## Dated corrections, 19 Sep 2026 (rev8) — kept (`git show 1765d21:docs/plans/add-engineer-plan.md`)

| # | Earlier text (retracted) | rev8 result | Where |
|---|---|---|---|
| 1 | ~~rev7 §4.9, §6 and the banner: "048 must be applied … **before the app change deploys**"~~ | **Merge is the deploy** (printed: `035-lockstep-runbook.md:162-164`, `2026-q3-week-4-migrations.md:519-523`; no deploy step in `ci.yml`/`vercel.json`). Order: 048 → test-db → CI green (pinned run URL, `headSha` = PR HEAD) → 048 → prod → **THEN merge**. DOWN: **revert commit (merged) first, then the DOWN.** | §4.9, §6 |
| 2 | ~~rev6/rev7 §4.7 item 4: "Every other D12 option reshapes fixtures to fit a constraint — the pattern that let the correction-gate bug hide behind `users.role='pm'` fixtures"~~ | **Wrong comparison.** The `pm` fixtures manufactured a FALSE shape; the 7 files construct a REAL state the code explicitly defends against, and are the only tests of that defence. Same conclusion (Option D), correct reason. | §4.10 |
| 7 | ~~rev7 §4.9: "(`anon` also holds table-level `SELECT` — pre-existing, RLS-bounded)"~~ | **Tagged a KNOWN GAP**, tracked only at `047-review-package.md:35,63` (D5) — not in `docs/build-status.md`'s backlog. This slice adds seven `users` columns to that exposed surface. | §4.10 |
| 8 | ~~rev7 §4.8: the future slice "named" with no tracked artefact~~ | **Pinned** (index, 7 files, two count sites, prerequisites, cost of deferral). **Honest status: not yet filed** — this pass may edit only the plan; the build slice files the `docs/build-status.md` backlog entry (owner Aravind). | §4.10 |
| 10 | ~~rev7 T16 "all three functions"; §8 "The three functions bypass RLS"; §6 "(1)–(6)"~~ | Four functions (helper + `add` + `deactivate` + `reactivate`). | §6, §7, §8 |

## Dated corrections, 19 Sep 2026 (rev7) — kept (`git show f407ba1:docs/plans/add-engineer-plan.md`)

| # | Earlier text (retracted) | rev7 result | Where |
|---|---|---|---|
| 8 | (carried, unchanged) rev6 #5: the CHECK on `project_members.role` re-grounded on the exact-string readers (`query.ts:163`, `is-project-pm.ts:30`, `project-manager.ts:36`) and the future index slice | Kept. **Added:** the general pattern, one line, at §4.5 item 5. | §4.5 |

## Dated corrections, 19 Sep 2026 (rev6) — kept

| # | Earlier text (retracted) | rev6 result | Where |
|---|---|---|---|
| 1 | ~~rev5 banner, §0 #2/#10, §4.7 "D12 open — BLOCKING", D12 table, T22, and every part of the plan that assumed the partial index ships in this slice~~ | **D12 settled: Option D.** The index leaves this slice, together with the deferred role-scoping of the count sites, into one named future slice (§4.8). **No fixture is reshaped.** Reasoning recorded in §4.7. | §4.7, §4.8 |
| 2 | ~~rev5 §6 item (2) "the partial index `uq_project_members_one_engineer_project…`" and its "sequencing constraint"; "if prod has violating rows: the index fails (query `e`)"~~ | Struck. The migration **still contains** the CHECK on `project_members.role`, and the five attribution columns with their pairing CHECKs and composite same-tenant FKs (plus the helper, two functions and ACLs, which never depended on the index). **`UNIQUE (project_id, user_id)` at `001:79` is unchanged — membership uniqueness was not dropped.** | §6 |
| 3 | ~~rev5 T3 (second `engineer` membership rejected `23505`)~~ and ~~T4 ("`pm` on P1 + `engineer` on P2 allowed by the index")~~ and ~~T22 (existing-fixture acceptance)~~ | Struck: each tested or depended on the index. T4's **consequence** ("allowed is not works") is kept as a fact, moved to §4.8 as design input for the future slice. T19 loses its "still caught by T3" clause. | §7 |
| 4 | ~~rev5 "59 tests" stated as a headline fact (banner, §0, §4.7)~~ | **Derived, never observed.** 59 = 7 + 1 + 16 + 5 + 4 + 6 + 20, counted from reading the setup calls of 7 named files; I did **not** run the suite, and a red run needs the index, which exists nowhere. Recorded as derived, with the 7 files named. | §4.7 |
| 5 | ~~rev4/rev5 D8/D11 rationale: "the CHECK exists to stop `'Engineer'` and typo variants escaping the partial index"~~ | **That rationale depended on the index and no longer stands as written.** The CHECK stays (decided). Its purpose now: every exact-string role reader — the Daily Logs roster `.eq('role','engineer')` (`query.ts:163`), `isProjectPm` (`is-project-pm.ts:30`), `resolveProjectManagerName` (`project-manager.ts:36`), the hindrance queue's PM scope (`queue.ts:172,291`) — silently misses a variant like `'Engineer'`; and it is the prerequisite the future index slice needs. Flagged, **not re-litigated**. | §4.5 |
| 7 | ~~rev5 §4.5 item 3 (unfiltered-count sites) as a free-standing deferral~~ | Folded into the named future slice with the index (§4.8); the sweep site `033:220-222` is named alongside `project-resolution.ts:37`. | §4.5, §4.8 |
| 8 | ~~rev5 `docs/schema.md:127-130` "both become stale"~~ | Only the `role TEXT NOT NULL` part goes stale (now a CHECK). "One active project per engineer — enforced at insert in app logic, NOT a DB constraint" **stays exactly as true as it was** — and no app code enforces it today (grep g5: no engineer write path exists). | §4.8 |
| 11 | ~~rev5 §4.7 wording "Option A provably breaks `dpr-stage1-plumbing.test.ts:207-217`"~~ (as I had it, rev5 scoped Option A to the 3 multiplicity tests only) | Made precise: mixed roles **applied to the incidental sites** (the only way they could cover #4–#7) inverts that test; Option A as scoped in rev5 did not cover those 35 call sites at all. | §4.7 |
| 12 | (checked) | Strings: **no constant existed only for the dropped index** — checked every rejection case R1–R8 and every constant; R5/R6/R7a/R7 exist because the *number* already exists (`001:44`), independent of any index. Nothing removed. | §9 |

## Dated corrections, 19 Sep 2026 (rev5) — kept

| # | Earlier text (retracted) | rev5 result |
|---|---|---|
| 1 | ~~rev4 CHECK set `('pm','engineer')` and "NEW CONFLICT: three test sites write `role: 'qs'`"~~ | D11: the CHECK mirrors `users_role_check` (six roles); no fixture reshaped; applies cleanly (probe x2). |
| 2 | ~~rev4 T19 "`'owner'` rejected"~~ | `'owner'` valid. |
| 3 | ~~rev4 silent on existing fixtures~~ | Found 7 files / 59 tests (derived, see rev6 #4); root cause: the shared morning engineer enrolled twice by construction. Now moot for this slice (rev6 #1). |
| 6–9 | ~~rev4 §4.5 one count site; T4 wording; "24 pm, 20 engineer"; §12~~ | Two count-shaped sites; T4 consequence; 55-site scan (28 pm, 24 engineer, 3 qs); file list. |

## Dated corrections, 19 Sep 2026 (rev4) — kept

| # | Earlier text (retracted) | rev4 result |
|---|---|---|
| 1 | ~~rev3 heading "Dated corrections, 18 Sep 2026 (rev3)"~~ | Wrong date: rev3's log starts `Sat Sep 19 00:01:34 IST 2026`, commit `2026-09-19 00:15:46 +0530`; 18 Sep only in UTC. |
| 2 | ~~rev3 §3.6 "India-only in SQL rejected because DB fixtures are `+1…`"~~ | Reason retracted: test-fixture shape must never decide a production constraint; decision stands as an ACCEPTED LIMIT (§3.6). |
| 3–5 | ~~rev3 D8/D9/D10 "open"; "the action refuses if attestation absent"; three-parameter signature~~ | CHECK settled (RLS insert policy places no restriction on the inserted row's `role`); D9 record-not-enforce (`consent_attested`, fourth parameter); D10 `deactivated_by/at`. |
| 6 | ~~rev3 T12 "the repo already uses `it.fails`"~~ | **Wrong**: no executable `it.fails` in `test/`; behaviour **verified by running it** on vitest 3.2.7 (re-run in the rev6 log). |
| 7–14 | session cleanup untraced; `pg_temp`; §7.3 "assumed no cron"; R7 split; matrix rows fixture-only; CHECK optional; digit strings; new items | Traced (F1–F3); `search_path=public` only; shown/not-shown breakdown; `registered_no_project`; rows 3–8 fixture-only; CHECK definite; residual-risk statement (§4.6). |

## Dated corrections, ~~18 Sep 2026~~ **19 Sep 2026** (rev3) and 18 Sep 2026 (rev2) — kept (dates verified)

| # | Earlier text (retracted) | Result |
|---|---|---|
| rev3 1 | ~~rev2 §9 "`// Tamil owed, NOT approved`" citing `lib/photos/copy.ts:13-20`~~ | Mis-citation: that comment marks *approved English awaiting Tamil* (`copy.ts:3-6`); unapproved wording uses `// Wording owed, NOT approved`. |
| rev3 2 | ~~rev2 §2.3 explicit NULL-tenant refusal; T1 fixture a NULL-role stub~~ | One null-safe comparison; T1 fixture `role='admin'`, `tenant_id` NULL. |
| rev3 3–14 | ~~isProjectPm unused; rule wording; India re-assert; `whatsapp:` accepted; …~~ | `git show 9b9187c:docs/plans/add-engineer-plan.md`. |
| rev2 1–12 | ~~rev1 "tighter than the policy"; service-client claim; two-client design; "prod unread"; quoted labels; R6 "index enforces"; partial apply; "048 reserved, 049 next"; §7 T8/T10; §8 residual; per-row strings; `classify.ts`~~ | `git show e67e297:docs/plans/add-engineer-plan.md`. |

## 0. Findings that shape the plan — read first

1. **`status='active'` (D1) departs from ENG-01** (`docs/bot-flows.md:303-308`). Nothing implements that flow (greps g1–g3; c1/c3: none of `registered_by`, `registered_at`, `consent_attest*`, `deactivated_by`, `deactivated_at` exists (rev9: this is evidence of *absence* on `main`; only the first three are created — D10 reversed, §2.8) in `app lib supabase scripts test types`; probe s). A non-`active` user is dropped by the webhook (`reactivation.ts:29-33`) and every roster.
2. **Every pasted row is a fresh `users.id`, so the add screen can never create a second membership** — which is why the partial index is not needed by this slice (§4.7).
3. **`users.status` is `NOT NULL DEFAULT 'active'`** (probe d; `012_…sql:45-46`); the gate is `route.ts:159` → `reactivation.ts:29-33`.
4. **`authenticated` cannot write `users`**: no INSERT (probe k, `015:114`), UPDATE only on `full_name, avatar_url` (`015:105`), only UPDATE policy is own-row (probe j). ~~Add and deactivate both need definer functions~~ **Add needs a definer function (slice 1); deactivate and reactivate are slice 2 (rev10)**; no service client (g4).
5. **Phone chain: no mismatch, but no validator exists** (§3).
6. **Migration number 048** is free (`origin/main` migrations end at 047; reservations end at 048, "RELEASED, NEVER USED … 048 is free").
8. **A test/production shape gap decides real bugs here** (§3.6): six test sites `update({ role: 'pm' })` on a fixture profile while real PMs are `admin`.
9. **This slice ships with NO database enforcement of one-project-per-engineer** (§4.8).

## 1. Authorisation
**The rule (D6).** With the caller resolved as the `users` row where `auth_id = auth.uid()`: `users.role IN ('admin','pm')` **AND** the project exists **in the caller's tenant** **AND** (`users.role = 'admin'` **OR** a `project_members` row with `role = 'pm'` for this `(user, project)`). It is the intersection of the DB policy's role list
(`project_members_insert`, probe j) and per-project membership; `qs`/`engineer`/NULL-role users never pass, even with a `pm` membership.
**Where each role column is written.** `users.role='admin'` for a self-serve account: `005:76-80`, `016:177-181`. `project_members.role='pm'` for a project's creator: `app/(dashboard)/projects/new/page.tsx:49-54`. So every real PM is `users.role='admin'` + `project_members.role='pm'`; grep g8: nothing writes `users.role='pm'` outside tests; probe t: test-db has 10 admins, 3 NULL-role stubs, 1,872 engineers, **no `pm` user**.
**Two implementations, one authority.** SQL (authoritative): the internal helper (§2.7). TypeScript (advisory only): pure `decideEngineerAdminAccess`, reusing `isProjectPm` (`lib/auth/is-project-pm.ts:20-34`). If they disagree, SQL wins; T6 catches drift.

## 2. The add function — SECURITY DEFINER (`add_engineers_to_project`)

### 2.1 Contract (signature and behaviour; no body is written here)
`(p_project_id uuid, p_engineers jsonb, p_dry_run boolean, p_consent_attested boolean) → jsonb`. No parameter defaults (`CLAUDE.md:361-372`). `p_engineers` is an array of `{ name, whatsapp_number }`, the number **already validated and normalised by TypeScript** (§3); the function asserts only the generic stored shape (§3.6).
In dry-run, `p_consent_attested` is ignored; in apply it is recorded as `coalesce(p_consent_attested, false)`.
Return `{ applied: boolean, rows: [ { idx, status, … } ] }`. Status values are machine identifiers, not wording. **Allowed fields per status — the whole payload:**
| status | fields | note |
|---|---|---|
| `ok` (dry-run: would be added) | `idx, status` | |
| `added` (apply) | `idx, status, user_id` | |
| `already_on_this_project` | `idx, status` | no name, no id |
| `on_another_project` | `idx, status, other_project_name` | **the caller's own tenant only** |
| `registered_no_project` | `idx, status` | **same-tenant engineer with no membership only** |
| `number_registered` | `idx, status` — **exactly these two keys** | generic; never a project id, project name, or full name |

### 2.2 The dry-run flag (D7)
`p_dry_run = true`: authorisation, tenant binding, argument validation and **full classification**; returns the payload apply would; **writes nothing**. **Why it exists, plainly:** without it a cross-tenant collision is invisible at preview (under RLS a preview reads only its own tenant's `users`, probe j `users_select`) and **aborts the whole all-or-nothing batch at apply**; with it, preview and apply run the *same code path* and the collision is caught at preview, generically.
1. **Authorisation runs BEFORE any number lookup, in both modes.** 2. **Cross-tenant collisions are `number_registered`**: exactly `{idx, status}` (T5). 3. **Apply re-runs every check** and never trusts the preview's verdicts. 4. Dry-run writes nothing (T7).

### 2.3 Order of operations (one transaction)
1. **Resolve the caller:** `users` where `auth_id = auth.uid()` (`019:170-171`; probe p); none → `insufficient_privilege` (`019:172-175`). `auth.uid()` is never compared to `users.id` (`007:127`, `007:60-67`, `007:76-78`); engineers/owners have `auth_id` NULL (`CLAUDE.md:833-840`).
2. **Load the project; tenant-bind NULL-safe.** Missing, **or** `project.tenant_id IS DISTINCT FROM caller.tenant_id` → `no_data_found`, one indistinguishable error (`019:219-222`); `projects.tenant_id` is NOT NULL (`001:55`). **This single comparison is the only tenant-binding mechanism** (T1).
3. **Role/authority gate (§1)**, else `insufficient_privilege`. 4. **Validate the argument:** 1..50 rows (`program_limit_exceeded`, `019:208-212`); non-empty `name` ≤ 100; generic-shape number; duplicates → `invalid_parameter_value`.
5. **Classify every row** (R5–R7, §4). 6. If `p_dry_run`, or **any** row is not `ok` → write nothing. 7. Otherwise insert per row (§2.6); any exception rolls back everything; a concurrent add of the same number loses on `UNIQUE (whatsapp_number)` (`001:44`, probe h; `23505`).
**The NULL trap in the precedent (deferred):** `019:230` is `IF v_tenant_id <> get_user_tenant_id()`; a NULL tenant makes it NULL and the guard passes (masked by `019:224-229`). The new function does not copy it.

### 2.4 `tenant_id` is derived from the project row, never a parameter
(a) A parameter is caller-controlled; a missed validation writes a user into the wrong tenant. (b) The function bypasses RLS; the composite FKs (`017:94-106`, probe h) validate the *membership* but not the `users.tenant_id` *value*. (c) It removes a class of test cases.

### 2.5 Ownership and grants
Precedent printed in full: `019:149-297` (`SECURITY DEFINER SET search_path = public` `:156`; `REVOKE … FROM PUBLIC, anon; GRANT … TO authenticated` `:294-295`). Live (probe n): all 15 definer functions owned by `postgres`; `correct_daily_log` still holds `service_role:EXECUTE` (hence `CLAUDE.md:910-918`). Tables owned by `postgres`, RLS on, **not forced** (probe o).

### 2.6 Columns written (explicit wherever a default or NULL would hide a bug)
**`users` row** (probes r, l):
| column | value | source |
|---|---|---|
| `id` | DB default, via `RETURNING` | `007:127` |
| `tenant_id` | the **project row's** tenant — explicit | §2.4 |
| `role` | `'engineer'` — explicit | `users_role_check`, probe h |
| `status` | `'active'` — explicit (D1) | probe d |
| `full_name` | trimmed `name` | argument |
| `whatsapp_number` | already-normalised number | argument |
| `messaging_blocked` | `false` — explicit | probe l |
| `auth_id` | `NULL` — explicit | `CLAUDE.md:833-840` |
| **`registered_by`** | the **resolved caller's `users.id`** — never `auth.uid()`, never a parameter | new (§2.8) |
| **`registered_at`** | `now()` in the function | new |
| **`consent_attested`** | `coalesce(p_consent_attested, false)` — recorded, not enforced (D9) | new; the **claim as passed** |
| not set | `avatar_url, hierarchy_level, reporting_manager_id, delegation_active, employee_id, notification_email, notification_email_verified_at, whatsapp_declined_at` | nullable |

**`project_members` row:** `id`/`created_at` defaults; `tenant_id` = derived tenant; `project_id` = `p_project_id`; `user_id` = the new id; `role` = literal `'engineer'` (exact string — constrained by the new CHECK, §4.5). **Existing `UNIQUE (project_id, user_id)` (`001:79`) still applies.**

### 2.7 Shared internal helper; search_path; grants
Steps 1–3 live in one **internal helper**; ~~both public functions call it~~ **the public function(s) call it — slice 1: `add_engineers_to_project`; slice 2 adds `deactivate_engineer` and `reactivate_engineer` (rev10)**. Not callable from outside: `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated, service_role`. Public functions: `REVOKE EXECUTE … FROM PUBLIC, anon, service_role; GRANT EXECUTE … TO authenticated`.
**`search_path`:** all **15** existing definer functions have `config = {search_path=public}` and nothing else (probe n; `019:156`, `012:85-87`, `033:170-171`; the 71-line `SECURITY DEFINER` grep is in the log). **The new functions follow exactly that: `SET search_path = public`, no `pg_temp`, every object schema-qualified, no dynamic SQL.** **Alternative:** duplicate steps 1–3 inline (no helper ACL, but two copies that can drift).

### 2.8 Attribution — `registered_by`, `registered_at`, `consent_attested` (slice 1 part; the episodes half is slice 2 §2.8)
**Confirmed absent** (grep c1/c3; probe s; probe r): none of `registered_by`, `registered_at`, `consent_attest*` exists, ~~and the name `engineer_episodes` is unused in migrations, generated types, `docs/schema.md` and the reservations file (grep, rev9 log)~~ (rev11: that check belongs to slice 2 and is in the episodes plan §2.8). **Cannot be reconstructed later:** after apply nothing else records who created an engineer (~~, deactivated or reactivated~~ — slice 2); the only other trace is request logging outside the database, which this repo does not read.
**D9:** a direct caller can pass any value, so a refusal buys nothing, while the recorded claim plus `registered_by`/`registered_at` answers "who confirmed this, and when" later. It records **the caller's claim**, not proof of consent; the screen's apply control is disabled until ticked (UI only).
**Where each fact lives.** **On `users`:** `registered_by`, `registered_at`, `consent_attested` (pairing CHECK `(registered_by IS NULL) = (registered_at IS NULL) AND (registered_by IS NULL) = (consent_attested IS NULL)`, precedent `036…:232-244`; composite same-tenant FK `(registered_by, tenant_id) → users (id, tenant_id)`, `017:94-100`). They are facts about **the number and its holder**: a consent attestation is a claim about a handset, made once~~; a deactivated-then-reactivated engineer is the same person on the same number, so reactivation neither overwrites the attestation nor is assumed to need a fresh one (UNKNOWNS #24); and the unreachability report keys on when the **number** was registered (§2.11).~~ (rev11: the reactivation and unreachability-report rationale is in the lifecycle plan and the episodes plan §2.8; slice 1 needs only that these are facts about the number and its holder.)
**Everything about *when an engineer was expected on a project* — the `engineer_episodes` table, its lifecycle, index, grants and the reversal of D10 (`deactivated_by`/`deactivated_at` are NOT created) — is in slice 2 §2.8.** *(Slice 1 note, rev10: external review signed off on a five-column attribution version; slice 1 creates three of those columns and slice 2 replaces the other two with the episodes table — **the attribution design changed after that sign-off**, and slice 1's `users` columns are unaffected.)*

## 3. Phone numbers and the validator

### 3.1 The chain
`route.ts:111`: `fromNumber = normalisePhoneNumber(params.From ?? '')`; `route.ts:130-133` looks up `.eq('whatsapp_number', fromNumber)`. Inbound form: `+` + digits, no `whatsapp:` prefix, no separators (`normalise.ts:13-15,18,21-23`); downstream passes it through verbatim (`dispatch.ts:180,199,217`; `inbound-start.ts:463,852`; `session.ts:58,91`). **No mismatch with the prod stored form** (`+` + 12 digits) provided the screen stores `normalisePhoneNumber(raw)` output only. That real Twilio sends `whatsapp:` + E.164 rests on a comment (`normalise.ts:4`) and fixtures (`test/webhook.test.ts:263`).

### 3.2 Status of the validator — the consequence, stated explicitly
`normalise.ts` **never rejects anything** (`normalise.ts:40-42`), and **no validator exists anywhere in the repo** (the phone `git grep`; the one schema CHECK is `outbound_sends_to_phone_number_check`, `031:478-479`, probe q). `links.ts:10-11` and `reactivate-copy.ts:48-52` say the guarantee "lives upstream at the write paths"; grep g5: no engineer write path exists, so this screen is the first.
**Consequence:** without a validator, a mistyped line stores a well-formed-looking row that can never match an inbound message (the webhook compares the *normalised inbound* number, `route.ts:133`) and **permanently holds that value under the global unique** (`001:44`), with no removal path in this slice (~~§2.9~~ — true of slice 1 as it stands; deactivate is slice 2 §2.9, rev10). The executed probe shows what `normalisePhoneNumber` alone would have stored for the rejected classes: letters gain a `+`, the empty string becomes `"+"`, a too-short value gains one, trailing text is kept, a `00`-prefixed form keeps its zeros.

### 3.3 Validation happens BEFORE normalisation — the exact rule
On each raw pasted token: **V1 charset** — only ASCII digits, `+`, whitespace, `-`, `(`, `)` (`normalise.ts:18`'s separators); anything else rejects. **V2** remove whitespace, `-`, `(`, `)` → `t`. **V3** `t` must match exactly one of `S1 ^\+91[6-9][0-9]{9}$`, `S2 ^91[6-9][0-9]{9}$`, `S3 ^0[6-9][0-9]{9}$`, `S4 ^[6-9][0-9]{9}$`. Then call `normalisePhoneNumber(raw)` and **assert** the result matches the single stored form **`^\+91[6-9][0-9]{9}$`** (13 characters) and is a fixed point.
**Reuse, not reimplementation:** import `lib/whatsapp/normalise.ts:9`; never edit or copy it. **Evidence (throwaway probe, re-run in this log):** 34 inputs (14 accepted, 20 rejected), **0 violations**.
### 3.4 On failure the preview shows the row exactly as pasted and `REJECT_BAD_NUMBER`; nothing is written; other rows still preview.
### 3.5 Line format (D4): one engineer per line; number = trailing run of digits, `+`, spaces, hyphens, parentheses; name = the rest, trimmed. Blank lines ignored. Name ≤ 100 characters; paste ≤ 50 lines.
### 3.6 The function's shape check is generic — ACCEPTED LIMIT, with the corrected reason
The function asserts `^\+[1-9][0-9]{1,14}$`, the shape of `outbound_sends_to_phone_number_check` (`031:478-479`, probe q). The India-only rule lives **in TypeScript only**.
~~**Struck reason (rev3):** "India-only in SQL is rejected because every DB fixture is `+1…`, so it would make every DB test impossible."~~ **Retracted 19 Sep 2026.** Test-fixture shape must never decide a production constraint: six test sites set a fixture profile's `users.role` to `'pm'` (`test/migration-019.test.ts:123,222`, `daily-log-detail-query.test.ts:69`, `dpr-detail.test.ts:97`, `migration-023.test.ts:121`, `daily-log-correction-rpc.test.ts:87`) while a real PM's `users.role` is `'admin'` on prod (`is-project-pm.ts:11-16`, `016:177-181`) — the gate passed on fixtures and failed a real PM on 2026-09-17.
**Replacement reason (ACCEPTED LIMIT):** (1) **the screen is the only intended caller** (a direct caller must be an authenticated tenant admin/PM, bounded by the 50-row cap); (2) **the residual risk is a stored row that never matches an inbound message, which is recoverable** (manual SQL); (3) **minting Indian test numbers is unsafe**: every `+91[6-9]…` value is a routable live handset. **Accepted, not closed:** an authorised caller bypassing the screen can store any well-formed E.164 number.

## 4. Rejection cases — which are reachable where
Preview = TypeScript parse (R1–R4) then the function with `p_dry_run = true` (R5–R7). Apply = parse again, then `p_dry_run = false`, re-running R5–R7.
| # | Reason | Detected by | Preview? | Apply? | Shown by |
|---|---|---|---|---|---|
| R1 | Empty name | TypeScript | yes | re-run | `REJECT_NO_NAME` |
| R2 | Name over 100 | TypeScript | yes | re-run | `formatRejectNameTooLong` |
| R3 | Bad number (§3.3) | TypeScript | yes | re-run | `REJECT_BAD_NUMBER` |
| R4 | Same number twice in the paste | TypeScript | yes | re-run | `REJECT_DUPLICATE_IN_PASTE` |
| R5 | Engineer already on **this** project | `already_on_this_project` | yes | yes | `REJECT_ALREADY_ON_THIS_PROJECT` |
| R6 | Engineer on **another project in the caller's tenant** | `on_another_project` + name | **yes** | yes | `formatRejectOnAnotherProject` |
| R7a | **Same-tenant engineer with no membership** | `registered_no_project` | yes | yes | `REJECT_REGISTERED_NO_PROJECT` |
| R7 | Any other existing number: **another tenant**, or same tenant but not an engineer | `number_registered`; `001:44` | yes (dry-run) | yes | `REJECT_NUMBER_REGISTERED` |
| R8 | Concurrent add between steps 5 and 7 | `23505` on `users_whatsapp_number_key`, rollback | **no** | **yes**, whole batch | `ERROR_BATCH_NOT_APPLIED` |
**Reachable at preview:** R1–R7. **Only at apply:** R8. **R5–R7a are lookups on the *number*, not on any index** — each exists because the number is already registered (`001:44`); none depends on the dropped index (rev6 #12). Whole-request refusals: unauthenticated (redirect); `no_data_found` → `ERROR_PROJECT_NOT_FOUND`; `insufficient_privilege` → `ERROR_NOT_ALLOWED`; empty → `ERROR_PASTE_EMPTY`; over the cap → `formatErrorPasteTooLong`.
**Number-existence oracle, bounded not closed:** authorisation first, generic payload, 50 rows per call; **no rate limit across calls** (UNKNOWNS).

### 4.5 Findings, decisions and deferred items
1. **`project_members.role` CHECK — D8 settled; D11 settled: the CHECK mirrors `users_role_check`.**
   **Underlying finding.** The RLS insert policy places **no restriction on the `role` value of the row being inserted.** Live (probe j): `with_check = ((tenant_id = get_user_tenant_id()) AND ((SELECT users.role FROM users WHERE users.auth_id = auth.uid()) = ANY (ARRAY['pm','admin'])))` — the `users.role` it tests is the **caller's**, not the new row's. Probe k: `authenticated` holds INSERT. Probe h: no CHECK on `project_members.role`. **So any tenant admin or pm can write an arbitrary role string today.** (Shown from catalog and grants; I ran no write.)
   **Allowed set: `('pm','qs','engineer','owner','subcontractor','admin')`** — exactly the live `users_role_check` (probe h). **Rationale (Aravind):** the CHECK is **not** to redefine which roles may hold a project membership; narrowing is a separate product decision; **no test fixture is reshaped to fit a constraint** (§3.6). ~~Purpose: stop `'Engineer'` escaping the partial index~~ — **struck (rev6 #5):** no index in this slice; the CHECK's purpose is now the exact-string role readers (`query.ts:163`, `is-project-pm.ts:30`, `project-manager.ts:36`, `queue.ts:172,291`) and the future index slice. **Applies cleanly (probe x2):** 0 rows outside the set, 0 case/space variants, of 2 rows — weak evidence alone. Whole-suite scan: 55 parsed write sites — 28 `pm`, 24 `engineer`, 3 `qs`. Aravind reports prod holds `pm` and `engineer` only (not in this log): §11 `n2`. `docs/schema.md:127` (`role TEXT NOT NULL`) becomes stale.
2. **Deferred — the `<>` tenant comparison at `019:230`.** Changes the logic of a live SECURITY DEFINER function (review-gate (a), `CLAUDE.md:192-205`); needs its own migration and package; masked today by `019:237-243` (`019:224-229`).
3. **Deferred — the unfiltered membership count: TWO count-shaped sites, in the future slice (§4.8).** **(a) `lib/whatsapp/project-resolution.ts:37`** — `supabase.from('project_members').select('project_id').eq('user_id', userId)`, then 0 / 1 / 2+ (`:39-63`). **(b) `supabase/migrations/033_sweep_stale_morning_sessions.sql:220-222`** — `SELECT count(*), (array_agg(project_id))[1] … FROM project_members WHERE user_id = v_row.user_id`, then `IF v_project_count != 1` (`:224-233`). Scoping (a) changes bot behaviour in `lib/whatsapp/` (barred to this slice); scoping (b) replaces a shipped function (F1 — in the lifecycle plan §2.9). Ten other unfiltered per-user reads are a *different shape* (scope/existence lookups), found by a throwaway scan (`scan_unfiltered.py`, **not in the repo**, printed in the log): `app/(dashboard)/dprs/page.tsx:32`, `app/(dashboard)/projects/page.tsx:35`, `lib/daily-logs/query.ts:142,384,558`, `lib/dpr/dispatch.ts:411`, `019:133`, `019:238`, `023:175`, `040:353`.
4. **Prod phone-format evidence is a single row.** Reported by Aravind (not in this log): `+` + 12 digits, prefix `+91`, **n=1 — the whole population observed**, consistent with `normalisePhoneNumber`'s output for an Indian mobile. One row cannot show any other stored value shares that form. Test-db holds no `+91` (probe g). §11 `g`, `r`.
5. **Pattern, for future readers (rev7).** When the reason for a constraint is removed, its justification must be re-derived or the constraint dropped — a rationale that outlives its cause is how dead constraints accumulate. (Worked example: the `project_members.role` CHECK lost its stated reason when the partial index left the slice (rev6 #5); it stayed only because a *new* reason was found and printed — the exact-string readers at `query.ts:163`, `is-project-pm.ts:30`, `project-manager.ts:36`, plus the future index slice.)

### 4.6 Residual risk — known and accepted, NOT closed
**The validator catches malformed numbers, not wrong ones.** A correctly formatted number with one digit wrong is **a stranger's live handset**; that person will receive a check-in from the production sender with **no opt-in**, at the next scheduled send (`vercel.json:12-19`; `roster.ts:165-168`, `checkpoint-trigger.ts:226-233`). The confirm step (§5) and the attestation (§2.8) ~~and deactivate (§2.9)~~ are **mitigations, not a solution** — they slow and record, they do not prevent; ~~deactivation does not free the number~~ **slice 1 has no deactivation at all and no way to free the number (rev10; deactivate is slice 2)**. **A known and accepted risk, not a closed one.**

### 4.7 D12 SETTLED (rev6) — Option D: the partial unique index leaves this slice; no fixture is reshaped
**Decision (Aravind, 19 Sep 2026):** remove the partial unique index on `project_members(user_id) WHERE role='engineer'` from this slice entirely. Do not reshape any test fixture. Move the index, together with the deferred role-scoping of the count sites, into one named future slice (§4.8).
**Reasoning, recorded in Aravind's terms:**
1. **The add screen can never trip the index:** every pasted row is a fresh `users.id`, so the screen never creates a second membership; existing numbers are rejected (R5–R7a).
2. **A second engineer membership already fails LOUDLY today:** the engineer is sent `MULTIPLE_MEMBERSHIPS_REPLY` (`project-resolution.ts:60-63,74-75`; `route.ts:244-247`), `resolveEngineerProject` captures a Sentry warning (`project-resolution.ts:55-59`), and the sweep **skips** the session (`033:224-233`) and reports it to Sentry with a per-session fingerprint (`lib/daily-logs/morning-cutoff-sweep.ts:141-144`). It is a visible state, not a silent one — visible to the engineer and to Sentry; **the PM is not told** (recorded, not disputed).
3. **The index enforces only half the rule:** `pm` on P1 + `engineer` on P2 passes it and **still bricks the engineer**, because both count sites are role-blind (`project-resolution.ts:37`; `033:220-222`). The other half is the role-scoping already deferred. Splitting them means doing the same fixture rework **twice** against half a rule.
4. ~~**Every other D12 option reshapes fixtures to fit a constraint** — the pattern that let the correction-gate bug hide behind `users.role='pm'` fixtures (§3.6).~~ **Corrected in rev8 (§4.10): that comparison was wrong** — the `pm` fixtures manufactured a *false* shape; these 7 files construct a *real* state the code defends against, and are the only tests of that defence. Mixed roles **applied to the incidental sites** (the only way they could cover #4–#7 below) provably inverts `dpr-stage1-plumbing.test.ts:207-217`, whose point is that a non-PM member is **not** picked up as the project manager (`project-manager.ts:31-36` selects `role = 'pm'`). (As scoped in rev5, Option A covered only the three multiplicity tests, so on its own it would not have unblocked those 35 call sites at all.)

**The finding this rests on (kept as input to the future slice).** `ensureMorningFixtures()` upserts the shared morning engineer (`testEngineerId()`, `test/helpers/db.ts:193-198,445`) as an `engineer` member of `TEST_PROJECT_ID` (`db.ts:490-498`); several files then add that same engineer to a fresh per-test project, and three files build a deliberate two-project engineer. Seven files construct "one user, two `engineer` memberships" as ordinary setup:
| # | File : lines | Setup | Tests hit (derived) | Failure mode with an index |
|---|---|---|---|---|
| 1 | `test/unit/project-resolution.test.ts:77-81` | `userMany` on `projectA` + `projectB`, one bulk insert | 7 of 7 (`beforeAll` throws `:82`) | loud, whole file |
| 2 | `test/unit/morning-cutoff-sweep.test.ts:516-517` | two separate `upsert`s, `error` never read | 1 of 15 (`:507-543`; the file header's "13" is stale) — the only test of the sweep's skip path | **silent**: fails later at `:522-528` for the wrong reason |
| 3 | `test/webhook.test.ts:239-246` (`ensureGateUser` `:181-185` + `secondProjectId`) | `multiUserId` on two projects | 16 of 16 (`beforeAll` throws `:246`) — incl. T-WH-01, required by `CLAUDE.md:1002-1006` | loud, whole file |
| 4 | `test/dpr-generate-job.test.ts:72-76`; calls `:112,206,297,328,378` | shared engineer on a fresh project | 5 of 7 | loud, per test |
| 5 | `test/dpr-generate-trigger.test.ts:40-44`; calls `:136,155,175,197` | same | 4 of 6 | loud, per test |
| 6 | `test/dpr-stage1-plumbing.test.ts:27-31`; calls `:54,71,95,127,153,212` | same | 6 of 9 | loud, per test |
| 7 | `test/owner-deliver-job.test.ts:121-127`; 20 calls `:430`–`:1046` | same | 20 of 21 | loud, per test |
**"59 tests" is DERIVED, not observed** (rev6 #4): 7 + 1 + 16 + 5 + 4 + 6 + 20, from reading the setup calls of these 7 named files; I did **not** run the suite, and a red run needs the index, which exists nowhere. **These 7 files are untouched by this slice.** Not affected (checked): `checkin-escalations-sweep` and the sweep's loop at `:144` (distinct users), `rehearse-038.ts:355` (one pair), `TEST_PROJECT_A_ID` tests (distinct users).
~~**Options A/B/C/D (rev5)**~~ — superseded by Option D. Full option table, coverage analysis and costs: `git show fad98e3:docs/plans/add-engineer-plan.md` (§4.7).

### 4.8 What this slice ships without — and the future slice; ~~D13 (F4) options~~ (rev10: the D13 options paragraph is in slice 2 §4.8)
**This slice ships with NO database enforcement of one-project-per-engineer, and the add screen is the only place the rule exists.** Stated precisely: the screen never creates a second membership (§4.7 #1) — that is the whole of the rule as this slice delivers it. **Nothing else prevents one:** the RLS insert policy lets any tenant admin or `pm` insert a `project_members` row for any tenant user with any allowed role (probes j, k), and the service role and SQL can too.
**`UNIQUE (project_id, user_id)` at `001:79` stays exactly as it is** — the same user twice on the *same* project is still prevented; membership uniqueness was **not** dropped. `docs/schema.md:129-130` ("One active project per engineer — enforced at insert in app logic, NOT a DB constraint") remains as true as it was — and no app code enforces it today (grep g5).
**The named future slice — "the one-project-per-engineer slice" — contains, together:** (i) the partial unique index (definition kept for it: `CREATE UNIQUE INDEX uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'`; not `CONCURRENTLY`, `docs/migration-runbook-template.md:34`; pre-check = query `e` from rev5, plus the prod queries then); (ii) role-scoping of `resolveEngineerProject` (`project-resolution.ts:37`); (iii) role-scoping of the sweep's count (`033:220-222`) — added to the slice because the third bullet of §4.7 makes it the same half-rule; (iv) the rework of the 7 files in §4.7, done once against the whole rule; (v) the CHECK from this slice as its prerequisite.
**Design input for that slice (kept from rev5 T4):** `pm` on P1 + `engineer` on P2 **passes** the index, and that user, if they text the bot, still gets `MULTIPLE_MEMBERSHIPS_REPLY` while the sweep parks their morning session — **allowed is not works** — until (ii) and (iii) land.

### 4.10 External-review conditions closed in rev8 — S1 lint, D12 rider, N1

**S1 — the SQL half of the profile-lookup lint. Specified; lands IN THIS SLICE.**
**The blind spot, printed (log).** `scripts/check-profile-lookups.mjs` guards the pre-007 bug class (`users.id` compared to the auth uid) but only over `app/` and `lib/` — `ROOTS = ['app', 'lib']` (`:18`) — and only `.ts`/`.tsx` (`:47`); its detector is `from('users')` plus `.eq('id', …)` in one file (`:20-21`), its exception is an inline tag `profile-lookup-guard:allow-id-eq` (`:29`), and it runs as `prebuild`/`pretest` (`package.json:12,17`), **not** as a CI job of its own. This slice moves identity resolution into SQL (the §2.7 helper resolves the caller by `users.auth_id = auth.uid()`), and **the class already shipped once in SQL**: `002_rls_policies.sql:122` — `AND (SELECT role FROM users WHERE id = auth.uid()) IN ('pm', 'admin')` — the exact policy §4.5 item 1 reasons about. A line-level grep of the migrations finds the same shape at `002:19,64,68,83-84,122,129,133,140,189,196` and `005:32,80`, all **superseded by 007** (`007:141,195,218-295`, which rewrote them to `auth_id = auth.uid()`). Nothing lints that class in SQL today.
**The extension.** A new rule in **`scripts/lint-migrations.mjs`** (the migration linter), **not** in `check-profile-lookups.mjs`: the migration linter already scans both `supabase/migrations/` and the held files in `docs/reviews/` (`main()`, `:685-723`), already has the rule shape (`ruleOrphanSecurityDefiner`, `:195-226`, returns `{file, object, rule}`), and **already runs as its own CI job, "Migration Lint" (`.github/workflows/ci.yml:161-176`)** — whereas `check-profile-lookups` would need a `.sql` walker bolted on. Rule name `no-auth-uid-as-users-id`. **Detector:** over comment-stripped SQL (`stripComments`, `:131`), split into statements on `;`; a statement is a violation when it (i) mentions the `users` table (`\b(?:public\.)?users\b` after `FROM`/`JOIN`/`ON`/`UPDATE`/`INTO`) **and** (ii) matches `(?<![A-Za-z0-9_])id\s*=\s*auth\.uid\(\)` — the look-behind is what keeps `auth_id = auth.uid()` (correct) and `engineer_id = …` from matching. Object key: the enclosing `CREATE POLICY "<name>"` or `CREATE … FUNCTION <name>`, else `L<line>`.
**Exceptions use the mechanism that file family already has** — `scripts/migration-lint-exceptions.json`, narrow `(file, object, rule)` triples with a required `reason` (`loadExceptions`, `:640-650`; 97 entries today). The profile script's inline tag cannot transfer: applied migrations are LIVE files that must not be edited (`CLAUDE.md` §6). Expected first-run findings are the superseded `002`/`005` sites, each exempted with reason "superseded by 007:<lines>"; the **final count is fixed by the statement-scoped run in the build slice**, not by the line-level grep above.
**Extension (b), recommended, flagged (D16):** the same class appears with other columns — `002:180,188,195` compare `engineer_id = auth.uid()` on `daily_logs` (superseded `007:277-295`). A second pattern `(?<![A-Za-z0-9_])(?!auth_id)[a-z_]+_id\s*=\s*auth\.uid\(\)` catches it. The instruction specified the `users … id` form; (b) is a superset, so it is not specified as required.
**Where it lands, and why in this slice:** `scripts/lint-migrations.mjs` + `scripts/migration-lint-exceptions.json` (+ its test), **as its own small commit that merges before `048_engineer_registration.sql` enters `docs/reviews/`** — the review package's lint capture must run with the rule live. Cost: one rule and a bounded exception list. **Alternative, not chosen:** defer to a named artefact — rejected because this slice's helper is the first new SQL to resolve identity since 007, so deferring leaves the review of that helper unlinted. **Test/red-first (T39):** (1) run the rule over the current tree **before** adding exceptions — it must fail CI on the `002`/`005` sites (the natural red, proving it bites); (2) add the exceptions — green; (3) mutation: give the 048 helper `WHERE id = auth.uid()` — red; (4) `WHERE auth_id = auth.uid()` — clean. **A unit test needs the rules importable:** `main()` is invoked unconditionally at the bottom of the file (`lint-migrations.mjs`, last line `main()`), so importing it runs the whole lint — the slice must guard `main()` and export the rule (**ASSUMED**; not checked further, UNKNOWNS #28).

**D12 rider — the future slice, PINNED as a tracked artefact.** *(§4.8 named it; nothing pinned it.)*
**Name:** "the one-project-per-engineer slice". **Owner: Aravind** (solo; `CLAUDE.md` §0 "I am solo and the only person who will ever debug this"). **Where it is tracked:** a **backlog entry in `docs/build-status.md`**, in that file's own format — `### [date] Backlog: <title>` plus an index row (`docs/build-status.md:34-38`; "the open backlog", `:11`). **Honest status: NOT YET FILED.** This pass may edit only this plan, so today the plan is the *only* record; **the build slice's docs commit files the entry, and the 048 apply record carries a checklist line "D12 rider filed at <path:line>"** — until then it is untracked and this paragraph says so. (The reservations file is for migration numbers, `migration-number-reservations.json:1-12`; the rider needs a number only when its migration is drafted, and reserves it then.) **The entry's contents, complete:**
1. **The index:** `CREATE UNIQUE INDEX uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'`; not `CONCURRENTLY` (`docs/migration-runbook-template.md:34`); pre-check queries `(a)` (users with >1 `project_members` row) and `(e)` (the exact predicate) from rev5 (`git show fad98e3:docs/plans/add-engineer-plan.md`).
2. **The 7 affected test files, by name:** `test/unit/project-resolution.test.ts:77-81`; `test/unit/morning-cutoff-sweep.test.ts:516-517`; `test/webhook.test.ts:239-246`; `test/dpr-generate-job.test.ts:72-76`; `test/dpr-generate-trigger.test.ts:40-44`; `test/dpr-stage1-plumbing.test.ts:27-31`; `test/owner-deliver-job.test.ts:121-127` (§4.7 table; "59 tests" is **derived**, never observed — the first step is a real red run against an index-carrying scaffold).
3. **Role-scoping of `resolveEngineerProject`** — `lib/whatsapp/project-resolution.ts:37`, `supabase.from('project_members').select('project_id').eq('user_id', userId)`, currently role-blind.
4. **The sweep's count** — `supabase/migrations/033_sweep_stale_morning_sessions.sql:220-222`, `SELECT count(*), … FROM project_members WHERE user_id = v_row.user_id`, role-blind; replacing that shipped SECURITY DEFINER function trips review gate (a) — a full package and rehearsal.
5. **Prerequisite from this slice:** the `project_members.role` CHECK (D8/D11).
6. **The consequence it exists to remove**, recorded as design input (kept from rev5 T4): `pm` on P1 + `engineer` on P2 passes the index yet the engineer still gets `MULTIPLE_MEMBERSHIPS_REPLY` while the sweep parks the session — "allowed is not works" — until items 3 and 4 land.
**The D12 reasoning, CORRECTED (rev8).** ~~rev6/rev7 §4.7 item 4: "Every other D12 option reshapes fixtures to fit a constraint — the pattern that let the correction-gate bug hide behind `users.role='pm'` fixtures (§3.6)."~~ **That comparison was wrong.** The `users.role='pm'` fixtures **manufactured a FALSE shape** — no real PM has `users.role='pm'` (probe t; `is-project-pm.ts:11-16`) — and so let a gate pass on a lie. **The 7 files construct a REAL state**: one engineer with two `engineer` memberships is exactly what the code **explicitly defends against** — `MULTIPLE_MEMBERSHIPS_REPLY` (`project-resolution.ts:60-63,74-75`), a Sentry warning (`:55-59`), the sweep's skip with a per-session fingerprint (`033:224-233`, `morning-cutoff-sweep.ts:141-144`). And **they are the only tests of that defence**: `project-resolution.test.ts:102-104,125-126`, `morning-cutoff-sweep.test.ts:507-543` (the only test of the skip path), `webhook.test.ts:339` (grep, log; the `-sentry.test.ts` file uses fabricated rows, not memberships). Reshaping them to fit an index would **remove real coverage of a defended state**, not tidy a fake one — which is the reason D12 Option D stands, and it is a different reason from the one previously written.
**The deferral's cost, recorded explicitly.** Until the rider ships, a second `engineer` membership is **loud to the engineer** (`MULTIPLE_MEMBERSHIPS_REPLY`) **and to Sentry** (`project-resolution.ts:55-59`; the sweep's per-session fingerprint) — and **SILENT TO THE PM.** The engineer stays on the roster of **each** project (`query.ts:159-163`), cannot check in, and so shows an amber **"Not checked in" every day with no explanation** on both boards while the sweep skips their session (`033:224-233`). Nothing tells the PM why. This slice does not create that state (§4.7 #1) and cannot prevent it (§4.8).
**`docs/schema.md:129-130`** ("One active project per engineer — enforced at insert in app logic, NOT a DB constraint") **becomes true the day this ships, for the paste path** — grep g5: no app code enforced it before, because no engineer write path existed. **The 048 apply record must say so in as many words: the add screen is now that app logic** — and only that: RLS still lets a tenant admin or `pm` insert a membership directly (probes j, k), so it is enforced by the screen, not by the database.

**N1 — `anon` holds table-level `SELECT` on `public.users`: a KNOWN GAP, not an accepted risk.** ~~rev7 §4.9: "(`anon` also holds table-level `SELECT` — pre-existing, RLS-bounded)".~~ Evidence: probe pg_6 (`anon_table_select: true`, 17 of 17 columns). What bounds it today is RLS alone (`users_select` requires own row or same tenant; an `anon` request has no tenant) — a **single layer**, the exact shape `CLAUDE.md` §6 warns about ("RLS and the grant are two independent layers"). **Where it is tracked:** `docs/reviews/047-review-package.md:35` (**D5: "`anon` SELECT cleanup is OUT of scope (backlog)"**) and `:63` ("`anon`'s remaining SELECT/INSERT/UPDATE surface is untouched"). **It is not in `docs/build-status.md`'s backlog list** (grep of `:34-39`, log) — so it is tracked only inside a review package. This slice **widens the exposed surface by three `users` columns** (~~seven~~ — rev9; the attribution columns inherit the table-level grant); ~~the new `engineer_episodes` table does **not** (explicit grants, §2.8)~~ (slice 2's new table carries its own explicit grants — episodes plan §2.8); this slice does not close it; the fix (a revoke on `users`) trips gate (b) and is its own migration. **Recommendation:** file it as a backlog entry beside the D12 rider, with the same owner.

## 5. The flow, and atomicity
**Flow:** paste → **Preview** (dry-run) → **Confirm** — a step naming the count of rows about to be created (`formatAddConfirm({ count })`) plus the admin-facing consent attestation (`ADD_CONSENT_ATTESTATION`), with the apply control **disabled until ticked** (UI only) → **Apply**. The action re-parses the raw text server-side, refuses if the re-parsed accepted count differs from the confirmed count, and passes the tick state to the function as `p_consent_attested`, recorded not enforced (D9). **Atomicity:** all-or-nothing per apply call; if any row is not `ok` at apply, or a concurrent add wins, nothing is written and the admin sees `ERROR_BATCH_NOT_APPLIED` and re-previews. Concurrency (T15) is **not verifiable locally** (`CLAUDE.md:478-486`).

### 5.1 The engineers list page — read-only (D21, rev11)

**Decision (Aravind, rev11; settles UNKNOWNS #45):** the engineers list page (`app/(dashboard)/projects/[id]/engineers/page.tsx`, route **ASSUMED**) **is in slice 1, and is read-only.**
**Reasoning, recorded.** Slice 1 has no deactivate, so the page carries **no actions**. It exists because **an admin who pastes fifty names needs to confirm what landed, and "did it work" is the first question after any bulk action** — the apply result (§5) says it once; the list is the standing answer afterwards. It also **becomes the host for slice 2's controls** (deactivate, reactivate), which add to it and do not replace it.
**What it shows (slice-1 data only):** the project's engineers — name, the number as stored, the `registered_by` / `registered_at` / `consent_attested` line (`formatRegisteredLine`), and `ENGINEER_STATUS_ACTIVE`. **No `actions.ts`, no form, no button, and no link other than back-navigation** (T44). How a **non-active** row (only possible through manual SQL in slice 1) displays is **not decided** — UNKNOWNS #47.
**Strings: no string on this page may imply a removal, edit or undo path, because none exists in slice 1** (§9). **Constants it needs:** `ENGINEERS_LIST_TITLE`, `ENGINEER_STATUS_ACTIVE` and `formatRegisteredLine` (already in §9) and **one new blank constant, `ENGINEERS_LIST_EMPTY`** (a project with no engineers must say something). The name and number are data, so **no column-heading constants are specified**; if a wording author wants headings, that is a new addition to §9, not assumed here.

## 6. The migration (slice 1)

- **File:** `048_engineer_registration.sql` (name **ASSUMED**). **Number 048** (`origin/main` ends at 047; reservations end at 048 "RELEASED, NEVER USED … free"); **ASSUMED still free at write time** (`CLAUDE.md:869-872`). Held in `docs/reviews/` until applied (`CLAUDE.md:947-952`).
- **What slice 1's migration contains (from the single-plan list at `eb8a9c2`, items (1), (2), (3), (4), (6)):** (1) **the CHECK `role IN ('pm','qs','engineer','owner','subcontractor','admin')` on `project_members.role`** (D8/D11); (2) **three attribution columns on `users`** — `registered_by`, `registered_at`, `consent_attested` — with their pairing CHECK and composite same-tenant FK (~~five, then seven, columns incl. `deactivated_*`/`reactivated_*`~~ — **not created**, D10 reversed, §2.8); and, unchanged because they never depended on the index, (3) the internal helper, (4) `add_engineers_to_project`, (6) their ACLs (§2.7) — for the functions that exist in slice 1. **(2b) the `engineer_episodes` table, (5) `deactivate_engineer` and (5b) `reactivate_engineer` are slice 2.** *(The single-plan sentence "The reviewer signed off on the five-column design" is in slice 2 §6.)*
- ~~(2) the partial index `uq_project_members_one_engineer_project ON public.project_members (user_id) WHERE role = 'engineer'`, "not `CONCURRENTLY`", and "sequencing constraint (D12): the fixture change must land before the migration is applied to test-db"~~ — **struck (rev6 #2):** the index is in the future slice (§4.8); there is no fixture change.
- **`UNIQUE (project_id, user_id)` (`001:79`) is unchanged.** ~~"`UNIQUE (project_id, user_id)` is insufficient… Partial, because PMs hold `pm` memberships on many projects"~~ — that argument was for the index and moves with it.
- **If prod has rows the CHECK would reject** (a role outside the six, or a case/space variant): it fails and the whole file aborts with no change (query `n2`). ~~"the index fails `23505` (query `e`)"~~ struck. Test-db: probe x2 — 0 rows.
- **Review gate (`CLAUDE.md:192-205`) clearly tripped** (a, b, c; a `DROP COLUMN` in the DOWN is destructive (d)). Required evidence: anon-key call refused `42501` (`CLAUDE.md:934-942`); `service_role` denial on the **real** database; ACL / `proowner` / `proconfig` for ~~**all four** functions (helper + `add` + `deactivate` + `reactivate`)~~ **the helper and `add_engineers_to_project`** (rev10; slice 2 adds the other two); disposable local dry-run first (`CLAUDE.md:1020-1030`); rehearsal on the cleaned test-db (`CLAUDE.md:74-78`).
- **DOWN:** drop the function(s), the CHECK, the ~~five~~ **three** columns (rev10: rev9 reduced `users` to three; the earlier wording was stale) (~~and the index~~); commented per `down-section-must-be-commented` (`CLAUDE.md:1135-1139`, `scripts/lint-migrations.mjs:547-552`) and **rehearsed** (`CLAUDE.md:1120-1128`); dropping the columns destroys attribution data.
- **Deploy order (rev8, §4.9): MERGE is the deploy.** 048 → **test-db** → CI green (pinned run URL, `headSha` = PR HEAD) → 048 → **prod** → **THEN merge**; rollback = **revert commit (merged) first, then the DOWN**. ~~rev7: "048 lands on test-db and prod BEFORE the app change deploys"~~ — the event is the merge, not a deploy step this repo can show.
- **After apply:** regenerate `types/database.ts` (`CLAUDE.md:853-858`); one file at a time via `supabase db query --linked -f`, foreground, never `db push` (`CLAUDE.md:156-160`); confirm the file is on `origin/main` and test-db carries it (`CLAUDE.md:142-146`).

### 6.1 Deploy order — MERGE is the deploy (moved here verbatim from §4.9 in rev10; slice 2 §4.9 points here and keeps only its own dependency paragraph)

*Slice 1 note (rev10): in slice 1 the app-side dependencies on 048 are the `add_engineers_to_project` RPC and the three `users` columns — an app merged before 048 fails on the missing function, the same class. ~~The sentences about the board and `engineer_episodes` describe slice 2's dependency and are kept verbatim.~~ **rev11: those sentences are struck below; they live in the episodes plan §4.9.***

**Deploy order — MERGE is the deploy (rev8; the dependency widened in rev9).** The event that matters is **merging to `main`**: the repo has **no deploy step** (`ci.yml` runs checks on `pull_request` and `push` to `main`, `:30-34`; `vercel.json:1-24` holds cron entries only), and records the fact repeatedly — "Vercel deploys on merge to `main`, so merging is the deploy" (`035-lockstep-runbook.md:162-164`); "merging to `main` deploys, full stop" (`2026-q3-week-4-migrations.md:519-523`); the 023 incident (`2026-q3-weeks-1-2.md:647-656`).
~~**The board now reads `users.status` (existing) and `engineer_episodes` (new).** Against a database without the table PostgREST rejects the read; the board returns `{ status: 'error' }` (`query.ts:173`) and **both** Daily Logs (`daily-logs/page.tsx:101-102`) and Today (`dashboard/page.tsx:128-130`) render their error state (the mechanism of rev7 probe pg_7, same class).~~ **Slice 1's dependency (rev11):** an app merged before 048 fails on the missing `add_engineers_to_project` function and the three `users` columns (the same mechanism as rev7 probe pg_7). **Order:** (1) apply 048 to **test-db** — foreground, one file, never `db push`, ref named per `CLAUDE.md` §0; (2) **CI green on the app PR against that test-db, pinned run URL, `headSha` = the PR's current HEAD** (`CLAUDE.md` §0); (3) apply 048 to **prod** — Aravind's go-ahead in the same exchange, PITR observed; (4) **THEN merge**; (5) verify on the **production deployment**. Steps 1–3 are safe with the old app serving: the migration is additive and its objects unused until the app lands. **Rollback: revert commit first (merged, deployed), THEN the DOWN** — the DOWN first drops ~~a table the deployed app still reads and takes both boards down. The DOWN also **destroys episode history** (§6)~~ the function and columns the deployed app still calls, so the add screen fails (the episodes-table version of this sentence is in the episodes plan §4.9 and §6). Vercel's "promote previous deployment" was not read and is not relied on.
**Preview deployments — what the repo can and cannot show (rev9 item 3).** *Printed (rev9 log):* `vercel.json` has crons only; there is **no `.vercel/`** and **no `VERCEL_ENV`/`VERCEL_URL`/`VERCEL_GIT` use** in `app`, `lib`, `components`, `proxy.ts`, `next.config.ts` or the instrumentation files (grep); the only env file in the repo is `.env.test.example`, holding four **test-only** names; the docs say the Preview-scoped Supabase variables are scoped to "All Preview Branches" (`env-and-stack-decisions.md:96-110`) but **never say which project they point at**; `020-review-package.md:267` ("test-db — PREVIEW badge visible") is ambiguous. Vercel's own page (rev7 log): crons call "your project's production deployment URL", so **Previews never run a cron and never send**. **Conclusion: which database a Preview reads cannot be determined from the repo.** **What it means either way:** a Preview built from the app branch **before 048 reaches its database** would ~~render both boards' error state~~ fail on the missing function and columns (slice 2 adds the boards' error state, episodes plan §4.9) (build-time is unaffected — `env-and-stack-decisions.md:105` — so the PR's Vercel check stays green while the runtime is broken). That does **not** change the production order (merge is still the only event that reaches production users), but it changes two things: **a Preview visit is no evidence of 048's state, and step 5 must be verified on the production deployment, never a Preview**; and if the Preview environment holds the **prod service-role key**, unreviewed PR code runs with it. **What Aravind must check in the Vercel dashboard** (Project → Settings → Environment Variables): for `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` at **Preview** scope, read only the **host** of the URL — `exfccwlrhoutkgrlikod` = test-db, `jvxwqignooseazzmwhvl` = prod (public path components, `CLAUDE.md` §0) — and never paste a key; and whether Preview deployments are enabled for non-`main` branches. Kept as UNKNOWNS #33.
**Grants:** no new GRANT on `users` (probe pg_6: table-level `SELECT`, 17 of 17 columns; this slice now adds **three** columns to it). **`anon` also holds table-level `SELECT` on `users` — a KNOWN GAP, §4.10 (N1).**

## 7. Positive controls (slice 1)
"Shown to fail" = a captured red run, then the fix, then green. Red variants of the function run on the **disposable local scaffold** (`CLAUDE.md:1020-1030`), never on test-db or prod.

### 7.1 Tests

| # | Asserts | How it is shown to FAIL first |
|---|---|---|
| **T1** | A caller with `users.tenant_id` **NULL** is refused, nothing written, both modes. **Fixture: `role='admin'`, `tenant_id` NULL, real `auth_id`** (constructed; test-db's 3 NULL-role stubs would not exercise it). Expected `no_data_found`. | **Red against a `<>` comparison first:** scaffold variant `IF project.tenant_id <> caller.tenant_id` — `NULL <> uuid` is NULL, the guard does not fire, the engineer is written into the **project's** tenant → fails. Then `IS DISTINCT FROM` → green. |
| T2 | *(folded into T6)* | |
| ~~T3~~ | ~~A second `role='engineer'` membership for the same user on another project is rejected `23505` naming `uq_project_members_one_engineer_project`~~ — **struck (rev6 #3): tests the dropped index.** Moves to the future slice. | |
| ~~T4~~ | ~~`admin` with `pm` memberships on P1 and P2 unaffected; `pm` on P1 + `engineer` on P2 allowed by the index~~ — **struck (rev6 #3): depended on the index.** Its consequence ("allowed is not works") is kept in §4.8. | |
| **T5** | A **tenant-B engineer's number** classified by a **tenant-A admin** (dry-run) returns `number_registered`; the row has **exactly the keys `idx, status`**; the serialised payload contains **no** tenant-B project id, project name, or full name — asserted **on the payload**. A tenant-B engineer with **no membership** also returns `number_registered`, never `registered_no_project`. In-tenant: `on_another_project` (`other_project_name`, no id/full name), `registered_no_project` (`idx, status`). | Mutations: (i) leak name/full_name/project id cross-tenant → fails; (ii) classify only within the caller's tenant → cross-tenant number returns `ok` → fails; (iii) return `registered_no_project` cross-tenant → fails. |
| **T6** | **One shared fixture matrix (§7.2), run twice:** against the **TypeScript gate** and the **SQL function**; both return the expected verdict on every row and agree. | Mutate each side separately (membership-only rule) → the `qs`-with-`pm`-membership row fails on that side; mutate one side → the agreement assertion fails. |
| **T7** | **Dry-run writes nothing.** After a dry-run that returns `ok` verdicts, row counts of `users` and `project_members` are unchanged; asserts ≥1 `ok`. | Mutation: let dry-run fall through to step 7 → counts change → fails. |
| **T8** | An unauthorised caller's dry-run gets an error, **not** statuses. | Mutation: move step 5 before step 3 → statuses leak → fails. |
| **T9** | **Shape and round-trip.** The validator over the §3.3 corpus **generated from `TEST_BOUNDARY_PHONE_LITERAL` by formatting and mutation only**; accepted → the stored form, fixed point under `normalisePhoneNumber`; the function accepts the generic shape, rejects malformed. | Red: pin `normalisePhoneNumber('abc')` → `'+abc'` (`normalise.ts:42`), assert the validator rejects. Mutation: store raw input → round trip fails. |
| **T10** | **Explicit columns, attribution, consent.** (a) Read-back: `tenant_id`, `role='engineer'`, `status='active'`, `messaging_blocked=false`, `auth_id IS NULL`, **`registered_by` = caller's `users.id`, `registered_at` non-null and equal across a call's rows, `consent_attested` = the value passed**; membership `role='engineer'`, same tenant. (b) **Source guard**: the `INSERT INTO public.users` column list contains all of them. | Mutations: drop `registered_by` → (a),(b) fail; write `auth.uid()` → (a) fails; drop `status` → (b) fails. |
| **T12** | **Copy is filled.** Every export of `lib/engineers/copy.ts` is non-empty. | **Expected-fail at commit** (`it.fails`): blank → assertion fails → test passes; when the copy PR fills them the wrapper goes red. **Verified** on vitest 3.2.7 (scratch dir, re-run in this log): blank → PASS, filled → FAIL, control PASS. No live `it.fails` exists in `test/` (grep f2). |
| **T13** | **Boundary test** (§7.3): one literal through the function in apply mode; read back; cleaned up. | Function absent → fails. |
| **T14** | End state: after adding one engineer, `resolveEngineerProject` returns `resolved` and the morning roster includes them. | Function absent → `zero_memberships`. |
| **T15** | Two concurrent adds of one number: exactly one wins. | **NOT VERIFIED LOCALLY, CI-ONLY** (`CLAUDE.md:478-486`). |
| **T16** | **ACL evidence** on the real test-db for ~~**all four** functions~~ **the helper and `add_engineers_to_project`** (rev10: slice 1; slice 2 extends the same evidence to `deactivate_engineer` and `reactivate_engineer`, T41): anon → `42501`; `service_role` denied; `authenticated` may call the public function (~~the three public functions~~ — slice 1 has one)  and **not** the helper; `has_function_privilege` for `anon`, `authenticated`, `service_role`, PUBLIC; `proowner = postgres`; `proconfig` = `search_path=public`. | Before the REVOKEs, `service_role`/PUBLIC hold EXECUTE (probe n, `correct_daily_log`). |
| **T17** | Tenant-A admin with a tenant-B `p_project_id` gets `no_data_found` **identical** to a nonexistent id, zero writes. | Mutation raising `insufficient_privilege` for foreign ids → fails. |
| **T18** | **Atomicity.** Row K fails after step 5 → **zero** new rows. | Mutation: per-row `EXCEPTION` sub-blocks → earlier rows persist → fails. |
| **T19** | **The CHECK.** On test-db, inserting a `project_members` row with role `'Engineer'`, `'engineer '`, `'ENGINEER'` or a value outside the six is rejected `23514`; each of the six valid roles succeeds. ~~"a second `'engineer'` membership is still caught by T3"~~ struck. | Natural red: **before** the migration those inserts succeed (probe h; probes j/k) → fails. |
| **T20** | **Consent is recorded, not enforced.** `p_consent_attested = false` (and NULL) does not block apply; stores `false`; `true` stores `true`. | Mutation: raise on false → fails; skip writing the column → read-back fails. |
| **T21** | **Boundary-literal source guard.** In `test/`, `+91` followed by a digit appears **only** in `test/helpers/boundary-phone.ts`; the boundary test imports `test/helpers/db.ts`, imports **no** module under `lib/whatsapp/outbound/` or `app/api/cron/`, and creates its fixture project with `status <> 'active'`. | Mutation: second `+91` literal / import `send.ts` / `active` project → fails. |
| ~~T22~~ | ~~Existing-fixture acceptance (D12): the 7 files pass on a DB carrying the index~~ — **struck (rev6 #3):** no index in this slice, no fixture change; moves to the future slice. | |
| **T44** | **The engineers list page is read-only and shows what landed (D21).** (i) **Source guard:** the page module imports no server action and contains no `<form>`, `<button>` or `onClick`; no `actions.ts` sits beside it; every string it renders is a `lib/engineers/copy.ts` export or data. (ii) After an apply of N rows (the T7/T10 fixture), the page's data function returns **exactly the N added engineers** with name, stored number and `registered_by` / `registered_at` / `consent_attested` equal to T10's read-back. | (i) Mutation: add a `<form>`, or import an action → fails. (ii) **Natural red:** the page / data function absent. |

### 7.2 The shared T6 matrix (one data table, two runners)
| # | role | tenant | membership | expected | shape exists in prod? |
|---|---|---|---|---|---|
| 1 | admin | same | none | allow | yes |
| 2 | admin | same | pm | allow | **yes — the real PM shape** |
| 3 | pm | same | pm | allow | **no — fixture-only** (no `users.role='pm'`, probe t) |
| 4 | pm | same | none | not_permitted | fixture-only |
| 5 | pm | same | engineer only | not_permitted | fixture-only |
| 6 | qs | same | pm | not_permitted | fixture-only |
| 7 | engineer | same | pm | not_permitted | fixture-only |
| 8 | NULL | same | pm | not_permitted | pre-onboarding stub shape |
| 9 | admin | other tenant's project | none | not_found | yes |
| 10 | admin | caller tenant NULL | none | not_found | constructed |
| 11 | admin | project id nonexistent | — | not_found | yes |
**No conclusion may rest on rows 3–8 alone; rows 1, 2, 9, 11 exist for real.**

### 7.3 The boundary literal, and the fixture gap
**`TEST_BOUNDARY_PHONE_LITERAL = '+919176861156'`** — one named constant in one file, `test/helpers/boundary-phone.ts`, swappable in one edit. **No other `+91` value is minted anywhere.** Checked in the log: 13 characters; matches the India stored form and the generic shape; a fixed point of `normalisePhoneNumber`; equals what the webhook would compute from `whatsapp:` + the literal.
**Fixture gap (limit):** DB fixtures are `+1…` (`test/helpers/db.ts:43,112,132-134,233`): 1,868 × 14 digits and 2 × 11 digits (probe g), none `+91`; the **one** boundary test drives the literal directly.
**The three confirmations, from printed output:**
1. **Test-db only — SHOWN at the harness level:** `test/setup/guard.ts:9-61` aborts the run unless the ref is `exfccwlrhoutkgrlikod`, wired as `globalSetup` (`vitest.config.ts:31`); `vitest.config.ts:9` loads only `.env.test`; `db.ts:205-207,953-955` build clients from `SUPABASE_TEST_*`, and `db.ts:26-28` says tests avoid the app env names because they "could resolve to production". The boundary test does not exist yet; T21 guards it uses `db.ts`.
2. **No row with this number exists on test-db — SHOWN** (probe v): 0 in `users`, `whatsapp_sessions`, `outbound_sends`, `processed_messages`.
3. **No real Twilio send — SHOWN for every path in the repo and database; NOT shown for deployed-environment configuration; neutralised structurally.** *Shown:* probe w — no triggers on `users`/`project_members`/`projects`, no `pg_net`/`pg_cron`/`http` (only `supabase_vault`); only two modules send (`trigger.ts:206`, `owner-deliver-dispatch.ts:503`); the engineer path is reached only via `runCheckpointTrigger` → `fetchActiveProjects` → roster (`checkpoint-trigger.ts:226-233`, `roster.ts:285-288`) started by `CRON_SECRET`-authorised cron routes (`morning-trigger/route.ts:29-36`); `readCredentials` throws unless all three `TWILIO_*` are set (`send.ts:154-176`); the real `.env.test` holds the **name** `TWILIO_AUTH_TOKEN` only (names, never values) and outbound tests stub fake credentials and mock `fetch` (`outbound-trigger.test.ts:173-181`); Vercel's documentation (re-fetched into this log, page last updated 2026-09-16): "…makes an HTTP GET request to your project's production deployment URL…". **Structural neutraliser (T21):** the boundary test's fixture project has `status <> 'active'` (probe z: the CHECK allows `on_hold`), so the roster never loads it.
   *Not shown:* that the deployed Production environment's variables do not point at test-db, and that no other scheduler calls the cron routes with the secret (Vercel dashboard, unreadable from here). Not blocking, because the non-active-project rule removes the path regardless; **if Aravind disagrees, treat (3) as blocking.** Limit: concurrent CI runs collide on `UNIQUE (whatsapp_number)`; surfaces as R7 (**ASSUMED** tolerable).

## 8. RLS (slice 1)

Live (probes j, k, o): `users` — `users_select` (own or same tenant), `users_update` (own row; column grant `full_name, avatar_url`, `015:105`); no INSERT/DELETE policy, `authenticated` lacks both (`015:114`). `project_members` — select tenant-scoped; insert/update require tenant match AND `users.role IN ('pm','admin')` **with no condition on the inserted row's `role`** (§4.5); no DELETE policy (`047:230`). Both tables owned by `postgres`, RLS on, **not forced**. ~~**The four functions (helper + three public) bypass RLS**~~ **The two slice-1 functions (the helper and `add_engineers_to_project`) bypass RLS** (rev10; slice 2 adds `deactivate_engineer` and `reactivate_engineer`, same posture); the gate is re-stated inside (§1). Still enforced regardless of RLS: composite FKs (`017:94-106`), `UNIQUE (whatsapp_number)`, `UNIQUE (project_id, user_id)` (`001:79`), `users_role_check`, `users_status_check`, the new CHECK, the pairing CHECKs. Cross-tenant: tenant is never an input (§2.4).

## 9. Strings (slice 1) — every value blank; Aravind writes all wording

No wording is drafted anywhere in this document. **Every value is blank and carries `// Wording owed, NOT approved`** (`Tamil owed, NOT approved` means approved English awaiting Tamil, `lib/photos/copy.ts:3-6`; not these). Home: `lib/engineers/copy.ts` (new). **rev6 removes none and adds none:** I checked every rejection case R1–R8 and every constant against the dropped index — **none existed only because of it** (R5–R7a are lookups on the number, `001:44`); the only index-dependent text was in prose.

**No slice-1 string may imply that a removal or undo path exists (rev10).** Slice 1 ships with no deactivate, no undo and no way to free a number (see the top of this document), so **no constant, formatter or error text here may say or suggest that an engineer can be removed, **edited**, switched off, undone or "fixed later from the dashboard".** This binds the wording author for, at least, `ADD_ENGINEERS_PAGE_INTRO`, `ADD_ENGINEERS_FORMAT_HELP`, `ADD_CONSENT_ATTESTATION`, the confirm text (`ADD_CONFIRM`), `RESULT_ROW_ADDED`, `ENGINEERS_LIST_TITLE`, `ENGINEERS_LIST_EMPTY`, **every string on the engineers list page (§5.1)**, and every rejection text (a rejected number is *not registered*; nothing is undone). `ADD_ENGINEERS_EDIT_BUTTON` edits the **pasted text before apply** — it must not read as editing a registered engineer.

**Formatters, after `formatKeptUntilLine`** (`lib/photos/copy.ts:23-46`: exported function, **named positional parameters**; **ASSUMED positional**): `PREVIEW_SUMMARY` → `formatPreviewSummary(accepted, rejected)`; `RESULT_SUMMARY` → `formatResultSummary(added)`; `REJECT_NAME_TOO_LONG` → `formatRejectNameTooLong(max)`; `ERROR_PASTE_TOO_LONG` → `formatErrorPasteTooLong(max)`; `ADD_CONFIRM` → `formatAddConfirm(count)`; `REJECT_ON_ANOTHER_PROJECT` → `formatRejectOnAnotherProject(projectName)` (in-tenant only); `formatRegisteredLine(registeredByName, registeredAt, consentAttested)`.
**Constants (blank):** `ADD_ENGINEERS_PAGE_TITLE`, `ADD_ENGINEERS_PAGE_INTRO`, `ADD_ENGINEERS_FORMAT_HELP`, `ADD_ENGINEERS_TEXTAREA_LABEL`, `ADD_ENGINEERS_PREVIEW_BUTTON`, `ADD_ENGINEERS_APPLY_BUTTON`, `ADD_ENGINEERS_EDIT_BUTTON`, `PREVIEW_ROW_ACCEPTED`, `PREVIEW_ROW_REJECTED`, `REJECT_NO_NAME`, `REJECT_BAD_NUMBER`, `REJECT_DUPLICATE_IN_PASTE`, `REJECT_ALREADY_ON_THIS_PROJECT`, `REJECT_NUMBER_REGISTERED` (generic; the only rejection ever used cross-tenant), `REJECT_REGISTERED_NO_PROJECT`, `PREVIEW_NOTHING_TO_APPLY`, `RESULT_ROW_ADDED`, `ERROR_BATCH_NOT_APPLIED`, `ERROR_PROJECT_NOT_FOUND`, `ERROR_NOT_ALLOWED`, `ERROR_PASTE_EMPTY`, `ERROR_GENERIC_SAVE`, `PROJECT_PAGE_ADD_ENGINEERS_LINK`, `ENGINEERS_LIST_TITLE`, `ADD_CONSENT_ATTESTATION`, `ENGINEER_STATUS_ACTIVE`, **`ENGINEERS_LIST_EMPTY` (rev11)**. **Removed earlier (kept):** ~~`RESULT_ROW_RACE`~~, ~~`RESULT_ROW_FAILED`~~, ~~`RESULT_ROW_FAILED_NEEDS_SUPPORT`~~. **Existing approved strings (reference, do not copy):** `route.ts:55-62`; `project-resolution.ts:71-72`, `:74-75`; `hindrances/actions.ts:24` (not exported, not reusable). **T12** asserts every export is non-empty (expected-fail at commit).

## 10. Pre-flight result (test-db `exfccwlrhoutkgrlikod`; full output in the log)
The log prints `CONFIRMED: project ref reads exfccwlrhoutkgrlikod (test-db)`. All read-only.
| Probe | Result |
|---|---|
| ~~(a) users with >1 `project_members` row~~ | 0 rows — **no longer gating** (was for the index) |
| (b) engineer users by status | 1,872 `active` |
| (c) engineers missing tenant or whatsapp | **2** (whatsapp NULL — probe m) |
| (d) `users.status` | `text`, default `'active'::text`, NOT NULL |
| ~~(e) index-predicate violations~~ | 0 rows — **no longer gating** |
| (f) `project_members` | 2 rows, both `engineer` |
| (g) stored phone shapes | 1,868 × `+`14 digits, 2 × `+`11 digits, zero `+91` |
| (h) live constraints | `users_role_check` = the six-role set; no CHECK on `project_members.role`; `UNIQUE (project_id, user_id)` present |
| (i–l) indexes, policies, grants, nullability | as cited |
| (n) definer inventory | 15 functions, owner `postgres`, all `search_path=public` |
| (o) owner / RLS forced | `postgres`, on, not forced |
| (p) `get_user_tenant_id()` | `SELECT tenant_id FROM users WHERE auth_id = auth.uid()` |
| (q) phone CHECKs | only `outbound_sends_to_phone_number_check` |
| (r, s) columns | no actor column; only `tenants.registered_address` |
| (t) role distributions | `project_members`: 2 × `engineer`; `users`: 10 admin, 3 NULL-role, 1,872 engineer, all `active`, no `pm` |
| (v) boundary literal presence | **0** in all four tables |
| (w) triggers / extensions | none on the three tables; only `supabase_vault` |
| **(x2) six-role-set violations / case-space variants / total** | **0 / 0 / 2** |
| (z) orphans; projects | **1,870** engineers with no membership vs 2 with; 14 projects, all `active` |
| **pg_5** D9/D10 columns on `users` | **none exist** (0 rows) |
| **pg_6** `SELECT` on `users` | table-level for `authenticated` and `anon`; 17 of 17 columns |
**Would the six-role CHECK apply cleanly on test-db? YES** (x2).

## 11. For Aravind — run against PROD (not run by me)
Read-only; confirm the project ref first.
```sql
-- (g) stored phone SHAPES, digits masked
SELECT role, regexp_replace(whatsapp_number, '[0-9]', '9', 'g') AS shape, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (n) DISTINCT project_members.role values, exact
SELECT role, count(*) AS n FROM project_members GROUP BY role ORDER BY role;

-- (n2) would the six-role CHECK apply on prod? any row here blocks it
SELECT role, count(*) AS n FROM project_members
WHERE role IS NULL OR role NOT IN ('pm','qs','engineer','owner','subcontractor','admin')
   OR role <> lower(btrim(role))
GROUP BY role ORDER BY role;

-- (r) country-code prefix and length only
SELECT left(whatsapp_number, 3) AS prefix, length(whatsapp_number) AS len, count(*) AS n
FROM users WHERE whatsapp_number IS NOT NULL GROUP BY 1, 2 ORDER BY 1, 2;

-- (u) do registered_* / consent_attest* / deactivat* columns already exist on prod?
SELECT table_name, column_name FROM information_schema.columns
WHERE table_schema = 'public' AND (column_name ILIKE 'registered%' OR column_name ILIKE 'consent_attest%' OR column_name ILIKE 'deactivat%');

-- (v) users by role and status
SELECT coalesce(role, '<NULL>') AS role, status, count(*) AS n FROM users GROUP BY 1, 2 ORDER BY 1, 2;

-- (w) engineers on prod with NO project membership (~~the F3 dead-end population~~ the R7a population — F3 is in the lifecycle plan §2.9)
SELECT count(*) AS orphan_engineers FROM users u
WHERE u.role = 'engineer' AND NOT EXISTS (SELECT 1 FROM project_members pm WHERE pm.user_id = u.id);
```
~~(a) users with more than one `project_members` row~~ and ~~(e) the exact index predicate~~ — struck (rev6 #2): they gated the index. They return with the future slice (§4.8).

## 12. File list (slice 1)

**Created (later build slice, not by this plan):** `docs/reviews/048_engineer_registration.sql` (moves to `supabase/migrations/` only at apply), `docs/reviews/048-review-package.md`; `app/(dashboard)/projects/[id]/engineers/new/page.tsx` and `actions.ts`; `app/(dashboard)/projects/[id]/engineers/page.tsx` (**read-only, D21**; route **ASSUMED**) ~~and `actions.ts`~~ (no actions in slice 1; slice 2's controls add one) (the add screen's `engineers/new` route and its `actions.ts` are unchanged); `lib/engineers/parse-roster.ts`, `gate.ts`, `add-engineers.ts`, `copy.ts`; tests per §7, `test/helpers/engineer-gate-matrix.ts`, **`test/helpers/boundary-phone.ts`**, `test/migration-048.test.ts`.
**Modified (build slice, slice 1):** `scripts/migration-number-reservations.json`; `docs/build-status.md`; `docs/schema.md` (only the `role TEXT NOT NULL` line goes stale, `:127`); `types/database.ts` (regenerated); `app/(dashboard)/projects/[id]/page.tsx` — one optional link. **No existing test file is modified** (D12 = Option D) — ~~the 7 files in §4.7~~ stay as they are.
**rev8 — modified (slice 1):** **`scripts/lint-migrations.mjs`** and **`scripts/migration-lint-exceptions.json`** (S1, its own earlier commit, §4.10), `docs/build-status.md` (the D12 rider and N1 backlog entries, filed by the build slice), `docs/reviews/048-review-package.md` (must record the deploy order and "the add screen is now that app logic"). **Not touched by this plan or the slice:** anything under `app/api/whatsapp/`, `lib/whatsapp/`, `lib/auth/`, or any existing migration; **under `lib/daily-logs/`, nothing in slice 1** (~~only `query.ts` and `status.ts` (D13)~~ — that is slice 2); `is-project-pm.ts` and `normalise.ts` are imported, not edited. ~~**This revision's diff:** exactly `docs/plans/add-engineer-plan.md`.~~ (rev10: the split's diff is exactly `docs/plans/add-engineer-plan.md` and `docs/plans/engineer-lifecycle-plan.md`.)

## 13. Plan split — DONE (rev10)

~~**REQUIRED BEFORE THE BUILD PACKAGE — split this plan (rev9; NOT done in this pass)**~~ **Done in rev10** — but not into the seven files rev9 proposed: **Aravind decided the slice itself is too large to review or ship as one piece, so the plan was split into two by content**: this document (slice 1) and ~~`docs/plans/engineer-lifecycle-plan.md` (slice 2)~~ **slice 2, which rev11 split again into `docs/plans/engineer-lifecycle-plan.md` and `docs/plans/engineer-episodes-plan.md`.** See the header of each for what it contains, what it does not, and the dependency. The `file-size-lint` WARN for the single plan no longer applies; each document is reported at the commit. Every decision, finding, test and UNKNOWN is mapped to its destination in the rev10 log (`add-engineer-plan-rev10.txt`).

## Decisions (slice 1)

| | Status |
|---|---|
| D1, D2/D5, D3, D4, D6, D7, D8, D9, D11 | **settled** |
| ~~**D10**~~ record who deactivated and when, on `users` | **REVERSED (rev9, Aravind):** `deactivated_by/at` are not created; episodes record it (§2.8). External review had signed off on the five-column version — **the design changed after that sign-off.** |
| **D12** the partial unique index and the 7 broken test files | **settled (rev6): Option D — the index leaves this slice; no fixture reshaped; named future slice (§4.8)** |
| **D16** (rev8) S1 lint extension (b): also catch `<col>_id = auth.uid()` (`002:180,188,195`) | recommended, not required; the instruction specified the `users … id` form (§4.10). |
| **D21** (rev11) the engineers list page is slice 1, read-only (settles UNKNOWNS #45) | **SETTLED (Aravind, rev11): §5.1.** No actions — slice 1 has no deactivate. It exists because an admin who pastes fifty names needs to confirm what landed; it becomes the host for slice 2's controls. No string on it may imply a removal, edit or undo path. |

## UNKNOWNS (slice 1)

**Not determinable from printed source or the test database:**
1. **Prod state.** Queries n/n2 (roles; CHECK violations); prod phone shapes (Aravind reports one row, `+91`, n=1 — not in this log, unverified by me); users by role; orphans (w); ~~deactivated-user sessions (y);~~ whether prod already has the new columns (u).
2. **What Twilio actually sends in `From`.** Only `normalise.ts:4` and fixtures (`test/webhook.test.ts:263`).
3. **Prod/test-db parity for 048's target.** Probes ran on test-db only.
4. **Whether `projects.status` should gate adding engineers.** None designed.
6. **Deployed Production environment variables and any other scheduler** — not readable from here; neutralised, not proven (§7.3).
7. **Rate limiting across calls.**
9. **Apply-time owner.** That the apply role yields `postgres`, as all 15 existing functions.
10. **Whether any path creates `users.role='pm'`.** g8 found none; a pattern search cannot see live data.
12. **My reading of "parsing"** (rev3 instruction A): validating jsonb elements in the function; raw-text parsing stays in TypeScript.
13. **"In the payload" (T10)** read as the insert payload.
14. **Attribution design details** (composite FKs, `ON DELETE`, pairing CHECKs, visibility) — recommendations, not rehearsed.
15. **`photo-access-route.test.ts:41` / `db.ts:27-28`** — I read only the comment lines.
16. **`it.fails` after a vitest upgrade** — verified on 3.2.7 only.
17. **Whether `consent_attested` as a boolean matches intent.**
18. **Exact digits of the T9 corpus** (derived from the literal) — designed, not built.
19. **Whether my whole-suite scan of `project_members` writes is exhaustive** (§4.7): it reads `.from('project_members').insert/upsert`, SQL `INSERT INTO project_members`, four wrapper helpers and loops; a differently-named helper could hide another site. The future slice must re-scan.
20. **The "59 tests" figure is derived from reading, not observed** (§4.7, rev6 #4); the future slice's first step is a real red run against an index-carrying scaffold.
28. **Whether `scripts/lint-migrations.mjs` can host a unit-testable rule.** `main()` runs unconditionally at import (last line); the slice must guard it and export the rule (**ASSUMED**); the final exception count is fixed only by the statement-scoped run, not by my line-level grep.
33. **Which database Preview deployments read — UNDETERMINABLE from the repo** (evidence and consequence in §6.1, moved from §4.9). **Aravind must check in the Vercel dashboard:** Preview-scope `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` — read only the host of the URL (`exfccwlrhoutkgrlikod` test-db / `jvxwqignooseazzmwhvl` prod), never paste a key — and whether Preview deployments are enabled for non-`main` branches.
34. **Vercel "promote previous deployment"** as an app rollback — dashboard feature, not read, not relied on.
36. **The D12 rider is not yet filed** in `docs/build-status.md` — this pass may edit only the plan (§4.10).
37. **No database query was run in rev8 or rev9**; every database statement cites the rev7 probes. ~~Nothing about `reactivate_engineer`, the classifier, the report or the episodes table was executed.~~ Nothing about `add_engineers_to_project`, the classifier's slice-1 outcomes, the validator or the engineers list page was executed.
44. ~~**The plan split (§13) is not done** and `file-size-lint` will keep printing the WARN until it is.~~ **DONE in rev10** — the plan is now two documents (§13); this item is closed.
**Assumed:** migration number 048 still free and the file name; routes `projects/[id]/engineers[/new]`; TypeScript gate and SQL function stay in agreement (T6 tests, does not prove); `supabase-js` `rpc` distinguishes `no_data_found` from `insufficient_privilege`; T15 un-testable here; no in-flight bot session depends on the new functions; colliding CI runs on the boundary literal are tolerable; the default `ON DELETE` on attribution FKs is right.
45. ~~**Whether slice 1 includes a read-only engineers list page** (`ENGINEERS_LIST_TITLE`, `ENGINEER_STATUS_ACTIVE`, `formatRegisteredLine` stayed in slice 1 §9 by content …). Placement **ASSUMED**, not decided.~~ **SETTLED (rev11): D21, §5.1** — read-only, in slice 1.
46. **Slice 1 alone: how long a mistyped number keeps receiving check-ins** depends on when slice 2 lands; until then only manual SQL removes it. Not estimated.
47. **How the list page shows a non-active row (UNKNOWNS #45's residue).** Slice 1 has `ENGINEER_STATUS_ACTIVE` but no `ENGINEER_STATUS_DEACTIVATED` (slice 2), and a non-active engineer can exist in slice 1 only through manual SQL; whether the page lists such rows, and how, is **not decided** (§5.1).
**Decisions still open (slice 1):** **D16** (recommended, not required). *(D14, D17–D20 are slice 2; D15 is settled there.)*
