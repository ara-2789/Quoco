import { redirect } from 'next/navigation'
import { Building2 } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { MobileNav } from './mobile-nav'
import { SidebarNav, type SidebarNavLink } from './sidebar-nav'

async function signOut() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

// Safety, Invoices, and Hindrances removed 2026-09-03: all three routes
// have never existed (Fast-Follow, CLAUDE.md §2 -- "table exists, flow
// ships later"), and this array has no role gate, so every authenticated
// user has seen three broken nav links since the very first commit that
// created this file (a71e5fa, 2026-06-28) -- flagged and never acted on
// even then (docs/build-status.md's own Week 1 note: "Hide or disable them
// for the Spine so beta PMs don't click into empty sections"). Restore
// each one individually once its route is actually built -- do not batch
// them back in together.
//
// DATED UPDATE (2026-09-08): Hindrances restored -- DASH-07 Phase 1 shipped
// (docs/plans/dash-07-hindrance-queue.md), a real read-only /hindrances
// route now exists. Safety (DASH-06) and Invoices (DASH-05) still have no
// route and stay out, per the "do not batch them back in together" rule
// above -- restore each on its own, when its own route ships.
//
// UI SHELL RESTYLE, SLICE 1 (Aravind, 2026-09-18): "Dashboard" relabelled
// "Today" (matches the page's own DASH-01 framing, "the list of things
// that need the PM"); DPRs REMOVED FROM THIS NAV ONLY -- the /dprs route,
// its page, and every DPR code path are UNCHANGED and still fully
// reachable by URL. Nothing about DPRs was deleted; the link is coming
// back in a later slice, elsewhere in the shell, per Aravind's own
// instruction. Do not read this array's silence on DPRs as the feature
// being retired.
const NAV_LINKS: SidebarNavLink[] = [
  { label: 'Today', href: '/dashboard' },
  { label: 'Daily Logs', href: '/daily-logs' },
  { label: 'Hindrances', href: '/hindrances' },
  { label: 'Projects', href: '/projects' },
]

// "AR" from "Aravindan Rajamani"; "?" when there's nothing to initial
// from (no profile row, no name on it) -- never a blank circle, which
// would read as a loading state that never resolves.
function initialsFrom(fullName: string | null): string {
  if (!fullName) return '?'
  const parts = fullName.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const first = parts[0]![0]
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return (first + last).toUpperCase()
}

function formatIstNow(now: Date): string {
  return now.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'Asia/Kolkata',
  })
}

type SidebarProfile = { fullName: string | null; tenantName: string | null }

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // UI SHELL RESTYLE, SLICE 1: new read, local to this file -- not a
  // change to lib/auth/profile(-query).ts or any other shared query
  // module. Needed for the sidebar's name (task requires it; no "omit if
  // unavailable" escape hatch was given for that one, unlike the top
  // bar's company name below) -- the tenant name comes along for free
  // from the SAME row via one embedded FK select (users.tenant_id ->
  // tenants.id, already a real FK -- 001_schema.sql), so the top bar's
  // "only if already available, don't add a query for it" condition is
  // satisfied by reusing this same read rather than a second one.
  let sidebarProfile: SidebarProfile = { fullName: null, tenantName: null }
  {
    const { data } = await supabase
      .from('users')
      .select('full_name, tenants(name)')
      .eq('auth_id', user.id)
      .maybeSingle<{ full_name: string | null; tenants: { name: string } | null }>()
    if (data) {
      sidebarProfile = { fullName: data.full_name, tenantName: data.tenants?.name ?? null }
    }
  }

  const now = new Date()

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-brand-canvas">
      {/* md:hidden below — a `hidden` element takes zero space, so this
          addition does not change the md:+ row layout at all. */}
      <MobileNav navLinks={NAV_LINKS} signOutAction={signOut} />

      {/* Byte-identical at md:+ ("hidden md:flex md:w-60 md:flex-shrink-0"
          is exactly "flex w-60 flex-shrink-0" once `hidden` no longer
          applies); simply absent below md:, where MobileNav renders instead. */}
      <aside className="hidden md:flex md:w-60 md:flex-shrink-0 bg-brand-ink flex-col">
        <div className="px-5 py-4">
          <span className="text-xl font-semibold text-white tracking-tight">QUOCO</span>
          <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-dim mt-0.5">
            Project Workspace
          </p>
        </div>

        <SidebarNav navLinks={NAV_LINKS} />

        <div className="px-3 py-3 border-t border-brand-panel space-y-2">
          <div className="flex items-center gap-2 px-3">
            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#5A5145] bg-brand-strong-muted text-xs font-medium text-white">
              {initialsFrom(sidebarProfile.fullName)}
            </span>
            <span className="truncate text-sm text-brand-soft">
              {sidebarProfile.fullName ?? 'Signed in'}
            </span>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm text-brand-soft rounded-md hover:bg-brand-panel hover:text-white transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <div className="flex-1 min-w-0 flex flex-col">
        {/* UI SHELL RESTYLE, SLICE 1: top bar. Left side (company name)
            renders only when this layout's own read above actually found
            one -- per Aravind's own instruction, no second query is added
            just to guarantee it always renders. */}
        <div className="flex items-center justify-between border-b border-brand-border bg-brand-paper px-4 py-3 sm:px-8">
          {sidebarProfile.tenantName ? (
            <div className="flex items-center gap-2 text-sm font-medium text-brand-strong-muted">
              <Building2 className="h-4 w-4 text-brand-muted" aria-hidden="true" />
              {sidebarProfile.tenantName}
            </div>
          ) : (
            <div />
          )}
          <span className="text-sm text-brand-muted">{formatIstNow(now)}</span>
        </div>

        <main className="flex-1 min-w-0 overflow-auto">{children}</main>
      </div>
    </div>
  )
}
