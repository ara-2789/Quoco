import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { istDateString } from '@/lib/daily-logs/date'
import { PM_PENDING_TIMEOUT_MINUTES, type PmAck, type PmDocKind, type PmKindSource } from './pm-copy'

// PR-D reads (D6). EVERY read here uses the SIGNED-IN USER's client, never the service role. Membership is
// enforced by the database: the four capture tables' SELECT policies require the same tenant AND an active user
// with project_members.role = 'pm' on the row's project (supabase/migrations/049_capture_tables.sql:906-960).
// Each query still carries an explicit tenant_id filter (CLAUDE.md section 4), as the hindrance queue does.
//
// Names come from `users` (select id, full_name only; users_select = own row OR same tenant,
// supabase/migrations/007_auth_surgery.sql:216-219) and `projects` (select id, name; tenant-wide policy,
// 002_rls_policies.sql:91-93). No phone number is ever selected.

type Client = SupabaseClient<Database>
export interface PmReader {
  id: string
  tenant_id: string | null
}

/** The list reads at most this many deliveries (newest first); PostgREST `in(...)` lists stay well under URL limits. */
export const PM_LIST_LIMIT = 100

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FileDisplayState = 'stored' | 'pending' | 'pending_timeout' | 'failed' | 'rejected_type' | 'rejected_size'

/**
 * How a file is shown (D9). A `pending` file older than PM_PENDING_TIMEOUT_MINUTES is shown as `pending_timeout`,
 * NOT as failed: it can still flip to stored (051 allows pending->stored and failed->stored, 051:247-250).
 * Pure; the clock is injected.
 */
export function fileDisplayState(
  f: { ingest_status: string; reject_reason: string | null; created_at: string },
  now: Date,
): FileDisplayState {
  switch (f.ingest_status) {
    case 'stored':
      return 'stored'
    case 'rejected':
      return f.reject_reason === 'too_large' ? 'rejected_size' : 'rejected_type'
    case 'failed':
      return 'failed'
    default: {
      const ageMs = now.getTime() - new Date(f.created_at).getTime()
      return ageMs > PM_PENDING_TIMEOUT_MINUTES * 60_000 ? 'pending_timeout' : 'pending'
    }
  }
}

/**
 * Site-engineer names for the link picker (PR-D1b, R4). A NEW tenant-scoped read: the lookup is filtered by the READER's
 * tenant, so a user id that belongs to another tenant resolves to nothing and the candidate shows no name (the label's
 * em dash); the candidate itself stays in the list. Only id and full_name are selected (no phone, no email).
 */
export async function readEngineerNames(
  client: Client,
  tenantId: string,
  ids: string[],
): Promise<{ ok: true; names: Map<string, string | null> } | { ok: false; error: { code?: string | null; message?: string | null } }> {
  const unique = [...new Set(ids)]
  if (unique.length === 0) return { ok: true, names: new Map() }
  const { data, error } = await client.from('users').select('id, full_name').eq('tenant_id', tenantId).in('id', unique)
  if (error) return { ok: false, error }
  return { ok: true, names: new Map((data ?? []).map((u) => [u.id, u.full_name])) }
}

/** Whole IST calendar days from a delivery_date ('YYYY-MM-DD') to today in IST. */
export function istDaysSince(deliveryDate: string, now: Date): number {
  const [y1, m1, d1] = deliveryDate.split('-').map(Number)
  const [y2, m2, d2] = istDateString(now).split('-').map(Number)
  return Math.max(0, Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000))
}

/** kind_source as stored: 'engineer_declared' | 'pm' | NULL. Anything else is read as NULL (the 052 provenance CHECK allows only these). */
export function asKindSource(v: string | null | undefined): PmKindSource {
  return v === 'engineer_declared' ? 'engineer_declared' : v === 'pm' ? 'pm' : null
}

function asAck(v: string | null): PmAck | null {
  return v === 'yes' || v === 'no' || v === 'partial' || v === 'unclear' ? v : null
}
/**
 * The document kind, or null when it is missing or not one of the two known values. The column is NOT NULL today
 * (049:286), so null cannot occur yet; PR-D1 is tolerant of it anyway (PR-D2 / MI-KIND-REMOVAL): a row with no known kind
 * is left out of every list, detail and picker rather than guessed at.
 */
