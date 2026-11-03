# PR-D1 round 3 package (PR #348)

Built from raw outputs; no paraphrase. Report only: no code change, commit, push or test-db call.
HEAD at build: b92fabd6b6561b30798bc464e5c2259daa1b4cbb; git status --porcelain bytes:        0 (0 = empty)

## P1 SHAs
```
f6cf79f556725d59480a573b89a975b0ad3ea072  S1 RED test: T-FILE-CTRL, a deactivated PM of A1 must be refused when step 2 is a service-role read (test only, no fix)
d5b8a64e3398458e71fe31c933372dac2df01fa3  review fixes: S1 users.status check on the file route, S2 T-NOBUCKET-1 bucket guard, S3 T-NOWRITE-1 retitle, N1/N2/N4/N6, deviation 38, both reviews in docs/reviews/
5699af6fbea06dee9d10bbba138de312aa32bf96  approved English strings (Aravind, 2 Nov): 75 placeholders replaced, placeholder assertions rewritten, test/pm-strings-approved.test.ts
92936dc5d8fc7e904efafeae58a66e41a745b400  merge of origin/main 9a42ac7 (#349, test-user teardown) into the branch
b92fabd6b6561b30798bc464e5c2259daa1b4cbb  day-count render: invoiceWaitLabel helper, one string change ("Invoice pending for {n} days"), H2 tests, deviation 39, approved-strings doc
(verified now with git rev-parse:)
f6cf79f556725d59480a573b89a975b0ad3ea072
d5b8a64e3398458e71fe31c933372dac2df01fa3
5699af6fbea06dee9d10bbba138de312aa32bf96
92936dc5d8fc7e904efafeae58a66e41a745b400
b92fabd6b6561b30798bc464e5c2259daa1b4cbb
```

## P2 G1 transcripts: /tmp/quoco/pr-d-s1-evidence.txt (full, ANSI stripped)

Chronology note: the RED run at f6cf79f started at 04:27:58 IST on 2 Nov (pinned header in pr-d-tests.txt). It ran before a hold. Per the backend chat, it overlapped main's CI test job (run 41359820380, started about 04:29 IST) on the shared test-db. Its failure is the intended one ('expected 302 to be 404'), not a collision signature. The GREEN runs at d5b8a64 ran after test-db was confirmed free.

```
################ X1 RED evidence: S1 deactivated PM, PM_CONTROL=service, at the test-only commit
$ git rev-parse HEAD
f6cf79f556725d59480a573b89a975b0ad3ea072
$ shasum -a 256 test/pm-file-route.test.ts lib/capture/pm-file-access.ts
e8e3ed6f46e8cb8020ca4ec629243266525b5e26af124c0f3c52271a4920f75b  test/pm-file-route.test.ts
9289988c256f6d25ca6f95b0954777585a7e6b479f3ad2254e35325a5fe262f6  lib/capture/pm-file-access.ts
$ git status --porcelain  (must be empty)
(end porcelain)
$ PM_CONTROL=service bash /tmp/quoco/pr-d-run.sh s1-red test/pm-file-route.test.ts -t T-FILE-CTRL   (ANSI-stripped failing lines for 'deactivated PM of A1'; full raw: /tmp/quoco/pr-d-s1-red-raw.txt)
   × T-FILE-CTRL: step 2 swapped for a SERVICE-ROLE read; the app check alone must refuse (real cross-tenant data) > same swap, a DEACTIVATED PM of A1 asking for A1's stored file: 404 (active status must not rest on RLS alone) 1642ms
 FAIL  test/pm-file-route.test.ts > T-FILE-CTRL: step 2 swapped for a SERVICE-ROLE read; the app check alone must refuse (real cross-tenant data) > same swap, a DEACTIVATED PM of A1 asking for A1's stored file: 404 (active status must not rest on RLS alone)
AssertionError: expected 302 to be 404 // Object.is equality
- Expected
+ Received
      Tests  1 failed | 4 passed | 21 skipped (26)
vitest exit: 1

################ G1 GREEN (2 Nov, after "go"; origin/main = 9a42ac7d0736c96ad889aa94ac444543df72c434)
HEAD: d5b8a64e3398458e71fe31c933372dac2df01fa3 (detached)
sha256 test/pm-file-route.test.ts:    e8e3ed6f46e8cb8020ca4ec629243266525b5e26af124c0f3c52271a4920f75b
sha256 lib/capture/pm-file-access.ts: 066396e38cd29d86426615c4d19123089363438fc55c2e7179c2b65126731249
git status --porcelain: (empty)

 RUN  v3.2.7 /Users/aravindanrajamani/Desktop/quocoai-pm-ui

stdout | test/pm-file-route.test.ts
[pm-file-route] buildPmKit: 10071 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-dca1 (stored): 3106 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-pdf (stored_pdf): 2625 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-dca2 (stored, P2): 2619 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-dcb (stored, tenant B): 2514 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-pend (pending): 1717 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-fail (failed): 1899 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-rej (rejected): 1906 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-invpdf (invoice, stored_pdf): 2516 ms

stdout | test/pm-file-route.test.ts > T-FILE (PM removed from the project)
[pm-file-route] removeStoredObjects: 652 ms

stdout | test/pm-file-route.test.ts > T-FILE (PM removed from the project)
[pm-file-route] teardownCaptureKit: 4470 ms

 ✓ test/pm-file-route.test.ts (26 tests | 25 skipped) 35444ms
   ✓ T-FILE-CTRL: step 2 swapped for a SERVICE-ROLE read; the app check alone must refuse (real cross-tenant data) > same swap, a DEACTIVATED PM of A1 asking for A1's stored file: 404 (active status must not rest on RLS alone)  1343ms

 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
   Start at  05:16:51
   Duration  35.68s (transform 43ms, setup 0ms, collect 116ms, tests 35.44s, environment 0ms, prepare 18ms)

vitest exit: 0

 RUN  v3.2.7 /Users/aravindanrajamani/Desktop/quocoai-pm-ui

stdout | test/pm-file-route.test.ts
[pm-file-route] buildPmKit: 10013 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-dca1 (stored): 3148 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-pdf (stored_pdf): 2775 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-dca2 (stored, P2): 2951 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-dcb (stored, tenant B): 2578 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-pend (pending): 1902 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-fail (failed): 2066 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-rej (rejected): 2283 ms

stdout | test/pm-file-route.test.ts
[pm-file-route] makeDocWithFile f-invpdf (invoice, stored_pdf): 3074 ms

stdout | test/pm-file-route.test.ts > T-FILE (PM removed from the project)
[pm-file-route] removeStoredObjects: 464 ms

stdout | test/pm-file-route.test.ts > T-FILE (PM removed from the project)
[pm-file-route] teardownCaptureKit: 4667 ms

 ✓ test/pm-file-route.test.ts (26 tests | 25 skipped) 37458ms
   ✓ T-FILE-2..n: every refusal is the identical 404 > deactivated PM of the project  1529ms

 Test Files  1 passed (1)
      Tests  1 passed | 25 skipped (26)
   Start at  05:17:30
   Duration  37.70s (transform 44ms, setup 0ms, collect 118ms, tests 37.46s, environment 0ms, prepare 18ms)

vitest exit: 0
```
(s1-green, pinned run header and result, from /tmp/quoco/pr-d-tests.txt:)
```
################ s1-green  2026-11-01T23:48:12Z
HEAD: d5b8a64e3398458e71fe31c933372dac2df01fa3
git status --porcelain (must be empty):
(end porcelain)
 Test Files  1 passed (1)
      Tests  5 passed | 21 skipped (26)
vitest exit: 0
```

