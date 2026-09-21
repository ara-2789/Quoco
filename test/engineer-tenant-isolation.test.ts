// Add-engineer slice 1, PR A. Tenant isolation of the add path, on test-db.
// Plan section (f): I1, I2, I5, I6. (I3 and I4 -- the list page -- are PR B.)
//
// Two tenants (test/helpers/db.ts's ensureTwoTenantFixtures). A "PM from
// company B" is built in BOTH shapes: the REAL prod shape (users.role 'admin'
// + project_members.role 'pm' on B's project -- 016:177-181, projects/new
// page.tsx) and the FIXTURE-ONLY shape (users.role 'pm'). No conclusion rests
// on the fixture-only shape alone.
//
// POSITIVE CONTROL SEAM: `companyB` below is the ONE place that says which
// client plays "company B", and which project is "B's own". The Step-4
// positive control substitutes company A's own admin+pm client (and A's own
// project) here, and every refusal assertion in I1, I2 and I5 must then fail
// by name -- a test that can only pass by refusing is not evidence.
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  TEST_007_PASSWORD,
  TEST_007_USER_A_EMAIL,
  TEST_007_USER_B_EMAIL,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  ensureTwoTenantFixtures,
  jwtClient,
  removeTwoTenantFixtures,
  testClient,
  type TwoTenantFixtures,
} from './helpers/db'
import { freshFixtureNumber } from './helpers/engineer-gate-matrix'

// The two-tenant fixture setup and teardown are dozens of sequential round
// trips; with test-db under load they exceed the 30 s default (observed
// 2026-09-21: both hooks timed out and the teardown was cut off before its
// last step). 180 s is headroom, not a fix for a slow database.
const HOOK_TIMEOUT_MS = 180_000

let db: SupabaseClient
let jwtA: SupabaseClient
let jwtB: SupabaseClient
let fx: TwoTenantFixtures

// The seam. See the header.
const companyB = () => ({ client: jwtB, ownProjectId: TEST_PROJECT_B_ID })

const PROJECT_A_NAME = 'ZZ 007 Project A'
// Fresh per run and shape-valid for the RPC (testPhone() yields 16 digits, which
// the function refuses as an invalid number shape).
const PROBE = freshFixtureNumber()
const WITH_PROJECT = freshFixtureNumber()
const NO_PROJECT = freshFixtureNumber()
const PROBE_NUMBER = () => PROBE
const ENGINEER_WITH_PROJECT = () => WITH_PROJECT
const ENGINEER_NO_PROJECT = () => NO_PROJECT
const ENGINEER_FULL_NAME = 'ZZ Isolation Engineer'

interface Refusal {
  code: string | undefined
  message: string | undefined
}

async function callAdd(client: SupabaseClient, projectId: string, number: string, dryRun: boolean) {
  return client.rpc('add_engineers_to_project', {
    p_project_id: projectId,
    p_engineers: [{ name: 'ZZ Isolation Probe', whatsapp_number: number }],
    p_dry_run: dryRun,
    p_consent_attested: false,
  })
}

async function rowCounts() {
  const one = async (table: string, tenantId: string) => {
    const { count, error } = await db.from(table).select('*', { count: 'exact', head: true }).eq('tenant_id', tenantId)
    if (error) throw new Error(`count ${table} failed: ${error.message}`)
    return count ?? 0
  }
  return {
    usersA: await one('users', TEST_TENANT_A_ID),
    membersA: await one('project_members', TEST_TENANT_A_ID),
    usersB: await one('users', TEST_TENANT_B_ID),
    membersB: await one('project_members', TEST_TENANT_B_ID),
  }
}

async function usersWithNumber(number: string): Promise<number> {
  const { count, error } = await db.from('users').select('*', { count: 'exact', head: true }).eq('whatsapp_number', number)
  if (error) throw new Error(`count by number failed: ${error.message}`)
  return count ?? 0
}

async function setRole(profileId: string, role: string) {
  const { error } = await db.from('users').update({ role }).eq('id', profileId)
  if (error) throw new Error(`setRole failed: ${error.message}`)
}

async function addPmMembership(tenantId: string, projectId: string, userId: string) {
  const { error } = await db
    .from('project_members')
    .upsert({ tenant_id: tenantId, project_id: projectId, user_id: userId, role: 'pm' }, { onConflict: 'project_id,user_id' })
  if (error) throw new Error(`addPmMembership failed: ${error.message}`)
}

async function insertEngineer(number: string, projectId: string | null) {
  const { data, error } = await db
    .from('users')
    .insert({ tenant_id: TEST_TENANT_A_ID, role: 'engineer', status: 'active', full_name: ENGINEER_FULL_NAME, whatsapp_number: number })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`insertEngineer failed: ${error?.message ?? 'no row'}`)
  if (projectId) {
    const { error: mErr } = await db
      .from('project_members')
      .insert({ tenant_id: TEST_TENANT_A_ID, project_id: projectId, user_id: data.id, role: 'engineer' })
    if (mErr) throw new Error(`insertEngineer membership failed: ${mErr.message}`)
  }
}

// The two "PM from company B" shapes. Each one is set on B's profile, then the
// assertions run under it.
const B_SHAPES = [
  { label: 'REAL prod shape (users.role admin + project_members pm)', usersRole: 'admin' },
  { label: 'fixture-only shape (users.role pm + project_members pm)', usersRole: 'pm' },
] as const

