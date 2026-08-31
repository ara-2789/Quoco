// Pass 1 item D2 (docs/plans/pass1-outbound-send-plan.md item D). Twilio
// POSTs here on every status transition of a message sent with a
// StatusCallback URL -- lib/whatsapp/outbound/send.ts now supplies one on
// every outbound send (added alongside this route; see that file's own
// header for why nothing reached this route before that change).
//
// SIGNATURE VALIDATION -- shared allowlist, not a callback-only patch, per
// Amendment (a) (lib/whatsapp/twilio-signature.ts carries the full
// incident/reasoning).
//
// IDEMPOTENCY -- NOT processed_messages (the inbound webhook's own
// mechanism). Twilio can legitimately send SEVERAL DIFFERENT status
// callbacks for the SAME MessageSid as a message progresses (sent ->
// delivered -> read, or sent -> undelivered) -- deduping on bare SID would
// incorrectly treat the SECOND, DIFFERENT status as a duplicate of the
// first. Idempotency instead comes from the UPDATE's own conditional WHERE
// clause below (`status = 'sent'`), the same CAS-style guard trigger.ts's
// own re-claim UPDATE already uses: a Twilio retry of the IDENTICAL
// callback finds the row already 'failed' and matches zero rows, safely.
//
// WHAT HAPPENS TO A CALLBACK FOR A SID WITH NO MATCHING LEDGER ROW -- not
// silently accepted, not treated as an error either. `outbound_sends.
// twilio_sid` is only ever set by trigger.ts's own synchronous 'sent'
// UPDATE, so a genuine callback for a message THIS system sent always has
// a matching row by the time any callback could possibly arrive (the
// claim + the 'sent' UPDATE both complete, synchronously, before
// triggerCheckIn's own HTTP response even returns). A miss here means the
// MessageSid belongs to a send this table doesn't know about -- a manual/
// test send via scripts/submit-templates.ts, or a future Pass 2 send path
// not yet wired to this table -- expected, not a bug, once other send
// paths exist. Logged (Sentry, 'warning' level -- this codebase's own
// convention for "worth seeing, not an actionable failure," fingerprinted
// per SID) for visibility, and always answered 200 -- a non-2xx makes
// Twilio retry an unmatchable callback forever, which fixes nothing.

import { NextRequest, NextResponse } from 'next/server'
import * as Sentry from '@sentry/nextjs'
// KNOWN GAP: SupabaseClient here is bare, not SupabaseClient<Database> --
// every query in this file is unchecked against the real schema, even
// though createServiceClient() below already builds a properly typed
// client; the type is erased at this file's own function boundary. See
// docs/reviews/outbound-untyped-supabase-client-gap.md for what it would
// take to close (not a one-line fix -- expect real errors to surface).
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { validateTwilioSignature } from '@/lib/whatsapp/twilio-signature'
import { classifyTwilioMessageStatus } from '@/lib/whatsapp/outbound/status-callback'

/**
 * Extracted from POST so a test harness can call it directly with an
 * injected client -- same shape as handleWebhookPost
 * (app/api/whatsapp/webhook/route.ts's own header explains why).
 */
export async function handleStatusCallbackPost(
  request: NextRequest,
  deps: { supabaseClient?: SupabaseClient } = {},
): Promise<NextResponse> {
  const authToken = process.env.TWILIO_AUTH_TOKEN
  if (!authToken) {
    return NextResponse.json({ error: 'Server misconfigured' }, { status: 500 })
  }

  const twilioSignature = request.headers.get('X-Twilio-Signature')
  if (!twilioSignature) {
    return NextResponse.json({ error: 'Missing signature' }, { status: 403 })
  }

  const formData = await request.formData()
  const params: Record<string, string> = {}
  formData.forEach((value, key) => {
    params[key] = value.toString()
  })

  const isValid = validateTwilioSignature('/api/whatsapp/status-callback', params, twilioSignature, authToken)
  if (!isValid) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 403 })
  }

  const messageSid = params.MessageSid
  const messageStatus = params.MessageStatus
  if (!messageSid || !messageStatus) {
    return NextResponse.json({ error: 'Missing MessageSid or MessageStatus' }, { status: 400 })
  }

  const action = classifyTwilioMessageStatus({
    messageSid,
    messageStatus,
    errorCode: params.ErrorCode,
    channelStatusMessage: params.ChannelStatusMessage,
  })

  const supabase = deps.supabaseClient ?? createServiceClient()

  if (action.action === 'noop') {
    return NextResponse.json({ status: 'noop' })
  }

  if (action.action === 'unrecognized_status') {
    // Twilio's own documented vocabulary is a closed set (see status-
    // callback.ts's own header) -- a value outside it is worth a human
    // noticing, not a silent drop. Never blocks the 200 response below.
    Sentry.captureMessage('outbound-send: status callback with unrecognized MessageStatus', {
      level: 'warning',
      fingerprint: ['outbound-send', 'status_callback_unrecognized', messageStatus],
      tags: { feature: 'outbound-send' },
      extra: { messageSid, messageStatus },
    })
    return NextResponse.json({ status: 'unrecognized' })
  }

  // action.action === 'mark_failed'. Conditional UPDATE -- see this file's
  // own IDEMPOTENCY note above for why the `.eq('status', 'sent')` guard
  // is the entire mechanism, not a belt-and-suspenders extra.
  const { data: updated, error: updateError } = await supabase
    .from('outbound_sends')
    .update({ status: 'failed', error: action.error, updated_at: new Date().toISOString() })
    .eq('twilio_sid', messageSid)
    .eq('status', 'sent')
    .select('id')
    .maybeSingle()

  if (updateError) {
    Sentry.captureException(updateError, {
      tags: { feature: 'outbound-send', stage: 'status-callback-update' },
      extra: { messageSid, messageStatus },
    })
    return NextResponse.json({ error: 'Update failed' }, { status: 500 })
  }

  if (updated) {
    return NextResponse.json({ status: 'marked_failed' })
  }

  // Zero rows matched -- either an idempotent retry of THIS exact callback
  // (row already 'failed', matched zero on the status guard, entirely
  // benign) or a genuine no-match (see this file's own header). Distinguish
  // by re-reading whether a row for this sid exists AT ALL, so the Sentry
  // signal below fires only for the real "no matching ledger row" case, not
  // for every ordinary retry.
  const { data: existing, error: readError } = await supabase
    .from('outbound_sends')
    .select('id')
    .eq('twilio_sid', messageSid)
    .maybeSingle()

  if (readError) {
    Sentry.captureException(readError, {
      tags: { feature: 'outbound-send', stage: 'status-callback-readback' },
      extra: { messageSid, messageStatus },
    })
    return NextResponse.json({ status: 'update_unconfirmed' })
  }

  if (!existing) {
    // 'warning', not 'error' -- this codebase's own established convention
    // for "worth a human seeing, not an actionable failure" (same level
    // reportUnreachableEngineer/reportMorningSweepAnomalies already use),
    // rather than inventing a new, unprecedented severity tier for a case
    // this file's own header already argues is expected once other send
    // paths exist, not a bug.
    Sentry.captureMessage('outbound-send: status callback for a MessageSid with no matching outbound_sends row', {
      level: 'warning',
      fingerprint: ['outbound-send', 'status_callback_no_match', messageSid],
      tags: { feature: 'outbound-send' },
      extra: { messageSid, messageStatus },
    })
  }

  return NextResponse.json({ status: 'noop' })
}

export async function POST(request: NextRequest) {
  return handleStatusCallbackPost(request)
}
