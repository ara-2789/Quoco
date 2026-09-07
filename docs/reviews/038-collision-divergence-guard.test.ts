import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  testPhone,
  TEST_TENANT_ID,
  testEngineerId,
  applyMorningFlowTurn,
  applyEveningFlowTurn,
} from '../../test/helpers/db'

// S-set (f), migration 038 external review round 2 (B1). NOT MOVED INTO
// test/ YET, DELIBERATELY -- apply_hindrance_flow_turn and the two
// collision branches this test exercises do not exist on test-db until
// migration 038 is applied there (still held, per the queue this session
// settled on: reviewer -> test-db rehearsal -> apply -> "1" wiring). A
// vitest file living in test/ that calls a function test-db doesn't have
// yet would fail CI on every future PR, the exact 035-lockstep hazard this
// project's own history already names. Move this file into test/ (adding
// it to the suite) as part of the SAME session that applies 038 to
// test-db, not before.
//
// WHAT THIS GUARDS AGAINST: apply_morning_flow_turn and apply_evening_
// flow_turn each got their OWN, independently-written hindrance-collision
// branch (038's own header: "mirrors ... exactly"). Two hand-maintained
// copies of the same rule is exactly the shape that already drifted once
// in this codebase (022's own CONTEXT DISCIPLINE section, §9: "one rule,
// four sites, two of them wrong until this round") -- a future edit to
// one collision branch that isn't mirrored into the other is a real,
// previously-observed failure mode, not a hypothetical one. This file
// seeds the SAME session shapes and drives them through BOTH RPCs,
// asserting the post-states agree in every way that matters (outcome
// shape, discard observability, context discipline) modulo only the
// flow-specific names (morning vs evening, q1-q5 vs e2-e6 reask keys).
//
// HELPER EXTRACTION -- NOT NOW, recorded as a rider (Aravind, external
// review round 2): a shared SQL or TS helper implementing "seed a
// collision scenario, drive it through {morning,evening}FlowTurn, extract
// the comparable fields" would remove real duplication below. Deliberately
// not built here -- the next migration that touches either of these two
// RPCs should build it then, when there is a second real caller to justify
// the abstraction, not speculatively now for a helper this file is the
// only user of.

const db = testClient()
const PHONE_A_MORNING = testPhone('710')
const PHONE_A_EVENING = testPhone('711')
const PHONE_B_MORNING = testPhone('712')
const PHONE_B_EVENING = testPhone('713')
const PHONE_C_MORNING = testPhone('714')
const PHONE_C_EVENING = testPhone('715')

async function seedHindranceSession(
  phone: string,
  opts: { updatedAt: string; context: Record<string, unknown> },
): Promise<void> {
  const { error } = await db.from('whatsapp_sessions').upsert(
    {
      phone_number: phone,
      tenant_id: TEST_TENANT_ID,
      user_id: testEngineerId(),
      current_flow: 'hindrance',
      current_step: 2,
      context: opts.context,
      pending_flows: [],
      expires_at: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
      updated_at: opts.updatedAt,
    },
    { onConflict: 'phone_number' },
  )
  if (error) throw new Error(`seedHindranceSession failed for ${phone}: ${error.message}`)
}

