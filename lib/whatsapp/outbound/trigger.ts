// The claim -> send -> activate orchestration for ONE engineer + ONE
// checkpoint -- Pass 1 item B, the piece everything else (item E's cron
// entries, item D's status-callback route, item F's cron-didn't-fire
// check) depends on. Out of scope for this file, deliberately: no
// vercel.json entry, no status-callback route, no cron-didn't-fire check
// -- those are separate items, built and reviewed on their own terms.
//
// ORDERING (docs/plans/pass1-outbound-send-plan.md §1, argued in full
// there -- restated here only as the consequence, not re-derived):
//   INSERT outbound_sends (status='sending'), committed
//     -> POST .../Messages
//       -> on 2xx: apply_{morning,evening}_flow_turn(startFlow: true)
//         -> UPDATE outbound_sends SET status='sent', twilio_sid=...
//       -> on non-2xx (4xx, non-retryable): UPDATE status='failed',
//         error=..., NO RPC call, session untouched
//       -> on 5xx / network failure (retryable, ambiguous): ledger row
//         LEFT at 'sending' -- reconciliation is item F's job (031's own
//         STUCK-CLAIM RECONCILIATION section), out of scope here.
// The claim commits BEFORE any Twilio call so a synchronous send failure
// can never leave a session activated with nothing actually sent. RPC
// activation runs BEFORE the terminal ledger UPDATE so a mid-write crash
// leaves only the LEDGER stale, never the session (§1's own reasoning,
// restated at each write below).

import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { applyMorningFlowTurn } from '@/lib/whatsapp/flows/morning'
import { applyEveningFlowTurn } from '@/lib/whatsapp/flows/evening'
import { sendWhatsAppTemplate } from './send'
import { buildMorningTemplate, selectEveningTemplate } from './templates'

export type Checkpoint = 'morning_send' | 'evening_send'

export interface TriggerParams {
  checkpoint: Checkpoint
  tenantId: string
  projectId: string
  engineerId: string
  engineerName: string
  projectName: string
  /** Bare E.164, e.g. "+919876543210" -- NOT "whatsapp:"-prefixed (matches users.whatsapp_number's own stored form and outbound_sends.to_phone_number's CHECK constraint). */
  whatsappNumber: string
  /** IST calendar date, "YYYY-MM-DD" -- the day this checkpoint is for. */
  logDate: string
  /** daily_logs.morning_plan for today, or null/undefined -- only used when checkpoint === 'evening_send'; ignored for 'morning_send'. */
  morningPlan?: string | null
  supabaseClient?: SupabaseClient
}

export type TriggerOutcome =
  | { outcome: 'already_claimed' }
  | { outcome: 'sent'; twilioSid: string }
  | { outcome: 'failed'; errorCode?: string; errorMessage?: string }
  | { outcome: 'ambiguous' }