## P3 T-NOBUCKET-1: /tmp/quoco/pr-d-nobucket-evidence.txt (full)
```
X3 - T-NOBUCKET-1 (test/pm-bucket-guard.test.ts) evidence. DB-free pure file scans; no test-db call.
Fix commit d5b8a64e3398458e71fe31c933372dac2df01fa3, porcelain empty before and after every control.

GREEN at the fix SHA: unit-pinned-10 = 3 files, 238/238 passed, HEAD d5b8a64e..., porcelain empty (log: /tmp/quoco/pr-d-tests.txt).

Controls (each: HEAD d5b8a64e... before and after; sha256 restored; 5 tests, 2 failed 3 passed unless noted)
 - planted .remove( in signer   : RED  mutated sha256 aad154eff7fa78a2cfde054d741e7d969a2b70063a4ba613db8ff372cbf680ab
 - planted .upload( in signer   : RED  mutated sha256 fdc11b8f8530df74017ea1f0a2b5c42af777fb24877da2a6fbe18dd11ae42174
 - planted .move( in signer     : RED  mutated sha256 ac01d32ec22e4af8d6c08ee57ff01c21b2134f8c8f9039d2f2d1d7afc0cf4d91
 - planted .copy( in signer     : RED  mutated sha256 aa7b8b0a9bdde77e7ef7b8212fde9c94d116ea8f7341c63b32f8727a6de1af04
 - unlisted lib/zz-scratch-bucket-control.ts naming 'capture-documents': RED (1 failed, 4 passed) created sha256 3746df94608f5c3044adadd1f9d444086f89b372528602101929de5ed4c7f68e, removed afterwards
 Signer sha256 before and after every control: 066396e38cd29d86426615c4d19123089363438fc55c2e7179c2b65126731249
Raw logs: /tmp/quoco/pr-d-nb-{remove,upload,move,copy,scratch}.txt
```

## P4 Raw outputs, re-run now

### git diff --stat d5b8a64 5699af6
```
 lib/capture/pm-copy.ts           | 156 +++++++++++++++++++--------------------
 test/pm-d30-shapes.test.tsx      |  22 ++++--
 test/pm-render.test.tsx          |  31 +++++---
 test/pm-strings-approved.test.ts | 150 +++++++++++++++++++++++++++++++++++++
 test/pm-unit.test.ts             |  13 ++--
 5 files changed, 270 insertions(+), 102 deletions(-)
```

