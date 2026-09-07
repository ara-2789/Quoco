import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail as sendEmailReal, type SendEmailParams, type SendEmailResult } from '@/lib/email/send'
import { enqueueJob } from '@/lib/queue/jobs'
import { istDateString } from '@/lib/daily-logs/date'

// Ad-hoc menu PR 2, step 5 (docs/plans/adhoc-menu-spec.md). PM lookup + the
// egress email that makes "your Project Manager will see it" true.
//
// PHASE A VERIFIED, 2026-09-07 (Aravind, via scripts/verify-email-delivery.ts):
// a real email sent from the verified quoco.co.in domain (reports@quoco.co.in)
// was CONFIRMED DELIVERED to an address other than the Resend account
// holder's own. The send/status-check pipeline this file's job handler
// calls (lib/email/send.ts's sendEmail + getEmailStatus) is proven working
// end to end, not merely unit-tested. lib/whatsapp/flows/hindrance.ts's own
// HINDRANCE_RESOLVED_REPLY/HINDRANCE_UNSPECIFIED_REPLY now say "Your
// Project Manager will see it" on the strength of this.
//
// STILL NECESSARY, NOT SUFFICIENT, same shape as lib/dpr/owner-deliver-
// dispatch.ts's own header: two things must ALSO be true before this
// module is REACHABLE from a real inbound WhatsApp message, neither built
// here:
//   1. Migration 038 (apply_hindrance_flow_turn) must be applied -- held
//      pending external review as of this file's own commit (see
//      lib/whatsapp/flows/hindrance.ts's own header).
//   2. inbound-start.ts's "1" branch must be wired to call
//      applyHindranceFlowTurn instead of buildItem1InterimReply --
//      deliberately NOT done yet, for the same lockstep reason 038 itself
//      isn't applied yet (that file's own header names migration 035's
//      lockstep hazard as the precedent this avoids repeating).
// Phase A proves the EMAIL CHANNEL works; it says nothing about whether a
// real engineer's hindrance report can reach this handler yet -- it can't,
// until both of the above ship.
//
// OPEN RELIABILITY GAP, RECORDED NOT FIXED (Aravind, 2026-09-07, same
// Phase A round). An earlier test send to a mistyped address
// (arajamani1989.rcpl@gmail.com) bounced (recipient not found) and Resend
// SILENTLY SUPPRESSED that address -- every future send attempt to it will
// be rejected by Resend without ever reaching the recipient's mail server
// again. Nothing in this file (or anywhere else in this codebase) checks
// Resend's suppression list, and no bounce/complaint webhook exists (the
// SAME gap lib/dpr/owner-deliver-dispatch.ts's own header already names
// for owner delivery, one channel-consumer over). CONSEQUENCE: if a real
// PM's email address is ever mistyped, or genuinely stops accepting mail,
// one bounce is enough to permanently and silently blackhole every future
// hindrance notification to them -- `sendEmail`'s result would need to be
// `ok:false` for this handler's own retry-then-dead-letter path to ever
// surface it, and a Resend suppression may not even surface as a
// synchronous rejection (unconfirmed -- not tested this round). NOT FIXED
// HERE, per Aravind's own explicit instruction ("record it, don't build
// it") -- filed as an open item for whoever eventually builds the
// bounce/complaint webhook this codebase has needed since owner-deliver
// shipped.
//
// FIRST USE OF THE SUPABASE ADMIN AUTH API IN THIS CODEBASE -- confirmed by
// grep before writing this, zero prior hits. Necessary because `users` has
// no `email` column at all (only `notification_email`, an OWNER-specific
// workaround -- owners have no auth_id/login). A PM DOES have auth_id and
// authenticates via magic link, so their verified email lives in
// auth.users.email, reachable only through the Admin API
// (supabase.auth.admin.getUserById), which requires the service-role
// client (lib/supabase/service.ts) -- never callable from a browser or
// user-session-aware route, per CLAUDE.md §4.
//
// "NOTIFY ALL, NOT SKIP-AND-SURFACE" -- DECIDED, DELIBERATELY THE OPPOSITE
// OF resolveEngineerProject's OWN POLICY (Aravind, 2026-09-06/07). That
// function skips-and-surfaces on 2+ project_members rows because ambiguity
// there means "I don't know which one write applies to." Here, 2+ PMs on
// one project is not ambiguous at all -- every one of them is a legitimate
// recipient of the same real notification, so all of them get emailed.

