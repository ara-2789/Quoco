import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PHOTO_BUCKET } from '@/lib/storage/photo-access'
import { getHindrancePhotosByHindranceIds, resolveHindranceCardPmAndPhotos, type HindrancePhotoItem } from '@/lib/hindrance/queue'
import {
  testClient,
  ensureTwoTenantFixtures,
  removeTwoTenantFixtures,
  TEST_TENANT_A_ID,
  TEST_TENANT_B_ID,
  TEST_PROJECT_A_ID,
  TEST_PROJECT_B_ID,
} from './helpers/db'

// Stage 5a, build slice B3 (docs/reviews/stage5a-review-package.md §5/§6
// revision, D3). Real test-db AND real Storage.

let engineerAId: string
let engineerBId: string

beforeAll(async () => {
  const fixtures = await ensureTwoTenantFixtures()
  engineerAId = fixtures.profileAId
  engineerBId = fixtures.profileBId

  const db = testClient()
  const { error: pmErr } = await db.from('project_members').upsert(
    { tenant_id: TEST_TENANT_A_ID, project_id: TEST_PROJECT_A_ID, user_id: engineerAId, role: 'pm' },
    { onConflict: 'project_id,user_id' },
  )
  if (pmErr) throw new Error(`seed pmA membership failed: ${pmErr.message}`)
})

afterAll(async () => {
  const db = testClient()
  if (uploadedPaths.length > 0) await db.storage.from(PHOTO_BUCKET).remove(uploadedPaths)
  await db.from('hindrance_photos').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('hindrance_photos').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await db.from('hindrances').delete().eq('tenant_id', TEST_TENANT_A_ID)
  await db.from('hindrances').delete().eq('tenant_id', TEST_TENANT_B_ID)
  await removeTwoTenantFixtures()
})

const uploadedPaths: string[] = []

async function uploadPhoto(tenantId: string): Promise<string> {
  const db = testClient()
  const objectPath = `${tenantId}/hindrance-queue-photos-test/${randomUUID()}.jpg`
  const { error } = await db.storage.from(PHOTO_BUCKET).upload(objectPath, Buffer.from(new Uint8Array(16).fill(1)), {
    contentType: 'image/jpeg',
  })
  if (error) throw new Error(`uploadPhoto failed: ${error.message}`)
  uploadedPaths.push(objectPath)
  return objectPath
}

