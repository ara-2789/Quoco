# Add-engineer plan — dated corrections history, rev3–rev10 (moved verbatim)

> **Moved in rev12** from `docs/plans/add-engineer-plan.md` so that file stays under the 120,000-byte warn threshold (`CLAUDE.md` FILE SIZE LIMITS: split by content, keep the original as the index). **Nothing below was edited, reordered or dropped:** it is byte-identical to lines 60–144 of `git show 6455bde:docs/plans/add-engineer-plan.md` (the verification is in `~/Desktop/add-engineer-plan-rev12.txt`). References elsewhere such as 'rev6 #2' or 'rev8 S1' resolve here. The rev11 and rev12 blocks stay in the plan.

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

