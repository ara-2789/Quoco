=== EMAIL OTP PLAN — command transcript + plan ===
Generated: 2026-09-25T16:37:35Z

$ git fetch origin

$ git rev-parse origin/main
1c8a45138930df4ed59b76231105e5a30f07dd18

$ git log --oneline 78d7763..origin/main
1c8a451 Merge pull request #314 from ara-2789/feat/add-engineer-slice1
aac5552 test(engineers): cover trailing semicolon and colon stripped from a name
90b139c docs(plans): dated decisions D-A1..D-A11 and the T44(iv) deferral for add-engineer PR A (append-only)
dd0e080 test(engineers): boundary-literal source guard (T21), scoped to this slice's own files
7ce6a45 feat(projects): one link from the project page to the add-site-engineers screen (M1)
5433192 feat(engineers): add-site-engineers screen (page, form, server actions, preview panel) with render tests
f2129f9 feat(engineers): add-engineers RPC wrapper, preview/apply orchestration, and DB tests
c1f6327 feat(engineers): pure add-engineer lib - roster parser, TS gate, confirm-set check, with tests
4516e5c Merge pull request #313 from ara-2789/fix/session-cleanup-run-scoping
acd1f75 fix(test-helpers): scope cleanupTestSessions LIKE to this run's phone block
26009d9 test: positive control - cleanupTestSessions must not delete another run's session row
86e1b44 Merge pull request #312 from ara-2789/feat/copy-length-wording
4c82f82 copy(engineers): approved wording for name-too-long; record component-side acceptance conditions
5c350ad Merge pull request #311 from ara-2789/feat/add-engineer-plan
e541554 Merge branch 'main' into feat/add-engineer-plan
8b56e31 Merge pull request #310 from ara-2789/docs/ci-time-record
11a6938 docs: correction pass on CI time record — primary finding, five dated corrections, cross-links
e97c9fa docs: CI time and skip-policy record (where the time goes, what to change, which merges hit CI)
caab70b docs(plan): add-engineer plan rev13 - slice 1 closed pending the build; FK/CHECK settled by test-db observation; coverage entry and Rule 9 recorded
7fec452 docs(plan): add-engineer plan rev12 - slice 1 external-review conditions closed (S1-S6, N1-N3); Design GO conditional, no apply GO
6455bde docs(plan): add-engineer plan rev11 - slice 2 split into lifecycle + episodes; #45 list page settled in slice 1; #52 backfill required; D22 opened
2f1b098 docs(plan): split the add-engineer plan into two slices - add-engineer-plan.md (slice 1) + engineer-lifecycle-plan.md (slice 2)
eb8a9c2 docs(plan): add-engineer plan rev9 - D15 settled: episodes table; board rule restated; Preview/predicate/F5/split recorded
1765d21 docs(plan): add-engineer plan rev8 - review conditions closed; reactivate ships; merge = deploy
f407ba1 docs(plan): add-engineer plan rev7 - D13 settled (dated deactivation rule), F1 closed, deploy-order hazard
eff12a0 docs(plan): add-engineer plan rev6 - D12 Option D (index leaves the slice), F4 traced, F1 nuance
fad98e3 docs(plan): add-engineer plan rev5 - BLOCKING fixture finding (D12), D11 settled, F1/F4 traced
dba9cfc docs(plan): add-engineer plan rev4 - D8/D9/D10 settled, India-rule reason corrected, session trace
9b9187c docs(plan): add-engineer plan rev3 - deactivate, attribution, dry-run spec, validator, strings
e67e297 docs(plan): add-engineer plan rev2 - SECURITY DEFINER design, phone chain, 3 corrections
c86c5b6 docs(plan): add-engineer screen plan (plan only, no code, no migration)

$ git diff --stat 78d7763..origin/main -- 'app/(auth)' 'lib/supabase' 'app/(dashboard)/layout.tsx' middleware.ts
(empty = no auth-relevant files changed since prior inventory)

====================================================================
STEP 1 — SOURCE FILES (from origin/main @ 1c8a45138930df4ed59b76231105e5a30f07dd18)
====================================================================

$ git show origin/main:'app/(auth)/login/page.tsx'
     1	import { headers } from 'next/headers'
     2	import { redirect } from 'next/navigation'
     3	import { createClient } from '@/lib/supabase/server'
     4	
     5	async function sendMagicLink(formData: FormData) {
     6	  'use server'
     7	  const email = (formData.get('email') as string).trim()
     8	  const headersList = await headers()
     9	  const origin = headersList.get('origin') ?? `https://${headersList.get('host')}`
    10	
    11	  const supabase = await createClient()
    12	  const { error } = await supabase.auth.signInWithOtp({
    13	    email,
    14	    options: { emailRedirectTo: `${origin}/auth/callback` },
    15	  })
    16	
    17	  if (error) {
    18	    redirect(`/login?error=${encodeURIComponent(error.message)}`)
    19	  }
    20	  redirect(`/login?step=sent&email=${encodeURIComponent(email)}`)
    21	}
    22	
    23	export default async function LoginPage({
    24	  searchParams,
    25	}: {
    26	  searchParams: Promise<{ step?: string; email?: string; error?: string }>
    27	}) {
    28	  const params = await searchParams
    29	
    30	  if (params.step === 'sent') {
    31	    const email = params.email ?? ''
    32	    return (
    33	      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
    34	        <h2 className="text-xl font-semibold text-gray-900 mb-1">Check your email</h2>
    35	        <p className="text-gray-700 text-sm mb-6">
    36	          We sent a sign-in link to <strong>{email}</strong>. Click it to continue — the link
    37	          expires in 1 hour.
    38	        </p>
    39	        <p className="text-center text-sm text-gray-700">
    40	          Wrong email?{' '}
    41	          <a href="/login" className="text-blue-600 hover:underline">
    42	            Start over
    43	          </a>
    44	        </p>
    45	      </div>
    46	    )
    47	  }
    48	
    49	  return (
    50	    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
    51	      <h2 className="text-xl font-semibold text-gray-900 mb-1">Sign in</h2>
    52	      <p className="text-gray-700 text-sm mb-6">
    53	        Enter your work email to receive a sign-in link.
    54	      </p>
    55	
    56	      {params.error && (
    57	        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
    58	          {params.error}
    59	        </div>
    60	      )}
    61	
    62	      <form action={sendMagicLink} className="space-y-4">
    63	        <div>
    64	          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
    65	            Email address
    66	          </label>
    67	          <input
    68	            id="email"
    69	            name="email"
    70	            type="email"
    71	            required
    72	            autoComplete="email"
    73	            placeholder="you@company.com"
    74	            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
    75	          />
    76	        </div>
    77	        <button
    78	          type="submit"
    79	          className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
    80	        >
    81	          Send sign-in link
    82	        </button>
    83	      </form>
    84	    </div>
    85	  )
    86	}

$ git show origin/main:'app/(auth)/auth/callback/route.ts'
     1	import { createClient } from '@/lib/supabase/server'
     2	import { profileForAuthId } from '@/lib/auth/profile'
     3	import { NextRequest, NextResponse } from 'next/server'
     4	
     5	// Handles OAuth and magic-link redirect callbacks (not used by the OTP code flow).
     6	export async function GET(request: NextRequest) {
     7	  const { searchParams, origin } = new URL(request.url)
     8	  const code = searchParams.get('code')
     9	
    10	  if (!code) {
    11	    return NextResponse.redirect(`${origin}/login?error=Missing+auth+code`)
    12	  }
    13	
    14	  const supabase = await createClient()
    15	  const { error } = await supabase.auth.exchangeCodeForSession(code)
    16	
    17	  if (error) {
    18	    return NextResponse.redirect(
    19	      `${origin}/login?error=${encodeURIComponent(error.message)}`,
    20	    )
    21	  }
    22	
    23	  const {
    24	    data: { user },
    25	  } = await supabase.auth.getUser()
    26	
    27	  if (!user) {
    28	    return NextResponse.redirect(`${origin}/login`)
    29	  }
    30	
    31	  // Post-007: resolve the profile by auth_id. Reuse THIS client — it holds the
    32	  // just-exchanged session; a fresh createClient() here wouldn't see it yet
    33	  // (the session cookies are on the outgoing response, not the request).
    34	  const profile = await profileForAuthId(supabase, user.id)
    35	
    36	  return NextResponse.redirect(
    37	    profile.tenant_id ? `${origin}/dashboard` : `${origin}/onboarding`,
    38	  )
    39	}

$ git show origin/main:'lib/supabase/client.ts'
     1	import { createBrowserClient } from '@supabase/ssr'
     2	import type { Database } from '@/types/database'
     3	
     4	export function createClient() {
     5	  return createBrowserClient<Database>(
     6	    process.env.NEXT_PUBLIC_SUPABASE_URL!,
     7	    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
     8	  )
     9	}

$ git show origin/main:'lib/supabase/server.ts'
     1	import { createServerClient } from '@supabase/ssr'
     2	import { cookies } from 'next/headers'
     3	import type { Database } from '@/types/database'
     4	
     5	export async function createClient() {
     6	  const cookieStore = await cookies()
     7	
     8	  return createServerClient<Database>(
     9	    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    10	    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    11	    {
    12	      cookies: {
    13	        getAll() {
    14	          return cookieStore.getAll()
    15	        },
    16	        setAll(cookiesToSet) {
    17	          try {
    18	            cookiesToSet.forEach(({ name, value, options }) =>
    19	              cookieStore.set(name, value, options),
    20	            )
    21	          } catch {
    22	            // Silently ignored when called from a Server Component render.
    23	            // Session refresh is handled by proxy.ts on every request instead.
    24	          }
    25	        },
    26	      },
    27	    },
    28	  )
    29	}

$ git show origin/main:'lib/supabase/service.ts'
     1	import { createClient as createSupabaseClient } from '@supabase/supabase-js'
     2	import type { Database } from '@/types/database'
     3	
     4	// Service-role client for backend-only operations: the jobs queue worker,
     5	// cron endpoints, and the WhatsApp webhook. Bypasses RLS entirely.
     6	// NEVER import this file into anything that runs in the browser or in a
     7	// user-session-aware route. Server-side only, per CLAUDE.md §4 and §8.
     8	export function createServiceClient() {
     9	  return createSupabaseClient<Database>(
    10	    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    11	    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    12	    {
    13	      auth: {
    14	        autoRefreshToken: false,
    15	        persistSession: false,
    16	      },
    17	    },
    18	  )
    19	}
$ git ls-tree -r origin/main --name-only | grep -E '^app/\(dashboard\)/layout\.tsx$'
app/(dashboard)/layout.tsx

$ git show origin/main:'app/(dashboard)/layout.tsx'
     1	import { redirect } from 'next/navigation'
     2	import { Building2 } from 'lucide-react'
     3	import { createClient } from '@/lib/supabase/server'
     4	import { MobileNav } from './mobile-nav'
     5	import { SidebarNav, type SidebarNavLink } from './sidebar-nav'
     6	
     7	async function signOut() {
     8	  'use server'
     9	  const supabase = await createClient()
    10	  await supabase.auth.signOut()
    11	  redirect('/login')
    12	}
    13	
    14	// Safety, Invoices, and Hindrances removed 2026-09-03: all three routes
    15	// have never existed (Fast-Follow, CLAUDE.md §2 -- "table exists, flow
    16	// ships later"), and this array has no role gate, so every authenticated
    17	// user has seen three broken nav links since the very first commit that
    18	// created this file (a71e5fa, 2026-06-28) -- flagged and never acted on
    19	// even then (docs/build-status.md's own Week 1 note: "Hide or disable them
    20	// for the Spine so beta PMs don't click into empty sections"). Restore
    21	// each one individually once its route is actually built -- do not batch
    22	// them back in together.
    23	//
    24	// DATED UPDATE (2026-09-08): Hindrances restored -- DASH-07 Phase 1 shipped
    25	// (docs/plans/dash-07-hindrance-queue.md), a real read-only /hindrances
    26	// route now exists. Safety (DASH-06) and Invoices (DASH-05) still have no
    27	// route and stay out, per the "do not batch them back in together" rule
    28	// above -- restore each on its own, when its own route ships.
    29	//
    30	// UI SHELL RESTYLE, SLICE 1 (Aravind, 2026-09-18): "Dashboard" relabelled
    31	// "Today" (matches the page's own DASH-01 framing, "the list of things
    32	// that need the PM"); DPRs REMOVED FROM THIS NAV ONLY -- the /dprs route,
    33	// its page, and every DPR code path are UNCHANGED and still fully
    34	// reachable by URL. Nothing about DPRs was deleted; the link is coming
    35	// back in a later slice, elsewhere in the shell, per Aravind's own
    36	// instruction. Do not read this array's silence on DPRs as the feature
    37	// being retired.
    38	const NAV_LINKS: SidebarNavLink[] = [
    39	  { label: 'Today', href: '/dashboard' },
    40	  { label: 'Daily Logs', href: '/daily-logs' },
    41	  { label: 'Hindrances', href: '/hindrances' },
    42	  { label: 'Projects', href: '/projects' },
    43	]
    44	
    45	// "AR" from "Aravindan Rajamani"; "?" when there's nothing to initial
    46	// from (no profile row, no name on it) -- never a blank circle, which
    47	// would read as a loading state that never resolves.
    48	function initialsFrom(fullName: string | null): string {
    49	  if (!fullName) return '?'
    50	  const parts = fullName.trim().split(/\s+/).filter(Boolean)
    51	  if (parts.length === 0) return '?'
    52	  const first = parts[0]![0]
    53	  const last = parts.length > 1 ? parts[parts.length - 1]![0] : ''
    54	  return (first + last).toUpperCase()
    55	}
    56	
    57	function formatIstNow(now: Date): string {
    58	  return now.toLocaleString('en-IN', {
    59	    day: 'numeric',
    60	    month: 'short',
    61	    year: 'numeric',
    62	    hour: 'numeric',
    63	    minute: '2-digit',
    64	    hour12: true,
    65	    timeZone: 'Asia/Kolkata',
    66	  })
    67	}
    68	
    69	type SidebarProfile = { fullName: string | null; tenantName: string | null }
    70	
    71	export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
    72	  const supabase = await createClient()
    73	  const {
    74	    data: { user },
    75	  } = await supabase.auth.getUser()
    76	
    77	  if (!user) redirect('/login')
    78	
    79	  // UI SHELL RESTYLE, SLICE 1: new read, local to this file -- not a
    80	  // change to lib/auth/profile(-query).ts or any other shared query
    81	  // module. Needed for the sidebar's name (task requires it; no "omit if
    82	  // unavailable" escape hatch was given for that one, unlike the top
    83	  // bar's company name below) -- the tenant name comes along for free
    84	  // from the SAME row via one embedded FK select (users.tenant_id ->
    85	  // tenants.id, already a real FK -- 001_schema.sql), so the top bar's
    86	  // "only if already available, don't add a query for it" condition is
    87	  // satisfied by reusing this same read rather than a second one.
    88	  let sidebarProfile: SidebarProfile = { fullName: null, tenantName: null }
    89	  {
    90	    const { data } = await supabase
    91	      .from('users')
    92	      .select('full_name, tenants(name)')
    93	      .eq('auth_id', user.id)
    94	      .maybeSingle<{ full_name: string | null; tenants: { name: string } | null }>()
    95	    if (data) {
    96	      sidebarProfile = { fullName: data.full_name, tenantName: data.tenants?.name ?? null }
    97	    }
    98	  }
    99	
   100	  const now = new Date()
   101	
   102	  return (
   103	    <div className="flex flex-col md:flex-row min-h-screen bg-brand-canvas">
   104	      {/* md:hidden below — a `hidden` element takes zero space, so this
   105	          addition does not change the md:+ row layout at all. */}
   106	      <MobileNav navLinks={NAV_LINKS} signOutAction={signOut} />
   107	
   108	      {/* Byte-identical at md:+ ("hidden md:flex md:w-60 md:flex-shrink-0"
   109	          is exactly "flex w-60 flex-shrink-0" once `hidden` no longer
   110	          applies); simply absent below md:, where MobileNav renders instead. */}
   111	      <aside className="hidden md:flex md:w-60 md:flex-shrink-0 bg-brand-ink flex-col">
   112	        <div className="px-5 py-4">
   113	          <span className="text-xl font-semibold text-white tracking-tight">QUOCO</span>
   114	          <p className="text-[10px] font-semibold uppercase tracking-widest text-brand-dim mt-0.5">
   115	            Project Workspace
   116	          </p>
   117	        </div>
   118	
   119	        <SidebarNav navLinks={NAV_LINKS} />
   120	
   121	        <div className="px-3 py-3 border-t border-brand-panel space-y-2">
   122	          <div className="flex items-center gap-2 px-3">
   123	            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-[#5A5145] bg-brand-strong-muted text-xs font-medium text-white">
   124	              {initialsFrom(sidebarProfile.fullName)}
   125	            </span>
   126	            <span className="truncate text-sm text-brand-soft">
   127	              {sidebarProfile.fullName ?? 'Signed in'}
   128	            </span>
   129	          </div>
   130	          <form action={signOut}>
   131	            <button
   132	              type="submit"
   133	              className="w-full text-left px-3 py-2 text-sm text-brand-soft rounded-md hover:bg-brand-panel hover:text-white transition-colors"
   134	            >
   135	              Sign out
   136	            </button>
   137	          </form>
   138	        </div>
   139	      </aside>
   140	
   141	      <div className="flex-1 min-w-0 flex flex-col">
   142	        {/* UI SHELL RESTYLE, SLICE 1: top bar. Left side (company name)
   143	            renders only when this layout's own read above actually found
   144	            one -- per Aravind's own instruction, no second query is added
   145	            just to guarantee it always renders. */}
   146	        <div className="flex items-center justify-between border-b border-brand-border bg-brand-paper px-4 py-3 sm:px-8">
   147	          {sidebarProfile.tenantName ? (
   148	            <div className="flex items-center gap-2 text-sm font-medium text-brand-strong-muted">
   149	              <Building2 className="h-4 w-4 text-brand-muted" aria-hidden="true" />
   150	              {sidebarProfile.tenantName}
   151	            </div>
   152	          ) : (
   153	            <div />
   154	          )}
   155	          <span className="text-sm text-brand-muted">{formatIstNow(now)}</span>
   156	        </div>
   157	
   158	        {/* UI slice 4 (Aravind, 2026-09-18): shared centering container --
   159	            every dashboard page's content sits INSIDE this, so the "wide
   160	            screens leave the right half empty" fix lives in ONE place,
   161	            not five. Pages themselves each dropped their own p-8/
   162	            max-w-3xl wrapper (see each page's own comment) so this is the
   163	            only place setting page-level width/padding now. */}
   164	        <main className="flex-1 min-w-0 overflow-auto">
   165	          <div className="mx-auto max-w-[1250px] p-4 sm:p-8">{children}</div>
   166	        </main>
   167	      </div>
   168	    </div>
   169	  )
   170	}

