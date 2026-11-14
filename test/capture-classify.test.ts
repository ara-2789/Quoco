// Migration 052 (MI-KIND-REMOVAL), block 2b: the PM classification, through the real wrapper public.pm_classify_document
// over PostgREST with REAL JWTs (docs/reviews/052-design/kind-removal-plan.md section F, T-C-*; SQL review round 1 S-5).
//
// Test IDs: T-C-1 (+1b), T-C-2, T-C-3, S-5, T-C-5, T-C-6, T-C-7, T-C-8, T-C-9. T-C-4 (two callers at once) is in
// test/capture-races.test.ts with the other CI-only tests.
//
// RULE (task 2e): every test that asserts a REFUSAL is paired, in this same file, with a passing call that shows the same
// path can succeed (a PM of the project classifies the same document, or an admin who is also a PM member does).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  buildCaptureKit,
  captureAnon,
  classifyAsPm,
  getDelivery,
  linksOfDelivery,
  linksOfInvoice,
  makeUnclassifiedDoc,
  miTurn,
  teardownCaptureKit,
  type CaptureKit,
  type ClassifyResult,
} from './helpers/capture-fixtures'

let kit: CaptureKit

beforeAll(async () => {
  kit = await buildCaptureKit('classify', ['eng', 'engWeb', 'pm1', 'pm2', 'pmB', 'qs', 'deact', 'admNon', 'admMem'])
})

afterAll(async () => {
  if (kit) await teardownCaptureKit(kit)
})

interface DocState {
  kind: string | null
  kind_source: string | null
  kind_set_at: string | null
  kind_set_by: string | null
  received_at: string
  sent_by: string
  engineer_ack: string | null
}

async function docState(docId: string): Promise<DocState> {
  const { data, error } = await kit.svc
    .from('capture_documents')
    .select('kind,kind_source,kind_set_at,kind_set_by,received_at,sent_by,engineer_ack')
    .eq('id', docId)
    .single<DocState>()
  if (error || !data) throw new Error(`docState(${docId}) failed: ${error?.message ?? 'no row'}`)
  return data
}

async function deliveriesOf(docId: string): Promise<Array<{ id: string }>> {
  const { data, error } = await kit.svc.from('deliveries').select('id').or(`dc_document_id.eq.${docId},created_from_invoice_id.eq.${docId}`)
  if (error) throw new Error(`deliveriesOf failed: ${error.message}`)
  return (data ?? []) as Array<{ id: string }>
}

