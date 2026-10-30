// S1 (Sentry outgoing-URL scrub): default-deny for URLs on outgoing http breadcrumbs and spans.
//
// P0 (scrub-pii.ts) redacts phone numbers and emails from every string; it has no notion of a
// URL. The URL a fetch/undici/http call puts into a breadcrumb or span still carries the Twilio
// media path (account, message and media SIDs), the PostgREST filters (tenant_id=eq.<uuid>) and the
// storage object path (<tenant>/<project>/<document>/<file>). This module reduces them.
//
// TWO TIERS. Classification is by PROVENANCE, never by "has a URL-ish key": Next stamps
// next.span_name / next.span_type on every span it creates and http.target on the server root, so a
// key-presence rule would rename every server span (review B1).
//   Tier 1, every span and breadcrumb, never renames:
//     delete url.query, http.query, url.fragment, http.fragment; strip query and fragment from
//     http.target; reduce url / url.full / http.url (absolute -> scheme://hostname, relative ->
//     path only, anything else -> [unparseable-url]).
//   Tier 2, outgoing only (op http.client*, a client sentry.origin, otel.kind CLIENT,
//     next.span_type AppRender.fetch, or an http / fetch / xhr breadcrumb):
//     delete url.path, http.target, url.template; a relative url becomes [same-origin]; the span
//     description becomes "<METHOD> <host>" ONLY when both are derivable.
// Method, status, server.address, http.route and next.route are never touched.
//
// The functions are exported separately (classifyOutgoing, applyTier1, applyTier2) and the
// orchestration lives in scrub-pii.ts, so a test can swap the classifier through the real hooks.
//
// Pure TypeScript, no Node APIs -- it runs in the edge and browser bundles. Plan: s1-plan-rev3.md.

export const SAME_ORIGIN = '[same-origin]'
export const UNPARSEABLE_URL = '[unparseable-url]'

type Data = Record<string, unknown>

/** The structural subset of a span (SpanJSON, or an event's contexts.trace) and of a breadcrumb that the tiers read. */
export interface UrlScrubItem {
  op?: string
  origin?: string
  description?: string
  category?: string
  type?: string
  data?: unknown
}

export type ItemKind = 'span' | 'breadcrumb'

const TIER1_DELETE_KEYS = ['url.query', 'http.query', 'url.fragment', 'http.fragment'] as const
const TIER2_DELETE_KEYS = ['url.path', 'http.target', 'url.template'] as const
const URL_VALUE_KEYS = ['url', 'url.full', 'http.url'] as const

// Exact set, from the installed SDKs: auto.http.client (node:http), auto.http.otel.node_fetch (undici),
// auto.http.browser (browser fetch/xhr), auto.http.wintercg_fetch (edge). NOT a prefix on auto.http.browser:
// the web-vitals origins auto.http.browser.lcp|inp|cls|stream are not requests. Server spans
// (auto.http.otel.http, auto.http.server, ...) are not in the set.
const CLIENT_ORIGINS: ReadonlySet<string> = new Set([
  'auto.http.client',
  'auto.http.otel.node_fetch',
  'auto.http.browser',
  'auto.http.wintercg_fetch',
])
const OUTGOING_BREADCRUMB_CATEGORIES: readonly string[] = ['http', 'fetch', 'xhr']

