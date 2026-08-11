import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import type { WhatsAppSession } from '@/lib/whatsapp/session'
import { dispatchEveningFlow, EVENING_Q4_HEADCOUNT_KEY } from '@/lib/whatsapp/flows/evening'
import {
  applyEveningFlowTurn,
  completeMorningNoEquipment,
  reachStep4,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  testPhone,
} from './helpers/db'

// THE MIRROR TEST (2026-08-12, retiring the edit-triggered gate — CLAUDE.md
// §10). The productive/idle reconciliation exists in two hand-maintained
// copies: dispatchEveningFlow's inline TS logic (lib/whatsapp/flows/
// evening.ts) and apply_evening_flow_turn's PL/pgSQL body (migration 025).
// Both take the SAME parsed shape (parseProductivity's output, plus
// headcount) as input and are supposed to compute the SAME idle_count /
// productive_count / confidence. Nothing before this file enforced that.
//
// ONE fixture table drives BOTH halves below — a case added to only one
// half is impossible by construction, since there is only one array to add
// it to. This is the shape most of the existing T-024-25..32 tests in
// test/migration-024.test.ts already were, unfactored (each one separately
// hand-writes the same "seed morning, reach step 4, send headcount, send
// productivity reply, read daily_logs" sequence for a single case); this
// file is that pattern generalized into a loop over a shared table, plus
// the unit half those RPC-only tests never had.
//
// WHY THIS EXISTS NOW, NOT LATER — the gate this replaces was originally
// "the pure-mirror test is required before the next INTENTIONAL edit to
// either copy." Retired: the db push incident (CLAUDE.md §0) proved the SQL
// copy can drift with NO intentional edit to either copy at all — a
// migration ledger lagging reality was enough on its own. The fresh-branch
// auth_id replay bug (docs/reviews/supabase-fresh-branch-auth-id-bug.md) is
// a second, earlier instance of the same class: schema drift with no
// authored change causing it. A gate that only fires on an edit is
// structurally blind to drift that doesn't come from one. A continuously-
// running test has no such blind spot — it fails the moment either copy's
// ACTUAL behavior diverges from the fixture table, regardless of why.
//
// NEGATIVE CASES ARE NOT OPTIONAL HERE (Aravind, 2026-08-12). Every fixture
// below that must stay 'high' is exactly as load-bearing as the ones that
// must be 'low' — without them, a future "safety improvement" narrowing
// confidence further would pass this whole file while pushing every clear
// answer toward 'low', and section 3 of the DPR would quietly go blank.
// Suppression is not a free default.

const P_NOW = '2026-04-10T19:00:00+05:30' // matches migration-024.test.ts's own fixed instant
const LOG_DATE = '2026-04-10'
const FIXED_NOW = P_NOW

interface ReconciliationCase {
  name: string
  headcount: number
  reply: string
  expected: { idle_count: number | null; productive_count: number | null; confidence: 'high' | 'low' }
}

const CASES: ReconciliationCase[] = [
  {
    name: 'THE ORIGINAL INCIDENT — both anchored via an immediate BEFORE match, sum agrees with headcount',
    headcount: 18,
    reply: '15 productive, 3 idle waiting for material',
    expected: { idle_count: 3, productive_count: 15, confidence: 'high' },
  },
  {
    name: 'WEAK AFTER MATCH — "all" is not a YES_WORD, no BEFORE digit within bound for \'productive\', falls back to AFTER',
    headcount: 18,
    reply: 'all productive, 2 left early',
    expected: { idle_count: 16, productive_count: 2, confidence: 'low' },
  },
  {
    name: 'WEAK AFTER MATCH, second shape — a YES_WORD is present but a digit + \'idle\' still route through number-pairing, same AFTER guess',
    headcount: 18,
    reply: 'yes all productive, 2 machines idle',
    expected: { idle_count: 16, productive_count: 2, confidence: 'low' },
  },
  {
    name: 'BOUNDED BACKWARD SCAN — one intervening non-digit token ("men") on each anchor, both STRONG BEFORE matches, sum agrees',
    headcount: 18,
    reply: '3 men idle, 15 men productive',
    expected: { idle_count: 3, productive_count: 15, confidence: 'high' },
  },
  {
    name: 'NEGATIVE — immediate BEFORE match stays STRONG/high; must not regress toward low',
    headcount: 18,
    reply: 'ok 2 idle waiting for cement',
    expected: { idle_count: 2, productive_count: 16, confidence: 'high' },
  },
  {
    name: 'NEGATIVE — immediate BEFORE match on a full-headcount answer stays STRONG/high; must not regress toward low',
    headcount: 18,
    reply: 'yes all 18 productive',
    expected: { idle_count: 0, productive_count: 18, confidence: 'high' },
  },
]

function makeStep5Session(headcount: number): WhatsAppSession {
  return {
    id: '00000000-0000-4000-a000-000000000001',
    created_at: FIXED_NOW,
    tenant_id: '00000000-0000-4000-a000-00000000d013',
    user_id: '00000000-0000-4000-a000-00000000e014',
    phone_number: '+19995550299',
    current_flow: 'evening',
    current_step: 5,
    context: { [EVENING_Q4_HEADCOUNT_KEY]: headcount },
    pending_flows: [],
    expires_at: FIXED_NOW,
    updated_at: FIXED_NOW,
  }
}

describe('productive/idle reconciliation — TS mirror and RPC must agree (2026-08-12)', () => {
  describe('UNIT — dispatchEveningFlow (the TS "pure mirror")', () => {
    for (const c of CASES) {
      it(c.name, () => {
        const session = makeStep5Session(c.headcount)
        const result = dispatchEveningFlow(session, c.reply, { now: FIXED_NOW })
        const manpower = result.dailyLogWrite?.evening_productive_manpower
        expect(manpower?.idle_count).toBe(c.expected.idle_count)
        expect(manpower?.productive_count).toBe(c.expected.productive_count)
        expect(manpower?.confidence).toBe(c.expected.confidence)
      })
    }
  })

  describe('INTEGRATION — apply_evening_flow_turn (the RPC), against test-db', () => {
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

    CASES.forEach((c, i) => {
      it(c.name, async () => {
        const phone = testPhone(`5${i}0`)
        await completeMorningNoEquipment(phone, P_NOW)
        await reachStep4(phone, P_NOW)
        await applyEveningFlowTurn({ phone, message: String(c.headcount), startFlow: false, now: P_NOW })

        const r = await applyEveningFlowTurn({ phone, message: c.reply, startFlow: false, now: P_NOW })
        expect(r.outcome).toBe('advance')

        const log = await getDailyLog(LOG_DATE)
        const manpower = log?.evening_productive_manpower
        expect(manpower?.idle_count).toBe(c.expected.idle_count)
        expect(manpower?.productive_count).toBe(c.expected.productive_count)
        expect(manpower?.confidence).toBe(c.expected.confidence)
      })
    })
  })
})
