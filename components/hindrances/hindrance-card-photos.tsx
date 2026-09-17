import { PhotoImg } from '@/components/photos/photo-img'
import { HINDRANCE_PHOTO_ALT } from '@/lib/photos/copy'
import type { HindrancePhotoItem } from '@/lib/hindrance/queue'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md §5/§6
// revision). No heading ever on this page's cards -- a photo-less or
// non-PM card renders nothing at all, not an empty wrapper (D8/C7). Pure
// presentational, directly renderable in isolation (C7).

export interface HindranceCardPhotosProps {
  isPm: boolean
  photos: HindrancePhotoItem[]
  now: Date
}

export function HindranceCardPhotos({ isPm, photos, now }: HindranceCardPhotosProps) {
  if (!isPm || photos.length === 0) return null
  return (
    <div>
      {photos.map((p) => (
        <PhotoImg key={p.id} kind={p.kind} id={p.id} alt={HINDRANCE_PHOTO_ALT} expiresAt={p.expiresAt} now={now} />
      ))}
    </div>
  )
}
