// PR-B (migration 050): the ENGINEER side of the material-inward flow, through the real apply_material_inward_turn
// and expire_stale_material_inward over PostgREST as service_role. NOT YET RUN: 050 is not applied to test-db
// (this file is typechecked only until it is). Plan: docs/plans/pr-b-050-plan.md rev 6, section 11.
//
// Test IDs covered here: T-FLOW-1/2/3 (+ T-FLOW-2 ack forms), T-A18-1 (two slots, same path), T-A28-1, T-SID-DUP,
// T-SID-DUP-TEXT, Q2-6 (received_at single-parameter rule), T-A27-1/2/5/7 (SQL halves), the capture_ingest job
// contract, T-B1-APPROVE/REJECT/LINK-THEN-ACK and T-D10-APPROVE-INCOMPLETE (they need the PM functions and live in
// test/capture-pm-functions.test.ts), T-F5-4 (grants of the engineer functions).
//
// Time travel: p_now is a parameter of the RPC. Scenarios that move time use noonIst() (12:00 IST today) as the
// base so that +31 minutes can never cross an IST midnight; they pass p_now on EVERY turn of that scenario.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  ack,
  buildCaptureKit,
  captureAnon,
  classifyAsPm,
  getDoc,
  getDelivery,
  getSession,
  jpegMedia,
  linksOfInvoice,
  makeDoc,
  miTurn,
  miTurnRaw,
  noonIst,
  seedSession,
  teardownCaptureKit,
  type ClassifyResult,
  type CaptureKit,
} from './helpers/capture-fixtures'

let kit: CaptureKit

// 052: makeDoc classifies as the PM of the document's project (pm1 = P1, pm2 = P2), so both PMs are in the kit.
beforeAll(async () => {
  kit = await buildCaptureKit('engineer-flow', ['eng', 'engP2', 'engQs', 'pm1', 'pm2'])
})

afterAll(async () => {
  if (kit) await teardownCaptureKit(kit)
})