export async function triggerCheckIn(params: TriggerParams): Promise<TriggerOutcome> {
  const supabase = params.supabaseClient ?? createServiceClient()
  // event_key format: '<checkpoint>:<IST date>' -- migration 031's own CHECK
  // constraint (`^[a-z_]+:\d{4}-\d{2}-\d{2}$`) and the entire idempotency
  // mechanism, paired with the UNIQUE(tenant_id, recipient_user_id,
  // event_key) constraint below.
  const eventKey = `${params.checkpoint}:${params.logDate}`

  const template =
    params.checkpoint === 'morning_send'
      ? buildMorningTemplate(params.engineerName, params.projectName)
      : selectEveningTemplate(params.engineerName, params.projectName, params.morningPlan)

  // 1. CLAIM. content_sid/to_phone_number are NOT NULL on outbound_sends by
  // design (031's own header: both are required Twilio POST parameters,
  // known by construction before this INSERT, since the claim precedes the
  // send). Commits before any Twilio call.
  const { data: claimRow, error: claimError } = await supabase
    .from('outbound_sends')
    .insert({
      tenant_id: params.tenantId,
      project_id: params.projectId,
      recipient_user_id: params.engineerId,
      event_key: eventKey,
      status: 'sending',
      content_sid: template.contentSid,
      to_phone_number: params.whatsappNumber,
    })
    .select('id')
    .single()

  if (claimError) {
    // Postgres unique violation -- '23505', same convention as
    // lib/whatsapp/idempotency.ts's own message-SID dedup. A prior claim
    // (this tick or an earlier one) already exists for this exact
    // checkpoint+engineer+day -- silent no-op, not an error, no Twilio
    // call ever attempted.
    if (claimError.code === '23505') {
      return { outcome: 'already_claimed' }
    }
    throw new Error(`triggerCheckIn: claim INSERT failed for ${eventKey}/${params.engineerId}: ${claimError.message}`)
  }
  const claimId = (claimRow as { id: string }).id

  // 2. SEND. Only after the claim is durably committed.
  let sendResult
  try {
    sendResult = await sendWhatsAppTemplate({
      to: params.whatsappNumber,
      contentSid: template.contentSid,
      contentVariables: template.contentVariables,
    })
  } catch (err) {
    // Network-level failure -- no HTTP response at all, same "retryable but
    // ambiguous" bucket as a Twilio 5xx below: whether Twilio actually
    // received the request is genuinely unknown. Ledger row is LEFT at
    // 'sending' -- reconciling a stuck row is item F's job (out of scope
    // here; see 031's own STUCK-CLAIM RECONCILIATION section for why a
    // blind retry is rejected there). No RPC call.
    Sentry.captureException(err, {
      tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
      extra: { eventKey, engineerId: params.engineerId, claimId },
    })
    return { outcome: 'ambiguous' }
  }

  if (!sendResult.ok) {
    if (sendResult.status >= 500) {
      // Retryable but ambiguous, same reasoning as the network-exception
      // branch above -- leave the ledger row at 'sending'.
      Sentry.captureMessage('outbound-send: Twilio 5xx on template send', {
        level: 'warning',
        tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
        extra: {
          eventKey,
          engineerId: params.engineerId,
          claimId,
          status: sendResult.status,
          errorCode: sendResult.errorCode,
        },
      })
      return { outcome: 'ambiguous' }
    }
    // Non-retryable (4xx) -- bad/unreachable number, template rejected by
    // Meta, etc. Real, actionable failure (plan §5). Session is NEVER
    // activated on this path -- no RPC call.
    const { error: updateError } = await supabase
      .from('outbound_sends')
      .update({
        status: 'failed',
        error: sendResult.errorMessage ?? `HTTP ${sendResult.status}`,
        updated_at: new Date().toISOString(),
      })
      .eq('id', claimId)
    if (updateError) {
      throw new Error(`triggerCheckIn: failed to mark ${claimId} as failed: ${updateError.message}`)
    }
    Sentry.captureMessage('outbound-send: Twilio rejected template send (non-retryable)', {
      level: 'error',
      tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
      extra: {
        eventKey,
        engineerId: params.engineerId,
        claimId,
        status: sendResult.status,
        errorCode: sendResult.errorCode,
        errorMessage: sendResult.errorMessage,
      },
    })
    return { outcome: 'failed', errorCode: sendResult.errorCode, errorMessage: sendResult.errorMessage }
  }

  // 3. ACTIVATE. Twilio confirmed synchronous acceptance -- only now does
  // session state change (§1's ordering: every failure branch above
  // returns before this point, so a failed/ambiguous send can never
  // strand a session at step 1 with nothing actually delivered).
  // message: '' -- a startFlow:true call never reads p_message inside the
  // RPC's own START branch (confirmed directly against
  // supabase/migrations/030_morning_flow_attendance.sql before writing
  // this file: v_text is computed but unused under `IF p_start_flow
  // THEN`), and both wrapper functions' own local parsing of an empty
  // string produces benign "unanswered" shapes the RPC also ignores on
  // this path.
  const rpcParams = {
    phoneNumber: params.whatsappNumber,
    tenantId: params.tenantId,
    userId: params.engineerId,
    projectId: params.projectId,
    message: '',
    startFlow: true as const,
    supabaseClient: supabase,
  }
  const turn =
    params.checkpoint === 'morning_send'
      ? await applyMorningFlowTurn(rpcParams)
      : await applyEveningFlowTurn(rpcParams)

  if (turn.outcome !== 'start') {
    // Named residual case, not solved here (same "residual risk, named,
    // not solved" pattern plan §1 already uses for the async-rejection
    // gap). Twilio already confirmed delivery -- the ledger below still
    // records 'sent', because that is what physically happened -- but an
    // outcome other than 'start' from a startFlow:true call means a
    // session was ALREADY active when the RPC's own lock was acquired: a
    // genuine race (B3's sweep should make this rare, not eliminate it
    // structurally), worth a loud alert to investigate, not a silent
    // accept.
    Sentry.captureMessage('outbound-send: RPC did not return "start" on a startFlow:true call', {
      level: 'error',
      tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
      extra: { eventKey, engineerId: params.engineerId, claimId, rpcOutcome: turn.outcome },
    })
  }

  // Ledger UPDATE after RPC activation, not before -- §1's crash-safety
  // argument: if the process dies between these two writes, the SESSION
  // is already correctly activated (matching reality — the message really
  // was sent), and only the LEDGER is left stale at 'sending', a
  // bookkeeping gap rather than a silent double-ask. The reverse order
  // would instead risk the ledger claiming 'sent' while the session was
  // never actually activated.
  const { error: sentUpdateError } = await supabase
    .from('outbound_sends')
    .update({ status: 'sent', twilio_sid: sendResult.sid, updated_at: new Date().toISOString() })
    .eq('id', claimId)
  if (sentUpdateError) {
    // The message really did send and the session really is activated —
    // only the bookkeeping write failed. Alert, don't throw: throwing here
    // would misrepresent a real, successful send as a failure to whatever
    // caller loop is iterating a roster.
    Sentry.captureException(sentUpdateError, {
      tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
      extra: { eventKey, engineerId: params.engineerId, claimId, twilioSid: sendResult.sid },
    })
  }

  return { outcome: 'sent', twilioSid: sendResult.sid }
}
