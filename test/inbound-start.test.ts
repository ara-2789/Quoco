import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import { routeInboundMessage, REPORT_READY_REPLY } from '@/lib/whatsapp/inbound-start'
import { FLOW_RACE_REPLY } from '@/lib/whatsapp/dispatch'
import {
  testClient,
  ensureMorningFixtures,
  removeMorningFixtures,
  cleanupTestSessions,
  cleanupTestDailyLogs,
  seedSession,
  seedDailyLogSubmission,
  readSession,
  getDailyLog,
  testPhone,
  TEST_TENANT_ID,
  TEST_PROJECT_ID,
  testEngineerId,
} from './helpers/db'
import { MORNING_QUESTIONS } from '@/lib/whatsapp/flows/morning'
import { EVENING_QUESTIONS, EVENING_ALREADY_COMPLETE_REPLY } from '@/lib/whatsapp/flows/evening'

// Integration tests for routeInboundMessage (lib/whatsapp/inbound-start.ts,
// II3 build, to docs/inbound-start-trigger-plan.md). Real test-db throughout
// via the injected supabaseClient param, same construction as
// test/dispatch.test.ts — no mocks. `now` is injected per case so every
// window in the plan's (a) table is deterministic, unlike webhook.test.ts's
// end-to-end path (no `now` injection point there, matching production).
//
// One case per window + the already-submitted-then-messages-again case +
// flow-active delegation, per JJ2. Every case asserts on the REPLY TEXT, not
// just the outcome/resolvedFlow — the copy is the product here.

const LOG_DATE = '2026-08-20'

// IST wall-clock instants for the day above, one per window in the plan's
// table. eveningClose is 19:45 IST (lib/daily-logs/cutoffs.ts).
const BEFORE_MORNING_SEND = `${LOG_DATE}T07:00:00+05:30` // 07:00 IST — before morningSend (08:30)
const MID_DAY_NOT_SUBMITTED = `${LOG_DATE}T12:00:00+05:30` // 12:00 IST — morningSend..eveningClose
const MID_DAY_MORNING_ONLY = `${LOG_DATE}T15:00:00+05:30` // 15:00 IST — morningSend..eveningClose
const MID_DAY_BOTH_DONE = `${LOG_DATE}T16:00:00+05:30` // 16:00 IST — morningSend..eveningClose
const AFTER_EVENING_CLOSE = `${LOG_DATE}T20:00:00+05:30` // 20:00 IST — after eveningClose (19:45)

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

function baseParams(phone: string, now: string, message = 'hi') {
  return {
    phoneNumber: phone,
    tenantId: TEST_TENANT_ID,
    userId: testEngineerId(),
    projectId: TEST_PROJECT_ID,
    message,
    now,
    supabaseClient: testClient(),
  }
}

describe('routeInboundMessage — (a) window table, no active session', () => {
  it('before morningSend, nothing submitted — starts morning', async () => {
    const phone = testPhone('801')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, BEFORE_MORNING_SEND))
    expect(reply).toBe(MORNING_QUESTIONS[1])
    expect(resolvedFlow).toBe('morning')
    expect((await readSession(phone))?.current_flow).toBe('morning')
    expect((await readSession(phone))?.current_step).toBe(1)
  })

  it('mid-day, nothing submitted — starts morning', async () => {
    const phone = testPhone('802')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_NOT_SUBMITTED))
    expect(reply).toBe(MORNING_QUESTIONS[1])
    expect(resolvedFlow).toBe('morning')
  })

  it('mid-day, morning submitted, evening not — starts evening (early-volunteer case)', async () => {
    const phone = testPhone('803')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_MORNING_ONLY))
    expect(reply).toBe(EVENING_QUESTIONS[1])
    expect(resolvedFlow).toBe('evening')
    expect((await readSession(phone))?.current_flow).toBe('evening')
  })

  it('mid-day, both submitted — "both done" reply, no RPC called, no session created', async () => {
    const phone = testPhone('804')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      eveningSubmittedAt: `${LOG_DATE}T10:00:00.000Z`,
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_BOTH_DONE))
    expect(reply).toBe(EVENING_ALREADY_COMPLETE_REPLY)
    expect(resolvedFlow).toBeNull()
    // No RPC was called for this branch — no session row should exist.
    expect(await readSession(phone)).toBeNull()
  })

  it('after eveningClose — refuses with REPORT_READY_REPLY, regardless of submission state', async () => {
    const phone = testPhone('805')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AFTER_EVENING_CLOSE))
    expect(reply).toBe(REPORT_READY_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })
})

