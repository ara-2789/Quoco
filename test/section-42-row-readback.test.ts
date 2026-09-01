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
import { SECTION_42_CORPUS } from './helpers/section-42-corpus'

// §42 (unmatched trade/equipment tokens are CAPTURED, not silently dropped)
// — POST-RPC ROW-READ-BACK LAYER, against the REAL, currently-live test-db
// RPC (apply_morning_flow_turn) — not a scaffold, not a hand-built payload.
// Companion to test/unit/section-42-unmatched-capture.test.ts (the TS-parser
// layer); both files share test/helpers/section-42-corpus.ts so the two
// layers cannot silently diverge on what "an unmatched token" means.
//
// ONLY THE MANPOWER SITE IS TESTABLE HERE TODAY, stated plainly rather than
// faked. Manpower is the one §42 site with BOTH a live parser
// (parseLabourCount) AND a live RPC branch (apply_morning_flow_turn's
// `v_col = 'manpower'`) to drive end-to-end through the real webhook path —
// and it is shared by morning Q2 and evening step 2 alike (035's own header:
// "SAME field names as morning's p_manpower"), so this is genuine coverage
// for both flows' eventual behaviour, not morning-only.
//
// idle_hours and equipment_hours are NOT covered by this file:
//   - idle_hours has no parser AND no RPC step at all yet — evening step 3
//     doesn't exist until 035 applies.
//   - equipment_hours has a parser (wrong shape) but the currently-live
//     apply_evening_flow_turn has no step that reads a `hours_used`/
//     type-joined payload — 024's MATCH TIERS design is what's live today.
//     Calling that live branch with a target-shape payload would prove
//     nothing about §42; it isn't a real post-RPC test of the behaviour in
//     question.
// Both close once the parsers in review package §10 exist and 035 is
// applied — see that section's own "once these three exist" paragraph. No
// schema or RPC change is required to run THIS file today: `apply_morning_
// flow_turn`'s `manpower` branch, and the `daily_logs.morning_manpower`
// column it writes, are both already live.
//
// EXPECTED-FAIL MECHANISM: same as the TS-parser layer — `it.fails` (Vitest
// 3.2.7, confirmed present). A companion "documents today's actual
// behaviour" test sits beside the target test, ordinary (not `.fails`).

const LOG_DATE = '2026-03-16'
const P_NOW = '2026-03-16T09:00:00+05:30'

const manpowerCase = SECTION_42_CORPUS.find((c) => c.site === 'manpower')!

async function driveToManpowerAnswer(phone: string): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyMorningFlowTurn({ phone, message: 'yes', startFlow: false, now: P_NOW }) // Q1 attendance -> step 2
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW }) // Q2 plan -> step 3
  await applyMorningFlowTurn({ phone, message: manpowerCase.input, startFlow: false, now: P_NOW }) // Q3 manpower -> step 4
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

describe('§42 unmatched-token capture — post-RPC row read-back (manpower, live test-db)', () => {
  it.fails('TARGET: daily_logs.morning_manpower.by_trade preserves the unmatched trade with matched:false', async () => {
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

  it('TODAY: the row stores the matched trade, drops the unmatched one, and carries no matched key at all', async () => {
    const phone = testPhone('305')
    await driveToManpowerAnswer(phone)

    const row = await getDailyLog(LOG_DATE)
    expect(row).not.toBeNull()
    const byTrade = ((row!.morning_manpower as { by_trade?: unknown[] } | null)?.by_trade ?? []) as Array<{
      trade: string
      count?: number
      matched?: boolean
    }>
    expect(byTrade.find((t) => t.trade === manpowerCase.unmatchedToken)).toBeUndefined()
    const matched = byTrade.find((t) => t.trade === manpowerCase.matchedToken)
    expect(matched).toEqual({ trade: manpowerCase.matchedToken, count: manpowerCase.matchedCount })
    expect(matched!.matched).toBeUndefined()
  })
})
