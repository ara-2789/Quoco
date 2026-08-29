import { StatusChip } from '@/components/ui/status-chip'
import { deriveHalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import { canEditLog } from '@/lib/daily-logs/correction'
import type { LogDetail } from '@/lib/daily-logs/query'
import { ScalarFieldRow } from './scalar-field-row'
import { HolidayField } from './holiday-field'

export type LogDetailViewProps = {
  data: LogDetail
  dprDeliveryCopy: string
  viewerRole: string | null
  now: Date
}

const MORNING_ROWS = [
  { column: 'morning_plan', label: 'Morning plan' },
  { column: 'morning_execution_plan', label: 'Execution plan' },
] as const

const EVENING_ROWS = [
  { column: 'evening_output', label: 'What was done' },
  { column: 'evening_workers_on_site', label: 'Workers on site' },
  { column: 'evening_schedule_met', label: 'Plan met?' },
  { column: 'evening_schedule_miss_reason', label: "Reason plan wasn't met" },
] as const

function formatLogDate(logDate: string): string {
  return new Date(`${logDate}T00:00:00Z`).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function LogDetailView({ data, dprDeliveryCopy, viewerRole, now }: LogDetailViewProps) {
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
    <div className="mx-auto max-w-2xl p-6">
      <a
        href={`/daily-logs?date=${data.logDate}`}
        className="text-sm text-blue-600 hover:underline"
      >
        ← Back to Daily Logs
      </a>

      <div className="mt-3">
        <h1 className="text-xl font-semibold text-gray-900">{data.engineerName}</h1>
        <p className="mt-1 text-sm text-gray-500">{formatLogDate(data.logDate)}</p>
        <div className="mt-2 flex gap-2">
          <StatusChip variant={morningStatus.variant} label={`Morning: ${morningStatus.label}`} />
          <StatusChip variant={eveningStatus.variant} label={`Evening: ${eveningStatus.label}`} />
        </div>
      </div>

      <p className="mt-4 rounded-md border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-600">
        {dprDeliveryCopy}
      </p>

      <div className="mt-6 divide-y divide-gray-100">
        <section>
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">Day</h2>
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

        <section>
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Morning{data.morningSubmittedAt ? '' : ' — not yet submitted'}
          </h2>
          {MORNING_ROWS.map(({ column, label }) => (
            <ScalarFieldRow
              key={column}
              dailyLogsId={data.id}
              column={column}
              label={label}
              currentValue={data.columns[column]}
              edit={data.edits[column]}
              submittedAt={data.morningSubmittedAt}
              engineerName={data.engineerName}
              canEdit={canEdit}
            />
          ))}
        </section>

        <section>
          <h2 className="pt-3 text-xs font-semibold uppercase tracking-wide text-gray-400">
            Evening{data.eveningSubmittedAt ? '' : ' — not yet submitted'}
          </h2>
          {EVENING_ROWS.map(({ column, label }) => (
            <ScalarFieldRow
              key={column}
              dailyLogsId={data.id}
              column={column}
              label={label}
              currentValue={data.columns[column]}
              edit={data.edits[column]}
              submittedAt={data.eveningSubmittedAt}
              engineerName={data.engineerName}
              canEdit={canEdit}
            />
          ))}
        </section>
      </div>
    </div>
  )
}
