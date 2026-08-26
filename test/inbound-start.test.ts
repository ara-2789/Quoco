import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  routeInboundMessage,
  REPORT_READY_REPLY,
  MORNING_WINDOW_CLOSED_REPLY,
  EVENING_WINDOW_NOT_OPEN_REPLY,
} from '@/lib/whatsapp/inbound-start'
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
const MID_DAY_NOT_SUBMITTED = `${LOG_DATE}T12:00:00+05:30` // 12:00 IST — morningSend..morningCutoff
// §35a (2026-08-26): morning done, evening not — the early-volunteer start
// case now requires evening's OWN window (>= eveningSend, 18:30) to be open.
// Was 15:00 before §35a's evening guard existed; moved to the boundary
// itself so this constant still demonstrates a SUCCESSFUL evening start,
// not a refusal. All three of this constant's uses (early-volunteer start,
// the flow-already-active evening delegation test, and the KK2 evening
// race) are safe at this value — see each test's own comment.
const MID_DAY_MORNING_ONLY = `${LOG_DATE}T18:30:00+05:30` // 18:30 IST — eveningSend, exactly
const MID_DAY_BOTH_DONE = `${LOG_DATE}T16:00:00+05:30` // 16:00 IST — morningSend..eveningClose
const AFTER_EVENING_CLOSE = `${LOG_DATE}T20:00:00+05:30` // 20:00 IST — after eveningClose (19:45)

// §35a WINDOW GUARD boundaries (design-decisions-beta-feedback.md §35),
// 2026-08-26. morningCutoff = 15:00, eveningSend = 18:30.
const JUST_BEFORE_MORNING_CUTOFF = `${LOG_DATE}T14:59:00+05:30` // 14:59 IST — morning still allowed
const AT_MORNING_CUTOFF = `${LOG_DATE}T15:00:00+05:30` // 15:00 IST — morning refused, boundary itself
const AFTER_MORNING_CUTOFF = `${LOG_DATE}T16:30:00+05:30` // 16:30 IST — morning refused, well past
const JUST_BEFORE_EVENING_SEND = `${LOG_DATE}T18:29:00+05:30` // 18:29 IST — evening still refused
const AT_EVENING_SEND = `${LOG_DATE}T18:30:00+05:30` // 18:30 IST — evening allowed, boundary itself

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

  it('at eveningSend, morning submitted, evening not — starts evening (early-volunteer case)', async () => {
    // §35a: this case now requires evening's OWN window to be open, not just
    // "any time before eveningClose" as it did pre-2026-08-26 — MID_DAY_
    // MORNING_ONLY sits exactly at eveningSend (18:30) for that reason.
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

// §35a (design-decisions-beta-feedback.md, 2026-08-26) — the two window
// guards this incident produced. Scaffolding per that entry's own note:
// §28(x)'s ad-hoc menu replaces these refusals once built.
describe('routeInboundMessage — §35a window guards (morningCutoff, eveningSend)', () => {
  it('morning: allowed just before the cutoff (14:59) — starts morning normally', async () => {
    const phone = testPhone('811')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_MORNING_CUTOFF))
    expect(reply).toBe(MORNING_QUESTIONS[1])
    expect(resolvedFlow).toBe('morning')
  })

  it('morning: refused exactly at the cutoff (15:00) — MORNING_WINDOW_CLOSED_REPLY, no session', async () => {
    const phone = testPhone('812')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_MORNING_CUTOFF))
    expect(reply).toBe(MORNING_WINDOW_CLOSED_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('morning: refused well after the cutoff (16:30) — the 2026-08-26 incident window', async () => {
    const phone = testPhone('813')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AFTER_MORNING_CUTOFF))
    expect(reply).toBe(MORNING_WINDOW_CLOSED_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
    // Nothing for sweep_stale_morning_sessions to ever race, because no
    // session was created — the actual fix, per §35b.
  })

  it('evening: refused just before eveningSend (18:29) even though morning is done', async () => {
    const phone = testPhone('814')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_EVENING_SEND))
    expect(reply).toBe(EVENING_WINDOW_NOT_OPEN_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('evening: allowed exactly at eveningSend (18:30) — starts evening normally', async () => {
    const phone = testPhone('815')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(EVENING_QUESTIONS[1])
    expect(resolvedFlow).toBe('evening')
  })

  it('the existing eveningClose refusal (19:45+) is NOT shadowed by the new evening guard — composition check', async () => {
    // Nothing submitted at all, well past BOTH new guards' own windows AND
    // past eveningClose. If the new evening guard were reached instead of
    // the pre-existing top-level eveningClose check, this would either try
    // to start evening (morning not submitted, so it wouldn't) or return
    // EVENING_WINDOW_NOT_OPEN_REPLY (it wouldn't, since 21:00 >= eveningSend)
    // -- REPORT_READY_REPLY is the ONLY correct outcome, and it must come
    // from line ~119's check, which runs before the `!morningSubmitted`
    // branch (and therefore before the new morning guard) is ever reached.
    const phone = testPhone('816')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, `${LOG_DATE}T21:00:00+05:30`))
    expect(reply).toBe(REPORT_READY_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('PRINTS the reply at 14:00, 16:00, 19:00, and 21:00 IST for a fresh (nothing submitted) engineer', async () => {
    const times: [string, string][] = [
      ['14:00', `${LOG_DATE}T14:00:00+05:30`],
      ['16:00', `${LOG_DATE}T16:00:00+05:30`],
      ['19:00', `${LOG_DATE}T19:00:00+05:30`],
      ['21:00', `${LOG_DATE}T21:00:00+05:30`],
    ]
    const results: Record<string, string> = {}
    for (const [label, now] of times) {
      const phone = testPhone(`82${label.slice(0, 2)}`)
      const { reply } = await routeInboundMessage(baseParams(phone, now))
      results[label] = reply
    }
    // eslint-disable-next-line no-console
    console.log('§35 composition table (nothing submitted):', JSON.stringify(results, null, 2))

    expect(results['14:00']).toBe(MORNING_QUESTIONS[1]) // before morningCutoff -- starts morning
    expect(results['16:00']).toBe(MORNING_WINDOW_CLOSED_REPLY) // past morningCutoff, morning not done
    // 19:00 is past eveningSend too, but morning was NEVER submitted -- the
    // early-volunteer evening-start path only fires when morningSubmitted is
    // true. A no-show morning does not get "promoted" into evening by this
    // router; evening for this engineer is cron-triggered, not inbound-
    // triggered, matching decision (a)/(c)'s own framing.
    expect(results['19:00']).toBe(MORNING_WINDOW_CLOSED_REPLY)
    expect(results['21:00']).toBe(REPORT_READY_REPLY) // past eveningClose -- top-level refusal
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
