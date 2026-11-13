# 052 SQL evidence (block 1)

Raw captures, one file per control. Each names the HEAD SHA and the sha256 of the file it mutates or checks.
Only substitution made when copying from the private record: an absolute home-directory path is replaced by `<repo>`.
No database was contacted for any file here. Nothing was executed as SQL.

| File | What it is |
|---|---|
| s1a-baseline.txt | lint on the untouched tree: 107 known violation(s) |
| s1c-proofs-1-2.txt | exceptions file untouched; lint still 107 |
| s1c-red-control-1-private.txt, s1c-red-control-2-public.txt | planted redefinitions: private. flagged with a schema-qualified key; public flagged with the bare key |
| s1c-lint-test.txt | the Rule 10 unit test file (11 tests) |
| s2c-down-body-md5.txt | md5 of every body embedded in both DOWN files vs the pre-052 baseline |
| s2d-lint-with-held.txt | lint at the committed HEAD with the held file present |
| s2d-fk-coverage-finding.txt, fk-coverage-entry-proposed.json | the one lint finding on 052 and the proposed fix (NOT applied) |
| 3a-static-grep.txt, 3c-tripwire-preview.txt | static greps of the held file / the N-C tripwire count |
| rpc-body-diff.txt | line diff of apply_material_inward_turn, captured pre-052 body -> 052 body |

Source of the pre-052 bodies: read from test-db by a SELECT on 13 Nov 2026; their md5 equals the three md5 Aravind pasted from the prod SQL editor.
That the paste came from prod is not established.

## Block 1b additions
| File | What it is |
|---|---|
| s1-lint-after-fk-entry.txt | lint after the one FK coverage entry: clean, 107 exempted |
| 3b-dump-record.txt | the read-only test-db structure dump: ref, sha256, credential scan, 051 evidence (the dump itself is not committed) |
| dryrun-00 ... dryrun-40 | the local PG17 dry-run, one file per step (label: local PG17, structure-only dump of test-db, no roles/PostgREST); local paths replaced by `<local-path>` |
| dryrun-src/ | the scenario SQL and runner scripts |
