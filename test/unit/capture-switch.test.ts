import { describe, it, expect, afterEach } from 'vitest'
import { CAPTURE_DIGIT_4_LIVE, isCaptureDigit4Live, parseCaptureTestPhones } from '@/lib/whatsapp/capture-switch'

const KEY = 'CAPTURE_DIGIT4_TEST_PHONES'
const A = '+919900000001'
const B = '+919900000002'
const saved = process.env[KEY]

afterEach(() => {
  if (saved === undefined) delete process.env[KEY]
  else process.env[KEY] = saved
})

describe('capture-switch', () => {
  it('the constant is false by default', () => {
    expect(CAPTURE_DIGIT_4_LIVE).toBe(false)
  })
  it('unset -> false', () => {
    delete process.env[KEY]
    expect(isCaptureDigit4Live(A)).toBe(false)
  })
  it('empty or blank -> false', () => {
    process.env[KEY] = ''
    expect(isCaptureDigit4Live(A)).toBe(false)
    process.env[KEY] = '   '
    expect(isCaptureDigit4Live(A)).toBe(false)
  })
  it('AT-DARK-3: one valid phone is live for it and not for another', () => {
    process.env[KEY] = A
    expect(isCaptureDigit4Live(A)).toBe(true)
    expect(isCaptureDigit4Live(B)).toBe(false)
  })
  it('whitespace around entries is tolerated', () => {
    process.env[KEY] = `  ${A} ,\t${B}  `
    expect(isCaptureDigit4Live(A)).toBe(true)
    expect(isCaptureDigit4Live(B)).toBe(true)
  })
  it.each([
    ['no plus', `${A},919900000003`],
    ['too short', `${A},+1234567`],
    ['too long', `${A},+1234567890123456`],
    ['letters', `${A},+9199abc00003`],
    ['empty entry from a stray comma', `${A},,${B}`],
    ['trailing comma', `${A},`],
  ])('one malformed entry (%s) among valid ones -> false for ALL (fail closed)', (_n, raw) => {
    process.env[KEY] = raw
    expect(parseCaptureTestPhones(raw)).toEqual([])
    expect(isCaptureDigit4Live(A)).toBe(false)
    expect(isCaptureDigit4Live(B)).toBe(false)
  })
})
