import { describe, it, expect } from 'vitest'
import { buildHindrancePmNotifyEmail } from '@/lib/hindrance/pm-notify'

describe('buildHindrancePmNotifyEmail', () => {
  const base = {
    projectName: 'Riverside Tower',
    engineerName: 'Vikram Rao',
    description: 'Cement delivery delayed at the main gate',
    // 10:00 UTC = 15:30 IST, same calendar day either side -- picked
    // deliberately unambiguous for the tests that aren't about the
    // IST-boundary or month-name behaviour themselves (those get their own
    // fixtures below).
    createdAt: '2026-08-13T10:00:00Z',
  }

  it('active timing renders "Blocking work now."', () => {
    const rendered = buildHindrancePmNotifyEmail({ ...base, timing: 'active', timingRaw: null })
    expect(rendered.subject).toBe('Hindrance reported — Riverside Tower — 13 Aug 2026')
    expect(rendered.text).toBe(
      'Vikram Rao reported a hindrance on Riverside Tower: "Cement delivery delayed at the main gate".\n\nBlocking work now.',
    )
    expect(rendered.html).toContain('Blocking work now.')
  })

  it('subject date is the IST calendar day, not the UTC one -- a report filed late evening IST rolls to the next date in UTC', () => {
    // 19:00 UTC = 00:30 IST the FOLLOWING calendar day.
    const rendered = buildHindrancePmNotifyEmail({ ...base, timing: 'active', timingRaw: null, createdAt: '2026-08-13T19:00:00Z' })
    expect(rendered.subject).toBe('Hindrance reported — Riverside Tower — 14 Aug 2026')
  })

  it('subject date renders "Sep", not "Sept" -- the exact ICU en-GB short-month quirk lib/dpr/owner-no-report.ts already found once, checked here independently since this is a separate, deliberately non-shared formatter', () => {
    const rendered = buildHindrancePmNotifyEmail({ ...base, timing: 'active', timingRaw: null, createdAt: '2026-09-07T10:00:00Z' })
    expect(rendered.subject).toBe('Hindrance reported — Riverside Tower — 07 Sep 2026')
  })

  it('potential timing renders "May block work later."', () => {
    const rendered = buildHindrancePmNotifyEmail({ ...base, timing: 'potential', timingRaw: null })
    expect(rendered.text).toContain('May block work later.')
  })

  it('unspecified timing with timing_raw includes the engineer\'s literal words, not a paraphrase', () => {
    const rendered = buildHindrancePmNotifyEmail({
      ...base,
      timing: 'unspecified',
      timingRaw: "cant say, depends on shuttering",
    })
    expect(rendered.text).toContain("Timing not confirmed — engineer said: 'cant say, depends on shuttering'")
  })

  it('never drops timing_raw silently -- html escapes it but still includes the real text', () => {
    const rendered = buildHindrancePmNotifyEmail({
      ...base,
      timing: 'unspecified',
      timingRaw: `depends on the crane <arriving> & "the weather"`,
    })
    expect(rendered.html).toContain('&lt;arriving&gt;')
    expect(rendered.html).toContain('&amp;')
    expect(rendered.html).toContain('&quot;the weather&quot;')
  })

  it('unspecified with no timing_raw (should not occur given the DB pairing CHECK) fails toward a plain, non-fabricated statement', () => {
    const rendered = buildHindrancePmNotifyEmail({ ...base, timing: 'unspecified', timingRaw: null })
    expect(rendered.text).toContain('Timing not confirmed.')
    expect(rendered.text).not.toContain('engineer said')
  })

  it('escapes the description and engineer name in html, never leaves raw markup unescaped', () => {
    const rendered = buildHindrancePmNotifyEmail({
      projectName: 'Site <A>',
      engineerName: 'Rao & Sons',
      description: 'wire "shorted" near <panel>',
      timing: 'active',
      timingRaw: null,
      createdAt: base.createdAt,
    })
    expect(rendered.html).toContain('Rao &amp; Sons')
    expect(rendered.html).toContain('&lt;panel&gt;')
    expect(rendered.html).toContain('&quot;shorted&quot;')
    expect(rendered.html).not.toContain('<panel>')
  })

  it('the subject line never varies by timing, only by project/date -- same template every time', () => {
    const active = buildHindrancePmNotifyEmail({ ...base, timing: 'active', timingRaw: null })
    const potential = buildHindrancePmNotifyEmail({ ...base, timing: 'potential', timingRaw: null })
    expect(active.subject).toBe(potential.subject)
  })
})
