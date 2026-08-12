import { notFound } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'

type DprDetail = {
  id: string
  log_date: string
  content: string | null
  projects: { name: string } | null
}

function formatDate(date: string) {
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

// Extracted so a test can call it directly with an injected client — same
// pattern as runDprGenerateTrigger in app/api/cron/dpr-generate/route.ts.
//
// SECURITY PROPERTY, DELIBERATE (not a missing branch): a `null` return means
// EITHER no row exists for this id, OR a row exists but dprs_select's RLS
// policy (migration 023 — project_members-scoped, not tenant-wide) denies
// this viewer. Both cases render the IDENTICAL notFound() page. This is
// intentional, mirroring T-023-03's "anon sees zero rows, not a rejected
// call" default-deny shape: a PM must never be able to distinguish "this
// report doesn't exist" from "it exists but you can't see it" by watching
// how the page responds — either signal would leak that a project they
// aren't a member of has (or hasn't) generated a report today. Do not add a
// second branch to disambiguate these two cases.
export async function getDprDetail(client: SupabaseClient, id: string): Promise<DprDetail | null> {
  const { data, error } = await client
    .from('dprs')
    .select('id, log_date, content, projects(name)')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return data as unknown as DprDetail | null
}

export default async function DprDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = await createClient()
  const dpr = await getDprDetail(supabase, id)

  if (!dpr) notFound()

  return (
    <div className="p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-gray-900">{dpr.projects?.name ?? '—'}</h1>
        <p className="text-gray-500 text-sm mt-1">{formatDate(dpr.log_date)}</p>
      </div>

      {dpr.content === null ? (
        <div className="bg-white border border-gray-200 rounded-lg p-12 text-center">
          <p className="text-gray-700 font-medium">Not generated yet.</p>
          <p className="text-gray-500 text-sm mt-2">
            This report hasn&apos;t finished generating. Check back shortly, or
            look for it on the archive page.
          </p>
        </div>
      ) : (
        // Renders `content`, not `structured` — see the PR's own notes for the
        // full reasoning: content is renderContent(structured)'s own output
        // (lib/dpr/render.ts), so this page reimplements none of that file's
        // section/collapse rules by construction. whitespace-pre-wrap keeps
        // render.ts's exact line breaks and spacing (the fidelity that
        // matters); font-sans/leading-relaxed/max-w override only the
        // browser's default monospace <pre> styling so a plain-text report
        // reads as a document instead of a terminal dump — zero change to
        // what text is shown, purely how it's set.
        //
        // NOT THE REAL FIX, NAMED NOT BUILT: a future pass splitting
        // renderContent into a structured array of {section, lines} instead
        // of one joined string would let this page style real <h2> section
        // headings while still reusing render.ts's exact section-selection
        // and collapse logic — not needed for this PR, and not attempted
        // here to avoid touching render.ts's tested behaviour for a purely
        // cosmetic gain.
        <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-gray-800 max-w-[70ch]">
          {dpr.content}
        </pre>
      )}
    </div>
  )
}
