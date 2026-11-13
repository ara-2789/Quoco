import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { closeViewerEntry, dialogNeedsShowModal, nativeCloseOutOfSync, parseViewerHash, pushViewerEntry, stripViewerHashOnMount, type HistoryLike, type LocationLike } from '@/components/material-inward/viewer-logic'

// PR-D1b: the leftover "#photo-<id>" after Save details (manual run, 12 Nov). Node only, no DOM.
//
// WHAT THIS MIMICS: Next 16.2.11, node_modules/next/dist/client/components/app-router.js.
//   :252-261 / :268-278  window.history.pushState / replaceState are patched:
//        if (data?.__NA || data?._N) { return original(data, _unused, url) }   // :255 / :271  -> the router is NOT told about the URL
//        data = copyNextJsInternalHistoryState(data)                          // :84-95  (null -> {}, copies __NA from the current state)
//        if (url) applyUrlFromHistoryPushReplace(url)                         // :237-247 -> canonicalUrl follows the URL
//   :44-67  on every router state change (a server action with revalidatePath is one) the router runs
//        window.history.replaceState({ __NA: true, ... }, '', canonicalUrl)   // re-applies ITS url
//   :284-300 popstate: the router takes window.location.href as its canonicalUrl.
// The fake below reproduces exactly these rules; it is a stand-in, not Next itself. Whether the real router behaves so is READ, and is
// re-checked in the manual run (docs/reviews/pr-d1b-manual-run.md).

const FILE_ID = '88888888-8888-4888-8888-888888888888'
const BASE = 'http://localhost:3000'
const PAGE = '/material-inward/b9995385-c2da-476b-9cec-fa4ab989fdd9'

interface Entry {
  url: string
  state: unknown
}

function makeBrowser(startUrl: string) {
  const entries: Entry[] = [{ url: BASE + startUrl, state: { __NA: true } }]
  let index = 0
  const popstate: Array<() => void> = []
  const router = { canonicalUrl: BASE + startUrl }

  const resolve = (url: string) => new URL(url, entries[index].url).href
  const cur = () => entries[index]

  const native = {
    push(data: unknown, url: string) {
      entries.splice(index + 1)
      entries.push({ url: resolve(url), state: data })
      index++
    },
    replace(data: unknown, url: string) {
      entries[index] = { url: resolve(url), state: data }
    },
  }
  const isNext = (d: unknown) => !!d && typeof d === 'object' && ((d as { __NA?: boolean }).__NA || (d as { _N?: boolean })._N)
  const copyInternal = (d: unknown) => {
    const out = (d ?? {}) as Record<string, unknown>
    if ((cur().state as { __NA?: boolean } | null)?.__NA) out.__NA = true
    return out
  }

  // the patched window.history
  const history: HistoryLike & { readonly state: unknown } = {
    get state() {
      return cur().state
    },
    pushState(data, _u, url) {
      if (isNext(data)) return native.push(data, url as string) // :255
      const d = copyInternal(data) // :258
      if (url) router.canonicalUrl = resolve(url) // :260 -> :237-247
      native.push(d, url as string)
    },
    replaceState(data, _u, url) {
      if (isNext(data)) return native.replace(data, url as string) // :271
      const d = copyInternal(data) // :274
      if (url) router.canonicalUrl = resolve(url) // :276 -> :237-247
      native.replace(d, url as string)
    },
    back() {
      if (index === 0) return
      index--
      router.canonicalUrl = cur().url // :284-300
      popstate.forEach((f) => f())
    },
  }
  const forward = () => {
    if (index >= entries.length - 1) return
    index++
    router.canonicalUrl = cur().url
    popstate.forEach((f) => f())
  }
  // :44-67: the router rewrites the URL from its canonicalUrl after a server action / refresh
  const routerRefresh = () => native.replace({ __NA: true }, router.canonicalUrl)

  const location: LocationLike = {
    get pathname() {
      return new URL(cur().url).pathname
    },
    get search() {
      return new URL(cur().url).search
    },
    get hash() {
      return new URL(cur().url).hash
    },
  }
  return { history, location, router, forward, routerRefresh, realUrl: () => cur().url, onPopstate: (f: () => void) => popstate.push(f) }
}

/** The viewer's own state machine, as file-viewer.tsx wires it (open, pushed, sync on popstate, close). */
function mountViewer(b: ReturnType<typeof makeBrowser>) {
  const v = { open: false, pushed: false }
  stripViewerHashOnMount(b.history, b.location)
  b.onPopstate(() => {
    const mine = parseViewerHash(b.location.hash, [FILE_ID]) === FILE_ID
    if (!mine) v.pushed = false
    v.open = mine
  })
  return {
    v,
    open() {
      pushViewerEntry(b.history, FILE_ID)
      v.pushed = true
      v.open = true
    },
    close() {
      if (closeViewerEntry(b.history, b.location, v.pushed) === 'cleared') v.open = false
    },
  }
}

