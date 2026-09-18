import Link from 'next/link'
import { StatusChip } from '@/components/ui/status-chip'
import { Card } from '@/components/ui/card'
import { deriveHalfStatus, type Half, type HalfStatus } from '@/lib/daily-logs/status'
import { DEFAULT_CUTOFFS } from '@/lib/daily-logs/cutoffs'
import { ScalarFieldRow } from '@/components/daily-logs/scalar-field-row'
import { MORNING_HEADLINE_ROW, EVENING_HEADLINE_ROW, VIEW_REPORTED_DETAILS_LABEL } from '@/components/daily-logs/log-detail-view'
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
// NO NEW QUERY: getDailyLogsBoard (lib/daily-logs/query.ts) already
// selects morning_plan and evening_output on the SAME daily_logs read
// this page always ran -- both headline fields the expansion needs were
// already sitting on `eng.log`, unused, before this slice. The
// "As reported by {engineer}, {time}" provenance line comes from
// ScalarFieldRow's own existing logic (engineerName + submittedAt, no
// `edit` prop passed -- this board never fetched daily_log_edits, and
// the task's own wording only asks for the "As reported by" case, never
// "Corrected by"), reusing that exact component in read-only mode
// (canEdit={false} hides its [Edit] affordance entirely, not disabled --
// same convention canEdit already follows everywhere else it's used).

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
          <div className="mt-2 grid grid-cols-1 divide-y divide-brand-border md:grid-cols-2 md:divide-x md:divide-y-0">
            <div className="py-2 first:pt-0 md:py-0 md:pr-4">
              {/* UI slice 4 (Aravind, 2026-09-18): key={eng.log.id} is the
                  actual bug fix, not decoration. ScalarFieldRow is a
                  Client Component whose displayed text comes from
                  useFieldCorrection's useReducer(fieldRowReducer,
                  initialFieldRowState(initialValue)) -- React evaluates
                  that initializer ONLY on this component instance's
                  FIRST mount (lib/daily-logs/use-field-correction.ts:30,
                  lib/daily-logs/field-row-state.ts:44-45). Navigating
                  via DateNav's prev/next/Today/date-input
                  (./date-nav.tsx) changes only the ?date= search param
                  on the SAME /daily-logs route -- a soft client
                  navigation. getDailyLogsBoard (lib/daily-logs/
                  query.ts) correctly re-fetches and passes the new
                  date's morning_plan/evening_output as fresh props, but
                  without a key that changes too, React RECONCILES this
                  same component instance instead of remounting it, so
                  the reducer's own state.currentValue -- seeded once,
                  from whichever date was first viewed in this browser
                  tab -- never resyncs to the new prop, and the card
                  keeps showing that first-viewed date's text forever
                  after. eng.log.id is a distinct id per (project,
                  engineer, log_date) row by construction, so keying on
                  it forces a genuine remount exactly when the
                  underlying row actually changes -- never on an
                  in-place edit/save, which intentionally updates this
                  same instance's state instead (SAVE_SUCCESS,
                  use-field-correction.ts:59). HalfRow above was never
                  affected -- it holds no state of its own, rendering
                  directly from fresh status/submittedAt props every
                  render. */}
              <ScalarFieldRow
                key={eng.log.id}
                dailyLogsId={eng.log.id}
                column={MORNING_HEADLINE_ROW.column}
                label={MORNING_HEADLINE_ROW.label}
                currentValue={eng.log.morning_plan}
                submittedAt={eng.log.morning_submitted_at}
                engineerName={eng.engineerName}
                canEdit={false}
              />
            </div>
            <div className="py-2 last:pb-0 md:py-0 md:pl-4">
              <ScalarFieldRow
                key={eng.log.id}
                dailyLogsId={eng.log.id}
                column={EVENING_HEADLINE_ROW.column}
                label={EVENING_HEADLINE_ROW.label}
                currentValue={eng.log.evening_output}
                submittedAt={eng.log.evening_submitted_at}
                engineerName={eng.engineerName}
                canEdit={false}
              />
            </div>
          </div>
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
