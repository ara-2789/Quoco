import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  routeInboundMessage,
  REPORT_READY_REPLY,
  MORNING_WINDOW_CLOSED_REPLY,
  EVENING_WINDOW_NOT_OPEN_REPLY,
  MORNING_AWAITING_TRIGGER_REPLY,
  EVENING_AWAITING_TRIGGER_REPLY,
  EVENING_SITE_HOLIDAY_REPLY,
} from '@/lib/whatsapp/inbound-start'
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

// Integration tests for routeInboundMessage (lib/whatsapp/inbound-start.ts).
// RETIRED, 2026-08-28 (this file's own header, design-decisions-beta-
// feedback.md §38): idle inbound no longer starts a flow via this path --
// the cron (Pass 1 items B-F) is the sole flow-starter now. This suite was
// rewritten the same day to match: every "starts morning"/"starts evening"
// case below now asserts a static acknowledgement reply and NO session
// row, and the whole KK2 flow-race describe block (which existed only to
// prove the now-removed startFlow:true RPC call couldn't be raced) is
// deleted -- there is no RPC call left in this file for anything to race.
//
// Real test-db throughout via the injected supabaseClient param, same
// construction as test/dispatch.test.ts -- no mocks. `now` is injected per
// case so every window is deterministic, unlike webhook.test.ts's
// end-to-end path (no `now` injection point there, matching production).

const LOG_DATE = '2026-08-20'

// IST wall-clock instants for the day above, one per window. eveningClose
// is 19:45 IST (lib/daily-logs/cutoffs.ts).
const BEFORE_MORNING_SEND = `${LOG_DATE}T07:00:00+05:30` // 07:00 IST — before morningSend (08:30)
const MID_DAY_NOT_SUBMITTED = `${LOG_DATE}T12:00:00+05:30` // 12:00 IST — morningSend..morningCutoff
const MID_DAY_MORNING_ONLY = `${LOG_DATE}T18:30:00+05:30` // 18:30 IST — eveningSend, exactly
const MID_DAY_BOTH_DONE = `${LOG_DATE}T16:00:00+05:30` // 16:00 IST — morningSend..eveningClose
const AFTER_EVENING_CLOSE = `${LOG_DATE}T20:00:00+05:30` // 20:00 IST — after eveningClose (19:45)

// §35a WINDOW GUARD boundaries (design-decisions-beta-feedback.md §35),
// 2026-08-26. morningCutoff = 15:00, eveningSend = 18:30.
const JUST_BEFORE_MORNING_CUTOFF = `${LOG_DATE}T14:59:00+05:30` // 14:59 IST — morning window still open
const AT_MORNING_CUTOFF = `${LOG_DATE}T15:00:00+05:30` // 15:00 IST — morning refused, boundary itself
const AFTER_MORNING_CUTOFF = `${LOG_DATE}T16:30:00+05:30` // 16:30 IST — morning refused, well past
const JUST_BEFORE_EVENING_SEND = `${LOG_DATE}T18:29:00+05:30` // 18:29 IST — evening still refused
const AT_EVENING_SEND = `${LOG_DATE}T18:30:00+05:30` // 18:30 IST — evening window open, boundary itself

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
  it('before morningSend, nothing submitted — awaiting-trigger acknowledgement, no session created', async () => {
    const phone = testPhone('801')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, BEFORE_MORNING_SEND))
    expect(reply).toBe(MORNING_AWAITING_TRIGGER_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('mid-day, nothing submitted, before morningCutoff — awaiting-trigger acknowledgement, no session', async () => {
    const phone = testPhone('802')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_NOT_SUBMITTED))
    expect(reply).toBe(MORNING_AWAITING_TRIGGER_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('at eveningSend, morning submitted, evening not — awaiting-trigger acknowledgement, no session', async () => {
    const phone = testPhone('803')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_MORNING_ONLY))
    expect(reply).toBe(EVENING_AWAITING_TRIGGER_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
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
// guards this incident produced. Both now unconditional (retirement
// removed the RPC calls they used to sit in front of) rather than guarding
// anything; the boundary itself is unchanged.
describe('routeInboundMessage — §35a window guards (morningCutoff, eveningSend)', () => {
  it('morning: window still open just before the cutoff (14:59) — awaiting-trigger acknowledgement, no session', async () => {
    const phone = testPhone('811')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_MORNING_CUTOFF))
    expect(reply).toBe(MORNING_AWAITING_TRIGGER_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
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
  })

  it('evening: refused just before eveningSend (18:29) even though morning is done', async () => {
    const phone = testPhone('814')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_EVENING_SEND))
    expect(reply).toBe(EVENING_WINDOW_NOT_OPEN_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('evening: window open exactly at eveningSend (18:30) — awaiting-trigger acknowledgement, no session', async () => {
    const phone = testPhone('815')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(EVENING_AWAITING_TRIGGER_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('the existing eveningClose refusal (19:45+) is NOT shadowed by the new evening guard — composition check', async () => {
    // Nothing submitted at all, well past BOTH window guards' own windows
    // AND past eveningClose. REPORT_READY_REPLY is the only correct
    // outcome, and it must come from the top-level eveningClose check,
    // which runs before the `!morningSubmitted` branch is ever reached.
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

    expect(results['14:00']).toBe(MORNING_AWAITING_TRIGGER_REPLY) // before morningCutoff -- window still open
    expect(results['16:00']).toBe(MORNING_WINDOW_CLOSED_REPLY) // past morningCutoff, morning not done
    // §37(b): 19:00 is past eveningSend too, but morning was NEVER
    // submitted -- the evening branch is unreachable for this engineer on
    // any timeline, not just at this instant. Accepted, not fixed (this
    // file's own header).
    expect(results['19:00']).toBe(MORNING_WINDOW_CLOSED_REPLY)
    expect(results['21:00']).toBe(REPORT_READY_REPLY) // past eveningClose -- top-level refusal
  })
})

// §39 fix (design-decisions-beta-feedback.md §39, audit finding J,
// 2026-09-05): a site-holiday day must not promise an evening check-in
// that filterEveningRoster (lib/whatsapp/outbound/roster.ts) has already
// excluded. Locks in the §37(a) distinction alongside it — 'absent' does
// NOT get this treatment, since the evening cron still sends for an
// absent-in-the-morning engineer — so nobody "fixes" absent later on the
// mistaken assumption the two attendance values should behave alike here.
describe('routeInboundMessage — §39 site-holiday evening reply', () => {
  it('site_holiday: evening not yet due (18:29) — still gets the holiday reply, not "not yet time"', async () => {
    const phone = testPhone('817')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'site_holiday',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_EVENING_SEND))
    expect(reply).toBe(EVENING_SITE_HOLIDAY_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('site_holiday: at eveningSend (18:30) — holiday reply, not the awaiting-trigger promise', async () => {
    const phone = testPhone('818')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'site_holiday',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(EVENING_SITE_HOLIDAY_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it("absent: at eveningSend — still the ordinary awaiting-trigger reply (§37(a), the evening cron still sends)", async () => {
    const phone = testPhone('819')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'absent',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(EVENING_AWAITING_TRIGGER_REPLY)
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('present: at eveningSend — the ordinary awaiting-trigger reply, unchanged baseline', async () => {
    const phone = testPhone('820')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'present',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(EVENING_AWAITING_TRIGGER_REPLY)
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