export function asKind(v: string | null | undefined): PmDocKind | null {
  return v === 'invoice' ? 'invoice' : v === 'dc' ? 'dc' : null
}

function reportRead(where: string, err: { code?: string | null; message?: string | null }): { status: 'error' } {
  // Code and message only: no row data, no ids.
  Sentry.captureException(new Error(`pm read ${where} ${err.code ?? 'no code'}: ${err.message ?? ''}`), {
    tags: { feature: 'pr-d-pm-page' },
  })
  return { status: 'error' }
}

export interface PmFileItem {
  id: string
  fileNo: number
  display: FileDisplayState
  contentType: string | null
  previewState: string | null
}

export interface PmListItem {
  id: string
  projectName: string
  status: string
  deliveryType: string | null
  dcNumber: string | null
  deliveryDate: string | null
  receivedAt: string
  kind: PmDocKind
  /** How the kind was set (D8): decides which ack wording the engineer's answer gets. */
  kindSource: PmKindSource
  ack: PmAck | null
  createdFromInvoice: boolean
  cancelReason: string | null
  engineerName: string | null
  fileCount: number
  /** DC delivery with no active invoice link (A16): days since the delivery date; null when not applicable. */
  invoiceExpectedDays: number | null
}

export type PmListResult =
  | { status: 'error' }
  | { status: 'not-a-pm' }
  | { status: 'ok'; items: PmListItem[]; truncated: boolean }

/** The deliveries a PM can still act on (050: approve and reject accept only these, 050:593 / 675). They list first. */
const OPEN_STATUSES = ['incomplete', 'awaiting_pm'] as const
const DELIVERY_COLUMNS =
  'id, project_id, status, delivery_type, vehicle_number, dc_number, delivery_date, received_at, cancel_reason, reported_by, dc_document_id, created_from_invoice_id'

/**
 * ORDER: incomplete and awaiting_pm deliveries first, then every other status; inside each group newest `received_at`
 * first. The cap (`opts.limit`, default PM_LIST_LIMIT) is applied to that combined order, so an old delivery still waiting
 * for the PM is never pushed off the list by newer approved ones. Two queries (PostgREST cannot order by a condition):
 * the open group fills the cap first; the rest fills what is left.
 */
