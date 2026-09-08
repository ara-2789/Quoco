'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { acknowledgeHindrance } from '../hindrances/actions'

// DASH-01 active-hindrances tile -- Acknowledge only, no Undo (design
// summary: "Action row: inline Acknowledge only"). Reuses
// acknowledgeHindrance UNCHANGED from app/(dashboard)/hindrances/actions.ts
// -- not a second Server Action. Deliberately NOT HindranceAckControls:
// that component also renders the acknowledged-state attribution line and
// Undo, neither of which this tile shows.
export function TileAcknowledgeButton({ hindranceId }: { hindranceId: string }) {
  const router = useRouter()
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState(false)

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

  return (
    <div className="mt-4 flex items-center gap-3">
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
  )
}
