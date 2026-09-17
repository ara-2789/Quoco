import * as Sentry from '@sentry/nextjs'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/service'
import { sendEmail as sendEmailReal, type SendEmailParams, type SendEmailResult, type EmailAttachment } from '@/lib/email/send'
import { enqueueJob } from '@/lib/queue/jobs'
import { istDateString } from '@/lib/daily-logs/date'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'

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
// REACHABLE, 2026-09-07 -- SUPERSEDES THE PARAGRAPH BELOW. Both conditions
// it named are now met: migration 038 is confirmed applied to prod
// (docs/reviews/038-post-apply-probe.sql, 17/17 checks), and
// inbound-start.ts's "1" branch now calls applyHindranceFlowTurn directly.
// This module is genuinely reachable from a real inbound WhatsApp message
// today. Struck through, not rewritten:
// ~~STILL NECESSARY, NOT SUFFICIENT, same shape as lib/dpr/owner-deliver-
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
// until both of the above ship.~~
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
// SECOND OPEN GAP, RECORDED NOT FIXED (Aravind, 2026-09-07, PR #241's
// pre-merge PM-resolvability check -- scripts/verify-pm-resolvability.ts).
// Every PM on every real prod project today resolves to Aravind's own
// address -- confirmed via the real resolveProjectPMEmails code path, not
// assumed. This proves the RESOLUTION path (project_members -> auth_id ->
// auth.users.email) works end to end, exactly like Phase A proved the SEND
// path worked -- but, same as Phase A before it specifically tested a
// non-account-holder address, this has never actually delivered a
// hindrance email to anyone OTHER than the person who already knows the
// report happened. Not the same gap as the bounce-suppression one above
// (that one is about a KNOWN-bad address; this one is about never having
// exercised a GENUINELY DIFFERENT recipient at all). NOT FIXED HERE, same
// "record it, don't build it" instruction -- worth closing the same way
// Phase A closed its own version: a real send to a real PM's mailbox that
// isn't Aravind's own, once one exists.
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
  /**
   * NEW, migration 044 (stage 2). Governs the one optional line appended
   * after timingLine -- APPROVED COPY (Aravind, 2026-09-14), all three
   * cases exact, Tamil pairs owed and NOT invented:
   *   - `{ kind: 'none' }` -- no photos were ever sent for this hindrance.
   *     Line omitted entirely (matches this function's existing posture
   *     of only ever stating true things).
   *   - `{ kind: 'attached', count }` -- photos fetched and attached to
   *     THIS send. "1 photo attached." (singular) / "N photos attached."
   *   - `{ kind: 'still_uploading' }` -- photos exist but retries
   *     exhausted before they finished uploading; the email sends anyway
   *     (Aravind, 2026-09-14: "never withhold the email"), without them.
   *     "Photos are still uploading — they'll be in the dashboard
   *     shortly." No count -- the exact number isn't the point once none
   *     of them made it in time.
   */
  photos: { kind: 'none' } | { kind: 'attached'; count: number } | { kind: 'still_uploading' }
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
  const { projectName, engineerName, description, timing, timingRaw, createdAt, photos } = params

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

  let photoLine: string | null = null
  if (photos.kind === 'attached') {
    photoLine = photos.count === 1 ? '1 photo attached.' : `${photos.count} photos attached.`
  } else if (photos.kind === 'still_uploading') {
    photoLine = "Photos are still uploading — they'll be in the dashboard shortly."
  }

  // WITH the date -- a PM with several hindrances across days can't tell
  // them apart in a subject list otherwise. Decided 2026-09-07 (Aravind).
  const subject = `Hindrance reported — ${projectName} — ${formatHindranceReportDate(createdAt)}`
  const openLine = `${engineerName} reported a hindrance on ${projectName}: "${description}".`
  const text = photoLine ? `${openLine}\n\n${timingLine}\n\n${photoLine}` : `${openLine}\n\n${timingLine}`
  const html = photoLine
    ? `<p>${escapeHtml(openLine)}</p><p>${escapeHtml(timingLine)}</p><p>${escapeHtml(photoLine)}</p>`
    : `<p>${escapeHtml(openLine)}</p><p>${escapeHtml(timingLine)}</p>`

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
  // NEW, migration 044. NULL = no photos ever sent for this hindrance;
  // 'pending' = a hindrance_media_ingest job is enqueued/running;
  // 'complete'/'failed' = the job resolved (all uploaded, or exhausted).
  photos_status: 'pending' | 'complete' | 'failed' | null
}

interface HindrancePhotoRow {
  photo_url: string | null
}

