// C2 (migration 051, rev 3): capture_files immutability, lifecycle CHECKs, INSERT lock and the column UPDATE grant (D-8).
// Plan: docs/plans/pr-c-plan.md section 3d (T-D8-1..11) and section 8 row C2; rev 2 added T-D8-12..17 after external
// review round 1 (docs/reviews/051-external-review-round-1.md); rev 3 adds T-D8-18..21 after round 2
// (docs/reviews/051-external-review-round-2.md). NOT YET RUN against test-db: 051 is HELD in
// docs/reviews/ and is not applied there, so every database test below is expected RED in CI until the test-db apply.
// T-D8-11 and T-D8-17 are static (no database) and read the migration SQL from supabase/migrations/ and docs/reviews/.
//
// Layers. The database tests run over PostgREST as service_role / anon / an authenticated PM, so they reach the
// GRANT layer (42501), the CHECK layer (23514) and the trigger layer for GRANTED columns (QE011). The trigger's QE009
// and QE014 refusals on columns the grant does not cover need a table-owner connection, which CI does not have; those
// cases, the DOWN rehearsal and the service_role TRUNCATE probe are recorded from the local scaffold in
// docs/reviews/051-sql-evidence/ (same precedent as test/capture-races.test.ts:307 and
// test/capture-pm-functions.test.ts:276).
//
// Fixtures: the capture kit (test/helpers/capture-fixtures.ts). Each file row is made by the real
// apply_material_inward_turn path, with the explicit time noonIst() so nothing crosses an IST midnight.
// Every update below uses .select('id') and asserts the returned row count: an UPDATE that matched 0 rows "succeeds"
// and would prove nothing (the 049 N-3 rule).
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { buildCaptureKit, captureAnon, makeDoc, noonIst, teardownCaptureKit, type CaptureKit } from './helpers/capture-fixtures'

const SHA_A = 'a'.repeat(64)
const SHA_B = 'b'.repeat(64)
const OWNER_ONLY = ' -- SKIPPED: needs owner connection; evidence in docs/reviews/051-sql-evidence/'

// N3: the table's columns are exactly identity UNION granted UNION ingested_at. A new column lands in none of these
// lists and fails T-D8-16 until the trigger and the grant have been revisited on purpose.
const IDENTITY_COLUMNS = ['id', 'created_at', 'tenant_id', 'project_id', 'document_id', 'file_no', 'source_message_sid', 'media_index', 'claimed_content_type']
const GRANTED_COLUMNS = ['ingest_status', 'content_type', 'byte_size', 'sha256', 'storage_path', 'reject_reason', 'preview_state']
const STAMPED_COLUMNS = ['ingested_at']

interface FileRow {
  id: string
  tenant_id: string
  project_id: string
  document_id: string
  file_no: number
  ingest_status: string
  sha256: string | null
  storage_path: string | null
  byte_size: number | null
  content_type: string | null
  reject_reason: string | null
  preview_state: string | null
  ingested_at: string | null
}

let kit: CaptureKit
let seq = 0

/** A fresh PENDING capture_files row, made by the real engineer path (one file turn). */
async function newPending(): Promise<FileRow> {
  seq += 1
  const d = await makeDoc(kit, 'dc', `cfi-${seq}`, { now: noonIst() })
  const { data, error } = await kit.svc.from('capture_files').select('*').eq('document_id', d.docId).single<FileRow>()
  if (error || !data) throw new Error(`newPending: no file row for document ${d.docId}: ${error?.message ?? 'none'}`)
  expect(data.ingest_status).toBe('pending')
  return data
}

/** The seven granted columns, filled for 'stored'. storage_path is row-owned (B2): tenant/project/document/<file id>. */
function storedPatch(f: FileRow, sha = SHA_A) {
  return {
    ingest_status: 'stored',
    content_type: 'image/jpeg',
    byte_size: 1000,
    sha256: sha,
    storage_path: `${f.tenant_id}/${f.project_id}/${f.document_id}/${f.id}.jpg`,
    reject_reason: null,
    preview_state: 'previewable',
  }
}

