import type { Breadcrumb, ErrorEvent, Log, NodeOptions } from '@sentry/nextjs'

// @sentry/nextjs does not re-export these two types and @sentry/core is not
// a direct dependency, so they are derived from the hook signatures
// themselves -- they can never drift from what Sentry.init actually passes.
export type TransactionEvent = Parameters<NonNullable<NodeOptions['beforeSendTransaction']>>[0]
export type SpanJSON = Parameters<NonNullable<NodeOptions['beforeSendSpan']>>[0]

// P0 (Sentry PII): every phone number and email address is redacted from
// every string in an outbound Sentry item before it leaves the process.
// Wired as beforeSend / beforeBreadcrumb / beforeSendTransaction /
// beforeSendSpan / beforeSendLog in all three runtimes (server, edge,
// client). This is the backstop behind the call-site fixes: it also covers
// provider error text and thrown messages that embed a number, which no
// call-site change can reach.
//
// FAILURE RULE: a normal item is never dropped. If the scrubber throws:
//   - error events:  a minimal event { message: 'pii-scrubber-failed',
//                    level: 'error', event_id } and nothing else;
//   - transactions:  dropped (null);
//   - breadcrumbs:   { message: 'pii-scrubber-failed', level: 'error', timestamp };
//   - spans, logs:   returned with every free-text string replaced by
//                    'pii-scrubber-failed'.
//
// Pure TypeScript, no Node APIs -- it runs in the edge and browser bundles.

export const REDACTED_PHONE = '[redacted-phone]'
export const REDACTED_EMAIL = '[redacted-email]'
export const SCRUBBER_FAILED = 'pii-scrubber-failed'

// Order matters: email first (its local part can be all digits), then the
// prefixed forms, then E.164, then the bare Indian mobile.
const EMAIL = /[A-Za-z0-9._+-]+(?:@|%40)[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

// whatsapp:+<digits>, whatsapp:<digits>, and the URL-encoded colon/plus.
const WHATSAPP = /whatsapp(?::|%3[Aa])\s*(?:\+|%2[Bb])?\d(?:[ -]?\d){5,14}/gi

// + (or URL-encoded %2B) then 10 to 15 digits, one optional space or hyphen
// between any two digits. Not preceded by a word character, so
// "abc+9198..." and Twilio SIDs (letters + hex) are never touched.
const E164 = /(?<!\w)(?:\+|%2[Bb])\d(?:[ -]?\d){9,14}(?!\d)/g

// A whole 10-digit token starting 6-9, optionally with the 91 country code
// and no plus. Not adjacent to a word character, and not part of a decimal
// amount (70446.00 style) on either side.
const BARE_INDIAN_MOBILE = /(?<![\w.+%-])(?:91)?[6-9]\d{9}(?!\w|\.\d)/g

export function scrubString(input: string): string {
  return input
    .replace(EMAIL, REDACTED_EMAIL)
    .replace(WHATSAPP, REDACTED_PHONE)
    .replace(E164, REDACTED_PHONE)
    .replace(BARE_INDIAN_MOBILE, REDACTED_PHONE)
}

const MAX_DEPTH = 32

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === 'string') return scrubString(value)
  // Sentry's ParameterizedString can arrive as a String object.
  if (value instanceof String) return scrubString(value.toString())
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH || seen.has(value)) return value
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1, seen))
  }

  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    // Date, Map, Buffer, class instances: left alone. Sentry normalises
    // event payloads to plain JSON before the before* hooks run.
    return value
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[scrubString(key)] = scrubValue(item, depth + 1, seen)
  }
  return out
}

function deepScrub<T>(item: T): T {
  return scrubValue(item, 0, new WeakSet()) as T
}

/** Replace every string leaf, whatever it holds. The crash-path fallback. */
function blankStrings(value: unknown, depth: number): unknown {
  if (typeof value === 'string' || value instanceof String) return SCRUBBER_FAILED
  if (value === null || typeof value !== 'object' || depth >= MAX_DEPTH) return value
  if (Array.isArray(value)) return value.map((v) => blankStrings(v, depth + 1))
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) return value
  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    out[key] = blankStrings(item, depth + 1)
  }
  return out
}

function minimalEvent<T extends ErrorEvent | TransactionEvent>(event: T): T {
  return { message: SCRUBBER_FAILED, level: 'error', event_id: event?.event_id } as unknown as T
}

export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  try {
    return deepScrub(event)
  } catch {
    return minimalEvent(event)
  }
}

// A transaction that cannot be scrubbed is DROPPED (null), not replaced:
// a minimal error-type event returned from beforeSendTransaction would be
// shipped as an error event, which is not a transaction. This is the one
// hook where null is the failure result; a normal transaction is never null.
export function scrubTransactionEvent(event: TransactionEvent): TransactionEvent | null {
  try {
    return deepScrub(event)
  } catch {
    return null
  }
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  try {
    return deepScrub(breadcrumb)
  } catch {
    return { message: SCRUBBER_FAILED, level: 'error', timestamp: breadcrumb?.timestamp }
  }
}

export function scrubSpan(span: SpanJSON): SpanJSON {
  try {
    return deepScrub(span)
  } catch {
    // Ids, timestamps and status keep their values so the trace stays
    // intact; only the free-text fields are blanked.
    try {
      return {
        ...span,
        ...(span.description !== undefined ? { description: SCRUBBER_FAILED } : {}),
        data: blankStrings(span.data, 0) as SpanJSON['data'],
      }
    } catch {
      return {
        span_id: span.span_id,
        trace_id: span.trace_id,
        start_timestamp: span.start_timestamp,
        description: SCRUBBER_FAILED,
        data: {},
      }
    }
  }
}

export function scrubLog(log: Log): Log {
  try {
    return deepScrub(log)
  } catch {
    try {
      return {
        ...log,
        message: SCRUBBER_FAILED,
        ...(log.attributes !== undefined ? { attributes: blankStrings(log.attributes, 0) as Log['attributes'] } : {}),
      } as Log
    } catch {
      return { level: log.level, message: SCRUBBER_FAILED, attributes: {} } as Log
    }
  }
}
