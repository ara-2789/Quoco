import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { getDailyLogsBoard } from '@/lib/daily-logs/query'
import { deriveHalfStatus } from '@/lib/daily-logs/status'
import { CHECKIN_CHECKPOINTS, type CutoffConfig } from '@/lib/daily-logs/cutoffs'
import { istDateString } from '@/lib/daily-logs/date'
import { waMeHref, telHref } from '@/lib/whatsapp/links'
import { StatusChip, type StatusVariant } from '@/components/ui/status-chip'
import { getActiveHindranceTiles } from '@/lib/hindrance/queue'
import { TileAcknowledgeButton } from './tile-acknowledge-button'

// DASH-01 — the PM's exceptions home (design-principles.md Rule 4.1). This
// screen stops being a welcome page and becomes the list of things that need
// the PM, most-urgent first. Five tile kinds; 'awaiting' is never a tile —
// the half is not yet due, so there is nothing to act on yet.
//
// TODAY ONLY (Aravind's own correction, 2026-09-05): getDailyLogsBoard is
// called ONCE, for today's IST date. A missing evening half from YESTERDAY
// already went out in last night's 8:30pm report — it is history, not an
// exception. There is no second call for a prior date here.
//
// ACTIVE-HINDRANCES TILE (added, design pass 2026-09-08): timing='active'
// ONLY -- potential/unspecified stay on /hindrances, never appear here.
// Ranked above every other tile kind. Inline Acknowledge, no WhatsApp/Call
// (resolution happens outside the app -- those buttons would imply the fix
// lives in Quoco). Drops off THIS TILE after DASHBOARD_TILE_WINDOW_DAYS
// (lib/hindrance/queue.ts) -- a display rule only, the hindrance stays on
// /hindrances indefinitely regardless. "Resolved" has no rendering here at
// all: nothing writes hindrances.status/resolved_at yet (DASH-10), so this
// tile only ever shows two states, unacknowledged or acknowledged.

type TileKind =
  | 'active-hindrance'
  | 'evening-missing'
  | 'morning-missing'
  | 'nobody-on-site'
  | 'stopped-messages'

type Tile = {
  kind: TileKind
  variant: StatusVariant
  chipLabel: string
  projectId: string
  projectName: string
  engineerId: string | null
  engineerName: string | null
  whatsappNumber: string | null
  // active-hindrance only; null for every other kind.
  hindranceId: string | null
  description: string | null
  isAcknowledged: boolean
}

