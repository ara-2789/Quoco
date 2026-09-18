import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getDailyLogsBoard, getNeededTomorrowItems, type NeededTomorrowItem } from '@/lib/daily-logs/query'
import { deriveHalfStatus } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS, type CutoffConfig } from '@/lib/daily-logs/cutoffs'
import { istDateString } from '@/lib/daily-logs/date'
import { StatusChip, type StatusVariant } from '@/components/ui/status-chip'
import { Card } from '@/components/ui/card'
import { getHindranceQueue, type HindranceCard } from '@/lib/hindrance/queue'
import { formatHindranceAge, formatHindranceReportedDate } from '@/lib/hindrance/relative-time'
import { NEEDED_TOMORROW_HEADING } from '@/components/daily-logs/log-detail-view'
import { CHIP } from '../hindrances/page'

// UI slice 5 (Aravind, 2026-09-18): DASH-01 rebuilt as a single "needs
// attention" list -- unacknowledged hindrances first (blocking ones
// first, oldest first within each group -- getHindranceQueue's own
// existing order, unchanged), then engineers with a missing morning or
// evening check-in for today. Replaces the previous five-tile-kind
// system (active-hindrance/evening-missing/morning-missing/nobody-on-
// site/stopped-messages) and its inline Acknowledge/WhatsApp/Call
// actions -- this rebuild's own spec names exactly two groups and "no
// acknowledge action here", so 'nobody-on-site' and 'stopped-messages'
// (and every inline action) are deliberately dropped from THIS page,
// not overlooked. Both are still visible elsewhere, unchanged: a
// project with zero engineers is still obvious from the Daily Logs
// page, and a messaging-blocked engineer still gets the ReactivateCta
// on their own Daily Logs card.
//
// getActiveHindranceTiles/DASHBOARD_TILE_WINDOW_DAYS/
// withinDashboardTileWindow (lib/hindrance/queue.ts) are now unused by
// this rebuild -- left in place, not deleted, since removing exported
// library functions is a separate decision from this page's own
// rebuild (flagged in this slice's own report, not acted on here).
//
// NO NEW QUERY for the first two groups: built entirely from
// getDailyLogsBoard (already called here) and getHindranceQueue
// (lib/hindrance/queue.ts, the SAME module the Hindrances page itself
// uses) -- no query this page didn't already have access to.
//
// TODAY ONLY (Aravind's own correction, 2026-09-05, unchanged by this
// rebuild): getDailyLogsBoard is called ONCE, for today's IST date. A
// missing evening half from YESTERDAY already went out in last night's
// 8:30pm report — it is history, not an exception.
//
// UI slice 6 (Aravind, 2026-09-18): a THIRD group, "Needed tomorrow" --
// per-engineer dependency text from the evening check-in, visible the
// day reported plus the following day (IST). getDailyLogsBoard's own
// single-date, one-log-per-engineer contract cannot cover a two-day
// window without breaking its OTHER caller (the Daily Logs page) --
// see getNeededTomorrowItems' own header comment (lib/daily-logs/
// query.ts) for why this is a new, narrow function instead of an
// extension of that one. Notice only: no action, no acknowledge, no
// link beyond the existing daily-log-for-that-date link. Not folded
// into totalCount/"Needs your attention" -- a genuinely different
// urgency tier, shown independently of whether the first two groups
// have anything at all.

// English only -- Tamil owed, NOT approved.
const NEEDS_ATTENTION_HEADING = 'Needs your attention'

