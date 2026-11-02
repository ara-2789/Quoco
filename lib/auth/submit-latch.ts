// Tap latch for the /login forms (docs/plans/login-otp-ux-plan.md, B1/B3).
//
// WHY A LATCH AND NOT `disabled` ALONE: a disabled button only takes effect
// after React re-renders. Two taps landing before that render are both real
// submit events, and Next runs server actions one after another, so the
// second request would still be sent (and would be rate-limited by Supabase,
// leaving the page on the wrong step). The latch is synchronous: the first
// submit enters it, every further submit is refused until the action settles.
//
// Pure and framework-free on purpose, so it can be unit-tested in the node
// environment (no jsdom in this repo). The React wiring lives in
// app/(auth)/login/pending-controls.tsx.

export type SubmitLatch = {
  /** true = this caller now holds the latch; false = already held, ignore the submit. */
  tryEnter: () => boolean
  release: () => void
}

export function createSubmitLatch(): SubmitLatch {
  let held = false
  return {
    tryEnter() {
      if (held) return false
      held = true
      return true
    },
    release() {
      held = false
    },
  }
}

// Releases the latch when a form's pending flag goes true -> false. The pending
// flag falls on EVERY outcome (the action returned, redirected, or threw), so
// this is what makes "released on error too" true without any catch block.
// A false -> false or true -> true observation never releases.
export function createPendingObserver(latch: SubmitLatch): (pending: boolean) => void {
  let previous = false
  return (pending: boolean) => {
    if (previous && !pending) latch.release()
    previous = pending
  }
}
