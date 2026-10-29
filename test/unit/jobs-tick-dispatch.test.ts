// Characterization of app/api/jobs/tick/route.ts's job dispatch and dead-letter branches (PR-C C5, plan 3.9).
//
// Written FIRST, against the unedited route, so "existing job types unchanged" is proven by assertions that are
// green before the capture_ingest edit and stay unedited after it. No test called runJobsTick or dispatchJob
// before this file (dispatchJob is not exported).
//
// No database, no network: every module the route imports is mocked. It never runs an unscoped claimJobs against
// test-db (the capture suites' standing rule).
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupabaseClient } from '@supabase/supabase-js'

const m = vi.hoisted(() => ({
  claimJobs: vi.fn(),
  completeJob: vi.fn(),
  failJob: vi.fn(),
  handleDprGenerateJob: vi.fn(),
  markDprGenerationFailed: vi.fn(),
  handleOwnerDeliverJob: vi.fn(),
  handleHindrancePmNotifyJob: vi.fn(),
  handleMediaIngestJob: vi.fn(),
  markMediaIngestFailed: vi.fn(),
  handleHindranceMediaIngestJob: vi.fn(),
  markHindranceMediaIngestFailed: vi.fn(),
  captureMessage: vi.fn(),
  handleCaptureIngestJob: vi.fn(),
  markCaptureIngestFailed: vi.fn(),
}))

vi.mock('@/lib/queue/jobs', () => ({ claimJobs: m.claimJobs, completeJob: m.completeJob, failJob: m.failJob }))
vi.mock('@/lib/cron/auth', () => ({ isCronRequestAuthorized: () => true }))
vi.mock('@/lib/dpr/dispatch', () => ({
  handleDprGenerateJob: m.handleDprGenerateJob,
  markDprGenerationFailed: m.markDprGenerationFailed,
}))
vi.mock('@/lib/dpr/owner-deliver-dispatch', () => ({ handleOwnerDeliverJob: m.handleOwnerDeliverJob }))
vi.mock('@/lib/hindrance/pm-notify', () => ({ handleHindrancePmNotifyJob: m.handleHindrancePmNotifyJob }))
vi.mock('@/lib/media/ingest', () => ({
  handleMediaIngestJob: m.handleMediaIngestJob,
  markMediaIngestFailed: m.markMediaIngestFailed,
}))
vi.mock('@/lib/media/hindrance-ingest', () => ({
  handleHindranceMediaIngestJob: m.handleHindranceMediaIngestJob,
  markHindranceMediaIngestFailed: m.markHindranceMediaIngestFailed,
}))
vi.mock('@/lib/media/capture-ingest', () => ({
  handleCaptureIngestJob: m.handleCaptureIngestJob,
  markCaptureIngestFailed: m.markCaptureIngestFailed,
}))
vi.mock('@/lib/daily-logs/morning-cutoff-sweep', () => ({
  sweepStaleMorningSessions: vi.fn(async () => ({})),
  reportMorningSweepAnomalies: vi.fn(),
  reportMorningSweepError: vi.fn(() => ({ error: 'x' })),
}))
vi.mock('@/lib/whatsapp/outbound/coverage-sweep', () => ({
  runOutboundCoverageSweep: vi.fn(async () => ({})),
  reportOutboundCoverageAnomalies: vi.fn(),
  reportOutboundCoverageSweepError: vi.fn(() => ({ error: 'x' })),
}))
vi.mock('@/lib/checkin-escalations/sweep', () => ({
  runCheckinEscalationTickSweep: vi.fn(async () => ({})),
  reportCheckinEscalationSweepAnomalies: vi.fn(),
  reportCheckinEscalationSweepError: vi.fn(() => ({ error: 'x' })),
}))
vi.mock('@/lib/supabase/service', () => ({ createServiceClient: vi.fn() }))
vi.mock('@sentry/nextjs', () => ({ captureMessage: m.captureMessage, captureException: vi.fn() }))

import { runJobsTick } from '@/app/api/jobs/tick/route'

const client = { tag: 'client' } as unknown as SupabaseClient
const PAYLOAD = { marker: 'payload-1', project_id: 'p', engineer_id: 'e', log_date: '2026-01-01', daily_log_id: 'd' }

function job(type: string) {
  return { id: 'job-1', type, payload: PAYLOAD }
}

