import { describe, it, expect, beforeAll, afterEach, afterAll } from 'vitest'
import {
  routeInboundMessage,
  classifyAdhocInput,
  computeIdleHeaderState,
  buildIdleReply,
  buildItem1InterimReply,
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
import { EVENING_QUESTIONS } from '@/lib/whatsapp/flows/evening'

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
//
// ROUTER REWRITE, 2026-09-06 (ad-hoc menu PR 2, step 2). The six/seven
// named static replies this file used to assert against
// (MORNING_AWAITING_TRIGGER_REPLY, MORNING_WINDOW_CLOSED_REPLY,
// EVENING_WINDOW_NOT_OPEN_REPLY, EVENING_AWAITING_TRIGGER_REPLY,
// EVENING_SITE_HOLIDAY_REPLY, REPORT_READY_REPLY) are gone. Every idle
// reply is now composed from computeIdleHeaderState + buildIdleReply
// (inbound-start.ts's own exports) -- tests below construct the exact
// expected string via buildIdleReply itself rather than duplicating the
// fifteen approved literal strings (docs/plans/adhoc-menu-spec.md's
// "Idle-inbound reply, decided" section is the source of truth for the
// literal copy; this file only proves the STATE MACHINE picks the right
// (kind, headerState) pair for each window). The default `baseParams`
// message is 'hi', which classifies as 'unrecognized' -- every existing
// window-table case below exercises that one input kind; a new describe
// block at the end covers the other two kinds and the "1" precedence rule
// directly.

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
  it('before morningSend, nothing submitted — awaiting_morning header, no session created', async () => {
    const phone = testPhone('801')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, BEFORE_MORNING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'awaiting_morning'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('mid-day, nothing submitted, before morningCutoff — awaiting_morning header, no session', async () => {
    const phone = testPhone('802')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_NOT_SUBMITTED))
    expect(reply).toBe(buildIdleReply('unrecognized', 'awaiting_morning'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('at eveningSend, morning submitted, evening not — no header (approved table has no "evening pending" row), no session', async () => {
    const phone = testPhone('803')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_MORNING_ONLY))
    expect(reply).toBe(buildIdleReply('unrecognized', 'none'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('mid-day, both submitted — "complete" header, no RPC called, no session created', async () => {
    const phone = testPhone('804')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      eveningSubmittedAt: `${LOG_DATE}T10:00:00.000Z`,
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_BOTH_DONE))
    expect(reply).toBe(buildIdleReply('unrecognized', 'complete'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('after eveningClose — "complete" header regardless of submission state (the old REPORT_READY_REPLY condition folds in here)', async () => {
    const phone = testPhone('805')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AFTER_EVENING_CLOSE))
    expect(reply).toBe(buildIdleReply('unrecognized', 'complete'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })
})

// §35a (design-decisions-beta-feedback.md, 2026-08-26) — the two window
// guards this incident produced. Both now unconditional (retirement
// removed the RPC calls they used to sit in front of) rather than guarding
// anything; the boundary itself is unchanged.
describe('routeInboundMessage — §35a window guards (morningCutoff, eveningSend)', () => {
  it('morning: window still open just before the cutoff (14:59) — awaiting_morning header, no session', async () => {
    const phone = testPhone('811')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_MORNING_CUTOFF))
    expect(reply).toBe(buildIdleReply('unrecognized', 'awaiting_morning'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('morning: refused exactly at the cutoff (15:00) — morning_closed header, no session', async () => {
    const phone = testPhone('812')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_MORNING_CUTOFF))
    expect(reply).toBe(buildIdleReply('unrecognized', 'morning_closed'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('morning: refused well after the cutoff (16:30) — the 2026-08-26 incident window', async () => {
    const phone = testPhone('813')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AFTER_MORNING_CUTOFF))
    expect(reply).toBe(buildIdleReply('unrecognized', 'morning_closed'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('evening: no header just before eveningSend (18:29) even though morning is done — same collapse as at eveningSend', async () => {
    const phone = testPhone('814')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_EVENING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'none'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('evening: window open exactly at eveningSend (18:30) — identical reply to just-before (real, accepted information loss — no dedicated "evening pending" row in the approved header table)', async () => {
    const phone = testPhone('815')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'none'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('the existing eveningClose refusal (19:45+) is NOT shadowed by the new evening guard — composition check', async () => {
    // Nothing submitted at all, well past BOTH window guards' own windows
    // AND past eveningClose. The "complete" header is the only correct
    // outcome, and it must come from the top-level eveningClose check,
    // which runs before the `!morningSubmitted` branch is ever reached.
    const phone = testPhone('816')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, `${LOG_DATE}T21:00:00+05:30`))
    expect(reply).toBe(buildIdleReply('unrecognized', 'complete'))
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

    expect(results['14:00']).toBe(buildIdleReply('unrecognized', 'awaiting_morning')) // before morningCutoff -- window still open
    expect(results['16:00']).toBe(buildIdleReply('unrecognized', 'morning_closed')) // past morningCutoff, morning not done
    // §37(b): 19:00 is past eveningSend too, but morning was NEVER
    // submitted -- the evening branch is unreachable for this engineer on
    // any timeline, not just at this instant. Accepted, not fixed (this
    // file's own header).
    expect(results['19:00']).toBe(buildIdleReply('unrecognized', 'morning_closed'))
    expect(results['21:00']).toBe(buildIdleReply('unrecognized', 'complete')) // past eveningClose -- top-level refusal
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
  it('site_holiday: evening not yet due (18:29) — still gets the site_holiday header, not "no header"', async () => {
    const phone = testPhone('817')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'site_holiday',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, JUST_BEFORE_EVENING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'site_holiday'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('site_holiday: at eveningSend (18:30) — site_holiday header, not the evening-pending collapse', async () => {
    const phone = testPhone('818')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'site_holiday',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'site_holiday'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it("absent: at eveningSend — no header, same evening-pending collapse as any other non-holiday attendance (§37(a), the evening cron still sends)", async () => {
    const phone = testPhone('819')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'absent',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'none'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('present: at eveningSend — no header, unchanged baseline', async () => {
    const phone = testPhone('820')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'present',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND))
    expect(reply).toBe(buildIdleReply('unrecognized', 'none'))
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
    expect(first.reply).toBe(buildIdleReply('unrecognized', 'complete'))

    const second = await routeInboundMessage(baseParams(phone, MID_DAY_BOTH_DONE, 'hello again'))
    expect(second.reply).toBe(buildIdleReply('unrecognized', 'complete'))

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

// classifyAdhocInput -- pure, no DB needed. The one case worth locking in
// with a real test: a leading digit must be STANDALONE (followed by a
// non-digit or end-of-string) or it must not match at all -- "12 bags of
// cement missing" must never be read as "1".
describe('classifyAdhocInput', () => {
  it('classifies a bare digit 1-7 as its own kind', () => {
    expect(classifyAdhocInput('1')).toBe('item1')
    expect(classifyAdhocInput('2')).toBe('item2')
    expect(classifyAdhocInput('7')).toBe('item_reserved')
  })

  it('classifies a digit followed by non-digit text the same way', () => {
    expect(classifyAdhocInput('1 crane blocked at gate')).toBe('item1')
    expect(classifyAdhocInput('7,')).toBe('item_reserved')
  })

  it('does NOT match a multi-digit number starting with 1 or 2', () => {
    expect(classifyAdhocInput('12 bags of cement missing')).toBe('unrecognized')
    expect(classifyAdhocInput('10 workers today')).toBe('unrecognized')
    expect(classifyAdhocInput('20')).toBe('unrecognized')
  })

  it('treats 0, 8, 9 as unrecognized -- never assigned to any item', () => {
    expect(classifyAdhocInput('0')).toBe('unrecognized')
    expect(classifyAdhocInput('8')).toBe('unrecognized')
    expect(classifyAdhocInput('9')).toBe('unrecognized')
  })

  it('treats free text and empty input as unrecognized', () => {
    expect(classifyAdhocInput('hi')).toBe('unrecognized')
    expect(classifyAdhocInput('')).toBe('unrecognized')
  })

  it('tolerates leading whitespace', () => {
    expect(classifyAdhocInput('   1')).toBe('item1')
  })
})

// PRECEDENCE (docs/plans/adhoc-menu-spec.md, "Idle-inbound reply, decided",
// Aravind's decision 2026-09-06): a leading "1" always starts item 1's
// flow, regardless of check-in state -- the header explains why no
// check-in is coming, never that nothing can be reported. Real DB
// round-trip through the full routeInboundMessage path, not just the pure
// classifier, so this proves the "1" check genuinely runs and still
// carries the daily_logs-derived header on the INTERIM reply (corrected
// 2026-09-06 -- the first draft's placeholder never showed a header at
// all, the exact false-promise-by-omission shape items 2/7 were dropped
// over).
describe('routeInboundMessage — ad-hoc precedence and fallback dispatch', () => {
  it('leading "1" wins even during morning_closed, and the interim reply still carries the header', async () => {
    const phone = testPhone('821')
    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, AFTER_MORNING_CUTOFF, '1 the crane access is blocked'),
    )
    expect(reply).toBe(buildItem1InterimReply('morning_closed'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('leading "1" wins even during site_holiday, header included — a genuine hindrance is still reportable on a holiday', async () => {
    const phone = testPhone('822')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      attendance: 'site_holiday',
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AT_EVENING_SEND, '1'))
    expect(reply).toBe(buildItem1InterimReply('site_holiday'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('leading "1" wins even after both halves are already submitted, header included', async () => {
    const phone = testPhone('823')
    await seedDailyLogSubmission({
      logDate: LOG_DATE,
      morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z`,
      eveningSubmittedAt: `${LOG_DATE}T10:00:00.000Z`,
    })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_BOTH_DONE, '1'))
    expect(reply).toBe(buildItem1InterimReply('complete'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('leading "1" with NO header state (evening-pending collapse) gets the interim line alone, no trailing blank line', async () => {
    const phone = testPhone('827')
    await seedDailyLogSubmission({ logDate: LOG_DATE, morningSubmittedAt: `${LOG_DATE}T04:00:00.000Z` })
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, MID_DAY_MORNING_ONLY, '1'))
    expect(reply).toBe(buildItem1InterimReply('none'))
    expect(reply).toBe("Hindrance reporting isn't ready yet. Nothing was recorded.")
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('typed "2" gets the safety fallback composed with whatever header applies', async () => {
    const phone = testPhone('824')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, AFTER_MORNING_CUTOFF, '2'))
    expect(reply).toBe(buildIdleReply('item2', computeIdleHeaderState({
      morningSubmitted: false,
      eveningSubmitted: false,
      attendance: null,
      istMinutes: 16 * 60 + 30,
    })))
    expect(reply).toBe(buildIdleReply('item2', 'morning_closed'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('typed "7" (reserved, held pending its own BOT-27 fix) gets the reserved fallback, distinct from typed "2"', async () => {
    const phone = testPhone('825')
    const { reply, resolvedFlow } = await routeInboundMessage(baseParams(phone, BEFORE_MORNING_SEND, '7'))
    expect(reply).toBe(buildIdleReply('item_reserved', 'awaiting_morning'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })

  it('a multi-digit message starting with "1" does NOT dispatch into item 1 — it is unrecognized', async () => {
    const phone = testPhone('826')
    const { reply, resolvedFlow } = await routeInboundMessage(
      baseParams(phone, BEFORE_MORNING_SEND, '10 bags of cement delivered'),
    )
    expect(reply).toBe(buildIdleReply('unrecognized', 'awaiting_morning'))
    expect(reply).not.toBe(buildItem1InterimReply('awaiting_morning'))
    expect(resolvedFlow).toBeNull()
    expect(await readSession(phone)).toBeNull()
  })
})
