import Link from 'next/link'
import { StatusChip } from '@/components/ui/status-chip'
import { Card } from '@/components/ui/card'
import { deriveHalfStatus, type Half, type HalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import {
  HalfFields,
  DependencyLine,
  MORNING_HEADLINE_ROW,
  MORNING_SECONDARY_ROWS,
  EVENING_HEADLINE_ROW,
  EVENING_SECONDARY_ROWS,
  VIEW_REPORTED_DETAILS_LABEL,
} from '@/components/daily-logs/log-detail-view'
import type { UiVisibleColumn } from '@/lib/daily-logs/correction'
import type { EngineerCard as EngineerCardData } from '@/lib/daily-logs/query'
import { ReactivateCta } from './reactivate-cta'

// UI slice 3 (Aravind, 2026-09-18): the Daily Logs board's own per-
// engineer card, split out of page.tsx so the collapsible expansion
// below has somewhere to live without bloating that file further.
// Collapsed (default) is BYTE-IDENTICAL to what this card showed before
// this slice: engineer name, Morning/Evening status chips, the
// reactivation CTA, the "nothing to correct yet" line -- none of that
// changed. The ONLY addition is the closed-by-default <details> beneath
// the chips.
//
// UI slice 5 (Aravind, 2026-09-18): the expansion now shows the WHOLE
// check-in (every reported field + photos), not just the two headline
// fields. This extended getDailyLogsBoard's own daily_logs select
// (lib/daily-logs/query.ts) to also read morning_execution_plan/
// evening_workers_on_site/evening_schedule_met/evening_tomorrow_needs,
// and, for THIS page only (via photoOptions), a batched daily_log_photos
// read + the isProjectPm gate -- both on the SAME board query, no
// per-card queries. The "As reported by {engineer}, {time}" provenance
// line is still ScalarFieldRow's own existing logic, unchanged; this
// board still never fetches daily_log_edits, so every field renders as
// "As reported by", never "Corrected by" -- canEdit is still hard false
// throughout.
//
// UI slice 6 (Aravind, 2026-09-18): the expansion now uses HalfFields
// (not HalfColumn) -- see the comment inside the <details> block below.

// Builds the Record<UiVisibleColumn, unknown> HalfFields' own `columns`
// prop expects, off the board's (smaller) per-log shape. is_holiday/
// holiday_reason are included only because the type requires every
// UiVisibleColumn key to be present -- HalfFields never actually reads
// them for morning/evening rows (those two belong to the detail page's
// separate "Day" section, deliberately not reproduced on this card, per
// this slice's own "no correction controls, no holiday field" scope).
function logColumns(log: NonNullable<EngineerCardData['log']>): Record<UiVisibleColumn, unknown> {
  return {
    is_holiday: log.is_holiday,
    holiday_reason: log.holiday_reason,
    morning_plan: log.morning_plan,
    morning_execution_plan: log.morning_execution_plan,
    evening_output: log.evening_output,
    evening_workers_on_site: log.evening_workers_on_site,
    evening_schedule_met: log.evening_schedule_met,
    evening_tomorrow_needs: log.evening_tomorrow_needs,
  }
}

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
      <span className="text-xs text-gray-700">{half === 'morning' ? 'Morning' : 'Evening'}</span>
      <StatusChip variant={status.variant} label={labelFor(status, submittedAt)} />
    </div>
  )
}

