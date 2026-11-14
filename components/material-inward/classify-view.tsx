import Link from 'next/link'
import { Card } from '@/components/ui/card'
import type { PmClassifyDocument } from '@/lib/capture/pm-queries'
import { FileList } from './file-list'
import { ackLabel, ageInfo, formatIstDate, formatIstTime } from './labels'
import { ClassifyControls } from '@/app/(dashboard)/material-inward/classify-controls'
import {
  PM_BACK_TO_LIST,
  PM_CLASSIFY_HEADING,
  PM_FIELD_ACK,
  PM_FIELD_ACK_NOTE,
  PM_FIELD_ENGINEER,
  PM_FIELD_FILES,
  PM_FIELD_PROJECT,
  PM_FIELD_RECEIVED,
  PM_PAGE_TITLE,
} from '@/lib/capture/pm-copy'

// PR-D2 (D3): the classify page body, separate from the page so a test can render it from a plain PmClassifyDocument.
// NEUTRAL: the document has no kind yet, so no "DC" / "Invoice" word appears before the PM's choice, and the engineer's answer uses
// the neutral wording. The caption (a WhatsApp file name, D-30 F4) is never selected or shown. No "classified by / at" (D10).

export function ClassifyView({ doc, now }: { doc: PmClassifyDocument; now: Date }) {
  const age = ageInfo(doc.receivedAt, now)
  return (
    <div className="flex flex-col gap-6">
      <div>
        <Link href="/material-inward" className="text-sm text-blue-700 underline">
          {PM_BACK_TO_LIST}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-gray-900">{PM_PAGE_TITLE}</h1>
      </div>

      <Card className="flex flex-col gap-3 p-4">
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label={PM_FIELD_PROJECT} value={doc.projectName} />
          <Row label={PM_FIELD_RECEIVED} value={`${formatIstDate(doc.receivedAt)}, ${formatIstTime(doc.receivedAt)} · ${age.text}`} />
          <Row label={PM_FIELD_ENGINEER} value={doc.engineerName ?? '—'} />
          <Row label={PM_FIELD_ACK} value={ackLabel(null, doc.ack, null)} testId="own-ack" />
          {doc.ackNote && <Row label={PM_FIELD_ACK_NOTE} value={doc.ackNote} />}
        </dl>
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2 lg:items-start">
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold text-gray-900">{PM_FIELD_FILES}</h2>
          <FileList files={doc.files} />
        </Card>
        <Card className="flex flex-col gap-3 p-4">
          <h2 className="text-base font-semibold text-gray-900">{PM_CLASSIFY_HEADING}</h2>
          <ClassifyControls documentId={doc.id} hasStoredFile={doc.hasStoredFile} />
        </Card>
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
