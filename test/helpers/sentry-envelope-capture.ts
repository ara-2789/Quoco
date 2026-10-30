import { createServer, type IncomingHttpHeaders, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'

// S1 (Sentry outgoing-URL scrub): test-only plumbing for the real-client envelope test
// (test/unit/sentry-outgoing-url-envelope.test.ts). Two pieces: a local HTTP server that
// records every request it receives (so the test can see which headers a "third party"
// got), and a parser for the envelope bodies the fake Sentry transport captures.
// No network beyond 127.0.0.1, no DB, no env reads.

export interface RecordedRequest {
  method: string
  url: string
  headers: IncomingHttpHeaders
}

export interface RecordingServer {
  origin: string
  requests: RecordedRequest[]
  close(): Promise<void>
}

/** Answers 200 to any path, 403 to a path containing "/forbidden". */
export async function startRecordingServer(): Promise<RecordingServer> {
  const requests: RecordedRequest[] = []
  const server: Server = createServer((req, res) => {
    requests.push({ method: req.method ?? 'GET', url: req.url ?? '/', headers: req.headers })
    const forbidden = (req.url ?? '').includes('/forbidden')
    res.statusCode = forbidden ? 403 : 200
    res.setHeader('content-type', 'text/plain')
    res.end(forbidden ? 'no' : 'ok')
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()))
  const { port } = server.address() as AddressInfo
  return {
    origin: `http://127.0.0.1:${port}`,
    requests,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

export interface EnvelopeItem {
  type: string
  payload: unknown
}

export interface ParsedEnvelope {
  header: Record<string, unknown>
  items: EnvelopeItem[]
  raw: string
}

/** An envelope is newline-delimited JSON: header, then (item header, payload) pairs. */
export function parseEnvelopeBody(body: string): ParsedEnvelope {
  const lines = body.split('\n')
  const header = JSON.parse(lines[0]) as Record<string, unknown>
  const items: EnvelopeItem[] = []
  for (let i = 1; i + 1 < lines.length; i += 2) {
    const itemHeader = JSON.parse(lines[i]) as { type?: unknown }
    let payload: unknown
    try {
      payload = JSON.parse(lines[i + 1])
    } catch {
      payload = lines[i + 1]
    }
    items.push({ type: String(itemHeader.type), payload })
  }
  return { header, items, raw: body }
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** All payloads of one item type across the captured envelopes. */
export function payloadsOfType(envelopes: ParsedEnvelope[], type: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = []
  for (const env of envelopes) {
    for (const item of env.items) {
      if (item.type === type && isRecord(item.payload)) out.push(item.payload)
    }
  }
  return out
}
