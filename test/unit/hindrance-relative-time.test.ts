import { describe, it, expect } from 'vitest'
import { formatHindranceAge } from '@/lib/hindrance/relative-time'

describe('formatHindranceAge', () => {
  const now = new Date('2026-09-20T12:00:00Z')

  it('under a minute -> "just now"', () => {
    const createdAt = new Date('2026-09-20T11:59:30Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('just now')
  })

  it('singular minute', () => {
    const createdAt = new Date('2026-09-20T11:59:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('1 minute ago')
  })

  it('plural minutes', () => {
    const createdAt = new Date('2026-09-20T11:45:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('15 minutes ago')
  })

  it('just under an hour stays in minutes', () => {
    const createdAt = new Date('2026-09-20T11:01:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('59 minutes ago')
  })

  it('exactly one hour rolls over to hours', () => {
    const createdAt = new Date('2026-09-20T11:00:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('1 hour ago')
  })

  it('plural hours, matches the spec example ("4 hours ago")', () => {
    const createdAt = new Date('2026-09-20T08:00:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('4 hours ago')
  })

  it('just under a day stays in hours', () => {
    const createdAt = new Date('2026-09-19T13:00:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('23 hours ago')
  })

  it('exactly one day rolls over to days', () => {
    const createdAt = new Date('2026-09-19T12:00:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('1 day ago')
  })

  it('plural days, matches the spec example ("2 days ago")', () => {
    const createdAt = new Date('2026-09-18T12:00:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('2 days ago')
  })

  it('a future/clock-skewed instant never goes negative', () => {
    const createdAt = new Date('2026-09-20T12:05:00Z').toISOString()
    expect(formatHindranceAge(createdAt, now)).toBe('just now')
  })
})
