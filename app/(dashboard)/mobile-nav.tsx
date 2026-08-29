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
// present-but-hidden. No transition/duration classes anywhere: instant
// show/hide, per the house's low-motion style.

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

  // Auto-close on any route change (a nav link click, the back button,
  // anything) — the layout persists across client-side navigations within
  // (dashboard), so without this the panel would stay open after navigating.
  // Adjusted DURING RENDER, not in a useEffect — React's own recommended
  // pattern for resetting state when a prop changes (avoids the extra
  // render-then-effect-then-render cascade an effect-based reset causes;
  // eslint's react-hooks/set-state-in-effect flags the effect version).
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
          aria-controls="mobile-dashboard-nav"
          onClick={() => setOpen((o) => !o)}
          className="rounded-md px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-100"
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
              className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-100 hover:text-gray-900"
            >
              {label}
            </Link>
          ))}
          <form action={signOutAction} className="pt-2 mt-2 border-t border-gray-200">
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900"
            >
              Sign out
            </button>
          </form>
        </nav>
      )}
    </div>
  )
}
