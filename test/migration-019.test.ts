import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { type SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  type TwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_PASSWORD,
} from './helpers/db'

// Migration 019 — Rule 4.3 inline correction: correct_daily_log RPC + audit.
// Negative-control suite (015/016/017 model): each authorization guard is proven
// by a call that must be REJECTED, keyed on error.code / SQLSTATE — never message
// text. Run BEFORE 019 is applied = the RPC doesn't exist and every call errors
// "function does not exist" (proves the suite exercises the real object); after
// apply the happy paths go green and the guards reject with 42501.
//
// The shared two-tenant fixtures are admin-role with NO project_members, so this
// suite promotes user A to 'pm', makes A a member of project A (the MEMBER
// project), and adds a SAME-TENANT project A2 that A is deliberately NOT a member
// of (the SCOPE-GAP negative control — the whole reason the RPC re-checks
// membership instead of trusting the tenant-wide daily_logs_update RLS policy).
//
//   T-019-01  happy: PM corrects a scalar (text) on a member-project row →
//             daily_logs updated AND one daily_log_edits row written (atomic)
//   T-019-02  happy: boolean + integer casts (is_holiday, evening_workers_on_site)
//   T-019-03  *** SCOPE GAP *** same-tenant NON-member project → 42501, no write
//   T-019-04  cross-tenant target → rejected, no write
//   T-019-05  disallowed column (JSONB col + engineer_id) → 42501
//   T-019-06  no-op (new == old) → returns null, NO audit row recorded
//   T-019-07  PM-only: a non-pm member is rejected → 42501
//   T-019-08  past-date correction is allowed (§3.3) — happy path on an old date

const PROJECT_A2_ID = '00000000-0000-4000-a000-00000000019a' // tenant A, non-member
// Dates unique to THIS suite — kept clear of the 017 suite's project-A seed
// (2026-07-15), since daily_logs has UNIQUE(project_id, engineer_id, log_date)
// and both suites use project A + user A.
const LOG_DATE = '2026-09-19'
const PAST_LOG_DATE = '2026-01-05'

let fx: TwoTenantFixtures
let jwtA: SupabaseClient

// Deterministic daily_logs ids so assertions/cleanup are stable across re-runs.
const ROW_MEMBER = '00000000-0000-4000-a000-0000000190a1' // project A (member)
const ROW_MEMBER_PAST = '00000000-0000-4000-a000-0000000190a2' // project A, past date
const ROW_NONMEMBER = '00000000-0000-4000-a000-0000000190b1' // project A2 (non-member)
const ROW_XTENANT = '00000000-0000-4000-a000-0000000190c1' // project B (tenant B)

