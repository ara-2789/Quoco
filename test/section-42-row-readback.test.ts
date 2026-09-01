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
//   - idle_hours has no RPC step at all yet — evening step 3 doesn't exist
//     until 035 applies (the parser itself now exists, per round 3).
//   - equipment_hours has a parser (parseEquipmentHoursByType, round 3) but
//     the currently-live apply_evening_flow_turn has no step that reads a
//     `hours_used`/type-joined payload — 024's MATCH TIERS design is what's
//     live today. Calling that live branch with a target-shape payload
//     would prove nothing about §42; it isn't a real post-RPC test of the
//     behaviour in question.
// Both close once 035 is applied — the test-db rehearsal (review package
// §9/§10, the step after this round). No schema or RPC change is required
// to run THIS file today: `apply_morning_flow_turn`'s `manpower` branch, and
// the `daily_logs.morning_manpower` column it writes, are both already live.
//
// STILL CORRECTLY RED, round 3 — TARGET stays `.fails`. Fixing
// parseLabourCount (round 3) does NOT flip this test, and testing it for
// real (not assuming) is exactly what surfaced why: the RPC hasn't changed,
// only the TS parser has. `matched` is a genuinely NEW behaviour this
// SPECIFIC test checks for, gated on 035's own reshape actually running.
//
// A SURPRISE FOUND BY RUNNING THIS FOR REAL, round 3 (recorded, not
// silently absorbed): the ORIGINAL "TODAY" companion test below assumed the
// unmatched trade would be ABSENT from the stored row, matching the
// pre-fix TS behaviour. That assumption broke the moment parseLabourCount
// started including unmatched entries in `by_trade` — the LIVE (pre-035)
// SQL reshape (030_morning_flow_attendance.sql:596) does an UNCONDITIONAL
// per-element map (`jsonb_build_object('trade', t->>'trade', 'count', ...)`
// for every element, filtering nothing), so it happily carries the now-
// present PEB entry through too — just without a `matched` key, since the
// old reshape never names one for ANY element. Confirmed live:
// `{"count": 11, "trade": "PEB"}` is already in the stored row today, pre-
// 035. The bug was entirely a TS-layer drop, not an SQL-layer filter — the
// companion test below now documents the CORRECT current three-tier state
// instead of the wrong assumption it replaced.

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

  it('TODAY (pre-035): the unmatched trade now ARRIVES in the row via the TS fix alone, but unlabeled — the old reshape carries every element through, it just never writes a matched key for any of them', async () => {
    const phone = testPhone('305')
    await driveToManpowerAnswer(phone)

    const row = await getDailyLog(LOG_DATE)
    expect(row).not.toBeNull()
    const byTrade = ((row!.morning_manpower as { by_trade?: unknown[] } | null)?.by_trade ?? []) as Array<{
      trade: string
      count?: number
      matched?: boolean
    }>
    const unmatched = byTrade.find((t) => t.trade === manpowerCase.unmatchedToken)
    expect(unmatched).toEqual({ trade: manpowerCase.unmatchedToken, count: 11 }) // present, no `matched` key
    expect(unmatched!.matched).toBeUndefined()
    const matched = byTrade.find((t) => t.trade === manpowerCase.matchedToken)
    expect(matched).toEqual({ trade: manpowerCase.matchedToken, count: manpowerCase.matchedCount })
    expect(matched!.matched).toBeUndefined()
  })
})
