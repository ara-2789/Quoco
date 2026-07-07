import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  applyMorningFlowTurn,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  getDailyLog,
  readSession,
  testPhone,
} from './helpers/db'
import {
  MORNING_QUESTIONS,
  MORNING_COMPLETE_REPLY,
  MORNING_ALREADY_COMPLETE_REPLY,
  buildMorningReply,
} from '@/lib/whatsapp/flows/morning'

// Integration tests for the morning check-in flow, Pass 1 (migration 014's
// apply_morning_flow_turn). Run ONLY against the test-db branch — the allowlist
// globalSetup guard hard-aborts otherwise. All rows use the fake +1 999 555-0XXX
// phone space and the fixed test tenant/engineer/project fixtures; afterEach
// sweeps sessions AND daily_logs so the branch never accumulates test rows.
//
// This is the AUTHORITATIVE proof of the Pass-1 flow: it exercises the real RPC
// (decision + writes under one lock), unlike the pure dispatchMorningFlow mirror.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Fixed IST anchors so log_date and the same-IST-day decision are independent of
// the wall clock / CI timezone.
const P_NOW = '2026-03-16T09:00:00+05:30' // 09:00 IST, 16 Mar
const P_LATER_SAME_DAY = '2026-03-16T15:00:00+05:30' // 15:00 IST, same IST day
const LOG_DATE = '2026-03-16' // (P_NOW AT TIME ZONE 'Asia/Kolkata')::date

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