async function update(f: FileRow, patch: Record<string, unknown>) {
  return kit.svc.from('capture_files').update(patch).eq('id', f.id).select('id')
}

async function mustUpdate(f: FileRow, patch: Record<string, unknown>): Promise<void> {
  const { data, error } = await update(f, patch)
  expect(error).toBeNull()
  expect(data).toHaveLength(1)
}

async function newStored(sha = SHA_A): Promise<FileRow> {
  const f = await newPending()
  await mustUpdate(f, storedPatch(f, sha))
  return read(f)
}

async function newRejected(): Promise<FileRow> {
  const f = await newPending()
  await mustUpdate(f, { ingest_status: 'rejected', reject_reason: 'wrong_type' })
  return read(f)
}

async function newFailed(): Promise<FileRow> {
  const f = await newPending()
  await mustUpdate(f, { ingest_status: 'failed' })
  return read(f)
}

async function read(f: FileRow): Promise<FileRow> {
  const { data, error } = await kit.svc.from('capture_files').select('*').eq('id', f.id).single<FileRow>()
  if (error || !data) throw new Error(`read ${f.id}: ${error?.message ?? 'none'}`)
  return data
}

describe('051 capture_files immutability (test-db)', () => {
  // Hooks live INSIDE this describe, so a run that selects only the static tests never builds a kit or touches the database.
  beforeAll(async () => {
    kit = await buildCaptureKit('cfi', ['eng', 'pm1'])
  })

  afterAll(async () => {
    if (kit) await teardownCaptureKit(kit)
  })

  it('T-D8-1 service_role can UPDATE the seven granted columns of a pending row [control: the row reads back stored; RED before 051: 42501, no grant]', async () => {
    const f = await newPending()
    await mustUpdate(f, storedPatch(f))
    const after = await read(f)
    expect(after).toMatchObject({ ingest_status: 'stored', sha256: SHA_A, byte_size: 1000, content_type: 'image/jpeg', preview_state: 'previewable' })
  })

  it('T-D8-2 grant layer: file_no, claimed_content_type, tenant_id and id are refused 42501 [control: a granted column (ingest_status) on the same row succeeds]', async () => {
    const f = await newPending()
    await mustUpdate(f, { ingest_status: 'failed' })
    for (const patch of [{ file_no: 99 }, { claimed_content_type: 'image/png' }, { tenant_id: kit.tenantB }, { id: randomUUID() }]) {
      const { error } = await update(f, patch)
      expect(error?.code, JSON.stringify(patch)).toBe('42501')
    }
    expect((await read(f)).file_no).toBe(f.file_no)
  })

  it.skip(`T-D8-2b trigger layer with the grant bypassed: the same UPDATEs reach the trigger and raise QE009${OWNER_ONLY}`, () => {})

  it('T-D8-3 the reviewer\'s stub case: on a stored row, rewriting sha256, storage_path, byte_size or content_type raises QE011 [control: pending -> stored with full details succeeds, in newStored]', async () => {
    const f = await newStored()
    for (const patch of [{ sha256: SHA_B }, { storage_path: `${f.tenant_id}/${f.project_id}/${f.document_id}/${f.id}-other.jpg` }, { byte_size: 2000 }, { content_type: 'image/png' }]) {
      const { error } = await update(f, patch)
      expect(error?.code, JSON.stringify(patch)).toBe('QE011')
    }
    expect(await read(f)).toMatchObject({ sha256: SHA_A, byte_size: 1000, content_type: 'image/jpeg' })
  })

  it('T-D8-4 rejected is terminal: changing reject_reason or moving to stored raises QE011 [control: pending -> rejected succeeded when the row was made]', async () => {
    const f = await newRejected()
    const a = await update(f, { reject_reason: 'too_large' })
    expect(a.error?.code).toBe('QE011')
    const b = await update(f, storedPatch(f))
    expect(b.error?.code).toBe('QE011')
    expect(await read(f)).toMatchObject({ ingest_status: 'rejected', reject_reason: 'wrong_type' })
  })

  it('T-D8-5 no move back to pending: stored -> pending and failed -> pending raise QE011; failed -> stored and failed -> rejected succeed [control: pending -> failed succeeded]', async () => {
    const s = await newStored()
    expect((await update(s, { ingest_status: 'pending' })).error?.code).toBe('QE011')
    const failed = await newFailed()
    expect((await update(failed, { ingest_status: 'pending' })).error?.code).toBe('QE011')
    await mustUpdate(failed, storedPatch(failed))
    const failed2 = await newFailed()
    await mustUpdate(failed2, { ingest_status: 'rejected', reject_reason: 'too_large' })
    expect((await read(failed2)).ingest_status).toBe('rejected')
  })

  it('T-D8-6 an UPDATE that changes nothing on a stored row is allowed (a retried job is a no-op) and leaves ingested_at unchanged [control: T-D8-3 shows a real change is refused]', async () => {
    const f = await newStored()
    expect(f.ingested_at).not.toBeNull()
    await mustUpdate(f, storedPatch(f))
    const after = await read(f)
    expect(after).toMatchObject({ ingest_status: 'stored', sha256: SHA_A })
    expect(after.ingested_at).toBe(f.ingested_at)
  })

  it('T-D8-7 anon and an authenticated PM are refused UPDATE with 42501, including a real anon-key call [control: service_role updates the same row]', async () => {
    const f = await newPending()
    const anon = captureAnon()
    const a = await anon.from('capture_files').update({ ingest_status: 'failed' }).eq('id', f.id).select('id')
    expect(a.error?.code).toBe('42501')
    const pm = await kit.jwt('pm1')
    const p = await pm.from('capture_files').update({ ingest_status: 'failed' }).eq('id', f.id).select('id')
    expect(p.error?.code).toBe('42501')
    await mustUpdate(f, { ingest_status: 'failed' })
  })

  it('T-D8-8 service_role DELETE on capture_files is refused with 42501 (TRUNCATE is probed on the scaffold: PostgREST cannot issue it) [control: the row still reads back]', async () => {
    const f = await newPending()
    const { error } = await kit.svc.from('capture_files').delete().eq('id', f.id)
    expect(error?.code).toBe('42501')
    expect((await read(f)).id).toBe(f.id)
  })

  it('T-D8-9 the trigger function is not callable over PostgREST by service_role, anon or an authenticated PM [control: an exposed test helper is callable]', async () => {
    const ctl = await kit.svc.rpc('quoco_test_capture_helpers_present')
    expect(ctl.error).toBeNull()
    expect(ctl.data).toBe(true)
    // 42501 = exposed but not executable; PGRST202 = not exposed at all. Either way the call is refused. The catalog-level
    // proof (has_function_privilege false for all four roles) is the in-file post-condition block and the scaffold transcript.
    const clients = [kit.svc, captureAnon(), await kit.jwt('pm1')]
    for (const c of clients) {
      const { error } = await c.rpc('trg_capture_files_before_update')
      expect(error).not.toBeNull()
      expect(['42501', 'PGRST202']).toContain(error?.code)
    }
  })

  it.skip(`T-D8-10 DOWN rehearsal: after the DOWN, service_role UPDATE is 42501, the trigger, function, five constraints and column are gone, ACLs match the pre-rehearsal values${OWNER_ONLY}`, () => {})

  // ---------------------------------------------------------------------------
  // Rev 2: the reviewer's three probes (B1 x2, B2). Each was a SUCCESS on rev-1 051 (G0c-review-probes-rev1) and is 23514 now.
  // ---------------------------------------------------------------------------
  it('T-D8-12 (B1 probe 1) a failed row carrying a reject_reason is refused 23514, so it can never become a stored file that says it was too large [control: failed -> stored with full details and no reject_reason succeeds]', async () => {
    const f = await newFailed()
    const a = await update(f, { reject_reason: 'too_large' })
    expect(a.error?.code).toBe('23514')
    const b = await update(f, { ...storedPatch(f), reject_reason: 'too_large' })
    expect(b.error?.code).toBe('23514')
    expect((await read(f)).reject_reason).toBeNull()
    await mustUpdate(f, storedPatch(f))
  })

  it('T-D8-13 (B1 probe 2) a rejected row carrying sha256, storage_path or preview_state is refused 23514 [control: pending -> rejected too_large WITH byte_size succeeds]', async () => {
    const control = await newPending()
    await mustUpdate(control, { ingest_status: 'rejected', reject_reason: 'too_large', byte_size: 20000000 })
    const f = await newPending()
    const full = { ingest_status: 'rejected', reject_reason: 'wrong_type' }
    for (const extra of [{ sha256: SHA_A }, { storage_path: storedPatch(f).storage_path }, { preview_state: 'previewable' }]) {
      const { error } = await update(f, { ...full, ...extra })
      expect(error?.code, JSON.stringify(extra)).toBe('23514')
    }
    // a pending row cannot carry the stored-only details either (the replaced rev-1 control, now refused by design)
    expect((await update(f, { sha256: SHA_B })).error?.code).toBe('23514')
    // rev 3 (S1): nor content_type or byte_size
    expect((await update(f, { byte_size: 5 })).error?.code).toBe('23514')
    expect((await update(f, { content_type: 'image/png' })).error?.code).toBe('23514')
    expect((await read(f)).ingest_status).toBe('pending')
  })

  it('T-D8-14 (B2 probe 3) a second row cannot claim another row\'s storage_path: refused 23514 [control: the same row\'s own path, stored, succeeds]', async () => {
    const a = await newStored()
    const b = await newPending()
    const { error } = await update(b, { ...storedPatch(b), storage_path: a.storage_path })
    expect(error?.code).toBe('23514')
    await mustUpdate(b, storedPatch(b))
  })

  it('T-D8-15 (S2) ingested_at is stamped by the database on the move into stored or rejected; service_role cannot set it [control: a granted column update on the same row succeeds]', async () => {
    const pending = await newPending()
    expect(pending.ingested_at).toBeNull()
    const before = Date.now()
    await mustUpdate(pending, storedPatch(pending))
    const after = Date.now()
    const stored = await read(pending)
    expect(stored.ingested_at).not.toBeNull()
    // The DB clock and this machine's clock can differ a little: allow 2 minutes either side of the test's own window.
    const t = new Date(stored.ingested_at as string).getTime()
    expect(t).toBeGreaterThanOrEqual(before - 120_000)
    expect(t).toBeLessThanOrEqual(after + 120_000)
    const rejected = await newRejected()
    expect(rejected.ingested_at).not.toBeNull()
    const failed = await newFailed()
    expect(failed.ingested_at).toBeNull()
    const f = await newPending()
    await mustUpdate(f, { ingest_status: 'failed' })
    const { error } = await update(f, { ingested_at: new Date().toISOString() })
    expect(error?.code).toBe('42501')
    expect((await read(f)).ingested_at).toBeNull()
  })

  it.skip(`T-D8-15b (S2) an owner UPDATE that sets ingested_at on a pending row raises QE009${OWNER_ONLY}`, () => {})

  it('T-D8-16 (N3) the table\'s columns are exactly identity + granted + ingested_at: a new column fails this until the trigger and grant are revisited [control: the list compared against is named in this file]', async () => {
    const f = await newPending()
    const expected = [...IDENTITY_COLUMNS, ...GRANTED_COLUMNS, ...STAMPED_COLUMNS].sort()
    expect(Object.keys(f).sort()).toEqual(expected)
    expect(expected).toHaveLength(17)
  })

  // ---------------------------------------------------------------------------
  // Rev 3: the reviewer's two round-2 probes. Each SUCCEEDED on rev 2 (G0d-review2-probes-rev2) and is refused on rev 3.
  // ---------------------------------------------------------------------------
  it('T-D8-18 (S1 probe, round 2) a failed row carrying content_type and byte_size is refused 23514, so a later rejected row cannot inherit them [control: pending -> rejected wrong_type WITH its own content_type and byte_size in ONE update succeeds]', async () => {
    const f = await newPending()
    const stale = await update(f, { ingest_status: 'failed', content_type: 'image/png', byte_size: 99999999 })
    expect(stale.error?.code).toBe('23514')
    const pendingOnly = await update(f, { byte_size: 5 })
    expect(pendingOnly.error?.code).toBe('23514')
    await mustUpdate(f, { ingest_status: 'failed' })
    // the second step of the probe: failed -> rejected WITHOUT overwriting anything. Nothing stale exists to inherit.
    await mustUpdate(f, { ingest_status: 'rejected', reject_reason: 'wrong_type' })
    expect(await read(f)).toMatchObject({ ingest_status: 'rejected', reject_reason: 'wrong_type', content_type: null, byte_size: null })
    const g = await newPending()
    await mustUpdate(g, { ingest_status: 'rejected', reject_reason: 'wrong_type', content_type: 'image/png', byte_size: 99999999 })
    expect(await read(g)).toMatchObject({ content_type: 'image/png', byte_size: 99999999 })
  })

  it.skip(`T-D8-19 (S2(a) probe, round 2) an owner INSERT of a terminal row (rejected, too_large, ingested_at 2020-01-01) is refused QE011; a blank pending insert with exactly 050's column list is accepted${OWNER_ONLY}`, () => {})

  it('T-D8-20 (S2(a) control) 050\'s real insert path is accepted by the INSERT lock: a file turn through apply_material_inward_turn yields a pending row with every detail and ingested_at NULL [control: the row exists, and a status move then works]', async () => {
    const f = await newPending()
    expect(f).toMatchObject({ ingest_status: 'pending', content_type: null, byte_size: null, sha256: null, storage_path: null, reject_reason: null, preview_state: null, ingested_at: null })
    await mustUpdate(f, { ingest_status: 'failed' })
  })

  it.skip(`T-D8-21 (S3) a DOWN with one stored row present is refused DOWN_PRECONDITION_051 ... terminal_rows=1 and changes nothing${OWNER_ONLY}`, () => {})
})

