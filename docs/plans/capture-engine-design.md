# Capture engine — design record (2026-10-01)

Status: DESIGN ONLY. Nothing built. Decisions below are per Aravind, 2026-10-01, in a
design-review session; they are recorded, not observed in code.

## What it is
One shared WhatsApp flow mechanism for menu items that capture a paper document:
photo, then one or two short questions, each answer saved as it arrives, and printed
documents read in the background. Each menu item is a configuration on top of it.

## Kinds and build order (D3)
1. Item 4 — Material received (FIRST, the only kind implemented in slice 1)
   - Photo of the challan (required).
   - Short description: what came and how much (e.g. "cement 50 bags, steel 2 ton").
2. Item 3 — Site expense (second)
   - Photo of the receipt; what it was for; amount; confirmation echo of the amount,
     as already required by adhoc-menu-spec.md §c item 3.
3. Item 5 — Invoice (third; later matched to deliveries, so item 4 must exist first)
   - Photo of the invoice; total amount; supplier. Never line items by hand.
The engine is designed on paper for all three; only item 4 is implemented first.

## D1 — Save as you go; check-ins still fire on time
- Every answer and photo is written when it arrives. A report exists, status incomplete,
  from the first thing the engineer sends.
- A scheduled check-in arriving mid-report runs on time. The partial report stays saved
  and is shown to the PM as incomplete. No engineer input is ever discarded.
- Rejected: holding the check-in until the report finishes.
- Relationship to migration 038 ("scheduled triggers always win", hindrance discarded):
  038 still governs the hindrance flow today. Making hindrance save-as-you-go is a
  separate, queued FULL-tier item, not part of this design.

## D2 — Engineer always states it; machine reads printed documents
- The engineer's typed answers are short by design (about 10 seconds), regardless of
  document length.
- Printed documents: read by Claude in a background job (never in the webhook), into
  fields marked unconfirmed, with a confidence value.
- Handwritten documents: reading is best-effort and low-confidence; not a priority.
  The photo is the record.
- PM sees the engineer's statement and the machine reading side by side; mismatches
  are flagged. Only PM-confirmed values count as facts (invoice matching; the owner report
  only if O2 decides that deliveries appear there).
- Phase 2, not slice 1: engineer confirms the machine reading on WhatsApp. Requires a
  job-initiated free-form WhatsApp message; none exists today (only template sends —
  probe 2026-10-01, capture-ocr-probe §E). Note: docs/design-principles.md Rule 3.9
  (Fast-Follow) describes engineer confirmation; this design defers it to phase 2.
  Rule 3.9 is NOT edited by this change — flagged for Aravind.

## Constraints carried into any build
- New tables hold company data and money: FULL tier. Composite same-tenant foreign keys
  from day one (precedent: 038 STEP 0 for hindrances).
- The existing `invoices` table needs a FULL-tier hardening migration before item 5 uses
  it: plain single-column FKs (no same-tenant pairing check) and tenant-wide
  insert/update policies for authenticated users (001_core_schema.sql:155-177,
  002_rls_policies.sql:224-243). `vendor_invoices` is a separate table and is not used.
- Partial reports must be valid rows from the first answer (no constraint that only a
  completed report can satisfy ~~— the reason 038 could not save partial hindrances~~). CORRECTED 2026-10-05: the rule stands. 038 discarded partial hindrances by design (038:123-142), not because of a constraint.
- Photos follow the existing ingest pattern to Supabase Storage; never a Twilio URL.
- All Claude calls run in the jobs queue.
- Accuracy test set: 15-20 real challans/invoices, stored OUTSIDE the repo (real
  supplier names, GST numbers and amounts are third-party data).
- Every engineer-facing and PM-facing string is a named constant marked
  "Tamil owed, NOT approved" and comes to Aravind for approval. No wording is decided here.

## Preconditions before item 4 is switched on for engineers
- A PM-facing Deliveries page exists (photo, engineer statement, machine reading,
  confirm/correct). Same rule as adhoc-menu-spec.md point 10 (item 3 cut 2026-09-03:
  no item ships without a reader). Pending Aravind's confirmation with his cofounder.
- The stale-session fix (branch fix/stale-flow-next-day) is merged.

## Unverified at time of writing
The statements below came from probes or earlier documents during the 2026-10-01 design
session. They were NOT re-checked when this record was written. Verify each against main
before any build relies on it.
- `invoices` table: plain single-column FKs and tenant-wide insert/update policies, at
  001_core_schema.sql:155-177 and 002_rls_policies.sql:224-243.
- No job-initiated free-form WhatsApp message exists today, only template sends
  (capture-ocr-probe §E).
