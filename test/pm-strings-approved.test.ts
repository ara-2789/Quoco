import { describe, it, expect } from 'vitest'
import * as copy from '@/lib/capture/pm-copy'

// PR-D1: the English strings approved by Aravind on 2 Nov, pinned EXACTLY. Tamil is owed and not approved. The values below
// are inlined on purpose (generated once from the approved list, never read from a file at test time), so a change to
// lib/capture/pm-copy.ts that is not also a change here fails this test.

const APPROVED: Record<string, string> = {
  PM_EMPTY_STATE: "No deliveries yet. They appear here when a site engineer sends a DC or invoice on WhatsApp.",
  PM_NOT_A_PM_STATE: "You are not a PM on any project, so there is nothing to show here.",
  PM_LOAD_ERROR: "This page could not load. Refresh to try again.",
  PM_LIST_TRUNCATED: "Showing the latest 100 deliveries. Open ones are listed first.",
  PM_KIND_DC: "DC / GRN", // per Aravind, 3 Nov
  PM_KIND_INVOICE: "Invoice",
  PM_LABEL_CREATED_FROM_INVOICE: "From invoice (no DC)",
  PM_LABEL_CANCELLED_REASON: "Replaced by a linked DC",
  PM_LABEL_INVOICE_EXPECTED: "Invoice expected",
  PM_LABEL_INVOICE_EXPECTED_DAYS: "Invoice pending for {n} days",
  PM_FIELD_ENGINEER: "Site engineer",
  PM_FIELD_ACK: "Engineer's answer",
  PM_FIELD_FILES: "Files",
  PM_STATUS_INCOMPLETE: "Details needed",
  PM_STATUS_AWAITING_PM: "Waiting for approval",
  PM_STATUS_APPROVED: "Approved",
  PM_STATUS_REJECTED: "Rejected",
  PM_STATUS_CANCELLED: "Cancelled",
  PM_TYPE_SUPPLIER: "Supplier",
  PM_TYPE_INTERNAL_TRANSFER: "Internal transfer", // per Aravind, 3 Nov
  PM_TYPE_NOT_SET: "Type not set",
  PM_ACK_DC_YES: "All arrived",
  PM_ACK_DC_NO: "Not arrived",
  PM_ACK_DC_PARTIAL: "Part arrived",
  PM_ACK_DC_UNCLEAR: "Answer unclear. Confirm with the engineer before you approve.",
  PM_ACK_INVOICE_YES: "Matches",
  PM_ACK_INVOICE_NO: "Does not match",
  PM_ACK_INVOICE_PARTIAL: "Partly matches",
  PM_ACK_INVOICE_UNCLEAR: "Answer unclear. Check the invoice with the engineer before you approve.",
  PM_ACK_NONE: "No answer yet",
  PM_BACK_TO_LIST: "Back to Material Inward",
  PM_DETAILS_TOGGLE: "More details (optional)", // per Aravind, 3 Nov
  PM_FIELD_PROJECT: "Project",
  PM_FIELD_RECEIVED: "Received",
  PM_FIELD_ACK_NOTE: "Engineer's note",
  PM_FIELD_REJECT_REASON: "Reason for rejecting",
  PM_INVOICES_HEADING: "Linked invoices",
  PM_LINKED_DELIVERIES_HEADING: "Linked DCs",
  PM_FILE_PREVIEW_ALT: "Photo of the document", // per Aravind, 3 Nov
  PM_VIEWER_CLOSE: "Close", // per Aravind, 3 Nov
  PM_VIEWER_ROTATE: "Rotate", // per Aravind, 3 Nov
  PM_FILE_OPEN: "Open",
  PM_FILE_DOWNLOAD: "Download",
  PM_FILE_UNAVAILABLE: "This file cannot be opened right now. Try again in a minute.",
  PM_LABEL_PDF_NOT_PREVIEWABLE: "Locked or damaged PDF. Download it to view.",
  PM_LABEL_FILE_PENDING: "Receiving file",
  PM_LABEL_FILE_PENDING_TIMEOUT: "Not received yet. It may still arrive.",
  PM_LABEL_FILE_FAILED: "Could not save this file yet. If it does not appear soon, ask the engineer to send it again.",
  PM_LABEL_FILE_REJECTED_TYPE: "Not kept. Only PDF, JPEG, PNG and WEBP files are accepted.",
  PM_LABEL_FILE_REJECTED_SIZE: "Not kept. The file is larger than 16 MB.",
  PM_ACTION_APPROVE: "Approve",
  PM_ACTION_REJECT: "Reject",
  PM_CONFIRM_REJECT: "Confirm reject. This cannot be undone.",
  PM_WARN_APPROVE_NO_FILE: "No readable file is attached. Check the material before you approve.",
  PM_ACTION_SAVE_DETAILS: "Save details",
  PM_FIELD_TYPE: "Delivery type",
  PM_FIELD_DC_NUMBER: "DC no.",
  PM_FIELD_DC_DATE: "DC date",
  PM_ACTION_LINK_INVOICE: "Link invoice",
  PM_LINK_SELECT_INVOICE: "Choose the invoice for this DC",
  PM_LINK_SELECT_DELIVERIES: "Choose the DCs this invoice covers (up to 20)",
  PM_LINK_OPTION: "{date}, {time} · {engineer} · {answer}", // per Aravind, 3 Nov
  PM_LINK_NO_CANDIDATES: "Nothing to link right now.",
  PM_ACTION_UNLINK: "Unlink",
  PM_CONFIRM_UNLINK: "Confirm unlink",
  PM_PENDING_ACTION: "Saving…",
  PM_ERR_NOT_AVAILABLE: "This delivery is not available to you.",
  PM_ERR_STATE_CHANGED: "Someone changed this delivery before you. The page now shows the latest version.",
  PM_ERR_SAVE_FAILED: "Something went wrong and nothing was saved. Try again.",
  PM_ERR_INVALID_INPUT: "Some details are not valid. Check them and try again.",
  PM_ERR_TYPE_REQUIRED: "Set the delivery type before you approve.",
  PM_ERR_REJECT_REASON: "Write a reason for rejecting, up to 1000 characters.",
  PM_ERR_ALREADY_LINKED: "This DC already has an invoice linked.",
  PM_ERR_LINK_AUTO_APPROVED: "This invoice is already approved on its own, so it cannot be linked to a DC.",
  PM_ERR_LINK_TARGET_INELIGIBLE: "This DC cannot take an invoice. It is an internal transfer, created from an invoice, or rejected.", // per Aravind, 12 Nov
  PM_ERR_ALREADY_UNLINKED: "This link was already removed.",
  PM_ERR_SELF_LINK_FIXED: "An invoice's link to its own delivery cannot be removed.",
  PM_ERR_RETYPE_LINKED: "Unlink the invoice before you change this to an internal transfer.", // per Aravind, 12 Nov
  PM_ERR_RETYPE_AUTOMATIC: "A delivery created from an invoice cannot be an internal transfer.", // per Aravind, 12 Nov
}

