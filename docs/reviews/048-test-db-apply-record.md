# Migration 048 — TEST-DB APPLY RECORD (2026-09-20)

Companion to `docs/reviews/048-review-package.md` and `docs/reviews/048-typo-repair-runbook.md`; follows `docs/reviews/047-test-db-apply-record.md`.
External review: **round 3 = PACKAGE GO for the test-db apply only. No prod GO exists.** Applied against `exfccwlrhoutkgrlikod` (test-db) only —
**never prod: no command in this record touched `jvxwqignooseazzmwhvl`**, and this record does not authorise one (section 14).
FULL tier (`CLAUDE.md` §0, pre-launch two-tier change process). PR #308 (draft, base `main`).

**How to read this record: observed versus reported.** Every claim is tagged.

- **[O] observed** — seen in captured command output in the session that produced this record. The capture log is `~/Desktop/048-apply-capture/part1.txt`
  (with `snap-*.json`, `R-ids.txt`, `B-ids.txt`, `types-regen.diff`), which is **outside the repo and outside version control**; every excerpt below is
  **extracted from it by script, not retyped** (queries appear above their results, as the 047 record does). What was observed is what the excerpt shows.
- **[R] reported** — carried from Aravind's instructions or from an earlier document, **not observed in this session**. Section 15 lists every one.

The per-call `"boundary"` token and the `"warning"` string the `supabase db query` tool wraps around results are elided below (a fresh random token per call;
not data — the 047 record makes the same point). Nothing else in a result is elided.

## 0. Repo-state header (pinned inputs — check these, not memory)

| Input | Value |
|---|---|
| `main` | `origin/main` @ `ae3df7f91676cf1b40741d527cccd84542906304` **[O]** — fetched at A0 and again before the push; unchanged. It is the baseline of green run `35455361971` (attempt 3, `success`) **[O]** |
| Branch / PR | `feat/048-engineer-registration`, PR #308, `OPEN`, draft, base `main` **[O]** (`gh pr list`, 2026-09-20) |
| PR head **at the apply** | `67b6e3bb2754528ae448789e09d68e2ccf0c5c2e` on origin. The promotion commit `61f479e` was **local and unpushed** at the apply (`git status -sb`: ahead 1), and nothing was pushed between round 3's push and the apply, so the push freeze (package §4.1) held **[O]** |
| Commits made in this session | `61f479e` promote (local until 2026-09-20 07:09Z) · `d81031b` Step H · `fd96199` types — all pushed together as `67b6e3b..fd96199` at 2026-09-20T07:09:27Z **[O]**. **This record is the next commit** (a file cannot cite its own commit id) |
| Pins for the evidence | The migration: `git show fd96199:supabase/migrations/048_engineer_registration.sql` → blob `b7fec7af1550d434b041c75a93907851a631d565`, sha256 `1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873`; the **same blob** at the certified `ae06082:docs/reviews/048_engineer_registration.sql` **[O]** (hash-object, rev-parse, shasum in section 1). Package at `fd96199`: blob `25b7a53fe3c5912c023538c905d6f2ac2b881e4a`; runbook `4439c6aaec0d1aa669f9c5749e200fabd939e1b1`; types `0a1698070810b971d668f7919a8f310aa30c6c5f`; reservations JSON `480753888b5a9d3a1ba171f6568177958c6075a1` **[O]**. **GitHub serves these pins:** `gh api repos/ara-2789/Quoco/contents/<path>?ref=fd96199…` returned blob ids equal to the four above (migration, package, runbook, types), checked 2026-09-20 after the push — the check the package's own pin row (§0) said could only be made after the push **[O]** |
| `supabase migration list --linked` (test-db) | before: local `001`–`007`, `011`–`025`, `027`–`047`; remote identical **except `042`, `043`, `044`, `046` (remote empty)**; `048` on neither side. After section 5: `048` on **both** sides; the other four unchanged **[O]** |
| Last runbook executed | 047's prod apply, 2026-09-17 — `docs/reviews/047-prod-apply-record.md` **[R]** (package §0) |
| Tier | FULL — the migration trips the external-review triggers (a), (b), (c), (d) (`CLAUDE.md` §0; package §1) **[R]** |

## 1. Provenance and the apply (steps A0–A7) — [O]

**A0 — nothing in flight.** No GitHub run outside `completed` on any branch; no vitest / supabase / npm-test process locally; the other Claude sessions on the
machine had no test or supabase process (this cannot prove what an idle session might do next, only that nothing was in flight).
**A1 — provenance.** `git status --porcelain` empty; HEAD `67b6e3b`; sha256 `1f20efe1…9873` and blob `b7fec7af…` equal the pin in `docs/reviews/048-review-package.md` §7's artefact table, at HEAD, in the working tree and at `ae06082`.
**A2** — `supabase/.temp/project-ref` printed and compared to `exfccwlrhoutkgrlikod` **inside every `supabase` CLI command of this record**; the wrapper refuses on a mismatch and none ever mismatched. The REST observations (sections 6, 7, 10, 12) do not go through the CLI: each proved its target instead, by the URL host, `SUPABASE_TEST_PROJECT_REF` and both keys' JWT `ref` claims all equalling `exfccwlrhoutkgrlikod` before any call.

**A3 — ledger pre-state (read-only)**, `supabase migration list --linked`, `[supabase exit 0]`:

```
{"migrations":[{"local":"001","remote":"001","time":"001"},{"local":"002","remote":"002","time":"002"},{"local":"003","remote":"003","time":"003"},{"local":"004","remote":"004","time":"004"},{"local":"005","remote":"005","time":"005"},{"local":"006","remote":"006","time":"006"},{"local":"007","remote":"007","time":"007"},{"local":"011","remote":"011","time":"011"},{"local":"012","remote":"012","time":"012"},{"local":"013","remote":"013","time":"013"},{"local":"014","remote":"014","time":"014"},{"local":"015","remote":"015","time":"015"},{"local":"016","remote":"016","time":"016"},{"local":"017","remote":"017","time":"017"},{"local":"018","remote":"018","time":"018"},{"local":"019","remote":"019","time":"019"},{"local":"020","remote":"020","time":"020"},{"local":"021","remote":"021","time":"021"},{"local":"022","remote":"022","time":"022"},{"local":"023","remote":"023","time":"023"},{"local":"024","remote":"024","time":"024"},{"local":"025","remote":"025","time":"025"},{"local":"027","remote":"027","time":"027"},{"local":"028","remote":"028","time":"028"},{"local":"029","remote":"029","time":"029"},{"local":"030","remote":"030","time":"030"},{"local":"031","remote":"031","time":"031"},{"local":"032","remote":"032","time":"032"},{"local":"033","remote":"033","time":"033"},{"local":"034","remote":"034","time":"034"},{"local":"035","remote":"035","time":"035"},{"local":"036","remote":"036","time":"036"},{"local":"037","remote":"037","time":"037"},{"local":"038","remote":"038","time":"038"},{"local":"039","remote":"039","time":"039"},{"local":"040","remote":"040","time":"040"},{"local":"041","remote":"041","time":"041"},{"local":"042","remote":"","time":"042"},{"local":"043","remote":"","time":"043"},{"local":"044","remote":"","time":"044"},{"local":"045","remote":"045","time":"045"},{"local":"046","remote":"","time":"046"},{"local":"047","remote":"047","time":"047"}],"message":"Migrations listed"}
```

**A5 — pre-apply readbacks.** The six F-queries (section 2, printed there) each returned **zero rows** before the apply — 048 absent — each `[supabase exit 0]`:

- **F1**: `"rows": []`, `[supabase exit 0]`, ref confirmed in the frame
- **F2**: `"rows": []`, `[supabase exit 0]`, ref confirmed in the frame
- **F3**: `"rows": []`, `[supabase exit 0]`, ref confirmed in the frame
- **F4**: `"rows": []`, `[supabase exit 0]`, ref confirmed in the frame
- **F5**: `"rows": []`, `[supabase exit 0]`, ref confirmed in the frame
- **F6**: `"rows": []`, `[supabase exit 0]`, ref confirmed in the frame

Precondition probes: `project_members` roles = **2 × `engineer`, none outside the six** (`outside_six = false`); `users_id_tenant_id_key` present as `UNIQUE (id, tenant_id)`. Query S (section 3) snapshotted to `snap-pre.json`.

**A6 — promotion.** `git mv docs/reviews/048_engineer_registration.sql supabase/migrations/048_engineer_registration.sql`; sha256 and blob unchanged after the move; `npm run lint:migrations` →
`migration-lint: clean. 107 known violation(s), all exempted.` (identical before and after the move); local commit **`61f479e`**, not pushed.

**A7 — the apply.** One file, foreground, never `db push`, never backgrounded; project-ref and sha256 printed **and enforced in the same frame** as the apply
(the script refuses on either mismatch). The whole frame:

```
--- A2: cat supabase/.temp/project-ref:
exfccwlrhoutkgrlikod
REF CONFIRMED: exfccwlrhoutkgrlikod (test-db)
--- shasum -a 256 supabase/migrations/048_engineer_registration.sql:
1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873  supabase/migrations/048_engineer_registration.sql
SHA CONFIRMED: 1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873
--- date (UTC): 2026-09-20T06:34:23Z
--- supabase db query --linked -f supabase/migrations/048_engineer_registration.sql   (foreground):
{
  "rows": []
}
[supabase exit 0]
--- date (UTC): 2026-09-20T06:34:28Z
```

**CLI exit 0, no error; 2026-09-20T06:34:23Z → 06:34:28Z.** The file is one `BEGIN … COMMIT`, so a failure would have applied nothing; there was none.

## 2. Post-apply fingerprint F1–F6, against the scaffold reference — [O]

