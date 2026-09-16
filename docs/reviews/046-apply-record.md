# Migration 046 — PRODUCTION APPLY RECORD (2026-09-16)

Companion to `supabase/migrations/046_hindrances_report_date.sql` (the
migration itself, header carries its own dated-correction trail) and this
project's test-db rehearsal work for 046 (forward apply, IST midnight
boundary probe, DOWN block rehearsed and re-verified, all against
`exfccwlrhoutkgrlikod`, prior sessions). Applied against `jvxwqignooseazzmwhvl`
(prod) only.

**PITR_OBSERVED** (Aravind, in the Supabase dashboard, before this apply):
restore window 09 Sep 2026 22:00:59 to 16 Sep 2026 20:38:08 IST. Recorded
as stated by Aravind — not independently observed by this session.

**CI_PROOF**: run `35107472623` at `5677615` — independently confirmed via
`gh run view 35107472623 --json databaseId,headSha,conclusion,status,workflowName`:
`{"conclusion":"success","databaseId":35107472623,"headSha":"567761553f816f75bfb43f52153db6d07c886477","status":"completed","workflowName":"CI"}`
— `headSha` matches `5677615` exactly. `test/hindrances-report-date.test.ts`
2 tests passed, 104/104 files, as reported by Aravind; corroborated by the
run's own green conclusion and matching SHA, not independently re-derived
from raw CI logs in this session. Merged as `ecf6105` (PR #280); migration
blob identical (see Source Check below).

**SOURCE CHECK — TWO SEPARATE FACTS, NOT ONE** (per Aravind's explicit
clarification during this apply): the PR #279 check below is NOT a
provenance check for migration 046 — it is a separate confirmation that PR
#279 (migration 045's own prod apply + the CLI credential-scope standing
rule) is merged into `main`. It passes on its own terms. Migration 046's
actual source is PR #280, merge commit `ecf6105` — confirmed by the blob-hash
match, which is the check that governs this apply.

Everything below is a live, first-hand transcript from this session — every
command was actually run, in order, raw output pasted verbatim.

## 0. Source check (read-only)

```
$ git fetch origin
(no output)

$ git log origin/main --oneline -8
ecf6105 Add migration 046: hindrances.report_date (generated IST date) (#280)
3db6a17 docs+rules: record 3 standing rules, split design-decisions-beta-feedback.md (#269)
9f951b3 docs: rescue 036-037 review package + repair 036 reservations entry (#272)
fb8a36d Migration 045 PROD apply + CLI credential-scope standing rule (#279)
3fb18c7 Stage 3: idle-photo nudge with burst throttle (migration 045, HELD) (#278)
fbced4b fix(hindrance): Q3 photo question is now answerable by photos (#277)
8cf25f3 docs(044): post-apply paperwork + CI cancel-in-progress fix (#276)
6285dca Stage 2: hindrance photo capture + email attachments (migration 044, test-db only) (#275)
```