async function removeSessions(phones: string[]): Promise<void> {
  await db.from('whatsapp_sessions').delete().in('phone_number', phones)
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterEach(async () => {
  await cleanupTestSessions()
  await cleanupTestDailyLogs()
  await removeSessions([PHONE_A_MORNING, PHONE_A_EVENING, PHONE_B_MORNING, PHONE_B_EVENING, PHONE_C_MORNING, PHONE_C_EVENING])
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('038 collision-branch divergence guard -- morning and evening must agree', () => {
  it('A: cross-day-stale hindrance session -- BOT-07 wipe fires first, collision branch never reached, both flows agree', async () => {
    const yesterday = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString() // >24h ago, definitely a different IST calendar day
    await seedHindranceSession(PHONE_A_MORNING, {
      updatedAt: yesterday,
      context: { description: 'abandoned yesterday', q2_reask: 1 },
    })
    await seedHindranceSession(PHONE_A_EVENING, {
      updatedAt: yesterday,
      context: { description: 'abandoned yesterday', q2_reask: 1 },
    })

    const morning = await applyMorningFlowTurn({ phone: PHONE_A_MORNING, message: '', startFlow: true })
    const evening = await applyEveningFlowTurn({ phone: PHONE_A_EVENING, message: '', startFlow: true })

    // BOT-07's own cross-day reset (quoco_same_ist_day) fires BEFORE the
    // p_start_flow branching logic ever runs -- current_flow is already
    // NULL by the time the collision-branch check happens, so this is the
    // GENUINE fresh-start branch, not the collision branch. Both flows
    // must agree on this.
    expect(morning.outcome).toBe('start')
    expect(evening.outcome).toBe('start')
    expect(morning.current_flow).toBe('morning')
    expect(evening.current_flow).toBe('evening')
    expect(morning.hindrance_discarded).toBeNull()
    expect(evening.hindrance_discarded).toBeNull()
  })

  it('B: same-day-live hindrance session, engineer ALREADY submitted -- must agree on already_complete + discard observability', async () => {
    const now = new Date().toISOString()
    await seedHindranceSession(PHONE_B_MORNING, {
      updatedAt: now,
      context: { description: 'abandoned today', q2_reask: 1, morning_submitted: true },
    })
    await seedHindranceSession(PHONE_B_EVENING, {
      updatedAt: now,
      context: { description: 'abandoned today', q2_reask: 1, evening_submitted: true },
    })

    const morning = await applyMorningFlowTurn({ phone: PHONE_B_MORNING, message: '', startFlow: true })
    const evening = await applyEveningFlowTurn({ phone: PHONE_B_EVENING, message: '', startFlow: true })

    expect(morning.outcome).toBe('already_complete')
    expect(evening.outcome).toBe('already_complete')
    expect(morning.current_flow).toBeNull()
    expect(evening.current_flow).toBeNull()
    expect(morning.hindrance_discarded).toBe(true)
    expect(evening.hindrance_discarded).toBe(true)
    expect(morning.hindrance_had_description).toBe(true)
    expect(evening.hindrance_had_description).toBe(true)

    // The cross-flow marker must have survived the collision branch in
    // BOTH directions -- this is B1's own fix, re-asserted here as a
    // divergence guard, not just a one-off regression test.
    const sessionMorning = await db.from('whatsapp_sessions').select('context').eq('phone_number', PHONE_B_MORNING).single()
    const sessionEvening = await db.from('whatsapp_sessions').select('context').eq('phone_number', PHONE_B_EVENING).single()
    expect(sessionMorning.data?.context).toEqual({ morning_submitted: true })
    expect(sessionEvening.data?.context).toEqual({ evening_submitted: true })
  })

  it('C: same-day-live hindrance session, genuinely unsubmitted -- must agree on force-reset to start + discard observability', async () => {
    const now = new Date().toISOString()
    await seedHindranceSession(PHONE_C_MORNING, { updatedAt: now, context: { description: 'abandoned today', q2_reask: 1 } })
    await seedHindranceSession(PHONE_C_EVENING, { updatedAt: now, context: { description: 'abandoned today', q2_reask: 1 } })

    const morning = await applyMorningFlowTurn({ phone: PHONE_C_MORNING, message: '', startFlow: true })
    const evening = await applyEveningFlowTurn({ phone: PHONE_C_EVENING, message: '', startFlow: true })

    expect(morning.outcome).toBe('start')
    expect(evening.outcome).toBe('start')
    expect(morning.current_flow).toBe('morning')
    expect(evening.current_flow).toBe('evening')
    expect(morning.current_step).toBe(1)
    expect(evening.current_step).toBe(1)
    expect(morning.hindrance_discarded).toBe(true)
    expect(evening.hindrance_discarded).toBe(true)
    expect(morning.hindrance_had_description).toBe(true)
    expect(evening.hindrance_had_description).toBe(true)

    // Neither flow's own reask keys, nor hindrance's own leftover keys,
    // survive -- both empty, agreeing.
    const sessionMorning = await db.from('whatsapp_sessions').select('context').eq('phone_number', PHONE_C_MORNING).single()
    const sessionEvening = await db.from('whatsapp_sessions').select('context').eq('phone_number', PHONE_C_EVENING).single()
    expect(sessionMorning.data?.context).toEqual({})
    expect(sessionEvening.data?.context).toEqual({})
  })
})
