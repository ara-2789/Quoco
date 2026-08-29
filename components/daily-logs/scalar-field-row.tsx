'use client'

import { Pencil } from 'lucide-react'
import { COLUMN_CONTRACT, formatValue, type CorrectableColumn } from '@/lib/daily-logs/correction'
import { useFieldCorrection } from '@/lib/daily-logs/use-field-correction'
import { formatIstTime } from '@/lib/daily-logs/date'

export type ScalarFieldRowProps = {
  dailyLogsId: string
  column: CorrectableColumn
  label: string
  currentValue: unknown
  edit?: { oldValue: unknown; editedByName: string; editedAt: string }
  /** morning_submitted_at or evening_submitted_at, whichever half this column belongs to. */
  submittedAt: string | null
  engineerName: string
  /** role === 'pm' — gates the [Edit] affordance entirely (absent, not disabled). */
  canEdit: boolean
}

// Generic one-field-per-row editor for the 6 non-holiday correctable columns
// (is_holiday/holiday_reason use HolidayField's bespoke orchestration — see
// that component). One RPC call per field, no multi-field form.

function isEmptyDraft(castType: 'boolean' | 'integer' | 'text', draft: unknown): boolean {
  if (castType === 'boolean') return false // no Clear on booleans — see below
  if (draft === null || draft === undefined) return true
  return String(draft).trim() === ''
}

export function ScalarFieldRow({
  dailyLogsId,
  column,
  label,
  currentValue,
  edit,
  submittedAt,
  engineerName,
  canEdit,
}: ScalarFieldRowProps) {
  const castType = COLUMN_CONTRACT[column]
  const { state, startEdit, changeDraft, cancel, save } = useFieldCorrection<boolean | number | string>(
    dailyLogsId,
    column,
    currentValue as boolean | number | string | null,
  )

  const inputId = `${dailyLogsId}-${column}`
  const displayValue =
    state.currentValue === null || state.currentValue === undefined
      ? 'Not set'
      : formatValue(column, state.currentValue)

  const provenance = edit ? (
    <span className="text-xs text-gray-500">
      Corrected by {edit.editedByName}, {formatIstTime(edit.editedAt)} · was: {formatValue(column, edit.oldValue)}
    </span>
  ) : submittedAt ? (
    <span className="text-xs text-gray-500">
      As reported by {engineerName}, {formatIstTime(submittedAt)}
    </span>
  ) : null

  if (state.mode === 'view') {
    return (
      <div className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-gray-500">{label}</div>
          <div className="mt-0.5 text-sm text-gray-900 whitespace-pre-wrap break-words">{displayValue}</div>
          <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
            {provenance}
            {state.noChange && <span className="text-xs text-gray-400">No change.</span>}
          </div>
        </div>
        {canEdit && (
          <button
            type="button"
            onClick={startEdit}
            className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-gray-700"
          >
            <Pencil className="h-3 w-3" aria-hidden="true" />
            Edit
          </button>
        )}
      </div>
    )
  }

  // editing / saving
  const saving = state.mode === 'saving'
  const clearing = isEmptyDraft(castType, state.draftValue)

  return (
    <div className="py-3">
      <div className="mb-1 flex items-center justify-between">
        <label htmlFor={inputId} className="text-xs font-medium text-gray-500">
          {label}
        </label>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      {castType === 'boolean' ? (
        <div className="flex gap-2" role="group" aria-label={label}>
          {(['Yes', 'No'] as const).map((opt) => {
            const val = opt === 'Yes'
            const selected = state.draftValue === val
            return (
              <button
                key={opt}
                type="button"
                disabled={saving}
                onClick={() => changeDraft(val)}
                className={`rounded-md border px-3 py-2 text-sm font-medium ${
                  selected
                    ? 'border-gray-900 bg-gray-900 text-white'
                    : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50'
                } disabled:opacity-50`}
              >
                {opt}
              </button>
            )
          })}
        </div>
      ) : castType === 'integer' ? (
        <input
          id={inputId}
          type="number"
          inputMode="numeric"
          min={0}
          step={1}
          disabled={saving}
          value={state.draftValue === null || state.draftValue === undefined ? '' : String(state.draftValue)}
          onChange={(e) => changeDraft(e.target.value === '' ? null : Number(e.target.value))}
          className="w-full rounded-md border border-gray-200 px-3 py-2 text-base text-gray-900 disabled:opacity-50"
        />
      ) : (
        <textarea
          id={inputId}
          disabled={saving}
          rows={3}
          value={(state.draftValue as string | null) ?? ''}
          onChange={(e) => changeDraft(e.target.value)}
          autoFocus
          className="w-full rounded-md border border-gray-200 px-3 py-2 text-base text-gray-900 disabled:opacity-50"
        />
      )}

      {state.errorMessage && <p className="mt-1 text-xs text-red-700">{state.errorMessage}</p>}

      <div className="mt-2 flex justify-end">
        <button
          type="button"
          onClick={save}
          disabled={saving || (castType === 'boolean' && state.draftValue === null)}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : clearing ? 'Clear' : 'Save'}
        </button>
      </div>
    </div>
  )
}