/** Raw PostgREST call, so a test can see the HTTP status and the error code the real API returns. */
async function rawRpc(fn: string, args: Record<string, unknown>, o: { token: string; apikey?: string; schema?: string }) {
  const r = await fetch(`${process.env.SUPABASE_TEST_URL}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: o.apikey ?? process.env.SUPABASE_TEST_ANON_KEY!,
      Authorization: `Bearer ${o.token}`,
      'Content-Type': 'application/json',
      ...(o.schema ? { 'Content-Profile': o.schema } : {}),
    },
    body: JSON.stringify(args),
  })
  const body = (await r.json().catch(() => null)) as { code?: string; message?: string } | null
  return { status: r.status, code: body?.code, message: body?.message }
}

async function accessTokenOf(label: 'pm1'): Promise<string> {
  const c = await kit.jwt(label)
  const { data } = await c.auth.getSession()
  if (!data.session) throw new Error('no session')
  return data.session.access_token
}

describe('T-C-1 classification creates the delivery (and for an invoice the self-link) from the locked document row', () => {
  it('a DC: exactly the 5 result keys; 1 delivery, 0 links; received_at equals the document and the dedup row; reported_by is the ENGINEER; kind_set_by is the PM', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c1-dc')
    expect(await docState(u.docId)).toMatchObject({ kind: null, kind_source: null, kind_set_at: null, kind_set_by: null })
    expect(await deliveriesOf(u.docId)).toHaveLength(0)

    const c = await classifyAsPm(kit, u.docId, 'dc')
    expect(c.error).toBeNull()
    const res = c.data as ClassifyResult
    expect(Object.keys(res).sort()).toEqual(['already_classified', 'delivery_id', 'document_id', 'kind', 'self_link_id'])
    expect(res).toMatchObject({ document_id: u.docId, kind: 'dc', self_link_id: null, already_classified: false })

    const d = await getDelivery(kit, res.delivery_id)
    expect(d).toMatchObject({ dc_document_id: u.docId, created_from_invoice_id: null, status: 'incomplete', tenant_id: kit.tenantA, project_id: kit.p1 })
    expect(await deliveriesOf(u.docId)).toHaveLength(1)
    expect(await linksOfDelivery(kit, d.id)).toHaveLength(0)
    expect(await linksOfInvoice(kit, u.docId)).toHaveLength(0)

    const doc = await docState(u.docId)
    expect(doc).toMatchObject({ kind: 'dc', kind_source: 'pm', kind_set_by: kit.uid('pm1'), sent_by: kit.uid('eng') })
    expect(doc.kind_set_at).not.toBeNull()
    const { data: pm } = await kit.svc.from('processed_messages').select('created_at').eq('message_sid', u.fileSid).single<{ created_at: string }>()
    expect(new Date(doc.received_at).getTime()).toBe(new Date(pm!.created_at).getTime())
    expect(new Date(d.received_at).getTime()).toBe(new Date(doc.received_at).getTime())
    const { data: rep } = await kit.svc.from('deliveries').select('reported_by').eq('id', d.id).single<{ reported_by: string }>()
    expect(rep!.reported_by).toBe(kit.uid('eng')) // the engineer who sent it, never the PM
    expect(rep!.reported_by).not.toBe(kit.uid('pm1'))
  })

  it('an invoice: 1 delivery created from the invoice and 1 ACTIVE self-link, the same 5 keys, self_link_id is the link', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c1-inv')
    const c = await classifyAsPm(kit, u.docId, 'invoice')
    expect(c.error).toBeNull()
    const res = c.data as ClassifyResult
    expect(Object.keys(res).sort()).toEqual(['already_classified', 'delivery_id', 'document_id', 'kind', 'self_link_id'])
    expect(res).toMatchObject({ kind: 'invoice', already_classified: false })
    expect(await getDelivery(kit, res.delivery_id)).toMatchObject({ created_from_invoice_id: u.docId, dc_document_id: null, status: 'incomplete' })
    const links = await linksOfInvoice(kit, u.docId)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ id: res.self_link_id, link_source: 'created_from_invoice', unlinked_at: null, delivery_id: res.delivery_id })
  })

  it('T-C-1b the status table: no ack -> incomplete; yes / no / partial / unclear -> awaiting_pm (the ack is read from the document under the lock)', async () => {
    const cases: Array<[string, string[], 'incomplete' | 'awaiting_pm', string | null]> = [
      ['none', [], 'incomplete', null],
      ['yes', ['1'], 'awaiting_pm', 'yes'],
      ['no', ['2'], 'awaiting_pm', 'no'],
      ['partial', ['3'], 'awaiting_pm', 'partial'],
      ['unclear', ['maybe', 'ZZ not sure'], 'awaiting_pm', 'unclear'],
    ]
    for (const [name, replies, status, storedAck] of cases) {
      const label = `c1b-${name}`
      const u = await makeUnclassifiedDoc(kit, label)
      for (const [i, text] of replies.entries()) await miTurn(kit, u.phone, text, kit.sid(`${label}-r${i}`))
      expect((await docState(u.docId)).engineer_ack, `${name}: ack stored before the classification`).toBe(storedAck)
      const c = await classifyAsPm(kit, u.docId, 'dc')
      expect(c.error, name).toBeNull()
      expect((await getDelivery(kit, (c.data as ClassifyResult).delivery_id)).status, name).toBe(status)
    }
  })
})

describe('T-C-2 set-once', () => {
  it('the same kind again is already_classified with both ids and creates nothing; a different kind is QE011; the columns never change', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c2')
    const first = await classifyAsPm(kit, u.docId, 'invoice')
    expect(first.error).toBeNull()
    const r1 = first.data as ClassifyResult
    const before = await docState(u.docId)

    const again = await classifyAsPm(kit, u.docId, 'invoice')
    expect(again.error).toBeNull()
    expect(again.data).toMatchObject({ already_classified: true, delivery_id: r1.delivery_id, self_link_id: r1.self_link_id, kind: 'invoice' })
    expect(await deliveriesOf(u.docId)).toHaveLength(1)
    expect(await linksOfInvoice(kit, u.docId)).toHaveLength(1)

    const other = await classifyAsPm(kit, u.docId, 'dc')
    expect(other.error?.code).toBe('QE011')
    expect(await docState(u.docId)).toEqual(before) // kind, kind_source, kind_set_at, kind_set_by, received_at: unchanged
    expect(await deliveriesOf(u.docId)).toHaveLength(1)
  })
})

describe('T-C-3 refusals leave the document unclassified and write nothing', () => {
  it('other-tenant PM, other-project PM, qs, deactivated PM, admin without PM membership: QE015 (identical to an unknown id); the PM of the project then succeeds', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c3')
    for (const who of ['pmB', 'pm2', 'qs', 'deact', 'admNon'] as const) {
      const r = await classifyAsPm(kit, u.docId, 'dc', who)
      expect(r.error?.code, who).toBe('QE015')
      expect(r.data, who).toBeNull()
    }
    const unknown = await classifyAsPm(kit, crypto.randomUUID(), 'dc')
    expect(unknown.error?.code).toBe('QE015') // no existence oracle: not-found looks like not-authorised
    const nullId = await kit.jwt('pm1').then((c) => c.rpc('pm_classify_document', { p_document_id: null, p_kind: 'dc' }))
    expect(nullId.error?.code).toBe('QE015')
    // nothing was written by any refusal
    expect(await docState(u.docId)).toMatchObject({ kind: null, kind_source: null, kind_set_at: null, kind_set_by: null })
    expect(await deliveriesOf(u.docId)).toHaveLength(0)

    // positive control (task 2e): the PM of THIS document's project succeeds on the very same document
    const ok = await classifyAsPm(kit, u.docId, 'dc')
    expect(ok.error).toBeNull()
    expect(await docState(u.docId)).toMatchObject({ kind: 'dc', kind_source: 'pm' })
  })

  it('a bad or NULL kind is QE012 and writes nothing; a good kind then works', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c3-kind')
    for (const bad of ['foo', '', 'DC', null]) {
      const c = await kit.jwt('pm1').then((cl) => cl.rpc('pm_classify_document', { p_document_id: u.docId, p_kind: bad }))
      expect(c.error?.code, String(bad)).toBe('QE012')
    }
    expect((await docState(u.docId)).kind).toBeNull()
    expect((await classifyAsPm(kit, u.docId, 'dc')).error).toBeNull()
  })

  it('anon is refused 42501 on the wrapper; service_role is refused 42501 on the wrapper; the PM of the project is not (control)', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c3-grants')
    const anon = await captureAnon().rpc('pm_classify_document', { p_document_id: u.docId, p_kind: 'dc' })
    expect(anon.error?.code).toBe('42501')
    const svc = await kit.svc.rpc('pm_classify_document', { p_document_id: u.docId, p_kind: 'dc' })
    expect(svc.error?.code).toBe('42501')
    expect((await docState(u.docId)).kind).toBeNull()
    expect((await classifyAsPm(kit, u.docId, 'dc')).error).toBeNull()
  })

  it('the private helper is not reachable: no Content-Profile -> 404 PGRST202; Content-Profile: private -> 406 PGRST106; for an authenticated PM and for service_role alike', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c3-helper')
    const args = { p_document_id: u.docId, p_kind: 'dc', p_set_by: kit.uid('pm1') }
    const pmToken = await accessTokenOf('pm1')
    const svcKey = process.env.SUPABASE_TEST_SERVICE_ROLE_KEY!
    for (const [who, o] of [
      ['pm1', { token: pmToken }],
      ['service_role', { token: svcKey, apikey: svcKey }],
    ] as const) {
      const noProfile = await rawRpc('capture_apply_classification', args, o)
      expect([who, noProfile.status, noProfile.code]).toEqual([who, 404, 'PGRST202'])
      const priv = await rawRpc('capture_apply_classification', args, { ...o, schema: 'private' })
      expect([who, priv.status, priv.code]).toEqual([who, 406, 'PGRST106'])
    }
    expect((await docState(u.docId)).kind).toBeNull()
    // control: the same raw path, to the PUBLIC wrapper, as the PM, succeeds (so the raw call shape is a working one)
    const ok = await rawRpc('pm_classify_document', { p_document_id: u.docId, p_kind: 'dc' }, { token: pmToken })
    expect(ok.status).toBe(200)
    expect((await docState(u.docId)).kind).toBe('dc')
  })
})

describe('S-5 (SQL review round 1): the engineer who sent the document, and an admin without PM membership, cannot classify it', () => {
  it('QE015 for both, the document stays unclassified; an admin who IS a PM member of the project is allowed', async () => {
    const u = await makeUnclassifiedDoc(kit, 's5', { userId: kit.uid('engWeb') })
    expect((await docState(u.docId)).sent_by).toBe(kit.uid('engWeb'))

    const sender = await classifyAsPm(kit, u.docId, 'dc', 'engWeb')
    expect(sender.error?.code).toBe('QE015')
    const admin = await classifyAsPm(kit, u.docId, 'dc', 'admNon')
    expect(admin.error?.code).toBe('QE015')
    expect(await docState(u.docId)).toMatchObject({ kind: null, kind_source: null, kind_set_by: null })
    expect(await deliveriesOf(u.docId)).toHaveLength(0)

    // positive control: admins count only as PM MEMBERS (admMem is a PM member of P1)
    const ok = await classifyAsPm(kit, u.docId, 'dc', 'admMem')
    expect(ok.error).toBeNull()
    expect(await docState(u.docId)).toMatchObject({ kind: 'dc', kind_source: 'pm', kind_set_by: kit.uid('admMem') })
  })
})

describe('T-C-5 / T-C-6 / T-C-7', () => {
  it('T-C-5 a classification sends nothing and queues nothing: 0 new jobs and 0 new outbound_sends for the tenant', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c5')
    const count = async (table: 'jobs' | 'outbound_sends') => {
      const q = kit.svc.from(table).select('id', { count: 'exact', head: true })
      const { count: c, error } = table === 'jobs' ? await q.contains('payload', { tenant_id: kit.tenantA }) : await q.eq('tenant_id', kit.tenantA)
      if (error) throw new Error(`${table} count failed: ${error.message}`)
      return c ?? 0
    }
    const before = [await count('jobs'), await count('outbound_sends')]
    expect(before[0]).toBeGreaterThan(0) // control: the file turn itself queued its capture_ingest job, so the count can see jobs
    expect((await classifyAsPm(kit, u.docId, 'dc')).error).toBeNull()
    expect([await count('jobs'), await count('outbound_sends')]).toEqual(before)
  })

  it('T-C-6 a document whose only file was rejected can still be classified (the helper never reads capture_files)', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c6')
    const { error } = await kit.svc.from('capture_files').update({ ingest_status: 'rejected', reject_reason: 'wrong_type' }).eq('document_id', u.docId)
    expect(error).toBeNull()
    const { data } = await kit.svc.from('capture_files').select('ingest_status').eq('document_id', u.docId)
    expect((data ?? []).map((f: { ingest_status: string }) => f.ingest_status)).toEqual(['rejected'])
    expect((await classifyAsPm(kit, u.docId, 'dc')).error).toBeNull()
  })

  it('T-C-7 RLS: a PM of the project reads an unclassified document (kind NULL); a PM of another project or tenant does not', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c7')
    const read = async (who: 'pm1' | 'pm2' | 'pmB') => {
      const c = await kit.jwt(who)
      const { data, error } = await c.from('capture_documents').select('id,kind').eq('id', u.docId)
      expect(error, who).toBeNull()
      return (data ?? []) as Array<{ id: string; kind: string | null }>
    }
    expect(await read('pm1')).toEqual([{ id: u.docId, kind: null }])
    expect(await read('pm2')).toEqual([])
    expect(await read('pmB')).toEqual([])
  })
})

describe('T-C-8 both orders of the ack and the classification end in the same state', () => {
  it('classify-then-ack: the ack moves the NEW delivery to awaiting_pm; one delivery, one self-link; the ack is stored', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c8-inv')
    const c = await classifyAsPm(kit, u.docId, 'invoice')
    expect(c.error).toBeNull()
    const res = c.data as ClassifyResult
    expect((await getDelivery(kit, res.delivery_id)).status).toBe('incomplete')
    const a = await miTurn(kit, u.phone, '1', kit.sid('c8-inv-ack'))
    expect(a).toMatchObject({ outcome: 'complete' })
    expect((await docState(u.docId)).engineer_ack).toBe('yes')
    expect((await getDelivery(kit, res.delivery_id)).status).toBe('awaiting_pm')
    expect(await deliveriesOf(u.docId)).toHaveLength(1)
    expect(await linksOfInvoice(kit, u.docId)).toHaveLength(1)
  })
})

describe('T-C-9 (B1) received_at is stored on the document: classification does not depend on the dedup table', () => {
  it('deleting the processed_messages row after the file turn does not stop the classification; the delivery gets the document received_at', async () => {
    const u = await makeUnclassifiedDoc(kit, 'c9')
    const before = await docState(u.docId)
    const del = await kit.svc.from('processed_messages').delete().eq('message_sid', u.fileSid)
    expect(del.error).toBeNull()
    const { data: gone } = await kit.svc.from('processed_messages').select('message_sid').eq('message_sid', u.fileSid)
    expect(gone ?? []).toHaveLength(0) // control: the row really is gone
    const c = await classifyAsPm(kit, u.docId, 'dc')
    expect(c.error).toBeNull()
    const d = await getDelivery(kit, (c.data as ClassifyResult).delivery_id)
    expect(new Date(d.received_at).getTime()).toBe(new Date(before.received_at).getTime())
  })
})
