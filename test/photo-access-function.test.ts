import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { getAuthorizedPhotoPath } from '@/lib/storage/photo-access'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_PROJECT_A_ID,
} from './helpers/db'

// Stage 5a (docs/reviews/stage5a-review-package.md, C2/C4). Defensive-
// parsing cases for getAuthorizedPhotoPath (lib/storage/photo-access.ts)
// that have NO RLS equivalent, and therefore cannot live in the shared
// test/photo-access-boundary-agreement.test.ts matrix -- RLS is a
// membership/tenant boundary only, and correctly has no opinion on a row's
// own stored photo_url shape, NULL-ness, or which `kind` segment a caller
// asked for. Forcing these into the "both boundaries must agree" matrix
// would be wrong (RLS really does still show a tombstoned row, or a row
// whose photo_url is malformed, or a real row requested under the wrong
// kind) -- these assertions exist precisely because the two boundaries are
// SUPPOSED to disagree here.
//
// Absorbs the two cases from the now-deleted test/storage-photo-access.
// test.ts that don't fit the boundary-agreement matrix either:
//   - "a malformed object path (wrong segment count) gets null" -> the
//     caller no longer supplies a path (the retired getSignedPhotoUrl
//     took one; getAuthorizedPhotoPath takes a photoId instead), so the
//     malformed input is now a seeded ROW (a row whose own stored
//     photo_url has the wrong shape), not a call argument. Reframed below
//     as the "malformed stored photo_url shape" cases.
//   - "a syntactically valid path pointing at a nonexistent daily_log_id"
//     -- NOT constructible anymore: daily_log_photos.daily_log_id is
//     FK'd NOT NULL to daily_logs(id) (001_core_schema.sql), so a row can
//     never point at a nonexistent daily_log. Its intent (a lookup target
//     that doesn't resolve -> null) is covered instead by
//     test/photo-access-boundary-agreement.test.ts's "nonexistent photo
//     id" case, since lookup is now by photoId, not by path.
//
// Every caller below is the SAME real PM on the SAME real project
// (pmAId / project A), deliberately, so any refusal in this file is
// attributable ONLY to the shape/tombstone/kind check under test -- never
// incidentally to a tenant or membership failure, which is what §5/§7's
// own tables in the build plan call out as the thing this file must
// isolate.

