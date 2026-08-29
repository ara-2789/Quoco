'use client'

import { useReducer } from 'react'
import { Pencil } from 'lucide-react'
import { validateValue, formatValue } from '@/lib/daily-logs/correction'
import { fieldRowReducer, initialFieldRowState } from '@/lib/daily-logs/field-row-state'
import { formatIstTime } from '@/lib/daily-logs/date'
import { correctDailyLogField } from '@/app/(dashboard)/daily-logs/actions'

export type HolidayFieldProps = {
  dailyLogsId: string
  currentIsHoliday: boolean | null
  currentHolidayReason: string | null
  isHolidayEdit?: { oldValue: unknown; editedByName: string; editedAt: string }
  holidayReasonEdit?: { oldValue: unknown; editedByName: string; editedAt: string }
  morningSubmittedAt: string | null
  engineerName: string
  /** 030's attendance_defaulted/attendance_raw — the engineer's reply couldn't be
   *  parsed and the system chose a value. NOTE: types/database.ts hasn't been
   *  regenerated since 030 landed these columns — see the detail page's
   *  prerequisite-PR note. This prop is correct against the live schema. */
  attendanceDefaulted: boolean | null
  attendanceRaw: string | null
  canEdit: boolean
}

// The ONE deliberate exception to "one field per row, one RPC call per
// field": orchestrates is_holiday + holiday_reason together, because turning
// a day ON as a holiday requires a reason (product policy, not an RPC
// constraint) and the two must write in a specific order (reason first) so a
// failure between the two calls leaves a harmless intermediate state (a
// reason on a non-holiday day) rather than a holiday with no reason. Every
// other correctable column stays a plain, independent ScalarFieldRow.

function truncate(s: string, max = 80): string {
  return s.length > max ? `${s.slice(0, max)}…` : s
}