// ---------------------------------------------------------------------------
// Static tests (no database).
// T-D8-11 -- overload rule (also in C3-C6). Exactly one CREATE [OR REPLACE] FUNCTION public.<name> per 050 name across
// supabase/migrations/ and docs/reviews/*.sql, and none of the seven names is reused by 051's new function. CONTROL: a
// planted second definition is counted.
// T-D8-17 -- the 051 function body does not name any capture table (049 DOWN Guard 2 scans function bodies for them).
// ---------------------------------------------------------------------------
const ROOT = resolve(__dirname, '..')
const NAMES_050 = [
  'apply_material_inward_turn',
  'expire_stale_material_inward',
  'pm_set_delivery_details',
  'pm_approve_delivery',
  'pm_reject_delivery',
  'pm_link_invoice',
  'pm_unlink_invoice',
] as const
const NAME_051 = 'trg_capture_files_before_update'

function sqlSources(): Array<{ path: string; text: string }> {
  const out: Array<{ path: string; text: string }> = []
  for (const dir of ['supabase/migrations', 'docs/reviews']) {
    const abs = resolve(ROOT, dir)
    if (!existsSync(abs)) continue
    for (const f of readdirSync(abs)) {
      if (f.endsWith('.sql')) out.push({ path: `${dir}/${f}`, text: readFileSync(resolve(abs, f), 'utf8') })
    }
  }
  return out
}

