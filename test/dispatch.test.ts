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

// 2026-09-03 production incident, fixed same day: 035's RPC declares
// v_equipment_echo := NULL and never assigns it (deliberate — see
// evening.ts's own EquipmentEchoItem comment). evening.ts shipped in the
// same PR still assumed the RPC would populate it, so every live Q4 prompt
// went out with an empty equipment list from ~09:05 IST until this fix
// (applyEveningFlowTurn now reads morning_equipment directly). These tests
// go through dispatchInboundTurn — the REAL webhook path — specifically
// because test/evening-flow.test.ts's own applyEveningFlowTurn helper calls
// the RPC directly (test/helpers/db.ts) and so cannot exercise this fix at
// all; only the production wrapper (lib/whatsapp/flows/evening.ts) can.
// 'concrete_mixer' deliberately used, not 'jcb' — EVENING_REASK_MESSAGES[4]
// hardcodes "JCB 6 hours" as its own illustrative example text, so a test
// using jcb cannot tell a genuine echo apart from that static copy (the
// exact false-positive this incident's own diagnosis caught in
// test/evening-flow.test.ts's Q4 reask test).
async function seedMorningEquipmentForDispatch(
  items: Array<{ type: string; count: number | null }> | null,
): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      engineer_id: testEngineerId(),
      log_date: LOG_DATE,
      morning_equipment: items === null ? null : { items, none: items.length === 0, raw_text: 'seeded' },
    },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
  if (error) throw new Error(`seedMorningEquipmentForDispatch failed: ${error.message}`)
}

describe('evening Q4 equipment echo — real morning_equipment, not the RPC (2026-09-03 fix)', () => {
  it('engineer WITH morning equipment reaches Q4 and sees the REAL list, not an empty one or the static example', async () => {
    const phone = testPhone('507')
    await seedMorningEquipmentForDispatch([{ type: 'concrete_mixer', count: 1 }])
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 3, // Q3 — idle hours
      context: {},
      updatedAt: P_NOW,
    })
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'all working',
      now: P_NOW,
      supabaseClient: testClient(),
    })
    expect(resolvedFlow).toBe('evening')
    // The REAL echo: exact match on the prefix, not just toContain, so a
    // future change that echoes the wrong item (but happens to still
    // mention 'Concrete Mixer' somewhere) can't slip past this check. 'JCB'
    // still legitimately appears later in this same reply — it's the
    // prompt's own static usage example ("e.g. \"JCB 6 hours...\""),
    // unrelated to the echo this test verifies.
    expect(reply.startsWith('Equipment you listed this morning: Concrete Mixer.')).toBe(true)
  })

  it('engineer with NO morning equipment auto-skips Q4 straight to Q5 — no echo needed, no read triggered', async () => {
    const phone = testPhone('508')
    await seedMorningEquipmentForDispatch(null) // no morning submission at all
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 3,
      context: {},
      updatedAt: P_NOW,
    })
    const { reply, resolvedFlow } = await dispatchInboundTurn({
      phoneNumber: phone,
      tenantId: TEST_TENANT_ID,
      userId: testEngineerId(),
      projectId: TEST_PROJECT_ID,
      message: 'all working',
      now: P_NOW,
      supabaseClient: testClient(),
    })
    expect(resolvedFlow).toBe('evening')
    expect(reply).toBe(EVENING_QUESTIONS[5])
  })
})
