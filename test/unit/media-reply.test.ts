import { describe, it, expect } from 'vitest'
import {
  classifyMediaReply,
  replyForMediaKind,
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
