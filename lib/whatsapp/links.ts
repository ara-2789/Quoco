// Tiny, pure link builders for contacting an engineer — the ONE place this
// codebase strips/preserves number formatting for wa.me vs tel: links.
// wa.me wants digits only (no leading +); tel: keeps the +. Two independent
// ad-hoc implementations of "clean this number" is exactly the drift this
// file exists to prevent — a PM's WhatsApp button and his Call button must
// resolve to the SAME underlying number, never two separately-massaged
// strings that quietly diverge.
//
// SILENT-FAILURE DEPENDENCY (same shape as lib/daily-logs/reactivate-copy.ts's
// own buildForwardHref): this trusts the input to already be E.164-normalised
// (enforced at the write paths, NFR-15). Neither function validates —
// they only format. A non-normalised number produces a wrong-but-well-formed
// link with no visible error.

/** wa.me deep link — digits only, no leading +. Nullable in, nullable out
 *  (the caller hides the button rather than render a dead link). */
export function waMeHref(e164: string | null): string | null {
  if (!e164) return null
  const digits = e164.replace(/\D/g, '')
  if (!digits) return null
  return `https://wa.me/${digits}`
}

/** tel: link — the + preserved, everything else (stray spaces, etc.) that
 *  some dialers reject stripped. Nullable in, nullable out. */
export function telHref(e164: string | null): string | null {
  if (!e164) return null
  const cleaned = e164.replace(/[^\d+]/g, '')
  if (!cleaned || cleaned === '+') return null
  return `tel:${cleaned}`
}
