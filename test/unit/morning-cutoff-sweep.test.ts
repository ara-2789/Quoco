import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient } from '../helpers/db'
import { sweepStaleMorningSessions } from '@/lib/daily-logs/morning-cutoff-sweep'

// B3 -- the 15:00 IST morning cutoff sweep. Integration tests against the
// real sweep_stale_morning_sessions RPC (docs/reviews/morning-flow-
// migration-review-package.md §4; migration itself is
// supabase/migrations/033_sweep_stale_morning_sessions.sql). Applied to
// test-db (exfccwlrhoutkgrlikod) and ledgered 2026-08-25 -- all 13 tests in
// this file passed against that rehearsal, including the project-membership
// count block below.
//
// Dedicated fixtures, distinct from test/helpers/db.ts's TEST_TENANT_ID /
// TEST_PROJECT_ID -- this suite needs MULTIPLE engineers with independent
// daily_logs rows (each whatsapp_sessions row needs its own real user_id for
// the RPC's project_members lookup, and daily_logs is keyed on
// (project_id, engineer_id, log_date) -- sharing one engineer across
// scenarios would collide all of them onto the same row), which the shared
// single-engineer fixture (ensureMorningFixtures/testEngineerId) doesn't
// support. Same pattern as test/unit/checkin-escalations-sweep.test.ts.

const TENANT_ID = '00000000-0000-4000-a000-0000000cf001'
const PROJECT_ID = '00000000-0000-4000-a000-0000000cf002'
// A second project, for the project-membership-count tests below only --
// an engineer needs two real project_members rows to exercise the
// multiple_project_memberships skip path.
const PROJECT_ID_2 = '00000000-0000-4000-a000-0000000cf003'
const LOG_DATE = '2026-09-10' // a date no other suite writes, per db.ts's own convention

// Engineer's last real turn: 09:00 IST on LOG_DATE = 2026-09-10T03:30:00Z.
const SESSION_UPDATED_AT = '2026-09-10T03:30:00Z'
// Sweep call at/after 15:00 IST the SAME day = 2026-09-10T09:30:00Z (900 minutes).
const AT_CUTOFF = '2026-09-10T09:30:00Z'
const AFTER_CUTOFF = '2026-09-10T12:00:00Z'
// Sweep call BEFORE 15:00 IST the same day -- must no-op.
const BEFORE_CUTOFF = '2026-09-10T03:30:00Z' // 09:00 IST

const PHONE = {
  step1: '+19995550401',
  step2: '+19995550402',
  step3: '+19995550403',
  step4: '+19995550404',
  step5: '+19995550405',
  preCutoff: '+19995550406',
  evening: '+19995550407',
} as const

const engineerIds: Record<keyof typeof PHONE, string> = {} as never