describe('PR-D1b hash sync with the router (fake of Next 16.2.11)', () => {
  it('REPRO of the manual run: open, Back, Forward, Close, router refresh (Save details): no #photo- left, URL equals the router\'s URL at every step', () => {
    const b = makeBrowser(PAGE)
    const m = mountViewer(b)
    const same = () => expect(b.realUrl()).toBe(b.router.canonicalUrl)

    m.open()
    expect(b.realUrl()).toContain('#photo-')
    same()
    b.history.back()
    expect(m.v.open).toBe(false)
    expect(b.realUrl()).not.toContain('#photo-')
    same()
    b.forward()
    expect(m.v.open).toBe(true)
    same()
    m.close() // pushed is false after the Back, so the hash is cleared in place
    expect(m.v.open).toBe(false)
    expect(b.realUrl()).not.toContain('#photo-')
    same()
    b.routerRefresh() // Save details
    expect(b.realUrl()).not.toContain('#photo-')
    same()
  })

  it('a router refresh while the overlay is OPEN keeps the hash (the second symptom: Close must still find its entry)', () => {
    const b = makeBrowser(PAGE)
    const m = mountViewer(b)
    m.open()
    b.routerRefresh()
    expect(b.realUrl()).toContain(`#photo-${FILE_ID}`)
    expect(b.realUrl()).toBe(b.router.canonicalUrl)
    m.close() // pushed: history.back()
    expect(m.v.open).toBe(false)
    expect(new URL(b.realUrl()).pathname).toBe(PAGE) // stayed on the page
    expect(b.realUrl()).not.toContain('#photo-')
  })

  it('open then Close (the normal path): back to the clean entry, URL equals canonicalUrl, refresh keeps it clean', () => {
    const b = makeBrowser(PAGE)
    const m = mountViewer(b)
    m.open()
    m.close()
    expect(m.v.open).toBe(false)
    expect(b.realUrl()).toBe(BASE + PAGE)
    b.routerRefresh()
    expect(b.realUrl()).toBe(BASE + PAGE)
    expect(b.realUrl()).toBe(b.router.canonicalUrl)
  })

  it('mount strips a leftover hash (R3), and a refresh does not bring it back', () => {
    const b = makeBrowser(`${PAGE}#photo-${FILE_ID}`)
    const m = mountViewer(b)
    expect(m.v.open).toBe(false)
    expect(b.realUrl()).toBe(BASE + PAGE)
    expect(b.realUrl()).toBe(b.router.canonicalUrl)
    b.routerRefresh()
    expect(b.realUrl()).toBe(BASE + PAGE)
  })

  it('the three calls pass NULL data: no Next marker (__NA / _N) ever reaches the patched history', () => {
    const seen: unknown[] = []
    const spy: HistoryLike = {
      pushState: (d) => void seen.push(d),
      replaceState: (d) => void seen.push(d),
      back: () => undefined,
    }
    const loc: LocationLike = { pathname: PAGE, search: '', hash: `#photo-${FILE_ID}` }
    pushViewerEntry(spy, FILE_ID)
    stripViewerHashOnMount(spy, loc)
    closeViewerEntry(spy, loc, false)
    expect(seen).toEqual([null, null, null])
  })
})

describe('S1 (review round 1): a native dialog close that skipped `cancel` must sync React', () => {
  it('close fired, React still open, dialog no longer open: the close sequence must run', () => {
    expect(nativeCloseOutOfSync(true, false)).toBe(true)
  })
  it('React already closed (our own close path): nothing to sync', () => {
    expect(nativeCloseOutOfSync(false, false)).toBe(false)
  })
  it('dialog still open: nothing to sync', () => {
    expect(nativeCloseOutOfSync(true, true)).toBe(false)
  })
  it('openViewer shows an element that exists but is closed; never one that is already showing or absent', () => {
    expect(dialogNeedsShowModal({ open: false })).toBe(true)
    expect(dialogNeedsShowModal({ open: true })).toBe(false)
    expect(dialogNeedsShowModal(null)).toBe(false)
  })
  it('the dialog element is wired to both helpers (source check: the DOM wiring itself is the manual S1 run)', () => {
    const src = readFileSync(resolve(__dirname, '../components/material-inward/file-viewer.tsx'), 'utf8')
    expect(src).toMatch(/onClose=\{[\s\S]*?nativeCloseOutOfSync\(open, e\.currentTarget\.open\)/)
    expect(src).toContain('dialogNeedsShowModal(dlg)')
  })
})

describe('N5 (review round 1): the fake router above models one exact Next version', () => {
  it('next is pinned at 16.2.11', () => {
    const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8')) as { dependencies: Record<string, string> }
    expect(
      pkg.dependencies.next,
      "Next version changed: re-run PR-D1b manual checks R1–R3 (viewer history) and update test/pm-viewer-history.test.ts's fake router.",
    ).toBe('16.2.11')
  })
})
