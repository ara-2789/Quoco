import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  applyMorningFlowTurn,
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
import { parseIdleHoursByTrade, isIdleHoursAnswered } from '@/lib/whatsapp/flows/parsers/idle-hours'
import { parseEquipmentHoursByType, isEquipmentHoursByTypeAnswered } from '@/lib/whatsapp/flows/parsers/equipment-hours'
import { assertPairwiseDistinct, stripEcho, type DistinctnessCase } from './helpers/write-boundary-distinctness'

// §42 (unmatched trade/equipment tokens are CAPTURED, not silently dropped)
// — POST-RPC ROW-READ-BACK LAYER. Written and RUN FOR REAL against test-db
// WITH 035 APPLIED, during the test-db rehearsal (review package §14) —
// all 5 tests below passed. 035 was then ROLLED BACK (per the shared-
// database argument, review package §14's own reasoning: leaving it
// applied breaks every other branch's CI, matching migration 030's own
// PR #98 precedent). EVERY TEST BELOW IS THEREFORE WRAPPED IN `it.fails`
// NOW, not because it's wrong, but because it is CORRECTLY unable to pass
// against the currently-live (pre-035) RPC — the real, passing evidence
// from the rehearsal is captured in the review package §14, not re-proven
// here on every CI run until the real lockstep apply happens. Companion to
// test/unit/section-42-unmatched-capture.test.ts (the TS-parser layer);
// both share test/helpers/section-42-corpus.ts.
//
// MANPOWER (below) is driven through the real `applyMorningFlowTurn`
// wrapper (lib/whatsapp/flows/morning.ts), same as always.
//
// IDLE_HOURS AND EQUIPMENT_HOURS ARE DRIVEN DIRECTLY AGAINST THE RPC,
// NOT THROUGH evening.ts. Stated plainly, not glossed over: evening.ts's
// real production wrapper (`applyEveningFlowTurn`) still constructs the
// OLD 6-step `p_parse` shapes (review package §12.4) — it has not been
// rewritten for 035's new 5-step design, because that rewrite is a large,
// separate task deliberately out of this round's scope (the "companion
// TypeScript" the runbook's own S1 names, to ship in lockstep with the
// real apply). `applyEveningFlowTurnDirect` below is REHEARSAL-ONLY
// scaffolding that constructs the NEW shapes by hand (using the REAL
// parsers, not hand-typed JSON, for fidelity) so the new RPC branches can
// be exercised end-to-end before that rewrite exists. It is not a
// preview of production wiring and should not be copied into evening.ts
// as-is.

const LOG_DATE = '2026-03-16'
const P_NOW = '2026-03-16T09:00:00+05:30'

const manpowerCase = SECTION_42_CORPUS.find((c) => c.site === 'manpower')!
const idleHoursCase = SECTION_42_CORPUS.find((c) => c.site === 'idle_hours')!

async function driveToManpowerAnswer(phone: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyMorningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW }) // Q1 attendance -> step 2
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW }) // Q2 plan -> step 3
  await applyMorningFlowTurn({ phone, message: manpowerCase.input, startFlow: false, now: P_NOW }) // Q3 manpower -> step 4
}

interface EveningTurnResult {
  outcome: string
  current_step: number
}

async function applyEveningFlowTurnDirect(params: {
  phone: string
  message: string
  startFlow: boolean
  parse?: Record<string, unknown>
  parseOk?: Record<string, unknown>
}): Promise<EveningTurnResult> {
  const db = testClient()
  const { data, error } = await db.rpc('apply_evening_flow_turn', {
    p_phone_number: params.phone,
    p_tenant_id: TEST_TENANT_ID,
    p_user_id: testEngineerId(),
    p_project_id: TEST_PROJECT_ID,
    p_message: params.message,
    p_start_flow: params.startFlow,
    p_parse: params.parse ?? {},
    p_parse_ok: params.parseOk ?? {},
    p_now: P_NOW,
  })
  if (error) throw new Error(`apply_evening_flow_turn (direct, rehearsal-only) failed: ${error.message}`)
  return data as EveningTurnResult
}

// Drive start -> step1 (output, ungated) -> step2 (manpower) -> arrives at
// step3 (idle_hours). Manpower content is irrelevant to the idle_hours/
// equipment_hours tests below, so a trivial valid answer is used.
async function driveToIdleHoursStep(phone: string): Promise<void> {
  await applyEveningFlowTurnDirect({ phone, message: '', startFlow: true })
  await applyEveningFlowTurnDirect({ phone, message: 'Slab work done', startFlow: false, parse: { '1': {} } })
  await applyEveningFlowTurnDirect({
    phone,
    message: '5 mason',
    startFlow: false,
    parse: { '2': { planned_total: 5, by_trade: [{ trade: 'mason', planned_count: 5, matched: true }], raw_text: '5 mason' } },
    parseOk: { '2': true },
  })
}

async function seedMorningEquipment(items: Array<{ type: string; count: number | null }>): Promise<void> {
  const db = testClient()
  const { error } = await db.from('daily_logs').upsert(
    {
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      engineer_id: testEngineerId(),
      log_date: LOG_DATE,
      morning_equipment: { items, none: false, raw_text: 'seeded for rehearsal' },
    },
    { onConflict: 'project_id,engineer_id,log_date' },
  )
  if (error) throw new Error(`seedMorningEquipment failed: ${error.message}`)
}

