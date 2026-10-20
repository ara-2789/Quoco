I'll pin PR #333, read the plan in full, and check its claims against the live check-in functions and the 049 file on main.

Main moved to `4b419f6`: 049 is applied and on main. The plan is 448 lines and about 74 KB, so I'll read it in parts.

No CHECK on `jobs.type`, so the S2 ingest-job insert won't be refused. Now the 038 morning body: the step-1 branch and the context write, to test the four-hunk claim.

# PR-B 050 plan review: PR #333 @ `ca06586`

**Verdict: STOP at plan stage, one round short.** Three findings change the design and have to be settled before you write any SQL. The rest can be fixed by editing the plan.

**What I checked**
- **Pins:** PR head `ca0658654b40061165bcd15aa1d33e427872850c`; base `main` `4b419f6`, with 049 applied and on main. The plan's sha256 is `3a5a90f8…1fb15d`.
- I read the whole plan.
- I checked its claims against main: 048's gate (`048:150-192`), the 038 morning body (`038:450-560`), `quoco_classify_yes_no` (`030:267-318`), the jobs table (`006`), and the idle digit router (`inbound-start.ts:255-262, 941`).
- I ran two things on a scratch PG 16: the live classifier itself, and the duplicate-key handler pattern. I did **not** read 040 line by line, so my four-hunk comments below cover morning only.

## Blocking

**B1. §3 (S3 row): the engineer's ack fails once a PM has acted first.** This is outside your six focus areas, but it blocks the SQL.

S3 moves the delivery to `awaiting_pm` "inside this call", whatever its status. The delivery exists from S2, so a PM can act before the engineer answers. D-10 (approve `incomplete`, decided 18 Oct) makes that a normal path. Under 049's TR4c, the ack's status move then does this:
- **approved → awaiting_pm:** forbidden, so E11. The whole turn rolls back and the engineer's ack is lost with an error.
- **rejected → awaiting_pm:** same.
- **cancelled → awaiting_pm**, when the PM linked the invoice before the engineer acked it: TR4c allows it as a restore, but B-1 requires `cancelled_*` to be cleared, so E11. If whoever writes the SQL "fixes" that by clearing them, a superseded automatic delivery comes back to life while its PM links are still active.

**Fix:** the ack is always stored on the document. The delivery moves only `WHERE status = 'incomplete'`; in any other status it is left alone.

**Tests:** for each of approve-then-ack, reject-then-ack and link-then-ack, the ack is stored and the status doesn't change.

**B2. §4: the people who can write are not the people who can read.**
- §4.2 copies 048's caller resolution. 048 never checks `users.status`, and it lets an `admin` through with no project membership at all (`048:177-189`; only `pm` is checked against `project_members`).
- So a deactivated PM whose auth account still works could approve, reject and link. D-32 already made the same gap on *reads* (043/044) a blocker before the switch trigger. This is a write path.

**Fix:** the PM functions use 049's D-20 audience exactly: the `users` row found by `auth_id = auth.uid()` with `status = 'active'`, plus `project_members.role = 'pm'` on the row's own project. An admin counts only if they're a PM member. Every failure gives the same QE015.

**Tests:** a deactivated PM, a pending user, and an admin who isn't a member each get QE015; an admin who is a PM member succeeds.

**B3. §7: the N13 guard only covers bare digits, but a check-in can reset the session at S1 or S4 too.**
The guard re-asks only for exactly `1`, `2` or `3`. But the reset can land while the engineer is about to type a kind (S1) or a free-text note (S4). I ran the live classifier:

| Message | Result |
|---|---|
| `2 bags short` | `{ok:true, met:false}` |
| `partial, cement not received` | `{ok:true, met:false}` |
| `some steel pending` | `{ok:true, met:false}` |

Any NO-list token wins (`030:299-307`). In morning, `ok AND NOT met` goes straight to step 5, not on site (`038:539-542`), on the first message with no re-ask. So the engineer's delivery note records them **absent**. In evening, step 1 accepts any text, so the note becomes the day's `evening_output`. Both are wrong facts on the DPR, written silently.

**Fix:** make the flag carry the step that was discarded. Then, either:
- **(a)** the first step-1 message after an `invoice` discard is never taken as an answer: reply with an explanation and the question, and handle the second message normally. This costs one extra exchange, and only for an engineer who was mid-capture. Or:
- **(b)** apply (a) only when the discarded step was S1 or S4, and keep the digit-only guard for S3.

I'd pick (a). It's one rule, it doesn't depend on guessing what the engineer meant, and the population it touches is tiny.

**Tests:** T-N13 cases using the three note texts above, morning and evening. RED: the digit-only guard records absent and writes `evening_output`.

## Non-blocking (fix in the plan before SQL)

**S1. §4: locks are taken before the caller is authorised, which breaks your "identical refusal" rule.**
- The 049 contract you're following says "Lock I, then validate the caller" (path 1, steps 1-2). For a foreign id, the lock is taken before the refusal.
- A nonexistent id returns at once. An existing row that its own tenant's PM is holding makes the call wait. That's a timing difference the function controls, which §4 itself forbids. It also means a caller from another tenant can queue on your rows.

**Fix:** authorise with unlocked reads first, and refuse with QE015. This is safe because `project_id` and `tenant_id` can't change (TR4a, TR5), so the answer can't flip under the lock. Only then take the contract locks.

This one is partly mine. I confirmed that six-path lock order in the 049 rounds without asking where authorisation goes.

