import { StatusChip, type StatusVariant } from '@/components/ui/status-chip'
import { deriveHalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import { canEditLog, type UiVisibleColumn } from '@/lib/daily-logs/correction'
import { formatIstTime } from '@/lib/daily-logs/date'
import type { LogDetail, LatestEdit, RawTextColumn } from '@/lib/daily-logs/query'
import { isMeaningfulDependencyText } from '@/lib/daily-logs/query'
import type { DailyLogPhotoSectionsData } from '@/lib/daily-logs/photos'
import { DailyLogPhotoColumn, DailyLogNoPhotosMessage } from './photo-sections'
import { ScalarFieldRow } from './scalar-field-row'
import { HolidayField } from './holiday-field'

// UI slice 2 (Aravind, 2026-09-18). Both English only -- Tamil owed, NOT
// approved. VIEW_REPORTED_DETAILS_LABEL exported (UI slice 3) so the
// Daily Logs list page's own per-card expansion reuses this EXACT
// string, not a second copy of the same wording.
export const VIEW_REPORTED_DETAILS_LABEL = 'View reported details'
const REPORT_SENT_TO_OWNER_LABEL = 'Report sent to owner'
// UI slice 6 (Aravind, 2026-09-18). English only -- Tamil owed, NOT
// approved. Replaces the "Dependency" label the evening_tomorrow_needs
// field used while it lived inside the evening column's own secondary
// rows -- now that it renders as its own full-width line (see
// DependencyLine below), it gets this new, approved label instead.
// Exported so the Today page's own third "Needed tomorrow" section
// (app/(dashboard)/dashboard/page.tsx) can reuse this EXACT string for
// its heading too -- "same constant file and comment".
export const NEEDED_TOMORROW_LABEL = 'Needed tomorrow'
export const NEEDED_TOMORROW_HEADING = 'Needed tomorrow'

// fix/daily-log-fields (Aravind, 2026-09-18). English only -- Tamil owed,
// NOT approved. Taken verbatim from the Owner DPR's own render.ts labels
// (lib/dpr/render.ts) so PM and Owner share wording for the same
// underlying data, per this fix's own instruction -- read there for
// wording only, nothing imported from lib/dpr. WORK_COMPLETED_LABEL
// REPLACES the old "What was done" label on evening_output (same column,
// same ScalarFieldRow, only the label text changes). The other five
// replace morning_execution_plan/evening_workers_on_site/
// evening_schedule_met, which nothing writes (verified by repo-wide grep,
// see this PR's own report) -- these five read the columns that actually
// hold the engineer's real answers instead.
export const WORK_COMPLETED_LABEL = 'Work completed'
export const MORNING_LABOUR_LABEL = 'Morning labour reported'
export const MACHINES_REPORTED_LABEL = 'Machines reported'
export const EVENING_LABOUR_LABEL = 'Evening labour reported'
export const MACHINE_USAGE_LABEL = 'Machine usage'
export const IDLE_HOURS_LABEL = 'Idle hours'

// RawTextColumn (the five jsonb columns above, each shaped
// { raw_text: string | null, ... } -- parsed breakdown fields alongside
// raw_text never rendered here, per this fix's own "not the parsed
// breakdown" instruction) is defined in lib/daily-logs/query.ts, the
// data layer, and imported below -- not redefined here, so the query's
// own select and this component's own row list can never drift apart on
// which five columns they mean. Not part of UiVisibleColumn/
// CorrectableColumn (lib/daily-logs/correction.ts) -- these were never
// in the correction whitelist and stay that way; no Edit affordance is
// possible for them (RawTextFieldRow below has none).

/** { raw_text: string | null } -- anything else (wrong shape, blank string) reads as absent. */
function extractRawText(value: unknown): string | null {
  if (value === null || typeof value !== 'object') return null
  const raw = (value as { raw_text?: unknown }).raw_text
  return typeof raw === 'string' && raw.trim() !== '' ? raw : null
}

// Presentational only -- no useFieldCorrection, no Edit button, ever
// (these columns are not correctable; see RawTextColumn's own comment).
// Visually identical to ScalarFieldRow's own view-mode row (same
// label/value/provenance layout, same "Not set" treatment) so the two
// kinds of rows line up in the same list without looking like two
// different components glued together.
function RawTextFieldRow({
  label,
  value,
  submittedAt,
  engineerName,
}: {
  label: string
  value: string | null
  submittedAt: string | null
  engineerName: string
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-xs font-medium text-gray-700">{label}</div>
        <div className="mt-0.5 text-sm text-gray-900 whitespace-pre-wrap break-words">{value ?? 'Not set'}</div>
        {submittedAt && (
          <div className="mt-0.5 text-xs text-gray-700">
            As reported by {engineerName}, {formatIstTime(submittedAt)}
          </div>
        )}
      </div>
    </div>
  )
}

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
// UI slice 3 (Aravind, 2026-09-18): exported so the Daily Logs list
// page's own per-card expansion (app/(dashboard)/daily-logs/engineer-
// card.tsx) can reuse these EXACT SAME (column, label) pairs for its own
// headline rows -- "reusing the same components and wording the detail
// page already uses," not a second, independently-typed copy of either
// label that could drift from this one.
export const MORNING_HEADLINE_ROW: Row = { kind: 'scalar', column: 'morning_plan', label: 'Morning plan' }
// fix/daily-log-fields (Aravind, 2026-09-18): morning_execution_plan
// REMOVED -- confirmed by repo-wide grep (lib/**, app/**, supabase/
// migrations/**) that no live code path writes it; the LIVE
// apply_morning_flow_turn (migration 038, the latest CREATE OR REPLACE)
// never sets it, and lib/whatsapp/flows/morning.ts:18 says so directly
// ("the OLD step 4... retired -- no longer written"). It read as
// permanently "Not set" on every real row. Replaced with the two fields
// that actually hold the engineer's morning answers -- 'kind: text' rows
// read straight off the jsonb columns' own raw_text (extractRawText
// above), never the parsed breakdown, matching the Owner DPR's own
// render.ts wording exactly (read there for labels only).
export const MORNING_SECONDARY_ROWS: readonly Row[] = [
  { kind: 'text', column: 'morning_manpower', label: MORNING_LABOUR_LABEL },
  { kind: 'text', column: 'morning_equipment', label: MACHINES_REPORTED_LABEL },
]

// fix/daily-log-fields: label changed from "What was done" to
// WORK_COMPLETED_LABEL ("Work completed") -- same column
// (evening_output), same ScalarFieldRow, same correctability. Matches
// the Owner DPR's own wording for the identical data.
export const EVENING_HEADLINE_ROW: Row = { kind: 'scalar', column: 'evening_output', label: WORK_COMPLETED_LABEL }
// fix/daily-log-fields: evening_workers_on_site/evening_schedule_met
// REMOVED -- same grep finding as morning_execution_plan above; the LIVE
// apply_evening_flow_turn (migration 040, the latest CREATE OR REPLACE)
// never sets either. Replaced with the three fields that actually hold
// the engineer's evening answers, read the same raw_text way as the
// morning ones above. evening_tomorrow_needs stays removed from this
// list (UI slice 6, DependencyLine below) -- unrelated to this change,
// not reverted.
export const EVENING_SECONDARY_ROWS: readonly Row[] = [
  { kind: 'text', column: 'evening_manpower', label: EVENING_LABOUR_LABEL },
  { kind: 'text', column: 'evening_equipment_utilisation', label: MACHINE_USAGE_LABEL },
  { kind: 'text', column: 'evening_idle_hours', label: IDLE_HOURS_LABEL },
]

const DEPENDENCY_ROW = { kind: 'scalar', column: 'evening_tomorrow_needs', label: NEEDED_TOMORROW_LABEL } as const

function formatLogDate(logDate: string): string {
  return new Date(`${logDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

// fix/daily-log-fields (Aravind, 2026-09-18): widened to a discriminated
// union -- 'scalar' rows are real, correctable daily_logs columns
// (ScalarFieldRow, as before); 'text' rows are the five raw_text-bearing
// jsonb columns (RawTextFieldRow above, never correctable, no Edit
// affordance). Both kinds share the same label/value/"As reported by"
// visual shape so a half's field list looks like ONE list, not two
// glued-together component types.
type Row =
  | { kind: 'scalar'; column: UiVisibleColumn; label: string }
  | { kind: 'text'; column: RawTextColumn; label: string }

// fix/daily-log-fields: Partial, not a strict Record -- the detail
// page's own LogDetail.columns genuinely carries every UiVisibleColumn +
// RawTextColumn key (getDailyLogDetail selects and populates all of
// them), but the Daily Logs list card's own logColumns() helper
// (engineer-card.tsx) deliberately does NOT provide morning_execution_
// plan/evening_workers_on_site/evening_schedule_met any more -- the
// board query no longer selects them (nothing writes them; see this
// PR's own report), so there is nothing real to put there. A strict
// Record would force fabricating fake null values just to satisfy the
// type; Partial lets a caller supply only the keys it actually has --
// ScalarFieldRow/extractRawText already treat a missing/undefined value
// exactly like an explicit null (both read as "Not set"/absent).
type HalfColumns = Partial<Record<UiVisibleColumn, unknown>> & Partial<Record<RawTextColumn, unknown>>

function renderRow(
  row: Row,
  ctx: {
    dailyLogsId: string
    columns: HalfColumns
    edits: Partial<Record<UiVisibleColumn, LatestEdit>>
    submittedAt: string | null
    engineerName: string
    canEdit: boolean
  },
) {
  if (row.kind === 'scalar') {
    return (
      <ScalarFieldRow
        key={`${ctx.dailyLogsId}-${row.column}`}
        dailyLogsId={ctx.dailyLogsId}
        column={row.column}
        label={row.label}
        currentValue={ctx.columns[row.column]}
        edit={ctx.edits[row.column]}
        submittedAt={ctx.submittedAt}
        engineerName={ctx.engineerName}
        canEdit={ctx.canEdit}
      />
    )
  }
  return (
    <RawTextFieldRow
      key={`${ctx.dailyLogsId}-${row.column}`}
      label={row.label}
      value={extractRawText(ctx.columns[row.column])}
      submittedAt={ctx.submittedAt}
      engineerName={ctx.engineerName}
    />
  )
}

// UI slice 2: one half's column -- heading + its own status chip (task 1:
// "each column keeps its own status chip"), the headline field always
// visible, every other reported field inside a closed-by-default
// <details> (native disclosure, same choice already made for the
// reactivate CTA one file over -- no shadcn, per CLAUDE.md §3), then that
// half's own photos, always visible (never collapsed).
//
// UI slice 5 (Aravind, 2026-09-18): exported so the Daily Logs list
// card's own expansion (app/(dashboard)/daily-logs/engineer-card.tsx) can
// reuse this EXACT rendering -- "every reported field... with its
// existing label and its As reported by line... presented as the detail
// page presents it" -- rather than a second, drifting copy of the same
// layout. Nothing about this function's own body changed for that reuse.
export function HalfColumn({
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
  columns: HalfColumns
  edits: Partial<Record<UiVisibleColumn, LatestEdit>>
  submittedAt: string | null
  engineerName: string
  canEdit: boolean
  photoSections: DailyLogPhotoSectionsData | null
  half: 'morning' | 'evening'
  now: Date
}) {
  const ctx = { dailyLogsId, columns, edits, submittedAt, engineerName, canEdit }
  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-medium text-gray-900">{heading}</h2>
        <StatusChip variant={chipVariant} label={chipLabel} />
      </div>

      {/* UI slice 4 follow-up (Aravind, 2026-09-18): keyed on dailyLogsId --
          the detail route ([logId]) is a soft client-side navigation
          between two engineers'/dates' logs, so without a key React
          reconciles this instance in place and keeps the PREVIOUS log's
          seeded useReducer state (initialFieldRowState runs once, on
          first mount only) -- the same bug as the daily-logs list card,
          fixed one level up (engineer-card.tsx). dailyLogsId changes on a
          real log change and stays fixed across an in-place edit/save
          (SAVE_SUCCESS), so it forces a remount only when it should. */}
      {renderRow(headlineRow, ctx)}

      {secondaryRows.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-brand-muted hover:text-brand-strong-muted">
            {VIEW_REPORTED_DETAILS_LABEL}
          </summary>
          <div className="mt-1 divide-y divide-gray-100">{secondaryRows.map((row) => renderRow(row, ctx))}</div>
        </details>
      )}

      <div className="mt-4">
        <DailyLogPhotoColumn photoSections={photoSections} half={half} now={now} />
      </div>
    </div>
  )
}

// UI slice 6 (Aravind, 2026-09-18): the Daily Logs list card's own
// expansion (app/(dashboard)/daily-logs/engineer-card.tsx). Was: HalfColumn
// above, which nests a SECOND "View reported details" disclosure around
// secondaryRows -- fine on the detail page (its only collapsible), but on
// the list card that stacked on top of the card's OWN outer "View
// reported details" summary, two clicks to read one half. HalfFields
// drops the inner disclosure entirely (every field in `rows` renders
// directly, flat, in order) AND drops the heading+status-chip HalfColumn
// renders at its own top -- the list card's collapsed rows already show
// "Morning -- Submitted 10:53 am" etc., so repeating "Morning"/
// "Evening: Submitted" inside the expansion once more said nothing new.
// `rows` is the full ordered field list for one half (headline +
// secondary, e.g. [MORNING_HEADLINE_ROW, ...MORNING_SECONDARY_ROWS]) --
// this is genuinely all that half HAS; a shorter half simply renders
// fewer rows (no invented filler field), and each field's own null value
// still gets ScalarFieldRow's existing "Not set" text, unchanged.
export function HalfFields({
  rows,
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
  rows: readonly Row[]
  dailyLogsId: string
  columns: HalfColumns
  edits: Partial<Record<UiVisibleColumn, LatestEdit>>
  submittedAt: string | null
  engineerName: string
  canEdit: boolean
  photoSections: DailyLogPhotoSectionsData | null
  half: 'morning' | 'evening'
  now: Date
}) {
  const ctx = { dailyLogsId, columns, edits, submittedAt, engineerName, canEdit }
  return (
    <div>
      <div className="divide-y divide-gray-100">{rows.map((row) => renderRow(row, ctx))}</div>

      <div className="mt-4">
        <DailyLogPhotoColumn photoSections={photoSections} half={half} now={now} />
      </div>
    </div>
  )
}

// UI slice 6: evening_tomorrow_needs, moved out of the evening column
// entirely ("in both the list card and the detail view") -- its own
// full-width line beneath both columns, labelled NEEDED_TOMORROW_LABEL,
// keeping ScalarFieldRow's own existing "As reported by ..." line
// unchanged. Renders nothing at all when the field has no value ("Show
// the line only when the field has a value") -- unlike HalfFields'
// aligned rows above, which always render (even a "Not set" row); this
// is a genuinely different rule for a genuinely different field, not an
// inconsistency.
export function DependencyLine({
  dailyLogsId,
  columns,
  edits,
  submittedAt,
  engineerName,
  canEdit,
}: {
  dailyLogsId: string
  columns: Partial<Record<UiVisibleColumn, unknown>>
  edits: Partial<Record<UiVisibleColumn, LatestEdit>>
  submittedAt: string | null
  engineerName: string
  canEdit: boolean
}) {
  // fix/daily-log-fields (Aravind, 2026-09-18): was a bare null/blank
  // check; now shares isMeaningfulDependencyText with getNeededTomorrow
  // Items' own selector (lib/daily-logs/query.ts) -- ONE "None"-answers-
  // aren't-notices rule, not two copies that could drift apart. A
  // non-string value (shouldn't happen for this column, but the prop
  // type is `unknown`) still reads as absent.
  const value = columns[DEPENDENCY_ROW.column]
  if (typeof value !== 'string' || !isMeaningfulDependencyText(value)) return null
  return (
    <div className="mt-4">
      <ScalarFieldRow
        key={dailyLogsId}
        dailyLogsId={dailyLogsId}
        column={DEPENDENCY_ROW.column}
        label={DEPENDENCY_ROW.label}
        currentValue={value}
        edit={edits[DEPENDENCY_ROW.column]}
        submittedAt={submittedAt}
        engineerName={engineerName}
        canEdit={canEdit}
      />
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
        className="text-sm text-brand-orange hover:underline"
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
        <a href={dprLinkHref} className="mt-2 inline-block text-sm text-brand-orange hover:underline">
          {REPORT_SENT_TO_OWNER_LABEL}
        </a>
      )}

      <div className="mt-6 divide-y divide-gray-100">
        <section>
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-600">Day</h2>
          <HolidayField
            key={data.id}
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

      {/* UI slice 6 (Aravind, 2026-09-18): the dependency line, moved out
          of the evening column above -- full width, beneath both
          columns, own "Needed tomorrow" label. */}
      <DependencyLine
        dailyLogsId={data.id}
        columns={data.columns}
        edits={data.edits}
        submittedAt={data.eveningSubmittedAt}
        engineerName={data.engineerName}
        canEdit={canEdit}
      />

      <div className="mt-4">
        <DailyLogNoPhotosMessage photoSections={photoSections} />
      </div>
    </div>
  )
}