export function HolidayField({
  dailyLogsId,
  currentIsHoliday,
  currentHolidayReason,
  isHolidayEdit,
  holidayReasonEdit,
  morningSubmittedAt,
  engineerName,
  attendanceDefaulted,
  attendanceRaw,
  canEdit,
}: HolidayFieldProps) {
  const [holidayState, holidayDispatch] = useReducer(
    fieldRowReducer<boolean>,
    initialFieldRowState<boolean>(currentIsHoliday),
  )
  const [reasonState, reasonDispatch] = useReducer(
    fieldRowReducer<string>,
    initialFieldRowState<string>(currentHolidayReason),
  )

  const editing = holidayState.mode !== 'view' || reasonState.mode !== 'view'
  const saving = holidayState.mode === 'saving' || reasonState.mode === 'saving'

  const turningOn = holidayState.draftValue === true && holidayState.currentValue !== true
  const turningOff = holidayState.draftValue === false && holidayState.currentValue === true
  const reasonDraftText = (reasonState.draftValue ?? '').trim()
  const hasReason = reasonDraftText !== '' || (currentHolidayReason ?? '').trim() !== ''

  function startEdit() {
    holidayDispatch({ type: 'START_EDIT' })
    reasonDispatch({ type: 'START_EDIT' })
  }

  function cancel() {
    holidayDispatch({ type: 'CANCEL' })
    reasonDispatch({ type: 'CANCEL' })
  }

  async function saveReason(): Promise<boolean> {
    const validated = validateValue('holiday_reason', reasonState.draftValue)
    if (!validated.ok) {
      reasonDispatch({ type: 'SAVE_ERROR', message: validated.error })
      return false
    }
    reasonDispatch({ type: 'SUBMIT' })
    const result = await correctDailyLogField(dailyLogsId, 'holiday_reason', validated.value)
    if (result.status === 'saved') {
      reasonDispatch({ type: 'SAVE_SUCCESS', value: validated.value as string | null })
      return true
    }
    if (result.status === 'no-change') {
      reasonDispatch({ type: 'NO_CHANGE' })
      return true
    }
    reasonDispatch({ type: 'SAVE_ERROR', message: result.message })
    return false
  }

  async function saveHoliday(next: boolean): Promise<void> {
    const validated = validateValue('is_holiday', next)
    if (!validated.ok) {
      holidayDispatch({ type: 'SAVE_ERROR', message: validated.error })
      return
    }
    holidayDispatch({ type: 'SUBMIT' })
    const result = await correctDailyLogField(dailyLogsId, 'is_holiday', next)
    if (result.status === 'saved') holidayDispatch({ type: 'SAVE_SUCCESS', value: next })
    else if (result.status === 'no-change') holidayDispatch({ type: 'NO_CHANGE' })
    else holidayDispatch({ type: 'SAVE_ERROR', message: result.message })
  }

  async function handleSave() {
    const reasonChanged = reasonDraftText !== (currentHolidayReason ?? '').trim()

    if (turningOn) {
      // Reason-first ordering: a failure between the two calls leaves a
      // reason on a non-holiday day (harmless) rather than a holiday with no
      // reason. Save is disabled below until hasReason is true, so this
      // branch always has a reason to write (new or already-present).
      if (reasonChanged) {
        const ok = await saveReason()
        if (!ok) return // stop — is_holiday untouched
      }
      await saveHoliday(true)
      return
    }

    if (turningOff) {
      await saveHoliday(false)
      // holiday_reason is deliberately left untouched — not cleared, not
      // re-validated. Close its editing UI without writing anything.
      reasonDispatch({ type: 'CANCEL' })
      return
    }

    // is_holiday unchanged this session — an independent reason-only edit
    // (e.g. fixing a typo), or nothing changed at all.
    if (reasonChanged) {
      await saveReason()
    } else {
      cancel()
    }
  }

  const isHolidayProvenance = isHolidayEdit ? (
    <span className="text-xs text-gray-500">
      Corrected by {isHolidayEdit.editedByName}, {formatIstTime(isHolidayEdit.editedAt)} · was:{' '}
      {formatValue('is_holiday', isHolidayEdit.oldValue)}
    </span>
  ) : attendanceDefaulted === true ? (
    <span className="text-xs text-gray-500">
      {engineerName} replied &ldquo;{truncate(attendanceRaw ?? '')}&rdquo; — recorded as{' '}
      {currentIsHoliday ? 'holiday' : 'not a holiday'}.
    </span>
  ) : morningSubmittedAt ? (
    <span className="text-xs text-gray-500">
      As reported by {engineerName}, {formatIstTime(morningSubmittedAt)}
    </span>
  ) : null

  const reasonProvenance = holidayReasonEdit ? (
    <span className="text-xs text-gray-500">
      Added by {holidayReasonEdit.editedByName}, {formatIstTime(holidayReasonEdit.editedAt)}
      {holidayReasonEdit.oldValue ? ` · was: ${formatValue('holiday_reason', holidayReasonEdit.oldValue)}` : ''}
    </span>
  ) : null

  const errorMessage = holidayState.errorMessage ?? reasonState.errorMessage

  if (!editing) {
    return (
      <div className="flex items-start justify-between gap-3 py-3">
        <div className="min-w-0 flex-1 space-y-2">
          <div>
            <div className="text-xs font-medium text-gray-500">Holiday?</div>
            <div className="mt-0.5 text-sm text-gray-900">
              {holidayState.currentValue === null
                ? 'Not set'
                : holidayState.currentValue
                  ? 'Yes — site closed'
                  : 'No — working day'}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              {isHolidayProvenance}
              {holidayState.noChange && <span className="text-xs text-gray-400">No change.</span>}
            </div>
          </div>
          <div>
            <div className="text-xs font-medium text-gray-500">Reason</div>
            <div className="mt-0.5 text-sm text-gray-900 whitespace-pre-wrap break-words">
              {reasonState.currentValue ?? 'Not set'}
            </div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-2">
              {reasonProvenance}
              {reasonState.noChange && <span className="text-xs text-gray-400">No change.</span>}
            </div>
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

  const saveDisabled = saving || (turningOn && !hasReason) || (holidayState.draftValue === null)

  return (
    <div className="py-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-gray-500">Holiday?</span>
        <button
          type="button"
          onClick={cancel}
          disabled={saving}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 disabled:opacity-50"
        >
          Cancel
        </button>
      </div>

      <div className="flex gap-2" role="group" aria-label="Holiday?">
        {(['Yes', 'No'] as const).map((opt) => {
          const val = opt === 'Yes'
          const selected = holidayState.draftValue === val
          return (
            <button
              key={opt}
              type="button"
              disabled={saving}
              onClick={() => holidayDispatch({ type: 'CHANGE_DRAFT', value: val })}
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

      {turningOn && (
        <p className="mt-2 text-xs text-gray-600">
          Marking this day as a holiday removes it from {engineerName}&apos;s attendance pattern — it won&apos;t
          count as a missed check-in in any future report.
        </p>
      )}
      {turningOff && (
        <p className="mt-2 text-xs text-gray-600">
          This day will count toward {engineerName}&apos;s attendance pattern again in future reports.
        </p>
      )}

      <div className="mt-3">
        <label htmlFor={`${dailyLogsId}-holiday_reason`} className="text-xs font-medium text-gray-500">
          Reason
        </label>
        <textarea
          id={`${dailyLogsId}-holiday_reason`}
          disabled={saving}
          rows={2}
          value={reasonState.draftValue ?? ''}
          onChange={(e) => reasonDispatch({ type: 'CHANGE_DRAFT', value: e.target.value })}
          className="mt-1 w-full rounded-md border border-gray-200 px-3 py-2 text-base text-gray-900 disabled:opacity-50"
        />
        {turningOn && !hasReason && (
          <p className="mt-1 text-xs text-gray-400">Add a reason to mark this as a holiday.</p>
        )}
      </div>

      {errorMessage && <p className="mt-2 text-xs text-red-700">{errorMessage}</p>}

      <div className="mt-3 flex justify-end">
        <button
          type="button"
          onClick={handleSave}
          disabled={saveDisabled}
          className="rounded-md bg-gray-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-gray-800 disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  )
}
