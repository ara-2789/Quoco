051 review: capture_files immutability (PR #339). Verdict: STOP, one round short.

Pins

main = 10cd3a3047d281c34a5e34cbae13d016dd0aa276
PR head = 9e9b63b44ffda5cf992919b603a05a6c76fdda16 (4 commits: 44cac28, 4f302c0, edf980f, 9e9b63b)

I read the SQL, both DOWN files, the test file and the package in full, plus 049:311–340 and 974–979. All 16 entries in SHA256.txt verify at head. Both DOWN bodies are identical below the header. I ran node scripts/lint-migrations.mjs at head: clean. 107 known violation(s), all exempted, exit 0.

My own probes ran on a disposable PG 16.15, not 17.11. The stub was 049’s capture_files DDL verbatim, its two grant lines, and minimal parents. 051 was applied byte-for-byte and its post-condition passed. The stub has no RLS, which doesn’t matter for service_role. The cluster is torn down.

Findings

B1. The terminal lock makes contradictory rows permanent.

049’s lifecycle CHECKs only work in one direction. rejected requires a reject_reason, but nothing stops a stored row from carrying one. stored requires the four details, but nothing stops a rejected row from carrying a hash and path.

Before 051 this didn’t matter, because nobody could write those columns. 051 opens the write path and then freezes whatever lands. Once a wrong shape reaches stored, service_role can’t fix it. Only the owner can, with the trigger disabled.

Raw output, as service_role:

UPDATE capture_files SET ingest_status='failed', reject_reason='too_large' WHERE file_no=1;        UPDATE 1
UPDATE capture_files SET ingest_status='stored', ... WHERE file_no=1;                              UPDATE 1
UPDATE capture_files SET reject_reason=NULL WHERE file_no=1;                                       ERROR:  E11
UPDATE capture_files SET ingest_status='rejected', reject_reason='wrong_type', ..., sha256=repeat('c',64), storage_path=..., preview_state='previewable' WHERE file_no=2;   UPDATE 1

 file_no | ingest_status | reject_reason | sha  | preview_state
       1 | stored        | too_large     | aaaa | previewable
       2 | rejected      | wrong_type    | cccc | previewable

The first row is a stored file that says it was too large. The second is a rejected file that claims stored, previewable bytes. Both are now immutable.

This is the “upstream distinction lost at the write boundary” class, made worse by the lock. The Q2 path (failed→failed with column changes) is exactly how the first row got there.

Fix: put these in 051, before the trigger:

sql
ALTER TABLE public.capture_files
  ADD CONSTRAINT capture_files_reject_reason_iff_chk CHECK ((ingest_status = 'rejected') = (reject_reason IS NOT NULL)),
  ADD CONSTRAINT capture_files_stored_only_chk CHECK (ingest_status = 'stored' OR (storage_path IS NULL AND sha256 IS NULL AND preview_state IS NULL));

content_type and byte_size stay allowed off stored, so too_large and wrong_type rejects can record what was observed. I ran both constraints against the same probes: each probe is refused 23514, and these controls still pass:

pending→stored with full details
pending→rejected too_large with byte_size
→failed with nothing set

Knock-ons:

The T-D8-3 control (sha256 set on a pending row) now fails 23514 by design. Replace it with a pending→stored move.
The post-condition must assert both constraints exist and are convalidated.
Both DOWN files must drop them, and the G0 baseline fingerprint must cover pg_constraint.
ADD CONSTRAINT takes ACCESS EXCLUSIVE and scans the table. 050 is live on prod and inserting pending rows, which all have NULL details, so validation passes. The 3s lock_timeout already covers the lock.

B2. Two rows can point at one storage object.

There is no uniqueness on storage_path, and the 049 prefix CHECK stops at the document folder.

 file_no | ingest_status | sha  | shared_path
       1 | stored        | aaaa | t
       3 | stored        | bbbb | t

Both rows are locked and both claim the same object. The second ingest’s upload replaces the first file’s bytes, and row 1 keeps certifying hash aaaa for bytes that no longer exist. This is the exact failure 051 is meant to prevent, and it gets in through the actor 051 constrains.

Fix: make the path belong to its row.

sql
CHECK (storage_path IS NULL OR starts_with(storage_path, tenant_id::text||'/'||project_id::text||'/'||document_id::text||'/'||id::text))

The uuid is fixed-width, so no row’s prefix can collide with another’s. This is stronger than a unique index, because it also blocks a path that some future row would legitimately own. I ran it: the shared path is refused 23514, and the test’s ${f.id}.jpg shape passes.

S1. The bytes are not locked, only the receipt.

Header line 3 and package §1 say “a stored capture file can never be silently changed.” service_role bypasses Storage RLS and can upsert over the object at any time. That needs a dated correction in the reworded header.

The guard relocates to C5’s entry gate:

upload with upsert: false to the row-owned path from B2
no code path in C5 overwrites or deletes an object under a stored row

S2. No terminal timestamp (this answers Q4).

A stored or rejected file has no record of when it got there, and the job row is not a substitute once jobs are pruned. That evidence is lost at write time and can’t be recovered later.

Decide now:

If yes: add ingested_at timestamptz to the grant (8 columns), with CHECK ((ingest_status IN ('stored','rejected')) = (ingested_at IS NOT NULL)). The trigger’s whole-row compare covers it for free.
If no: record why.

Adding it after rows exist means a backfill with an invented time.

N1. Stale self-attestation.

Item L is struck as resolved, but other parts of the package still say otherwise:

§7 still lists “Reservation entry … Not done here.”
Q9 still asks the question.
G4-lint.txt is a RED transcript of 44cac28, and there is no GREEN transcript at the current head.

Add a dated addendum to §7 and Q9, plus a lint transcript at the head you resubmit.

N2. C5 contract.

C5 should filter its UPDATE on ingest_status IN ('pending','failed'), so a retry touches 0 rows instead of depending on value equality.

Otherwise a C5 change that re-derives content_type differently (say, a detection library bump) turns every retry on a correct row into a QE011. C5 must treat QE011 as an alert, never as a retry. Write that into the C5 plan, not into this file.

N3. The identity list is maintained by hand.

Add a 17th column later and it lands in neither list: the owner can mutate it freely on pending rows, and nothing complains. Add a test asserting that columns(capture_files) = identity ∪ granted, so growing the table forces the trigger to be revisited.

N4. The DOWN refuses without the ledger row.

The ledger row is a separate manual step. If it is skipped at apply, the rollback refuses at the worst moment. The runbook should make the ledger row part of “apply done,” not a follow-up.

Your questions
Identity list. It is complete: 9 + 7 = 16, checked against 049:311–340. ingest_status is not identity; it is the state machine.
failed→failed with changes. Allow it, but only once B1 lands. Today it is the path that produced the stored-with-reject-reason row.
DEFINER vs INVOKER. Keep DEFINER. But not for consistency: a trigger-returning function can’t be invoked directly (your 0A000 proof), so the DEFINER surface is nil, and switching would cost a re-rehearsal for no gain.
Missing grant columns. See S2. Beyond that, C5’s plan must enumerate its UPDATE column list and diff it against this grant before any C5 code exists.
No-op UPDATE on terminal rows. Correct to allow. WAL cost at ingest volume is noise. N2 makes it rarely exercised anyway.
Reusing QE009/011/014. Fine for one caller. Make sure logs carry the table name, since E11 now means two tables.
Pending→pending with changes. No. The stored details move only with the status. B1’s second CHECK enforces this.
Owner/superuser boundary. Accept it. service_role can’t disable triggers or TRUNCATE. An event trigger only guards against the owner, who can drop the event trigger too.
Reservation timing. Moot: it’s done (see N1).
Prod ACL pre-state. Your in-file post-condition is already the real pre-check: G1b shows it aborts on foreign grants. Keep the readback as the PITR substitute. Nothing more is needed.
Credit
G2b mutant. It flips one line and gets 20 FAILs. That is the proof the suite tests the lock and not the fixture.
G1b negative post-conditions. Three seeded wrong states each abort the file whole, with nothing left behind.
Column walk. The post-condition walks every attribute rather than the seven, so a stray UPDATE(file_no) is caught, not just a missing grant.
049 DOWN guard. Keeping the table name out of the function body to stay clear of 049 Guard 2 is a real constraint, handled and proven (G5) rather than asserted.
Row counts. .select('id') plus row-count assertions on every update is the N-3 rule actually applied.
Verdict

STOP, one round short. It clears with:

B1 and B2 in the file, together with the matching post-condition assertions and DOWN drops.
G0/G2/G2b/G1b/G3 re-run. The three probes above must be RED on today’s 051 and GREEN after.
S1 reworded with a dated correction, and S2 decided and recorded.
N1 addendum.

That gets you a design GO. Apply GO additionally needs the test-db apply, its ledger row, and a pinned green CI run URL where QE011 is observed as error.code. Today that is still inferred.

I’m not pushing pr339. It’s a read-only local copy of PR #339’s head that I fetched to review, so the four commits are yours and already on GitHub. I made no commits and changed no files in the repo, so there is nothing of mine to push.

Pushing it would also create a new branch on ara-2789/Quoco that you didn’t ask for, and this session only has read access to the repo anyway.

The review above is complete as sent.
