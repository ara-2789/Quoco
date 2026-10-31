# D-30 A1 prod vs scaffold diff

Repo HEAD fe75d6cd73b138b28700c607f54e6bdb25af3771 (main). No DB connection; no repo edit; no branch or commit.
Input: `/tmp/quoco/d30-a1-prod.csv` sha256 `c18e65365ccfb26c53e14a4a4a052e718af3f87193854fdcbbe6fe94a88d7446`, 162 data rows + header (`wc -l` counts 162 newlines: the last line has no trailing newline).
Scaffold reference: `/tmp/quoco/d30-ctl-before.txt` sha256 `2be14ea0ef6e647ea829f40c148e36d54582527f4e270ad4154f84d8ca57fe8b`, 162 data rows.
First 2 lines of the prod CSV, as printed before analysis:
```
o,k,v,md5_of_v,baseline,baseline_src,status
0,"SNAPSHOT  /  now(), server_version, objects found (tables of 11, functions of 16)",2026-10-30 17:55:03.331602+00 | 17.6 | tables=11 functions=16,null,tables=11 functions=16 (expected),null,MATCH (counts)
```
The o=0 snapshot row is excluded from every comparison below (it embeds now() and the server version).

## 1. Overall md5
```
prod     7a9c61dcaac37375d1f92b22a5033a7d
scaffold 05d576845d2a9c5c36fc353dc25c8522
```
Matches the predicted `7a9c61dc…` (prod) and `05d57684…` (scaffold). They differ.

Shape: both files have identical key sets for o=1 (132 rows), o=2 (28 rows) and o=3 (1 row); no row exists on only one side. Prod status counts equal the scaffold's: MATCH 18, MATCH (count only) 20, MATCH (counts) 1, COMPARE BY EYE 4, BASELINE ONLY 119, **DIFFERS 0**. So every recorded baseline (the 9 function md5s and ACLs from 050-prod-apply-record.md:43,49-51, the 049 counts and table ACLs from 049-prod-apply-record.md:29) is reproduced on prod.

## 2. Objects whose md5 differs (7 of 28)
| object | prod | scaffold |
|---|---|---|
| daily_logs | `0f8f1e3f2b60715dd845a9f6867421ed` | `554a84eb09e2cfc19b86e6785d6b6644` |
| jobs | `3b450120a9552cf065413ff070b39496` | `9572941e10fb7bd4a45955382089fab9` |
| project_members | `4a9a8649a945a3160473987076603a83` | `94194056804cadccf7f024bbf11ff090` |
| projects | `ce619844774a5709688e1a43c0f6e901` | `83e80e666bc76c8874eaf838ff4d064f` |
| tenants | `f7a62b1a86b187829e6458f4d9ffd3e7` | `75851c9878b77fb137425e743ed35026` |
| users | `c4f5c5791fdfc13fa5df5cad305126de` | `990e8e2b2ac86c7530d39acb5e2b4888` |
| whatsapp_sessions | `661c33acf3ea7593d9a084e27db96c48` | `4d398b22977e532fce8517f4d91fc7bd` |

Identical on both sides (21 of 28 objects): capture_documents, capture_files, deliveries, delivery_invoice_links (all four 049 tables), all 16 functions, and the capture-documents bucket row. Every object not in the table above matches.

## 3. Differing facets (14), all in facet 01 (owner/rls/force/relacl) or 02 (table acl); no other facet of any object differs
Every differing object differs in exactly its 01 and 02 facets and in nothing else (columns, constraints, triggers, policies, indexes, comments are all identical).

