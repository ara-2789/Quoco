'use client'

// Login-only client controls (docs/plans/login-otp-ux-plan.md, B1/B3/B4 and
// the §12 review-round-1 addendum).
//
// The three server actions (requestCode / resendCode / verifyCode) stay in
// page.tsx, byte-identical. Everything here only wraps the FORMS and BUTTONS
// that call them. The server action is passed to LatchedForm as the form's own
// `action`, so the form still works as a plain form post before hydration.

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useFormStatus } from 'react-dom'
import {
  createPendingObserver,
  createSubmitLatch,
  type SubmitLatch,
} from '@/lib/auth/submit-latch'

// NOTE: nothing in this 'use client' file may be CALLED by page.tsx (a server
// component); page.tsx may only render the components exported here. Pure
// helpers it needs while rendering live in plain modules (see
// lib/auth/login-form-key.ts, which used to be here and crashed every /login).

// ---------------------------------------------------------------------------
// Presentational views. No hooks, so the node-env tests can render them with
// renderToStaticMarkup. The wired wrappers below are thin on purpose.
// ---------------------------------------------------------------------------

export function SubmitButtonView({
  pending,
  label,
  busyLabel,
  className,
}: {
  pending: boolean
  label: string
  /** Shown instead of `label` while pending. Omit to keep the label unchanged. */
  busyLabel?: string
  className?: string
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending ? true : undefined}
      className={className}
    >
      {pending && busyLabel ? busyLabel : label}
    </button>
  )
}

// A GET SUBMITTER (review round 1, S1): a string `formAction` replaces the
// form's server action for this submission, so React neither runs the action
// nor cancels the event; the browser submits natively, `step=code` and the
// typed email go in the query string, and nothing is sent. Needs no JS, so it
// works before hydration. `data-no-latch` tells LatchedForm's onSubmit to
// leave this submission alone (no latch, no preventDefault).
export function HaveCodeButtonView({
  pending,
  label,
  className,
}: {
  pending: boolean
  label: string
  className?: string
}) {
  return (
    <button
      type="submit"
      formMethod="get"
      formAction="/login"
      name="step"
      value="code"
      data-no-latch=""
      disabled={pending}
      className={className}
    >
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Latch wiring.
// ---------------------------------------------------------------------------

type LatchContextValue = { latch: SubmitLatch; id: string }
const LatchContext = createContext<LatchContextValue | null>(null)

function useOwnedLatch(): SubmitLatch {
  const [latch] = useState(() => createSubmitLatch())
  // Drop any hold (and its timer) when the form unmounts.
  useEffect(() => () => latch.release(), [latch])
  return latch
}

function useLatchHeld(): boolean {
  const ctx = useContext(LatchContext)
  const fallback = useState(() => createSubmitLatch())[0]
  const latch = ctx?.latch ?? fallback
  return useSyncExternalStore(latch.subscribe, latch.isHeld, () => false)
}

// Shared by the code step's two forms (verify, resend): ONE latch, so while
// either is in flight both buttons are disabled and a tap on the other is
// refused (review round 1, S2).
export function LatchScope({ children }: { children: ReactNode }) {
  const latch = useOwnedLatch()
  const id = useId()
  const value = useMemo(() => ({ latch, id }), [latch, id])
  return <LatchContext.Provider value={value}>{children}</LatchContext.Provider>
}

export function SubmitButton(props: { label: string; busyLabel?: string; className?: string }) {
  return <SubmitButtonView pending={useLatchHeld()} {...props} />
}

export function HaveCodeButton(props: { label: string; className?: string }) {
  // Disabled while a send is pending, so a PM cannot leave mid-send.
  return <HaveCodeButtonView pending={useLatchHeld()} {...props} />
}

function PendingWatcher({ onPending }: { onPending: (pending: boolean) => void }) {
  const { pending } = useFormStatus()
  useEffect(() => {
    onPending(pending)
  }, [pending, onPending])
  return null
}

export function LatchedForm({
  action,
  className,
  latchKey,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>
  className?: string
  /** loginFormKey(params); rendered as data-latch-key so the wiring is inspectable. */
  latchKey: string
  children: ReactNode
}) {
  const scope = useContext(LatchContext)
  const ownLatch = useOwnedLatch()
  const ownId = useId()
  const own = useMemo(() => ({ latch: ownLatch, id: ownId }), [ownLatch, ownId])
  const { latch, id } = scope ?? own
  // One observer per form, over a latch that may be shared (see submit-latch.ts).
  const [observe] = useState(() => createPendingObserver(latch))

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    // The have-code GET submission is not a send: no latch, no preventDefault.
    if (submitter?.hasAttribute('data-no-latch')) return
    // First submit enters the latch; any further submit before the action
    // settles is cancelled, so it never becomes a second request.
    if (!latch.tryEnter()) event.preventDefault()
  }

  return (
    <LatchContext.Provider value={scope ?? own}>
      <form
        action={action}
        onSubmit={onSubmit}
        className={className}
        data-latch-key={latchKey}
        data-latch-id={id}
      >
        <PendingWatcher onPending={observe} />
        {children}
      </form>
    </LatchContext.Provider>
  )
}
