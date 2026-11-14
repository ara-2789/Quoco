import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { renderToStaticMarkup } from 'react-dom/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Server Actions import lib/auth/profile ('server-only'); rendering never calls them (same mock as pm-render.test.tsx).
vi.mock('@/app/(dashboard)/material-inward/actions', () => ({
  approveDeliveryAction: vi.fn(),
  rejectDeliveryAction: vi.fn(),
  setDeliveryDetailsAction: vi.fn(),
  linkInvoiceAction: vi.fn(),
  unlinkInvoiceAction: vi.fn(),
  classifyDocumentAction: vi.fn(),
}))

import { getClassifyDocument, getDeliveryDetail, getMaterialInwardList, getUnclassifiedList } from '@/lib/capture/pm-queries'
import { runClassify, type PmActionDeps } from '@/lib/capture/pm-actions'
import { mapPmRpcError } from '@/lib/capture/pm-errors'
import { ackLabel, ageInfo } from '@/components/material-inward/labels'
import { DeliveryRow } from '@/components/material-inward/delivery-row'
import { DetailView } from '@/components/material-inward/detail-view'
import { UnclassifiedSection } from '@/components/material-inward/unclassified-section'
import { ClassifyView } from '@/components/material-inward/classify-view'
import * as copy from '@/lib/capture/pm-copy'

// PR-D2 tests that need no database. The query mappers are the REAL ones, run against a small fake client that applies eq / in / is /
// not / order / limit to LITERAL rows, so a row shaped like production (kind_source 'engineer_declared', kind_set_by / kind_set_at NULL)
// goes through the real mapping code. Database-backed D2 tests are in test/pm-d2-db.test.ts.

type Row = Record<string, unknown>

class FakeQuery implements PromiseLike<{ data: Row[]; error: null }> {
  constructor(private rows: Row[], private log: Array<{ table: string; col: string; ascending: boolean }>, private table: string) {}
  private v(r: Row, col: string): unknown {
    return r[col] ?? null
  }
  select(): this {
    return this
  }
  eq(col: string, val: unknown): this {
    this.rows = this.rows.filter((r) => this.v(r, col) === val)
    return this
  }
  neq(col: string, val: unknown): this {
    this.rows = this.rows.filter((r) => this.v(r, col) !== val)
    return this
  }
  in(col: string, vals: unknown[]): this {
    this.rows = this.rows.filter((r) => vals.includes(this.v(r, col)))
    return this
  }
  is(col: string, val: null): this {
    this.rows = this.rows.filter((r) => this.v(r, col) === val)
    return this
  }
  not(col: string, op: string, val: unknown): this {
    if (op === 'is' && val === null) this.rows = this.rows.filter((r) => this.v(r, col) !== null)
    else if (op === 'in' && typeof val === 'string') {
      const set = val.replace(/[()]/g, '').split(',')
      this.rows = this.rows.filter((r) => !set.includes(String(this.v(r, col))))
    }
    return this
  }
  or(expr: string): this {
    // only the `col.eq.value,col.eq.value` shape the PM queries use; any other expression leaves the rows alone
    const alts = expr.split(',').map((a) => a.split('.'))
    if (alts.every((a) => a.length === 3 && a[1] === 'eq')) this.rows = this.rows.filter((r) => alts.some(([col, , val]) => this.v(r, col) === val))
    return this
  }
  order(col: string, o?: { ascending?: boolean }): this {
    const ascending = o?.ascending ?? true
    this.log.push({ table: this.table, col, ascending })
    this.rows = [...this.rows].sort((a, b) => {
      const x = String(this.v(a, col))
      const y = String(this.v(b, col))
      return (x < y ? -1 : x > y ? 1 : 0) * (ascending ? 1 : -1)
    })
    return this
  }
  limit(n: number): this {
    this.rows = this.rows.slice(0, n)
    return this
  }
  maybeSingle(): Promise<{ data: Row | null; error: null }> {
    return Promise.resolve({ data: this.rows[0] ?? null, error: null })
  }
  then<T1 = { data: Row[]; error: null }, T2 = never>(
    onfulfilled?: ((value: { data: Row[]; error: null }) => T1 | PromiseLike<T1>) | null,
    onrejected?: ((reason: unknown) => T2 | PromiseLike<T2>) | null,
  ): PromiseLike<T1 | T2> {
    return Promise.resolve({ data: this.rows, error: null }).then(onfulfilled, onrejected)
  }
}

