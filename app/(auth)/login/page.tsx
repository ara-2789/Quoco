import { headers } from 'next/headers'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function sendMagicLink(formData: FormData) {
  'use server'
  const email = (formData.get('email') as string).trim()
  const headersList = await headers()
  const origin = headersList.get('origin') ?? `https://${headersList.get('host')}`

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: `${origin}/auth/callback` },
  })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }
  redirect(`/login?step=sent&email=${encodeURIComponent(email)}`)
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; email?: string; error?: string }>
}) {
  const params = await searchParams

  if (params.step === 'sent') {
    const email = params.email ?? ''
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Check your email</h2>
        <p className="text-gray-500 text-sm mb-6">
          We sent a sign-in link to <strong>{email}</strong>. Click it to continue — the link
          expires in 1 hour.
        </p>
        <p className="text-center text-sm text-gray-500">
          Wrong email?{' '}
          <a href="/login" className="text-blue-600 hover:underline">
            Start over
          </a>
        </p>
      </div>
    )
  }

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
      <h2 className="text-xl font-semibold text-gray-900 mb-1">Sign in</h2>
      <p className="text-gray-500 text-sm mb-6">
        Enter your work email to receive a sign-in link.
      </p>

      {params.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {params.error}
        </div>
      )}

      <form action={sendMagicLink} className="space-y-4">
        <div>
          <label htmlFor="email" className="block text-sm font-medium text-gray-700 mb-1">
            Email address
          </label>
          <input
            id="email"
            name="email"
            type="email"
            required
            autoComplete="email"
            placeholder="you@company.com"
            className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <button
          type="submit"
          className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
        >
          Send sign-in link
        </button>
      </form>
    </div>
  )
}
