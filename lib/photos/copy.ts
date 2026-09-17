import { istDateString } from '@/lib/daily-logs/date'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, §5;
// approved 2026-09-17). The six approved user-facing strings, English
// only -- Tamil is owed, not yet approved. No other user-facing text is
// introduced by this slice.
//
// Alt text (Aravind, 2026-09-17, alongside these six) is NOT one of the
// six -- it is non-visual accessibility text -- but is still new
// user-facing text, so it is named and flagged the same way, not invented
// inline at a call site.

export const NO_PHOTOS_FOR_LOG_TEXT = 'No photos for this log.' // Tamil owed, NOT approved
export const MORNING_PHOTOS_HEADING = 'Morning photos' // Tamil owed, NOT approved
export const EVENING_PHOTOS_HEADING = 'Evening photos' // Tamil owed, NOT approved
export const HINDRANCE_PHOTOS_HEADING = 'Hindrance photos' // Tamil owed, NOT approved
export const PHOTO_UNAVAILABLE_TEXT = 'Photo unavailable. Refresh to try again.' // Tamil owed, NOT approved

export const MORNING_PHOTO_ALT = 'Morning check-in photo' // Tamil owed, NOT approved
export const EVENING_PHOTO_ALT = 'Evening check-in photo' // Tamil owed, NOT approved
export const HINDRANCE_PHOTO_ALT = 'Hindrance photo' // Tamil owed, NOT approved

/**
 * Approved template: "Kept until {date}" -- Tamil owed, NOT approved (D4).
 * Returns null, not a string, once expiresAt has passed -- the caller
 * renders nothing in that case (D4: hidden once past, no tombstone UI).
 * {date} is the IST calendar date, long form ("18 September 2026"), same
 * technique log-detail-view.tsx's own private formatLogDate already uses:
 * convert to an IST 'YYYY-MM-DD' string (istDateString, lib/daily-logs/
 * date.ts, IMPORT ONLY), then reformat via a UTC-midnight Date built from
 * that string so the locale formatter can't re-shift it across a zone.
 */
export function formatKeptUntilLine(expiresAt: string, now: Date): string | null {
  const expiry = new Date(expiresAt)
  if (expiry.getTime() <= now.getTime()) return null

  const istDate = istDateString(expiry)
  const [year, month, day] = istDate.split('-').map(Number)
  const long = new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  })
  return `Kept until ${long}`
}
