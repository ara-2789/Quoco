import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { testClient, TEST_TENANT_ID, TEST_PROJECT_ID, testEngineerId, ensureMorningFixtures, removeMorningFixtures } from './helpers/db'

// Migration 046 (docs/reviews/046_hindrances_report_date.sql / supabase/
// migrations/046_hindrances_report_date.sql): hindrances.report_date, a
// GENERATED STORED column computing the IST calendar date of created_at.
// Schema-only column -- no application code reads it yet (stage 4 is
// unbuilt) -- so this asserts the generated expression directly against
// real test-db rows, the same seed-and-select pattern test/hindrance-
// media-ingest.test.ts already uses for daily_log_photos/hindrance_photos'
// own generated expires_at column.

async function seedHindrance(createdAt: string | null): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('hindrances')
    .insert({
      tenant_id: TEST_TENANT_ID,
      project_id: TEST_PROJECT_ID,
      reported_by: testEngineerId(),
      description: 'ZZ hindrances-report-date test row',
      submitted_via: 'web_app',
      created_at: createdAt,
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrance failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function cleanupHindrance(hindranceId: string) {
  const db = testClient()
  const { error } = await db.from('hindrances').delete().eq('id', hindranceId)
  if (error) {
    throw new Error(`cleanupHindrance failed for hindrance ${hindranceId}: ${error.message}`)
  }
}

beforeAll(async () => {
  await ensureMorningFixtures()
})

afterAll(async () => {
  await removeMorningFixtures()
})

describe('hindrances.report_date — generated IST calendar date', () => {
  it('computes the IST calendar date, not the UTC one, across the midnight boundary', async () => {
    // 2026-09-15 18:31:00 UTC = 2026-09-16 00:01:00 IST (UTC+5:30) --
    // one minute past IST midnight, still 2026-09-15 in UTC.
    const hindranceId = await seedHindrance('2026-09-15T18:31:00+00:00')
    try {
      const db = testClient()
      const { data, error } = await db
        .from('hindrances')
        .select('created_at, report_date')
        .eq('id', hindranceId)
        .single<{ created_at: string; report_date: string }>()
      if (error || !data) throw new Error(`select failed: ${error?.message ?? 'no row'}`)

      expect(data.created_at.startsWith('2026-09-15')).toBe(true)
      expect(data.report_date).toBe('2026-09-16')
    } finally {
      await cleanupHindrance(hindranceId)
    }
  })

  it('is NULL when created_at is explicitly NULL', async () => {
    const hindranceId = await seedHindrance(null)
    try {
      const db = testClient()
      const { data, error } = await db
        .from('hindrances')
        .select('created_at, report_date')
        .eq('id', hindranceId)
        .single<{ created_at: string | null; report_date: string | null }>()
      if (error || !data) throw new Error(`select failed: ${error?.message ?? 'no row'}`)

      expect(data.created_at).toBeNull()
      expect(data.report_date).toBeNull()
    } finally {
      await cleanupHindrance(hindranceId)
    }
  })
})
