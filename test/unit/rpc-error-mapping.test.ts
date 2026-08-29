import { describe, it, expect } from 'vitest'
import { classifyRpcError } from '@/lib/daily-logs/rpc-error-mapping'

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
