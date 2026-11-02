// T-UX-11 -- keeping the typed email across the /login error redirect
// (docs/plans/login-otp-ux-plan.md, section 14). Pure unit tests with an
// in-memory Storage-like object: no browser, no network, no test-db.
import { describe, expect, it } from 'vitest'
import {
  SAVED_EMAIL_KEY,
  readSavedEmail,
  saveEmail,
  type StorageLike,
} from '@/lib/auth/saved-email'

function memoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data = { ...initial }
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value
    },
  }
}

const throwingStorage: StorageLike = {
  getItem: () => {
    throw new Error('SecurityError: storage blocked')
  },
  setItem: () => {
    throw new Error('QuotaExceededError')
  },
}

describe('T-UX-11: saved email helpers', () => {
  it('save then read returns the TRIMMED email', () => {
    const storage = memoryStorage()
    saveEmail(storage, '  ux-test+tag@example.com  ')
    expect(readSavedEmail(storage)).toBe('ux-test+tag@example.com')
    expect(storage.data[SAVED_EMAIL_KEY]).toBe('ux-test+tag@example.com')
  })

  it('uses exactly one key, and nothing else is written', () => {
    const storage = memoryStorage()
    saveEmail(storage, 'ux-test@example.com')
    expect(Object.keys(storage.data)).toEqual([SAVED_EMAIL_KEY])
  })

  it('a storage whose getItem/setItem THROW: read returns "" and save does not throw', () => {
    expect(() => saveEmail(throwingStorage, 'ux-test@example.com')).not.toThrow()
    expect(readSavedEmail(throwingStorage)).toBe('')
  })

  it('no storage at all (null / undefined): read "" and save does not throw', () => {
    expect(() => saveEmail(null, 'ux-test@example.com')).not.toThrow()
    expect(() => saveEmail(undefined, 'ux-test@example.com')).not.toThrow()
    expect(readSavedEmail(null)).toBe('')
    expect(readSavedEmail(undefined)).toBe('')
  })

  it('read ignores stored values that are empty, have no "@", or are longer than 254 chars', () => {
    const tooLong = `${'a'.repeat(250)}@b.co` // 255 chars, has an '@': isolates the length rule
    expect(tooLong).toHaveLength(255)
    expect(readSavedEmail(memoryStorage({ [SAVED_EMAIL_KEY]: '' }))).toBe('')
    expect(readSavedEmail(memoryStorage({ [SAVED_EMAIL_KEY]: 'nope' }))).toBe('')
    expect(readSavedEmail(memoryStorage({ [SAVED_EMAIL_KEY]: tooLong }))).toBe('')
    expect(readSavedEmail(memoryStorage())).toBe('') // nothing stored
  })

  it('a 254-char value is accepted (the boundary)', () => {
    const atLimit = `${'a'.repeat(249)}@b.co` // 254 chars
    expect(atLimit).toHaveLength(254)
    expect(readSavedEmail(memoryStorage({ [SAVED_EMAIL_KEY]: atLimit }))).toBe(atLimit)
  })

  it('save ignores invalid values and keeps what was there', () => {
    const storage = memoryStorage()
    saveEmail(storage, 'first@example.com')
    saveEmail(storage, '')
    saveEmail(storage, '   ')
    saveEmail(storage, 'nope')
    saveEmail(storage, `${'a'.repeat(250)}@b.co`)
    expect(readSavedEmail(storage)).toBe('first@example.com')
  })
})
