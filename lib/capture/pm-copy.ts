// PR-D (PM page "Material Inward"). EVERY user-facing string of this page is a named constant here and nowhere
// else. Per Aravind (31 Oct): no wording has been invented. Each value is the literal placeholder '[KEY_NAME]'
// until the strings come to him for approval. The single approved exception is PM_PAGE_TITLE.
//
// Constraints any final wording must meet (rules, not text):
//   * Ack labels are separate per document type. Invoice ack: matches / does not match / partly matches.
//     DC ack: all arrived / not arrived / part arrived. An invoice's ack is never evidence that goods arrived.
//   * No string says "DC missing" or "paid" (slice-1a-plan-v3.md A16 / A17; asserted by test/pm-render.test.tsx).
//   * 'unclear' (both ack types) is OPEN: Aravind has not decided its label or whether it applies to both types.

export const PM_PAGE_TITLE = 'Material Inward' // approved English; Tamil owed

// ---- page states
export const PM_EMPTY_STATE = '[PM_EMPTY_STATE]' // Tamil owed, NOT approved
export const PM_NOT_A_PM_STATE = '[PM_NOT_A_PM_STATE]' // Tamil owed, NOT approved
export const PM_LOAD_ERROR = '[PM_LOAD_ERROR]' // Tamil owed, NOT approved
export const PM_BACK_TO_LIST = '[PM_BACK_TO_LIST]' // Tamil owed, NOT approved
export const PM_LIST_TRUNCATED = '[PM_LIST_TRUNCATED]' // Tamil owed, NOT approved (shown when more than PM_LIST_LIMIT deliveries exist)

// ---- delivery status (deliveries.status CHECK: incomplete, awaiting_pm, approved, rejected, cancelled)
export const PM_STATUS_INCOMPLETE = '[PM_STATUS_INCOMPLETE]' // Tamil owed, NOT approved
export const PM_STATUS_AWAITING_PM = '[PM_STATUS_AWAITING_PM]' // Tamil owed, NOT approved
export const PM_STATUS_APPROVED = '[PM_STATUS_APPROVED]' // Tamil owed, NOT approved
export const PM_STATUS_REJECTED = '[PM_STATUS_REJECTED]' // Tamil owed, NOT approved
export const PM_STATUS_CANCELLED = '[PM_STATUS_CANCELLED]' // Tamil owed, NOT approved

// ---- delivery type (deliveries.delivery_type CHECK: supplier, internal_transfer; NULL until set)
export const PM_TYPE_SUPPLIER = '[PM_TYPE_SUPPLIER]' // Tamil owed, NOT approved
export const PM_TYPE_INTERNAL_TRANSFER = '[PM_TYPE_INTERNAL_TRANSFER]' // Tamil owed, NOT approved
export const PM_TYPE_NOT_SET = '[PM_TYPE_NOT_SET]' // Tamil owed, NOT approved

// ---- document kind
export const PM_KIND_DC = '[PM_KIND_DC]' // Tamil owed, NOT approved
export const PM_KIND_INVOICE = '[PM_KIND_INVOICE]' // Tamil owed, NOT approved

