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
//       -> on 429: UPDATE error=RATE_LIMITED_MARKER, status LEFT at
//         'sending' -- genuinely retryable, see the 429 note below.
//       -> on 5xx / network failure (retryable, ambiguous): ledger row
//         LEFT at 'sending' -- reconciliation is item F's job (031's own
//         STUCK-CLAIM RECONCILIATION section), out of scope here.
// The claim commits BEFORE any Twilio call so a synchronous send failure
// can never leave a session activated with nothing actually sent. RPC
// activation runs BEFORE the terminal ledger UPDATE so a mid-write crash
// leaves only the LEDGER stale, never the session (§1's own reasoning,
// restated at each write below).
//
// 429 IS RETRYABLE -- DECIDED (Aravind, 2026-08-27), AND WHY IT IS SAFE
// HERE AND NOWHERE ELSE IN THIS FILE. A 429 is Twilio explicitly
// REJECTING the request before doing anything with it -- nothing was
// delivered, so re-claiming and re-attempting cannot double-send. A
// network timeout or a 5xx carries no such proof: the request may have
// been received and even accepted before the failure occurred, which is
// exactly the (i)/(ii) ambiguity migration 031's own header rejects blind
// re-claim over (STUCK-CLAIM RECONCILIATION section). Those two stay
// alert-only, ledger left at 'sending', item F's scan (out of scope
// here) -- this file does not widen re-claiming to them.
//
// THE MECHANISM, narrow by construction so it cannot widen by accident.
// A 429 does NOT retry in-process -- it marks the existing row's `error`
// column with RATE_LIMITED_MARKER and returns, leaving status='sending'.
// The NEXT triggerCheckIn call for the SAME event_key (the next cron
// tick, not built here -- see item E) hits the claim INSERT's UNIQUE
// violation as always, but instead of unconditionally treating that as
// "already claimed," attempts an ATOMIC conditional UPDATE: only a row
// that is STILL `status='sending' AND error=RATE_LIMITED_MARKER` at the
// moment of that UPDATE is re-taken (a compare-and-swap, so two
// concurrent callers can never both win the same stuck row -- the second
// one's UPDATE matches zero rows and falls through to 'already_claimed'
// exactly like today's behaviour). The condition is on the RECORDED
// REASON, never on `status` alone and never on row age -- a row stuck at
// 'sending' for a 5xx or a network exception has `error IS NULL`, not the
// marker, so it is structurally ineligible for re-claim by this same
// code path. There is no separate "retry old rows" sweep to widen by
// mistake; the only door in is this one conditional UPDATE.

import type { SupabaseClient } from '@supabase/supabase-js'
import * as Sentry from '@sentry/nextjs'
import { createServiceClient } from '@/lib/supabase/service'
import { applyMorningFlowTurn } from '@/lib/whatsapp/flows/morning'
import { applyEveningFlowTurn } from '@/lib/whatsapp/flows/evening'
import { sendWhatsAppTemplate } from './send'
import { buildMorningTemplate, selectEveningTemplate } from './templates'

export type Checkpoint = 'morning_send' | 'evening_send'

// Recorded in outbound_sends.error (not the status column -- status stays
// 'sending' throughout, matching every other "left ambiguous" case) to
// mark a row as safe to re-claim. Never matched against by anything other
// than the exact string equality check in the re-claim UPDATE below.
//
// INVARIANT THIS MARKER DEPENDS ON, NOT SCHEMA-ENFORCED -- CHECKED, NOT
// ASSUMED (2026-08-28): no .update() in this file may leave a row at
// status='sending' while writing anything into `error` other than `null`
// or this exact literal. The CAS below matches on `status='sending' AND
// error=<this marker>` -- that's only safe because the one writer of REAL
// Twilio error text into `error` always sets status='failed' in the SAME
// atomic UPDATE (a 'failed' row can never satisfy the CAS's status half
// regardless of its text). outbound_sends.error is a plain nullable TEXT
// column with no CHECK tying its content to status, so nothing in the
// schema enforces this -- it is enforced by
// test/unit/outbound-trigger-cas-invariant.test.ts, a static source guard
// that scans this file's own .update() calls and fails if a future change
// (e.g. logging a 5xx's message into `error` for debugging, a natural-
// looking addition that says nothing about re-claim semantics) violates
// it. Keep that test passing rather than re-deriving this reasoning from
// scratch if it ever fails.
const RATE_LIMITED_MARKER = 'rate_limited_429_retryable'

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
  /** Injectable, defaulting to global `fetch` when omitted -- see send.ts's own doc for why this must be injected rather than stubbed globally in a test. */
  fetchFn?: typeof fetch
}

