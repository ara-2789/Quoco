import { describe, it, expect } from 'vitest'
import { decideInboundGate } from '@/lib/whatsapp/reactivation'

// Pure unit tests for the BOT-27 reactivation gate decision (clear-half). The
// safety-critical case is deactivated+blocked -> gated_noop: a non-active
// engineer must NEVER be reactivated by texting in.

describe('decideInboundGate', () => {
  it('active + messaging_blocked -> reactivate (clear the block)', () => {
    expect(decideInboundGate({ status: 'active', messaging_blocked: true })).toBe('reactivate')
  })

  it('active + not blocked -> proceed (normal flow)', () => {
    expect(decideInboundGate({ status: 'active', messaging_blocked: false })).toBe('proceed')
  })

  it('pending + blocked -> gated_noop (no reactivation before opt-in)', () => {
    expect(decideInboundGate({ status: 'pending', messaging_blocked: true })).toBe('gated_noop')
  })

  it('pending + not blocked -> gated_noop', () => {
    expect(decideInboundGate({ status: 'pending', messaging_blocked: false })).toBe('gated_noop')
  })

  it('SAFETY: deactivated + blocked -> gated_noop, NEVER reactivate', () => {
    // A deactivated (e.g. removed) engineer who is also blocked must not be
    // silently reactivated by messaging in — status gates ahead of the flag.
    expect(decideInboundGate({ status: 'deactivated', messaging_blocked: true })).toBe('gated_noop')
  })

  it('deactivated + not blocked -> gated_noop', () => {
    expect(decideInboundGate({ status: 'deactivated', messaging_blocked: false })).toBe('gated_noop')
  })
})