export interface PMEmailTarget {
  userId: string
  fullName: string | null
  email: string
}

export type ResolvePMEmailsResult = { outcome: 'resolved'; targets: PMEmailTarget[] } | { outcome: 'zero_pms' }

interface PMUserRow {
  id: string
  full_name: string | null
  auth_id: string | null
}

// Same embedded-join-ambiguity guard as lib/dpr/accountability.ts's own
// extractEngineerRow, one column set over (adds auth_id, drops role/status
// -- this query already filters project_members.role='pm' server-side, so
// nothing here needs to re-check it).
function extractPmUserRow(raw: unknown): PMUserRow {
  const resolved = Array.isArray(raw) ? raw[0] : raw
  const candidate = resolved as Partial<PMUserRow> | null | undefined
  if (!candidate || typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw new Error(
      `resolveProjectPMEmails: project_members -> users join did not resolve to a valid user row (got ${JSON.stringify(raw)}). Refusing to guess a PM identity.`,
    )
  }
  return { id: candidate.id, full_name: candidate.full_name ?? null, auth_id: candidate.auth_id ?? null }
}

/**
 * Resolve every PM's email for a project. Per-PM failures (no auth_id, or
 * the Admin API lookup fails/returns no email) are skipped with a Sentry
 * warning, not fatal to the whole batch -- one broken PM row must not
 * silently block every OTHER PM on the same project from being notified.
 * 'zero_pms' covers both "no project_members row with role='pm'" and
 * "rows existed but none resolved to a usable email" -- the caller does
 * not need to distinguish them, both mean nobody can be emailed right now.
 */
export async function resolveProjectPMEmails(projectId: string, client?: SupabaseClient): Promise<ResolvePMEmailsResult> {
  const supabase = client ?? createServiceClient()

  const { data: members, error } = await supabase
    .from('project_members')
    .select('users!inner(id, full_name, auth_id)')
    .eq('project_id', projectId)
    .eq('role', 'pm')

  if (error) {
    throw new Error(`resolveProjectPMEmails: project_members lookup failed for project ${projectId}: ${error.message}`)
  }

  const pmRows = (members ?? []).map((m) => extractPmUserRow((m as { users: unknown }).users))

  const targets: PMEmailTarget[] = []
  for (const row of pmRows) {
    if (!row.auth_id) {
      Sentry.captureMessage('resolveProjectPMEmails: pm row has no auth_id -- cannot look up email', {
        level: 'warning',
        tags: { feature: 'hindrance-pm-notify' },
        extra: { userId: row.id, projectId },
      })
      continue
    }

    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(row.auth_id)
    const email = authUser?.user?.email
    if (authError || !email) {
      Sentry.captureMessage('resolveProjectPMEmails: auth admin lookup failed or returned no email', {
        level: 'warning',
        tags: { feature: 'hindrance-pm-notify' },
        extra: { userId: row.id, authId: row.auth_id, projectId, authError: authError?.message },
      })
      continue
    }

    targets.push({ userId: row.id, fullName: row.full_name, email })
  }

  if (targets.length === 0) {
    // ERROR level, deliberately louder than the per-row warnings above --
    // per Aravind's own instruction, "zero_pms: Sentry, no send, column
    // stays NULL." A project with a hindrance report and no reachable PM
    // is a real operational gap someone needs to act on, not a transient
    // condition a job retry would ever fix on its own.
    Sentry.captureMessage('resolveProjectPMEmails: zero_pms -- no PM with a resolvable email for this project', {
      level: 'error',
      tags: { feature: 'hindrance-pm-notify' },
      extra: { projectId, pmRowCount: pmRows.length },
    })
    return { outcome: 'zero_pms' }
  }

  return { outcome: 'resolved', targets }
}