ADDED (25 Sep 2026, external review round 1, N3): the original pass through
this file asserted at 1.7 below that `proxy.ts` was "printed above" when it
never actually was — an asserted-but-nonexistent citation. Printed here, for
real, closing that gap:

$ git show origin/main:proxy.ts
     1	import { createServerClient } from '@supabase/ssr'
     2	import { NextResponse, type NextRequest } from 'next/server'
     3	
     4	export async function proxy(request: NextRequest) {
     5	  let response = NextResponse.next({ request })
     6	
     7	  const supabase = createServerClient(
     8	    process.env.NEXT_PUBLIC_SUPABASE_URL!,
     9	    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    10	    {
    11	      cookies: {
    12	        getAll() {
    13	          return request.cookies.getAll()
    14	        },
    15	        setAll(cookiesToSet, headers) {
    16	          cookiesToSet.forEach(({ name, value }) =>
    17	            request.cookies.set(name, value),
    18	          )
    19	          response = NextResponse.next({ request })
    20	          cookiesToSet.forEach(({ name, value, options }) =>
    21	            response.cookies.set(name, value, options),
    22	          )
    23	          Object.entries(headers).forEach(([key, value]) =>
    24	            response.headers.set(key, value),
    25	          )
    26	        },
    27	      },
    28	    },
    29	  )
    30	
    31	  // Refreshes the session if the access token is expired.
    32	  // Must be called before any code that reads the session,
    33	  // and before any Response is returned.
    34	  await supabase.auth.getUser()
    35	
    36	  return response
    37	}
    38	
    39	export const config = {
    40	  matcher: [
    41	    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    42	  ],
    43	}
(43 lines total, confirmed via `git show origin/main:proxy.ts | wc -l`)

$ git ls-tree -r origin/main --name-only | grep -iE '^middleware\.(ts|js)$'
(if empty: no middleware.ts/js at repo root on origin/main)

$ git ls-tree -r origin/main --name-only | grep -iE 'middleware'
(confirms whether ANY middleware file exists anywhere in repo)

$ git ls-tree -r origin/main --name-only | grep -iE 'auth.*layout\.tsx$'
app/(auth)/layout.tsx
app/(dashboard)/layout.tsx

$ git ls-tree -r origin/main --name-only | grep -iE 'test.*(login|callback|auth)'
test/status-callback.test.ts
test/unit/cron-auth.test.ts
test/unit/lint-no-auth-uid-as-users-id.test.ts
test/unit/outbound-status-callback.test.ts
(empty = no tests currently cover login or callback)

$ node -p "require('./node_modules/@supabase/supabase-js/package.json').version"
2.108.2

$ node -p "require('./node_modules/@supabase/ssr/package.json').version"
0.12.0

$ node -p "require('./node_modules/@supabase/auth-js/package.json').version"
2.108.2

