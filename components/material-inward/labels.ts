import type { StatusVariant } from '@/components/ui/status-chip'
import {
  PM_ACK_DC_UNCLEAR,
  PM_ACK_INVOICE_NO,
  PM_ACK_INVOICE_PARTIAL,
  PM_ACK_INVOICE_YES,
  PM_ACK_LABEL,
  PM_ACK_NONE,
  PM_AGE_DAYS,
  PM_AGE_HOURS,
  PM_AGE_JUST_NOW,
  PM_LABEL_INVOICE_EXPECTED,
  PM_LABEL_INVOICE_EXPECTED_DAYS,
  PM_LINK_OPTION,
  PM_STATUS_APPROVED,
  PM_STATUS_AWAITING_PM,
  PM_STATUS_CANCELLED,
  PM_STATUS_INCOMPLETE,
  PM_STATUS_REJECTED,
  PM_TYPE_INTERNAL_TRANSFER,
  PM_TYPE_NOT_SET,
  PM_TYPE_SUPPLIER,
  type PmAck,
  type PmDocKind,
  type PmKindSource,
} from '@/lib/capture/pm-copy'

// Pure mapping from DB values to copy constants and chip variants. No user-facing text is defined here.

/**
 * The ack label for a document (D8). `kindSource` decides the wording, because it says which question the engineer was asked:
 *   * 'engineer_declared' (pre-052 rows): the engineer chose DC or invoice and got the per-kind question, so the per-kind label applies
 *     (PM_ACK_LABEL is keyed by kind: an invoice never gets a DC label and the reverse).
 *   * 'pm' or NULL kind (after 052): the engineer got ONE neutral "does the material match this document?" question whatever the
 *     document turned out to be (lib/whatsapp/flows/material-inward-strings.ts, MI_ACK_QUESTION), so 1 / 2 / 3 read "Matches" /
 *     "Does not match" / "Partly matches" for both kinds, and 'unclear' uses the existing PM_ACK_DC_UNCLEAR text (no new string).
 * No answer is PM_ACK_NONE.
 */
export function ackLabel(kind: PmDocKind | null, ack: PmAck | null, kindSource: PmKindSource): string {
  if (ack === null) return PM_ACK_NONE
  if (kind !== null && kindSource === 'engineer_declared') return PM_ACK_LABEL[kind][ack]
  switch (ack) {
    case 'yes':
      return PM_ACK_INVOICE_YES
    case 'no':
      return PM_ACK_INVOICE_NO
    case 'partial':
      return PM_ACK_INVOICE_PARTIAL
    case 'unclear':
      return PM_ACK_DC_UNCLEAR
  }
}

/** The age badge text and the overdue flag (D2). Pure: `now` is injected. Age is from capture_documents.received_at (never created_at). */
export function ageInfo(receivedAt: string, now: Date): { text: string; overdue: boolean } {
  const ms = now.getTime() - new Date(receivedAt).getTime()
  const age = Number.isFinite(ms) && ms > 0 ? ms : 0
  const hours = Math.floor(age / 3_600_000)
  const overdue = age >= 24 * 3_600_000
  if (hours < 1) return { text: PM_AGE_JUST_NOW, overdue }
  if (hours < 48) return { text: PM_AGE_HOURS.replace('{n}', String(hours)), overdue }
  return { text: PM_AGE_DAYS.replace('{n}', String(Math.floor(hours / 24))), overdue }
}

/**
 * The one line shown for a DC that is waiting for an invoice (the caller shows it only when the query reported a day count,
 * i.e. an open DC with no invoice linked). n = whole IST calendar days since the DC was received (pm-queries.ts istDaysSince).
 *   n >= 2          -> PM_LABEL_INVOICE_EXPECTED_DAYS with "{n}" replaced by n, and nothing else on the line.
 *   n is 0, 1 or not a finite number -> PM_LABEL_INVOICE_EXPECTED only.
 */
export function invoiceWaitLabel(n: number): string {
  if (!Number.isFinite(n) || n < 2) return PM_LABEL_INVOICE_EXPECTED
  return PM_LABEL_INVOICE_EXPECTED_DAYS.replace('{n}', String(Math.floor(n)))
}

export const STATUS_CHIP: Record<string, { variant: StatusVariant; label: string }> = {
  incomplete: { variant: 'muted', label: PM_STATUS_INCOMPLETE },
  awaiting_pm: { variant: 'risk', label: PM_STATUS_AWAITING_PM },
  approved: { variant: 'ok', label: PM_STATUS_APPROVED },
  rejected: { variant: 'blocked', label: PM_STATUS_REJECTED },
  cancelled: { variant: 'muted', label: PM_STATUS_CANCELLED },
}

export function typeLabel(t: string | null): string {
  if (t === 'supplier') return PM_TYPE_SUPPLIER
  if (t === 'internal_transfer') return PM_TYPE_INTERNAL_TRANSFER
  return PM_TYPE_NOT_SET
}

/** IST calendar date, e.g. "18 Sep 2026" (same technique as lib/hindrance/relative-time.ts). */
export function formatIstDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Asia/Kolkata' })
}

/**
 * IST wall-clock time, 12-hour, lowercase am/pm, e.g. "10:33 am". 00:xx is "12:xx am", 12:xx is "12:xx pm".
 * Computed from the instant shifted by +05:30 (India has no DST), not from the machine's zone or the ICU's am/pm casing.
 */
export function formatIstTime(iso: string | null): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime()
  if (!Number.isFinite(ms)) return '—'
  const ist = new Date(ms + 330 * 60_000)
  const h24 = ist.getUTCHours()
  const mm = String(ist.getUTCMinutes()).padStart(2, '0')
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${mm} ${h24 < 12 ? 'am' : 'pm'}`
}

/** The picker option line (PM_LINK_OPTION). One pass, so text inside a value is never treated as a placeholder. */
export function linkOptionLabel(
  c: { receivedAt: string | null; documentCreatedAt: string | null; engineerName: string | null; ack: PmAck | null; kindSource: PmKindSource },
  kind: PmDocKind,
): string {
  const at = c.receivedAt ?? c.documentCreatedAt
  const values: Record<string, string> = {
    date: formatIstDate(at),
    time: formatIstTime(at),
    engineer: c.engineerName ?? '—',
    answer: ackLabel(kind, c.ack, c.kindSource),
  }
  return PM_LINK_OPTION.replace(/\{(date|time|engineer|answer)\}/g, (_m, k: string) => values[k])
}

/** Status values the PM can still act on (050: approve and reject accept only these, 050:593 / 675). */
export function isOpenStatus(status: string): boolean {
  return status === 'incomplete' || status === 'awaiting_pm'
}
