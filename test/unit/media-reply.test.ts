import { describe, it, expect } from 'vitest'
import {
  classifyMediaReply,
  replyForMediaKind,
  extractMediaItems,
  MEDIA_NUDGE_REPLY,
  MEDIA_NUDGE_PROGRESS_LINE,
  MEDIA_NUDGE_WINDOW_SECONDS,
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
  // Narrowed to 'voice' only, stage 3 -- PHOTO_REPLY is retired (see
  // media-reply.ts's own header for the full reversal); the idle-photo
  // nudge is now RPC-throttled (claim_media_nudge, migration 045) and
  // composed in lib/whatsapp/inbound-start.ts's own handleIdlePhoto, not
  // returned synchronously by this function any more.
  it('returns the voice reply', () => {
    expect(replyForMediaKind('voice')).toBe(VOICE_REPLY)
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