export function EngineerCardView({
  eng,
  date,
  now,
  quocoNumber,
}: {
  eng: EngineerCardData
  date: string
  now: Date
  quocoNumber: string | null
}) {
  const morningStatus = deriveHalfStatus(eng.log, eng.messagingBlocked, 'morning', date, now, DEFAULT_CUTOFFS)
  const eveningStatus = deriveHalfStatus(eng.log, eng.messagingBlocked, 'evening', date, now, DEFAULT_CUTOFFS)
  // Card-level, not per-half: messaging_blocked is a user-level state, so
  // the CTA renders ONCE. Gating on the derived state (rather than the
  // raw flag) keeps status.ts the single source of the today-only rule
  // — no past-date CTA.
  const isBlocked = morningStatus.state === 'messaging_blocked' || eveningStatus.state === 'messaging_blocked'

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

  return (
    <Card className="p-4">
      {/* ReactivateCta renders its own <a>/<button> (a "Forward to
          wa.me" link, a copy button) — it must stay a SIBLING of the
          Link below, never a child of it, or the nested <a> would be
          invalid HTML and its clicks would also trigger card
          navigation. Only the name+halves region is the link target.
          Same reasoning now applies to the <details> below: it too
          stays a sibling, never nested inside the Link, so expanding it
          can never also navigate. */}
      {eng.log ? (
        <Link href={`/daily-logs/${eng.log.id}`} className="block hover:opacity-80">
          {cardHeaderAndHalves}
        </Link>
      ) : (
        cardHeaderAndHalves
      )}

      {eng.log && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-brand-muted hover:text-brand-strong-muted">
            {VIEW_REPORTED_DETAILS_LABEL}
          </summary>
          {/* UI slice 6 (Aravind, 2026-09-18): ONE collapsible per card --
              this <details> is now the ONLY one. Was: HalfColumn per
              column, which nested its OWN "View reported details" around
              secondary fields, two clicks to read one half. Now uses
              HalfFields instead -- every field for that half (headline +
              secondary, in order) renders directly, flat, the moment THIS
              summary opens. No repeated heading/chip either (task 2): the
              collapsed rows above already say "Morning -- Submitted
              10:53 am" / "Evening -- Submitted 7:01 pm", so HalfFields
              renders no heading or status chip of its own -- those two
              rows above are the only labelling either half gets. Columns
              are only as aligned as the data actually is (task 3): Morning
              has 2 fields, Evening has 2 (now that evening_tomorrow_needs
              moved to its own line below, not invented parity). Photos,
              PM gate (eng.photoSections), canEdit=false, and the
              never-fetches-daily_log_edits "As reported by" convention are
              all unchanged from UI slice 5. */}
          <div className="mt-2 grid grid-cols-1 divide-y divide-brand-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="py-2 first:pt-0 md:py-0 md:pr-4">
              <HalfFields
                rows={[MORNING_HEADLINE_ROW, ...MORNING_SECONDARY_ROWS]}
                dailyLogsId={eng.log.id}
                columns={logColumns(eng.log)}
                edits={{}}
                submittedAt={eng.log.morning_submitted_at}
                engineerName={eng.engineerName}
                canEdit={false}
                photoSections={eng.photoSections ?? null}
                half="morning"
                now={now}
              />
            </div>
            <div className="py-2 last:pb-0 md:py-0 md:pl-4">
              <HalfFields
                rows={[EVENING_HEADLINE_ROW, ...EVENING_SECONDARY_ROWS]}
                dailyLogsId={eng.log.id}
                columns={logColumns(eng.log)}
                edits={{}}
                submittedAt={eng.log.evening_submitted_at}
                engineerName={eng.engineerName}
                canEdit={false}
                photoSections={eng.photoSections ?? null}
                half="evening"
                now={now}
              />
            </div>
          </div>

          {/* UI slice 6: the dependency line, moved out of the evening
              column above -- same component the detail view now uses. */}
          <DependencyLine
            dailyLogsId={eng.log.id}
            columns={logColumns(eng.log)}
            edits={{}}
            submittedAt={eng.log.evening_submitted_at}
            engineerName={eng.engineerName}
            canEdit={false}
          />
        </details>
      )}

      {isBlocked && (
        <ReactivateCta
          engineerName={eng.engineerName}
          engineerWhatsappNumber={eng.engineerWhatsappNumber}
          quocoNumber={quocoNumber}
        />
      )}
      {!eng.log && (
        // A card with no daily_logs row has nothing to correct (the
        // correction RPC takes a daily_logs_id; there is no insert
        // path) — no link, no expansion, one line explaining why.
        <p className="mt-2 text-xs text-gray-600">
          Nothing to correct yet — check-ins for this day haven&apos;t come in.
        </p>
      )}
    </Card>
  )
}
