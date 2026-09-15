# Hindrance Q3 photo question — unanswerable-by-photos fix (2026-09-15)

Live prod finding (Aravind, 2026-09-15), not a design refinement. The
hindrance flow's Q3 photo question — "Send photos of the issue. Reply none
to skip." — was itself unanswerable by photos, because items 12 and 23 ("a
caption/photo is never an answer") apply to Q3 exactly as they apply
everywhere else, and Q3 is the one question whose real answer IS photos.

## What was observed

- The engineer sends a photo. The question repeats.
- An **uncaptioned** photo produced **no acknowledgement at all** — just the
  question again, reading as "that didn't work" when the photo was in fact
  stored (`photos_status='pending'`, a `hindrance_media_ingest` job
  enqueued).
- A **captioned** photo produced `"Photo saved. Type your reply for this
  question."` — correct copy everywhere else it fires (morning, evening),
  but wrong here: the only text that closes Q3 was `"none"`, which reads as
  discarding the photos he just sent, not as "type your reply."

## Cause

Items 12 (a caption is never an answer) and 23 (a photo is never an answer)
collide with a question whose answer is photos. Both rules stay correct
everywhere else — this is a **scoped exception at Q3 only**, not a general
reversal. A caption at Q3 is still stored on the photo row and still never
parsed as an answer; nothing about items 12/23 changed anywhere else.

## Decision (Aravind, 2026-09-15)

At the hindrance photo question, photos are acknowledged with a running
count and the engineer closes the question himself:

- Every photo received at Q3 is acknowledged, captioned or not.
- The count is cumulative for this hindrance.
- The engineer replies **"done"** to finish, or **"none"** to skip if he
  has sent nothing.
- **"none" AFTER photos already exist behaves exactly like "done"**: the
  flow completes and the photos are KEPT. Never discard stored photos
  because the engineer typed the other word.

**Approved copy, exact** (Tamil pair owed, NOT approved — not invented):

```
The question:
    Send photos of the issue. Reply none to skip, or done when finished.
First photo:
    1 photo saved. Send more, or reply done.
Subsequent photos (cumulative count):
    3 photos saved. Send more, or reply done.
```

## Is this a TS-only fix, or does it touch `apply_hindrance_flow_turn`?

**TS-only. No migration, no RPC signature or logic change, no external
review gate tripped.** Confirmed by the actual mechanism, not assumed:

- A photo arriving at Q3 has **never** reached `apply_hindrance_flow_turn`
  at all — `handleHindrancePhoto` (`lib/whatsapp/inbound-start.ts`) reads
  `whatsapp_sessions.current_step`/`context` directly, enqueues the
  `hindrance_media_ingest` job, and replies, entirely without calling the
  RPC. This was already true before this fix (migration 044's own SQL
  comment: "a photo arriving at step 3 is enqueued directly ... and reasks
  without calling this RPC"). Changing what that TypeScript function
  computes and replies with — a running count instead of a re-ask — touches
  none of that.
- "done"/"none"/any other non-empty text at Q3 already, unconditionally,
  completes the flow under the RPC's existing step-3 branch (any non-empty
  text → `v_complete := true`) — this was true before 044's own build and
  is unchanged by this fix. Copy now names "done" explicitly, but the
  underlying acceptance rule (any non-empty text closes the question) did
  not need to change to support it.
- "none after photos" already could not discard anything, structurally: the
  RPC's step-3 completion branch only ever flips
  `current_flow`/`current_step` and clears `hindrance_id`/
  `hindrance_unspecified` from session context — it has never touched
  `hindrance_photos` or the `jobs` table in either direction. There was no
  discard path to disable; there is still none to reintroduce.

Net: the fix is contained entirely to `handleHindrancePhoto`
(`lib/whatsapp/inbound-start.ts`), a new `HINDRANCE_QUESTIONS[3]` copy
string (`lib/whatsapp/flows/hindrance.ts`), and a new
`countReceivedHindrancePhotos` helper (`lib/media/hindrance-ingest.ts`)
mirroring the existing `countReceivedPhotos` (`lib/media/ingest.ts`) —
counting enqueued `hindrance_media_ingest` job rows' own `media` arrays for
this `hindrance_id`, not `hindrance_photos` table rows, for the same reason
`countReceivedPhotos` already documents: this is read synchronously, in the
same webhook turn that just enqueued the current job, before the async
ingest job has necessarily run.

## The generic "Photo saved. Type your reply for this question." prefix

`PHOTO_SAVED_REASK_PREFIX` (`lib/whatsapp/inbound-start.ts`) no longer fires
at hindrance Q3 — replaced by the new `buildHindrancePhotoAck` count
acknowledgement, which fires for every photo at Q3 regardless of caption.
This is a **scoped exception at this one question**, documented inline at
the constant's own definition and at `handleHindrancePhoto`'s own doc.

**Confirmed it still fires everywhere else, locked in by an existing
test** (not new — `test/media-ingest.test.ts` already asserted this before
this fix and continues to pass unchanged after it):
- Morning, captioned in-flow photo → `PHOTO_SAVED_REASK_PREFIX` + reask
  (`test/media-ingest.test.ts` line ~195).
- Evening, captioned in-flow photo → `PHOTO_SAVED_REASK_PREFIX` + reask
  (`test/media-ingest.test.ts` line ~130).
- Hindrance Q1/Q2 (before the row exists) is untouched by this fix — still
  uses `HINDRANCE_PHOTO_NOT_SAVED_YET_REPLY`, a separate constant, never
  `PHOTO_SAVED_REASK_PREFIX`.

## Tests

All in `test/hindrance-photos-flow.test.ts` unless noted, real test-db
throughout (`testClient()`, no mocks):

- First photo at Q3 is acknowledged with the exact singular copy
  (`"1 photo saved. Send more, or reply done."`), enqueues the ingest job,
  sets `photos_status='pending'`.
- A second photo increments the count to the exact plural copy
  (`"2 photos saved..."`) — cumulative for the hindrance.
- A captioned photo at Q3 is acknowledged identically to an uncaptioned one
  (no `PHOTO_SAVED_REASK_PREFIX`), and its caption is stored on the job
  payload only, never parsed as an answer.
- `"done"` completes the flow after photos have been sent.
- `"none"` with zero photos sent skips normally (unchanged from before this
  fix).
- `"none"` AFTER photos already exist completes identically to `"done"` and
  the two already-enqueued photo jobs are confirmed still present
  afterward — nothing discarded.
- `test/unit/hindrance-flow.test.ts` updated for the new exact `Q3` copy
  string.
- `test/media-ingest.test.ts` re-run unchanged, confirming the generic
  `PHOTO_SAVED_REASK_PREFIX` still fires for morning/evening.

31/31 tests green across the three affected files, run locally against
test-db. The full suite was not run locally, per this pass's own
instruction — CI is the gate.

## What this pass does NOT include

No database contact of any kind for the fix itself (pure TypeScript, no
migration file touched, no `supabase` CLI command run). A local test-db run
was used only to verify the fix (per this pass's own "run only the affected
test files locally" instruction) — never to apply or query anything against
prod. Not merged. Not linked to prod.