### git diff 5699af6^..5699af6 -- lib/capture/pm-copy.ts | grep -E "^[-+].*(export|PM_ERR_MESSAGES|PM_ACK_LABEL)"
```
-export const PM_EMPTY_STATE = '[PM_EMPTY_STATE]' // Tamil owed, NOT approved
-export const PM_NOT_A_PM_STATE = '[PM_NOT_A_PM_STATE]' // Tamil owed, NOT approved
-export const PM_LOAD_ERROR = '[PM_LOAD_ERROR]' // Tamil owed, NOT approved
-export const PM_BACK_TO_LIST = '[PM_BACK_TO_LIST]' // Tamil owed, NOT approved
-export const PM_LIST_TRUNCATED = '[PM_LIST_TRUNCATED]' // Tamil owed, NOT approved (shown when more than PM_LIST_LIMIT deliveries exist)
+export const PM_EMPTY_STATE = 'No deliveries yet. They appear here when a site engineer sends a DC or invoice on WhatsApp.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_NOT_A_PM_STATE = 'You are not a PM on any project, so there is nothing to show here.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LOAD_ERROR = 'This page could not load. Refresh to try again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_BACK_TO_LIST = 'Back to Material Inward' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LIST_TRUNCATED = 'Showing the latest 100 deliveries. Open ones are listed first.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_STATUS_INCOMPLETE = '[PM_STATUS_INCOMPLETE]' // Tamil owed, NOT approved
-export const PM_STATUS_AWAITING_PM = '[PM_STATUS_AWAITING_PM]' // Tamil owed, NOT approved
-export const PM_STATUS_APPROVED = '[PM_STATUS_APPROVED]' // Tamil owed, NOT approved
-export const PM_STATUS_REJECTED = '[PM_STATUS_REJECTED]' // Tamil owed, NOT approved
-export const PM_STATUS_CANCELLED = '[PM_STATUS_CANCELLED]' // Tamil owed, NOT approved
+export const PM_STATUS_INCOMPLETE = 'Details needed' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_STATUS_AWAITING_PM = 'Waiting for approval' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_STATUS_APPROVED = 'Approved' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_STATUS_REJECTED = 'Rejected' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_STATUS_CANCELLED = 'Cancelled' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_TYPE_SUPPLIER = '[PM_TYPE_SUPPLIER]' // Tamil owed, NOT approved
-export const PM_TYPE_INTERNAL_TRANSFER = '[PM_TYPE_INTERNAL_TRANSFER]' // Tamil owed, NOT approved
-export const PM_TYPE_NOT_SET = '[PM_TYPE_NOT_SET]' // Tamil owed, NOT approved
+export const PM_TYPE_SUPPLIER = 'Supplier' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_TYPE_INTERNAL_TRANSFER = 'Internal GRN (from another site)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_TYPE_NOT_SET = 'Type not set' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_KIND_DC = '[PM_KIND_DC]' // Tamil owed, NOT approved
-export const PM_KIND_INVOICE = '[PM_KIND_INVOICE]' // Tamil owed, NOT approved
+export const PM_KIND_DC = 'DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_KIND_INVOICE = 'Invoice' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_ACK_INVOICE_YES = '[PM_ACK_INVOICE_YES]' // Tamil owed, NOT approved
-export const PM_ACK_INVOICE_NO = '[PM_ACK_INVOICE_NO]' // Tamil owed, NOT approved
-export const PM_ACK_INVOICE_PARTIAL = '[PM_ACK_INVOICE_PARTIAL]' // Tamil owed, NOT approved
-export const PM_ACK_INVOICE_UNCLEAR = '[PM_ACK_INVOICE_UNCLEAR]' // OPEN (Aravind undecided); Tamil owed, NOT approved
-export const PM_ACK_DC_YES = '[PM_ACK_DC_YES]' // Tamil owed, NOT approved
-export const PM_ACK_DC_NO = '[PM_ACK_DC_NO]' // Tamil owed, NOT approved
-export const PM_ACK_DC_PARTIAL = '[PM_ACK_DC_PARTIAL]' // Tamil owed, NOT approved
-export const PM_ACK_DC_UNCLEAR = '[PM_ACK_DC_UNCLEAR]' // OPEN (Aravind undecided); Tamil owed, NOT approved
-export const PM_ACK_NONE = '[PM_ACK_NONE]' // Tamil owed, NOT approved
+export const PM_ACK_INVOICE_YES = 'Matches' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_INVOICE_NO = 'Does not match' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_INVOICE_PARTIAL = 'Partly matches' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_INVOICE_UNCLEAR = 'Answer unclear. Check the invoice with the engineer before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_DC_YES = 'All arrived' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_DC_NO = 'Not arrived' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_DC_PARTIAL = 'Part arrived' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_DC_UNCLEAR = 'Answer unclear. Confirm with the engineer before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACK_NONE = 'No answer yet' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_LABEL_CREATED_FROM_INVOICE = '[PM_LABEL_CREATED_FROM_INVOICE]' // Tamil owed, NOT approved
-export const PM_LABEL_CANCELLED_REASON = '[PM_LABEL_CANCELLED_REASON]' // Tamil owed, NOT approved
-export const PM_LABEL_INVOICE_EXPECTED = '[PM_LABEL_INVOICE_EXPECTED]' // Tamil owed, NOT approved
-export const PM_LABEL_INVOICE_EXPECTED_DAYS = '[PM_LABEL_INVOICE_EXPECTED_DAYS]' // Tamil owed, NOT approved
-export const PM_INVOICES_HEADING = '[PM_INVOICES_HEADING]' // Tamil owed, NOT approved
-export const PM_LINKED_DELIVERIES_HEADING = '[PM_LINKED_DELIVERIES_HEADING]' // Tamil owed, NOT approved
-export const PM_LINK_SELECT_INVOICE = '[PM_LINK_SELECT_INVOICE]' // Tamil owed, NOT approved
-export const PM_LINK_SELECT_DELIVERIES = '[PM_LINK_SELECT_DELIVERIES]' // Tamil owed, NOT approved
-export const PM_LINK_NO_CANDIDATES = '[PM_LINK_NO_CANDIDATES]' // Tamil owed, NOT approved
+export const PM_LABEL_CREATED_FROM_INVOICE = 'From invoice (no DC)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_CANCELLED_REASON = 'Replaced by a linked DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_INVOICE_EXPECTED = 'Invoice expected' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_INVOICE_EXPECTED_DAYS = 'Invoice expected for {n} days' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_INVOICES_HEADING = 'Linked invoices' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LINKED_DELIVERIES_HEADING = 'Linked DCs' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LINK_SELECT_INVOICE = 'Choose the invoice for this DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LINK_SELECT_DELIVERIES = 'Choose the DCs this invoice covers (up to 20)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LINK_NO_CANDIDATES = 'Nothing to link right now.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_FIELD_TYPE = '[PM_FIELD_TYPE]' // Tamil owed, NOT approved
-export const PM_FIELD_VEHICLE = '[PM_FIELD_VEHICLE]' // Tamil owed, NOT approved
-export const PM_FIELD_DC_NUMBER = '[PM_FIELD_DC_NUMBER]' // Tamil owed, NOT approved
-export const PM_FIELD_DC_DATE = '[PM_FIELD_DC_DATE]' // Tamil owed, NOT approved
-export const PM_FIELD_REJECT_REASON = '[PM_FIELD_REJECT_REASON]' // Tamil owed, NOT approved
-export const PM_FIELD_RECEIVED = '[PM_FIELD_RECEIVED]' // Tamil owed, NOT approved
-export const PM_FIELD_ENGINEER = '[PM_FIELD_ENGINEER]' // Tamil owed, NOT approved
-export const PM_FIELD_ACK = '[PM_FIELD_ACK]' // Tamil owed, NOT approved
-export const PM_FIELD_ACK_NOTE = '[PM_FIELD_ACK_NOTE]' // Tamil owed, NOT approved
-export const PM_FIELD_FILES = '[PM_FIELD_FILES]' // Tamil owed, NOT approved
-export const PM_FIELD_PROJECT = '[PM_FIELD_PROJECT]' // Tamil owed, NOT approved
+export const PM_FIELD_TYPE = 'Delivery type' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_VEHICLE = 'Vehicle no.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_DC_NUMBER = 'DC no.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_DC_DATE = 'DC date' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_REJECT_REASON = 'Reason for rejecting' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_RECEIVED = 'Received' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_ENGINEER = 'Site engineer' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_ACK = 'Engineer\'s answer' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_ACK_NOTE = 'Engineer\'s note' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_FILES = 'Files' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FIELD_PROJECT = 'Project' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_LABEL_PDF_NOT_PREVIEWABLE = '[PM_LABEL_PDF_NOT_PREVIEWABLE]' // Tamil owed, NOT approved
-export const PM_LABEL_FILE_REJECTED_TYPE = '[PM_LABEL_FILE_REJECTED_TYPE]' // Tamil owed, NOT approved
-export const PM_LABEL_FILE_REJECTED_SIZE = '[PM_LABEL_FILE_REJECTED_SIZE]' // Tamil owed, NOT approved
-export const PM_LABEL_FILE_PENDING = '[PM_LABEL_FILE_PENDING]' // Tamil owed, NOT approved
+export const PM_LABEL_PDF_NOT_PREVIEWABLE = 'Locked or damaged PDF. Download it to view.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_FILE_REJECTED_TYPE = 'Not kept. Only PDF, JPEG, PNG and WEBP files are accepted.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_FILE_REJECTED_SIZE = 'Not kept. The file is larger than 16 MB.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_FILE_PENDING = 'Receiving file' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_LABEL_FILE_PENDING_TIMEOUT = '[PM_LABEL_FILE_PENDING_TIMEOUT]' // Tamil owed, NOT approved
-export const PM_LABEL_FILE_FAILED = '[PM_LABEL_FILE_FAILED]' // Tamil owed, NOT approved
-export const PM_FILE_UNAVAILABLE = '[PM_FILE_UNAVAILABLE]' // Tamil owed, NOT approved
-export const PM_FILE_OPEN = '[PM_FILE_OPEN]' // Tamil owed, NOT approved
-export const PM_FILE_DOWNLOAD = '[PM_FILE_DOWNLOAD]' // Tamil owed, NOT approved
+export const PM_LABEL_FILE_PENDING_TIMEOUT = 'Not received yet. It may still arrive.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_LABEL_FILE_FAILED = 'Could not save this file yet. If it does not appear soon, ask the engineer to send it again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FILE_UNAVAILABLE = 'This file cannot be opened right now. Try again in a minute.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FILE_OPEN = 'Open' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_FILE_DOWNLOAD = 'Download' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_ACTION_APPROVE = '[PM_ACTION_APPROVE]' // Tamil owed, NOT approved
-export const PM_ACTION_REJECT = '[PM_ACTION_REJECT]' // Tamil owed, NOT approved
-export const PM_ACTION_LINK_INVOICE = '[PM_ACTION_LINK_INVOICE]' // Tamil owed, NOT approved
-export const PM_ACTION_UNLINK = '[PM_ACTION_UNLINK]' // Tamil owed, NOT approved
-export const PM_ACTION_SAVE_DETAILS = '[PM_ACTION_SAVE_DETAILS]' // Tamil owed, NOT approved
-export const PM_CONFIRM_REJECT = '[PM_CONFIRM_REJECT]' // Tamil owed, NOT approved
-export const PM_CONFIRM_UNLINK = '[PM_CONFIRM_UNLINK]' // Tamil owed, NOT approved
-export const PM_PENDING_ACTION = '[PM_PENDING_ACTION]' // Tamil owed, NOT approved
+export const PM_ACTION_APPROVE = 'Approve' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACTION_REJECT = 'Reject' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACTION_LINK_INVOICE = 'Link invoice' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACTION_UNLINK = 'Unlink' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ACTION_SAVE_DETAILS = 'Save details' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_CONFIRM_REJECT = 'Confirm reject. This cannot be undone.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_CONFIRM_UNLINK = 'Confirm unlink' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_PENDING_ACTION = 'Saving…' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_WARN_APPROVE_NO_FILE = '[PM_WARN_APPROVE_NO_FILE]' // Tamil owed, NOT approved
+export const PM_WARN_APPROVE_NO_FILE = 'No readable file is attached. Check the material before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_ERR_NOT_AVAILABLE = '[PM_ERR_NOT_AVAILABLE]' // Tamil owed, NOT approved
-export const PM_ERR_STATE_CHANGED = '[PM_ERR_STATE_CHANGED]' // Tamil owed, NOT approved
-export const PM_ERR_LINK_AUTO_APPROVED = '[PM_ERR_LINK_AUTO_APPROVED]' // Tamil owed, NOT approved
-export const PM_ERR_ALREADY_UNLINKED = '[PM_ERR_ALREADY_UNLINKED]' // Tamil owed, NOT approved
-export const PM_ERR_TYPE_REQUIRED = '[PM_ERR_TYPE_REQUIRED]' // Tamil owed, NOT approved
-export const PM_ERR_REJECT_REASON = '[PM_ERR_REJECT_REASON]' // Tamil owed, NOT approved
-export const PM_ERR_INVALID_INPUT = '[PM_ERR_INVALID_INPUT]' // Tamil owed, NOT approved
-export const PM_ERR_ALREADY_LINKED = '[PM_ERR_ALREADY_LINKED]' // Tamil owed, NOT approved
-export const PM_ERR_SELF_LINK_FIXED = '[PM_ERR_SELF_LINK_FIXED]' // Tamil owed, NOT approved
-export const PM_ERR_RETYPE_LINKED = '[PM_ERR_RETYPE_LINKED]' // Tamil owed, NOT approved
-export const PM_ERR_RETYPE_AUTOMATIC = '[PM_ERR_RETYPE_AUTOMATIC]' // Tamil owed, NOT approved
-export const PM_ERR_LINK_TARGET_INELIGIBLE = '[PM_ERR_LINK_TARGET_INELIGIBLE]' // Tamil owed, NOT approved
-export const PM_ERR_SAVE_FAILED = '[PM_ERR_SAVE_FAILED]' // Tamil owed, NOT approved
+export const PM_ERR_NOT_AVAILABLE = 'This delivery is not available to you.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_STATE_CHANGED = 'Someone changed this delivery before you. The page now shows the latest version.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_LINK_AUTO_APPROVED = 'This invoice is already approved on its own, so it cannot be linked to a DC.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_ALREADY_UNLINKED = 'This link was already removed.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_TYPE_REQUIRED = 'Set the delivery type before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_REJECT_REASON = 'Write a reason for rejecting, up to 1000 characters.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_INVALID_INPUT = 'Some details are not valid. Check them and try again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_ALREADY_LINKED = 'This DC already has an invoice linked.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_SELF_LINK_FIXED = 'An invoice\'s link to its own delivery cannot be removed.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_RETYPE_LINKED = 'Unlink the invoice before you change this to an internal GRN.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_RETYPE_AUTOMATIC = 'A delivery created from an invoice cannot be an internal GRN.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_LINK_TARGET_INELIGIBLE = 'This DC cannot take an invoice. It is an internal GRN, created from an invoice, or rejected.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+export const PM_ERR_SAVE_FAILED = 'Something went wrong and nothing was saved. Try again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
```
Counts: 75 '-' lines, 75 '+' lines. Every line is a 'export const PM_... = ...' value line (none is a PM_ERR_MESSAGES / PM_ACK_LABEL line):
```
lines that are NOT plain "export const PM_X = " value lines: 0
```