// --- Email copy (Aravind, 2026-09-06/07 -- confirmed verbatim, only the
// unspecified-timing line was revised from an earlier draft that dropped
// timing_raw entirely: "That's the engineer's literal words, captured
// specifically so they wouldn't be lost, and the PM is the one person who
// could read 'cant say, depends on shuttering' and understand it.") -------

export interface RenderedHindrancePmEmail {
  subject: string
  text: string
  html: string
}

// Same local, non-shared escapeHtml as owner-no-report.ts/render-email.ts
// -- matches this codebase's own convention of not factoring this into a
// shared util (each email-rendering file keeps its own copy).
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// Fixed lookup, NOT Intl/toLocaleDateString -- same reason lib/dpr/owner-
// no-report.ts's own SHORT_MONTHS exists (checked directly there,
// 2026-09-02): `toLocaleDateString('en-GB', { month: 'short' })` renders
// September as "Sept" (4 letters), not "Sep". NOT importing that file's
// own formatOwnerNoticeDate instead -- its date SHAPE happens to be
// identical ("27 Aug 2026") but it is deliberately frozen to template 14's
// own Meta-approved sample value, an unrelated concern this email must not
// be coupled to (a future template resubmission changing that shape would
// silently drag this email's shape along with it). Same
// don't-share-render-helpers convention this file's own escapeHtml already
// follows, one helper over.
const SHORT_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * IST calendar date for `createdAt` (a hindrance has no log_date of its own
 * -- it is not tied to a daily_logs row -- so the report's own created_at
 * is the only real date it has), rendered "07 Sep 2026". Reuses
 * lib/daily-logs/date.ts's istDateString -- the general-purpose UTC->IST
 * conversion this codebase already shares across checkin-escalations and
 * the Daily Logs board, unlike the frozen owner-notice formatter above.
 */
function formatHindranceReportDate(createdAt: string): string {
  const istDate = istDateString(new Date(createdAt))
  const [year, month, day] = istDate.split('-').map(Number)
  return `${String(day).padStart(2, '0')} ${SHORT_MONTHS[month - 1]} ${year}`
}

export interface HindrancePmNotifyEmailParams {
  projectName: string
  engineerName: string
  description: string
  timing: 'active' | 'potential' | 'unspecified' | null
  timingRaw: string | null
  createdAt: string
}

/**
 * `timing`/`timingRaw` come straight off the `hindrances` row -- migration
 * 036's own hindrances_timing_raw_pairing_check already makes
 * (timing='unspecified') <=> (timing_raw IS NOT NULL) structural, so the
 * only genuinely reachable cases from real data are the three branched
 * below. The trailing else exists only so this function is total over the
 * column's declared type (timing=NULL is a pre-menu legacy row this job
 * will never actually be enqueued for) -- it fails toward a plainly true
 * statement, never a fabricated claim about timing nobody has fabricated.
 */
export function buildHindrancePmNotifyEmail(params: HindrancePmNotifyEmailParams): RenderedHindrancePmEmail {
  const { projectName, engineerName, description, timing, timingRaw, createdAt } = params

  let timingLine: string
  if (timing === 'active') {
    timingLine = 'Blocking work now.'
  } else if (timing === 'potential') {
    timingLine = 'May block work later.'
  } else if (timing === 'unspecified' && timingRaw) {
    timingLine = `Timing not confirmed — engineer said: '${timingRaw}'`
  } else {
    timingLine = 'Timing not confirmed.'
  }

  // WITH the date -- a PM with several hindrances across days can't tell
  // them apart in a subject list otherwise. Decided 2026-09-07 (Aravind).
  const subject = `Hindrance reported — ${projectName} — ${formatHindranceReportDate(createdAt)}`
  const openLine = `${engineerName} reported a hindrance on ${projectName}: "${description}".`
  const text = `${openLine}\n\n${timingLine}`
  const html = `<p>${escapeHtml(openLine)}</p><p>${escapeHtml(timingLine)}</p>`

  return { subject, text, html }
}

