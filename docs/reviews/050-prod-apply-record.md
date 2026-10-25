# Migration 050 — PROD apply record (2026-10-25)

**Target: prod `jvxwqignooseazzmwhvl`.** One file, one foreground run, never `db push`, no DOWN run. FULL tier. Executed by Claude Code (background job, PR-B block 21) in workdir `/tmp/quoco/cli-prod` (deleted at the end); the ledger repair was run by Aravind. Full raw log of this block: `/tmp/quoco/pr-b-block-21.txt` on Aravind's machine (not committed; the commands and outputs below are quoted from it).
Markers: **[O]** observed by Claude Code, raw output in the log; **[R]** reported to Claude Code by Aravind, not observed.

## 0. Inputs and decisions

- **GO** — the block-21 instruction from Aravind, after he merged PR #333 (merge commit `349d360a9d633501ed800e0ca858dd9a786f2278`, merged 2026-10-25T17:24:23Z; second parent `f11451b7b3fe5e7ac1571b9f46e784084c58e72d`) [O: `git rev-list --parents`, `gh pr view 333`].
- **Time window** — apply began 17:27:47Z = 22:57 IST, outside 08:25–08:40 and 18:25–18:40 IST [O].
- **CI pin** — run 39380098060, `conclusion: success`, `headSha: f11451b7b3fe5e7ac1571b9f46e784084c58e72d` [O: `gh run view`].
- **PITR — SUBSTITUTED, NOT OBSERVED.** No PITR / backup state was read in this block. Per Aravind's standing decision (049 record, 12 Oct 2026: PITR disabled on prod until beta launch, no sensitive data), PITR is not relied on. Rollback evidence instead, all committed on `main`:
  - `docs/reviews/050-prod-live-morning.sql` sha256 `69ae1b5cb73e9a1b2830b7524d853db2e48d91d4bc8030f1233e31edab2cebe5` and `docs/reviews/050-prod-live-evening.sql` sha256 `30979c8f4d8745e63184079cefedfd74b2cc2d54455b9e679578a4e9327c18a4` — the prod-captured pre-050 bodies of the two replaced functions (their md5s equal the pre-apply md5s in section 2);
  - `docs/reviews/050-down-prod.sql` sha256 `868a68f19304b546570445e627606f1f9b1e4ae9749d45a4112dee0cd1443a36` — the prod DOWN, with the `DOWN_PRECONDITION_050` guard (proof transcript: `docs/reviews/050-down-precondition-transcript.txt`). The DOWN was **not run** on prod. Its test-db rehearsal pre-dates the precondition text (see `050-test-db-apply-record.md`).
  **PITR must be re-enabled before the first beta, customer or RCPL data lands on prod** (switch trigger).
- **Workdir "link"** — `supabase link` was not used. As on test-db, `supabase/.temp/project-ref` in a throwaway workdir was written with the named ref; no password was needed. The main tree's link was read at the start and still reads `exfccwlrhoutkgrlikod` (test-db) [O].

## 1. Step 1 — file pin [O]

`git show origin/main:docs/reviews/050_material_inward_functions.sql` → `/tmp/quoco/cli-prod/supabase/migrations/050_material_inward_functions.sql`; sha256 `1e09730d26aec0dcd46fefd09601651bad149138326c351556b8405acec0fade` (equals the test-db-applied bytes). A read-only `SELECT current_database(), version()` on the workdir returned `postgres`, PostgreSQL 17.6.

## 2. Step 2 — pre-apply re-check, read-only, ref `jvxwqignooseazzmwhvl` printed before every query [O]

Run 2026-10-25T17:27:07Z.
- md5(pg_get_functiondef): `apply_morning_flow_turn` `707c10fe09dfd5a7cd065f7826eacd46`; `apply_evening_flow_turn` `d19d07507abccdaf7d54ee1d74419af7` (as expected).
- ACL before-reading, both: owner postgres, SECURITY DEFINER, `proconfig {search_path=public}`, `proacl {postgres=X/postgres,service_role=X/postgres}`; anon false, authenticated false, service_role true.
- `whatsapp_sessions` with `current_flow='invoice'`: 0.
- S-4 probe (active engineers with a non-`engineer` membership): 0 rows.
- The seven new names: absent (`[]`).
- Ledger: max `049` (`capture_tables`, 59 statements); rows after 049: 0.

## 3. Step 3 — the apply [O]

