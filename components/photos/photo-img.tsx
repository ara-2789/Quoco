'use client'

import { useState } from 'react'
import type { PhotoKind } from '@/lib/storage/photo-access'
import { PHOTO_UNAVAILABLE_TEXT, formatKeptUntilLine } from '@/lib/photos/copy'

// Stage 5a, build slice B3. The ONE place in this codebase that builds a
// photo <img src> (task item 4; D6). Takes kind+id only, NEVER photoUrl --
// a raw Storage object path cannot reach this component's props by
// construction, so it cannot leak into HTML through here. The route
// (app/api/photos/[kind]/[photoId]/route.ts, B1, IMPORT ONLY) re-derives
// its own signed URL from kind+id under its own tenant/PM check; nothing
// here authorizes anything on its own.
//
// 'use client' because the "Photo unavailable..." fallback needs onError,
// which Server Components can't run. This is a leaf component -- no data
// fetching, no Supabase import.

export interface PhotoImgProps {
  kind: PhotoKind
  id: string
  alt: string
  expiresAt: string
  now: Date
}

export function PhotoImg({ kind, id, alt, expiresAt, now }: PhotoImgProps) {
  const [failed, setFailed] = useState(false)
  const keptUntil = formatKeptUntilLine(expiresAt, now)

  return (
    <figure>
      {failed ? (
        <p>{PHOTO_UNAVAILABLE_TEXT}</p>
      ) : (
        <img
          src={`/api/photos/${kind}/${id}`}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
        />
      )}
      {keptUntil !== null && <figcaption>{keptUntil}</figcaption>}
    </figure>
  )
}
