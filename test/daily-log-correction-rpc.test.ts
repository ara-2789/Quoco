import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  testClient,
  jwtClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  type TwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
  TEST_007_USER_A_EMAIL,
  TEST_007_PASSWORD,
} from './helpers/db'
import { MAX_VALUE_BYTES } from '@/lib/daily-logs/correction'

// Two behaviors specific to THIS build's design, not already covered by
// migration-019.test.ts's own suite (which proves the RPC's authorization
// guards): (1) the real 100 KB boundary the client's 95,000-byte margin sits
// under, and (2) the DB-level RESULT of the holiday reason-first write
// ordering — not just that the component code calls them in that order
// (visible in the source), but that the resulting intermediate state really
// is the harmless one the plan describes.
//
// Dates unique to this suite, clear of migration-019.test.ts's own project-A
// seeds and daily-log-detail-query.test.ts's (2026-10-11).
const LOG_DATE = '2026-10-12'
// ROW_HOLIDAY needs its OWN date, not LOG_DATE: daily_logs carries
// UNIQUE(project_id, engineer_id, log_date) (001_core_schema.sql:130,
// daily_logs_project_id_engineer_id_log_date_key) — one log per engineer per
// day. Both rows below share project A + fx.profileAId as engineer_id, so
// two rows on the same date collide on that natural key even though they
// have distinct ids; `{ onConflict: 'id' }` only dedupes on the PK and does
// not help here. Mirrors test/migration-019.test.ts's own LOG_DATE /
// PAST_LOG_DATE split for the identical reason.
const HOLIDAY_LOG_DATE = '2026-10-13'

const ROW_SIZE = '00000000-0000-4000-a000-0000000190e1'
const ROW_HOLIDAY = '00000000-0000-4000-a000-0000000190e2'

let fx: TwoTenantFixtures
let jwtA: SupabaseClient

async function seedLog(id: string, logDate: string, cols: Record<string, unknown> = {}): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    {
      id,
      tenant_id: TEST_TENANT_A_ID,
      project_id: TEST_PROJECT_A_ID,
      engineer_id: fx.profileAId,
      log_date: logDate,
      ...cols,
    },
    { onConflict: 'id' },
  )
  if (error) throw new Error(`seedLog(${id}) failed: ${error.message}`)
}

async function readRow(id: string): Promise<{ is_holiday: boolean | null; holiday_reason: string | null; weather: string | null }> {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .select('is_holiday, holiday_reason, weather')
    .eq('id', id)
    .single()
  if (error) throw new Error(`readRow failed: ${error.message}`)
  return data as { is_holiday: boolean | null; holiday_reason: string | null; weather: string | null }
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
  return { data, error: error as { code?: string; message: string } | null }
}

beforeAll(async () => {
  fx = await ensureTwoTenantFixtures()
  const db = testClient()
  await db.from('users').update({ role: 'pm' }).eq('id', fx.profileAId)
  await db.from('project_members').upsert(
    { project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, tenant_id: TEST_TENANT_A_ID, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  await seedLog(ROW_SIZE, LOG_DATE, { weather: 'clear' })
  await seedLog(ROW_HOLIDAY, HOLIDAY_LOG_DATE, { is_holiday: false, holiday_reason: null })

  jwtA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
})

afterAll(async () => {
  const db = testClient()
  await db.from('daily_log_edits').delete().in('daily_logs_id', [ROW_SIZE, ROW_HOLIDAY])
  await db.from('daily_logs').delete().in('id', [ROW_SIZE, ROW_HOLIDAY])
  await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID).eq('user_id', fx.profileAId)
  await db.from('users').update({ role: 'admin' }).eq('id', fx.profileAId)
  await removeTwoTenantFixtures()
})

describe('correct_daily_log — byte-size boundary (Change 4: 95,000-byte client margin under the real 100,000-byte RPC cap)', () => {
  it("a value under this build's 95,000-byte client margin (and well under the RPC's real 100,000-byte cap) succeeds", async () => {
    const value = 'a'.repeat(MAX_VALUE_BYTES - 1000) // inside the client margin
    const { error } = await correct(jwtA, ROW_SIZE, 'weather', value)
    expect(error).toBeNull()
    expect((await readRow(ROW_SIZE)).weather).toBe(value)
  })

  it("a value between the client's 95,000-byte margin and the RPC's real 100,000-byte cap still succeeds at the RPC (proves the margin is a genuine safety buffer, not the real boundary)", async () => {
    const value = 'b'.repeat(MAX_VALUE_BYTES + 2000) // over the client margin, under 100,000
    const { error } = await correct(jwtA, ROW_SIZE, 'weather', value)
    expect(error).toBeNull()
    expect((await readRow(ROW_SIZE)).weather).toBe(value)
  })

  it('a value over the real 100,000-byte RPC cap is rejected with program_limit_exceeded (54000), never message-text matching', async () => {
    const value = 'c'.repeat(100_001)
    const { error } = await correct(jwtA, ROW_SIZE, 'weather', value)
    expect(error?.code).toBe('54000')
  })
})

describe('correct_daily_log — holiday reason-first write ordering (§7/§8 of the build plan)', () => {
  it('writing holiday_reason alone leaves is_holiday untouched — the exact harmless intermediate state the plan describes', async () => {
    const { error: reasonErr } = await correct(jwtA, ROW_HOLIDAY, 'holiday_reason', 'Local festival')
    expect(reasonErr).toBeNull()

    const afterReason = await readRow(ROW_HOLIDAY)
    expect(afterReason.holiday_reason).toBe('Local festival')
    expect(afterReason.is_holiday).toBe(false) // still false — "a reason on a non-holiday day," not a broken state

    const { error: holidayErr } = await correct(jwtA, ROW_HOLIDAY, 'is_holiday', true)
    expect(holidayErr).toBeNull()

    const afterHoliday = await readRow(ROW_HOLIDAY)
    expect(afterHoliday.is_holiday).toBe(true)
    expect(afterHoliday.holiday_reason).toBe('Local festival') // both now consistent
  })
})
