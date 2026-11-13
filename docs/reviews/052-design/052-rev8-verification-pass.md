**Verification pass: 052 plan rev 8 (PR #354)**

**Pins**

- PR #354 head is `1bbe25218e07857d0d39e302ca1ce90cde4542a4`.
- Its base is `origin/main` = `b9ee956ab0596d15002e26748b3c1c3eec8cb1ac`, which includes #353 (the design record).
- `kind-removal-plan.md`: 121 lines, sha256 `f69a0dad2da9b79e552b4661b46c689ca9ec07a65b557b76b3ad550c235cdced`. Matches what you submitted.
- I diffed the plan word by word against rev 7 at `b071fb9`. Exactly 8 hunks changed, and they match `052-rev8-CHANGES.txt` (d) line for line. Nothing outside the round-3 items moved.
- The PR touches docs only. Nothing under `scripts/`, `supabase/`, `test/`, `lib/` or `app/` changes.
- Numbering, re-checked today: the migrations directory and the reservations file both end at 051, so 052 is still free.

**What matched**

| Item | Status |
|---|---|
| S-A | Landed. Details below. |
| S-B | Landed as a plan paragraph with its RED control. One gap, see S-D. |
| S-C | Landed. The T-C-3 QE012 row is struck with a date and pointed to T-E-1. |
| N-A | Landed: D now says four columns, with a dated strike. |
| N-B | Landed: dated path map in the header, no citations rewritten. |
| N-C | Landed: tripwire in F, file `test/capture-kind-deferred.test.ts`. |
| N-D | Landed: Still open (2). |
| Note 2 | Recorded as declined, with the reason. |

S-A in detail:

- The inventory header states the glob and the count. 184 files under `test/` checks out.
- 131 rows (DIRECT 79, MAKEDOC-only 35, FIXTURE 17), plus a separate call-site list for `makeDocWithFile`.
- The PR-time control is written in F.
- `pm-fixtures.ts` and the six `pm-*` suites are in H.
- `makeDocWithCaption` is to be rebuilt on the classify path.
- H now says "PR-D app files."

**Your three notes**

1. **The dropped row.** Dropping it is right; the reason given is wrong.
   - The test at `capture-ingest.test.ts:386` does have capture-domain content. It seeds through `seed()` (`:86-102`), which drives the engineer flow and sends the retired kind turn at `:89`. The inventory flags that fixture itself as FIXTURE `:86`.
   - Its assertions concern ingest only, so its meaning does not change. That is the correct ground for leaving the row out.
   - Correct the stated reason in the inventory, with a date. See N-E for the fixture itself.
2. **23 call sites, not 25.** You are right. My count picked up the helper's own definition line (`pm-fixtures.ts:115`) and the error string at `:124`. That is a reviewer error: I asserted a number I had not filtered.
3. **File names.** Both accepted.

**New findings**

**S-D. A schema-aware Rule 10 must not re-key the exemptions it already has.**

- `scripts/migration-lint-exceptions.json` holds 11 Rule 10 entries. They are keyed on the violation's object string, which today uses bare names, e.g. `uncaptured-redefinition-apply_morning_flow_turn,apply_evening_flow_turn`.
- If the new key `schema.name` leaks into that string as `public.apply_morning_flow_turn`, all 11 exemptions stop matching and CI goes red.
- The obvious "fix" would then be rewriting 11 rows of an exemptions ledger. That is a silent edit to a record.

*Fix (one plan line, for the build):*

- Key internally on `schema.name`.
- In the violation object, emit the bare name for `public` and `schema.name` only for other schemas.

*Proof in the PR:*

- `git diff --stat origin/main -- scripts/migration-lint-exceptions.json` is empty.
- `lint:migrations` still prints "107 known violation(s), all exempted."
- The planted `private.` redefinition is RED.

**N-E. Two inventory files are missing from H.**

- `test/capture-ingest.test.ts`: its `seed` sends `'1'` at what is now the file step. Under 052 that is "text at S2", so it uses up the one re-ask before the file arrives. It still passes, but only by luck. Drop that turn.
- `test/unit/capture-fixtures-clock.test.ts`: FIXTURE `fakeKit`, flag STEP1.
- Add both to H, or mark each row "checked, no change" in the inventory with the reason.

**Not verified from here**

- The inventory's pattern completeness, beyond the spot checks above.
- That `052-design-review-round-3.md` is byte-identical to what I sent.

The README records that round 2's opening sections are lost. That is the right handling, and nothing more is owed on it.

**Result**

Design GO stands.

- S-D and N-E are one-line plan edits.
- They can land in the plan or in the SQL-review package. This round does not need repeating for them.
- S-D must be in place before `lint-migrations.mjs` is touched in the build.

Next artifact: step 0, the read-only prod body capture, then the held 052 file with its reservation. The Apply GO list is unchanged from round 3.