describe('routeInboundMessage — already-submitted-then-messages-again', () => {
  it('a second inbound after both-done gets the identical static reply, no drift, no writes', async () => {
    const phone = testPhone('806')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      eveningSubmittedAt: `${LOG_DATE}T10:00:00.000Z`,
    })

    const first = await routeInboundMessage(baseParams(phone, MID_DAY_BOTH_DONE, 'hi'))
    expect(first.reply).toBe(EVENING_ALREADY_COMPLETE_REPLY)

    const second = await routeInboundMessage(baseParams(phone, MID_DAY_BOTH_DONE, 'hello again'))
    expect(second.reply).toBe(EVENING_ALREADY_COMPLETE_REPLY)

    expect(await readSession(phone)).toBeNull()
    // Confirm the markers are unchanged by either turn -- compared as
    // instants, not raw strings: Postgres round-trips a UTC timestamp as
    // "...+00:00", not the "...Z" this test wrote, so a string-equality
    // assertion would fail on formatting alone, not on a real drift.
    const log = await getDailyLog(LOG_DATE)
    expect(new Date(log?.morning_submitted_at ?? '').getTime()).toBe(
      new Date(`${LOG_DATE}T04:00:00.000Z`).getTime(),
    )
    expect(new Date(log?.evening_submitted_at ?? '').getTime()).toBe(
      new Date(`${LOG_DATE}T10:00:00.000Z`).getTime(),
    )
  })
})

describe('routeInboundMessage — flow already active: delegates unchanged', () => {
  it('an active morning session is routed exactly as dispatchInboundTurn would route it', async () => {
    const phone = testPhone('807')
    await seedSession({
      phone,
      currentFlow: 'morning',
      currentStep: 2, // Q2 plan (030_morning_flow_attendance.sql renumbering — step 1 is now attendance)
      context: {},
      updatedAt: MID_DAY_NOT_SUBMITTED,
    })
    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, MID_DAY_NOT_SUBMITTED, 'Pour slab on level 3'),
    )
    expect(resolvedFlow).toBe('morning')
    expect(reply).toBe(MORNING_QUESTIONS[3])
    expect((await getDailyLog(LOG_DATE))?.morning_plan).toBe('Pour slab on level 3')
  })

  it('an active evening session is routed exactly as dispatchInboundTurn would route it', async () => {
    const phone = testPhone('808')
    await seedSession({
      phone,
      currentFlow: 'evening',
      currentStep: 1,
      context: {},
      updatedAt: MID_DAY_MORNING_ONLY,
    })
    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, MID_DAY_MORNING_ONLY, 'some work done'),
    )
    expect(resolvedFlow).toBe('evening')
    expect(reply).toBe(EVENING_QUESTIONS[2])
    expect((await getDailyLog(LOG_DATE))?.evening_output).toBe('some work done')
  })
})

describe('routeInboundMessage — KK2: flow race between readCurrentFlow and the RPC', () => {
  it('a genuine flow starts (evening) in the gap before the morning startFlow:true RPC call — FLOW_RACE_REPLY, not the wrong question', async () => {
    const phone = testPhone('809')
    const { reply, resolvedFlow } = await routeInboundMessage({
      ...baseParams(phone, MID_DAY_NOT_SUBMITTED),
      onBeforeStart: async () => {
        // Constructs the race deterministically: readCurrentFlow already
        // returned null above (no row existed yet); this seeds one with a
        // DIFFERENT flow active, exactly as if a real evening start had won
        // the race against this call's own upcoming startFlow:true RPC call.
        await seedSession({
          phone,
          currentFlow: 'evening',
          currentStep: 3,
          context: {},
          updatedAt: MID_DAY_NOT_SUBMITTED,
        })
      },
    })
    expect(reply).toBe(FLOW_RACE_REPLY)
    expect(resolvedFlow).toBeNull()
    // The raced-in evening session is untouched by the losing morning call —
    // still step 3, still evening, not overwritten or advanced.
    const session = await readSession(phone)
    expect(session?.current_flow).toBe('evening')
    expect(session?.current_step).toBe(3)
  })

  it('a genuine flow starts (morning) in the gap before the evening startFlow:true RPC call — FLOW_RACE_REPLY, not the wrong question', async () => {
    const phone = testPhone('810')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage({
      ...baseParams(phone, MID_DAY_MORNING_ONLY),
      onBeforeStart: async () => {
        await seedSession({
          phone,
          currentFlow: 'morning',
          currentStep: 2,
          context: {},
          updatedAt: MID_DAY_MORNING_ONLY,
        })
      },
    })
    expect(reply).toBe(FLOW_RACE_REPLY)
    expect(resolvedFlow).toBeNull()
    const session = await readSession(phone)
    expect(session?.current_flow).toBe('morning')
    expect(session?.current_step).toBe(2)
  })
})
