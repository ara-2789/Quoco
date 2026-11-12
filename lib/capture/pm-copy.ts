// PR-D (PM page "Material Inward"). EVERY user-facing string of this page is a named constant here and nowhere
// else. English wording approved by Aravind on 2 Nov (docs/plans/pr-d1-strings-approved.md). Tamil is owed and NOT
// approved. PM_LABEL_INVOICE_EXPECTED_DAYS holds a literal {n} for the day count (rendered only when n >= 2).
//
// Constraints any final wording must meet (rules, not text):
//   * Ack labels are separate per document type. Invoice ack: matches / does not match / partly matches.
//     DC ack: all arrived / not arrived / part arrived. An invoice's ack is never evidence that goods arrived.
//   * No string says "DC missing" or "paid" (slice-1a-plan-v3.md A16 / A17; asserted by test/pm-render.test.tsx).
//   * 'unclear' (both ack types): decided 2 Nov, a separate "confirm before you approve" wording per type.

export const PM_PAGE_TITLE = 'Material Inward' // approved English; Tamil owed

// ---- page states
export const PM_EMPTY_STATE = 'No deliveries yet. They appear here when a site engineer sends a DC or invoice on WhatsApp.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_NOT_A_PM_STATE = 'You are not a PM on any project, so there is nothing to show here.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LOAD_ERROR = 'This page could not load. Refresh to try again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_BACK_TO_LIST = 'Back to Material Inward' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LIST_TRUNCATED = 'Showing the latest 100 deliveries. Open ones are listed first.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- delivery status (deliveries.status CHECK: incomplete, awaiting_pm, approved, rejected, cancelled)
export const PM_STATUS_INCOMPLETE = 'Details needed' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_STATUS_AWAITING_PM = 'Waiting for approval' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_STATUS_APPROVED = 'Approved' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_STATUS_REJECTED = 'Rejected' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_STATUS_CANCELLED = 'Cancelled' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- delivery type (deliveries.delivery_type CHECK: supplier, internal_transfer; NULL until set)
export const PM_TYPE_SUPPLIER = 'Supplier' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_TYPE_INTERNAL_TRANSFER = 'Internal transfer' // English approved (Aravind, 3 Nov; was "Internal GRN (from another site)"). Tamil owed.
export const PM_TYPE_NOT_SET = 'Type not set' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- document kind
export const PM_KIND_DC = 'DC / GRN' // English approved (Aravind, 3 Nov; was "DC"). Tamil owed. A GRN that arrives "as it comes" is stored as kind 'dc'.
export const PM_KIND_INVOICE = 'Invoice' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- ack (capture_documents.engineer_ack CHECK: yes, no, partial, unclear; NULL until answered). Separate per type.
export const PM_ACK_INVOICE_YES = 'Matches' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_INVOICE_NO = 'Does not match' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_INVOICE_PARTIAL = 'Partly matches' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_INVOICE_UNCLEAR = 'Answer unclear. Check the invoice with the engineer before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_DC_YES = 'All arrived' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_DC_NO = 'Not arrived' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_DC_PARTIAL = 'Part arrived' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_DC_UNCLEAR = 'Answer unclear. Confirm with the engineer before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACK_NONE = 'No answer yet' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

export type PmAck = 'yes' | 'no' | 'partial' | 'unclear'
export type PmDocKind = 'dc' | 'invoice'

// Typed so a new DB ack value or document kind is a compile error, and so a kind can never fall through to the
// other kind's label.
export const PM_ACK_LABEL: Record<PmDocKind, Record<PmAck, string>> = {
  invoice: {
    yes: PM_ACK_INVOICE_YES,
    no: PM_ACK_INVOICE_NO,
    partial: PM_ACK_INVOICE_PARTIAL,
    unclear: PM_ACK_INVOICE_UNCLEAR,
  },
  dc: {
    yes: PM_ACK_DC_YES,
    no: PM_ACK_DC_NO,
    partial: PM_ACK_DC_PARTIAL,
    unclear: PM_ACK_DC_UNCLEAR,
  },
}

