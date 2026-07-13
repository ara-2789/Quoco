import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/types/database'

// Service-role client for backend-only operations: the jobs queue worker,
// cron endpoints, and the WhatsApp webhook. Bypasses RLS entirely.
// NEVER import this file into anything that runs in the browser or in a
// user-session-aware route. Server-side only, per CLAUDE.md §4 and §8.
export function createServiceClient() {
  return createSupabaseClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  )
}