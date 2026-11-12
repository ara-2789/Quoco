import type { PmFileItem } from '@/lib/capture/pm-queries'

// Pure helpers of the photo viewer (components/material-inward/file-viewer.tsx), kept free of React and the DOM so they run
// in the node test environment (test/pm-viewer.test.ts). No user-facing text lives here.

const HASH_PREFIX = '#photo-'
const HASH_RE = /^#photo-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

/** The URL hash that marks "the viewer is open on this file". */
export function viewerHash(fileId: string): string {
  return `${HASH_PREFIX}${fileId}`
}

/** Any hash of the viewer's own family, valid or not. Used on mount to clear a leftover one (R3: a reload never reopens). */
export function isViewerHash(hash: string): boolean {
  return hash.startsWith(HASH_PREFIX)
}

/** The file id a hash names, only when it is a well-formed id that is in `ids` (this delivery's viewable images). */
export function parseViewerHash(hash: string, ids: readonly string[]): string | null {
  const m = HASH_RE.exec(hash)
  if (!m) return null
  const wanted = m[1].toLowerCase()
  return ids.find((id) => id.toLowerCase() === wanted) ?? null
}

/** One 90-degree clockwise step. Display only: never stored, never sent. */
export function nextRotation(deg: number): number {
  return (((Math.round(deg / 90) * 90 + 90) % 360) + 360) % 360
}

/** A stored image the page can show inline. PDFs, locked/damaged files and not-yet-stored files are not. */
export function isViewableImage(f: Pick<PmFileItem, 'display' | 'contentType' | 'previewState'>): boolean {
  return f.display === 'stored' && (f.contentType ?? '').startsWith('image/') && f.previewState !== 'not_previewable'
}
