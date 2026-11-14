'use client'

import { useState, useTransition } from 'react'
import { classifyDocumentAction } from './actions'
import {
  PM_CLASSIFY_AS_DC,
  PM_CLASSIFY_AS_INVOICE,
  PM_CLASSIFY_CONFIRM_NOTE,
  PM_CONFIRM_CLASSIFY_DC,
  PM_CONFIRM_CLASSIFY_INVOICE,
  PM_LABEL_FILE_PENDING,
  PM_PENDING_ACTION,
} from '@/lib/capture/pm-copy'

// PR-D2 classify controls: two kind buttons, then a confirm step with the set-once note, then the action.
//
// WAY BACK FROM THE CONFIRM STEP (D3): the approved reject confirm has no cancel string (decision-controls.tsx confirms by clicking the
// same button a second time), so no cancel text exists to reuse and none is invented. The two kind buttons are a TOGGLE instead: pressing
// the chosen one again clears the choice (back to the two buttons); pressing the other one changes the choice. Reported to Aravind as a
// deviation from D3's "reuse the cancel string" wording.
//
// D4: both buttons are disabled until the document has at least one stored file (PM_LABEL_FILE_PENDING is shown while it has none).
// Busy state: one useTransition, buttons disabled while pending (a convenience only; a true double submit is idempotent in the database:
// the second call returns already_classified with the same delivery). On success the server action redirects to the delivery; on a
// refusal it returns the mapped, named string, shown here and nothing else.

type Choice = 'dc' | 'invoice'

const KIND_BUTTON = 'inline-flex items-center justify-center rounded-md border px-4 py-3 text-sm font-medium disabled:opacity-60'
const KIND_BUTTON_ON = 'border-blue-600 bg-blue-50 text-blue-800'
const KIND_BUTTON_OFF = 'border-brand-border text-gray-900'

export function ClassifyControls({ documentId, hasStoredFile }: { documentId: string; hasStoredFile: boolean }) {
  const [isPending, startTransition] = useTransition()
  const [choice, setChoice] = useState<Choice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const blocked = isPending || !hasStoredFile

  function pick(c: Choice) {
    setError(null)
    setChoice((cur) => (cur === c ? null : c))
  }

  function confirm() {
    if (choice === null) return
    const kind = choice
    startTransition(async () => {
      setError(null)
      const result = await classifyDocumentAction(documentId, kind)
      if (result.status === 'error') setError(result.message)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-red-600" data-testid="classify-error">
          {error}
        </p>
      )}
      {!hasStoredFile && <p className="text-sm text-gray-700">{PM_LABEL_FILE_PENDING}</p>}
      <div className="flex flex-wrap gap-3">
        <button
          type="button"
          disabled={blocked}
          aria-pressed={choice === 'dc'}
          onClick={() => pick('dc')}
          className={`${KIND_BUTTON} ${choice === 'dc' ? KIND_BUTTON_ON : KIND_BUTTON_OFF}`}
        >
          {PM_CLASSIFY_AS_DC}
        </button>
        <button
          type="button"
          disabled={blocked}
          aria-pressed={choice === 'invoice'}
          onClick={() => pick('invoice')}
          className={`${KIND_BUTTON} ${choice === 'invoice' ? KIND_BUTTON_ON : KIND_BUTTON_OFF}`}
        >
          {PM_CLASSIFY_AS_INVOICE}
        </button>
      </div>
      {choice !== null && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-gray-900">{PM_CLASSIFY_CONFIRM_NOTE}</p>
          <button
            type="button"
            disabled={blocked}
            onClick={confirm}
            className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isPending ? PM_PENDING_ACTION : choice === 'invoice' ? PM_CONFIRM_CLASSIFY_INVOICE : PM_CONFIRM_CLASSIFY_DC}
          </button>
        </div>
      )}
    </div>
  )
}
