import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { dispatchInboundTurn, FLOW_RACE_REPLY } from '@/lib/whatsapp/dispatch'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  seedSession,
  readSession,
  getDailyLog,
  testPhone,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  testEngineerId,
} from './helpers/db'
import { MORNING_QUESTIONS } from '@/lib/whatsapp/flows/morning'
import { EVENING_QUESTIONS } from '@/lib/whatsapp/flows/evening'

// Integration tests for dispatchInboundTurn (lib/whatsapp/dispatch.ts) — the
// webhook-wiring retry contract from migration 022's review package §10.
// Real test-db throughout via the injected supabaseClient param (client
// injection, same round); no mocks, no races.
//
// CONSTRUCTION, per the design settled across several turns:
//   - firstFlow forces attempt 1 to mismatch a directly-seeded session,
//     producing a genuine 'wrong_flow' from the REAL RPC. Handles BOTH
//     single-retry directions on its own.
//   - onBeforeRetry is used ONLY for the double-wrong_flow edge, where the
//     session must move a SECOND time between attempt 1 and attempt 2 — the
//     one case firstFlow structurally cannot construct alone (secondFlow is
//     always the flip of firstFlow, not independently settable).
// Tests reaching for both where one suffices would be a sign the scenario
// could be simpler — none below do.

const P_NOW = '2026-08-06T19:00:00+05:30' // 19:00 IST
const LOG_DATE = '2026-08-06'

beforeAll(async () => {
  await ensureMorningFixtures()
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterEach(async () => {
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('dispatchInboundTurn', () => {
  it('no session (idle) — defaults to morning, no override needed', async () => {
    const phone = testPhone('501')
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'hi',
      now: P_NOW,
      supabaseClient: testClient(),
    })
    expect(resolvedFlow).toBe('morning')
    // idle -> empty reply (MORNING_IDLE_REPLY), matching morning.ts's own contract.
    expect(reply).toBe('')
  })

  it('session mid-morning, no override — readCurrentFlow correctly picks morning', async () => {
    const phone = testPhone('502')
    await seedSession({
      phone,
      currentFlow: 'morning',
      currentStep: 2, // Q2 plan (030_morning_flow_attendance.sql renumbering — step 1 is now attendance)
      context: {},
      updatedAt: P_NOW,
    })
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'Pour slab on level 3',
      now: P_NOW,
      supabaseClient: testClient(),
    })
    expect(resolvedFlow).toBe('morning')
    expect(reply).toBe(MORNING_QUESTIONS[3])
    expect((await getDailyLog(LOG_DATE))?.morning_plan).toBe('Pour slab on level 3')
  })

  it('session mid-evening, no override — readCurrentFlow correctly picks evening', async () => {
    const phone = testPhone('503')
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 1,
      context: {},
      updatedAt: P_NOW,
    })
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'some work done',
      now: P_NOW,
      supabaseClient: testClient(),
    })
    expect(resolvedFlow).toBe('evening')
    expect(reply).toBe(EVENING_QUESTIONS[2])
    expect((await getDailyLog(LOG_DATE))?.evening_output).toBe('some work done')
  })

  it('retry direction A — firstFlow forces a genuine morning wrong_flow, evening resolves it (firstFlow alone, no onBeforeRetry)', async () => {
    const phone = testPhone('504')
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 1,
      context: {},
      updatedAt: P_NOW,
    })
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'some work done',
      now: P_NOW,
      supabaseClient: testClient(),
      firstFlow: 'morning', // deliberately mismatched — session is really evening
    })
    expect(resolvedFlow).toBe('evening')
    expect(reply).toBe(EVENING_QUESTIONS[2])
    // The wrong_flow attempt (morning) wrote nothing; the retry (evening) did.
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBeNull()
    expect(log?.evening_output).toBe('some work done')
    // Session state unaffected by the wrong_flow turn beyond the real advance.
    const session = await readSession(phone)
    expect(session?.current_flow).toBe('evening')
    expect(session?.current_step).toBe(2)
  })

  it('retry direction B — firstFlow forces a genuine evening wrong_flow, morning resolves it (firstFlow alone, no onBeforeRetry)', async () => {
    const phone = testPhone('505')
    await seedSession({
      phone,
      currentFlow: 'morning',
      currentStep: 2, // Q2 plan (030_morning_flow_attendance.sql renumbering — step 1 is now attendance)
      context: {},
      updatedAt: P_NOW,
    })
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'Pour slab on level 3',
      now: P_NOW,
      supabaseClient: testClient(),
      firstFlow: 'evening', // deliberately mismatched — session is really morning
    })
    expect(resolvedFlow).toBe('morning')
    expect(reply).toBe(MORNING_QUESTIONS[3])
    const log = await getDailyLog(LOG_DATE)
    expect(log?.evening_output).toBeNull()
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    const session = await readSession(phone)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(3)
  })

  it('double wrong_flow — the flow moves TWICE; onBeforeRetry is what this edge actually needs, firstFlow alone cannot construct it', async () => {
    const phone = testPhone('506')
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 1,
      context: {},
      updatedAt: P_NOW,
    })

    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'anything',
      now: P_NOW,
      supabaseClient: testClient(),
      firstFlow: 'morning', // attempt 1 (morning) sees evening -> wrong_flow
      onBeforeRetry: async () => {
        // Move it AGAIN so attempt 2 (evening, the flip of 'morning') also
        // mismatches. This is the one thing firstFlow cannot do alone:
        // secondFlow is always the flip of firstFlow, not independently
        // settable — the session has to genuinely move a second time.
        const { error } = await testClient()
          .from('whatsapp_sessions')
          .update({ current_flow: 'morning' })
          .eq('phone_number', phone)
        if (error) throw new Error(`onBeforeRetry update failed: ${error.message}`)
      },
    })

    expect(resolvedFlow).toBeNull()
    expect(reply).toBe(FLOW_RACE_REPLY)
    // Neither attempt resolved a column — no write from either wrong_flow call.
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })
})
