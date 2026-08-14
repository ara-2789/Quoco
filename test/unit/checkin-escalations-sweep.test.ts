import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient } from '../helpers/db'
import { fetchDueRoster } from '@/lib/checkin-escalations/roster'
import { sweepEngineerHalf } from '@/lib/checkin-escalations/sweep'

// Dedicated fixtures, distinct from test/helpers/db.ts's TEST_TENANT_ID /
// TEST_PROJECT_ID (the morning-flow suite's own fixtures) — this suite needs
// engineers in specific holiday/messaging_blocked states those fixtures don't
// model, and mixing the two risks exactly the cross-suite collision
// test/helpers/db.ts's own TEST-DB HYGIENE DEBT note already documents.

const TENANT_ID = '00000000-0000-4000-a000-0000000ce001'
const PROJECT_ID = '00000000-0000-4000-a000-0000000ce002'
const ENGINEER_NORMAL_ID_KEY = '+19995550301' // whatsapp_number, unique key for lookup
const ENGINEER_BLOCKED_KEY = '+19995550302'
const ENGINEER_HOLIDAY_KEY = '+19995550303'
const LOG_DATE = '2026-09-01' // a date no other suite writes, per db.ts's own convention

let normalId: string
let blockedId: string
let holidayId: string

async function ensureEngineer(whatsapp: string, name: string, messagingBlocked: boolean): Promise<string> {
  const db = testClient()
  const { data: existing } = await db.from('users').select('id').eq('whatsapp_number', whatsapp).maybeSingle<{ id: string }>()
  if (existing) return existing.id
  const { data, error } = await db
    .from('users')
    .insert({
      tenant_id: TENANT_ID,
      full_name: name,
      role: 'engineer',
      status: 'active',
      messaging_blocked: messagingBlocked,
      whatsapp_number: whatsapp,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`ensureEngineer(${name}) failed: ${error?.message ?? 'no row'}`)
  return data.id
}

beforeAll(async () => {
  const db = testClient()

  await db.from('tenants').upsert({ id: TENANT_ID, name: 'ZZ Checkin-Escalations Suite', slug: 'zz-checkin-escalations' }, { onConflict: 'id' })
  await db.from('projects').upsert({ id: PROJECT_ID, tenant_id: TENANT_ID, name: 'ZZ Checkin-Escalations Project' }, { onConflict: 'id' })

  normalId = await ensureEngineer(ENGINEER_NORMAL_ID_KEY, 'ZZ Normal Engineer', false)
  blockedId = await ensureEngineer(ENGINEER_BLOCKED_KEY, 'ZZ Blocked Engineer', true)
  holidayId = await ensureEngineer(ENGINEER_HOLIDAY_KEY, 'ZZ Holiday Engineer', false)

  for (const userId of [normalId, blockedId, holidayId]) {
    await db.from('project_members').upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: userId, role: 'engineer' }, { onConflict: 'project_id,user_id' })
  }

  // Holiday engineer reports a site-closed day — this is what filterDueRoster excludes on.
  await db.from('daily_logs').upsert(
    { tenant_id: TENANT_ID, project_id: PROJECT_ID, engineer_id: holidayId, log_date: LOG_DATE, is_holiday: true },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
})

afterAll(async () => {
  const db = testClient()
  await db.from('checkin_escalations').delete().eq('project_id', PROJECT_ID)
  await db.from('daily_logs').delete().eq('project_id', PROJECT_ID)
  await db.from('project_members').delete().eq('project_id', PROJECT_ID)
  await db.from('projects').delete().eq('id', PROJECT_ID)
  for (const userId of [normalId, blockedId, holidayId]) {
    if (userId) await db.from('users').delete().eq('id', userId)
  }
  await db.from('tenants').delete().eq('id', TENANT_ID)
})