### git diff --stat 5699af6 92936dc
```
 test/helpers/auth-user-teardown.ts           | 21 +++++++++++++++++++++
 test/login-otp.test.ts                       |  8 ++++++--
 test/photo-access-boundary-agreement.test.ts | 19 +++++++++++++++++++
 test/photo-access-route.test.ts              | 19 +++++++++++++++++++
 4 files changed, 65 insertions(+), 2 deletions(-)
```

### git diff --name-only 5699af6 92936dc | grep -E "^(test/capture-handler\.test\.ts|lib/capture/|app/api/capture-files/|lib/media/capture-ingest\.ts|supabase/)"
```
(none)
```

### git diff --stat 92936dc b92fabd
```
 components/material-inward/delivery-row.tsx |  8 +--
 components/material-inward/detail-view.tsx  |  8 +--
 components/material-inward/labels.ts        | 13 +++++
 docs/plans/pr-d-plan.md                     |  7 +++
 docs/plans/pr-d1-strings-approved.md        | 84 ++++++++++++++++++++++++++++
 lib/capture/pm-copy.ts                      |  7 ++-
 test/pm-render.test.tsx                     | 86 +++++++++++++++++++++++++++++
 test/pm-strings-approved.test.ts            |  2 +-
 8 files changed, 199 insertions(+), 16 deletions(-)
```