async function ensureEngineer(whatsapp: string, name: string): Promise<string> {
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
      messaging_blocked: false,
      whatsapp_number: whatsapp,
      auth_id: null,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`ensureEngineer(${name}) failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedMorningSession(phone: string, userId: string, currentStep: number, updatedAt: string): Promise<void> {
  const db = testClient()
  const { error } = await db.from('whatsapp_sessions').insert({
    phone_number: phone,
    tenant_id: TENANT_ID,
    user_id: userId,
    current_flow: 'morning',
    current_step: currentStep,
    context: {},
    pending_flows: [],
    updated_at: updatedAt,
    expires_at: updatedAt,
  })
  if (error) throw new Error(`seedMorningSession(${phone}) failed: ${error.message}`)
}

async function getSession(phone: string) {
  const db = testClient()
  const { data, error } = await db.from('whatsapp_sessions').select('*').eq('phone_number', phone).maybeSingle()
  if (error) throw new Error(`getSession(${phone}) failed: ${error.message}`)
  return data as { current_flow: string | null; current_step: number; context: Record<string, unknown> } | null
}

async function getLog(engineerId: string) {
  const db = testClient()
  const { data, error } = await db
    .from('daily_logs')
    .select('*')
    .eq('project_id', PROJECT_ID)
    .eq('engineer_id', engineerId)
    .eq('log_date', LOG_DATE)
    .maybeSingle()
  if (error) throw new Error(`getLog(${engineerId}) failed: ${error.message}`)
  return data as {
    attendance: string | null
    attendance_defaulted: boolean | null
    attendance_raw: string | null
    is_holiday: boolean | null
    morning_plan: string | null
    morning_manpower: unknown | null
    morning_submitted_at: string | null
  } | null
}

async function runSweep(now: string) {
  const db = testClient()
  const { data, error } = await db.rpc('sweep_stale_morning_sessions', { p_now: now })
  if (error) throw new Error(`sweep_stale_morning_sessions failed: ${error.message}`)
  return data as {
    swept_count: number
    swept_phone_numbers: string[]
    reason?: string
    missing_daily_logs_rows: { phone_number: string; current_step: number; reason: string }[]
    skipped_count: number
    skipped_sessions: { phone_number: string; current_step: number; project_membership_count: number; reason: string }[]
  }
}

beforeAll(async () => {
  const db = testClient()

  await db.from('tenants').upsert({ id: TENANT_ID, name: 'ZZ Morning-Cutoff-Sweep Suite', slug: 'zz-morning-cutoff-sweep' }, { onConflict: 'id' })
  await db.from('projects').upsert({ id: PROJECT_ID, tenant_id: TENANT_ID, name: 'ZZ Morning-Cutoff-Sweep Project' }, { onConflict: 'id' })
  await db.from('projects').upsert({ id: PROJECT_ID_2, tenant_id: TENANT_ID, name: 'ZZ Morning-Cutoff-Sweep Project 2' }, { onConflict: 'id' })

  for (const key of Object.keys(PHONE) as (keyof typeof PHONE)[]) {
    engineerIds[key] = await ensureEngineer(PHONE[key], `ZZ ${key} Engineer`)
    await db.from('project_members').upsert(
      { tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: engineerIds[key], role: 'engineer' },
      { onConflict: 'project_id,user_id' },
    )
  }

  // Steps 2-4 need a pre-existing daily_logs row (attendance already written
  // by step 1's own real site) -- the sweep must preserve it untouched.
  for (const key of ['step2', 'step3', 'step4', 'preCutoff'] as const) {
    await db.from('daily_logs').upsert(
      {
        tenant_id: TENANT_ID,
        project_id: PROJECT_ID,
        engineer_id: engineerIds[key],
        log_date: LOG_DATE,
        attendance: 'present',
        attendance_defaulted: false,
        attendance_raw: 'yes',
      },
      { onConflict: 'project_id,engineer_id,log_date' },
    )
  }
  // step3 additionally has a plan (step 2's own site) and step4 additionally
  // has manpower (step 3's own site) -- prove the sweep never touches EITHER.
  await db.from('daily_logs').update({ morning_plan: 'Foundation work on block A' }).eq('project_id', PROJECT_ID).eq('engineer_id', engineerIds.step3).eq('log_date', LOG_DATE)
  await db.from('daily_logs').update({
    morning_plan: 'Foundation work on block A',
    morning_manpower: { total: 12, by_trade: [{ trade: 'mason', count: 12 }], raw_text: '12 mason' },
  }).eq('project_id', PROJECT_ID).eq('engineer_id', engineerIds.step4).eq('log_date', LOG_DATE)
})

afterAll(async () => {
  const db = testClient()
  await db.from('daily_logs').delete().eq('project_id', PROJECT_ID)
  await db.from('whatsapp_sessions').delete().like('phone_number', '+199955504%')
  await db.from('project_members').delete().eq('project_id', PROJECT_ID)
  // PROJECT_ID_2's own project_members rows are cleaned by the individual
  // membership-count tests below (self-contained, same pattern as the
  // wrapper/missing-row-guard tests above) -- only the project row itself
  // is torn down here.
  await db.from('project_members').delete().eq('project_id', PROJECT_ID_2)
  await db.from('projects').delete().eq('id', PROJECT_ID)
  await db.from('projects').delete().eq('id', PROJECT_ID_2)
  for (const key of Object.keys(engineerIds) as (keyof typeof PHONE)[]) {
    if (engineerIds[key]) await db.from('users').delete().eq('id', engineerIds[key])
  }
  await db.from('tenants').delete().eq('id', TENANT_ID)
})

describe('sweep_stale_morning_sessions — B3, the 15:00 IST morning cutoff sweep', () => {
  it('step 1 — attendance unanswered: no daily_logs row, session closed, morning_submitted NOT set', async () => {
    await seedMorningSession(PHONE.step1, engineerIds.step1, 1, SESSION_UPDATED_AT)

    const result = await runSweep(AT_CUTOFF)
    expect(result.swept_phone_numbers).toContain(PHONE.step1)

    const session = await getSession(PHONE.step1)
    expect(session?.current_flow).toBeNull()
    expect(session?.current_step).toBe(0)
    expect(session?.context.morning_submitted).toBeUndefined()

    const log = await getLog(engineerIds.step1)
    expect(log).toBeNull()
  })

  it('step 2 — attendance already present is preserved untouched, submission stamped', async () => {
    await seedMorningSession(PHONE.step2, engineerIds.step2, 2, SESSION_UPDATED_AT)

    const result = await runSweep(AT_CUTOFF)
    expect(result.swept_phone_numbers).toContain(PHONE.step2)

    const session = await getSession(PHONE.step2)
    expect(session?.current_flow).toBeNull()
    expect(session?.context.morning_submitted).toBe(true)

    const log = await getLog(engineerIds.step2)
    expect(log?.attendance).toBe('present')
    expect(log?.attendance_defaulted).toBe(false)
    expect(log?.attendance_raw).toBe('yes')
    expect(log?.morning_submitted_at).not.toBeNull()
  })

  it('step 3 — plan already captured is preserved untouched, submission stamped', async () => {
    await seedMorningSession(PHONE.step3, engineerIds.step3, 3, SESSION_UPDATED_AT)

    await runSweep(AT_CUTOFF)

    const log = await getLog(engineerIds.step3)
    expect(log?.attendance).toBe('present')
    expect(log?.morning_plan).toBe('Foundation work on block A')
    expect(log?.morning_submitted_at).not.toBeNull()
  })

  it('step 4 — workers already captured is preserved untouched, submission stamped', async () => {
    await seedMorningSession(PHONE.step4, engineerIds.step4, 4, SESSION_UPDATED_AT)

    await runSweep(AT_CUTOFF)

    const log = await getLog(engineerIds.step4)
    expect(log?.attendance).toBe('present')
    expect(log?.morning_plan).toBe('Foundation work on block A')
    expect(log?.morning_manpower).toEqual({ total: 12, by_trade: [{ trade: 'mason', count: 12 }], raw_text: '12 mason' })
    expect(log?.morning_submitted_at).not.toBeNull()
  })

  it('step 5 — holiday follow-up unanswered: INSERTs absent, defaulted=true, raw=null, is_holiday=false', async () => {
    // Confirm no row exists yet -- proves the sweep genuinely INSERTs, not UPDATEs.
    expect(await getLog(engineerIds.step5)).toBeNull()

    await seedMorningSession(PHONE.step5, engineerIds.step5, 5, SESSION_UPDATED_AT)

    const result = await runSweep(AT_CUTOFF)
    expect(result.swept_phone_numbers).toContain(PHONE.step5)

    const log = await getLog(engineerIds.step5)
    expect(log?.attendance).toBe('absent')
    expect(log?.attendance_defaulted).toBe(true)
    expect(log?.attendance_raw).toBeNull()
    expect(log?.is_holiday).toBe(false)
    expect(log?.morning_submitted_at).not.toBeNull()

    const session = await getSession(PHONE.step5)
    expect(session?.current_flow).toBeNull()
    expect(session?.context.morning_submitted).toBe(true)
  })

  it('idempotency — a second sweep after the first is a genuine no-op, does not re-stamp', async () => {
    const firstLog = await getLog(engineerIds.step5)
    const firstStampedAt = firstLog?.morning_submitted_at

    const secondResult = await runSweep(AFTER_CUTOFF)
    expect(secondResult.swept_phone_numbers).not.toContain(PHONE.step5)
    expect(secondResult.swept_count).toBe(0)

    const secondLog = await getLog(engineerIds.step5)
    expect(secondLog?.morning_submitted_at).toBe(firstStampedAt)
  })

  it('pre-15:00 IST — no-op, nothing touched', async () => {
    await seedMorningSession(PHONE.preCutoff, engineerIds.preCutoff, 2, SESSION_UPDATED_AT)

    const result = await runSweep(BEFORE_CUTOFF)
    expect(result.swept_count).toBe(0)
    expect(result.reason).toBe('before_cutoff')

    const session = await getSession(PHONE.preCutoff)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(2)

    const log = await getLog(engineerIds.preCutoff)
    expect(log?.morning_submitted_at).toBeNull()

    // Now confirm the SAME session is correctly swept once the cutoff passes.
    const afterResult = await runSweep(AT_CUTOFF)
    expect(afterResult.swept_phone_numbers).toContain(PHONE.preCutoff)
    const sessionAfter = await getSession(PHONE.preCutoff)
    expect(sessionAfter?.current_flow).toBeNull()
  })

  it('missing-row guard — a step 2-4 session with no daily_logs row surfaces it, still closes, does not fail the sweep', async () => {
    // Deliberately no pre-existing daily_logs row for this engineer, unlike
    // steps 2-4's own fixtures above.
    const phone = '+19995550409'
    const db = testClient()
    const { data: user, error: userErr } = await db
      .from('users')
      .insert({ tenant_id: TENANT_ID, full_name: 'ZZ missingRow Engineer', role: 'engineer', status: 'active', messaging_blocked: false, whatsapp_number: phone, auth_id: null })
      .select('id')
      .single<{ id: string }>()
    if (userErr || !user) throw new Error(`missing-row-test engineer insert failed: ${userErr?.message}`)
    await db.from('project_members').upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: user.id, role: 'engineer' }, { onConflict: 'project_id,user_id' })
    await seedMorningSession(phone, user.id, 2, SESSION_UPDATED_AT)

    const result = await runSweep(AFTER_CUTOFF)

    // Surfaced, not thrown -- the call itself succeeds.
    expect(result.swept_phone_numbers).toContain(phone)
    expect(result.missing_daily_logs_rows).toContainEqual({
      phone_number: phone,
      current_step: 2,
      reason: 'no_daily_logs_row_found',
    })

    // The session still closes -- one bad row does not leave it stuck.
    const session = await getSession(phone)
    expect(session?.current_flow).toBeNull()
    expect(session?.current_step).toBe(0)

    await db.from('project_members').delete().eq('user_id', user.id)
    await db.from('users').delete().eq('id', user.id)
  })

  it('the TypeScript wrapper (sweepStaleMorningSessions) calls the same RPC and maps its result', async () => {
    // A second step-1-shaped scenario, run through the actual TS wrapper
    // (not testClient().rpc(...) directly, unlike every test above) so the
    // wrapper layer itself -- not just the RPC -- is exercised at least once.
    const phone = '+19995550408'
    const db = testClient()
    const { data: user, error: userErr } = await db
      .from('users')
      .insert({ tenant_id: TENANT_ID, full_name: 'ZZ wrapperTest Engineer', role: 'engineer', status: 'active', messaging_blocked: false, whatsapp_number: phone, auth_id: null })
      .select('id')
      .single<{ id: string }>()
    if (userErr || !user) throw new Error(`wrapper-test engineer insert failed: ${userErr?.message}`)
    await db.from('project_members').upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: user.id, role: 'engineer' }, { onConflict: 'project_id,user_id' })
    await seedMorningSession(phone, user.id, 1, SESSION_UPDATED_AT)

    const result = await sweepStaleMorningSessions(db, AFTER_CUTOFF)
    expect(result.sweptPhoneNumbers).toContain(phone)
    expect(result.sweptCount).toBeGreaterThan(0)

    const session = await getSession(phone)
    expect(session?.current_flow).toBeNull()

    await db.from('project_members').delete().eq('user_id', user.id)
    await db.from('users').delete().eq('id', user.id)
  })

  it('evening sessions are never touched', async () => {
    const db = testClient()
    const { error } = await db.from('whatsapp_sessions').insert({
      phone_number: PHONE.evening,
      tenant_id: TENANT_ID,
      user_id: engineerIds.evening,
      current_flow: 'evening',
      current_step: 2,
      context: {},
      pending_flows: [],
      updated_at: SESSION_UPDATED_AT,
      expires_at: SESSION_UPDATED_AT,
    })
    if (error) throw new Error(`seed evening session failed: ${error.message}`)

    const result = await runSweep(AFTER_CUTOFF)
    expect(result.swept_phone_numbers).not.toContain(PHONE.evening)

    const session = await getSession(PHONE.evening)
    expect(session?.current_flow).toBe('evening')
    expect(session?.current_step).toBe(2)

    const log = await getLog(engineerIds.evening)
    expect(log).toBeNull()
  })

  describe('project-membership count — do not guess a project', () => {
    // Sharpest test at step 5 specifically: it's an INSERT, so a wrong
    // guess would fabricate an absence record against a project the
    // engineer may have nothing to do with -- the exact hazard this fix
    // exists to prevent.

    it('multi-project engineer is SKIPPED and counted, nothing written, session untouched', async () => {
      const phone = '+19995550411'
      const db = testClient()
      const { data: user, error: userErr } = await db
        .from('users')
        .insert({ tenant_id: TENANT_ID, full_name: 'ZZ multiProject Engineer', role: 'engineer', status: 'active', messaging_blocked: false, whatsapp_number: phone, auth_id: null })
        .select('id')
        .single<{ id: string }>()
      if (userErr || !user) throw new Error(`multi-project-test engineer insert failed: ${userErr?.message}`)
      await db.from('project_members').upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: user.id, role: 'engineer' }, { onConflict: 'project_id,user_id' })
      await db.from('project_members').upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID_2, user_id: user.id, role: 'engineer' }, { onConflict: 'project_id,user_id' })
      await seedMorningSession(phone, user.id, 5, SESSION_UPDATED_AT)

      const result = await runSweep(AFTER_CUTOFF)

      expect(result.swept_phone_numbers).not.toContain(phone)
      expect(result.skipped_sessions).toContainEqual({
        phone_number: phone,
        current_step: 5,
        project_membership_count: 2,
        reason: 'multiple_project_memberships',
      })

      // Nothing fabricated in EITHER project, and the session is left
      // completely alone -- not even a partial reset.
      const logA = await getLog(user.id)
      expect(logA).toBeNull()
      const { data: logB } = await db.from('daily_logs').select('*').eq('project_id', PROJECT_ID_2).eq('engineer_id', user.id).eq('log_date', LOG_DATE).maybeSingle()
      expect(logB).toBeNull()

      const session = await getSession(phone)
      expect(session?.current_flow).toBe('morning')
      expect(session?.current_step).toBe(5)

      await db.from('project_members').delete().eq('user_id', user.id)
      await db.from('users').delete().eq('id', user.id)
    })

    it('zero-membership engineer is SKIPPED and counted, nothing written, session untouched', async () => {
      const phone = '+19995550412'
      const db = testClient()
      const { data: user, error: userErr } = await db
        .from('users')
        .insert({ tenant_id: TENANT_ID, full_name: 'ZZ zeroMembership Engineer', role: 'engineer', status: 'active', messaging_blocked: false, whatsapp_number: phone, auth_id: null })
        .select('id')
        .single<{ id: string }>()
      if (userErr || !user) throw new Error(`zero-membership-test engineer insert failed: ${userErr?.message}`)
      // Deliberately NO project_members row at all.
      await seedMorningSession(phone, user.id, 5, SESSION_UPDATED_AT)

      const result = await runSweep(AFTER_CUTOFF)

      expect(result.swept_phone_numbers).not.toContain(phone)
      expect(result.skipped_sessions).toContainEqual({
        phone_number: phone,
        current_step: 5,
        project_membership_count: 0,
        reason: 'zero_project_memberships',
      })

      const log = await getLog(user.id)
      expect(log).toBeNull()

      const session = await getSession(phone)
      expect(session?.current_flow).toBe('morning')
      expect(session?.current_step).toBe(5)

      await db.from('users').delete().eq('id', user.id)
    })

    it('single-project engineer sweeps normally -- the count check does not regress the normal case', async () => {
      const phone = '+19995550413'
      const db = testClient()
      const { data: user, error: userErr } = await db
        .from('users')
        .insert({ tenant_id: TENANT_ID, full_name: 'ZZ singleProject Engineer', role: 'engineer', status: 'active', messaging_blocked: false, whatsapp_number: phone, auth_id: null })
        .select('id')
        .single<{ id: string }>()
      if (userErr || !user) throw new Error(`single-project-test engineer insert failed: ${userErr?.message}`)
      await db.from('project_members').upsert({ tenant_id: TENANT_ID, project_id: PROJECT_ID, user_id: user.id, role: 'engineer' }, { onConflict: 'project_id,user_id' })
      await seedMorningSession(phone, user.id, 5, SESSION_UPDATED_AT)

      const result = await runSweep(AFTER_CUTOFF)

      expect(result.swept_phone_numbers).toContain(phone)
      expect(result.skipped_sessions.some((s) => s.phone_number === phone)).toBe(false)

      const log = await getLog(user.id)
      expect(log?.attendance).toBe('absent')
      expect(log?.attendance_defaulted).toBe(true)

      const session = await getSession(phone)
      expect(session?.current_flow).toBeNull()

      await db.from('project_members').delete().eq('user_id', user.id)
      await db.from('users').delete().eq('id', user.id)
    })
  })
})
