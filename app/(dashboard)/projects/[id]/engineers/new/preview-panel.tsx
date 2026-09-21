import * as copy from '@/lib/engineers/copy'
import { MAX_NAME_LENGTH } from '@/lib/engineers/parse-roster'
import type { AddedRow, PreviewRow } from '@/lib/engineers/add-engineers'

// PURE PRESENTATIONAL -- no 'use client', no server imports -- so
// react-dom/server's renderToStaticMarkup can load it under vitest
// (test/engineer-add-render.test.tsx).
//
// THE COUNT-DEPENDENT RENDERING RULES LIVE HERE, not in lib/engineers/copy.ts
// (a flat string table whose header forbids logic) and not anywhere else in
// lib/ (docs/plans/add-engineer-plan.md section 9a; E6 guards this):
//   9a(a) the confirm prompt is singular when the count is 1;
//   9a(b) a zero rejected count omits the second summary sentence entirely;
//   D-A5  a successful result shows only the first sentence of result.summary,
//         and a preview with nothing acceptable omits "0 will be added." and
//         shows preview.nothingToApply instead.
// The ONE user-facing string in this file that is not in copy.ts is the
// approved singular confirm prompt (section 9a(a)).

// Fill {placeholders} in an approved string. An unknown placeholder is left
// exactly as written -- it is never given an invented value.
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{([^}]+)\}/g, (whole: string, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? String(values[key]) : whole,
  )
}

// Split a two-sentence summary template at the sentence boundary. Throws unless
// there are exactly two sentences, so a future copy change of shape fails loudly
// (E5) instead of rendering garbage.
export function summarySentences(template: string): [string, string] {
  const parts = template.split(/(?<=\.)\s+/).filter((p) => p !== '')
  if (parts.length !== 2) {
    throw new Error(`summarySentences: expected exactly two sentences, got ${parts.length} in ${JSON.stringify(template)}`)
  }
  return [parts[0], parts[1]]
}

// 9a(a).
export function ConfirmQuestion({ count }: { count: number }) {
  const text = count === 1 ? 'Add 1 site engineer to this project?' : fill(copy.confirm.question, { n: count })
  return <p className="text-sm font-medium text-gray-900">{text}</p>
}

function rejectionText(row: Extract<PreviewRow, { accepted: false }>): string {
  switch (row.reason) {
    case 'noName':
      return copy.rejections.noName
    case 'nameTooLong':
      return fill(copy.rejections.nameTooLong, { n: MAX_NAME_LENGTH })
    case 'badNumber':
      return copy.rejections.badNumber
    case 'duplicateInPaste':
      return copy.rejections.duplicateInPaste
    case 'alreadyOnThisProject':
      return copy.rejections.alreadyOnThisProject
    case 'onAnotherProject':
      return fill(copy.rejections.onAnotherProject, { 'project name': row.otherProjectName ?? '' })
    case 'inUse':
      return copy.rejections.inUse
  }
}

// 9a(b) and D-A5 (preview side).
export function PreviewPanel({ rows }: { rows: PreviewRow[] }) {
  const accepted = rows.filter((r): r is Extract<PreviewRow, { accepted: true }> => r.accepted)
  const rejected = rows.filter((r): r is Extract<PreviewRow, { accepted: false }> => !r.accepted)
  const [willBeAdded, cannotBeAdded] = summarySentences(copy.preview.summary)

  // One string, so the two sentences read as one line of text in the markup.
  const summary = [
    accepted.length > 0 ? fill(willBeAdded, { n: accepted.length }) : null,
    rejected.length > 0 ? fill(cannotBeAdded, { n: rejected.length }) : null,
  ]
    .filter((s): s is string => s !== null)
    .join(' ')

  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-900" role="status">
        {summary}
      </p>
      {accepted.length === 0 && <p className="text-sm text-gray-700">{copy.preview.nothingToApply}</p>}

      {accepted.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{copy.preview.accepted}</h2>
          <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
            {accepted.map((row, i) => (
              <li key={`${row.number}-${i}`} data-preview-row="accepted" className="px-4 py-2">
                <span className="font-medium text-gray-900">{row.name}</span>{' '}
                <span className="text-gray-700">{row.number}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {rejected.length > 0 && (
        <section>
          <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide mb-2">{copy.preview.rejected}</h2>
          <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
            {rejected.map((row, i) => (
              <li key={`${row.line}-${i}`} data-preview-row="rejected" className="px-4 py-2">
                <span className="text-gray-900">{row.line}</span>{' '}
                <span className="text-red-700">{rejectionText(row)}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

// D-A5 (result side): only the first sentence of result.summary, never "0 not
// added". The apply is all-or-nothing, so on success "not added" is always zero
// and on failure result.batchFailed is shown instead.
export function ResultPanel({ added }: { added: AddedRow[] }) {
  const [addedSentence] = summarySentences(copy.result.summary)
  return (
    <div className="space-y-4">
      <p className="text-sm font-medium text-gray-900" role="status">
        {fill(addedSentence, { n: added.length })}
      </p>
      <ul className="bg-white border border-gray-200 rounded-lg divide-y divide-gray-100 text-sm">
        {added.map((row, i) => (
          <li key={`${row.number}-${i}`} data-result-row="added" className="px-4 py-2">
            <span className="font-medium text-gray-900">{row.name}</span>{' '}
            <span className="text-gray-700">{row.number}</span>{' '}
            <span className="text-gray-700">{copy.result.rowAdded}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
