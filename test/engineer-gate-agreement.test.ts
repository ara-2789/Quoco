// Add-engineer slice 1, PR A (I7 / T6, SQL half + agreement). Real test-db.
//
// The plan section 7.2 matrix (test/helpers/engineer-gate-matrix.ts) is run
// through BOTH gates and each verdict is checked against the matrix's expected
// value and against the other gate:
//   - SQL   (authoritative): add_engineers_to_project in DRY-RUN, as a real
//     JWT caller. P0002 -> not_found, 42501 -> not_permitted, success -> allow.
//     Dry-run writes nothing (T7), so a probe row that is "allowed" leaves no trace.
//   - TS    (advisory): checkEngineerAdminAccess with the SAME caller's own
//     client, so RLS decides what project the gate can see, exactly as on the page.
//
// ONE auth user plays every row: before each row its users.role / tenant_id and
// its project_members row are set through the service client. The RLS policies
// and the SQL gate read those tables live, so a single JWT is enough.
//
// Rows 3-8 use fixture-only shapes (a real PM is users.role 'admin' + a 'pm'
// membership); no conclusion rests on them alone (plan 7.2).
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TEST_007_PASSWORD,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
  TEST_TENANT_A_ID,
  ensureTwoTenantFixtures,
  jwtClient,
  removeTwoTenantFixtures,
  testClient,
} from './helpers/db'
import {
  ENGINEER_GATE_MATRIX,
  freshFixtureNumber,
  type GateMatrixRow,
  type MatrixVerdict,
} from './helpers/engineer-gate-matrix'
import { checkEngineerAdminAccess } from '@/lib/engineers/gate'
import { profileForAuthId } from '@/lib/auth/profile-query'

// See test/engineer-tenant-isolation.test.ts for why this is explicit.
const HOOK_TIMEOUT_MS = 180_000

let db: SupabaseClient
let client: SupabaseClient
let authUserId: string
let userId: string
const email = `zz-gate-matrix-${crypto.randomUUID()}@example.com`
const verdicts = new Map<number, { sql: MatrixVerdict; ts: MatrixVerdict }>()

async function place(row: GateMatrixRow): Promise<string> {
  const projectId =
    row.project === 'own_tenant' ? TEST_PROJECT_A_ID : row.project === 'other_tenant' ? TEST_PROJECT_B_ID : crypto.randomUUID()

  // Memberships first: the composite FK (user_id, tenant_id) forbids changing the
  // user's tenant under a membership.
  const { error: delErr } = await db.from('project_members').delete().eq('user_id', userId)
  if (delErr) throw new Error(`place: clear memberships failed: ${delErr.message}`)
  const { error: updErr } = await db
    .from('users')
    .update({ tenant_id: row.callerTenant === 'null' ? null : TEST_TENANT_A_ID, role: row.role })
    .eq('id', userId)
  if (updErr) throw new Error(`place: set role/tenant failed: ${updErr.message}`)
  if (row.membership !== 'none') {
    const { error } = await db
      .from('project_members')
      .insert({ tenant_id: TEST_TENANT_A_ID, project_id: projectId, user_id: userId, role: row.membership })
    if (error) throw new Error(`place: insert membership failed: ${error.message}`)
  }
  return projectId
}

async function sqlVerdict(projectId: string): Promise<MatrixVerdict> {
  const { data, error } = await client.rpc('add_engineers_to_project', {
    p_project_id: projectId,
    p_engineers: [{ name: 'ZZ Gate Probe', whatsapp_number: freshFixtureNumber() }],
    p_dry_run: true,
    p_consent_attested: false,
  })
  if (error) {
    if (error.code === 'P0002') return 'not_found'
    if (error.code === '42501') return 'not_permitted'
    throw new Error(`unexpected SQLSTATE ${error.code}: ${error.message}`)
  }
  expect(data, 'an allowed dry-run returns statuses and applies nothing').toEqual({
    applied: false,
    rows: [{ idx: 0, status: 'ok' }],
  })
  return 'allow'
}

async function tsVerdict(projectId: string): Promise<MatrixVerdict> {
  const profile = await profileForAuthId(client, authUserId)
  return (await checkEngineerAdminAccess(client, profile, projectId)).verdict
}

beforeAll(async () => {
  db = testClient()
  await ensureTwoTenantFixtures()
  const { data, error } = await db.auth.admin.createUser({ email, password: TEST_007_PASSWORD, email_confirm: true })
  if (error || !data.user) throw new Error(`create matrix auth user failed: ${error?.message ?? 'no user'}`)
  authUserId = data.user.id
  const { data: stub, error: stubErr } = await db.from('users').select('id').eq('auth_id', authUserId).single<{ id: string }>()
  if (stubErr || !stub) throw new Error(`matrix user stub row missing: ${stubErr?.message ?? 'no row'}`)
  userId = stub.id
  client = await jwtClient(email, TEST_007_PASSWORD)
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  // The matrix user is removed explicitly: a tenant-NULL row (matrix row 10)
  // would not be caught by removeTwoTenantFixtures's tenant-scoped delete.
  if (userId) {
    await db.from('project_members').delete().eq('user_id', userId)
    await db.from('users').delete().eq('id', userId)
  }
  if (authUserId) await db.auth.admin.deleteUser(authUserId)
  await removeTwoTenantFixtures()
}, HOOK_TIMEOUT_MS)

describe('T6 / I7: the SQL gate and the TypeScript gate, one matrix', () => {
  it.each(ENGINEER_GATE_MATRIX.map((r) => [r.n, r] as const))(
    'row %i: SQL and TypeScript both return the expected verdict, and agree',
    async (_n, row) => {
      const projectId = await place(row)
      const sql = await sqlVerdict(projectId)
      const ts = await tsVerdict(projectId)
      verdicts.set(row.n, { sql, ts })
      expect(sql, `row ${row.n} (${row.prodShape}) SQL verdict`).toBe(row.expected)
      expect(ts, `row ${row.n} (${row.prodShape}) TypeScript verdict`).toBe(row.expected)
      expect(ts, `row ${row.n} TypeScript agrees with SQL`).toBe(sql)
    },
  )

  it('the matrix produced a verdict for every row, and every row agreed', () => {
    expect([...verdicts.keys()].sort((a, b) => a - b)).toEqual(ENGINEER_GATE_MATRIX.map((r) => r.n))
    for (const [n, v] of verdicts) expect(v.ts, `row ${n}`).toBe(v.sql)
  })

  it('rows 1, 2, 9 and 11 exist in the real prod shape; rows 3-8 are labelled fixture-only or stub', () => {
    const real = ENGINEER_GATE_MATRIX.filter((r) => r.prodShape === 'yes').map((r) => r.n)
    expect(real).toEqual([1, 2, 9, 11])
    for (const n of [3, 4, 5, 6, 7, 8]) {
      expect(ENGINEER_GATE_MATRIX.find((r) => r.n === n)!.prodShape).not.toBe('yes')
    }
  })
})
