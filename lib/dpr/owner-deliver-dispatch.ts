// The owner_deliver job handler -- stage 2 of docs/dpr-delivery-versioning-
// plan.md's two-stage owner delivery (§2a/§2e), gated by §37(c)/(d) of
// design-decisions-beta-feedback.md. Built 2026-09-02, application code
// only -- migration 034 (already live on production) is the schema this
// handler reads and writes; no migration, no apply, nothing here touches a
// database beyond reads until a real send happens.
//
// SHIPS AND REACHES NOBODY YET -- STATED PLAINLY, NOT DISCOVERED LATER
// (Aravind, 2026-09-02). Every REPORT-route row this handler processes
// today writes `skipped_unverified` on its very first send attempt,
// because no owner in production has a verified email -- the confirm
// route that sets `notification_email_verified_at` is not built, and the
// beta-provisioning operator script that would create real owner rows in
// the first place is not built either. This handler is NECESSARY and NOT
// SUFFICIENT. What else must exist before owner delivery reaches anyone:
//   1. The confirm-email route (034's own §5/§12f -- token-gated write to
//      notification_email_verified_at). NOT built here.
//   2. The beta-provisioning operator script (034's own §2j/A1 -- the
//      INSERT that creates a real `role='owner'` row with a
//      notification_email in the first place). NOT built here.
//   3. The eveningClose/ownerSend cron entries that actually ENQUEUE an
//      owner_deliver job for a real project-day. NOT built here -- nothing
//      in this codebase calls `enqueueJob('owner_deliver', ...)` anywhere,
//      confirmed by grep, and that stays true after this file.
// A reader merging this handler should not read a green test suite as "owner
// delivery works now" -- it means the RECEIVING END is ready for the day the
// other three pieces exist.
//
// JOB GRANULARITY -- DECIDED HERE, NOT SPECIFIED ELSEWHERE (see this
// session's own report before writing). Neither `decideOwnerDeliveryRoute`
// nor `renderEmailReport` decide whether the owner receives one send per
// engineer or one aggregated send per project-day -- both explicitly punt
// the question to "whoever builds the ownerSend handler." This file: ONE
// job per (project_id, log_date), not per engineer. Reasoning:
//   - `dpr-delivery-versioning-plan.md` §2a: "the 20:30 cron fires and
//     sends whatever `dprs` currently holds" -- `dprs` rows are per-
//     engineer (028's key widening), so a project's owner-send is
//     inherently an operation over every engineer row for the day, not a
//     single row.
//   - 034's own PROPAGATION GAP note: the no-report notice is sent ONCE
//     per owner per project-day, not once per engineer -- sending N
//     duplicate "nothing to report" messages when N engineers all lack
//     evening data would be a real, visible defect.
//
// THE REPORT PATH SENDS PER ENGINEER -- BUILT AS SCOPED, RECORDED AS AN
// OPEN PRODUCT QUESTION, NOT DECIDED HERE (Aravind, 2026-09-02). An owner
// with four engineers on one project gets four separate emails at 20:30,
// one per engineer's report. This is consistent with `dprs` being
// per-engineer end to end, and it is what render-email.ts's own renderer
// already produces (one call = one engineer's report) -- but it is also
// the owner's actual inbox experience, and nobody has looked at a real one
// and decided whether that is what an owner wants versus one combined
// email per project-day. Full argument, not repeated here:
// docs/reviews/owner-deliver-handler-record.md.
//
// THE NOTICE PATH DOES NOT SEND PER ENGINEER -- exactly one send (WhatsApp
// or its email fallback) per project-day when ANY engineer's row routes to
// 'notice', with the SAME outcome fanned out to every such row in one
// batch UPDATE. This is what actually resolves 034's "N dprs rows, one
// WhatsApp outcome" gap -- one real send event, one UPDATE with an
// `IN (...)` over the matched row ids.
//
// THE TERMINAL-VALUE SKIP -- A DECISION, NOT A CITATION (Aravind,
// 2026-09-02). Stage 2 is documented as the unconditional, authoritative
// writer over stage 1's leftovers (`delivery_status` can be overwritten
// from `pending`, `pm_notified`, or `skipped_no_template` with equal
// validity -- dpr-delivery-versioning-plan.md line ~494) -- so this
// handler does NOT gate on the row's current value before writing a new
// stage-2 outcome. What it DOES gate on: a row already at a STAGE-2
// TERMINAL value (`delivered`, `owner_send_failed`, `no_report_sent`,
// `no_report_failed`, `skipped_unverified`) is skipped outright. Reason: a
// retried job (network blip, partial-batch failure, exponential-backoff
// retry) must not re-send to an owner who already received the real
// message -- there is no claim-before-send ledger insulating this handler
// from double-send the way `outbound_sends` insulates the engineer
// checkpoints, so this same-row-already-terminal check is what stands in
// for one.
//
// WHAT CANNOT BE TESTED LOCALLY, STATED PLAINLY: any real send to Resend
// or Twilio (no live credentials in this sandbox); the async bounce/
// complaint webhook path entirely (`delivered -> owner_send_failed` is a
// legal, expected async transition per 034's own transition table, but the
// webhook that would ever write it -- §2g -- does not exist, so that
// transition is untestable end to end until it's built, separately);
// genuine concurrent job claims (this project's own standing rule --
// concurrency/lock/race verification is CI-only in this sandbox).
//
// WHAT CAN BE TESTED LOCALLY, AND IS (test/unit/owner-deliver-dispatch.test.ts,
// test/owner-deliver-job.test.ts -- named distinctly from the unit file,
// see that file's own header for why): the routing fan-out (which rows go
// to which path, mocked send functions), the copy-drift test
// (test/unit/owner-no-report.test.ts), payload construction through the
// injected send seam (asserting sendEmail/sendWhatsAppTemplate are called
// with the right arguments, not asserting a real provider response), the
// skipped_unverified gate, and the batch-write fan-out against real
// test-db.

