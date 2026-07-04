/**
 * Normalise a phone number to E.164 format for consistent storage and
 * lookup (NFR-15). Handles the input shapes we expect to see:
 *   - Twilio inbound: "whatsapp:+919876543210"
 *   - Dashboard input: "98765 43210", "+91-98765-43210", "09876543210"
 * Assumes India (+91) as the default country code when none is given,
 * since Quoco is India-only for Phase 1.
 */
export function normalisePhoneNumber(raw: string): string {
  let cleaned = raw.trim()

  // Strip Twilio's "whatsapp:" prefix if present.
  if (cleaned.startsWith('whatsapp:')) {
    cleaned = cleaned.slice('whatsapp:'.length)
  }

  // Remove all whitespace, hyphens, and parentheses.
  cleaned = cleaned.replace(/[\s\-()]/g, '')

  // Already has a country code with +.
  if (cleaned.startsWith('+')) {
    return cleaned
  }

  // Indian numbers sometimes come with a leading 0 (STD-style) or as a
  // bare 10-digit number. Normalise both to +91.
  if (cleaned.startsWith('0') && cleaned.length === 11) {
    cleaned = cleaned.slice(1)
  }

  if (cleaned.length === 10) {
    return `+91${cleaned}`
  }

  // If it's a 12-digit number already starting with 91 (no +), add the +.
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`
  }

  // Fallback: return as-is with a + prefix if it looks numeric but doesn't
  // match a known pattern. Caller should validate downstream if needed.
  return cleaned.startsWith('+') ? cleaned : `+${cleaned}`
}