Queries: `docs/reviews/048-scaffold/fingerprint.sql`, **split into six single-statement files** (`supabase db query -f` returns only the **last** statement's result set — **[R]**, verified in an earlier preflight session and carried in Aravind's instruction; the six-file split follows from it, and every frame below shows one statement's rows;
a single file would have shown F6 only). The split was asserted by script: six `-- F<n>.` markers in order, exactly one statement per file after stripping comments (F1's comment contains a `;`, so a naive count would be wrong),
the blocks reproduce the source, six files. Source sha256 `83ced3e41a9dd3f2f55307202e9976a6f06a5c7448a5fcb468f29031f0dca714`. Each query is printed **above** its result. The scaffold reference is
`docs/reviews/048-review-package.md` §7.3 at `ae06082` (`git show ae06082:docs/reviews/048-review-package.md`).

### F1

```sql
-- F1. The exact parameter list, as the catalog renders it. Compare on the TYPE LIST with spaces removed:
--     add_engineers_to_project(uuid, jsonb, boolean, boolean); engineer_admin_gate(uuid).
SELECT p.proname,
       oidvectortypes(p.proargtypes)   AS arg_type_list,
       p.oid::regprocedure::text       AS regprocedure
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
ORDER BY p.proname;
```

Result — ref confirmed `exfccwlrhoutkgrlikod` in the frame, `[supabase exit 0]`:

```json
[
  {
    "arg_type_list": "uuid, jsonb, boolean, boolean",
    "proname": "add_engineers_to_project",
    "regprocedure": "add_engineers_to_project(uuid,jsonb,boolean,boolean)"
  },
  {
    "arg_type_list": "uuid",
    "proname": "engineer_admin_gate",
    "regprocedure": "engineer_admin_gate(uuid)"
  }
]
```

### F2

```sql
-- F2. pg_proc count per name in public. Expected: exactly 1 each. A 2 means a second overload exists.
SELECT p.proname, count(*) AS n
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
GROUP BY p.proname
ORDER BY p.proname;
```

Result — ref confirmed `exfccwlrhoutkgrlikod` in the frame, `[supabase exit 0]`:

```json
[
  {
    "n": 1,
    "proname": "add_engineers_to_project"
  },
  {
    "n": 1,
    "proname": "engineer_admin_gate"
  }
]
```

### F3

```sql
-- F3. Body and definition hashes, owner, SECURITY DEFINER, proconfig, ACL.
--     md5(pg_get_functiondef) is beyond the ask: prosrc alone misses SECURITY DEFINER / search_path, and
--     lint-migrations.mjs Rule 10 already asks a redefinition for a pg_get_functiondef baseline.
SELECT p.proname,
       md5(p.prosrc)                          AS md5_prosrc,
       length(p.prosrc)                       AS len_prosrc,
       md5(pg_get_functiondef(p.oid))         AS md5_functiondef,
       length(pg_get_functiondef(p.oid))      AS len_functiondef,
       pg_get_userbyid(p.proowner)            AS owner,
       p.prosecdef                            AS security_definer,
       p.proconfig::text                      AS proconfig,
       p.proacl::text                         AS proacl
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
ORDER BY p.proname;
```

Result — ref confirmed `exfccwlrhoutkgrlikod` in the frame, `[supabase exit 0]`:

```json
[
  {
    "len_functiondef": 6488,
    "len_prosrc": 6240,
    "md5_functiondef": "97dacf3ce23f8f3ac906209a1e2de35b",
    "md5_prosrc": "85ec32ab5959613e6ac9932740e3ad1a",
    "owner": "postgres",
    "proacl": "{postgres=X/postgres,authenticated=X/postgres}",
    "proconfig": "{search_path=public}",
    "proname": "add_engineers_to_project",
    "security_definer": true
  },
  {
    "len_functiondef": 1874,
    "len_prosrc": 1661,
    "md5_functiondef": "f7e9ff1f407e90b4741d7629e4802128",
    "md5_prosrc": "968a53c5260d7fda4d7fcc53552d3671",
    "owner": "postgres",
    "proacl": "{postgres=X/postgres}",
    "proconfig": "{search_path=public}",
    "proname": "engineer_admin_gate",
    "security_definer": true
  }
]
```

### F4

```sql
-- F4. EXECUTE, per role, by name (has_function_privilege) -- the readback that catches a per-role default grant.
SELECT p.proname,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       has_function_privilege('postgres',      p.oid, 'EXECUTE') AS postgres,
       EXISTS (SELECT 1 FROM aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a WHERE a.grantee = 0) AS public_pseudo_role
FROM pg_proc p
WHERE p.pronamespace = 'public'::regnamespace
  AND p.proname IN ('add_engineers_to_project', 'engineer_admin_gate')
ORDER BY p.proname;
```

Result — ref confirmed `exfccwlrhoutkgrlikod` in the frame, `[supabase exit 0]`:

```json
[
  {
    "anon": false,
    "authenticated": true,
    "postgres": true,
    "proname": "add_engineers_to_project",
    "public_pseudo_role": false,
    "service_role": false
  },
  {
    "anon": false,
    "authenticated": false,
    "postgres": true,
    "proname": "engineer_admin_gate",
    "public_pseudo_role": false,
    "service_role": false
  }
]
```

### F5

```sql
-- F5. The attribution FK's actions (plan §2.8a) and the three new CHECKs (project_members role, the pairing CHECK,
--     and the no-self-attribution CHECK, R3-N3).
--     Expected for users_registered_by_fkey: confdeltype 'r' (RESTRICT), confupdtype 'a' (NO ACTION),
--     confmatchtype 's' (SIMPLE). A bare REFERENCES reads confdeltype 'a', so this pin discriminates.
SELECT c.conrelid::regclass::text AS on_table, c.conname, c.contype,
       c.confdeltype, c.confupdtype, c.confmatchtype,
       c.conkey::text AS conkey, c.confkey::text AS confkey,
       pg_get_constraintdef(c.oid) AS definition
FROM pg_constraint c
WHERE c.conname IN ('users_registered_by_fkey', 'users_registered_pairing_chk', 'users_registered_by_not_self_chk', 'project_members_role_check')
ORDER BY c.conname;
```

Result — ref confirmed `exfccwlrhoutkgrlikod` in the frame, `[supabase exit 0]`:

```json
[
  {
    "confdeltype": " ",
    "confkey": null,
    "confmatchtype": " ",
    "confupdtype": " ",
    "conkey": "{6}",
    "conname": "project_members_role_check",
    "contype": "c",
    "definition": "CHECK ((role = ANY (ARRAY['pm'::text, 'qs'::text, 'engineer'::text, 'owner'::text, 'subcontractor'::text, 'admin'::text])))",
    "on_table": "project_members"
  },
  {
    "confdeltype": "r",
    "confkey": "{1,3}",
    "confmatchtype": "s",
    "confupdtype": "a",
    "conkey": "{21,3}",
    "conname": "users_registered_by_fkey",
    "contype": "f",
    "definition": "FOREIGN KEY (registered_by, tenant_id) REFERENCES users(id, tenant_id) ON DELETE RESTRICT",
    "on_table": "users"
  },
  {
    "confdeltype": " ",
    "confkey": null,
    "confmatchtype": " ",
    "confupdtype": " ",
    "conkey": "{21,1}",
    "conname": "users_registered_by_not_self_chk",
    "contype": "c",
    "definition": "CHECK ((registered_by <> id))",
    "on_table": "users"
  },
  {
    "confdeltype": " ",
    "confkey": null,
    "confmatchtype": " ",
    "confupdtype": " ",
    "conkey": "{21,22,23}",
    "conname": "users_registered_pairing_chk",
    "contype": "c",
    "definition": "CHECK ((((registered_by IS NULL) = (registered_at IS NULL)) AND ((registered_by IS NULL) = (consent_attested IS NULL))))",
    "on_table": "users"
  }
]
```

### F6

```sql
-- F6. The three new columns (all nullable, no default) and their comments (a teardown verifies comments too,
--     CLAUDE.md §7: 048 adds no COMMENT ON, so these must read NULL).
SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS type, a.attnotnull, pg_get_expr(d.adbin, d.adrelid) AS default_expr,
       col_description(a.attrelid, a.attnum) AS comment
FROM pg_attribute a
LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
WHERE a.attrelid = 'public.users'::regclass
  AND a.attname IN ('registered_by', 'registered_at', 'consent_attested')
  AND NOT a.attisdropped
ORDER BY a.attname;
```

Result — ref confirmed `exfccwlrhoutkgrlikod` in the frame, `[supabase exit 0]`:

```json
[
  {
    "attname": "consent_attested",
    "attnotnull": false,
    "comment": null,
    "default_expr": null,
    "type": "boolean"
  },
  {
    "attname": "registered_at",
    "attnotnull": false,
    "comment": null,
    "default_expr": null,
    "type": "timestamp with time zone"
  },
  {
    "attname": "registered_by",
    "attnotnull": false,
    "comment": null,
    "default_expr": null,
    "type": "uuid"
  }
]
```


**Verdict against the scaffold reference (package §7.3):**

| | Scaffold reference | test-db, post-apply | |
|---|---|---|---|
| F1 | `uuid, jsonb, boolean, boolean` / `uuid` | identical | match |
| F2 | 1 and 1 | 1 and 1 | match |
| F3 | `md5_prosrc` `85ec32ab5959613e6ac9932740e3ad1a` / `968a53c5260d7fda4d7fcc53552d3671`; `md5_functiondef` `97dacf3ce23f8f3ac906209a1e2de35b` / `f7e9ff1f407e90b4741d7629e4802128`; lengths 6240/6488 and 1661/1874; owner `postgres`, `security_definer` t, `proconfig` `{search_path=public}`; ACLs `{postgres=X/postgres,authenticated=X/postgres}` / `{postgres=X/postgres}` | **every value identical** — so there is no `functiondef`-only difference to report | match |
| F4 | public function: anon f / authenticated t / service_role f / postgres t / PUBLIC f; helper: f / f / f / t / f | identical | match |
| F5 | four rows; FK `r` / `a` / `s`, `confkey` `{1,3}`; CHECK definitions | identical on **names, types, `confdeltype`/`confupdtype`/`confmatchtype`, `confkey` and every `pg_get_constraintdef`**; **`conkey` differs** | match, **except conkey** |
| F6 | three columns, nullable, no default, `comment` NULL | identical | match |

**The `conkey` attnum difference, and why it is not drift.** `pg_constraint.conkey` holds the *attribute numbers* of the constrained columns, i.e. physical column positions. On the scaffold they are
`{18,3}`, `{18,1}`, `{18,19,20}`; on test-db `{21,3}`, `{21,1}`, `{21,22,23}`. The scaffold's `users` had 17 columns and no dropped-column slots, so the first new column took attnum 18. On test-db the pre-apply snapshot
shows **17 live `users` columns** (section 3) yet the first new column took **attnum 21**: three attribute numbers were already spent on columns dropped earlier in the table's history (inferred from the arithmetic — `attisdropped`
was not queried). Nothing about the *definitions* differs: same names, same actions, same `confkey`. It is a property of column history, not of the migration. **Corroboration, [O]:** after the DOWN (which drops the three columns) and the re-UP
(which re-adds them) the numbers moved again to `{24,3}`, `{24,1}`, `{24,25,26}` — a drop-and-re-add takes fresh attribute numbers — with definitions unchanged (section 4). **Consequence for future records: compare F5 on
`definition` and the action columns, never on `conkey`.**

## 3. Query S — the snapshot used to prove nothing else moved — [O]

