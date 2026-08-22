# CLAUDE.md Rule Inventory — 2026-08-22

File: 167,825 bytes (`wc -c`), 2,517 lines (`wc -l`).
Method: standing rules extracted by direct read of §0–§9 (lines 1–1054); §10
(lines 1055–2517, 100,271 chars, ~60% of the file) audited for any NEW
standing-rule declarations — none found (every "standing rule"/"hard rule"
label in §10 is a cross-reference back to a rule already stated in §0/§6/§7).
Narrative blocks below are computed on blank-line paragraph boundaries.

---

## PART A — STANDING RULES (79 total)

### §0 — HOW WE WORK (22 rules)
1. L20 — Never build multiple features in one prompt (one feature per session).
2. L21-22 — Plan first: list files/approach and wait for confirmation before writing code.
3. L23 — Use /clear between every task.
4. L24 — Commit after every working, tested feature before starting the next.
5. L25-26 — Explain any code the user doesn't fully understand until they do, before it's accepted.
6. L27-28 — If a request conflicts with a rule in this file/docs, STOP and flag the conflict; never silently resolve it.
7. L29-31 — If a fact (model name, library version, API shape) may have changed since training, say so and ask for verification rather than guessing.
8. L32-38 — Rollback mechanisms (backup/PITR/restore path) must be verified by direct observation before any dependent migration, never by trusting a checklist "DONE".
9. L39-53 — Every reviewer-package artifact is pinned to its exact source (`git show <sha>`, probe captures with query text, suite output with SHA + empty `git status --porcelain`), never retyped/paraphrased.
10. L54-74 — Rehearse migrations on a cleaned existing test-db, never a freshly-provisioned Supabase branch, until the fresh-branch replay bug is confirmed fixed (conditional; lapses on that confirmation).
11. L96-107 — A superseding PR must carry forward the superseded PR's open reviewer items as an explicit per-item LANDED/DEFERRED checklist; review packages must state which round was reviewed-with-changes vs. approved.
12. L108-124 — Review requests at 019+-tier open with a two-line repo-state header (`main @ <sha>`; migration list local/remote; last runbook executed + date).
13. L125-164 — Prod applies may use `supabase db query --linked -f <file>` instead of the SQL Editor, provided: (a) linked project ref printed fresh immediately before apply, (b) pre/post-apply hash comparison against an independently re-probed reference, (c) explicit human go-ahead in the same exchange, (d) a migration isn't "done" until its file is merged to `main` — confirmed by reading `main` directly.
14. L165-191 — `supabase db push` is never used against any database, test-db included; migrations are applied one file at a time via `db query --linked -f <file>` or the SQL Editor.
15. L192-205 — No database-altering command is ever backgrounded; any command with an interactive confirmation runs in the foreground with the confirmation reported before proceeding.
16. L206-219 — Application code changes and database-touching rehearsals are different risk tiers and must never be collapsed into one uninterrupted stretch of execution; put a separate checkpoint before any rehearsal step.
17. L220-319 — External review package required whenever a migration/PR (a) creates/modifies a live function's logic, (b) creates/modifies grants/RLS/SECURITY DEFINER status on an object, (c) touches auth/identity, (d) is destructive/irreversible, or (e) moves money — trigger is subject matter, not DDL shape; not required for purely additive/reversible changes touching none of these.
18. L320-338 — Before manually starting/seeding anything whose output a cron/scheduled job will later read, check whether that period's consumer window has already run, not just whether the trigger is ready.
19. L339-366 — Before submitting any package/plan for external review, audit every internal cross-reference and confirm every cited artifact (probe, section, script, output) actually exists; prefer stable name-based anchors and check new numbered labels against existing conventions.
20. L367-379 — Before merging, confirm the passing CI run's `headSha` matches the PR's current HEAD; a pass on an earlier commit certifies nothing about the one being merged.
21. L380-398 — Any claim about current state (PR status, file contents, whether something is built) is verified against `main`/the live database before acting on it, never trusted from a chat message, prior summary, or earlier round's notes regardless of recency.
22. L399-423 — For third-party account state (Twilio, Meta, Vercel, Supabase dashboard), the provider's own console is the source of truth — the repo only shows what the app is configured to reach, not what the account actually holds.

### §1 — WHAT IS QUOCO (1 rule)
23. L434 — Do not build Phase 2 (Tender Analyser, BOQ Estimator) now.

### §2 — SPINE vs FAST-FOLLOW (2 rules)
24. L445-446 — Build SPINE first; when asked what to build, answer from the SPINE list only.
25. L459 — Do not build FAST-FOLLOW items yet (listed in file).