function fakeClient(tables: Record<string, Row[]>) {
  const orders: Array<{ table: string; col: string; ascending: boolean }> = []
  const client = { from: (table: string) => new FakeQuery(tables[table] ?? [], orders, table) } as unknown as SupabaseClient<Database>
  return { client, orders }
}

const T = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222221'
const U_PM = '33333333-3333-4333-8333-333333333331'
const U_ENG = '33333333-3333-4333-8333-333333333332'
const DOC_DC = '44444444-4444-4444-8444-444444444441'
const DOC_INV = '44444444-4444-4444-8444-444444444442'
const DEL_DC = '55555555-5555-4555-8555-555555555551'
const DEL_INV = '55555555-5555-4555-8555-555555555552'
const FILE_1 = '66666666-6666-4666-8666-666666666661'
const NOW = new Date('2026-11-14T10:00:00Z')

// LITERAL production-shaped rows (review condition 1): the five D-30 rows after migration 052 look like these. kind_source
// 'engineer_declared', kind_set_by / kind_set_at NULL, received_at set, one delivery each.
function docRow(id: string, kind: 'dc' | 'invoice'): Row {
  return {
    id,
    created_at: '2026-10-30T05:00:01.250+00:00',
    tenant_id: T,
    project_id: P1,
    kind,
    kind_source: 'engineer_declared',
    kind_set_at: null,
    kind_set_by: null,
    sent_by: U_ENG,
    source_message_sid: `SM-${id}`,
    received_at: '2026-10-30T05:00:00.500+00:00',
    engineer_ack: 'yes',
    engineer_ack_at: '2026-10-30T05:01:00+00:00',
    engineer_ack_note: null,
    caption: 'phone pdf.pdf',
  }
}
const PROD_TABLES: Record<string, Row[]> = {
  project_members: [{ project_id: P1, tenant_id: T, user_id: U_PM, role: 'pm' }],
  deliveries: [
    {
      id: DEL_DC, tenant_id: T, project_id: P1, status: 'awaiting_pm', delivery_type: 'supplier', vehicle_number: 'TN01', dc_number: 'DC-1',
      dc_date: null, delivery_date: '2026-10-30', received_at: '2026-10-30T05:00:00.500+00:00', created_at: '2026-10-30T05:00:02+00:00',
      cancel_reason: null, reject_reason: null, reported_by: U_ENG, dc_document_id: DOC_DC, created_from_invoice_id: null,
    },
    {
      id: DEL_INV, tenant_id: T, project_id: P1, status: 'awaiting_pm', delivery_type: null, vehicle_number: null, dc_number: null,
      dc_date: null, delivery_date: null, received_at: '2026-10-30T06:00:00.500+00:00', created_at: '2026-10-30T06:00:02+00:00',
      cancel_reason: null, reject_reason: null, reported_by: U_ENG, dc_document_id: null, created_from_invoice_id: DOC_INV,
    },
  ],
  capture_documents: [docRow(DOC_DC, 'dc'), docRow(DOC_INV, 'invoice')],
  capture_files: [
    { id: FILE_1, tenant_id: T, project_id: P1, document_id: DOC_DC, file_no: 1, ingest_status: 'stored', reject_reason: null, preview_state: 'previewable', content_type: 'image/png', created_at: '2026-10-30T05:00:03+00:00' },
  ],
  delivery_invoice_links: [],
  users: [{ id: U_ENG, tenant_id: T, full_name: 'Ravi' }],
  projects: [{ id: P1, tenant_id: T, name: 'Site A' }],
}
const BAD_TEXT = /\b(undefined|null|Invalid Date|NaN)\b/
const READER = { id: U_PM, tenant_id: T }

