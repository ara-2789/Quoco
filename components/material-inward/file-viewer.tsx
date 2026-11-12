'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { PM_FILE_PREVIEW_ALT, PM_VIEWER_CLOSE, PM_VIEWER_ROTATE } from '@/lib/capture/pm-copy'
import { closeViewerEntry, nextRotation, parseViewerHash, pushViewerEntry, stripViewerHashOnMount } from './viewer-logic'

// PR-D1b photo viewer for ONE stored image: a thumbnail button, and a full-screen overlay in the same tab.
//
// IMAGE SOURCE: always the route path /api/capture-files/<id>, as a plain image element (never next/image). The browser follows the
// route's 302 to a 60 s signed URL itself; that URL is never in our HTML, and neither is the storage host or a token.
// Rendering the overlay content only while it is open means the overlay does not request the image a second time on page load.
//
// BACK BUTTON: the URL hash is the single source of truth. Open pushes "#photo-<id>"; Back pops it, popstate fires, the
// overlay closes. Close / Esc call history.back() when this document pushed the entry, so Back and Close leave the same
// history. A page that LOADS with a "#photo-…" hash (a reload while open, or a pasted link) does NOT open: on mount the hash is
// replaced with the clean URL (R3). Forward after Back re-opens (popstate with the hash). Rotation is CSS only, in memory,
// reset on close, and makes no request.

const IMG_PATH = (id: string) => `/api/capture-files/${id}`

export function ViewerPanel({ fileId, rotation, onClose, onRotate }: { fileId: string; rotation: number; onClose: () => void; onRotate: () => void }) {
  const turned = rotation % 180 !== 0
  return (
    <div className="flex h-full w-full flex-col items-center gap-3 p-3">
      <div className="flex gap-3">
        <button
          type="button"
          autoFocus
          onClick={onClose}
          className="inline-flex items-center justify-center rounded-md bg-white px-4 py-3 text-sm font-medium text-gray-900"
        >
          {PM_VIEWER_CLOSE}
        </button>
        <button
          type="button"
          onClick={onRotate}
          className="inline-flex items-center justify-center rounded-md bg-white px-4 py-3 text-sm font-medium text-gray-900"
        >
          {PM_VIEWER_ROTATE}
        </button>
      </div>
      <div className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image is banned here: the route 302s to a signed URL */}
        <img
          src={IMG_PATH(fileId)}
          alt={PM_FILE_PREVIEW_ALT}
          className="object-contain"
          style={{
            transform: `rotate(${rotation}deg)`,
            maxWidth: turned ? '80vh' : '95vw',
            maxHeight: turned ? '90vw' : '80vh',
          }}
        />
      </div>
    </div>
  )
}

export function FileImage({ fileId }: { fileId: string }) {
  const [open, setOpen] = useState(false)
  const [rotation, setRotation] = useState(0)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const pushed = useRef(false)
  const wasOpen = useRef(false)

  // R3: a leftover viewer hash on load is cleared, never opened.
  useEffect(() => {
    stripViewerHashOnMount(window.history, window.location)
  }, [])

  // Back / Forward: open exactly when the hash names this file.
  useEffect(() => {
    function sync() {
      const mine = parseViewerHash(window.location.hash, [fileId]) === fileId
      if (!mine) pushed.current = false
      setRotation(0)
      setOpen(mine)
    }
    window.addEventListener('popstate', sync)
    return () => window.removeEventListener('popstate', sync)
  }, [fileId])

  // The native <dialog> gives the focus trap and the top layer; it is shown / closed from `open`.
  useEffect(() => {
    const dlg = dialogRef.current
    if (open && dlg && !dlg.open) dlg.showModal()
    if (!open && wasOpen.current) triggerRef.current?.focus()
    wasOpen.current = open
  }, [open])

  const openViewer = useCallback(() => {
    pushViewerEntry(window.history, fileId)
    pushed.current = true
    setRotation(0)
    setOpen(true)
  }, [fileId])

  const closeViewer = useCallback(() => {
    setRotation(0)
    // 'back': the popstate listener (sync) closes the overlay. 'cleared': the hash was removed in place, so close it here.
    if (closeViewerEntry(window.history, window.location, pushed.current) === 'cleared') setOpen(false)
  }, [])

  return (
    <>
      <button ref={triggerRef} type="button" onClick={openViewer} className="rounded-md border border-brand-border p-1">
        {/* eslint-disable-next-line @next/next/no-img-element -- next/image is banned here: the route 302s to a signed URL */}
        <img src={IMG_PATH(fileId)} alt={PM_FILE_PREVIEW_ALT} className="max-h-64 w-auto max-w-full rounded object-contain" />
      </button>
      {open && (
        <dialog
          ref={dialogRef}
          aria-label={PM_FILE_PREVIEW_ALT}
          onCancel={(e) => {
            e.preventDefault() // Esc: go through the same close path as the Close button
            closeViewer()
          }}
          className="m-0 h-dvh max-h-none w-dvw max-w-none bg-black/90 p-0 text-white"
        >
          <ViewerPanel fileId={fileId} rotation={rotation} onClose={closeViewer} onRotate={() => setRotation((r) => nextRotation(r))} />
        </dialog>
      )}
    </>
  )
}