import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import type { Json } from '@/types/database'
import { decideOwnerDeliveryRoute } from './owner-delivery-route'
import { renderEmailReport, type EngineerReportMeta, type RenderedCheckInStatus } from './render-email'
import { formatDate } from './dispatch'
import type { EngineerDprFacts } from './schema'
import {
  OWNER_NO_REPORT_TEMPLATE_SID,
  buildOwnerNoReportTemplateVariables,
  renderOwnerNoReportEmail,
} from './owner-no-report'
import { sendEmail as sendEmailReal, type SendEmailParams, type SendEmailResult } from '@/lib/email/send'
import {
  sendWhatsAppTemplate as sendWhatsAppTemplateReal,
  type SendTemplateParams,
  type SendTemplateResult,
} from '@/lib/whatsapp/outbound/send'

export interface OwnerDeliverJobPayload {
  project_id: string
  log_date: string
}

// Stage-2 terminal values -- a row already at one of these has already
// been handled by THIS handler (or a prior run of it) and must not be
// re-sent to. Deliberately a whitelist of what to SKIP, not a whitelist of
// what to PROCESS (see the ELIGIBLE set below) -- two separate lists so a
// future, unrecognised delivery_status value fails toward "not processed"
// rather than "silently re-sent to."
const STAGE_2_TERMINAL = new Set(['delivered', 'owner_send_failed', 'no_report_sent', 'no_report_failed', 'skipped_unverified'])

// Rows eligible for stage 2 to act on -- every value stage 1 (PM-notify)
// can leave behind, PLUS the row's own starting state. `paused` and
// `skipped_no_data` are neither here nor in STAGE_2_TERMINAL -- both are
// deliberately out of this handler's scope (paused: a different, unbuilt
// feature's semantics; skipped_no_data: written by an earlier stage for a
// day with no data at all, nothing for this handler to act on) and are
// silently left alone.
const STAGE_2_ELIGIBLE = new Set(['pending', 'pm_notified', 'skipped_no_template', 'failed'])

export interface DprRow {
  id: string
  engineer_id: string
  delivery_status: string
  structured: Json | null
}

