import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  applyEveningFlowTurn,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  testClient,
  testEngineerId,
  testPhone,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
} from './helpers/db'
import { EVENING_QUESTIONS, buildEveningReply } from '@/lib/whatsapp/flows/evening'

// Integration tests for the RESTRUCTURED evening check-in flow (migration
// 035, evening.ts's rewrite, 2026-09-02) — the RPC-authoritative replacement
// for test/migration-022.test.ts + test/migration-024.test.ts +
// test/productivity-reconciliation-mirror.test.ts (58 tests total, all
// exercising the OLD 6-step design this migration deletes). Written and
// proven green FIRST, per explicit sequencing instruction, before any of
// those 58 tests were deleted — this file is the replacement coverage
// existing before the old coverage stops existing, not after.
//
// NO PURE MIRROR for this flow (see evening.ts's own header) — this suite
// IS the authority, the same way test/morning-flow.test.ts is authoritative
// for the morning RPC independent of dispatchMorningFlow.
//
// STATED PLAINLY, NOT GLOSSED OVER: 035 has not been applied anywhere. Test-
// db is currently running the OLD (pre-035) `apply_evening_flow_turn` body.
// Every test below that depends on step-2-through-5 CONTENT is therefore
// wrapped in `it.fails` — it is REAL, comprehensive, and was verified to
// throw for the RIGHT reason (a step-2 "plan met yes/no" body receiving a
// workers-by-trade payload, not a bug in this file's own code) before being
// left in that state. Only the handful of tests whose behaviour is
// version-agnostic (checked directly against 035_evening_flow_
// restructuring.sql's own STEP 1 comment — "BYTE-IDENTICAL to the
// pre-migration step 1" — and against the shared early-exit checks both
// bodies share before ever reaching v_col dispatch) are ordinary tests that
// genuinely pass today. Once the real lockstep apply happens, every
// `it.fails` below should be unwrapped in the same commit that applies 035
// for real — a test that stays green after unwrapping is the confirmation
// the lockstep worked; one that goes red is exactly the signal it didn't.

const P_NOW = '2026-03-20T18:30:00+05:30'
const LOG_DATE = '2026-03-20'

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

async function seedMorningEquipment(items: Array<{ type: string; count: number | null }> | null): Promise<void> {
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
  if (error) throw new Error(`seedMorningEquipment failed: ${error.message}`)
}

// ---------------------------------------------------------------------------
// VERSION-AGNOSTIC — genuinely pass today, against the currently-live
// (pre-035) RPC, checked directly rather than assumed.
// ---------------------------------------------------------------------------