/** Definitions of public.<name> in the given texts. Comment lines are dropped first, so prose naming a function does not count. */
function countDefinitions(name: string, texts: string[]): number {
  const re = new RegExp(`CREATE\\s+(?:OR\\s+REPLACE\\s+)?FUNCTION\\s+public\\.${name}\\s*\\(`, 'gi')
  let n = 0
  for (const t of texts) {
    const code = t
      .split('\n')
      .map((l) => l.replace(/--.*$/, ''))
      .join('\n')
    n += (code.match(re) ?? []).length
  }
  return n
}

/** The $$ ... $$ body of the 051 function, comments included (Guard 2 matches on the raw prosrc, comments and all). */
function functionBody051(sql: string): string {
  const start = sql.indexOf(`CREATE FUNCTION public.${NAME_051}()`)
  if (start < 0) throw new Error('051 CREATE FUNCTION not found')
  const open = sql.indexOf('$$', start)
  const close = sql.indexOf('$$', open + 2)
  if (open < 0 || close < 0) throw new Error('051 function body delimiters not found')
  return sql.slice(open + 2, close)
}

// ---------------------------------------------------------------------------
// T-D8-11, REWRITTEN for migration 052 (plan section B, "T-D8-11 (Q4, S7)"): the test used to count definitions, which cannot
// survive the 052 DOWN files (they carry the pre-052 bodies) and the held file (a CREATE OR REPLACE). Its real purpose is the
// OVERLOAD hazard: CREATE OR REPLACE with a changed argument list silently creates a SECOND function (CLAUDE.md section 6).
// So it pins the NORMALISED HEADER (schema, name, argument-type list) of each 050-052 function, and asserts that EVERY
// definition of one of these names, in ANY schema, across supabase/migrations/ and docs/reviews/*.sql, carries exactly that
// header. The in-file pg_proc count = 1 assertion (A6 of the held file) stays the authority at apply time.
// Body-md5 pins are dropped on purpose (they would force a re-pin on every review edit).
// ---------------------------------------------------------------------------

