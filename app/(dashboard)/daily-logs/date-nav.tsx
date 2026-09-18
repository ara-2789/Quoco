'use client'

import { useRouter } from 'next/navigation'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { isValidCalendarDate } from '@/lib/daily-logs/date'

// Date stepper for the Daily Logs board. Drives ?date=YYYY-MM-DD. Pure string
// math on the calendar date (no timezone concern — the date is already an IST
// calendar day chosen server-side). The page only ever passes a validated date,
// but this helper guards defensively so a malformed value can never silently
// roll over (Date.UTC(2026, 1, 31) -> 03 Mar) and mislabel the day (S2).
//
// UI slice 3 (Aravind, 2026-09-18): ONE control now, not three. The
// separate long-form date text ("Thu, 17 Sept, 2026") this file used to
// render alongside the arrows, and the separate native date input added
// in #300, are both gone -- the input is now the ONLY date display, sitting
// between the two arrows. `pretty()` (the long-form formatter) is removed
// entirely, not just unused, since nothing calls it anymore.

function shift(date: string, days: number): string {
  if (!isValidCalendarDate(date)) return date
  const [y, m, d] = date.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCDate(dt.getUTCDate() + days)
  return dt.toISOString().slice(0, 10)
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
      {/* The input IS the date display now (no visible label -- no new
          user-facing text -- aria-label only). `date`/`today` are already
          IST calendar-date strings ('YYYY-MM-DD', istDateString
          upstream), the exact format <input type="date"> itself uses, so
          no new date library or timezone conversion is needed. Styled
          with the brand tokens (border-brand-border/bg-brand-paper/
          hover:bg-brand-canvas) so it reads as part of this control, not
          a raw browser field -- the two arrow buttons either side keep
          their own existing neutral-grey styling, unchanged, since this
          task only asked for the input's own treatment. Focus ring left
          as the existing blue -- an accessibility signal, not a brand
          colour, so out of scope for the brand-accent cleanup (task 4)
          the same way task 4 itself asks focus-visible outlines to stay
          untouched. */}
      <input
        type="date"
        aria-label="Choose date"
        value={date}
        max={today}
        onChange={(e) => e.target.value && go(e.target.value)}
        className="rounded-md border border-brand-border bg-brand-paper px-2 py-1.5 text-sm text-gray-900 hover:bg-brand-canvas focus:outline-none focus:ring-2 focus:ring-blue-500"
      />
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
    </div>
  )
}