// ---- ack (capture_documents.engineer_ack CHECK: yes, no, partial, unclear; NULL until answered). Separate per type.
export const PM_ACK_INVOICE_YES = '[PM_ACK_INVOICE_YES]' // Tamil owed, NOT approved
export const PM_ACK_INVOICE_NO = '[PM_ACK_INVOICE_NO]' // Tamil owed, NOT approved
export const PM_ACK_INVOICE_PARTIAL = '[PM_ACK_INVOICE_PARTIAL]' // Tamil owed, NOT approved
export const PM_ACK_INVOICE_UNCLEAR = '[PM_ACK_INVOICE_UNCLEAR]' // OPEN (Aravind undecided); Tamil owed, NOT approved
export const PM_ACK_DC_YES = '[PM_ACK_DC_YES]' // Tamil owed, NOT approved
export const PM_ACK_DC_NO = '[PM_ACK_DC_NO]' // Tamil owed, NOT approved
export const PM_ACK_DC_PARTIAL = '[PM_ACK_DC_PARTIAL]' // Tamil owed, NOT approved
export const PM_ACK_DC_UNCLEAR = '[PM_ACK_DC_UNCLEAR]' // OPEN (Aravind undecided); Tamil owed, NOT approved
export const PM_ACK_NONE = '[PM_ACK_NONE]' // Tamil owed, NOT approved

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
export const PM_LABEL_CREATED_FROM_INVOICE = '[PM_LABEL_CREATED_FROM_INVOICE]' // Tamil owed, NOT approved
export const PM_LABEL_CANCELLED_REASON = '[PM_LABEL_CANCELLED_REASON]' // Tamil owed, NOT approved
export const PM_LABEL_INVOICE_EXPECTED = '[PM_LABEL_INVOICE_EXPECTED]' // Tamil owed, NOT approved
export const PM_LABEL_INVOICE_EXPECTED_DAYS = '[PM_LABEL_INVOICE_EXPECTED_DAYS]' // Tamil owed, NOT approved
export const PM_INVOICES_HEADING = '[PM_INVOICES_HEADING]' // Tamil owed, NOT approved
export const PM_LINKED_DELIVERIES_HEADING = '[PM_LINKED_DELIVERIES_HEADING]' // Tamil owed, NOT approved
export const PM_LINK_SELECT_INVOICE = '[PM_LINK_SELECT_INVOICE]' // Tamil owed, NOT approved
export const PM_LINK_SELECT_DELIVERIES = '[PM_LINK_SELECT_DELIVERIES]' // Tamil owed, NOT approved
export const PM_LINK_NO_CANDIDATES = '[PM_LINK_NO_CANDIDATES]' // Tamil owed, NOT approved

// ---- field labels
export const PM_FIELD_TYPE = '[PM_FIELD_TYPE]' // Tamil owed, NOT approved
export const PM_FIELD_VEHICLE = '[PM_FIELD_VEHICLE]' // Tamil owed, NOT approved
export const PM_FIELD_DC_NUMBER = '[PM_FIELD_DC_NUMBER]' // Tamil owed, NOT approved
export const PM_FIELD_DC_DATE = '[PM_FIELD_DC_DATE]' // Tamil owed, NOT approved
export const PM_FIELD_REJECT_REASON = '[PM_FIELD_REJECT_REASON]' // Tamil owed, NOT approved
export const PM_FIELD_RECEIVED = '[PM_FIELD_RECEIVED]' // Tamil owed, NOT approved
export const PM_FIELD_ENGINEER = '[PM_FIELD_ENGINEER]' // Tamil owed, NOT approved
export const PM_FIELD_ACK = '[PM_FIELD_ACK]' // Tamil owed, NOT approved
export const PM_FIELD_ACK_NOTE = '[PM_FIELD_ACK_NOTE]' // Tamil owed, NOT approved
export const PM_FIELD_CAPTION = '[PM_FIELD_CAPTION]' // Tamil owed, NOT approved
export const PM_FIELD_FILES = '[PM_FIELD_FILES]' // Tamil owed, NOT approved
export const PM_FIELD_PROJECT = '[PM_FIELD_PROJECT]' // Tamil owed, NOT approved

