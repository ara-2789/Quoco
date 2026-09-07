import { describe, it, expect } from 'vitest'
import { buildHindrancePmNotifyEmail } from '@/lib/hindrance/pm-notify'

describe('buildHindrancePmNotifyEmail', () => {
  const base = {
    projectName: 'Riverside Tower',
    engineerName: 'Vikram Rao',
    description: 'Cement delivery delayed at the main gate',
  }

  it('active timing renders "Blocking work now."', () => {
    const rendered = buildHindrancePmNotifyEmail({ ...base, timing: 'active', timingRaw: null })
    expect(rendered.subject).toBe('Hindrance reported — Riverside Tower')
    expect(rendered.text).toBe(
      'Vikram Rao reported a hindrance on Riverside Tower: "Cement delivery delayed at the main gate".\n\nBlocking work now.',
    )
    expect(rendered.html).toContain('Blocking work now.')
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
    })
    expect(rendered.html).toContain('Rao &amp; Sons')
    expect(rendered.html).toContain('&lt;panel&gt;')
    expect(rendered.html).toContain('&quot;shorted&quot;')
    expect(rendered.html).not.toContain('<panel>')
  })

  it('the subject line never varies by timing -- same three-word template every time', () => {
    const active = buildHindrancePmNotifyEmail({ ...base, timing: 'active', timingRaw: null })
    const potential = buildHindrancePmNotifyEmail({ ...base, timing: 'potential', timingRaw: null })
    expect(active.subject).toBe(potential.subject)
  })
})
