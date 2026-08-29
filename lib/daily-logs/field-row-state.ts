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

/**
 * Whether a correctDailyLogField result warrants a refresh — TRUE only for
 * an actual write ('saved'). Never for 'no-change' (nothing changed; the
 * server-rendered page is already accurate) and never for 'error' (the
 * write never happened). Extracted as its own pure function, next to the
 * reducer, rather than left inline where router.refresh() is actually
 * called (lib/daily-logs/use-field-correction.ts, components/daily-logs/
 * holiday-field.tsx) — router.refresh() itself needs next/navigation's
 * app-router client context and can't be exercised under plain vitest, so
 * this is the seam that CAN be unit-tested (test/unit/field-row-state.test.ts),
 * same pattern lib/daily-logs/rpc-error-mapping.ts already established for
 * classifyRpcError vs. the actual Sentry.captureException call.
 *
 * NOTE for HolidayField specifically: its turn-on path can make up to two
 * correctDailyLogField calls (reason, then is_holiday). The caller must
 * call this once per RESULT and OR the outcomes together, then refresh at
 * most ONCE for the whole user action — not once per sub-write — since a
 * reason-then-holiday save that both succeed should still produce a single
 * refresh, not two.
 */
export function shouldRefreshAfter(status: 'saved' | 'no-change' | 'error'): boolean {
  return status === 'saved'
}
