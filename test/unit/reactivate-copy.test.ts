import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import {
  formatQuocoNumber,
  buildReconnectInstruction,
  buildForwardMessage,
  buildForwardHref,
} from '@/lib/daily-logs/reactivate-copy'

// DASH-03 / BOT-27 2b — the messaging_blocked reactivation CTA.
//
// The repo has no React render harness (all test/unit/* are pure-logic tests);
// the CTA is built as thin presentation over the pure builders below, so the copy
// contract is tested here directly, and the no-mutation invariant is guarded by a
// static source assertion (mirrors scripts/check-profile-lookups.mjs).

describe('reactivate-copy — pure builders', () => {
  it('formatQuocoNumber strips the whatsapp: prefix and trims', () => {
    expect(formatQuocoNumber('whatsapp:+14155238886')).toBe('+14155238886')
    expect(formatQuocoNumber('+14155238886')).toBe('+14155238886')
    expect(formatQuocoNumber('  whatsapp:+14155238886  ')).toBe('+14155238886')
  })

  it('buildReconnectInstruction names engineer + number and says START (hard constraint)', () => {
    const s = buildReconnectInstruction('Ravi', '+14155238886')
    expect(s).toContain('START')
    expect(s).toContain('+14155238886')
    expect(s).toContain('Ravi')
    // Must teach the future keyword contract, never generic "text us".
    expect(s).not.toMatch(/text us\b/i)
  })

  it('buildReconnectInstruction degrades cleanly with no number but still says START', () => {
    const s = buildReconnectInstruction('Ravi', null)
    expect(s).toContain('START')
    expect(s).not.toContain('null')
  })

  it('buildForwardMessage is action-only (no WhatsApp-mechanics "why") and names START + number', () => {
    const s = buildForwardMessage('Ravi', '+14155238886')
    expect(s).toContain('START')
    expect(s).toContain('+14155238886')
    expect(s).toContain('Ravi')
    // Simplified per 2b review — the engineer-facing text drops the mechanics.
    expect(s).not.toMatch(/blocked number|reopens|message us first/i)
  })

  it('buildForwardHref builds a digits-only wa.me link encoding START + number', () => {
    const href = buildForwardHref('+91 98765 43210', 'Ravi', '+14155238886')
    expect(href).not.toBeNull()
    expect(href).toContain('https://wa.me/919876543210?text=')
    const decoded = decodeURIComponent(href as string)
    expect(decoded).toContain('START')
    expect(decoded).toContain('+14155238886')
  })

  it('buildForwardHref returns null when EITHER the engineer number or Quoco number is missing', () => {
    expect(buildForwardHref(null, 'Ravi', '+14155238886')).toBeNull()
    expect(buildForwardHref('+919876543210', 'Ravi', null)).toBeNull()
    expect(buildForwardHref('', 'Ravi', '+14155238886')).toBeNull()
  })
})

describe('reactivate-cta — no-false-unblock static source guard', () => {
  // messaging_blocked is engineer consent-state, never PM-clearable (bot-flows.md
  // BOT-27). Guard that the CTA component holds NO write surface — it can only ever
  // instruct, never flip the flag. Asserting on source (not behaviour) is the
  // honest check without a render harness.
  const raw = readFileSync(
    join(process.cwd(), 'app/(dashboard)/daily-logs/reactivate-cta.tsx'),
    'utf8',
  )
  // Scan CODE, not prose: a comment documenting "no supabase client" must not
  // trip the guard. Strip block + line comments (the `:` lookbehind spares
  // `https://` URLs) before asserting.
  const src = raw
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/([^:]|^)\/\/.*$/gm, '$1')

  const forbidden = ["'use server'", 'supabase', 'createClient', '.update(', '.from(', 'fetch(']
  for (const token of forbidden) {
    it(`contains no mutation surface: ${token}`, () => {
      expect(src).not.toContain(token)
    })
  }
})
