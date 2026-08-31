import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  triggerWithRetryBudget,
  reportRetryBudgetExhausted,
  MAX_ATTEMPTS,
  RETRY_BACKOFF_MS,
} from '@/lib/whatsapp/outbound/checkpoint-trigger'
import type { TriggerOutcome } from '@/lib/whatsapp/outbound/trigger'

// Item E's own retry budget (docs/plans/pass1-outbound-send-plan.md's own
// Amendment (g) resolution, Aravind, 2026-08-28): 3 attempts, per
// engineer, per checkpoint, per IST day. Pure-logic unit tests -- the
// trigger function and the sleep function are both injected (see
// checkpoint-trigger.ts's own header on triggerWithRetryBudget), so this
// suite proves the BUDGET mechanics deterministically, without a real
// Twilio call, a real DB, or real multi-second waits.
//
// @sentry/nextjs's ESM namespace exports are not configurable -- same
// vi.mock reasoning as test/unit/morning-cutoff-sweep-sentry.test.ts's
// own header.
const { captureMessage } = vi.hoisted(() => ({
  captureMessage: vi.fn((_message: string, _options?: Record<string, unknown>) => 'mock-event-id'),
}))
vi.mock('@sentry/nextjs', () => ({ captureMessage }))

const FAKE_PARAMS = {
  checkpoint: 'morning_send' as const,
  tenantId: 'tenant-1',
  projectId: 'project-1',
  engineerId: 'engineer-1',
  engineerName: 'ZZ Test Engineer',
  projectName: 'ZZ Test Project',
  whatsappNumber: '+919876543210',
  logDate: '2026-09-01',
}

function outcome(o: TriggerOutcome['outcome']): TriggerOutcome {
  if (o === 'sent') return { outcome: 'sent', twilioSid: 'SMabc' }
  if (o === 'failed') return { outcome: 'failed' }
  return { outcome: o } as TriggerOutcome
}

describe('triggerWithRetryBudget', () => {
  it('a non-rate-limited outcome on the first attempt returns immediately, attempts=1, no sleep', async () => {
    const triggerFn = vi.fn().mockResolvedValue(outcome('sent'))
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const result = await triggerWithRetryBudget(FAKE_PARAMS, triggerFn, sleepFn)
    expect(result).toEqual({ outcome: outcome('sent'), attempts: 1 })
    expect(triggerFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).not.toHaveBeenCalled()
  })

  it('rate_limited then sent: two attempts, exactly one sleep between them', async () => {
    const triggerFn = vi.fn().mockResolvedValueOnce(outcome('rate_limited')).mockResolvedValueOnce(outcome('sent'))
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const result = await triggerWithRetryBudget(FAKE_PARAMS, triggerFn, sleepFn)
    expect(result).toEqual({ outcome: outcome('sent'), attempts: 2 })
    expect(triggerFn).toHaveBeenCalledTimes(2)
    expect(sleepFn).toHaveBeenCalledTimes(1)
    expect(sleepFn).toHaveBeenCalledWith(RETRY_BACKOFF_MS)
  })

  it('rate_limited on every attempt: exhausts at exactly MAX_ATTEMPTS, sleeps MAX_ATTEMPTS-1 times, final outcome still rate_limited', async () => {
    const triggerFn = vi.fn().mockResolvedValue(outcome('rate_limited'))
    const sleepFn = vi.fn().mockResolvedValue(undefined)
    const result = await triggerWithRetryBudget(FAKE_PARAMS, triggerFn, sleepFn)
    expect(result).toEqual({ outcome: outcome('rate_limited'), attempts: MAX_ATTEMPTS })
    expect(triggerFn).toHaveBeenCalledTimes(MAX_ATTEMPTS)
    // No sleep AFTER the final attempt -- there is nothing left to wait for.
    expect(sleepFn).toHaveBeenCalledTimes(MAX_ATTEMPTS - 1)
  })

  it.each(['failed', 'ambiguous', 'already_claimed'] as const)(
    'a %s outcome is NEVER retried -- terminal-for-today by trigger.ts\'s own design, this function must not widen that',
    async (outcomeName) => {
      const triggerFn = vi.fn().mockResolvedValue(outcome(outcomeName))
      const sleepFn = vi.fn().mockResolvedValue(undefined)
      const result = await triggerWithRetryBudget(FAKE_PARAMS, triggerFn, sleepFn)
      expect(result.attempts).toBe(1)
      expect(triggerFn).toHaveBeenCalledTimes(1)
      expect(sleepFn).not.toHaveBeenCalled()
    },
  )

  it('passes the exact same params object through to every attempt, unmodified', async () => {
    const triggerFn = vi.fn().mockResolvedValueOnce(outcome('rate_limited')).mockResolvedValueOnce(outcome('sent'))
    await triggerWithRetryBudget(FAKE_PARAMS, triggerFn, vi.fn().mockResolvedValue(undefined))
    expect(triggerFn).toHaveBeenNthCalledWith(1, FAKE_PARAMS)
    expect(triggerFn).toHaveBeenNthCalledWith(2, FAKE_PARAMS)
  })
})

describe('reportRetryBudgetExhausted', () => {
  beforeEach(() => {
    captureMessage.mockClear()
  })

  it('fires a loud, error-level alert fingerprinted per (checkpoint, engineer, day), naming the phone number for a human to act on', () => {
    reportRetryBudgetExhausted('engineer-1', '+919876543210', 'evening_send', '2026-09-01')
    expect(captureMessage).toHaveBeenCalledTimes(1)
    const [message, options] = captureMessage.mock.calls[0]
    expect(message).toContain('retry budget exhausted')
    expect(options).toMatchObject({
      level: 'error',
      fingerprint: ['outbound-send', 'retry_budget_exhausted', 'evening_send', 'engineer-1', '2026-09-01'],
      tags: { feature: 'outbound-send', checkpoint: 'evening_send' },
      extra: expect.objectContaining({
        engineer_id: 'engineer-1',
        whatsapp_number: '+919876543210',
        checkpoint: 'evening_send',
        log_date: '2026-09-01',
        max_attempts: MAX_ATTEMPTS,
      }),
    })
    // The alert must be actionable on its own -- the phone number appears
    // in the action_required text too, not only in `extra`, so a human
    // scanning the message doesn't have to dig into structured fields.
    const extra = (options as { extra: Record<string, unknown> }).extra
    expect(String(extra.action_required)).toContain('+919876543210')
  })
})
