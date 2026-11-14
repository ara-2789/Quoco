import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getClassifyDocument } from '@/lib/capture/pm-queries'
import { PM_LOAD_ERROR } from '@/lib/capture/pm-copy'
import { ClassifyView } from '@/components/material-inward/classify-view'

// PR-D2 (D3, D5): classify one unclassified document. Never cached. A document that does not exist, belongs to another project or
// tenant, or is not visible to this viewer is the SAME 404 (RLS returns no row). A document that ALREADY has a kind goes to its
// delivery (redirect); a kind with no delivery is a 404. The static `classify` segment wins over `[deliveryId]`, and a delivery id can
// never be the word "classify" (both routes UUID-check their id). User-session client only; the write is the server action.
export const dynamic = 'force-dynamic'

export default async function MaterialInwardClassifyPage({ params }: { params: Promise<{ documentId: string }> }) {
  const { documentId } = await params
  const supabase = await createClient()
  const profile = await getProfile()
  const now = new Date()
  const result = await getClassifyDocument(supabase, { id: profile.id, tenant_id: profile.tenant_id }, documentId, now)

  if (result.status === 'not-found') notFound()
  if (result.status === 'error') return <p className="text-sm text-gray-700">{PM_LOAD_ERROR}</p>
  if (result.status === 'redirect') redirect(`/material-inward/${result.deliveryId}`)

  return <ClassifyView doc={result.doc} now={now} />
}