Query S was **defined by the assistant** (the original from an earlier session was not recoverable) and **approved by Aravind as covering everything 048's DOWN touches [R]**. It is read-only, structure and row counts
only: row counts of `users`, `project_members`, `projects`, `tenants`; `users` columns; `users` and `project_members` constraints; every `public` function's signature, owner, `SECURITY DEFINER`, ACL and `md5(pg_get_functiondef)`; the
ledger's versions. **It carries no column comments** (a limit: comments are covered by F6, which reads NULL after UP and after re-UP; 048 adds no `COMMENT ON`).

```sql
-- Query S: read-only pre/post-apply SNAPSHOT of test-db (one statement, one JSON value). Structure + row counts only; no row contents.
-- Captured before the apply (snap-pre.json) and again after (snap-post.json) so the diff shows exactly what 048 changed and nothing else.
SELECT jsonb_pretty(jsonb_build_object(
  'database', current_database(),
  'server_version', current_setting('server_version'),
  'row_counts', jsonb_build_object(
    'users',           (SELECT count(*) FROM public.users),
    'project_members', (SELECT count(*) FROM public.project_members),
    'projects',        (SELECT count(*) FROM public.projects),
    'tenants',         (SELECT count(*) FROM public.tenants)),
  'users_columns', (SELECT jsonb_agg(jsonb_build_object('name', column_name, 'type', data_type, 'nullable', is_nullable, 'default', column_default) ORDER BY ordinal_position)
                    FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users'),
  'users_constraints', (SELECT jsonb_agg(jsonb_build_object('name', conname, 'def', pg_get_constraintdef(oid)) ORDER BY conname)
                        FROM pg_constraint WHERE conrelid = 'public.users'::regclass),
  'project_members_constraints', (SELECT jsonb_agg(jsonb_build_object('name', conname, 'def', pg_get_constraintdef(oid)) ORDER BY conname)
                        FROM pg_constraint WHERE conrelid = 'public.project_members'::regclass),
  'public_functions', (SELECT jsonb_agg(jsonb_build_object('sig', p.oid::regprocedure::text, 'owner', pg_get_userbyid(p.proowner), 'secdef', p.prosecdef,
                                                           'acl', p.proacl::text, 'md5_def', md5(pg_get_functiondef(p.oid))) ORDER BY p.oid::regprocedure::text)
                       FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.prokind = 'f'),
  'ledger_versions', (SELECT jsonb_agg(version ORDER BY version) FROM supabase_migrations.schema_migrations)
)) AS snapshot;
```

| Snapshot | When | users cols / users constraints / pm constraints / public functions / ledger | sha256 of the extracted JSON |
|---|---|---|---|
| `snap-pre.json` | before the apply | 17 / 8 / 5 / 130 / 39 | `48b64a3f9c009cd02c8983e3b166ca33d68992cbe40e3e45021790ca87ac9b6a` |
| `snap-post-up.json` | after the apply | 20 / 11 / 6 / 132 / 39 | `697fc5954a2d92ba643e728fa1f5c32980264f1c0a84b0821bf55a2d4dd2e55b` |
| `snap-post-down.json` | after the DOWN | 17 / 8 / 5 / 130 / 39 | `48b64a3f9c009cd02c8983e3b166ca33d68992cbe40e3e45021790ca87ac9b6a` |
| `snap-post-reup.json` | after the re-UP | 20 / 11 / 6 / 132 / 39 | `697fc5954a2d92ba643e728fa1f5c32980264f1c0a84b0821bf55a2d4dd2e55b` |

Row counts were identical throughout: `users` 1932, `tenants` 46, `projects` 16, `project_members` 2. `diff -u snap-pre.json snap-post-up.json` was **purely additive** (48 added lines, 0 removed):
`users` +3 columns, +3 constraints (the FK, the pairing CHECK, the no-self CHECK), `project_members` +1 constraint (the role CHECK), +2 public functions. **The ledger did not move** at the apply
(a `db query -f` never writes `schema_migrations`; only `migration repair` does — section 5).

## 4. DOWN rehearsal, `UP → DOWN → UP`, on test-db — [O]

Full-tier requirement (package §4.2 step 3; `CLAUDE.md` §7). **D0 — the DOWN destroys attribution data**, so first: `SELECT count(*) FROM public.users WHERE registered_by IS NOT NULL` → **0** (`[supabase exit 0]`).

**D1 — the DOWN block**, extracted from `supabase/migrations/048_engineer_registration.sql` (source lines 398–413) by the same logic `docs/reviews/048-scaffold/down.sh` uses, printed in full before running, with an exact-text assertion against the package §7.4 list
(extracted-text sha256 `0458594611c27a37c0886c67dd94e0802adf2a43fddb994270c8ce701eeb121b`):

```sql
BEGIN;

DROP FUNCTION IF EXISTS public.add_engineers_to_project(uuid, jsonb, boolean, boolean);
DROP FUNCTION IF EXISTS public.engineer_admin_gate(uuid);

ALTER TABLE public.project_members DROP CONSTRAINT IF EXISTS project_members_role_check;

ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_registered_by_fkey;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_registered_pairing_chk;
ALTER TABLE public.users DROP CONSTRAINT IF EXISTS users_registered_by_not_self_chk;
ALTER TABLE public.users
  DROP COLUMN IF EXISTS consent_attested,
  DROP COLUMN IF EXISTS registered_at,
  DROP COLUMN IF EXISTS registered_by;

COMMIT;
```

**It is NINE statements:** `BEGIN`; 2 × `DROP FUNCTION IF EXISTS`; 4 × `ALTER TABLE … DROP CONSTRAINT IF EXISTS`; 1 × `ALTER TABLE public.users DROP COLUMN IF EXISTS` (three columns in one statement); `COMMIT`.

