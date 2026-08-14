import { describe, it, expect } from 'vitest'
import { determineReachability } from '@/lib/checkin-escalations/reachability'

describe('determineReachability', () => {
  it('window open when the session was updated less than 24h ago', () => {
    const now = new Date('2026-08-14T12:00:00Z')
    const sessionUpdatedAt = '2026-08-14T00:00:00Z' // 12h ago
    const result = determineReachability(sessionUpdatedAt, now)
    expect(result.windowOpen).toBe(true)
    expect(result.windowClosesAt).toBe('2026-08-15T00:00:00.000Z')
  })

  it('window closed when the session was updated more than 24h ago', () => {
    const now = new Date('2026-08-14T12:00:00Z')
    const sessionUpdatedAt = '2026-08-13T00:00:00Z' // 36h ago
    const result = determineReachability(sessionUpdatedAt, now)
    expect(result.windowOpen).toBe(false)
  })

  it('window closed with no closesAt when no session row exists', () => {
    const now = new Date('2026-08-14T12:00:00Z')
    const result = determineReachability(null, now)
    expect(result.windowOpen).toBe(false)
    expect(result.windowClosesAt).toBeNull()
  })

  it('boundary — exactly 24h ago reads as closed (strict less-than, not less-than-or-equal)', () => {
    const sessionUpdatedAt = '2026-08-13T12:00:00.000Z'
    const now = new Date('2026-08-14T12:00:00.000Z') // exactly 24h later
    const result = determineReachability(sessionUpdatedAt, now)
    expect(result.windowOpen).toBe(false)
  })
})