async function seedHindrance(tenantId: string, projectId: string, reportedBy: string): Promise<string> {
  const db = testClient()
  const { data, error } = await db
    .from('hindrances')
    .insert({
      tenant_id: tenantId,
      project_id: projectId,
      reported_by: reportedBy,
      description: 'ZZ hindrance-queue-photos test',
      timing: 'active',
      submitted_via: 'whatsapp_adhoc',
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrance failed: ${error?.message ?? 'no row'}`)
  return data.id
}

async function seedHindrancePhoto(hindranceId: string, tenantId: string, receivedAt?: string): Promise<{ id: string; objectPath: string }> {
  const db = testClient()
  const objectPath = await uploadPhoto(tenantId)
  const { data, error } = await db
    .from('hindrance_photos')
    .insert({
      tenant_id: tenantId,
      hindrance_id: hindranceId,
      photo_url: objectPath,
      retention_class: 'hindrance',
      ...(receivedAt ? { received_at: receivedAt } : {}),
    })
    .select('id')
    .single<{ id: string }>()
  if (error || !data) throw new Error(`seedHindrancePhoto failed: ${error?.message ?? 'no row'}`)
  return { id: data.id, objectPath }
}

describe('getHindrancePhotosByHindranceIds', () => {
  it('one batched call groups photos correctly across multiple hindrance ids, ordered by received_at', async () => {
    const hA = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId)
    const hB = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId)
    const baseTime = Date.now()
    const pA1 = await seedHindrancePhoto(hA, TEST_TENANT_A_ID, new Date(baseTime).toISOString())
    const pA2 = await seedHindrancePhoto(hA, TEST_TENANT_A_ID, new Date(baseTime + 1).toISOString())
    const pB1 = await seedHindrancePhoto(hB, TEST_TENANT_A_ID, new Date(baseTime + 2).toISOString())

    const result = await getHindrancePhotosByHindranceIds([hA, hB], TEST_TENANT_A_ID, testClient())
    expect(result.get(hA)?.map((p) => p.id)).toEqual([pA1.id, pA2.id])
    expect(result.get(hB)?.map((p) => p.id)).toEqual([pB1.id])
    expect(result.get(hA)?.every((p) => p.kind === 'hindrance')).toBe(true)
  })

  it('tenant isolation: a tenant-B hindrance id queried under tenant A returns nothing for it', async () => {
    const hB = await seedHindrance(TEST_TENANT_B_ID, TEST_PROJECT_B_ID, engineerBId)
    await seedHindrancePhoto(hB, TEST_TENANT_B_ID)

    const result = await getHindrancePhotosByHindranceIds([hB], TEST_TENANT_A_ID, testClient())
    expect(result.get(hB)).toBeUndefined()
  })

  it('a tombstoned photo (photo_url NULL) is excluded, a valid sibling still returned', async () => {
    const h = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId)
    const tombstoned = await seedHindrancePhoto(h, TEST_TENANT_A_ID)
    const valid = await seedHindrancePhoto(h, TEST_TENANT_A_ID)

    const db = testClient()
    const { error } = await db.from('hindrance_photos').update({ photo_url: null }).eq('id', tombstoned.id)
    if (error) throw new Error(`tombstone update failed: ${error.message}`)

    const result = await getHindrancePhotosByHindranceIds([h], TEST_TENANT_A_ID, db)
    expect(result.get(h)?.map((p) => p.id)).toEqual([valid.id])
  })

  it('empty id list: returns an empty Map with no query', async () => {
    const result = await getHindrancePhotosByHindranceIds([], TEST_TENANT_A_ID, testClient())
    expect(result.size).toBe(0)
  })
})

describe('resolveHindranceCardPmAndPhotos (D3 per-card gate)', () => {
  it('a real card on the viewer\'s own PM project: isPm true, photos from the map', async () => {
    const h = await seedHindrance(TEST_TENANT_A_ID, TEST_PROJECT_A_ID, engineerAId)
    const photo = await seedHindrancePhoto(h, TEST_TENANT_A_ID)
    const map = await getHindrancePhotosByHindranceIds([h], TEST_TENANT_A_ID, testClient())

    const result = await resolveHindranceCardPmAndPhotos(testClient(), engineerAId, { id: h, projectId: TEST_PROJECT_A_ID }, map)
    expect(result.isPm).toBe(true)
    expect(result.photos.map((p) => p.id)).toEqual([photo.id])
  })

  it('unknown #5 (Aravind, 2026-09-17): a SYNTHETIC item for a project the viewer is NOT PM on -> isPm false, photos empty, no DB bypass/row needed for that project', async () => {
    // TEST_PROJECT_B_ID is real (seeded by ensureTwoTenantFixtures), but
    // engineerAId (tenant A's own PM) has no project_members row on it at
    // all -- no hindrance row needs to exist for this project either; the
    // "item" is entirely synthetic, matching the resolved unknown's own
    // wording.
    const syntheticItem = { id: randomUUID(), projectId: TEST_PROJECT_B_ID }
    // A non-empty map is deliberately supplied for this exact id, so a
    // wrong implementation that skipped the PM check would return photos
    // anyway -- proving isPm gates photos, not just that the map was empty.
    const photosMap = new Map<string, HindrancePhotoItem[]>([
      [syntheticItem.id, [{ id: randomUUID(), kind: 'hindrance', expiresAt: '2099-01-01T00:00:00.000Z' }]],
    ])

    const result = await resolveHindranceCardPmAndPhotos(testClient(), engineerAId, syntheticItem, photosMap)
    expect(result.isPm).toBe(false)
    expect(result.photos).toEqual([])
  })
})
