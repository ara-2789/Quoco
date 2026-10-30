import type { Breadcrumb, ErrorEvent, Log, NodeOptions } from '@sentry/nextjs'
import { applyTier1, applyTier2, classifyOutgoing, reduceUrlsInText, type ItemKind, type UrlScrubItem } from './scrub-url'

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
// S1 (outgoing-URL scrub, scrub-url.ts) adds two things on top, both ahead of the phone/email regexes:
//   - the two-tier URL reduction on spans and breadcrumbs (scrubSpan, scrubBreadcrumb,
//     scrubTransactionEvent, and the trace context of error events);
//   - a free-text pass that reduces any http(s):// URL inside a string to scheme://hostname. It is a flag
//     (`urlPass`) carried through the traversal and cleared inside stacktrace, debug_meta, sdk and
//     modules: browser frame filenames / abs_path / debug_meta code_file are https URLs that source-map
//     matching needs. Descent is NOT stopped there -- the phone/email passes still run on a frame's
//     context_line, pre_context and post_context.
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

// The phone and email passes ALWAYS run. The URL pass runs first and only when `urls` is true (the default,
// so every one-argument caller behaves as before plus the URL pass).
export function scrubString(input: string, opts: { urls?: boolean } = {}): string {
  const text = opts.urls === false ? input : reduceUrlsInText(input)
  return text
    .replace(EMAIL, REDACTED_EMAIL)
    .replace(WHATSAPP, REDACTED_PHONE)
    .replace(E164, REDACTED_PHONE)
    .replace(BARE_INDIAN_MOBILE, REDACTED_PHONE)
}

const MAX_DEPTH = 32

// Keys under which the free-text URL pass is OFF (and stays off for the whole subtree).
const URL_PASS_SKIP_KEYS: readonly string[] = ['stacktrace', 'debug_meta', 'sdk', 'modules']

interface Traversal {
  skip: ReadonlySet<string>
  /** Control-only: skip the whole subtree untouched instead of clearing urlPass. A P0 regression BY DESIGN. */
  stopDescent: boolean
}

const DEFAULT_TRAVERSAL: Traversal = { skip: new Set(URL_PASS_SKIP_KEYS), stopDescent: false }

function scrubValue(value: unknown, depth: number, seen: WeakSet<object>, urlPass: boolean, traversal: Traversal): unknown {
  if (typeof value === 'string') return scrubString(value, { urls: urlPass })
  // Sentry's ParameterizedString can arrive as a String object.
  if (value instanceof String) return scrubString(value.toString(), { urls: urlPass })
  if (value === null || typeof value !== 'object') return value
  if (depth >= MAX_DEPTH || seen.has(value)) return value
  seen.add(value)

  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(item, depth + 1, seen, urlPass, traversal))
  }

  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) {
    // Date, Map, Buffer, class instances: left alone. Sentry normalises
    // event payloads to plain JSON before the before* hooks run.
    return value
  }

  const out: Record<string, unknown> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    // The key belongs to THIS object, so it gets this object's flag; the child gets the flag cleared when
    // the key is a skip key. Phone and email in keys are redacted whatever the flag. Two keys that reduce
    // to the same string collide and the later one wins (only keys that contained URLs are affected).
    const childUrlPass = urlPass && !traversal.skip.has(key)
    out[scrubString(key, { urls: urlPass })] =
      traversal.stopDescent && urlPass && !childUrlPass ? item : scrubValue(item, depth + 1, seen, childUrlPass, traversal)
  }
  return out
}

function deepScrub<T>(item: T): T {
  return scrubValue(item, 0, new WeakSet(), true, DEFAULT_TRAVERSAL) as T
}

/**
 * TEST SEAM for the two urlPass controls (test/unit/scrub-url.test.ts). Not used by production code, not
 * imported by any Sentry config, reads no environment variable, and is not reachable from any Sentry
 * option. `skip: []` removes the skip set (the frame filename is then reduced); `stopDescent: true`
 * leaves skipped subtrees completely untouched, which switches OFF phone and email redaction there -- a
 * P0 regression by design, present only so a control can show the positive assertion would catch it.
 */
export function scrubWithTraversal<T>(item: T, traversal: { skip?: readonly string[]; stopDescent?: boolean } = {}): T {
  const resolved: Traversal = {
    skip: new Set(traversal.skip ?? URL_PASS_SKIP_KEYS),
    stopDescent: traversal.stopDescent ?? false,
  }
  return scrubValue(item, 0, new WeakSet(), true, resolved) as T
}

// Tier 1 always; Tier 2 when the ORIGINAL item is an outgoing request by provenance. Classification reads
// the original item (not the Tier 1 output) so provenance never depends on a key Tier 1 touched.
function applyUrlTiers<T extends UrlScrubItem>(item: T, kind: ItemKind): T {
  const outgoing = classifyOutgoing(item, kind)
  const reduced = applyTier1(item)
  return outgoing ? applyTier2(reduced) : reduced
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

// Defence in depth. On a TRANSACTION, contexts.trace carries the root span's attributes, including
// http.target = req.url WITH its query. @sentry 10.63.0 error events carry ids only (their trace context
// comes from spanToTraceContext: trace_id, span_id, parent_span_id, no data), so on an error event this is a
// no-op today. Kept because it is idempotent, fails closed through the existing catch, and guards against an
// SDK change that puts span attributes on an error event's trace context.
function withUrlTiersOnTraceContext<T extends { contexts?: unknown }>(event: T): T {
  const contexts = event.contexts
  if (typeof contexts !== 'object' || contexts === null) return event
  const trace = (contexts as { trace?: unknown }).trace
  if (typeof trace !== 'object' || trace === null) return event
  return { ...event, contexts: { ...contexts, trace: applyUrlTiers(trace as UrlScrubItem, 'span') } } as T
}

export function scrubErrorEvent(event: ErrorEvent): ErrorEvent {
  try {
    return deepScrub(withUrlTiersOnTraceContext(event))
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
    const withTrace = withUrlTiersOnTraceContext(event)
    const spans = Array.isArray(withTrace.spans)
      ? withTrace.spans.map((span) => applyUrlTiers(span as UrlScrubItem, 'span') as unknown as SpanJSON)
      : withTrace.spans
    return deepScrub({ ...withTrace, ...(spans !== undefined ? { spans } : {}) })
  } catch {
    return null
  }
}

export function scrubBreadcrumb(breadcrumb: Breadcrumb): Breadcrumb {
  try {
    return deepScrub(applyUrlTiers(breadcrumb as UrlScrubItem, 'breadcrumb') as unknown as Breadcrumb)
  } catch {
    return { message: SCRUBBER_FAILED, level: 'error', timestamp: breadcrumb?.timestamp }
  }
}

export function scrubSpan(span: SpanJSON): SpanJSON {
  try {
    return deepScrub(applyUrlTiers(span as UrlScrubItem, 'span') as unknown as SpanJSON)
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
