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

// Integration tests for the morning check-in flow (migrations 014 + 018's
// apply_morning_flow_turn). Run ONLY against the test-db branch — the allowlist
// globalSetup guard hard-aborts otherwise. All rows use the fake +1 999 555-0XXX
// phone space and the fixed test tenant/engineer/project fixtures; afterEach
// sweeps sessions AND daily_logs so the branch never accumulates test rows.
//
// This is the AUTHORITATIVE proof of the flow: it exercises the real RPC
// (decision + writes under one lock), unlike the pure dispatchMorningFlow mirror.
// The four-step core is Q1 (plan) -> Q2 (labour) -> Q3 (equipment) -> Q4 (exec).

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

const P_NOW = '2026-03-16T09:00:00+05:30' // 09:00 IST, 16 Mar
const P_LATER_SAME_DAY = '2026-03-16T15:00:00+05:30' // 15:00 IST, same IST day
const P_NEXT_DAY = '2026-03-17T09:00:00+05:30' // 09:00 IST, 17 Mar (next IST day)
const LOG_DATE = '2026-03-16'

// Drive Q1->Q2->Q3->Q4 up to (but not including) the given step, returning after
// the last answer submitted. Used to position a session for a step-specific case.
async function driveTo(phone: string, stop: 2 | 3 | 4): Promise<void> {
  await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
  await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW })
  if (stop === 2) return
  await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW })
  if (stop === 3) return
  await applyMorningFlowTurn({ phone, message: 'JCB 1500', startFlow: false, now: P_NOW })
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

