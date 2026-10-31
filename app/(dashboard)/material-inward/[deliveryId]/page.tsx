import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getDeliveryDetail } from '@/lib/capture/pm-queries'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import { FileList } from '@/components/material-inward/file-list'
import { STATUS_CHIP, ackLabel, formatIstDate, isOpenStatus, typeLabel } from '@/components/material-inward/labels'
import {
  PM_BACK_TO_LIST,
  PM_FIELD_ACK,
  PM_FIELD_ACK_NOTE,
  PM_FIELD_CAPTION,
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
  PM_LABEL_INVOICE_EXPECTED,
  PM_LABEL_INVOICE_EXPECTED_DAYS,
  PM_LINKED_DELIVERIES_HEADING,
  PM_LOAD_ERROR,
  PM_PAGE_TITLE,
} from '@/lib/capture/pm-copy'
import { DecisionControls } from '../decision-controls'
import { DetailsControls } from '../details-controls'
import { LinkControls } from '../link-controls'

// PR-D: delivery detail. D2: never cached. A delivery that does not exist, belongs to another project or tenant, or is
// not visible to this viewer is the SAME 404 (RLS returns no row; getDeliveryDetail says 'not-found').
export const dynamic = 'force-dynamic'

export default async function MaterialInwardDetailPage({ params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params
  const supabase = await createClient()
  const profile = await getProfile()
  const result = await getDeliveryDetail(supabase, { id: profile.id, tenant_id: profile.tenant_id }, deliveryId, new Date())

  if (result.status === 'not-found') notFound()
  if (result.status === 'error') return <p className="text-sm text-gray-700">{PM_LOAD_ERROR}</p>

  const d = result.detail
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
      ? d.linkedDeliveries.map((l) => ({ linkId: l.linkId, receivedAt: l.receivedAt, dcNumber: l.dcNumber }))
      : d.activeLinks
          .filter((l) => l.linkSource === 'pm_manual')
          .map((l) => ({ linkId: l.linkId, receivedAt: d.linkedInvoice?.receivedAt ?? d.receivedAt, dcNumber: null }))

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
          <Row label={PM_FIELD_ACK} value={ackLabel(kind, d.document.ack)} />
          {d.document.ackNote && <Row label={PM_FIELD_ACK_NOTE} value={d.document.ackNote} />}
          {d.document.caption && <Row label={PM_FIELD_CAPTION} value={d.document.caption} />}
          {d.rejectReason && <Row label={PM_FIELD_REJECT_REASON} value={d.rejectReason} />}
        </dl>
        {(d.createdFromInvoice || d.cancelReason || d.invoiceExpectedDays !== null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
            {d.createdFromInvoice && <span>{PM_LABEL_CREATED_FROM_INVOICE}</span>}
            {d.cancelReason && <span>{PM_LABEL_CANCELLED_REASON}</span>}
            {d.invoiceExpectedDays !== null && (
              <span>
                {PM_LABEL_INVOICE_EXPECTED} {PM_LABEL_INVOICE_EXPECTED_DAYS} {d.invoiceExpectedDays}
              </span>
            )}
          </div>
        )}
      </Card>

      <Card className="flex flex-col gap-3 p-4">
        <h2 className="text-base font-semibold text-gray-900">{PM_FIELD_FILES}</h2>
        <FileList files={d.files} />
      </Card>

      {open && (
        <Card className="p-4">
          {/* Remount on any change of the loaded values so the form never keeps a stale draft (D8). */}
          <DetailsControls key={JSON.stringify(loaded)} deliveryId={d.id} loaded={loaded} />
        </Card>
      )}

      {open && (
        <Card className="p-4">
          <DecisionControls deliveryId={d.id} hasStoredFile={d.hasStoredFile} />
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
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col">
      <dt className="text-xs text-gray-700">{label}</dt>
      <dd className="text-gray-900">{value}</dd>
    </div>
  )
}