- docs/design-principles.md Rule 3.9 (Fast-Follow) describes engineer confirmation.
- inbound-start.ts classifyAdhocInput: digits '3'-'7' reply "not available yet".
- Branch fix/stale-flow-next-day exists and contains the stale-session fix.
- Whether the §28(aa)(1) media blocker is fully cleared.
- adhoc-menu-spec.md §c item 3 already requires a confirmation echo of the amount.
- Item 3 was cut on 2026-09-03 under spec point 10.
- ~~038 could not save partial hindrances because of a completed-report-only constraint.~~ CORRECTED 2026-10-05: cause contradicted, see "Block A findings, 2026-10-05".

## Answers and decisions, 2026-10-04
Recorded from a design-review session. Per Aravind, not observed in code.
- O1 answered: the engineer reports both rates and quantities.
- O2 answered: summaries of delivered items and site documents appear in the owner's
  nightly report.
- O4 answered: about 60% handwritten, 40% printed. Machine reading is a must.
  See O14.
- O5 answered: photos are kept for the duration of the project. See O9.
- The DC is the vendor's document: what the vendor says was sent. The GRN (goods receipt
  note) is the engineer's acknowledgment of what arrived. The engineer reports both.
- The GRN is the WhatsApp record, stamped with the site engineer's name. No paper GRN.
- A GRN becomes the record for the owner only after the PM approves it. Unapproved GRNs
  do not count. This is consistent with D2.

### Proposed, NOT agreed
Recorded so they are not lost. None of these is a decision until Aravind confirms it.
- P1: One menu entry, proposed wording "What are you uploading today?", with sub-types
  DC / invoice / GRN, in place of separate items 4 and 5. Pending Aravind (O3). The
  wording is a proposal, not an approved string. If adopted, D3's build order needs
  revisiting.
- P2: The delivery is the anchor. DC, GRN and invoice attach to it in any order. A DC
  received on WhatsApp before the truck opens an "expected" delivery. The engineer's GRN
  attaches to it on arrival.
- P3: The bot echoes the rate back for the engineer to confirm, as item 3 does for
  amounts.
- P4: A DC with no GRN after a set time shows to the PM as sent but not acknowledged.

### New open items
- O8: Menu numbering if items 4 and 5 merge. The spec says row numbers are never reused
  or renumbered. What happens to digit 5?
- O9: What event ends "the duration of the project" for photo retention?
- O10: Does adding deliveries to the owner's nightly report need a WhatsApp template
  change and Meta approval? Not checked.
- O11: Does the inbound pipeline accept PDF documents, such as a printed DC forwarded on
  WhatsApp? Not checked.
- O12: After how long is an unacknowledged DC flagged (if P4 is adopted)?
- O13: Still needed: 15-20 real DC/GRN/invoice photos for the accuracy set, stored
  outside the repo.
- O14: D2 calls handwritten reading "not a priority". On 2026-10-04 Aravind said machine
  reading is a must. Does that include handwritten DCs?

### Confirmed later on 2026-10-04
Per Aravind, not observed in code. These lines update the proposals and open items above.
- P1 confirmed: one menu entry with sub-types DC / invoice / GRN, in place of items 4
  and 5. Digit 5 retires and is never reused (O8). The wording is still not an approved
  string. Cofounder confirmation (O3) is still open.
- P2 confirmed in part: the delivery is the anchor in the schema. In slice 1, the
  engineer's GRN creates the delivery. "Expected" deliveries opened by a vendor-sent DC
  are deferred.
- ~~P3 rejected for now: the bot does not echo the typed rate.~~
  Corrected 2026-10-04, per Aravind: P3's forced confirmation is rejected. The bot
  still echoes the typed rate under Rule 3.4, with confirmation by silence. The
  engineer never has to reply "yes".
- P4 confirmed in this form: when the engineer sends a DC, the bot asks for the GRN in
  the same flow and links that GRN to that DC. If the engineer leaves the flow, the DC is
  saved and the PM dashboard shows it as not acknowledged. No reminder goes to the
  engineer in slice 1.
- O12 answered: no wait. The PM sees an unacknowledged DC immediately.
- Invoice in slice 1: the bot does not ask for a GRN after an invoice. The invoice is
  saved on its own. The PM links it to a delivery on the dashboard.
- O14 answered: machine reading of DCs is in slice 1, handwritten DCs included. This
  reverses D2's "handwritten reading is not a priority". D2 is left as written above.
- Rule 3.9 in docs/design-principles.md is changed for capture-engine machine reading:
  the PM checks the machine reading on the dashboard. The engineer does not see it or
  confirm it. See the correction note under Rule 3.9.
- Invoices in slice 1 are machine-read. The PM checks the machine reading on the
  dashboard. The engineer adds only a description of the values (see O18). See the
  second correction note under Rule 3.9.

