// Classifies an inbound Twilio message carrying media (NumMedia > 0), and
// extracts the media items themselves for a photo. Used by BOTH
// handleWebhookPost (voice only, unconditional, upstream) and
// routeInboundMessage (photo handling, flow-aware, downstream) -- see each
// call site's own header for why they split this way.
//
// REVERSED, 2026-09-13 (docs/plans/media-capture-design.md item 18; full
// build: docs/plans/stage1-photo-intake-plan.md). The paragraph struck
// through below records the 2026-09-06 decision this reverses, kept for
// its own reasoning, not deleted:
//
// ~~SITS UPSTREAM OF BOTH isTestStartTrigger AND routeInboundMessage,
// DELIBERATELY -- routeInboundMessage only handles the no-active-flow case;
// when a flow IS active it delegates straight to dispatchInboundTurn,
// bypassing routeInboundMessage's own branches entirely. A media reply sent
// mid-flow (an engineer answering a check-in question with a photo instead
// of typing) would reach dispatchInboundTurn with an empty Body and be
// parsed as an invalid text answer if this check lived inside
// routeInboundMessage alone. Placing it in route.ts, ahead of both call
// sites, is what makes the mid-flow case covered at all.~~
//
// DATED CORRECTION (2026-09-13): that claim -- "would reach
// dispatchInboundTurn with an empty Body" -- is WRONG for a captioned
// photo, confirmed live against Twilio's own inbound message log (SID
// MM1b568a6b25d047a6c302851d36102784, body "This is a fan" delivered
// alongside the media). A captioned photo populates Body exactly like an
// ordinary text message would. The reversal itself is unrelated to that
// correction, though: item 18 moves photo handling downstream because the
// photo-window decision (item 11) and "a photo is never an answer" (item
// 23) both require knowing whether a flow is active and what its current
// step is -- information this module deliberately did not have, by design,
// when it sat upstream. Voice is UNCHANGED by any of this -- nothing
// decided in items 1-23 touches voice handling, so it keeps the exact
// upstream, flow-state-blind placement the struck-through paragraph
// describes, and stays in route.ts. Only the PHOTO half of this module's
// old job moves; see routeInboundMessage's own header
// (lib/whatsapp/inbound-start.ts) for where it landed.
//
// Media handling did not exist anywhere else in this codebase before stage
// 1 -- confirmed by grep at design time (docs/plans/adhoc-menu-spec.md
// §28(aa)(1)): no Twilio media URL was ever downloaded, stored, or
// re-uploaded to Supabase Storage. This module itself still never reads
// MediaUrl0 for VOICE classification (voice is rejected outright, the
// bytes are never needed) -- extractMediaItems below is the new function
// that actually reads MediaUrl{i}/MediaContentType{i} for a photo, and it
// is called only downstream, only when a photo is going to be stored.

export type MediaKind = 'photo' | 'voice'

// VOICE_REPLY is unchanged in every respect -- worded to be correct
// regardless of flow state, exactly as it always was, since voice handling
// itself is unaffected by this reversal.
export const VOICE_REPLY = "Voice messages aren't supported yet. Please send your message as text."

// PHOTO_REPLY is UNCHANGED TEXT, but its USAGE narrows with this reversal:
// it now fires only from the idle branch (no active flow) and the
// hindrance branch (active flow, but hindrance photo capture is stage 2,
// not yet built) -- never for an active morning/evening flow, where a
// photo is now stored instead. See routeInboundMessage's own header.
export const PHOTO_REPLY = "Photos aren't used yet. Please send your message as text."

/**
 * Classify an inbound Twilio request's media fields. Returns null when no
 * media is attached (NumMedia missing, "0", or unparseable) so the caller
 * falls through to ordinary text handling. UNCHANGED by this reversal --
 * still reads only NumMedia/MediaContentType0, still classifies by the
 * first item's content type alone (see its own comment below for why).
 */
export function classifyMediaReply(params: {
  NumMedia?: string
  MediaContentType0?: string
}): MediaKind | null {
  const numMedia = Number(params.NumMedia ?? '0')
  if (!Number.isFinite(numMedia) || numMedia < 1) return null
  // MediaContentType0 is the MIME type of the FIRST media item only --
  // WhatsApp voice notes arrive as audio/ogg. A multi-media message (rare;
  // WhatsApp forwards one at a time in practice) is classified by that
  // first item alone, matching the "which register, not which item" job
  // this function actually does.
  return params.MediaContentType0?.startsWith('audio/') ? 'voice' : 'photo'
}

export function replyForMediaKind(kind: MediaKind): string {
  return kind === 'voice' ? VOICE_REPLY : PHOTO_REPLY
}

export interface MediaItem {
  url: string
  contentType: string
}

/**
 * NEW, stage 1. Extract every media item Twilio attached to this message
 * (MediaUrl0..N / MediaContentType0..N, N = NumMedia - 1) -- called only
 * when classifyMediaReply has already returned 'photo' for this message.
 * Returns [] when NumMedia is missing/zero/unparseable, or when every
 * indexed MediaUrl{i} is itself missing (defensive; not expected from a
 * real Twilio request that already passed classifyMediaReply).
 *
 * Twilio's own per-message media limit (assumed up to 10, per
 * design-doc-time research into its WhatsApp media documentation) is not
 * enforced here -- this function reads however many NumMedia claims and
 * lets the caller decide what to do with the result; intake is uncapped
 * (item 14, reversed), so there is no cap to enforce in the first place.
 */
export function extractMediaItems(params: Record<string, string | undefined>): MediaItem[] {
  const numMedia = Number(params.NumMedia ?? '0')
  if (!Number.isFinite(numMedia) || numMedia < 1) return []

  const items: MediaItem[] = []
  for (let i = 0; i < numMedia; i++) {
    const url = params[`MediaUrl${i}`]
    if (!url) continue
    const contentType = params[`MediaContentType${i}`] ?? 'application/octet-stream'
    items.push({ url, contentType })
  }
  return items
}