interface StructuredReportShape {
  facts: EngineerDprFacts
  verdict: string
  morning_status: RenderedCheckInStatus
  evening_status: RenderedCheckInStatus
}

export type DprRowStage2Classification = 'eligible' | 'already_terminal' | 'out_of_scope'

/**
 * Pure -- testable without a client. See STAGE_2_ELIGIBLE/STAGE_2_TERMINAL's
 * own comments above for the reasoning behind each bucket; 'out_of_scope'
 * covers `paused`/`skipped_no_data` and any future, unrecognised value --
 * deliberately the DEFAULT case, so a new CHECK value this handler has
 * never heard of fails toward "not processed," never "silently re-sent to."
 */
export function classifyDprRowForStage2(deliveryStatus: string): DprRowStage2Classification {
  if (STAGE_2_ELIGIBLE.has(deliveryStatus)) return 'eligible'
  if (STAGE_2_TERMINAL.has(deliveryStatus)) return 'already_terminal'
  return 'out_of_scope'
}

/**
 * Pure -- testable without a client or a real decideOwnerDeliveryRoute
 * call site elsewhere. Takes ELIGIBLE rows only (see classifyDprRowForStage2)
 * and the evening_submitted_at fact per engineer, reuses
 * decideOwnerDeliveryRoute exactly as instructed (not reimplemented), and
 * returns the two buckets the real handler sends to differently: N separate
 * report emails vs. exactly one fanned-out notice send.
 */
export function partitionEligibleRows(
  eligibleRows: DprRow[],
  eveningByEngineer: ReadonlyMap<string, string | null>,
): { reportRows: DprRow[]; noticeRows: DprRow[] } {
  const reportRows: DprRow[] = []
  const noticeRows: DprRow[] = []
  for (const row of eligibleRows) {
    const route = decideOwnerDeliveryRoute(eveningByEngineer.get(row.engineer_id) ?? null)
    if (route === 'report') reportRows.push(row)
    else noticeRows.push(row)
  }
  return { reportRows, noticeRows }
}

export interface OwnerDeliverResult {
  reportSent: number
  reportFailed: number
  reportSkippedUnverified: number
  noticeSent: boolean | null // null = no notice needed this run
  noticeFailed: boolean
  noticeSkippedUnverified: boolean
  skippedAlreadyTerminal: number
  skippedNoDprs: boolean
}

async function batchWriteDeliveryStatus(
  client: SupabaseClient,
  dprIds: string[],
  status: string,
  extra: Record<string, unknown> = {},
): Promise<void> {
  if (dprIds.length === 0) return
  const { error } = await client
    .from('dprs')
    .update({ delivery_status: status, ...extra })
    .in('id', dprIds)
  if (error) {
    // Mirrors trigger.ts's own "the send genuinely happened, only the
    // bookkeeping write failed" reasoning -- alert, don't throw. Throwing
    // here would fail the whole job and risk a retry RE-SENDING to an
    // owner who already received the real message.
    Sentry.captureException(error, {
      fingerprint: ['owner-deliver', 'batch_write_failed', status],
      tags: { feature: 'owner-deliver' },
      extra: { dprIds, status },
    })
  }
}