### git diff 92936dc b92fabd -- lib/capture/pm-copy.ts
```
diff --git a/lib/capture/pm-copy.ts b/lib/capture/pm-copy.ts
index b1f6351..a31a25d 100644
--- a/lib/capture/pm-copy.ts
+++ b/lib/capture/pm-copy.ts
@@ -1,6 +1,6 @@
 // PR-D (PM page "Material Inward"). EVERY user-facing string of this page is a named constant here and nowhere
-// else. English wording approved by Aravind on 2 Nov (docs: claude/2026-11-02-pr-d1-strings-approved.md). Tamil is
-// owed and NOT approved. PM_LABEL_INVOICE_EXPECTED_DAYS holds a literal {n} for the day count (see the PR notes).
+// else. English wording approved by Aravind on 2 Nov (docs/plans/pr-d1-strings-approved.md). Tamil is owed and NOT
+// approved. PM_LABEL_INVOICE_EXPECTED_DAYS holds a literal {n} for the day count (rendered only when n >= 2).
 //
 // Constraints any final wording must meet (rules, not text):
 //   * Ack labels are separate per document type. Invoice ack: matches / does not match / partly matches.
@@ -68,7 +68,8 @@ export const PM_ACK_LABEL: Record<PmDocKind, Record<PmAck, string>> = {
 export const PM_LABEL_CREATED_FROM_INVOICE = 'From invoice (no DC)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LABEL_CANCELLED_REASON = 'Replaced by a linked DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LABEL_INVOICE_EXPECTED = 'Invoice expected' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_LABEL_INVOICE_EXPECTED_DAYS = 'Invoice expected for {n} days' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+// {n} is the day count; components/material-inward/labels.ts (invoiceWaitLabel) substitutes it and renders this ONLY when n >= 2.
+export const PM_LABEL_INVOICE_EXPECTED_DAYS = 'Invoice pending for {n} days' // English approved (Aravind, 2 Nov; changed from "expected for" the same day). Tamil owed, NOT approved.
 export const PM_INVOICES_HEADING = 'Linked invoices' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LINKED_DELIVERIES_HEADING = 'Linked DCs' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LINK_SELECT_INVOICE = 'Choose the invoice for this DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
```

