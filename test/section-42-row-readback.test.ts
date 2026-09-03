import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  applyMorningFlowTurn,
  applyEveningFlowTurn,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  testPhone,
  testClient,
  testEngineerId,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
} from './helpers/db'
import { SECTION_42_CORPUS } from './helpers/section-42-corpus'
import { assertPairwiseDistinct, stripEcho, type DistinctnessCase } from './helpers/write-boundary-distinctness'

// §42 (unmatched trade/equipment tokens are CAPTURED, not silently dropped)
// — POST-RPC ROW-READ-BACK LAYER, against test-db, via the REAL, rewritten
// `applyEveningFlowTurn` (lib/whatsapp/flows/evening.ts / test/helpers/
// db.ts — migration 035's evening.ts rewrite, 2026-09-02). Companion to
// test/unit/section-42-unmatched-capture.test.ts (the TS-parser layer);
// both share test/helpers/section-42-corpus.ts.
//
// STILL WRAPPED IN `it.fails`, stated plainly, not glossed over: 035 itself
// has not been applied anywhere (review package §14's rehearsal was rolled
// back — the lockstep apply is a separate event, per Aravind's own
// instruction, needing its own runbook, a live zero-sessions probe, and a
// human at the SQL Editor). The TS side built here is real, and the SAME
// tests below already passed for real during the rehearsal (review package
// §14.3) against a temporarily-applied 035 — that evidence is not
// re-proven on every CI run against a currently-unmatched RPC; it lives in
// the review package instead.

const LOG_DATE = '2026-03-16'
const P_NOW = '2026-03-16T09:00:00+05:30'

const manpowerCase = SECTION_42_CORPUS.find((c) => c.site === 'manpower')!
const idleHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'idle_hours')!
const equipmentHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'equipment_hours')!

async function driveToManpowerAnswer(phone: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyMorningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW }) // Q1 attendance -> step 2
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW }) // Q2 plan -> step 3
  await applyMorningFlowTurn({ phone, message: manpowerCase.input, startFlow: false, now: P_NOW }) // Q3 manpower -> step 4
}

// Drive start -> step1 (output, ungated) -> step2 (workers by trade) ->
// arrives at step3 (idle hours). Step 2's own content is irrelevant to the
// idle_hours/equipment_hours tests below, so a trivial valid answer is used.
async function driveToIdleHoursStep(phone: string): Promise<void> {
  await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyEveningFlowTurn({ phone, message: 'Slab work done', startFlow: false, now: P_NOW })
  await applyEveningFlowTurn({ phone, message: '5 mason', startFlow: false, now: P_NOW })
}

async function seedMorningEquipment(items: Array<{ type: string; count: number | null }>): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      engineer_id: testEngineerId(),
      log_date: LOG_DATE,
      morning_equipment: { items, none: false, raw_text: 'seeded for test' },
    },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
  if (error) throw new Error(`seedMorningEquipment failed: ${error.message}`)
}

// Drive to step4 (equipment_hours) — requires a non-empty morning_equipment
// seed BEFORE starting, or the auto-skip (BOT-22) routes step3 -> step5
// directly. idle_hours is answered with "all working" to move past step3
// without exercising its own tri-state (that's the describe block above).
async function driveToEquipmentHoursStep(phone: string, morningItems: Array<{ type: string; count: number | null }>): Promise<void> {
  await seedMorningEquipment(morningItems)
  await driveToIdleHoursStep(phone)
  const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
  expect(r.current_step).toBe(4) // sanity: must NOT have auto-skipped to 5
}

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

