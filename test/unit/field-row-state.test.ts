import { describe, it, expect } from 'vitest'
import { fieldRowReducer, initialFieldRowState, shouldRefreshAfter } from '@/lib/daily-logs/field-row-state'

describe('fieldRowReducer', () => {
  it('starts in view with the given current value', () => {
    const s = initialFieldRowState<string>('cloudy')
    expect(s).toEqual({ mode: 'view', currentValue: 'cloudy', draftValue: null, noChange: false, errorMessage: null })
  })

  it('START_EDIT copies currentValue into draftValue and clears noChange/error', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'NO_CHANGE' }) // put a stale noChange flag up first
    expect(s.noChange).toBe(true)
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    expect(s).toMatchObject({ mode: 'editing', draftValue: 'cloudy', noChange: false, errorMessage: null })
  })

  it('CHANGE_DRAFT updates draftValue and clears a stale error', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'SAVE_ERROR', message: 'oops' })
    expect(s.errorMessage).toBe('oops')
    s = fieldRowReducer(s, { type: 'CHANGE_DRAFT', value: 'sunny' })
    expect(s.draftValue).toBe('sunny')
    expect(s.errorMessage).toBeNull()
  })

  it('CANCEL returns to view without touching currentValue', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'CHANGE_DRAFT', value: 'sunny' })
    s = fieldRowReducer(s, { type: 'CANCEL' })
    expect(s).toMatchObject({ mode: 'view', currentValue: 'cloudy', draftValue: null, errorMessage: null })
  })

  it('SUBMIT moves to saving and clears any error', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    expect(s.mode).toBe('saving')
    expect(s.errorMessage).toBeNull()
  })

  it('SAVE_SUCCESS returns to view with the new currentValue — no separate "saved" mode', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'CHANGE_DRAFT', value: 'sunny' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    s = fieldRowReducer(s, { type: 'SAVE_SUCCESS', value: 'sunny' })
    expect(s).toEqual({ mode: 'view', currentValue: 'sunny', draftValue: null, noChange: false, errorMessage: null })
  })

  it('NO_CHANGE returns to view with noChange true and currentValue UNCHANGED — provenance is never overwritten', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'CHANGE_DRAFT', value: 'cloudy' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    s = fieldRowReducer(s, { type: 'NO_CHANGE' })
    expect(s.mode).toBe('view')
    expect(s.currentValue).toBe('cloudy') // untouched — the caller's provenance line stays valid
    expect(s.noChange).toBe(true)
  })

  it('NO_CHANGE flag is cleared by the next START_EDIT, not by a timer', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    s = fieldRowReducer(s, { type: 'NO_CHANGE' })
    expect(s.noChange).toBe(true)
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    expect(s.noChange).toBe(false)
  })

  it('SAVE_ERROR returns to EDITING (not a fourth mode), preserving draftValue and currentValue', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'CHANGE_DRAFT', value: 'sunny' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    s = fieldRowReducer(s, { type: 'SAVE_ERROR', message: "That's too long to save." })
    expect(s.mode).toBe('editing')
    expect(s.draftValue).toBe('sunny') // preserved — the PM doesn't lose what they typed
    expect(s.currentValue).toBe('cloudy') // untouched — the write never happened
    expect(s.errorMessage).toBe("That's too long to save.")
  })

  it('a retry after SAVE_ERROR (CANCEL then re-edit, or direct SUBMIT again) can still succeed', () => {
    let s = initialFieldRowState<string>('cloudy')
    s = fieldRowReducer(s, { type: 'START_EDIT' })
    s = fieldRowReducer(s, { type: 'CHANGE_DRAFT', value: 'sunny' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    s = fieldRowReducer(s, { type: 'SAVE_ERROR', message: 'network blip' })
    s = fieldRowReducer(s, { type: 'SUBMIT' })
    expect(s.mode).toBe('saving')
    s = fieldRowReducer(s, { type: 'SAVE_SUCCESS', value: 'sunny' })
    expect(s).toMatchObject({ mode: 'view', currentValue: 'sunny' })
  })
})

// PR #137 manual-walkthrough finding: a successful save updated the row's
// VALUE (optimistic reducer state, above) but never its PROVENANCE line,
// because `edit` is a server-rendered prop, re-derived fresh on every
// render, never captured into this reducer — so without a refresh it just
// never changes, and a PM's own edit rendered under the engineer's old
// "As reported by" line. router.refresh() itself can't run under plain
// vitest (needs next/navigation's app-router client context), so this pure
// decision is the testable seam — same pattern as classifyRpcError's
// reportToSentry flag vs. the actual Sentry.captureException call.
describe('shouldRefreshAfter', () => {
  it('saved -> true (the ONLY case that warrants a refresh)', () => {
    expect(shouldRefreshAfter('saved')).toBe(true)
  })

  it('no-change -> false (nothing changed; the server-rendered page is already accurate)', () => {
    expect(shouldRefreshAfter('no-change')).toBe(false)
  })

  it('error -> false (the write never happened)', () => {
    expect(shouldRefreshAfter('error')).toBe(false)
  })
})
