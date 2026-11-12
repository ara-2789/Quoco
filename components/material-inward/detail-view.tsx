import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import type { PmDetail } from '@/lib/capture/pm-queries'
import { FileList } from './file-list'
import { STATUS_CHIP, ackLabel, formatIstDate, invoiceWaitLabel, isOpenStatus, typeLabel } from './labels'
import {
  PM_BACK_TO_LIST,
  PM_FIELD_ACK,
  PM_FIELD_ACK_NOTE,
  PM_FIELD_ENGINEER,
  PM_FIELD_FILES,
  PM_FIELD_PROJECT,
  PM_FIELD_RECEIVED,
  PM_FIELD_REJECT_REASON,
  PM_INVOICES_HEADING,
  PM_KIND_DC,
  PM_KIND_INVOICE,
  PM_LABEL_CANCELLED_REASON,
  PM_LABEL_CREATED_FROM_INVOICE,
  PM_LINKED_DELIVERIES_HEADING,
  PM_PAGE_TITLE,
} from '@/lib/capture/pm-copy'
import { DecisionControls } from '@/app/(dashboard)/material-inward/decision-controls'
import { DetailsControls } from '@/app/(dashboard)/material-inward/details-controls'
import { LinkControls } from '@/app/(dashboard)/material-inward/link-controls'

// The delivery detail body, separate from the page so it can be rendered in a test with a plain PmDetail (no database).
//
// CAPTION IS NEVER SHOWN (D-30 finding F4): `capture_documents.caption` holds the WhatsApp FILE NAME for a forwarded
// document (e.g. "phone pdf.pdf"), not text the engineer wrote. PmDetail does not even carry it (pm-queries.ts does not
// select it), and nothing on this page, the list or the pickers renders it. test/pm-render.test.tsx proves the view ignores
// a caption that is injected into the data.

export function DetailView({ d }: { d: PmDetail }) {
  const chip = STATUS_CHIP[d.status] ?? STATUS_CHIP.incomplete
  const open = isOpenStatus(d.status)
  const kind = d.document.kind
  const loaded = {
    status: d.status,
    deliveryType: d.deliveryType,
    vehicleNumber: d.vehicleNumber,
    dcNumber: d.dcNumber,
    dcDate: d.dcDate,
  }

  // What can be unlinked here: only pm_manual links (the automatic self-link is fixed, QE010).
  const unlinkable =
    kind === 'invoice'
      ? d.linkedDeliveries.map((l) => ({ linkId: l.linkId, receivedAt: l.receivedAt, documentCreatedAt: null, dcNumber: l.dcNumber }))
      : d.activeLinks
          .filter((l) => l.linkSource === 'pm_manual')
          .map((l) => ({
            linkId: l.linkId,
            receivedAt: null,
            // the linked INVOICE's document time (capture_documents.created_at); this DC's own received time is not it
            documentCreatedAt: d.linkedInvoice?.documentCreatedAt ?? null,
            dcNumber: null,
          }))

  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/material-inward" className="text-sm text-blue-700 underline">
          {PM_BACK_TO_LIST}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">{PM_PAGE_TITLE}</h1>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusChip variant={chip.variant} label={chip.label} />
          <span className="text-sm font-medium text-gray-900">{kind === 'invoice' ? PM_KIND_INVOICE : PM_KIND_DC}</span>
          <span className="text-sm text-gray-900">{typeLabel(d.deliveryType)}</span>
        </div>
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={PM_FIELD_PROJECT} value={d.projectName} />
          <Row label={PM_FIELD_RECEIVED} value={formatIstDate(d.receivedAt)} />
          <Row label={PM_FIELD_ENGINEER} value={d.engineerName ?? '—'} />
          <Row label={PM_FIELD_ACK} value={ackLabel(kind, d.document.ack)} testId="own-ack" />
          {d.document.ackNote && <Row label={PM_FIELD_ACK_NOTE} value={d.document.ackNote} />}
          {d.rejectReason && <Row label={PM_FIELD_REJECT_REASON} value={d.rejectReason} />}
        </dl>
        {(d.createdFromInvoice || d.cancelReason || d.invoiceExpectedDays !== null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
            {d.createdFromInvoice && <span>{PM_LABEL_CREATED_FROM_INVOICE}</span>}
            {d.cancelReason && <span>{PM_LABEL_CANCELLED_REASON}</span>}
            {d.invoiceExpectedDays !== null && (
              <span>{invoiceWaitLabel(d.invoiceExpectedDays)}</span>
            )}
          </div>
        )}
      </Card>

      {/* PR-D1b: the photo beside the form on wide screens, above it on narrow ones (single column first, two from lg). */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold text-gray-900">{PM_FIELD_FILES}</h2>
          <FileList files={d.files} />
        </Card>

        <div className="flex flex-col gap-6">
          {open && (
            <Card className="p-4">
              {/* Remount on any change of the loaded values so the form never keeps a stale draft (D8). Order: delivery type,
                  Approve / Reject (the children), then the collapsed "More details (optional)". */}
              <DetailsControls key={JSON.stringify(loaded)} deliveryId={d.id} loaded={loaded}>
                <DecisionControls deliveryId={d.id} hasStoredFile={d.hasStoredFile} />
              </DetailsControls>
            </Card>
          )}

          {(unlinkable.length > 0 || d.candidates.length > 0 || open) && (
            <Card className="flex flex-col gap-3 p-4">
              <h2 className="text-base font-semibold text-gray-900">{kind === 'invoice' ? PM_LINKED_DELIVERIES_HEADING : PM_INVOICES_HEADING}</h2>
              <LinkControls
                mode={kind === 'invoice' ? 'invoice' : 'dc'}
                invoiceDocumentId={kind === 'invoice' ? d.document.id : null}
                deliveryId={d.id}
                candidates={d.candidates}
                unlinkable={unlinkable}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}

function Row({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-700">{label}</dt>
      <dd className="text-gray-900" data-testid={testId}>
        {value}
      </dd>
    </div>
  )
}
