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
//
// Stage 5a, build slice B4 (Aravind, 2026-09-17): headings/grid
// readability fix. This page has no <h2> section heading of its own to
// diverge from (its only other content is a plain <pre> block, per this
// page's own file header) -- HEADING_CLASSES is the SAME class copied
// verbatim from the one real section-heading precedent in this codebase,
// components/daily-logs/log-detail-view.tsx:97,113,132, applied here for
// consistency rather than inventing a second heading style. Grid gap:
// this page has no existing gap-utility precedent of its own either;
// gap-3 is chosen to match the hindrances queue's own established gap-3
// (app/(dashboard)/hindrances/page.tsx:97,155), not copied from this page.
const HEADING_CLASSES = 'text-xs font-semibold uppercase tracking-wide text-gray-400'

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
          <h2 className={HEADING_CLASSES}>{EVENING_PHOTOS_HEADING}</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {evening.map((p) => (
              <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={EVENING_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
            ))}
          </div>
        </section>
      )}
      {hindrance.length > 0 && (
        <section>
          <h2 className={HEADING_CLASSES}>{HINDRANCE_PHOTOS_HEADING}</h2>
          <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {hindrance.map((p) => (
              <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={HINDRANCE_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
            ))}
          </div>
        </section>
      )}
    </>
  )
}
