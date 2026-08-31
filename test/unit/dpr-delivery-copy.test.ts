import { describe, it, expect } from 'vitest'
import { deriveDprDeliveryCopy, type DprDeliveryResult } from '@/lib/daily-logs/dpr-delivery-note'

const NOT_GENERATED = "The report for this day hasn't been generated yet. This correction will be included."

function row(overrides: Partial<{
  content: string | null
  generation_status: string
  delivery_status: string
  delivered_owner_at: string | null
}>): DprDeliveryResult {
  return {
    status: 'ok',
    row: {
      content: null,
      generation_status: 'idle',
      delivery_status: 'pending',
      delivered_owner_at: null,
      ...overrides,
    },
  }
}

describe('deriveDprDeliveryCopy', () => {
  it('no dprs row at all -> "hasn\'t been generated yet", correction will be included', () => {
    expect(deriveDprDeliveryCopy({ status: 'no-row' })).toBe(NOT_GENERATED)
  })

  it('read error -> honest "couldn\'t check" line, never defaults to either reassuring bucket', () => {
    const copy = deriveDprDeliveryCopy({ status: 'error' })
    expect(copy).toMatch(/couldn.t check/i)
    expect(copy).not.toBe(NOT_GENERATED)
    expect(copy).not.toMatch(/will be included/)
  })

  it("generation_status idle, no content -> not_generated bucket, same copy as no-row", () => {
    expect(deriveDprDeliveryCopy(row({ generation_status: 'idle', content: null }))).toBe(NOT_GENERATED)
  })

  it('generation_status running, no content -> its OWN copy, distinct from not_generated (FIX A — no inclusion promise during the claim/assemble race)', () => {
    const generating = deriveDprDeliveryCopy(row({ generation_status: 'running', content: null }))
    expect(generating).not.toBe(NOT_GENERATED)
    expect(generating).toMatch(/being generated right now/)
    expect(generating).toMatch(/may not be included/)
  })

  it('content present + delivered_owner_at set -> "was sent to the owner at <time>", correction will NOT change it', () => {
    const copy = deriveDprDeliveryCopy(
      row({ content: 'the report body', delivered_owner_at: '2026-08-29T15:30:00.000Z' }),
    )
    expect(copy).toMatch(/was sent to the owner at/)
    expect(copy).toMatch(/won.t change what they received/)
    expect(copy).not.toMatch(/tonight/i) // FIX 2 — never today/tonight-scoped
  })

  it('content present + delivered_owner_at null -> "already been prepared", not the same as the sent copy', () => {
    const copy = deriveDprDeliveryCopy(row({ content: 'the report body', delivered_owner_at: null }))
    expect(copy).toMatch(/already been prepared/)
    expect(copy).not.toMatch(/was sent to the owner at/)
  })

  it("delivery_status failed -> its own copy, distinct from no_data (not conflated)", () => {
    const failed = deriveDprDeliveryCopy(row({ delivery_status: 'failed', content: null, generation_status: 'idle' }))
    const noData = deriveDprDeliveryCopy(
      row({ delivery_status: 'skipped_no_data', content: null, generation_status: 'idle' }),
    )
    expect(failed).not.toBe(noData)
    expect(failed).toMatch(/did not succeed/)
    expect(failed).toMatch(/delay notice/)
  })

  it('delivery_status skipped_no_data -> one plain "no site data" line', () => {
    const copy = deriveDprDeliveryCopy(
      row({ delivery_status: 'skipped_no_data', content: null, generation_status: 'idle' }),
    )
    expect(copy).toMatch(/no site data/)
  })

  it('none of the branch copies read as promising inclusion except not_generated/generating', () => {
    const sent = deriveDprDeliveryCopy(row({ content: 'x', delivered_owner_at: '2026-08-29T15:30:00.000Z' }))
    const prepared = deriveDprDeliveryCopy(row({ content: 'x', delivered_owner_at: null }))
    const failed = deriveDprDeliveryCopy(row({ delivery_status: 'failed' }))
    const noData = deriveDprDeliveryCopy(row({ delivery_status: 'skipped_no_data' }))
    for (const copy of [sent, prepared, failed, noData]) {
      expect(copy).not.toMatch(/will be included/)
    }
  })
})
