import * as Sentry from '@sentry/nextjs'
import Link from 'next/link'
import { CircleAlert } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { StatusChip } from '@/components/ui/status-chip'
import { deriveHalfStatus, type Half, type HalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import { getDailyLogsBoard } from '@/lib/daily-logs/query'
import { istDateString, isValidCalendarDate } from '@/lib/daily-logs/date'
import { formatQuocoNumber } from '@/lib/daily-logs/reactivate-copy'
import { DateNav } from './date-nav'
import { ReactivateCta } from './reactivate-cta'

// DASH-03 Daily Logs — PM triage board. One card per engineer per day, morning
// + evening halves. A card with a check-in row links through to the Rule 4.3
// inline correction detail route (./[logId]/page.tsx) — NOT role-gated here:
// read access is preserved for every project_members role, only the edit
// affordances on the detail page itself are gated on role === 'pm'. Scoped to
// the PM's projects via project_members (§4).

function formatTime(iso: string | null): string {
  if (!iso) return ''
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

// A submitted chip shows the real IST submission time; everything else uses the
// derived label as-is.
function labelFor(status: HalfStatus, submittedAt: string | null): string {
  if (status.state === 'submitted' && submittedAt) return `Submitted ${formatTime(submittedAt)}`
  return status.label
}

function HalfRow({ half, status, submittedAt }: { half: Half; status: HalfStatus; submittedAt: string | null }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-gray-500">{half === 'morning' ? 'Morning' : 'Evening'}</span>
      <StatusChip variant={status.variant} label={labelFor(status, submittedAt)} />
    </div>
  )
}

export default async function DailyLogsPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>
}) {
  const supabase = await createClient()
  const profile = await getProfile()

  const now = new Date()
  const today = istDateString(now)
  const params = await searchParams
  // Validate the date param: a REAL calendar date (round-trips through Date, so
  // "2026-02-31" / "2026-13-01" are rejected rather than silently rolling over
  // and hitting Postgres as an invalid literal — S2), and not in the future.
  // Fall back to today on any failure.
  let date = params.date && isValidCalendarDate(params.date) ? params.date : today
  if (date > today) date = today

  const result = await getDailyLogsBoard(supabase, profile.id, date)
  const boards = result.status === 'ok' ? result.boards : []
  const hasAnyEngineer = boards.some((b) => b.engineers.length > 0)

  // Quoco WhatsApp number for the reactivation CTA. Business number, not a secret
  // — read server-side and passed as a prop (no NEXT_PUBLIC_ needed). Stored with
  // Twilio's "whatsapp:" prefix (CLAUDE.md §8); strip it for display.
  const rawQuocoNumber = process.env.TWILIO_WHATSAPP_NUMBER
  const quocoNumber = rawQuocoNumber ? formatQuocoNumber(rawQuocoNumber) : null

  // If any engineer is messaging_blocked TODAY but we have no number to show, the
  // CTA degrades to instruction-only (still names START). That's degraded-but-
  // functioning, not a failure — surface it as a Sentry WARNING (not exception),
  // and only when a CTA would actually render (skip the pass entirely when the
  // env is set, the normal path).
  if (quocoNumber === null) {
    const anyBlocked = boards.some((b) =>
      b.engineers.some(
        (eng) =>
          deriveHalfStatus(eng.log, eng.messagingBlocked, 'morning', date, now, DEFAULT_CUTOFFS).state ===
            'messaging_blocked' ||
          deriveHalfStatus(eng.log, eng.messagingBlocked, 'evening', date, now, DEFAULT_CUTOFFS).state ===
            'messaging_blocked',
      ),
    )
    if (anyBlocked) {
      Sentry.captureMessage(
        'DASH-03 reactivate CTA degraded: TWILIO_WHATSAPP_NUMBER unset',
        'warning',
      )
    }
  }

  return (
    <div className="p-8">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Daily Logs</h1>
          <p className="mt-1 text-sm text-gray-500">
            Morning &amp; evening check-ins per engineer. Missing halves are flagged amber; holidays and
            unreachable engineers are shown separately.
          </p>
        </div>
        <DateNav date={date} today={today} />
      </div>

      {result.status === 'error' ? (
        <ErrorState date={date} />
      ) : boards.length === 0 ? (
        <EmptyState
          title="No projects yet."
          body="Daily Logs appear here once you create a project and assign site engineers to it."
          action={{ href: '/projects/new', label: 'Create your first project →' }}
        />
      ) : !hasAnyEngineer ? (
        <EmptyState
          title="No engineers assigned yet."
          body="Check-ins appear here once you add site engineers to your projects."
          action={{ href: '/projects', label: 'Manage projects →' }}
        />
      ) : (
        <div className="space-y-8">
          {boards.map((board) => (
            <section key={board.projectId}>
              <h2 className="mb-3 text-sm font-semibold text-gray-700">{board.projectName}</h2>
              {board.engineers.length === 0 ? (
                <p className="text-sm text-gray-400">No engineers assigned to this project.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {board.engineers.map((eng) => {
                    const morningStatus = deriveHalfStatus(eng.log, eng.messagingBlocked, 'morning', date, now, DEFAULT_CUTOFFS)
                    const eveningStatus = deriveHalfStatus(eng.log, eng.messagingBlocked, 'evening', date, now, DEFAULT_CUTOFFS)
                    // Card-level, not per-half: messaging_blocked is a user-level
                    // state, so the CTA renders ONCE. Gating on the derived state
                    // (rather than the raw flag) keeps status.ts the single source
                    // of the today-only rule — no past-date CTA.
                    const isBlocked =
                      morningStatus.state === 'messaging_blocked' || eveningStatus.state === 'messaging_blocked'
                    const cardHeaderAndHalves = (
                      <>
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-sm font-medium text-gray-900">{eng.engineerName}</span>
                        </div>
                        <div className="divide-y divide-gray-100">
                          <HalfRow half="morning" status={morningStatus} submittedAt={eng.log?.morning_submitted_at ?? null} />
                          <HalfRow half="evening" status={eveningStatus} submittedAt={eng.log?.evening_submitted_at ?? null} />
                        </div>
                      </>
                    )
                    // ReactivateCta renders its own <a>/<button> (a "Forward
                    // to wa.me" link, a copy button) — it must stay a SIBLING
                    // of the Link below, never a child of it, or the nested
                    // <a> would be invalid HTML and its clicks would also
                    // trigger card navigation. Only the name+halves region is
                    // the link target.
                    return (
                      <div key={eng.engineerId} className="rounded-lg border border-gray-200 bg-white p-4">
                        {eng.log ? (
                          <Link href={`/daily-logs/${eng.log.id}`} className="block hover:opacity-80">
                            {cardHeaderAndHalves}
                          </Link>
                        ) : (
                          cardHeaderAndHalves
                        )}
                        {isBlocked && (
                          <ReactivateCta
                            engineerName={eng.engineerName}
                            engineerWhatsappNumber={eng.engineerWhatsappNumber}
                            quocoNumber={quocoNumber}
                          />
                        )}
                        {!eng.log && (
                          // A card with no daily_logs row has nothing to
                          // correct (the correction RPC takes a
                          // daily_logs_id; there is no insert path) — no
                          // link, one line explaining why.
                          <p className="mt-2 text-xs text-gray-400">
                            Nothing to correct yet — check-ins for this day haven&apos;t come in.
                          </p>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({
  title,
  body,
  action,
}: {
  title: string
  body: string
  action: { href: string; label: string }
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-12 text-center">
      <p className="text-sm font-medium text-gray-900">{title}</p>
      <p className="mx-auto mt-1 max-w-md text-sm text-gray-500">{body}</p>
      <a href={action.href} className="mt-3 inline-block text-sm text-blue-600 hover:underline">
        {action.label}
      </a>
    </div>
  )
}

// Distinct FAILED-READ state (B1). Deliberately red-bordered and icon-marked so
// it is visually unmistakable from both the neutral empty state (grey/white) and
// the amber "Not checked in" gap chips — a data-load failure must never read as
// "nobody checked in". The error itself is already on Sentry (see query.ts);
// this only offers the PM a retry.
function ErrorState({ date }: { date: string }) {
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-12 text-center">
      <div className="mb-2 flex items-center justify-center gap-2 text-red-700">
        <CircleAlert className="h-5 w-5" aria-hidden="true" />
        <p className="text-sm font-semibold">Couldn&apos;t load check-ins</p>
      </div>
      <p className="mx-auto max-w-md text-sm text-red-700/80">
        Something went wrong reading these logs — this is not a report that no one checked in.
        Please retry.
      </p>
      <a
        href={`/daily-logs?date=${date}`}
        className="mt-3 inline-block rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
      >
        Retry
      </a>
    </div>
  )
}
