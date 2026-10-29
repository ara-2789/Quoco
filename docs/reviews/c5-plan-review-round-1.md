Copied from a rendered view on 2026-10-28; Markdown formatting lost, wording unchanged (per Aravind).

C5 plan review (capture_ingest), base main @ a84f6e53a68d44e22b34601a575c9346eafe3dd4. Verdict: plan GO, with five changes to make in the review package. Nothing blocks.

The base’s parents match what you printed (f55431c8…, 41e8db66…). I spot-checked against that SHA:

TK:84–85 (Unknown job type), S051:288–289 (the grant) and S051:174 (row-owned path) are all where the plan says.
The bucket definition at S049:1021–1024.
claimJobs and the backoff in JB.
The tick’s Promise.allSettled with the dead-letter catch.
050’s payload build at :362–385.

I didn’t re-read the whole plan line by line. These were the citations the design leans on.

The C7 diff is right: the union of the SET columns equals the grant, with nothing outside it.

Findings

S1. A 0-row UPDATE has no defined meaning. guardedUpdate ends in .select('id'), and T-C4-1 treats “0 rows, no error” as the wanted result. Nothing says what processOneFile then reports. If it counts the file as stored, the job completes on a write that never happened.

The fix: on 0 rows, re-read the row, scoped to the tenant.

If it’s terminal with the same sha256 and storage_path, count it as already done, since another run got there first.
Otherwise raise an update_noop alert and make it non-retryable.

Test: inject a wrapper that moves the row to stored between the read in step 2 and the UPDATE. The handler must not count a fresh store. Then a mutant that treats 0 rows as success should go red.

S2. The upload doesn’t say contentType, and the bucket enforces it. 049 created capture-documents with allowed_mime_types set to the four types. When the body is a Buffer and no contentType is passed, supabase-js sends text/plain;charset=UTF-8. The bucket would refuse every upload. Your classification makes that storage_failed, so it’s retried five times, with a 16 MiB download each attempt, and then every file is dead-lettered as failed.

uploadOnce must pass { upsert: false, contentType: <detected type> }. IG does the same at IG:125.
Treat a deterministic storage 4xx other than duplicate (mime type, size) as alert-and-don’t-retry.
T-C1-1 should assert contentType too.
The object metadata is also what PR-D’s download will serve, so it has to be the detected type.

S3. The time budget only covers the fetch. The 15 s timeout and the 20 s start gate leave several calls with no bound: the upload (up to 16 MiB), the existing-object download on the duplicate path, and the UPDATE.

That matters because of U5. A function killed at the platform limit leaves its job in running forever. claimJobs only selects pending or failed, nothing reaps running, and the files sit pending with no alert. PR-D’s 15-minute rule doesn’t exist yet, so today nothing would surface it at all.

Put every network call under one per-job deadline, and check the deadline again before each upload, not only before starting a file.
Before C6 turns digit 4 on, add a stuck-running scan with a deduplicated alert, or a reaper, so the gap has an owner. This is the same rule as before: a guard you can’t build in C5 has to move to C6’s entry gate, not disappear.

S4. %PDF- at byte 0 will reject real PDFs, and the rejection can’t be undone. Readers accept the header anywhere in the first 1024 bytes, and some scanner and phone apps write a prefix before it. Under 051 a rejected row is terminal and keeps no bytes. The engineer has already been told “received” and never hears otherwise (R5/A11), so a real invoice quietly becomes “wrong type” for good.

Scan for %PDF- within the first 1024 bytes and store the bytes untouched. This is your decision, because V3:203 says byte 0; if you keep byte 0, record why. Either way, the D-30 phone test should include one PDF from a scanner app.

S5. A too_large reject throws away the type it already detected. Detection runs on the first chunk, before any size decision, so a too_large file has a known type. The S1 CHECK allows content_type on rejected rows. Write it: it’s a fact observed at write time, and it’s gone afterwards.

byte_size should stay NULL (Q7, below): the true size isn’t known, and recording Content-Length would be a guess.

N1. U9’s cap of 20 files: 050 sets no limit and Twilio sends at most 10 media items per message. Twenty is safe. A payload over the cap should raise payload_invalid and an alert, which the plan already does.

N2. If markCaptureIngestFailed itself throws inside the tick’s catch, the job’s promise rejects and no alert goes out. Wrap it so a failed dead-letter attempt sends its own event.

Rulings on your questions
Fail the whole job closed on any mismatch. Agreed, and for the reason you gave: 050 builds the payload in one transaction, so a payload that is partly wrong didn’t come from 050.
URL guard. Yes. Without it, the job queue can make C5 attach your Twilio credentials to any URL. Twilio-shaped test URLs are a cheap price for that.
Drop the extension. I’m overruling the brief’s <file_id>.<ext>. With the extension, the path depends on what the bytes turn out to be, and that dependency is what creates the orphan in 3.4. Without it, the path depends only on the row’s identity, so a retry always lands on the same object and the duplicate check always fires. content_type is already stored on the row, and the CHECK still passes on …/<id>.
The timing numbers. Check the real Vercel limit (U1) before the package. Accept 15 s / 20 s only once S3 puts every call under the deadline.
The alert-not-retry list. Agreed, including 42501, since a retry can’t restore a missing grant. Add the deterministic storage 4xx from S2.
The dead letter’s narrower = 'pending' filter, and alerting only when rows moved. Agreed.
Size on too_large rejects. byte_size stays NULL; see S5 for content_type.
Sentry identifiers. jobId only. The job’s payload maps it to the files.
No zod. Agreed; validate by hand.
The two edits outside the list (the JobType union and the dispatch test). Both agreed. Writing the dispatch test first, green against the unedited route, is the right order.
PITR: option (b). Take a hashed readback just before the D-30 test, since that’s when the first real rows appear, and record the word “substituted”.
No env kill switch. The stop levers are digit 4 (a constant) and a revert. Write in the runbook that after a revert, in-flight jobs burn their attempts and die without changing any data.
%%EOF and /Encrypt. Both agreed; each errs in the safe direction. For the header, see S4.
Ordering against C4b. Merge C5 before C4b. It has no dependency on C4b, and while digit 4 is dark nothing exercises it either way.
The V3:203 correction. Yes, queue a dated correction to V3:203 for PR-F.
Rows left pending after a non-retryable alert. Accept it while digit 4 is dark. Before C6, the stuck scan from S3 has to cover these rows too, or PR-D has to be live.
Credit
Doing the C7 diff before designing the SET lists, and pasting it.
Comparing hashes on a duplicate upload instead of trusting or overwriting the existing object.
Reading by id IN (…) AND tenant_id and treating a missing row as a mismatch, which satisfies CM §4 without weakening the identity check.
Writing the dispatch characterization test green against the unedited route before touching the route.
The no-fetch evidence for the dark state, plus a static test to keep it that way.
Verdict

Plan GO. No blocking findings. The next artifact is docs/reviews/c5-review-package.md. It should contain:

S1–S5 folded in;
the Q3 path change;
the code and the raw test output at a pinned SHA;
U1 and U2 observed, not inferred: the Vercel limit, and the real shape of the duplicate-upload error on test-db;
U3 covered by T-PRE-1, raw output included.