Frame printed in the same output immediately before the command: ref `jvxwqignooseazzmwhvl`, sha256 `1e09730d…0fade`.
`supabase --workdir /tmp/quoco/cli-prod db query --linked -f /tmp/quoco/cli-prod/supabase/migrations/050_material_inward_functions.sql`, foreground, once. **START 2026-10-25T17:27:47Z, END 17:27:53Z, exit 0**, output `{"rows": []}`. The in-file assertion block passed (a failure aborts the transaction; the objects exist, section 5).

## 4. Step 4 — ledger [R] repair, [O] verification

Printed for Aravind (ref + sha first, then the command): `supabase --workdir /tmp/quoco/cli-prod migration repair --status applied 050 --linked`. **Run by Aravind in two attempts, both [R]:** (1) the first run, at 17:34:37Z, failed at "Initialising login role" with a Cloudflare 502 from api.supabase.com, before "Connecting to remote database"; nothing was written. (2) After about a minute he retried and the second run succeeded; his pasted output: ref `jvxwqignooseazzmwhvl`, sha256 `1e09730d…0fade`, `Repaired migration history: [050] => applied` [R].
Verified by query (17:37:53Z) [O]: `050 material_inward_functions`, **31 statements**; previous row `049 capture_tables` 59; max version `050`; 46 rows. `supabase migration list --linked`: last entry `{"local":"050","remote":"050"}` (local is 050 only because the workdir holds the file).

## 5. Step 5 — readbacks [O]

- **Nine functions, one `pg_proc` row each**, md5 of definition: `apply_morning_flow_turn` `cf2e78881f03d4e03a0dc51fd9b6008e`; `apply_evening_flow_turn` `9987ab905a5563f94f9226445fbcef8b` — **both equal test-db's post-050 md5s** (`cf2e7888…` / `9987ab90…`); `apply_material_inward_turn` `cecc170b26208d4b820402879e020271`; `expire_stale_material_inward` `06cc13da48b24ff258b6ce4e3b6bf944`; `pm_approve_delivery` `2e4ccc5c49aefe125e4f8e9ddb3ffe7d`; `pm_link_invoice` `1ba0c060ee0e222eaa5224c411ff4320`; `pm_reject_delivery` `07165f5b1317a12577dc59e3e463b062`; `pm_set_delivery_details` `6333390e137ee7e140b668e2b56f03bd`; `pm_unlink_invoice` `28185a9d79ea308ead1d2e7d67b0fc9c`. (The md5s of the seven new functions were not compared to test-db in this block.)
- **ACL matrix** (all owner postgres, SECURITY DEFINER):
  | function | proacl | anon | authenticated | service_role | search_path |
  |---|---|---|---|---|---|
  | apply_morning_flow_turn, apply_evening_flow_turn | `{postgres=X/postgres,service_role=X/postgres}` | f | f | t | `public` |
  | apply_material_inward_turn, expire_stale_material_inward | `{postgres=X/postgres,service_role=X/postgres}` | f | f | t | `""` |
  | pm_set_delivery_details, pm_approve_delivery, pm_reject_delivery, pm_link_invoice, pm_unlink_invoice | `{postgres=X/postgres,authenticated=X/postgres}` | f | t | f | `""` |
  The two replaced functions' ACL and `proconfig` are **identical to the step-2 before-reading**.
- **Real anon-key PostgREST calls** against `https://jvxwqignooseazzmwhvl.supabase.co/rest/v1/rpc/…` (anon key fetched into a shell variable, never printed): a first attempt with an empty body returned `PGRST202` / HTTP 404 for both (no signature match — **not** a refusal, not counted as evidence). Re-run with the real parameter names and nil-UUID values: `pm_approve_delivery` → HTTP 401 `42501 permission denied for function pm_approve_delivery`; `apply_material_inward_turn` → HTTP 401 `42501 permission denied for function apply_material_inward_turn`.
- Not run on prod in this block: authenticated / service_role behavioural calls, a positive service_role control over PostgREST, anon calls for the other seven functions (ACL for them is by catalog only).

## 6. Observed vs reported

Observed: everything marked [O]. Reported: only Aravind's ledger-repair runs (the failed first attempt and the successful second). Not done / not observed: PITR state; DOWN on prod; ~~the CI run on the merge commit `349d360`~~ (struck 2026-10-25, block 22). Observed: tree of `349d360` = tree of `f11451b` = `e4e5c5eaef4e71d887d0decf6f5792f2f46fdfab`, so CI run 39380098060 certifies the merged tree.
