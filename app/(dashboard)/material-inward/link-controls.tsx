'use client'

import { useState, useTransition } from 'react'
import { linkInvoiceAction, unlinkInvoiceAction } from './actions'
import type { PmActionResult } from '@/lib/capture/pm-errors'
import type { PmCandidate } from '@/lib/capture/pm-queries'
import { ackLabel, formatIstDate } from '@/components/material-inward/labels'
import {
  PM_ACTION_LINK_INVOICE,
  PM_ACTION_UNLINK,
  PM_CONFIRM_UNLINK,
  PM_LINK_NO_CANDIDATES,
  PM_LINK_SELECT_DELIVERIES,
  PM_LINK_SELECT_INVOICE,
  PM_PENDING_ACTION,
} from '@/lib/capture/pm-copy'

// Link / unlink. Two shapes of the SAME function, pm_link_invoice(invoice, deliveries[]):
//   mode 'invoice' (on an invoice's page): pick 1-20 DC deliveries to link THIS invoice to;
//   mode 'dc' (on a DC delivery's page): pick the one invoice to link to THIS delivery.
// Candidates are filtered for the PM's convenience only; the database refuses ineligible targets (QE003/004/005) and a
// delivery that already has an active link (QE008). Unlink asks twice (PM_CONFIRM_UNLINK) before calling.

export interface UnlinkableItem {
  linkId: string
  receivedAt: string
  dcNumber: string | null
}

export function LinkControls({
  mode,
  invoiceDocumentId,
  deliveryId,
  candidates,
  unlinkable,
}: {
  mode: 'invoice' | 'dc'
  /** The invoice's document id; null on a DC page (the invoice is the picked candidate). */
  invoiceDocumentId: string | null
  deliveryId: string
  candidates: PmCandidate[]
  unlinkable: UnlinkableItem[]
}) {
  const [isPending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)
  const [picked, setPicked] = useState<string[]>([])
  const [confirming, setConfirming] = useState<string | null>(null)
  const candidateKind = mode === 'invoice' ? 'dc' : 'invoice'

  function run(call: () => Promise<PmActionResult>) {
    startTransition(async () => {
      setError(null)
      const result = await call()
      if (result.status === 'error') setError(result.message)
      else {
        setPicked([])
        setConfirming(null)
      }
    })
  }

  function toggle(id: string) {
    if (mode === 'dc') setPicked([id])
    else setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length >= 20 ? cur : [...cur, id]))
  }

  function submitLink() {
    if (picked.length === 0) return
    run(() =>
      mode === 'invoice'
        ? linkInvoiceAction(invoiceDocumentId ?? '', picked)
        : linkInvoiceAction(picked[0], [deliveryId]),
    )
  }

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {unlinkable.length > 0 && (
        <ul className="flex flex-col gap-2">
          {unlinkable.map((u) => (
            <li key={u.linkId} className="flex flex-wrap items-center gap-3 text-sm text-gray-900">
              <span>
                {formatIstDate(u.receivedAt)} {u.dcNumber ?? ''}
              </span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => (confirming === u.linkId ? run(() => unlinkInvoiceAction(u.linkId)) : setConfirming(u.linkId))}
                className="inline-flex items-center justify-center rounded-md border border-red-300 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
              >
                {isPending && confirming === u.linkId ? PM_PENDING_ACTION : confirming === u.linkId ? PM_CONFIRM_UNLINK : PM_ACTION_UNLINK}
              </button>
            </li>
          ))}
        </ul>
      )}
      {candidates.length === 0 ? (
        unlinkable.length === 0 && <p className="text-sm text-gray-700">{PM_LINK_NO_CANDIDATES}</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-sm font-medium text-gray-900">{mode === 'invoice' ? PM_LINK_SELECT_DELIVERIES : PM_LINK_SELECT_INVOICE}</legend>
          {candidates.map((c) => (
            <label key={c.id} className="flex items-center gap-2 text-sm text-gray-900">
              <input
                type={mode === 'dc' ? 'radio' : 'checkbox'}
                name={`link-candidate-${deliveryId}`}
                checked={picked.includes(c.id)}
                onChange={() => toggle(c.id)}
              />
              <span>
                {formatIstDate(c.receivedAt)} {c.dcNumber ?? ''} {ackLabel(candidateKind, c.ack)}
              </span>
            </label>
          ))}
          <button
            type="button"
            disabled={isPending || picked.length === 0}
            onClick={submitLink}
            className="inline-flex w-fit items-center justify-center rounded-md bg-blue-600 px-4 py-3 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {isPending && confirming === null ? PM_PENDING_ACTION : PM_ACTION_LINK_INVOICE}
          </button>
        </fieldset>
      )}
    </div>
  )
}
