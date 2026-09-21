// Add-engineer slice 1, PR A (A4), T46(i). Pure.
// Confirm -> apply is a SET check, not a count (plan section 5.2, round-2 S3).
import { describe, expect, it } from 'vitest'
import { parseCarriedField, sameConfirmedSet } from '@/lib/engineers/confirm-set'
import { boundaryDerivedNumber } from './helpers/boundary-phone'

const A = boundaryDerivedNumber(1)
const B = boundaryDerivedNumber(2)
const C = boundaryDerivedNumber(3)

describe('T46(i) sameConfirmedSet', () => {
  it('[A,B] equals [B,A] (order does not matter)', () => {
    expect(sameConfirmedSet([A, B], [B, A])).toBe(true)
  })

  it('[A,B] equals [A,B]', () => {
    expect(sameConfirmedSet([A, B], [A, B])).toBe(true)
  })

  it('[A,B] vs [A,C] -- same count, one number swapped -- is a MISMATCH', () => {
    expect(sameConfirmedSet([A, B], [A, C])).toBe(false)
  })

  it('[A,B] vs [A] and [A,B,C] are mismatches', () => {
    expect(sameConfirmedSet([A, B], [A])).toBe(false)
    expect(sameConfirmedSet([A, B], [A, B, C])).toBe(false)
  })

  it('a one-digit change is a mismatch', () => {
    const almostA = A.slice(0, -1) + String((Number(A.slice(-1)) + 1) % 10)
    expect(sameConfirmedSet([A, B], [almostA, B])).toBe(false)
  })

  it('two empty lists are equal; empty vs non-empty is not', () => {
    expect(sameConfirmedSet([], [])).toBe(true)
    expect(sameConfirmedSet([], [A])).toBe(false)
  })

  it('a repeated element is not a set match for a distinct one', () => {
    expect(sameConfirmedSet([A, A], [A, B])).toBe(false)
  })

  it('does not mutate its arguments', () => {
    const carried = [B, A]
    const reparsed = [A, B]
    sameConfirmedSet(carried, reparsed)
    expect(carried).toEqual([B, A])
    expect(reparsed).toEqual([A, B])
  })
})

describe('parseCarriedField (hidden-field hand validation)', () => {
  it('parses a JSON array of strings', () => {
    expect(parseCarriedField(JSON.stringify([A, B]))).toEqual([A, B])
  })

  it('accepts an empty array', () => {
    expect(parseCarriedField('[]')).toEqual([])
  })

  it.each([
    ['null (field absent)', null],
    ['not JSON', 'not json'],
    ['a JSON object', '{"a":1}'],
    ['an array holding a non-string', JSON.stringify([A, 5])],
    ['an array holding an over-long string', JSON.stringify(['x'.repeat(65)])],
    ['more than 50 entries', JSON.stringify(Array.from({ length: 51 }, () => A))],
    ['a File-like non-string entry', undefined as unknown as string],
  ])('rejects %s', (_label, value) => {
    expect(parseCarriedField(value as FormDataEntryValue | null)).toBeNull()
  })
})
