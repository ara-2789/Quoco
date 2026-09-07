// Classifies an inbound Twilio message carrying media (NumMedia > 0) into a
// reply, so handleWebhookPost (app/api/whatsapp/webhook/route.ts) can
// intercept it before any menu or flow logic runs.
//
// SITS UPSTREAM OF BOTH isTestStartTrigger AND routeInboundMessage,
// DELIBERATELY -- routeInboundMessage only handles the no-active-flow case;
// when a flow IS active it delegates straight to dispatchInboundTurn,
// bypassing routeInboundMessage's own branches entirely. A media reply sent
// mid-flow (an engineer answering a check-in question with a photo instead
// of typing) would reach dispatchInboundTurn with an empty Body and be
// parsed as an invalid text answer if this check lived inside
// routeInboundMessage alone. Placing it in route.ts, ahead of both call
// sites, is what makes the mid-flow case covered at all.
//
// Media handling does not exist anywhere else in this codebase (confirmed by
// grep; docs/plans/adhoc-menu-spec.md §28(aa)(1)) -- no Twilio media URL is
// ever downloaded, stored, or re-uploaded to Supabase Storage. This module
// never reads MediaUrl0; it only reads NumMedia/MediaContentType0 to pick a
// fixed reply, then stops -- the media itself is never fetched.

export type MediaKind = 'photo' | 'voice'

// One string per media type, worded to be correct whether or not a flow
// question is currently pending (Aravind's decision, 2026-09-06) --
// deliberately NOT branched on active-flow state. Branching would need a
// second readCurrentFlow lookup upstream of the one routeInboundMessage/
// dispatchInboundTurn already make to decide the exact same fact -- the
// same two-places-decide-one-thing shape this project has already been bitten
// by (buildBodyCorpus, isHireRateTrusted; docs/reviews/admin-merge-
// retrospective-2026-09-05.md Q6).
export const PHOTO_REPLY = "Photos aren't used yet. Please send your message as text."
export const VOICE_REPLY = "Voice messages aren't supported yet. Please send your message as text."

/**
 * Classify an inbound Twilio request's media fields. Returns null when no
 * media is attached (NumMedia missing, "0", or unparseable) so the caller
 * falls through to ordinary text handling.
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
