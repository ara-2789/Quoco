import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getDailyLogsBoard } from '@/lib/daily-logs/query'
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

// UI slice 4 (Aravind, 2026-09-18) — reported symptom: the Daily Logs
// list page's expanded card showed a DIFFERENT date's morning_plan/
// evening_output text than the one being viewed, while the detail page
// for the same log showed the correct text for that date.
//
// ROOT CAUSE (found by reading the code, not by this test): NOT
// getDailyLogsBoard. This function already filters daily_logs by
// `.eq('log_date', logDate)` (lib/daily-logs/query.ts) for EVERY column
// it selects, including morning_plan/evening_output -- there is no
// separate "latest row" path and no split between how status/timestamp
// fields and text fields are fetched. This test proves exactly that
// per-date correctness directly, as the task instructed -- and it
// PASSES UNCHANGED, before and after the actual fix, because the real
// bug lives entirely on the client: app/(dashboard)/daily-logs/
// engineer-card.tsx's two <ScalarFieldRow> elements had no `key` that
// changed across a date navigation, so React reconciled (rather than
// remounted) the same component instance across a soft ?date= change,
// and ScalarFieldRow's own internal reducer state (lib/daily-logs/
// use-field-correction.ts's useReducer, seeded once via
// initialFieldRowState) never resynced to the new date's prop. That
// class of bug (stale client component state across a soft navigation)
// cannot be exercised by a server-side function test like this one --
// this repo has no jsdom/React-rendering test capability (no
// @testing-library/react, `environment: 'node'` in vitest.config.ts) --
// so the fix itself (adding `key={eng.log.id}`) is verified by code
// reading against React's own documented reconciliation semantics, not
// by an automated test. Said plainly here rather than claimed as
// covered.
//
// This test still has real, independent value: it is a genuine
// regression guard for getDailyLogsBoard's own per-date correctness,
// which a future edit to that function's merge/select logic could
// break even though it isn't what's broken today.

const LOG_DATE_EARLIER = '2026-07-20'
const LOG_DATE_LATER = '2026-07-21'
let engineerId: string

describe('getDailyLogsBoard — per-date text correctness (UI slice 4)', () => {
  let fx: TwoTenantFixtures
  let clientA: SupabaseClient

  beforeAll(async () => {
    fx = await ensureTwoTenantFixtures()
    const db = testClient()

    const { error: pmErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: fx.profileAId, role: 'pm' },
      { onConflict: 'project_id,user_id' },
    )
    if (pmErr) throw new Error(`seed pm member failed: ${pmErr.message}`)

    const { data: eng, error: engErr } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        full_name: 'ZZ 007 Engineer A (slice 4)',
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

    // Same engineer, same project, TWO CONSECUTIVE DATES, deliberately
    // distinct morning_plan/evening_output text on each -- the exact
    // shape the bug report described (17 Sept showing text that
    // actually belonged to a different date).
    const { error: earlierErr } = await db.from('daily_logs').upsert(
      {
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE_EARLIER,
        morning_submitted_at: '2026-07-20T04:00:00Z',
        evening_submitted_at: '2026-07-20T13:00:00Z',
        morning_plan: 'EARLIER DATE morning plan text',
        evening_output: 'EARLIER DATE evening output text',
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    if (earlierErr) throw new Error(`seed earlier daily_log failed: ${earlierErr.message}`)

    const { error: laterErr } = await db.from('daily_logs').upsert(
      {
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: engineerId,
        log_date: LOG_DATE_LATER,
        morning_submitted_at: '2026-07-21T04:00:00Z',
        evening_submitted_at: '2026-07-21T13:00:00Z',
        morning_plan: 'LATER DATE morning plan text',
        evening_output: 'LATER DATE evening output text',
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    if (laterErr) throw new Error(`seed later daily_log failed: ${laterErr.message}`)

    clientA = await jwtClient(TEST_007_USER_A_EMAIL, TEST_007_PASSWORD)
  })

  afterAll(async () => {
    const db = testClient()
    await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID)
    await removeTwoTenantFixtures()
  })

  it('the earlier date\'s board result carries the earlier date\'s morning_plan/evening_output, never the later date\'s', async () => {
    const result = await getDailyLogsBoard(
      clientA as unknown as SupabaseClient<Database>,
      fx.profileAId,
      LOG_DATE_EARLIER,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const board = result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)
    expect(board).toBeDefined()
    const eng = board!.engineers.find((e) => e.engineerId === engineerId)
    expect(eng).toBeDefined()
    expect(eng!.log?.morning_plan).toBe('EARLIER DATE morning plan text')
    expect(eng!.log?.evening_output).toBe('EARLIER DATE evening output text')
    expect(eng!.log?.morning_plan).not.toBe('LATER DATE morning plan text')
    expect(eng!.log?.evening_output).not.toBe('LATER DATE evening output text')
  })

  it('the later date\'s board result carries the later date\'s text, never the earlier date\'s', async () => {
    const result = await getDailyLogsBoard(
      clientA as unknown as SupabaseClient<Database>,
      fx.profileAId,
      LOG_DATE_LATER,
    )
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return

    const board = result.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)
    const eng = board!.engineers.find((e) => e.engineerId === engineerId)
    expect(eng!.log?.morning_plan).toBe('LATER DATE morning plan text')
    expect(eng!.log?.evening_output).toBe('LATER DATE evening output text')
  })

  it('each date\'s daily_logs.id (the field engineer-card.tsx now keys ScalarFieldRow on) is genuinely distinct', async () => {
    const earlier = await getDailyLogsBoard(clientA as unknown as SupabaseClient<Database>, fx.profileAId, LOG_DATE_EARLIER)
    const later = await getDailyLogsBoard(clientA as unknown as SupabaseClient<Database>, fx.profileAId, LOG_DATE_LATER)
    if (earlier.status !== 'ok' || later.status !== 'ok') throw new Error('unexpected read failure')

    const earlierLog = earlier.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)?.engineers.find((e) => e.engineerId === engineerId)?.log
    const laterLog = later.boards.find((b) => b.projectId === TEST_PROJECT_A_ID)?.engineers.find((e) => e.engineerId === engineerId)?.log
    expect(earlierLog?.id).toBeTruthy()
    expect(laterLog?.id).toBeTruthy()
    expect(earlierLog?.id).not.toBe(laterLog?.id)
  })
})