// Urgency order — the whole point of this screen. Rendered as full-width
// stacked cards, never a grid: a grid has no reading order.
const TILE_RANK: Record<TileKind, number> = {
  'active-hindrance': 0,
  'evening-missing': 1,
  'morning-missing': 2,
  'nobody-on-site': 3,
  'stopped-messages': 4,
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-IN', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

// Excludes 'active-hindrance' deliberately -- that kind's title is
// description reused verbatim, never an authored template (design pass
// decision), so this function is never called for it. Narrowing the
// parameter type (rather than adding a dead case to the switch below)
// makes that enforced at compile time, not just by convention.
function tileTitle(kind: Exclude<TileKind, 'active-hindrance'>, engineerName: string | null): string {
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

  // Parallel -- the two reads are independent of each other.
  const [board, hindranceTilesResult] = await Promise.all([
    getDailyLogsBoard(supabase, profile.id, today),
    getActiveHindranceTiles(supabase, profile.id, now),
  ])

  // A failed read must NEVER render as "nothing needs you" — that's the exact
  // all-amber lie query.ts's own B1 comment bans, one level up (an all-clear
  // lie instead of an all-gap one). Explicit error state, not a blank/happy
  // screen. Extended to hindranceTilesResult on the same reasoning: an empty
  // hindrance-tile list must never be indistinguishable from a failed read
  // for that feed either.
  if (board.status === 'error' || hindranceTilesResult.status === 'error') {
    return <DashboardErrorState />
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
        hindranceId: null,
        description: null,
        isAcknowledged: false,
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
          hindranceId: null,
          description: null,
          isAcknowledged: false,
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
          hindranceId: null,
          description: null,
          isAcknowledged: false,
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
          hindranceId: null,
          description: null,
          isAcknowledged: false,
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

  // One tile per hindrance, matching the pattern above -- not an aggregated
  // rollup. A site with several active hindrances produces several cards.
  for (const h of hindranceTilesResult.items) {
    tiles.push({
      kind: 'active-hindrance',
      // Reuses /hindrances' own precedent exactly (page.tsx's CHIP map +
      // the acknowledged-state swap) -- no new chip copy for this tile.
      variant: h.acknowledgedAt ? 'muted' : 'blocked',
      chipLabel: h.acknowledgedAt ? 'Seen' : 'Blocking now',
      projectId: h.projectId,
      projectName: h.projectName,
      engineerId: null,
      engineerName: null,
      whatsappNumber: null,
      hindranceId: h.id,
      description: h.description,
      isAcknowledged: h.acknowledgedAt !== null,
    })
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
          {now.toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'Asia/Kolkata' })} — {formatTime(now.toISOString())}
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

function DashboardErrorState() {
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

function TileCard({ tile }: { tile: Tile }) {
  const wa = waMeHref(tile.whatsappNumber)
  const call = telHref(tile.whatsappNumber)
  const isActiveHindrance = tile.kind === 'active-hindrance'

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4 sm:p-5">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div>
          <p className="text-xs text-gray-500 mb-1">{tile.projectName}</p>
          {tile.kind === 'active-hindrance' ? (
            <h3 className="font-medium text-gray-900 text-sm leading-snug line-clamp-2">
              {tile.description}
            </h3>
          ) : (
            <h3 className="font-medium text-gray-900 text-sm leading-snug">
              {tileTitle(tile.kind, tile.engineerName)}
            </h3>
          )}
        </div>
        <StatusChip variant={tile.variant} label={tile.chipLabel} />
      </div>

      {tile.kind === 'nobody-on-site' && (
        <p className="text-sm text-amber-700 mt-2">
          Adding engineers isn&apos;t in the dashboard yet. Ask Aravind to set one up.
        </p>
      )}

      {isActiveHindrance ? (
        tile.isAcknowledged ? (
          // Acknowledged: nothing left to action inline -- the chip above
          // already says Seen -- so this offers a way INTO the project
          // instead of a second action, not Undo. Deliberately asymmetric
          // with the unacknowledged branch below, not an inconsistency:
          // Undo lives on /hindrances only, where state actually gets
          // managed; this tile is a glanceable surface, not a place to
          // manage it from. No WhatsApp/Call on this state either.
          <div className="mt-4">
            <Link
              href={`/projects/${tile.projectId}`}
              className="inline-flex items-center justify-center rounded-md px-4 py-3 sm:py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors"
            >
              Open project
            </Link>
          </div>
        ) : (
          // Unacknowledged: exactly one job, acknowledge it. No
          // WhatsApp/Call (resolution happens outside the app), no link
          // elsewhere -- this state has one thing to do, not a menu of
          // options.
          tile.hindranceId && <TileAcknowledgeButton hindranceId={tile.hindranceId} />
        )
      ) : (
        <div
          className={`flex flex-col sm:flex-row gap-2 ${tile.kind === 'nobody-on-site' ? 'mt-3' : 'mt-4'}`}
        >
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
            className={
              !wa && !call
                ? 'inline-flex items-center justify-center rounded-md px-4 py-3 text-sm font-medium border border-gray-300 text-gray-700 hover:bg-gray-50 transition-colors'
                : 'inline-flex items-center justify-center rounded-md px-4 py-3 sm:py-1 text-sm font-medium text-blue-600 hover:bg-blue-50 transition-colors'
            }
          >
            Open project
          </Link>
        </div>
      )}
    </div>
  )
}
