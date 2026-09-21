'use client'

import { useActionState, useState } from 'react'
import * as copy from '@/lib/engineers/copy'
import { MAX_LINES } from '@/lib/engineers/parse-roster'
import type { AddError, EngineerFormState } from '@/lib/engineers/add-engineers'
import { applyEngineersAction, previewEngineersAction } from './actions'
import { ConfirmQuestion, PreviewPanel, ResultPanel, fill } from './preview-panel'

// Add-engineer slice 1, PR A. Paste -> Preview -> Confirm -> Apply, in ONE
// client form (plan section 5; the U17 mechanics -- React 19 useActionState with
// a (prevState, formData) action -- were checked against the installed Next
// 16.2.11 / React 19.2.4 docs and types before this was written).
//
// ONE state, one source of truth: a single useActionState whose action routes by
// the submitter button's `intent` to the preview or the apply Server Action.
//
// Every response carries a fresh `nonce`. The attestation tick and the "go back
// and edit" toggle are keyed to the CURRENT nonce, so any new response clears
// both -- a new list needs a new attestation (plan 5.2) -- with no effect.
//
// Every user-facing string is from lib/engineers/copy.ts; the only exception is
// the singular confirm prompt, which lives in preview-panel.tsx (plan 9a(a)).

const IDLE: EngineerFormState = { kind: 'idle' }

async function routeByIntent(_previous: EngineerFormState, formData: FormData): Promise<EngineerFormState> {
  return formData.get('intent') === 'apply' ? applyEngineersAction(formData) : previewEngineersAction(formData)
}

function errorText(error: AddError): string {
  return error === 'tooManyLines' ? fill(copy.errors.tooManyLines, { n: MAX_LINES }) : copy.errors[error]
}

function noticeText(notice: 'list_changed' | 'batch_failed'): string {
  return notice === 'list_changed' ? copy.errors.listChanged : copy.result.batchFailed
}

export function AddEngineersForm({ projectId }: { projectId: string }) {
  const [state, formAction, pending] = useActionState(routeByIntent, IDLE)
  const [tickedFor, setTickedFor] = useState<string | null>(null)
  const [editingFor, setEditingFor] = useState<string | null>(null)

  if (state.kind === 'applied') return <ResultPanel added={state.added} />

  const preview = state.kind === 'preview' && editingFor !== state.nonce ? state : null
  const ticked = preview !== null && tickedFor === preview.nonce
  const pastedText = state.kind === 'preview' || state.kind === 'error' ? state.raw : ''
  const textareaKey = state.kind === 'idle' ? 'idle' : state.nonce

  return (
    <form action={formAction} className="space-y-4">
      <input type="hidden" name="projectId" value={projectId} />

      {state.kind === 'error' && (
        <p role="alert" className="text-sm text-red-700">
          {errorText(state.error)}
        </p>
      )}
      {state.kind === 'preview' && state.notice !== null && (
        <p role="alert" className="text-sm text-red-700">
          {noticeText(state.notice)}
        </p>
      )}

      {preview !== null ? (
        <>
          <input type="hidden" name="raw" value={preview.raw} />
          <input type="hidden" name="carried" value={JSON.stringify(preview.carried)} />
          <input type="hidden" name="pasted" value={JSON.stringify(preview.pasted)} />
          <PreviewPanel rows={preview.rows} />

          {preview.carried.length > 0 && (
            <div className="space-y-3">
              <ConfirmQuestion count={preview.carried.length} />
              <label className="flex items-start gap-2 text-sm text-gray-900">
                <input
                  type="checkbox"
                  name="consent"
                  className="mt-1"
                  checked={ticked}
                  onChange={(e) => setTickedFor(e.target.checked ? preview.nonce : null)}
                />
                <span>{copy.confirm.attestation}</span>
              </label>
              <button
                type="submit"
                name="intent"
                value="apply"
                disabled={!ticked || pending}
                className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
              >
                {copy.page.applyButton}
              </button>
            </div>
          )}

          <button
            type="button"
            onClick={() => setEditingFor(preview.nonce)}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-900"
          >
            {copy.page.editButton}
          </button>
        </>
      ) : (
        <>
          <div>
            <label htmlFor="raw" className="block text-sm font-medium text-gray-900 mb-1">
              {copy.page.textareaLabel}
            </label>
            <textarea
              key={textareaKey}
              id="raw"
              name="raw"
              defaultValue={pastedText}
              rows={10}
              className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-900"
            />
          </div>
          <button
            type="submit"
            name="intent"
            value="preview"
            disabled={pending}
            className="rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {copy.page.previewButton}
          </button>
        </>
      )}
    </form>
  )
}
