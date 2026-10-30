import { leakFindings } from '../unit/capture-ingest-support'
import { isRecord, type ParsedEnvelope } from './sentry-envelope-capture'

// S1 (Sentry outgoing-URL scrub): the S1-local half of the leak scanner.
//
// The C5 scanner (`leakFindings`, test/unit/capture-ingest-support.ts, imported unedited)
// flags ANY http(s) URL as a leak, so it cannot be the GREEN criterion here: the intended
// output of the scrub IS a URL, reduced to scheme://hostname. This file composes
//   findings = leakFindings(value, S1_LITERALS) minus its 'url' finding   (phone, SID,
//              token and caller literals are kept)
//            + urlFindings(value)                                         (anything
//              beyond scheme://hostname)
// and walks parsed Sentry envelopes with per-location labels so a failure says where the
// leak is.
//
// Placeholders are deliberately NOT shaped like real Twilio SIDs (no AC + 32 hex) and are
// passed as `literals` because leakFindings' SID regex would not catch them.

export const S1_LITERALS: string[] = [
  'S1CANARY_PATH',
  'S1CANARY_QUERY',
  'ACxxxxS1TEST',
  'MMxxxxS1TEST',
  'MExxxxS1TEST',
  'S1-TENANT-0000',
  'S1-PROJECT-0000',
  'S1-DOCUMENT-0000',
  'S1-FILE-0000',
  'S1-PHONE-PLACEHOLDER',
  '00000000-0000-4000-8000-000000000001',
]

const URL_IN_TEXT = /https?:\/\/[^\s"'<>\\]+/gi

/** Rules broken by URLs in `value`. scheme://hostname (no port, userinfo, path, query, fragment) is allowed. */
export function urlFindings(value: unknown): string[] {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  const found = new Set<string>()
  for (const match of text.matchAll(URL_IN_TEXT)) {
    let u: URL
    try {
      u = new URL(match[0])
    } catch {
      found.add('url-unparseable')
      continue
    }
    if (u.username || u.password) found.add('url-userinfo')
    if (u.port) found.add('url-port')
    if (u.search) found.add('url-query')
    if (u.hash) found.add('url-fragment')
    if (u.pathname !== '/' && u.pathname !== '') found.add('url-path')
  }
  return [...found]
}

/** leakFindings minus its blanket 'url' finding, plus urlFindings. */
export function composedFindings(value: unknown, literals: string[] = S1_LITERALS): string[] {
  return [...leakFindings(value, literals).filter((f) => f !== 'url'), ...urlFindings(value)]
}

export interface Finding {
  location: string
  rule: string
}

const TIER1_KEYS = ['url.query', 'http.query', 'url.fragment', 'http.fragment']
const TIER2_KEYS = ['url.path', 'http.target', 'url.template']

function looksOutgoing(owner: Record<string, unknown>): boolean {
  const { op, category, type } = owner
  return (
    (typeof op === 'string' && (op === 'http.client' || op.startsWith('http.client.'))) ||
    category === 'http' ||
    category === 'fetch' ||
    category === 'xhr' ||
    type === 'http'
  )
}

function walk(path: string, value: unknown, owner: Record<string, unknown> | null, out: Finding[]): void {
  if (typeof value === 'string') {
    for (const rule of composedFindings(value)) out.push({ location: path, rule })
    return
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(`${path}[${i}]`, v, owner, out))
    return
  }
  if (!isRecord(value)) return
  for (const [key, item] of Object.entries(value)) {
    for (const rule of composedFindings(key)) out.push({ location: `${path}.<key ${key}>`, rule })
    if (key === 'data' && isRecord(item)) {
      const outgoing = looksOutgoing(value)
      for (const k of TIER1_KEYS) if (k in item) out.push({ location: `${path}.data.${k}`, rule: 'tier1-key-present' })
      const target = item['http.target']
      if (typeof target === 'string' && /[?#]/.test(target)) out.push({ location: `${path}.data.http.target`, rule: 'target-has-query' })
      if (outgoing) for (const k of TIER2_KEYS) if (k in item) out.push({ location: `${path}.data.${k}`, rule: 'tier2-key-present' })
    }
    walk(`${path}.${key}`, item, value, out)
  }
}

/** The envelope header's dsn is a URL with userinfo and a path by design; it is not scanned. */
function withoutDsn(raw: string): string {
  return raw.replace(/"dsn":"[^"]*"/g, '')
}

/** Per-location findings over every item of every envelope, then a raw-text pass over what was not enumerated. */
export function scanEnvelopes(envelopes: ParsedEnvelope[]): Finding[] {
  const out: Finding[] = []
  envelopes.forEach((env, ei) => {
    env.items.forEach((item, ii) => walk(`envelope[${ei}].${item.type}[${ii}]`, item.payload, null, out))
    for (const rule of composedFindings(withoutDsn(env.raw))) out.push({ location: `envelope[${ei}].<raw text>`, rule })
  })
  return out
}

/** Distinct location classes (array indices collapsed) with the rules broken there, so a failure names each leaking field once. */
export function describeFindings(findings: Finding[]): string {
  const unique = new Set<string>()
  for (const f of findings) unique.add(`${f.location.replace(/\[\d+\]/g, '[]')} :: ${f.rule}`)
  return [...unique].sort().slice(0, 120).join('\n')
}
