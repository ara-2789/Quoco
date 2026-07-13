import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'

export type JobType =
  | 'dpr_generate'
  | 'owner_deliver'
  | 'template_send'
  | 'morning_trigger'
  | 'evening_trigger'
  | 'nudge'

export type JobStatus = 'pending' | 'running' | 'succeeded' | 'failed'

export interface Job {
  id: string
  created_at: string
  type: JobType
  payload: Record<string, unknown>
  status: JobStatus
  attempt_count: number
  next_retry_at: string
  last_error: string | null
  completed_at: string | null
}

const MAX_ATTEMPTS = 5

// Exponential backoff: 1min, 2min, 4min, 8min, 16min
function backoffSeconds(attemptCount: number): number {
  return Math.min(60 * Math.pow(2, attemptCount), 60 * 30) // cap at 30 min
}

/**
 * Add a new job to the queue. Called from webhook handlers, cron triggers,
 * or anywhere Claude API work needs to happen — NEVER call Claude directly
 * inline (NFR-16).
 */
export async function enqueueJob(
  type: JobType,
  payload: Json,
): Promise<Job> {
  const supabase = createServiceClient()

  const { data, error } = await supabase
    .from('jobs')
    .insert({
      type,
      payload,
      status: 'pending',
    })
    .select()
    .single()

  if (error) {
    throw new Error(`Failed to enqueue job (${type}): ${error.message}`)
  }

  return data as Job
}

/**
 * Claim up to `limit` jobs that are ready to run (per NFR-16, worker should
 * call this with limit=3 per invocation). Atomically marks them 'running'
 * so no other worker invocation picks up the same job.
 */
export async function claimJobs(limit: number = 3): Promise<Job[]> {
  const supabase = createServiceClient()

  // Select jobs that are pending/failed-with-retry-due, oldest first.
  const { data: candidates, error: selectError } = await supabase
    .from('jobs')
    .select('*')
    .in('status', ['pending', 'failed'])
    .lte('next_retry_at', new Date().toISOString())
    .lt('attempt_count', MAX_ATTEMPTS)
    .order('next_retry_at', { ascending: true })
    .limit(limit)

  if (selectError) {
    throw new Error(`Failed to select jobs: ${selectError.message}`)
  }

  if (!candidates || candidates.length === 0) {
    return []
  }

  // Claim each one individually via a conditional update — if two worker
  // invocations race, only one will succeed per job (status='pending' or
  // 'failed' check in the WHERE clause prevents double-claiming).
  const claimed: Job[] = []
  for (const job of candidates) {
    const { data, error } = await supabase
      .from('jobs')
      .update({ status: 'running' })
      .eq('id', job.id)
      .in('status', ['pending', 'failed'])
      .select()
      .single()

    if (!error && data) {
      claimed.push(data as Job)
    }
  }

  return claimed
}

/** Mark a job as successfully completed. */
export async function completeJob(jobId: string): Promise<void> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('jobs')
    .update({
      status: 'succeeded',
      completed_at: new Date().toISOString(),
    })
    .eq('id', jobId)

  if (error) {
    throw new Error(`Failed to complete job ${jobId}: ${error.message}`)
  }
}

/**
 * Mark a job as failed. If attempts remain, schedules a retry with
 * exponential backoff. If attempts are exhausted, status stays 'failed'
 * permanently (dead-letter per NFR-17) — caller is responsible for
 * raising a Sentry alert when this happens.
 */
export async function failJob(
  jobId: string,
  errorMessage: string,
): Promise<{ willRetry: boolean }> {
  const supabase = createServiceClient()

  const { data: current, error: fetchError } = await supabase
    .from('jobs')
    .select('attempt_count')
    .eq('id', jobId)
    .single()

  if (fetchError || !current) {
    throw new Error(`Failed to fetch job ${jobId} for retry: ${fetchError?.message}`)
  }

  const newAttemptCount = current.attempt_count + 1
  const willRetry = newAttemptCount < MAX_ATTEMPTS

  const { error: updateError } = await supabase
    .from('jobs')
    .update({
      status: 'failed',
      attempt_count: newAttemptCount,
      last_error: errorMessage,
      next_retry_at: willRetry
        ? new Date(Date.now() + backoffSeconds(newAttemptCount) * 1000).toISOString()
        : new Date().toISOString(),
    })
    .eq('id', jobId)

  if (updateError) {
    throw new Error(`Failed to update failed job ${jobId}: ${updateError.message}`)
  }

  return { willRetry }
}