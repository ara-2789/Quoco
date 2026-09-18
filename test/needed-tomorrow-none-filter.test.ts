import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'
import { getNeededTomorrowItems, isMeaningfulDependencyText } from '@/lib/daily-logs/query'
import { istDateString } from '@/lib/daily-logs/date'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
} from './helpers/db'

// fix/daily-log-fields (Aravind, 2026-09-18). Real test-db proof that
// "None" answers (and its variants) never appear as a "Needed tomorrow"
// notice -- the filter lives in getNeededTomorrowItems itself (the
// selector), not client-side in the Today page, per this fix's own
// instruction. Six engineers, same project, same log_date (today's IST
// date at call time -- the date WINDOW itself is already covered by
// test/needed-tomorrow-window.test.ts; this file is purely about the
// TEXT filter, so it deliberately stays inside one single day to avoid
// mixing the two concerns into one test). "" (a genuinely empty string,
// not NULL) is included specifically because `.not(col, 'is', null)`
// alone would NOT exclude it -- only the JS-level isMeaningfulDependencyText
// check does, so this row proves that check is actually running, not
// just the SQL NULL filter.

const NOW = new Date()
const TODAY_IST = istDateString(NOW)

const CASES: { label: string; text: string; shouldShow: boolean }[] = [
  { label: 'None', text: 'None', shouldShow: false },
  { label: 'none', text: 'none', shouldShow: false },
  { label: 'nil', text: 'nil', shouldShow: false },
  { label: 'dash', text: '-', shouldShow: false },
  { label: 'empty string', text: '', shouldShow: false },
  { label: 'a real value', text: 'Cement delivery expected by 9am', shouldShow: true },
]

let pmUserId: string
const engineerIdByLabel = new Map<string, string>()

beforeAll(async () => {
  const fx = await ensureTwoTenantFixtures()
  pmUserId = fx.profileAId
  const db = testClient()

  const { error: pmErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: pmUserId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  if (pmErr) throw new Error(`seed pm member failed: ${pmErr.message}`)

  for (const c of CASES) {
    const { data: eng, error: engErr } = await db
      .from('users')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        full_name: `ZZ 007 Engineer A (slice none-filter ${c.label})`,
        role: 'engineer',
        status: 'active',
        messaging_blocked: false,
        auth_id: null,
      })
      .select('id')
      .single<{ id: string }>()
    if (engErr || !eng) throw new Error(`seed engineer (${c.label}) failed: ${engErr?.message ?? 'no row'}`)
    engineerIdByLabel.set(c.label, eng.id)

    const { error: memErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: eng.id, role: 'engineer' },
      { onConflict: 'project_id,user_id' },
    )
    if (memErr) throw new Error(`seed engineer member (${c.label}) failed: ${memErr.message}`)

    const { error: logErr } = await db.from('daily_logs').upsert(
      {
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: eng.id,
        log_date: TODAY_IST,
        evening_tomorrow_needs: c.text,
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
    if (logErr) throw new Error(`seed daily_log (${c.label}) failed: ${logErr.message}`)
  }
})

afterAll(async () => {
  const db = testClient()
  const engineerIds = [...engineerIdByLabel.values()]
  await db.from('daily_logs').delete().eq('project_id', TEST_PROJECT_A_ID).in('engineer_id', engineerIds)
  await removeTwoTenantFixtures()
})

describe('isMeaningfulDependencyText (unit)', () => {
  it.each(CASES)('$label -> $shouldShow', ({ text, shouldShow }) => {
    expect(isMeaningfulDependencyText(text)).toBe(shouldShow)
  })
})

describe('getNeededTomorrowItems — "None" answers filtered in the selector (fix/daily-log-fields)', () => {
  it.each(CASES)('$label: shown = $shouldShow', async ({ label, shouldShow }) => {
    const result = await getNeededTomorrowItems(testClient() as unknown as SupabaseClient<Database>, pmUserId, NOW)
    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    const engineerId = engineerIdByLabel.get(label)
    const item = result.items.find((i) => i.engineerId === engineerId)
    if (shouldShow) {
      expect(item).toBeDefined()
    } else {
      expect(item).toBeUndefined()
    }
  })
})