describe('050 engineer flow (apply_material_inward_turn)', () => {
  // 052 (plan F, T-E-1): written against the NEW facts and RED against the 050 function, which created a delivery at the
  // file turn. The engineer sends no kind; the file turn creates a document with received_at and NO delivery, NO link.
  it('T-E-1 / T-FLOW-1 start -> two files -> ack 1 closes: after the file turn 0 deliveries, 0 links, kind NULL, delivery_id key PRESENT and NULL; the PM classification creates the delivery', async () => {
    const phone = kit.phone('dc-full')
    const s0 = await miTurn(kit, phone, '4', kit.sid('dc-full-s0'), { start: true })
    expect(s0).toMatchObject({ outcome: 'start', current_flow: 'invoice', current_step: 2 })
    const fileSid = kit.sid('dc-full-s2')
    const s2 = await miTurn(kit, phone, 'ZZ gate pass', fileSid, { media: jpegMedia(2) })
    expect(s2).toMatchObject({ outcome: 'advance', current_step: 3 })
    // SQL review round 1, answer 2: the result keeps the delivery_id key, always NULL after 052
    expect(Object.keys(s2)).toContain('delivery_id')
    expect(s2.delivery_id).toBeNull()
    const docId = s2.document_id!
    const doc = await getDoc(kit, docId)
    expect(doc).toMatchObject({ kind: null, engineer_ack: null, source_message_sid: fileSid })
    const { data: dels } = await kit.svc.from('deliveries').select('id').or(`dc_document_id.eq.${docId},created_from_invoice_id.eq.${docId}`)
    expect(dels ?? []).toHaveLength(0)
    expect(await linksOfInvoice(kit, docId)).toHaveLength(0)
    const { data: row } = await kit.svc.from('capture_documents').select('received_at,kind_source,kind_set_at,kind_set_by').eq('id', docId).single<{ received_at: string | null; kind_source: string | null; kind_set_at: string | null; kind_set_by: string | null }>()
    expect(row!.received_at).not.toBeNull()
    expect([row!.kind_source, row!.kind_set_at, row!.kind_set_by]).toEqual([null, null, null])
    const { data: files } = await kit.svc.from('capture_files').select('file_no,ingest_status,source_message_sid').eq('document_id', docId).order('file_no')
    expect(files).toHaveLength(2)
    expect((files ?? []).map((f: { ingest_status: string }) => f.ingest_status)).toEqual(['pending', 'pending'])

    // the engineer's ack is stored on the document; there is still no delivery to move
    const a = await miTurn(kit, phone, '1', kit.sid('dc-full-ack'))
    expect(a).toMatchObject({ outcome: 'complete', current_flow: null, current_step: 0 })
    expect((await getDoc(kit, docId)).engineer_ack).toBe('yes')
    const { data: stillNone } = await kit.svc.from('deliveries').select('id').eq('dc_document_id', docId)
    expect(stillNone ?? []).toHaveLength(0)

    // positive control for the whole test: the PM classification creates the delivery, awaiting_pm because the ack came first
    const c = await classifyAsPm(kit, docId, 'dc')
    expect(c.error).toBeNull()
    const res = c.data as ClassifyResult
    expect(res).toMatchObject({ document_id: docId, kind: 'dc', already_classified: false, self_link_id: null })
    expect(await getDelivery(kit, res.delivery_id)).toMatchObject({ status: 'awaiting_pm', dc_document_id: docId, created_from_invoice_id: null })
    // a DC creates a delivery and NO link (T-A28-1, second half)
    expect(await linksOfInvoice(kit, docId)).toHaveLength(0)
  })

  it('T-E-1 the file turn still refuses QE012 and writes nothing when the processed_messages row is missing (050:313-320, kept)', async () => {
    const phone = kit.phone('e1-no-pm-row')
    await miTurn(kit, phone, '4', kit.sid('e1-no-pm-row-s0'), { start: true })
    const fileSid = kit.sid('e1-no-pm-row-s2')
    const { error } = await miTurnRaw(kit, phone, null, fileSid, { media: jpegMedia(1), skipProcessed: true })
    expect(error?.code).toBe('QE012')
    const { data } = await kit.svc.from('capture_documents').select('id').eq('source_message_sid', fileSid)
    expect(data ?? []).toHaveLength(0)
    // positive control: the same turn WITH the row succeeds
    const ok = await miTurn(kit, phone, null, kit.sid('e1-no-pm-row-ok'), { media: jpegMedia(1) })
    expect(ok).toMatchObject({ outcome: 'advance', current_step: 3 })
  })

  it('T-E-2 a stray step-1 session (a row left by the old flow) is read as step 2: a file turn works, a text re-asks', async () => {
    const base = noonIst()
    const p1 = kit.phone('stray-step1-file')
    await seedSession(kit, p1, { flow: 'invoice', step: 1, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 20 * 60 * 1000) })
    const r = await miTurn(kit, p1, null, kit.sid('stray-step1-file-s'), { media: jpegMedia(1), now: base })
    expect(r).toMatchObject({ outcome: 'advance', current_step: 3 })
    const p2 = kit.phone('stray-step1-text')
    await seedSession(kit, p2, { flow: 'invoice', step: 1, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 20 * 60 * 1000) })
    // observed (not assumed): the RPC treats the row as step 2 (one re-ask, then close) but does not renumber it, so the
    // re-ask still reports current_step 1
    expect(await miTurn(kit, p2, 'hello', kit.sid('stray-step1-text-t'), { now: base })).toMatchObject({ outcome: 'reask', current_step: 1 })
    expect(await miTurn(kit, p2, 'hello again', kit.sid('stray-step1-text-t2'), { now: base })).toMatchObject({ outcome: 'closed', current_flow: null })
  })

  it('T-A28-1 / T-A18-1 invoice path: the file creates exactly one automatic delivery and one active self-link; ack 2 asks for the note', async () => {
    const d = await makeDoc(kit, 'invoice', 'inv-full')
    const del = await getDelivery(kit, d.deliveryId)
    expect(del).toMatchObject({ status: 'incomplete', created_from_invoice_id: d.docId, dc_document_id: null })
    const links = await linksOfInvoice(kit, d.docId)
    expect(links).toHaveLength(1)
    expect(links[0]).toMatchObject({ link_source: 'created_from_invoice', unlinked_at: null, delivery_id: d.deliveryId })
    const a = await ack(kit, d, '2', 'inv-full')
    expect(a).toMatchObject({ outcome: 'advance', current_step: 4 })
    expect((await getDoc(kit, d.docId)).engineer_ack).toBe('no')
    const note = await miTurn(kit, d.phone, 'ZZ two bags short', kit.sid('inv-full-note'))
    expect(note).toMatchObject({ outcome: 'complete', current_flow: null })
    expect((await getDoc(kit, d.docId)).engineer_ack_note).toBe('ZZ two bags short')
  })

  it('T-A18-1 the same numbered question path runs after a DC and after an invoice; the engineer is never asked for a rate, total or quantity', async () => {
    for (const kind of ['dc', 'invoice'] as const) {
      const d = await makeDoc(kit, kind, `a18-${kind}`)
      const s = await getSession(kit, d.phone)
      expect(s).toMatchObject({ current_flow: 'invoice', current_step: 3 })
    }
  })

  it('T-FLOW-2 ack 3 -> partial, step 4; a further file at S4 attaches to the same document (D-11) and the step stays', async () => {
    const d = await makeDoc(kit, 'dc', 'ack3')
    expect(await ack(kit, d, '3', 'ack3')).toMatchObject({ outcome: 'advance', current_step: 4 })
    expect((await getDoc(kit, d.docId)).engineer_ack).toBe('partial')
    const f = await miTurn(kit, d.phone, null, kit.sid('ack3-extra'), { media: jpegMedia(1) })
    expect(f).toMatchObject({ outcome: 'file_attached', current_step: 4 })
    const { data: files } = await kit.svc.from('capture_files').select('file_no').eq('document_id', d.docId).order('file_no')
    expect((files ?? []).map((x: { file_no: number }) => x.file_no)).toEqual([1, 2])
  })

  it('T-FLOW-2 a file at S3 attaches to the same document and the session stays at S3 (D-11)', async () => {
    const d = await makeDoc(kit, 'dc', 'attach-s3')
    const f = await miTurn(kit, d.phone, null, kit.sid('attach-s3-extra'), { media: jpegMedia(1) })
    expect(f).toMatchObject({ outcome: 'file_attached', current_step: 3 })
    expect((await getDoc(kit, d.docId)).engineer_ack).toBeNull()
  })

  it.each([
    ['1.', 'yes'],
    ['2)', 'no'],
    ['3', 'partial'],
    ['1️⃣', 'yes'],
    ['2️⃣', 'no'],
    ['3️⃣', 'partial'],
  ])('T-S3-ACK-PARSE accepted ack form %j -> %s', async (reply, expected) => {
    const label = `form-${Buffer.from(reply).toString('hex')}`
    const d = await makeDoc(kit, 'dc', label)
    await ack(kit, d, reply, label)
    expect((await getDoc(kit, d.docId)).engineer_ack).toBe(expected)
  })

  it('T-S3-ACK-PARSE "12" is NOT an ack: one re-ask, nothing stored', async () => {
    const d = await makeDoc(kit, 'dc', 'form-12')
    const r = await ack(kit, d, '12', 'form-12')
    expect(r).toMatchObject({ outcome: 'reask', current_step: 3 })
    expect((await getDoc(kit, d.docId)).engineer_ack).toBeNull()
  })

  it('T-FLOW-2 garbage at S3: one re-ask, then ack=unclear with the raw text as the note, and the flow CLOSES (never S4)', async () => {
    const d = await makeDoc(kit, 'dc', 'unclear')
    expect(await miTurn(kit, d.phone, 'maybe', kit.sid('unclear-g1'))).toMatchObject({ outcome: 'reask', current_step: 3 })
    const r = await miTurn(kit, d.phone, 'ZZ not sure', kit.sid('unclear-g2'))
    expect(r).toMatchObject({ outcome: 'complete', current_flow: null, current_step: 0 })
    const doc = await getDoc(kit, d.docId)
    expect(doc.engineer_ack).toBe('unclear')
    expect(doc.engineer_ack_note).toBe('ZZ not sure')
    // a following text must NOT be treated as an S4 note (it would raise QE011 from TR5): it reaches idle
    const after = await miTurn(kit, d.phone, 'ZZ later note', kit.sid('unclear-after'))
    expect(after.outcome).toBe('idle')
    expect((await getDoc(kit, d.docId)).engineer_ack_note).toBe('ZZ not sure')
  })

  // 052 (inventory row :143, meaning changed): there is no S1 any more. The start lands on step 2, so the only
  // "garbage" case is text at the file step: one re-ask, then close with nothing recorded.
  it('T-FLOW-2 text at the file step (S2): one re-ask, then close with nothing recorded', async () => {
    const p2 = kit.phone('close-s2')
    expect(await miTurn(kit, p2, '4', kit.sid('close-s2-s0'), { start: true })).toMatchObject({ outcome: 'start', current_step: 2 })
    expect(await miTurn(kit, p2, 'no file', kit.sid('close-s2-a'))).toMatchObject({ outcome: 'reask', current_step: 2 })
    expect(await miTurn(kit, p2, 'still no file', kit.sid('close-s2-b'))).toMatchObject({ outcome: 'closed', current_flow: null })
    const { data } = await kit.svc.from('capture_documents').select('id').in('source_message_sid', [kit.sid('close-s2-a'), kit.sid('close-s2-b')])
    expect(data ?? []).toHaveLength(0)
    // positive control: a file at the same step is NOT re-asked
    const p3 = kit.phone('close-s2-ok')
    await miTurn(kit, p3, '4', kit.sid('close-s2-ok-s0'), { start: true })
    expect((await miTurn(kit, p3, null, kit.sid('close-s2-ok-f'), { media: jpegMedia(1) })).outcome).toBe('advance')
  })

  it('T-SID-DUP a repeated FILE SID writes nothing and returns the duplicate outcome', async () => {
    const d = await makeDoc(kit, 'dc', 'dup-file')
    const again = await miTurn(kit, d.phone, null, d.fileSid, { media: jpegMedia(1) })
    expect(again.outcome).toBe('duplicate')
    const { data: docs } = await kit.svc.from('capture_documents').select('id').eq('source_message_sid', d.fileSid)
    const { data: files } = await kit.svc.from('capture_files').select('id').eq('source_message_sid', d.fileSid)
    expect(docs).toHaveLength(1)
    expect(files).toHaveLength(1)
    // control: a NEW SID is processed
    const fresh = await miTurn(kit, d.phone, null, kit.sid('dup-file-new'), { media: jpegMedia(1) })
    expect(fresh.outcome).toBe('file_attached')
  })

  it('T-SID-DUP-TEXT a repeated ACK SID writes nothing and raises nothing (the second ack would otherwise hit TR5 / QE011)', async () => {
    const d = await makeDoc(kit, 'dc', 'dup-text')
    const first = await ack(kit, d, '1', 'dup-text')
    expect(first.outcome).toBe('complete')
    const { data, error } = await miTurnRaw(kit, d.phone, '1', kit.sid('dup-text-ack'))
    expect(error).toBeNull()
    expect((data as { outcome: string }).outcome).toBe('duplicate')
    expect((await getDoc(kit, d.docId)).engineer_ack).toBe('yes')
  })

  // 052 (inventory row :181, meaning changed): the repeated text SID now falls at the file step (S2), where a text is a re-ask.
  it('T-SID-DUP-TEXT a repeated text SID in the middle of the flow (S2, a text at the file step) is a duplicate, not a second re-ask', async () => {
    const phone = kit.phone('dup-s2')
    await miTurn(kit, phone, '4', kit.sid('dup-s2-s0'), { start: true })
    const first = await miTurn(kit, phone, 'hmm', kit.sid('dup-s2-t'))
    expect(first).toMatchObject({ outcome: 'reask', current_step: 2 })
    const again = await miTurn(kit, phone, 'hmm', kit.sid('dup-s2-t'))
    expect(again.outcome).toBe('duplicate')
    // the second delivery of the SID did not use up the one re-ask: a different text is the second miss and closes
    expect(await getSession(kit, phone)).toMatchObject({ current_flow: 'invoice', current_step: 2 })
    expect((await miTurn(kit, phone, 'again', kit.sid('dup-s2-t2'))).outcome).toBe('closed')
  })

  it('Q2-6 received_at is the processed_messages.created_at of the SAME SID, stored on the document and copied to the delivery at classification', async () => {
    const d = await makeDoc(kit, 'dc', 'recv')
    const { data: pm } = await kit.svc.from('processed_messages').select('created_at').eq('message_sid', d.fileSid).single<{ created_at: string }>()
    const del = await getDelivery(kit, d.deliveryId)
    expect(new Date(del.received_at).getTime()).toBe(new Date(pm!.created_at).getTime())
    const { data: doc } = await kit.svc.from('capture_documents').select('received_at').eq('id', d.docId).single<{ received_at: string }>()
    expect(new Date(doc!.received_at).getTime()).toBe(new Date(pm!.created_at).getTime())
    // the missing-processed_messages refusal moved to T-E-1 (the file turn, no kind turn any more)
  })

  it.each([
    ['2026-09-22T18:29:00Z', '2026-09-22'], //  22-09 23:59 IST
    ['2026-09-22T19:00:00Z', '2026-09-23'], //  23-09 00:30 IST
  ])('T-DATE-1 delivery_date is the IST date of received_at: processed_messages.created_at %s -> %s (a UTC implementation would differ for the second)', async (createdAt, expectedDate) => {
    const label = `date-${createdAt.slice(11, 13)}${createdAt.slice(14, 16)}`
    const phone = kit.phone(label)
    await miTurn(kit, phone, '4', kit.sid(`${label}-s0`), { start: true })
    const fileSid = kit.sid(`${label}-s2`)
    const { error: pErr } = await kit.svc.from('processed_messages').insert({ message_sid: fileSid, created_at: createdAt })
    expect(pErr).toBeNull()
    const r = await miTurn(kit, phone, null, fileSid, { media: jpegMedia(1), skipProcessed: true })
    // 052: the file turn makes no delivery; the PM classification does, with received_at copied from the document
    const c = await classifyAsPm(kit, r.document_id!, 'dc')
    expect(c.error).toBeNull()
    const { data } = await kit.svc.from('deliveries').select('delivery_date').eq('id', (c.data as ClassifyResult).delivery_id).single<{ delivery_date: string }>()
    expect(data!.delivery_date).toBe(expectedDate)
  })

  it('S-1 (SQL review r1) a P2 engineer sending the file into a P1 session is refused QE012 and NOTHING is written', async () => {
    const phone = kit.phone('s1-cross-project')
    const o = { userId: kit.uid('engP2'), projectId: kit.p1 }
    await miTurn(kit, phone, '4', kit.sid('s1x-s0'), { ...o, start: true })
    const fileSid = kit.sid('s1x-s2')
    const { error } = await miTurnRaw(kit, phone, null, fileSid, { ...o, media: jpegMedia(1) })
    expect(error?.code).toBe('QE012')
    const { data: docs } = await kit.svc.from('capture_documents').select('id').eq('source_message_sid', fileSid)
    const { data: files } = await kit.svc.from('capture_files').select('id').eq('source_message_sid', fileSid)
    const { data: dels } = await kit.svc.from('deliveries').select('id').eq('reported_by', kit.uid('engP2'))
    const { data: jobs } = await kit.svc.from('jobs').select('id').eq('type', 'capture_ingest').contains('payload', { source_message_sid: fileSid })
    expect([docs, files, dels, jobs].map((x) => (x ?? []).length)).toEqual([0, 0, 0, 0])
    expect(await getSession(kit, phone)).toMatchObject({ current_flow: 'invoice', current_step: 2 })
    // positive control: the same engineer into HER project creates the document
    const ok = await makeDoc(kit, 'dc', 's1-own-project', { userId: kit.uid('engP2'), projectId: kit.p2 })
    expect((await getDelivery(kit, ok.deliveryId)).project_id).toBe(kit.p2)
  })

  it('S-4 (SQL review r2) an engineer whose ONLY membership has role qs (not engineer) is refused QE012 and nothing is written', async () => {
    const phone = kit.phone('s4-qs-membership')
    const o = { userId: kit.uid('engQs'), projectId: kit.p1 }
    await miTurn(kit, phone, '4', kit.sid('s4-s0'), { ...o, start: true })
    const fileSid = kit.sid('s4-s2')
    const { error } = await miTurnRaw(kit, phone, null, fileSid, { ...o, media: jpegMedia(1) })
    expect(error?.code).toBe('QE012')
    const { data: docs } = await kit.svc.from('capture_documents').select('id').eq('source_message_sid', fileSid)
    const { data: dels } = await kit.svc.from('deliveries').select('id').eq('reported_by', kit.uid('engQs'))
    expect([docs, dels].map((x) => (x ?? []).length)).toEqual([0, 0])
  })

  // 052 (inventory rows :253 and :268, meaning changed): the S1 kind parser is retired. The old N-1 asserted that
  // '1.', '2)', 'Invoice.', 'DC' ARE a kind and stored mi_kind; after 052 none of them is, so each is a text at the file
  // step: a re-ask, still step 2, and NOTHING stored in the session context.
  it.each(['1.', '2)', '2\uFE0F\u20E3', 'Invoice.', 'DC', '12'])('N-1 (retired parser) %j at the file step is not a kind: re-ask, still step 2, no mi_kind stored', async (reply) => {
    const label = `n1-${Buffer.from(reply).toString('hex')}`
    const phone = kit.phone(label)
    await miTurn(kit, phone, '4', kit.sid(`${label}-s0`), { start: true })
    const r = await miTurn(kit, phone, reply, kit.sid(`${label}-s1`))
    expect(r).toMatchObject({ outcome: 'reask', current_step: 2 })
    const s = await getSession(kit, phone)
    expect(s!.context).not.toHaveProperty('mi_kind')
    // positive control: the same session accepts a file
    expect((await miTurn(kit, phone, null, kit.sid(`${label}-f`), { media: jpegMedia(1) })).outcome).toBe('advance')
  })

  it('N-2 (SQL review r1) an ack with mi_document_id missing is refused QE012; nothing changes', async () => {
    const base = noonIst()
    const phone = kit.phone('n2-missing-doc')
    await seedSession(kit, phone, { flow: 'invoice', step: 3, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 20 * 60 * 1000) })
    const { error } = await miTurnRaw(kit, phone, '1', kit.sid('n2-missing-ack'), { now: base })
    expect(error?.code).toBe('QE012')
    expect(await getSession(kit, phone)).toMatchObject({ current_flow: 'invoice', current_step: 3 })
  })

  it('capture_ingest job contract: one job per file turn, payload carries tenant, project, document, SID and every file', async () => {
    const d = await makeDoc(kit, 'dc', 'job')
    const { data } = await kit.svc
      .from('jobs')
      .select('type,status,payload')
      .eq('type', 'capture_ingest')
      .contains('payload', { source_message_sid: d.fileSid })
    expect(data).toHaveLength(1)
    const job = (data ?? [])[0] as { status: string; payload: { tenant_id: string; project_id: string; document_id: string; files: Array<{ file_no: number; media_index: number; url: string }> } }
    expect(job.status).toBe('pending')
    expect(job.payload).toMatchObject({ tenant_id: kit.tenantA, project_id: kit.p1, document_id: d.docId })
    expect(job.payload.files).toHaveLength(1)
    expect(job.payload.files[0]).toMatchObject({ file_no: 1, media_index: 0 })
  })

  it('N8 every processed turn, including a re-ask, writes expires_at = p_now + 30 min and updated_at = p_now (T-A27-5)', async () => {
    const base = noonIst()
    const phone = kit.phone('n8')
    await miTurn(kit, phone, '4', kit.sid('n8-s0'), { start: true, now: base })
    const later = new Date(base.getTime() + 25 * 60 * 1000)
    const r = await miTurn(kit, phone, 'hmm', kit.sid('n8-a'), { now: later })
    expect(r.outcome).toBe('reask')
    const s = await getSession(kit, phone)
    expect(new Date(s!.expires_at).getTime()).toBe(later.getTime() + 30 * 60 * 1000)
    expect(new Date(s!.updated_at).getTime()).toBe(later.getTime())
    // an engineer replying every 25 minutes never expires
    const again = new Date(later.getTime() + 25 * 60 * 1000)
    expect((await miTurn(kit, phone, 'hmm 2', kit.sid('n8-b'), { now: again })).outcome).toBe('closed')
  })

  it('T-A27-1 / T-A27-2 expiry boundary: 29:59 idle is still active, 30:01 idle is expired (never tested at exactly 30:00)', async () => {
    const base = noonIst()
    // 052: the turn after the start is the FILE (there is no kind turn), so the boundary is tested with a file turn
    const live = kit.phone('a27-live')
    await miTurn(kit, live, '4', kit.sid('a27-live-s0'), { start: true, now: base })
    const at2959 = new Date(base.getTime() + (29 * 60 + 59) * 1000)
    expect((await miTurn(kit, live, null, kit.sid('a27-live-s1'), { now: at2959, media: jpegMedia(1) })).outcome).toBe('advance')

    const dead = kit.phone('a27-dead')
    await miTurn(kit, dead, '4', kit.sid('a27-dead-s0'), { start: true, now: base })
    const at3001 = new Date(base.getTime() + (30 * 60 + 1) * 1000)
    const r = await miTurn(kit, dead, null, kit.sid('a27-dead-s1'), { now: at3001, media: jpegMedia(1) })
    expect(r).toMatchObject({ outcome: 'expired', current_flow: null })
    expect(await getSession(kit, dead)).toMatchObject({ current_flow: null, current_step: 0 })
  })

  it('T-A27-1 the delivery of an expired session stays exactly as it was ("not acknowledged")', async () => {
    const base = noonIst()
    const d = await makeDoc(kit, 'dc', 'a27-keep', { now: base })
    const r = await miTurn(kit, d.phone, '1', kit.sid('a27-keep-ack'), { now: new Date(base.getTime() + 31 * 60 * 1000) })
    expect(r.outcome).toBe('expired')
    expect((await getDoc(kit, d.docId)).engineer_ack).toBeNull()
    expect((await getDelivery(kit, d.deliveryId)).status).toBe('incomplete')
  })

  it('T-A27-6 (SQL half) a turn that reaches the RPC after expiry writes ONLY the clear: expires_at / updated_at untouched', async () => {
    const base = noonIst()
    const phone = kit.phone('a27-clear-only')
    await miTurn(kit, phone, '4', kit.sid('a27-clear-s0'), { start: true, now: base })
    const before = await getSession(kit, phone)
    await miTurn(kit, phone, '1', kit.sid('a27-clear-s1'), { now: new Date(base.getTime() + 31 * 60 * 1000) })
    const after = await getSession(kit, phone)
    expect(after!.current_flow).toBeNull()
    expect(after!.expires_at).toBe(before!.expires_at)
    expect(after!.updated_at).toBe(before!.updated_at)
  })

  it('expire_stale_material_inward: clears an expired invoice row once (true), then false; returns false for no row', async () => {
    const base = noonIst()
    const phone = kit.phone('expire-fn')
    await miTurn(kit, phone, '4', kit.sid('expire-fn-s0'), { start: true, now: base })
    const late = new Date(base.getTime() + 31 * 60 * 1000).toISOString()
    const first = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: phone, p_now: late })
    expect(first.error).toBeNull()
    expect(first.data).toBe(true)
    expect(await getSession(kit, phone)).toMatchObject({ current_flow: null, current_step: 0 })
    const second = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: phone, p_now: late })
    expect(second.data).toBe(false)
    const none = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: kit.phone('expire-nobody'), p_now: late })
    expect(none.data).toBe(false)
  })

  it('T-A27-7 (SQL half) expire_stale_material_inward leaves an expired MORNING session untouched', async () => {
    const base = noonIst()
    const phone = kit.phone('expire-morning')
    await seedSession(kit, phone, { flow: 'morning', step: 2, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() - 3600 * 1000) })
    const r = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: phone, p_now: new Date(base.getTime() + 31 * 60 * 1000).toISOString() })
    expect(r.data).toBe(false)
    expect(await getSession(kit, phone)).toMatchObject({ current_flow: 'morning', current_step: 2 })
  })

  it('a start over a live OTHER-flow session never creates this flow (reask) and an idle non-start is idle', async () => {
    const base = noonIst()
    const phone = kit.phone('other-flow')
    await seedSession(kit, phone, { flow: 'morning', step: 2, context: {}, updatedAt: base, expiresAt: new Date(base.getTime() + 20 * 60 * 1000) })
    expect((await miTurn(kit, phone, '4', kit.sid('other-flow-s0'), { start: true, now: base })).outcome).toBe('reask')
    expect(await getSession(kit, phone)).toMatchObject({ current_flow: 'morning', current_step: 2 })
    expect((await miTurn(kit, kit.phone('idle-nobody'), '1', kit.sid('idle-nobody-s0'))).outcome).toBe('idle')
  })
})

