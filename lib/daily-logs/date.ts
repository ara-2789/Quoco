// Pure date helpers for the Daily Logs board (DASH-03). No server/next/react
// imports, so this is safe to import from both the server page and the 'use
// client' DateNav, and directly unit-testable.

/**
 * True only if `s` is a real calendar date in strict "YYYY-MM-DD" form.
 *
 * A regex alone is not enough: "2026-02-31" and "2026-13-01" match the shape but
 * are not real dates. JS `Date` silently ROLLS them over (Feb 31 -> Mar 3), which
 * downstream becomes either a wrong board or — when fed to Postgres as a date
 * literal — a query error. So we round-trip: construct the date in UTC, reformat,
 * and require the reformat to equal the input exactly. Rollover changes the
 * string, so it fails.
 */
export function isValidCalendarDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return (
    dt.getUTCFullYear() === y &&
    dt.getUTCMonth() === m - 1 &&
    dt.getUTCDate() === d
  )
}

/** IST calendar date "YYYY-MM-DD" for a UTC instant (the board's default date). */
export function istDateString(now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now)
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')}`
}
