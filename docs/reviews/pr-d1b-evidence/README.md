# PR-D1b evidence files

Raw captures from the build and checks (12 Nov 2026). Nothing here holds a key, a token or a signed URL (`grep -rn "token=\|eyJ"` over this folder is empty).

| File | What it is |
|------|------------|
| `pr-d1b-evidence.redacted.txt` | Base check, CSP/headers search, build results, the first controls at `05bba02` (superseded), tests, scope. REDACTED copy, see below |
| `pr-d1b-ctl-2.redacted.txt` | The four controls C1-C4 at `b0a9e5a`, raw vitest output. REDACTED copy, see below |
| `pr-d1b-viewer-history-control.txt` | The viewer-history control at `d9ad29f`: `history.state` put back as data, 4 of 5 tests RED |
| `pr-d1b-testdb.txt` | Test-db pre-check: how vitest loads env (P1), the P2 grep result, the P3 hosts (host names only) |
| `pr-d1b-tests-node-only-latest.txt` | The 13 node-only test files run on the hash-fix code just before it was committed as `d9ad29f`: 13 files, 493 passed |
| `manual-run-env.txt` | The CURRENT manual-run environment: HEAD `3e378e1`, BUILD_ID `JrDWZU6aPjVNFyweEY5k5`, served-match MATCH. The first run's file (BUILD_ID `B9tAt1Q_eg5nNdKj8hU9Y` at `c94b421`) was overwritten by the second run; its values are in `docs/reviews/pr-d1b-manual-run.md` section 3 |

## The two REDACTED files

The originals contain the literal text `token=` in two harmless ways: test-assertion text (`expected '...' not to contain 'token='`) and the dummy value
the T-RENDER control deliberately injects (`https://x.supabase.co/storage/v1/object/sign/b/<id>?token=abc`, a dummy host and a dummy value). The rule for this
folder is that no file may contain `token=`, so each `token=` was replaced by `token-param=` with `sed 's/token=/token-param=/g'`, and nothing else was changed.
Originals (on Aravind's machine, `/tmp/quoco/`), for anyone who wants to compare:

- `pr-d1b-evidence.txt`: sha256 `23e3b676b30d783c2e192d6d67276934d02879bc75b39b6a988d7a7bc41275dc`
- `pr-d1b-ctl-2.txt`: sha256 `ad0ebc409f6a408096f6bac250370a0e79b8bf6db0baf275ef8dedbcaf972ac1`
