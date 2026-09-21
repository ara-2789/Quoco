// Add-engineer slice 1, PR A (A9, M1). Rendered-output proof, no jsdom and no
// network/database: react-dom/server's renderToStaticMarkup over the PURE
// presentational module preview-panel.tsx (same style as
// test/photo-sections-render.test.tsx). The client form and the server actions
// cannot load under vitest ('server-only' via getProfile), so this file proves
// the rendering rules, not the interactivity (decision D-A9 / plan U16).
//
// The two approved-wording rules of docs/plans/add-engineer-plan.md section 9a
// live in the COMPONENT, never in lib/ or copy.ts:
//   (a) confirm prompt reads "Add 1 site engineer to this project?" when n = 1;
//   (b) a zero rejected count omits the second summary sentence entirely.
// Decision D-A5 adds: a successful result renders only the first sentence of
// result.summary ("{n} added."), never "0 not added"; a preview with zero
// acceptable rows omits "0 will be added." and shows preview.nothingToApply.
import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import * as copy from '@/lib/engineers/copy'
import type { PreviewRow, RejectionKey } from '@/lib/engineers/add-engineers'
import {
  ConfirmQuestion,
  PreviewPanel,
  ResultPanel,
  fill,
  summarySentences,
} from '@/app/(dashboard)/projects/[id]/engineers/new/preview-panel'
import { boundaryDerivedNumber } from './helpers/boundary-phone'

const acceptedRow = (k: number): PreviewRow => ({
  accepted: true,
  line: `Person ${k}, ${boundaryDerivedNumber(k)}`,
  name: `Person ${k}`,
  number: boundaryDerivedNumber(k),
})

const rejectedRow = (k: number, reason: RejectionKey, otherProjectName?: string): PreviewRow => ({
  accepted: false,
  line: `Rejected ${k}, ${boundaryDerivedNumber(k)}`,
  name: `Rejected ${k}`,
  number: boundaryDerivedNumber(k),
  reason,
  ...(otherProjectName === undefined ? {} : { otherProjectName }),
})

const panel = (rows: PreviewRow[]) => renderToStaticMarkup(createElement(PreviewPanel, { rows }))
const confirm = (count: number) => renderToStaticMarkup(createElement(ConfirmQuestion, { count }))
const result = (n: number) =>
  renderToStaticMarkup(
    createElement(ResultPanel, {
      added: Array.from({ length: n }, (_, i) => ({ name: `Person ${i + 1}`, number: boundaryDerivedNumber((i % 8) + 1) })),
    }),
  )

describe('section 9a(a): the confirm prompt', () => {
  it('E1: renders the singular form when n = 1', () => {
    const html = confirm(1)
    expect(html).toContain('Add 1 site engineer to this project?')
    expect(html).not.toContain('1 site engineers')
  })

  it.each([2, 7, 50])('E2: renders the plural form (copy.confirm.question, {n} filled) when n = %i', (n) => {
    const html = confirm(n)
    expect(html).toContain(copy.confirm.question.replace('{n}', String(n)))
    expect(html).toContain(`Add ${n} site engineers to this project?`)
    expect(html).not.toContain(`Add ${n} site engineer to this project?`)
  })

  it('E2 (control): the singular string occurs only in the n = 1 branch', () => {
    for (const n of [2, 3, 10, 50]) expect(confirm(n)).not.toContain('Add 1 site engineer ')
  })

  it('never leaves a {n} placeholder in the markup', () => {
    for (const n of [1, 2, 50]) expect(confirm(n)).not.toContain('{')
  })
})

describe('section 9a(b): the preview summary', () => {
  it('E3: a rejected count of zero omits the second sentence entirely', () => {
    const html = panel([acceptedRow(1), acceptedRow(2), acceptedRow(3)])
    expect(html).toContain('3 will be added.')
    expect(html).not.toContain('0 cannot be added')
    expect(html).not.toContain('cannot be added')
  })

  it('E4: a rejected count above zero keeps both sentences', () => {
    const html = panel([acceptedRow(1), acceptedRow(2), rejectedRow(3, 'badNumber')])
    expect(html).toContain('2 will be added. 1 cannot be added.')
  })

  it('E5: the summary copy still has exactly two sentences (fails loudly if its shape changes)', () => {
    expect(summarySentences(copy.preview.summary)).toEqual(['{n} will be added.', '{n} cannot be added.'])
    expect(summarySentences(copy.result.summary)).toEqual(['{n} added.', '{n} not added.'])
    expect(() => summarySentences('{n} will be added.')).toThrow()
    expect(() => summarySentences('{n} one. {n} two. {n} three.')).toThrow()
  })
})

describe('decision D-A5: zero-count handling beyond 9a', () => {
  it('a successful result renders only the first sentence, never "0 not added"', () => {
    const html = result(3)
    expect(html).toContain('3 added.')
    expect(html).not.toContain('not added')
    expect(html).not.toContain('0 not added')
  })

  it('a single added row reads "1 added."', () => {
    expect(result(1)).toContain('1 added.')
  })

  it('a preview with zero acceptable rows omits "0 will be added." and shows nothingToApply', () => {
    const html = panel([rejectedRow(1, 'badNumber'), rejectedRow(2, 'inUse')])
    expect(html).not.toContain('0 will be added.')
    expect(html).not.toContain('will be added')
    expect(html).toContain(copy.preview.nothingToApply)
    // The rejected sentence follows the 9a(b) rule: two rejected -> shown.
    expect(html).toContain('2 cannot be added.')
  })

  it('a preview with acceptable rows never shows nothingToApply', () => {
    expect(panel([acceptedRow(1), rejectedRow(2, 'badNumber')])).not.toContain(copy.preview.nothingToApply)
  })
})