export async function getMaterialInwardList(
  client: Client,
  reader: PmReader,
  now: Date,
  opts: { limit?: number } = {},
): Promise<PmListResult> {
  if (reader.tenant_id === null) return { status: 'not-a-pm' }
  const tenantId = reader.tenant_id
  const limit = opts.limit ?? PM_LIST_LIMIT

  const { data: mem, error: memErr } = await client
    .from('project_members')
    .select('project_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', reader.id)
    .eq('role', 'pm')
  if (memErr) return reportRead('memberships', memErr)
  const projectIds = [...new Set((mem ?? []).map((m) => m.project_id))]
  if (projectIds.length === 0) return { status: 'not-a-pm' }

  const base = () => client.from('deliveries').select(DELIVERY_COLUMNS).eq('tenant_id', tenantId).in('project_id', projectIds)

  const { data: openRows, error: openErr } = await base()
    .in('status', [...OPEN_STATUSES])
    .order('received_at', { ascending: false })
    .order('created_at', { ascending: false })
    .limit(limit + 1)
  if (openErr) return reportRead('deliveries (open)', openErr)
  let rows = (openRows ?? []).slice(0, limit)
  let truncated = (openRows ?? []).length > limit
  if (!truncated) {
    const room = limit - rows.length
    const { data: otherRows, error: otherErr } = await base()
      .not('status', 'in', `(${OPEN_STATUSES.join(',')})`)
      .order('received_at', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(room + 1)
    if (otherErr) return reportRead('deliveries (other)', otherErr)
    rows = rows.concat((otherRows ?? []).slice(0, room))
    truncated = (otherRows ?? []).length > room
  }
  if (rows.length === 0) return { status: 'ok', items: [], truncated: false }

  const docIdOf = (d: { dc_document_id: string | null; created_from_invoice_id: string | null }) =>
    d.dc_document_id ?? d.created_from_invoice_id
  const docIds = [...new Set(rows.map(docIdOf).filter((v): v is string => v !== null))]
  const deliveryIds = rows.map((r) => r.id)
  const reporterIds = [...new Set(rows.map((r) => r.reported_by))]

  const [docs, files, links, users, projects] = await Promise.all([
    client.from('capture_documents').select('id, kind, kind_source, engineer_ack').eq('tenant_id', tenantId).in('id', docIds),
    client.from('capture_files').select('document_id').eq('tenant_id', tenantId).in('document_id', docIds),
    client
      .from('delivery_invoice_links')
      .select('delivery_id')
      .eq('tenant_id', tenantId)
      .in('delivery_id', deliveryIds)
      .is('unlinked_at', null),
    client.from('users').select('id, full_name').eq('tenant_id', tenantId).in('id', reporterIds),
    client.from('projects').select('id, name').eq('tenant_id', tenantId).in('id', [...new Set(rows.map((r) => r.project_id))]),
  ])
  for (const [where, r] of [['documents', docs], ['files', files], ['links', links], ['users', users], ['projects', projects]] as const) {
    if (r.error) return reportRead(where, r.error)
  }

  const docById = new Map((docs.data ?? []).map((d) => [d.id, d]))
  const fileCount = new Map<string, number>()
  for (const f of files.data ?? []) fileCount.set(f.document_id, (fileCount.get(f.document_id) ?? 0) + 1)
  const linked = new Set((links.data ?? []).map((l) => l.delivery_id))
  const nameById = new Map((users.data ?? []).map((u) => [u.id, u.full_name]))
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]))

  const items: PmListItem[] = rows.flatMap((r): PmListItem[] => {
    const docId = docIdOf(r)
    const doc = docId ? docById.get(docId) : undefined
    const kind = doc ? asKind(doc.kind) : null
    if (kind === null) return [] // no known document kind: not listed (null-kind tolerance)
    const isDc = r.dc_document_id !== null
    const open = r.status !== 'rejected' && r.status !== 'cancelled'
    return [{
      id: r.id,
      projectName: projectName.get(r.project_id) ?? '—',
      status: r.status,
      deliveryType: r.delivery_type,
      dcNumber: r.dc_number,
      deliveryDate: r.delivery_date,
      receivedAt: r.received_at,
      kind,
      kindSource: doc ? asKindSource(doc.kind_source) : null,
      ack: doc ? asAck(doc.engineer_ack) : null,
      createdFromInvoice: r.created_from_invoice_id !== null,
      cancelReason: r.cancel_reason,
      engineerName: nameById.get(r.reported_by) ?? null,
      fileCount: docId ? (fileCount.get(docId) ?? 0) : 0,
      invoiceExpectedDays: isDc && open && !linked.has(r.id) && r.delivery_date ? istDaysSince(r.delivery_date, now) : null,
    }]
  })
  return { status: 'ok', items, truncated }
}

// ---------------------------------------------------------------------------------------------------------------
// detail
// ---------------------------------------------------------------------------------------------------------------

export interface PmLinkItem {
  linkId: string
  linkSource: string
  invoiceDocumentId: string
  deliveryId: string
}

export interface PmCandidate {
  /** invoice document id (DC page) or delivery id (invoice page) */
  id: string
  /** Invoice page (a DC delivery): deliveries.received_at. null for an invoice candidate. */
  receivedAt: string | null
  /** DC page (an invoice document): capture_documents.created_at, NOT a delivery time. null for a DC candidate. */
  documentCreatedAt: string | null
  dcNumber: string | null
  ack: PmAck | null
  /** The candidate document's own kind_source (D8). */
  kindSource: PmKindSource
  engineerName: string | null
}

