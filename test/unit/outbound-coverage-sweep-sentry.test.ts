import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  reportOutboundCoverageAnomalies,
  reportOutboundCoverageSweepError,
  isOutboundTriggerCronLive,
  type CoverageSweepResult,
} from '@/lib/whatsapp/outbound/coverage-sweep'
import vercelConfig from '@/vercel.json'

// F3/F4 -- pure-logic unit tests of the alerting half, no database needed,
// same shape as test/unit/morning-cutoff-sweep-sentry.test.ts (that file's
// own header explains why @sentry/nextjs is vi.mock'd rather than
// vi.spyOn'd: its ESM namespace exports are not configurable).
const { captureMessage, captureException } = vi.hoisted(() => ({
  captureMessage: vi.fn((_message: string, _options?: Record<string, unknown>) => 'mock-event-id'),
  captureException: vi.fn((_error: unknown, _options?: Record<string, unknown>) => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage, captureException }))

function emptyResult(overrides: Partial<CoverageSweepResult> = {}): CoverageSweepResult {
  return {
    checkpoints: [],
    stuckClaims: [],
    rateLimitedBacklogCount: 0,
    ...overrides,
  }
}

describe('reportOutboundCoverageAnomalies', () => {
  beforeEach(() => {
    captureMessage.mockClear()
  })

  it('empty result: no anomalies, Sentry never called', () => {
    reportOutboundCoverageAnomalies(emptyResult())
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('PRODUCTION DEFAULT: a real coverage gap, past window close, is NEVER alerted while the REAL vercel.json still holds only today\'s two known-pre-item-E crons -- item E does not exist yet, so a gap here is expected, not a bug (called with no third argument, exactly like the real jobs/tick call site -- the default derives from the actual file, not a declared value)', () => {
    reportOutboundCoverageAnomalies(
      emptyResult({
        checkpoints: [
          { checkpoint: 'morning_send', logDate: '2026-09-01', windowClosed: true, expectedRosterSize: 10, sentCount: 0, gap: 10 },
        ],
      }),
    )
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('a coverage gap BEFORE the window closes is never alerted even with triggerCronLive=true -- checking too early is a false positive by construction', () => {
    reportOutboundCoverageAnomalies(
      emptyResult({
        checkpoints: [
          { checkpoint: 'morning_send', logDate: '2026-09-01', windowClosed: false, expectedRosterSize: 10, sentCount: 2, gap: 8 },
        ],
      }),
      true,
    )
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('a coverage gap AFTER the window closes IS alerted once triggerCronLive=true, fingerprinted on (checkpoint, logDate)', () => {
    reportOutboundCoverageAnomalies(
      emptyResult({
        checkpoints: [
          { checkpoint: 'evening_send', logDate: '2026-09-01', windowClosed: true, expectedRosterSize: 10, sentCount: 7, gap: 3 },
        ],
      }),
      true,
    )
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessage.mock.calls[0]
    expect(message).toContain('coverage gap')
    expect(options).toMatchObject({
      level: 'error',
      fingerprint: ['outbound-send', 'coverage_gap', 'evening_send', '2026-09-01'],
      tags: { feature: 'outbound-send', checkpoint: 'evening_send' },
      extra: { log_date: '2026-09-01', expected_roster_size: 10, sent_count: 7, gap: 3 },
    })
  })

  it('windowClosed=true with gap=0 (full coverage) is never alerted, even with triggerCronLive=true', () => {
    reportOutboundCoverageAnomalies(
      emptyResult({
        checkpoints: [
          { checkpoint: 'morning_send', logDate: '2026-09-01', windowClosed: true, expectedRosterSize: 5, sentCount: 5, gap: 0 },
        ],
      }),
      true,
    )
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('a stuck claim is alerted, fingerprinted on the row id, naming phone/content_sid for direct investigation', () => {
    reportOutboundCoverageAnomalies(
      emptyResult({
        stuckClaims: [
          { id: 'row-abc-123', toPhoneNumber: '+919876543210', contentSid: 'HXdeadbeef', updatedAt: '2026-09-01T10:00:00Z' },
        ],
      }),
    )
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessage.mock.calls[0]
    expect(message).toContain('stuck')
    expect(options).toMatchObject({
      level: 'error',
      fingerprint: ['outbound-send', 'stuck_claim', 'row-abc-123'],
      tags: { feature: 'outbound-send' },
      extra: {
        claim_id: 'row-abc-123',
        to_phone_number: '+919876543210',
        content_sid: 'HXdeadbeef',
        updated_at: '2026-09-01T10:00:00Z',
      },
    })
  })

  it('F3: rateLimitedBacklogCount NEVER triggers a Sentry call, at any value -- excluded from alerting entirely, per Amendment (g)\'s own "benign morning backlog" warning', () => {
    reportOutboundCoverageAnomalies(emptyResult({ rateLimitedBacklogCount: 500 }))
    expect(captureMessage).not.toHaveBeenCalled()
  })

  it('multiple stuck claims each get their own alert, not one combined issue', () => {
    reportOutboundCoverageAnomalies(
      emptyResult({
        stuckClaims: [
          { id: 'row-1', toPhoneNumber: '+919876543210', contentSid: 'HXone', updatedAt: '2026-09-01T10:00:00Z' },
          { id: 'row-2', toPhoneNumber: '+919876543211', contentSid: 'HXtwo', updatedAt: '2026-09-01T10:05:00Z' },
        ],
      }),
    )
    expect(captureMessage).toHaveBeenCalledTimes(2)
  })
})

describe('reportOutboundCoverageSweepError', () => {
  beforeEach(() => {
    captureException.mockClear()
  })

  it('a real Error is captured as-is and its message returned in the { error } shape callers expect', () => {
    const result = reportOutboundCoverageSweepError(new Error('boom'))
    expect(result).toEqual({ error: 'boom' })
    expect(captureException).toHaveBeenCalledTimes(1)
    const [err, options] = captureException.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect(options).toMatchObject({ tags: { feature: 'outbound-send-coverage-sweep' } })
  })

  it('a non-Error thrown value is wrapped, not passed through raw', () => {
    const result = reportOutboundCoverageSweepError('a string was thrown')
    expect(result).toEqual({ error: 'a string was thrown' })
    expect(captureException).toHaveBeenCalledTimes(1)
    const [err] = captureException.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
  })
})

// THE GATE MECHANISM ITSELF, PINNED AGAINST THE REAL vercel.json -- NOT A
// FIXTURE. This is the tripwire: item E's own PR, once it adds its two
// cron entries to the real vercel.json, changes what vercelConfig.crons
// actually contains -- the first test below then evaluates against a
// vercel.json that genuinely has more than the two known-pre-item-E
// paths, and isOutboundTriggerCronLive correctly starts returning true,
// which flips this test's own assertion from pass to fail. Item E's PR
// cannot land with CI green without someone looking at this test --
// nothing to remember, a broken assertion forces the acknowledgment
// instead of relying on a human to recall a separate step.
describe('isOutboundTriggerCronLive', () => {
  it('with the REAL, current vercel.json (today: exactly jobs/tick + dpr-generate, nothing else), the gate is OFF', () => {
    expect(isOutboundTriggerCronLive(vercelConfig.crons)).toBe(false)
  })

  it('a third cron entry beyond the known-pre-item-E paths trips the gate ON -- proves the mechanism reacts to ANY new entry, not a guess at item E\'s own (not-yet-decided) route name', () => {
    const withExtraCron = [...vercelConfig.crons, { path: '/api/cron/some-future-thing', schedule: '0 0 * * *' }]
    expect(isOutboundTriggerCronLive(withExtraCron)).toBe(true)
  })

  it('the two known-pre-item-E paths, given directly rather than read from the real file, evaluate to OFF -- pins the list\'s own contents, not only today\'s file state', () => {
    expect(
      isOutboundTriggerCronLive([
        { path: '/api/jobs/tick' },
        { path: '/api/cron/dpr-generate' },
      ]),
    ).toBe(false)
  })

  it('an empty crons array is OFF -- no crons at all is not evidence item E exists', () => {
    expect(isOutboundTriggerCronLive([])).toBe(false)
  })
})