### More open items, 2026-10-04
- O15: How does an engineer link an invoice to a delivery on WhatsApp? Deferred. In
  slice 1 the PM links them on the dashboard.
- O16: A reminder to the engineer for an unacknowledged DC. Needs a template decision
  (see O10). Deferred.
- O17: How a vendor-sent DC matches a later GRN when "expected" deliveries are built.
  Two trucks from one vendor on one day make the match ambiguous. Deferred.
- O18: What does the engineer's description of invoice values contain: free text, or
  specific fields such as amount and date? Wording owed.

### Answered 2026-10-05
Per Aravind, not observed in code.
- O3 closed: Aravind and the cofounder both agree to the single menu entry (P1) and the
  PM page. The cofounder's agreement is per Aravind, not observed.
- The PM page is labelled "Material Inward". This is an approved English user-facing
  string. Tamil owed, NOT approved. The label applies to the page only. This record, the
  tables and the code keep the word "delivery".
- O18 answered: with an invoice, the engineer enters a description, the quantity if it
  applies, and the total amount. Machine reading extracts the individual line items.
- For a delivery, the engineer reports rates and quantities per item (O1). For an
  invoice, the engineer reports one total amount (O18).

## Open — not decided
(Kept as originally written. O1, O2, O4 and O5 were answered on 2026-10-04: see above.)
- O1: Does a delivery record rates/amounts, or quantity only?
- O2: Do confirmed deliveries appear in the owner's nightly report, or only the PM page?
- O3: Deliveries page — confirmation with cofounder.
- O4: Share of RCPL challans/receipts that are handwritten (expenses and site invoices
  reported mostly handwritten, per Aravind).
- O5: Retention period for challan/receipt photos.
- O6: Exact wording of every message (all TBD, to Aravind).
- O7: Idle digit "4" becomes live; today '3'-'7' reply "not available yet"
  (inbound-start.ts classifyAdhocInput).

## Block A findings, 2026-10-05
Source: docs/reviews/2026-10-05-capture-block-a-probes.txt, a read-only probe of origin/main at ea12c89. "Observed" = shown in that file's raw output. "Per Aravind" = stated in chat, not shown.

### Verdicts on the nine unverified claims (lines 74-84)
1. VERIFIED (observed). Addition: migration 047:229 drops invoices_delete. The single-column FKs remain. The hardening at line 51 still applies.
2. TRUE BY CODE (observed, send.ts:223-229 sends no Body field). The cited source "capture-ocr-probe §E" does not exist in the repo. The source cannot be checked.
3. VERIFIED (observed, design-principles.md:37). Two corrections dated 2026-10-04 sit directly below that line and already carry this record's decisions. The 2026-10-05 probe printed line 37 only and missed them. design-principles.md needs no change.
4. VERIFIED in behaviour (observed, inbound-start.ts:263 and :350). The code string is "That option isn't available yet. Nothing was recorded."
5. VERIFIED (observed). The branch merged as #319, a81b5c3.
6. PARTLY CLEARED (observed). The Twilio media download exists for an active morning, evening or hindrance flow. A photo sent with no active flow is discarded (inbound-start.ts:925-926). No ingest path exists for menu items 3-6. Slice 1 needs its own ingest path.
7. VERIFIED (observed, adhoc-menu-spec.md:342-346).
8. VERIFIED (observed, adhoc-menu-spec.md:1039-1047).
9. CAUSE CONTRADICTED (observed, 038:123-142). 038 discarded partial hindrances by design. The pairing CHECK (036:395-396) does not require a completed report. This is deduced from SQL NULL semantics. No SQL was run.

### Open items answered or added
- O10 ANSWERED. The owner nightly report is email (observed, owner-deliver-dispatch.ts:470). Delivery items go in the email. No template or Meta approval is needed. Per Aravind 2026-10-05: email is the channel for now.
- O19 NEW, DEFERRED (per Aravind 2026-10-05): a WhatsApp alert to the owner and PM when materials arrive. Later version. It needs a new template and Meta approval when built.
- O11 ANSWERED (code path observed, not exercised). Every inbound media type except audio is classified as a photo (media-reply.ts:102), including PDF and video. During an active flow, the file is stored under a .jpg path and can reach the owner's email as an attachment. With no active flow, the file is discarded with "Photo not saved". Fix planned on branch fix/media-image-only (plan written 2026-10-05; no code yet).
- O20 NEW, OPEN: media ingest has no size cap (ingest.ts:118 buffers the whole file). After fix/media-image-only, the remaining exposure is an image sent as an uncompressed document.
- No code sends an image or document to the Claude API today (observed). Slice 1 builds the first such path.
- Open tension (per Aravind 2026-10-05): slice 1 asks the engineer to type GRN quantities and rates that the DC photo already holds (Rule 3.9, media-first). The slice 1 plan must address it.