// ---- files
export const PM_LABEL_PDF_NOT_PREVIEWABLE = '[PM_LABEL_PDF_NOT_PREVIEWABLE]' // Tamil owed, NOT approved
export const PM_LABEL_FILE_REJECTED_TYPE = '[PM_LABEL_FILE_REJECTED_TYPE]' // Tamil owed, NOT approved
export const PM_LABEL_FILE_REJECTED_SIZE = '[PM_LABEL_FILE_REJECTED_SIZE]' // Tamil owed, NOT approved
export const PM_LABEL_FILE_PENDING = '[PM_LABEL_FILE_PENDING]' // Tamil owed, NOT approved
// D9: a pending file older than PM_PENDING_TIMEOUT_MINUTES. Separate from a real 'failed' because it can still flip to stored.
export const PM_LABEL_FILE_PENDING_TIMEOUT = '[PM_LABEL_FILE_PENDING_TIMEOUT]' // Tamil owed, NOT approved
export const PM_LABEL_FILE_FAILED = '[PM_LABEL_FILE_FAILED]' // Tamil owed, NOT approved
export const PM_FILE_UNAVAILABLE = '[PM_FILE_UNAVAILABLE]' // Tamil owed, NOT approved
export const PM_FILE_OPEN = '[PM_FILE_OPEN]' // Tamil owed, NOT approved
export const PM_FILE_DOWNLOAD = '[PM_FILE_DOWNLOAD]' // Tamil owed, NOT approved

// ---- actions
export const PM_ACTION_APPROVE = '[PM_ACTION_APPROVE]' // Tamil owed, NOT approved
export const PM_ACTION_REJECT = '[PM_ACTION_REJECT]' // Tamil owed, NOT approved
export const PM_ACTION_LINK_INVOICE = '[PM_ACTION_LINK_INVOICE]' // Tamil owed, NOT approved
export const PM_ACTION_UNLINK = '[PM_ACTION_UNLINK]' // Tamil owed, NOT approved
export const PM_ACTION_SAVE_DETAILS = '[PM_ACTION_SAVE_DETAILS]' // Tamil owed, NOT approved
export const PM_CONFIRM_REJECT = '[PM_CONFIRM_REJECT]' // Tamil owed, NOT approved
export const PM_CONFIRM_UNLINK = '[PM_CONFIRM_UNLINK]' // Tamil owed, NOT approved
export const PM_PENDING_ACTION = '[PM_PENDING_ACTION]' // Tamil owed, NOT approved
// D10: approving a delivery with no stored file shows this warning and still allows the approve.
export const PM_WARN_APPROVE_NO_FILE = '[PM_WARN_APPROVE_NO_FILE]' // Tamil owed, NOT approved

// ---- errors (one key per refusal class; mapping in lib/capture/pm-errors.ts)
export const PM_ERR_NOT_AVAILABLE = '[PM_ERR_NOT_AVAILABLE]' // Tamil owed, NOT approved
export const PM_ERR_STATE_CHANGED = '[PM_ERR_STATE_CHANGED]' // Tamil owed, NOT approved
export const PM_ERR_LINK_AUTO_APPROVED = '[PM_ERR_LINK_AUTO_APPROVED]' // Tamil owed, NOT approved
export const PM_ERR_ALREADY_UNLINKED = '[PM_ERR_ALREADY_UNLINKED]' // Tamil owed, NOT approved
export const PM_ERR_TYPE_REQUIRED = '[PM_ERR_TYPE_REQUIRED]' // Tamil owed, NOT approved
export const PM_ERR_REJECT_REASON = '[PM_ERR_REJECT_REASON]' // Tamil owed, NOT approved
export const PM_ERR_INVALID_INPUT = '[PM_ERR_INVALID_INPUT]' // Tamil owed, NOT approved
export const PM_ERR_ALREADY_LINKED = '[PM_ERR_ALREADY_LINKED]' // Tamil owed, NOT approved
export const PM_ERR_SELF_LINK_FIXED = '[PM_ERR_SELF_LINK_FIXED]' // Tamil owed, NOT approved
export const PM_ERR_RETYPE_LINKED = '[PM_ERR_RETYPE_LINKED]' // Tamil owed, NOT approved
export const PM_ERR_RETYPE_AUTOMATIC = '[PM_ERR_RETYPE_AUTOMATIC]' // Tamil owed, NOT approved
export const PM_ERR_LINK_TARGET_INELIGIBLE = '[PM_ERR_LINK_TARGET_INELIGIBLE]' // Tamil owed, NOT approved
export const PM_ERR_SAVE_FAILED = '[PM_ERR_SAVE_FAILED]' // Tamil owed, NOT approved

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
