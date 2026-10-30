# C5 code review, round 1 (PR #344) — SUMMARY from session record, not the reviewer's original text (original not preserved)

Received 29 Oct 2026. Reviewer acknowledged fix-up 60890bb on 29 Oct.

Verdict: GO to merge, conditional on (1) pinned green CI with a passing Test job (moved to 60890bb after the CI fix-up, reviewer-acknowledged), (2) prod read-only counts before and after deploy: 0, empty, empty.

- Q1: no path counts stored without a confirmed one-row UPDATE. Q2: storage only at rowPath(row). Q3: C5's own payloads clean.
- Deviation 1 (no second write after a DB refusal): accepted. A refusal means C5's picture of the row or its code is wrong, so it does not write again; "pending" stays distinct from "processed and failed". Deviations 2 (jobId in events) and 3 (rebuild, no bypass): accepted.
- S1 (before D-30): @sentry/nextjs NodeFetch + tracesSampleRate 1 put Twilio media URLs, storage paths and PostgREST tenant_id queries into breadcrumbs and spans; scrub-pii.ts redacted only phones/emails. Fixed in PR #345 (merge 6c76a27).
- Twilio console: confirm HTTP Basic auth on media URLs (before D-30). Done 30 Oct (Enabled, per Aravind's screenshot).
- S2 (before C6): a DB refusal leaves the job 'succeeded' and the row 'pending'; a running-jobs scan never sees it. C6 stuck scan must be ROW-based (capture_files pending/failed older than N minutes, deduplicated per day) or PR-D 15-minute rule live.
- N1: markFailed reports quarantined even when the failed write was refused/0 rows: add a marked indicator to quarantine events. Implemented as markedCount (30 Oct).
- N2: already_done for rejected rows compares reject_reason only, not content_type: note.
- N3: control runs must print HEAD SHA and the mutated file's hash.
- N4: 1024-byte PDF window: a text/HTML body with %PDF- near the start is stored as application/pdf (not_previewable) permanently: accept and record.
- N5: events keep only the first errorCode per kind: keep a small set, or accept. Decided 30 Oct: accept.
- Nit: T-NOWRITE-1 (c) misses .from(TABLE); tighten to "capture_files appears exactly once in the route, inside the event extra". Reviewer found no other "until C5" guards.

Ack: Aravind accepted all findings; N1, N2, N4, N5 and the nit are handled in the C5 follow-up PR (#346).