describe('§42 unmatched-token capture — post-RPC row read-back (manpower)', () => {
  it.fails('daily_logs.morning_manpower.by_trade preserves the unmatched trade with matched:false', async () => {
    const phone = testPhone('305')
    await driveToManpowerAnswer(phone)

    const row = await getDailyLog(LOG_DATE)
    expect(row).not.toBeNull()
    const byTrade = ((row!.morning_manpower as { by_trade?: unknown[] } | null)?.by_trade ?? []) as Array<{
      trade: string
      matched?: boolean
    }>
    const unmatched = byTrade.find((t) => t.trade === manpowerCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })
})

describe('§42 unmatched-token capture + tri-state — post-RPC row read-back (idle_hours)', () => {
  it.fails('an unmatched trade is preserved in evening_idle_hours.by_trade with matched:false', async () => {
    const phone = testPhone('317')
    await driveToIdleHoursStep(phone)
    const r = await applyEveningFlowTurn({ phone, message: idleHoursCase.input, startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')

    const row = await getDailyLog(LOG_DATE)
    const idleHours = row!.evening_idle_hours as { by_trade: Array<{ trade: string; matched: boolean }> }
    const unmatched = idleHours.by_trade.find((t) => t.trade === idleHoursCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })

  it.fails('WRITE-BOUNDARY DISTINCTNESS: real data / all_working / unknown produce pairwise-distinct stored shapes — the exact case §13.1 fixed', async () => {
    const cases: DistinctnessCase[] = []

    // Real data.
    {
      const phone = testPhone('318')
      await driveToIdleHoursStep(phone)
      await applyEveningFlowTurn({ phone, message: 'mason idle 2 hours', startFlow: false, now: P_NOW })
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'real data', shape: stripEcho(row!.evening_idle_hours as Record<string, unknown>) })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // Confident zero.
    {
      const phone = testPhone('319')
      await driveToIdleHoursStep(phone)
      await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'confident zero (all_working)', shape: stripEcho(row!.evening_idle_hours as Record<string, unknown>) })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // Genuinely unknown — "half day" must NOT collapse into confident zero.
    // Submitted twice: first reasks (genuinely unanswered, budget not
    // exhausted), second is accepted on budget exhaustion and actually
    // written — the REAL parser's own isIdleHoursAnswered still reads
    // false both times; the RPC's own reask-budget logic is what forces
    // the second turn to advance anyway.
    {
      const phone = testPhone('320')
      await driveToIdleHoursStep(phone)
      const r1 = await applyEveningFlowTurn({ phone, message: 'half day', startFlow: false, now: P_NOW })
      expect(r1.outcome).toBe('reask')
      const r2 = await applyEveningFlowTurn({ phone, message: 'half day', startFlow: false, now: P_NOW })
      expect(r2.outcome).toBe('advance') // budget exhausted, accepted anyway
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'genuinely unknown ("half day")', shape: stripEcho(row!.evening_idle_hours as Record<string, unknown>) })
    }

    assertPairwiseDistinct(cases)

    expect(cases[0].shape).toEqual({ by_trade: [{ trade: 'mason', idle_hours: 2, matched: true }], all_working: false, unknown: false })
    expect(cases[1].shape).toEqual({ by_trade: [], all_working: true, unknown: false })
    expect(cases[2].shape).toEqual({ by_trade: [], all_working: false, unknown: true })
  })
})

describe('§42 unmatched-token capture + implausible tri-state — post-RPC row read-back (equipment_hours)', () => {
  it.fails('an unmatched equipment type is preserved with matched:false', async () => {
    const phone = testPhone('328')
    await driveToEquipmentHoursStep(phone, [{ type: 'jcb', count: 2 }])
    const r = await applyEveningFlowTurn({ phone, message: equipmentHoursCase.input, startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    const row = await getDailyLog(LOG_DATE)
    const items = (row!.evening_equipment_utilisation as unknown as { items: Array<{ type: string; matched: boolean }> }).items
    const unmatched = items.find((i) => i.type === equipmentHoursCase.unmatchedToken)
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })

  it.fails('WRITE-BOUNDARY DISTINCTNESS: implausible true/false/null are pairwise distinct', async () => {
    const cases: DistinctnessCase[] = []

    // implausible:false — 6 hours <= 24 * count(2) = 48.
    {
      const phone = testPhone('329')
      await driveToEquipmentHoursStep(phone, [{ type: 'jcb', count: 2 }])
      await applyEveningFlowTurn({ phone, message: 'JCB 6 hours', startFlow: false, now: P_NOW })
      const row = await getDailyLog(LOG_DATE)
      const items = stripEcho((row!.evening_equipment_utilisation as unknown as { items: unknown[] }).items) as Array<Record<string, unknown>>
      cases.push({ label: 'implausible:false', shape: items.find((i) => i.type === 'jcb') })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // implausible:true — 50 hours > 24 * count(1) = 24.
    {
      const phone = testPhone('330')
      await driveToEquipmentHoursStep(phone, [{ type: 'jcb', count: 1 }])
      await applyEveningFlowTurn({ phone, message: 'JCB used 50 hours', startFlow: false, now: P_NOW })
      const row = await getDailyLog(LOG_DATE)
      const items = stripEcho((row!.evening_equipment_utilisation as unknown as { items: unknown[] }).items) as Array<Record<string, unknown>>
      cases.push({ label: 'implausible:true', shape: items.find((i) => i.type === 'jcb') })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // implausible:null — reported type never appears in morning_equipment at all.
    {
      const phone = testPhone('331')
      await driveToEquipmentHoursStep(phone, [{ type: 'mixer', count: 1 }])
      await applyEveningFlowTurn({ phone, message: 'JCB 6 hours', startFlow: false, now: P_NOW })
      const row = await getDailyLog(LOG_DATE)
      const items = stripEcho((row!.evening_equipment_utilisation as unknown as { items: unknown[] }).items) as Array<Record<string, unknown>>
      cases.push({ label: 'implausible:null (type not in morning_equipment)', shape: items.find((i) => i.type === 'jcb') })
    }

    assertPairwiseDistinct(cases)

    expect((cases[0].shape as { implausible: unknown }).implausible).toBe(false)
    expect((cases[1].shape as { implausible: unknown }).implausible).toBe(true)
    expect((cases[2].shape as { implausible: unknown }).implausible).toBeNull()
  })
})