## P5 /tmp/quoco/pr-d-round3-render.txt (full)
```
PR-D1 round 3: render fix, raw. Branch pr-d-material-inward, render SHA b92fabd6b6561b30798bc464e5c2259daa1b4cbb.
Report only: no code change, commit, push or test-db call was made to produce this file.

================ R1  A1: what the invoice day count n measures
lib/capture/pm-queries.ts:52-57  istDaysSince(deliveryDate, now): whole IST calendar days from a delivery_date ('YYYY-MM-DD') to today in IST, Math.max(0, ...).
  53: export function istDaysSince(deliveryDate: string, now: Date): number {
  56:   return Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000))
Timestamp: deliveries.delivery_date, which is a GENERATED column = timezone('Asia/Kolkata', received_at)::date
  supabase/migrations/049_capture_tables.sql:354  delivery_date date GENERATED ALWAYS AS (timezone('Asia/Kolkata', received_at)::date) STORED
  so n counts IST calendar days from the IST date the DC was received (received_at), not 24-hour elapsed time.
Where it is set:
  list    lib/capture/pm-queries.ts:216  invoiceExpectedDays: isDc && open && !linked.has(r.id) && r.delivery_date ? istDaysSince(r.delivery_date, now) : null
            isDc = dc_document_id !== null (:199); open = status not rejected/cancelled (:200); linked = delivery_invoice_links rows with unlinked_at IS NULL (:174-179,190)
  detail  lib/capture/pm-queries.ts:458-459,503  mine = activeLinks[0]; open = status not rejected/cancelled; line 503: if (open && !mine && d.delivery_date) detail.invoiceExpectedDays = istDaysSince(d.delivery_date, now)
  everywhere else null (invoice page, linked DC, rejected/cancelled DC).
Consequence: n = whole IST calendar days since the DC was received, while no invoice is linked. It also shows on an APPROVED DC that still has no invoice (open here means not rejected/cancelled).
Render (b92fabd): components/material-inward/labels.ts invoiceWaitLabel(n); used at delivery-row.tsx and detail-view.tsx.

================ R2  H2 render tests, n=1 and n=7, list row and detail view
Source: re-run of test/pm-render.test.tsx only, -t H2, --reporter=verbose (log /tmp/quoco/pr-d-round3-h2-verbose.txt), HEAD b92fabd6b6561b30798bc464e5c2259daa1b4cbb, porcelain bytes:        0
NOTE: '-t H2' also matches an older, unrelated 'H2: a caption that is a file name...' describe (8 tests); only the day-count rows are the subject here.
The test asserts the rendered line EQUALS the literal string (toBe); the markup itself is not printed by a passing test.
These are the passing rows (the asserted strings are in the titles):
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row, n=7: exactly "Invoice pending for 7 days" and nothing else on the line 1ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row, n=2: the day-count line (the first n that shows a count) 1ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row, n=1: exactly "Invoice expected", no count 0ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row, n=0: exactly "Invoice expected", no count 0ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row: no "{n}" anywhere and the label never appears twice, for n = 0, 1, 2, 7 2ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view, n=7: exactly "Invoice pending for 7 days" and nothing else on the line 2ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view, n=2: the day-count line (the first n that shows a count) 1ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view, n=1: exactly "Invoice expected", no count 1ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view, n=0: exactly "Invoice expected", no count 1ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view: no "{n}" anywhere and the label never appears twice, for n = 0, 1, 2, 7 3ms
✓ test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > a DC with no day count (an invoice is linked, or it is not a DC) renders no wait line at all 0ms
 Test Files  1 passed (1)
      Tests  19 passed | 31 skipped (50)
vitest exit: 0

What the OLD concatenation rendered (verbatim 'Received:' lines from the RED control run, /tmp/quoco/pr-d-control-h2-concat-vitest.txt), for contrast:
Expected: "Invoice pending for 7 days"
Received: "Invoice expected Invoice pending for {n} days 7"
Expected: "Invoice pending for 2 days"
Received: "Invoice expected Invoice pending for {n} days 2"
Expected: "Invoice expected"
Received: "Invoice expected Invoice pending for {n} days 1"
Expected: "Invoice expected"
Received: "Invoice expected Invoice pending for {n} days 0"

================ R3  H2 positive control (restore the old concatenation in invoiceWaitLabel): from /tmp/quoco/pr-d-controls.txt
################ CONTROL h2-concat  2026-11-01T23:42:03Z
HEAD: b92fabd6b6561b30798bc464e5c2259daa1b4cbb
porcelain before: empty
sha256 components/material-inward/labels.ts BEFORE:  5b9aa995dbea76b1a0806c88df99c510380c86b1f4439eedf54fe43a2adc0fbb
sha256 components/material-inward/labels.ts MUTATED: f1c07c827afade5e5c01efd4e4221a03b89e6a978fc4ca1999cad1f9f30aa77a
mutation present: 35:  return `${PM_LABEL_INVOICE_EXPECTED} ${PM_LABEL_INVOICE_EXPECTED_DAYS} ${n}`
vitest exit code: 1   (raw: /tmp/quoco/pr-d-control-h2-concat-vitest.txt)
 FAIL  test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row, n=7: exactly "Invoice pending for 7 days" and nothing else on the line
 FAIL  test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view, n=7: exactly "Invoice pending for 7 days" and nothing else on the line
 FAIL  test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > list row, n=2: the day-count line (the first n that shows a count)
 FAIL  test/pm-render.test.tsx > H2: the invoice-pending day count (list row and detail view) > detail view, n=2: the day-count line (the first n that shows a count)
sha256 components/material-inward/labels.ts AFTER:   5b9aa995dbea76b1a0806c88df99c510380c86b1f4439eedf54fe43a2adc0fbb  (before: 5b9aa995dbea76b1a0806c88df99c510380c86b1f4439eedf54fe43a2adc0fbb)
HEAD after: b92fabd6b6561b30798bc464e5c2259daa1b4cbb
porcelain after revert: [] (must be empty)
RESULT h2-concat: RED (exit 1)
(all RED test names, uncut:)
 FAIL  test/pm-render.test.tsx
     > list row, n=7: exactly "Invoice pending for 7 days" and nothing else on the line
 FAIL  test/pm-render.test.tsx
     > detail view, n=7: exactly "Invoice pending for 7 days" and nothing else on the line
 FAIL  test/pm-render.test.tsx
     > list row, n=2: the day-count line (the first n that shows a count)
 FAIL  test/pm-render.test.tsx
     > detail view, n=2: the day-count line (the first n that shows a count)
 FAIL  test/pm-render.test.tsx
     > list row, n=1: exactly "Invoice expected", no count
 FAIL  test/pm-render.test.tsx
     > detail view, n=1: exactly "Invoice expected", no count
 FAIL  test/pm-render.test.tsx
     > list row, n=0: exactly "Invoice expected", no count
 FAIL  test/pm-render.test.tsx
     > detail view, n=0: exactly "Invoice expected", no count
 FAIL  test/pm-render.test.tsx
     > list row: no "{n}" anywhere and the label never appears twice, for n = 0, 1, 2, 7
 FAIL  test/pm-render.test.tsx
     > detail view: no "{n}" anywhere and the label never appears twice, for n = 0, 1, 2, 7

================ R4  git diff --stat 92936dc b92fabd
 components/material-inward/delivery-row.tsx |  8 +--
 components/material-inward/detail-view.tsx  |  8 +--
 components/material-inward/labels.ts        | 13 +++++
 docs/plans/pr-d-plan.md                     |  7 +++
 docs/plans/pr-d1-strings-approved.md        | 84 ++++++++++++++++++++++++++++
 lib/capture/pm-copy.ts                      |  7 ++-
 test/pm-render.test.tsx                     | 86 +++++++++++++++++++++++++++++
 test/pm-strings-approved.test.ts            |  2 +-
 8 files changed, 199 insertions(+), 16 deletions(-)

git diff 92936dc b92fabd -- lib/capture/pm-copy.ts
diff --git a/lib/capture/pm-copy.ts b/lib/capture/pm-copy.ts
index b1f6351..a31a25d 100644
--- a/lib/capture/pm-copy.ts
+++ b/lib/capture/pm-copy.ts
@@ -1,6 +1,6 @@
 // PR-D (PM page "Material Inward"). EVERY user-facing string of this page is a named constant here and nowhere
-// else. English wording approved by Aravind on 2 Nov (docs: claude/2026-11-02-pr-d1-strings-approved.md). Tamil is
-// owed and NOT approved. PM_LABEL_INVOICE_EXPECTED_DAYS holds a literal {n} for the day count (see the PR notes).
+// else. English wording approved by Aravind on 2 Nov (docs/plans/pr-d1-strings-approved.md). Tamil is owed and NOT
+// approved. PM_LABEL_INVOICE_EXPECTED_DAYS holds a literal {n} for the day count (rendered only when n >= 2).
 //
 // Constraints any final wording must meet (rules, not text):
 //   * Ack labels are separate per document type. Invoice ack: matches / does not match / partly matches.
@@ -68,7 +68,8 @@ export const PM_ACK_LABEL: Record<PmDocKind, Record<PmAck, string>> = {
 export const PM_LABEL_CREATED_FROM_INVOICE = 'From invoice (no DC)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LABEL_CANCELLED_REASON = 'Replaced by a linked DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LABEL_INVOICE_EXPECTED = 'Invoice expected' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
-export const PM_LABEL_INVOICE_EXPECTED_DAYS = 'Invoice expected for {n} days' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
+// {n} is the day count; components/material-inward/labels.ts (invoiceWaitLabel) substitutes it and renders this ONLY when n >= 2.
+export const PM_LABEL_INVOICE_EXPECTED_DAYS = 'Invoice pending for {n} days' // English approved (Aravind, 2 Nov; changed from "expected for" the same day). Tamil owed, NOT approved.
 export const PM_INVOICES_HEADING = 'Linked invoices' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LINKED_DELIVERIES_HEADING = 'Linked DCs' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
 export const PM_LINK_SELECT_INVOICE = 'Choose the invoice for this DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

================ R5  at b92fabd
unit-pinned-12 (log /tmp/quoco/pr-d1-unit-12.txt):
################ unit-pinned-12  2026-11-01T23:42:16Z
HEAD: b92fabd6b6561b30798bc464e5c2259daa1b4cbb
git status --porcelain (must be empty):
(end porcelain)
 ✓ test/pm-render.test.tsx (50 tests) 41ms
 ✓ test/pm-unit.test.ts (195 tests) 19ms
 ✓ test/pm-bucket-guard.test.ts (5 tests) 17ms
 ✓ test/pm-strings-approved.test.ts (83 tests) 4ms
 Test Files  4 passed (4)
      Tests  333 passed (333)
vitest exit: 0

tsc (re-run at b92fabd, porcelain empty): tsc exit: 0
lint (re-run at b92fabd): lint exit: 0; summary line: ✖ 317 problems (0 errors, 317 warnings); errors in material-inward/pm-copy/pm-render/pm-strings: none
build (re-run at b92fabd): ✓ Compiled successfully in 3.4s; build exit: 0

HEAD at end: b92fabd6b6561b30798bc464e5c2259daa1b4cbb; git status --porcelain bytes:        0 (0 = empty)
```

