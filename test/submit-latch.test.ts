// T-UX-1 -- tap latch for the /login forms (docs/plans/login-otp-ux-plan.md,
// B1). Pure unit test: no Supabase, no network, no test-db, no React.
import { describe, expect, it } from 'vitest'
import { createPendingObserver, createSubmitLatch } from '@/lib/auth/submit-latch'

describe('T-UX-1: submit latch', () => {
  it('the first enter wins; a second enter while held is refused', () => {
    const latch = createSubmitLatch()
    expect(latch.tryEnter()).toBe(true)
    expect(latch.tryEnter()).toBe(false)
    expect(latch.tryEnter()).toBe(false)
  })

  it('is released after the action settles (pending true -> false)', () => {
    const latch = createSubmitLatch()
    const observe = createPendingObserver(latch)

    expect(latch.tryEnter()).toBe(true) // tap
    observe(false) // not pending yet: must NOT release (the tap is still in flight)
    expect(latch.tryEnter()).toBe(false)
    observe(true) // action running
    expect(latch.tryEnter()).toBe(false)
    observe(false) // action settled
    expect(latch.tryEnter()).toBe(true)
  })

  it('is released when the action THROWS: the pending flag falls on every outcome', async () => {
    const latch = createSubmitLatch()
    const observe = createPendingObserver(latch)
    const failingAction = async () => {
      throw new Error('simulated network failure')
    }

    expect(latch.tryEnter()).toBe(true)
    observe(true)
    await expect(failingAction()).rejects.toThrow('simulated network failure')
    observe(false) // React clears pending when the action rejects, same as on success
    expect(latch.tryEnter()).toBe(true)
  })

  it('a false -> false observation never releases', () => {
    const latch = createSubmitLatch()
    const observe = createPendingObserver(latch)
    expect(latch.tryEnter()).toBe(true)
    observe(false)
    observe(false)
    expect(latch.tryEnter()).toBe(false)
  })
})