/**
 * Fetch every stored photo's bytes for a hindrance, via service_role,
 * directly -- NEVER a signed URL (docs/plans/stage0-storage-setup-plan.md
 * §5's own already-decided split: dashboard reads use the photo route's
 * authorization function (lib/storage/photo-access.ts's
 * getAuthorizedPhotoPath, via app/api/photos/[kind]/[photoId]/route.ts --
 * stage 5a's replacement for the original getSignedPhotoUrl this comment
 * used to name), email attachments read bytes directly, since the job already knows which
 * hindrance it's attaching for from its own query). Tombstoned rows
 * (`photo_url IS NULL`, item 9 -- not reachable in practice this soon
 * after a report, since stage 6's retention job doesn't exist yet, but
 * excluded defensively) are skipped, not treated as a failure.
 */
async function fetchHindrancePhotoAttachments(
  hindranceId: string,
  client: SupabaseClient,
): Promise<EmailAttachment[]> {
  const { data: photoRows, error: photosError } = await client
    .from('hindrance_photos')
    .select('photo_url')
    .eq('hindrance_id', hindranceId)
    .order('created_at', { ascending: true })
  if (photosError) throw photosError

  const attachments: EmailAttachment[] = []
  for (const row of (photoRows ?? []) as HindrancePhotoRow[]) {
    if (!row.photo_url) continue
    const { data: blob, error: downloadError } = await client.storage.from(PHOTO_BUCKET).download(row.photo_url)
    if (downloadError || !blob) {
      throw new Error(`fetchHindrancePhotoAttachments: download failed for ${row.photo_url}: ${downloadError?.message}`)
    }
    const bytes = Buffer.from(await blob.arrayBuffer())
    const filename = row.photo_url.split('/').pop() ?? 'photo.jpg'
    attachments.push({
      filename,
      content: bytes.toString('base64'),
      contentType: blob.type || undefined,
    })
  }
  return attachments
}