export interface PmDetail {
  id: string
  projectId: string
  projectName: string
  status: string
  deliveryType: string | null
  vehicleNumber: string | null
  dcNumber: string | null
  dcDate: string | null
  deliveryDate: string | null
  receivedAt: string
  cancelReason: string | null
  rejectReason: string | null
  createdFromInvoice: boolean
  engineerName: string | null
  document: {
    id: string
    kind: PmDocKind
    kindSource: PmKindSource
    ack: PmAck | null
    ackNote: string | null
    // No `caption` on purpose (D-30 F4): capture_documents.caption holds the WhatsApp FILE NAME, not engineer text.
  }
  files: PmFileItem[]
  hasStoredFile: boolean
  /** Active links of THIS delivery (a DC has at most one; an automatic delivery has its self-link). */
  activeLinks: PmLinkItem[]
  /** Invoice page: active PM links from this invoice to DC deliveries. DC page: unused. */
  linkedDeliveries: Array<PmLinkItem & { dcNumber: string | null; receivedAt: string }>
  /** DC page: the invoice behind its active link, if any. */
  linkedInvoice: { ack: PmAck | null; documentCreatedAt: string } | null
  /** Invoice page: DC deliveries that could be linked. DC page: invoices that could be linked (only when it has no active link). */
  candidates: PmCandidate[]
  invoiceExpectedDays: number | null
}

export type PmDetailResult = { status: 'error' } | { status: 'not-found' } | { status: 'ok'; detail: PmDetail }

/** Link-picker cap. Applied AFTER every eligibility filter (the filters are in the queries), so an older eligible row is
 *  never hidden behind newer ineligible ones. */
export const PM_CANDIDATE_LIMIT = 50

/**
 * PostgREST list literal of uuids that came from the database: `(id1,id2)`. THROWS on anything that is not a uuid (review round 1,
 * N4): in an exclusion list a silently dropped id becomes an INCLUDED candidate, so a surprise must fail loudly, not quietly.
 */
export function uuidList(ids: string[]): string {
  const bad = ids.find((i) => !UUID_RE.test(i))
  if (bad !== undefined) throw new Error('uuidList: a value is not a uuid')
  return `(${ids.join(',')})`
}

