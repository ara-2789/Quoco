import { createClient } from '@/lib/supabase/server'
import { getProfile } from '@/lib/auth/profile'
import { StatusChip, type StatusVariant } from '@/components/ui/status-chip'
import {
  getHindranceQueue,
  getHindrancePhotosByHindranceIds,
  resolveHindranceCardPmAndPhotos,
  type HindranceCard,
  type HindranceTiming,
  type HindrancePhotoItem,
} from '@/lib/hindrance/queue'
import { formatHindranceAge } from '@/lib/hindrance/relative-time'
import { HindranceCardPhotos } from '@/components/hindrances/hindrance-card-photos'
import { HindranceAckControls } from './ack-controls'

// DASH-07 — PM hindrance queue (docs/plans/dash-07-hindrance-queue.md).
// Phase 2 adds Acknowledge/Undo (migration 039 + app/(dashboard)/
// hindrances/actions.ts). Acknowledged rows KEEP their position (never
// sink, never hidden -- §Rendering rules) and get a quiet background tint,
// never dimmed text (decision 2: acknowledged reads as "seen", not
// "resolved/dismissed").
//
// ROUTE ACCESS -- no role gate, no redirect (§Route access). Matches
// daily-logs/dprs: open to any authenticated user, scoped by data. A viewer
// with zero project_members role='pm' rows sees the dedicated "not a PM"
// empty state below, not a silent lie ("Nothing reported" would otherwise be
// indistinguishable from "you can't see it").

const CHIP: Record<HindranceTiming, { variant: StatusVariant; label: string }> = {
  active: { variant: 'blocked', label: 'Blocking now' },
  unspecified: { variant: 'risk', label: 'Timing unclear' },
  potential: { variant: 'risk', label: 'Could block' },
}

export default async function HindrancesPage() {
  const supabase = await createClient()
  const profile = await getProfile()
  const now = new Date()

  const result = await getHindranceQueue(supabase, profile.id, now)

  // Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md §5/§6
  // revision, D3). One batched photo query for every card on the page,
  // but the PM check itself runs per card via resolveHindranceCardPmAndPhotos
  // -- getHindranceQueue's own PM-scoping above is NOT trusted as
  // equivalent to hindrance_photos_select's RLS (open question, package
  // lines 911-916).
  //
  // RATE LIMIT NOTE: the photo route (app/api/photos/[kind]/[photoId]/
  // route.ts) allows DEFAULT_PHOTO_RATE_LIMIT_MAX_REQUESTS = 120
  // requests/min per user (route.ts:47-48). A queue with many photos
  // rendered above the fold in one page load could approach that limit
  // for a PM with a lot of open hindrances in a single render — thumbnails
  // (smaller, cheaper renders, fewer route calls) are a backlog item, not
  // built here.
  const photosByHindrance =
    result.status === 'ok'
      ? await getHindrancePhotosByHindranceIds(result.items.map((item) => item.id), profile.tenant_id ?? '', supabase)
      : new Map<string, HindrancePhotoItem[]>()

  const cardPhotoDataById =
    result.status === 'ok'
      ? new Map(
          await Promise.all(
            result.items.map(
              async (item) =>
                [item.id, await resolveHindranceCardPmAndPhotos(supabase, profile.id, item, photosByHindrance)] as const,
            ),
          ),
        )
      : new Map<string, { isPm: boolean; photos: HindrancePhotoItem[] }>()

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-semibold text-gray-900">Hindrances</h1>
        {result.status === 'ok' && result.items.length > 0 && (
          <p className="mt-1 text-sm text-gray-700">
            {result.items.length} {result.items.length === 1 ? 'thing' : 'things'} reported from your sites.
          </p>
        )}
      </div>

      {result.status === 'error' ? (
        <ErrorState />
      ) : result.status === 'not-a-pm' ? (
        <EmptyState text="You're not the PM on any project. Hindrances appear here for projects you manage." />
      ) : result.items.length === 0 ? (
        <EmptyState
          text={
            result.hasAnyEver
              ? 'Nothing reported in the last two weeks.'
              : "Nothing reported. Your engineers can flag a blockage any time from WhatsApp."
          }
        />
      ) : (
        <div className="flex max-w-3xl flex-col gap-3">
          {result.items.map((item) => (
            <HindranceRow
              key={item.id}
              item={item}
              now={now}
              photoData={cardPhotoDataById.get(item.id) ?? { isPm: false, photos: [] }}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="max-w-3xl rounded-lg border border-gray-200 bg-white p-12 text-center">
      <p className="mx-auto max-w-md text-sm text-gray-700">{text}</p>
    </div>
  )
}

// Same distinct-red-border shape as daily-logs/page.tsx's ErrorState and
// dprs/page.tsx's failed-read state -- a load failure must never look like
// the "Nothing reported" empty state.
function ErrorState() {
  return (
    <div className="max-w-3xl rounded-lg border border-red-200 bg-red-50 p-12 text-center">
      <p className="text-sm font-semibold text-red-700">Couldn&apos;t load hindrances.</p>
      <p className="mx-auto mt-2 max-w-md text-sm text-red-600">
        Something went wrong loading this list. This has been reported — try refreshing.
      </p>
    </div>
  )
}

// Row anatomy (§Row anatomy): project, chip, the engineer's words, then
// attribution and action. Acknowledged rows add a second attribution/action
// line (Seen by ..., Undo) below the reporter line -- they don't replace it
// (§Row anatomy's own "Acknowledged:" mockup keeps both lines).
function HindranceRow({
  item,
  now,
  photoData,
}: {
  item: HindranceCard
  now: Date
  photoData: { isPm: boolean; photos: HindrancePhotoItem[] }
}) {
  const isAcknowledged = item.acknowledgedAt !== null
  const chip = isAcknowledged ? { variant: 'muted' as const, label: 'Seen' } : CHIP[item.timing]
  const rawAnswer = item.timingRaw?.trim()

  return (
    <div
      className={`rounded-lg border border-gray-200 p-4 sm:p-5 ${isAcknowledged ? 'bg-gray-50' : 'bg-white'}`}
    >
      <div className="mb-1 flex items-start justify-between gap-3">
        <p className="text-xs text-gray-700">{item.projectName}</p>
        <StatusChip variant={chip.variant} label={chip.label} />
      </div>
      <p className="text-sm font-medium leading-snug text-gray-900">{item.description}</p>
      {/* timing_raw verbatim, quoted, prefixed "He answered:" -- omitted
          entirely when empty/whitespace, never rendered as "He answered: ''"
          (§Rendering rules). Plain JSX text child -- never markup, never
          normalised. */}
      {item.timing === 'unspecified' && rawAnswer && (
        <p className="mt-1 text-sm italic text-gray-600">He answered: &quot;{rawAnswer}&quot;</p>
      )}
      <p className="mt-2 text-xs text-gray-700">
        {item.reporterName} · {formatHindranceAge(item.createdAt, now)}
      </p>
      <HindranceCardPhotos isPm={photoData.isPm} photos={photoData.photos} now={now} />
      <HindranceAckControls
        hindranceId={item.id}
        isAcknowledged={isAcknowledged}
        acknowledgedAt={item.acknowledgedAt}
        acknowledgedBySelf={item.acknowledgedBySelf}
        acknowledgedByName={item.acknowledgedByName}
        ackNotifiedAt={item.ackNotifiedAt}
        reporterName={item.reporterName}
      />
    </div>
  )
}