/**
 * Notify every PM on a hindrance's project by email. Idempotency guard:
 * `pm_notified_at IS NULL` is checked BEFORE sending (037's own column
 * comment names this exact check-then-send-then-set race and accepts it --
 * "duplicate-over-silence," matching the trade this handler makes on
 * partial failure below).
 *
 * PHOTO WAIT, NEW (migration 044). If `photos_status === 'pending'` and
 * `deps.forceSendWithoutPhotos` is not set, this THROWS a distinctly-
 * tagged error -- reusing lib/queue/jobs.ts's own exponential-backoff
 * retry (NFR-17, up to 5 attempts) as the "wait for the async
 * hindrance_media_ingest job to finish" mechanism, rather than building a
 * dedicated hold-timer the way DPR-24's own hold logic does. If retries
 * exhaust while STILL pending (or the job failed outright), app/api/jobs/
 * tick/route.ts's own dead-letter branch calls this function AGAIN with
 * `forceSendWithoutPhotos: true` -- Aravind's 2026-09-14 decision: "a
 * blocker the PM learns about late is worse than one without a picture,"
 * the email is NEVER withheld. That forced call skips the pending-check
 * below entirely and sends with whatever photos exist right now (possibly
 * none), using the "still uploading" copy.
 *
 * SHARED RETRY BUDGET, ACCEPTED AS A TRADE (external review round 2, S4,
 * 2026-09-14) -- NOT REFINED, deliberately. This THROW and the per-PM
 * send-failure THROW below draw on the SAME 5-attempt backoff budget
 * (lib/queue/jobs.ts, NFR-17) -- there is no separate counter for "still
 * waiting on photos" versus "a PM's email keeps failing." A hindrance
 * whose photo upload is merely slow gets the same handful of attempts,
 * spaced the same exponentially-widening way, as one whose Resend send is
 * genuinely broken -- a dedicated hold budget for the photo-wait case
 * (its own counter, its own backoff curve, independent of send-failure
 * retries) is NOT built here. Reasoning: the exhaustion behavior for
 * BOTH cases already converges on the same outcome Aravind decided above
 * -- send anyway, without waiting further -- so a second budget would
 * change WHEN that convergence happens, not WHAT happens at it. Worth
 * building only if a real collision is later observed: a hindrance whose
 * photos would have finished uploading well inside a photo-specific hold
 * window, but whose email nonetheless went out without them because an
 * unrelated PM-send failure on an EARLIER attempt had already spent part
 * of the shared budget. Not decided in advance of having one.
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
    forceSendWithoutPhotos?: boolean
  } = {},
): Promise<HindrancePmNotifyResult> {
  const client = deps.supabaseClient ?? createServiceClient()
  const sendEmail = deps.sendEmailFn ?? sendEmailReal

  const { data: hindrance, error: hindranceError } = await client
    .from('hindrances')
    .select('id, project_id, reported_by, description, timing, timing_raw, pm_notified_at, created_at, photos_status')
    .eq('id', payload.hindrance_id)
    .single()
  if (hindranceError) throw hindranceError
  const row = hindrance as HindranceRow

  if (row.pm_notified_at) {
    return { outcome: 'already_notified', sentCount: 0, failedCount: 0 }
  }

  if (row.photos_status === 'pending' && !deps.forceSendWithoutPhotos) {
    throw new Error(
      `handleHindrancePmNotifyJob: hindrance ${payload.hindrance_id} has photos still uploading (photos_status='pending') -- will retry`,
    )
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

  // Photos: fetched and attached whenever photos_status is NOT 'pending'
  // (i.e. NULL -- none ever sent -- or 'complete') on the NORMAL path.
  // On the FORCED path (retries exhausted), photos_status is still
  // 'pending' or is 'failed' -- attach nothing, use the "still uploading"
  // copy instead, per Aravind's own decision.
  let attachments: EmailAttachment[] = []
  let photos: HindrancePmNotifyEmailParams['photos']
  if (row.photos_status === null) {
    photos = { kind: 'none' }
  } else if (row.photos_status === 'complete') {
    attachments = await fetchHindrancePhotoAttachments(row.id, client)
    photos = attachments.length > 0 ? { kind: 'attached', count: attachments.length } : { kind: 'none' }
  } else {
    // 'pending' (forced path only, by the guard above) or 'failed'.
    photos = { kind: 'still_uploading' }
  }

  const rendered = buildHindrancePmNotifyEmail({
    projectName: project.name as string,
    engineerName: (reporter.full_name as string | null) ?? 'An engineer',
    description: row.description,
    timing: row.timing,
    timingRaw: row.timing_raw,
    createdAt: row.created_at,
    photos,
  })

  let sentCount = 0
  let failedCount = 0
  for (const target of resolution.targets) {
    const result = await sendEmail({
      to: target.email,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
      ...(attachments.length > 0 ? { attachments } : {}),
    })
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

// DELETED, external review round 2 (S1, fold-and-return, 2026-09-14):
// resolveMostRecentHindranceId used to live here, resolving a Q3 photo's
// (or a just-completed turn's) parent hindrance via a "most recent report
// for this reporter" lookup. The reviewer's finding: the safety argument
// for that heuristic fenced only the writer that exists TODAY (the
// hindrance flow itself) -- it said nothing about a future one, and one is
// already named in this project's own artifacts (DASH-10, the unbuilt
// hindrance-editing dashboard surface, cited in 039's own grant
// commentary). The moment any PM/dashboard path ever inserts a hindrance
// for the same reporter mid-session, "most recent" would silently attach
// that session's photos (or this function's own PM-notify email) to the
// WRONG row -- the SAME failure shape as the `was_unspecified` bug this
// migration already found and fixed internally, one layer up: re-deriving
// from adjacent state a fact the system already established, on an
// earlier turn, instead of carrying it forward. FIX: migration 044's own
// RPC now stamps `hindrance_id` into `whatsapp_sessions.context` at the
// turn it is inserted, and returns it again at the turn the flow
// completes (read back from that same context key) -- both callers below
// now receive it directly from their own caller, which already has it
// from the RPC. The heuristic is DELETED, not fenced or narrowed.

/**
 * Enqueue the PM-notify job for a hindrance report that has just
 * genuinely completed. NEVER THROWS -- the hindrance row is already
 * safely written by the RPC by the time this runs; a failure here must
 * not surface as a broken engineer-facing confirmation reply. Failures
 * are Sentry-alerted instead.
 *
 * CHANGED, external review round 2 (S1, 2026-09-14): takes `hindranceId`
 * directly from the caller (lib/whatsapp/flows/hindrance.ts, which now
 * gets it straight from the RPC's own return value) instead of resolving
 * it via a lookup -- see this file's own DELETED note immediately above
 * for why the lookup is gone, not merely relocated. This is a pure
 * enqueue now: no query at all before the job insert.
 */
export async function enqueueHindrancePmNotify(
  params: { hindranceId: string },
  client: SupabaseClient,
): Promise<void> {
  try {
    await enqueueJob('hindrance_pm_notify', { hindrance_id: params.hindranceId }, client)
  } catch (err) {
    Sentry.captureException(err, {
      fingerprint: ['hindrance-flow', 'pm_notify_enqueue_failed'],
      tags: { feature: 'hindrance-flow' },
      extra: { hindranceId: params.hindranceId },
    })
  }
}
