import { StatusChip, type StatusVariant } from '@/components/ui/status-chip'
import { deriveHalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import { canEditLog, type UiVisibleColumn } from '@/lib/daily-logs/correction'
import type { LogDetail, LatestEdit } from '@/lib/daily-logs/query'
import type { DailyLogPhotoSectionsData } from '@/lib/daily-logs/photos'
import { DailyLogPhotoColumn, DailyLogNoPhotosMessage } from './photo-sections'
import { ScalarFieldRow } from './scalar-field-row'
import { HolidayField } from './holiday-field'

// UI slice 2 (Aravind, 2026-09-18). Both English only -- Tamil owed, NOT
// approved.
const VIEW_REPORTED_DETAILS_LABEL = 'View reported details'
const REPORT_SENT_TO_OWNER_LABEL = 'Report sent to owner'

export type LogDetailViewProps = {
  data: LogDetail
  dprDeliveryCopy: string
  // UI slice 2, task 4a -- href to that day's DPR for this project/
  // engineer/log_date, or null when no such row exists/is visible to
  // this viewer (page.tsx's own dprState.status !== 'ok'). null renders
  // nothing at all, never a disabled/greyed link.
  dprLinkHref: string | null
  viewerRole: string | null
  now: Date
  // Stage 5a, build slice B3 -- null means "not a PM on this project"
  // (D3), never rendered as an empty section. Deliberately independent of
  // `viewerRole` above, which stays wired to canEditLog only (R1
  // revision).
  photoSections: DailyLogPhotoSectionsData | null
}

// UI slice 2: each half's "headline" field (always visible) split from
// its "secondary" fields (collapsed by default, task 1) -- same columns/
// labels/order as before, just partitioned into two groups instead of
// one flat list. The first row of each half's ORIGINAL list is the
// headline (Aravind did not name one explicitly; this is the most
// legible read of "the headline entry" -- flagged, not assumed silently).
const MORNING_HEADLINE_ROW = { column: 'morning_plan', label: 'Morning plan' } as const
const MORNING_SECONDARY_ROWS = [{ column: 'morning_execution_plan', label: 'Execution plan' }] as const

const EVENING_HEADLINE_ROW = { column: 'evening_output', label: 'What was done' } as const
const EVENING_SECONDARY_ROWS = [
  { column: 'evening_workers_on_site', label: 'Workers on site' },
  { column: 'evening_schedule_met', label: 'Plan met?' },
  // RENAMED 2026-09-11 (migration 040) -- was evening_schedule_miss_reason /
  // "Reason plan wasn't met". Aravind approved "Dependency" as the label,
  // matching the DPR's own render.ts label exactly.
  { column: 'evening_tomorrow_needs', label: 'Dependency' },
] as const

function formatLogDate(logDate: string): string {
  return new Date(`${logDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

type Row = { column: UiVisibleColumn; label: string }

// UI slice 2: one half's column -- heading + its own status chip (task 1:
// "each column keeps its own status chip"), the headline field always
// visible, every other reported field inside a closed-by-default
// <details> (native disclosure, same choice already made for the
// reactivate CTA one file over -- no shadcn, per CLAUDE.md §3), then that
// half's own photos, always visible (never collapsed).
function HalfColumn({
  heading,
  chipVariant,
  chipLabel,
  headlineRow,
  secondaryRows,
  dailyLogsId,
  columns,
  edits,
  submittedAt,
  engineerName,
  canEdit,
  photoSections,
  half,
  now,
}: {
  heading: string
  chipVariant: StatusVariant
  chipLabel: string
  headlineRow: Row
  secondaryRows: readonly Row[]
  dailyLogsId: string
  columns: Record<UiVisibleColumn, unknown>
  edits: Partial<Record<UiVisibleColumn, LatestEdit>>
  submittedAt: string | null
  engineerName: string
  canEdit: boolean
  photoSections: DailyLogPhotoSectionsData | null
  half: 'morning' | 'evening'
  now: Date
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-900">{heading}</h2>
        <StatusChip variant={chipVariant} label={chipLabel} />
      </div>

      <ScalarFieldRow
        dailyLogsId={dailyLogsId}
        column={headlineRow.column}
        label={headlineRow.label}
        currentValue={columns[headlineRow.column]}
        edit={edits[headlineRow.column]}
        submittedAt={submittedAt}
        engineerName={engineerName}
        canEdit={canEdit}
      />

      {secondaryRows.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-brand-muted hover:text-brand-strong-muted">
            {VIEW_REPORTED_DETAILS_LABEL}
          </summary>
          <div className="mt-1 divide-y divide-gray-100">
            {secondaryRows.map((row) => (
              <ScalarFieldRow
                key={row.column}
                dailyLogsId={dailyLogsId}
                column={row.column}
                label={row.label}
                currentValue={columns[row.column]}
                edit={edits[row.column]}
                submittedAt={submittedAt}
                engineerName={engineerName}
                canEdit={canEdit}
              />
            ))}
          </div>
        </details>
      )}

      <div className="mt-4">
        <DailyLogPhotoColumn photoSections={photoSections} half={half} now={now} />
      </div>
    </div>
  )
}

export function LogDetailView({
  data,
  dprDeliveryCopy,
  dprLinkHref,
  viewerRole,
  now,
  photoSections,
}: LogDetailViewProps) {
  const canEdit = canEditLog(viewerRole)

  const halfInput = {
    morning_submitted_at: data.morningSubmittedAt,
    evening_submitted_at: data.eveningSubmittedAt,
    is_holiday: data.columns.is_holiday as boolean | null,
    holiday_reason: data.columns.holiday_reason as string | null,
  }
  const morningStatus = deriveHalfStatus(
    halfInput,
    data.messagingBlocked,
    'morning',
    data.logDate,
    now,
    DEFAULT_CUTOFFS,
  )
  const eveningStatus = deriveHalfStatus(
    halfInput,
    data.messagingBlocked,
    'evening',
    data.logDate,
    now,
    DEFAULT_CUTOFFS,
  )

  return (
    <div className="mx-auto max-w-3xl p-6">
      <a
        href={`/daily-logs?date=${data.logDate}`}
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to Daily Logs
      </a>

      <div className="mt-3">
        <h1 className="text-xl font-semibold text-gray-900">{data.engineerName}</h1>
        <p className="mt-1 text-sm text-gray-700">{formatLogDate(data.logDate)}</p>
      </div>

      <p className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        {dprDeliveryCopy}
      </p>

      {/* UI slice 2, task 4a: renders only when page.tsx's own dprs
          lookup found a visible row for this exact key -- null renders
          nothing at all, never a disabled placeholder. */}
      {dprLinkHref && (
        <a href={dprLinkHref} className="mt-2 inline-block text-sm text-blue-600 hover:underline">
          {REPORT_SENT_TO_OWNER_LABEL}
        </a>
      )}

      <div className="mt-6 divide-y divide-gray-100">
        <section>
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Day</h2>
          <HolidayField
            dailyLogsId={data.id}
            currentIsHoliday={data.columns.is_holiday as boolean | null}
            currentHolidayReason={data.columns.holiday_reason as string | null}
            isHolidayEdit={data.edits.is_holiday}
            holidayReasonEdit={data.edits.holiday_reason}
            morningSubmittedAt={data.morningSubmittedAt}
            engineerName={data.engineerName}
            attendanceDefaulted={data.attendanceDefaulted}
            attendanceRaw={data.attendanceRaw}
            canEdit={canEdit}
          />
        </section>
      </div>

      {/* UI slice 2, task 1: Morning/Evening as two side-by-side columns
          at md+, stacked on small screens, with a divider between them
          (md:divide-x; the stacked mobile layout gets a horizontal
          divider instead via divide-y on the same element, py-6 giving
          it breathing room). */}
      <div className="mt-6 grid grid-cols-1 divide-y divide-brand-border md:grid-cols-2 md:divide-x md:divide-y-0">
        <div className="py-6 first:pt-0 md:py-0 md:pr-6">
          <HalfColumn
            heading={`Morning${data.morningSubmittedAt ? '' : ' — not yet submitted'}`}
            chipVariant={morningStatus.variant}
            chipLabel={`Morning: ${morningStatus.label}`}
            headlineRow={MORNING_HEADLINE_ROW}
            secondaryRows={MORNING_SECONDARY_ROWS}
            dailyLogsId={data.id}
            columns={data.columns}
            edits={data.edits}
            submittedAt={data.morningSubmittedAt}
            engineerName={data.engineerName}
            canEdit={canEdit}
            photoSections={photoSections}
            half="morning"
            now={now}
          />
        </div>
        <div className="py-6 last:pb-0 md:py-0 md:pl-6">
          <HalfColumn
            heading={`Evening${data.eveningSubmittedAt ? '' : ' — not yet submitted'}`}
            chipVariant={eveningStatus.variant}
            chipLabel={`Evening: ${eveningStatus.label}`}
            headlineRow={EVENING_HEADLINE_ROW}
            secondaryRows={EVENING_SECONDARY_ROWS}
            dailyLogsId={data.id}
            columns={data.columns}
            edits={data.edits}
            submittedAt={data.eveningSubmittedAt}
            engineerName={data.engineerName}
            canEdit={canEdit}
            photoSections={photoSections}
            half="evening"
            now={now}
          />
        </div>
      </div>

      <div className="mt-4">
        <DailyLogNoPhotosMessage photoSections={photoSections} />
      </div>
    </div>
  )
}
