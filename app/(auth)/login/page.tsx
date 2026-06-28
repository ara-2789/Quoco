import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

async function sendOtp(formData: FormData) {
  'use server'
  const email = (formData.get('email') as string).trim()

  const supabase = await createClient()
  const { error } = await supabase.auth.signInWithOtp({ email })

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`)
  }
  redirect(`/login?step=verify&email=${encodeURIComponent(email)}`)
}

async function verifyOtp(formData: FormData) {
  'use server'
  const email = (formData.get('email') as string).trim()
  const token = (formData.get('token') as string).trim()

  const supabase = await createClient()
  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' })

  if (error) {
    redirect(
      `/login?step=verify&email=${encodeURIComponent(email)}&error=${encodeURIComponent(error.message)}`,
    )
  }

  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) {
    redirect('/login')
  }

  const { data: profile } = await supabase
    .from('users')
    .select('tenant_id')
    .eq('id', user.id)
    .single()

  if (!profile?.tenant_id) {
    redirect('/onboarding')
  }

  redirect('/dashboard')
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ step?: string; email?: string; error?: string }>
}) {
  const params = await searchParams

  if (params.step === 'verify') {
    const email = params.email ?? ''
    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-8">
        <h2 className="text-xl font-semibold text-gray-900 mb-1">Enter your code</h2>
        <p className="text-gray-500 text-sm mb-6">
          We sent a 6-digit code to <strong>{email}</strong>. Enter it below to sign in.
        </p>

        {params.error && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
            {params.error}
          </div>
        )}

        <form action={verifyOtp} className="space-y-4">
          <input type="hidden" name="email" value={email} />
          <div>
            <label htmlFor="token" className="block text-sm font-medium text-gray-700 mb-1">
              6-digit code
            </label>
            <input
              id="token"
              name="token"
              type="text"
              inputMode="numeric"
              pattern="[0-9]{6}"
              maxLength={6}
              required
              autoFocus
              placeholder="123456"
              className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent tracking-widest text-center text-lg"
            />
          </div>
          <button
            type="submit"
            className="w-full bg-blue-600 text-white rounded-md px-4 py-2 text-sm font-medium hover:bg-blue-700 active:bg-blue-800 transition-colors"
          >
            Sign in
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-gray-500">
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
        Enter your work email to receive a one-time code.
      </p>

      {params.error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-md text-red-700 text-sm">
          {params.error}
        </div>
      )}

      <form action={sendOtp} className="space-y-4">
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
          Send code
        </button>
      </form>
    </div>
  )
}