type MissingCheckinCard = {
  half: 'morning' | 'evening'
  projectId: string
  projectName: string
  engineerId: string
  engineerName: string
  variant: StatusVariant
  chipLabel: string
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

// Reused verbatim from the previous tile system -- "reuse every other
// existing string".
function missingCheckinTitle(half: 'morning' | 'evening', engineerName: string): string {
  return half === 'evening'
    ? `${engineerName} hasn't sent an evening check-in`
    : `${engineerName} hasn't sent a morning check-in`
}

export default async function DashboardPage() {
  const supabase = await createClient()
  // getProfile() gates auth (redirects if unauthenticated) and fail-louds on a
  // missing profile — so profile is always present past this line.
  const profile = await getProfile()

  const now = new Date()
  const today = istDateString(now)

  // DASH-01's OWN morning boundary — NOT DEFAULT_CUTOFFS.morning (15:00,
  // DASH-03's board boundary). cutoffs.ts:47's own in-code spec:
  // morningEscalate is "PM escalation surfaces on the DASH-01 dashboard
  // (never a WhatsApp send); persistent until submit or morningCutoff."
  // Evening DOES match DEFAULT_CUTOFFS.evening (eveningNudge, 19:15) — same
  // boundary as the DASH-03 board, deliberately. This is the single easiest
  // thing to get wrong in this file — do not "simplify" it to
  // DEFAULT_CUTOFFS, and do not invent a third constant. Unchanged by this
  // slice's rebuild.
  const cutoffs: CutoffConfig = {
    morning: CHECKIN_CHECKPOINTS.morningEscalate,
    evening: CHECKIN_CHECKPOINTS.eveningNudge,
  }

  // Parallel -- all three reads are independent of each other. getDailyLogsBoard
  // is called with NO photoOptions (this page never renders photos, unlike
  // the Daily Logs page's own call -- see that query's own comment).
  const [board, hindranceResult, neededTomorrowResult] = await Promise.all([
    getDailyLogsBoard(supabase, profile.id, today),
    getHindranceQueue(supabase, profile.id, now),
    getNeededTomorrowItems(supabase, profile.id, now),
  ])

  // A failed read must NEVER render as "nothing needs you" — that's the exact
  // all-amber lie query.ts's own B1 comment bans, one level up (an all-clear
  // lie instead of an all-gap one). Explicit error state, not a blank/happy
  // screen. 'not-a-pm' is NOT an error -- it means this viewer simply has no
  // PM-role project_members row, same as getActiveHindranceTiles' own old
  // 'ok, items: []' behaviour for that case; this page has never role-gated
  // itself, and a non-PM viewer still sees their missing-check-in items.
  if (board.status === 'error' || hindranceResult.status === 'error' || neededTomorrowResult.status === 'error') {
    return <DashboardErrorState />
  }

  const neededTomorrowItems: NeededTomorrowItem[] =
    neededTomorrowResult.status === 'ok' ? neededTomorrowResult.items : []

  const hindranceItems: HindranceCard[] =
    hindranceResult.status === 'ok' ? hindranceResult.items.filter((h) => h.acknowledgedAt === null) : []

  const missingCheckins: MissingCheckinCard[] = []
  // Proof-of-life for the empty state — which sites checked in this morning,
  // and when, regardless of whether anything needs attention today.
  const morningSubmissions: { projectName: string; engineerName: string; at: string }[] = []

  for (const b of board.boards) {
    for (const e of b.engineers) {
      // Reuse the SAME judgment DASH-03 uses — never re-decide whether a
      // check-in is late here. Only .variant/.state are read; DASH-01 does
      // not pick a chip colour itself. A messaging_blocked engineer's own
      // missing half for TODAY already resolves to 'messaging_blocked'
      // here (not 'missing'), so it never produces a card on this page —
      // deriveHalfStatus's own existing branch, not new logic.
      const eveningStatus = deriveHalfStatus(e.log, e.messagingBlocked, 'evening', today, now, cutoffs)
      const morningStatus = deriveHalfStatus(e.log, e.messagingBlocked, 'morning', today, now, cutoffs)

      if (eveningStatus.state === 'missing') {
        missingCheckins.push({
          half: 'evening',
          projectId: b.projectId,
          projectName: b.projectName,
          engineerId: e.engineerId,
          engineerName: e.engineerName,
          variant: eveningStatus.variant,
          chipLabel: 'Evening check-in missing',
        })
      }
      if (morningStatus.state === 'missing') {
        missingCheckins.push({
          half: 'morning',
          projectId: b.projectId,
          projectName: b.projectName,
          engineerId: e.engineerId,
          engineerName: e.engineerName,
          variant: morningStatus.variant,
          chipLabel: 'Morning check-in missing',
        })
      }

      if (e.log?.morning_submitted_at) {
        morningSubmissions.push({
          projectName: b.projectName,
          engineerName: e.engineerName,
          at: e.log.morning_submitted_at,
        })
      }
    }
  }

  const totalCount = hindranceItems.length + missingCheckins.length

  return (
    // UI slice 4 (Aravind, 2026-09-18): padding/max-width moved to the
    // shared layout wrapper (app/(dashboard)/layout.tsx) so every
    // dashboard page centres in the same ~1250px container instead of
    // each setting its own narrower one.
    //
    // UI slice 5: mb-6 -> mb-8, matching Hindrances/Daily Logs/Projects'
    // own header margin now, for consistent vertical rhythm (Part C). The
    // dynamic title/subtitle text below is UNCHANGED from before this
    // rebuild -- reused, not reworded.
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-gray-900">
          {totalCount === 0
            ? 'Nothing needs you right now'
            : `${totalCount} thing${totalCount === 1 ? '' : 's'} need${totalCount === 1 ? 's' : ''} you`}
        </h1>
        <p className="text-gray-700 mt-1 text-sm">
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })} — {formatTime(now.toISOString())}
        </p>
      </div>

      {totalCount === 0 ? (
        // Unchanged from before this rebuild -- "When both groups are
        // empty, keep the page's existing empty state unchanged." A blank
        // page on a good day reads as broken — show that the system ran,
        // not just that nothing is wrong.
        <Card className="p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            This morning
          </h2>
          {morningSubmissions.length === 0 ? (
            <p className="text-sm text-gray-700">No morning check-ins recorded yet today.</p>
          ) : (
            <ul className="space-y-2">
              {morningSubmissions.map((s) => (
                <li
                  key={`${s.projectName}-${s.engineerName}`}
                  className="flex items-center justify-between text-sm gap-3"
                >
                  <span className="text-gray-900">
                    {s.projectName} — {s.engineerName}
                  </span>
                  <span className="text-gray-700 flex-shrink-0">{formatTime(s.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      ) : (
        <div>
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{NEEDS_ATTENTION_HEADING}</h2>
          <div className="flex flex-col gap-3">
            {hindranceItems.map((h) => (
              <HindranceNeedsAttentionCard key={h.id} item={h} now={now} />
            ))}
            {missingCheckins.map((m, i) => (
              <MissingCheckinNeedsAttentionCard key={`${m.half}-${m.engineerId}-${i}`} item={m} today={today} />
            ))}
          </div>
        </div>
      )}

      {/* UI slice 6: third group, independent of totalCount above -- shows
          whenever there's a dependency in its own two-day window,
          regardless of whether "Needs your attention" is empty or not.
          Renders nothing at all (no heading, no empty-state text) when
          the list itself is empty. */}
      {neededTomorrowItems.length > 0 && (
        <div className="mt-8">
          <h2 className="mb-4 text-sm font-semibold text-gray-700">{NEEDED_TOMORROW_HEADING}</h2>
          <div className="flex flex-col gap-3">
            {neededTomorrowItems.map((item) => (
              <NeededTomorrowCard key={item.id} item={item} />
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DashboardErrorState() {
  return (
    <div>
      <div className="bg-red-50 border border-red-200 rounded-lg p-6">
        <h1 className="text-lg font-semibold text-red-900">Couldn&apos;t load your dashboard</h1>
        <p className="text-sm text-red-700 mt-1">
          Something went wrong reading today&apos;s check-ins. This has been reported — try
          refreshing in a moment.
        </p>
      </div>
    </div>
  )
}

// Card contents per this slice's own spec: project name, reported text,
// its existing status chip, and the reporter line -- "matching the
// hindrances page". No acknowledge action, no photos, no "He answered"
// raw-timing line -- this is a glanceable pointer INTO /hindrances, not a
// second place to manage a hindrance from.
function HindranceNeedsAttentionCard({ item, now }: { item: HindranceCard; now: Date }) {
  const chip = CHIP[item.timing]
  return (
    <Link href="/hindrances" className="block hover:opacity-80">
      <Card className="p-4 sm:p-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <p className="text-xs text-gray-700">{item.projectName}</p>
          <StatusChip variant={chip.variant} label={chip.label} />
        </div>
        <p className="text-sm font-medium leading-snug text-gray-900">{item.description}</p>
        <p className="mt-2 text-xs text-gray-700">
          {item.reporterName} · {formatHindranceReportedDate(item.createdAt)} · {formatHindranceAge(item.createdAt, now)}
        </p>
      </Card>
    </Link>
  )
}

// Card contents per this slice's own spec: project, engineer, which half
// is missing, linking to that engineer's daily log for today -- the Daily
// Logs list page itself, filtered to today, which is the only always-
// valid target (a missing half can mean NO daily_logs row exists yet at
// all, so there is no per-row detail page to link to in that case).
function MissingCheckinNeedsAttentionCard({ item, today }: { item: MissingCheckinCard; today: string }) {
  return (
    <Link href={`/daily-logs?date=${today}`} className="block hover:opacity-80">
      <Card className="p-4 sm:p-5">
        <div className="mb-1 flex items-start justify-between gap-3">
          <p className="text-xs text-gray-700">{item.projectName}</p>
          <StatusChip variant={item.variant} label={item.chipLabel} />
        </div>
        <p className="text-sm font-medium leading-snug text-gray-900">
          {missingCheckinTitle(item.half, item.engineerName)}
        </p>
      </Card>
    </Link>
  )
}

// item.logDate is a 'YYYY-MM-DD' date, not a timestamp -- parsed at UTC
// midnight before formatting, same convention log-detail-view.tsx's own
// formatLogDate already uses, so a late-evening IST render never rolls
// the date back a day the way parsing the bare string directly (implicit
// local-time midnight) can.
function formatIstDate(logDate: string): string {
  return new Date(`${logDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// Card contents per this slice's own spec: project, engineer name, the
// reported date (IST), and the dependency text -- notice only, no chip,
// no action. Links to that engineer's daily log for the date it was
// actually reported on ("the existing daily-log link, if one fits
// naturally") -- not always today, since a dependency reported
// yesterday still shows here today.
function NeededTomorrowCard({ item }: { item: NeededTomorrowItem }) {
  return (
    <Link href={`/daily-logs?date=${item.logDate}`} className="block hover:opacity-80">
      <Card className="p-4 sm:p-5">
        <p className="text-xs text-gray-700">{item.projectName}</p>
        <p className="mt-1 text-sm font-medium leading-snug text-gray-900">{item.dependencyText}</p>
        <p className="mt-2 text-xs text-gray-700">
          {item.engineerName} · {formatIstDate(item.logDate)}
        </p>
      </Card>
    </Link>
  )
}
