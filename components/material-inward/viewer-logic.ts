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

// ---- history calls (PR-D1b, fix for the leftover #photo hash)
//
// Next 16.2.11 patches window.history.pushState / replaceState (node_modules/next/dist/client/components/app-router.js:252-276). A call whose
// data carries Next's own marker (`__NA` / `_N`, which is what `window.history.state` holds) is passed straight through and the router is NOT
// told about the new URL (:255, :271). A call with any other data (null) reaches applyUrlFromHistoryPushReplace(url) (:237-247), which keeps the
// router's canonicalUrl equal to the real URL. The router rewrites the URL from its canonicalUrl on every state change (:64-66, e.g. after a server
// action), so the viewer must always use the second kind: data is null in all three calls below, never window.history.state.

export interface HistoryLike {
  pushState(data: unknown, unused: string, url?: string | null): void
  replaceState(data: unknown, unused: string, url?: string | null): void
  back(): void
}
export interface LocationLike {
  pathname: string
  search: string
  hash: string
}

/** Open: one new entry whose URL carries the viewer hash. */
export function pushViewerEntry(history: HistoryLike, fileId: string): void {
  history.pushState(null, '', viewerHash(fileId))
}

/** The current entry's URL without the hash (no new entry). */
export function clearViewerHash(history: HistoryLike, location: Pick<LocationLike, 'pathname' | 'search'>): void {
  history.replaceState(null, '', location.pathname + location.search)
}

/** Mount: a leftover viewer hash (a reload while open, a pasted link) is stripped, never opened. Returns whether it stripped one. */
export function stripViewerHashOnMount(history: HistoryLike, location: LocationLike): boolean {
  if (!isViewerHash(location.hash)) return false
  clearViewerHash(history, location)
  return true
}

/**
 * Close / Esc. history.back() only when THIS document pushed the entry ('back': the popstate listener then closes the overlay);
 * otherwise the hash is cleared in place ('cleared': the caller closes the overlay itself).
 */
export function closeViewerEntry(history: HistoryLike, location: LocationLike, pushedByThisDocument: boolean): 'back' | 'cleared' {
  if (pushedByThisDocument) {
    history.back()
    return 'back'
  }
  clearViewerHash(history, location)
  return 'cleared'
}

// ---- native dialog sync (PR-D1b review round 1, S1)
//
// Esc and the Android Back gesture are "close requests". Chrome only fires a cancellable `cancel` event if the page has had user
// activation since the last cancelled close; without it the <dialog> closes NATIVELY and only `close` fires. So the viewer also
// listens to `close`, and re-opens through showModal() directly rather than relying on a React state change that may be a no-op.

/** `close` fired but React still thinks the viewer is open: the dialog was closed natively and the close sequence must run. */
export function nativeCloseOutOfSync(reactOpen: boolean, dialogOpen: boolean): boolean {
  return reactOpen && !dialogOpen
}

/** The dialog element exists but is not showing (closed natively): it must be shown again directly on the next open. */
export function dialogNeedsShowModal(dialog: { open: boolean } | null): boolean {
  return dialog !== null && !dialog.open
}