// Typed from the live catalog (pg_get_function_identity_arguments, test-db, 14 Nov 2026), NOT from the SQL files; the readback
// is docs/reviews/052-code-evidence/step6-catalog-signatures.txt.
const HEADER_PINS: Record<string, string> = {
  apply_material_inward_turn: 'public.apply_material_inward_turn(text, uuid, uuid, uuid, text, text, jsonb, boolean, timestamp with time zone, integer)',
  expire_stale_material_inward: 'public.expire_stale_material_inward(text, timestamp with time zone)',
  pm_set_delivery_details: 'public.pm_set_delivery_details(uuid, text, text, text, date)',
  pm_approve_delivery: 'public.pm_approve_delivery(uuid)',
  pm_reject_delivery: 'public.pm_reject_delivery(uuid, text)',
  pm_link_invoice: 'public.pm_link_invoice(uuid, uuid[])',
  pm_unlink_invoice: 'public.pm_unlink_invoice(uuid)',
  trg_capture_files_before_update: 'public.trg_capture_files_before_update()',
  trg_capture_documents_before_insert: 'public.trg_capture_documents_before_insert()',
  trg_capture_documents_before_update: 'public.trg_capture_documents_before_update()',
  pm_classify_document: 'public.pm_classify_document(uuid, text)',
  capture_apply_classification: 'private.capture_apply_classification(uuid, text, uuid)',
}

