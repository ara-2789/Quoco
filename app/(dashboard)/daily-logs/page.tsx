import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { StatusChip } from '@/components/ui/status-chip'
import { deriveHalfStatus, type Half, type HalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import { getDailyLogsBoard, istDateString, type EngineerCard } from '@/lib/daily-logs/query'
import { DateNav } from './date-nav'

// DASH-03 Daily Logs — PM triage board. One card per engineer per day, morning
// + evening halves. Read-only this pass (Rule 4.3 inline correction is a
// deferred follow-up). Scoped to the PM's projects via project_members (§4).

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

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

function HalfRow({ half, card, logDate, now }: { half: Half; card: EngineerCard; logDate: string; now: Date }) {
  const status = deriveHalfStatus(card.log, card.messagingBlocked, half, logDate, now, DEFAULT_CUTOFFS)
  const submittedAt = half === 'morning' ? card.log?.morning_submitted_at ?? null : card.log?.evening_submitted_at ?? null
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
  // Validate the date param: well-formed and not in the future; else fall back to today.
  let date = params.date && DATE_RE.test(params.date) ? params.date : today
  if (date > today) date = today

  const boards = await getDailyLogsBoard(supabase, profile.id, date)
  const hasAnyEngineer = boards.some((b) => b.engineers.length > 0)

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

      {boards.length === 0 ? (
        <EmptyState
          title="No projects yet."
          body="Daily Logs appear here once you create a project and assign site engineers to it."
          action={{ href: '/projects/new', label: 'Create your first project →' }}
        />
      ) : !hasAnyEngineer ? (
        <EmptyState
          title="No engineers assigned yet."
          body="Check-ins appear here once you add site engineers to your projects and they opt in to the morning WhatsApp prompt."
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
                  {board.engineers.map((eng) => (
                    <div key={eng.engineerId} className="rounded-lg border border-gray-200 bg-white p-4">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-900">{eng.engineerName}</span>
                      </div>
                      <div className="divide-y divide-gray-100">
                        <HalfRow half="morning" card={eng} logDate={date} now={now} />
                        <HalfRow half="evening" card={eng} logDate={date} now={now} />
                      </div>
                    </div>
                  ))}
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