async function seedLog(
  id: string,
  tenantId: string,
  projectId: string,
  engineerId: string,
  logDate: string,
  cols: Record<string, unknown>,
): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    { id, tenant_id: tenantId, project_id: projectId, engineer_id: engineerId, log_date: logDate, ...cols },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seedLog(${id}) failed: ${error.message}`)
}

async function readCol(id: string, col: string): Promise<unknown> {
  const db = testClient()
  const { data, error } = await db.from('daily_logs').select(col).eq('id', id).single()
  if (error) throw new Error(`readCol failed: ${error.message}`)
  return (data as unknown as Record<string, unknown>)[col]
}

async function editCount(dailyLogsId: string): Promise<number> {
  const db = testClient()
  const { count, error } = await db
    .from('daily_log_edits')
    .select('id', { count: 'exact', head: true })
    .eq('daily_logs_id', dailyLogsId)
  if (error) throw new Error(`editCount failed: ${error.message}`)
  return count ?? 0
}

async function correct(
  client: SupabaseClient,
  dailyLogsId: string,
  column: string,
  newValue: unknown,
): Promise<{ data: unknown; error: { code?: string; message: string } | null }> {
  const { data, error } = await client.rpc('correct_daily_log', {
    p_daily_logs_id: dailyLogsId,
    p_column: column,
    p_new_value: newValue,
  })
  return { data, error }
}

beforeAll(async () => {
  const db = testClient()
  fx = await ensureTwoTenantFixtures()

  // Promote A to PM and make A a member of project A only (NOT project A2).
  await db.from('users').update({ role: 'pm' }).eq('id', fx.profileAId)
  await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  // Same-tenant project A has a member; A2 deliberately does not include A.
  await db.from('projects').upsert(
    { id: PROJECT_A2_ID, tenant_id: TEST_TENANT_A_ID, created_by: fx.profileAId, name: 'ZZ 019 Project A2 (non-member)' },
    { onConflict: 'id' },
  )

  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

beforeEach(async () => {
  // Establish a known baseline BEFORE each test (incl. the first): seed the
  // rows and clear audit rows. Must be beforeEach, not afterEach — afterEach
  // runs AFTER a test, so the first test would execute against unseeded rows
  // (correct_daily_log then RAISEs P0002 "no daily_logs row"). Re-seeding via
  // upsert(onConflict:'id') also resets any mutation a prior test made, so the
  // suite is order-independent.
  await seedLog(ROW_MEMBER, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, fx.profileAId, LOG_DATE, {
    weather: 'cloudy', is_holiday: false, evening_workers_on_site: 10,
  })
  await seedLog(ROW_MEMBER_PAST, TEST_TENANT_A_ID, TEST_PROJECT_A_ID, fx.profileAId, PAST_LOG_DATE, {
    weather: 'rain',
  })
  await seedLog(ROW_NONMEMBER, TEST_TENANT_A_ID, PROJECT_A2_ID, fx.profileAId, LOG_DATE, { weather: 'clear' })
  await seedLog(ROW_XTENANT, TEST_TENANT_B_ID, TEST_PROJECT_B_ID, fx.profileBId, LOG_DATE, { weather: 'clear' })
  const db = testClient()
  await db.from('daily_log_edits').delete().in('daily_logs_id', [ROW_MEMBER, ROW_MEMBER_PAST, ROW_NONMEMBER, ROW_XTENANT])
})

afterAll(async () => {
  const db = testClient()
  await db.from('daily_log_edits').delete().in('daily_logs_id', [ROW_MEMBER, ROW_MEMBER_PAST, ROW_NONMEMBER, ROW_XTENANT])
  await db.from('daily_logs').delete().in('id', [ROW_MEMBER, ROW_MEMBER_PAST, ROW_NONMEMBER, ROW_XTENANT])
  await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID).eq('user_id', fx.profileAId)
  await db.from('projects').delete().eq('id', PROJECT_A2_ID)
  await db.from('users').update({ role: 'admin' }).eq('id', fx.profileAId) // restore shared fixture state
  await removeTwoTenantFixtures()
})

describe('migration 019 — correct_daily_log RPC', () => {
  it('T-019-01: PM corrects a scalar on a member-project row → updated + one audit row (atomic)', async () => {
    const { data, error } = await correct(jwtA, ROW_MEMBER, 'weather', 'sunny')
    expect(error).toBeNull()
    expect(typeof data).toBe('string') // the daily_log_edits.id
    expect(await readCol(ROW_MEMBER, 'weather')).toBe('sunny')
    expect(await editCount(ROW_MEMBER)).toBe(1)
  })

  it('T-019-02: boolean and integer casts work', async () => {
    const b = await correct(jwtA, ROW_MEMBER, 'is_holiday', true)
    expect(b.error).toBeNull()
    expect(await readCol(ROW_MEMBER, 'is_holiday')).toBe(true)

    const n = await correct(jwtA, ROW_MEMBER, 'evening_workers_on_site', 42)
    expect(n.error).toBeNull()
    expect(await readCol(ROW_MEMBER, 'evening_workers_on_site')).toBe(42)
  })

  it('T-019-03: SCOPE GAP — same-tenant NON-member project is rejected, no write', async () => {
    const { error } = await correct(jwtA, ROW_NONMEMBER, 'weather', 'sunny')
    expect(error?.code).toBe('42501')
    expect(await readCol(ROW_NONMEMBER, 'weather')).toBe('clear') // unchanged
    expect(await editCount(ROW_NONMEMBER)).toBe(0)
  })

  it('T-019-04: cross-tenant target is rejected, no write', async () => {
    const { error } = await correct(jwtA, ROW_XTENANT, 'weather', 'sunny')
    expect(error?.code).toBe('42501')
    expect(await readCol(ROW_XTENANT, 'weather')).toBe('clear')
    expect(await editCount(ROW_XTENANT)).toBe(0)
  })

  it('T-019-05: disallowed columns (JSONB col + identity col) are rejected', async () => {
    const jsonbCol = await correct(jwtA, ROW_MEMBER, 'morning_manpower_planned', [{ role: 'mason', count: 3 }])
    expect(jsonbCol.error?.code).toBe('42501')
    const idCol = await correct(jwtA, ROW_MEMBER, 'engineer_id', fx.profileBId)
    expect(idCol.error?.code).toBe('42501')
    expect(await editCount(ROW_MEMBER)).toBe(0)
  })

  it('T-019-06: no-op (new == old) returns null and records NO audit row', async () => {
    const { data, error } = await correct(jwtA, ROW_MEMBER, 'weather', 'cloudy') // already 'cloudy'
    expect(error).toBeNull()
    expect(data).toBeNull()
    expect(await editCount(ROW_MEMBER)).toBe(0)
  })

  it('T-019-07: PM-only — a non-pm member is rejected', async () => {
    const db = testClient()
    await db.from('users').update({ role: 'qs' }).eq('id', fx.profileAId)
    try {
      const { error } = await correct(jwtA, ROW_MEMBER, 'weather', 'sunny')
      expect(error?.code).toBe('42501')
      expect(await editCount(ROW_MEMBER)).toBe(0)
    } finally {
      await db.from('users').update({ role: 'pm' }).eq('id', fx.profileAId)
    }
  })

  it('T-019-08: correction on a PAST date is allowed (§3.3, no date gate)', async () => {
    const { error } = await correct(jwtA, ROW_MEMBER_PAST, 'weather', 'sunny')
    expect(error).toBeNull()
    expect(await readCol(ROW_MEMBER_PAST, 'weather')).toBe('sunny')
    expect(await editCount(ROW_MEMBER_PAST)).toBe(1)
  })
})
