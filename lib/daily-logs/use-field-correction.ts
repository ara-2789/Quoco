'use client'

import { useCallback, useReducer } from 'react'
import { useRouter } from 'next/navigation'
import { validateValue, type CorrectableColumn } from './correction'
import { fieldRowReducer, initialFieldRowState, shouldRefreshAfter, type FieldRowState } from './field-row-state'
import { correctDailyLogField } from '@/app/(dashboard)/daily-logs/actions'

// Client hook wiring field-row-state.ts's pure reducer to the
// correctDailyLogField Server Action. Shared by ScalarFieldRow and
// HolidayField's two sub-fields — the ONE seam where the RPC contract
// (no-op -> null, SQL NULL clears, 42501/program_limit_exceeded/no_data_found
// mapping) is actually handled, so both components get identical
// saving/error/no-change mechanics without duplicating them.

export type UseFieldCorrection<T> = {
  state: FieldRowState<T>
  startEdit: () => void
  changeDraft: (value: T | null) => void
  cancel: () => void
  /** Validates client-side first (no network call on failure), then submits. */
  save: () => Promise<void>
}

export function useFieldCorrection<T extends boolean | number | string>(
  dailyLogsId: string,
  column: CorrectableColumn,
  initialValue: T | null,
): UseFieldCorrection<T> {
  const [state, dispatch] = useReducer(fieldRowReducer<T>, initialFieldRowState<T>(initialValue))
  const router = useRouter()

  const startEdit = useCallback(() => dispatch({ type: 'START_EDIT' }), [])
  const changeDraft = useCallback((value: T | null) => dispatch({ type: 'CHANGE_DRAFT', value }), [])
  const cancel = useCallback(() => dispatch({ type: 'CANCEL' }), [])

  const save = useCallback(async () => {
    const validated = validateValue(column, state.draftValue)
    if (!validated.ok) {
      dispatch({ type: 'SAVE_ERROR', message: validated.error })
      return
    }

    dispatch({ type: 'SUBMIT' })
    const result = await correctDailyLogField(dailyLogsId, column, validated.value)

    if (result.status === 'saved') {
      // Local state first — the row shows the new value immediately, no
      // waiting on the refresh. Then router.refresh() so the server
      // component re-fetches getDailyLogDetail and this row's `edit` PROP
      // (the provenance line — "Corrected by you, <time> · was: <old>")
      // actually updates: `edit` is a prop, re-derived fresh on every
      // render in ScalarFieldRow/HolidayField, never cached into this
      // reducer's own state, so without this refresh the prop simply never
      // changes and the provenance line stays whatever it was at page
      // load — this is the bug a manual walkthrough of PR #137 found.
      // router.refresh() delivers new props to this same component
      // instance (no remount), so `state` here is untouched by it.
      dispatch({ type: 'SAVE_SUCCESS', value: validated.value as T | null })
      if (shouldRefreshAfter(result.status)) router.refresh()
    } else if (result.status === 'no-change') {
      dispatch({ type: 'NO_CHANGE' })
    } else {
      dispatch({ type: 'SAVE_ERROR', message: result.message })
    }
  }, [column, dailyLogsId, router, state.draftValue])

  return { state, startEdit, changeDraft, cancel, save }
}
