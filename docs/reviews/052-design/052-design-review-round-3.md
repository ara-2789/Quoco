**Review: 052 MI-KIND-REMOVAL, design round 3**

**Pins and scope**

- Plan rev 7 = `docs/reviews/052-design/kind-removal-plan.md` on `docs/052-design-record` at `b071fb9e944590a0d768f6e45764841cbd50e215`. It is 119 lines with sha256 `5e117c92f17a697ee5cb5ec0bd97cd3276671ad1cf53851ed93710ad626f04f9`, matching what you submitted.
  - That branch is not merged. Its merge-base is `origin/main` = `78ba82e110193266a6f33a7d364729d242e89849`.
- Read in full:
  - plan rev 7, sections A–R and Still open
  - `052-rev7-CHANGES.txt` (sha256 `10496f7d…5934`)
  - the S2 inventory `052-tests-changing-meaning.txt` (sha256 `193cfa12…8d60`)
- Checked against `origin/main`:
  - migrations: `011:8-13`, `047:201`, `049:240-252`, `049:349-391`, `049:448`, `049:645-660`, `049:770-876`, `049:965-985`, `050:300-346`
  - other files: `lint-migrations.mjs:595-645`, `migration-number-reservations.json` (it ends at 051, and `supabase/migrations/` ends at 051), `test/helpers/capture-fixtures.ts:240`, `test/helpers/pm-fixtures.ts:100-210`, `pr-c-plan.md:114`
- The CHANGES file's claim that forward and reverse replay reproduce rev 6 and rev 7 is plausible from the listing. I did not have rev 6 to replay it myself.

---

**B1 (round 2): closed. I verified the mechanism, not just the text.**

- **The lookup and refusal stay.** `050:313-320` is the lookup and its refusal, and the INSERT is at `:322`. Rev 7 keeps `:313-320` and writes `received_at = v_received`, so the engineer turn still requires the `processed_messages` row.
- **The backfill is a lossless copy.**
  - Both delivery pointers are UNIQUE (`049:371-372`).
  - Both pointers and `received_at` are immutable on deliveries (`049:645-653`).
  - No role holds DELETE on deliveries (`049:973-975`).
  - No `DELETE FROM public.deliveries` exists in any 05x file.
  - So each D-30 document's delivery still carries the exact value 050 wrote from the same SID.
- **The order CHECK holds for new rows.** `processed_messages.created_at` is `DEFAULT now()` (`011:10`), stamped by the webhook's earlier, committed transaction. The document's `created_at` is stamped by the insert trigger in the RPC's later transaction (`049:870-871`). So `received_at <= created_at` holds.
- **The order CHECK holds for the 5 backfilled rows.** The document and its delivery share one transaction's `now()`, and `deliveries_received_order_chk` (`049:391`) already bounds the delivery's value.
- **The old triggers do not block the backfill.** The old update trigger's immutable list (`049:784-791`) names none of the new columns, and the backfill runs as postgres in READ COMMITTED, so neither QE009 nor QE014 fires.

---

**Your three notes**

**1. "The inventory is a superset." Not true across the repo. It is a superset only of the 16 files it scanned.**

- The scan covered `test/capture-*`, `test/unit/capture-*` and the strings test. It excluded the PR-D1 suites merged in #348.
- `test/helpers/pm-fixtures.ts:176-187` (`makeDocWithCaption`) drives the engineer function itself, without going through `makeDoc`:
  - It sends the retired kind turn: `miTurn(..., kind === 'dc' ? '1' : '2', ...)`.
  - It then throws unless the file turn returns a `delivery_id`.
  - Under 052 both steps fail. It builds the D-30 shapes fixture (`:203`, `:206`), which `pm-d30-shapes.test.tsx` reads, including `kind` at `:79`.
- `makeDocWithFile` (`:115-123`) wraps `makeDoc`, so it is absorbed. Its 25 call sites across `pm-actions`, `pm-file-route` and `pm-queries` are absent from the inventory, and their MAKEDOC-only status is unstated.
- Plan H says "Not touched: … PR-D files," and neither `pm-fixtures.ts` nor any `pm-*` test is in the change list. As written, the builder must either break scope or watch the PR-D1 suites go red.
- See S-A.

**2. An A4b check that `received_at` equals the capture time: declined.**

- The only insert path is `050:322`. It writes the value from the row it looked up two statements earlier, in the same transaction.
- A trigger re-read of `processed_messages` would validate a value the RPC already constructed from that same row. It cannot differ, and it would put the dedup table back on the write path, which B1 just removed it from.
- The invariant worth guarding is "one insert path." For that, a source-reading tripwire is the right size (N-C).

**3. Lint Rule 10 matches public functions only: accepted for 052's own redefinitions, but it opens a blind spot that 052 itself creates.**

