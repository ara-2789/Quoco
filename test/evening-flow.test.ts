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
// UNWRAPPED 2026-09-03, after the real lockstep apply (035 live on prod
// ~09:05 IST same day, test-db re-applied same session): every `it.fails`
// below flipped to a genuine `it()`. Two needed a real fix first, not just
// unwrapping — both test-authoring bugs in THIS file, not RPC defects:
//   - 3 idle-hours (Q3) expected literals were missing a `raw_text` field
//     the RPC correctly writes.
//   - Both Q5 tests seeded `seedMorningEquipment([])` — an EMPTY items
//     array triggers the SAME auto-skip as no submission at all
//     (035_evening_flow_restructuring.sql:629-630), so Q3 auto-skipped
//     straight to step 5 and driveToStep's own step-4 message landed as the
//     Q5 answer instead. Fixed by seeding non-empty equipment, matching
//     what driveToStep already assumes.
// One assertion was DROPPED, not fixed: `equipment_echo` on the RPC's own
// return value is checked nowhere in this file any more — the RPC
// deliberately never populates it (declared NULL, never assigned,
// 035...sql:524) by design, since this helper (test/helpers/db.ts) calls
// the RPC directly and cannot exercise the real fix. That fix lives one
// layer up, in lib/whatsapp/flows/evening.ts's own direct daily_logs read —
// see its EquipmentEchoItem comment and test/dispatch.test.ts's "evening Q4
// equipment echo" suite, which is what actually proves it.

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
  it('writes evening_manpower (total/by_trade/matched), advances to step 3', async () => {
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

  it('§42: an unmatched trade is captured with matched:false, not dropped', async () => {
    const phone = testPhone('345')
    await driveToStep(phone, 2)
    await applyEveningFlowTurn({ phone, message: '25 mason 11 PEB', startFlow: false, now: P_NOW })
    const row = await getDailyLog(LOG_DATE)
    const byTrade = (row?.evening_manpower as { by_trade: Array<{ trade: string; matched: boolean }> } | null)?.by_trade ?? []
    const unmatched = byTrade.find((t) => t.trade === 'PEB')
    expect(unmatched).toBeDefined()
    expect(unmatched!.matched).toBe(false)
  })

  it('no number: reasks once WITH A REASON, then accepts raw on budget exhaustion', async () => {
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
  it('real data: writes evening_idle_hours, advances (auto-skip when morning has no equipment)', async () => {
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
      raw_text: 'mason idle 2 hours',
    })
  })

  it('"all working" is a CONFIDENT answer, not a non-answer — not classifyYesNo, a purpose-built sentinel', async () => {
    const phone = testPhone('348')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(4) // equipment exists -> not skipped
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_idle_hours).toEqual({ by_trade: [], all_working: true, unknown: false, raw_text: 'all working' })
  })

  it('REGRESSION GUARD: "half day" is UNKNOWN, never a fabricated zero — reasks WITH A REASON, then accepted as unknown', async () => {
    const phone = testPhone('349')
    await seedMorningEquipment([])
    await driveToStep(phone, 3)
    const reask = await applyEveningFlowTurn({ phone, message: 'half day', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    expect(buildEveningReply(reask.outcome, reask.current_step)).toContain("didn't catch that")
    const accepted = await applyEveningFlowTurn({ phone, message: 'half day', startFlow: false, now: P_NOW })
    expect(accepted.outcome).toBe('advance')
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_idle_hours).toEqual({ by_trade: [], all_working: false, unknown: true, raw_text: 'half day' })
  })

  it('auto-skip (BOT-22): no morning equipment -> routes step 3 straight to step 5, writes an explicit empty equipment placeholder', async () => {
    const phone = testPhone('350')
    await seedMorningEquipment(null) // no morning submission at all
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
    expect(r.current_step).toBe(5)
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_equipment_utilisation).toEqual({ items: [], raw_text: null, confidence: null })
  })

  it('morning HAS equipment -> step 3 routes to step 4, NOT skipped', async () => {
    const phone = testPhone('351')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 3)
    const r = await applyEveningFlowTurn({ phone, message: 'all working', startFlow: false, now: P_NOW })
    expect(r.current_step).toBe(4)
    // NOT asserting r.equipment_echo here — this helper calls the RPC
    // directly (test/helpers/db.ts), and the RPC deliberately never
    // populates equipment_echo (035_evening_flow_restructuring.sql:524,
    // never assigned). That's the caller's job now: see
    // lib/whatsapp/flows/evening.ts's own fetchMorningEquipmentEcho and
    // test/dispatch.test.ts's "evening Q4 equipment echo" suite, which
    // exercises the real production wrapper this RPC-only helper bypasses.
  })
})