describe('apply_morning_flow_turn (morning flow, 4-step core)', () => {
  // 1. start — asks Q1, writes NO daily_log yet.
  it('start: asks Q1, no daily_logs row materialised yet', async () => {
    const phone = testPhone('301')
    const r = await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    expect(r.outcome).toBe('start')
    expect(r.current_flow).toBe('morning')
    expect(r.current_step).toBe(1)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[1])
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })

  // 2. Q1 -> morning_plan written, advances to Q2 (step 2).
  it('Q1: writes morning_plan and advances to Q2', async () => {
    const phone = testPhone('302')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })
    const r = await applyMorningFlowTurn({ phone, message: 'Pour slab on level 3', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(2)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[2])
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    expect(log?.morning_manpower_planned).toBeNull()
  })

  // 3. Q2 -> parsed labour written, advances to Q3 (step 3).
  it('Q2: writes parsed morning_manpower_planned and advances to Q3', async () => {
    const phone = testPhone('303')
    await driveTo(phone, 2)
    const r = await applyMorningFlowTurn({ phone, message: '12 mason 8 helper', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(3)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[3])
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_manpower_planned).toMatchObject({
      planned_total: 20,
      by_trade: [
        { trade: 'mason', planned_count: 12 },
        { trade: 'helper', planned_count: 8 },
      ],
      raw_text: '12 mason 8 helper',
    })
  })

  // 4. Q2 reask-once — no number reasks, second no-number accepts raw + advances.
  it('Q2 no-number: reasks once, then accepts the raw answer and advances', async () => {
    const phone = testPhone('304')
    await driveTo(phone, 2)

    const r1 = await applyMorningFlowTurn({ phone, message: 'some workers', startFlow: false, now: P_NOW })
    expect(r1.outcome).toBe('reask')
    expect(r1.current_step).toBe(2)
    expect((await getDailyLog(LOG_DATE))?.morning_manpower_planned).toBeNull()
    expect((await readSession(phone))?.context).toMatchObject({ q2_reask: 1 })

    const r2 = await applyMorningFlowTurn({ phone, message: 'still no number', startFlow: false, now: P_NOW })
    expect(r2.outcome).toBe('advance')
    expect(r2.current_step).toBe(3)
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_manpower_planned).toMatchObject({ planned_total: null, raw_text: 'still no number' })
    expect((await readSession(phone))?.context).toMatchObject({ q2_reask: 0 })
  })

  // 5. Q3 -> parsed equipment written, advances to Q4 (step 4).
  it('Q3: writes parsed morning_equipment and advances to Q4', async () => {
    const phone = testPhone('305')
    await driveTo(phone, 3)
    const r = await applyMorningFlowTurn({ phone, message: 'JCB 1500', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(4)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[4])
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_equipment).toMatchObject({
      none: false,
      items: [{ type: 'jcb', daily_hire_cost: 1500 }],
      raw_text: 'JCB 1500',
    })
  })

  // 6. Q3 "no equipment" -> answered-empty (none:true, []), advances (no reask).
  it('Q3 none sentinel: stores none:true / empty items and advances, not a reask', async () => {
    const phone = testPhone('306')
    await driveTo(phone, 3)
    const r = await applyMorningFlowTurn({ phone, message: 'illa', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_step).toBe(4)
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_equipment).toMatchObject({ none: true, items: [], raw_text: 'illa' })
  })

  // 7. Q3 garbled -> reask once, then accept.
  it('Q3 garbled: reasks once, then accepts the raw answer and advances', async () => {
    const phone = testPhone('307')
    await driveTo(phone, 3)
    const r1 = await applyMorningFlowTurn({ phone, message: 'asdf', startFlow: false, now: P_NOW })
    expect(r1.outcome).toBe('reask')
    expect(r1.current_step).toBe(3)
    expect((await readSession(phone))?.context).toMatchObject({ q3_reask: 1 })

    const r2 = await applyMorningFlowTurn({ phone, message: 'qwerty', startFlow: false, now: P_NOW })
    expect(r2.outcome).toBe('advance')
    expect(r2.current_step).toBe(4)
    expect((await getDailyLog(LOG_DATE))?.morning_equipment).toMatchObject({ raw_text: 'qwerty' })
  })

  // 8. Q4 -> completion: all four columns + submitted_at, session reset + marker.
  it('Q4: completes — all morning columns + submitted_at, session reset', async () => {
    const phone = testPhone('308')
    await driveTo(phone, 4)
    const r = await applyMorningFlowTurn({ phone, message: 'Crew A then Crew B', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('advance')
    expect(r.current_flow).toBeNull()
    expect(r.current_step).toBe(0)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_COMPLETE_REPLY)

    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Pour slab on level 3')
    expect(log?.morning_manpower_planned).toMatchObject({ planned_total: 20 })
    expect(log?.morning_equipment).toMatchObject({ items: [{ type: 'jcb' }] })
    expect(log?.morning_execution_plan).toBe('Crew A then Crew B')
    expect(log?.morning_submitted_at).not.toBeNull()

    const session = await readSession(phone)
    expect(session?.current_flow).toBeNull()
    expect(session?.context).toEqual({ morning_submitted: true })
  })

  // 9. already_complete — messaging after completion, no new write.
  it('already_complete: post-completion inbound, no daily_logs write', async () => {
    const phone = testPhone('309')
    await driveTo(phone, 4)
    await applyMorningFlowTurn({ phone, message: 'Execution text', startFlow: false, now: P_NOW })
    const submittedBefore = (await getDailyLog(LOG_DATE))?.morning_submitted_at

    const r = await applyMorningFlowTurn({ phone, message: 'anything else?', startFlow: false, now: P_LATER_SAME_DAY })
    expect(r.outcome).toBe('already_complete')
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_ALREADY_COMPLETE_REPLY)
    expect((await getDailyLog(LOG_DATE))?.morning_submitted_at).toBe(submittedBefore)
  })

  // 10. empty re-ask — whitespace answer re-asks, no write, step + counter unchanged.
  it('reask: whitespace answer re-asks the current question, no write, no budget spent', async () => {
    const phone = testPhone('310')
    await driveTo(phone, 2)
    const r = await applyMorningFlowTurn({ phone, message: '   ', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('reask')
    expect(r.current_step).toBe(2)
    expect(buildMorningReply(r.outcome, r.current_step)).toBe(MORNING_QUESTIONS[2])
    // Empty never consumes the parse reask budget.
    const ctx = (await readSession(phone))?.context ?? {}
    expect(ctx).not.toHaveProperty('q2_reask')
  })

  // 11. BOT-07 next-day reset wipes the NEW reask counters (explicitly requested).
  //     Mid-Q2 with q2_reask=1, a next-IST-day inbound resets context to {} —
  //     the counter must be gone, session idle.
  it('next-day reset: wipes q2_reask counter along with the rest of context', async () => {
    const phone = testPhone('311')
    await driveTo(phone, 2)
    const rReask = await applyMorningFlowTurn({ phone, message: 'no number here', startFlow: false, now: P_NOW })
    expect(rReask.outcome).toBe('reask')
    expect((await readSession(phone))?.context).toMatchObject({ q2_reask: 1 })

    // Next IST day, ordinary inbound (no startFlow). BOT-07 resets to idle.
    const r = await applyMorningFlowTurn({ phone, message: 'good morning', startFlow: false, now: P_NEXT_DAY })
    expect(r.outcome).toBe('idle')
    expect(r.current_flow).toBeNull()
    const session = await readSession(phone)
    expect(session?.context).toEqual({}) // q2_reask wiped, no marker
  })

  // 12. concurrency — two near-simultaneous turns serialise on the row lock.
  it('concurrency: two simultaneous turns are serialised by the row lock', async () => {
    const phone = testPhone('312')
    await applyMorningFlowTurn({ phone, message: '', startFlow: true, now: P_NOW })

    // Caller 1 holds the lock across an 800ms sleep (answers Q1); caller 2 fires
    // a beat later and must block until caller 1 commits (then answers Q2).
    const c1 = applyMorningFlowTurn({ phone, message: 'Plan from caller 1', startFlow: false, now: P_NOW, testSleepMs: 800 })
    await sleep(100)
    const c2 = applyMorningFlowTurn({ phone, message: '9 mason', startFlow: false, now: P_NOW, testSleepMs: 0 })
    await Promise.all([c1, c2])

    // Serialised: caller 1's Q1 answer landed in morning_plan, then caller 2 saw
    // step 2 and answered Q2. No lost update.
    const log = await getDailyLog(LOG_DATE)
    expect(log?.morning_plan).toBe('Plan from caller 1')
    expect(log?.morning_manpower_planned).toMatchObject({ planned_total: 9 })

    const session = await readSession(phone)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(3)
  })

  // 13. RPC-level startFlow:false on an idle session -> idle, no write.
  it('startFlow:false on idle session -> idle, no flow started, no write', async () => {
    const phone = testPhone('313')
    const r = await applyMorningFlowTurn({ phone, message: 'hi bot', startFlow: false, now: P_NOW })
    expect(r.outcome).toBe('idle')
    expect(r.current_flow).toBeNull()
    expect(await getDailyLog(LOG_DATE)).toBeNull()
  })
})
