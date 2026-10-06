import { describe, it, expect, vi, beforeEach } from 'vitest'
import { reportMorningSweepAnomalies, reportMorningSweepError, type MorningCutoffSweepResult } from '@/lib/daily-logs/morning-cutoff-sweep'

// B2 (external review round 1, migration 033): the skip-over-guess safety
// argument for ambiguous project membership -- and the missing-daily_logs-
// row guard -- both leaned on "surfaced in the return value," but nothing
// ever read that value (runJobsTick's response body is a cron HTTP response
// nobody reads). These are pure-logic unit tests of the two functions that
// close that gap, no database needed -- both operate purely on an
// already-known MorningCutoffSweepResult / a synthetic Error.
//
// @sentry/nextjs's ESM namespace exports are not configurable -- vi.spyOn
// directly on the imported namespace throws "Cannot redefine property"
// (no precedent for this in the codebase yet; every other Sentry call site
// is exercised only indirectly, never asserted on). vi.mock the module
// instead, same as any other external dependency this suite replaces.
const { captureMessage, captureException } = vi.hoisted(() => ({
  captureMessage: vi.fn((_message: string, _options?: Record<string, unknown>) => 'mock-event-id'),
  captureException: vi.fn((_error: unknown, _options?: Record<string, unknown>) => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }))

// RUN_TAG-derived test numbers: unique per run, so a leak can never be a
// coincidental match with a fixture another test left behind.
const RUN_TAG = crypto.randomUUID()
function digitsFrom(tag: string): string {
  return tag.replace(/\D/g, '').padEnd(10, '7').slice(0, 10)
}
const TEST_PHONE_A_DIGITS = `9${digitsFrom(RUN_TAG).slice(0, 9)}`
const TEST_PHONE_B_DIGITS = `8${digitsFrom(RUN_TAG).slice(1, 10)}`
const TEST_PHONE_A = `+91${TEST_PHONE_A_DIGITS}`
const TEST_PHONE_B = `+91${TEST_PHONE_B_DIGITS}`

function emptyResult(overrides: Partial<MorningCutoffSweepResult> = {}): MorningCutoffSweepResult {
  return {
    sweptCount: 0,
    sweptPhoneNumbers: [],
    missingDailyLogsRows: [],
    skippedCount: 0,
    skippedSessions: [],
    ...overrides,
  }
}

describe('reportMorningSweepAnomalies', () => {
  beforeEach(() => {
    captureMessage.mockClear()
  })

  it('empty result: no anomalies, Sentry never called', () => {
    reportMorningSweepAnomalies(emptyResult(), new Date('2026-09-10T10:00:00Z'))
    expect(captureMessage).not.toHaveBeenCalled()
  })

  // P0 (Sentry PII): the phone number is no longer sent anywhere -- not in
  // the fingerprint, not in `extra`. Fingerprint is (reason, IST day);
  // `extra.affected_sessions` carries how many sessions share that reason.
  // OLD assertions (removed): fingerprint [..., reason, '+19995551111',
  // '2026-09-10'] and extra { phone_number: '+19995551111', ... }.
  it('a skipped session emits one warning with a fingerprint scoped to reason/day, and no phone number anywhere', () => {
    const result = emptyResult({
      skippedCount: 1,
      skippedSessions: [
        { phoneNumber: TEST_PHONE_A, currentStep: 3, projectMembershipCount: 2, reason: 'multiple_project_memberships' },
      ],
    })
    reportMorningSweepAnomalies(result, new Date('2026-09-10T10:00:00Z'))

    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessage.mock.calls[0]
    expect(message).toContain('session skipped')
    expect(options).toMatchObject({
      level: 'warning',
      fingerprint: ['morning-cutoff-sweep', 'skipped', 'multiple_project_memberships', '2026-09-10'],
      tags: { feature: 'morning-cutoff-sweep', reason: 'multiple_project_memberships' },
      extra: { affected_sessions: 1, current_step: 3, project_membership_count: 2 },
    })
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(TEST_PHONE_A_DIGITS)
  })

  it('a missing-daily_logs-row anomaly emits its own warning with its own fingerprint shape, and no phone number anywhere', () => {
    const result = emptyResult({
      missingDailyLogsRows: [{ phoneNumber: TEST_PHONE_B, currentStep: 3, reason: 'no_daily_logs_row_found' }],
    })
    reportMorningSweepAnomalies(result, new Date('2026-09-10T10:00:00Z'))

    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessage.mock.calls[0]
    expect(message).toContain('daily_logs row missing')
    expect(options).toMatchObject({
      level: 'warning',
      fingerprint: ['morning-cutoff-sweep', 'missing-row', 'no_daily_logs_row_found', '2026-09-10'],
      tags: { feature: 'morning-cutoff-sweep', reason: 'no_daily_logs_row_found' },
      extra: { affected_sessions: 1, current_step: 3 },
    })
    expect(JSON.stringify(captureMessage.mock.calls)).not.toContain(TEST_PHONE_B_DIGITS)
  })

  it('sessions sharing a reason on the same day share one fingerprint and report the affected count', () => {
    const result = emptyResult({
      skippedCount: 3,
      skippedSessions: [
        { phoneNumber: TEST_PHONE_A, currentStep: 3, projectMembershipCount: 0, reason: 'zero_project_memberships' },
        { phoneNumber: TEST_PHONE_B, currentStep: 1, projectMembershipCount: 0, reason: 'zero_project_memberships' },
        { phoneNumber: TEST_PHONE_A, currentStep: 2, projectMembershipCount: 2, reason: 'multiple_project_memberships' },
      ],
    })
    reportMorningSweepAnomalies(result, new Date('2026-09-10T10:00:00Z'))

    expect(captureMessage).toHaveBeenCalledTimes(3)
    const fp = (i: number) => captureMessage.mock.calls[i][1]?.fingerprint
    expect(fp(0)).toEqual(fp(1))
    expect(fp(0)).not.toEqual(fp(2))
    expect(captureMessage.mock.calls[0][1]?.extra).toMatchObject({ affected_sessions: 2 })
    expect(captureMessage.mock.calls[2][1]?.extra).toMatchObject({ affected_sessions: 1 })
    const serialised = JSON.stringify(captureMessage.mock.calls)
    expect(serialised).not.toContain(TEST_PHONE_A_DIGITS)
    expect(serialised).not.toContain(TEST_PHONE_B_DIGITS)
  })

  it('multiple skipped sessions in one result each get their own call, none dropped', () => {
    const result = emptyResult({
      skippedCount: 2,
      skippedSessions: [
        { phoneNumber: '+19995551111', currentStep: 3, projectMembershipCount: 0, reason: 'zero_project_memberships' },
        { phoneNumber: '+19995553333', currentStep: 1, projectMembershipCount: 2, reason: 'multiple_project_memberships' },
      ],
    })
    reportMorningSweepAnomalies(result, new Date('2026-09-10T10:00:00Z'))
    expect(captureMessage).toHaveBeenCalledTimes(2)
  })

  it('DEDUP: the identical still-parked session, reported again the SAME IST day, gets the identical fingerprint', () => {
    const result = emptyResult({
      skippedCount: 1,
      skippedSessions: [
        { phoneNumber: '+19995551111', currentStep: 3, projectMembershipCount: 0, reason: 'zero_project_memberships' },
      ],
    })
    // Two ticks, 60s apart, same IST calendar day.
    reportMorningSweepAnomalies(result, new Date('2026-09-10T10:00:00Z'))
    reportMorningSweepAnomalies(result, new Date('2026-09-10T10:01:00Z'))

    expect(captureMessage).toHaveBeenCalledTimes(2)
    const fp1 = captureMessage.mock.calls[0][1]?.fingerprint
    const fp2 = captureMessage.mock.calls[1][1]?.fingerprint
    expect(fp1).toEqual(fp2)
  })

  it('the SAME still-parked session, reported the NEXT IST day, gets a DIFFERENT fingerprint (stays visible, not muted forever)', () => {
    const result = emptyResult({
      skippedCount: 1,
      skippedSessions: [
        { phoneNumber: '+19995551111', currentStep: 3, projectMembershipCount: 0, reason: 'zero_project_memberships' },
      ],
    })
    reportMorningSweepAnomalies(result, new Date('2026-09-10T16:00:00Z'))
    reportMorningSweepAnomalies(result, new Date('2026-09-11T10:00:00Z'))

    const fp1 = captureMessage.mock.calls[0][1]?.fingerprint
    const fp2 = captureMessage.mock.calls[1][1]?.fingerprint
    expect(fp1).not.toEqual(fp2)
  })
})

describe('reportMorningSweepError', () => {
  beforeEach(() => {
    captureException.mockClear()
  })

  it('a real Error is captured as-is and its message returned in the { error } shape runJobsTick expects', () => {
    const err = new Error('sweep_stale_morning_sessions failed: Could not find the function')
    const result = reportMorningSweepError(err)

    expect(result).toEqual({ error: 'sweep_stale_morning_sessions failed: Could not find the function' })
    expect(captureException).toHaveBeenCalledTimes(1)
    expect(captureException.mock.calls[0][0]).toBe(err)
    expect(captureException.mock.calls[0][1]).toMatchObject({ tags: { feature: 'morning-cutoff-sweep' } })
  })

  it('a non-Error throw is wrapped, not dropped -- Sentry still gets a real Error object', () => {
    const result = reportMorningSweepError('a string was thrown')

    expect(result).toEqual({ error: 'a string was thrown' })
    expect(captureException).toHaveBeenCalledTimes(1)
    const captured = captureException.mock.calls[0][0]
    expect(captured).toBeInstanceOf(Error)
    expect((captured as Error).message).toBe('a string was thrown')
  })
})
