import { PhotoImg } from '@/components/photos/photo-img'
import { EVENING_PHOTOS_HEADING, HINDRANCE_PHOTOS_HEADING, EVENING_PHOTO_ALT, HINDRANCE_PHOTO_ALT } from '@/lib/photos/copy'
import type { DprPhotoCandidate } from '@/lib/dpr/select-photo-candidates'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D2/
// D3/D8). Pure presentational component, same shape as
// components/daily-logs/photo-sections.tsx -- directly renderable in
// isolation (C7).
//
// photoSections === null means "not a PM" -- renders nothing. Zero total
// photos: no section at all, no placeholder (D8, literal for THIS page --
// unlike the daily-log page, there is no "No photos" string here). A
// section with zero photos renders no heading (same rule as the
// daily-log page, unknowns #1/#2).

export interface DprPhotoSectionsData {
  evening: DprPhotoCandidate[]
  hindrance: DprPhotoCandidate[]
}

export interface DprPhotoSectionsProps {
  photoSections: DprPhotoSectionsData | null
  now: Date
}

export function DprPhotoSections({ photoSections, now }: DprPhotoSectionsProps) {
  if (!photoSections) return null
  const { evening, hindrance } = photoSections
  if (evening.length === 0 && hindrance.length === 0) return null

  return (
    <>
      {evening.length > 0 && (
        <section>
          <h2>{EVENING_PHOTOS_HEADING}</h2>
          {evening.map((p) => (
            <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={EVENING_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
          ))}
        </section>
      )}
      {hindrance.length > 0 && (
        <section>
          <h2>{HINDRANCE_PHOTOS_HEADING}</h2>
          {hindrance.map((p) => (
            <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={HINDRANCE_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
          ))}
        </section>
      )}
    </>
  )
}
