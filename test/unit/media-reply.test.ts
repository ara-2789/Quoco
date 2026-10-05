import { describe, it, expect } from 'vitest'
import {
  classifyMediaReply,
  replyForMediaKind,
  extractMediaItems,
  MEDIA_NUDGE_REPLY,
  MEDIA_NUDGE_PROGRESS_LINE,
  MEDIA_NUDGE_WINDOW_SECONDS,
  VOICE_REPLY,
  UNSUPPORTED_MEDIA_REPLY,
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

  // Changed 2026-10-05, option A strict (Aravind). Was: 'defaults to photo
  // when NumMedia > 0 but content-type is missing' -> 'photo'.
  it('treats NumMedia > 0 with a missing content-type as unsupported (option A, strict)', () => {
    expect(classifyMediaReply({ NumMedia: '1' })).toBe('unsupported')
  })

  // Changed 2026-10-05, option A strict (Aravind). Was: 'classifies a
  // multi-item media message by the first item only' -> 'photo'. Items 1-2
  // carry no type here, so the message is no longer all-image.
  it('treats a multi-item message with untyped later items as unsupported (option A, strict)', () => {
    expect(classifyMediaReply({ NumMedia: '3', MediaContentType0: 'image/png' })).toBe('unsupported')
  })

  it('U1: a pdf alone is unsupported', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'application/pdf' })).toBe('unsupported')
  })

  it('U2: video/mp4 alone is unsupported', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'video/mp4' })).toBe('unsupported')
  })

  it('U3: image/jpeg + pdf is unsupported', () => {
    expect(
      classifyMediaReply({
        NumMedia: '2',
        MediaContentType0: 'image/jpeg',
        MediaContentType1: 'application/pdf',
      }),
    ).toBe('unsupported')
  })

  it('U4: image/jpeg alone is a photo', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'image/jpeg' })).toBe('photo')
  })

  it('U5: audio/ogg alone is voice', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'audio/ogg' })).toBe('voice')
  })

  it('U6: audio on item 0 wins over a pdf on item 1 (voice)', () => {
    expect(
      classifyMediaReply({
        NumMedia: '2',
        MediaContentType0: 'audio/ogg',
        MediaContentType1: 'application/pdf',
      }),
    ).toBe('voice')
  })

  it('U7: NumMedia 1 with image/png and no MediaUrl0 is still a photo (classification never reads URLs)', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'image/png' })).toBe('photo')
  })

  it('U8: image/jpeg + audio on item 1 is unsupported (audio only wins on item 0)', () => {
    expect(
      classifyMediaReply({
        NumMedia: '2',
        MediaContentType0: 'image/jpeg',
        MediaContentType1: 'audio/ogg',
      }),
    ).toBe('unsupported')
  })

  it('U9: content type is trimmed and case-insensitive ("IMAGE/JPEG; q=1" is a photo)', () => {
    expect(classifyMediaReply({ NumMedia: '1', MediaContentType0: 'IMAGE/JPEG; q=1' })).toBe('photo')
  })

  it('U12a: NumMedia 1 with no type at all is unsupported', () => {
    expect(classifyMediaReply({ NumMedia: '1' })).toBe('unsupported')
  })

  it('U12b: NumMedia 3 with only MediaContentType0 image/png is unsupported', () => {
    expect(classifyMediaReply({ NumMedia: '3', MediaContentType0: 'image/png' })).toBe('unsupported')
  })
})

describe('replyForMediaKind', () => {
  // Narrowed to 'voice' only, stage 3 -- PHOTO_REPLY is retired (see
  // media-reply.ts's own header for the full reversal); the idle-photo
  // nudge is now RPC-throttled (claim_media_nudge, migration 045) and
  // composed in lib/whatsapp/inbound-start.ts's own handleIdlePhoto, not
  // returned synchronously by this function any more.
  it('returns the voice reply', () => {
    expect(replyForMediaKind('voice')).toBe(VOICE_REPLY)
  })

  it('U13b: returns UNSUPPORTED_MEDIA_REPLY for unsupported', () => {
    expect(replyForMediaKind('unsupported')).toBe(UNSUPPORTED_MEDIA_REPLY)
  })
})

describe('UNSUPPORTED_MEDIA_REPLY copy (NOT approved -- needs Aravind\'s approval before merge)', () => {
  it('U13a: equals the exact string', () => {
    expect(UNSUPPORTED_MEDIA_REPLY).toBe(
      "This file type isn't supported yet. Nothing was saved. Please send a photo instead.",
    )
  })
})

// NEW, stage 3 (docs/plans/media-capture-design.md's stage 3 entry). Copy
// constants only -- the throttle mechanism itself (claim_media_nudge) is a
// DB test-db integration concern (test/inbound-start.test.ts and the
// standalone RPC test file, per docs/reviews/045-review-brief.md), not
// something a pure unit test can exercise.
describe('media nudge copy constants (stage 3)', () => {
  it('MEDIA_NUDGE_REPLY is the approved copy', () => {
    expect(MEDIA_NUDGE_REPLY).toBe('Photo not saved. Please send it through the right option in the menu below.')
  })

  it('MEDIA_NUDGE_PROGRESS_LINE names morning or evening check-in, not just evening', () => {
    expect(MEDIA_NUDGE_PROGRESS_LINE).toBe('Progress photos: send them during your morning or evening check-in.')
    expect(MEDIA_NUDGE_PROGRESS_LINE).not.toContain('during your evening check-in')
  })

  it('MEDIA_NUDGE_WINDOW_SECONDS is 5 minutes', () => {
    expect(MEDIA_NUDGE_WINDOW_SECONDS).toBe(300)
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

  // Changed 2026-10-05, option A strict (Aravind). Was: 'defaults a missing
  // content type to application/octet-stream and skips a missing URL' ->
  // [{ url: 'url-0', contentType: 'application/octet-stream' }]. An item with
  // no content type is now dropped, as is an item with no URL.
  it('drops an item with no content type and skips a missing URL (option A, strict)', () => {
    expect(
      extractMediaItems({
        NumMedia: '2',
        MediaUrl0: 'url-0',
        // MediaContentType0 deliberately absent
        // MediaUrl1 deliberately absent -- NumMedia claims 2, only 1 real item
        MediaContentType1: 'image/png',
      }),
    ).toEqual([])
  })

  it('U10: keeps the jpeg item and drops the pdf item', () => {
    expect(
      extractMediaItems({
        NumMedia: '2',
        MediaUrl0: 'url-0',
        MediaContentType0: 'image/jpeg',
        MediaUrl1: 'url-1',
        MediaContentType1: 'application/pdf',
      }),
    ).toEqual([{ url: 'url-0', contentType: 'image/jpeg' }])
  })

  it('U11: a pdf alone yields []', () => {
    expect(
      extractMediaItems({ NumMedia: '1', MediaUrl0: 'url-0', MediaContentType0: 'application/pdf' }),
    ).toEqual([])
  })

  it('U12c: an item with a URL but no content type is dropped', () => {
    expect(extractMediaItems({ NumMedia: '1', MediaUrl0: 'url-0' })).toEqual([])
  })
})