// ---- other labels
export const PM_LABEL_CREATED_FROM_INVOICE = 'From invoice (no DC)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LABEL_CANCELLED_REASON = 'Replaced by a linked DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LABEL_INVOICE_EXPECTED = 'Invoice expected' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
// {n} is the day count; components/material-inward/labels.ts (invoiceWaitLabel) substitutes it and renders this ONLY when n >= 2.
export const PM_LABEL_INVOICE_EXPECTED_DAYS = 'Invoice pending for {n} days' // English approved (Aravind, 2 Nov; changed from "expected for" the same day). Tamil owed, NOT approved.
export const PM_INVOICES_HEADING = 'Linked invoices' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LINKED_DELIVERIES_HEADING = 'Linked DCs' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LINK_SELECT_INVOICE = 'Choose the invoice for this DC' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LINK_SELECT_DELIVERIES = 'Choose the DCs this invoice covers (up to 20)' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
// {date} formatIstDate, {time} 12-hour IST lowercase am/pm, {engineer} site engineer name or an em dash, {answer} the engineer's ack label of the candidate's own kind.
export const PM_LINK_OPTION = '{date}, {time} · {engineer} · {answer}' // English approved (Aravind, 3 Nov). Tamil owed.
export const PM_LINK_NO_CANDIDATES = 'Nothing to link right now.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- field labels
export const PM_FIELD_TYPE = 'Delivery type' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
// PM_FIELD_VEHICLE deleted 3 Nov (PR-D1b): the vehicle field left the form and the list. The value is still stored and passed through unchanged.
export const PM_FIELD_DC_NUMBER = 'DC no.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_DC_DATE = 'DC date' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_REJECT_REASON = 'Reason for rejecting' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_RECEIVED = 'Received' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_ENGINEER = 'Site engineer' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_ACK = 'Engineer\'s answer' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_ACK_NOTE = 'Engineer\'s note' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FIELD_FILES = 'Files' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_DETAILS_TOGGLE = 'More details (optional)' // English approved (Aravind, 3 Nov). Tamil owed.
export const PM_FIELD_PROJECT = 'Project' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- files
export const PM_LABEL_PDF_NOT_PREVIEWABLE = 'Locked or damaged PDF. Download it to view.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LABEL_FILE_REJECTED_TYPE = 'Not kept. Only PDF, JPEG, PNG and WEBP files are accepted.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LABEL_FILE_REJECTED_SIZE = 'Not kept. The file is larger than 16 MB.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LABEL_FILE_PENDING = 'Receiving file' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
// D9: a pending file older than PM_PENDING_TIMEOUT_MINUTES. Separate from a real 'failed' because it can still flip to stored.
export const PM_LABEL_FILE_PENDING_TIMEOUT = 'Not received yet. It may still arrive.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_LABEL_FILE_FAILED = 'Could not save this file yet. If it does not appear soon, ask the engineer to send it again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FILE_UNAVAILABLE = 'This file cannot be opened right now. Try again in a minute.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FILE_PREVIEW_ALT = 'Photo of the document' // English approved (Aravind, 3 Nov). Tamil owed. Also the viewer dialog's accessible name.
export const PM_VIEWER_CLOSE = 'Close' // English approved (Aravind, 3 Nov). Tamil owed.
export const PM_VIEWER_ROTATE = 'Rotate' // English approved (Aravind, 3 Nov). Tamil owed.
export const PM_FILE_OPEN = 'Open' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_FILE_DOWNLOAD = 'Download' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- actions
export const PM_ACTION_APPROVE = 'Approve' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACTION_REJECT = 'Reject' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACTION_LINK_INVOICE = 'Link invoice' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACTION_UNLINK = 'Unlink' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ACTION_SAVE_DETAILS = 'Save details' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_CONFIRM_REJECT = 'Confirm reject. This cannot be undone.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_CONFIRM_UNLINK = 'Confirm unlink' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_PENDING_ACTION = 'Saving…' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
// D10: approving a delivery with no stored file shows this warning and still allows the approve.
export const PM_WARN_APPROVE_NO_FILE = 'No readable file is attached. Check the material before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

// ---- errors (one key per refusal class; mapping in lib/capture/pm-errors.ts)
export const PM_ERR_NOT_AVAILABLE = 'This delivery is not available to you.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_STATE_CHANGED = 'Someone changed this delivery before you. The page now shows the latest version.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_LINK_AUTO_APPROVED = 'This invoice is already approved on its own, so it cannot be linked to a DC.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_ALREADY_UNLINKED = 'This link was already removed.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_TYPE_REQUIRED = 'Set the delivery type before you approve.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_REJECT_REASON = 'Write a reason for rejecting, up to 1000 characters.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_INVALID_INPUT = 'Some details are not valid. Check them and try again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_ALREADY_LINKED = 'This DC already has an invoice linked.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_SELF_LINK_FIXED = 'An invoice\'s link to its own delivery cannot be removed.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.
export const PM_ERR_RETYPE_LINKED = 'Unlink the invoice before you change this to an internal transfer.' // Proposed English, NOT approved (word swap of the 2 Nov text). Tamil owed, NOT approved.
export const PM_ERR_RETYPE_AUTOMATIC = 'A delivery created from an invoice cannot be an internal transfer.' // Proposed English, NOT approved (word swap of the 2 Nov text). Tamil owed, NOT approved.
export const PM_ERR_LINK_TARGET_INELIGIBLE = 'This DC cannot take an invoice. It is an internal transfer, created from an invoice, or rejected.' // Proposed English, NOT approved (word swap of the 2 Nov text). Tamil owed, NOT approved.
export const PM_ERR_SAVE_FAILED = 'Something went wrong and nothing was saved. Try again.' // English approved (Aravind, 2 Nov). Tamil owed, NOT approved.

/** The display-side error table: key name -> string. The name is what tests assert on; the string is the placeholder. */
export const PM_ERR_MESSAGES = {
  PM_ERR_NOT_AVAILABLE,
  PM_ERR_STATE_CHANGED,
  PM_ERR_LINK_AUTO_APPROVED,
  PM_ERR_ALREADY_UNLINKED,
  PM_ERR_TYPE_REQUIRED,
  PM_ERR_REJECT_REASON,
  PM_ERR_INVALID_INPUT,
  PM_ERR_ALREADY_LINKED,
  PM_ERR_SELF_LINK_FIXED,
  PM_ERR_RETYPE_LINKED,
  PM_ERR_RETYPE_AUTOMATIC,
  PM_ERR_LINK_TARGET_INELIGIBLE,
  PM_ERR_SAVE_FAILED,
} as const

export type PmErrKey = keyof typeof PM_ERR_MESSAGES

// D9 (slice-1a-plan-v3.md:119): a pending file older than this shows PM_LABEL_FILE_PENDING_TIMEOUT.
export const PM_PENDING_TIMEOUT_MINUTES = 15
