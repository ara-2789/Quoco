'use client'

import { useEffect, useRef, useState, useTransition, type ReactNode } from 'react'
import { setDeliveryDetailsAction } from './actions'
import type { PmDetailsFields } from '@/lib/capture/pm-actions'
import { DetailsDirtyContext, isMoreDetailsDirty } from '@/components/material-inward/details-dirty'
import { buildDetailsNext, isDetailsDirty } from '@/components/material-inward/details-next'
import {
  PM_ACTION_SAVE_DETAILS,
  PM_DETAILS_TOGGLE,
  PM_FIELD_DC_DATE,
  PM_FIELD_DC_NUMBER,
  PM_FIELD_TYPE,
  PM_PENDING_ACTION,
  PM_TYPE_INTERNAL_TRANSFER,
  PM_TYPE_NOT_SET,
  PM_TYPE_SUPPLIER,
} from '@/lib/capture/pm-copy'

// Set-details form. D8: the form sends back the values it was RENDERED with (`loaded`, including the status) next to
// the new ones; the action re-reads the row and answers PM_ERR_STATE_CHANGED if anything differs, before the RPC. When `loaded`
// changes (after a save or a refresh) this component RESETS its own draft to the new values in place. It is NOT remounted: the
// parent used to key it, which remounted the Approve / Reject children and wiped the typed reject reason (review round 1, S2).
// An empty field clears that field (full overwrite, 050:456). The vehicle is NOT a form field any more: buildDetailsNext
// sends the loaded vehicle back unchanged.
//
// PR-D1b layout: delivery type first (with its own Save), then `children` (Approve / Reject, rendered by the page), then a
// collapsed "More details (optional)" block (DC no., DC date, its own Save). ONE shared state, so both Save buttons send all
// the values. While the form differs from the loaded values, DetailsDirtyContext is true and Approve / Reject are disabled.

type ErrorAt = 'type' | 'details'

export function DetailsControls({
  deliveryId,
  loaded,
  children,
}: {
  deliveryId: string
  loaded: PmDetailsFields & { status: string }
  children?: ReactNode
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<{ at: ErrorAt; message: string } | null>(null)
  const [type, setType] = useState(loaded.deliveryType ?? '')
  const [dcNumber, setDcNumber] = useState(loaded.dcNumber ?? '')
  const [dcDate, setDcDate] = useState(loaded.dcDate ?? '')

  // Reset the draft when the loaded values change (D8: never keep a stale draft). Adjusting state while rendering is the React
  // pattern for this; the children (Approve / Reject) stay mounted, so their own state (the reject reason) survives.
  const loadedKey = JSON.stringify(loaded)
  const [seenKey, setSeenKey] = useState(loadedKey)
  if (seenKey !== loadedKey) {
    setSeenKey(loadedKey)
    setType(loaded.deliveryType ?? '')
    setDcNumber(loaded.dcNumber ?? '')
    setDcDate(loaded.dcDate ?? '')
    setError(null)
  }

  const form = { deliveryType: type, dcNumber, dcDate }
  const dirty = isDetailsDirty(loaded, form)
  // N1: while an unsaved edit sits inside "More details (optional)", that block is open and cannot be collapsed, so the reason
  // Approve / Reject are disabled is visible. It is never forced closed when clean (the PM may have opened it).
  const moreDirty = isMoreDetailsDirty(loaded, form)
  const moreRef = useRef<HTMLDetailsElement>(null)
  useEffect(() => {
    if (moreDirty && moreRef.current) moreRef.current.open = true
  }, [moreDirty])

  function submit(at: ErrorAt) {
    startTransition(async () => {
      setError(null)
      const result = await setDeliveryDetailsAction({
        deliveryId,
        loaded,
        next: buildDetailsNext(loaded, form),
      })
      if (result.status === 'error') setError({ at, message: result.message })
    })
  }

  const field = 'w-full rounded-md border border-brand-border px-3 py-2 text-sm'
  const save = (at: ErrorAt) => (
    <button
      type="button"
      disabled={isPending}
      onClick={() => submit(at)}
      className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
    >
      {isPending ? PM_PENDING_ACTION : PM_ACTION_SAVE_DETAILS}
    </button>
  )
  const alertFor = (at: ErrorAt) =>
    error && error.at === at ? (
      <p role="alert" className="text-sm text-red-600">
        {error.message}
      </p>
    ) : null

  return (
    <DetailsDirtyContext.Provider value={dirty}>
      <div className="flex flex-col gap-6">
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
            {PM_FIELD_TYPE}
            <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
              <option value="">{PM_TYPE_NOT_SET}</option>
              <option value="supplier">{PM_TYPE_SUPPLIER}</option>
              <option value="internal_transfer">{PM_TYPE_INTERNAL_TRANSFER}</option>
            </select>
          </label>
          {alertFor('type')}
          {save('type')}
        </div>
        {children}
        <details ref={moreRef} className="rounded-md border border-brand-border px-3 py-2">
          <summary
            onClick={(e) => {
              if (moreDirty) e.preventDefault() // N1: no collapse while it holds an unsaved edit
            }}
            className="cursor-pointer text-sm font-medium text-gray-900"
          >
            {PM_DETAILS_TOGGLE}
          </summary>
          <div className="mt-3 flex flex-col gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
              {PM_FIELD_DC_NUMBER}
              <input value={dcNumber} maxLength={64} onChange={(e) => setDcNumber(e.target.value)} className={field} />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
              {PM_FIELD_DC_DATE}
              <input type="date" value={dcDate} onChange={(e) => setDcDate(e.target.value)} className={field} />
            </label>
            {alertFor('details')}
            {save('details')}
          </div>
        </details>
      </div>
    </DetailsDirtyContext.Provider>
  )
}
