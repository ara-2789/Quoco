import { describe, it, expect } from 'vitest'
import { classifyRpcError, forbiddenBecauseNotPm, FORBIDDEN_MESSAGE } from '@/lib/daily-logs/rpc-error-mapping'
import { canEditLog } from '@/lib/daily-logs/correction'

describe('classifyRpcError', () => {
  it('42501 -> forbidden, reported (defense-in-depth signal now that the role gate exists)', () => {
    const result = classifyRpcError({ code: '42501', message: 'permission denied for function' })
    expect(result.kind).toBe('forbidden')
    expect(result.reportToSentry).toBe(true)
    expect(result.message).not.toMatch(/permission denied for function/) // never the raw Postgres text
  })

  it('P0002 -> not-found, NOT reported (legitimate concurrent-edit race, distinct from 42501)', () => {
    const result = classifyRpcError({ code: 'P0002', message: 'no daily_logs row abc' })
    expect(result.kind).toBe('not-found')
    expect(result.reportToSentry).toBe(false)
  })

  it('54000 -> too-large, reported (client validation should have caught this first)', () => {
    const result = classifyRpcError({ code: '54000', message: 'new_value too large (150000 bytes, cap 100000)' })
    expect(result.kind).toBe('too-large')
    expect(result.reportToSentry).toBe(true)
    expect(result.message).not.toMatch(/150000/) // never the raw Postgres text
  })

  it('unmapped code -> unknown, reported, generic copy only', () => {
    const result = classifyRpcError({ code: '23505', message: 'duplicate key value violates unique constraint' })
    expect(result.kind).toBe('unknown')
    expect(result.reportToSentry).toBe(true)
    expect(result.message).not.toMatch(/duplicate key/)
  })

  it('missing code entirely -> unknown, reported', () => {
    const result = classifyRpcError({ message: 'network error' })
    expect(result.kind).toBe('unknown')
    expect(result.reportToSentry).toBe(true)
  })
})

describe('forbiddenBecauseNotPm (the PRE-RPC role check in correctDailyLogField)', () => {
  it('a qs-role project member is forbidden via the pure pre-check, same copy as the post-gate 42501 path — but structurally incapable of a Sentry report', () => {
    // The condition this branch actually gates on:
    expect(canEditLog('qs')).toBe(false)
    expect(canEditLog('admin')).toBe(false)
    expect(canEditLog('pm')).toBe(true)

    const preCheck = forbiddenBecauseNotPm()
    expect(preCheck).toEqual({ kind: 'forbidden', message: FORBIDDEN_MESSAGE })

    // Message parity with the RPC's own 42501 mapping — one shared constant,
    // not two literals that could silently drift apart.
    const postGate = classifyRpcError({ code: '42501', message: 'permission denied for function' })
    expect(preCheck.message).toBe(postGate.message)

    // Unlike classifyRpcError's result, this one carries no `reportToSentry`
    // field at all — there is nothing for a caller to report, which is the
    // structural proof (not a mock) that an ordinary non-PM project member
    // reaching this Server Action never fires Sentry. Only a 42501 the RPC
    // returns AFTER this check has already passed does that.
    expect('reportToSentry' in preCheck).toBe(false)
  })
})
