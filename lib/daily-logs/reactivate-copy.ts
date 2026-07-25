// Pure, framework-free copy/link builders for the Daily Logs "How to reactivate"
// CTA (DASH-03 / BOT-27 2b). No React, no I/O — unit-tested directly in the
// repo's pure-test style; the 'use client' reactivate-cta.tsx is a thin
// presentational wrapper over these.
//
// messaging_blocked is ENGINEER consent-state, cleared only by the engineer
// messaging in — never PM-clearable (bot-flows.md BOT-27 canonical definition).
// These builders produce INSTRUCTIONAL copy only; nothing here mutates state.
// The copy says "START" (not "text us") deliberately: it teaches the FUTURE
// keyword-gated resume contract (bot-flows.md B2) so it needn't change when the
// SET stage ships.

/**
 * Strip Twilio's "whatsapp:" prefix from TWILIO_WHATSAPP_NUMBER for display,
 * clipboard, and copy text. The env value is stored as "whatsapp:+14155238886"
 * (CLAUDE.md §8); the human-facing form is the bare E.164 "+14155238886".
 * Returns the trimmed input unchanged if the prefix is absent.
 */
export function formatQuocoNumber(raw: string): string {
  const trimmed = raw.trim()
  return trimmed.startsWith('whatsapp:') ? trimmed.slice('whatsapp:'.length) : trimmed
}

/**
 * PM-facing instruction shown in the disclosure body. Names the engineer and the
 * Quoco number, keeps the WhatsApp-mechanics "why" (appropriate for the PM), and
 * says START. When the number is unavailable (env unset — degraded path) the
 * specific number is omitted but the instruction still says START.
 */
export function buildReconnectInstruction(engineerName: string, quocoNumber: string | null): string {
  const target = quocoNumber
    ? `the Quoco WhatsApp number ${quocoNumber}`
    : 'the Quoco WhatsApp number'
  return `Ask ${engineerName} to text START to ${target} to reconnect. We can't message a blocked number first — WhatsApp only reopens once they text in.`
}

/**
 * Forwardable, first-person message the PM sends TO the engineer, pre-filled into
 * the wa.me deep link. Action-only (no WhatsApp-mechanics "why" — the engineer
 * just needs the action), and still names START + the Quoco number.
 */
export function buildForwardMessage(engineerName: string, quocoNumber: string): string {
  return `Hi ${engineerName}, please text START to ${quocoNumber} on WhatsApp so we can send you your daily check-ins again.`
}

// SILENT-FAILURE DEPENDENCY (NFR-15): this trusts whatsapp_number to be stored
// E.164-normalised (enforced at every write path per NFR-15). A non-normalised
// number here produces a wrong-but-well-formed wa.me link that fails with NO
// visible error — the PM's WhatsApp just opens to the wrong/no contact. There is
// no validation at this layer; the guarantee lives upstream at the write paths.
/**
 * wa.me deep link opening the PM's WhatsApp to the ENGINEER, pre-filled with the
 * forward message. wa.me wants digits only in the path, so the engineer's E.164
 * "+91…" number is reduced to digits. Returns null when EITHER the engineer has
 * no stored number (column is nullable) or the Quoco number is unavailable — the
 * caller hides the "Forward to" link in those cases.
 */
export function buildForwardHref(
  engineerWhatsappNumber: string | null,
  engineerName: string,
  quocoNumber: string | null,
): string | null {
  if (!engineerWhatsappNumber || !quocoNumber) return null
  const digits = engineerWhatsappNumber.replace(/\D/g, '')
  if (!digits) return null
  const text = encodeURIComponent(buildForwardMessage(engineerName, quocoNumber))
  return `https://wa.me/${digits}?text=${text}`
}
