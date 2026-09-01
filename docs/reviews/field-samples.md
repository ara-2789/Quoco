# Real field samples — WhatsApp check-in messages, as actually received

**This file did not exist before this entry.** Checked directly, not assumed: no
raw-inbound-text corpus exists anywhere in this repo. `lib/dpr/eval/` exists and is real —
`cases/` (asserted golden Facts fixtures: `case-complete-two-engineer-day.ts`,
`case-morning-missing-evening-present.ts`, `case-manpower-equipment-not-captured.ts`) and
`manual-cases/` (human-reviewed, non-asserted: `case-vernacular-answers.ts`) — but every
file in it starts from an already-STRUCTURED `Facts` object (`ExecutionOutputFacts`,
`ManpowerFacts`, etc.), never from raw engineer text. That harness tests parsing's OUTPUT
and the model's rendering of it; nothing in this repo captures parsing's INPUT — a real
message, unparsed, as an engineer actually sent it. This file is that corpus's home,
created now because the standing "cofounder vernacular WhatsApp examples" open item
(since 2026-07-26) never had one, and this sample — a real field message, not one of the
seven cofounder samples judged too clean — should not sit lost in a WhatsApp thread while
that gap stays open.

Also relevant, not a duplicate: `design-decisions-beta-feedback.md` §32 ("Parse-attempt
corpus... RECORD ONLY, NOT SCHEDULED") already decided this project wants an ongoing,
DB-backed corpus of every real parse attempt, captured automatically. That mechanism does
not exist yet either. This file is a manual, by-hand instance of exactly what §32
eventually wants to do systematically — not a replacement for it, and not evidence it's
been built.

---

## Sample 1 — 2026-08-26, real site engineer, unprompted

Received 2026-08-26. Sent by a real site engineer, unprompted, in his own format — not
written for Quoco, not one of the seven cofounder samples (those were judged too clean to
be representative). This is the first genuine field sample this project has. It sat in a
WhatsApp thread for two days before being captured here.

**Verbatim — spacing, asterisks, capitalisation, and the "P.EB" inconsistency preserved
exactly, byte for byte, not cleaned up:**

```
26.08.2026
 work plan
*Canteen building Brick work-  4m³
*Security Building Plastering preparation work - 30 sq.m
*EB building sill concrete - 0.5m³
Roller compaction - 1900sq.m
PEB work:
*sag rod fixing from grid ( A-B/15-19)
*East side purlin work from grid A1 to E1
Labours strength
Civil - 25 Nos
P.EB - 11 Nos
Total - 36 Nos.
```

### What this demonstrates

**a. Planned quantities appear unprompted — evidence, not a reversal of §28(m).**
4m³, 30 sq.m, 0.5m³, 1900 sq.m all appear against morning plan-of-action items, entirely
unasked. `design-decisions-beta-feedback.md` §28(m) ("NO PLAN-VS-ACTUAL REPORTING")
decided morning and evening are never compared "because morning Q2 has no quantity to
compare against" — and §28(l)'s own Q2 spec is explicit: "free text, captured verbatim,
**NO quantities** → `morning_plan`." That reasoning is still sound for what the SYSTEM
ASKS (Q2 asks for a plan, not a quantity) — but this sample shows an engineer supplying
exact, structured quantities against his own plan items without being asked to, in his
own natural reporting format. Recorded as field evidence that the underlying data exists
and could be captured if a future pass asks for it — not as a case for reopening §28(m)'s
decision, which was never about whether engineers HAVE quantities to give, only about
whether the SYSTEM currently asks morning to produce a number to compare evening against.

**b. Labour is reported by discipline, not by trade — the real cost of §33's... no,
§28(l)/§28(r)'s enforcement, corrected citation below.** "Civil - 25 Nos, P.EB - 11 Nos" —
two broad disciplines, not the trade-level breakdown (`mason`, `helper`, `bar-bender`,
etc.) the product's own morning/evening Q3 shape expects. **Citation check, done before
writing this down:** the original framing for this finding cited "§33" for "trades are
enforced in the product" — checked directly, and §33 ("Equipment captures units, not hire
rate — seven decisions, 2026-08-25") is about equipment capture, not labour trades at
all; that citation was wrong. The correct citations are **§28(l)** ("Q3 Workers by
trade → `morning_manpower`," evening Q2 mirrors it) and **§28(r)** ("VOCABULARY — now
load-bearing and blocking": a fixed lexicon of 7 canonical trades, 26 aliases, single-
token positional matching) — trade-level capture and a fixed vocabulary are both real,
decided, enforced shapes in this product. This sample is the field evidence of what that
enforcement actually costs: the engineer does not hold the number this way at all. He
holds two totals — Civil and P.EB (a mechanical/electrical/plumbing-adjacent discipline
bucket, inconsistently abbreviated even within his own message) — summing to a stated
total (36) that the message itself cross-checks. Directly relevant to **§6**'s own
"Controlled vocabulary" decision (buttons/numbered options, not free text, because "the
efficiency joins die on free-text trade names") and to `productivity_standards`' own
denominator (§6: `Efficiency % = actual output ÷ (headcount × standard)`) — a standard
keyed on individual trades cannot be checked against a headcount this engineer only ever
reports at the discipline level.

**c. A real day is six activities across four structures — untested against any parser.**
Canteen building, Security Building, EB building, roller compaction (unnamed structure),
PEB work (two sub-items: sag-rod fixing, purlin work) — six distinct line items across at
least four named structures/areas in one message. Nothing in this codebase's own parser
test suites (`parseLabourCount`, `parseEquipment`, `parseQuantities`, or any T-PR test)
has ever been exercised against a list this long or this structured. Recorded as an
untested case, not a claim that anything currently fails against it — morning Q2 stores
this whole block as opaque free text today (see "How this is handled today," below), so
no PARSER currently even attempts to read it; the untested gap is for whenever a future
pass tries to.

**d. Format details worth keeping, for whoever eventually designs a real parser against
messages shaped like this:**
- Asterisk-prefixed bullets (`*Canteen building...`) mixed with un-prefixed lines
  (`Roller compaction...`, `Civil - 25 Nos`) in the SAME message — not a consistent
  convention even within one engineer's own habit.
- A leading date header on its own line (`26.08.2026`), followed by a section label
  (` work plan`, indented, lowercase) before any content.
- Grid/location references embedded in free text (`grid ( A-B/15-19)`, `grid A1 to E1`) —
  a structural-drawing coordinate system with its own punctuation (parentheses, a hyphen
  for a range, a slash for a second axis), not something any current field or parser
  expects.
- The same discipline named two different ways in one message — `PEB work:` as a section
  header, `P.EB - 11 Nos` in the labour summary. A real engineer's own inconsistency, not
  a typo to silently normalise away if this ever becomes a golden fixture — preserved
  verbatim above specifically so a future parser test can assert against BOTH spellings
  resolving to the same discipline, not just one.

### How this would be handled today — verified against the actual current code, not assumed

**Unprompted, before any flow is active:** `routeInboundMessage`
(`lib/whatsapp/inbound-start.ts`) is retired as of 2026-08-28 (this same repo, `main`).
Before retirement, an idle inbound like this would have started the morning flow via
`applyMorningFlowTurn(startFlow: true)` — and confirmed directly against
`dispatchMorningFlow`'s own `startFlow` branch: when `current_flow === null`, the outcome
is unconditionally `'start'`, which sets `current_step: 1` and asks Q1 (attendance) fresh
— **the inbound message's own text, this entire work-plan block, would never have been
read as an answer to anything. It would have been silently discarded**, and Q1 sent back
in its place. **Post-retirement, it does even less**: `routeInboundMessage`'s idle branch
now returns one of four static acknowledgement replies (`design-decisions-beta-feedback.md`
§38) with no RPC call, no session write, and no read of the message body beyond the
`daily_logs` submission-state lookup used to pick which of the four replies to send. The
message text is not stored anywhere, not even transiently.

**If pasted as the literal answer to the real Q2 (plan-of-action) question**, once a
flow is genuinely active and has reached step 2: verified directly against
`lib/whatsapp/flows/morning.ts`'s own step-2 branch —

```ts
} else if (session.current_step === 2) {
  // Q2 (free text) -> morning_plan, advance to Q3. Old step 1's logic,
  // moved here verbatim.
  outcome = 'advance'
  sessionUpdate = { current_step: 3 }
  dailyLogWrite = { morning_plan: text }
}
```

`text` is the inbound message after `.trim()` only — no other normalisation, no parsing,
no quantity extraction of any kind. **It lands in `daily_logs.morning_plan` exactly as
typed, asterisks and all, minus only leading/trailing whitespace.** Every quantity in the
sample (a, above), the grid references (d, above), and the discipline labels (b, above)
would all be stored as inert characters inside one free-text column — structurally
identical, to this codebase, to a plain one-line plan like "pour slab on level 3." Nothing
downstream of Q2 reads any structure out of `morning_plan` at all today.

### First entry in the golden test set — recorded so it is not lost when that work begins

**Correcting the premise this was framed under:** the DPR eval harness itself is not
unbuilt — `lib/dpr/eval/` is real, with real golden Facts fixtures already asserted in CI
(see this file's own header). What does not exist is a golden set of RAW, PRE-PARSE INPUT
SAMPLES — real messages, not synthetic ones, not already-structured Facts — anywhere in
this repo. In that specific, narrower sense, **Sample 1 above is the first entry**: the
first real-world raw input this project has on record, ahead of whatever parser or
eval-harness-input-layer work eventually reads it. When that work begins, this file (or
wherever its contents migrate to) is where to start, not a WhatsApp thread two days
(or longer, by then) stale.

---

## Sample 2 — 2026-08-31, real site engineer, first successful automated trigger

Received 2026-08-31, in reply to the first `app/api/cron/morning-trigger` fire that
delivered end to end (`docs/reviews/first-successful-delivery-record.md`). Same engineer
and project as Sample 1 (Vikram Rao, Speed Mechatronics) — a second data point from the
same real user, not a second user, worth stating plainly before drawing any pattern from
two samples.

**Morning Q2 (plan of action) answer, verbatim, as stored in `daily_logs.morning_plan`:**

```
Land excavation - 3 m3
```

### What this demonstrates

**Two samples, same behaviour — accumulating evidence for §28(m)'s reasoning, not a
reversal of it.** Exactly like Sample 1's "4m³, 30 sq.m, 0.5m³, 1900 sq.m" against its own
plan items, this answer carries a planned quantity — **"3 m3"** — attached to a Q2 answer
the system never asked to be quantified. `design-decisions-beta-feedback.md` §28(m) ("NO
PLAN-VS-ACTUAL REPORTING") and §28(l)'s Q2 spec ("free text, captured verbatim, NO
quantities → `morning_plan`") are unchanged by this: the system still asks for a plan, not
a number, and still has nothing on the evening side shaped to compare against one even
when a number arrives anyway. What two samples now show, that one could not, is that this
is not a one-off habit of a single verbose message (Sample 1 was six line items across
four structures; Sample 2 is one line, five words) — the SAME engineer, on two different
days, in two very different message shapes, both volunteered a quantity against a plan
item unprompted. The evidence is about what engineers naturally supply, not about how they
format it.

**Stored exactly as before — confirmed against the same code path, not re-derived.**
`morning.ts`'s step-2 branch (quoted in Sample 1's own "How this is handled today"
section) is unchanged: `text.trim()` only, no parsing, no quantity extraction. "3 m3"
lands in `morning_plan` as inert characters inside one free-text column, identical in kind
to Sample 1's four quantities and to a plain unquantified plan like "pour slab on level
3." Nothing downstream of Q2 reads any structure out of this column today, on either
sample.

**One difference worth naming, not over-reading:** Sample 1 arrived unprompted, before any
flow was active, under the now-retired inbound-start scaffolding (§38). Sample 2 arrived
as a genuine Q2 answer inside an active, cron-triggered flow — the intended path, not a
side effect of a since-removed behaviour. The quantity-volunteering pattern held across
both circumstances; nothing about which trigger mechanism was in use appears to affect it,
though two samples is not enough to call that finding load-bearing on its own.

---

## Sample 3 — 2026-09-01, evening Q4 step 2 (productivity/idle) answer

Received 2026-09-01, same engineer and project as Samples 1-2 (Vikram Rao, Speed
Mechatronics). Captured as part of `docs/reviews/033-first-sweep-record.md` (B3's first
real production sweep of a genuinely parked morning session, same day) — recorded here
because it's a real productivity/idle answer, not because it relates to the sweep itself.

**Q4 step 2 answer, verbatim, as stored in `daily_logs.evening_productive_manpower`:**

```
No , no work for 4
```

Full stored value (`daily_logs`, `log_date = 2026-09-01`, `engineer_id =
3534756b-2a32-4b91-954b-0bab15c2dba1`):

```json
{
  "raw_text": "No , no work for 4",
  "productive_count": 12,
  "idle_count": 4,
  "idle_reason": "work for",
  "confidence": "high"
}
```

Context from the same row: `evening_workers_on_site = 16` (Q4 step 1, the headcount this
answer is reconciled against), `morning_manpower.total = 12` (this same engineer's own
morning headcount, coincidentally equal to today's `productive_count` — not causally
related; see below for the real derivation).

### What this demonstrates — traced against the live parser, not assumed

**a. A real "no, with a number and an unfinished reason" answer — not a template match.**
"No , no work for 4" answers "All productive, or any idle? If idle: how many + why?" the
way a real person answers a compound question under one breath: a flat "no" (not all
productive), then a number, then the start of a reason that never actually finishes ("work
for" — for what is never said). No cofounder sample or prior field sample looks like this.

**b. `idle_count = 4` — the single-unanchored-number default, not an anchor match.**
`parseProductivity` (`lib/whatsapp/flows/parsers/productivity.ts`) tokenizes to `["no",
"no", "work", "for", "4"]`. The message contains neither anchor word ("idle" or
"productive"), so PASS 1's anchor-adjacent scan (the file's own "ANCHOR-WORD PAIRING" logic)
finds nothing to pair. PASS 2 then finds exactly one unclaimed digit ("4") with `idle_count`
still `null`, and assigns it there — the parser's documented default for a bare-number idle
answer with no anchor at all, exercised here by a real message for what may be the first
time (this parser's own header names only synthetic/reviewed examples, all containing the
literal word "idle").

**c. `idle_reason = "work for"` — a correct, not a broken, extraction of an incomplete
reason.** `classifyYesNo` matches the first "no" as a NO_WORD, and `PRODUCTIVITY_STOPWORDS`
(`lexicon.ts:408`) spreads `NO_WORDS` into itself specifically so a classification word like
"no" doesn't leak into the reason text — confirmed both "no" tokens are stripped as
stopwords, "4" is stripped as the already-claimed count, and "work"/"for" (neither a
stopword) are what's left, joined verbatim. **The engineer never actually stated a cause**
("work for" what — material, drawings, instructions? — is never said); `idle_reason`
faithfully reflects that omission rather than fabricating a plausible-sounding cause. Field
evidence that this parser's reason-extraction can produce a genuinely uninformative but
*honest* string, not a defect to fix — the alternative (guessing a cause) is the exact class
of fabrication this parser's own header (`THE GENERAL GUARD`) is built to avoid.

**d. `productive_count = 12` is derived, not parsed — reconciled correctly against the real
headcount.** `parse.productive_count` from the file above is `null` (the word "productive"
never appears in the message). The actual `12` comes from `lib/whatsapp/flows/evening.ts`'s
own reconciliation (`evening.ts:562-586`): since `parse.productive_count` is `null`, it falls
to the plain-derivation branch, `Math.max(headcount - idleCount, 0)` — `headcount` here is
today's `evening_workers_on_site` (**16**, this evening's own Q4-step-1 answer), not
`morning_manpower.total` (**12**, this morning's headcount — the same number appearing in
both fields today is coincidence, traced through the code rather than assumed from the
matching value). `16 - 4 = 12`, `confidence: 'high'` (answered, headcount known, no
arithmetic-guard trip — `idle_count(4) ≤ headcount(16)`).

**e. No trade-level breakdown exists to evaluate — named precisely, not conflated with a
different function.** No function named `parseIdleHoursByTrade` exists in this codebase
(grepped, zero hits) — the parser that actually produced this sample is `parseProductivity`,
whose own header documents it as **AGGREGATE-ONLY v1, decided** (`design-decisions-beta-
feedback.md` §9): a total idle count + one free-text reason, with trade-level idle
attribution explicitly deferred (canonicalTrade's silent-failure risk, Civil-biased
vernacular coverage, multi-word-trade tokenizer gap — same three reasons Sample 1's own §28
finding already named for `morning_manpower`'s trade capture). This sample is real evidence
for *that* design, not for a not-yet-built trade-level parser: a genuine field answer that
names no trade at all ("no work for 4" — four of what, doing what, is never specified)
directly supports the decision to ship aggregate-only rather than assume engineers report
idle time trade-by-trade in the first place.