describe('apply_morning_flow_turn (morning flow, Pass 1)', () => {
  // 1. start — the env-gated trigger asks Q1 and writes NO daily_log yet.
  it('start: asks Q1, no daily_logs row materialised yet', async () => {
    const phone = testPhone('301')

    const r = await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    expect(r.outcome).toBe('start')
    expect(r.current_flow).toBe('morning')
    expect(r.current_step).toBe(1)
    expect(r.log_date).toBe(LOG_DATE)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[1])

    // No answer yet -> no row (an empty row would falsely read as "submitted").
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  // 2. Q1 answer -> morning_plan written, flow advances to Q4.
  it('Q1: writes morning_plan and advances to Q4', async () => {
    const phone = testPhone('302')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })

    const r = await applyMorningFlowTurn({
      phone,
      message: 'Pour slab on level 3',
      startFlow: false,
      now: P_NOW,
    })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBe('morning')
    expect(r.current_step).toBe(4)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[4])

    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    expect(log?.morning_execution_plan).toBeNull()
    expect(log?.morning_submitted_at).toBeNull()
  })

  // 3. Q4 answer -> completion: both fields + submitted_at, session reset.
  it('Q4: completes — both fields + submitted_at, session current_flow reset', async () => {
    const phone = testPhone('303')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW })

    const r = await applyMorningFlowTurn({
      phone,
      message: 'Crew A first, then Crew B',
      startFlow: false,
      now: P_NOW,
    })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBeNull() // flow cleared on completion
    expect(r.current_step).toBe(0)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_COMPLETE_REPLY)

    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    expect(log?.morning_execution_plan).toBe('Crew A first, then Crew B')
    expect(log?.morning_submitted_at).not.toBeNull()

    const session = await readSession(phone)
    expect(session?.current_flow).toBeNull()
    expect(session?.context).toEqual({ morning_submitted: true })
  })

  // 4. already_complete — messaging after completion, no new write.
  it('already_complete: post-completion inbound, no daily_logs write', async () => {
    const phone = testPhone('304')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Plan text', startFlow: false, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Execution text', startFlow: false, now: P_NOW })

    const submittedAtBefore = (await getDailyLog(LOG_DATE))?.morning_submitted_at

    const r = await applyMorningFlowTurn({
      phone,
      message: 'anything else?',
      startFlow: false,
      now: P_LATER_SAME_DAY,
    })
    expect(r.outcome).toBe('already_complete')
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_ALREADY_COMPLETE_REPLY)

    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Plan text')
    expect(log?.morning_execution_plan).toBe('Execution text')
    // Unchanged: no new write, submitted_at not re-stamped.
    expect(log?.morning_submitted_at).toBe(submittedAtBefore)
  })

  // 5. same-IST-day resume — interrupted after Q1, resumes at Q4 (not Q1).
  it('resume: same IST day resumes at Q4, does not restart at Q1', async () => {
    const phone = testPhone('305')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Morning plan A', startFlow: false, now: P_NOW })

    // Session is now at step 4 (awaiting Q4). A later inbound the SAME IST day
    // must be treated as the Q4 answer — NOT a fresh Q1 that overwrites the plan.
    const r = await applyMorningFlowTurn({
      phone,
      message: 'Execution plan B',
      startFlow: false,
      now: P_LATER_SAME_DAY,
    })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBeNull() // Q4 answered -> completed

    const log = await getDailyLog(LOG_DATE)
    // morning_plan untouched (proves it resumed at Q4, not restarted at Q1)...
    expect(log?.morning_plan).toBe('Morning plan A')
    // ...and the later message landed in the execution column.
    expect(log?.morning_execution_plan).toBe('Execution plan B')
    expect(log?.morning_submitted_at).not.toBeNull()
  })

  // 6. empty re-ask — whitespace answer re-asks, no write, step unchanged.
  it('reask: whitespace answer re-asks the current question, no write', async () => {
    const phone = testPhone('306')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    await applyMorningFlowTurn({ phone, message: 'Morning plan', startFlow: false, now: P_NOW })

    const r = await applyMorningFlowTurn({ phone, message: '    ', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('reask')
    expect(r.current_flow).toBe('morning')
    expect(r.current_step).toBe(4) // unchanged
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[4])

    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Morning plan')
    expect(log?.morning_execution_plan).toBeNull() // no write
  })

  // 7. concurrency (Test-B-analog) — two near-simultaneous turns serialise on
  //    the row lock; neither is lost, neither double-writes the same column.
  it('concurrency: two simultaneous turns are serialised by the row lock', async () => {
    const phone = testPhone('307')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })

    // Caller 1 holds the lock across an 800ms injected sleep; caller 2 fires a
    // beat later so caller 1 reaches the acquire first and caller 2 must block.
    const c1 = applyMorningFlowTurn({
      phone,
      message: 'Plan from caller 1',
      startFlow: false,
      now: P_NOW,
      testSleepMs: 800,
    })
    await sleep(100)
    const c2 = applyMorningFlowTurn({
      phone,
      message: 'Execution from caller 2',
      startFlow: false,
      now: P_NOW,
      testSleepMs: 0,
    })

    await Promise.all([c1, c2])

    // Serialised outcome: caller 1's Q1 answer landed in morning_plan, then
    // caller 2 (blocked until caller 1 committed) saw step 4 and answered Q4.
    // If the lock had NOT held, both would have read step 1 and both written
    // morning_plan — a lost update. This asserts that did not happen.
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Plan from caller 1')
    expect(log?.morning_execution_plan).toBe('Execution from caller 2')
    expect(log?.morning_submitted_at).not.toBeNull()

    const session = await readSession(phone)
    expect(session?.current_flow).toBeNull() // completed
  })

  // 8. RPC-level startFlow:false on an idle session — the webhook's env gate
  //    resolves to startFlow=false when ENABLE_TEST_FLOW_TRIGGER is unset; this
  //    confirms the RPC then does NOTHING (no start, no write). The env-var
  //    mapping itself is covered separately in test/unit/test-trigger.test.ts.
  it('startFlow:false on idle session -> idle, no flow started, no write', async () => {
    const phone = testPhone('308')

    const r = await applyMorningFlowTurn({
      phone,
      message: 'hi bot',
      startFlow: false,
      now: P_NOW,
    })
    expect(r.outcome).toBe('idle')
    expect(r.current_flow).toBeNull()
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })
})
