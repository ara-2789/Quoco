import { describe, it, expect } from 'vitest'
import { deriveDprArchiveStatus, type DprArchiveRowInput } from '@/lib/dpr/archive-status'

// Pure unit tests for the DASH-04 archive row status derivation. Covers all
// five states in the priority order the function checks them, plus the two
// precedence cases that prove content wins over stale status columns and
// failed beats the generic not_generated fallback.

const base: DprArchiveRowInput = {
  content: null,
  generation_status: 'idle',
  delivery_status: 'pending',
}

describe('deriveDprArchiveStatus', () => {
  it('content present -> generated/ok, regardless of status columns', () => {
    const s = deriveDprArchiveStatus({ ...base, content: 'EXECUTION OUTPUT\n...' })
    expect(s.state).toBe('generated')
    expect(s.variant).toBe('ok')
  })

  it('content present wins even over a failed delivery_status (precedence check)', () => {
    // Not the normal path (see archive-status.ts's header on how this could
    // arise), but content having ever been written is the one unambiguous
    // success signal — it must not be shadowed by a stale failed flag.
    const s = deriveDprArchiveStatus({ content: 'text', generation_status: 'idle', delivery_status: 'failed' })
    expect(s.state).toBe('generated')
  })

  it('generation_status running -> generating/muted', () => {
    const s = deriveDprArchiveStatus({ ...base, generation_status: 'running' })
    expect(s.state).toBe('generating')
    expect(s.variant).toBe('muted')
  })

  it('delivery_status failed -> failed/blocked (red)', () => {
    const s = deriveDprArchiveStatus({ ...base, delivery_status: 'failed' })
    expect(s.state).toBe('failed')
    expect(s.variant).toBe('blocked')
  })

  it('delivery_status skipped_no_data -> no_data/info (blue, never red)', () => {
    const s = deriveDprArchiveStatus({ ...base, delivery_status: 'skipped_no_data' })
    expect(s.state).toBe('no_data')
    expect(s.variant).toBe('info')
  })

  it('running beats failed when both somehow hold (running checked first)', () => {
    const s = deriveDprArchiveStatus({ content: null, generation_status: 'running', delivery_status: 'failed' })
    expect(s.state).toBe('generating')
  })

  it('row exists, content null, nothing else explains it -> not_generated/risk (amber)', () => {
    const s = deriveDprArchiveStatus(base)
    expect(s.state).toBe('not_generated')
    expect(s.variant).toBe('risk')
  })
})
