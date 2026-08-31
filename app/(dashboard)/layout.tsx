import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MobileNav } from './mobile-nav'

async function signOut() {
  'use server'
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect('/login')
}

const NAV_LINKS = [
  { label: 'Dashboard', href: '/dashboard' },
  { label: 'Projects', href: '/projects' },
  { label: 'Daily Logs', href: '/daily-logs' },
  { label: 'DPRs', href: '/dprs' },
  { label: 'Safety', href: '/safety' },
  { label: 'Invoices', href: '/invoices' },
  { label: 'Hindrances', href: '/hindrances' },
]

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  return (
    <div className="flex flex-col md:flex-row min-h-screen bg-gray-50">
      {/* md:hidden below — a `hidden` element takes zero space, so this
          addition does not change the md:+ row layout at all. */}
      <MobileNav navLinks={NAV_LINKS} signOutAction={signOut} />

      {/* Byte-identical at md:+ ("hidden md:flex md:w-60 md:flex-shrink-0"
          is exactly "flex w-60 flex-shrink-0" once `hidden` no longer
          applies); simply absent below md:, where MobileNav renders instead. */}
      <aside className="hidden md:flex md:w-60 md:flex-shrink-0 bg-white border-r border-gray-200 flex-col">
        <div className="px-5 py-4 border-b border-gray-200">
          <span className="text-xl font-semibold text-gray-900 tracking-tight">Quoco</span>
          <p className="text-xs text-gray-500 mt-0.5">Construction Management</p>
        </div>

        <nav className="flex-1 px-3 py-3 space-y-0.5">
          {NAV_LINKS.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              className="flex items-center px-3 py-2 text-sm text-gray-700 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              {label}
            </Link>
          ))}
        </nav>

        <div className="px-3 py-3 border-t border-gray-200">
          <form action={signOut}>
            <button
              type="submit"
              className="w-full text-left px-3 py-2 text-sm text-gray-600 rounded-md hover:bg-gray-100 hover:text-gray-900 transition-colors"
            >
              Sign out
            </button>
          </form>
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">{children}</main>
    </div>
  )
}
