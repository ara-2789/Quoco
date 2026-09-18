import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getNeededTomorrowItems } from '@/lib/daily-logs/query'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
} from './helpers/db'

// UI slice 6 (Aravind, 2026-09-18). Real test-db proof of
// getNeededTomorrowItems' own visibility window: the day a dependency was
// reported plus the following day, in IST -- reported on day N's evening,
// visible through the end of day N+1, gone from day N+2.
//
// THE BOUNDARY THIS TEST ACTUALLY EXERCISES: NOW below is chosen so the
// UTC calendar day and the IST calendar day DISAGREE at the instant of
// the read -- 2026-08-11T19:15:00Z is 00:45 IST on 2026-08-12 (already
// past IST midnight), while the UTC calendar date is still 2026-08-11.
// A naive UTC-based "today"/"yesterday" computation would resolve the
// window to {2026-08-11, 2026-08-10} instead of the correct (IST)
// {2026-08-12, 2026-08-11} -- a DIFFERENT, non-overlapping-except-at-one-
// point set, so a wrong implementation would show/hide the exact
// opposite of what this test asserts, not coincidentally pass either
// way. IST has no DST, so this boundary is exact and repeatable.

const NOW = new Date('2026-08-11T19:15:00.000Z') // 00:45 IST, 2026-08-12
const LOG_DATE_TODAY = '2026-08-12' // IST "today" at NOW -- in window
const LOG_DATE_YESTERDAY = '2026-08-11' // IST "yesterday" at NOW -- in window
const LOG_DATE_TWO_DAYS_AGO = '2026-08-10' // IST day N-2 at NOW -- out of window

let engineerId: string
let pmUserId: string

beforeAll(async () => {
  const fx = await ensureTwoTenantFixtures()
  pmUserId = fx.profileAId
  const db = testClient()

  const { error: pmErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: pmUserId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  if (pmErr) throw new Error(`seed pm member failed: ${pmErr.message}`)

  const { data: eng, error: engErr } = await db
    .from('users')
    .insert({
      tenant_id: TEST_TENANT_A_ID,
      full_name: 'ZZ 007 Engineer A (slice 6 needed-tomorrow window)',
      role: 'engineer',
      status: 'active',
      messaging_blocked: false,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (engErr || !eng) throw new Error(`seed engineer failed: ${engErr?.message ?? 'no row'}`)
  engineerId = eng.id

  const { error: memErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: engineerId, role: 'engineer' },
    { onConflict: 'project_id,user_id' },
  )
  if (memErr) throw new Error(`seed engineer member failed: ${memErr.message}`)

  for (const [logDate, text] of [
    [LOG_DATE_TODAY, 'SLICE-6-WINDOW-TEST: today dependency'],
    [LOG_DATE_YESTERDAY, 'SLICE-6-WINDOW-TEST: yesterday dependency'],
    [LOG_DATE_TWO_DAYS_AGO, 'SLICE-6-WINDOW-TEST: two-days-ago dependency'],
  ] as const) {
    const { error: logErr } = await db.from('daily_logs').upsert(
      {
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: engineerId,
        log_date: logDate,
        evening_tomorrow_needs: text,
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    if (logErr) throw new Error(`seed daily_log ${logDate} failed: ${logErr.message}`)
  }
})

afterAll(async () => {
  const db = testClient()
  await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID).eq('engineer_id', engineerId)
  await removeTwoTenantFixtures()
})

describe('getNeededTomorrowItems — visibility window (UI slice 6)', () => {
  it('reported today (IST): shown', async () => {
    const result = await getNeededTomorrowItems(testClient() as unknown as SupabaseClient<Database>, pmUserId, NOW)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const item = result.items.find((i) => i.logDate === LOG_DATE_TODAY && i.engineerId === engineerId)
    expect(item).toBeDefined()
    expect(item?.dependencyText).toBe('SLICE-6-WINDOW-TEST: today dependency')
  })

  it('reported yesterday (IST): shown', async () => {
    const result = await getNeededTomorrowItems(testClient() as unknown as SupabaseClient<Database>, pmUserId, NOW)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const item = result.items.find((i) => i.logDate === LOG_DATE_YESTERDAY && i.engineerId === engineerId)
    expect(item).toBeDefined()
    expect(item?.dependencyText).toBe('SLICE-6-WINDOW-TEST: yesterday dependency')
  })

  it('reported two days ago (IST): NOT shown', async () => {
    const result = await getNeededTomorrowItems(testClient() as unknown as SupabaseClient<Database>, pmUserId, NOW)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const item = result.items.find((i) => i.logDate === LOG_DATE_TWO_DAYS_AGO && i.engineerId === engineerId)
    expect(item).toBeUndefined()
  })

  it('every returned item for this engineer carries the correct project/engineer names', async () => {
    const result = await getNeededTomorrowItems(testClient() as unknown as SupabaseClient<Database>, pmUserId, NOW)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const items = result.items.filter((i) => i.engineerId === engineerId)
    expect(items).toHaveLength(2)
    for (const item of items) {
      expect(item.projectId).toBe(TEST_PROJECT_A_ID)
      expect(item.engineerName).toBe('ZZ 007 Engineer A (slice 6 needed-tomorrow window)')
    }
  })
})
