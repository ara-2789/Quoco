'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

// UI shell restyle, slice 1 (Aravind, 2026-09-18). Desktop <aside>'s own
// nav links, split out of layout.tsx (a Server Component) into a small
// client leaf — same reasoning MobileNav (one file up) already exists
// for: usePathname() needs a Client Component, and this is the only part
// of the desktop sidebar that does.
//
// Selected-state detection: exact match OR a "/segment/..." prefix match,
// so a detail route (e.g. /daily-logs/<id>) still highlights its own
// section's nav link — same convention MobileNav's own auto-close effect
// already treats pathname changes under, just applied to link selection
// instead.

export type SidebarNavLink = { label: string; href: string }

function isSelected(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

export function SidebarNav({ navLinks }: { navLinks: SidebarNavLink[] }) {
  const pathname = usePathname()

  return (
    <nav className="flex-1 px-3 py-3 space-y-0.5">
      {navLinks.map(({ label, href }) => {
        const selected = isSelected(pathname, href)
        return (
          <Link
            key={href}
            href={href}
            className={
              selected
                ? 'flex items-center border-l-[3px] border-brand-orange bg-[#332C24] px-3 py-2 text-sm text-brand-orange-light rounded-r-md transition-colors'
                : 'flex items-center border-l-[3px] border-transparent px-3 py-2 text-sm text-brand-soft rounded-md hover:bg-brand-panel hover:text-white transition-colors'
            }
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
