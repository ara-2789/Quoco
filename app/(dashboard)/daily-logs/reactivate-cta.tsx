'use client'

import { useState } from 'react'
import { buildReconnectInstruction, buildForwardHref } from '@/lib/daily-logs/reactivate-copy'

// DASH-03 / BOT-27 2b — PM-facing INSTRUCTIONAL CTA for a messaging_blocked
// engineer. Native <details> disclosure (no shadcn — this isn't the
// dialog/dropdown/combobox class that warrants it, per CLAUDE.md §3).
//
// NO-FALSE-UNBLOCK INVARIANT: this component NEVER mutates the block flag. The
// flag is engineer consent-state, cleared only by the engineer texting START
// (bot-flows.md BOT-27) — a PM cannot un-opt-out on their behalf. So there is
// deliberately no supabase client, no server action, no fetch here: only
// instructional copy + a copy-to-clipboard + a wa.me forward link. A static
// source guard (test/unit/reactivate-copy.test.ts) enforces that this file holds
// no write surface.

export function ReactivateCta({
  engineerName,
  engineerWhatsappNumber,
  quocoNumber,
}: {
  engineerName: string
  engineerWhatsappNumber: string | null
  /** Formatted Quoco number, or null when TWILIO_WHATSAPP_NUMBER is unset (degraded). */
  quocoNumber: string | null
}) {
  const [copied, setCopied] = useState(false)
  const instruction = buildReconnectInstruction(engineerName, quocoNumber)
  const forwardHref = buildForwardHref(engineerWhatsappNumber, engineerName, quocoNumber)

  async function copyNumber() {
    if (!quocoNumber) return
    try {
      await navigator.clipboard.writeText(quocoNumber)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (permissions / insecure context) — non-fatal; the
      // number is still visible in the instruction text to copy by hand.
    }
  }

  return (
    <details className="mt-2 text-xs">
      <summary className="cursor-pointer text-gray-500 hover:text-gray-700">How to reactivate</summary>
      <div className="mt-2 space-y-2 rounded-md bg-gray-50 p-2.5 text-gray-600">
        <p>{instruction}</p>
        <div className="flex flex-wrap items-center gap-2">
          {quocoNumber && (
            <button
              type="button"
              onClick={copyNumber}
              className="rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100"
            >
              {copied ? 'Copied' : `Copy ${quocoNumber}`}
            </button>
          )}
          {forwardHref && (
            <a
              href={forwardHref}
              target="_blank"
              rel="noopener noreferrer"
              className="rounded border border-gray-300 bg-white px-2 py-1 font-medium text-gray-700 hover:bg-gray-100"
            >
              Forward to {engineerName}
            </a>
          )}
        </div>
      </div>
    </details>
  )
}
