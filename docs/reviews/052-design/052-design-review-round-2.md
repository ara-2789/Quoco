**`private` schema non-exposure: not verifiable from here.** The test-db observation plan is right. Add one case: call `/rpc/capture_apply_classification` with no `Content-Profile` header. It must return 404, not 42501, which proves the function is not in `public`.

## 4. Findings

**B1. Deferring the `received_at` read to classify time makes a document permanently unclassifiable if its `processed_messages` row is ever gone.** This is a reviewer error of mine.

*Reviewer error.* In round 1 (B3) I told you to take `received_at` from `processed_messages` by the document's SID at classify time. That carried the Q2-6 decision across a timing change without re-checking it. Q2-6 was safe in 050 because the lookup ran in the **same transaction** as the document insert (`050:313-320`), seconds after the webhook wrote the row. Rev 6 moves the same read days or weeks later. Class: stale assumption carried onto a changed mechanism.

*What breaks.* `processed_messages` is a dedup table, not a record:

- `service_role` holds DELETE on it through the default ACL (`047:201` revoked only anon and authenticated).
- The fixtures already delete from it (`test/helpers/capture-fixtures.ts:240`).
- `pr-c-plan.md:114` S-F-2 proposes deleting the row on failure as a designed mechanism.
- Any future retention job on a table that grows with every inbound message removes the row the same way.

After any of these, helper step 4 raises QE012 on every attempt for that document. The document never gets a delivery and can only be recovered by a SQL fix.

As written, the plan's create block also "replaces `:312-346`". That range contains the lookup and its refusal (`:315-320`). So the engineer turn no longer guarantees the row exists when the document is written.

This violates capture-at-write: the arrival time is a fact that exists when the document is created, and it must be stored then.

*Fix.*

- Add `capture_documents.received_at timestamptz NOT NULL`, written by the RPC in the create block from the unchanged `:315-320` lookup and refusal.
- Add it to the 049 QE009 immutable list in A4.
- Have the A4b insert trigger accept it only as written by the RPC. The only insert path is `050:322`, which is service_role-only.
- In the helper, copy `received_at` from the locked document row and never read `processed_messages`.
- Backfill the 5 D-30 rows from their own deliveries' `received_at` (one delivery per document, D-19). That is a lossless copy, not a guess.
- Add an order CHECK: `received_at <= created_at`.

*Tests.*

- T-C-1 asserts that delivery `received_at` equals document `received_at`.
- A new test deletes the `processed_messages` row after the file turn, then classifies successfully.
- T-E-1 asserts that the engineer turn still refuses QE012 when the row is missing.

**S1. The T-D8-11 header pin needs an alias-normalisation control and must be schema-aware.**

- *Prod-captured text uses spelled-out types.* 052-down-prod.sql will carry `pg_get_functiondef` output, which spells types out (`timestamp with time zone`, `DEFAULT NULL::jsonb`; see the 050 form at `050:1026`). The 050 source uses `timestamptz`. A normaliser without an alias table turns the real files red. The "fix" then becomes loosening the matcher.
- *Required control.* The `pg_get_functiondef` header of the real 050 `apply_material_inward_turn` must normalise equal to its source header. A planted overload must still fail.
- *Schema blind spot.* The current regex matches `public\.` only. A stray `public.capture_apply_classification` or a second `private.` copy would be invisible.
- *Same gap in the catalog check.* A6 should count the helper's name across all non-system schemas, not only in `private`.

**S2. Tests whose meaning flips must be rewritten as tests, not absorbed by the fixture.**

- `makeDoc` keeps its signature but changes behaviour across 61 call sites. Any test that asserted "file turn creates a delivery" would now pass only because `makeDoc` classifies behind it.
- T-E-1 must assert the new fact directly: after a file turn there are 0 deliveries, 0 links and kind NULL. Write it RED against the current 050.
- List in the package every existing test whose assertion changes meaning, so the reviewer can check none was edited just to compile.

**N1. Lint Rule 10.** 052 redefines three existing functions (`apply_material_inward_turn` and both capture_documents triggers). `lint-migrations.mjs:620-645` requires a `body_md5 (pre-052):` line for each and a `pg_get_functiondef` mention. Section E puts the prod capture after SQL review. Either move the capture earlier, or expect CI red until it lands.

**N2. Reservation.** The reservations file at `f536fe2` ends at 051. Reserve 052 when the held file is written, because Rule 8 fires otherwise. Re-verify at promotion.

**N3. A0 snippet.** `RAISE EXCEPTION '...: %', n` uses `n`, which is never computed under `IF EXISTS`. Select the count into a variable first. The SQL round would catch this, but it is in the plan text.

**N4. DOWN lock.** DOWN's "clear invoice sessions subtract-only" needs the same `EXCLUSIVE` lock and `lock_timeout` as A0 and the 050 DOWN. State it.

**N5. Classification result on an already-classified document.** Define `delivery_id` and `self_link_id` on the `already_classified` path. The 5 D-30 rows have deliveries, and their self-link may since have been unlinked.

**N6. Lock-hold cost.** Webhook RPCs queue behind the `EXCLUSIVE` lock for the whole migration. Record the measured hold time in the test-db rehearsal.

The likely failure mode is a clean abort from `lock_timeout` or deadlock detection, because the new FK takes `SHARE ROW EXCLUSIVE` on `users`. Have the apply record say that such an abort changes nothing, and that re-running means re-probe, then re-apply as a new run.

## 5. Credit

- A4's carve-out tests all four provenance columns on both OLD and NEW, overwrites `kind_set_at` and refuses `engineer_declared` by UPDATE. Combined with the 3-way table CHECK, a forged or backdated classification is structurally impossible, not merely untested.
- The S table derives status from the document's own ack under the lock, and shows the ack path needs no change because `:255-259` already matches either pointer. That is the minimal change, argued from the line.
- `pm_link_invoice`'s unlocked kind read (`050:808-811`) stays sound under 052 without a re-read, because kind moves only out of NULL and NULL is refused. The plan did not touch it, which was correct.
- 4c drops the system or OCR path outright instead of guarding it. This removes the two-class hazard rather than mitigating it.
- R names the actual gap: the switch gates only the start at `:1137`, while live sessions route at `:780`. It then closes it twice, with the in-migration abort plus the external probe.

## 6. Verdict

**STOP, one round short.** Rev 7 needs:

1. B1 as specified: a document `received_at` column, written at the document insert, immutable, backfilled from the existing deliveries, with the helper reading only the document row, plus the three tests.
2. S1 and S2 recorded in the plan's test section.
3. N1–N6 as one-line plan edits.

If rev 7 is exactly that delta, I expect **Design GO**. Apply GO additionally needs the items already listed in rev 6 E/R:

- the PG17 dry-run from a structure-only dump
- the privilege matrix including anon 42501 and the no-header 404
- the measured lock hold
- the executed DOWN, including the seeded unclassified refusal
- the S5 dark-control record
- the external probe output immediately before apply