PR #279 check (separate fact — 045's own PR merged, NOT migration 046's
provenance):
```
$ gh pr view 279 --json state,mergeCommit
{"mergeCommit":{"oid":"fb8a36d57279567a45ceec761d4f119cf4d2d611"},"state":"MERGED"}

$ git merge-base --is-ancestor fb8a36d57279567a45ceec761d4f119cf4d2d611 origin/main
$ echo "exit code: $?"
exit code: 0
```
`fb8a36d` (PR #279, migration 045's own prod-apply/credential-scope PR) is
confirmed MERGED and an ancestor of `origin/main`. This does not verify
migration 046's provenance — see the blob-hash check below for that.

Migration 046's actual governing check — blob hash identity between
`origin/main`'s merge commit and this session's own pre-fix commit:
```
$ git rev-parse ecf6105:supabase/migrations/046_hindrances_report_date.sql
7dbfb701d18ab9a647b341ca874d8096cc780c9d

$ git rev-parse 5677615:supabase/migrations/046_hindrances_report_date.sql
7dbfb701d18ab9a647b341ca874d8096cc780c9d
```
Identical. The migration file merged into `main` (PR #280) is byte-identical
to what was rehearsed and DOWN-tested on test-db.

```
$ git rev-parse origin/main
ecf6105dea8611454b9d1ded2139809cbd43cbf7

$ git checkout ecf6105
HEAD is now at ecf6105 Add migration 046: hindrances.report_date (generated IST date) (#280)

$ git status
HEAD detached at ecf6105
nothing to commit, working tree clean
```
Clean checkout of `origin/main` at `ecf6105` confirmed before any write.

## 1. Link to prod, confirm target

```
$ supabase link --project-ref jvxwqignooseazzmwhvl
{"project_ref":"jvxwqignooseazzmwhvl","message":""}

$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl
```
Equals the named prod ref exactly. Proceeded.

## 2. Pre-probe (prod, read-only)

```
$ supabase migration list --linked
{"migrations":[...,{"local":"045","remote":"045","time":"045"},{"local":"046","remote":"","time":"046"}],"message":"Migrations listed"}
```
Local through 046, remote tops out at 045 (046 shows `remote:""`) —
confirmed not yet applied.

```sql
SELECT count(*) AS total, count(*) FILTER (WHERE created_at IS NULL) AS created_at_null_count FROM public.hindrances;
```
```
$ supabase db query --linked -f pre-counts.sql
{"rows":[{"created_at_null_count":0,"total":4}]}
```

```sql
SELECT * FROM information_schema.columns WHERE table_schema='public' AND table_name='hindrances' AND column_name='report_date';
```
```
$ supabase db query --linked -f pre-columns.sql
{"rows":[]}
```
0 rows — `report_date` does not already exist on prod. Confirmed.

Table-level grants (`information_schema.role_table_grants`, `anon`/
`authenticated`/`service_role`): 17 rows, identical shape to test-db's
pre-046 grants (anon: REFERENCES, SELECT, TRIGGER, TRUNCATE; authenticated:
DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE; service_role: DELETE,
INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE).

Column-level grants (`information_schema.column_privileges`, all columns,
same three grantees): 1207 output lines, saved to a temp file outside the
repo for the post-apply diff.

## 3. Apply

```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl

$ supabase db query --linked -f supabase/migrations/046_hindrances_report_date.sql
{"rows":[]}
```
No error.

## 4. Verify by observation (prod)

```sql
SELECT a.attname, pg_get_expr(d.adbin, d.adrelid) FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum WHERE a.attrelid='public.hindrances'::regclass AND a.attname='report_date';
```
```
$ supabase db query --linked -f verify-expr.sql
{"rows":[{"column_name":"report_date","generation_expression":"(timezone('Asia/Kolkata'::text, created_at))::date"}]}
```
Matches expected exactly.

```
$ supabase db query --linked -f post-counts.sql
{"rows":[{"created_at_null_count":0,"report_date_null_count":0,"total":4}]}
```
Total unchanged (4); the two null counts are equal (0 = 0).

```
$ supabase db query --linked -f verify-index.sql
{"rows":[{"indexdef":"CREATE INDEX idx_hindrances_project_reporter_report_date ON public.hindrances USING btree (project_id, reported_by, report_date)","indexname":"idx_hindrances_project_reporter_report_date"}]}
```
Index confirmed present.

Table-level grants re-run: identical, row for row, to the pre-apply
capture (17 rows).

Column-level grants re-run, diffed against the pre-apply saved file:
```
$ diff pre-column-grants.json post-column-grants.json
```
Only differences: the per-query `boundary` token, and 9 new `report_date`
rows (anon: SELECT, REFERENCES; authenticated: SELECT, INSERT, REFERENCES;
service_role: UPDATE, INSERT, REFERENCES, SELECT) — mirroring
`created_at`'s own privilege set per role exactly. No other differences.

**SMOKE TEST** (inside `BEGIN...ROLLBACK`, reusing an existing prod
hindrance row's `tenant_id`/`project_id`/`reported_by` so the composite FKs
hold):
```sql
BEGIN;
WITH existing_row AS (SELECT tenant_id, project_id, reported_by FROM public.hindrances LIMIT 1)
INSERT INTO public.hindrances (tenant_id, project_id, reported_by, description, submitted_via, created_at)
SELECT tenant_id, project_id, reported_by, 'ZZ 046 smoke', 'web_app', '2026-09-15 18:31:00+00'::timestamptz
FROM existing_row
RETURNING id, created_at, report_date, (report_date = DATE '2026-09-16') AS matches_expected_2026_09_16;
ROLLBACK;
```
```
$ supabase db query --linked -f smoke-test.sql
{"rows":[{"created_at":"2026-09-15 18:31:00+00","id":"6c7bfacc-0888-4c03-b968-b8d3ec8bd5fd","matches_expected_2026_09_16":true,"report_date":"2026-09-16"}]}
```
`report_date = 2026-09-16`, matches expected.

```
$ supabase db query --linked -f pre-counts.sql
{"rows":[{"created_at_null_count":0,"total":4}]}
```
Total still 4 — ROLLBACK confirmed, no committed side effect.

## 5. Ledger

```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl

$ supabase migration repair --status applied 046 --linked
Repaired migration history: [046] => applied
{"versions":["046"],"status":"applied","repairAll":false,"message":"Migration history repaired"}

$ supabase migration list --linked
{"migrations":[...,{"local":"045","remote":"045","time":"045"},{"local":"046","remote":"046","time":"046"}],"message":"Migrations listed"}
```
Local and remote match through 046.

## 6. Types

```
$ cat supabase/.temp/project-ref
jvxwqignooseazzmwhvl

$ npx supabase gen types typescript --linked --schema public > /tmp/046-prod-types.ts
exit: 0
2392 lines

$ diff types/database.ts /tmp/046-prod-types.ts
2250,2253d2249
<       quoco_test_row_is_locked: {
<         Args: { p_phone_number: string }
<         Returns: boolean
<       }
```
One difference — `quoco_test_row_is_locked`, a pre-existing, test-db-only
diagnostic function (unrelated to migration 046; documented in CLAUDE.md's
own concurrency-verification standing rule). `report_date` itself is
present identically in both, at the same lines (759/784/809). Per
instruction: **`types/database.ts` was NOT overwritten** — the committed
copy (generated from test-db) remains authoritative and correct; this
diff is expected and pre-existing, not introduced by this apply.

## 7. Relink to test

```
$ supabase link --project-ref exfccwlrhoutkgrlikod
{"project_ref":"exfccwlrhoutkgrlikod","message":""}

$ cat supabase/.temp/project-ref
exfccwlrhoutkgrlikod
```
Confirmed. Prod is no longer linked.

## Test-db rehearsal note (prior session, referenced here for completeness)

Test-db (`exfccwlrhoutkgrlikod`) DOWN rehearsed 2026-09-16; re-apply
verified by observation (generation expression, index_count=1, total=5,
report_date_null=0). The removal-step output (column/index confirmed gone
immediately after the DOWN ran) was not re-captured in this prod-apply
session — it was captured and verified in the prior test-db rehearsal
session, not repeated here.
