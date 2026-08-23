import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import type { WhatsAppSession } from '@/lib/whatsapp/session'
import { dispatchMorningFlow } from '@/lib/whatsapp/flows/morning'
import {
  applyMorningFlowTurn,
  seedSession,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  testPhone,
  TEST_TENANT_ID,
  testEngineerId,
} from '../helpers/db'
import { MORNING_MIRROR_CASES } from '../helpers/morning-mirror-cases'

// THE MIRROR TEST for morning's renumbered flow (supabase/migrations/
// 030_morning_flow_attendance.sql), same shape as
// test/productivity-reconciliation-mirror.test.ts: apply_morning_flow_turn
// (SQL, via test-db) and dispatchMorningFlow (the pure TS mirror) are two
// hand-maintained copies of the SAME decision logic. Nothing before this
// file enforced that they agree on the NEW step meanings specifically —
// test/morning-flow.test.ts and test/unit/morning-dispatch.test.ts each
// assert against hand-written expected values independently, which is
// exactly the shape that let the two copies drift silently in the past
// (CLAUDE.md's "morning.ts:188 TS/SQL MIRROR DIVERGENCE" entry, closed by
// this same migration — see morning.ts's own header).
//
// ONE shared table (test/helpers/morning-mirror-cases.ts) drives both
// halves below, checked against the SAME `expected` value per case — a
// case added to only one half is impossible by construction.
//
// NOT YET RUNNABLE against test-db as committed: migration 030 has not
// been applied there. Ready to run the moment it is — this is the review
// package's own evidence artifact #4.

const P_NOW = '2026-05-01T09:00:00+05:30'

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

function makeMirrorSession(step: number, context: Record<string, unknown>): WhatsAppSession {
  return {
    id: '00000000-0000-4000-a000-000000000099',
    created_at: P_NOW,
    tenant_id: TEST_TENANT_ID,
    user_id: testEngineerId(),
    phone_number: '+19995550999',
    current_flow: 'morning',
    current_step: step,
    context,
    pending_flows: [],
    expires_at: P_NOW,
    updated_at: P_NOW,
  }
}

describe('morning flow mirror agreement (SQL vs. TS, one fixture, one expectation each)', () => {
  MORNING_MIRROR_CASES.forEach((c, i) => {
    describe(c.name, () => {
      it('SQL (apply_morning_flow_turn) matches the expected outcome', async () => {
        const phone = testPhone(`6${i}0`)
        await seedSession({
          phone,
          currentFlow: 'morning',
          currentStep: c.seedStep,
          context: c.seedContext,
          updatedAt: P_NOW,
        })
        const r = await applyMorningFlowTurn({ phone, message: c.message, startFlow: false, now: P_NOW })
        expect(r.outcome).toBe(c.expected.outcome)
        expect(r.current_step).toBe(c.expected.nextStep)
        expect(r.attendance).toBe(c.expected.attendance)
      })

      it('TS mirror (dispatchMorningFlow) matches the SAME expected outcome', () => {
        const session = makeMirrorSession(c.seedStep, c.seedContext)
        const d = dispatchMorningFlow(session, c.message, { now: P_NOW })
        const nextStep = d.sessionUpdate.current_step ?? c.seedStep
        const attendance =
          d.dailyLogWrite && 'attendance' in d.dailyLogWrite ? (d.dailyLogWrite.attendance ?? null) : null
        expect(d.outcome).toBe(c.expected.outcome)
        expect(nextStep).toBe(c.expected.nextStep)
        expect(attendance).toBe(c.expected.attendance)
      })
    })
  })
})
