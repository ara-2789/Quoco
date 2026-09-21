# Rediscovery without action — a separate finding from the migration/decision-staleness standing rule

Deliberately not filed as a row in a batch table. Aravind's own framing,
kept verbatim because paraphrasing it loses the point: *"A rediscovery
mechanism that produces rediscoveries and no action is worse than no
mechanism, because it manufactures the feeling of having handled
something."*

## The evidence

§1 (2026-07-28 or earlier) decides a PM-hierarchy-handoff mechanism for
engineer absences. It was never built. §28(d) (2026-08-21, five weeks
later) finds this, states it explicitly — *"§1's own decision... is
DEFERRED, not built... recorded explicitly so it isn't assumed built"* —
and still nothing moves. This audit (2026-09-05, two more weeks later)
found the identical gap a third time, independently, by reading the code
fresh before ever finding §28(d)'s own note.

Three finds. Zero builds. Two of the three finds were themselves correctly
labeled and clearly written — this was never a case of a vague or buried
warning nobody could act on.

## Why this is a different problem from the standing rule this audit has been collecting for

The migration/decision-staleness rule (§9, §14, §15, the 2026-08-14
pipeline swap, all recorded across batches 1–3) is about a decision going
stale **silently** — nobody notices, because nothing points back to it.
That rule's fix is a pointer: a cross-reference, a lint check, something
that makes the staleness visible.

§1/§28(d) is not that. The staleness here was never silent — §28(d) is
itself a working example of the "make it visible" fix, applied correctly,
by hand, once. It still didn't produce a build. A cross-reference rule
would not have helped here; §28(d) already *is* the cross-reference, and
the gap persisted through it anyway. Whatever closes this needs to attach
to something with actual consequence — an owner, a date, a build queue
entry — not another note, however well-written.

## Why this audit is itself at risk of becoming the third instance, not the fix

Recording this finding in a batch table, the same shape as every other
finding in batches 1–3, would make this document the third correctly-
labeled rediscovery of the same gap — proving the pattern it names rather
than breaking it. That is the reason this lives in its own file instead:
not because it's unrelated to the audit, but because folding it into the
audit's own output format would be the exact failure being described,
happening again, inside the document meant to catch it.

## Not solved here, per instruction

No build, no owner assignment, no CLAUDE.md standing rule added by this
entry. Recorded so it exists as its own item at the end-of-audit review,
alongside the migration/decision-staleness standing rule — a second,
distinct thing to decide what to do about, not folded into the first.
