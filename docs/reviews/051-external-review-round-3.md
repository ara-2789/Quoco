051 round 3, PR #339 @ c5920ca464fada119638a4f132c75d59c7225063

Base is still main @ 10cd3a3047d281c34a5e34cbae13d016dd0aa276. I diffed rev 2 (f03a372) against rev 3: the SQL, both DOWN files (bodies still identical), the Rev 3 section, the R3 questions and carry-forward items 9–13. I re-ran 051 rev 3 byte-for-byte on a PG 16.15 stub of 049’s DDL (sha debe97f0…): the post-condition passes, and the cluster is gone.

All five round-2 conditions landed as written:

S1: the CHECK, its post-condition entry and its DOWN drop are in.
S2(a): the trigger is BEFORE INSERT OR UPDATE, and the tgtype mask was updated to match.
S3: both DOWN files now refuse with terminal_rows=N, and only count when the column exists, so a run against a database without 051 still reports the missing objects.
Probes: both round-2 probes are RED on rev 2 and GREEN on rev 3, with the rev 2 file sha-checked by the runner before the RED run.
Wording: R2-1 and R2-5 are corrected, with dated notes.

Yes: design GO, unconditional. Nothing below changes the design. Everything else is apply-side.

One consequence I should have named in round 2 (my miss). S2(a) together with the stamp CHECK means no path that fires triggers can ever INSERT a terminal row. The INSERT branch wants ingested_at NULL, and the CHECK wants it set. That is the point of the lock, but it also hits data-only restores:

--- full dump -> fresh db
 ingest_status | stamped
 stored        | t
--- data-only dump -> same schema, emptied
psql:data.sql:27: ERROR:  E11
CONTEXT:  PL/pgSQL function public.trg_capture_files_before_update() line 19 at RAISE

A full logical restore is fine, because pg_dump puts triggers in post-data, so the rows load before the trigger exists. A data-only restore into an existing schema loses the whole COPY for that table. That covers a prod-to-test-db data copy, or rebuilding data into a migrated schema.

The design doesn’t change. Add one runbook line: data-only restores of capture_files must run with triggers disabled (owner or superuser, session_replication_role = replica or --disable-triggers), and the restore record must say so. With PITR off until launch, this is the restore path you’re most likely to reach for.

R3 answers

R3-1, keep QE014 on INSERT. 049’s own E14 definition says “any invariant trigger,” and trg_capture_documents_before_insert (049:864) already raises QE014. So the new-document turn already depends on READ COMMITTED; only the append-to-existing-document turn is new.
Close the “not read” gap in the apply block with two read-only probes on test-db and prod: SHOW default_transaction_isolation, and any pg_roles.rolconfig / pg_db_role_setting entry that sets isolation for authenticator, service_role or postgres.
If either returns anything other than read committed, that is a STOP before apply, not a reason to drop the check.
R3-2, confirmed. “failed → failed with changes” is vacuous now, and that’s the intended end state. Every detail arrives with its transition. Record it as superseded in §9, not deleted.
R3-3, yes, count both. Count terminal rows, and rows where content_type or byte_size is set. The same structural reason as R2-5 applies: only the owner can write those columns today. The file aborting whole is the real guard; the count is the early warning.
R3-4, acceptable. The refusal is correct, and you don’t need a ready-made alternative.
The alternative depends on a decision you can only make at that point: what happens to the ingested_at values.
Rolling back a lock over live data is almost never the incident response anyway. If C5 misbehaves, you stop C5 and leave 051 in place.
Put that sentence in the runbook next to carry-forward item 12, so nobody reaches for this DOWN first.
R3-5, I want a targeted mutant. The 90-FAIL mutant proves the stamp is load-bearing. It doesn’t prove the suite checks the value, because a mutant that stamps the wrong time would leave every fixture valid.
Run NEW.ingested_at := 'epoch'; instead of now(), against the same GREEN scenario.
The T-D8-15-style time-window checks must FAIL and nothing else should. If nothing fails, the window check has never fired.

Nits

N1. Carry-forward item 9 still says “believed empty (nothing calls apply_material_inward_turn before C4)”. Item 13 supersedes it, but item 9 has no strike-through. Add a dated strike.
N2. The scaffold credential-scan gap is stated honestly, so it’s fine as a record. On the next rehearsal run (the test-db apply rehearsal), capture the scan output without the | head pipe.

Credit

Counting terminal rows only when the column exists, so a DOWN run against a no-051 database still reports the missing objects instead of failing on a missing column.
G1b case E: you found the second apply-time failure mode yourself and proved it aborts whole.
The R3-A/R3-B fixture rework: the fixtures now take the same blank-insert-then-update path production will.

Verdict

Design GO, unconditional.

Apply GO needs all of the following:

the test-db apply and its ledger row;
the pre-apply probes on each database: terminal rows, rows with details set, and the isolation settings from R3-1;
the epoch mutant transcript;
the restore runbook line;
the item 9 strike;
a pinned green CI run URL where QE011 and 23514 both appear as error.code.
