# 052 apply GO request (records only; written 14 Nov 2026; no apply performed)

## Pins
- main `8e90cb5` = merge of #355; parents `f007f61` + `a077bd05679cd0a91d838032361204f85980aa56`.
- tree(8e90cb5) = tree(a077bd0) = `cbd99d72a726dd269af36f13efcd8987bbdcb263`. CI run 43565517165, success, headSha a077bd0.
- Apply bytes (`origin/main:docs/reviews/052_mi_kind_deferred.sql`) sha256 `2c4ee3bca72fc6f89ec37821594de565490bf65740be701470d5e8789586357e`.
- DOWN prod (`origin/main:docs/reviews/052-down-prod.sql`) sha256 `344f4b2e5a1fe42c0502a63a47feee9e3980e830adbc2d03a9288610991cc43a`.
- Reviewer: GO to merge at a077bd0, NOT an Apply GO (052-code-review-confirmation.md).

## Owed before prod apply
| Item | Status | Evidence |
|---|---|---|
| Dark control on merged code | DONE, reported by Aravind: reply to "4" at 12:31 IST, "That option isn't available yet. Nothing was recorded." Deployment id and Vercel env listing WAIVED by Aravind (reviewer must be told) | p1-notes.md |
| Frozen-row call, test-db | DONE: QE009 raised, row unchanged | d-frozen-row-testdb.txt |
| Prod P0 probes (read-only) | DONE, all as expected | p0-probes.txt, plan-rev8.1-probe-quotes.txt |
| Pre-apply readback (PITR substituted) | DONE, sha256 1b4e4acf964dd39b68be4d58dc3036161daaa18ef1a3f1b38b8e11f0a4e9e4f0 | p0-readback.txt |
| `private` schema not exposed | DONE, per Aravind: Data API exposed schemas graphql_public, public. Prod also reads private absent (to_regnamespace NULL) | p1-notes.md, p0-probes.txt |
| T-M-1 abort-half evidence | ON FILE, local PG17 scaffold only (apply exit 3, nothing changed). None found on test-db | docs/reviews/052-sql-evidence/dryrun-30-abort-invoice-session.txt and dryrun-r1-30-abort-invoice-session.txt |
| Rehearsal record verification pass (13 Nov record) | OWED by reviewer | 052-test-db-apply-record.md |

Prod facts at probe time (14 Nov, ~07:12 UTC): ledger tail 051/050/049, no 052 row; invoice sessions 0; the three function md5s equal the pre-052 header values (cecc170b..., b5467b20..., 4a7f4703...); test helpers absent; capture_files fingerprint 19102bc8... and comments b97d2e3b... equal to the 051 record.

## Item 7 deviation
Planned "5 engineer_declared with NULL kind_set_*, received_at saved" cannot be read pre-apply: kind_source, kind_set_at, kind_set_by and received_at do not exist on capture_documents before 052. Pre-apply form recorded instead: 5 documents (3 dc, 2 invoice), 0 with NULL kind, 0 whose delivery count differs from 1. The received_at column in p0-capture-documents.txt is each document's DELIVERY received_at (the value 052 A3b copies).
Post-apply check: 5 rows kind_source = engineer_declared; kind_set_by and kind_set_at NULL; capture_documents.received_at equal, row by row, to p0-capture-documents.txt (sha256 f78592046c30e6f0970aa90e44699d97ff963e60ae8bc3600817c33c5f4601bb).

## Planned apply window
Outside 08:25-08:40 and 18:25-18:40 IST, and outside 23:15-00:15 IST. Gates immediately before: gh run list in_progress=0 queued=0; ref jvxwqignooseazzmwhvl printed in the same frame; invoice-session count 0; the three md5s re-read; apply sha256 re-checked; Aravind's explicit "go". Foreground, one file, never db push. Ledger row 052: not written by the file, Aravind runs migration repair afterwards (051 method).

## Not in the plan
No prod dry run (BEGIN; apply; ROLLBACK) is in plan rev 8.1; none was run.