### §3 — TECH STACK (3 rules)
26. L475 — Verify the exact Next.js version in package.json; do not assume.
27. L480-483 — Verify the current Claude model string against platform.claude.com/docs before Week 4; do not trust a carried-over string.
28. L524 — Verify the Tailwind major version in the repo.

### §4 — MULTI-TENANCY (8 rules)
29. L535-536 — Every table has a tenant_id UUID column except rate_catalog/rate_catalog_history.
30. L537 — Never query the DB without filtering by tenant_id.
31. L538 — Use `tenant_id`, never organization_id/org_id/company_id.
32. L539-540 — RLS enforced at the DB layer via get_user_tenant_id(); never rely on app-layer filtering alone.
33. L541-542 — Use the Supabase SSR client in server components/API routes; never the browser client on the server.
34. L543-544 — Never use the service role key client-side or in any route reachable without authentication.
35. L545 — All RLS policies verify tenant membership through auth.uid().
36. L546-548 — Cross-project scope: DASH views/DPR delivery scoped to the PM's project_members rows, not all tenant projects; owner DPR content is strictly single-project scoped.

### §5 — USER ROLES (2 rules)
37. L557-558 — Use role value 'owner' everywhere (not 'client').
38. L578-579 — Do not create auth.users entries for engineer/owner rows (auth_id stays null).

