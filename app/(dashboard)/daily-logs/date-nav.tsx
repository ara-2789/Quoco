'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { isValidCalendarDate } from '@/lib/daily-logs/date'

// Date stepper for the Daily Logs board. Drives ?date=YYYY-MM-DD. Pure string
// math on the calendar date (no timezone concern — the date is already an IST
// calendar day chosen server-side). The page only ever passes a validated date,
// but these helpers guard defensively so a malformed value can never silently
// roll over (Date.UTC(2026, 1, 31) -> 03 Mar) and mislabel the day (S2).

function shift(date: string, days: number): string {
  if (!isValidCalendarDate(date)) return date
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
}

function pretty(date: string): string {
  if (!isValidCalendarDate(date)) return date
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-IN', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  })
}

export function DateNav({ date, today }: { date: string; today: string }) {
  const router = useRouter()
  const go = (d: string) => router.push(`/daily-logs?date=${d}`)
  const isToday = date === today
  // Do not let the PM step into the future — no check-ins can exist there.
  const canGoNext = date < today

  return (
    <div className="flex items-center gap-2">
      <button
        onClick={() => go(shift(date, -1))}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50"
        aria-label="Previous day"
      >
        <ChevronLeft className="h-4 w-4" />
      </button>
      <span className="min-w-[10rem] text-center text-sm font-medium text-gray-900">{pretty(date)}</span>
      <button
        onClick={() => canGoNext && go(shift(date, 1))}
        disabled={!canGoNext}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
        aria-label="Next day"
      >
        <ChevronRight className="h-4 w-4" />
      </button>
      {!isToday && (
        <button
          onClick={() => go(today)}
          className="ml-1 rounded-md border border-gray-200 px-3 py-1.5 text-sm font-medium text-gray-600 hover:bg-gray-50"
        >
          Today
        </button>
      )}
      {/* UI slice 2 (Aravind, 2026-09-18): native date input alongside the
          existing prev/next/Today controls, which keep working exactly as
          above -- this is additive, not a replacement. `date`/`today` are
          already IST calendar-date strings ('YYYY-MM-DD', istDateString
          upstream), the exact format <input type="date"> itself uses, so
          no new date library or timezone conversion is needed. No visible
          label (no new user-facing text) -- aria-label only. */}
      <input
        type="date"
        aria-label="Choose date"
        value={date}
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="ml-1 rounded-md border border-gray-200 px-2 py-1.5 text-sm text-gray-900 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
    </div>
  )
}
