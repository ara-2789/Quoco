I'll pin `21627a8`, diff rev 4.1 against rev 5.1, and read every changed section. Then I'll test your questions 1 and 3 on the stub rather than argue them.

# PR-B 050 plan review, round 2: PR #333 @ `21627a8`

**Verdict: cleared for SQL once one line changes.**
- The DOWN's lock mode has to change from SHARE ROW EXCLUSIVE to EXCLUSIVE. The mode I recommended in round 1 deadlocks; I proved it on the stub (below).
- Everything else in rev 5/5.1 lands round 1 correctly.
- After that edit, no further plan round is needed. The other notes are non-blocking.

**Pins**
- PR head `21627a876abeeb0d420620d985e28c7230960151`; base `main` still `4b419f6`.
- Plan sha256 `d1641678…2759`.
- The saved round-1 review is `2382018c…c9`, matching what the plan cites.

**What I checked**
- The full diff from `ca06586`.
- Main's final 049 loaded onto a PG 16 stub (`MAINTAIN` line removed as before).
- `040:540-560, 715-730, 870-905` read at `4b419f6`.

## Your four questions

**1. B1 error code: your reading is right. It's 23514, not E11.**

I ran the unconditional S3 move on a cancelled automatic delivery with `cancelled_*` left as they were:

```
ERROR: 23514: new row for relation "deliveries" violates check constraint "deliveries_cancelled_at_chk"
```

B-1's E11 only fires when the `cancelled_*` columns *change* without the matching transition. Leaving them alone isn't a change. TR4c allows `cancelled → awaiting_pm`, so the trigger passes and the CHECK catches it. My round-1 B1 had this wrong.

- `approved → awaiting_pm` and `rejected → awaiting_pm` really are QE011, from TR4c's transition check.
- In §3, replace the "both readings" text with: QE011 for approved and rejected, 23514 for cancelled.
- The fix and the warning against clearing `cancelled_*` stand as written.
- T-B1-LINK-THEN-ACK can now assert the exact code its RED produces.

**2. Evening four-hunk count: yes, it holds.**
- `040:876-880` is the single persist, and it writes `context = v_session.context` on every path. So a new `v_session.context` assignment inside the step-1 branch persists without touching the write.
- A deferred message leaves `v_col` NULL, so the output upsert at `721-728` is skipped.

The shape matters for the proof diff, though. Don't wrap the existing three statements at `556-558` (or morning's `534-551`) in a new `IF … ELSE`. That re-indents unchanged lines, and the unified diff will show them as removed and re-added. Instead, add a **new `ELSIF` arm** between the empty-message arm and the step-1 arm:

```
ELSIF v_session.current_step = 1 AND <flag matches this check-in> THEN
  <defer; clear the flag>
```

Then every existing line stays byte-identical. The step-1 comment at `040:555` even says "BYTE-IDENTICAL". Same shape in morning, before `038:533`.

The claim is still checked against the migration file, not the live body, so it stays unverified until the diff against live, as you've recorded.

**3. DOWN lock: SHARE ROW EXCLUSIVE is not acceptable. It deadlocks.**

I raced a webhook-style turn (`FOR UPDATE` on the session row, then `UPDATE`) against the DOWN (lock, then clear):

| DOWN lock mode | What happened | End state |
|---|---|---|
| SHARE ROW EXCLUSIVE | `deadlock detected`; the **turn** was the one killed | `flow=NULL context={}` |
| EXCLUSIVE | the turn finished first, then the DOWN cleared | `flow=NULL context={"turn":1}` |

Why SHARE ROW EXCLUSIVE fails:
- It doesn't conflict with the ROW SHARE lock that `FOR UPDATE` takes, so the DOWN gets in while the turn holds the session row.
- The turn's `UPDATE` (ROW EXCLUSIVE) then waits on the DOWN, and the DOWN's `UPDATE` waits on the turn's row lock.
- The engineer's turn dies, the webhook returns an error, and Twilio's retry is dropped as a duplicate. The message is lost: the S-F window, caused by the rollback.

