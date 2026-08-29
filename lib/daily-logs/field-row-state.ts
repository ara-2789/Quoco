// Pure state machine for one correctable field row (ScalarFieldRow /
// HolidayField's two sub-fields). No React, no fetch — unit-tested directly
// (test/unit/field-row-state.test.ts). This is the ONLY way this logic is
// testable in this repo: there is no @testing-library, jsdom, or happy-dom in
// package.json, so a DOM-rendering test isn't available. Keep this reducer
// separate from the component even though it's small — it's the one place
// the row's save/error/no-change transitions can be asserted without a
// browser.
//
// Three modes only, not the five the surface has visible states for:
//   - 'saved' is NOT a mode. On success the row returns straight to 'view'
//     with the new currentValue — the updated provenance line IS the save
//     confirmation, no separate toast/timer.
//   - 'no-change' is NOT a mode either. It's the `noChange` flag on 'view' —
//     shown BESIDE the (unchanged) provenance line, never replacing it, and
//     cleared by the next START_EDIT, not by a timer.
//   - 'error' is NOT a mode. A failed save returns to 'editing' with
//     `errorMessage` set — the brief's own words are "stays in editing, value
//     preserved" — so error is a flag on 'editing', not a fourth mode.

export type FieldRowMode = 'view' | 'editing' | 'saving'

export type FieldRowState<T> = {
  mode: FieldRowMode
  /** The last known-good value (post any successful save, or the initial server-rendered value). */
  currentValue: T | null
  /** The value being edited. Only meaningful while mode is 'editing' or 'saving'. */
  draftValue: T | null
  /** True immediately after a no-op RPC result; cleared on the next START_EDIT. Relevant only in 'view'. */
  noChange: boolean
  /** Set on a failed save; relevant only in 'editing' (a failed save always returns here, never to 'saving'). */
  errorMessage: string | null
}

export type FieldRowAction<T> =
  | { type: 'START_EDIT' }
  | { type: 'CHANGE_DRAFT'; value: T | null }
  | { type: 'CANCEL' }
  | { type: 'SUBMIT' }
  | { type: 'SAVE_SUCCESS'; value: T | null }
  | { type: 'NO_CHANGE' }
  | { type: 'SAVE_ERROR'; message: string }

export function initialFieldRowState<T>(currentValue: T | null): FieldRowState<T> {
  return { mode: 'view', currentValue, draftValue: null, noChange: false, errorMessage: null }
}

export function fieldRowReducer<T>(
  state: FieldRowState<T>,
  action: FieldRowAction<T>,
): FieldRowState<T> {
  switch (action.type) {
    case 'START_EDIT':
      return {
        ...state,
        mode: 'editing',
        draftValue: state.currentValue,
        noChange: false,
        errorMessage: null,
      }

    case 'CHANGE_DRAFT':
      // Clear a stale error once the PM starts changing the value again —
      // the old error referred to the old draft, not this one.
      return { ...state, draftValue: action.value, errorMessage: null }

    case 'CANCEL':
      return { ...state, mode: 'view', draftValue: null, errorMessage: null }

    case 'SUBMIT':
      return { ...state, mode: 'saving', errorMessage: null }

    case 'SAVE_SUCCESS':
      return {
        ...state,
        mode: 'view',
        currentValue: action.value,
        draftValue: null,
        noChange: false,
        errorMessage: null,
      }

    case 'NO_CHANGE':
      return { ...state, mode: 'view', draftValue: null, noChange: true, errorMessage: null }

    case 'SAVE_ERROR':
      // Deliberately back to 'editing', not a fourth mode — draftValue (and
      // therefore whatever the PM typed) is untouched, currentValue is
      // untouched (the write never happened).
      return { ...state, mode: 'editing', errorMessage: action.message }

    default:
      return state
  }
}