describe('getAuthorizedPhotoPath — defensive parsing (stage 5a, no RLS equivalent)', () => {
  let pmAId: string
  let dailyLogAId: string
  let hindranceAId: string
  let dlNormalPhotoId: string
  let dlMalformedShortPhotoId: string
  let dlMalformedWrongIdPhotoId: string
  let dlTombstonedPhotoId: string
  let hNormalPhotoId: string
  let hMalformedPhotoId: string
  let hTombstonedPhotoId: string

  beforeAll(async () => {
    const db = testClient()
    const fixtures = await ensureTwoTenantFixtures()
    pmAId = fixtures.profileAId

    const { error: pmAErr } = await db.from('project_members').upsert(
      { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: pmAId, role: 'pm' },
      { onConflict: 'project_id,user_id' },
    )
    if (pmAErr) throw new Error(`seed pmA membership failed: ${pmAErr.message}`)

    const { data: log, error: logErr } = await db
      .from('daily_logs')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        engineer_id: pmAId,
        log_date: '2026-09-17',
      })
      .select('id')
      .single<{ id: string }>()
    if (logErr || !log) throw new Error(`seed daily_log failed: ${logErr?.message ?? 'no row'}`)
    dailyLogAId = log.id

    const { data: hindrance, error: hindranceErr } = await db
      .from('hindrances')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        project_id: TEST_PROJECT_A_ID,
        reported_by: pmAId,
        description: 'ZZ function-test hindrance',
        timing: 'active',
        submitted_via: 'whatsapp_adhoc',
      })
      .select('id')
      .single<{ id: string }>()
    if (hindranceErr || !hindrance) throw new Error(`seed hindrance failed: ${hindranceErr?.message ?? 'no row'}`)
    hindranceAId = hindrance.id

    // Normal daily_log_photos row -- correct 3-segment shape, used as the
    // real id for the "wrong kind for a real id" case.
    const { data: dlNormal, error: dlNormalErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: `${TEST_TENANT_A_ID}/${dailyLogAId}/${randomUUID()}.jpg`,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (dlNormalErr || !dlNormal) throw new Error(`seed normal daily_log_photos row failed: ${dlNormalErr?.message ?? 'no row'}`)
    dlNormalPhotoId = dlNormal.id

    // Malformed shape #1: wrong segment COUNT (2, not 3).
    const { data: dlShort, error: dlShortErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: `${TEST_TENANT_A_ID}/${randomUUID()}.jpg`,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (dlShortErr || !dlShort) throw new Error(`seed short-path daily_log_photos row failed: ${dlShortErr?.message ?? 'no row'}`)
    dlMalformedShortPhotoId = dlShort.id

    // Malformed shape #2: right segment count (3), but segment[1] does NOT
    // match this row's own daily_log_id.
    const { data: dlWrongId, error: dlWrongIdErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: `${TEST_TENANT_A_ID}/${randomUUID()}/${randomUUID()}.jpg`,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (dlWrongIdErr || !dlWrongId) {
      throw new Error(`seed wrong-daily-log-id-segment daily_log_photos row failed: ${dlWrongIdErr?.message ?? 'no row'}`)
    }
    dlMalformedWrongIdPhotoId = dlWrongId.id

    // Tombstoned: photo_url IS NULL.
    const { data: dlTombstoned, error: dlTombstonedErr } = await db
      .from('daily_log_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        daily_log_id: dailyLogAId,
        phase: 'morning',
        photo_url: null,
        caption: null,
        retention_class: 'attendance',
      })
      .select('id')
      .single<{ id: string }>()
    if (dlTombstonedErr || !dlTombstoned) {
      throw new Error(`seed tombstoned daily_log_photos row failed: ${dlTombstonedErr?.message ?? 'no row'}`)
    }
    dlTombstonedPhotoId = dlTombstoned.id

    // Normal hindrance_photos row -- correct 4-segment shape, used as the
    // real id for the "wrong kind for a real id" case.
    const { data: hNormal, error: hNormalErr } = await db
      .from('hindrance_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        hindrance_id: hindranceAId,
        photo_url: `${TEST_TENANT_A_ID}/hindrance/${hindranceAId}/${randomUUID()}.jpg`,
        retention_class: 'hindrance',
      })
      .select('id')
      .single<{ id: string }>()
    if (hNormalErr || !hNormal) throw new Error(`seed normal hindrance_photos row failed: ${hNormalErr?.message ?? 'no row'}`)
    hNormalPhotoId = hNormal.id

    // Malformed shape: a daily-log-SHAPED (3-segment) path stored on a
    // hindrance_photos row, which requires 4.
    const { data: hMalformed, error: hMalformedErr } = await db
      .from('hindrance_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        hindrance_id: hindranceAId,
        photo_url: `${TEST_TENANT_A_ID}/${hindranceAId}/${randomUUID()}.jpg`,
        retention_class: 'hindrance',
      })
      .select('id')
      .single<{ id: string }>()
    if (hMalformedErr || !hMalformed) {
      throw new Error(`seed malformed-shape hindrance_photos row failed: ${hMalformedErr?.message ?? 'no row'}`)
    }
    hMalformedPhotoId = hMalformed.id

    // Tombstoned: photo_url IS NULL.
    const { data: hTombstoned, error: hTombstonedErr } = await db
      .from('hindrance_photos')
      .insert({
        tenant_id: TEST_TENANT_A_ID,
        hindrance_id: hindranceAId,
        photo_url: null,
        retention_class: 'hindrance',
      })
      .select('id')
      .single<{ id: string }>()
    if (hTombstonedErr || !hTombstoned) {
      throw new Error(`seed tombstoned hindrance_photos row failed: ${hTombstonedErr?.message ?? 'no row'}`)
    }
    hTombstonedPhotoId = hTombstoned.id
  })

  afterAll(async () => {
    const db = testClient()
    await db.from('daily_log_photos').delete().eq('daily_log_id', dailyLogAId)
    await db.from('hindrance_photos').delete().eq('hindrance_id', hindranceAId)
    await db.from('hindrances').delete().eq('id', hindranceAId)
    await db.from('daily_logs').delete().eq('id', dailyLogAId)
    await db.from('project_members').delete().eq('project_id', TEST_PROJECT_A_ID)
    await removeTwoTenantFixtures()
  })

  const caller = () => ({ id: pmAId, tenant_id: TEST_TENANT_A_ID })

  it('daily_log: a row whose own photo_url has the wrong segment COUNT (2, not 3) refuses', async () => {
    const path = await getAuthorizedPhotoPath('daily_log', dlMalformedShortPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it("daily_log: a row whose own photo_url has 3 segments but segment[1] doesn't match its own daily_log_id refuses", async () => {
    const path = await getAuthorizedPhotoPath('daily_log', dlMalformedWrongIdPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it('daily_log: a tombstoned row (photo_url IS NULL) refuses — RLS would still show this row', async () => {
    const path = await getAuthorizedPhotoPath('daily_log', dlTombstonedPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it('hindrance: a row whose own photo_url is 3-segment (daily-log-shaped), not the required 4, refuses', async () => {
    const path = await getAuthorizedPhotoPath('hindrance', hMalformedPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it('hindrance: a tombstoned row (photo_url IS NULL) refuses — RLS would still show this row', async () => {
    const path = await getAuthorizedPhotoPath('hindrance', hTombstonedPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it('wrong kind for a real id: a real hindrance_photos id requested via kind="daily_log" refuses (no row in that table)', async () => {
    const path = await getAuthorizedPhotoPath('daily_log', hNormalPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it('wrong kind for a real id: a real daily_log_photos id requested via kind="hindrance" refuses (no row in that table)', async () => {
    const path = await getAuthorizedPhotoPath('hindrance', dlNormalPhotoId, caller(), testClient())
    expect(path).toBeNull()
  })

  it('sanity: the real PM does see the normal daily_log_photos row through this same function', async () => {
    const path = await getAuthorizedPhotoPath('daily_log', dlNormalPhotoId, caller(), testClient())
    expect(path).not.toBeNull()
  })

  it('sanity: the real PM does see the normal hindrance_photos row through this same function', async () => {
    const path = await getAuthorizedPhotoPath('hindrance', hNormalPhotoId, caller(), testClient())
    expect(path).not.toBeNull()
  })
})