// Drive to step4 (equipment_hours) — requires a non-empty morning_equipment
// seed BEFORE starting, or the auto-skip (BOT-22) routes step3 -> step5
// directly. idle_hours is answered with a trivial "all working" to move
// past step3 without exercising its own tri-state (that's the describe
// block above).
async function driveToEquipmentHoursStep(phone: string, morningItems: Array<{ type: string; count: number | null }>): Promise<void> {
  await seedMorningEquipment(morningItems)
  await driveToIdleHoursStep(phone)
  const allWorking = parseIdleHoursByTrade('all working')
  const r = await applyEveningFlowTurnDirect({
    phone,
    message: 'all working',
    startFlow: false,
    parse: { '3': allWorking },
    parseOk: { '3': isIdleHoursAnswered(allWorking) },
  })
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

describe('§42 unmatched-token capture — post-RPC row read-back (manpower, live test-db, 035 applied)', () => {
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

describe('§42 unmatched-token capture + tri-state — post-RPC row read-back (idle_hours, live test-db, 035 applied)', () => {
  it.fails('an unmatched trade is preserved in evening_idle_hours.by_trade with matched:false', async () => {
    const phone = testPhone('317')
    await driveToIdleHoursStep(phone)
    const parse = parseIdleHoursByTrade(idleHoursCase.input)
    const r = await applyEveningFlowTurnDirect({
      phone,
      message: idleHoursCase.input,
      startFlow: false,
      parse: { '3': parse },
      parseOk: { '3': isIdleHoursAnswered(parse) },
    })
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
      const parse = parseIdleHoursByTrade('mason idle 2 hours')
      await applyEveningFlowTurnDirect({
        phone,
        message: 'mason idle 2 hours',
        startFlow: false,
        parse: { '3': parse },
        parseOk: { '3': isIdleHoursAnswered(parse) },
      })
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'real data', shape: stripEcho(row!.evening_idle_hours as Record<string, unknown>) })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // Confident zero.
    {
      const phone = testPhone('319')
      await driveToIdleHoursStep(phone)
      const parse = parseIdleHoursByTrade('all working')
      await applyEveningFlowTurnDirect({
        phone,
        message: 'all working',
        startFlow: false,
        parse: { '3': parse },
        parseOk: { '3': isIdleHoursAnswered(parse) },
      })
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'confident zero (all_working)', shape: stripEcho(row!.evening_idle_hours as Record<string, unknown>) })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // Genuinely unknown — "half day" must NOT collapse into confident zero.
    // Submitted twice: first reasks (parse_ok false, budget not exhausted),
    // second is accepted on budget exhaustion and actually written.
    {
      const phone = testPhone('320')
      await driveToIdleHoursStep(phone)
      const parse = parseIdleHoursByTrade('half day')
      expect(isIdleHoursAnswered(parse)).toBe(false) // sanity: this must reask, not answer directly
      const r1 = await applyEveningFlowTurnDirect({
        phone,
        message: 'half day',
        startFlow: false,
        parse: { '3': parse },
        parseOk: { '3': false },
      })
      expect(r1.outcome).toBe('reask')
      const r2 = await applyEveningFlowTurnDirect({
        phone,
        message: 'half day',
        startFlow: false,
        parse: { '3': parse },
        parseOk: { '3': false },
      })
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

describe('§42 unmatched-token capture + implausible tri-state — post-RPC row read-back (equipment_hours, live test-db, 035 applied)', () => {
  it.fails('an unmatched equipment type is preserved with matched:false', async () => {
    const phone = testPhone('328')
    await driveToEquipmentHoursStep(phone, [{ type: 'jcb', count: 2 }])
    const parse = parseEquipmentHoursByType('hydra 4 hours')
    const r = await applyEveningFlowTurnDirect({
      phone,
      message: 'hydra 4 hours',
      startFlow: false,
      parse: { '4': parse },
      parseOk: { '4': isEquipmentHoursByTypeAnswered(parse) },
    })
    expect(r.outcome).toBe('advance')
    const row = await getDailyLog(LOG_DATE)
    const items = (row!.evening_equipment_utilisation as unknown as { items: Array<{ type: string; matched: boolean }> }).items
    const unmatched = items.find((i) => i.type === 'hydra')
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })

  it.fails('WRITE-BOUNDARY DISTINCTNESS: implausible true/false/null are pairwise distinct', async () => {
    const cases: DistinctnessCase[] = []

    // implausible:false — 6 hours <= 24 * count(2) = 48.
    {
      const phone = testPhone('329')
      await driveToEquipmentHoursStep(phone, [{ type: 'jcb', count: 2 }])
      const parse = parseEquipmentHoursByType('JCB 6 hours')
      await applyEveningFlowTurnDirect({
        phone,
        message: 'JCB 6 hours',
        startFlow: false,
        parse: { '4': parse },
        parseOk: { '4': isEquipmentHoursByTypeAnswered(parse) },
      })
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
      const parse = parseEquipmentHoursByType('JCB used 50 hours')
      await applyEveningFlowTurnDirect({
        phone,
        message: 'JCB used 50 hours',
        startFlow: false,
        parse: { '4': parse },
        parseOk: { '4': isEquipmentHoursByTypeAnswered(parse) },
      })
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
      const parse = parseEquipmentHoursByType('JCB 6 hours')
      await applyEveningFlowTurnDirect({
        phone,
        message: 'JCB 6 hours',
        startFlow: false,
        parse: { '4': parse },
        parseOk: { '4': isEquipmentHoursByTypeAnswered(parse) },
      })
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