// The alias table (S1): the spelled-out pg_get_functiondef text that the DOWN files carry must compare equal to the source form.
const TYPE_ALIASES: Record<string, string> = {
  timestamptz: 'timestamp with time zone',
  timestamp: 'timestamp without time zone',
  int: 'integer',
  int4: 'integer',
  bool: 'boolean',
  varchar: 'character varying',
  float8: 'double precision',
  decimal: 'numeric',
  char: 'character',
  bpchar: 'character',
}

function stripSqlComments(text: string): string {
  return text
    .split('\n')
    .map((l) => l.replace(/--.*$/, ''))
    .join('\n')
}

function normaliseType(raw: string): string {
  let t = raw.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\b(public|pg_catalog)\./g, '')
  const arr = /((?:\[\d*\])+)$/.exec(t)
  const suffix = arr ? arr[1].replace(/\d+/g, '') : ''
  if (arr) t = t.slice(0, t.length - arr[1].length).trim()
  t = t.replace(/\(.*\)$/, '').trim() // a type modifier such as (12,2) or (10)
  return `${TYPE_ALIASES[t] ?? t}${suffix}`
}

/** Split an argument list on commas that are not inside parentheses or single quotes. */
function splitTopLevel(args: string): string[] {
  const out: string[] = []
  let depth = 0
  let quoted = false
  let cur = ''
  for (const ch of args) {
    if (ch === "'") quoted = !quoted
    if (!quoted) {
      if (ch === '(') depth++
      if (ch === ')') depth--
      if (ch === ',' && depth === 0) {
        out.push(cur)
        cur = ''
        continue
      }
    }
    cur += ch
  }
  if (cur.trim() !== '') out.push(cur)
  return out
}

