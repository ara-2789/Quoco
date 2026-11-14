import Link from 'next/link'
import { Card } from '@/components/ui/card'
import { StatusChip } from '@/components/ui/status-chip'
import type { PmUnclassifiedResult } from '@/lib/capture/pm-queries'
import {
  PM_FIELD_ACK,
  PM_FIELD_ENGINEER,
  PM_FIELD_FILES,
  PM_LABEL_FILE_PENDING,
  PM_LOAD_ERROR,
  PM_AGE_OVERDUE,
  PM_UNCLASSIFIED_EMPTY,
  PM_UNCLASSIFIED_HEADING,
  PM_UNCLASSIFIED_TRUNCATED,
} from '@/lib/capture/pm-copy'
import { ackLabel, ageInfo, formatIstDate, formatIstTime } from './labels'

// PR-D2 (D1): documents the engineer sent that the PM has not classified yet, ABOVE the deliveries list. Oldest received first
// (the caller's query already orders them). Age is from capture_documents.received_at with the injected clock (D2). A row links to
// /material-inward/classify/<documentId>. Nothing here names a kind: an unclassified document has none (neutral labels only), and the
// engineer's answer uses the neutral wording (ackLabel(null, ack, null)). No caption, no phone number.
//
// A 'not-a-pm' result renders nothing: the page already shows PM_NOT_A_PM_STATE from the deliveries read.

export function UnclassifiedSection({ result, now }: { result: PmUnclassifiedResult; now: Date }) {
  if (result.status === 'not-a-pm') return null
  return (
    <section className="mb-8 flex flex-col gap-3" data-testid="unclassified-section">
      <h2 className="text-lg font-semibold text-gray-900">{PM_UNCLASSIFIED_HEADING}</h2>
      {result.status === 'error' ? (
        <p className="text-sm text-gray-700">{PM_LOAD_ERROR}</p>
      ) : result.items.length === 0 ? (
        <p className="text-sm text-gray-700">{PM_UNCLASSIFIED_EMPTY}</p>
      ) : (
        <>
          {result.items.map((item) => {
            const age = ageInfo(item.receivedAt, now)
            return (
              <Card key={item.documentId} className="p-4" data-testid="unclassified-row">
                <Link href={`/material-inward/classify/${item.documentId}`} className="flex flex-col gap-2">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span className="text-sm font-medium text-gray-900">{item.projectName}</span>
                    <span className="text-sm text-gray-700">
                      {formatIstDate(item.receivedAt)}, {formatIstTime(item.receivedAt)}
                    </span>
                    <span className="text-sm text-gray-700" data-testid="unclassified-age">
                      {age.text}
                    </span>
                    {age.overdue && <StatusChip variant="risk" label={PM_AGE_OVERDUE} />}
                  </div>
                  <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-gray-700">
                    <span>
                      {PM_FIELD_ENGINEER} {item.engineerName ?? '—'}
                    </span>
                    <span>
                      {PM_FIELD_ACK} {ackLabel(null, item.ack, null)}
                    </span>
                    <span>
                      {PM_FIELD_FILES} {item.fileCount}
                    </span>
                    {!item.hasStoredFile && <span>{PM_LABEL_FILE_PENDING}</span>}
                  </div>
                </Link>
              </Card>
            )
          })}
          {result.truncated && <p className="text-sm text-gray-700">{PM_UNCLASSIFIED_TRUNCATED}</p>}
        </>
      )}
    </section>
  )
}
