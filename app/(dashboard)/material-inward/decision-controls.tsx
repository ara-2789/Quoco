'use client'

import { useContext, useState, useTransition } from 'react'
import { DetailsDirtyContext } from '@/components/material-inward/details-dirty'
import { approveDeliveryAction, rejectDeliveryAction } from './actions'
import type { PmActionResult } from '@/lib/capture/pm-errors'
import {
  PM_ACTION_APPROVE,
  PM_ACTION_REJECT,
  PM_CONFIRM_REJECT,
  PM_FIELD_REJECT_REASON,
  PM_PENDING_ACTION,
  PM_WARN_APPROVE_NO_FILE,
} from '@/lib/capture/pm-copy'

// Approve / reject for an OPEN delivery. Busy state: one useTransition per component, both buttons disabled while
// any action is pending (same idiom as hindrances/ack-controls.tsx:59,111,130). That is a convenience only; the
// database locks and re-checks status (a double submit gets PM_ERR_STATE_CHANGED from QE011). The busy state is a
// MANUAL check (no DOM test dependency, Q6).
//
// D10: with no stored file the approve button still works; PM_WARN_APPROVE_NO_FILE is shown next to it.

export function DecisionControls({ deliveryId, hasStoredFile }: { deliveryId: string; hasStoredFile: boolean }) {
  const [isPending, startTransition] = useTransition()
  // R1: unsaved edits in the details form disable both buttons (label unchanged).
  const dirty = useContext(DetailsDirtyContext)
  const blocked = isPending || dirty
  const [error, setError] = useState<string | null>(null)
  const [reason, setReason] = useState('')
  // A rejection is final (nothing leaves 'rejected', 050:523-524), so the button asks twice.
  const [confirmingReject, setConfirmingReject] = useState(false)

  function run(call: () => Promise<PmActionResult>) {
    startTransition(async () => {
      setError(null)
      const result = await call()
      if (result.status === 'error') setError(result.message)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {!hasStoredFile && <p className="text-sm text-amber-800">{PM_WARN_APPROVE_NO_FILE}</p>}
        <button
          type="button"
          disabled={blocked}
          onClick={() => run(() => approveDeliveryAction(deliveryId))}
          className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {isPending ? PM_PENDING_ACTION : PM_ACTION_APPROVE}
        </button>
      </div>
      <div className="flex flex-col gap-2">
        <label className="text-sm font-medium text-gray-900" htmlFor={`reject-reason-${deliveryId}`}>
          {PM_FIELD_REJECT_REASON}
        </label>
        <textarea
          id={`reject-reason-${deliveryId}`}
          value={reason}
          maxLength={1000}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-brand-border px-3 py-2 text-sm"
        />
        <button
          type="button"
          disabled={blocked}
          onClick={() => {
            if (!confirmingReject) {
              setConfirmingReject(true)
              return
            }
            setConfirmingReject(false)
            run(() => rejectDeliveryAction(deliveryId, reason))
          }}
          className="inline-flex w-fit items-center justify-center rounded-md border border-red-300 px-4 py-3 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
        >
          {isPending ? PM_PENDING_ACTION : confirmingReject ? PM_CONFIRM_REJECT : PM_ACTION_REJECT}
        </button>
      </div>
    </div>
  )
}