describe('T-D2-PROD-SHAPE: documents shaped like production rows (kind_source engineer_declared, kind_set_* NULL)', () => {
  it('the list renders both, neither is in the unclassified section, no undefined / null / Invalid Date / NaN anywhere', async () => {
    const { client } = fakeClient(PROD_TABLES)
    const list = await getMaterialInwardList(client, READER, NOW)
    expect(list.status).toBe('ok')
    if (list.status !== 'ok') return
    expect(list.items.map((i) => i.id).sort()).toEqual([DEL_DC, DEL_INV].sort())
    for (const item of list.items) {
      const html = renderToStaticMarkup(<DeliveryRow item={item} />)
      expect(html).not.toMatch(BAD_TEXT)
      expect(item.kindSource).toBe('engineer_declared')
    }
    // the per-kind pre-052 wording is kept for engineer_declared rows
    const dc = list.items.find((i) => i.id === DEL_DC)
    expect(renderToStaticMarkup(<DeliveryRow item={dc as NonNullable<typeof dc>} />)).toContain(copy.PM_ACK_DC_YES)
    const inv = list.items.find((i) => i.id === DEL_INV)
    expect(renderToStaticMarkup(<DeliveryRow item={inv as NonNullable<typeof inv>} />)).toContain(copy.PM_ACK_INVOICE_YES)

    const uncl = await getUnclassifiedList(client, READER)
    expect(uncl.status).toBe('ok')
    if (uncl.status !== 'ok') return
    expect(uncl.items).toHaveLength(0)
    const sec = renderToStaticMarkup(<UnclassifiedSection result={uncl} now={NOW} />)
    expect(sec).toContain(copy.PM_UNCLASSIFIED_EMPTY)
    expect(sec).not.toContain(DOC_DC)
    expect(sec).not.toContain(DOC_INV)
    expect(sec).not.toMatch(BAD_TEXT)
  })

  it('the detail pages (dc and invoice) render with no undefined / null / Invalid Date / NaN', async () => {
    for (const [del, kind] of [[DEL_DC, 'dc'], [DEL_INV, 'invoice']] as const) {
      const { client } = fakeClient(PROD_TABLES)
      const r = await getDeliveryDetail(client, READER, del, NOW)
      expect(r.status).toBe('ok')
      if (r.status !== 'ok') return
      expect(r.detail.document.kind).toBe(kind)
      expect(r.detail.document.kindSource).toBe('engineer_declared')
      const html = renderToStaticMarkup(<DetailView d={r.detail} />)
      expect(html).not.toMatch(BAD_TEXT)
      expect(html).toContain('data-testid="own-ack"')
    }
  })
})

// kind-NULL rows: what the unclassified list reads. Two documents whose received_at order is the OPPOSITE of their created_at order.
function unclassifiedRow(id: string, receivedAt: string, createdAt: string, extra: Row = {}): Row {
  return {
    id, tenant_id: T, project_id: P1, kind: null, kind_source: null, kind_set_at: null, kind_set_by: null, sent_by: U_ENG,
    received_at: receivedAt, created_at: createdAt, engineer_ack: null, ...extra,
  }
}
const DOC_A = '77777777-7777-4777-8777-777777777771'
const DOC_B = '77777777-7777-4777-8777-777777777772'
const UNCL_TABLES: Record<string, Row[]> = {
  project_members: PROD_TABLES.project_members,
  // A: received FIRST (08:00) but created LAST (12:00); B: received 09:00, created 10:00. received_at order: A, B. created_at order: B, A.
  capture_documents: [
    unclassifiedRow(DOC_B, '2026-11-14T09:00:00+00:00', '2026-11-14T10:00:00+00:00', { engineer_ack: 'yes' }),
    unclassifiedRow(DOC_A, '2026-11-14T08:00:00+00:00', '2026-11-14T12:00:00+00:00'),
    docRow(DOC_DC, 'dc'), // a classified document is never in this list
  ],
  capture_files: [
    { document_id: DOC_A, ingest_status: 'stored', tenant_id: T },
    { document_id: DOC_B, ingest_status: 'pending', tenant_id: T },
  ],
  users: PROD_TABLES.users,
  projects: PROD_TABLES.projects,
}