> **DATED CORRECTION (2026-09-20, at Aravind's instruction [R]).** The D1 instruction said the block must read "exactly the **ten** statements the package specifies". **That count was wrong; the block has nine.**
> No document states "ten"; the extracted text matched the package §7.4 list item for item and in order, so the assistant proceeded and flagged the discrepancy. Aravind confirmed the miscount was his and that proceeding was right.
> The first-pass D1 lines in the capture log are left as written (they already say "9 statements, not the ten in the instruction"); this entry is the correction, and **this record cites the count as nine.**

**D2 — run**, project-ref printed and compared in the frame, foreground:

```
$ Q.sh down048.sql (ref shown first)
REF CONFIRMED: exfccwlrhoutkgrlikod (test-db)
--- result:
{
  "rows": []
}
[supabase exit 0]
```

**D3 — post-DOWN.** `snap-post-down.json` versus `snap-pre.json`: **0 differing lines, `cmp` byte-identical, both sha256 `48b64a3f9c009cd02c8983e3b166ca33d68992cbe40e3e45021790ca87ac9b6a`.** Then all six F-queries: **zero rows each**, each `[supabase exit 0]`
(F1–F6 all `"rows": []`, exits 0 ×6, ref confirmed ×6). F6 empty means the three columns are gone, so there is nothing for `col_description` to read; 048 adds no `COMMENT ON`, and F6 read NULL after the UP and after the re-UP (section 2).

**D4 — re-UP**, the same enforced-frame script as A7: project-ref and sha256 printed and enforced, foreground, `[supabase exit 0]`, no error (2026-09-20T06:39:44Z → 06:39:50Z).

**D5 — post-re-UP.** `snap-post-reup.json` versus `snap-post-up.json`: **0 differing lines, `cmp` byte-identical, both sha256 `697fc5954a2d92ba643e728fa1f5c32980264f1c0a84b0821bf55a2d4dd2e55b`** — which includes every `public` function's definition hash and ACL, so the re-created functions are byte-for-byte the applied ones. The six F-queries compared
field by field against the section 2 capture (script `cmp_f.py`; the per-call boundary ignored):

```
F1: 2 rows  identical to A8 (all fields)
F2: 2 rows  identical to A8 (all fields)
F3: 2 rows  identical to A8 (all fields)
F4: 2 rows  identical to A8 (all fields)
F5: 4 rows  identical to A8 except conkey (expected)
     conkey users_registered_by_fkey: A8 {21,3} -> re-UP {24,3}
     conkey users_registered_by_not_self_chk: A8 {21,1} -> re-UP {24,1}
     conkey users_registered_pairing_chk: A8 {21,22,23} -> re-UP {24,25,26}
F6: 3 rows  identical to A8 (all fields)
F2 counts now: [('add_engineers_to_project', 1), ('engineer_admin_gate', 1)] -> 1 and 1
F5 fkey: r a s confkey {1,3} | names: ['project_members_role_check', 'users_registered_by_fkey', 'users_registered_by_not_self_chk', 'users_registered_pairing_chk']
RESULT: NO UNEXPECTED DIFFERENCE
[python exit 0]
```

**F5's `conkey` differs again, as expected** (section 2). `confkey` stayed `{1,3}`, the FK still reads `r`/`a`/`s`, F2 is 1 and 1. **Not applicable before the merge (package §7.4):** the "live in-flight session is still processable after DOWN" check —
no application code calls either function until the app lands, and the deploy order (revert first, then DOWN) is what protects it afterwards.

## 5. Ledger repair (step A11) — [O]

Applied to test-db only, following 045/047's precedent (apply, then `supabase migration repair --status applied <N> --linked`, then `migration list`). **048 alone.** Project-ref printed and enforced in the frame; foreground; no `--yes` passed.

```
--- A2: cat supabase/.temp/project-ref:
exfccwlrhoutkgrlikod
REF CONFIRMED: exfccwlrhoutkgrlikod (test-db)
--- date (UTC): 2026-09-20T06:42:34Z
--- supabase migration repair --status applied 048 --linked   (foreground):
Initialising login role...
Connecting to remote database...
Repaired migration history: [048] => applied
{"versions":["048"],"status":"applied","repairAll":false,"message":"Migration history repaired"}
[supabase exit 0]
--- supabase migration list --linked:
Initialising login role...
Connecting to remote database...
{"migrations":[{"local":"001","remote":"001","time":"001"},{"local":"002","remote":"002","time":"002"},{"local":"003","remote":"003","time":"003"},{"local":"004","remote":"004","time":"004"},{"local":"005","remote":"005","time":"005"},{"local":"006","remote":"006","time":"006"},{"local":"007","remote":"007","time":"007"},{"local":"011","remote":"011","time":"011"},{"local":"012","remote":"012","time":"012"},{"local":"013","remote":"013","time":"013"},{"local":"014","remote":"014","time":"014"},{"local":"015","remote":"015","time":"015"},{"local":"016","remote":"016","time":"016"},{"local":"017","remote":"017","time":"017"},{"local":"018","remote":"018","time":"018"},{"local":"019","remote":"019","time":"019"},{"local":"020","remote":"020","time":"020"},{"local":"021","remote":"021","time":"021"},{"local":"022","remote":"022","time":"022"},{"local":"023","remote":"023","time":"023"},{"local":"024","remote":"024","time":"024"},{"local":"025","remote":"025","time":"025"},{"local":"027","remote":"027","time":"027"},{"local":"028","remote":"028","time":"028"},{"local":"029","remote":"029","time":"029"},{"local":"030","remote":"030","time":"030"},{"local":"031","remote":"031","time":"031"},{"local":"032","remote":"032","time":"032"},{"local":"033","remote":"033","time":"033"},{"local":"034","remote":"034","time":"034"},{"local":"035","remote":"035","time":"035"},{"local":"036","remote":"036","time":"036"},{"local":"037","remote":"037","time":"037"},{"local":"038","remote":"038","time":"038"},{"local":"039","remote":"039","time":"039"},{"local":"040","remote":"040","time":"040"},{"local":"041","remote":"041","time":"041"},{"local":"042","remote":"","time":"042"},{"local":"043","remote":"","time":"043"},{"local":"044","remote":"","time":"044"},{"local":"045","remote":"045","time":"045"},{"local":"046","remote":"","time":"046"},{"local":"047","remote":"047","time":"047"},{"local":"048","remote":"048","time":"048"}],"message":"Migrations listed"}
[supabase exit 0]
--- date (UTC): 2026-09-20T06:42:54Z

================================================================================
```

`048` is now local `048` / remote `048`. **`042`, `043`, `044`, `046` remain local-only with an empty remote, exactly as before — not repaired, not touched** (a pre-existing, unrelated test-db ledger lag; same posture as 045's and 047's records).

## 6. Observation (a) — anon and service_role are refused through PostgREST — [O]

Package §12 step 2(a). Reads only; nothing written. The target was proven **before any call**: the URL host, `SUPABASE_TEST_PROJECT_REF` and **both keys' JWT `ref` claims** all equal `exfccwlrhoutkgrlikod`, and the roles are `anon` and `service_role`
(only those public claim fields were printed; **no key, token or header was ever printed**; the log holds no JWT-shaped string). The criterion is the **body code**, not the HTTP status.

```
URL host: exfccwlrhoutkgrlikod.supabase.co
SUPABASE_TEST_PROJECT_REF: exfccwlrhoutkgrlikod
anon key JWT claims (public fields only): {'ref': 'exfccwlrhoutkgrlikod', 'role': 'anon'}
service key JWT claims (public fields only): {'ref': 'exfccwlrhoutkgrlikod', 'role': 'service_role'}
TARGET CHECK PASSED: URL host, PROJECT_REF and both JWT ref claims == exfccwlrhoutkgrlikod; roles anon / service_role as expected.

--- POST /rest/v1/rpc/add_engineers_to_project as anon
    request body: {"p_project_id": "00000000-0000-0000-0000-000000000000", "p_engineers": [], "p_dry_run": true, "p_consent_attested": true}
    HTTP 401  body: {"code":"42501","details":null,"hint":null,"message":"permission denied for function add_engineers_to_project"}
    -> 42501 refusal observed (PASS for this call)

--- POST /rest/v1/rpc/add_engineers_to_project as service_role
    request body: {"p_project_id": "00000000-0000-0000-0000-000000000000", "p_engineers": [], "p_dry_run": true, "p_consent_attested": true}
    HTTP 403  body: {"code":"42501","details":null,"hint":null,"message":"permission denied for function add_engineers_to_project"}
    -> 42501 refusal observed (PASS for this call)

--- POST /rest/v1/rpc/engineer_admin_gate as anon
    request body: {"p_project_id": "00000000-0000-0000-0000-000000000000"}
    HTTP 401  body: {"code":"42501","details":null,"hint":null,"message":"permission denied for function engineer_admin_gate"}
    -> 42501 refusal observed (PASS for this call)

--- POST /rest/v1/rpc/engineer_admin_gate as service_role
    request body: {"p_project_id": "00000000-0000-0000-0000-000000000000"}
    HTTP 403  body: {"code":"42501","details":null,"hint":null,"message":"permission denied for function engineer_admin_gate"}
    -> 42501 refusal observed (PASS for this call)

=== SUMMARY (criterion = body code 42501; HTTP status is not the criterion) ===
  add_engineers_to_project   anon          HTTP 401  code 42501  
  add_engineers_to_project   service_role  HTTP 403  code 42501  
  engineer_admin_gate        anon          HTTP 401  code 42501  
  engineer_admin_gate        service_role  HTTP 403  code 42501  
RESULT: ALL FOUR calls refused with 42501
[python exit 0]
```

**Four of four refused with `"code":"42501"`, no 2xx, no other body code, no `PGRST202`** (so no stale schema cache and no retry). The request body used an **empty `p_engineers` array** and a nil UUID — it never reached the function body, and it mints no phone number.
This is the anon-key call `CLAUDE.md` §6 requires in every `SECURITY DEFINER` function's review package, run **on test-db**; the **prod** one is still owed (section 14).

## 7. Observation (b) — R3-U-2 resolved: a real authenticated call succeeds — [O]

Package §6 "What the scaffold CANNOT show (R3-U-2)": the scaffold's `postgres` is a superuser **[R]**, so it could not show that a **non-superuser** authenticated caller can reach the ACL-locked helper `engineer_admin_gate` through the definer function's owner chain.
This observation **does**: the caller's JWT role is `authenticated` (claim printed below), and the call returned a normal result — which requires `add_engineers_to_project` to execute the helper as its first step (`engineer_admin_gate` carries `{postgres=X/postgres}` only, section 2). It did **not** fail with
`permission denied for function engineer_admin_gate`.

Fixture (through the service role; **project created `on_hold`** so no roster can ever load it; every id saved as created): tenant → auth user (Admin API) → claim of the `handle_new_user` stub by `auth_id` (`role = admin`, tenant set) → project → password sign-in. Ids:

```
# observation (b) fixture, created 20260920T065049Z, test-db exfccwlrhoutkgrlikod
target_ref=exfccwlrhoutkgrlikod
tenant_id=4c2ec8ae-1029-43f5-af3a-99721fe9b77a
tenant_slug=zz-048-obs-b-eef508
auth_user_id=bf5cc0f9-5dee-4439-b538-a16e8c9ef72f
auth_email=zz-048-obs-eef508@quoco.test
users_id=7c0ba656-c4d5-462f-9f53-1a19c32c3aa1
project_id=0232e547-c3e0-486e-99bf-0e162da175ce
# CLEANED UP (B3), all counts verified 0
# B1 sign-in line (a meaningless trailing label in the print statement is omitted):
JWT public claims: role=authenticated sub==auth_user_id: True
```

The call, and the proof that nothing was written:

```
URL host: exfccwlrhoutkgrlikod.supabase.co | PROJECT_REF: exfccwlrhoutkgrlikod | anon claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'anon'} | service claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'service_role'}
TARGET CHECK PASSED: everything == exfccwlrhoutkgrlikod

BEFORE the call (service role, read-only): users with whatsapp_number = +15550480002: 0; users in fixture tenant: 1; project_members on fixture project: 0

--- POST /rest/v1/rpc/add_engineers_to_project as the signed-in admin (apikey = anon key, Authorization = admin JWT; neither printed)
    request body: {"p_project_id": "0232e547-c3e0-486e-99bf-0e162da175ce", "p_engineers": [{"name": "ZZ 048 Obs Engineer", "whatsapp_number": "+15550480002"}], "p_dry_run": true, "p_consent_attested": true}
    HTTP 200
    body: {"rows": [{"idx": 0, "status": "ok"}], "applied": false}

VERDICT: PASS

AFTER the call (service role, read-only): SELECT count(*) FROM public.users WHERE whatsapp_number = '+15550480002': 0  | users in fixture tenant: 1 | project_members on fixture project: 0
NOTHING WRITTEN: PASS
[python exit 0]
```

**HTTP 200, body `{"rows":[{"idx":0,"status":"ok"}],"applied":false}`** — exactly the pass body (key order differs from the instruction; content identical). **Nothing written:** `users` with the number 0 before and 0 after; users in the fixture tenant 1 and 1; `project_members` on the project 0 and 0.
**R3-U-2 is resolved in the good direction; the grant design works on test-db.** (T13's boundary literal was **not** used here; this used `+15550480002`, and the T13 test is still unbuilt.)

**Cleanup — extensional, pinned to the saved ids, each `DELETE` `Prefer: return=representation` with a second pin beside the id, each returning exactly 1:**

```
URL host: exfccwlrhoutkgrlikod.supabase.co | PROJECT_REF: exfccwlrhoutkgrlikod | anon claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'anon'} | service claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'service_role'}
TARGET CHECK PASSED: everything == exfccwlrhoutkgrlikod
pinned ids: tenant=4c2ec8ae-1029-43f5-af3a-99721fe9b77a slug=zz-048-obs-b-eef508 project=0232e547-c3e0-486e-99bf-0e162da175ce users=7c0ba656-c4d5-462f-9f53-1a19c32c3aa1 auth_user=bf5cc0f9-5dee-4439-b538-a16e8c9ef72f

[1/4] project
  DELETE /rest/v1/projects?id=eq.0232e547-c3e0-486e-99bf-0e162da175ce&tenant_id=eq.4c2ec8ae-1029-43f5-af3a-99721fe9b77a
    HTTP 200  returned rows: 1  (ids: 0232e547-c3e0-486e-99bf-0e162da175ce)
    -> count == 1  OK

[2/4] users row
  DELETE /rest/v1/users?id=eq.7c0ba656-c4d5-462f-9f53-1a19c32c3aa1&tenant_id=eq.4c2ec8ae-1029-43f5-af3a-99721fe9b77a&auth_id=eq.bf5cc0f9-5dee-4439-b538-a16e8c9ef72f
    HTTP 200  returned rows: 1  (ids: 7c0ba656-c4d5-462f-9f53-1a19c32c3aa1)
    -> count == 1  OK

[3/4] auth user (Admin API; no row representation, so count is proven 1 -> 0 by GET before and after)
  before: GET admin/users/bf5cc0f9-5dee-4439-b538-a16e8c9ef72f -> HTTP 200, id matches, email zz-048-obs-eef508@quoco.test  (count 1)
  DELETE admin/users/bf5cc0f9-5dee-4439-b538-a16e8c9ef72f -> HTTP 200
  after:  GET admin/users/bf5cc0f9-5dee-4439-b538-a16e8c9ef72f -> HTTP 404  (404 = count 0)

[4/4] tenant
  DELETE /rest/v1/tenants?id=eq.4c2ec8ae-1029-43f5-af3a-99721fe9b77a&slug=eq.zz-048-obs-b-eef508
    HTTP 200  returned rows: 1  (ids: 4c2ec8ae-1029-43f5-af3a-99721fe9b77a)
    -> count == 1  OK

=== CONFIRMATION (service role reads) ===
  SELECT count(*) FROM public.tenants WHERE id = '<T>': 0
  projects WHERE id = '<P>': 0
  projects WHERE tenant_id = '<T>': 0
  users WHERE id = '<U>' OR tenant_id = '<T>': 0
  users WHERE auth_id = '<A>': 0
  users WHERE whatsapp_number = '+15550480002': 0
  project_members WHERE project_id = '<P>': 0

CLEANUP COMPLETE: every pinned row is gone; tenant count = 0.
JWT file deleted from job tmp dir.
[python exit 0]
```

## 8. Types regeneration and typecheck (commit `fd96199`) — [O] except where marked

Regenerated with `supabase gen types typescript --linked --schema public` against test-db (CLI 2.109.1, ref printed and compared in the frame, exit 0, 0 stderr lines) into a temp file, diffed **before** overwriting. The diff (+39 lines, 0 removed; saved as `types-regen.diff`):
`users` +3 columns in Row/Insert/Update; `add_engineers_to_project`; `engineer_admin_gate` — **plus two things not in the "three columns and two functions" the step authorised**, which halted the step until Aravind decided:

1. `users_registered_by_fkey` in the `users` Relationships — 048's own FK, a direct consequence of the migration, not drift.
2. `quoco_test_047_unused_rights_check` — a **test-db-only** helper (`scripts/test-db-only-047-rights-check.sql`), not from 048 and absent from prod.

**Decision (Aravind [R]): accept the regenerated file as-is, both extras included** — `quoco_test_row_is_locked` (its sibling) is already in the committed types, so the file has always described test-db rather than prod, and hand-editing generated output would make the file
unreproducible by the command that generates it. Committed unedited (sha256 `54c21b3e1003cf6ba219669b5adb9b95205cb2c8f2f1f2b906f7d7b0463dc2a5`). **Consequence to remember: prod's own regeneration will differ** from this file until 048 (and the test-only helpers, which prod will never have) line up.

**Typecheck:** `tsc --noEmit --incremental false` → **exit 0, zero errors** on the new types. A plain `tsc --noEmit` first showed two errors (`lib/media/ingest.ts:155`, `lib/whatsapp/inbound-start.ts:835`, both `daily_logs` updates with a computed key); the **same two** appeared with the previously committed types restored, so they were not caused
by this change; CI's Typecheck job was green on `main` and on the previous PR run. **Cause: a stale local `tsconfig.tsbuildinfo` — inferred** from the errors vanishing when the incremental cache was bypassed, **not** independently confirmed.

## 9. CI on the PR head — fully green (package §8.3's rule) — [O]

```
$ gh run view 35496136697 --json ...
run 35496136697 status=completed conclusion=success
headSha=fd96199600ec3325a8150a855fd4971b60918575
url=https://github.com/ara-2789/Quoco/actions/runs/35496136697
createdAt=2026-09-20T07:10:00Z updatedAt=2026-09-20T07:32:11Z
Test (real test-db): conclusion=success started=2026-09-20T07:10:10Z completed=2026-09-20T07:32:11Z
$ gh run list (not completed, all branches)
(end of not-completed list)
PR head (origin): fd96199600ec3325a8150a855fd4971b60918575
```

Pinned: **run 35496136697, `headSha` `fd96199600ec3325a8150a855fd4971b60918575` = the PR head on origin at that moment, `conclusion: success`, attempt 1.**
URL: **https://github.com/ara-2789/Quoco/actions/runs/35496136697**
The `Test (real test-db)` job ran 07:10:10Z → 07:32:11Z, `success`; vitest: **119 files passed (119), 1350 tests passed | 1 todo (1351), 0 `FAIL` lines**, and **the old error is absent**: the job log contains **0** occurrences of `registered_by`, `does not exist`,
`sweepSharedFixtureReferences` or `projects_owner_user_id_fkey` (the M1 error text of package §8.2 and the M2 contamination signature). All 119 test files passed, which necessarily includes the 21 files that failed with M1 before the apply (**that list of 21 is package §8.2's [R]**; this session did not re-derive it).
**Under package §8.3 the rule for this PR after the apply is that any failure is *new*; there were none.**
**Caveat that matters for the merge:** "green" is pinned to `fd96199`. This record's own commit moves the PR head, and the CI docs-only filter looks at the **whole PR's** file list (this PR contains non-doc files), so the next push runs the full `Test (real test-db)` job again.
The merge gate needs a green run whose `headSha` equals the head **at merge**; **the run for this record's own commit is not covered by this record.**

## 10. The stranded-row sweep — zero rows on the redesigned criterion — [O]

Read-only; nothing deleted. Run **after** the CI run completed and with no other run in flight (`gh run list` not-completed = empty). Package §12 step 4 requires this **before** "fully green" is claimed.

**The old criterion, "zero `zz-%` tenants", is recorded as UNUSABLE — it can never pass on this database.** Reasons: (1) the persistent outbound-send tenant `00000000-0000-4000-a000-000000031000` (`zz-outbound-send`) is a `zz-` tenant that persists **by design** and accretes users on every run
(`docs/reviews/outbound-sends-test-accretion.md`; observed this session: its user count grew by exactly 4 during the CI run, below); (2) the strands from failed runs on 2026-09-19 are left in place by decision (section 11); (3) older residue from 2026-09-13 to 2026-09-17 exists (section 11, part D [R]).
A criterion that a healthy database cannot satisfy cannot certify anything.

**The redesigned criterion (section 11's rule, dated 2026-09-20):** tenants created **at or after the run's `Test` job start** (`2026-09-20T07:10:10Z`, per Aravind [R]; the earlier text used the run's `createdAt` `07:10:00Z` — immaterial, the control below shows nothing newer than 2026-09-19 18:28:59Z exists), **excluding** the persistent tenant and the 14 known ids, plus
the companion users query. **PASS = 0 rows in the tenants query, 0 rows in the users query, and the run's conclusion `success` with `headSha` = the PR head.**

**Query 1 — tenants (the criterion)** — ref confirmed in the frame, `[supabase exit 0]`:

```sql
-- SWEEP 1/2 (READ-ONLY): tenants created at or after the test job's start (2026-09-20T07:10:10Z, run 35496136697), excluding the persistent
-- outbound-send tenant and the 14 known stranded tenants. PASS = 0 rows.
SELECT t.id, t.slug, t.created_at,
       (SELECT count(*) FROM public.users u            WHERE u.tenant_id = t.id) AS users,
       (SELECT count(*) FROM public.projects p         WHERE p.tenant_id = t.id) AS projects,
       (SELECT count(*) FROM public.project_members m  WHERE m.tenant_id = t.id) AS members,
       (SELECT count(*) FROM public.daily_logs d       WHERE d.tenant_id = t.id) AS daily_logs,
       (SELECT count(*) FROM public.dprs d             WHERE d.tenant_id = t.id) AS dprs,
       (SELECT count(*) FROM public.whatsapp_sessions s WHERE s.tenant_id = t.id) AS sessions
FROM public.tenants t
WHERE t.created_at >= '2026-09-20T07:10:10Z'
  AND t.id <> '00000000-0000-4000-a000-000000031000'
  AND t.id NOT IN ('29e04518-e9cd-4aaa-9aa4-21e50ce0b756','49e3a24b-5ee1-42c5-a91e-7f290cbd511e','39d65f70-3ab3-4598-8f64-76f27efd032b',
                   'e2003340-15a9-4e0b-9c5a-289a72e3d3db','353384a7-efa5-4a9d-871f-892bd3166df1','fed961ae-5ce8-46d0-90f1-a2c2f915f9c6',
                   '02c503e1-4f0b-4408-a394-069cba9c14e3','f988fac3-1851-43ab-8d02-52bc99185672','3c408925-3b3c-44a0-9909-4e3454e1aefc',
                   'a1035883-ed91-4e95-8933-aec78f1e6975','5b0c6883-24ce-4ea4-8cc9-12c6ebbeaeb9','4573d413-0c9f-456e-8fd6-394f52fa1a6b',
                   '8fae7c7c-fcf9-4b99-b5d1-f2351a971bca','5fe52fc7-bf10-40b0-b980-f5a0c7f9fc95')
ORDER BY t.created_at;
```

```json
[]
```

**Query 2 — users (companion)** — ref confirmed in the frame, `[supabase exit 0]`:

```sql
-- SWEEP 2/2 (READ-ONLY, companion): users created at or after the test job's start (2026-09-20T07:10:10Z), outside the persistent outbound-send tenant.
-- PASS = 0 rows.
SELECT u.id, u.tenant_id, u.role, u.status, u.full_name, u.created_at
FROM public.users u
WHERE u.created_at >= '2026-09-20T07:10:10Z'
  AND u.tenant_id IS DISTINCT FROM '00000000-0000-4000-a000-000000031000'
ORDER BY u.created_at;
```

```json
[]
```

**Control — proves the query shape can see strands** — ref confirmed in the frame, `[supabase exit 0]`:

```sql
-- SWEEP CONTROL (READ-ONLY): the tenants query with an EARLIER cutoff and NO known-id exclusion. It must SEE the known stranded tenants
-- (so 'zero rows' in the real sweep is not just a blind query). Expect >= the 14 known + the 2 from this PR's earlier pushes, and 0 outside the
-- persistent tenant that were created after 07:10:10Z.
SELECT count(*) FILTER (WHERE t.created_at >= '2026-09-19T00:00:00Z')                              AS since_2026_09_19,
       count(*) FILTER (WHERE t.created_at >= '2026-09-19T00:00:00Z' AND t.slug LIKE 'zz-test-session-transition-%') AS of_which_session_transition,
       count(*) FILTER (WHERE t.created_at >= '2026-09-19T00:00:00Z' AND t.slug LIKE 'zz-007-tenant-%')             AS of_which_007_pair,
       count(*) FILTER (WHERE t.created_at >= '2026-09-20T07:10:10Z')                              AS since_test_job_start_incl_everything,
       max(t.created_at)                                                                            AS newest_created_at
FROM public.tenants t
WHERE t.id <> '00000000-0000-4000-a000-000000031000';
```

```json
[
  {
    "newest_created_at": "2026-09-19 18:28:59.684359+00",
    "of_which_007_pair": 2,
    "of_which_session_transition": 14,
    "since_2026_09_19": 16,
    "since_test_job_start_incl_everything": 0
  }
]
```

**For UNKNOWN #69 (section 13) — is the users→users edge populated?** — ref confirmed in the frame, `[supabase exit 0]`:

```sql
-- #69 READ-ONLY evidence: is the users->users self-referential edge populated anywhere on test-db right now? (registered_by, registered_at, consent_attested are all NULL together by the pairing CHECK.)
SELECT count(*) FILTER (WHERE registered_by IS NOT NULL)  AS rows_with_registered_by,
       count(*) FILTER (WHERE registered_at IS NOT NULL)  AS rows_with_registered_at,
       count(*) FILTER (WHERE consent_attested IS NOT NULL) AS rows_with_consent_attested,
       count(*)                                          AS users_total
FROM public.users;
```

```json
[
  {
    "rows_with_consent_attested": 0,
    "rows_with_registered_at": 0,
    "rows_with_registered_by": 0,
    "users_total": 1936
  }
]
```

**Where did the users created since the pre-apply snapshot go? (1932 → 1936)** — ref confirmed in the frame, `[supabase exit 0]`:

```sql
-- READ-ONLY: where did the users created since the pre-apply snapshot (2026-09-20 06:26Z) go? Grouped by tenant. Explains 1932 -> 1936.
SELECT u.tenant_id, count(*) AS n, min(u.created_at) AS first_created, max(u.created_at) AS last_created
FROM public.users u
WHERE u.created_at >= '2026-09-20T06:20:00Z'
GROUP BY u.tenant_id
ORDER BY n DESC;
```

```json
[
  {
    "first_created": "2026-09-20 07:13:51.410525+00",
    "last_created": "2026-09-20 07:27:05.244588+00",
    "n": 4,
    "tenant_id": "00000000-0000-4000-a000-000000031000"
  }
]
```


**Result: PASS.** Tenants 0 rows; users 0 rows; run `success` at `headSha` `fd96199` = PR head (section 9). **Control** (same shape, earlier cutoff, no known-id exclusion): **16** tenants since 2026-09-19 — 14 `zz-test-session-transition-*` + 2 `zz-007-tenant-*` = the 14 known plus the 2 from earlier pushes — newest `2026-09-19 18:28:59Z`, and **0** created since `07:10:10Z`:
the query can see strands, and this run stranded none.
**Where the 4 new users went (1932 → 1936):** all four in the persistent outbound-send tenant, created 07:13:51Z–07:27:05Z (during the CI run) — its documented accretion; none in any other tenant since 06:20Z.

## 11. Known stranded tenants on test-db — the pinned list (moved into the repo from `~/Desktop/048-known-tenants-section.md`)

**Provenance of this section: [R].** The per-id fields (slug, `created_at`, users, projects) and part D's counts come from the prepared section written earlier on 2026-09-20 (its text says: from the live test-db catalog, read-only, ids from the cleanup record `~/Desktop/048-cleanup.txt`),
**not re-read in this session** — this session's only check of the set is the section 10 control, whose **count of 16 agrees** with A + B below. A pass criterion that names a set must carry the set (`CLAUDE.md` §0); this is that set, now in version control.

### A. The 14 known stranded tenants — cause: failed local/agent `vitest` runs on 2026-09-19 (package §8.5); left in place by decision

| # | tenant id | slug | created_at (last re-creation, UTC) | users | projects |
|---|---|---|---|---|---|
| 1 | `29e04518-e9cd-4aaa-9aa4-21e50ce0b756` | `zz-test-session-transition-cb8b1b8a-6dde-4f28-b807-a3dba85386e6` | 2026-09-19 16:34:47 | 1 | 0 |
| 2 | `49e3a24b-5ee1-42c5-a91e-7f290cbd511e` | `zz-007-tenant-a-cb8b1b8a-6dde-4f28-b807-a3dba85386e6` | 2026-09-19 16:41:42 | 1 | 1 |
| 3 | `39d65f70-3ab3-4598-8f64-76f27efd032b` | `zz-007-tenant-b-cb8b1b8a-6dde-4f28-b807-a3dba85386e6` | 2026-09-19 16:41:42 | 1 | 1 |
| 4 | `e2003340-15a9-4e0b-9c5a-289a72e3d3db` | `zz-test-session-transition-ac912424-9da8-4c7a-ab46-b8c5fefc2ec5` | 2026-09-19 16:49:00 | 1 | 0 |
| 5 | `353384a7-efa5-4a9d-871f-892bd3166df1` | `zz-test-session-transition-29c96461-6494-409a-9833-d4ca32a38d82` | 2026-09-19 16:52:46 | 1 | 0 |
| 6 | `fed961ae-5ce8-46d0-90f1-a2c2f915f9c6` | `zz-test-session-transition-4ae38061-d701-4d0b-8eed-e361273abf30` | 2026-09-19 16:58:09 | 1 | 0 |
| 7 | `02c503e1-4f0b-4408-a394-069cba9c14e3` | `zz-test-session-transition-ba1bb11e-f212-4bcf-b12a-ab6c1d92a055` | 2026-09-19 16:58:59 | 1 | 0 |
| 8 | `f988fac3-1851-43ab-8d02-52bc99185672` | `zz-test-session-transition-0a2a90d9-0cde-44ab-bd67-9eeabe1be12a` | 2026-09-19 17:00:27 | 1 | 0 |
| 9 | `3c408925-3b3c-44a0-9909-4e3454e1aefc` | `zz-test-session-transition-05959bbd-84d8-4b07-a072-10381b2a1998` | 2026-09-19 17:01:35 | 1 | 0 |
| 10 | `a1035883-ed91-4e95-8933-aec78f1e6975` | `zz-test-session-transition-3e105d0f-e629-48a5-932f-396400374d50` | 2026-09-19 17:02:04 | 1 | 0 |
| 11 | `5b0c6883-24ce-4ea4-8cc9-12c6ebbeaeb9` | `zz-test-session-transition-d07d7e41-54a3-41b9-b309-b111ced96d0c` | 2026-09-19 17:02:56 | 1 | 0 |
| 12 | `4573d413-0c9f-456e-8fd6-394f52fa1a6b` | `zz-test-session-transition-a5c54cd2-472a-41f7-afb3-0bc6d8fe89b8` | 2026-09-19 17:03:15 | 1 | 0 |
| 13 | `8fae7c7c-fcf9-4b99-b5d1-f2351a971bca` | `zz-test-session-transition-512735d3-74fb-46fb-9ed5-bc4a9a9146a0` | 2026-09-19 17:03:49 | 1 | 0 |
| 14 | `5fe52fc7-bf10-40b0-b980-f5a0c7f9fc95` | `zz-test-session-transition-52a7bd81-061c-4a54-896e-de808a6af8d2` | 2026-09-19 17:42:01 | 1 | 0 |

Rows 1-13 are the "13 known" of `docs/reviews/048-review-package.md` §8.5 (11 `zz-test-session-transition-*` + the `zz-007-tenant-{a,b}` pair, which share run id `cb8b1b8a…` with row 1 — i.e. 11 distinct
runs). Row 14 is the tenant of CI run 35458046968 (this PR, 17:25:28Z start), found after the package §8.5 cleanup. All 14 were, per the prepared section, verified present on 2026-09-20 **[R]** (not re-verified in this session).

### B. Stranded by this PR's own CI pushes after list A was written — ADDED to the known list by this record

| tenant id | slug | created_at (UTC) | users | attributed to (by window; slug run id not mappable to a CI run) |
|---|---|---|---|---|
| `a6194458-7d33-4d24-b49d-93b0ebe916e0` | `zz-test-session-transition-aadd8183-367b-4736-a0e0-8a73aea20743` | 2026-09-19 18:06:34 | 1 | run 35458696055 (17:38:04-~18:13:50Z) |
| `e3393109-f708-47f4-b1e0-18c53d9eabb8` | `zz-test-session-transition-ed1f9f9b-be66-49df-864c-06a57a1ba368` | 2026-09-19 18:28:59 | 1 (`f2964ad5-d6ed-4677-859d-3cb0cffd6b5b`) | run 35460472253 @ `67b6e3b` (test job 18:13:51-18:36:20Z) |

Pattern: one stranded tenant and one stranded user per failed run (each failed run's teardown throws before its tenant is deleted).

### C. Documented persistent tenant — EXCLUDED from every sweep by design

`00000000-0000-4000-a000-000000031000` (`zz-outbound-send`, "ZZ Test Tenant (outbound-send suite)", created 2026-08-27; live 2026-09-20: 1,888 users, 114 daily_logs,
1 project, 491 sessions). It accretes minted engineers on every run — `docs/reviews/outbound-sends-test-accretion.md`. Not stranded; not swept.

### D. Older residue NOT from this PR — excluded by the time criterion, not listed by id, not swept (Aravind's decision to make)

29 tenants created 2026-09-13 to 2026-09-17 (live 2026-09-20): 12 `zz-007-tenant-{a,b}-<run id>` (12 users) and 17 `zz-test-session-transition-<run id>` (5 users).

### E. The sweep criterion

Section 10 above — the queries as they were **run**, with the cutoff `2026-09-20T07:10:10Z`. To reuse it, replace the cutoff with the new run's `Test` job start, and **add part B's two ids to the exclusion list** (they are older than any new run's start, so the time filter already excludes them; the list is a belt).
Notes carried from the prepared section: `supabase db query -f` returns only the last result set of a file, so the two queries are two files; an overlapping run (CI or a local/agent `vitest` on test-db) makes tenants appear that are not this run's — check for one before reading a row as a strand;
do not extend the users query with `registered_by` before the columns exist (they do now).

## 12. Typo-repair runbook rehearsal, R1–R8 — [O]

`docs/reviews/048-typo-repair-runbook.md`, on a fresh fixture of the section 7 shape (**project `on_hold`**), engineer `+15550480003`. The runbook's SQL blocks were **extracted from the runbook file by script and only the placeholders substituted**, so nothing was retyped.
Aravind's go-ahead was in the same exchange before the `UPDATE`. (The `saved to B-ids.txt` label in the rehearsal's printed output is a **stale print string in the shared helper**; the file actually written was `R-ids.txt`.) Ids: tenant `6a77113a-17a0-424a-897e-407ca20f4f2c`, admin `61f8c0e6-64ee-45f3-b855-59be6709402e`, project `a2c62895-5151-4a64-a8db-b369cf9e8380` (`on_hold`), engineer `a9eddfd7-ce58-4db1-be92-89a0a340369c`.

**R1 — create the engineer through the function in APPLY mode**, as the fixture admin (JWT; not printed). PASS: `applied: true`, one row `added`.

```
URL host: exfccwlrhoutkgrlikod.supabase.co | PROJECT_REF: exfccwlrhoutkgrlikod | anon claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'anon'} | service claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'service_role'}
TARGET CHECK PASSED: everything == exfccwlrhoutkgrlikod
BEFORE: users with whatsapp_number = +15550480003: 0

--- POST /rest/v1/rpc/add_engineers_to_project as the signed-in fixture admin (APPLY mode; keys not printed)
    request body: {"p_project_id": "a2c62895-5151-4a64-a8db-b369cf9e8380", "p_engineers": [{"name": "ZZ 048 Rehearsal Engineer", "whatsapp_number": "+15550480003"}], "p_dry_run": false, "p_consent_attested": true}
    HTTP 200
    body: {"rows": [{"idx": 0, "status": "added", "user_id": "a9eddfd7-ce58-4db1-be92-89a0a340369c"}], "applied": true}
  saved to B-ids.txt: engineer_user_id=a9eddfd7-ce58-4db1-be92-89a0a340369c
  saved to B-ids.txt: engineer_number=+15550480003

R1 PASS: applied=true, one row, status 'added'. engineer user_id = a9eddfd7-ce58-4db1-be92-89a0a340369c
[python exit 0]
```

**R2 — Step 1 pre-probe** (runbook Step 1, number and tenant filled). Exactly one row: `status` active; `registered_by` = the admin's `users.id`; `registered_at` set; `consent_attested` true; one `engineer` membership.

```sql
SELECT u.id, u.tenant_id, u.full_name, u.whatsapp_number, u.status,
       u.registered_by, u.registered_at, u.consent_attested,
       (SELECT jsonb_agg(jsonb_build_object('project_id', m.project_id, 'role', m.role) ORDER BY m.project_id)
          FROM public.project_members m WHERE m.user_id = u.id) AS memberships
FROM public.users u
WHERE u.whatsapp_number = '+15550480003'
  AND u.tenant_id = '6a77113a-17a0-424a-897e-407ca20f4f2c';
```

```json
[
  {
    "consent_attested": true,
    "full_name": "ZZ 048 Rehearsal Engineer",
    "id": "a9eddfd7-ce58-4db1-be92-89a0a340369c",
    "memberships": [
      {
        "project_id": "a2c62895-5151-4a64-a8db-b369cf9e8380",
        "role": "engineer"
      }
    ],
    "registered_at": "2026-09-20 08:03:54.770354+00",
    "registered_by": "61f8c0e6-64ee-45f3-b855-59be6709402e",
    "status": "active",
    "tenant_id": "6a77113a-17a0-424a-897e-407ca20f4f2c",
    "whatsapp_number": "+15550480003"
  }
]
```

```
[check step1] CLI exit ok: True; rows: 1
   OK  id == engineer user_id
   OK  tenant_id == fixture tenant
   OK  whatsapp_number == +15550480003
   OK  status == active
   OK  registered_by == the admin's users.id
   OK  registered_at set
   OK  consent_attested == true (as passed)
   OK  exactly one membership, role engineer, this project
   pre-probe row saved (rehearsal-pre-probe.json). PROCEED: exactly one row.
```

**R3 — Step 3b BEFORE the repair: 1 row. That is the natural red** — before the repair the engineer **is** on the roster predicate, so the zero-row reading after the repair means something.

```sql
SELECT m.project_id
FROM public.project_members m
JOIN public.users u ON u.id = m.user_id
WHERE u.id = 'a9eddfd7-ce58-4db1-be92-89a0a340369c'
  AND u.role = 'engineer'
  AND u.status = 'active'
  AND u.messaging_blocked = false;
```

```json
[
  {
    "project_id": "a2c62895-5151-4a64-a8db-b369cf9e8380"
  }
]
```

```
[check step3b_before] CLI exit ok: True; rows: 1
   3b rows: 1 -> [{'project_id': 'a2c62895-5151-4a64-a8db-b369cf9e8380'}]
   NATURAL RED CONFIRMED: the engineer IS on the roster predicate before the repair (1 row).
```

**R4 — Step 2**, `<ID>` and `<TENANT_ID>` filled from R2's output, written to a file, printed in full, then run (project-ref printed in the frame; the `DO` block raises unless exactly 1 row is updated):

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.users
     SET status = 'deactivated'
   WHERE id = 'a9eddfd7-ce58-4db1-be92-89a0a340369c'
     AND tenant_id = '6a77113a-17a0-424a-897e-407ca20f4f2c';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'typo-repair: expected exactly 1 row, updated %', n;
  END IF;
END $$;
COMMIT;
```

Result (`DO` block returns no rows; **the CLI exited 0, so the block did not raise**):

```json
[]
```

```
[check step2] CLI exit ok: True; rows: 0
   step 2 result rows: 0 (a DO block returns none); CLI exit 0 => the DO block did not raise, i.e. exactly 1 row was updated
```

**R5 — Step 3a** (the Step 1 query again): `status` `active → deactivated`, **every other column identical to R2**. **Step 3b: 0 rows.**

Step 3a — the Step 1 query, unchanged (same text as R2), result:

```json
[
  {
    "consent_attested": true,
    "full_name": "ZZ 048 Rehearsal Engineer",
    "id": "a9eddfd7-ce58-4db1-be92-89a0a340369c",
    "memberships": [
      {
        "project_id": "a2c62895-5151-4a64-a8db-b369cf9e8380",
        "role": "engineer"
      }
    ],
    "registered_at": "2026-09-20 08:03:54.770354+00",
    "registered_by": "61f8c0e6-64ee-45f3-b855-59be6709402e",
    "status": "deactivated",
    "tenant_id": "6a77113a-17a0-424a-897e-407ca20f4f2c",
    "whatsapp_number": "+15550480003"
  }
]
```

```
[check step3a] CLI exit ok: True; rows: 1
   columns compared: ['consent_attested', 'full_name', 'id', 'memberships', 'registered_at', 'registered_by', 'status', 'tenant_id', 'whatsapp_number']
   differing columns vs the R2 pre-probe: {'status': ('active', 'deactivated')}
   3a OK: status deactivated; every other column identical to R2.
```

Step 3b — the query printed under R3, result after the repair:

```json
[]
```

```
[check step3b_after] CLI exit ok: True; rows: 0
   3b rows: 0 -> []
   3b OK: ZERO rows -- the engineer is on neither roster.
```

**R6 — Step 4 evidence: the number stays held.** A dry-run call with `+15550480003` as the admin:

```
URL host: exfccwlrhoutkgrlikod.supabase.co | PROJECT_REF: exfccwlrhoutkgrlikod | anon claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'anon'} | service claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'service_role'}
TARGET CHECK PASSED: everything == exfccwlrhoutkgrlikod
--- POST /rest/v1/rpc/add_engineers_to_project as the fixture admin (DRY RUN; keys not printed)
    request body: {"p_project_id": "a2c62895-5151-4a64-a8db-b369cf9e8380", "p_engineers": [{"name": "ZZ 048 Rehearsal Engineer", "whatsapp_number": "+15550480003"}], "p_dry_run": true, "p_consent_attested": true}
    HTTP 200
    body: {"rows": [{"idx": 0, "status": "already_on_this_project"}], "applied": false}

R6 PASS: status = 'already_on_this_project' (not 'ok'); applied = False. Exactly the expected value.
AFTER (service role read): users with the number: [{'id': 'a9eddfd7-ce58-4db1-be92-89a0a340369c', 'status': 'deactivated'}]
[python exit 0]
```

`already_on_this_project`, **not `ok`** — the number cannot be re-added while the deactivated row exists; no slice-1 path frees it (this is the checklist line "a mistyped number stays held").

**R7 — Step 5 (timing) is not exercisable on test-db.** It concerns the production cron schedule (`vercel.json`: morning `0 3 * * *` UTC = 08:30 IST, evening `0 13 * * *` UTC = 18:30 IST **[R]**, from the runbook) and human timing (about thirty minutes from an 08:00 paste); test-db runs no cron, and the rehearsal project is `on_hold`, so nothing could send.

**R8 — cleanup**, pinned to `R-ids.txt`, each returning exactly 1 (membership, engineer `users` row, project, admin `users` row, tenant; auth user 200 → 404), then every confirmation count 0 — including **`outbound_sends` rows for the engineer = 0** and `whatsapp_sessions` = 0, direct evidence that **no message was sent**:

```
URL host: exfccwlrhoutkgrlikod.supabase.co | PROJECT_REF: exfccwlrhoutkgrlikod | anon claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'anon'} | service claims: {'ref': 'exfccwlrhoutkgrlikod', 'role': 'service_role'}
TARGET CHECK PASSED: everything == exfccwlrhoutkgrlikod
pinned ids: tenant=6a77113a-17a0-424a-897e-407ca20f4f2c slug=zz-048-rehearsal-89a724 project=a2c62895-5151-4a64-a8db-b369cf9e8380 admin_users=61f8c0e6-64ee-45f3-b855-59be6709402e auth_user=eda30558-3cc8-42c9-b161-e61362f6ddb1 engineer_users=a9eddfd7-ce58-4db1-be92-89a0a340369c

--- pre-cleanup evidence (read-only)
  outbound_sends rows with recipient_user_id = engineer: 0   (0 = no message was sent to the rehearsal engineer)
  whatsapp_sessions rows for the engineer: 0
  engineer membership rows: [{'id': '21c479af-64a3-4e94-afe2-c094df37815b', 'role': 'engineer'}]
  saved to B-ids.txt: engineer_membership_id=21c479af-64a3-4e94-afe2-c094df37815b

[1/6] engineer's project_members row
  DELETE /rest/v1/project_members?id=eq.21c479af-64a3-4e94-afe2-c094df37815b&user_id=eq.a9eddfd7-ce58-4db1-be92-89a0a340369c&project_id=eq.a2c62895-5151-4a64-a8db-b369cf9e8380&tenant_id=eq.6a77113a-17a0-424a-897e-407ca20f4f2c
    HTTP 200  returned rows: 1  ['21c479af-64a3-4e94-afe2-c094df37815b']
    -> count == 1  OK

[2/6] engineer's users row (the row holding registered_by -> admin: the populated self-referential edge; deleted directly, not via the sweep)
  DELETE /rest/v1/users?id=eq.a9eddfd7-ce58-4db1-be92-89a0a340369c&tenant_id=eq.6a77113a-17a0-424a-897e-407ca20f4f2c&registered_by=eq.61f8c0e6-64ee-45f3-b855-59be6709402e
    HTTP 200  returned rows: 1  ['a9eddfd7-ce58-4db1-be92-89a0a340369c']
    -> count == 1  OK

[3/6] fixture project
  DELETE /rest/v1/projects?id=eq.a2c62895-5151-4a64-a8db-b369cf9e8380&tenant_id=eq.6a77113a-17a0-424a-897e-407ca20f4f2c
    HTTP 200  returned rows: 1  ['a2c62895-5151-4a64-a8db-b369cf9e8380']
    -> count == 1  OK

[4/6] fixture admin users row (ON DELETE RESTRICT protected it while the engineer stood; the engineer is gone)
  DELETE /rest/v1/users?id=eq.61f8c0e6-64ee-45f3-b855-59be6709402e&tenant_id=eq.6a77113a-17a0-424a-897e-407ca20f4f2c&auth_id=eq.eda30558-3cc8-42c9-b161-e61362f6ddb1
    HTTP 200  returned rows: 1  ['61f8c0e6-64ee-45f3-b855-59be6709402e']
    -> count == 1  OK

[5/6] auth user (Admin API; no row representation: count proven 1 -> 0 by GET before and after)
  before: GET admin/users/eda30558-3cc8-42c9-b161-e61362f6ddb1 -> HTTP 200 (count 1)
  DELETE -> HTTP 200
  after:  GET -> HTTP 404 (404 = count 0)

[6/6] tenant
  DELETE /rest/v1/tenants?id=eq.6a77113a-17a0-424a-897e-407ca20f4f2c&slug=eq.zz-048-rehearsal-89a724
    HTTP 200  returned rows: 1  ['6a77113a-17a0-424a-897e-407ca20f4f2c']
    -> count == 1  OK

=== CONFIRMATION (service role reads; all must be 0) ===
  SELECT count(*) FROM public.tenants WHERE id = '<T>': 0
  projects WHERE id = '<P>' or tenant_id = '<T>': 0
  users WHERE id IN (admin, engineer) or tenant_id = '<T>': 0
  users WHERE auth_id = '<A>': 0
  users WHERE whatsapp_number = '+15550480003': 0
  users WHERE registered_by IS NOT NULL (whole table): 0
  project_members WHERE project_id = '<P>' or user_id IN (admin, engineer): 0
  outbound_sends WHERE recipient_user_id = '<engineer>': 0

CLEANUP COMPLETE: every pinned row is gone; tenant count = 0; the users->users edge is empty again.
JWT file deleted from job tmp dir.
[python exit 0]
```

**Two stated limits — this rehearsal does NOT show:**

1. **The Step 3b query is the runbook's own SQL restatement of the roster predicate, not the roster code.** `fetchMorningRoster` / `fetchEveningRoster` (`lib/whatsapp/outbound/roster.ts`, via `fetchActiveEngineers`) were **not exercised**, and **T49** — the test that pins the `users.status = 'active'` filter inside the roster — is **specified in the package and unbuilt**.
2. **`on_hold` keeps the engineer off the roster regardless.** The neutralised project is what makes the rehearsal safe, and it means the roster would not have loaded this engineer before *or* after the repair. So the rehearsal proves the runbook's statements, their pins and their evidence queries — **not** that the roster's status filter is what excludes a deactivated engineer.

## 13. UNKNOWN #69 — NARROWED, NOT CLOSED (dated 2026-09-20)

**#69:** the JS sweep `sweepSharedFixtureReferences` on a self-referential edge (`users.registered_by → users`, action `delete`; the first such edge in `scripts/shared-fixture-fk-coverage.json`).

- **OBSERVED [O]** (CI run 35496136697 at `fd96199`, 119 files, 1350 tests): the sweep's `SELECT id FROM users WHERE registered_by = <id>` and `DELETE FROM users WHERE registered_by = <id>` ran **without error** against the edge. (The same `SELECT` is what threw M1 in 21 files before the apply.)
- **NOT OBSERVED:** **the edge was EMPTY.** After the run **0 of 1936** `users` rows had `registered_by`, `registered_at` or `consent_attested` set; the **only writer** of those columns is the SQL function, and **no test, app or lib file calls it** (a grep of `app/`, `lib/`, `test/` finds `registered_by` and the function names only in `scripts/*.json`). So every `SELECT` on the edge returned zero rows.
  **Recursion, child-first order and the cycle case** (a `registered_by` cycle — manual SQL only — inferred, never run, to loop the sweep, which keeps no visited set) **are unobserved.**
  The sweep logs nothing, so the CI log carries no direct trace; the conclusion rests on the two pieces of evidence above, and is **inference**, stated as such.
- **A green result over an empty edge proves nothing about a populated one.** Recording #69 as closed on the strength of section 9 would be wrong.
- **First observation will be** the first engineer added through the add screen — the first `users` row with `registered_by` set, and its teardown through the sweep.
- **The runbook rehearsal (section 12) is NOT a #69 observation.** It populated the edge (R1) for a few minutes, but R8 was **direct, pinned `DELETE`s** (child first, then the admin; neither refused); **the sweep never ran and no repo teardown touched the edge.** The only data-level facts it added: a populated row satisfied the pairing and no-self CHECKs and the composite FK, and deleting engineer-then-admin needed no `RESTRICT` workaround.
  A dedicated populated-edge fixture (recursion and, separately, the cycle) was **deliberately not run**.

**Package corrections, dated strikethrough, made in this commit** (the certified text is left legible): §8.4, §11 F4 and §13 U-8 of `docs/reviews/048-review-package.md` all said the first observation is "the first CI run **after** the test-db apply" — **stale**, because that run (section 9) has now happened and did not observe it.
Other package text that this apply made stale was corrected the same way: the header ("HELD … Nothing in this package was applied to any database"), the two "**NOT rehearsed**" statements and the "not rehearsed" bullet in section 11.

## 14. Prod — NOT applied, no prod GO

**Prod (`jvxwqignooseazzmwhvl`) was not touched by any command in this session, and no prod apply GO exists** [R — Aravind's instruction and package §12; the absence of any prod command is [O] from the capture log, which names `exfccwlrhoutkgrlikod` in every database frame].
This record certifies **test-db only**. A prod GO additionally requires, on top of the package §12 gate (each is **blank and unrun** in the checklist):

1. **The F4 per-role EXECUTE readback from prod** — the F4 query (section 2), run against prod with its query text above its result — and the anon-key `42501` and `service_role` refusals **on prod** (section 6's shape).
2. **Plan §11's pre-checks, run on prod:** **`n2`** (the six-role CHECK on `project_members.role` fits prod's rows — any row outside `pm, qs, engineer, owner, subcontractor, admin` aborts the whole file) and **`u`** (the three columns are absent on prod).
3. **PITR observed live, not assumed** (`CLAUDE.md` §0: a rollback mechanism is verified by observation, never by checklist status), and the **prod ref named** by Aravind in the same exchange, `supabase/.temp/project-ref` printed and compared first.
4. Its **own explicit GO** naming the ref; one file, foreground, `db query --linked -f`, never `db push`; pre- and post-apply hash; fingerprint F1–F6 on prod; ledger repair; the Step H flip to **APPLIED on prod**; and prod's types regeneration (which will differ from the test-db-generated file, section 8).
5. **Merge order (package §4.2):** prod apply sits between the runbook rehearsal (done) and the merge; the merge is a **regular merge commit, not squash**, and gated on the test-db apply by package §4.1 (ii). This branch **is not merged**.

## 15. Observed versus reported

Everything tagged **[O]** above was seen in captured output in the session that wrote this record. The following was **carried, not observed**:

| Item | Source |
|---|---|
| External review round 3 = PACKAGE GO for the test-db apply only; no prod GO | Aravind's instruction; package header and §12 |
| Every go-ahead (apply, DOWN, ledger, observations, types decision, push, sweep, rehearsal, this record) | Aravind's instructions in the conversation — not in the capture log |
| Query S approved as covering everything the DOWN touches | Aravind's instruction |
| The "ten statements" miscount and that proceeding was right | Aravind's statement (the count of **nine** is observed) |
| The types decision and its reasoning (accept as-is, both extras) | Aravind's instruction |
| Section 11's per-id table, part C's counts (1,888 users, 114 daily_logs, 1 project, 491 sessions) and part D's residue counts (29 tenants, 12 + 17 by slug) | the prepared section of 2026-09-20 (`~/Desktop/048-known-tenants-section.md`); **not re-read this session** except the control's count of 16 and the +4 users |
| The cause of the strands in A and B (failed local/agent `vitest` runs, one stranded tenant and user per failed run) | package §8.5 and the prepared section |
| The scaffold's `postgres` being a superuser (R3-U-2's premise) | package §6 |
| The list of the 21 files that failed with M1 before the apply | package §8.2 |
| The cron schedule and timing figures in R7 | the runbook and `vercel.json` per the runbook |
| The redesigned criterion's cutoff being the `Test` job start | Aravind's instruction (the observed run facts give the times) |
| Prod is unapplied | Aravind's instruction; no prod command was run |
| The stale `tsconfig.tsbuildinfo` as the cause of two local type errors | **inferred** from one observation (errors vanish with the cache bypassed) |
| Column-history explanation of the `conkey` attnums | **inferred** from the observed arithmetic (17 live columns, first new attnum 21) |

## 16. Commit map, and how to re-verify

| Commit | Content |
|---|---|
| `61f479e` | `git mv` of the held file into `supabase/migrations/` (R100; sha256 and blob unchanged); `claimedBy` repointed; the reservation note says "PROMOTED, APPLY PENDING" |
| `d81031b` | Step H — a dated note supersedes it: **APPLIED TO TEST-DB ONLY**. `migration-lint: clean. 107 known violation(s), all exempted.` — the same count before and after the file moved to `supabase/migrations/` |
| `fd96199` | `types/database.ts` regenerated from test-db, unedited; message records the accept-as-is reasoning |
| *(this record's commit)* | this file; the runbook header (now **rehearsed**, citing this path and date); the package §12 checklist lines that are satisfied; the dated corrections of section 13 |

```
git show fd96199:supabase/migrations/048_engineer_registration.sql | shasum -a 256     # 1f20efe1716c8fb0f0d18e856bfd3125e8d1559acfd761bde27cf51cd01a9873
git show ae06082:docs/reviews/048_engineer_registration.sql | shasum -a 256            # the same
git show fd96199:docs/reviews/048-review-package.md   # the package as it stood at the CI-green pin
```

Run `supabase migration list --linked` against test-db to see `048` on both sides. **Nothing in this record can be re-verified against prod, because nothing was done to prod.**
