// C2 (migration 051, rev 2): capture_files immutability, lifecycle CHECKs and the column UPDATE grant (D-8).
// Plan: docs/plans/pr-c-plan.md section 3d (T-D8-1..11) and section 8 row C2; rev 2 adds T-D8-12..17 after external
// review round 1 (docs/reviews/051-external-review-round-1.md). NOT YET RUN against test-db: 051 is HELD in
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

  it('T-D8-2 grant layer: file_no, claimed_content_type, tenant_id and id are refused 42501 [control: a granted column on the same row succeeds]', async () => {
    const f = await newPending()
    await mustUpdate(f, { byte_size: 100 })
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
    const a = await anon.from('capture_files').update({ byte_size: 5 }).eq('id', f.id).select('id')
    expect(a.error?.code).toBe('42501')
    const pm = await kit.jwt('pm1')
    const p = await pm.from('capture_files').update({ byte_size: 5 }).eq('id', f.id).select('id')
    expect(p.error?.code).toBe('42501')
    await mustUpdate(f, { byte_size: 5 })
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

  it.skip(`T-D8-10 DOWN rehearsal: after the DOWN, service_role UPDATE is 42501, the trigger, function, constraints and column are gone, ACLs match the pre-rehearsal values${OWNER_ONLY}`, () => {})

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
    await mustUpdate(f, { byte_size: 7 })
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

describe('T-D8-11 overload rule (static)', () => {
  const texts = sqlSources().map((s) => s.text)

  it.each(NAMES_050)('exactly one definition of %s across supabase/migrations/ and docs/reviews/*.sql', (name) => {
    expect(countDefinitions(name, texts)).toBe(1)
  })

  it('051 adds exactly one function, and its name is not one of the seven 050 names', () => {
    expect(NAMES_050 as readonly string[]).not.toContain(NAME_051)
    expect(countDefinitions(NAME_051, texts)).toBe(1)
  })

  it('control: a planted second definition is counted (so a duplicate would fail the tests above)', () => {
    const planted = 'CREATE OR REPLACE FUNCTION public.pm_approve_delivery(p_id uuid) RETURNS void LANGUAGE sql AS $$ SELECT 1 $$;'
    expect(countDefinitions('pm_approve_delivery', [...texts, planted])).toBe(2)
    const commentOnly = '-- CREATE FUNCTION public.pm_approve_delivery(uuid) is described here only'
    expect(countDefinitions('pm_approve_delivery', [...texts, commentOnly])).toBe(1)
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