- The regex `FUNCTION\s+(?:public\.)?(\w+)\s*\(` (`lint-migrations.mjs:613`) does not match `private.capture_apply_classification(` at all. The helper is never even recorded as first defined.
- The first later migration that redefines it (PR-D2's confirm step, or the OCR suggestion work) will need no `body_md5 (pre-0xx):` line and no `pg_get_functiondef` capture. Its DOWN will then have nothing byte-exact to restore from. That is the exact failure Rule 10 was written for.
- You already made this fix for T-D8-11 (S1 iii). Fix the pattern where it recurs: see S-B.

---

**Findings**

**S-A. The S2 inventory and the H file list miss the PR-D1 fixtures and suites.**
- *Fix:*
  - Regenerate the inventory over all of `test/**` and `test/helpers/**`, and state the pattern and file count in its header.
  - Add `test/helpers/pm-fixtures.ts` and every flagged `pm-*` test to H's change list.
  - Narrow H's "Not touched: PR-D files" to "PR-D app files."
  - `makeDocWithCaption` gets the same treatment as `makeDoc`: start → file → classify as the PM. The D-30 shapes then come from the real path.
- *Mechanical control at PR time:* every `it(`/`test(` block whose body changes in the diff must appear in the inventory. A changed test missing from it is a finding. This makes the inventory checkable instead of a promise.

**S-B. Rule 10's regex must be schema-aware.**
- *Fix (in the 052 PR):*
  - Capture an optional schema, as `(?:(\w+)\.)?(\w+)`.
  - Key first-definitions on `schema.name`, defaulting to `public`.
- *RED control:* a planted later held file that redefines `private.capture_apply_classification` with no `body_md5` line must flag. 052 itself must stay clean, because the helper is a first definition.
- Step 0's capture query can stay public-only. All three functions 052 redefines are in `public`.

**S-C. The T-C-3 test text contradicts T-C-9.**
- F line 104, T-C-3, still lists "missing `processed_messages` QE012" as a classify refusal. That was the dropped helper step 4.
- T-C-9 asserts the opposite: the row is deleted and classify succeeds. A builder can satisfy both only by putting the read back.
- *Fix:* strike it from T-C-3 with a dated note. The QE012-on-missing-row case now belongs to T-E-1 (engineer turn) only, which rev 7 already says.
- *Owned:* my round-2 fix list named T-C-1, the new test and T-E-1, but not the existing T-C-3 row that asserts the reverse. Coverage miss, same class as the B1 miss in the 028 round.

**N-A.** D (types) still says "three columns." It is four with `received_at`. The rule map marks D unchanged, so the delta missed the line.

**N-B. Dead paths in the plan.**
- The plan, CHANGES and inventory cite `/tmp/quoco/...`, but per the branch README that directory was cleared. The record of these files is now `docs/reviews/052-design/` at `b071fb9`.
- Add a dated path-map line to the plan header. Do not silently rewrite the citations.
- The round-2 review file still lacks its opening sections, and I cannot supply the missing text from here.

**N-C.** Add a source-reading tripwire: exactly one `INSERT INTO public.capture_documents` across `supabase/migrations/` and `docs/reviews/*.sql`, and its column list includes `received_at`. This is what makes note 2's structural argument stay true.

**N-D.** 4b's "age" for unclassified documents should now be `now() - capture_documents.received_at`, which is the same origin as the delivery's. Write it into the PR-D item in Still open (2) so PR-D does not key age on `created_at`.

---

**Credit**

- A3b chose the delivery as the backfill source and asserts exactly one delivery per document in the file. Any test-db document that breaks that assumption aborts the migration loudly instead of copying a wrong value.
- The A order line names why the old triggers do not block the backfill and why the old RPC cannot run in the `SET NOT NULL` window (one transaction, A0 lock). That is the window argument written down rather than assumed.
- The N5 queries define `self_link_id` as NULL for an unlinked invoice instead of reaching for an inactive row. That is absence recorded as absence.
- The DOWN states plainly that dropping `received_at` loses nothing.

---

**Pre-verdict checklist (design-level)**

| Check | Result |
|---|---|
| FKs | `kind_set_by` is composite and same-tenant, with explicit RESTRICT/RESTRICT. |
| DEFINER posture | The wrapper is the auth.uid class with an authenticated grant and a PM role gate. The helper is postgres-only in `private`. No caller-selectable system branch (4c). |
| Transaction | One transaction. The DOWN is to be executed at rehearsal. |
| Overloads | Single signature; A6 counts the helper and wrapper names across all schemas. |
| Numbering | Re-verified today: 052 is free on main. |
| Prior-round items | All landed, with the gaps noted in S-A and S-C. |
| Deploy window | Named in R, with an external probe and an in-file abort. |
| Write-boundary distinctness | `engineer_declared` vs `pm` vs NULL are structurally distinct. |
| Sends | None (T-C-5). |
| Post-apply record | Specified in R. |

Owed to apply rather than design: the rehearsal evidence listed in round 2.

---

**Verdict: Design GO (conditional).** The schema and function design is right, and B1 is closed on mechanism.

Before the SQL review package, rev 8 must contain:

1. **S-A:** a repo-wide inventory with its pattern stated, `pm-fixtures.ts` and the `pm-*` suites in H, and `makeDocWithCaption` rebuilt on the classify path.
2. **S-B:** the Rule 10 regex made schema-aware in the same PR, with its RED control.
3. **S-C:** the stale T-C-3 QE012 row struck, with a date.
4. **N-A to N-D:** as one-line edits.

None of these change the design, so a rev 8 limited to these items needs only a verification pass, not another design round.

**Apply GO** still requires the round-2 list:

- the PG17 dry-run from a structure-only dump
- the privilege matrix, including the anon 42501 and the no-header 404
- the measured lock hold
- the executed DOWN, including the seeded unclassified refusal
- the S5 dark-control record
- the external probe output immediately before apply
- the test-db proof of the `FOR UPDATE` key-update claim
