# 050 close-out record

Docs only. Tier: LIGHT. No database work, no supabase command, no code.
Date: 2026-10-26. Written by Claude Code (background job).

Marks: **[O]** observed by Claude Code in this block, raw output in `/tmp/quoco/docs-050-closeout.txt` on Aravind's machine (not committed). **[R]** reported by Aravind.

The raw log of the prod apply block (block 21) is committed beside this file: `docs/reviews/050-prod-apply/block-21-raw-log.txt`, sha256 `b8039298f405fd7d3721ff511be7ec1abf1f1e6c97b714d79cf002942f0addf4` [O] (hash checked before and after the copy; a secret scan of the file found no match before it was copied [O]).

## 1. Merge [O]

- PR #334: state `MERGED`, `mergedAt` `2026-10-25T19:41:43Z`.
- Merge commit: `4c64471b6a51e6e037211cee158a258f25f40800`.
- Parents: `349d360a9d633501ed800e0ca858dd9a786f2278` (main before) and `c00ed2a818c35aa5134e1172e8115310bf76e59a` (the PR head).
- Tree equality: the tree of `4c64471b` and the tree of `c00ed2a` are the same object, `1a36ce523dc5060a8c1eb9a830b9bb6b056b9814`. So the merge added nothing beyond the PR head.

```
$ git log -1 --format='%H %P' 4c64471b
4c64471b6a51e6e037211cee158a258f25f40800 349d360a9d633501ed800e0ca858dd9a786f2278 c00ed2a818c35aa5134e1172e8115310bf76e59a
$ git rev-parse '4c64471b^{tree}' 'c00ed2a^{tree}'
1a36ce523dc5060a8c1eb9a830b9bb6b056b9814
1a36ce523dc5060a8c1eb9a830b9bb6b056b9814
```

## 2. CI pin [O]

- Run `40217915047`, head `c00ed2a818c35aa5134e1172e8115310bf76e59a`.
- Attempt 2: `success`. Attempt 1: `failure`. Same head SHA for both.
- URL: https://github.com/ara-2789/Quoco/actions/runs/40217915047

```
$ gh run view 40217915047 --json attempt,conclusion,headSha,url
{"attempt":2,"conclusion":"success","headSha":"c00ed2a818c35aa5134e1172e8115310bf76e59a","url":"https://github.com/ara-2789/Quoco/actions/runs/40217915047"}
$ gh run view 40217915047 --attempt 1 --json conclusion,headSha
{"conclusion":"failure","headSha":"c00ed2a818c35aa5134e1172e8115310bf76e59a"}
```

## 3. Attempt-1 failure [O]

- Failing test file: `test/capture-races.test.ts`.
- Failing call: `makeDoc(r11-dc3)` (`test/helpers/capture-fixtures.ts:346`). It got `outcome: idle` and no `document_id` or `delivery_id`.
- Round 3 of `p1xp1` logged `invB setup_ms=2552` at 18:29:59.196Z. No round 3 `dc` line follows it.
- The next test (`p1xp4 round=0 inv setup`) logged at 18:30:18Z.
- IST midnight is 18:30:00Z. The gap from 18:29:59Z to 18:30:18Z spans it.

Raw lines (the `Test (real test-db)<TAB>Run npm test<TAB>` prefix and the colour codes are trimmed; everything else is as logged):

```
2026-10-25T18:29:57.9179524Z [race-diag] p1xp1 round=3 invA setup_ms=1273
2026-10-25T18:29:59.1964362Z [race-diag] p1xp1 round=3 invB setup_ms=2552
2026-10-25T18:30:18.6929659Z [race-diag] p1xp4 round=0 inv setup_ms=1331
2026-10-25T18:32:28.7641167Z      → makeDoc(r11-dc3): no document_id/delivery_id in {"outcome":"idle","delivery_id":null,"document_id":null,"current_flow":null,"current_step":0}
2026-10-25T18:48:14.0827247Z Error: makeDoc(r11-dc3): no document_id/delivery_id in {"outcome":"idle","delivery_id":null,"document_id":null,"current_flow":null,"current_step":0}
2026-10-25T18:48:14.0828548Z  ❯ makeDoc test/helpers/capture-fixtures.ts:346:47
```

**Cause attributed by timing to the IST day reset; fixture code not traced.** A re-run after midnight IST passed (attempt 2). This is a test-clock problem, not a defect in the 050 SQL. See `docs/plans/pr-c-carry-forward.md`.

## 4. Prod ledger [O] and the repair command [R]

- Ledger state: observed by query on prod `jvxwqignooseazzmwhvl` at 2026-10-25T17:37:53Z, quoted below from lines 242-262 of the committed raw log. `050 material_inward_functions` has 31 statements. The row before it is `049 capture_tables` with 59. Max version is `050`. 46 rows in total. [O]
- The ledger repair itself (`supabase --workdir /tmp/quoco/cli-prod migration repair --status applied 050 --linked`) was run by Aravind, two attempts. The first failed with a Cloudflare 502 before connecting; the second succeeded. [R]

