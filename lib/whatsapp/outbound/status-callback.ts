// The status-callback route's own decision logic, pure and testable
// without a DB or an HTTP request -- Pass 1 item D2
// (docs/plans/pass1-outbound-send-plan.md item D, Amendment (a)).
//
// STATUS VOCABULARY, VERIFIED AGAINST TWILIO'S CURRENT DOCS BEFORE WRITING
// THIS FILE, not memory (2026-08-28, same discipline as send.ts's own
// IDEMPOTENCY KEY note). Confirmed live:
//   - Full status lifecycle (twilio.com/docs/messaging/guides/outbound-
//     message-status-in-status-callbacks): queued, sent, delivered,
//     undelivered, failed, read (WhatsApp read receipts), plus
//     scheduled/canceled for the Messaging Services scheduling feature
//     (not used by this codebase -- sendWhatsAppTemplate never schedules).
//   - Payload field names (twilio.com/docs/messaging/api/message-resource):
//     `MessageSid`, `MessageStatus`, `ErrorCode` are the standard status-
//     callback parameters; WhatsApp specifically also carries
//     `ChannelStatusMessage`, a human-readable error string -- preferred
//     over the bare numeric ErrorCode when present, same "prefer message
//     text, fall back to a code/status label" convention trigger.ts's own
//     4xx branch already uses (`sendResult.errorMessage ?? \`HTTP
//     ${sendResult.status}\``).
//
// THE MAPPING, ARGUED (matches plan §5's own explicit statement -- "ledger
// flips from 'sent' to 'failed' once the async status arrives" -- not
// invented here):
//   - queued / sending / sent -- confirms what trigger.ts's own synchronous
//     2xx handling already recorded as 'sent'. NO-OP: outbound_sends has no
//     status value more granular than 'sent' to move to (031's own STATUS
//     LIFECYCLE is deliberately exactly 'sending'/'sent'/'failed', not a
//     fuller Twilio-mirroring state machine).
//   - delivered / read -- confirms real device-level delivery/read. Also a
//     NO-OP on `status` for the identical reason: 031's schema has no
//     'delivered' or 'read' state, and nothing in this Pass reads one.
//     Genuine evidence, but not evidence this table's own status column is
//     designed to hold.
//   - undelivered / failed -- THE async-rejection case plan §1/§5 name
//     explicitly (error-63016-class: Twilio accepted synchronously, Meta
//     rejected asynchronously). Twilio already confirmed synchronous
//     acceptance (ledger is 'sent'); this is genuinely NEW terminal
//     information -- flip 'sent' -> 'failed'. The route's own UPDATE is
//     conditioned on `status = 'sent'` (see the route itself), so this is
//     idempotent by construction: a Twilio retry of the identical callback
//     finds the row already 'failed' and matches zero rows, same shape as
//     trigger.ts's own CAS re-claim guard.
//   - anything else -- Twilio's own documented vocabulary is exactly the
//     six values above; a value outside it is either a future Twilio
//     addition or a genuine anomaly. Never silently ignored (this
//     codebase's own "never a silent mystery" convention) and never
//     failed loudly either -- Twilio retries a non-2xx response, and
//     retrying an unrecognized status forever helps nobody. Reported,
//     not acted on.

export interface TwilioStatusCallbackPayload {
  messageSid: string
  messageStatus: string
  errorCode?: string
  channelStatusMessage?: string
}

export type StatusCallbackAction =
  | { action: 'noop' }
  | { action: 'mark_failed'; error: string }
  | { action: 'unrecognized_status' }

const NOOP_STATUSES = new Set(['queued', 'sending', 'sent', 'delivered', 'read'])
const TERMINAL_FAILURE_STATUSES = new Set(['undelivered', 'failed'])

export function classifyTwilioMessageStatus(payload: TwilioStatusCallbackPayload): StatusCallbackAction {
  const { messageStatus, errorCode, channelStatusMessage } = payload

  if (NOOP_STATUSES.has(messageStatus)) {
    return { action: 'noop' }
  }

  if (TERMINAL_FAILURE_STATUSES.has(messageStatus)) {
    const detail = channelStatusMessage ?? (errorCode ? `ErrorCode ${errorCode}` : messageStatus)
    return { action: 'mark_failed', error: `Twilio status callback: ${messageStatus} (${detail})` }
  }

  return { action: 'unrecognized_status' }
}
