import type { StatusVariant } from '@/components/ui/status-chip'
import {
  PM_ACK_LABEL,
  PM_ACK_NONE,
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
} from '@/lib/capture/pm-copy'

// Pure mapping from DB values to copy constants and chip variants. No user-facing text is defined here.

/** The ack label for a document of the given kind. An invoice never gets a DC label and the reverse (PM_ACK_LABEL is keyed by kind). */
export function ackLabel(kind: PmDocKind | null, ack: PmAck | null): string {
  // No known kind (null-kind tolerance, PR-D2 / MI-KIND-REMOVAL): no kind-specific label exists, so show the existing "no ack" slot.
  if (kind === null || ack === null) return PM_ACK_NONE
  return PM_ACK_LABEL[kind][ack]
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

/** Status values the PM can still act on (050: approve and reject accept only these, 050:593 / 675). */
export function isOpenStatus(status: string): boolean {
  return status === 'incomplete' || status === 'awaiting_pm'
}
