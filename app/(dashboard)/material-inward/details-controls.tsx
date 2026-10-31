'use client'

import { useState, useTransition } from 'react'
import { setDeliveryDetailsAction } from './actions'
import type { PmDetailsFields } from '@/lib/capture/pm-actions'
import {
  PM_ACTION_SAVE_DETAILS,
  PM_FIELD_DC_DATE,
  PM_FIELD_DC_NUMBER,
  PM_FIELD_TYPE,
  PM_FIELD_VEHICLE,
  PM_PENDING_ACTION,
  PM_TYPE_INTERNAL_TRANSFER,
  PM_TYPE_NOT_SET,
  PM_TYPE_SUPPLIER,
} from '@/lib/capture/pm-copy'

// Set-details form. D8: the form sends back the values it was RENDERED with (`loaded`, including the status) next to
// the new ones; the action re-reads the row and answers PM_ERR_STATE_CHANGED if anything differs, before the RPC. The
// parent keys this component on `loaded`, so after a save or a refresh it remounts with the current values.
// An empty field clears that field (full overwrite, 050:456).

export function DetailsControls({
  deliveryId,
  loaded,
}: {
  deliveryId: string
  loaded: PmDetailsFields & { status: string }
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState(loaded.deliveryType ?? '')
  const [vehicle, setVehicle] = useState(loaded.vehicleNumber ?? '')
  const [dcNumber, setDcNumber] = useState(loaded.dcNumber ?? '')
  const [dcDate, setDcDate] = useState(loaded.dcDate ?? '')

  function submit() {
    startTransition(async () => {
      setError(null)
      const result = await setDeliveryDetailsAction({
        deliveryId,
        loaded,
        next: { deliveryType: type, vehicleNumber: vehicle, dcNumber, dcDate },
      })
      if (result.status === 'error') setError(result.message)
    })
  }

  const field = 'w-full rounded-md border border-brand-border px-3 py-2 text-sm'
  return (
    <div className="flex flex-col gap-3">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
        {PM_FIELD_TYPE}
        <select value={type} onChange={(e) => setType(e.target.value)} className={field}>
          <option value="">{PM_TYPE_NOT_SET}</option>
          <option value="supplier">{PM_TYPE_SUPPLIER}</option>
          <option value="internal_transfer">{PM_TYPE_INTERNAL_TRANSFER}</option>
        </select>
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
        {PM_FIELD_VEHICLE}
        <input value={vehicle} maxLength={64} onChange={(e) => setVehicle(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
        {PM_FIELD_DC_NUMBER}
        <input value={dcNumber} maxLength={64} onChange={(e) => setDcNumber(e.target.value)} className={field} />
      </label>
      <label className="flex flex-col gap-1 text-sm font-medium text-gray-900">
        {PM_FIELD_DC_DATE}
        <input type="date" value={dcDate} onChange={(e) => setDcDate(e.target.value)} className={field} />
      </label>
      <button
        type="button"
        disabled={isPending}
        onClick={submit}
        className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
      >
        {isPending ? PM_PENDING_ACTION : PM_ACTION_SAVE_DETAILS}
      </button>
    </div>
  )
}
