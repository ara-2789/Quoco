import type { PmFileItem } from '@/lib/capture/pm-queries'
import {
  PM_FILE_DOWNLOAD,
  PM_FILE_OPEN,
  PM_FILE_UNAVAILABLE,
  PM_LABEL_FILE_FAILED,
  PM_LABEL_FILE_PENDING,
  PM_LABEL_FILE_PENDING_TIMEOUT,
  PM_LABEL_FILE_REJECTED_SIZE,
  PM_LABEL_FILE_REJECTED_TYPE,
  PM_LABEL_PDF_NOT_PREVIEWABLE,
} from '@/lib/capture/pm-copy'

// D3: a stored file is opened ONLY through a plain <a target="_blank" rel="noopener noreferrer"> pointing at
// /api/capture-files/<id>. No next/image, no next/link to the route, no image element, no signed URL anywhere in this markup:
// the URL is minted by the route when the PM clicks. Files that are not stored have no object, so no link, only a label.

const NOT_STORED_LABEL: Record<Exclude<PmFileItem['display'], 'stored'>, string> = {
  pending: PM_LABEL_FILE_PENDING,
  pending_timeout: PM_LABEL_FILE_PENDING_TIMEOUT,
  failed: PM_LABEL_FILE_FAILED,
  rejected_type: PM_LABEL_FILE_REJECTED_TYPE,
  rejected_size: PM_LABEL_FILE_REJECTED_SIZE,
}

export function FileList({ files }: { files: PmFileItem[] }) {
  if (files.length === 0) return <p className="text-sm text-gray-700">{PM_FILE_UNAVAILABLE}</p>
  return (
    <ul className="flex flex-col gap-2">
      {files.map((f) => (
        <li key={f.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-900">
          <span className="font-medium">{f.fileNo}</span>
          {f.display === 'stored' ? (
            <>
              <a
                href={`/api/capture-files/${f.id}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-700 underline"
              >
                {f.previewState === 'not_previewable' ? PM_FILE_DOWNLOAD : PM_FILE_OPEN}
              </a>
              {f.previewState === 'not_previewable' && <span className="text-gray-700">{PM_LABEL_PDF_NOT_PREVIEWABLE}</span>}
            </>
          ) : (
            <span className="text-gray-700">{NOT_STORED_LABEL[f.display]}</span>
          )}
        </li>
      ))}
    </ul>
  )
}
