// Fixtures for the PR-D (PM page) suites. Builds on the PR-B capture kit (test/helpers/capture-fixtures.ts, imported,
// NOT modified). Every user, tenant, project, document and storage object used here is created for THIS run:
//   * users/tenants/projects come from buildCaptureKit, whose ids, e-mails and slugs are run-scoped
//     (zz-test-capture-<tag>-<runId>); the shared fixture users are never touched;
//   * identifiers carry ZZTestCapture-${runTag}- (kit.sid / kit.phone);
//   * storage objects are uploaded under this run's tenant ids and removed again in removeStoredObjects();
//   * nothing here writes outbound_sends, and no +199955503XX phone is used (kit.phone derives run-scoped numbers).
// Cleanup of the 049 rows is teardownCaptureKit (service_role has no DELETE; the fixture-tenant-guarded helper does it).
import { createHash } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  buildCaptureKit,
  captureAnon,
  makeDoc,
  ack,
  teardownCaptureKit,
  type CaptureKit,
  type CaptureUserLabel,
  type MadeDoc,
} from './capture-fixtures'

export { captureAnon, makeDoc, ack, teardownCaptureKit }
export type { CaptureKit, CaptureUserLabel, MadeDoc }

export const PM_BUCKET = 'capture-documents'

/** 1x1 PNG. */
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
/** A minimal PDF header + body; enough for Storage (the bucket allows application/pdf). */
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n', 'utf8')

const uploaded = new WeakMap<CaptureKit, string[]>()

/** Tenant of a kit user label (A for everyone except the tenant-B labels). */
export function tenantOf(kit: CaptureKit, label: CaptureUserLabel): string {
  return label === 'pmB' || label === 'engB' ? kit.tenantB : kit.tenantA
}

/** The identity the page code receives for a kit user. */
export function readerOf(kit: CaptureKit, label: CaptureUserLabel): { id: string; tenant_id: string } {
  return { id: kit.uid(label), tenant_id: tenantOf(kit, label) }
}

/**
 * The client a NEGATIVE actor uses. Normally the actor's own signed-in (RLS) client. With PM_CONTROL=service the
 * negative actor is swapped for the service-role client: that is the CONTROL run, and the negatives that rely on RLS
 * must then go RED (it proves those assertions can fail). Positive actors never use this.
 */
export async function negClient(kit: CaptureKit, label: CaptureUserLabel): Promise<SupabaseClient> {
  return process.env.PM_CONTROL === 'service' ? kit.svc : kit.jwt(label)
}

/** Build the kit used by the PM suites. `fileTag` keeps ids distinct per test file. */
export async function buildPmKit(fileTag: string, extra: readonly CaptureUserLabel[] = []): Promise<CaptureKit> {
  const labels = new Set<CaptureUserLabel>(['eng', 'engP2', 'engB', 'pm1', 'pm2', 'pmB', 'qs', 'deact', ...extra])
  return buildCaptureKit(fileTag, [...labels])
}

