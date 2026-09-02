import { describe, it, expect } from 'vitest'
import { equipmentLabel } from '@/lib/whatsapp/flows/parsers/lexicon'
import { buildEquipmentHoursPrompt } from '@/lib/whatsapp/flows/evening'

// equipmentLabel is the render-layer humanizer for the Q5 equipment prompt
// (2026-08-10 — "1) jcb" read like a debug dump on a real handset). Humanize
// is the RULE (split '_', capitalize each word); the override map is for
// acronyms only. Every distinct EQUIPMENT_ALIASES value is asserted here so a
// wrong render is visible in this file, not just inferred from the shape of
// the function.

describe('equipmentLabel', () => {
  it.each([
    ['jcb', 'JCB'],
    ['excavator', 'Excavator'],
    ['backhoe_loader', 'Backhoe Loader'],
    ['concrete_mixer', 'Concrete Mixer'],
    ['crane', 'Crane'],
    ['roller', 'Roller'],
    ['loader', 'Loader'],
    ['generator', 'Generator'],
    ['concrete_pump', 'Concrete Pump'],
    ['vibrator', 'Vibrator'],
    ['tractor', 'Tractor'],
    ['dumper', 'Dumper'],
    ['tipper', 'Tipper'],
    ['lorry', 'Lorry'],
  ])('canonical type %s -> %s', (type, expected) => {
    expect(equipmentLabel(type)).toBe(expected)
  })

  it.each([
    ['hydra', 'Hydra'],
    ['bobcat', 'Bobcat'],
    ['boomlift', 'Boomlift'],
  ])('unmatched raw token %s -> %s (humanize covers it with no override entry)', (type, expected) => {
    expect(equipmentLabel(type)).toBe(expected)
  })

  it('the literal fallback "equipment" -> Equipment', () => {
    expect(equipmentLabel('equipment')).toBe('Equipment')
  })

  it('degenerate input: empty string does not throw', () => {
    expect(() => equipmentLabel('')).not.toThrow()
    expect(equipmentLabel('')).toBe('Equipment')
  })

  it('degenerate input: all-underscore does not throw', () => {
    expect(() => equipmentLabel('_')).not.toThrow()
    expect(equipmentLabel('_')).toBe('Equipment')
  })
})

describe('buildEquipmentHoursPrompt', () => {
  it('renders the full prompt, humanized labels, comma-joined (NO positional numbering — matching is by type string now), pinned against accidental wording edits', () => {
    const prompt = buildEquipmentHoursPrompt([{ type: 'jcb' }, { type: 'concrete_mixer' }])
    expect(prompt).toBe(
      'Equipment you listed this morning: JCB, Concrete Mixer. How many *hours* was each used today? e.g. "JCB 6 hours, mixer 4 hours".',
    )
  })

  it('a single machine renders without a trailing comma', () => {
    const prompt = buildEquipmentHoursPrompt([{ type: 'jcb' }])
    expect(prompt).toBe(
      'Equipment you listed this morning: JCB. How many *hours* was each used today? e.g. "JCB 6 hours, mixer 4 hours".',
    )
  })
})
