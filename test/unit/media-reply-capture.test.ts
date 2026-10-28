import { describe, it, expect } from 'vitest'
import { classifyCaptureDocument, extractCaptureMediaItems, classifyMediaReply } from '@/lib/whatsapp/media-reply'

// PR-C C4b, T-GATE-3: the webhook's "may this be a material-inward file?" classifier. Additive to classifyMediaReply,
// which these cases also pin as UNCHANGED (a PDF is still 'unsupported' to it).

type P = Record<string, string>
const msg = (...types: Array<string | undefined>): P => {
  const p: P = { NumMedia: String(types.length) }
  types.forEach((t, i) => {
    if (t !== undefined) p[`MediaContentType${i}`] = t
    p[`MediaUrl${i}`] = `https://example.invalid/m/${i}`
  })
  return p
}

describe('T-GATE-3 classifyCaptureDocument', () => {
  it.each<[string, P, 'document' | null]>([
    ['pdf', msg('application/pdf'), 'document'],
    ['jpeg + pdf', msg('image/jpeg', 'application/pdf'), 'document'],
    ['pdf + jpeg', msg('application/pdf', 'image/jpeg'), 'document'],
    ['two pdfs', msg('application/pdf', 'application/pdf'), 'document'],
    ['upper-case APPLICATION/PDF', msg('APPLICATION/PDF'), 'document'],
    ['padded " application/pdf "', msg(' application/pdf '), 'document'],
    ['pdf + video', msg('application/pdf', 'video/mp4'), null],
    ['video + pdf', msg('video/mp4', 'application/pdf'), null],
    ['audio first + pdf', msg('audio/ogg', 'application/pdf'), null],
    ['pdf + audio later', msg('application/pdf', 'audio/ogg'), null],
    ['pdf + untyped item', msg('application/pdf', undefined), null],
    ['untyped only', msg(undefined), null],
    ['"application/pdf; x=y" (parameters)', msg('application/pdf; x=y'), null],
    ['jpeg only (a photo, not a document)', msg('image/jpeg'), null],
    ['video only', msg('video/mp4'), null],
    ['other application type', msg('application/msword'), null],
    ['NumMedia 0', { NumMedia: '0' }, null],
    ['NumMedia missing', {}, null],
    ['NumMedia garbage', { NumMedia: 'abc', MediaContentType0: 'application/pdf' }, null],
  ])('%s', (_label, params, expected) => {
    expect(classifyCaptureDocument(params)).toBe(expected)
  })

  it('classifyMediaReply is unchanged: a PDF is still "unsupported", a jpeg still "photo"', () => {
    expect(classifyMediaReply(msg('application/pdf'))).toBe('unsupported')
    expect(classifyMediaReply(msg('image/jpeg', 'application/pdf'))).toBe('unsupported')
    expect(classifyMediaReply(msg('image/jpeg'))).toBe('photo')
  })
})

describe('extractCaptureMediaItems', () => {
  it('keeps image/* and application/pdf items that have a URL, with the raw content type', () => {
    const p = msg('image/jpeg', 'application/PDF', 'video/mp4')
    expect(extractCaptureMediaItems(p)).toEqual([
      { url: 'https://example.invalid/m/0', contentType: 'image/jpeg' },
      { url: 'https://example.invalid/m/1', contentType: 'application/PDF' },
    ])
  })
  it('drops an item with no URL and returns [] for no media', () => {
    expect(extractCaptureMediaItems({ NumMedia: '1', MediaContentType0: 'application/pdf' })).toEqual([])
    expect(extractCaptureMediaItems({ NumMedia: '0' })).toEqual([])
  })
})