describe('T-D2-LIST: the unclassified list', () => {
  it('holds only kind-NULL documents, oldest received_at first, with ordering taken from received_at (not created_at)', async () => {
    const { client, orders } = fakeClient(UNCL_TABLES)
    const r = await getUnclassifiedList(client, READER)
    expect(r.status).toBe('ok')
    if (r.status !== 'ok') return
    expect(r.items.map((i) => i.documentId)).toEqual([DOC_A, DOC_B])
    expect(orders.filter((o) => o.table === 'capture_documents')[0]).toEqual({ table: 'capture_documents', col: 'received_at', ascending: true })
    expect(r.items[0].receivedAt).toBe('2026-11-14T08:00:00+00:00') // the item carries received_at, never created_at
    expect(r.items[0].hasStoredFile).toBe(true)
    expect(r.items[1].hasStoredFile).toBe(false) // D4: B's only file is pending
    expect(r.items[1].ack).toBe('yes')
  })

  it('is capped at the limit and says so (truncated), and an empty list is ok with no items', async () => {
    const { client } = fakeClient(UNCL_TABLES)
    const r = await getUnclassifiedList(client, READER, { limit: 1 })
    expect(r.status === 'ok' && r.items.length === 1 && r.truncated === true).toBe(true)
    const none = await getUnclassifiedList(fakeClient({ ...UNCL_TABLES, capture_documents: [] }).client, READER)
    expect(none).toEqual({ status: 'ok', items: [], truncated: false })
  })

  it('renders rows with the age taken from received_at, no kind word, the neutral answer wording, and the pending-file label when nothing is stored', async () => {
    const { client } = fakeClient(UNCL_TABLES)
    const r = await getUnclassifiedList(client, READER)
    if (r.status !== 'ok') throw new Error('list not ok')
    const html = renderToStaticMarkup(<UnclassifiedSection result={r} now={NOW} />)
    expect(html).toContain(copy.PM_UNCLASSIFIED_HEADING)
    expect(html).toContain(`/material-inward/classify/${DOC_A}`)
    // A was received 08:00, NOW is 10:00 -> 2 h ago (created_at 12:00 would give "Just now")
    expect(html).toContain('2 h ago')
    expect(html).toContain(copy.PM_ACK_INVOICE_YES) // B answered 'yes' with no kind: neutral wording, never "No answer yet"
    expect(html).toContain(copy.PM_LABEL_FILE_PENDING) // B has no stored file
    expect(html).not.toContain(copy.PM_KIND_DC)
    expect(html).not.toContain(copy.PM_KIND_INVOICE)
    expect(html).not.toContain(copy.PM_CLASSIFY_CONFIRM_NOTE)
    expect(html).not.toMatch(BAD_TEXT)
  })

  it('a reader who is a PM of no project gets not-a-pm, and the section then renders nothing', async () => {
    const { client } = fakeClient({ ...UNCL_TABLES, project_members: [] })
    const r = await getUnclassifiedList(client, READER)
    expect(r.status).toBe('not-a-pm')
    expect(renderToStaticMarkup(<UnclassifiedSection result={r} now={NOW} />)).toBe('')
  })
})

