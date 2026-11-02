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
  useRef,
  useState,
  useSyncExternalStore,
  type FormEvent,
  type ReactNode,
} from 'react'
import { useFormStatus } from 'react-dom'
import {
  createPendingObserver,
  createSubmitLatch,
  decideSubmit,
  isSubmitterBusy,
  type SubmitLatch,
} from '@/lib/auth/submit-latch'
import {
  browserSessionStorage,
  clearSavedEmail,
  readSavedEmail,
  saveEmail,
} from '@/lib/auth/saved-email'

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
  submitId,
  formAction,
  formNoValidate,
}: {
  pending: boolean
  label: string
  /** Shown instead of `label` while pending. Omit to keep the label unchanged. */
  busyLabel?: string
  className?: string
  /** Names this submitter (data-submit-id) so the form can tell which button started a send. */
  submitId?: string
  /** A submitter-level action: overrides the form's `action` for this button's submissions. */
  formAction?: (formData: FormData) => void | Promise<void>
  /** Skip browser validation for this submitter (Send a new code must work with an empty code field). */
  formNoValidate?: boolean
}) {
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending ? true : undefined}
      className={className}
      data-submit-id={submitId}
      formAction={formAction}
      formNoValidate={formNoValidate}
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

// ONE latch per form, and (S2, plan section 15) the code step is now ONE form:
// Sign in and Send a new code are both submitters of the same <form>, so they
// share this latch, this useFormStatus and this host transition by
// construction. (The earlier design put them in two forms that shared a latch
// through context; a resend tap made while Sign in was pending still ran.)
type LatchContextValue = {
  latch: SubmitLatch
  /** data-submit-id of the submitter that took the latch; only meaningful while it is held. */
  activeSubmitId: string | null
}
const LatchContext = createContext<LatchContextValue | null>(null)

function useOwnedLatch(): SubmitLatch {
  const [latch] = useState(() => createSubmitLatch())
  // Drop any hold (and its timer) when the form unmounts.
  useEffect(() => () => latch.release(), [latch])
  return latch
}

function useLatchState(): { held: boolean; activeSubmitId: string | null } {
  const ctx = useContext(LatchContext)
  const fallback = useState(() => createSubmitLatch())[0]
  const latch = ctx?.latch ?? fallback
  const held = useSyncExternalStore(latch.subscribe, latch.isHeld, () => false)
  return { held, activeSubmitId: ctx?.activeSubmitId ?? null }
}

export function SubmitButton({
  busyLabel,
  submitId,
  ...props
}: {
  label: string
  busyLabel?: string
  className?: string
  submitId?: string
  formAction?: (formData: FormData) => void | Promise<void>
  formNoValidate?: boolean
}) {
  const { held, activeSubmitId } = useLatchState()
  // Every button in the form is disabled while the latch is held; only the
  // submitter that started the send shows its busy label.
  const busy = isSubmitterBusy(held, activeSubmitId, submitId)
  return (
    <SubmitButtonView
      pending={held}
      busyLabel={busy ? busyLabel : undefined}
      submitId={submitId}
      {...props}
    />
  )
}

export function HaveCodeButton(props: { label: string; className?: string }) {
  // Disabled while a send is pending, so a PM cannot leave mid-send.
  return <HaveCodeButtonView pending={useLatchState().held} {...props} />
}

// The email field of the requestCode form (section 14). Same attributes as the
// plain input it replaces; UNCONTROLLED (ref, no value prop), so a no-JS submit
// still works. On mount, if the field is empty (a remount after the error
// redirect), the address saved by LatchedForm's onSubmit is put back. A field
// the browser already autofilled is left alone.
export function EmailInput({ className }: { className?: string }) {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const field = ref.current
    if (!field || field.value !== '') return
    const saved = readSavedEmail(browserSessionStorage())
    if (saved !== '') field.value = saved
  }, [])
  return (
    <input
      ref={ref}
      id="email"
      name="email"
      type="email"
      required
      autoComplete="email"
      placeholder="you@company.com"
      className={className}
    />
  )
}

// Rendered on the CODE step only (review round 2, N1). Once a code has been
// sent (or the have-code path taken) the saved address has done its job, so it
// is dropped on mount: a later /login in the same tab (e.g. after a sign-out on
// a shared computer) must not show the previous PM's address. The email step
// never renders this, so the rate-limit error path still restores the address.
// The hidden marker element exists only so the wiring is visible in the server
// HTML (a node-env test cannot run the effect); it has no text and no layout.
export function ClearSavedEmailOnMount() {
  useEffect(() => {
    clearSavedEmail(browserSessionStorage())
  }, [])
  return <span hidden aria-hidden="true" data-clear-saved-email="" />
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
  rememberEmail,
  children,
}: {
  action: (formData: FormData) => void | Promise<void>
  className?: string
  /** loginFormKey(params); rendered as data-latch-key so the wiring is inspectable. */
  latchKey: string
  /** The requestCode form only: save the typed email to sessionStorage on submit (section 14). */
  rememberEmail?: boolean
  children: ReactNode
}) {
  const latch = useOwnedLatch()
  const id = useId()
  const [activeSubmitId, setActiveSubmitId] = useState<string | null>(null)
  const ctx = useMemo(() => ({ latch, activeSubmitId }), [latch, activeSubmitId])
  const [observe] = useState(() => createPendingObserver(latch))

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // Save the typed email for BOTH submitters (Send code and the have-code
    // GET button), BEFORE the latch decision: even a tap the latch refuses
    // carries the same address, and the have-code path returns just below.
    // A submit only fires once browser validation has passed, so an invalid
    // field is never saved (and saveEmail ignores non-emails anyway).
    if (rememberEmail) {
      const field = event.currentTarget.elements.namedItem('email')
      if (field instanceof HTMLInputElement) saveEmail(browserSessionStorage(), field.value)
    }
    const submitter = (event.nativeEvent as SubmitEvent).submitter
    // The have-code GET submission is not a send ('bypass'): no latch, no
    // preventDefault. Otherwise the FIRST submit from ANY submitter takes the
    // latch; every further submit, from either button, is cancelled until the
    // action settles, so it never becomes a second request.
    const decision = decideSubmit(latch, submitter?.hasAttribute('data-no-latch') ?? false)
    if (decision === 'refuse') event.preventDefault()
    // Remember which button started the send (its busy label shows; the others
    // are only disabled). Buttons without a data-submit-id leave it null.
    if (decision === 'allow') setActiveSubmitId(submitter?.getAttribute('data-submit-id') ?? null)
  }

  return (
    <LatchContext.Provider value={ctx}>
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
