import { describe, it, expect } from 'vitest'
import { buildPerCallSchema } from '@/lib/dpr/generate'

// THE ZERO-EQUIPMENT SCHEMA BUG — third attempt, 2026-08-11 (found running
// the first real golden-case batch). Two prior fixes both 400'd:
//   1. enum: [] on morning_item_index — INVALID JSON Schema ("Enum must be
//      a non-empty array").
//   2. maxItems: 0 on the equipment_items array — also rejected ("For
//      'array' type, property 'maxItems' is not supported").
// RESOLVED: delete equipment_items from BOTH properties and required
// entirely. This is the common shape for a small site, not an edge case,
// so it needs its own test, not just the non-empty happy path.

describe('buildPerCallSchema — zero-equipment case', () => {
  it('deletes equipment_items from properties entirely when there are no equipment items', () => {
    const schema = buildPerCallSchema([])
    expect('equipment_items' in schema.properties).toBe(false)
  })

  it('deletes equipment_items from required entirely when there are no equipment items', () => {
    const schema = buildPerCallSchema([])
    expect(schema.required).not.toContain('equipment_items')
  })

  it('does NOT delete equipment_items when there are real equipment items — the enum path, not the deletion path', () => {
    const schema = buildPerCallSchema([0, 1])
    expect('equipment_items' in schema.properties).toBe(true)
    expect(schema.required).toContain('equipment_items')
    const morningItemIndexSchema = schema.properties.equipment_items.items.properties.morning_item_index as { enum?: number[] }
    expect(morningItemIndexSchema.enum).toEqual([0, 1])
  })

  it('single equipment item still uses the enum path, not deletion', () => {
    const schema = buildPerCallSchema([0])
    expect('equipment_items' in schema.properties).toBe(true)
    const morningItemIndexSchema = schema.properties.equipment_items.items.properties.morning_item_index as { enum?: number[] }
    expect(morningItemIndexSchema.enum).toEqual([0])
  })

  it("mutating one call's schema does not affect a later call — deep clone, not a shared reference", () => {
    const first = buildPerCallSchema([0, 1])
    const second = buildPerCallSchema([])
    expect('equipment_items' in first.properties).toBe(true) // unaffected by the second, empty-equipment call
    expect('equipment_items' in second.properties).toBe(false)
  })

  it('the static DPR_JUDGMENT_SCHEMA export is untouched by either path — buildPerCallSchema deep-clones before mutating', () => {
    // Regression guard specifically for the delete() call: deleting a key
    // off a shallow copy (or a copy that shares nested objects) would
    // corrupt the module-level export for every future call, non-empty or
    // not. Calling with [] first, then [0, 1], proves the static schema's
    // own equipment_items survives.
    buildPerCallSchema([])
    const afterward = buildPerCallSchema([0, 1])
    expect('equipment_items' in afterward.properties).toBe(true)
    expect(afterward.required).toContain('equipment_items')
  })
})