describe('T-D2-AGE and T-D2-HIGHLIGHT: age text and the 24 h badge (injected now)', () => {
  const at = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
  const H = 3_600_000
  const M = 60_000
  it('59 min is "Just now"; 1 h, 47 h, 48 h and later use whole hours then whole days', () => {
    expect(ageInfo(at(59 * M), NOW).text).toBe(copy.PM_AGE_JUST_NOW)
    expect(ageInfo(at(0), NOW).text).toBe(copy.PM_AGE_JUST_NOW)
    expect(ageInfo(at(60 * M), NOW).text).toBe('1 h ago')
    expect(ageInfo(at(47 * H), NOW).text).toBe('47 h ago')
    expect(ageInfo(at(47 * H + 59 * M), NOW).text).toBe('47 h ago')
    expect(ageInfo(at(48 * H), NOW).text).toBe('2 days ago')
    expect(ageInfo(at(71 * H + 59 * M), NOW).text).toBe('2 days ago')
    expect(ageInfo(at(72 * H), NOW).text).toBe('3 days ago')
  })
  it('a future or unreadable received_at is "Just now", never negative or NaN', () => {
    expect(ageInfo(at(-5 * H), NOW).text).toBe(copy.PM_AGE_JUST_NOW)
    expect(ageInfo('not a date', NOW).text).toBe(copy.PM_AGE_JUST_NOW)
    expect(ageInfo('not a date', NOW).overdue).toBe(false)
  })
  function sectionAt(ms: number): string {
    return renderToStaticMarkup(
      <UnclassifiedSection
        now={NOW}
        result={{ status: 'ok', truncated: false, items: [{ documentId: DOC_A, projectName: 'P', engineerName: 'E', receivedAt: at(ms), ack: null, fileCount: 1, hasStoredFile: true }] }}
      />,
    )
  }
  it('23 h 59 m shows no badge; 24 h 00 m shows it', () => {
    expect(sectionAt(23 * H + 59 * M)).not.toContain(copy.PM_AGE_OVERDUE)
    expect(sectionAt(24 * H)).toContain(copy.PM_AGE_OVERDUE)
    expect(sectionAt(24 * H + 1)).toContain(copy.PM_AGE_OVERDUE)
  })
})

describe('T-D2-ACK-LABELS (D8)', () => {
  it('engineer_declared keeps the per-kind labels (pre-052 rows)', () => {
    expect(ackLabel('dc', 'yes', 'engineer_declared')).toBe(copy.PM_ACK_DC_YES)
    expect(ackLabel('dc', 'no', 'engineer_declared')).toBe(copy.PM_ACK_DC_NO)
    expect(ackLabel('dc', 'partial', 'engineer_declared')).toBe(copy.PM_ACK_DC_PARTIAL)
    expect(ackLabel('dc', 'unclear', 'engineer_declared')).toBe(copy.PM_ACK_DC_UNCLEAR)
    expect(ackLabel('invoice', 'yes', 'engineer_declared')).toBe(copy.PM_ACK_INVOICE_YES)
    expect(ackLabel('invoice', 'unclear', 'engineer_declared')).toBe(copy.PM_ACK_INVOICE_UNCLEAR)
  })
  it("'pm' dc, 'pm' invoice and kind NULL all use Matches / Does not match / Partly matches; unclear is PM_ACK_DC_UNCLEAR", () => {
    for (const [kind, src] of [['dc', 'pm'], ['invoice', 'pm'], [null, null]] as const) {
      expect(ackLabel(kind, 'yes', src), `${kind}/${src}`).toBe('Matches')
      expect(ackLabel(kind, 'no', src)).toBe('Does not match')
      expect(ackLabel(kind, 'partial', src)).toBe('Partly matches')
      expect(ackLabel(kind, 'unclear', src)).toBe(copy.PM_ACK_DC_UNCLEAR)
      expect(ackLabel(kind, null, src)).toBe(copy.PM_ACK_NONE)
    }
  })
  it("a 'pm' DC detail page renders 'Matches' for answer 1 and never 'All arrived'", async () => {
    const tables = {
      ...PROD_TABLES,
      capture_documents: [{ ...docRow(DOC_DC, 'dc'), kind_source: 'pm', kind_set_at: '2026-10-30T05:02:00+00:00', kind_set_by: U_PM }],
    }
    const r = await getDeliveryDetail(fakeClient(tables).client, READER, DEL_DC, NOW)
    if (r.status !== 'ok') throw new Error('detail not ok')
    expect(r.detail.document.kindSource).toBe('pm')
    const html = renderToStaticMarkup(<DetailView d={r.detail} />)
    expect(html).toContain('Matches')
    expect(html).not.toContain(copy.PM_ACK_DC_YES)
  })
})