// --- The job handler --------------------------------------------------

export interface HindrancePmNotifyJobPayload {
  hindrance_id: string
}

export type HindrancePmNotifyOutcome = 'sent' | 'zero_pms' | 'already_notified'

export interface HindrancePmNotifyResult {
  outcome: HindrancePmNotifyOutcome
  sentCount: number
  failedCount: number
}

interface HindranceRow {
  id: string
  project_id: string
  reported_by: string
  description: string
  timing: 'active' | 'potential' | 'unspecified' | null
  timing_raw: string | null
  pm_notified_at: string | null
  created_at: string
}

/**
 * Notify every PM on a hindrance's project by email. Idempotency guard:
 * `pm_notified_at IS NULL` is checked BEFORE sending (037's own column
 * comment names this exact check-then-send-then-set race and accepts it --
 * "duplicate-over-silence," matching the trade this handler makes on
 * partial failure below).
 *
 * ON ANY PER-PM SEND FAILURE, THIS THROWS -- deliberately unlike
 * handleOwnerDeliverJob's own terminal-failure model. Owner delivery has a
 * dedicated terminal `delivery_status` value for a rejected send
 * ('owner_send_failed') and an async webhook path that could one day
 * correct it; hindrance PM notification has neither -- `pm_notified_at`
 * is a boolean send-once guard with no failure state of its own. Throwing
 * lets lib/queue/jobs.ts's own exponential-backoff retry (up to 5
 * attempts) be the recovery mechanism instead. CONSEQUENCE, NAMED: a
 * retry re-sends to every PM, including ones who already got a real email
 * on an earlier attempt, if even one other PM's send failed that attempt
 * -- the same duplicate-over-silence trade 037's own comment argues for,
 * one layer up.
 */