async function tick(type: string, opts: { handlerFails?: boolean; willRetry?: boolean } = {}) {
  m.claimJobs.mockResolvedValue([job(type)])
  m.failJob.mockResolvedValue({ willRetry: opts.willRetry ?? true })
  return runJobsTick(client)
}

beforeEach(() => {
  vi.clearAllMocks()
  for (const k of [
    'handleDprGenerateJob',
    'handleOwnerDeliverJob',
    'handleHindrancePmNotifyJob',
    'handleMediaIngestJob',
    'handleHindranceMediaIngestJob',
    'markDprGenerationFailed',
    'markMediaIngestFailed',
    'markHindranceMediaIngestFailed',
  ] as const) {
    m[k].mockReset()
    m[k].mockResolvedValue(undefined)
  }
})

describe('tick dispatch: existing job types reach their own handler (T-TICK-EXIST-1)', () => {
  it('dpr_generate -> handleDprGenerateJob(payload, job.id, {supabaseClient})', async () => {
    const r = await tick('dpr_generate')
    expect(m.handleDprGenerateJob).toHaveBeenCalledWith(PAYLOAD, 'job-1', { supabaseClient: client })
    expect(m.completeJob).toHaveBeenCalledWith('job-1', client)
    expect(m.failJob).not.toHaveBeenCalled()
    expect(r.results).toEqual([{ id: 'job-1', status: 'succeeded' }])
  })

  it.each([
    ['owner_deliver', 'handleOwnerDeliverJob'],
    ['hindrance_pm_notify', 'handleHindrancePmNotifyJob'],
    ['media_ingest', 'handleMediaIngestJob'],
    ['hindrance_media_ingest', 'handleHindranceMediaIngestJob'],
  ] as const)('%s -> %s(payload, {supabaseClient})', async (type, handler) => {
    await tick(type)
    expect(m[handler]).toHaveBeenCalledTimes(1)
    expect(m[handler]).toHaveBeenCalledWith(PAYLOAD, { supabaseClient: client })
    expect(m.completeJob).toHaveBeenCalledWith('job-1', client)
    expect(m.failJob).not.toHaveBeenCalled()
  })

  it('each type calls ONLY its own handler', async () => {
    await tick('media_ingest')
    for (const k of [
      'handleDprGenerateJob',
      'handleOwnerDeliverJob',
      'handleHindrancePmNotifyJob',
      'handleHindranceMediaIngestJob',
    ] as const) {
      expect(m[k]).not.toHaveBeenCalled()
    }
  })
})

describe('tick dispatch: placeholders and unknown types throw (T-TICK-EXIST-2)', () => {
  it.each(['template_send', 'morning_trigger', 'evening_trigger', 'nudge'])(
    '%s -> "No handler implemented yet"',
    async (type) => {
      const r = await tick(type)
      expect(m.failJob).toHaveBeenCalledWith('job-1', `No handler implemented yet for job type: ${type}`, client)
      expect(m.completeJob).not.toHaveBeenCalled()
      expect(r.results[0]).toMatchObject({ status: 'failed', willRetry: true })
    },
  )

  it('an unknown type -> "Unknown job type"', async () => {
    await tick('zz_not_a_type')
    expect(m.failJob).toHaveBeenCalledWith('job-1', 'Unknown job type: zz_not_a_type', client)
    expect(m.completeJob).not.toHaveBeenCalled()
  })
})

