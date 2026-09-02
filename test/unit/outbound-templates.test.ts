import { describe, it, expect } from 'vitest'
import {
  selectEveningTemplate,
  buildMorningTemplate,
  MORNING_CHECKIN_SID,
  EVENING_CHECKIN_SID,
} from '@/lib/whatsapp/outbound/templates'

describe('selectEveningTemplate', () => {
  it('builds the evening checkin template with name and project, no {{3}}', () => {
    const sel = selectEveningTemplate('Arjun Nair', 'Emerald Heights')
    expect(sel.contentSid).toBe(EVENING_CHECKIN_SID)
    expect(sel.contentVariables).toEqual({ '1': 'Arjun Nair', '2': 'Emerald Heights' })
    expect(sel.contentVariables['3']).toBeUndefined()
  })
})

describe('buildMorningTemplate', () => {
  it('builds the morning checkin template with name and project', () => {
    const sel = buildMorningTemplate('Arjun Nair', 'Emerald Heights')
    expect(sel.contentSid).toBe(MORNING_CHECKIN_SID)
    expect(sel.contentVariables).toEqual({ '1': 'Arjun Nair', '2': 'Emerald Heights' })
  })
})
