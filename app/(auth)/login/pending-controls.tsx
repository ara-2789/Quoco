'use client'

// Login-only client controls (docs/plans/login-otp-ux-plan.md, B1/B3/B4).
//
// The three server actions (requestCode / resendCode / verifyCode) stay in
// page.tsx, byte-identical. Everything here only wraps the FORMS and BUTTONS
// that call them. The server action is passed to LatchedForm as the form's own
// `action`, so the form still works as a plain form post before hydration.

import { useEffect, useState, type FormEvent, type MouseEvent, type ReactNode } from 'react'
import { useFormStatus } from 'react-dom'
import { createPendingObserver, createSubmitLatch } from '@/lib/auth/submit-latch'

// The URL the have-code button sends the browser to. Same shape page.tsx's own
// actions redirect to (`/login?step=code&email=...`), so the existing code step
// and its server-side isValidEmail guard are reused unchanged. encodeURIComponent
// escapes '+' (-> %2B) and '@' (-> %40); an unescaped '+' would be decoded as a
// space by the server and the address would no longer match the one typed.
export function haveCodeUrl(email: string): string {
  return `/login?step=code&email=${encodeURIComponent(email.trim())}`
}

// ---------------------------------------------------------------------------
// Presentational views. No hooks, so the node-env tests can render them with
// renderToStaticMarkup. The hook-wired wrappers below are thin on purpose.
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

// type="button" on purpose: NOT a submit, no formAction, no formMethod. It can
// never invoke requestCode; the click handler only navigates (see HaveCodeButton).
export function HaveCodeButtonView({
  pending,
  label,
  className,
  onClick,
}: {
  pending: boolean
  label: string
  className?: string
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void
}) {
  return (
    <button type="button" disabled={pending} onClick={onClick} className={className}>
      {label}
    </button>
  )
}

// ---------------------------------------------------------------------------
// Hook-wired wrappers.
// ---------------------------------------------------------------------------

export function SubmitButton(props: {
  label: string
  busyLabel?: string
  className?: string
}) {
  const { pending } = useFormStatus()
  return <SubmitButtonView pending={pending} {...props} />
}

// Navigation choice: window.location.assign, not router.push. This is a plain
// GET to a server-rendered step; a full load always gets a fresh render of the
// code step (and its server-side email check) with no client router cache or
// soft-navigation state in between, and it needs no router hook. The cost is
// one full page load, acceptable on a sign-in screen.
export function HaveCodeButton({ label, className }: { label: string; className?: string }) {
  // useFormStatus reports the ENCLOSING form's action submission, so this is
  // disabled while "Send code" is pending and a PM cannot leave mid-send.
  const { pending } = useFormStatus()
  return (
    <HaveCodeButtonView
      pending={pending}
      label={label}
      className={className}
      onClick={(event) => {
        const field = event.currentTarget.form?.elements.namedItem('email')
        if (!(field instanceof HTMLInputElement)) return
        if (!field.checkValidity()) {
          field.reportValidity()
          return
        }
        window.location.assign(haveCodeUrl(field.value))
      }}
    />
  )
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
  children,
}: {
  action: (formData: FormData) => void | Promise<void>
  className?: string
  children: ReactNode
}) {
  const [latch] = useState(createSubmitLatch)
  const [observe] = useState(() => createPendingObserver(latch))

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    // First submit enters the latch; any further submit before the action
    // settles is cancelled, so it never becomes a second request.
    if (!latch.tryEnter()) event.preventDefault()
  }

  return (
    <form action={action} onSubmit={onSubmit} className={className}>
      <PendingWatcher onPending={observe} />
      {children}
    </form>
  )
}
