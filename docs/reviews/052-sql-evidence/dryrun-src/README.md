Scenario SQL and the runner for the 052 local PG17 dry-run (block 1b). LABEL: local PG17, structure-only dump of test-db, no roles/PostgREST.
`run-all.sh`, `pg-up.sh`, `readback.sh`, `env.sh` are the runner scripts, with local paths replaced by `<local-path>`; `run-all.sh` calls the last two under their original names (`s3c2.sh`, `psqlenv.sh`).
`lib.sql`, `main.sql`, `legacy-seed.sql`, `legacy-post.sql`, `state.sql` are the SQL. The fixture is `docs/reviews/049-sql-evidence/src/_fixture.sql`.

## SQL review round 1 additions (block 1c)
`main.sql` gained M3b (S-5: the engineer who sent the document, and an admin without PM membership, are refused). `lock-test.sh` is new (N-5, two raw psql sessions).
`run-all-r1.sh` is the runner for block 1c (paths replaced by `<local-path>`); `run-all.sh` is the block 1b runner, kept as it was. The block 1b version of `main.sql` is in git history (commit `105bf67`).