describe('Q4 — equipment hours used, one number per type (needs 035 applied)', () => {
  it('real data: writes evening_equipment_utilisation with implausible:false, advances to step 5', async () => {
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

  it('THE ORIGINAL 2026-08-31 INCIDENT INPUT: "2 JCB 8" is accepted cleanly, no rejection', async () => {
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

  it('implausible:true, a FLAG not a GATE — the turn still advances normally', async () => {
    const phone = testPhone('354')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 4)
    const r = await applyEveningFlowTurn({ phone, message: 'JCB used 50 hours', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    const row = await getDailyLog(LOG_DATE)
    const items = (row?.evening_equipment_utilisation as { items: Array<{ implausible: unknown }> } | null)?.items
    expect(items?.[0]?.implausible).toBe(true)
  })

  it('§42: an unmatched equipment type is captured with matched:false, not dropped', async () => {
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

  it('no number: reasks once WITH A REASON, then accepts on budget exhaustion', async () => {
    const phone = testPhone('356')
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 4)
    const reask = await applyEveningFlowTurn({ phone, message: 'running fine', startFlow: false, now: P_NOW })
    expect(reask.outcome).toBe('reask')
    // NOT asserting the echo here (see the "morning HAS equipment" test's
    // own note just above) — 'JCB' would pass regardless of whether a real
    // echo works, since EVENING_REASK_MESSAGES[4] hardcodes "JCB 6 hours" as
    // its own illustrative example text. That false-positive is exactly
    // what test/dispatch.test.ts's equipment-echo suite was written to
    // catch, using 'concrete_mixer' specifically to rule it out.
    const reply = buildEveningReply(reask.outcome, reask.current_step)
    expect(reply).toContain("didn't catch an hours number")
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
  it('writes evening_schedule_miss_reason (reused) + evening_submitted_at, completes the flow', async () => {
    const phone = testPhone('357')
    // NOT seedMorningEquipment([]) — an empty items array triggers the SAME
    // auto-skip as no submission at all (035...sql:629-630: `IS NULL OR
    // jsonb_array_length(...) = 0`). With that seeding, Q3 auto-skips
    // straight to step 5, and driveToStep's own step-4 message ('JCB 6
    // hours') lands as THIS test's Q5 answer instead, completing the flow
    // before the real hindrance message is ever sent. Non-empty equipment
    // keeps step 4 genuinely reached, matching what driveToStep assumes.
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 5)
    const r = await applyEveningFlowTurn({ phone, message: 'RMC truck delayed by an hour', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(0) // flow complete
    const row = await getDailyLog(LOG_DATE)
    expect(row?.evening_schedule_miss_reason).toBe('RMC truck delayed by an hour')
    expect(row?.evening_submitted_at).not.toBeNull()
  })

  it('already_complete: post-completion inbound writes nothing, timestamp frozen', async () => {
    const phone = testPhone('358')
    // Same seeding fix as the test above — see its own note.
    await seedMorningEquipment([{ type: 'jcb', count: 1 }])
    await driveToStep(phone, 5)
    await applyEveningFlowTurn({ phone, message: 'none', startFlow: false, now: P_NOW })
    const first = await getDailyLog(LOG_DATE)
    const r = await applyEveningFlowTurn({ phone, message: 'anything', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('already_complete')
    const second = await getDailyLog(LOG_DATE)
    expect(second?.evening_submitted_at).toBe(first?.evening_submitted_at)
  })
})