## P6 CI of record, as pasted by Aravind
```
run https://github.com/ara-2789/Quoco/actions/runs/41364145241
{"conclusion":"success","headSha":"b92fabd6b6561b30798bc464e5c2259daa1b4cbb","status":"completed"}
Test Files 164 passed (164); Tests 2697 passed | 7 skipped | 1 todo (2705)
✓ T-CONC-1 (CI-only) > two PMs approving the same delivery at once: exactly one wins, the other gets STATE_CHANGED 4598ms
```
headSha equals HEAD at build: yes

## P7 G2 and G3, last gated run (2 Nov, after Aravind's go)
### pm-file-route-8 (from /tmp/quoco/pr-d-tests.txt)
```
################ pm-file-route-8  2026-11-01T23:49:06Z
HEAD: b92fabd6b6561b30798bc464e5c2259daa1b4cbb
git status --porcelain (must be empty):
(end porcelain)
 Test Files  1 passed (1)
      Tests  26 passed (26)
vitest exit: 0
```
### pm-d30-shapes-3 (from /tmp/quoco/pr-d-tests.txt)
```
################ pm-d30-shapes-3  2026-11-01T23:50:30Z
HEAD: b92fabd6b6561b30798bc464e5c2259daa1b4cbb
git status --porcelain (must be empty):
(end porcelain)
 Test Files  1 passed (1)
      Tests  11 passed (11)
vitest exit: 0
```
### G3 residue check (/tmp/quoco/pr-d-g3-residue.txt)
```
target project ref: exfccwlrhoutkgrlikod (equals the guard allowlist)

TENANTS still present for file tags pmq / pma / pmf / pmd3 / c4a-handler: 0

ROWS BY THIS RUN'S TENANT IDS (expected 0 each):
  users                    0
  projects                 0
  project_members          0
  capture_documents        0
  capture_files            0
  deliveries               0
  delivery_invoice_links   0
  outbound_sends           0

MARKER ROWS (prefix ZZTestCapture-, ANY run tag; D-30 or other sessions could also be present):
  tenants.name               4
  users.full_name            4
  projects.name              6
  capture_documents.sid      51
  capture_files.sid          69
  processed_messages.sid     154

STORAGE: objects in bucket capture-documents under this run's tenant prefixes (expected 0):
  (no tenants left, so nothing to list by prefix)

AUTH USERS created since 2026-10-31T07:10:00Z with the run-scoped email shape zz-test-<hex>@quoco.test:
  matching: 0 (of 17 auth users scanned)
```
### G3 bucket listing (/tmp/quoco/pr-d-g3-bucket.txt)
```
bucket capture-documents, objects created since 2026-11-01T23:40:00Z (target ref exfccwlrhoutkgrlikod)
objects in bucket (all times): 31
objects created since 2026-11-01T23:40:00Z: 0
```