export async function handleHindrancePmNotifyJob(
  payload: HindrancePmNotifyJobPayload,
  deps: {
    supabaseClient?: SupabaseClient
    sendEmailFn?: (params: SendEmailParams) => Promise<SendEmailResult>
  } = {},
): Promise<HindrancePmNotifyResult> {
  const client = deps.supabaseClient ?? createServiceClient()
  const sendEmail = deps.sendEmailFn ?? sendEmailReal

  const { data: hindrance, error: hindranceError } = await client
    .from('hindrances')
    .select('id, project_id, reported_by, description, timing, timing_raw, pm_notified_at, created_at')
    .eq('id', payload.hindrance_id)
    .single()
  if (hindranceError) throw hindranceError
  const row = hindrance as HindranceRow

  if (row.pm_notified_at) {
    return { outcome: 'already_notified', sentCount: 0, failedCount: 0 }
  }

  const { data: project, error: projectError } = await client.from('projects').select('name').eq('id', row.project_id).single()
  if (projectError) throw projectError

  // profile-lookup-guard:allow-id-eq -- row.reported_by is a resolved
  // users.id (hindrances.reported_by, a plain FK column), never an auth
  // uid -- same reasoning as owner-deliver-dispatch.ts's own identical tag.
  const { data: reporter, error: reporterError } = await client.from('users').select('full_name').eq('id', row.reported_by).single()
  if (reporterError) throw reporterError

  const resolution = await resolveProjectPMEmails(row.project_id, client)
  if (resolution.outcome === 'zero_pms') {
    // Already alerted (error level) inside resolveProjectPMEmails. No
    // send, pm_notified_at stays NULL -- exactly as Aravind specified.
    return { outcome: 'zero_pms', sentCount: 0, failedCount: 0 }
  }

  const rendered = buildHindrancePmNotifyEmail({
    projectName: project.name as string,
    engineerName: (reporter.full_name as string | null) ?? 'An engineer',
    description: row.description,
    timing: row.timing,
    timingRaw: row.timing_raw,
    createdAt: row.created_at,
  })

  let sentCount = 0
  let failedCount = 0
  for (const target of resolution.targets) {
    const result = await sendEmail({ to: target.email, subject: rendered.subject, text: rendered.text, html: rendered.html })
    if (result.ok) {
      sentCount++
    } else {
      failedCount++
      Sentry.captureMessage('hindrance-pm-notify: email rejected by provider', {
        level: 'error',
        fingerprint: ['hindrance-pm-notify', 'send_failed', payload.hindrance_id, target.userId],
        tags: { feature: 'hindrance-pm-notify' },
        extra: {
          hindranceId: payload.hindrance_id,
          pmUserId: target.userId,
          status: result.status,
          errorMessage: result.errorMessage,
          responseShape: result.responseShape,
        },
      })
    }
  }

  if (failedCount > 0) {
    throw new Error(
      `handleHindrancePmNotifyJob: ${failedCount}/${resolution.targets.length} PM email(s) failed for hindrance ${payload.hindrance_id} -- pm_notified_at intentionally left NULL, job will retry. See per-target Sentry events for detail.`,
    )
  }

  const { error: updateError } = await client
    .from('hindrances')
    .update({ pm_notified_at: new Date().toISOString() })
    .eq('id', payload.hindrance_id)
  if (updateError) {
    // Same reasoning as owner-deliver-dispatch's own batchWriteDeliveryStatus:
    // the send genuinely happened, only the bookkeeping write failed --
    // alert, don't throw. Throwing here would trigger a retry that
    // RE-SENDS to every PM who already received the real email.
    Sentry.captureException(updateError, {
      fingerprint: ['hindrance-pm-notify', 'pm_notified_at_write_failed', payload.hindrance_id],
      tags: { feature: 'hindrance-pm-notify' },
      extra: { hindranceId: payload.hindrance_id },
    })
  }

  return { outcome: 'sent', sentCount, failedCount: 0 }
}

// --- Enqueue helper, called from applyHindranceFlowTurn's own completion
// branch (lib/whatsapp/flows/hindrance.ts) -- kept here, not there, so the
// flow module doesn't need to import Sentry/enqueueJob itself for a single
// call site, and so this file owns its own job-type's enqueue shape end to
// end. ------------------------------------------------------------------

/**
 * Look up the hindrance row a just-completed turn wrote (safe: a single
 * engineer's own session lock serializes his turns, so this query can
 * never race a concurrent insert FROM THE SAME ENGINEER; a different
 * engineer's row is excluded by the reported_by filter regardless) and
 * enqueue its PM-notify job. NEVER THROWS -- the hindrance row is already
 * safely written by the RPC by the time this runs; a failure here must
 * not surface as a broken engineer-facing confirmation reply. Failures
 * are Sentry-alerted instead.
 */
export async function enqueueHindrancePmNotify(
  params: { projectId: string; userId: string },
  client: SupabaseClient,
): Promise<void> {
  try {
    const { data: newRow, error: selectError } = await client
      .from('hindrances')
      .select('id')
      .eq('project_id', params.projectId)
      .eq('reported_by', params.userId)
      .eq('submitted_via', 'whatsapp_adhoc')
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    if (selectError) {
      Sentry.captureException(selectError, {
        fingerprint: ['hindrance-flow', 'pm_notify_enqueue_lookup_failed'],
        tags: { feature: 'hindrance-flow' },
        extra: { projectId: params.projectId, userId: params.userId },
      })
      return
    }

    await enqueueJob('hindrance_pm_notify', { hindrance_id: newRow.id }, client)
  } catch (err) {
    Sentry.captureException(err, {
      fingerprint: ['hindrance-flow', 'pm_notify_enqueue_failed'],
      tags: { feature: 'hindrance-flow' },
      extra: { projectId: params.projectId, userId: params.userId },
    })
  }
}
