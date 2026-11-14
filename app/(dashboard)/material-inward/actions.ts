'use server'

import { revalidatePath } from 'next/cache'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import {
  runApprove,
  runClassify,
  runLink,
  runReject,
  runSetDetails,
  runUnlink,
  type PmActionDeps,
  type PmSetDetailsInput,
} from '@/lib/capture/pm-actions'
import type { PmActionError, PmActionResult } from '@/lib/capture/pm-errors'

// PR-D (D7): THIN 'use server' wrappers. They take only the form fields and build the client and profile themselves;
// nothing injectable is exposed to the browser. All logic, validation and error mapping is in lib/capture/pm-actions.ts
// (testable with an injected client). getProfile() redirects to /login when there is no session; it does not refuse
// inactive users, which the 050 functions do themselves (QE015).

async function buildDeps(): Promise<PmActionDeps> {
  const client = await createClient()
  const profile = await getProfile()
  return { client, profile: { id: profile.id, tenant_id: profile.tenant_id } }
}

function refresh(result: PmActionResult): PmActionResult {
  // Success changes the list and any detail page (link/unlink/reject can change a second delivery), so refresh both.
  // A refusal also refreshes: a STATE_CHANGED answer means the page the PM is looking at is stale.
  revalidatePath('/material-inward')
  revalidatePath('/material-inward/[deliveryId]', 'page')
  return result
}

export async function approveDeliveryAction(deliveryId: string): Promise<PmActionResult> {
  return refresh(await runApprove(await buildDeps(), { deliveryId }))
}

export async function rejectDeliveryAction(deliveryId: string, reason: string): Promise<PmActionResult> {
  return refresh(await runReject(await buildDeps(), { deliveryId, reason }))
}

export async function setDeliveryDetailsAction(input: PmSetDetailsInput): Promise<PmActionResult> {
  return refresh(await runSetDetails(await buildDeps(), input))
}

export async function linkInvoiceAction(invoiceDocumentId: string, deliveryIds: string[]): Promise<PmActionResult> {
  return refresh(await runLink(await buildDeps(), { invoiceDocumentId, deliveryIds }))
}

export async function unlinkInvoiceAction(linkId: string): Promise<PmActionResult> {
  return refresh(await runUnlink(await buildDeps(), { linkId }))
}

// PR-D2 (D7, D11): classify. Same thin-wrapper shape as the five above: the user-session client via buildDeps(), never the service
// role. On success (or already_classified with the same kind) it redirects to the resulting delivery; redirect() throws, so a
// success never returns. A refusal returns the mapped, named string only.
export async function classifyDocumentAction(documentId: string, kind: string): Promise<PmActionError> {
  const result = await runClassify(await buildDeps(), { documentId, kind })
  revalidatePath('/material-inward')
  revalidatePath('/material-inward/[deliveryId]', 'page')
  if (result.status === 'ok') redirect(`/material-inward/${result.deliveryId}`)
  return result
}
