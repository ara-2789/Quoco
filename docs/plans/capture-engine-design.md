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
  completed report can satisfy — the reason 038 could not save partial hindrances).
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
- 038 could not save partial hindrances because of a completed-report-only constraint.

## Open — not decided
- O1: Does a delivery record rates/amounts, or quantity only?
- O2: Do confirmed deliveries appear in the owner's nightly report, or only the PM page?
- O3: Deliveries page — confirmation with cofounder.
- O4: Share of RCPL challans/receipts that are handwritten (expenses and site invoices
  reported mostly handwritten, per Aravind).
- O5: Retention period for challan/receipt photos.
- O6: Exact wording of every message (all TBD, to Aravind).
- O7: Idle digit "4" becomes live; today '3'-'7' reply "not available yet"
  (inbound-start.ts classifyAdhocInput).
