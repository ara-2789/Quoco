'use client'

import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

// Mobile-only (md:hidden) top bar + inline nav panel, replacing the
// always-visible 240px <aside> below the md: breakpoint (design-principles
// Rule 4.6 — "assume the dashboard is used at 6:45 PM on a phone").
//
// INLINE PANEL, NOT AN OFF-CANVAS DRAWER — same decision PR #137 already
// made for the DASH-03 correction UI, applied a second time, not a fresh
// preference: a correctly-built dialog needs focus trap, backdrop,
// escape-to-close, and scroll-lock — the exact list that pushed #137 toward
// shadcn rather than hand-rolling it, and the exact list an off-canvas
// drawer needs too. This panel is normal document flow instead: no fixed
// positioning, no backdrop, no scroll-lock, no z-index. If either decision
// is revisited, revisit both together — they're the same tradeoff.
//
// Conditionally RENDERED (not CSS-hidden) while closed, so the nav links are
// simply absent from the DOM — and therefore from tab order — rather than
// present-but-hidden. The PANEL itself has no transition/duration classes —
// instant show/hide, per the house's low-motion style. That "no motion" rule
// is scoped to the panel's own mount/unmount; ordinary hover-state color
// transitions (`transition-colors`, below) are a different, much subtler
// category the rest of the house uses everywhere (including the desktop
// <aside>'s own links, one file up) — they're kept here to match, not
// dropped in the name of the same rule.

export type MobileNavLink = { label: string; href: string }

export function MobileNav({
  navLinks,
  signOutAction,
}: {
  navLinks: MobileNavLink[]
  signOutAction: () => Promise<void>
}) {
  const [open, setOpen] = useState(false)
  const pathname = usePathname()

  // Auto-close on any route CHANGE (the back button, a link elsewhere on the
  // page, anything that isn't this panel's own links) — the layout persists
  // across client-side navigations within (dashboard), so without this the
  // panel would stay open after navigating. Adjusted DURING RENDER, not in a
  // useEffect — React's own recommended pattern for resetting state when a
  // prop changes (avoids the extra render-then-effect-then-render cascade an
  // effect-based reset causes; eslint's react-hooks/set-state-in-effect flags
  // the effect version).
  //
  // NOT SUFFICIENT ON ITS OWN: tapping the link for the route already open
  // doesn't change pathname, so this watcher never fires for that tap — the
  // panel would stay open and the tap would look ignored. The onClick on
  // each Link below covers exactly that case. Keep BOTH — they cover
  // different triggers (this: navigation from anywhere; that: a tap on one
  // of THIS panel's own links, same-route or not), not one mechanism
  // duplicating the other.
  const [prevPathname, setPrevPathname] = useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setOpen(false)
  }

  return (
    <div className="md:hidden border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-lg font-semibold text-gray-900 tracking-tight">Quoco</span>
        <button
          type="button"
          aria-expanded={open}
          // No aria-controls: #mobile-dashboard-nav is conditionally
          // RENDERED (see the header comment) and simply absent from the DOM
          // while closed, so the reference would dangle half the time. That
          // conditional render is the deliberate choice — it's what keeps
          // the panel's links out of tab order while closed — so it stays,
          // and aria-controls is dropped rather than switching to
          // render-and-hide just to keep the attribute valid.
          onClick={() => setOpen((o) => !o)}
          className="rounded-md px-3 py-3 text-sm font-medium text-gray-700 hover:bg-gray-100 transition-colors"
        >
          {open ? 'Close menu' : 'Menu'}
        </button>
      </div>

      {open && (
        <nav id="mobile-dashboard-nav" className="border-t border-gray-200 px-3 py-3 space-y-0.5">
          {navLinks.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              // Covers the same-route tap the pathname watcher above can't
              // (see that comment) — both stay, different triggers.
              onClick={() => setOpen(false)}
              className="flex items-center px-3 py-3 text-base text-gray-700 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              {label}
            </Link>
          ))}
          <form action={signOutAction} className="pt-2 mt-2 border-t border-gray-200">
            <button
              type="submit"
              className="w-full text-left px-3 py-3 text-base text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              Sign out
            </button>
          </form>
        </nav>
      )}
    </div>
  )
}