describe('row rendering', () => {
  it('shows accepted rows by name and stored number, under the accepted label', () => {
    const html = panel([acceptedRow(1), rejectedRow(2, 'badNumber')])
    expect(html).toContain(copy.preview.accepted)
    expect(html).toContain('Person 1')
    expect(html).toContain(boundaryDerivedNumber(1))
  })

  it('shows a rejected row exactly as pasted, under the rejected label', () => {
    const html = panel([acceptedRow(1), rejectedRow(2, 'badNumber')])
    expect(html).toContain(copy.preview.rejected)
    expect(html).toContain(`Rejected 2, ${boundaryDerivedNumber(2)}`)
  })

  it('omits a group label whose group is empty', () => {
    expect(panel([acceptedRow(1)])).not.toContain(copy.preview.rejected)
    expect(panel([rejectedRow(1, 'badNumber')])).not.toContain(copy.preview.accepted)
  })

  it.each([
    ['noName', copy.rejections.noName],
    ['badNumber', copy.rejections.badNumber],
    ['duplicateInPaste', copy.rejections.duplicateInPaste],
    ['alreadyOnThisProject', copy.rejections.alreadyOnThisProject],
    ['inUse', copy.rejections.inUse],
  ] as const)('rejection %s renders its approved text', (reason, text) => {
    expect(panel([acceptedRow(1), rejectedRow(2, reason)])).toContain(text)
  })

  it('nameTooLong fills {n} with the 100-character cap', () => {
    expect(panel([acceptedRow(1), rejectedRow(2, 'nameTooLong')])).toContain(
      copy.rejections.nameTooLong.replace('{n}', '100'),
    )
  })

  it('onAnotherProject fills {project name} with the other project (data, HTML-escaped)', () => {
    const html = panel([acceptedRow(1), rejectedRow(2, 'onAnotherProject', 'Tower B')])
    expect(html).toContain(copy.rejections.onAnotherProject.replace('{project name}', 'Tower B'))
    const escaped = panel([acceptedRow(1), rejectedRow(2, 'onAnotherProject', '<b>x</b>')])
    expect(escaped).not.toContain('<b>x</b>')
  })

  it('registered_no_project and number_registered share ONE text (decision D-A4): both are inUse', () => {
    expect(copy.rejections.inUse).toBeTruthy()
    expect(Object.keys(copy.rejections).filter((k) => /inUse|registered/i.test(k))).toEqual(['inUse'])
  })

  it('never leaves a placeholder in the markup', () => {
    const html = panel([
      acceptedRow(1),
      rejectedRow(2, 'nameTooLong'),
      rejectedRow(3, 'onAnotherProject', 'Tower B'),
      rejectedRow(4, 'inUse'),
    ])
    expect(html).not.toMatch(/\{(n|project name)\}/)
  })
})

describe('fill()', () => {
  it('fills every occurrence of a placeholder', () => {
    expect(fill('{n} and {n}', { n: 4 })).toBe('4 and 4')
  })
  it('leaves an unknown placeholder alone (never invents a value)', () => {
    expect(fill('{n} {project name}', { n: 2 })).toBe('2 {project name}')
  })
})

describe('E6: no pluralisation or zero-suppression logic in lib/', () => {
  const LIB = join(process.cwd(), 'lib', 'engineers')
  const files = readdirSync(LIB).filter((f) => f.endsWith('.ts'))

  it('lib/engineers/ holds the files this slice expects', () => {
    expect(files).toEqual(
      expect.arrayContaining(['add-engineers.ts', 'confirm-set.ts', 'copy.ts', 'gate.ts', 'parse-roster.ts']),
    )
  })

  // Code only: comments legitimately talk about pluralisation (they say it is
  // NOT done here), so they are stripped before the patterns are applied.
  const codeOf = (file: string) =>
    readFileSync(join(LIB, file), 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n')
      .map((l) => l.replace(/(^|\s)\/\/.*$/, ''))
      .join('\n')

  it.each(files.filter((f) => f !== 'copy.ts'))('%s never imports the copy module, so it cannot render a count into wording', (file) => {
    const code = codeOf(file)
    expect(code).not.toMatch(/from\s+['"](@\/lib\/engineers\/copy|\.\/copy)['"]/)
    expect(code).not.toMatch(/\b(pluralis|pluraliz|singular)/i)
    expect(code).not.toMatch(/site engineers?/i)
  })

  it('copy.ts holds no function, conditional or template logic: strings and groups only', () => {
    expect(codeOf('copy.ts')).not.toMatch(/=>|\bfunction\b|\bif\s*\(|\bswitch\b|\$\{/)
  })
  // NAMED LIMIT: a grep, not a proof. It catches the obvious shapes, not every
  // way a future edit could branch on a count.
})

describe('M1: the project page carries exactly one add link (decision D-A3)', () => {
  const source = readFileSync(join(process.cwd(), 'app', '(dashboard)', 'projects', '[id]', 'page.tsx'), 'utf8')

  it('links to /projects/[id]/engineers/new with copy list.addLink', () => {
    expect(source).toContain('${project.id}/engineers/new')
    expect(source).toMatch(/\bengineerCopy\.addLink\b/)
  })

  it('has exactly ONE route into /engineers (no list-page navigation in PR A)', () => {
    // '}/engineers' matches only an href built from an id, not the copy import path.
    expect(source.match(/\}\/engineers/g)).toHaveLength(1)
  })
})
