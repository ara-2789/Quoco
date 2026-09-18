import { PhotoImg } from '@/components/photos/photo-img'
import { HINDRANCE_PHOTO_ALT } from '@/lib/photos/copy'
import type { HindrancePhotoItem } from '@/lib/hindrance/queue'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md §5/§6
// revision). No heading ever on this page's cards -- a photo-less or
// non-PM card renders nothing at all, not an empty wrapper (D8/C7). Pure
// presentational, directly renderable in isolation (C7).
//
// Stage 5a, build slice B4 (Aravind, 2026-09-17): grid readability fix --
// no heading change (still none, per D3/D8/§5/§6 above). gap-3 matches
// this page's OWN established gap usage (app/(dashboard)/hindrances/
// page.tsx:97's card-list gap-3, and :155's chip-row gap-3), copied
// verbatim, not invented here.

export interface HindranceCardPhotosProps {
  isPm: boolean
  photos: HindrancePhotoItem[]
  now: Date
}

export function HindranceCardPhotos({ isPm, photos, now }: HindranceCardPhotosProps) {
  if (!isPm || photos.length === 0) return null
  return (
    <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
      {photos.map((p) => (
        <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={HINDRANCE_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
      ))}
    </div>
  )
}
