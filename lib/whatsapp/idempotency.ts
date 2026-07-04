import { createServiceClient } from '@/lib/supabase/service'

/**
 * Check whether a Twilio message SID has already been processed. If not,
 * atomically record it as processed. Returns true if this is a NEW message
 * (safe to process), false if it's a DUPLICATE (Twilio retry — no-op).
 *
 * Relies on the UNIQUE constraint on processed_messages.message_sid: the
 * insert will fail with a unique violation if the SID was already recorded,
 * which we catch and treat as "already processed" rather than an error.
 */
export async function isNewMessage(messageSid: string): Promise<boolean> {
  const supabase = createServiceClient()

  const { error } = await supabase
    .from('processed_messages')
    .insert({ message_sid: messageSid })

  if (error) {
    // Postgres unique violation error code is '23505'.
    if (error.code === '23505') {
      return false // duplicate — already processed
    }
    // Any other error is unexpected — surface it rather than silently
    // treating as duplicate or new.
    throw new Error(`Idempotency check failed for SID ${messageSid}: ${error.message}`)
  }

  return true // new message, safe to process
}