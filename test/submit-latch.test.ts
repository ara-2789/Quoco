// T-UX-1, T-UX-9, T-UX-10 (pure part) -- tap latch for the /login forms
// (docs/plans/login-otp-ux-plan.md, B1; review round 1: B1 safety release, S2
// shared latch). Pure unit tests: no Supabase, no network, no test-db, no
// React. Fake timers for the whole file so the latch's safety timer is never a
// real timer.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  LATCH_SAFETY_RELEASE_MS,
  createPendingObserver,
  createSubmitLatch,
} from '@/lib/auth/submit-latch'

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

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

  // Renamed (review round 1, N1): this row never involved React or a real
  // rejection reaching the observer. It pins what the observer actually does.
  it('observer releases on true->false regardless of cause', () => {
    const latch = createSubmitLatch()
    const observe = createPendingObserver(latch)

    expect(latch.tryEnter()).toBe(true)
    observe(true)
    observe(false) // the observer cannot tell success from failure, and need not
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

  it('notifies subscribers on enter and on release (what the buttons read)', () => {
    const latch = createSubmitLatch()
    const seen: boolean[] = []
    const unsubscribe = latch.subscribe(() => seen.push(latch.isHeld()))
    latch.tryEnter()
    latch.release()
    latch.release() // releasing a free latch is a no-op, no extra notification
    unsubscribe()
    latch.tryEnter()
    expect(seen).toEqual([true, false])
  })
})

describe('T-UX-9: safety release', () => {
  it('the documented timeout is 20 000 ms', () => {
    expect(LATCH_SAFETY_RELEASE_MS).toBe(20_000)
  })

  it('a held latch releases at 20 000 ms, not at 19 999', () => {
    const latch = createSubmitLatch()
    expect(latch.tryEnter()).toBe(true)

    vi.advanceTimersByTime(19_999)
    expect(latch.isHeld()).toBe(true)
    expect(latch.tryEnter()).toBe(false)

    vi.advanceTimersByTime(1) // t = 20 000
    expect(latch.isHeld()).toBe(false)
    expect(latch.tryEnter()).toBe(true)
  })

  it('subscribers are told when the timeout releases (so buttons re-enable)', () => {
    const latch = createSubmitLatch()
    const seen: boolean[] = []
    latch.subscribe(() => seen.push(latch.isHeld()))
    latch.tryEnter()
    vi.advanceTimersByTime(20_000)
    expect(seen).toEqual([true, false])
  })

  it('a normal release cancels the timer: it cannot release a LATER hold early', () => {
    const latch = createSubmitLatch()
    expect(latch.tryEnter()).toBe(true) // t = 0
    vi.advanceTimersByTime(5_000)
    latch.release() // action settled at t = 5 s
    expect(latch.tryEnter()).toBe(true) // second hold from t = 5 s
    vi.advanceTimersByTime(15_000) // t = 20 s: the FIRST timer would fire here
    expect(latch.isHeld()).toBe(true)
    vi.advanceTimersByTime(5_000) // t = 25 s = second hold's own 20 s
    expect(latch.isHeld()).toBe(false)
  })
})

describe('T-UX-10 (pure part): the code step shares one latch', () => {
  it('held by verify -> resend is refused; released only by the form that was pending', () => {
    const shared = createSubmitLatch()
    const observeVerify = createPendingObserver(shared)
    const observeResend = createPendingObserver(shared)

    expect(shared.tryEnter()).toBe(true) // verify tapped
    expect(shared.tryEnter()).toBe(false) // resend tapped inside the pending window

    observeVerify(true)
    observeResend(false) // the resend form never ran: it must not release verify's hold
    expect(shared.isHeld()).toBe(true)
    observeResend(false)
    expect(shared.isHeld()).toBe(true)

    observeVerify(false) // verify settled
    expect(shared.isHeld()).toBe(false)
    expect(shared.tryEnter()).toBe(true)
  })
})
