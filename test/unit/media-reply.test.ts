import { describe, it, expect } from 'vitest'
import {
  classifyMediaReply,
  replyForMediaKind,
  extractMediaItems,
  PHOTO_REPLY,
  VOICE_REPLY,
} from '@/lib/whatsapp/media-reply'

describe('classifyMediaReply', () => {
  it('returns null when NumMedia is absent', () => {
    expect(classifyMediaReply({})).toBeNull()
  })

  it('returns null when NumMedia is "0"', () => {
    expect(classifyMediaReply({ NumMedia: '0' })).toBeNull()
  })

  it('classifies an image content-type as photo', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'image/jpeg' })).toBe('photo')
  })

  it('classifies a WhatsApp voice-note content-type as voice', () => {
    expect(
      classifyMediaReply({ NumMedia: '1', MediaContentType0: 'audio/ogg; codecs=opus' }),
    ).toBe('voice')
  })

  it('defaults to photo when NumMedia > 0 but content-type is missing', () => {
    expect(classifyMediaReply({ NumMedia: '1' })).toBe('photo')
  })

  it('classifies a multi-item media message by the first item only', () => {
    expect(classifyMediaReply({ NumMedia: '3', MediaContentType0: 'image/png' })).toBe('photo')
  })
})

describe('replyForMediaKind', () => {
  it('returns the photo reply', () => {
    expect(replyForMediaKind('photo')).toBe(PHOTO_REPLY)
  })

  it('returns the voice reply', () => {
    expect(replyForMediaKind('voice')).toBe(VOICE_REPLY)
  })
})

// NEW, stage 1 (docs/plans/stage1-photo-intake-plan.md, item 18's
// interceptor move). extractMediaItems is the function that actually reads
// MediaUrl{i}/MediaContentType{i} -- called only downstream, only for a
// message already classified 'photo'.
describe('extractMediaItems', () => {
  it('returns [] when NumMedia is absent, "0", or unparseable', () => {
    expect(extractMediaItems({})).toEqual([])
    expect(extractMediaItems({ NumMedia: '0' })).toEqual([])
    expect(extractMediaItems({ NumMedia: 'not-a-number' })).toEqual([])
  })

  it('extracts a single item with its content type', () => {
    expect(
      extractMediaItems({
        NumMedia: '1',
        MediaUrl0: 'https://api.twilio.com/media/ABC',
        MediaContentType0: 'image/jpeg',
      }),
    ).toEqual([{ url: 'https://api.twilio.com/media/ABC', contentType: 'image/jpeg' }])
  })

  it('extracts every item for a multi-item message, in index order', () => {
    expect(
      extractMediaItems({
        NumMedia: '3',
        MediaUrl0: 'url-0',
        MediaContentType0: 'image/jpeg',
        MediaUrl1: 'url-1',
        MediaContentType1: 'image/png',
        MediaUrl2: 'url-2',
        MediaContentType2: 'image/webp',
      }),
    ).toEqual([
      { url: 'url-0', contentType: 'image/jpeg' },
      { url: 'url-1', contentType: 'image/png' },
      { url: 'url-2', contentType: 'image/webp' },
    ])
  })

  it('defaults a missing content type to application/octet-stream and skips a missing URL', () => {
    expect(
      extractMediaItems({
        NumMedia: '2',
        MediaUrl0: 'url-0',
        // MediaContentType0 deliberately absent
        // MediaUrl1 deliberately absent -- NumMedia claims 2, only 1 real item
        MediaContentType1: 'image/png',
      }),
    ).toEqual([{ url: 'url-0', contentType: 'application/octet-stream' }])
  })
})
