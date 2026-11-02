// Tap latch for the /login forms (docs/plans/login-otp-ux-plan.md, B1/B3,
// review round 1 B1/S2).
//
// WHY A LATCH AND NOT `disabled` ALONE: a disabled button only takes effect
// after React re-renders. Two taps landing before that render are both real
// submit events, and Next runs server actions one after another, so the
// second request would still be sent (and would be rate-limited by Supabase,
// leaving the page on the wrong step). The latch is synchronous: the first
// submit enters it, every further submit is refused until the action settles.
//
// The latch is also the single source of "busy" for the buttons (they read
// isHeld() through subscribe()), so a latch shared by two forms disables both
// forms' buttons (S2), and a latch released by the safety timeout re-enables
// them (B1): the buttons never depend on a `pending` flag that might not fall.
//
// Pure and framework-free on purpose, so it can be unit-tested in the node
// environment (no jsdom in this repo). The React wiring lives in
// app/(auth)/login/pending-controls.tsx.

/**
 * Safety release (review round 1, B1): if `pending` is never observed falling
 * (a same-route redirect where React batches the values, or an action that
 * never settles), the latch releases itself this long after entry so the
 * buttons come back instead of leaving a dead end. 20 s is above a normal
 * slow send and below the point where a PM gives up and reloads.
 */
export const LATCH_SAFETY_RELEASE_MS = 20_000

export type SubmitLatch = {
  /** true = this caller now holds the latch; false = already held, ignore the submit. */
  tryEnter: () => boolean
  release: () => void
  isHeld: () => boolean
  /** For useSyncExternalStore. Returns the unsubscribe function. */
  subscribe: (listener: () => void) => () => void
}

export function createSubmitLatch(timeoutMs: number = LATCH_SAFETY_RELEASE_MS): SubmitLatch {
  let held = false
  let timer: ReturnType<typeof setTimeout> | null = null
  const listeners = new Set<() => void>()

  const notify = () => {
    for (const listener of listeners) listener()
  }

  const release = () => {
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!held) return
    held = false
    notify()
  }

  return {
    tryEnter() {
      if (held) return false
      held = true
      timer = setTimeout(release, timeoutMs)
      notify()
      return true
    },
    release,
    isHeld: () => held,
    subscribe(listener) {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
  }
}

// Releases the latch when ONE form's pending flag goes true -> false. The
// pending flag falls on EVERY outcome (the action returned, redirected, or
// threw), so this is what makes "released on error too" true without any
// catch block. A false -> false or true -> true observation never releases.
// One observer PER FORM, over a latch that may be shared: each form only
// releases on its own true -> false, so a form that never ran (it only ever
// reports false) can never release a hold taken by its sibling.
export function createPendingObserver(latch: SubmitLatch): (pending: boolean) => void {
  let previous = false
  return (pending: boolean) => {
    if (previous && !pending) latch.release()
    previous = pending
  }
}
