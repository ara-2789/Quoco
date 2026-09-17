import { PhotoImg } from '@/components/photos/photo-img'
import {
  MORNING_PHOTOS_HEADING,
  EVENING_PHOTOS_HEADING,
  NO_PHOTOS_FOR_LOG_TEXT,
  MORNING_PHOTO_ALT,
  EVENING_PHOTO_ALT,
} from '@/lib/photos/copy'
import type { DailyLogPhotoSectionsData } from '@/lib/daily-logs/photos'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D1/
// D3/D8). Pure presentational component -- synchronous, no data fetching
// -- so it is directly renderable in isolation (react-dom/server's
// renderToStaticMarkup, C7's rendered-output proof).
//
// photoSections === null means "not a PM on this project" (R1 revision,
// §4 D3) -- renders NOTHING at all, not an empty section (D3/C7). A
// section with zero photos renders no heading (Aravind, 2026-09-17,
// unknowns #1/#2 resolved); "No photos for this log." appears ONLY when
// BOTH morning and evening are empty, for a PM (D8, literal for this
// page).

export interface DailyLogPhotoSectionsProps {
  photoSections: DailyLogPhotoSectionsData | null
  now: Date
}

export function DailyLogPhotoSections({ photoSections, now }: DailyLogPhotoSectionsProps) {
  if (!photoSections) return null
  const { morning, evening } = photoSections

  if (morning.length === 0 && evening.length === 0) {
    return <p>{NO_PHOTOS_FOR_LOG_TEXT}</p>
  }

  return (
    <>
      {morning.length > 0 && (
        <section>
          <h2>{MORNING_PHOTOS_HEADING}</h2>
          {morning.map((p) => (
            <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={MORNING_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
          ))}
        </section>
      )}
      {evening.length > 0 && (
        <section>
          <h2>{EVENING_PHOTOS_HEADING}</h2>
          {evening.map((p) => (
            <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={EVENING_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
          ))}
        </section>
      )}
    </>
  )
}
