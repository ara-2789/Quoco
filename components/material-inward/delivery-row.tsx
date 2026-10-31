import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import type { PmListItem } from '@/lib/capture/pm-queries'
import {
  PM_FIELD_ACK,
  PM_FIELD_ENGINEER,
  PM_FIELD_FILES,
  PM_FIELD_VEHICLE,
  PM_KIND_DC,
  PM_KIND_INVOICE,
  PM_LABEL_CANCELLED_REASON,
  PM_LABEL_CREATED_FROM_INVOICE,
  PM_LABEL_INVOICE_EXPECTED,
  PM_LABEL_INVOICE_EXPECTED_DAYS,
} from '@/lib/capture/pm-copy'
import { STATUS_CHIP, ackLabel, formatIstDate, typeLabel } from './labels'

// One row of the Material Inward list. Links to the detail PAGE (an ordinary page route); file links live on the detail
// page only and are plain <a> tags (components/material-inward/file-list.tsx).

export function DeliveryRow({ item }: { item: PmListItem }) {
  const chip = STATUS_CHIP[item.status] ?? STATUS_CHIP.incomplete
  return (
    <Card className="p-4">
      <Link href={`/material-inward/${item.id}`} className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <StatusChip variant={chip.variant} label={chip.label} />
          <span className="text-sm font-medium text-gray-900">{item.kind === 'invoice' ? PM_KIND_INVOICE : PM_KIND_DC}</span>
          <span className="text-sm text-gray-700">{item.projectName}</span>
          <span className="text-sm text-gray-700">{formatIstDate(item.receivedAt)}</span>
          <span className="text-sm text-gray-900">{typeLabel(item.deliveryType)}</span>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
          {item.dcNumber && <span>{item.dcNumber}</span>}
          {item.vehicleNumber && (
            <span>
              {PM_FIELD_VEHICLE} {item.vehicleNumber}
            </span>
          )}
          <span>
            {PM_FIELD_ENGINEER} {item.engineerName ?? '—'}
          </span>
          <span>
            {PM_FIELD_ACK} {ackLabel(item.kind, item.ack)}
          </span>
          <span>
            {PM_FIELD_FILES} {item.fileCount}
          </span>
        </div>
        {(item.createdFromInvoice || item.cancelReason || item.invoiceExpectedDays !== null) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-700">
            {item.createdFromInvoice && <span>{PM_LABEL_CREATED_FROM_INVOICE}</span>}
            {item.cancelReason && <span>{PM_LABEL_CANCELLED_REASON}</span>}
            {item.invoiceExpectedDays !== null && (
              <span>
                {PM_LABEL_INVOICE_EXPECTED} {PM_LABEL_INVOICE_EXPECTED_DAYS} {item.invoiceExpectedDays}
              </span>
            )}
          </div>
        )}
      </Link>
    </Card>
  )
}
