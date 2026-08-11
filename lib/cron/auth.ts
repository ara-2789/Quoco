import type { NextRequest } from 'next/server'

// Shared cron-request authorization check (2026-08-12) — Vercel's
// documented mechanism for securing Cron Jobs, verified directly against
// Vercel's current docs at build time, not assumed from training: when a
// project's CRON_SECRET environment variable is set, Vercel automatically
// sends `Authorization: Bearer <CRON_SECRET>` on every cron-triggered
// invocation. The comparison below matches Vercel's own recommended
// snippet exactly.
//
// FAILS CLOSED — if CRON_SECRET is unset (misconfigured, or not yet
// provisioned in this environment), this returns false. Never "no secret
// configured, allow everything."
//
// SHARED BY BOTH /api/jobs/tick AND /api/cron/dpr-generate (2026-08-12).
// Before this, /api/jobs/tick had NO auth at all, live in production —
// an unauthenticated request could only claim jobs that already existed.
// /api/cron/dpr-generate is a materially worse target for the same gap:
// an unauthenticated, repeated hit can ENQUEUE jobs, each costing a real
// Anthropic API call — a cost-abuse surface, not just a data-integrity
// one, created by adding this route. Same class of finding as migration
// 020 (over-broad access to something that should be restricted); this
// project already has one incident on record from that shape. One shared
// check, not two hand-copies, so the two routes cannot silently drift on
// what "authorized" means.
export function isCronRequestAuthorized(request: NextRequest): boolean {
  const cronSecret = process.env.CRON_SECRET
  const authHeader = request.headers.get('authorization')
  return Boolean(cronSecret) && authHeader === `Bearer ${cronSecret}`
}