Why EXCLUSIVE works:
- It conflicts with ROW SHARE, so it waits for in-flight turns. Postgres lets the turn's own `UPDATE` go ahead of the waiting DOWN, because the turn already holds a lock that conflicts with it.
- So the turn commits, then the DOWN clears what it wrote.
- Plain `SELECT`s are not blocked.

Under load, while the DOWN waits for and holds EXCLUSIVE, new turns queue behind it. So:
- add `SET LOCAL lock_timeout = '3s'`, so the DOWN gives up instead of stalling webhooks (Twilio waits about 15 s);
- run the DOWN outside the 08:25–08:40 and 18:25–18:40 IST windows.

This was my error in round 1: I picked the lock mode without testing it against the webhook's `FOR UPDATE`.

**4. `pm_link_invoice` per-id check: sound, under five conditions.**
- **The check:** each delivery's `project_id` (and `tenant_id`) must equal the **invoice's**, not merely be some project the caller is a PM on.
  - The link's composite FKs force link, delivery and invoice into one project anyway.
  - Without this check, a foreign delivery id would surface as an FK 23503 *after* authorisation. That's a different error from QE015, which leaks.
- **Why it's stable without locks:** `project_id` and `tenant_id` can't change (TR4a).
- **Do it as one unlocked query:** `WHERE id = ANY(ids) AND project_id = <invoice project> AND tenant_id = <caller tenant>`, and compare the count with the number of distinct ids.

The five conditions:
- refuse an empty array, any NULL element, and duplicate ids (a duplicate would otherwise come back as a misleading QE008);
- cap the array length;
- every failure is QE015 for the whole call and never says which id failed;
- sort the ids before taking the ascending-id locks;
- nothing is locked or written until every id has passed.

`pm_unlink_invoice` (link id → project) is safe by the same reasoning, because TR3 makes the link's identity columns immutable.

## Findings

**Blocking, §9 (S4).** Change the DOWN's first statement to `LOCK TABLE public.whatsapp_sessions IN EXCLUSIVE MODE`, with `SET LOCAL lock_timeout = '3s'` before it. Record the quiet-window rule, and replace the §14 unknown with the race result above.

**T-DOWN-1 gains a case:** a second session holds a session row `FOR UPDATE`, then updates it while the DOWN runs. The turn must commit, and the DOWN must still end with no `invoice` row and no flag. RED: SHARE ROW EXCLUSIVE gives `deadlock detected`.

**Non-blocking, §3 (B1):** replace the two-readings note with what the stub showed (question 1).

**Non-blocking, §6 (N1):** write hunk (2) as a new `ELSIF` arm before the step-1 arm in both functions, so no existing line changes (question 2).

**Non-blocking, §4.5 (S1):** write the five conditions from question 4 into the plan, and add tests:
- a foreign delivery id in the array → QE015, not 23503;
- an empty array, a NULL element, and a duplicate id → QE015;
- nothing is cancelled in any of them.

**Non-blocking, §3 (S3 row):** make "`unclear` → close" explicit. The table says "S4 after `2` or `3`; close after `1`" and leaves `unclear` out. v3:91 says the flow closes. That's the only safe route: the raw text is already stored as the note, and TR5 allows the note to be set once, so a following S4 note would get QE011.

**Non-blocking, §7 (B3 item 1):** the flag records the discarded step, but option (a) defers whatever the step was (T-N13-3 says so). That's a stored fact nothing reads. Either use it, for example to make the explanation string say "your delivery note wasn't saved" when the step was S4, or drop it.

**Non-blocking, §9 (S4, two artifacts):** say where the two per-database DOWN texts live, for example `docs/reviews/050-down-prod.sql` and `050-down-testdb.sql` with their sha256 values, and point the commented DOWN in the migration at them.

## My errors this round

- I said E11 where the stub gives 23514 (B1).
- I recommended a lock mode that deadlocks (S4).

Both were claims I made without running them. That's the class I keep naming in your files, and I'm not exempt from it.