function isRecord(value: unknown): value is Data {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** scheme://hostname of an absolute http(s) URL (userinfo, port, path, query, fragment dropped); null if the value is not one. */
function originOf(value: string): string | null {
  if (!/^https?:\/\//i.test(value)) return null
  try {
    const u = new URL(value)
    return `${u.protocol}//${u.hostname}`
  } catch {
    return null
  }
}

function isRelativePath(value: string): boolean {
  return value.startsWith('/') && !value.startsWith('//')
}

function stripQueryAndFragment(value: string): string {
  return value.split(/[?#]/, 1)[0]
}

function reduceUrlValue(value: string): string {
  if (value === '' || value === SAME_ORIGIN || value === UNPARSEABLE_URL) return value
  const origin = originOf(value)
  if (origin !== null) return origin
  if (isRelativePath(value)) return stripQueryAndFragment(value)
  return UNPARSEABLE_URL
}

/** Is this item an outgoing request, by provenance. `kind` says whether it is a span or a breadcrumb. */
export function classifyOutgoing(item: UrlScrubItem, kind: ItemKind): boolean {
  if (kind === 'breadcrumb') {
    return item.type === 'http' || (typeof item.category === 'string' && OUTGOING_BREADCRUMB_CATEGORIES.includes(item.category))
  }
  const { op } = item
  if (typeof op === 'string' && (op === 'http.client' || op.startsWith('http.client.'))) return true
  const data = isRecord(item.data) ? item.data : {}
  for (const origin of [item.origin, data['sentry.origin']]) {
    if (typeof origin === 'string' && (CLIENT_ORIGINS.has(origin) || origin.startsWith('auto.http.client.'))) return true
  }
  // SpanJSON has no `kind`; node:http client spans record it as an attribute
  if (data['otel.kind'] === 'CLIENT') return true
  // exact match, not a presence check: every Next span carries next.span_type
  return data['next.span_type'] === 'AppRender.fetch'
}

/** Tier 1: applies to every span and breadcrumb; never renames anything. */
export function applyTier1<T extends UrlScrubItem>(item: T): T {
  if (!isRecord(item.data)) return item
  const data: Data = { ...item.data }
  for (const key of TIER1_DELETE_KEYS) delete data[key]
  const target = data['http.target']
  if (typeof target === 'string') data['http.target'] = stripQueryAndFragment(target)
  for (const key of URL_VALUE_KEYS) {
    const value = data[key]
    if (typeof value === 'string') data[key] = reduceUrlValue(value)
  }
  return { ...item, data } as unknown as T
}

function methodOf(data: Data, description: unknown): string | undefined {
  for (const key of ['http.request.method', 'http.method', 'method']) {
    const value = data[key]
    if (typeof value === 'string' && /^[A-Za-z]+$/.test(value)) return value.toUpperCase()
  }
  if (typeof description === 'string') {
    const match = /^(?:fetch )?([A-Z]+)(?:\s|$)/.exec(description)
    if (match) return match[1]
  }
  return undefined
}

/** `host:8443` -> `host`; a bracketed IPv6 literal keeps its brackets and loses the port. */
function stripPort(address: string): string {
  if (address.startsWith('[')) {
    const close = address.indexOf(']')
    return close === -1 ? address : address.slice(0, close + 1)
  }
  return address.replace(/:\d+$/, '')
}

/** Host for the rename, in order: reduced absolute URL value, server.address without port, net.peer.name, url.domain, [same-origin] for a relative url. */
function hostOf(data: Data): string | undefined {
  for (const key of ['url.full', 'http.url', 'url']) {
    const value = data[key]
    if (typeof value === 'string') {
      const origin = originOf(value)
      if (origin !== null) return origin.replace(/^https?:\/\//i, '')
    }
  }
  const address = data['server.address']
  if (typeof address === 'string' && address !== '') return stripPort(address)
  for (const key of ['net.peer.name', 'url.domain']) {
    const value = data[key]
    if (typeof value === 'string' && value !== '') return value
  }
  for (const key of URL_VALUE_KEYS) {
    const value = data[key]
    if (typeof value === 'string' && (isRelativePath(value) || value === SAME_ORIGIN)) return SAME_ORIGIN
  }
  return undefined
}

/** Tier 2: outgoing only. Run after applyTier1. */
export function applyTier2<T extends UrlScrubItem>(item: T): T {
  if (!isRecord(item.data)) return item
  const data: Data = { ...item.data }
  const method = methodOf(data, item.description)
  const host = hostOf(data)
  for (const key of TIER2_DELETE_KEYS) delete data[key]
  for (const key of URL_VALUE_KEYS) {
    const value = data[key]
    if (typeof value === 'string' && isRelativePath(value)) data[key] = SAME_ORIGIN
  }
  let { description } = item
  // rename guard: both a method and a host, or the description is left alone
  if (typeof description === 'string' && method !== undefined && host !== undefined) {
    description = `${method} ${host}`
    if (data['next.span_type'] === 'AppRender.fetch') data['next.span_name'] = description
  }
  return { ...item, data, ...(description !== undefined ? { description } : {}) } as unknown as T
}

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/gi
const TRAILING_PUNCTUATION = /[.,;:!?)\]}]+$/

/**
 * Free-text pass (D1): every http(s) URL inside a string becomes scheme://hostname (an unparseable one
 * becomes [unparseable-url]); trailing sentence punctuation stays outside the match. A string without
 * http:// or https:// is returned as the SAME string, before any replace.
 */
export function reduceUrlsInText(input: string): string {
  if (!/https?:\/\//i.test(input)) return input
  return input.replace(URL_IN_TEXT, (match) => {
    const trailing = TRAILING_PUNCTUATION.exec(match)?.[0] ?? ''
    const core = trailing ? match.slice(0, match.length - trailing.length) : match
    return (originOf(core) ?? UNPARSEABLE_URL) + trailing
  })
}