export type TriggerOutcome =
  | { outcome: 'already_claimed' }
  | { outcome: 'sent'; twilioSid: string }
  | { outcome: 'failed'; errorCode?: string; errorMessage?: string }
  | { outcome: 'ambiguous' }
  | { outcome: 'rate_limited' }

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

  let claimId: string
  if (claimError) {
    // Postgres unique violation -- '23505', same convention as
    // lib/whatsapp/idempotency.ts's own message-SID dedup. A prior claim
    // (this tick or an earlier one) already exists for this exact
    // checkpoint+engineer+day.
    if (claimError.code !== '23505') {
      throw new Error(`triggerCheckIn: claim INSERT failed for ${eventKey}/${params.engineerId}: ${claimError.message}`)
    }
    // RE-CLAIM ATTEMPT -- see the file header's "429 IS RETRYABLE" note
    // for the full argument. Atomic conditional UPDATE (compare-and-swap):
    // only succeeds if the existing row is STILL exactly
    // status='sending' AND error=RATE_LIMITED_MARKER at this instant, so
    // two concurrent callers can never both win it. Any other state
    // (already 'sent'/'failed', or stuck at 'sending' for a non-429
    // reason, or another caller already re-claimed it) matches zero rows
    // and falls through to 'already_claimed', unchanged from before this
    // fix.
    const { data: reclaimed, error: reclaimError } = await supabase
      .from('outbound_sends')
      .update({ error: null, updated_at: new Date().toISOString() })
      .eq('tenant_id', params.tenantId)
      .eq('recipient_user_id', params.engineerId)
      .eq('event_key', eventKey)
      .eq('status', 'sending')
      .eq('error', RATE_LIMITED_MARKER)
      .select('id')
      .maybeSingle()
    if (reclaimError) {
      throw new Error(`triggerCheckIn: re-claim UPDATE failed for ${eventKey}/${params.engineerId}: ${reclaimError.message}`)
    }
    if (!reclaimed) {
      return { outcome: 'already_claimed' }
    }
    claimId = (reclaimed as { id: string }).id
  } else {
    claimId = (claimRow as { id: string }).id
  }

  // 2. SEND. Only after the claim is durably committed.
  let sendResult
  try {
    sendResult = await sendWhatsAppTemplate(
      {
        to: params.whatsappNumber,
        contentSid: template.contentSid,
        contentVariables: template.contentVariables,
      },
      params.fetchFn,
    )
  } catch (err) {
    // Network-level failure -- no HTTP response at all, same "retryable but
    // ambiguous" bucket as a Twilio 5xx below: whether Twilio actually
    // received the request is genuinely unknown. Ledger row is LEFT at
    // 'sending' -- reconciling a stuck row is item F's job (out of scope
    // here; see 031's own STUCK-CLAIM RECONCILIATION section for why a
    // blind retry is rejected there). No RPC call.
    // DEDUP: per (reason, engineer, IST day), same convention as
    // reportMorningSweepAnomalies/roster.ts's reportUnreachableEngineer.
    // This exact branch cannot itself repeat for the SAME event_key under
    // today's code -- a network exception leaves the row un-reclaimable
    // (no marker written), so a later call for this event_key short-
    // circuits to already_claimed before ever reaching another Twilio
    // call. Fingerprinted anyway for consistency with the other five
    // branches and so a chronic connectivity issue recurring across
    // different engineers/checkpoints on the SAME day still collapses
    // sensibly rather than relying on Sentry's own default grouping.
    Sentry.captureException(err, {
      fingerprint: ['outbound-send', 'network_exception', params.engineerId, params.logDate],
      tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
      extra: { eventKey, engineerId: params.engineerId, claimId },
    })
    return { outcome: 'ambiguous' }
  }

  if (!sendResult.ok) {
    if (sendResult.status === 429) {
      // RETRYABLE, unlike every other branch here -- see the file header's
      // "429 IS RETRYABLE" note for the full argument (Twilio explicitly
      // rejected the request; nothing was delivered, so re-claiming cannot
      // double-send). Mark the row re-claimable and leave it at 'sending'
      // -- the NEXT triggerCheckIn call for this exact event_key wins it
      // via the atomic conditional UPDATE above. No RPC call on this path.
      const { error: updateError } = await supabase
        .from('outbound_sends')
        .update({ error: RATE_LIMITED_MARKER, updated_at: new Date().toISOString() })
        .eq('id', claimId)
      if (updateError) {
        throw new Error(`triggerCheckIn: failed to mark ${claimId} rate-limited: ${updateError.message}`)
      }
      // DEDUP: per (reason, engineer, IST day) -- THE branch this matters
      // most for. This is the only outcome that is genuinely re-claimable,
      // so a persistently rate-limited engineer can page THIS exact
      // message once per retry attempt for the same event_key, all day,
      // for as long as the (not-yet-built) caller keeps retrying -- see
      // docs/plans/pass1-outbound-send-plan.md's own item-E requirement
      // recording the retry-budget question this depends on. Without this
      // fingerprint, every attempt would open a fresh issue instead of
      // collapsing into one growing one.
      Sentry.captureMessage('outbound-send: Twilio 429 rate limit, will retry next tick', {
        level: 'warning',
        fingerprint: ['outbound-send', 'rate_limited_429', params.engineerId, params.logDate],
        tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
        extra: { eventKey, engineerId: params.engineerId, claimId },
      })
      return { outcome: 'rate_limited' }
    }
    if (sendResult.status >= 500) {
      // Retryable but ambiguous, same reasoning as the network-exception
      // branch above -- leave the ledger row at 'sending'.
      // DEDUP: per (reason, engineer, IST day). Same structural note as
      // the network-exception branch above -- a 5xx is NOT re-claimable
      // (the CAS requires the 429 marker, never written here), so this
      // exact event_key cannot retrigger this branch a second time under
      // today's code. Fingerprinted for consistency and to collapse a
      // chronic-5xx day across checkpoints, not because a single
      // event_key can page it repeatedly.
      Sentry.captureMessage('outbound-send: Twilio 5xx on template send', {
        level: 'warning',
        fingerprint: ['outbound-send', 'twilio_5xx', params.engineerId, params.logDate],
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
    // DEDUP: per (reason, engineer, IST day). status='failed' is terminal
    // -- the event_key can never be re-claimed again (the CAS requires
    // status='sending'), so this branch fires at most once per event_key.
    // Fingerprinted for consistency and to collapse a bad-number/quality-
    // rating-class problem recurring across checkpoints on the same day,
    // not because a single event_key can page it repeatedly.
    Sentry.captureMessage('outbound-send: Twilio rejected template send (non-retryable)', {
      level: 'error',
      fingerprint: ['outbound-send', 'twilio_4xx_failed', params.engineerId, params.logDate],
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
    // DEDUP: per (reason, engineer, IST day). The row becomes terminal
    // ('sent') regardless of this anomaly, so this exact event_key cannot
    // retrigger this branch. Fingerprinted for consistency and to
    // collapse a genuinely recurring race (the same engineer hitting this
    // more than once in a day, across morning/evening checkpoints) into
    // one issue instead of two unrelated-looking ones.
    Sentry.captureMessage('outbound-send: RPC did not return "start" on a startFlow:true call', {
      level: 'error',
      fingerprint: ['outbound-send', 'rpc_not_start', params.engineerId, params.logDate],
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
    // DEDUP: per (reason, engineer, IST day). A message was genuinely
    // delivered here -- this event_key stays stuck at status='sending'
    // with error=null afterward (not re-claimable: the CAS needs the 429
    // marker, never written on this path), so it cannot retrigger this
    // branch again. Fingerprinted for consistency, same as the rest.
    Sentry.captureException(sentUpdateError, {
      fingerprint: ['outbound-send', 'ledger_update_failed', params.engineerId, params.logDate],
      tags: { feature: 'outbound-send', checkpoint: params.checkpoint },
      extra: { eventKey, engineerId: params.engineerId, claimId, twilioSid: sendResult.sid },
    })
  }

  return { outcome: 'sent', twilioSid: sendResult.sid }
}