// ---------------------------------------------------------------------------------------------------------------------------------
// the classify action
// ---------------------------------------------------------------------------------------------------------------------------------
function rpcClient(result: { data: unknown; error: { code?: string; message?: string } | null }) {
  const calls: Array<{ fn: string; args: unknown }> = []
  const client = { rpc: (fn: string, args: unknown) => (calls.push({ fn, args }), Promise.resolve(result)) } as unknown as SupabaseClient<Database>
  const deps: PmActionDeps = { client, profile: { id: U_PM, tenant_id: T } }
  return { deps, calls }
}
const GOOD = { document_id: DOC_A, kind: 'dc', delivery_id: DEL_DC, self_link_id: null, already_classified: false }

describe('T-D2-ERRMAP: every classify refusal is a named string, never the raw database text', () => {
  it('QE015 -> not available; QE011 -> other kind; QE009 / QE012 / QE014 / 23xxx / unknown / none -> the reported catch-all', () => {
    expect(mapPmRpcError('classify', 'QE015')).toBe('PM_ERR_CLASSIFY_NOT_AVAILABLE')
    expect(mapPmRpcError('classify', 'QE011')).toBe('PM_ERR_CLASSIFY_OTHER_KIND')
    for (const code of ['QE009', 'QE012', 'QE014', '23514', '23503', '23505', 'XX000', 'PGRST301', '', null, undefined]) {
      expect(mapPmRpcError('classify', code), String(code)).toBe('PM_ERR_CLASSIFY_FAILED')
    }
    // the other five actions are untouched: QE011 there still means what it meant
    expect(mapPmRpcError('approve', 'QE011')).toBe('PM_ERR_STATE_CHANGED')
    expect(mapPmRpcError('approve', 'QE015')).toBe('PM_ERR_NOT_AVAILABLE')
  })
  it('there is no PM_ERR_CLASSIFY_KIND_CHANGE', () => {
    expect('PM_ERR_CLASSIFY_KIND_CHANGE' in copy).toBe(false)
  })
  it('runClassify returns the mapped string for each code and never the raw message', async () => {
    const RAW = 'RAW-DB-TEXT-must-not-leak: relation "capture_documents" row-level security'
    const expected: Array<[string, string]> = [
      ['QE015', copy.PM_ERR_CLASSIFY_NOT_AVAILABLE],
      ['QE011', copy.PM_ERR_CLASSIFY_OTHER_KIND],
      ['QE009', copy.PM_ERR_CLASSIFY_FAILED],
      ['QE012', copy.PM_ERR_CLASSIFY_FAILED],
      ['QE014', copy.PM_ERR_CLASSIFY_FAILED],
      ['23514', copy.PM_ERR_CLASSIFY_FAILED],
      ['ZZZZZ', copy.PM_ERR_CLASSIFY_FAILED],
    ]
    for (const [code, text] of expected) {
      const { deps } = rpcClient({ data: null, error: { code, message: RAW } })
      const r = await runClassify(deps, { documentId: DOC_A, kind: 'dc' })
      expect(r.status).toBe('error')
      if (r.status !== 'error') return
      expect(r.message, code).toBe(text)
      expect(JSON.stringify(r)).not.toContain('RAW-DB-TEXT')
    }
  })
  it('bad input never reaches the database', async () => {
    const { deps, calls } = rpcClient({ data: GOOD, error: null })
    for (const bad of [{ documentId: 'not-a-uuid', kind: 'dc' }, { documentId: DOC_A, kind: 'receipt' }, { documentId: DOC_A, kind: '' }]) {
      const r = await runClassify(deps, bad)
      expect(r).toMatchObject({ status: 'error', key: 'PM_ERR_CLASSIFY_FAILED' })
    }
    expect(calls).toHaveLength(0)
  })
  it('a thrown error is the catch-all string, not an exception', async () => {
    const client = { rpc: () => Promise.reject(new Error('boom: secret')) } as unknown as SupabaseClient<Database>
    const r = await runClassify({ client, profile: { id: U_PM, tenant_id: T } }, { documentId: DOC_A, kind: 'dc' })
    expect(r).toMatchObject({ status: 'error', key: 'PM_ERR_CLASSIFY_FAILED', message: copy.PM_ERR_CLASSIFY_FAILED })
    expect(JSON.stringify(r)).not.toContain('secret')
  })
})