/** Parameter names, modes and DEFAULT expressions dropped; aliases, case, whitespace and public./pg_catalog. normalised. */
function normaliseArgTypes(args: string): string {
  if (args.trim() === '') return ''
  return splitTopLevel(args)
    .map((p) => {
      let q = p.trim().replace(/\s+/g, ' ').replace(/^(in|inout|variadic) /i, '')
      q = q.replace(/\s+default\s.*$/i, '').replace(/\s*=\s.*$/, '')
      const sp = q.indexOf(' ') // every parameter in these files is named: the first token is the name
      return normaliseType(sp < 0 ? q : q.slice(sp + 1))
    })
    .join(', ')
}

interface FnHeader {
  path: string
  schema: string
  name: string
  header: string
}

/** Every CREATE [OR REPLACE] FUNCTION in the given sources, in ANY schema (an optional schema before the name is captured). */
function functionHeaders(sources: Array<{ path: string; text: string }>): FnHeader[] {
  const out: FnHeader[] = []
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+(?:"?(\w+)"?\s*\.\s*)?"?(\w+)"?\s*\(/gi
  for (const { path, text } of sources) {
    const code = stripSqlComments(text)
    let m: RegExpExecArray | null
    while ((m = re.exec(code)) !== null) {
      let depth = 1
      let i = re.lastIndex
      let quoted = false
      const open = i
      for (; i < code.length && depth > 0; i++) {
        const ch = code[i]
        if (ch === "'") quoted = !quoted
        if (!quoted) {
          if (ch === '(') depth++
          if (ch === ')') depth--
        }
      }
      const schema = (m[1] ?? 'public').toLowerCase()
      const name = m[2].toLowerCase()
      out.push({ path, schema, name, header: `${schema}.${name}(${normaliseArgTypes(code.slice(open, i - 1))})` })
    }
  }
  return out
}

/** Violations: any definition of a pinned name whose normalised header differs from the pin (a second schema or argument list). */
function headerViolations(sources: Array<{ path: string; text: string }>): string[] {
  const out: string[] = []
  for (const h of functionHeaders(sources)) {
    const pin = HEADER_PINS[h.name]
    if (pin !== undefined && h.header !== pin) out.push(`${h.path}: ${h.header} (pinned: ${pin})`)
  }
  return out
}

describe('T-D8-11 overload rule (static; rewritten for 052: pinned normalised headers, every schema)', () => {
  const sources = sqlSources()

  it.each(Object.keys(HEADER_PINS))('%s: at least one definition exists and every definition, in any schema, carries the pinned header', (name) => {
    const defs = functionHeaders(sources).filter((h) => h.name === name)
    expect(defs.length, `no definition of ${name} found in the sources`).toBeGreaterThan(0)
    expect(defs.filter((d) => d.header !== HEADER_PINS[name]).map((d) => `${d.path}: ${d.header}`)).toEqual([])
  })

  it('the real sources have no header violation at all', () => {
    expect(headerViolations(sources)).toEqual([])
  })

  it('051 adds exactly one function, and its name is not one of the seven 050 names', () => {
    expect(NAMES_050 as readonly string[]).not.toContain(NAME_051)
    expect(countDefinitions(NAME_051, sources.map((s) => s.text))).toBe(1)
  })

  it('control (alias table): the spelled-out pg_get_functiondef form and the source form normalise equal', () => {
    expect(normaliseArgTypes('p_now timestamptz DEFAULT now(), p_n int DEFAULT NULL, p_f bool, p_v varchar, p_d float8, p_c decimal, p_ts timestamp')).toBe(
      'timestamp with time zone, integer, boolean, character varying, double precision, numeric, timestamp without time zone',
    )
    expect(normaliseArgTypes('p_now timestamp with time zone DEFAULT now(), p_n integer DEFAULT NULL::integer, p_m jsonb DEFAULT NULL::jsonb')).toBe(
      'timestamp with time zone, integer, jsonb',
    )
    expect(normaliseArgTypes('p_ids public.uuid[], p_x pg_catalog.text')).toBe('uuid[], text')
    expect(normaliseArgTypes('')).toBe('')
  })

  it('control (real 050 header): the spelled-out header the 052 DOWN carries for apply_material_inward_turn normalises equal to the 050 source header', () => {
    const defs = functionHeaders(sources).filter((h) => h.name === 'apply_material_inward_turn')
    const fromDown = defs.filter((d) => /052-down-/.test(d.path))
    const from050 = defs.filter((d) => /050_/.test(d.path) && /supabase\/migrations/.test(d.path))
    expect(fromDown.length, 'a 052 DOWN definition').toBeGreaterThan(0)
    expect(from050.length, 'the 050 migration definition').toBeGreaterThan(0)
    expect(new Set([...fromDown, ...from050].map((d) => d.header)).size).toBe(1)
    expect(fromDown[0]!.header).toBe(HEADER_PINS.apply_material_inward_turn)
  })

  it('control: a planted overload of apply_material_inward_turn is RED', () => {
    const planted = { path: 'docs/reviews/999_planted.sql', text: 'CREATE OR REPLACE FUNCTION public.apply_material_inward_turn(p_phone_number text, p_extra integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT 1 $$;' }
    expect(headerViolations([...sources, planted])).toHaveLength(1)
    expect(headerViolations([...sources, planted])[0]).toContain('999_planted.sql')
    // and the SAME header as the pin is not a violation (a plain CREATE OR REPLACE of an unchanged signature)
    const same = { path: 'docs/reviews/999_same.sql', text: 'CREATE OR REPLACE FUNCTION public.pm_approve_delivery(p_delivery_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;' }
    expect(headerViolations([...sources, same])).toEqual([])
  })

  it('control (every schema): a planted stray public.capture_apply_classification and a planted second private. copy are both RED', () => {
    const strayPublic = { path: 'docs/reviews/999_stray.sql', text: 'CREATE FUNCTION public.capture_apply_classification(p_document_id uuid, p_kind text, p_set_by uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;' }
    const secondPrivate = { path: 'docs/reviews/999_second.sql', text: 'CREATE OR REPLACE FUNCTION private.capture_apply_classification(p_document_id uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;' }
    expect(headerViolations([...sources, strayPublic]).map((v) => v.split(':')[0])).toEqual(['docs/reviews/999_stray.sql'])
    expect(headerViolations([...sources, secondPrivate]).map((v) => v.split(':')[0])).toEqual(['docs/reviews/999_second.sql'])
    // positive control for the same planted shapes: the legal private. definition (the pinned header) is not a violation
    const legal = { path: 'docs/reviews/999_legal.sql', text: 'CREATE OR REPLACE FUNCTION private.capture_apply_classification(p_document_id uuid, p_kind text, p_set_by uuid) RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;' }
    expect(headerViolations([...sources, legal])).toEqual([])
  })

  it('control: a comment that names a CREATE FUNCTION is not a definition', () => {
    const commentOnly = { path: 'docs/reviews/999_comment.sql', text: '-- CREATE FUNCTION public.pm_approve_delivery(p_other text) is described here only' }
    expect(headerViolations([...sources, commentOnly])).toEqual([])
  })
})

describe('T-D8-17 the 051 function body names no capture table (static; 049 DOWN Guard 2)', () => {
  // 049's Guard 2 regex uses PostgreSQL's \m ... \M word anchors; JS has none, so \b on both sides is the equivalent for these identifiers.
  const guard2 = (body: string) => /\b(deliveries|capture_documents|capture_files|delivery_invoice_links)\b/.test(body)
  const sql = sqlSources().find((s) => /051_capture_files_immutability\.sql$/.test(s.path))

  it('the real 051 function body does not match', () => {
    expect(sql, '051 SQL not found').toBeDefined()
    expect(guard2(functionBody051((sql as { text: string }).text))).toBe(false)
  })

  it('control: the same matcher does match a body that names the table', () => {
    expect(guard2('BEGIN UPDATE public.capture_files SET x = 1; END;')).toBe(true)
  })
})
