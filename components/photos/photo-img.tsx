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
//
// Stage 5a, build slice B4 (Aravind, 2026-09-17): thumbnail presentation.
// The <a> wraps the SAME path the <img> already points at -- never
// photoUrl, never a signed URL -- so tapping a thumbnail opens the exact
// route this component already trusts, under its own tenant/PM check, not
// a second, independently-derived link. "Kept until" reuses the caption
// class already established for provenance captions elsewhere in this
// codebase (components/daily-logs/scalar-field-row.tsx:59, "As reported
// by ..."; independently corroborated by app/(dashboard)/hindrances/
// page.tsx:156,167's own captions) -- copied verbatim, not invented here.

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
  const href = `/api/photos/${kind}/${id}`

  return (
    <figure>
      <a href={href} target="_blank" rel="noopener noreferrer">
        <div className="aspect-square overflow-hidden rounded-md bg-gray-100">
          {failed ? (
            <div className="flex h-full w-full items-center justify-center p-2 text-center">
              <p className="text-xs text-gray-700">{PHOTO_UNAVAILABLE_TEXT}</p>
            </div>
          ) : (
            <img
              src={href}
              alt={alt}
              loading="lazy"
              onError={() => setFailed(true)}
              className="h-full w-full object-cover"
            />
          )}
        </div>
      </a>
      {keptUntil !== null && <figcaption className="text-xs text-gray-700">{keptUntil}</figcaption>}
    </figure>
  )
}
