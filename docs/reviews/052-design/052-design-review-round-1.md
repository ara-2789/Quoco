# MI-KIND-REMOVAL (052): design review, round 1

**Verdict: STOP.** The package did not reach me, so nothing in the plan can be cleared. The design direction is sound and this is probably one round short. Answers to your five questions are below, checked against base `f536fe26cc9d9c6ac0fd5d4c2cbcd006b885be87`.

## 1. Pins and scope

- `main` = `f536fe26cc9d9c6ac0fd5d4c2cbcd006b885be87` (merge of #347).
- Read in full: 049 (capture_documents / deliveries / dil DDL, triggers, grants), 050 (`apply_material_inward_turn`, PM functions, §3 grants, §4 assertion block, DOWN), `capture-switch.ts`, the `material-inward.ts` read paths, the `inbound-start.ts` routing, T-D8-11 in `test/capture-files-immutability.test.ts`, and `docs/reviews/d30-record.md` with its evidence.
- **Not received:** `052-design-review.zip`. That means `kind-removal-plan.md`, evidence E1–E37, the impact study and the file copies are all missing. Every ruling below is on the design as you described it in the request. None of it is on the plan text. Resubmit the zip and I will review the delta against this record.

## 2. Answers to what you asked

**Q1. Classify split, grants and lock order.** The shape is right, with conditions.

- **Grants.** Supabase default privileges grant EXECUTE on new `public` functions to anon, authenticated and service_role. So the helper's REVOKE must name PUBLIC plus all three, in the same transaction as the CREATE. Follow the 049:999-1005 precedent: explicit `GRANT ... TO postgres`.
- **Assertion block.** Extend 050 §4 to all three functions:
  - name count = 1
  - `prosecdef`, owner postgres, `proconfig = search_path=""`
  - the `has_function_privilege` matrix, with the helper false/false/false
- **Authorisation order.** Read the document's project without a lock, then authorise (PM member, active, role = `pm`), then `SELECT ... FOR UPDATE`, then re-check `kind IS NULL` under the lock. Authorising first means an unauthorised caller never holds a lock on someone else's row.
- **Error codes.** Not-found and not-authorised must return the same code (QE015, as 050 does) so there is no cross-tenant existence oracle. "Already classified" may be distinct, but only after authorisation passes.
- **Lock order.** The engineer path locks session → document → deliveries. Classify locks document → deliveries. That is the same order, so there is no deadlock cycle. It holds only if classify never touches `whatsapp_sessions`.
- **Helper inputs.** The helper must derive tenant, project, `reported_by` (= `sent_by`) and `received_at` from the locked document row. It must never take them from parameters. See B3.

**Q2. Trigger.** There are gaps; see S2 and S3.

- "Together" is not enough. `kind_set_at` must be DB-stamped (`now()`), the same S-3 rule as `engineer_ack_at` (049:806-811). Otherwise a backdated stamp passes.
- Put the triple-null rule in a table CHECK, not only in the trigger. A CHECK makes it structural and covers INSERT too.
- `kind_set_by` needs a composite `(kind_set_by, tenant_id)` FK with explicit actions, plus a CHECK that `kind_set_at >= created_at`.
- The carve-out from the 049:783-789 QE009 set must require all three OLD values NULL and all three NEW values non-NULL. Every other immutable column must still be checked in the same UPDATE.

**Q3. Nullable kind with the UNIQUE key and FKs unchanged.** Safe, for a mechanical reason.

- The child kind columns are fixed and non-null (049:361, 363, 410). With MATCH SIMPLE, a non-null child tuple needs an exact parent match, so a delivery or link **cannot** point at an unclassified document.
- `ON UPDATE RESTRICT` does not fire on NULL→value, because no child row can reference a key that contains NULL.
- The UNIQUE key stays sound because `id` is the PK.
- `pm_link_invoice` already refuses NULL kind (`IS DISTINCT FROM 'invoice'`, 050:811).
- Required tests: link an unclassified document (refused), and insert a delivery on an unclassified document (FK violation).

**Q4. T-D8-11 as an md5 pin per statement.** It still guards something, but not the hazard it was written for.

- The hazard is an overload: a `CREATE OR REPLACE` with a different parameter list. A whole-statement md5 couples the pin to the function body. Every review-round edit to 052 then forces a re-pin, and a pin that is regenerated on every edit guards nothing.
- **Ruling:**
  - Pin the normalised **header** (name plus argument-type list) rather than the body.
  - Assert that every definition of a name shares one argument-type list.
  - Keep the in-file catalog assertion (`pg_proc` count = 1) as the authority.
- Show it RED with a planted overload in `docs/reviews/*.sql` (the test scans that directory too), then GREEN.

**Q5. Rollout.** Two gaps; see B2 and S5.

## 3. Findings

**B1. Package missing.** No plan, evidence, tests or rehearsal output arrived, so the pre-verdict checklist cannot run.
- Fix: resubmit the zip, with every file pinned `sha256` + `git show`.

**B2. The in-flight probe is outside the transaction, and "dark" does not cover in-flight sessions.**
- The switch gates only the **start** branch (`inbound-start.ts:1137`).
- A live `current_flow='invoice'` session routes at `inbound-start.ts:780` whatever the switch says.
- Step meanings change in 052, so a session parked on old step 1, 2 or 3 lands on a new meaning. A probe taken "immediately before" is a hope.
- Fix: inside 052, take `LOCK TABLE whatsapp_sessions IN EXCLUSIVE MODE` (the 050 DOWN pattern). Then either raise when any `current_flow='invoice'` row exists, or sweep subtract-only (the 050 DOWN key list). Keep the external probe as a second guard.
- Test: seed a step-3 session, apply, and confirm it aborts or sweeps.

**B3. Late classification must reproduce what 050 did at S2 and S3.**
- When classify runs after the ack, the insert trigger forces `incomplete`, and the 050 S3 UPDATE to `awaiting_pm` has already run against zero rows.
- The helper must therefore set `awaiting_pm` iff `engineer_ack IS NOT NULL`, read under the document lock.
- It must also:
  - take `received_at` from `processed_messages` by the document's `source_message_sid` (Q2-6), never `now()`
  - set `reported_by = sent_by`, never the PM
  - for an invoice, insert the A28 self-link in the same transaction
- Test both race orderings (ack-then-classify and classify-then-ack) and assert the end state. This is B until the plan shows it; I could not check whether it already does.

**S1. The five live prod documents from D-30.**
- They have kind set and `kind_set_*` NULL (d30-record §4 F). A table CHECK rejects them.
- A backfill UPDATE run after the new trigger raises QE009.
- Backfilling `kind_set_by = sent_by` blends an engineer declaration into a field that means "PM classified". That collapses a distinction at the write boundary.
- Decide one:
  - a source marker (`engineer_declared` vs `pm`), with the backfill ordered before the trigger replace, or
  - a CHECK that exempts pre-052 rows, argued in the file.

**S2.** DB-stamped `kind_set_at`, the composite FK on `kind_set_by`, an order CHECK and the table-level triple CHECK, as in Q2.

**S3. Insert trigger.**
- The 049:867 insert trigger must also refuse a non-null **kind** at INSERT, not only forged attribution.
- Otherwise any future insert path quietly brings back engineer-declared kind with no attribution.

**S4. "OCR will classify through the same helper" contradicts the D-30 record.**
- The record says OCR is "asynchronous and PM-confirmed".
- The helper has no service_role grant, so an OCR job needs a new wrapper. That wrapper is a caller-selectable system branch, which is exactly the class the two-class convention forbids.
- Decide now: OCR writes a suggestion column and never writes kind.

**S5. The allowlist is set on prod today.**
- D-30 §1 (reported) has `CAPTURE_DIGIT4_TEST_PHONES` set to your number.
- `isCaptureDigit4Live` reads `process.env` per request, and a Vercel env change takes effect only on redeploy.
- Required evidence before apply: the env var removed, a redeploy recorded, and the allowlisted phone sending "4" and getting the dark reply (repeat D-30 case 7 on that phone).

**S6. DOWN.**
- Restoring `kind NOT NULL` fails once any unclassified document exists. Guessing a kind is not an option. Make it a named precondition (unclassified count = 0) and exercise it with a seeded row.
- The restored `apply_material_inward_turn` must hash to the 050 md5 recorded in D-30 A1.
- Dropping `kind_set_*` destroys PM attribution. Name that consequence in the file.

**S7.** T-D8-11 as ruled in Q4.

**S8. The D-12 clock is undefined for unclassified documents.**
- `engineer_ack_at` drives "the D-12 clock" (049:808), and D-12 is not defined anywhere in the repo.
- Under 052, the clock starts before any delivery exists. State what it measures, and cite where D-12 lives.

**N1.** Put the helper in a non-exposed schema rather than `public`. The ACL is the real control, but this removes it from the API surface.

**N2.** Add to the C6 switch-flip gate: "PM classify UI live" and the `jobs` out-of-band RLS item (D-30 §6).

## 4. Credit

- The fixed-value kind columns with MATCH SIMPLE (049:343-380) make "a delivery only after classification" hold structurally without touching one FK. 052 gets that guarantee for free.
- `pm_link_invoice`'s `IS DISTINCT FROM 'invoice'` (050:811) already treats NULL as "not an invoice". Defaults point toward refusal.
- D-30 recorded the kind-question UX decision and F3 (a photo dropped at the kind step) as evidence before redesigning. The change is driven by a real-phone record, not a hunch.

## 5. Verdict

**STOP.** To clear:

1. The package itself (B1).
2. In-migration lock plus assert or sweep for in-flight sessions (B2).
3. Helper provenance and status on late classification, with both race orderings tested (B3).
4. A decision on the five legacy rows (S1).

S2 to S7 can land in the same round. I expect a design GO next round if B2 and B3 are as stated. Apply GO additionally needs the rehearsal on a structure-only dump, the privilege-matrix output, the S5 dark-control record and the executed DOWN.