**S2. §4.5 and §11: T-E8-RERAISE can't be built through the real function.**
- `pm_link_invoice` inserts only `pm_manual` links.
- `source_message_sid` and `(source_message_sid, media_index)` are on tables it never writes.
- `uq_dil_active_self_per_invoice` only covers `link_source = 'created_from_invoice'`, so a `pm_manual` row can never hit it.
- So `uq_dil_active_per_delivery` is the only 23505 the function can reach, and the "re-raise everything else" branch has nothing real to test.

**Fix:** in the rehearsal only, plant a unique index that a `pm_manual` insert will hit, using a seeded row. Assert native 23505 **and** that nothing changed: the automatic delivery is not cancelled and the self-link is still active.

Two corrections to the mechanism, both checked on the stub:
- **What a swallowed error actually does.** A caught error rolls back only the writes *inside* the protected block. Writes *before* the block are kept, and they commit. So the danger is precisely path 1 steps 4-5 (unlink the self-link, cancel the automatic delivery) committing without the PM links. The block should wrap only the link-INSERT loop. The RED for the test is a swallowing handler, which leaves the delivery cancelled with no links.
- **What `GET STACKED DIAGNOSTICS … CONSTRAINT_NAME` returns.** It does return the partial index's name, `uq_dil_active_per_delivery`. The design works.

One more thing: a bare `RAISE;` also carries DETAIL with the key values. Any native 23505 coming out of a `pm_*` function has to map to the generic E12 string in the app, never be shown.

**S3. §7: the guard's digit set must be the same code as the S3 ack parser.**
- If S3 accepts `1.` or `1️⃣` (the classifier treats both as unparsed), but the guard checks bare `1`/`2`/`3` only, an emoji ack walks straight past the guard.
- §4.1 still leaves open whether parsing happens inside the RPC.

**Fix:** decide that parsing happens in SQL, in one function that both the guard and S3 call, with one shared test.

**S4. §9: the DOWN can race against live calls.**
- The order is "clear sessions, strip flag, restore bodies, drop functions". An in-flight call on the 050 body can write an `invoice` row or the flag after the clear has already scanned the table.

Fixes:
- Run `LOCK TABLE public.whatsapp_sessions IN SHARE ROW EXCLUSIVE MODE` first.
- State the precondition: PR-C's code has been rolled back and that rollback is live (the C, B, A order), so nothing calls `apply_material_inward_turn`.
- Write "clear" as subtract-only: `current_flow` NULL, step 0, remove the flow-owned keys and the flag. Never `context := '{}'`, because that drops `morning_submitted` and the check-in re-asks an engineer who has already finished. This can't be written until the flow-owned key list exists, which is still owed.
- Restore each database from its **own** captured body. If prod and test-db differ, that's two texts, two sha256 pins, and two DOWN artifacts.

**S5. §10: the S-F split is recorded as more than it is.**
- RPC idempotency doesn't reduce capture loss at all. A Twilio retry is dropped at the webhook as `duplicate_ignored` (`route.ts:224-227`) and never reaches the RPC.
- What PR-B delivers is a *prerequisite* for PR-C's fix, not half of it. Reword the 049 dated note to say so.

Also record this coupling now:
- `received_at` requires the `processed_messages` row to exist **before** the RPC runs (Q2-6).
- So PR-C can't fix S-F by consuming the SID after processing unless 050 changes too.

**N1. §6: say where the hunk boundaries are.**
- The four-hunk claim holds for morning, because the step-1 branch writes `v_session.context` inline (`038:537, 541, 545`).
- That's only true if the guard and the flag-clear sit **at the top** of the step-1 branch, before its three sub-branches. Otherwise the clear spreads into three places and the hunk count breaks. Write that down now.
- "Re-assert grants" should mean the ACL read from the live database, with before and after compared equal, not the text at `038:712`.

I didn't check 040 line by line.

**N2. §9: after a DOWN, a pending ack reply starts a hindrance report.**
After the DOWN clears an S3 session, the engineer's `1` ("yes, received") arrives at idle and starts a hindrance report (`inbound-start.ts:941`). It's the same mechanism as v3 D1 after expiry. Not a defect in the DOWN, but name it in the DOWN record.

**N3. §5: add an in-file assertion block to the UP.**
Use the same pattern as 049, covering all seven new functions: `pg_proc` count = 1 per name, `prosecdef`, `proconfig`, owner, and ACL. Reading these back after apply is too late to stop a bad apply.

**N4. §3 and §4.1: two loose ends.**
- The S2 ingest job (`jobs.type` has no CHECK, `006:7`, so no schema change is needed) is a contract between PR-B and PR-C. Name the job type and its payload in this plan.
- §4.1 says "see 4.4" for the duplicate-key handler; it should say 4.5. Also state explicitly that `apply_material_inward_turn` has no `unique_violation` handler at all.

## Your six areas, in short

1. **§4 (locks, re-raise, refusal):** the lock order is right, but authorisation must come first (S1). The re-raise design works, but the test needs a planted index (S2). Identical refusal also needs the D-20 audience (B2).
2. **§5 (grants):** the matrix is right. Add the in-file assertion (N3).
3. **§6 (four places):** feasible, provided the hunk boundaries are written down (N1).
4. **§7 (stray 1/2/3 guard):** too narrow (B3), and must share the ack parser (S3).
5. **§9 (DOWN):** needs the table lock, subtract-only clearing, and a per-database restore (S4).
6. **§10 (blocking conditions):** the conditions are carried correctly, but the S-F record overstates PR-B's half (S5).