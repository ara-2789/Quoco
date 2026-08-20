# Language observation — plan item, not a feature (Y2)

**Status: design only. Nothing here has been built.** Replaces the cancelled
onboarding "choose your language" step and the X2/X3 bilingual-template workstream
(`claude/whatsapp-templates-en-ta.md`).

## Why observation, not a question

A "choose your language" onboarding step costs a conversational turn (Rule 3.3: morning
flow target ≤90 seconds end-to-end — every extra question taxes that budget), needs its
own template (submitted, approved, billed), needs parsing to interpret the answer, and
changes nothing about what the engineer actually receives (output stays English
regardless, per Y1). It also asks for a STATED preference, which is aspirational — an
engineer might say "English" and then write every reply in Tamil, or the reverse. A stated
preference and an observed behavior can diverge, and the stated one is the less honest
signal.

**Instead: log the language of each inbound reply.** Free — the message is already in
hand for parsing regardless — and truthful, since it's derived from what the engineer
actually does, not what he says he'll do. After a few weeks of beta this answers
empirically whether Tamil-language OUTPUT is ever worth building: if inbound replies are
overwhelmingly English, the input-language freedom was already sufficient and no output
work is justified; if Tamil-script inbound is common, that's real evidence, not a guess,
for a future PHASE 2 decision (Rule 3.11's own existing framing).

**This is telemetry, not a feature.** Scope it that cheap.

## Where detection happens

At the same point every inbound message already passes through en route to a parser —
`app/api/whatsapp/webhook/route.ts`'s dispatch path, immediately after the Twilio
signature/idempotency checks and before (or alongside) `dispatchInboundTurn`. No new
network call, no new round trip: the message body is already in memory for parsing: reuse
it, don't refetch it.

**Detection method, kept deliberately cheap — script detection, not language
classification:** a message either contains Tamil Unicode codepoints (`஀`–`௿`,
the Tamil block) or it doesn't. This is NOT the same question as "what language is this,"
and should not be built to look like it is:
- Script detection is a single regex test, zero dependencies, zero latency, deterministic.
- Full language identification (is this Tamil, is this Tanglish/transliterated-Tamil-in-
  Latin-script, is this English with borrowed construction terms) needs either a
  library/model call (cost, latency, a new failure mode on the webhook's 15-second budget
  — CLAUDE.md §6) or heuristics nobody has validated yet.
- Script detection alone already answers the question this plan exists to answer: is
  Tamil SCRIPT actually showing up in real replies, at what rate, from which engineers.
  Transliterated Tamil in Latin script ("mesthiri", "illa" — already handled by
  `lexicon.ts`) is a SEPARATE, harder question (indistinguishable from English by script
  alone) and is explicitly OUT of this plan's cheap-telemetry scope — if script detection
  shows near-zero Tamil-script usage but the anecdotal sense is that transliterated Tamil
  is common, that is itself a finding worth acting on, not something this simple check
  needs to also solve.

Record, per inbound message: `has_tamil_script: boolean` (or equivalently, three buckets —
`tamil_script`, `latin_only`, `mixed` — see storage shape below for why three, not two).

## What is stored, against which table

**NOT a new column on `users`.** `users.preferred_language` is explicitly cancelled (Y1) —
a per-user column implies a STATED, persistent preference, which is exactly the
aspirational signal this plan avoids. The right grain is per-MESSAGE, not per-user: an
engineer's language mix can vary message to message (English for a number-heavy answer,
Tamil for a free-text one), and collapsing that into one user-level flag would throw away
the signal this plan exists to capture.

**Proposal: a column on `processed_messages`**, not a new table. `processed_messages`
already exists (011, idempotency dedupe on Twilio SID), already receives one row per
inbound message, and CLAUDE.md's own DATA RETENTION POSTURE already classifies it as pure
hygiene (prune freely, no compliance claim on it) — the right retention posture for
telemetry, not a business record. Add:

```sql
ALTER TABLE public.processed_messages
  ADD COLUMN inbound_script TEXT NULL
    CHECK (inbound_script IN ('latin_only', 'tamil_script', 'mixed'));
```

Nullable, no default, no backfill needed (historical rows simply have no signal — this is
observational data collected going forward, not a fact about the past that needs
reconstructing). `mixed` (both Latin and Tamil codepoints present) is its own bucket, not
folded into `tamil_script` — the three test cases this session verified (Y4a) were ALL
`mixed`, not `tamil_script`-only, and collapsing that distinction would hide the exact
shape ("mixed script is the normal case," per Y4's own framing) this telemetry is meant to
surface.

**Why not `whatsapp_sessions` or `daily_logs` instead:** `whatsapp_sessions` is
single-row-per-phone-number, overwritten in place — it cannot hold a per-message history,
only a current-session snapshot, wrong grain for this. `daily_logs` is the business
record; bolting telemetry onto it mixes hygiene-class data into a compliance-class table,
which CLAUDE.md's own three-way retention taxonomy (§10, DATA RETENTION POSTURE) argues
against by precedent — the two classes should not share a table's growth/retention story.

## What this is NOT

Not a trigger for anything. Not read by any consumer in Phase 1 — no dashboard chip, no
DPR field, no alert. It exists to be queried by hand after a few weeks of beta
(`SELECT inbound_script, count(*) FROM processed_messages GROUP BY inbound_script`), not
to drive any runtime decision. Building a consumer for it now would be exactly the kind of
premature feature-work Y2's own framing ("telemetry, not a feature") warns against.

## Not built here

This is a plan item, per the governing instruction ("design it as a plan item... nothing
here touches a database"). The migration above is a proposal, not a file in
`supabase/migrations/` — authoring it for real is a future, separately-authorized step,
same discipline as every other schema change in this project.
