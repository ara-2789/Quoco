// Row-anatomy attribution line -- "Vikram Rao · 2 days ago"
// (docs/plans/dash-07-hindrance-queue.md §Row anatomy). This is a
// clock-relative label, not a calendar-relative one -- unlike the window
// predicate in lib/hindrance/queue.ts, it deliberately uses a raw ms
// difference, since "2 days ago" is about elapsed time, not calendar days.
export function formatHindranceAge(createdAt: string, now: Date): string {
  const diffMs = Math.max(0, now.getTime() - new Date(createdAt).getTime())
  const minutes = Math.floor(diffMs / 60_000)

  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const days = Math.floor(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

// UI slice 2 (Aravind, 2026-09-18): the reported date, IST, "{d MMM
// yyyy}" (e.g. "18 Sep 2026") -- for the row anatomy's own "{name} ·
// {date} · {age}" line, SAME timestamp formatHindranceAge above already
// uses (createdAt), not a second read of anything.
export function formatHindranceReportedDate(createdAt: string): string {
  return new Date(createdAt).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  })
}