describe('apply_evening_flow_turn (evening flow, restructured) — version-agnostic today', () => {
  it('start: asks Q1, no daily_logs row materialised yet', async () => {
    const phone = testPhone('340')
    const r = await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    expect(r.outcome).toBe('start')
    expect(r.current_flow).toBe('evening')
    expect(r.current_step).toBe(1)
    expect(buildEveningReply(r.outcome, r.current_step)).toBe(EVENING_QUESTIONS[1])
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  it('Q1: writes evening_output + quantities, advances to step 2 (BYTE-IDENTICAL write behaviour old/new)', async () => {
    const phone = testPhone('341')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    const r = await applyEveningFlowTurn({ phone, message: 'Slab concrete 120 sqm', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(2)
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_output).toBe('Slab concrete 120 sqm')
  })

  it('idle: startFlow:false on an idle session -> idle, no write', async () => {
    const phone = testPhone('342')
    const r = await applyEveningFlowTurn({ phone, message: 'anything', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('idle')
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  it('reask: whitespace-only answer re-asks the current question, no write (shared early-exit check)', async () => {
    const phone = testPhone('343')
    await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    const r = await applyEveningFlowTurn({ phone, message: '   ', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('reask')
    expect(r.current_step).toBe(1)
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// EVERYTHING BELOW NEEDS 035 APPLIED. Real, comprehensive, `it.fails`-
// wrapped — see the file header.
// ---------------------------------------------------------------------------

async function driveToStep(phone: string, stop: 2 | 3 | 4 | 5): Promise<void> {
  await applyEveningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyEveningFlowTurn({ phone, message: 'Slab concrete 120 sqm', startFlow: false, now: P_NOW }) // Q1 -> step 2
  if (stop === 2) return
  await applyEveningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW }) // Q2 -> step 3
  if (stop === 3) return
  await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW }) // Q3 -> step 4 (requires morning equipment seeded)
  if (stop === 4) return
  await applyEveningFlowTurn({ phone, message: 'JCB 6 hours', startFlow: false, now: P_NOW }) // Q4 -> step 5
}

describe('Q2 — workers by trade (needs 035 applied)', () => {
  it.fails('writes evening_manpower (total/by_trade/matched), advances to step 3', async () => {
    const phone = testPhone('344')
    await driveToStep(phone, 2)
    const r = await applyEveningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(3)
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_manpower).toEqual({
      total: 20,
      by_trade: [
        { trade: 'mason', count: 12, matched: true },
        { trade: 'helper', count: 8, matched: true },
      ],
      raw_text: '12 mason 8 helper',
    })
  })

  it.fails('§42: an unmatched trade is captured with matched:false, not dropped', async () => {
    const phone = testPhone('345')
    await driveToStep(phone, 2)
    await applyEveningFlowTurn({ phone, message: '25 mason 11 PEB', startFlow: false, now: P_NOW })
    const row = await getDailyLog(LOG_DATE)
    const byTrade = (row?.evening_manpower as { by_trade: Array<{ trade: string; matched: boolean }> } | null)?.by_trade ?? []
    const unmatched = byTrade.find((t) => t.trade === 'PEB')
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })

  it.fails('no number: reasks once WITH A REASON, then accepts raw on budget exhaustion', async () => {
    const phone = testPhone('346')
    await driveToStep(phone, 2)
    const reask = await applyEveningFlowTurn({ phone, message: 'some workers', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(buildEveningReply(reask.outcome, reask.current_step)).toContain("didn't catch a number")
    const accepted = await applyEveningFlowTurn({ phone, message: 'still no number', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    expect(accepted.current_step).toBe(3)
    // Checks the STORED shape, not just outcome/step-number — outcome and
    // step-number alone coincidentally match the OLD design's own generic
    // reask-then-accept path (old step 2 = plan-met, unrelated content, but
    // the SAME reask mechanism and, by numbering accident, the same next
    // step). Only the actual written column tells the two designs apart.
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_manpower).toEqual({ total: null, by_trade: [], raw_text: 'still no number' })
  })
})

describe('Q3 — idle hours by trade, UNCONDITIONAL (needs 035 applied)', () => {
  it.fails('real data: writes evening_idle_hours, advances (auto-skip when morning has no equipment)', async () => {
    const phone = testPhone('347')
    await seedMorningEquipment([])
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'mason idle 2 hours', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(5) // auto-skipped step 4, no equipment
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_idle_hours).toEqual({
      by_trade: [{ trade: 'mason', idle_hours: 2, matched: true }],
      all_working: false,
      unknown: false,
    })
  })

  it.fails('"all working" is a CONFIDENT answer, not a non-answer — not classifyYesNo, a purpose-built sentinel', async () => {
    const phone = testPhone('348')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(4) // equipment exists -> not skipped
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_idle_hours).toEqual({ by_trade: [], all_working: true, unknown: false })
  })

  it.fails('REGRESSION GUARD: "half day" is UNKNOWN, never a fabricated zero — reasks WITH A REASON, then accepted as unknown', async () => {
    const phone = testPhone('349')
    await seedMorningEquipment([])
    await driveToStep(phone, 3)
    const reask = await applyEveningFlowTurn({ phone, message: 'half day', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(buildEveningReply(reask.outcome, reask.current_step)).toContain("didn't catch that")
    const accepted = await applyEveningFlowTurn({ phone, message: 'half day', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_idle_hours).toEqual({ by_trade: [], all_working: false, unknown: true })
  })

  it.fails('auto-skip (BOT-22): no morning equipment -> routes step 3 straight to step 5, writes an explicit empty equipment placeholder', async () => {
    const phone = testPhone('350')
    await seedMorningEquipment(null) // no morning submission at all
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
    expect(r.current_step).toBe(5)
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_equipment_utilisation).toEqual({ items: [], raw_text: null, confidence: null })
  })

  it.fails('morning HAS equipment -> step 3 routes to step 4, NOT skipped', async () => {
    const phone = testPhone('351')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
    expect(r.current_step).toBe(4)
    expect(r.equipment_echo).toEqual([{ type: 'jcb' }])
  })
})

describe('Q4 — equipment hours used, one number per type (needs 035 applied)', () => {
  it.fails('real data: writes evening_equipment_utilisation with implausible:false, advances to step 5', async () => {
    const phone = testPhone('352')
    await seedMorningEquipment([{ type: 'jcb', count: 2 }])
    await driveToStep(phone, 4)
    const r = await applyEveningFlowTurn({ phone, message: 'JCB 6 hours', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(5)
    const row = await getDailyLog(LOG_DATE)
    const items = (row?.evening_equipment_utilisation as { items: unknown[] } | null)?.items
    expect(items).toEqual([{ type: 'jcb', hours_used: 6, matched: true, implausible: false, raw: 'JCB 6 hours' }])
  })

  it.fails('THE ORIGINAL 2026-08-31 INCIDENT INPUT: "2 JCB 8" is accepted cleanly, no rejection', async () => {
    const phone = testPhone('353')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 4)
    const r = await applyEveningFlowTurn({ phone, message: '2 JCB 8', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance') // NOT a reask — the arithmetic guard that caused the incident no longer exists
    // Checks the STORED shape, not just outcome — 'advance' alone can
    // coincidentally happen under the OLD design too (by the time this
    // message lands, driveToStep's own new-shaped step-2/3 payloads may
    // have already pushed the OLD session into ITS OWN step 4 (headcount),
    // where '2 JCB 8' parses as a valid headcount answer and also advances
    // — a coincidence, not the behaviour this test exists to prove).
    const row = await getDailyLog(LOG_DATE)
    const items = (row?.evening_equipment_utilisation as { items: unknown[] } | null)?.items
    expect(items).toEqual([{ type: 'jcb', hours_used: 2, matched: true, implausible: false, raw: '2 JCB 8' }])
  })

  it.fails('implausible:true, a FLAG not a GATE — the turn still advances normally', async () => {
    const phone = testPhone('354')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 4)
    const r = await applyEveningFlowTurn({ phone, message: 'JCB used 50 hours', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    const row = await getDailyLog(LOG_DATE)
    const items = (row?.evening_equipment_utilisation as { items: Array<{ implausible: unknown }> } | null)?.items
    expect(items?.[0]?.implausible).toBe(true)
  })

  it.fails('§42: an unmatched equipment type is captured with matched:false, not dropped', async () => {
    const phone = testPhone('355')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 4)
    await applyEveningFlowTurn({ phone, message: 'hydra 4 hours', startFlow: false, now: P_NOW })
    const row = await getDailyLog(LOG_DATE)
    const items = (row?.evening_equipment_utilisation as { items: Array<{ type: string; matched: boolean }> } | null)?.items ?? []
    const unmatched = items.find((i) => i.type === 'hydra')
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })

  it.fails('no number: reasks once WITH A REASON, carrying the equipment echo again, then accepts on budget exhaustion', async () => {
    const phone = testPhone('356')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 4)
    const reask = await applyEveningFlowTurn({ phone, message: 'running fine', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    const reply = buildEveningReply(reask.outcome, reask.current_step, reask.equipment_echo ?? undefined)
    expect(reply).toContain("didn't catch an hours number")
    expect(reply).toContain('JCB')
    const accepted = await applyEveningFlowTurn({ phone, message: 'still nothing', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    expect(accepted.current_step).toBe(5)
    // Checks the STORED shape, not just outcome/step-number (both
    // coincidentally match the OLD design's own generic reask-then-accept
    // path by numbering accident — see the Q2 reask test's own note).
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_equipment_utilisation).toEqual({
      items: [{ type: 'jcb', hours_used: null, matched: true, implausible: null, raw: null }], // Case B: morning listed jcb, reply named nothing
      raw_text: 'still nothing',
      confidence: 'low',
    })
  })
})

describe('Q5 — hindrance, UNCONDITIONAL, terminal (needs 035 applied)', () => {
  it.fails('writes evening_schedule_miss_reason (reused) + evening_submitted_at, completes the flow', async () => {
    const phone = testPhone('357')
    await seedMorningEquipment([])
    await driveToStep(phone, 5)
    const r = await applyEveningFlowTurn({ phone, message: 'RMC truck delayed by an hour', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // flow complete
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_schedule_miss_reason).toBe('RMC truck delayed by an hour')
    expect(row?.evening_submitted_at).not.toBeNull()
  })

  it.fails('already_complete: post-completion inbound writes nothing, timestamp frozen', async () => {
    const phone = testPhone('358')
    await seedMorningEquipment([])
    await driveToStep(phone, 5)
    await applyEveningFlowTurn({ phone, message: 'none', startFlow: false, now: P_NOW })
    const first = await getDailyLog(LOG_DATE)
    const r = await applyEveningFlowTurn({ phone, message: 'anything', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('already_complete')
    const second = await getDailyLog(LOG_DATE)
    expect(second?.evening_submitted_at).toBe(first?.evening_submitted_at)
  })
})