describe('tick dispatch: dead-letter branches fire only when retries are exhausted (T-TICK-EXIST-3)', () => {
  it('dpr_generate', async () => {
    m.handleDprGenerateJob.mockRejectedValue(new Error('boom'))
    await tick('dpr_generate', { willRetry: true })
    expect(m.markDprGenerationFailed).not.toHaveBeenCalled()
    await tick('dpr_generate', { willRetry: false })
    expect(m.markDprGenerationFailed).toHaveBeenCalledWith(client, 'p', 'e', '2026-01-01')
  })

  it('media_ingest', async () => {
    m.handleMediaIngestJob.mockRejectedValue(new Error('boom'))
    await tick('media_ingest', { willRetry: true })
    expect(m.markMediaIngestFailed).not.toHaveBeenCalled()
    await tick('media_ingest', { willRetry: false })
    expect(m.markMediaIngestFailed).toHaveBeenCalledWith(client, PAYLOAD, 'boom')
  })

  it('hindrance_media_ingest', async () => {
    m.handleHindranceMediaIngestJob.mockRejectedValue(new Error('boom'))
    await tick('hindrance_media_ingest', { willRetry: true })
    expect(m.markHindranceMediaIngestFailed).not.toHaveBeenCalled()
    await tick('hindrance_media_ingest', { willRetry: false })
    expect(m.markHindranceMediaIngestFailed).toHaveBeenCalledWith(client, PAYLOAD, 'boom')
  })

  it.each([
    ['hindrance_pm_notify', 'handleHindrancePmNotifyJob'],
    ['owner_deliver', 'handleOwnerDeliverJob'],
  ] as const)('%s: one forced second call on exhaustion, then a Sentry event if that also fails', async (type, handler) => {
    m[handler].mockRejectedValue(new Error('boom'))
    await tick(type, { willRetry: true })
    expect(m[handler]).toHaveBeenCalledTimes(1)
    expect(m.captureMessage).not.toHaveBeenCalled()

    m[handler].mockClear()
    await tick(type, { willRetry: false })
    expect(m[handler]).toHaveBeenCalledTimes(2)
    expect(m[handler]).toHaveBeenLastCalledWith(PAYLOAD, { supabaseClient: client, forceSendWithoutPhotos: true })
    expect(m.captureMessage).toHaveBeenCalledTimes(1)
  })
})

describe('tick dispatch: capture_ingest (PR-C C5, plan 3.9)', () => {
  beforeEach(() => {
    m.handleCaptureIngestJob.mockReset()
    m.handleCaptureIngestJob.mockResolvedValue(undefined)
    m.markCaptureIngestFailed.mockReset()
    m.markCaptureIngestFailed.mockResolvedValue(undefined)
  })

  it('T-TICK-CI-1: reaches handleCaptureIngestJob(payload, {supabaseClient}) and completes', async () => {
    const r = await tick('capture_ingest')
    expect(m.failJob).not.toHaveBeenCalled() // before the edit this shows "Unknown job type: capture_ingest"
    expect(m.handleCaptureIngestJob).toHaveBeenCalledTimes(1)
    expect(m.handleCaptureIngestJob).toHaveBeenCalledWith(PAYLOAD, { supabaseClient: client, jobId: 'job-1' })
    expect(m.completeJob).toHaveBeenCalledWith('job-1', client)
    expect(r.results).toEqual([{ id: 'job-1', status: 'succeeded' }])
  })

  it('T-TICK-CI-1b: no other handler is called for it', async () => {
    await tick('capture_ingest')
    for (const k of [
      'handleDprGenerateJob',
      'handleOwnerDeliverJob',
      'handleHindrancePmNotifyJob',
      'handleMediaIngestJob',
      'handleHindranceMediaIngestJob',
    ] as const) {
      expect(m[k]).not.toHaveBeenCalled()
    }
  })

  it('T-TICK-CI-2: the dead letter runs only when retries are exhausted, and receives job.id', async () => {
    m.handleCaptureIngestJob.mockRejectedValue(new Error('capture_files ingest: 1 of 1 files not completed (download:1)'))
    await tick('capture_ingest', { willRetry: true })
    expect(m.markCaptureIngestFailed).not.toHaveBeenCalled()
    await tick('capture_ingest', { willRetry: false })
    expect(m.markCaptureIngestFailed).toHaveBeenCalledTimes(1)
    expect(m.markCaptureIngestFailed).toHaveBeenCalledWith(
      client,
      PAYLOAD,
      'capture_files ingest: 1 of 1 files not completed (download:1)',
      'job-1',
    )
  })

  it('T-TICK-CI-3 (review N2): a throwing dead letter sends ONE counts-only event and does not reject the tick', async () => {
    m.handleCaptureIngestJob.mockRejectedValue(new Error('boom'))
    m.markCaptureIngestFailed.mockRejectedValue(new Error('https://api.twilio.com/leak +19995550000 payload-1'))
    const r = await tick('capture_ingest', { willRetry: false })
    expect(r.results[0]).toMatchObject({ id: 'job-1', status: 'failed', willRetry: false })
    expect(m.captureMessage).toHaveBeenCalledTimes(1)
    const [, opts] = m.captureMessage.mock.calls[0]
    expect(opts.level).toBe('error')
    expect(opts.fingerprint).toEqual(['capture-ingest', 'dead_letter_failed'])
    expect(opts.extra).toEqual({ table: 'capture_files', jobId: 'job-1' })
    expect(JSON.stringify(m.captureMessage.mock.calls)).not.toMatch(/twilio|\+1999|payload-1/)
  })
})