export async function getDeliveryDetail(
  client: Client,
  reader: PmReader,
  deliveryId: string,
  now: Date,
  opts: { candidateLimit?: number } = {},
): Promise<PmDetailResult> {
  if (reader.tenant_id === null) return { status: 'not-found' }
  const tenantId = reader.tenant_id
  const candidateLimit = opts.candidateLimit ?? PM_CANDIDATE_LIMIT
  // deliveryId comes from the URL and is interpolated into a PostgREST `or(...)` filter below: only a UUID gets in.
  if (!UUID_RE.test(deliveryId)) return { status: 'not-found' }

  const { data: d, error: dErr } = await client
    .from('deliveries')
    .select(
      'id, project_id, status, delivery_type, vehicle_number, dc_number, dc_date, delivery_date, received_at, cancel_reason, reject_reason, reported_by, dc_document_id, created_from_invoice_id',
    )
    .eq('tenant_id', tenantId)
    .eq('id', deliveryId)
    .maybeSingle()
  if (dErr) return reportRead('delivery', dErr)
  if (!d) return { status: 'not-found' } // not found, other project, other tenant: RLS makes these the same
  const docId = d.dc_document_id ?? d.created_from_invoice_id
  if (!docId) return { status: 'not-found' }

  const [doc, files, links, project, reporter] = await Promise.all([
    client.from('capture_documents').select('id, kind, kind_source, engineer_ack, engineer_ack_note').eq('tenant_id', tenantId).eq('id', docId).maybeSingle(),
    client
      .from('capture_files')
      .select('id, file_no, ingest_status, reject_reason, preview_state, content_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('document_id', docId)
      .order('file_no', { ascending: true }),
    client
      .from('delivery_invoice_links')
      .select('id, delivery_id, invoice_document_id, link_source')
      .eq('tenant_id', tenantId)
      .is('unlinked_at', null)
      .or(`delivery_id.eq.${deliveryId},invoice_document_id.eq.${docId}`),
    client.from('projects').select('name').eq('tenant_id', tenantId).eq('id', d.project_id).maybeSingle(),
    // profile-lookup-guard:allow-id-eq -- d.reported_by is a resolved users.id, never an auth uid: written by 050 as p_user_id, and
    // constrained by the COMPOSITE same-tenant FK deliveries_reported_by_fk (reported_by, tenant_id) -> users (id, tenant_id) (049);
    // same reasoning as lib/hindrance/pm-notify.ts and owner-deliver-dispatch.ts.
    client.from('users').select('full_name').eq('tenant_id', tenantId).eq('id', d.reported_by).maybeSingle(),
  ])
  for (const [where, r] of [['document', doc], ['files', files], ['links', links], ['project', project], ['reporter', reporter]] as const) {
    if (r.error) return reportRead(where, r.error)
  }
  if (!doc.data) return { status: 'not-found' }
  const kind = asKind(doc.data.kind)
  if (kind === null) return { status: 'not-found' } // no known document kind: not shown (null-kind tolerance)

  const fileItems: PmFileItem[] = (files.data ?? []).map((f) => ({
    id: f.id,
    fileNo: f.file_no,
    display: fileDisplayState(f, now),
    contentType: f.content_type,
    previewState: f.preview_state,
  }))
  const allLinks = (links.data ?? []).map((l) => ({
    linkId: l.id,
    linkSource: l.link_source,
    invoiceDocumentId: l.invoice_document_id,
    deliveryId: l.delivery_id,
  }))
  const activeLinks = allLinks.filter((l) => l.deliveryId === deliveryId)

  const detail: PmDetail = {
    id: d.id,
    projectId: d.project_id,
    projectName: project.data?.name ?? '—',
    status: d.status,
    deliveryType: d.delivery_type,
    vehicleNumber: d.vehicle_number,
    dcNumber: d.dc_number,
    dcDate: d.dc_date,
    deliveryDate: d.delivery_date,
    receivedAt: d.received_at,
    cancelReason: d.cancel_reason,
    rejectReason: d.reject_reason,
    createdFromInvoice: d.created_from_invoice_id !== null,
    engineerName: reporter.data?.full_name ?? null,
    document: {
      id: doc.data.id,
      kind,
      kindSource: asKindSource(doc.data.kind_source),
      ack: asAck(doc.data.engineer_ack),
      ackNote: doc.data.engineer_ack_note,
    },
    files: fileItems,
    hasStoredFile: fileItems.some((f) => f.display === 'stored'),
    activeLinks,
    linkedDeliveries: [],
    linkedInvoice: null,
    candidates: [],
    invoiceExpectedDays: null,
  }

  if (kind === 'invoice') {
    // Invoice page: the DC deliveries this invoice is linked to, and the DC deliveries that could be linked.
    const pmLinks = allLinks.filter((l) => l.invoiceDocumentId === docId && l.linkSource === 'pm_manual')
    if (pmLinks.length > 0) {
      const { data: ld, error } = await client
        .from('deliveries')
        .select('id, dc_number, received_at')
        .eq('tenant_id', tenantId)
        .in('id', pmLinks.map((l) => l.deliveryId))
      if (error) return reportRead('linked deliveries', error)
      const byId = new Map((ld ?? []).map((x) => [x.id, x]))
      detail.linkedDeliveries = pmLinks.map((l) => ({
        ...l,
        dcNumber: byId.get(l.deliveryId)?.dc_number ?? null,
        receivedAt: byId.get(l.deliveryId)?.received_at ?? '',
      }))
    }
    // Invoice page -> DC deliveries to link. EVERY eligibility rule is in the query, so the cap is applied to eligible rows only
    // and an older eligible DC is never hidden behind newer ineligible ones:
    //   * a DC delivery (dc_document_id not null; automatic deliveries are not link targets, QE004);
    //   * status not rejected/cancelled (QE005);
    //   * type not internal_transfer (QE003); NULL type is allowed;
    //   * no active link (a delivery has at most one, uq_dil_active_per_delivery -> QE008): the ids that do are fetched first.
    // Order: newest received_at first, id as the tie-break.
    const { data: taken, error: tErr } = await client
      .from('delivery_invoice_links')
      .select('delivery_id')
      .eq('tenant_id', tenantId)
      .eq('project_id', d.project_id)
      .is('unlinked_at', null)
    if (tErr) return reportRead('candidate links', tErr)
    const takenIds = (taken ?? []).map((t) => t.delivery_id)
    let candQuery = client
      .from('deliveries')
      .select('id, dc_number, received_at, dc_document_id, reported_by')
      .eq('tenant_id', tenantId)
      .eq('project_id', d.project_id)
      .not('dc_document_id', 'is', null)
      .not('status', 'in', '(rejected,cancelled)')
      .or('delivery_type.is.null,delivery_type.neq.internal_transfer')
    if (takenIds.length > 0) candQuery = candQuery.not('id', 'in', uuidList(takenIds))
    const { data: cand, error: cErr } = await candQuery
      .order('received_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(candidateLimit)
    if (cErr) return reportRead('candidate deliveries', cErr)
    const eligible = cand ?? []
    if (eligible.length > 0) {
      const dcIds = eligible.map((c) => c.dc_document_id).filter((v): v is string => v !== null)
      const dcDocs = await client.from('capture_documents').select('id, engineer_ack, kind, kind_source').eq('tenant_id', tenantId).in('id', dcIds)
      if (dcDocs.error) return reportRead('candidate documents', dcDocs.error)
      const ackByDoc = new Map((dcDocs.data ?? []).map((x) => [x.id, asAck(x.engineer_ack)]))
      const sourceByDoc = new Map((dcDocs.data ?? []).map((x) => [x.id, asKindSource(x.kind_source)]))
      const dcKindOk = new Set((dcDocs.data ?? []).filter((x) => asKind(x.kind) === 'dc').map((x) => x.id))
      const shown = eligible.filter((c) => c.dc_document_id !== null && dcKindOk.has(c.dc_document_id))
      const dcNames = await readEngineerNames(client, tenantId, shown.map((c) => c.reported_by))
      if (!dcNames.ok) return reportRead('candidate engineers', dcNames.error)
      detail.candidates = shown.map((c) => ({
        id: c.id,
        receivedAt: c.received_at,
        documentCreatedAt: null,
        dcNumber: c.dc_number,
        ack: c.dc_document_id ? (ackByDoc.get(c.dc_document_id) ?? null) : null,
        kindSource: c.dc_document_id ? (sourceByDoc.get(c.dc_document_id) ?? null) : null,
        engineerName: dcNames.names.get(c.reported_by) ?? null,
      }))
    }
  } else {
    // DC page: its active invoice link, or the invoices it could be linked to.
    const mine = activeLinks[0]
    const open = d.status !== 'rejected' && d.status !== 'cancelled'
    if (mine) {
      const { data: inv, error } = await client
        .from('capture_documents')
        .select('id, engineer_ack, created_at')
        .eq('tenant_id', tenantId)
        .eq('id', mine.invoiceDocumentId)
        .not('kind', 'is', null)
        .maybeSingle()
      if (error) return reportRead('linked invoice', error)
      if (inv) detail.linkedInvoice = { ack: asAck(inv.engineer_ack), documentCreatedAt: inv.created_at }
    } else if (open && d.delivery_type !== 'internal_transfer') {
      // DC page -> invoices to link. Invoices whose AUTOMATIC delivery is approved are left out: linking one fails with QE011
      // (050:869-870). Their ids are fetched first so the cap applies to the rest. Order: newest first, id as the tie-break.
      const { data: approvedAuto, error: aErr } = await client
        .from('deliveries')
        .select('created_from_invoice_id')
        .eq('tenant_id', tenantId)
        .eq('project_id', d.project_id)
        .eq('status', 'approved')
        .not('created_from_invoice_id', 'is', null)
      if (aErr) return reportRead('approved automatic deliveries', aErr)
      const blockedInvoiceIds = (approvedAuto ?? []).map((a) => a.created_from_invoice_id).filter((v): v is string => v !== null)
      let invQuery = client
        .from('capture_documents')
        .select('id, engineer_ack, kind_source, created_at, sent_by')
        .eq('tenant_id', tenantId)
        .eq('project_id', d.project_id)
        .eq('kind', 'invoice')
      if (blockedInvoiceIds.length > 0) invQuery = invQuery.not('id', 'in', uuidList(blockedInvoiceIds))
      const { data: invs, error } = await invQuery
        .order('created_at', { ascending: false })
        .order('id', { ascending: false })
        .limit(candidateLimit)
      if (error) return reportRead('candidate invoices', error)
      const invNames = await readEngineerNames(client, tenantId, (invs ?? []).map((i) => i.sent_by))
      if (!invNames.ok) return reportRead('candidate invoice senders', invNames.error)
      detail.candidates = (invs ?? []).map((i) => ({
        id: i.id,
        receivedAt: null,
        documentCreatedAt: i.created_at,
        dcNumber: null,
        ack: asAck(i.engineer_ack),
        kindSource: asKindSource(i.kind_source),
        engineerName: invNames.names.get(i.sent_by) ?? null,
      }))
    }
    if (open && !mine && d.delivery_date) detail.invoiceExpectedDays = istDaysSince(d.delivery_date, now)
  }
  return { status: 'ok', detail }
}

// ---------------------------------------------------------------------------------------------------------------
// PR-D2: documents waiting for the PM to classify (capture_documents.kind IS NULL)
// ---------------------------------------------------------------------------------------------------------------
// These rows have NO delivery yet (the delivery is created by pm_classify_document, 052:300-305), so the PR-D1 reads, which start from
// `deliveries`, can never show them. Same user-session client and the same RLS as every other read here: capture_documents_select and
// capture_files_select (049:906, 921) carry no condition on kind, so a PM reads a kind-NULL document and its files.

export interface PmUnclassifiedItem {
  documentId: string
  projectName: string
  engineerName: string | null
  receivedAt: string
  ack: PmAck | null
  fileCount: number
  /** D4: at least one file with ingest_status 'stored'. Classify is disabled until then. */
  hasStoredFile: boolean
}

export type PmUnclassifiedResult =
  | { status: 'error' }
  | { status: 'not-a-pm' }
  | { status: 'ok'; items: PmUnclassifiedItem[]; truncated: boolean }

/** Oldest `received_at` first (the one waiting longest is on top; id breaks ties), at most `limit` (default PM_LIST_LIMIT). */
export async function getUnclassifiedList(
  client: Client,
  reader: PmReader,
  opts: { limit?: number } = {},
): Promise<PmUnclassifiedResult> {
  if (reader.tenant_id === null) return { status: 'not-a-pm' }
  const tenantId = reader.tenant_id
  const limit = opts.limit ?? PM_LIST_LIMIT

  const { data: mem, error: memErr } = await client
    .from('project_members')
    .select('project_id')
    .eq('tenant_id', tenantId)
    .eq('user_id', reader.id)
    .eq('role', 'pm')
  if (memErr) return reportRead('memberships', memErr)
  const projectIds = [...new Set((mem ?? []).map((m) => m.project_id))]
  if (projectIds.length === 0) return { status: 'not-a-pm' }

  const { data: docs, error: docErr } = await client
    .from('capture_documents')
    .select('id, project_id, sent_by, received_at, engineer_ack')
    .eq('tenant_id', tenantId)
    .in('project_id', projectIds)
    .is('kind', null)
    .order('received_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(limit + 1)
  if (docErr) return reportRead('unclassified documents', docErr)
  const truncated = (docs ?? []).length > limit
  const rows = (docs ?? []).slice(0, limit)
  if (rows.length === 0) return { status: 'ok', items: [], truncated: false }

  const docIds = rows.map((r) => r.id)
  const [files, names, projects] = await Promise.all([
    client.from('capture_files').select('document_id, ingest_status').eq('tenant_id', tenantId).in('document_id', docIds),
    readEngineerNames(client, tenantId, rows.map((r) => r.sent_by)),
    client.from('projects').select('id, name').eq('tenant_id', tenantId).in('id', [...new Set(rows.map((r) => r.project_id))]),
  ])
  if (files.error) return reportRead('unclassified files', files.error)
  if (!names.ok) return reportRead('unclassified engineers', names.error)
  if (projects.error) return reportRead('unclassified projects', projects.error)

  const fileCount = new Map<string, number>()
  const stored = new Set<string>()
  for (const f of files.data ?? []) {
    fileCount.set(f.document_id, (fileCount.get(f.document_id) ?? 0) + 1)
    if (f.ingest_status === 'stored') stored.add(f.document_id)
  }
  const projectName = new Map((projects.data ?? []).map((p) => [p.id, p.name]))

  return {
    status: 'ok',
    truncated,
    items: rows.map((r) => ({
      documentId: r.id,
      projectName: projectName.get(r.project_id) ?? '—',
      engineerName: names.names.get(r.sent_by) ?? null,
      receivedAt: r.received_at,
      ack: asAck(r.engineer_ack),
      fileCount: fileCount.get(r.id) ?? 0,
      hasStoredFile: stored.has(r.id),
    })),
  }
}

export interface PmClassifyDocument {
  id: string
  projectName: string
  engineerName: string | null
  receivedAt: string
  ack: PmAck | null
  ackNote: string | null
  files: PmFileItem[]
  hasStoredFile: boolean
}

export type PmClassifyDocResult =
  | { status: 'error' }
  | { status: 'not-found' }
  /** D5: the document already has a kind and a delivery: the page redirects to it. A kind with no delivery is 'not-found'. */
  | { status: 'redirect'; deliveryId: string }
  | { status: 'ok'; doc: PmClassifyDocument }

/** The classify page's read. RLS makes another project's / tenant's / a nonexistent document the same 'not-found'. */
export async function getClassifyDocument(client: Client, reader: PmReader, documentId: string, now: Date): Promise<PmClassifyDocResult> {
  if (reader.tenant_id === null) return { status: 'not-found' }
  const tenantId = reader.tenant_id
  // documentId comes from the URL and is interpolated into a PostgREST `or(...)` filter below: only a UUID gets in.
  if (!UUID_RE.test(documentId)) return { status: 'not-found' }

  const { data: doc, error: docErr } = await client
    .from('capture_documents')
    .select('id, project_id, kind, sent_by, received_at, engineer_ack, engineer_ack_note')
    .eq('tenant_id', tenantId)
    .eq('id', documentId)
    .maybeSingle()
  if (docErr) return reportRead('classify document', docErr)
  if (!doc) return { status: 'not-found' }

  if (doc.kind !== null) {
    const { data: del, error: delErr } = await client
      .from('deliveries')
      .select('id')
      .eq('tenant_id', tenantId)
      .or(`dc_document_id.eq.${documentId},created_from_invoice_id.eq.${documentId}`)
      .limit(1)
      .maybeSingle()
    if (delErr) return reportRead('classify delivery', delErr)
    return del ? { status: 'redirect', deliveryId: del.id } : { status: 'not-found' }
  }

  const [files, project, engineer] = await Promise.all([
    client
      .from('capture_files')
      .select('id, file_no, ingest_status, reject_reason, preview_state, content_type, created_at')
      .eq('tenant_id', tenantId)
      .eq('document_id', documentId)
      .order('file_no', { ascending: true }),
    client.from('projects').select('name').eq('tenant_id', tenantId).eq('id', doc.project_id).maybeSingle(),
    readEngineerNames(client, tenantId, [doc.sent_by]),
  ])
  if (files.error) return reportRead('classify files', files.error)
  if (project.error) return reportRead('classify project', project.error)
  if (!engineer.ok) return reportRead('classify engineer', engineer.error)

  const fileItems: PmFileItem[] = (files.data ?? []).map((f) => ({
    id: f.id,
    fileNo: f.file_no,
    display: fileDisplayState(f, now),
    contentType: f.content_type,
    previewState: f.preview_state,
  }))
  return {
    status: 'ok',
    doc: {
      id: doc.id,
      projectName: project.data?.name ?? '—',
      engineerName: engineer.names.get(doc.sent_by) ?? null,
      receivedAt: doc.received_at,
      ack: asAck(doc.engineer_ack),
      ackNote: doc.engineer_ack_note,
      files: fileItems,
      hasStoredFile: fileItems.some((f) => f.display === 'stored'),
    },
  }
}
