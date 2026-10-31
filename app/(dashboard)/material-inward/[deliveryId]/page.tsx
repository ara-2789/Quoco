import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getDeliveryDetail } from '@/lib/capture/pm-queries'
import { PM_LOAD_ERROR } from '@/lib/capture/pm-copy'
import { DetailView } from '@/components/material-inward/detail-view'

// PR-D: delivery detail. D2: never cached. A delivery that does not exist, belongs to another project or tenant, or is
// not visible to this viewer is the SAME 404 (RLS returns no row; getDeliveryDetail says 'not-found'). The body is
// components/material-inward/detail-view.tsx (renderable in a test without a database).
export const dynamic = 'force-dynamic'

export default async function MaterialInwardDetailPage({ params }: { params: Promise<{ deliveryId: string }> }) {
  const { deliveryId } = await params
  const supabase = await createClient()
  const profile = await getProfile()
  const result = await getDeliveryDetail(supabase, { id: profile.id, tenant_id: profile.tenant_id }, deliveryId, new Date())

  if (result.status === 'not-found') notFound()
  if (result.status === 'error') return <p className="text-sm text-gray-700">{PM_LOAD_ERROR}</p>

  return <DetailView d={result.detail} />
}