### §6 — CODING RULES (25 rules)
39. L586 — Always TypeScript; no `any` under any circumstances.
40. L587 — Generate DB types from the schema; do not hand-write them.
41. L601-603 — Regenerate `types/database.ts` after every schema migration (now active, no longer inert).
42. L606 — Every amount/rate/cost/value column is DECIMAL(12,2), no exceptions.
43. L607 — Never TEXT or FLOAT for money.
44. L610 — Status columns are always TEXT + CHECK constraint; never ENUM types.
45. L614-623 — Every numbered file in supabase/migrations/ is LIVE — never edit any of them; author new changes as the next unused number, confirmed via `ls supabase/migrations/` and `supabase migration list`, never a number carried over from memory.
46. L624 — Never edit schema directly in the Supabase dashboard.
47. L625-626 — Every table gets `id UUID PK DEFAULT gen_random_uuid()` and `created_at TIMESTAMPTZ DEFAULT now()`.
48. L628-661 — One-time migration statements targeting specific rows: destructive statements (DELETE/DROP) enumerate specific known IDs, never a general WHERE; additive idempotent statements (INSERT-only backfills) take a general predicate plus an in-transaction structural assertion and a pre-apply probe.
49. L662-716 — Every new function in the `public` schema requires an explicit per-role REVOKE by name (anon/authenticated/etc.) — `REVOKE ALL ... FROM PUBLIC` alone is not sufficient; same for new tables (state audience, bound grants explicitly, don't rely on RLS alone).
50. L696-703 — Post-apply catalog readback for any migration creating a new function/table must fingerprint the ACL of every new object, not just its definition.
51. L704-716 — A real anon-key call proving refusal (42501) is a required line in every future SECURITY DEFINER function's own review package, run proactively, not only when a gap is suspected.
52. L717-733 — A migration file enters `supabase/migrations/` only as part of the same commit/session that applies it, never earlier; until then it lives in `docs/reviews/`.
53. L736 — All /api/ routes require authentication.
54. L737 — Validate ALL inputs with Zod before processing.
55. L738 — WhatsApp webhook responds within 15 seconds.
56. L739-740 — All Claude API calls go through the jobs table; never called synchronously in the webhook handler.
57. L743 — Validate X-Twilio-Signature HMAC on every request; reject non-matching requests with 403.
58. L744-745 — Idempotency: dedupe on Twilio message SID; a repeated SID is a no-op (no duplicate rows/replies).
59. L746-747 — Media: download from Twilio, re-upload to Supabase Storage (tenant-scoped), store the Supabase URL; never persist a Twilio media URL.
60. L750 — Never hardcode a secret, key, token, or connection string in source.
61. L751 — Never console.log a key, token, or full auth header, even while debugging.
62. L752 — Never commit .env.local; secrets come from env vars only.
63. L755-756 — Wrap external calls in try/catch, return structured errors (never expose raw DB errors to the client), log to Sentry in production.
64. L759-760 — WhatsApp session state lives in `whatsapp_sessions`, never in memory.
65. L761 — SELECT FOR UPDATE on the session row before any state change.

### §7 — TESTING & VERIFICATION (14 rules)
66. L772-773 — A task is done only when code + its tests are written, tests are green, and it's committed; zero TypeScript errors (`tsc --noEmit` clean), no `any`.
67. L776 — A state-machine change ships with its T-SM unit tests.
68. L777 — A parser change ships with its T-PR tests.
69. L778-779 — A webhook change ships with the relevant T-WH integration test, including the forged-signature rejection (T-WH-01).
70. L780-782 — DPR generation work is not done until the eval harness golden-set cases pass (required deliverable, not optional).
71. L783-784 — An RLS change ships with a cross-tenant AND cross-project isolation test.
72. L785-792 — A state-loss regression fix ships with a test asserting the end state of the full realistic sequence, not just the targeted mechanism.
73. L794-827 — Every new migration gets a disposable dry-run before it enters a review package, built from a real `supabase db dump --dry-run` schema scaffold, not a hand-built one.
74. L829-846 — The dry-run scaffold must stub the `auth` schema (bare `auth.users` + `auth.uid()` returning NULL) and the standard Postgres roles by hand every time; anything else platform-specific is added to the stub list explicitly when it comes up, not silently assumed away.
75. L848-856 — The local Postgres used for the dry-run must match the server's major version (verified via `SELECT version()` against prod/test-db).
76. L870-871 — DB changes run against a Supabase branch first, never prod, confirmed error-free, before Aravind reviews.
77. L872 — Every change needs `tsc --noEmit` clean and `npm test` green for the touched area.
78. L873-875 — Bot flow changes are exercised end-to-end against the Twilio sandbox on a real handset before being called done.
79. L877-878 — If a test can't be written for something, say so and explain why rather than quietly skipping it.

### §8 — ENVIRONMENT VARIABLES (2 rules, folded into the count above as 78/79 boundary — see note)
- L884 — Never commit .env.local; NEXT_PUBLIC_ prefix only for browser-safe values. *(duplicate of §6 rule #62, listed here since §8 restates it explicitly — not double-counted)*
- L901 — All non-NEXT_PUBLIC_ env keys are used only in server-side API routes. *(counted as rule #79 above via renumbering — see raw count note below)*

**Raw count note:** the two §8 lines above are substantively distinct enough from §6 to count separately; the running total through §7 is 79, and §8 contributes 1 net-new rule (L901; L884 is a verbatim duplicate of #62 and is not double-counted). **Final total: 79 distinct standing rules.**

---

## PART B — NARRATIVE / INCIDENT BLOCKS (81 total, ~102,668 chars)

These are NOT standing rules — historical findings, incident write-ups, dated
status updates, one-off decisions, and closed items. Split candidates for a
future P3 pass, per the file's own P3 SCOPE CAPTURE entry (§10, L1568).

### Outside §10 (3 blocks, 9,926 chars)
1. L1-14 (858 chars) — File header/preamble comment block (doc pointers).
2. L75-95 (1,568 chars) — §0 "TEST-DB IS NOT CONFIDENTLY REBUILDABLE" — current-risk record, not an imperative rule.
3. L903-1011 (7,500 chars) — §8 CRON_SECRET provisioning narrative + INFERENCE TRAP note + KNOWN VERCEL CONFIG GAP + KNOWN SUPABASE AUTH CONFIG GAP + "SAME DEAD BRANCH, BITTEN TWICE" + SWEEP COMPLETE (all resolved/closed incidents).

### §10 — CURRENT BUILD STATUS (78 blocks, 100,242 chars = 100,271 char section total, minus 29 chars of heading/blank-line overhead not captured as blocks)
1. L1057-1063 (431 chars) — next 16.2.11 security patch heading + PR #11 note.
2. L1064-1065 (157 chars) — Re-evaluate/remove overrides when Next 16.3 stable.
3. L1067-1069 (216 chars) — Known gap: sharp override unverified at runtime.
4. L1071-1081 (538 chars) — Week 1: COMPLETE.
5. L1083-1120 (2,572 chars) — Week 2: IN PROGRESS (day-1 checklist).
6. L1122-1126 (368 chars) — NOTE: Supabase CLI migration tracking was out of sync.
7. L1128-1144 (1,343 chars) — OUT-OF-BAND DB OBJECTS registry.
8. L1146-1166 (1,485 chars) — SECURITY INCIDENT — anon-callable SECURITY DEFINER RPCs (migration 020).
9. L1168-1180 (757 chars) — Then in Week 2 (remaining) — task list.
10. L1182-1186 (386 chars) — BOT-27 reactivation CLEAR-HALF — DONE.
11. L1188-1225 (2,772 chars) — BOT-27's SET-HALF DOES NOT EXIST.
12. L1227-1246 (1,538 chars) — TESTING DEBT — WEBHOOK HTTP HARNESS (opened, then closed below).
13. L1248-1275 (2,060 chars) — CLOSED (2026-08-07): test/webhook.test.ts now exists.
14. L1277-1284 (583 chars) — PROD SMOKE CHECK RESOLVED (2026-07-26).
15. L1286-1320 (2,611 chars) — DATA RETENTION POSTURE — AUDITED 2026-07-27.
16. L1322-1338 (1,222 chars) — DATED ADDITION (2026-08-13) — checkin_escalations retention classification.
17. L1340-1360 (1,551 chars) — PARSER DEBT — RULE 3.5's LOW-CONFIDENCE FLAG DOES NOT EXIST.
18. L1362-1372 (803 chars) — HIGH-1 (users_update self-privilege-escalation) — CLOSED.
19. L1374-1398 (1,823 chars) — EQUIPMENT daily_hire_cost — A COUNT IN A MONEY FIELD.
20. L1400-1416 (1,301 chars) — DATED FINDING (2026-08-13) — "Job 15oo" equipment typo.
21. L1418-1428 (788 chars) — SIGNIFICANCE note on the typo finding.
22. L1430-1443 (967 chars) — NOT FIXED TODAY, ON PURPOSE.
23. L1445-1456 (812 chars) — DATED REFRAME (2026-08-13) — fuzzy matching framing.
24. L1458-1488 (2,094 chars) — Per-parser confidence-signal audit (5 parsers).
25. L1490-1499 (674 chars) — Summary: 3 of 5 parsers have no confidence signal.
26. L1501-1515 (1,056 chars) — SECOND FAILURE, UNDERNEATH THE FIRST — splitDigitBoundaries root cause.
27. L1517-1534 (1,083 chars) — PLAN PRIORITY (not built — analysis only).
28. L1536-1566 (2,228 chars) — CANDIDATE CI CHECK — createServiceClient() (not built).
29. L1568-1597 (2,069 chars) — P3 SCOPE CAPTURE — rules-file staleness triage test (not applied file-wide).
30. L1599-1626 (2,100 chars) — DASH-04 DPR archive list-only status + dead-link removal.
31. L1628-1656 (2,052 chars) — DPRS PAGE SWALLOWS QUERY ERRORS (open, not fixed).
32. L1658-1685 (1,876 chars) — MIGRATION 023 APPLIED TO PRODUCTION (2026-08-07).
33. L1687-1709 (1,743 chars) — HAND-MIRRORED RECONCILIATION, TWO COPIES risk.
34. L1711-1723 (974 chars) — DATED AMENDMENT (2026-08-11) — conditional gate (retired below).
35. L1725-1763 (2,645 chars) — CONDITIONAL GATE RETIRED, replaced by continuous test.
36. L1765-1777 (918 chars) — RECORDED, GATED, NOT BUILT — future single-source-of-truth shape.
37. L1779-1781 (182 chars) — MIGRATION 025 APPLIED TO PRODUCTION (2026-08-11) pointer.
38. L1783-1795 (974 chars) — Struck-through superseded "025 written, not yet applied" entry.
39. L1797-1813 (1,220 chars) — DATED UPDATE (2026-08-11) — 025 apply verification detail.
40. L1815-1827 (929 chars) — BUG PROVEN DEAD ON PROD — webhook round-trip evidence.
41. L1829-1858 (1,156 chars) — PRESERVED ARTIFACT — pre-overwrite daily_logs JSON.
42. L1860-1894 (2,376 chars) — EVENING FLOW SANDBOX SCENARIOS 2/3 — CLOSED.
43. L1896-1901 (398 chars) — Test engineer deactivated/session reset note.
44. L1903-1908 (413 chars) — Ledger repaired (023/024/025 rows).
45. L1910-1922 (914 chars) — Struck-through "PROCESS NOTE — decision needed" (resolved below).
46. L1924-1931 (544 chars) — DATED RESOLUTION (2026-08-11) — db query path formalized into §0.
47. L1933-1956 (1,657 chars) — Week 4 (in progress) — migration 022 applied.
48. L1958-1984 (1,836 chars) — 019's correctable-column set gap — two instances.
49. L1986-2014 (2,068 chars) — REGENERATION-ON-CORRECTION DOES NOT EXIST.
50. L2016-2030 (1,088 chars) — JOBS TABLE HAS NO CLAIMED-AT/STALE MECHANISM.
51. L2032-2042 (816 chars) — Sibling-gap detail continued.
52. L2044-2055 (868 chars) — Root-cause/trigger-condition detail continued.
53. L2057-2062 (411 chars) — DATED CORRECTION (2026-08-12) — Phase 3 vs Phase 4 fix.
54. L2064-2075 (844 chars) — DATED UPDATE (2026-08-12) — trigger partially fired.
55. L2077-2095 (1,371 chars) — DATED UPDATE (2026-08-12, ~22:15 IST) — superseded, cron ran for real.
56. L2097-2120 (1,655 chars) — DATED UPDATE (2026-08-12, pre-midnight) — E2E SMOKE PAUSED.
57. L2122-2130 (674 chars) — MIGRATION 027 APPLIED TO PRODUCTION (2026-08-13).
58. L2132-2141 (668 chars) — Apply method/PITR detail continued.
59. L2143-2155 (800 chars) — Post-apply catalog fingerprint detail.
60. L2157-2162 (442 chars) — Ledger update (027 row) + types regen.
61. L2164-2168 (362 chars) — Not-closed-out-by-this-apply note.
62. L2170-2179 (654 chars) — Reviewer's closing frame (quoted).
63. L2181-2209 (2,468 chars) — TRIPWIRE — `3534756b` / "Vikram Rao" test-account risk.
64. L2211-2219 (729 chars) — NO PRODUCTION MECHANISM STARTS A MORNING CHECK-IN.
65. L2221-2229 (732 chars) — Trace of today's specific silent-failure incident.
66. L2231-2248 (1,452 chars) — Whole-codebase mechanism check (grep results).
67. L2250-2257 (668 chars) — CONFIRMED (2026-08-15) — ENABLE_TEST_FLOW_TRIGGER absent.
68. L2259-2305 (3,771 chars) — OPEN QUESTION — how 2026-08-13's check-in happened (unresolved). **[contains the exact 150,000-char cutoff, at L2290]**
69. L2307-2329 (1,864 chars) — DATED UPDATE (2026-08-20) — inbound-start build, partially closes gap.
70. L2331-2353 (1,968 chars) — BOT-07 SILENCE IS A RULE 3.5 DEAD-END (opened, then resolved).
71. L2355-2374 (1,763 chars) — PROCESS BREACH (2026-08-15) — PR #64 re-run-to-green incident.
72. L2376-2426 (4,168 chars) — TEST-DB INCIDENT #4, CLASSIFIED — unresolved root cause.
73. L2428-2430 (220 chars) — main's own CI confirmed green.
74. L2432-2443 (913 chars) — RECORDED, NOT FIXED — two small findings (expires_at, cross-ref).
75. L2445-2449 (384 chars) — SCOPE CORRECTION (2026-08-15) — merge = deploy clarification.
76. L2451-2466 (1,418 chars) — `morning.ts:188` TS/SQL mirror divergence — tracked, not fixed.
77. L2468-2470 (188 chars) — Milestone-plan pointer (ARD §12).
78. L2472-2516 (3,620 chars) — WEBHOOK SIGNATURE VALIDATION IS HOST-PINNED — QQ1-QQ3 incident + fix + open item.

**§10 total across the 78 blocks above: 100,242 chars** (vs. 100,271 chars measured heading-to-EOF — the 29-char gap is the "## 10." heading line, its trailing blank line, and the "### [2026-07-24]" sub-heading marker itself, none of which are paragraph content).

---

## KEY FINDING FOR PART 2 (truncation at 150,000 chars)

- No markdown heading of ANY level (`#`, `##`, or `###`) occurs anywhere
  after line 1057 (offset ~67,985) — the entire back half of the file, all
  ~100,000 characters of §10, is one long flat run of narrative blocks with
  no further structural markers at all.
- The 150,000-character mark falls at line 2290, inside narrative block #68
  above (`OPEN QUESTION — SHARPER NOW...`, L2259-2305).
- The last block that starts entirely before the cutoff is block #67
  (`CONFIRMED (2026-08-15, Aravind checked the Vercel dashboard directly)`,
  L2250-2257, ending at offset 149,990).
- Everything from block #68 onward (L2259 to EOF, L2517) — blocks 68
  through 78 — is PAST the 150,000-char mark and is NOT reaching a
  truncated session. That is 10 of the 78 §10 narrative blocks, ~18,675
  characters (~11% of the file), none of which contain any new standing
  rule (confirmed: zero "standing rule"/"hard rule" declarations after
  line 401, all instances checked above are cross-references back into §0).
