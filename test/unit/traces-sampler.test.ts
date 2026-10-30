import { describe, it, expect } from 'vitest'

// S1 (Sentry outgoing-URL scrub), plan section B / J6: the tick sampler. Quota control only,
// not a privacy control. At sample time Sentry hands the sampler its INFERRED name
// ("GET /api/jobs/tick", built from http.target) and the raw attributes, before Next's
// updateName; a strict name-AND-path match fails toward 1 (more data), never toward dropping
// another route.
//
// CONTROL: SAMPLER_CONTROL=const1 swaps the sampler for () => 1; the MATCH rows must FAIL.

type Ctx = Parameters<typeof import('@/lib/observability/traces-sampler').tracesSampler>[0]

interface CtxSpec {
  name?: string
  attributes?: Record<string, unknown>
  parentSampled?: boolean
  parentSampleRate?: number
  normalizedRequest?: { url?: string }
}

// inheritOrSampleWith is transcribed from @sentry/core/build/cjs/tracing/sampling.js:17-25
// (parentSampleRate if numeric, else Number(parentSampled) if boolean, else the fallback).
function ctx(spec: CtxSpec): Ctx {
  const base = { name: 'GET /api/jobs/tick', attributes: { 'http.target': '/api/jobs/tick' }, ...spec }
  const inheritOrSampleWith = (fallback: number): number => {
    if (typeof base.parentSampleRate === 'number') return base.parentSampleRate
    if (typeof base.parentSampled === 'boolean') return Number(base.parentSampled)
    return fallback
  }
  return { ...base, inheritOrSampleWith } as unknown as Ctx
}

async function sample(spec: CtxSpec): Promise<number | boolean> {
  const { tracesSampler } = await import('@/lib/observability/traces-sampler')
  const fn = process.env.SAMPLER_CONTROL === 'const1' ? () => 1 : tracesSampler
  return fn(ctx(spec))
}

describe('tracesSampler: the tick is sampled at 0.02, everything else at 1', () => {
  it('MATCH: name "GET /api/jobs/tick" + path from http.target -> 0.02', async () => {
    expect(await sample({})).toBe(0.02)
  })
  it('MATCH: a query on http.target is stripped before comparing', async () => {
    expect(await sample({ attributes: { 'http.target': '/api/jobs/tick?x=1' } })).toBe(0.02)
    expect(await sample({ attributes: { 'http.target': '/api/jobs/tick#f' } })).toBe(0.02)
  })
  it('MATCH: path from http.route, url.path or normalizedRequest.url when http.target is absent', async () => {
    expect(await sample({ attributes: { 'http.route': '/api/jobs/tick' } })).toBe(0.02)
    expect(await sample({ attributes: { 'url.path': '/api/jobs/tick' } })).toBe(0.02)
    expect(await sample({ attributes: {}, normalizedRequest: { url: 'https://app.example.test/api/jobs/tick?x=1' } })).toBe(0.02)
  })

  const noMatch: [string, CtxSpec][] = [
    ['same name, path /api/jobs/other', { attributes: { 'http.target': '/api/jobs/other' } }],
    ['POST /api/jobs/tick', { name: 'POST /api/jobs/tick' }],
    ['GET /api/jobs/tick/extra (name)', { name: 'GET /api/jobs/tick/extra', attributes: { 'http.target': '/api/jobs/tick/extra' } }],
    ['GET /api/jobs/ticker', { name: 'GET /api/jobs/ticker', attributes: { 'http.target': '/api/jobs/ticker' } }],
    ['GET /api/cron/dpr-generate', { name: 'GET /api/cron/dpr-generate', attributes: { 'http.target': '/api/cron/dpr-generate' } }],
    ['correct name but NO path attribute at all (strict AND fails toward 1)', { attributes: {} }],
    ['correct path but another name', { name: 'GET /something' }],
    ['name differs only by case', { name: 'get /api/jobs/tick' }],
  ]
  it.each(noMatch)('NO-MATCH -> 1: %s', async (_label, spec) => {
    expect(await sample(spec)).toBe(1)
  })

  describe('inheritOrSampleWith: an inherited decision is honoured with its real rate (N2)', () => {
    it('tick: parentSampleRate 0.5 -> 0.5; parentSampled true -> 1; parentSampled false -> 0', async () => {
      expect(await sample({ parentSampleRate: 0.5 })).toBe(0.5)
      expect(await sample({ parentSampled: true })).toBe(1)
      expect(await sample({ parentSampled: false })).toBe(0)
    })
    it('other route: the same three rows', async () => {
      const other = { name: 'GET /api/other', attributes: { 'http.target': '/api/other' } }
      expect(await sample({ ...other, parentSampleRate: 0.5 })).toBe(0.5)
      expect(await sample({ ...other, parentSampled: true })).toBe(1)
      expect(await sample({ ...other, parentSampled: false })).toBe(0)
    })
    it('no parent, other route -> 1', async () => {
      expect(await sample({ name: 'GET /api/other', attributes: { 'http.target': '/api/other' } })).toBe(1)
    })
  })
})
