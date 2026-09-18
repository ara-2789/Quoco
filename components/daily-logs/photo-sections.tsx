import { PhotoImg } from '@/components/photos/photo-img'
import {
  MORNING_PHOTOS_HEADING,
  EVENING_PHOTOS_HEADING,
  NO_PHOTOS_FOR_LOG_TEXT,
  MORNING_PHOTO_ALT,
  EVENING_PHOTO_ALT,
} from '@/lib/photos/copy'
import type { DailyLogPhotoSectionsData, DailyLogPhotoItem } from '@/lib/daily-logs/photos'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md, D1/
// D3/D8). Pure presentational -- synchronous, no data fetching -- so it
// is directly renderable in isolation (react-dom/server's
// renderToStaticMarkup, C7's rendered-output proof).
//
// photoSections === null means "not a PM on this project" (R1 revision,
// §4 D3) -- renders NOTHING at all, not an empty section (D3/C7). A
// section with zero photos renders no heading (Aravind, 2026-09-17,
// unknowns #1/#2 resolved); "No photos for this log." appears ONLY when
// BOTH morning and evening are empty, for a PM (D8, literal for this
// page).
//
// Stage 5a, build slice B4 (Aravind, 2026-09-17): headings/grid
// readability fix. HEADING_CLASSES below is copied VERBATIM from this
// page's own existing section headings -- components/daily-logs/log-
// detail-view.tsx's own "Day"/"Morning"/"Evening" <h2>s -- not a new
// style. The thumbnail grid uses gap-2, matching this same page's own
// nearby gap usage (the StatusChip row).
const HEADING_CLASSES = 'text-xs font-semibold uppercase tracking-wide text-gray-600'

// UI slice 2 (Aravind, 2026-09-18): morning/evening now render inside
// TWO SEPARATE columns (log-detail-view.tsx's own split), not one
// combined block -- so the combined DailyLogPhotoSections component from
// B3/B4 is REPLACED here by two smaller pieces the column layout can
// place independently: one photo grid for a single half
// (DailyLogPhotoColumn), and the combined empty-state message on its
// own (DailyLogNoPhotosMessage), since D8's "No photos for this log."
// still depends on BOTH halves being empty together, not either column
// alone. Nothing about D1/D3/D8/D9's own rules changed, only where each
// piece renders. test/photo-sections-render.test.tsx's own
// "DailyLogPhotoSections" describe block is updated to match (see that
// file) -- this is a real prop-shape change, not a colour-only edit, so
// updating the test is the correct response, not a shortcut.

export interface DailyLogPhotoColumnProps {
  photoSections: DailyLogPhotoSectionsData | null
  half: 'morning' | 'evening'
  now: Date
}

export function DailyLogPhotoColumn({ photoSections, half, now }: DailyLogPhotoColumnProps) {
  if (!photoSections) return null
  const items: DailyLogPhotoItem[] = photoSections[half]
  if (items.length === 0) return null

  const heading = half === 'morning' ? MORNING_PHOTOS_HEADING : EVENING_PHOTOS_HEADING
  const alt = half === 'morning' ? MORNING_PHOTO_ALT : EVENING_PHOTO_ALT

  return (
    <section>
      <h2 className={HEADING_CLASSES}>{heading}</h2>
      <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {items.map((p) => (
          <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={alt} expiresAt={p.expiresAt} now={now} />
        ))}
      </div>
    </section>
  )
}

export function DailyLogNoPhotosMessage({ photoSections }: { photoSections: DailyLogPhotoSectionsData | null }) {
  if (!photoSections) return null
  if (photoSections.morning.length > 0 || photoSections.evening.length > 0) return null
  return <p>{NO_PHOTOS_FOR_LOG_TEXT}</p>
}