describe('T-D2-ECHO (D7): success is never inferred', () => {
  it('a result echoing the document id with a delivery id is ok, and the RPC got exactly the id and kind', async () => {
    const { deps, calls } = rpcClient({ data: GOOD, error: null })
    expect(await runClassify(deps, { documentId: DOC_A, kind: 'dc' })).toEqual({ status: 'ok', deliveryId: DEL_DC })
    expect(calls).toEqual([{ fn: 'pm_classify_document', args: { p_document_id: DOC_A, p_kind: 'dc' } }])
  })
  it('already_classified:true with the same delivery is the same success (T-D2-ALREADY, unit side)', async () => {
    const { deps } = rpcClient({ data: { ...GOOD, already_classified: true }, error: null })
    expect(await runClassify(deps, { documentId: DOC_A, kind: 'dc' })).toEqual({ status: 'ok', deliveryId: DEL_DC })
  })
  it('a mismatched document id, a null or non-uuid delivery id, a missing or non-object result is PM_ERR_CLASSIFY_FAILED', async () => {
    const bad: unknown[] = [
      { ...GOOD, document_id: DOC_B },
      { ...GOOD, delivery_id: null },
      { ...GOOD, delivery_id: 'x/../../admin' },
      { kind: 'dc' },
      null,
      'ok',
      [GOOD],
    ]
    for (const data of bad) {
      const { deps } = rpcClient({ data, error: null })
      const r = await runClassify(deps, { documentId: DOC_A, kind: 'dc' })
      expect(r, JSON.stringify(data)).toMatchObject({ status: 'error', key: 'PM_ERR_CLASSIFY_FAILED' })
    }
  })
})

