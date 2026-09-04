import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  applyMorningFlowTurn,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  testPhone,
} from './helpers/db'
import { assertPairwiseDistinct, stripEcho, type DistinctnessCase } from './helpers/write-boundary-distinctness'

// §42's class, generalized (Aravind's instruction, round 3 review of the
// idle-hours tri-state finding, §13.1): "an upstream distinction lost at
// the write boundary" has now appeared TWICE inside artifacts that already
// passed review. This suite makes it a mechanical check instead of
// something a reader has to notice: for a field with multiple
// semantically-distinct outcomes, round-trip each through the REAL RPC and
// assert the stored shapes are pairwise distinct (echo fields like
// `raw_text` stripped first -- see write-boundary-distinctness.ts's own
// header for why that step is not optional).
//
// COVERAGE, STATED PLAINLY:
//   - `equipment` (morning Q3, `apply_morning_flow_turn`'s live
//     `v_col = 'equipment'` branch) — COVERED HERE, TODAY. Unchanged by
//     035 (that migration only edits the `manpower` branch), so this runs
//     against whatever is currently live, no rehearsal required.
//   - `idle_hours` (evening step 3) and `equipment_hours` (evening step 4)
//     — BUILT, but in `test/section-42-row-readback.test.ts`, not here,
//     per this file's own original plan ("added to test/section-42-row-
//     readback.test.ts alongside the manpower site already there — not
//     retrofitted onto this file"). Both use the SAME `assertPairwiseDistinct`/
//     `stripEcho` helpers this file's own equipment case does. Still
//     `it.fails`-wrapped there (035 is not applied anywhere) — see that
//     file's own header for the real, passing evidence from the test-db
//     rehearsal (review package §14.3).

const LOG_DATE = '2026-03-16'
const P_NOW = '2026-03-16T09:00:00+05:30'

async function driveToEquipmentStep(phone: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyMorningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW }) // Q1 -> step 2
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW }) // Q2 -> step 3
  await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW }) // Q3 -> step 4 (equipment)
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

describe('write-boundary distinctness — equipment (morning Q3, live today)', () => {
  it('real items / explicit-none / garbled-accepted all produce pairwise-distinct stored shapes', async () => {
    const cases: DistinctnessCase[] = []

    // Case A: real items.
    {
      const phone = testPhone('314')
      await driveToEquipmentStep(phone)
      // "JCB 2" not "JCB 1500" — Q4 now captures unit count, not a hire
      // rate (§33(a), 2026-08-25, built 2026-09-04).
      await applyMorningFlowTurn({ phone, message: 'JCB 2', startFlow: false, now: P_NOW }) // completes
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'real items', shape: stripEcho(row!.morning_equipment as Record<string, unknown>) })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // Case B: explicit "no equipment" sentinel.
    {
      const phone = testPhone('315')
      await driveToEquipmentStep(phone)
      await applyMorningFlowTurn({ phone, message: 'no equipment', startFlow: false, now: P_NOW }) // completes, none:true
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'explicit none', shape: stripEcho(row!.morning_equipment as Record<string, unknown>) })
      await cleanupTestDailyLogs()
      await cleanupTestSessions()
    }

    // Case C: garbled, accepted after the reask-once budget is exhausted.
    {
      const phone = testPhone('316')
      await driveToEquipmentStep(phone)
      await applyMorningFlowTurn({ phone, message: 'asdkjh qwerty', startFlow: false, now: P_NOW }) // reask
      await applyMorningFlowTurn({ phone, message: 'asdkjh qwerty', startFlow: false, now: P_NOW }) // accepted, completes
      const row = await getDailyLog(LOG_DATE)
      cases.push({ label: 'garbled-accepted', shape: stripEcho(row!.morning_equipment as Record<string, unknown>) })
    }

    // The check itself: none of the three may collide.
    assertPairwiseDistinct(cases)

    // Spelled out too, not just "didn't throw" -- confirms WHY they're
    // distinct, not just that assertPairwiseDistinct's own logic ran.
    expect(cases[0].shape).toEqual({
      items: [{ type: 'jcb', count: 2, owned_or_hired: null, daily_hire_cost: null }],
      none: false,
    })
    expect(cases[1].shape).toEqual({ items: [], none: true })
    expect(cases[2].shape).toEqual({ items: [], none: false })
  })
})

// Evening's own write-boundary distinctness cases (idle_hours' real-data/
// all_working/unknown tri-state; equipment_hours' implausible true/false/
// null tri-state) live in test/section-42-row-readback.test.ts, not here —
// see this file's own header COVERAGE note for why.