beforeAll(async () => {
  db = testClient()
  fx = await ensureTwoTenantFixtures()
  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
  jwtB = await jwtClient(TEST_007_USER_B_EMAIL, TEST_007_PASSWORD)
  // Both admins are PMs of their own project (the real shape).
  await addPmMembership(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, fx.profileAId)
  await addPmMembership(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, fx.profileBId)
  // Tenant A's engineers, for I5.
  await insertEngineer(ENGINEER_WITH_PROJECT(), TEST_PROJECT_A_ID)
  await insertEngineer(ENGINEER_NO_PROJECT(), null)
}, HOOK_TIMEOUT_MS)

afterAll(async () => {
  await removeTwoTenantFixtures()
}, HOOK_TIMEOUT_MS)

describe.each(B_SHAPES)('company B PM, $label', ({ usersRole }) => {
  beforeAll(async () => {
    await setRole(fx.profileBId, usersRole)
  })

  it("I1: cannot ADD to company A's project -- dry-run returns no_data_found, identical to a nonexistent project id, zero writes", async () => {
    const before = await rowCounts()
    const foreign = await callAdd(companyB().client, TEST_PROJECT_A_ID, PROBE_NUMBER(), true)
    const missing = await callAdd(companyB().client, crypto.randomUUID(), PROBE_NUMBER(), true)

    expect(foreign.error, 'the foreign-project dry-run must be REFUSED').not.toBeNull()
    expect(foreign.data).toBeNull()
    expect(foreign.error!.code, 'refusal code for company A project').toBe('P0002')
    expect(missing.error!.code).toBe('P0002')
    const asRefusal = (e: { code?: string; message?: string }): Refusal => ({ code: e.code, message: e.message })
    expect(asRefusal(foreign.error!), 'indistinguishable from a nonexistent project id').toEqual(asRefusal(missing.error!))
    expect(await rowCounts()).toEqual(before)
  })

  it("I2: cannot ADD to company A's project -- apply returns no_data_found, nothing written in either tenant", async () => {
    const before = await rowCounts()
    const applied = await callAdd(companyB().client, TEST_PROJECT_A_ID, PROBE_NUMBER(), false)

    expect(applied.error, 'the foreign-project APPLY must be REFUSED').not.toBeNull()
    expect(applied.data).toBeNull()
    expect(applied.error!.code, 'refusal code for company A project (apply)').toBe('P0002')
    expect(await rowCounts()).toEqual(before)
    expect(await usersWithNumber(PROBE_NUMBER()), 'no users row was created for the probe number').toBe(0)
  })

  it("I5: a number registered in company A is not distinguishable from company B's side -- exactly {idx, status:'number_registered'}, no project, name or id", async () => {
    const { client, ownProjectId } = companyB()
    for (const number of [ENGINEER_WITH_PROJECT(), ENGINEER_NO_PROJECT()]) {
      const res = await callAdd(client, ownProjectId, number, true)
      expect(res.error, `dry-run of ${number} from company B's own project must succeed`).toBeNull()
      const payload = res.data as { applied: boolean; rows: Array<Record<string, unknown>> }
      expect(payload.applied).toBe(false)
      expect(payload.rows, 'one row').toHaveLength(1)
      // T5: exactly the keys idx and status, and the generic status -- never
      // registered_no_project, on_another_project or already_on_this_project.
      expect(payload.rows[0]).toEqual({ idx: 0, status: 'number_registered' })
      const serialised = JSON.stringify(res.data)
      expect(serialised).not.toContain(TEST_PROJECT_A_ID)
      expect(serialised).not.toContain(PROJECT_A_NAME)
      expect(serialised).not.toContain(ENGINEER_FULL_NAME)
    }
  })
})

describe('I6: positive control -- company A can use its own project, in both shapes', () => {
  it.each([
    { label: 'REAL prod shape (users.role admin + project_members pm)', usersRole: 'admin' },
    { label: 'fixture-only shape (users.role pm + project_members pm)', usersRole: 'pm' },
  ])('company A, $label: dry-run of an unregistered number on its own project succeeds', async ({ usersRole }) => {
    await setRole(fx.profileAId, usersRole)
    const res = await callAdd(jwtA, TEST_PROJECT_A_ID, PROBE_NUMBER(), true)
    expect(res.error, 'company A must be able to dry-run on its own project').toBeNull()
    expect(res.data).toEqual({ applied: false, rows: [{ idx: 0, status: 'ok' }] })
  })

  it("company A sees the SAME number company B saw as generic, classified specifically (so B's generic answer is a real redaction, not the only answer the function has)", async () => {
    await setRole(fx.profileAId, 'admin')
    const res = await callAdd(jwtA, TEST_PROJECT_A_ID, ENGINEER_WITH_PROJECT(), true)
    expect(res.error).toBeNull()
    expect((res.data as { rows: Array<{ status: string }> }).rows[0].status).toBe('already_on_this_project')
    const noProject = await callAdd(jwtA, TEST_PROJECT_A_ID, ENGINEER_NO_PROJECT(), true)
    expect((noProject.data as { rows: Array<{ status: string }> }).rows[0].status).toBe('registered_no_project')
  })
})