describe('T-D2-NOFILE (D4): no stored file -> both classify buttons are disabled', () => {
  const doc = (stored: boolean) => ({
    id: DOC_A, projectName: 'P', engineerName: 'E', receivedAt: NOW.toISOString(), ack: null, ackNote: null, hasStoredFile: stored,
    files: [{ id: FILE_1, fileNo: 1, display: stored ? ('stored' as const) : ('pending' as const), contentType: 'image/png', previewState: 'previewable' }],
  })
  function buttons(html: string): string[] {
    return [...html.matchAll(/<button[^>]*>.*?<\/button>/g)].map((m) => m[0]).filter((b) => b.includes(copy.PM_CLASSIFY_AS_DC) || b.includes(copy.PM_CLASSIFY_AS_INVOICE))
  }
  it('with no stored file both buttons are disabled and the pending label is shown', () => {
    const html = renderToStaticMarkup(<ClassifyView doc={doc(false)} now={NOW} />)
    const b = buttons(html)
    expect(b).toHaveLength(2)
    for (const x of b) expect(x).toContain('disabled=""')
    expect(html).toContain(copy.PM_LABEL_FILE_PENDING)
  })
  it('POSITIVE CONTROL: with a stored file neither button is disabled, and no confirm step shows before a choice', () => {
    const html = renderToStaticMarkup(<ClassifyView doc={doc(true)} now={NOW} />)
    const b = buttons(html)
    expect(b).toHaveLength(2)
    for (const x of b) expect(x).not.toContain('disabled=""')
    expect(html).not.toContain(copy.PM_CLASSIFY_CONFIRM_NOTE)
    expect(html).not.toContain(copy.PM_CONFIRM_CLASSIFY_DC)
  })
  it('the classify page is neutral: no kind word other than the two choices, the neutral answer wording, no caption, no phone', () => {
    const html = renderToStaticMarkup(<ClassifyView doc={{ ...doc(true), ack: 'yes' }} now={NOW} />)
    expect(html).toContain(copy.PM_CLASSIFY_HEADING)
    expect(html).toContain('Matches')
    expect(html).not.toMatch(BAD_TEXT)
    expect(html).not.toMatch(/caption/i)
  })
})

describe('T-D2-SESSION-CLIENT (D11): the classify path never imports the service-role client', () => {
  const FILES = [
    'lib/capture/pm-actions.ts',
    'lib/capture/pm-errors.ts',
    'lib/capture/pm-queries.ts',
    'app/(dashboard)/material-inward/actions.ts',
    'app/(dashboard)/material-inward/classify-controls.tsx',
    'app/(dashboard)/material-inward/classify/[documentId]/page.tsx',
    'components/material-inward/classify-view.tsx',
    'components/material-inward/unclassified-section.tsx',
  ]
  it.each(FILES)('%s has no service-role import or call', (f) => {
    const src = readFileSync(resolve(__dirname, '..', f), 'utf8')
    expect(src).not.toMatch(/supabase\/service/)
    expect(src).not.toMatch(/createServiceClient|SERVICE_ROLE/)
  })
  it('POSITIVE CONTROL: the scan can see what it looks for (the file route legitimately uses the service client to sign)', () => {
    const src = readFileSync(resolve(__dirname, '..', 'lib/capture/pm-file-access.ts'), 'utf8')
    expect(src).toMatch(/createServiceClient/)
  })
  it('the action builds its client with buildDeps() (the session client), as the five existing actions do', () => {
    const src = readFileSync(resolve(__dirname, '..', 'app/(dashboard)/material-inward/actions.ts'), 'utf8')
    expect(src).toMatch(/classifyDocumentAction[\s\S]*runClassify\(await buildDeps\(\)/)
  })
})

describe('D5: an already-classified document on the classify URL', () => {
  it('redirects to its delivery; a kind with no delivery is not-found; a kind-NULL document is shown', async () => {
    const withDelivery = await getClassifyDocument(fakeClient(PROD_TABLES).client, READER, DOC_DC, NOW)
    expect(withDelivery).toEqual({ status: 'redirect', deliveryId: DEL_DC })
    const invoice = await getClassifyDocument(fakeClient(PROD_TABLES).client, READER, DOC_INV, NOW)
    expect(invoice).toEqual({ status: 'redirect', deliveryId: DEL_INV })
    const noDelivery = await getClassifyDocument(fakeClient({ ...PROD_TABLES, deliveries: [] }).client, READER, DOC_DC, NOW)
    expect(noDelivery).toEqual({ status: 'not-found' })
    const open = await getClassifyDocument(fakeClient(UNCL_TABLES).client, READER, DOC_A, NOW)
    expect(open.status).toBe('ok')
    expect(await getClassifyDocument(fakeClient(UNCL_TABLES).client, { id: U_PM, tenant_id: null }, DOC_A, NOW)).toEqual({ status: 'not-found' })
  })
})