describe('050 grants of the two engineer-side functions (T-F5-4, real PostgREST calls)', () => {
  const args = () => ({
    p_phone_number: kit.phone('grants'),
    p_tenant_id: kit.tenantA,
    p_user_id: kit.uid('eng'),
    p_project_id: kit.p1,
    p_message: 'x',
    p_message_sid: kit.sid('grants'),
  })

  it('anon is refused 42501 on both (a real anon-key call, not only the catalog)', async () => {
    const anon = captureAnon()
    const a = await anon.rpc('apply_material_inward_turn', args())
    const b = await anon.rpc('expire_stale_material_inward', { p_phone_number: kit.phone('grants') })
    expect(a.error?.code).toBe('42501')
    expect(b.error?.code).toBe('42501')
  })

  it('an authenticated PM is refused 42501 on both', async () => {
    const pm = await kit.jwt('pm1')
    const a = await pm.rpc('apply_material_inward_turn', args())
    const b = await pm.rpc('expire_stale_material_inward', { p_phone_number: kit.phone('grants') })
    expect(a.error?.code).toBe('42501')
    expect(b.error?.code).toBe('42501')
  })

  it('positive control: service_role succeeds on expire_stale_material_inward', async () => {
    const r = await kit.svc.rpc('expire_stale_material_inward', { p_phone_number: kit.phone('grants') })
    expect(r.error).toBeNull()
  })
})
