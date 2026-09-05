# design-decisions-beta-feedback.md audit — Batch 4 (§31–§41), final batch

Per instruction: every section below states explicitly whether its verified
status was already true **before tonight** or was changed **by tonight's
own PRs** (C1, C2; C3 stayed parked). None of tonight's PRs touched
anything in this batch's range — all findings here predate tonight's
session entirely, several by days.

| # | Section | Self-label | Verified status | Before/after tonight |
|---|---|---|---|---|
| 31 | Stable-signature RPC refactor | DECIDED IN PRINCIPLE, NOT SCHEDULED | Confirmed still not scheduled — both RPCs still use named parameters, not JSONB, in the latest migration (035) | Unchanged — pre-existing |
| 32 | Parse-attempt corpus | RECORD ONLY, NOT SCHEDULED | Not independently re-verified this pass (self-labeled, no code claims to contradict) | Unchanged — pre-existing |
| 33 | Equipment units not hire rate | Record only → own addendum (h) says BUILT 2026-09-04 | **Confirmed BUILT**, and confirmed by the section's own dated addendum, written the day before tonight's session | **Pre-existing** — built and documented yesterday (PR #187), not touched by C1/C2 |
| 34 | checkin_escalations can't distinguish never-asked | OPEN, recorded | Not built — #192 (still open) only does bookkeeping, doesn't touch this distinction | Unchanged — pre-existing |
| 35 | Check-in window rules | DECIDED and BUILT | **Confirmed built** at the time (2026-08-26); the specific mechanism (`routeInboundMessage` refusing to start a flow) was later superseded by §38's full retirement of that code path — moot in a good way, not a regression | Unchanged — pre-existing |
| 36 | UNIQUE index on project_members(user_id) | DECIDED IN PRINCIPLE, NOT SCHEDULED | Confirmed still not built — no such index in any migration through 035 | Unchanged — pre-existing |
| 37 | Evening delivery gates on evening data | Six decisions, record only | **(c)/(d) confirmed BUILT** — `owner-deliver-dispatch.ts`'s `partitionEligibleRows`/`decideOwnerDeliveryRoute` gate on `evening_submitted_at` exactly as decided, and the exact draft copy is live verbatim in `lib/dpr/owner-no-report.ts`. (a)/(b)/(e)/(f) are scope/requirement notes, not code | Unchanged — pre-existing (PR #67-era work) |
| 38 | Inbound-start retirement, two new strings | DECIDED, built | **Confirmed built** — matches Batch 1's own finding (`routeInboundMessage` returns one of four static replies) | Unchanged — pre-existing |
| 39 | `EVENING_AWAITING_TRIGGER_REPLY` false promise on site-holiday | "RESOLVED-BY-DESIGN" (a design decision, not a code fix) | **Still live today** — see Finding J below | Unchanged — pre-existing, and still unbuilt |
| 40 | Evening template drops {{3}} | DECIDED, not built (explicitly, by its own text) | Confirmed not built — old two-template pair still live, per the section's own explicit statement | Unchanged — pre-existing |
| 41 | Photos as first-customer requirement | DECIDED, not built (docs-only reorder) | Confirmed not built — no photo/media code anywhere | Unchanged — pre-existing |

## Finding J — §39's bug is still live, confirmed against `main` today

§39 records a real, observed incident (2026-08-30): a site-holiday
engineer messaging after 18:30 IST gets told *"Your evening check-in will
arrive shortly"* — a promise `filterEveningRoster` has already, correctly,
ruled out for that exact engineer (site-holiday engineers are excluded
from the evening roster). The entry's own closing note says "RESOLVED-BY-
DESIGN" — but reading that phrase precisely: it records that a *design*
(the ad-hoc menu computing an attendance-aware header) was decided the
same day to fix this once built. It does not claim the fix was coded, and
says so explicitly: *"no copy drafted, no code written."*

Checked directly against `main` today, not inferred from the entry's own
framing: `lib/whatsapp/inbound-start.ts:161`'s `daily_logs` select still
reads only `morning_submitted_at, evening_submitted_at` — no `attendance`
column, the one-column addition §39 itself names as the fix. The bug is
unchanged, six days later, because the thing that actually resolves it
(the ad-hoc menu) is Fast-Follow and correctly unbuilt — "resolved by
design" described a decision, not a deployed state, and the section's own
table-of-contents position (inside a sequence of BUILT/CONFIRMED entries)
makes that easy to misread on a skim. Worth flagging precisely: this is a
real, currently-live, low-frequency (site-holiday + late-message specific)
but genuine false-promise bug, distinct from the file-size/pipeline-
staleness findings elsewhere in this audit — a live product defect, small
in blast radius, real today.

## A positive pattern worth naming, not just gaps

§31–41 correct each other explicitly and in place far more often than
§1–30 did — §39 states outright *"This also corrects §38(d) above"*; §40
states it "supersedes §28(s)... left as written, not rewritten, per this
file's own correction discipline"; §36 corrects its own citation on read
rather than silently propagating it. The later half of this document
visibly got better at the exact failure this whole audit has been
tracking. Worth recording as the positive counterpart to the "migration
reversed a decision" pattern — the discipline that closes it already
exists in this project's own recent history; it just hasn't been applied
retroactively to the earlier sections that needed it (Batch 1/2's
findings).

## End-of-audit synthesis

Four batches complete. Two standing items to decide, both deliberately
left open rather than resolved tonight:

1. **The migration/decision-staleness rule** (§9, §14, §15, the 2026-08-14
   pipeline swap, §28/§30's own tangle) — attaches to the MIGRATION per
   your reframing, not the document; same shape as tonight's own
   consumer-check rule, one level up.
2. **Rediscovery without action** (`docs/reviews/rediscovery-without-
   action-2026-09-05.md`) — §1/§28(d), a decision correctly labeled,
   correctly rediscovered once already, still never built. A different
   problem from (1); needs an owner/queue mechanism, not a pointer.

New from this batch: §39 is a live, confirmed, currently-unfixed bug — not
a documentation-staleness finding, an actual product defect, small and
specific but real. Recommend it get its own build item independent of both
standing-rule questions, since fixing it doesn't wait on either being
resolved.

**File-split note, final answer** (tracked across all four batches, not
acted on per instruction): `design-decisions-beta-feedback.md` is
211,092 chars (214,268 after the six SUPERSEDED pointers), already WARN.
A split by decade (§1–10/11–20/21–30/31–41, this audit's own batching)
would work mechanically, but batch 3's finding (§28/§30's cross-tangle)
and this batch's finding (§39↔§38, §36↔§35's citation fix) show real
decisions cross-reference across those boundaries constantly — a decade
split would cut live cross-references, not just file size. Better
candidate: split at the point this audit itself found the character
change in the document's own discipline — roughly §1–30 (pre-2026-08-20,
denser, less self-correcting) versus §31–41 (post-2026-08-20, actively
self-correcting) — but that's a judgment call for whoever owns the split,
not decided here.