export async function handleOwnerDeliverJob(
  payload: OwnerDeliverJobPayload,
  deps: {
    supabaseClient?: SupabaseClient
    // Injectable, defaulting to the real send.ts/send functions -- same DI
    // shape as trigger.ts's own fetchFn parameter, and for the identical
    // reason: a test exercising the routing/payload-construction logic
    // must not make a real Twilio/Resend call, and injecting the whole
    // send FUNCTION (not just fetch) is what lets a unit test assert what
    // this handler SENDS without needing to fake an HTTP response shape
    // for two different providers.
    sendEmailFn?: (params: SendEmailParams) => Promise<SendEmailResult>
    sendWhatsAppFn?: (params: SendTemplateParams) => Promise<SendTemplateResult>
  } = {},
): Promise<OwnerDeliverResult> {
  const client = deps.supabaseClient ?? createServiceClient()
  const sendEmail = deps.sendEmailFn ?? sendEmailReal
  const sendWhatsAppTemplate = deps.sendWhatsAppFn ?? sendWhatsAppTemplateReal

  const { data: project, error: projectError } = await client
    .from('projects')
    .select('name, tenant_id, owner_user_id')
    .eq('id', payload.project_id)
    .single()
  if (projectError) throw projectError
  if (!project.owner_user_id) {
    throw new Error(`handleOwnerDeliverJob: project ${payload.project_id} has no owner_user_id -- nobody to deliver to.`)
  }

  // profile-lookup-guard:allow-id-eq -- project.owner_user_id is a resolved
  // users.id (projects.owner_user_id, a plain FK column), never an auth
  // uid -- same reasoning as dispatch.ts's own identical tag, one column
  // over.
  const { data: owner, error: ownerError } = await client
    .from('users')
    .select('full_name, whatsapp_number, notification_email, notification_email_verified_at')
    .eq('id', project.owner_user_id)
    .single()
  if (ownerError) throw ownerError

  const { data: dprs, error: dprsError } = await client
    .from('dprs')
    .select('id, engineer_id, delivery_status, structured')
    .eq('project_id', payload.project_id)
    .eq('log_date', payload.log_date)
  if (dprsError) throw dprsError

  const allRows = (dprs ?? []) as DprRow[]
  if (allRows.length === 0) {
    return {
      reportSent: 0,
      reportFailed: 0,
      reportSkippedUnverified: 0,
      noticeSent: null,
      noticeFailed: false,
      noticeSkippedUnverified: false,
      skippedAlreadyTerminal: 0,
      skippedNoDprs: true,
    }
  }

  const eligibleRows = allRows.filter((r) => classifyDprRowForStage2(r.delivery_status) === 'eligible')
  const skippedAlreadyTerminal = allRows.filter((r) => classifyDprRowForStage2(r.delivery_status) === 'already_terminal').length

  if (eligibleRows.length === 0) {
    return {
      reportSent: 0,
      reportFailed: 0,
      reportSkippedUnverified: 0,
      noticeSent: null,
      noticeFailed: false,
      noticeSkippedUnverified: false,
      skippedAlreadyTerminal,
      skippedNoDprs: false,
    }
  }

  const engineerIds = eligibleRows.map((r) => r.engineer_id)
  const { data: logs, error: logsError } = await client
    .from('daily_logs')
    .select('engineer_id, evening_submitted_at')
    .eq('project_id', payload.project_id)
    .eq('log_date', payload.log_date)
    .in('engineer_id', engineerIds)
  if (logsError) throw logsError
  const eveningByEngineer = new Map((logs ?? []).map((l) => [l.engineer_id as string, l.evening_submitted_at as string | null]))

  const { data: engineerUsers, error: engineerUsersError } = await client
    .from('users')
    .select('id, full_name')
    .in('id', engineerIds)
  if (engineerUsersError) throw engineerUsersError
  const engineerNameById = new Map((engineerUsers ?? []).map((u) => [u.id as string, (u.full_name as string | null) ?? 'Unnamed engineer']))

  const { reportRows, noticeRows } = partitionEligibleRows(eligibleRows, eveningByEngineer)

  const canSendReportEmail = !!owner.notification_email_verified_at
  const formattedDate = formatDate(payload.log_date)

  let reportSent = 0
  let reportFailed = 0
  let reportSkippedUnverified = 0

  if (reportRows.length > 0) {
    if (!canSendReportEmail) {
      await batchWriteDeliveryStatus(client, reportRows.map((r) => r.id), 'skipped_unverified')
      reportSkippedUnverified = reportRows.length
    } else {
      for (const row of reportRows) {
        if (!row.structured) {
          // Report route implies evening data exists, which implies
          // dpr_generate should have populated `structured` -- a null
          // here means generation hasn't finished (or failed) for this
          // specific row. Treat as a send failure for THIS row only,
          // never crash the whole batch over one engineer's row.
          Sentry.captureException(new Error('owner_deliver: report route row has null structured'), {
            fingerprint: ['owner-deliver', 'null_structured', row.id],
            tags: { feature: 'owner-deliver' },
            extra: { dprId: row.id, projectId: payload.project_id, logDate: payload.log_date },
          })
          await batchWriteDeliveryStatus(client, [row.id], 'owner_send_failed')
          reportFailed++
          continue
        }
        const structured = row.structured as unknown as StructuredReportShape
        const meta: EngineerReportMeta = {
          project_name: project.name as string,
          engineer_name: engineerNameById.get(row.engineer_id) ?? 'Unnamed engineer',
          formatted_date: formattedDate,
        }
        const rendered = renderEmailReport(structured.facts, structured.verdict, structured.morning_status, structured.evening_status, meta)
        const result = await sendEmail({
          to: owner.notification_email as string,
          subject: rendered.subject,
          text: rendered.text,
          html: rendered.html,
        })
        if (result.ok) {
          await batchWriteDeliveryStatus(client, [row.id], 'delivered', { delivered_owner_at: new Date().toISOString() })
          reportSent++
        } else {
          Sentry.captureMessage('owner-deliver: report email rejected by provider', {
            level: 'error',
            fingerprint: ['owner-deliver', 'owner_send_failed', row.id],
            tags: { feature: 'owner-deliver' },
            extra: { dprId: row.id, status: result.status, errorMessage: result.errorMessage, responseShape: result.responseShape },
          })
          await batchWriteDeliveryStatus(client, [row.id], 'owner_send_failed')
          reportFailed++
        }
      }
    }
  }

  let noticeSent: boolean | null = null
  let noticeFailed = false
  let noticeSkippedUnverified = false

  if (noticeRows.length > 0) {
    const noticeIds = noticeRows.map((r) => r.id)
    const useWhatsApp = !!owner.whatsapp_number

    if (useWhatsApp) {
      const result = await sendWhatsAppTemplate({
        to: owner.whatsapp_number as string,
        contentSid: OWNER_NO_REPORT_TEMPLATE_SID,
        contentVariables: buildOwnerNoReportTemplateVariables(project.name as string, payload.log_date),
      })
      if (result.ok) {
        await batchWriteDeliveryStatus(client, noticeIds, 'no_report_sent')
        noticeSent = true
      } else {
        Sentry.captureMessage('owner-deliver: no-report WhatsApp notice rejected by Twilio', {
          level: 'error',
          fingerprint: ['owner-deliver', 'no_report_failed', payload.project_id, payload.log_date],
          tags: { feature: 'owner-deliver' },
          extra: { status: result.status, errorCode: result.errorCode, errorMessage: result.errorMessage, responseShape: result.responseShape },
        })
        await batchWriteDeliveryStatus(client, noticeIds, 'no_report_failed')
        noticeSent = false
        noticeFailed = true
      }
    } else if (canSendReportEmail) {
      const rendered = renderOwnerNoReportEmail(project.name as string, payload.log_date)
      const result = await sendEmail({
        to: owner.notification_email as string,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
      })
      if (result.ok) {
        await batchWriteDeliveryStatus(client, noticeIds, 'no_report_sent')
        noticeSent = true
      } else {
        Sentry.captureMessage('owner-deliver: no-report email fallback rejected by provider', {
          level: 'error',
          fingerprint: ['owner-deliver', 'no_report_failed', payload.project_id, payload.log_date],
          tags: { feature: 'owner-deliver' },
          extra: { status: result.status, errorMessage: result.errorMessage, responseShape: result.responseShape },
        })
        await batchWriteDeliveryStatus(client, noticeIds, 'no_report_failed')
        noticeSent = false
        noticeFailed = true
      }
    } else {
      await batchWriteDeliveryStatus(client, noticeIds, 'skipped_unverified')
      noticeSkippedUnverified = true
    }
  }

  return {
    reportSent,
    reportFailed,
    reportSkippedUnverified,
    noticeSent,
    noticeFailed,
    noticeSkippedUnverified,
    skippedAlreadyTerminal,
    skippedNoDprs: false,
  }
}