### daily_logs  /  01 owner/rls/force/relacl  — class (a)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=ar/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=true force=false acl={postgres=arwdDxtm/postgres}
```
### daily_logs  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:INSERT authenticated:SELECT service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```
### jobs  /  01 owner/rls/force/relacl  — class (b)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=false force=false acl={postgres=arwdDxtm/postgres}
```
### jobs  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:INSERT authenticated:SELECT authenticated:UPDATE service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```
### project_members  /  01 owner/rls/force/relacl  — class (a)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=true force=false acl={postgres=arwdDxtm/postgres}
```
### project_members  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:INSERT authenticated:SELECT authenticated:UPDATE service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```
### projects  /  01 owner/rls/force/relacl  — class (a)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=ar/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=true force=false acl={postgres=arwdDxtm/postgres}
```
### projects  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:INSERT authenticated:SELECT service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```
### tenants  /  01 owner/rls/force/relacl  — class (a)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=true force=false acl={postgres=arwdDxtm/postgres}
```
### tenants  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:INSERT authenticated:SELECT authenticated:UPDATE service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```
### users  /  01 owner/rls/force/relacl  — class (a)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=r/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=true force=false acl={postgres=arwdDxtm/postgres}
```
### users  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:SELECT service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```
### whatsapp_sessions  /  01 owner/rls/force/relacl  — class (a)
```
PROD: postgres rls=true force=false acl={postgres=arwdDxtm/postgres,anon=r/postgres,authenticated=arw/postgres,service_role=arwdDxtm/postgres}
SCAF: postgres rls=true force=false acl={postgres=arwdDxtm/postgres}
```
### whatsapp_sessions  /  02 table acl (aclexplode)  — class (a)
```
PROD: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE anon:SELECT authenticated:INSERT authenticated:SELECT authenticated:UPDATE service_role:DELETE service_role:INSERT service_role:MAINTAIN service_role:REFERENCES service_role:SELECT service_role:TRIGGER service_role:TRUNCATE service_role:UPDATE
SCAF: postgres:DELETE postgres:INSERT postgres:MAINTAIN postgres:REFERENCES postgres:SELECT postgres:TRIGGER postgres:TRUNCATE postgres:UPDATE
```

## 4. Classification
- **(a) platform default the scaffold lacks: 13 facet rows** (daily_logs 01+02, jobs 02, project_members 01+02, projects 01+02, tenants 01+02, users 01+02, whatsapp_sessions 01+02).
- **(b) in prod, in no repo migration: 1 facet row** (jobs 01, the `rls=true` part; its ACL part is also class (a)).
- **(c) unexplained: 0.**

### (a) why
- Cited: `supabase/migrations/047_revoke_unused_table_rights.sql:40-43` (PURPOSE): "Supabase's project-level default ACL grants anon and authenticated TRUNCATE, TRIGGER, REFERENCES, and DELETE on every new public-schema table the moment it's created (and, on Postgres 17+, MAINTAIN too)". CLAUDE.md §0 (table-level REVOKE rule) says the same default gives `service_role` ALL privileges on every new public table. The local scaffold has no such default ACL, so its tables carry owner-only ACLs.
- Tested, not just cited: I rebuilt a second throwaway local Postgres 17 with `ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT ALL ON TABLES/FUNCTIONS/SEQUENCES TO anon, authenticated, service_role` set BEFORE replaying migrations 001-051. Result: all 12 ACL-driven differences on the six tables, plus jobs/02, disappeared; **the only row still different from prod was jobs/01 (`rls=false` vs `rls=true`)**. The narrowing from "ALL" down to prod's `anon=r`, `authenticated=ar|arw|r` comes from the repo's own revokes replaying on top of the default (047 and earlier migrations), not from anything extra on prod.
- This is a model of the platform default, not an observation of prod's `pg_default_acl`: A1 does not read it. See unknown 1.

### (b) why
- `jobs` is created at `supabase/migrations/006_jobs_queue.sql:4-14` with no `ENABLE ROW LEVEL SECURITY`, and no migration enables it (`grep -n -i -E "jobs.*(enable|force) row level|row level.*jobs" supabase/migrations/*.sql` returns nothing).
- It is a registered out-of-band object: `docs/build-status/2026-q3-weeks-1-2.md:94-96`: "`jobs` / `processed_messages` RLS-enabled state — `relrowsecurity=true` set out-of-band (017 review F6); default-deny holds on prod but a rebuild comes up RLS-DISABLED. Codify via its own migration before any environment rebuild."
- Confirmed by experiment: enabling RLS on `jobs` in the second scaffold, on top of the default ACL, makes the local A1 equal prod on every row; its overall md5 is `7a9c61dcaac37375d1f92b22a5033a7d`, byte-equal to prod's.

### (c) raw side-by-side
None.

## Finding to act on, not a D-30 blocker
The out-of-band `jobs` RLS state is still uncodified (registry text above says to codify before any environment rebuild). Prod behaviour is as documented; this readback only re-observes it.

## Unknowns
1. A1 does not read prod `pg_default_acl`. The explanation in (a) matches prod exactly under my model of the Supabase default, but a one-line SELECT of `pg_default_acl` for schema public would turn it from "reproduced" into "observed".
2. A1 covers only the 11 tables, 16 functions and the bucket. Prod-only objects outside them (for example `rls_auto_enable()`, registered out-of-band at docs/build-status/2026-q3-weeks-1-2.md:89-92) are not read by A1 at all.