$ sed -n '1000,1090p' node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts
     *       }
     *     }
     *   },
     *   "error": null
     * }
     * ```
     */
    signInWithIdToken(credentials: SignInWithIdTokenCredentials): Promise<AuthTokenResponse>;
    /**
     * Log in a user using magiclink or a one-time password (OTP).
     *
     * If the `{{ .ConfirmationURL }}` variable is specified in the email template, a magiclink will be sent.
     * If the `{{ .Token }}` variable is specified in the email template, an OTP will be sent.
     * If you're using phone sign-ins, only an OTP will be sent. You won't be able to send a magiclink for phone sign-ins.
     *
     * Be aware that you may get back an error message that will not distinguish
     * between the cases where the account does not exist or, that the account
     * can only be accessed via social login.
     *
     * Do note that you will need to configure a Whatsapp sender on Twilio
     * if you are using phone sign in with the 'whatsapp' channel. The whatsapp
     * channel is not supported on other providers
     * at this time.
     * This method supports PKCE when an email is passed.
     *
     * @category Auth
     *
     * @remarks
     * - Requires either an email or phone number.
     * - This method is used for passwordless sign-ins where a OTP is sent to the user's email or phone number.
     * - If the user doesn't exist, `signInWithOtp()` will signup the user instead. To restrict this behavior, you can set `shouldCreateUser` in `SignInWithPasswordlessCredentials.options` to `false`.
     * - If you're using an email, you can configure whether you want the user to receive a magiclink or a OTP.
     * - If you're using phone, you can configure whether you want the user to receive a OTP.
     * - The magic link's destination URL is determined by the [`SITE_URL`](/docs/guides/auth/redirect-urls#use-wildcards-in-redirect-urls).
     * - See [redirect URLs and wildcards](/docs/guides/auth/redirect-urls#use-wildcards-in-redirect-urls) to add additional redirect URLs to your project.
     * - Magic links and OTPs share the same implementation. To send users a one-time code instead of a magic link, [modify the magic link email template](/dashboard/project/_/auth/templates) to include `{{ .Token }}` instead of `{{ .ConfirmationURL }}`.
     * - See our [Twilio Phone Auth Guide](/docs/guides/auth/phone-login?showSMSProvider=Twilio) for details about configuring WhatsApp sign in.
     *
     * @exampleDescription Sign in with email
     * The user will be sent an email which contains either a magiclink or a OTP or both. By default, a given user can only request a OTP once every 60 seconds.
     *
     * @example Sign in with email
     * ```js
     * const { data, error } = await supabase.auth.signInWithOtp({
     *   email: 'example@email.com',
     *   options: {
     *     emailRedirectTo: 'https://example.com/welcome'
     *   }
     * })
     * ```
     *
     * @exampleResponse Sign in with email
     * ```json
     * {
     *   "data": {
     *     "user": null,
     *     "session": null
     *   },
     *   "error": null
     * }
     * ```
     *
     * @exampleDescription Sign in with SMS OTP
     * The user will be sent a SMS which contains a OTP. By default, a given user can only request a OTP once every 60 seconds.
     *
     * @example Sign in with SMS OTP
     * ```js
     * const { data, error } = await supabase.auth.signInWithOtp({
     *   phone: '+13334445555',
     * })
     * ```
     *
     * @exampleDescription Sign in with WhatsApp OTP
     * The user will be sent a WhatsApp message which contains a OTP. By default, a given user can only request a OTP once every 60 seconds. Note that a user will need to have a valid WhatsApp account that is linked to Twilio in order to use this feature.
     *
     * @example Sign in with WhatsApp OTP
     * ```js
     * const { data, error } = await supabase.auth.signInWithOtp({
     *   phone: '+13334445555',
     *   options: {
     *     channel:'whatsapp',
     *   }
     * })
     * ```
     */
    signInWithOtp(credentials: SignInWithPasswordlessCredentials): Promise<AuthOtpResponse>;
    /**
     * Log in a user given a User supplied OTP or TokenHash received through mobile or email.
     *
     * @category Auth
     *

$ git grep -n "auth/callback" origin/main -- . ':!*.test.ts'
origin/main:CLAUDE.md:1256:│   ├── (auth)/login, auth/callback ← done
origin/main:app/(auth)/login/page.tsx:14:    options: { emailRedirectTo: `${origin}/auth/callback` },
origin/main:docs/build-status.md:165:    browser landed on app.quoco.co.in/ (not /auth/callback) one second
origin/main:docs/claude-rules-history/env-and-stack-decisions.md:116:code bug — login/page.tsx + auth/callback/route.ts derive the domain dynamically
origin/main:docs/dpr-delivery-versioning-plan.md:555:(`login/page.tsx`, `auth/callback/route.ts` — see CLAUDE.md §8's own Auth Site URL
origin/main:docs/migration-007-checkpoint-1-review.md:340:| `app/(auth)/auth/callback/route.ts:33` | `.from('users').eq('id', user.id)` | looks up profile by auth uid | `.eq('auth_id', user.id)` |
origin/main:docs/reviews/stage5a-review-package.md:823:  `+smoke020` login has `tenant_id IS NULL`, so `app/(auth)/auth/callback/route.ts:37`

$ git grep -n "exchangeCodeForSession" origin/main
origin/main:app/(auth)/auth/callback/route.ts:15:  const { error } = await supabase.auth.exchangeCodeForSession(code)
origin/main:test/migration-007.test.ts:317:  // right after exchangeCodeForSession, against a tenant-less row. No other test

$ git grep -n "signInWithOtp" origin/main
origin/main:app/(auth)/login/page.tsx:12:  const { error } = await supabase.auth.signInWithOtp({
origin/main:docs/migration-007-checkpoint-1-review.md:578:tenant user — via `signInWithOtp`/admin-generated sessions in the fixture. That

$ git grep -n "verifyOtp" origin/main
(empty = verifyOtp not called anywhere yet)

$ git status --porcelain (pre-plan-write check)
(empty expected)

$ git ls-tree origin/main --name-only supabase/migrations/ | sort -V | tail -6
supabase/migrations/043_daily_log_photos.sql
supabase/migrations/044_hindrance_photos.sql
supabase/migrations/045_media_nudge_throttle.sql
supabase/migrations/046_hindrances_report_date.sql
supabase/migrations/047_revoke_unused_table_rights.sql
supabase/migrations/048_engineer_registration.sql
(local migration-file listing only — no supabase CLI project link invoked in this task, since no project ref was named in this directive and no DB access is needed for a plan-only task)


====================================================================
THE PLAN — Replace the email magic link with an email OTP code at /login
====================================================================
Status: PLAN ONLY. No code written, no branch created, no commits made,
no database writes performed. Tier: FULL (auth/identity — CLAUDE.md §0
EXTERNAL REVIEW GATE condition (c), and independently required by
docs/design-decisions/outbound-infra-and-auth.md §26's own text: "this
workstream goes to external review from the PLAN stage").

This document is self-contained and assumes no shared context with the
session that produced it. Every claim is either (a) grounded in an exact
file:line citation from origin/main, (b) an explicit design decision
attributed to Aravind with a date, or (c) named as an open unknown.

REPO-STATE HEADER (per CLAUDE.md's REVIEW REQUESTS AT THIS TIER convention)
- ~~origin/main @ 1c8a45138930df4ed59b76231105e5a30f07dd18 (fetched 2026-09-25)~~
- RE-PINNED (dated correction, 25 Sep 2026, external review round 1):
  origin/main @ 3c0a2437cb0241c9663e9602b97f77ad558bdd55 (fetched 2026-09-25,
  external review round 1). RESOLVED SHA DISCREPANCY: this plan has now cited
  three SHAs across its lifecycle — 78d7763 (accurate at the very first
  inventory pass), 1c8a451 (accurate when this plan document was first
  written), and now 3c0a243 (current, as of this round). Each was accurate
  AT THE TIME it was pinned; `git log --oneline 1c8a451..3c0a243` shows the
  intervening commits are all `docs/048-prod-apply-record` work
  (`docs/reviews/048-prod-apply-record.md`,
  `scripts/migration-number-reservations.json`) — confirmed via
  `git diff --stat 1c8a451..3c0a243`, which touches neither `app/(auth)/**`,
  `lib/supabase/**`, `app/(dashboard)/layout.tsx`, nor `proxy.ts`. No
  auth-relevant fact in this plan is stale because of the SHA move; the
  header is re-pinned purely so the citation matches the true current tip.
- RE-PINNED AGAIN (dated correction, 25 Sep 2026, external review round 2,
  PIN): origin/main @ 5914c9049dbee10f0cd4dfee4fec66b33288ad92 (fetched 25
  Sep 2026, external review round 2) — moved again from `3c0a243`. Scoped
  check: `git diff --stat 3c0a2437cb0241c9663e9602b97f77ad558bdd55..
  5914c9049dbee10f0cd4dfee4fec66b33288ad92 -- 'app/(auth)' lib/supabase
  'app/(dashboard)/layout.tsx' proxy.ts` returns EMPTY — zero changes to
  any file this plan depends on. The full (unscoped) diff between those
  two SHAs touches exactly one file: `docs/build-status.md` (13
  insertions) — this IS the round-2 RECORD condition 5 merge (PR #316,
  see (k)), not an independent drift. No auth-relevant fact in this plan
  is stale because of this second SHA move either. THIS CHECK MUST BE
  REPEATED AGAIN at actual branch-cut time — the SHA this plan document
  cites is a snapshot as of this review round, NOT what the real build PR
  pins; the build PR pins whatever `origin/main` resolves to at the
  moment that branch is actually cut, which may have moved again by then.
- CONFIRMED AT BRANCH-CUT (28 Sep 2026, build task Step 0): this is the
  actual branch-cut moment the note above asked to repeat the check at.
  `git fetch origin && git rev-parse origin/main` at branch-cut resolves to
  `5914c9049dbee10f0cd4dfee4fec66b33288ad92` — UNCHANGED from the pin above.
  `feat/login-email-otp` is cut from this exact SHA (`git merge-base HEAD
  origin/main` == `5914c9049dbee10f0cd4dfee4fec66b33288ad92`, confirmed in
  otp-build.txt). The header pin is current; no re-pin is needed for this
  build.
- Migrations present on origin/main: 001 through 048 (latest:
  048_engineer_registration.sql). No migration is added, changed, or
  implied by this plan — this slice is app-code only.
- No supabase CLI project-link command was run to produce this plan (no
  project ref was named in the task instruction, and no DB read/write is
  needed for a plan). The migration list above comes from
  `git ls-tree origin/main -- supabase/migrations/`, a local, non-network
  check.
- Last runbook executed: none in this session. Most recent prior apply on
  record: migration 048 (engineer registration), per
  docs/build-status.md and the 048 apply record.

DECISIONS THIS PLAN IS BUILT ON (Aravind, 2026-09-21 — stated verbatim
from the task, reproduced here so this document stands alone)
- D-O1: Email OTP ships now; WhatsApp OTP is a later channel, out of
  scope for this slice.
- D-O2: Aravind creates each beta customer's company himself; self-serve
  signup stays OFF. The app itself must refuse an unknown email
  (`shouldCreateUser: false`), not rely on the dashboard toggle alone.
  ADDED (25 Sep 2026, external review round 1, S1): the PROVISIONING
  MECHANISM for this is `admin.createUser({ email_confirm: true })`, NOT
  the Supabase dashboard's "Invite user" button. Reason: an account
  created without `email_confirm: true` may receive Supabase's
  Confirm-signup email template on its first `signInWithOtp` call rather
  than the Magic Link template this plan's (g)#1 flips to `{{ .Token }}`
  — flipping only the Magic Link template would silently miss that path.
  See (g)#9 and (h) for the conditional check this implies.
- D-O3: PM invites will reuse this same code flow later. The invite
  screen is NOT built in this slice.
- D-O4: The onboarding re-entry guard (duplicate-tenant bug) is NOT
  fixed in this slice. Named as a separate, still-open blocker.
- D-O5: No new user-facing wording in this plan. Every new string is
  listed BLANK for Aravind to word.

--------------------------------------------------------------------
STEP 1 RESULTS — exact facts the plan below depends on
--------------------------------------------------------------------

1.1 Installed package versions (from node_modules, NOT package.json's
    semver range):
    - @supabase/supabase-js: 2.108.2
    - @supabase/ssr: 0.12.0
    - @supabase/auth-js (the underlying client supabase-js re-exports as
      `.auth`): 2.108.2

1.2 `signInWithOtp` — real signature, from
    node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts:1085
    and lib/types.d.ts:527-545 (type `SignInWithPasswordlessCredentials`,
    email variant):
      signInWithOtp(credentials: {
        email: string
        options?: {
          emailRedirectTo?: string
          shouldCreateUser?: boolean   // default true if omitted
          data?: object
          captchaToken?: string
        }
      }): Promise<AuthOtpResponse>

    CRITICAL FACT, confirmed from the installed package's own doc-comment
    (GoTrueClient.d.ts:1008-1014), not assumption: **the SAME
    `signInWithOtp` call sends either a magic link or a numeric code —
    which one the user receives is decided entirely by the Supabase
    Auth EMAIL TEMPLATE**, not by any argument to this call:
      "If the `{{ .ConfirmationURL }}` variable is specified in the email
       template, a magiclink will be sent. If the `{{ .Token }}` variable
       is specified in the email template, an OTP will be sent."
    Consequence: `emailRedirectTo` becomes irrelevant to the OTP path (it
    only matters for the ConfirmationURL branch) and can be dropped from
    the call once the template is switched. This is why the dashboard
    template change (Step g below) is not a side detail — it is the
    mechanism that actually switches the product from links to codes.

1.3 `verifyOtp` — real signature, from
    node_modules/@supabase/auth-js/dist/module/GoTrueClient.d.ts:1223
    and lib/types.d.ts:669-682 (`VerifyEmailOtpParams`):
      verifyOtp(params: {
        email: string
        token: string          // the 6-digit code the user typed
        type: 'email'          // NOT 'magiclink' -- 'email' is the type
                                // for a code sent via signInWithOtp
        options?: { redirectTo?: string, captchaToken?: string }
      }): Promise<AuthResponse>   // AuthResponse = { data: {user, session}, error }

    `EmailOtpType` (lib/types.d.ts:693) is
    `'signup' | 'invite' | 'magiclink' | 'recovery' | 'email_change' | 'email'`
    — `'email'` is the correct type for this flow; `'magiclink'` is a
    distinct type used only when verifying a `token_hash` from a clicked
    link, not applicable here.

    CRITICAL FACT: `verifyOtp` returns a session directly in its
    response (`AuthResponse.data.session`). It does NOT go through
    `exchangeCodeForSession` and does NOT need the `/auth/callback`
    route at all — that route only handles the `?code=` query-param
    PKCE exchange used by the clicked-link path. The OTP-code path is a
    parallel, self-contained call: request code -> user types code ->
    `verifyOtp` -> session exists.

1.4 Current login page — `app/(auth)/login/page.tsx` (full file, 86
    lines, printed above in this file's Step 1 dump):
    - Lines 5-21: server action `sendMagicLink` calls
      `supabase.auth.signInWithOtp({ email, options: { emailRedirectTo:
      ... } })`, redirects to `/login?error=...` with `error.message`
      RAW on failure (line 18), or `/login?step=sent&email=...` on
      success.
    - Lines 30-47: the "Check your email" / "click it to continue"
      confirmation screen.
    - Lines 56-60: renders `params.error` directly into the DOM with no
      transformation — confirms Step 2(e)'s premise that raw provider
      error text reaches the user today.
    - Uses `lib/supabase/server.ts`'s `createClient()` (the SSR server
      client) inside a Server Action, not the browser client.

1.5 Current callback route — `app/(auth)/auth/callback/route.ts` (full
    file, 39 lines, printed above):
    - Line 5: a comment already reading "Handles OAuth and magic-link
      redirect callbacks (not used by the OTP code flow)." Checked via
      `git log --follow -p`: this comment has existed since the file's
      original commit (e5c5a175b7, 2026-06-28) — it is a pre-existing,
      forward-looking note, not evidence any OTP flow has been built.
      Confirmed by direct grep of origin/main (below) that `verifyOtp`
      is called nowhere in the codebase today.
    - Line 15: `supabase.auth.exchangeCodeForSession(code)` — the PKCE
      exchange, magic-link-only.
    - Lines 23-34: resolves the profile via `profileForAuthId`, reusing
      the same client instance specifically because the just-set session
      cookies live on the outgoing response, not yet on the incoming
      request (line 31-33's own comment).
    - Line 37: redirects to `/dashboard` if `profile.tenant_id` is set,
      else `/onboarding`.

1.6 `lib/supabase/client.ts`, `server.ts`, `service.ts` (all three
    printed above):
    - `client.ts`: `createBrowserClient<Database>(URL, ANON_KEY)` — no
      cookie plumbing of its own (the browser client manages its own
      storage).
    - `server.ts`: `createServerClient<Database>(URL, ANON_KEY, {
      cookies: { getAll, setAll } })` reading/writing Next.js
      `cookies()`. Its own comment (lines in the printed dump above):
      `setAll`'s write can silently no-op when called from a Server
      Component render — "Session refresh is handled by proxy.ts on
      every request instead."
    - `service.ts`: not reprinted here in full (not called by anything
      in this plan — the service-role client is for backend jobs, never
      the login path; CLAUDE.md §6 forbids using it in any route
      reachable without authentication, and the login route is exactly
      that).

1.7 `proxy.ts` (repo root). CLOSING N4 (build task Step 1, 28 Sep 2026 —
    the original round-1, N3 correction had already fixed the substance
    here but left the paragraph saying "printed above" twice, once struck
    and once live, which itself reads as unresolved on a skim; closed here
    by stating it once, plainly): proxy.ts IS printed raw above (Step 1
    dump, immediately after the `app/(dashboard)/layout.tsx` dump; 43
    lines total, confirmed via `git show origin/main:proxy.ts | wc -l`) —
    not merely read. THIS is the project's actual middleware: a Next.js
    `proxy`/`middleware` export with `export const config = { matcher:
    [...] }`, running `supabase.auth.getUser()` on every matched request
    purely to refresh an expiring session cookie. It contains no
    login-specific logic and needs no change for this plan.

1.8 `app/(dashboard)/layout.tsx` — auth check at lines 71-77:
      const { data: { user} } = await supabase.auth.getUser()
      if (!user) redirect('/login')
    CONFIRMED: this is an authentication check only. There is no role
    check anywhere in this file — its own comment block (lines 14-22)
    states outright: "this array has no role gate, so every
    authenticated user has seen three broken nav links since the very
    first commit."

1.9 Tests: `git ls-tree -r origin/main --name-only | grep -iE
    'test.*(login|callback|auth)'` returns:
      test/status-callback.test.ts        (Twilio delivery-status webhook — unrelated)
      test/unit/cron-auth.test.ts         (CRON_SECRET header check — unrelated)
      test/unit/lint-no-auth-uid-as-users-id.test.ts   (a repo-wide lint rule — unrelated)
      test/unit/outbound-status-callback.test.ts        (unrelated)
    CONFIRMED: no existing test exercises `/login`'s page/action or
    `/auth/callback`'s route today. This slice starts from zero coverage
    on the exact surface it's changing.

1.10 `test/migration-007.test.ts:317` (comment only, not a callback
    test) documents the project's existing pattern for driving a real
    JWT-bearing Postgrest client in tests without going through Next.js
    routes: `db.auth.admin.listUsers`/`deleteUser`, and calling the
    extracted query function (`lib/auth/profile-query.ts`'s
    `profileForAuthId`) directly against a signed-in test client. This
    same pattern (service-role admin API + a plain `@supabase/supabase-js`
    client, no Next.js route involved) is the basis for Step (h) below.

1.11 Admin API fact used in Step (h): `supabase.auth.admin.generateLink
    ({ type: 'magiclink', email })` — confirmed from
    node_modules/@supabase/auth-js/dist/module/GoTrueAdminApi.d.ts:148-172
    and lib/types.d.ts:781-800 — returns
    `data.properties.email_otp`, the SAME raw numeric code that would be
    emailed to the user, without sending any email. This is the
    project's only way to get a real, valid OTP code in an automated
    test without a live mailbox.

1.12 `git grep` confirms (full output above): `/auth/callback` is
    referenced only by `login/page.tsx:14`'s `emailRedirectTo` value and
    by docs/comments — no other code path constructs or depends on it.
    `exchangeCodeForSession` appears only in the callback route itself.
    `signInWithOtp` appears only in `login/page.tsx:12`. `verifyOtp`
    appears nowhere in the codebase.

--------------------------------------------------------------------
STEP 2 — THE PLAN
--------------------------------------------------------------------

a) FLOW, SCREEN BY SCREEN

   Screen 1 — enter email (replaces today's single login screen):
     Same form shape as today (`app/(auth)/login/page.tsx`), one email
     input, one submit button. On submit, a Server Action (replacing
     `sendMagicLink`) calls:
       await supabase.auth.signInWithOtp({
         email,
         options: {
           shouldCreateUser: false,
           emailRedirectTo: `${origin}/auth/callback`,
         },
       })
     ~~`emailRedirectTo` is DROPPED (per 1.2 — irrelevant to the {{ .Token }}
     template branch; keeping it does nothing wrong, but nothing right
     either, since the code path never redirects through a link).~~

     DATED CORRECTION (25 Sep 2026, external review round 1, B1): the struck
     text above is wrong. `emailRedirectTo` is RETAINED, not dropped, for
     this slice. Reason: this same call is the one that produces the kept
     magic-link callback path (see (c)) for as long as any link is still
     capable of being generated. If `emailRedirectTo` resolves to a URL not
     on Supabase's allowed redirect list — which is functionally what
     omitting it altogether risks, since there is then no explicit override
     for Supabase's redirect-URL resolution to honor — Supabase Auth falls
     back to the project's default Site URL root rather than to
     `/auth/callback?code=...`. This fallback behavior is evidenced by a
     real, recorded incident (`docs/build-status.md:162-170`, dated
     2026-09-17): a magic link requested with an origin not on the allowlist
     was consumed by Supabase but the browser landed on `app.quoco.co.in/`
     (not `/auth/callback`) with no code param, and the link later failed
     with "One-time token not found." That incident was specifically about
     a disallowed ORIGIN (a vercel.app preview host), not a MISSING
     `emailRedirectTo`.

     DATED CORRECTION (25 Sep 2026, external review round 2, N1): the
     "extension by analogy" hedge that previously followed here, and the
     "{{ .Token }}-template email with a fallback link" framing that came
     after it, are both wrong and are corrected, not merely qualified. The
     real risk window is the one (c) and (g)'s DEPLOY ORDER already
     describe, not a hypothetical: the email template is STILL emitting
     `{{ .ConfirmationURL }}` (not yet flipped to `{{ .Token }}`) while the
     NEW, code-based app is already deployed — exactly the intended state
     between deploy steps 1 and 2/3 of (g)'s DEPLOY ORDER. Within that
     window, IF the code-request call omitted `emailRedirectTo` (it does
     not — B1 retains it, this is why), every `{{ .ConfirmationURL }}` link
     Supabase generates would have no explicit, valid redirect target to
     resolve against, and would fall back to the project's Site URL root
     instead of `/auth/callback?code=...` — exchanging no code. This is the
     exact failure the 2026-09-17 incident recorded, and the exact reason
     B1 requires `emailRedirectTo` to be retained through this window. It
     is not an analogy: a disallowed origin and a missing parameter are the
     SAME input to Supabase's redirect-URL resolution — neither supplies a
     valid explicit target — so both terminate at the identical Site-URL
     fallback. This plan cites one directly observed instance of that
     fallback (`docs/build-status.md:162-170`) as its evidence; no separate
     platform-documentation source for the fallback mechanism itself was
     independently verified in this session, so the claim rests on that one
     observed incident plus the shared-input reasoning above, not on a
     second, independent citation. The earlier "kept callback route (c)
     would protect only links already sitting in inboxes" framing is
     dropped along with it: because `emailRedirectTo` IS retained (B1),
     this failure mode does not occur in this plan's actual design — it is
     explained here only to state WHY `emailRedirectTo` must stay, not as a
     live risk in the shipped plan.

     Retaining `emailRedirectTo` costs nothing (per
     1.2, it's simply unused by the `{{ .Token }}` template branch) and
     removes this risk entirely. Dropping it is left as a FOLLOW-UP for a
     LATER cleanup, done together with removing the callback route entirely
     once no magic-link capability remains — NOT part of this slice.
     On success, redirect to `/login?step=code&email=...` (a new step
     value; today's `step=sent` screen is retired, see (f)).
     On error, redirect to `/login?error=<KNOWN_ERROR_KEY>` — a mapped
     constant key, never `error.message` (see (e)).

   Screen 2 — enter code (NEW screen, does not exist today):
     A form with a 6-digit code input (length TBD by the dashboard
     setting in (g)) and the email carried forward as a hidden field (or
     re-typed — Aravind's call at build time; not a decision this plan
     makes).

     ADDED (25 Sep 2026, external review round 1, S4 — grounded rule,
     independent of which of the two options above is chosen at build
     time): the email value rendered into `LOGIN_CODE_STEP_BODY`'s
     `{email}` placeholder is user-supplied — carried across the
     `/login?step=code&email=...` redirect as a query-string value, the
     SAME pattern the current, already-shipped page already uses for its
     equivalent `step=sent` screen (confirmed: `login/page.tsx` line 31,
     `params.email ?? ''`, rendered as JSX text at line 36 — React's JSX
     text rendering auto-escapes it, so this is not an HTML-injection
     path). It is never independently re-validated against `auth.users` or
     re-confirmed as the address a code was actually sent to before being
     displayed — this matches today's existing behavior for the
     equivalent screen and is not a new gap this slice introduces. If
     Aravind's build-time choice is instead a hidden form field, the same
     property holds: the value is still Screen 1's own unauthenticated
     submission, not re-verified server-side before being echoed. Neither
     option needs re-validation added for this slice; this note exists so
     a reviewer doesn't assume either path already checks the value
     against something authoritative. A second Server Action calls:
       const { data, error } = await supabase.auth.verifyOtp({
         email,
         token: code,
         type: 'email',
       })
     This action MUST run through `lib/supabase/server.ts`'s
     `createClient()` (the SSR server client, same as today's action) —
     NOT the browser client — because only the SSR server client's
     `cookies().setAll` (server.ts, current file) can write the Supabase
     session cookie into the Next.js response that the redirect rides
     on. `verifyOtp`'s successful response contains the session already
     ( `AuthResponse.data.session` per 1.3); `@supabase/ssr`'s
     `createServerClient` wiring persists it via the existing
     `cookies: { getAll, setAll }` config in `server.ts` — no new
     Supabase-client code is needed, only a new call site.

   Screen 3 — signed in: after `verifyOtp` succeeds, the action reads
     `supabase.auth.getUser()` (same call the callback route already
     makes) and redirects to `/dashboard` or `/onboarding` by the same
     `profile.tenant_id` check the callback route uses today (`route.ts`
     lines 27-38) — this logic is DUPLICATED into the new verify action
     (see (i) for exactly which file), not shared with the callback
     route, because the callback route is being kept for a different,
     narrower purpose (see (c)).

     ADDED (25 Sep 2026, external review round 1, N1): the `getUser()` call
     on Screen 3 MUST run against the SAME Supabase client instance that
     just called `verifyOtp` in the same Server Action — never a freshly
     constructed `createClient()`. Grounded in the callback route's own
     existing code, `app/(auth)/auth/callback/route.ts:31-33` (confirmed via
     `git show origin/main`): "Reuse THIS client — it holds the
     just-exchanged session; a fresh createClient() here wouldn't see it yet
     (the session cookies are on the outgoing response, not the request)."
     The identical mechanism applies to `verifyOtp`: its session is held by
     the client instance that made the call, and `@supabase/ssr`'s
     `server.ts` `setAll` writes those cookies onto the outgoing response —
     a second, freshly created client in the same action would not see that
     session either. Concretely: the verify Server Action calls
     `const supabase = await createClient()` ONCE, uses that SAME `supabase`
     for both `verifyOtp` and the subsequent `getUser()`/redirect logic.

   `@supabase/ssr`'s role, stated plainly: it is not additional
   integration work — it's already wired in `server.ts`/`client.ts`/
   `proxy.ts` and needs no change. `@supabase/ssr` exists to make the
   Supabase session cookie readable/writable across Server Components,
   Server Actions, Route Handlers, and the proxy/middleware. `verifyOtp`
   is called from a Server Action, so it is `server.ts`'s existing
   `createClient()` doing the cookie-writing via its `setAll` — no new
   plumbing.

b) `shouldCreateUser: false` — WHERE AND WHAT THE USER SEES

   Goes in the code-request call in (a), Screen 1 — the ONLY call this
   plan adds that can create a user, so it is the only call that needs
   the flag.

   What an unknown-email user sees: `signInWithOtp` returns an `error`
   in this case (Supabase's passwordless-signin path returns an error
   rather than silently creating nothing, when `shouldCreateUser: false`
   is set and the email has no existing `auth.users` row — this is the
   documented purpose of the flag per 1.2's docstring: "If set to false,
   this method will not create a new user"). The action redirects to
   `/login?error=LOGIN_ERROR_UNKNOWN_EMAIL` — a dedicated string, distinct
   from the generic error string, now APPROVED by Aravind (21 Sep 2026, see
   (f)/(k)): "We could not find that email. Contact your Quoco admin." This
   was a blank placeholder as of the plan's first draft; it is filled and
   final as of this correction (25 Sep 2026) — no wording decision remains
   open here.

   STATED PLAINLY, per the task's own instruction: this is the APP-level
   guard. The Supabase dashboard's own "Allow new users to sign up"
   toggle (confirmed disabled on prod as of 2026-09-17, per
   docs/build-status.md and the prior inventory) is a SECOND, INDEPENDENT
   guard at the platform level. This plan's `shouldCreateUser: false`
   does not depend on that toggle's state and does not change it; both
   layers refuse an unknown email today, for two different reasons (one
   in this app's own call, one in Supabase project settings) — this is
   intentional defense in depth, not redundancy to be pruned.

c) THE MAGIC-LINK CALLBACK ROUTE'S FATE: KEPT AND MODIFIED, NARROWED IN PURPOSE

   Justification from actual callers (1.12, exhaustively grepped): today
   exactly one thing constructs a URL pointing at `/auth/callback` —
   `login/page.tsx:14`'s `emailRedirectTo`. ~~Once the code-request call
   in (a) stops passing `emailRedirectTo` and the email template stops
   emitting `{{ .ConfirmationURL }}` (Step (g)), NOTHING in this
   codebase will construct a link to `/auth/callback` going forward.~~

   DATED CORRECTION (25 Sep 2026, external review round 2, S2): the struck
   sentence is stale. Per (a)'s B1 correction, the code-request call does
   NOT stop passing `emailRedirectTo` — it retains it for this slice, and
   dropping it is an explicit, separate FOLLOW-UP left for a later cleanup
   (B1), not something this slice does. Corrected statement: the code
   itself keeps constructing an `/auth/callback` URL indefinitely, for as
   long as `emailRedirectTo` is passed. What actually stops the codebase
   from producing a link a user can act on is the email TEMPLATE change in
   (g)#1 — once the template emits `{{ .Token }}` only, no email body
   contains a clickable link for `verifyOtp`-eligible sign-ins to use,
   even though the code-request call still supplies a redirect target that
   would work if a link were ever generated (e.g. during the deploy window
   before the template flip, per (c)'s own DEPLOY ORDER section below, and
   per (a)'s B1 correction).

   Decision: KEEP the route file, with one small change, rather than delete
   it. Reasons, not preference:
     1. Any magic link already sent and sitting in a real inbox before
        this ships (e.g. one sent minutes before deploy) still points at
        `/auth/callback?code=...` and must not 404 — deleting the route
        breaks in-flight logins with no warning to anyone. B1 (see (a))
        establishes this window is real for as long as `emailRedirectTo`
        keeps generating link-capable redirects, not merely theoretical.
     2. The file's own comment (line 5) already anticipated this split
        ("not used by the OTP code flow") — keeping it matches the
        codebase's own stated intent, not this plan's invention.
     3. `exchangeCodeForSession` and the OTP `verifyOtp` path are
        cryptographically and functionally independent flows in
        Supabase Auth (different token formats, different endpoints) —
        there is no shared state between them to reconcile by keeping
        both.

   ADDED (25 Sep 2026, external review round 1, Q2): "unmodified" above is
   corrected — the route is KEPT, but no longer unmodified. It carries one
   small change: on `error`, it must redirect with a known constant error
   key (e.g. `/login?error=CALLBACK_FAILED`), never `error.message` raw as
   it does today (`route.ts` lines 17-20, confirmed above) — matching the
   same no-raw-provider-text rule this plan applies to every other error
   path in the new flow (see (e)). This is the one-line-shaped change
   referenced in (i)'s file list, which is corrected accordingly to no
   longer list this route under "NOT modified."

   What happens if a link and a code exist for the same login attempt:
   they cannot, under this design, refer to "the same attempt" in any
   sense Supabase Auth tracks — each `signInWithOtp` call issues Supabase
   the SAME single OTP-relevant server-side token per its passwordless
   flow (both the emailed code and, hypothetically, a still-configured
   link would be the display of that one underlying grant, per the
   docstring in 1.2: "Magic links and OTPs share the same
   implementation"). Because this plan's dashboard template change (Step
   g) sets the template to emit `{{ .Token }}` only, no link is ever
   generated by any signInWithOtp call made after that dashboard change
   ships — the "both a link and a code exist" case can only happen in
   the narrow window before the dashboard template is switched, ~~which is
   why (g) states the template change should land before (or atomically
   with) the app deploy, not after it.~~

   DATED CORRECTION (2026-09-21, per Aravind): the struck sentence above
   had the order backwards. Correct order, with the reason:
     1. Merge and deploy the app code first (the login page now asks for
        a code; the callback route stays, per this section).
     2. Flip the email template on test-db; run (h)'s manual script
        there.
     3. Flip the email template on prod.
   Reason: template-first means a user receives a numeric code by email
   while the deployed screen still only knows how to ask for a link click
   — no code box exists yet, and the link the old screen expects was never
   sent either, so that user is locked out. Code-first means the deployed
   screen asks for a code while the email template, for the short window
   before it's flipped, still emits a link — that link still works,
   because the callback route is kept (per this section's own decision),
   so nobody is locked out during the window. See (g)'s own DEPLOY ORDER
   entry below for the same correction stated at the checklist itself.

   ADDED (25 Sep 2026, external review round 1, B1 cross-reference): the
   "that link still works" claim in this deploy-window argument depends on
   `emailRedirectTo` being RETAINED in the code-request call (see (a)'s
   B1 correction) — it is NOT retained solely for the OTP path's own
   benefit, but specifically so any link generated during this window
   (before the template flip on a given project) resolves to
   `/auth/callback?code=...` rather than falling back to the Site URL
   root per the failure mode `docs/build-status.md:162-170` records. Had
   the earlier (now-corrected) "DROPPED" text in (a) shipped as written,
   this deploy-window argument would have been false: the app-code-first
   step would deploy a screen asking for a code while a straggler link
   generated in that same window pointed at a URL with no code param,
   failing exactly like the recorded incident, not "still working."

d) RESEND / WRONG CODE / EXPIRED CODE / TOO MANY ATTEMPTS

   - Resend: Screen 2 offers a "resend code" action that simply calls
     `signInWithOtp` again with the same email (per 1.2's own docstring:
     "Passwordless sign-ins can be resent by calling the `signInWithOtp()`
     method again" — NOT the separate `resend()` API, which per
     `ResendParams` (lib/types.d.ts) only covers `'signup'`/
     `'email_change'`, not passwordless email OTP). Supabase enforces a
     minimum interval between sends per email (default: 60 seconds per
     the docstring's own example text, "a given user can only request a
     OTP once every 60 seconds") — DASHBOARD-ONLY, UNVERIFIED FROM THE
     REPO: the actual configured value for this project is not visible
     in any repo file; assume 60s until confirmed on the dashboard for
     both projects, per (g).
   - Wrong code: `verifyOtp` returns an `error` (no session). The verify
     action redirects to `/login?step=code&email=...&error=<KNOWN_ERROR
     _KEY_FOR_WRONG_CODE>`, keeping the user on Screen 2 with the
     email preserved so they can retype without re-requesting a code.
   - Expired code: same call path as "wrong code" from the app's point of
     view. ~~`verifyOtp` does not appear to distinguish "wrong" from
     "expired" in its return type (`AuthResponse` carries only a generic
     `AuthError`); DASHBOARD-ONLY, UNVERIFIED FROM THE REPO: whether the
     actual error message/code differs between these two cases must be
     confirmed by a real expired-code test (see (h)) before deciding
     whether they need two different blank constants or one shared one.~~
     CORRECTED (25 Sep 2026, external review round 1, S3/S4): the struck
     claim was incomplete — checked directly against the installed SDK's
     own error-code enum (`node_modules/@supabase/auth-js/dist/module/lib/
     error-codes.d.ts:6`, `ErrorCode` type), which DOES define a distinct
     `otp_expired` code. Supabase Auth's wire protocol therefore CAN
     distinguish an expired code from a wrong one at the `error.code`
     level, even though (per (f)'s approved copy) this plan's own UI
     deliberately shows the SAME message for both (`LOGIN_ERROR_WRONG_CODE`
     and `LOGIN_ERROR_EXPIRED_CODE` share one approved string, by Aravind's
     choice, not because the codes are indistinguishable). Tests must
     assert on `error.code === 'otp_expired'` vs. some other code for
     "wrong" (the SDK enum has no single named code obviously meaning
     "wrong code specifically" — `invalid_credentials` is the most likely
     candidate but this is not directly confirmed for the passwordless-OTP
     path specifically) — never on message text (per S4 below). Whether
     verifyOtp ACTUALLY returns `otp_expired` for this project's real
     runtime behavior is still DASHBOARD/RUNTIME-UNVERIFIED: the SDK
     defining the code is not proof the server emits it in every
     configuration; (h)'s manual expired-code test still confirms this by
     observation, but the test can now assert a specific code instead of
     an unspecified "differs somehow."
     The code's VALIDITY WINDOW itself (how long before it expires) is a
     dashboard setting — DASHBOARD-ONLY, UNVERIFIED FROM THE REPO, see (g).
   - Too many attempts: ~~Supabase Auth enforces a maximum verification
     attempt count per issued OTP before it is invalidated — DASHBOARD-
     ONLY, UNVERIFIED FROM THE REPO: the exact count is not in any repo
     file. When exceeded, the plan assumes `verifyOtp` returns an error
     indistinguishable, from the repo's point of view, from "wrong code"
     — mapped to the same or a dedicated blank constant, TBD after (h)'s
     manual test observes the actual behavior.~~
     CORRECTED (25 Sep 2026, external review round 1, S3): `LOGIN_ERROR
     _TOO_MANY_ATTEMPTS` maps to an HTTP 429 response from `verifyOtp`
     carrying Supabase's ENDPOINT-LEVEL rate limit, not a distinct
     per-code verification-attempt counter. Basis: the installed SDK's
     `ErrorCode` enum (same citation as above) defines
     `over_request_rate_limit`, `over_email_send_rate_limit`, and
     `over_sms_send_rate_limit` as its only rate-limit-shaped codes — there
     is no separate named code resembling "too many verification attempts
     on this specific code." `over_request_rate_limit` is the most likely
     candidate for a `verifyOtp` brute-force guard; `over_email_send_rate
     _limit` is the most likely candidate for the RESEND case in the bullet
     above (`LOGIN_ERROR_RESEND_RATE_LIMITED`). This is an inference from
     the ABSENCE of a dedicated per-attempt-count code in the enum, not a
     direct confirmation that Supabase never enforces one server-side
     outside this SDK's typed surface — flagged accordingly in UNKNOWNS.
     The brute-force bound this plan actually relies on, stated explicitly:
     a 6-digit code space (10^6 possibilities, per (g)#8's required value),
     a 10-minute validity window (per (g)#8), and this endpoint-level rate
     limit as the throttle on guess rate — together, not a separate
     attempt-count cap. The "TBD after (h)" framing is removed; (h)'s
     manual test still confirms the actual `error.code` returned in this
     project's real configuration, per S4's rule that tests assert codes,
     not message text.

e) ERRORS — NO RAW PROVIDER TEXT REACHES THE SCREEN

   Confirmed today (1.4): `login/page.tsx` lines 17-18 redirect with
   `error.message` verbatim, and lines 56-60 render `params.error`
   directly — e.g. the real string "Signups not allowed for this
   instance" reaches the screen today, per docs/build-status.md's
   "Parked, not designed" note under "How people log in".

   New flow's distinct error conditions, each mapped to a constant (see (f)
   for the actual table, now fully approved — see (k)):
     1. Unknown email refused (`shouldCreateUser: false` triggered) — (b)
     2. Rate-limited resend (sent again before the cooldown elapsed)
     3. Wrong code entered
     4. Expired code entered — DISTINGUISHABLE from #3 at the `error.code`
        level per the SDK's `otp_expired` code (see (d)'s S3/S4
        correction), even though the approved UI copy (f) shows the same
        text for both by Aravind's choice
     5. Too many verification attempts on one code — an endpoint-level
        rate limit (`over_request_rate_limit`, most likely), not a
        per-code attempt counter (see (d)'s S3 correction)
     6. Any other/unclassified Supabase error (a catch-all fallback
        string, so a future provider-side error the plan didn't
        enumerate still never surfaces raw text — this fallback is
        itself one of the (now-approved) constants in (f), not an
        exemption from the no-raw-text rule)
     7. (Onboarding's own raw-DB-error surfacing, noted in
        docs/build-status.md as "Parked, not designed" for
        `app/(onboarding)/onboarding/page.tsx`'s `createCompany`, is
        EXPLICITLY OUT OF SCOPE — that page is not touched by this
        slice. Named here only so it is not mistaken for closed by this
        plan.)

   ADDED (25 Sep 2026, external review round 1, S4): a governing rule for
   ALL of the redirects above, and for the kept callback route's own
   redirect (per (c)'s Q2 correction) — an unrecognised `?error=` query key
   renders `LOGIN_ERROR_GENERIC`; the raw query-string VALUE is never
   rendered to the screen under any circumstance. Concretely: every
   Server Action redirects with one of a small, fixed set of known keys
   (e.g. `?error=UNKNOWN_EMAIL`, `?error=WRONG_CODE`, `?error=CALLBACK
   _FAILED`), and the page's rendering code does a lookup against that
   fixed set — `ERROR_MESSAGES[params.error] ?? LOGIN_ERROR_GENERIC` — so
   an unexpected or tampered key (e.g. someone hand-editing the URL to
   `?error=<script>` or an unmapped string) falls through to the generic
   string rather than being reflected. New test `T-OTP-07` (see (h))
   covers exactly this case. Note (a)'s S4 addition above (Screen 2's
   `{email}` interpolation) is a related but SEPARATE concern — the error
   KEY is looked up against a fixed map (this rule), while the EMAIL value
   is rendered as-is via React's auto-escaping (that rule); neither reuses
   the other's mechanism.

   ACCEPTED TRADE-OFF, DATED (2026-09-21, per Aravind): condition #1's
   mapped string, `LOGIN_ERROR_UNKNOWN_EMAIL`, now carries the approved
   wording "We could not find that email. Contact your Quoco admin." (see
   (f), (k)) — this tells an unregistered visitor outright that their
   email is not in the system, a user-enumeration disclosure (an attacker
   can learn which email addresses are registered customers by trying
   them at `/login`). This is a DELIBERATE, accepted trade-off, not an
   oversight: this codebase already has an established pattern of
   AVOIDING exactly this kind of disclosure elsewhere — `lib/engineers/
   copy.ts`'s `inUse` string is deliberately a single non-distinguishing
   message specifically "so two distinguishable messages would [not]
   reveal whether a number belongs to another company" (per that file's
   own header). This plan's string 10 takes the opposite choice for login,
   on Aravind's explicit instruction, because D-O2 already establishes
   that only Aravind-provisioned accounts exist pre-beta (no public
   signup to enumerate against in practice yet). REVISIT when self-serve
   signup opens (per D-O2's own scope note) — at that point this trade-off
   should be re-evaluated against the same anti-enumeration reasoning
   `copy.ts` already applies elsewhere in this codebase.

f) STRINGS TABLE

   DATED UPDATE (2026-09-21, per Aravind): 11 of the 17 constants below now
   carry APPROVED wording (strings 1-11 of Aravind's 21 Sep list). ~~The
   remaining 6 stay BLANK — Aravind's list did not cover Screen 1's copy,
   the Screen 2 "start over" link, or a distinct resend-rate-limit error —
   and D-O5's blank-constant rule still applies to those.~~ See (k) for the
   formal approval record.

   DATED CORRECTION (2026-09-21, per Aravind, same day): the struck
   sentence above is superseded. Aravind supplied the final five strings
   the same day (`LOGIN_EMAIL_STEP_HEADING`, `LOGIN_EMAIL_STEP_BODY`,
   `LOGIN_EMAIL_STEP_SUBMIT_LABEL`, `LOGIN_CODE_START_OVER_LABEL`,
   `LOGIN_ERROR_RESEND_RATE_LIMITED`). All 17 constants in the table below
   now carry approved wording; no BLANK rows remain. D-O5's blank-constant
   rule is fully discharged for this slice. See (k) for the updated formal
   approval record.

   NOTE ON WRONG-CODE VS EXPIRED-CODE (resolves an open question from (d)/
   (h)): Aravind's approved string 8 ("That code is wrong or has expired.
   Ask for a new one.") is a single, deliberately generic message covering
   BOTH cases. This settles the open question at the UI-copy layer
   regardless of whether Supabase's `verifyOtp` distinguishes the two
   server-side (still unconfirmed, see UNKNOWNS) — the user sees the same
   text either way, so `LOGIN_ERROR_WRONG_CODE` and `LOGIN_ERROR_EXPIRED
   _CODE` both get this same approved value below rather than being merged
   into one constant (kept as two, per this task's own instruction to keep
   proposed constant names as they are).

     | Element                                  | Proposed constant name              | Value |
     |-------------------------------------------|--------------------------------------|-------|
     | Screen 1 heading                          | LOGIN_EMAIL_STEP_HEADING             | Sign in to Quoco |
     | Screen 1 body copy                        | LOGIN_EMAIL_STEP_BODY                | Enter your email and we will send you a 6-digit code. |
     | Screen 1 submit button                    | LOGIN_EMAIL_STEP_SUBMIT_LABEL        | Send code |
     | Screen 2 heading                          | LOGIN_CODE_STEP_HEADING              | Enter your code |
     | Screen 2 body copy (tell user to check email) | LOGIN_CODE_STEP_BODY             | We sent a 6-digit code to {email}. It expires in 10 minutes. |
     | Screen 2 code input label                 | LOGIN_CODE_INPUT_LABEL               | 6-digit code |
     | Screen 2 submit button                    | LOGIN_CODE_STEP_SUBMIT_LABEL         | Sign in |
     | Screen 2 resend link/button                | LOGIN_CODE_RESEND_LABEL              | Send a new code |
     | Screen 2 "wrong email, start over" link    | LOGIN_CODE_START_OVER_LABEL          | Use a different email |
     | Error: unknown email refused                | LOGIN_ERROR_UNKNOWN_EMAIL            | We could not find that email. Contact your Quoco admin. |
     | Error: resend rate-limited                  | LOGIN_ERROR_RESEND_RATE_LIMITED      | You asked for a code a moment ago. Wait a minute before asking again. |
     | Error: wrong code                           | LOGIN_ERROR_WRONG_CODE               | That code is wrong or has expired. Ask for a new one. |
     | Error: expired code                         | LOGIN_ERROR_EXPIRED_CODE              | That code is wrong or has expired. Ask for a new one. |
     | Error: too many attempts                    | LOGIN_ERROR_TOO_MANY_ATTEMPTS         | Too many tries. Wait a minute, then ask for a new code. |
     | Error: generic/unclassified fallback        | LOGIN_ERROR_GENERIC                   | Something went wrong. Please try again. |
     | Sign-in email SUBJECT (dashboard template)  | LOGIN_OTP_EMAIL_SUBJECT               | Your Quoco sign-in code |
     | Sign-in email BODY (dashboard template)     | LOGIN_OTP_EMAIL_BODY                  | Your sign-in code is {{ .Token }}. It is valid for 10 minutes. If you did not ask to sign in, you can ignore this email. |

   RETIRED strings (today's magic-link copy, `login/page.tsx`, lines
   33-46 — the "Check your email" screen):
     - "Check your email" (line 34)
     - "We sent a sign-in link to {email}. Click it to continue — the
       link expires in 1 hour." (lines 35-38)
     - "Wrong email? Start over" (lines 39-44 — NOTE: this exact link is
       NOT fully retired; Screen 2 needs an equivalent "start over" link,
       renamed `LOGIN_CODE_START_OVER_LABEL` above, so this is a
       reword-and-relocate, not a pure deletion)
     - "Sign in" / "Enter your work email to receive a sign-in link."
       (lines 51-53 — Screen 1 heading/body, superseded by
       `LOGIN_EMAIL_STEP_HEADING`/`_BODY` above since "a sign-in link" is
       no longer accurate copy)
     - "Send sign-in link" button (line 81, superseded by
       `LOGIN_EMAIL_STEP_SUBMIT_LABEL`)
   Every one of these five strings lives ONLY in
   `app/(auth)/login/page.tsx` — confirmed by `git grep` (1.12's scope;
   no other file was found to duplicate this copy).

g) SUPABASE DASHBOARD CHECKLIST — ARAVIND, BY HAND (this plan makes NONE
   of these changes itself)

   1. EMAIL TEMPLATE — switch the "Magic Link" template to emit
      `{{ .Token }}` instead of (or alongside removing) `{{
      .ConfirmationURL }}`, per 1.2's confirmed mechanism. This is the
      single change that actually turns the product from links into
      codes.
        - PROD (`jvxwqignooseazzmwhvl`): Dashboard -> Authentication ->
          Emails -> Templates -> Magic Link.
        - TEST-DB (`exfccwlrhoutkgrlikod`): same screen, on the test-db
          project.
        - Must read: template body contains `{{ .Token }}`.
   2. OTP CODE LENGTH — the digit count Screen 2's input should expect.
        - Both projects: Dashboard -> Authentication -> Providers ->
          Email (or Auth settings, depending on current dashboard
          version) -> OTP length setting.
        - Must read: whatever numeric length Aravind sets (commonly 6 —
          NOT assumed here as a repo fact, since it's not in any config
          file this repo tracks).
   3. OTP CODE VALIDITY WINDOW — how long an issued code stays valid.
        - Both projects: same Auth settings screen as #2.
        - Must read: the expiry duration Aravind sets. This value
          directly determines the copy for `LOGIN_CODE_STEP_BODY`
          ("enter within N minutes") once worded.
   4. RESEND / RATE-LIMIT INTERVAL — the minimum time between two
      `signInWithOtp` calls for the same email (assumed 60s default per
      (d); confirm the actual configured value).
        - Both projects: same Auth settings screen.
   5. MAX VERIFICATION ATTEMPTS per issued code, if exposed as a
      separate setting (not confirmed to exist as a distinct dashboard
      field — Aravind to check during (2) and (3) above; if it isn't a
      separate setting, note that back into this plan's own record
      before build starts).
   6. "ALLOW NEW USERS TO SIGN UP" — CONFIRM STILL DISABLED on PROD
      (`jvxwqignooseazzmwhvl`) after this ships, since D-O2 depends on
      BOTH layers (app-level `shouldCreateUser: false` AND this toggle)
      refusing unknown emails. No change expected here, just a
      re-confirmation.
        - Screen: Dashboard -> Authentication -> Providers -> Email ->
          "Allow new users to sign up".
   7. SITE URL / REDIRECT URLS — unaffected by this plan (no new
      redirect URL is introduced; `/auth/callback` keeps its existing
      allowed entry per (c)), but Aravind should re-confirm
      `app.quoco.co.in` is still the only allowed value, per
      docs/build-status.md's "Login must complete on the official host"
      note — that finding is independent of this plan and not resolved
      by it.

      ADDED (25 Sep 2026, external review round 1, N2): this "official
      host" requirement is MOOTED for the new code-request/verify path —
      `signInWithOtp`/`verifyOtp` are direct Server Action calls, not a
      browser redirect through a link, so which host the browser happens
      to be on when it submits the form has no bearing on whether the
      code request or verification succeeds. It REMAINS OPEN and
      unresolved for the KEPT link-based `/auth/callback` route (per (c)):
      any magic link still generated during the deploy window (per (a)'s
      B1 correction) is subject to the exact same origin-mismatch failure
      mode `docs/build-status.md:162-170` already recorded, for exactly as
      long as that route stays reachable. Not resolved by this slice.

   8. REQUIRED VALUES (added 2026-09-21, per Aravind; extended same day):
      items #2, #3, AND #4 above MUST be set to exactly 6 (code length),
      10 minutes (validity window), AND 60 seconds (resend/rate-limit
      interval) on BOTH projects — strings 2, 4, 5, and now
      `LOGIN_ERROR_RESEND_RATE_LIMITED` in (f)'s table are already worded
      against those exact numbers ("6-digit code", "expires in 10
      minutes", "wait a minute before asking again"). If any project
      cannot be set to precisely these values, the wording in (f) must
      come back to Aravind before any build starts — do not adjust the
      copy to match whatever the dashboard happens to allow without his
      sign-off.

   DEPLOY ORDER (dated correction, 2026-09-21, per Aravind — see (c) for
   the full reasoning): the dashboard email-template change (#1 above)
   does NOT land before the app deploy. Correct order:
     1. Merge and deploy the app code.
     2. Flip the email template on test-db (`exfccwlrhoutkgrlikod`); run
        (h)'s manual script there.
     3. Flip the email template on prod (`jvxwqignooseazzmwhvl`).
   Items #2-#7 above (code length, validity, resend interval, attempt
   cap, signup toggle, Site URL) are NOT time-ordered against the code
   deploy the way #1 is — they can be confirmed/set independently, at any
   point before (h)'s manual script is run on that project.

   9. PROVISIONING TEMPLATE CHECK (added 25 Sep 2026, external review
      round 1, S1 — CONDITIONAL, NOT YET DECIDED): per Aravind (25 Sep
      2026), beta accounts are created via `admin.createUser({
      email_confirm: true })` (confirmed as a real, documented parameter —
      `node_modules/@supabase/auth-js/dist/module/GoTrueAdminApi.d.ts:263`,
      "Both arguments default to false" — so `email_confirm: true` must be
      passed explicitly), NOT the dashboard "Invite user" button. Reason
      this matters here: an account created WITHOUT `email_confirm: true`
      may receive Supabase's Confirm-signup email template on its first
      `signInWithOtp` call, rather than the Magic Link template this
      plan's item #1 flips to `{{ .Token }}` — flipping only the Magic
      Link template would not cover that case. See D-O2 (this plan's
      header decisions) for the provisioning-mechanism record, and (h) for
      the PLANNED (not yet run) test-db observation that settles this. IF
      that observation finds an unconfirmed user gets the Confirm-signup
      template instead of Magic Link, item #1 above must ALSO flip the
      Confirm-signup template to `{{ .Token }}` on both projects — stated
      here as a CONDITIONAL, open item, not a decided requirement, pending
      that observation.
   10. EMAIL SENDER + HOURLY CAP (added 25 Sep 2026, external review round
      1, S2): confirm on BOTH projects which email sender is configured —
      a custom SMTP provider, or Supabase's own built-in dev sender — and
      read+record each project's hourly email-send cap. Supabase's
      built-in sender is throttled far more aggressively than a custom
      SMTP integration; this plan's manual test script (h) sends multiple
      real emails per run, so the configured cap bounds how many manual
      runs are safe in a given hour. This plan does not check or change
      this — Aravind/a reviewer confirms it on the dashboard before (h)'s
      manual script is relied on for repeated runs.
        - Screen: Dashboard -> Authentication -> Emails -> SMTP Settings
          (or Project Settings -> Auth, depending on dashboard version).

      CAP ARITHMETIC (added 25 Sep 2026, external review round 2, N3): the
      automated test suite (h) sends exactly TWO real emails per full run
      (T-OTP-04 + T-OTP-05 — T-OTP-01b/02/03 send zero, via
      `admin.generateLink`/dashboard-toggle checks that never trigger a
      real send; see (h)'s N3 correction). The manual verification
      script (h) sends additional real emails on top of that per full
      walkthrough (per project: one for the unknown-good-email step, one
      or more for the resend step, one for the expired-code step) — this
      plan does not fix an exact manual-script count here since it
      depends on how many resend attempts a given walkthrough makes;
      whoever runs (h)'s manual script tallies its own sends against
      whatever hourly cap item #10 above reads off the dashboard, on TOP
      of the suite's fixed 2-per-run automated count, before deciding how
      many manual runs are safe in a given hour.

   This plan does not and cannot change any of the above; all ten items
   are manual, dashboard-only actions (item #9 is additionally conditional
   on an observation this plan has not yet made).

h) TESTS

   GOVERNING RULE (added 25 Sep 2026, external review round 1, S3/S4): every
   test below that inspects a Supabase Auth error MUST assert on
   `error.code` (per the `ErrorCode` enum,
   `node_modules/@supabase/auth-js/dist/module/lib/error-codes.d.ts:6`),
   NEVER on `error.message` text — message text is not part of Supabase's
   stability contract and this plan's own (e) rule already forbids
   surfacing it to users; asserting on it in tests would let a wording-only
   provider change silently break coverage. The actual codes test-db
   returns for each condition are recorded when these tests are actually
   run (not in this plan-only task, which has no DB access) — (d)'s S3
   correction names the most likely candidates (`otp_expired`,
   `over_request_rate_limit`, `over_email_send_rate_limit`) but these are
   not yet independently confirmed against this project's real
   configuration.

   Automatable without a live mailbox (using
   `supabase.auth.admin.generateLink` per 1.11 to obtain a real
   `email_otp` value, service-role client, same pattern as
   `test/migration-007.test.ts`):
     - T-OTP-01: unknown email is refused — `signInWithOtp({ email:
       <never-seen-before>, options: { shouldCreateUser: false } })`
       returns an error; no `auth.users` row is created (assert via
       admin `listUsers` before/after). RED FIRST: written and run
       before the app code exists, against the real Supabase client
       directly (proves the flag's behavior in isolation) — then GREEN
       once the Server Action wraps it.
     - T-OTP-01b (ADDED 25 Sep 2026, external review round 1, S4): the
       ONE test in this list that actually observes the Supabase dashboard
       "Allow new users to sign up" toggle from (g)#6, which none of the
       other tests exercise — `signInWithOtp({ email: <never-seen-before>
       })` called WITHOUT `shouldCreateUser` set at all (i.e. relying on
       Supabase's own default/dashboard behavior, not this app's guard),
       asserting BOTH the refusal AND that no `auth.users` row was created
       (via `admin.listUsers`, same pattern as T-OTP-01). If this toggle is
       ever accidentally re-enabled on a project, T-OTP-01 alone would not
       catch it (T-OTP-01 tests the APP's own flag, which would still pass
       even if the dashboard toggle drifted) — T-OTP-01b is the test that
       would actually fail.
     - T-OTP-02: known email + correct code succeeds — seed a test user
       via `admin.createUser({ email_confirm: true, ... })` (CORRECTED 25
       Sep 2026, external review round 2, N2: `email_confirm: true` is
       REQUIRED here, matching D-O2's provisioning mechanism — seeding
       WITHOUT it would accidentally exercise the unconfirmed-user/
       Confirm-signup-template path that (g)#9/S1's PLANNED observation
       (h)'s manual script step 8 exists specifically to investigate in
       isolation, not the path a real, properly-provisioned customer
       actually gets; T-OTP-02 must test the real customer path), call
       `generateLink({ type: 'magiclink', email })` to get
       `properties.email_otp`, then call `verifyOtp({ email, token:
       email_otp, type: 'email' })` directly and assert a session comes
       back. RED FIRST (no verify action exists yet) then GREEN.
     - T-OTP-03: known email + wrong code fails — same seeded user,
       `verifyOtp` with a deliberately wrong 6-digit string, assert an
       error and no session (assert `error.code`, per the GOVERNING RULE
       above).
     - T-OTP-04: resend calls `signInWithOtp` again without erroring for
       an already-known email (distinct from T-OTP-01's refusal case).
       CORRECTED (25 Sep 2026, external review round 1, S2): this test's
       SECOND call (the actual resend) must assert the 60-second-window
       refusal (`error.code === 'over_email_send_rate_limit'`, per (d)'s
       S3 correction — to be confirmed against real behavior when run),
       NOT a second success — so that a single run of this test sends
       exactly ONE real email via `generateLink`/`signInWithOtp`, not two,
       keeping this test's own contribution to (g)#10's hourly send cap
       minimal.
     - T-OTP-05 (integration, hits the actual Server Actions once built):
       full page-level flow via the same harness pattern
       `test/migration-007.test.ts` uses for driving real
       Supabase-authenticated calls — request code, verify code, assert
       redirect target matches `profile.tenant_id`'s null/non-null state
       (mirrors the callback route's existing branch, 1.5's line 37).
     - T-OTP-06: dashboard layout's existing auth check
       (`app/(dashboard)/layout.tsx:77`) still redirects an unauthenticated
       request to `/login` — a regression guard, since this plan touches
       adjacent auth surface even though this file itself isn't modified.
     - T-OTP-07 (ADDED 25 Sep 2026, external review round 1, S4): an
       unrecognised `?error=` query key (e.g. `/login?error=NOT_A_REAL_KEY`)
       renders `LOGIN_ERROR_GENERIC`'s approved text — never the raw key,
       never any other string. Covers (e)'s S4 rule directly; a render/unit
       test against the login page component, no live Supabase call
       needed.

   Every test address used by ANY of the above that sends a real email
   ~~(T-OTP-01b's negative case sends none; T-OTP-02/03/04/05 and the manual
   script below do)~~ must be an address ARAVIND controls (ADDED 25 Sep
   2026, external review round 1, S2) — not invented ad hoc by whoever
   writes the test. This plan does not name a specific address; it states
   the requirement.

   CORRECTED (25 Sep 2026, external review round 2, N3): the struck
   parenthetical undercounted which tests send NO real email.
   `admin.generateLink` sends NO email at all — it only returns the
   `email_otp`/`action_link` values directly to the caller. T-OTP-02 and
   T-OTP-03 both obtain their code via `generateLink`, so BOTH send zero
   real emails, same as T-OTP-01b's negative case. The only automated
   tests that send a real email are T-OTP-04 (one — its corrected second
   call per (h)'s S2 note asserts a refusal, not a second send) and
   T-OTP-05 (one — it drives the real Server Action end to end, which
   calls `signInWithOtp` for real rather than `generateLink`). CORRECTED
   TOTAL: the automated suite sends exactly TWO real emails per full run
   (T-OTP-04 + T-OTP-05), not four. See (g)#10 for this count carried into
   the hourly-cap arithmetic.

   CANNOT be automated — manual observation required, because they
   depend on live dashboard settings (Step g) and a real inbox:
     1. The actual email arrives with a NUMBER, not a clickable link,
        after the template change in (g)#1.
     2. Expired-code behavior — waiting out the real validity window
        from (g)#3 and confirming the actual observed `error.code`
        matches `otp_expired` (per (d)'s S3 correction) or something else.
     3. Actual resend cooldown and max-attempt counts match what was
        read off the dashboard in (g).
     4. Visual/UX correctness of Screen 2 on a real device.
     5. PLANNED, NOT YET RUN (ADDED 25 Sep 2026, external review round 1,
        S1 — no DB access in this plan-only task): seed a test-db user via
        `admin.createUser` WITHOUT `email_confirm: true`, then call
        `signInWithOtp` for that address and observe which email template
        actually arrives. If it is anything other than the Magic Link
        template this plan flips in (g)#1, then (g)#9's conditional item
        becomes a decided requirement — both templates must be flipped to
        `{{ .Token }}` on both projects before this plan's design holds for
        every provisioning path, not just the confirmed-user one.

   MANUAL VERIFICATION SCRIPT (step by step, BOTH projects):

     On TEST-DB (`exfccwlrhoutkgrlikod`) first:
       1. Confirm (g)'s dashboard settings are applied on this project.
       2. From `app.quoco.co.in` pointed at test-db (or the equivalent
          test-db-linked preview, per existing Vercel Preview/test-db
          branch wiring noted in the prior inventory), enter an email
          KNOWN to have no `auth.users` row. Confirm: refused, with the
          new `LOGIN_ERROR_UNKNOWN_EMAIL` string, NOT a raw provider
          message.
       3. Enter a known-good test email. Confirm: redirected to Screen
          2, a real email arrives containing a bare number (not a link).
       4. Enter the wrong code on purpose. Confirm: `LOGIN_ERROR_WRONG
          _CODE`, still on Screen 2, email preserved.
       5. Enter the correct code. Confirm: signed in, landed on
          `/dashboard` or `/onboarding` matching that account's real
          `tenant_id` state.
       6. Request a second code immediately (resend). Confirm either it
          succeeds after the real cooldown or is refused with
          `LOGIN_ERROR_RESEND_RATE_LIMITED` before it.
       7. Let a requested code sit unused past the real validity window
          from (g)#3, then try it. Record the exact observed `error.code`
          (per (d)'s S3 correction, expected `otp_expired` — confirm or
          correct that expectation here) — the UI text is already settled
          (f)'s shared wrong/expired string; this step confirms what the
          SDK actually returns underneath it.
       8. ADDED (25 Sep 2026, external review round 1, S1): seed a user
          WITHOUT `email_confirm: true` on test-db and call `signInWithOtp`
          for that address. Record which email template arrives (Magic
          Link vs. Confirm-signup vs. other). If not Magic Link, (g)#9's
          conditional item becomes required before this design is
          considered closed.

     On PROD (`jvxwqignooseazzmwhvl`) — ONLY once test-db's script above
     is fully green, and ONLY with Aravind's own real email, per
     CLAUDE.md's "A LIVE WHATSAPP MESSAGE IS NEVER SENT..." rule's sibling
     principle for email — no message goes to any address not
     explicitly confirmed by Aravind in the same session as the send:
       1. Repeat steps 2-6 above against prod, using Aravind's own known
          account.
       2. Confirm step 7 (expired code) is NOT repeated needlessly
          against prod if test-db already established the behavior —
          only re-confirm if test-db and prod have DIFFERENT dashboard
          settings for validity window (per (g), each project's setting
          is independent).
       3. ADDED (25 Sep 2026, external review round 2, S1): directly
          observe PROD's "Allow new users to sign up" toggle itself — this
          is the ONE thing none of the other steps in this script, T-OTP-
          01, or T-OTP-01b can observe on PROD, because every one of them
          goes through THIS app's own code, which always sends
          `shouldCreateUser: false` explicitly (per D-O2/(b)) — so all of
          them observe only the APP-level guard, never whether the
          Supabase PLATFORM toggle itself is actually off on production
          right now. This closes the "signup toggle unobserved since
          2026-09-17" item that has stood in every round's UNKNOWNS so
          far. Step: call `supabase.auth.signInWithOtp({ email:
          <never-seen-before-on-prod, Aravind-controlled address> })`
          directly against PROD, WITHOUT setting `shouldCreateUser` at
          all (bypassing this app's own code path entirely — a raw SDK
          call, the same pattern (h)'s T-OTP-01b already uses on test-db).
          Assert: (a) the call returns a refusal, and (b) no new
          `auth.users` row was created, checked via
          `admin.listUsers({ email: ... })` immediately after. Print the
          observed `error.code`. If a new `auth.users` row DOES appear —
          meaning signups are actually allowed on prod, contradicting the
          2026-09-17 record — immediately run `admin.deleteUser` on that
          row to clean it up, and treat this as a STOP-and-report finding,
          not a step to quietly continue past.

i) FILES TO CREATE / MODIFY / DELETE

   Modify:
     - `app/(auth)/login/page.tsx` — replace `sendMagicLink` with a
       code-request action (RETAINS `emailRedirectTo` per (a)'s B1
       correction; adds `shouldCreateUser: false`); replace the
       `step=sent` confirmation branch with a `step=code` branch rendering
       the new Screen 2 form; add a second Server Action for `verifyOtp` +
       the tenant_id-based redirect (duplicated from the callback route's
       logic per (a) Screen 3, reusing the SAME client instance per (a)'s
       N1 addition — not extracted into a shared helper in this slice, to
       keep the diff small; extraction is a reasonable fast-follow, not
       required here); every error redirect uses a known constant key per
       (e)'s S4 rule.
     - `app/(auth)/auth/callback/route.ts` (ADDED 25 Sep 2026, external
       review round 1, Q2 — moved out of "NOT modified" below, where it
       was incorrectly listed) — ONE-LINE-SHAPED change: its error
       redirect (lines 17-20) uses a known constant key instead of
       `error.message` raw, matching (c)'s Q2 correction. The route's
       core logic (`exchangeCodeForSession`, the `tenant_id` branch) is
       otherwise unchanged.
     - Any single shared strings/constants file this codebase already
       uses for user-facing copy, if one exists (NOT CONFIRMED — this
       plan did not locate one; if none exists, the (f) string constants,
       now all approved, are added as exported consts local to
       `app/(auth)/login/page.tsx`, since nothing else references them
       per (f)'s own file-scope finding).

   Create:
     - A new test file, e.g. `test/login-otp.test.ts`, covering T-OTP-01,
       T-OTP-01b, T-OTP-02 through T-OTP-07 from (h).

   NOT modified (named explicitly so a reviewer can see the boundary):
     - `lib/supabase/client.ts`, `server.ts`, `service.ts` — no change;
       the SSR wiring already supports this flow per (a).
     - `proxy.ts` — no change; unrelated to login-specific logic.
     - `app/(dashboard)/layout.tsx` — no change; T-OTP-06 is a
       regression test against its EXISTING behavior, not a modification
       of it.
     - `app/(onboarding)/onboarding/page.tsx` — explicitly out of scope
       (its own raw-error-surfacing issue is a separate, already-parked
       item per docs/build-status.md, not touched here).

   FORBIDDEN LIST — explicit confirmation none of these are touched by
   the above, and no part of this plan's own logic implies they need to
   be:
     - `supabase/migrations/**` — confirmed: no schema change of any
       kind is needed; the entire OTP mechanism is a Supabase Auth
       platform feature plus a dashboard template setting, not a new
       table/column/function.
     - `.github/workflows/ci.yml` — confirmed: the new test file runs
       under the existing `vitest` suite with no new CI wiring.
     - `test/helpers/db.ts` — confirmed: (h)'s tests use the existing
       admin-client/service-role pattern already established by
       `test/migration-007.test.ts`; no new test-helper infrastructure
       is implied.
     - `package.json` / `package-lock.json` — confirmed: `@supabase/
       supabase-js` and `@supabase/ssr` are already installed (1.1); no
       new dependency is needed.
     - `lib/engineers/**` — confirmed: unrelated surface, not referenced
       anywhere in this plan.
   NO CONFLICT FOUND: every forbidden path is naturally out of scope for
   this slice; nothing here had to be excluded by force.

j) ROLLBACK

   ~~If merged and sign-in breaks for everyone:
     1. Revert the single commit/PR that changed `login/page.tsx` (this
        plan touches exactly one application file plus one new test
        file — a clean, single-file revert with no migration to also
        roll back, since none exists).
     2. Independently: revert the dashboard email-template change from
        (g)#1 back to `{{ .ConfirmationURL }}` — this is a MANUAL,
        DASHBOARD-ONLY rollback step that a code revert alone does NOT
        undo. Both reverts are needed together: reverting the code
        without reverting the template leaves the old `sendMagicLink`
        code requesting a link via a template that's still emitting a
        link, which actually still works — so the CODE side is not the
        dangerous half; the TEMPLATE side is the one that, left
        switched to `{{ .Token }}` while old link-based code is
        restored, would break a reverted app just as badly. State this
        explicitly: the rollback is NOT complete until BOTH sides match
        again (link+link, or code+code).
     3. Escape hatch for Aravind specifically, while broken: the
        Supabase dashboard's own Authentication -> Users screen lets an
        admin manually confirm/inspect a user and, if genuinely locked
        out, the SQL editor or `supabase db query --linked` (per
        CLAUDE.md §0's own accepted apply path, condition (c)'s explicit
        go-ahead requirement still applying) can call
        `auth.admin.generateLink` via a one-off authenticated script run
        locally with the service-role key (never committed, never
        logged) to mint a working session server-side, bypassing the
        broken UI entirely — this is the same mechanism (h)'s tests
        already use, so it is a proven, already-exercised escape hatch,
        not a novel one invented for rollback.~~

   REWRITTEN (25 Sep 2026, external review round 1, B2): the struck version
   above had both the order and the escape hatch wrong.

   ORDER — reverse of deploy, not the same order as deploy:
     1. Flip the email template back to `{{ .ConfirmationURL }}` FIRST
        (reverse of (g)'s DEPLOY ORDER, which flips it last, on the way
        up).
     2. THEN revert the commit/PR that changed `login/page.tsx` (and, per
        (c)'s Q2 correction, the one-line change to
        `app/(auth)/auth/callback/route.ts`, if that commit is separate).
   Reason revert-first is WRONG: reverting the code commit first restores
   the OLD screen (which only knows how to ask for a link click) while the
   template is still emitting `{{ .Token }}` — the email that arrives is a
   bare number, but the restored screen has no code box and never sends a
   link either. That user is locked out, symmetric to (c)'s own
   template-first deploy hazard. Flipping the template back first restores
   link-emission while the NEW code-based screen is still deployed — that
   screen doesn't yet know what to do with a link either, but per (c) the
   callback route is kept and (a)'s B1 correction keeps `emailRedirectTo`
   live, so a user who clicks that link still completes sign-in via the
   unmodified `exchangeCodeForSession` path, same as they could throughout
   the entire code-first deploy window. Rollback is NOT complete until code
   and template match again (old code + link template, the fully-reverted
   end state).

   ESCAPE HATCH — differs by which code is CURRENTLY deployed at the moment
   someone is locked out, not one universal answer:
     - If the NEW (OTP) code is still deployed when someone is locked out:
       `supabase.auth.admin.generateLink({ type: 'magiclink', email })`
       returns `data.properties.email_otp` (per 1.11) — that raw 6-digit
       value can be typed directly into the deployed Screen 2's code input
       and verified via the deployed `verifyOtp` action, regardless of
       what the email template currently emits. This works because the
       NEW screen has a code input to receive it.
     - If the OLD (link-only) code has already been reverted back into
       deployment: there is NO equivalent server-side lever. The old
       screen has no code input to receive an `email_otp` value, and (per
       the corrected reasoning below) a locally-generated `action_link`
       cannot be completed outside a real browser either. The ONLY
       recovery in this state is the template flip itself (already ORDER
       step 1 above) — there is no faster individual-user workaround.

   ~~Escape hatch for Aravind specifically, while broken: ... a one-off
   authenticated script run locally with the service-role key (never
   committed, never logged) to mint a working session server-side,
   bypassing the broken UI entirely — this is the same mechanism (h)'s
   tests already use, so it is a proven, already-exercised escape hatch,
   not a novel one invented for rollback.~~

   CORRECTED (25 Sep 2026, external review round 1, B2): the struck
   sentence is wrong and is removed as an escape hatch. A session obtained
   by calling `verifyOtp` (or inspecting `generateLink`'s response) inside
   a local script, authenticated with the service-role key, exists only in
   that script's process memory — it is never written to any browser's
   cookies, so it does not make the broken web UI usable for an actual
   human. Separately, opening the `action_link` URL that `generateLink`
   returns, from any context OTHER than the exact browser session that
   initiated the original request, lands on `/auth/callback?code=...` with
   no matching PKCE code_verifier in that browser's storage — this is a
   REAL, NAMED failure mode in the installed SDK itself, not this plan's
   invention: `AuthPKCECodeVerifierMissingError`
   (`node_modules/@supabase/auth-js/dist/module/lib/errors.d.ts`, its own
   docstring: "This typically happens when the auth flow was initiated in
   a different browser, device, or the storage was cleared"). A script
   run locally with the service-role key is exactly such a different
   context. ~~NOTE ON PROVENANCE: this task's own instruction referred to
   this as "the 19 Aug failure verbatim," implying a dated, recorded
   incident. This plan searched the repo for it directly (`git grep` for
   `action_link`, `PKCE verifier`, `code verifier`, `pkce_code_verifier`
   across `origin/main`, and for a 2026-08-19-dated entry in
   `docs/build-status/**`, `docs/claude-rules-history/**`, and
   `docs/reviews/**`) and found NO matching recorded incident anywhere in
   this repository. The technical claim itself is independently verified
   above, from the installed SDK's own error class and docstring — but no
   dated "19 Aug" incident record exists in this codebase to cite, and
   this plan does not invent one. Flagged in UNKNOWNS.~~

   NOTE ON PROVENANCE — UPDATED (25 Sep 2026, external review round 2,
   RECORD, condition 5): the gap described in the struck paragraph above
   is now CLOSED. The 2026-08-19 cross-device PKCE observation is recorded
   in `docs/build-status.md`'s "How people log in" section, committed as
   `1cf9d7dde945e42c119ee7c90f8e5ea37827bc52` on branch
   `docs/auth-pkce-incident-record`, merged to `origin/main` via PR #316
   (verified: `gh pr view 316` returns `headRefName:
   docs/auth-pkce-incident-record`, `headRefOid:
   1cf9d7dde945e42c119ee7c90f8e5ea37827bc52`, `state: MERGED` — an exact
   match, not an assumed one). This plan's own citation above now rests on
   TWO independent legs where it previously rested on one: the installed
   SDK's `AuthPKCECodeVerifierMissingError` docstring (the technical
   mechanism) AND this now-real repo record (the dated observation itself,
   `docs/build-status.md`, the entry immediately following the
   2026-09-17 "Login must complete on the official host" entry). STATED
   PLAINLY so a future reader doesn't overweight this citation trail: the
   round-1 reviewer's own framing of this as "the 19 Aug bug, verbatim"
   was ITSELF not a repo record at the time it was said — round 1's own
   grep (reproduced in the struck paragraph above) found nothing. The
   underlying technical claim has never rested on that phrase being a
   pre-existing citation; it rested on the SDK docstring then, and now
   additionally on this newly-created, independently verified commit.

k) RECORDS

   EXTERNAL REVIEW ROUND 2 — CONDITIONAL DESIGN GO (25 Sep 2026): external
   review round 2 returned a CONDITIONAL GO on this plan's DESIGN. CORRECTED
   (build task Step 1, 28 Sep 2026): this list previously said "Five
   conditions were attached" and enumerated four ADDRESSED-this-round items
   (S1, N1, N2, N3) plus one DONE-prior-to-this-round item (the PKCE
   RECORD). That undercounted the ADDRESSED-this-round set by two: S2 (the
   stale (c) sentence about `emailRedirectTo`, corrected in the body at the
   time but never added to this summary) and N4 (the §1.7 proxy.ts
   citation-wording nit, closed by this same build-task edit — see 1.7
   above). Six conditions were attached; status of each as of this round:
     1. S1 — directly observe PROD's "Allow new users to sign up" toggle
        itself, not just the app-level guard. STATUS: ADDRESSED this
        round — new step 3 added to (h)'s "On PROD" manual script.
     2. S2 — correct the stale, struck sentence in (c) claiming that once
        the code-request call stops passing `emailRedirectTo` and the
        template stops emitting `{{ .ConfirmationURL }}`, nothing will
        construct a link to `/auth/callback` going forward — false once
        (a)'s B1 correction established `emailRedirectTo` IS retained, so
        the code itself keeps constructing the link indefinitely; what
        actually stops a usable link reaching an inbox is the template
        flip in (g)#1, not the code. STATUS: ADDRESSED this round — (c)'s
        stale struck sentence corrected in place.
     3. N1 — correct the B1 mechanism paragraph in (a): the risk window is
        template-still-`{{ .ConfirmationURL }}` plus new-code-deployed,
        not a hypothetical `{{ .Token }}`-email-with-fallback-link, and
        the 2026-09-17 incident is direct evidence, not an analogy.
        STATUS: ADDRESSED this round — (a)'s B1 paragraph rewritten.
     4. N2 — T-OTP-02's seeded user must use `admin.createUser({
        email_confirm: true })`, matching D-O2, so the test exercises the
        real customer path rather than the unconfirmed-user path (g)#9/S1
        is separately investigating. STATUS: ADDRESSED this round — (h)'s
        T-OTP-02 corrected.
     5. N3 — correct the real-email-send count feeding (g)#10's cap
        arithmetic: `generateLink` sends no email, so only T-OTP-04 and
        T-OTP-05 send real email (two per run, not four). STATUS:
        ADDRESSED this round — (h) and (g)#10 both corrected.
     6. N4 — §1.7's `proxy.ts` citation was worded so that "printed above"
        appeared once struck (the original false claim) and once live (the
        N3 fix reasserting it), which reads as unresolved on a skim even
        though the file genuinely is printed raw. STATUS:
        CLOSED-BY-THIS-EDIT — 1.7 rewritten to state plainly, once, that
        proxy.ts is printed raw above; no restated correction narrative.
     7. (Tracked separately from the six above, not folded into them: a
        DONE-prior-to-this-round item, not one round 2 itself attached.)
        The 2026-08-19 cross-device PKCE observation must be recorded in
        the repo, not left as a plan-only citation resting on a chat-
        export decision document. STATUS: DONE, prior to this round —
        commit `1cf9d7dde945e42c119ee7c90f8e5ea37827bc52` on branch
        `docs/auth-pkce-incident-record`, merged via PR #316 (VERIFIED
        this round via `gh pr view 316`: `headRefOid` matches exactly,
        `state: MERGED`). Every place in this plan that previously
        flagged this as a provenance gap ((j)'s NOTE ON PROVENANCE, and
        this RECORD's own condition 5) now cites this real commit.
   STATED EXPLICITLY: this GO covers the DESIGN only. The eventual build
   PR is FULL tier in its own right (CLAUDE.md §0's PRE-LAUNCH TWO-TIER
   CHANGE PROCESS and its EXTERNAL REVIEW GATE condition (c) — this touches
   auth/identity directly) and requires its own review at build time,
   regardless of this design-level GO. A design GO is not a build GO.

   DATED AMENDMENT (2026-09-21, Aravind's decision, recorded here per
   D-O1):
     This amendment SUPERSEDES two prior records:
       (i) `docs/design-decisions/outbound-infra-and-auth.md` §26
           (2026-08-15), specifically its first bullet: "First user
           creation -> magic link (unchanged, existing behaviour). Every
           login after the first -> OTP delivered over WhatsApp, not
           magic link, not password."
       (ii) `docs/build-status.md`'s "How people log in" entry
           (2026-09-17), specifically its scope line: "WhatsApp OTP
           replaces the email magic link (decided 2026-09-17)."
     As of 2026-09-21: EVERY login (first and subsequent) uses an EMAIL
     OTP code, replacing the magic link entirely. WhatsApp OTP is
     deferred to a later channel-addition slice, not cancelled — the
     risk analysis in §26 (WhatsApp-only lockout risk, Authentication-
     template billing-per-delivery, Meta template approval dependency)
     remains valid and un-superseded for WHENEVER that later slice is
     built; only the "which channel ships first, and does it replace
     magic link" decision changes here. This amendment is recorded in
     this plan file; per this task's own instruction, the two source
     documents above are NOT edited (no repo writes in a plan-only
     task) — a future session applying this plan should append this
     amendment to both source documents as part of that work, not as
     part of this one.

   STRINGS APPROVED (2026-09-21, per Aravind): strings 1-11 of Aravind's
   21 Sep wording list — filled into (f)'s table against
   `LOGIN_OTP_EMAIL_SUBJECT`, `LOGIN_OTP_EMAIL_BODY`,
   `LOGIN_CODE_STEP_HEADING`, `LOGIN_CODE_STEP_BODY`,
   `LOGIN_CODE_INPUT_LABEL`, `LOGIN_CODE_STEP_SUBMIT_LABEL`,
   `LOGIN_CODE_RESEND_LABEL`, `LOGIN_ERROR_WRONG_CODE` +
   `LOGIN_ERROR_EXPIRED_CODE` (shared wording, one approved string, per
   (f)'s note), `LOGIN_ERROR_TOO_MANY_ATTEMPTS`, `LOGIN_ERROR_UNKNOWN
   _EMAIL`, and `LOGIN_ERROR_GENERIC` — are APPROVED, final, and ship
   as-is. ~~D-O5's blank-constant rule does NOT apply to these eleven; it
   still applies to the remaining six constants in (f)'s table that
   Aravind's list did not cover (`LOGIN_EMAIL_STEP_HEADING`,
   `LOGIN_EMAIL_STEP_BODY`, `LOGIN_EMAIL_STEP_SUBMIT_LABEL`,
   `LOGIN_CODE_START_OVER_LABEL`, `LOGIN_ERROR_RESEND_RATE_LIMITED`).~~

   STRINGS APPROVED — FINAL FIVE (2026-09-21, per Aravind, same day): the
   remaining five constants — `LOGIN_EMAIL_STEP_HEADING`,
   `LOGIN_EMAIL_STEP_BODY`, `LOGIN_EMAIL_STEP_SUBMIT_LABEL`,
   `LOGIN_CODE_START_OVER_LABEL`, and `LOGIN_ERROR_RESEND_RATE_LIMITED` —
   are now also APPROVED, final, and ship as-is. ALL SEVENTEEN constants
   in (f)'s table are approved; no BLANK rows remain. D-O5's blank-
   constant rule is FULLY DISCHARGED for this slice — nothing further is
   pending from Aravind on wording.

   CROSS-SLICE ENUMERATION NOTE (dated 2026-09-21, per Aravind): the
   add-site-engineers surface (migration 048, `lib/engineers/copy.ts`)
   deliberately does NOT reveal whether a phone number is already
   registered (that file's own "Deliberate, do not fix" header), while
   this slice's `LOGIN_ERROR_UNKNOWN_EMAIL` deliberately DOES reveal
   whether an email exists (see (e)'s ACCEPTED TRADE-OFF note above for
   the full reasoning — not repeated here). Both are intentional, dated
   decisions, not a defect in either slice, and opposite choices for a
   reason: this slice was pre-beta with no public signup surface, while
   the engineers surface protects against enumerating OTHER companies'
   phone numbers. Reconcile both against the same anti-enumeration
   standard once self-serve signup opens.

   The approved strings live in a NEW file, separate from
   `lib/engineers/copy.ts` (confirmed via `git show origin/main:lib/
   engineers/copy.ts`: that file is scoped to the add-site-engineers
   flow specifically, with its own "Deliberate, do not fix" header note
   about a different enumeration choice — see (e) above). The new auth
   strings file follows the SAME header convention already established
   by `copy.ts` (a top comment naming the file's scope and any
   placeholder syntax, plus a "Deliberate, do not fix" block for
   non-obvious choices) — for this file, that block should record the
   (f) note that `LOGIN_ERROR_WRONG_CODE`/`_EXPIRED_CODE` share one
   approved string on purpose, and the (e) note that `LOGIN_ERROR_UNKNOWN
   _EMAIL` is a deliberate, dated enumeration trade-off, not an oversight
   to "fix" later without re-checking with Aravind first.

   BLOCKERS THIS SLICE DOES NOT CLOSE (named explicitly, none of them
   silently implied as fixed by this plan):
     1. Onboarding re-entry guard / duplicate-tenant bug —
        `complete_onboarding` (`supabase/migrations/016_corrections.sql
        :160-191`, confirmed by direct read in this session, 1.-prefix
        excerpt above) has no check for an existing `tenant_id` before
        minting a new tenant. Per D-O4, unresolved by this slice.
        Tracked in docs/build-status.md's "How people log in" entry as
        "a HARD BLOCKER for the switch trigger on its own."
     2. `users.role` vs `project_members.role` divergence —
        `complete_onboarding` sets `users.role = 'admin'` for every
        self-serve account while project creation separately sets
        `project_members.role = 'pm'` for the same person on that
        project; `canEditLog` (`lib/daily-logs/correction.ts:131-133`)
        and the `correct_daily_log` RPC
        (`supabase/migrations/019_daily_log_corrections.sql:170-181`)
        both authorize off `users.role`, not `project_members.role`.
        Confirmed on prod by observation, 2026-09-17 (per
        docs/build-status.md). Untouched by this slice.
     3. Missing role gate on the dashboard layout —
        `app/(dashboard)/layout.tsx` has only an authentication check
        (1.8), no role check; any authenticated user can reach every
        nav link regardless of role. Untouched by this slice — this
        plan's new Screen 2 sits entirely before that layout is ever
        reached.
     4. WhatsApp OTP channel — deferred per D-O1's amendment above, not
        cancelled; §26's risk analysis remains the reference document
        for whenever it is scheduled.

--------------------------------------------------------------------
STEP 3 — CONFIRM NOTHING WAS WRITTEN TO THE REPO
--------------------------------------------------------------------
$ git status --porcelain
(empty)

$ git branch --show-current
main
(confirmed: main, unchanged)

$ git log -1 --oneline
78d7763 Merge pull request #309 from ara-2789/feat/engineer-copy

RE-CONFIRMED (25 Sep 2026, external review round 1): same result — repo
still clean, still on `main`, still zero commits made by any of this plan's
sessions. NOTE: local `main`'s tip (78d7763) is BEHIND `origin/main`
(re-pinned to 3c0a243 this round, per PIN above) — this is expected and
benign: this task only ever reads via `git show origin/main:<path>` and
`git fetch`, and never checks out, merges, or fast-forwards the local
branch. The local/origin gap is not evidence of any repo write by this
plan.

RE-CONFIRMED AGAIN (25 Sep 2026, external review round 2):
$ git status --porcelain
(empty)

$ git branch --show-current
docs/auth-pkce-incident-record

CWD NOTE: this round ran from an active `EnterWorktree` isolation session
at `.claude/worktrees/docs+auth-pkce-incident-record`, left over from a
prior, SEPARATE, already-finished task (recording the 2026-08-19
observation itself — see (k)'s RECORD condition 5 and (j)'s NOTE ON
PROVENANCE). That branch's own single commit
(`1cf9d7dde945e42c119ee7c90f8e5ea37827bc52`) was already committed and
pushed to `origin` BEFORE this round began — it is unrelated to, and
unaffected by, this plan-amendment task, which touches only this Desktop
file. `git status --porcelain` empty confirms no NEW uncommitted change
exists anywhere in that worktree either. Zero commits were made by this
round's own work; the branch shown is not `main` only because of this
incidental, already-resolved isolation context, not because this task
wrote anything to the repo.


--------------------------------------------------------------------
UNKNOWNS
--------------------------------------------------------------------

(1) NEEDS THE SUPABASE DASHBOARD (not derivable from the repo):
    - Whether the email template's `{{ .Token }}` variable is already
      configured on either project, or still `{{ .ConfirmationURL }}`
      (assumed still link-based today, since the app currently only
      ever sends links — not independently verified this session, no
      dashboard access from this environment).
    - Current OTP code length, validity window, and resend cooldown on
      BOTH projects (g)#2-#4 — none of these are config-as-code anywhere
      in this repo. (g)#8 requires these to be exactly 6/10min/60s; not
      independently confirmed they can be.
    - Whether a separate "max verification attempts" dashboard field
      exists at all, distinct from the endpoint rate limit — (g)#5 flags
      this as unconfirmed; this round's S3 finding (the SDK's `ErrorCode`
      enum has no dedicated per-attempt-count code) makes it MORE likely
      no such separate field exists, but that is an inference from an
      SDK enum, not a dashboard observation.
    - Which email sender is configured on BOTH projects (custom SMTP vs.
      Supabase's built-in dev sender) and each project's hourly send cap
      — ADDED THIS ROUND, (g)#10, S2. Bounds how many times (h)'s manual
      script can safely be run per hour.
    - Whether an unconfirmed user (no `email_confirm: true`) receives the
      Magic Link template or a different one (e.g. Confirm-signup) on
      first `signInWithOtp` — ADDED THIS ROUND, S1. (g)#9 is CONDITIONAL
      on this observation; (h)'s manual script step 8 is the PLANNED,
      NOT-YET-RUN test that settles it.
    - Whether "Allow new users to sign up" is still disabled on prod as
      of today, 2026-09-25 (last independently recorded observation:
      2026-09-17, per docs/build-status.md — 8 days old, not re-checked
      this session since this is a plan-only task with no DB/dashboard
      access). UPDATED THIS ROUND (external review round 2, S1): (h)'s
      "On PROD" manual script now has a dedicated step 3 that directly
      settles this by observation (a raw `signInWithOtp` call bypassing
      the app entirely) — the mechanism to close this UNKNOWN now exists
      in the plan, but the observation itself has not been RUN yet (no DB
      access in this plan-only task), so the toggle's current state
      remains unconfirmed until (h)'s script is actually executed.
    - RUNTIME CONFIRMATION of this round's error-code findings: this
      round grounded `otp_expired`, `over_request_rate_limit`, and
      `over_email_send_rate_limit` from the INSTALLED SDK's `ErrorCode`
      enum (a real, verifiable source — see (d)'s S3 correction) — but
      whether Supabase's server ACTUALLY returns exactly these codes for
      this project's real configuration is still unconfirmed; only (h)'s
      manual script (steps 4, 6, 7) settles this by direct observation.

(2) NEEDS AN ACTUAL DECISION FROM ARAVIND (distinct from D-O1..D-O5,
    which are already decided and were treated as fixed inputs above):
    - ~~The wording for every BLANK string in (f)...~~ RESOLVED
      (2026-09-21, per Aravind): all 17 constants in (f) are now
      approved; see (k)'s STRINGS APPROVED — FINAL FIVE record. No
      wording remains open.
    - Whether Screen 2 re-collects the email address by hand or carries
      it forward silently (a hidden field/session value) — (a) flagged
      this as "Aravind's call at build time," not decided here. THIS
      ROUND's S4 addition to (a) establishes that neither choice changes
      the security/validation posture of the value once rendered, but
      does not itself pick one.
    - Whether the OTP-request and OTP-verify Server Actions should be
      extracted into a shared helper now or left duplicated with the
      callback route's tenant_id-redirect logic (i) chose NOT to extract,
      to keep this slice's diff small, but that is a judgment call, not
      a technical requirement.
    - Whether a codebase-wide shared strings/constants module should be
      introduced now (this plan did not find one to reuse, per (i)) or
      whether file-local constants in `login/page.tsx` are acceptable
      for this slice.
    - Whether this plan, once approved, goes to the external reviewer
      named in CLAUDE.md's EXTERNAL REVIEW GATE as a document (this
      file) or needs to be translated into a different review-package
      shape first — this plan followed the "external review from the
      plan stage" instruction from §26 by writing self-contained,
      citation-grounded prose, but the actual review-package template
      (docs/migration-runbook-template.md) is migration-shaped and this
      slice has no migration; whether that template's non-migration
      sections still apply is Aravind's call.
    - NEW, THIS ROUND (S1): IF (h)'s planned observation finds an
      unconfirmed user gets a template other than Magic Link, Aravind
      must decide whether to flip that second template too (per (g)#9)
      before build — this plan states the conditional trigger but the
      observation hasn't run yet, so the decision itself is not yet
      needed, only anticipated.
    - NEW, THIS ROUND (N2): the "official host" / Site URL requirement
      remains genuinely open for the kept link-based callback route (per
      (g) item 7's N2 addition) — Aravind has not decided whether/how to
      close this for as long as the link route stays reachable; it is
      independent of this slice and not resolved by it.
    - ~~NEW, THIS ROUND (B2, provenance gap...)~~ RESOLVED (25 Sep 2026,
      external review round 2, RECORD condition 5): the round-1 provenance
      gap described here is CLOSED. The 2026-08-19 observation is now
      recorded in `docs/build-status.md`, committed as
      `1cf9d7dde945e42c119ee7c90f8e5ea37827bc52` on branch
      `docs/auth-pkce-incident-record`, and merged via PR #316 — verified
      this round via `gh pr view 316` (exact `headRefOid` match, `state:
      MERGED`). See (j)'s updated NOTE ON PROVENANCE and (k)'s new
      EXTERNAL REVIEW ROUND 2 record for the full citation. No decision
      from Aravind is needed on this item any longer.

END OF PLAN. Nothing in this document was applied — no code, no branch,
no commit, no database write. This file (~/Desktop/email-otp-plan.txt)
is the complete deliverable.