describe('fetchDueRoster — against real data', () => {
  it('excludes the holiday engineer but includes the blocked engineer (Decision 1)', async () => {
    const db = testClient()
    const roster = await fetchDueRoster(db, PROJECT_ID, LOG_DATE)
    const ids = roster.map((r) => r.engineer_id)
    expect(ids).toContain(normalId)
    expect(ids).toContain(blockedId) // the corrected behaviour — stays in roster
    expect(ids).not.toContain(holidayId)
  })
})

describe('sweepEngineerHalf — guarded upsert against real data', () => {
  it('creates a row and advances it from awaited to escalated', async () => {
    const db = testClient()
    const now = '2026-09-01T05:00:00.000Z'
    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: normalId,
      logDate: LOG_DATE,
      half: 'morning',
      targetStatus: 'escalated',
      now,
    })
    const { data } = await db
      .from('checkin_escalations')
      .select('status, escalated_at, closed_at')
      .eq('project_id', PROJECT_ID)
      .eq('engineer_id', normalId)
      .eq('log_date', LOG_DATE)
      .eq('half', 'morning')
      .single()
    expect(data?.status).toBe('escalated')
    // Postgres returns timestamptz as "+00:00", not "Z" — same instant,
    // different string. Compare by value, not raw string equality.
    expect(new Date(data?.escalated_at as string).getTime()).toBe(new Date(now).getTime())
    expect(data?.closed_at).toBeNull()
  })

  it('double-invocation with the same target leaves the timestamp UNCHANGED (Correction 2) — not merely the status', async () => {
    const db = testClient()
    const firstCallNow = '2026-09-01T05:00:00.000Z'
    const secondCallNow = '2026-09-01T06:00:00.000Z' // later clock, same computed target

    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: blockedId,
      logDate: LOG_DATE,
      half: 'morning',
      targetStatus: 'escalated',
      now: firstCallNow,
    })
    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: blockedId,
      logDate: LOG_DATE,
      half: 'morning',
      targetStatus: 'escalated',
      now: secondCallNow,
    })

    const { data } = await db
      .from('checkin_escalations')
      .select('status, escalated_at')
      .eq('project_id', PROJECT_ID)
      .eq('engineer_id', blockedId)
      .eq('log_date', LOG_DATE)
      .eq('half', 'morning')
      .single()
    expect(data?.status).toBe('escalated')
    // The assertion that matters: NOT firstCallNow-or-secondCallNow loosely,
    // but exactly the FIRST call's timestamp — proving the second call's
    // guarded UPDATE matched zero rows rather than re-writing the same status
    // with a later timestamp. (Compared by value — see the note above on
    // Postgres's "+00:00" vs JS's "Z" suffix.)
    expect(new Date(data?.escalated_at as string).getTime()).toBe(new Date(firstCallNow).getTime())
  })

  it('a submitted row is never overwritten by a later not_submitted target — the one invariant named in the task', async () => {
    const db = testClient()
    const submittedAt = '2026-09-01T04:00:00.000Z'

    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: normalId,
      logDate: LOG_DATE,
      half: 'evening',
      targetStatus: 'submitted',
      now: submittedAt,
    })

    // Attempt the regression: a later, wrongly-computed target of not_submitted.
    await sweepEngineerHalf(db, {
      tenantId: TENANT_ID,
      projectId: PROJECT_ID,
      engineerId: normalId,
      logDate: LOG_DATE,
      half: 'evening',
      targetStatus: 'not_submitted',
      now: '2026-09-01T20:00:00.000Z',
    })

    const { data } = await db
      .from('checkin_escalations')
      .select('status, closed_at')
      .eq('project_id', PROJECT_ID)
      .eq('engineer_id', normalId)
      .eq('log_date', LOG_DATE)
      .eq('half', 'evening')
      .single()
    expect(data?.status).toBe('submitted')
    expect(new Date(data?.closed_at as string).getTime()).toBe(new Date(submittedAt).getTime())
  })
})