### O4 conflict, not resolved
- Per Aravind 2026-10-04 (O4): about 60% of documents are handwritten.
- Per Aravind 2026-10-05, relaying the cofounder: most inward DCs and invoices are printed.
- These two statements conflict. The O13 set settles the ratio by count. O14 (handwritten reading in slice 1) depends on the answer.
- O13 addition: collect documents from real deliveries, not chosen examples. Include forwarded PDF DCs and invoices if vendors send them.
- Per Aravind 2026-10-05, relaying the cofounder: the WhatsApp GRN acknowledgment can serve as the record. This agrees with line 96.

## Decisions, session of 5–6 Oct 2026 IST (exact time per decision not recorded)

All lines per Aravind unless marked.

- A1. Slice 1 splits. 1a = engineer capture, storage, PM approval, owner email. 1b = machine reading, invoices table hardening, invoice-delivery links, matching.
- A2. O14: machine reading of handwritten and printed documents are both priority. Reading is 1b. This removes O14's dependency on the handwritten ratio.
- A3. The site receives printed DCs. Peruvalappur is the same site that sent the 58 O13 photos.
- A4. O9: retention ends at project completion. No completion event exists, so retention is indefinite for now.
- A5. Supplier documents may go to the Anthropic API (1b).
- A6. PDFs are accepted and read. No information in a PDF may be lost. Design chosen by Claude under Aravind's delegation: in 1a, PDFs are accepted only inside the material-inward flow; original bytes stored unchanged, all pages; file type checked by first bytes (%PDF-); an encrypted or unparseable PDF is stored and marked not previewable; PDFs in check-ins stay rejected; a PDF with no active flow gets the idle nudge (a change from today's behaviour, planned for 1a).
- A7. Owner email: a separate email; reads approved deliveries at send time; the deliveries section appears once per project per night; late approvals roll forward to the next night; the owner sees money for purchases, from PM values only; no invoices and no attachments in 1a; nothing is sent on an empty night.
- A8. Delivery type: supplier or internal transfer. The PM sets it at approval. The engineer gets no extra question. An internal transfer needs no invoice and shows quantities without money in the owner email.
- A9. New open item: equipment location (inward and outward transfers; which site holds which equipment). Not designed. Not in 1a.
- A10. Engineer GRN: with a DC, the engineer answers "all as on the DC" or lists only the items that differ. Without a DC, the engineer sends one free-text message, stored raw; the PM itemises. The engineer types no rate; the PM enters rates from the document. Amends O1. Cofounder confirmation: not recorded.
- A11. File size cap 16 MB for images and PDFs. An oversize file shows to the PM only; the engineer gets no message. Basis: Twilio documents a 16 MB WhatsApp media limit for messages Twilio sends; Claude found no Twilio statement for inbound media (inferred cap, not a Twilio fact).
- A12. New storage bucket for capture documents. PDF checks stay byte-level in 1a (no PDF parser).
- A13. The PM must enter the supplier or origin name before approval. Vehicle number, DC number, DC date optional in 1a. Invoices view-only in 1a.
- A14. Design fixes: the engineer acknowledgement says "received", not "saved"; the owner-email send ledger needs a stuck-claim rule and a provider idempotency check; approval is final in 1a (correction design later); the IST date column follows migration 043's method, proven in rehearsal; every PM SECURITY DEFINER function gets negative tests (PM of another project, PM of another tenant).
- A15. 1b arithmetic check: subtotal + CGST + SGST + IGST + round-off = grand total. A line-sum check alone fails on correct GST invoices.

### Evidence: internal DC sample (observed by Claude from Aravind's upload; file not stored in repo)

- DC No RCPL/TN/26-27/05, date 23-09-2026 (DD-MM-YYYY), vehicle TN 67 BW 0599, RCPL yard Kancheepuram to RCPL site Peruvalappur. Marked "INTERNAL TRANSFER, NOT FOR SALE".
- 6 lines, unit Nos: 200 x 80, 300 x 60, 255 x 40, 50 x 200, 40 x 100, 3 x 500. Lines sum to 59,700. CGST 9% 5,373. SGST 9% 5,373. Grand total 70,446.00. No round-off line. Arithmetic exact (checked by Claude).
- Header label "Details of Consigner" labels the consignee. Misspelled descriptions ("Verticle", "Leger"). The PDF has a text layer (Excel export).

Open follow-ups from the 6 Oct 2026 records are listed in `docs/reviews/2026-10-06-p0-sentry-record.md` (FOLLOW-UPS).
