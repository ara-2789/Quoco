'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { formatIstTime } from '@/lib/daily-logs/date'
import { UNNAMED_ENGINEER_FALLBACK } from '@/lib/hindrance/queue'
import { acknowledgeHindrance, unacknowledgeHindrance } from './actions'

// DASH-07 Phase 2 — interactive Acknowledge / Undo controls (docs/plans/
// dash-07-hindrance-queue.md §Row anatomy, §Undo). Client component -- the
// rest of HindranceRow stays a Server Component; this is the one piece that
// calls a Server Action and needs local pending/error state, same split as
// ReactivateCta / use-field-correction.ts elsewhere in this app.
//
// UNDO CONSEQUENCE GATING (decision, 2026-09-08): the consequence line
// ("...that message can't be recalled") is true only once a sender has
// actually notified the engineer -- gated on ackNotifiedAt !== null, NEVER
// on isAcknowledged/acknowledgedAt alone. No sender exists yet (Stage 3),
// so ackNotifiedAt is always null today and this branch never fires -- Undo
// is silent. The gate is real, not stubbed, so Stage 3 needs no change here.
//
// FIRST-NAME FALLBACK: reporterName can be UNNAMED_ENGINEER_FALLBACK
// ('Unnamed engineer') -- engineer rows are provisioned entirely out-of-band
// (docs/reviews/engineer-provisioning-gap.md; no in-repo path validates or
// requires full_name), and the outbound-send infrastructure this Stage-3
// sender will build on (lib/whatsapp/outbound/roster.ts's own
// `engineer_name: row.full_name ?? 'Unnamed engineer'`) already addresses
// purely by whatsapp_number, tolerating a null name -- so an unnamed
// engineer getting notified (ackNotifiedAt set) is a real, reachable case,
// not a hypothetical one. Falls back to "Your engineer" rather than
// interpolating "Unnamed" as a first name.
//
// CONSEQUENCE-NOTE PERSISTENCE: 4000ms is its own product call for
// readability (the full sentence needs a moment to read), not a match to
// ReactivateCta's 1500ms "Copied" flash -- that one is a single word.
// router.refresh() fires IMMEDIATELY on success, never deferred behind this
// timeout -- the note is appended below whichever controls are currently
// showing, never a replacement for them, so it can't hold the row's
// interactivity hostage.

export function HindranceAckControls({
  hindranceId,
  isAcknowledged,
  acknowledgedAt,
  acknowledgedBySelf,
  acknowledgedByName,
  ackNotifiedAt,
  reporterName,
}: {
  hindranceId: string
  isAcknowledged: boolean
  acknowledgedAt: string | null
  acknowledgedBySelf: boolean
  acknowledgedByName: string | null
  ackNotifiedAt: string | null
  reporterName: string
}) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)
  const [consequenceMessage, setConsequenceMessage] = useState<string | null>(null)

  function handleAcknowledge() {
    setError(false)
    startTransition(async () => {
      const result = await acknowledgeHindrance(hindranceId)
      if (result.status === 'error') {
        setError(true)
        return
      }
      router.refresh()
    })
  }

  function handleUndo() {
    setError(false)
    startTransition(async () => {
      const result = await unacknowledgeHindrance(hindranceId)
      if (result.status === 'error') {
        setError(true)
        return
      }
      if (ackNotifiedAt !== null) {
        const subject = reporterName === UNNAMED_ENGINEER_FALLBACK ? 'Your engineer' : reporterName.split(' ')[0]
        setConsequenceMessage(
          `Marked unseen. ${subject} was already told you'd seen it — that message can't be recalled.`,
        )
        setTimeout(() => setConsequenceMessage(null), 4000)
      }
      router.refresh()
    })
  }

  const note = consequenceMessage && (
    <p className="mt-1 text-xs font-medium text-amber-700">{consequenceMessage}</p>
  )

  if (isAcknowledged) {
    const attribution = acknowledgedBySelf ? 'you' : (acknowledgedByName ?? 'someone')
    return (
      <>
        <div className="mt-2 flex items-center justify-between gap-3">
          <p className="text-xs text-gray-500">
            Seen by {attribution}, {formatIstTime(acknowledgedAt)}
          </p>
          <div className="flex items-center gap-3">
            {error && <p className="text-xs text-red-600">Couldn&apos;t save that. Try again.</p>}
            <button
              type="button"
              onClick={handleUndo}
              disabled={isPending}
              className="inline-flex items-center justify-center rounded-md px-4 py-3 sm:py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors disabled:opacity-50"
            >
              Undo
            </button>
          </div>
        </div>
        {note}
      </>
    )
  }

  return (
    <>
      <div className="mt-2 flex items-center justify-end gap-3">
        {error && <p className="text-xs text-red-600">Couldn&apos;t save that. Try again.</p>}
        <button
          type="button"
          onClick={handleAcknowledge}
          disabled={isPending}
          className="inline-flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50"
        >
          Acknowledge
        </button>
      </div>
      {note}
    </>
  )
}