const strings = Object.entries(copy).filter(([, v]) => typeof v === 'string') as Array<[string, string]>

describe('PR-D1 / PR-D1b approved English strings (Aravind, 2, 3 and 12 Nov)', () => {
  it('the approved list has 79 keys', () => expect(Object.keys(APPROVED)).toHaveLength(79))

  it('pm-copy.ts exports exactly the approved keys plus PM_PAGE_TITLE as strings: no key added, none missing', () => {
    expect(strings.map(([k]) => k).filter((k) => k !== 'PM_PAGE_TITLE').sort()).toEqual(Object.keys(APPROVED).sort())
  })

  it.each(Object.entries(APPROVED))('%s equals the approved text exactly', (key, text) => {
    expect((copy as Record<string, unknown>)[key]).toBe(text)
  })

  it('PM_FIELD_VEHICLE is deleted (PR-D1b): nothing renders the vehicle any more', () => expect('PM_FIELD_VEHICLE' in copy).toBe(false))

  it('PM_PAGE_TITLE is unchanged', () => expect(copy.PM_PAGE_TITLE).toBe('Material Inward'))

  it('the 8 per-kind ack values are pairwise distinct', () => {
    const eight = [
      ...Object.values(copy.PM_ACK_LABEL.invoice),
      ...Object.values(copy.PM_ACK_LABEL.dc),
    ]
    expect(eight).toHaveLength(8)
    expect(new Set(eight).size).toBe(8)
    // and none of them is the no-answer value
    expect(eight).not.toContain(copy.PM_ACK_NONE)
  })

  it('no value contains an opening bracket followed by PM_ (no placeholder left)', () => {
    const marker = '[' + 'PM_'
    for (const [key, v] of strings) expect(v, key).not.toContain(marker)
  })

  it('no value says "DC missing" or "paid" (A16 / A17), case-insensitive', () => {
    for (const [key, v] of strings) {
      expect(v, key).not.toMatch(/dc missing/i)
      expect(v, key).not.toMatch(/\bpaid\b/i)
    }
  })

  it('PM_ACK_LABEL maps every DB ack value to the matching per-kind constant', () => {
    expect(copy.PM_ACK_LABEL).toEqual({
      invoice: { yes: copy.PM_ACK_INVOICE_YES, no: copy.PM_ACK_INVOICE_NO, partial: copy.PM_ACK_INVOICE_PARTIAL, unclear: copy.PM_ACK_INVOICE_UNCLEAR },
      dc: { yes: copy.PM_ACK_DC_YES, no: copy.PM_ACK_DC_NO, partial: copy.PM_ACK_DC_PARTIAL, unclear: copy.PM_ACK_DC_UNCLEAR },
    })
  })

  it('the error table keeps its 13 keys', () => {
    expect(Object.keys(copy.PM_ERR_MESSAGES).sort()).toEqual(
      [
        'PM_ERR_ALREADY_LINKED',
        'PM_ERR_ALREADY_UNLINKED',
        'PM_ERR_INVALID_INPUT',
        'PM_ERR_LINK_AUTO_APPROVED',
        'PM_ERR_LINK_TARGET_INELIGIBLE',
        'PM_ERR_NOT_AVAILABLE',
        'PM_ERR_REJECT_REASON',
        'PM_ERR_RETYPE_AUTOMATIC',
        'PM_ERR_RETYPE_LINKED',
        'PM_ERR_SAVE_FAILED',
        'PM_ERR_SELF_LINK_FIXED',
        'PM_ERR_STATE_CHANGED',
        'PM_ERR_TYPE_REQUIRED',
      ].sort(),
    )
  })
})