```
=== step 4 verify + step 5 readbacks 2026-10-25T17:37:53Z ===
--- project-ref: jvxwqignooseazzmwhvl
SELECT version, name, coalesce(array_length(statements,1),0) st, (SELECT max(version) FROM supabase_migrations.schema_migrations) maxv, (SELECT count(*) FROM supabase_migrations.schema_migrations) total FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 2;
{
  "rows": [
    {
      "maxv": "050",
      "name": "material_inward_functions",
      "st": 31,
      "total": 46,
      "version": "050"
    },
    {
      "maxv": "050",
      "name": "capture_tables",
      "st": 59,
      "total": 46,
      "version": "049"
    }
  ],
}
[exit 0]
```

## 5. DOWN status [O]

- The DOWN rehearsed on test-db is `docs/reviews/050-down-testdb.sql` as it stood at `bf91095^`, sha256 `c7f13299441ce26c2fa7f63a396a6dfa2c571bbd3d64b0c6ab7451e6ecc83bd6`.
- Today's test-db DOWN is `8990092b04f2603134e5ea4da61961e0e4345074e4d91c808f8af7b108f438bd`.
- The prod DOWN is `docs/reviews/050-down-prod.sql`, sha256 `868a68f19304b546570445e627606f1f9b1e4ae9749d45a4112dee0cd1443a36`. **It has never been run, on any database.**
- The rehearsed file and today's test-db file differ only by the `DOWN_PRECONDITION_050` block. That block was proven on a local scaffold, not on test-db.
- Today's test-db file and the prod file differ only in header comment lines 1-6.

Diff 1, rehearsed file against today's test-db DOWN (`git diff --no-index /tmp/quoco/down-rehearsed.sql docs/reviews/050-down-testdb.sql`):

```
diff --git a/tmp/quoco/down-rehearsed.sql b/docs/reviews/050-down-testdb.sql
index e3fa7c5..58e5724 100644
--- a/tmp/quoco/down-rehearsed.sql
+++ b/docs/reviews/050-down-testdb.sql
@@ -16,6 +16,22 @@ SET LOCAL lock_timeout = '3s';
 -- SELECT ... FOR UPDATE and DEADLOCKS (review r2, proven on a stub); EXCLUSIVE waits for in-flight turns.
 LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE;
 
+-- 0. Precondition [block 19 pre-merge fix]: the DOWN refuses unless the 050 ledger row exists AND all seven functions exist.
+--    A second run (or a run against a database that never had 050) would otherwise restore bodies and report success on nothing.
+DO $$
+DECLARE
+  v_n int;
+BEGIN
+  SELECT count(*) INTO v_n FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace
+    AND p.proname IN ('apply_material_inward_turn','expire_stale_material_inward','pm_set_delivery_details',
+                      'pm_approve_delivery','pm_reject_delivery','pm_link_invoice','pm_unlink_invoice');
+  IF NOT EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '050') OR v_n <> 7 THEN
+    RAISE EXCEPTION 'DOWN_PRECONDITION_050: ledger_050=% functions_found=%',
+      EXISTS (SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '050'), v_n;
+  END IF;
+END;
+$$;
+
 -- 1. Clear every 'invoice' session, SUBTRACT-ONLY: flow NULL, step 0, flow-owned keys and the N13 flag removed.
 --    Never context := '{}' (that would drop morning_submitted / evening_submitted).
 UPDATE public.whatsapp_sessions
```

Diff 2, today's test-db DOWN against the prod DOWN (`diff docs/reviews/050-down-testdb.sql docs/reviews/050-down-prod.sql`):

```
1,6c1,6
< -- docs/reviews/050-down-testdb.sql  -- DOWN artifact for migration 050, TEST-DB (exfccwlrhoutkgrlikod).
< -- Plan docs/plans/pr-b-050-plan.md rev 6, section 9. NOT RUN on test-db by this block (only on a disposable
< -- local scaffold). The restore text below is the LIVE pg_get_functiondef of test-db captured 18 Oct 2026,
< -- verbatim: apply_morning_flow_turn md5 707c10fe09dfd5a7cd065f7826eacd46, apply_evening_flow_turn md5
< -- d19d07507abccdaf7d54ee1d74419af7 (equal to probe 1). Prod gets its OWN artifact, docs/reviews/050-down-prod.sql,
< -- built from the prod-captured bodies; never apply this file to prod, never the other way round.
---
> -- docs/reviews/050-down-prod.sql  -- DOWN artifact for migration 050, PROD (jvxwqignooseazzmwhvl).
> -- Plan docs/plans/pr-b-050-plan.md rev 6, section 9. NOT RUN. The restore text below is the LIVE pg_get_functiondef of PROD
> -- captured 20 Oct 2026 (read-only, block 18), verbatim: apply_morning_flow_turn md5 707c10fe09dfd5a7cd065f7826eacd46 (file
> -- docs/reviews/050-prod-live-morning.sql, sha256 69ae1b5c...cebe5), apply_evening_flow_turn md5 d19d07507abccdaf7d54ee1d74419af7
> -- (file docs/reviews/050-prod-live-evening.sql, sha256 30979c8f...c18a4). Never apply this file to test-db; test-db has its own
> -- artifact, docs/reviews/050-down-testdb.sql.
```

**Decision [R]:** No test-db rehearsal of 868a68f1…: the guard reads only pg_proc and schema_migrations and fails safe. Per Aravind, 2026-10-26.

## 6. PITR [R]

Off until launch (switch trigger), per Aravind 2026-10-26. Until then each FULL-tier prod apply records "PITR substituted" with prod-captured bodies and a DOWN.
