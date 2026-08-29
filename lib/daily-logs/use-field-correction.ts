'use client'

import { useCallback, useReducer } from 'react'
import { validateValue, type CorrectableColumn } from './correction'
import { fieldRowReducer, initialFieldRowState, type FieldRowState } from './field-row-state'
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
      dispatch({ type: 'SAVE_SUCCESS', value: validated.value as T | null })
    } else if (result.status === 'no-change') {
      dispatch({ type: 'NO_CHANGE' })
    } else {
      dispatch({ type: 'SAVE_ERROR', message: result.message })
    }
  }, [column, dailyLogsId, state.draftValue])

  return { state, startEdit, changeDraft, cancel, save }
}