export async function filesOfDoc(kit: CaptureKit, docId: string): Promise<Array<{ id: string; file_no: number }>> {
  const { data, error } = await kit.svc.from('capture_files').select('id, file_no').eq('document_id', docId).order('file_no')
  if (error) throw new Error(`filesOfDoc failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string; file_no: number }>
}

/**
 * Move a pending file to `stored`: upload real bytes to this run's tenant path, then UPDATE the row the way the ingest
 * job does (service_role column grant, 051:288). The path is exactly what the writer builds (capture-ingest.ts:500-502).
 */
export async function storeFile(kit: CaptureKit, fileId: string, kind: 'png' | 'pdf_not_previewable' = 'png'): Promise<string> {
  const { data: row, error } = await kit.svc
    .from('capture_files')
    .select('id, tenant_id, project_id, document_id')
    .eq('id', fileId)
    .single<{ id: string; tenant_id: string; project_id: string; document_id: string }>()
  if (error || !row) throw new Error(`storeFile read failed: ${error?.message ?? 'no row'}`)
  const path = `${row.tenant_id}/${row.project_id}/${row.document_id}/${row.id}`
  const bytes = kind === 'png' ? PNG_BYTES : PDF_BYTES
  const contentType = kind === 'png' ? 'image/png' : 'application/pdf'
  // Tracked BEFORE the upload: if the upload lands but the call fails or times out, afterAll still removes the object
  // (removing a path that does not exist is harmless).
  uploaded.set(kit, [...(uploaded.get(kit) ?? []), path])
  const up = await kit.svc.storage.from(PM_BUCKET).upload(path, bytes, { upsert: false, contentType })
  if (up.error) throw new Error(`storeFile upload failed: ${up.error.message}`)
  const upd = await kit.svc
    .from('capture_files')
    .update({
      ingest_status: 'stored',
      content_type: contentType,
      byte_size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      storage_path: path,
      preview_state: kind === 'png' ? 'previewable' : 'not_previewable',
    })
    .eq('id', fileId)
  if (upd.error) throw new Error(`storeFile update failed: ${upd.error.message}`)
  return path
}

/** Terminal non-stored states for a pending file (service_role column grant). */
export async function markFile(kit: CaptureKit, fileId: string, state: 'failed' | 'rejected_type' | 'rejected_size'): Promise<void> {
  const patch =
    state === 'failed'
      ? { ingest_status: 'failed' }
      : { ingest_status: 'rejected', reject_reason: state === 'rejected_type' ? 'wrong_type' : 'too_large' }
  const { error } = await kit.svc.from('capture_files').update(patch).eq('id', fileId)
  if (error) throw new Error(`markFile(${state}) failed: ${error.message}`)
}

/** A document made through the real engineer function, with its (single) file moved to the requested state. */
export async function makeDocWithFile(
  kit: CaptureKit,
  kind: 'dc' | 'invoice',
  label: string,
  fileState: 'stored' | 'pending' | 'failed' | 'rejected_type' | 'stored_pdf',
  o: { tenantId?: string; projectId?: string; userId?: string } = {},
): Promise<MadeDoc & { fileId: string }> {
  const d = await makeDoc(kit, kind, label, o)
  const files = await filesOfDoc(kit, d.docId)
  if (files.length !== 1) throw new Error(`makeDocWithFile(${label}): expected 1 file, got ${files.length}`)
  const fileId = files[0].id
  if (fileState === 'stored') await storeFile(kit, fileId)
  else if (fileState === 'stored_pdf') await storeFile(kit, fileId, 'pdf_not_previewable')
  else if (fileState === 'failed') await markFile(kit, fileId, 'failed')
  else if (fileState === 'rejected_type') await markFile(kit, fileId, 'rejected_type')
  return { ...d, fileId }
}

/** Remove the objects this run uploaded. Call in afterAll BEFORE teardownCaptureKit. */
export async function removeStoredObjects(kit: CaptureKit): Promise<void> {
  const paths = uploaded.get(kit) ?? []
  if (paths.length === 0) return
  const { error } = await kit.svc.storage.from(PM_BUCKET).remove(paths)
  if (error) throw new Error(`removeStoredObjects failed: ${error.message}`)
  uploaded.set(kit, [])
}

export async function deliveryRow(kit: CaptureKit, id: string): Promise<Record<string, unknown>> {
  const { data, error } = await kit.svc.from('deliveries').select('*').eq('id', id).single()
  if (error || !data) throw new Error(`deliveryRow(${id}) failed: ${error?.message ?? 'no row'}`)
  return data as Record<string, unknown>
}

export async function activeLinkIds(kit: CaptureKit, invoiceDocId: string): Promise<Array<{ id: string; delivery_id: string; link_source: string }>> {
  const { data, error } = await kit.svc
    .from('delivery_invoice_links')
    .select('id, delivery_id, link_source')
    .eq('invoice_document_id', invoiceDocId)
    .is('unlinked_at', null)
  if (error) throw new Error(`activeLinkIds failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string; delivery_id: string; link_source: string }>
}
