import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getDailyLogsBoard } from '@/lib/daily-logs/query'
import { deriveHalfStatus } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS, type CutoffConfig } from '@/lib/daily-logs/cutoffs'
import { istDateString } from '@/lib/daily-logs/date'
import { waMeHref, telHref } from '@/lib/whatsapp/links'
import { StatusChip, type StatusVariant } from '@/components/ui/status-chip'

// DASH-01 — the PM's exceptions home (design-principles.md Rule 4.1). This
// screen stops being a welcome page and becomes the list of things that need
// the PM, most-urgent first. Four tile kinds; 'awaiting' is never a tile —
// the half is not yet due, so there is nothing to act on yet.
//
// TODAY ONLY (Aravind's own correction, 2026-09-05): getDailyLogsBoard is
// called ONCE, for today's IST date. A missing evening half from YESTERDAY
// already went out in last night's 8:30pm report — it is history, not an
// exception. There is no second call for a prior date here.

type TileKind = 'evening-missing' | 'morning-missing' | 'nobody-on-site' | 'stopped-messages'

type Tile = {
  kind: TileKind
  variant: StatusVariant
  chipLabel: string
  projectId: string
  projectName: string
  engineerId: string | null
  engineerName: string | null
  whatsappNumber: string | null
}

// Urgency order — the whole point of this screen. Rendered as full-width
// stacked cards, never a grid: a grid has no reading order.
const TILE_RANK: Record<TileKind, number> = {
  'evening-missing': 0,
  'morning-missing': 1,
  'nobody-on-site': 2,
  'stopped-messages': 3,
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

function tileTitle(kind: TileKind, engineerName: string | null): string {
  switch (kind) {
    case 'evening-missing':
      return `${engineerName} hasn't sent an evening check-in`
    case 'morning-missing':
      return `${engineerName} hasn't sent a morning check-in`
    case 'nobody-on-site':
      return 'No engineer set up on this project'
    case 'stopped-messages':
      return `${engineerName} has stopped receiving messages`
  }
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
  // DEFAULT_CUTOFFS, and do not invent a third constant.
  const cutoffs: CutoffConfig = {
    morning: CHECKIN_CHECKPOINTS.morningEscalate,
    evening: CHECKIN_CHECKPOINTS.eveningNudge,
  }

  const board = await getDailyLogsBoard(supabase, profile.id, today)

  const firstName = profile.full_name?.split(' ')[0] ?? 'there'

  // A failed read must NEVER render as "nothing needs you" — that's the exact
  // all-amber lie query.ts's own B1 comment bans, one level up (an all-clear
  // lie instead of an all-gap one). Explicit error state, not a blank/happy
  // screen.
  if (board.status === 'error') {
    return (
      <div className="p-4 sm:p-8 max-w-3xl">
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

  const tiles: Tile[] = []
  // Proof-of-life for the empty state — which sites checked in this morning,
  // and when, regardless of whether any tile fires today.
  const morningSubmissions: { projectName: string; engineerName: string; at: string }[] = []

  for (const b of board.boards) {
    if (b.engineers.length === 0) {
      tiles.push({
        kind: 'nobody-on-site',
        variant: 'risk',
        chipLabel: 'Nobody on site',
        projectId: b.projectId,
        projectName: b.projectName,
        engineerId: null,
        engineerName: null,
        whatsappNumber: null,
      })
      continue
    }

    for (const e of b.engineers) {
      // Reuse the SAME judgment DASH-03 uses — never re-decide whether a
      // check-in is late here. Only .variant/.state are read; DASH-01 does
      // not pick a chip colour itself.
      const eveningStatus = deriveHalfStatus(e.log, e.messagingBlocked, 'evening', today, now, cutoffs)
      const morningStatus = deriveHalfStatus(e.log, e.messagingBlocked, 'morning', today, now, cutoffs)

      if (eveningStatus.state === 'missing') {
        tiles.push({
          kind: 'evening-missing',
          variant: eveningStatus.variant,
          chipLabel: 'Evening check-in missing',
          projectId: b.projectId,
          projectName: b.projectName,
          engineerId: e.engineerId,
          engineerName: e.engineerName,
          whatsappNumber: e.engineerWhatsappNumber,
        })
      }
      if (morningStatus.state === 'missing') {
        tiles.push({
          kind: 'morning-missing',
          variant: morningStatus.variant,
          chipLabel: 'Morning check-in missing',
          projectId: b.projectId,
          projectName: b.projectName,
          engineerId: e.engineerId,
          engineerName: e.engineerName,
          whatsappNumber: e.engineerWhatsappNumber,
        })
      }
      // Independent of the halves above — a blocked engineer's own missing
      // half for TODAY is already excluded by deriveHalfStatus's own
      // messaging_blocked branch (info, not risk), so this never
      // double-fires as both "missing" (amber) and "stopped messages"
      // (blue) for the same half.
      if (e.messagingBlocked) {
        tiles.push({
          kind: 'stopped-messages',
          variant: 'info',
          chipLabel: 'Stopped messages',
          projectId: b.projectId,
          projectName: b.projectName,
          engineerId: e.engineerId,
          engineerName: e.engineerName,
          whatsappNumber: e.engineerWhatsappNumber,
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

  tiles.sort((a, b) => TILE_RANK[a.kind] - TILE_RANK[b.kind])

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">
          {tiles.length === 0
            ? 'Nothing needs you right now'
            : `${tiles.length} thing${tiles.length === 1 ? '' : 's'} need${tiles.length === 1 ? 's' : ''} you`}
        </h1>
        <p className="text-gray-500 mt-1 text-sm">
          {firstName}, {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })} — {formatTime(now.toISOString())}
        </p>
      </div>

      {tiles.length === 0 ? (
        // A blank page on a good day reads as broken — show that the system
        // ran, not just that nothing is wrong.
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-4">
            This morning
          </h2>
          {morningSubmissions.length === 0 ? (
            <p className="text-sm text-gray-500">No morning check-ins recorded yet today.</p>
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
                  <span className="text-gray-500 flex-shrink-0">{formatTime(s.at)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {tiles.map((t, i) => (
            <TileCard key={`${t.kind}-${t.projectId}-${t.engineerId ?? 'none'}-${i}`} tile={t} />
          ))}
        </div>
      )}
    </div>
  )
}

function TileCard({ tile }: { tile: Tile }) {
  const wa = waMeHref(tile.whatsappNumber)
  const call = telHref(tile.whatsappNumber)

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <p className="text-xs text-gray-500 mb-1">{tile.projectName}</p>
          <h3 className="font-medium text-gray-900 text-sm leading-snug">
            {tileTitle(tile.kind, tile.engineerName)}
          </h3>
        </div>
        <StatusChip variant={tile.variant} label={tile.chipLabel} />
      </div>

      {tile.kind === 'nobody-on-site' && (
        <p className="text-sm text-amber-700 mt-2">
          Adding engineers isn&apos;t in the dashboard yet. Ask Aravind to set one up.
        </p>
      )}

      <div className="flex flex-col sm:flex-row gap-2 mt-4">
        {wa && (
          <a
            href={wa}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          >
            WhatsApp
          </a>
        )}
        {call && (
          <a
            href={call}
            className="inline-flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors"
          >
            Call
          </a>
        )}
        <Link
          href={`/projects/${tile.projectId}`}
          className="inline-flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
        >
          Open project
        </Link>
      </div>
    </div>
  )
}
