# LL2 — check-in test checklist (tonight + tomorrow)

**Provenance:** written in chat during the 2026-08-20 session (LL2), never previously
saved to disk. Recovered and committed verbatim on 2026-08-21 per direct instruction —
content below is unchanged from the original, including the verbatim expected replies.

**Status as of 2026-08-21:** the "tonight" row was executed and verified by database
read-back (SS1) — confirmed correct. The "tomorrow — full run" table below has NOT yet
been executed.

**CORRECTED (2026-08-25):** the "tomorrow — full run" morning rows below were wrong
about which question comes first — written pre-migration-030, when the plan question
was Q1. Rewritten against the actual post-030 flow shape, sourced from
`lib/whatsapp/flows/morning.ts`'s live constants, not from memory. The original,
already-wrong rows are not preserved inline (unlike this project's usual struck-through
correction style) since the whole point of this document is a script to run verbatim —
a struck-through wrong answer sitting next to the table invites sending the wrong text
by accident. This note is the correction record instead.

---

**Tonight (deterministic — it's 22:51 IST now, well past the 19:45 refusal boundary):**

Send anything, e.g. `hi`. Expect back, verbatim:

> Today's report is ready. Send your update tomorrow morning.

Any mismatch — wrong wording, silence, or a question instead — is a real problem, not a
judgment call.

**Tomorrow — full run.** Two corrections to your framing: evening's **Q6 was never
built** — `evening.ts`'s own header states it's explicitly out of scope — and morning's
own question order is **NOT** what an earlier version of this checklist said. The morning
flow migration (`030_morning_flow_attendance.sql`) renumbered it attendance-first; the
rows below were rewritten from `lib/whatsapp/flows/morning.ts`'s actual current constants
(`MORNING_QUESTIONS`, `MORNING_COMPLETE_REPLY`, `MORNING_SITE_HOLIDAY_REPLY`,
`MORNING_ABSENT_REPLY`), not from memory — see each row's own citation. The real flow is
morning Q1 attendance, Q2 plan, Q3 workers by trade, Q4 equipment (plus the NO-path
holiday follow-up, a genuine fork off Q1, shown separately below), then evening Q1, Q2,
conditional Q3, Q4a, Q4b, plus an auto-skippable equipment-hours question. Answering "no"
to morning **Q4** (below — equipment, not Q3; Q3 is now the workers question) makes that
auto-skip fire deterministically tomorrow, so the checklist below is fully pinned — no
branch left to chance except the ones flagged where they occur.

**Main run (the YES path — this is what continues into evening below):**

| # | Send | Expect back, verbatim | Source |
|---|---|---|---|
| 1 | `hi` | `Good morning. Are you on site today? Reply yes or no.` | `MORNING_QUESTIONS[1]`, `morning.ts:92` |
| 2 | `yes` ← the NO fork is shown separately below | `What's your *plan of action* for today?` | `MORNING_QUESTIONS[2]`, `morning.ts:93` |
| 3 | any plan, e.g. `Foundation work on block A` | `How many *workers* today? You can just send a number, or a breakdown like "12 mason 8 helper".` | `MORNING_QUESTIONS[3]`, `morning.ts:94` |
| 4 | `12` | `Any *equipment / machinery* on site? Send name + hire rate (e.g. "JCB 1500"), or reply "no" if none.` | `MORNING_QUESTIONS[4]`, `morning.ts:95` |
| 5 | `no` ← deliberate, makes step 15 below deterministic | `✅ Morning check-in complete. Have a productive day on site!` — **morning done** | `MORNING_COMPLETE_REPLY`, `morning.ts:99-100` |

**NO-path fork — attendance "no" at step 1, instead of `yes`.** Never reaches Q2–Q4;
completes in one more message. Two outcomes depending on the follow-up answer — pick
ONE, this is a genuine fork, not both at once. Skip this entirely if you sent `yes` above
and are running the main sequence.

| # | Send | Expect back, verbatim | Source |
|---|---|---|---|
| 1f | `no` (instead of step 1's `yes`) | `Is it a site holiday? Reply yes or no.` | `MORNING_QUESTIONS[5]`, `morning.ts:96` |
| 1f-yes | `yes` | `✅ Got it — site holiday recorded. No further check-ins needed today.` — **morning done, site holiday** | `MORNING_SITE_HOLIDAY_REPLY`, `morning.ts:110-111` |
| 1f-no | `no` (instead of `yes` at 1f) | `✅ Got it, thanks for letting us know. We'll still check in this evening.` — **morning done, absent** | `MORNING_ABSENT_REPLY`, `morning.ts:113-114` |

**Evening (continues from the main run above — the NO-path fork does not lead here in
this checklist; it stands alone):**

| # | Send | Expect back, verbatim |
|---|---|---|
| 11 | `hi` (any time after — no need to wait for 18:30) | `Evening check-in 🌇 What *work was completed* today? Add the quantity if you can — e.g. "slab concrete 120 sqm".` |
| 12 | e.g. `Foundation excavation completed 50 cum` | `Did you *meet today's plan*? Reply *yes* or *no*.` |
| 13 | **fork here:** `no` → | `Got it. What *stopped the plan* being met today?` |
| 13b | (if step 13 was `yes` instead) | jumps straight to the headcount question below — Q3 is skipped, not a bug |
| 14 | (only if step 13 was `no`) e.g. `Waited for cement delivery` | `How many *workers* are on site right now? Just send a number.` |
| 15 | `10` | `Were they *all productive*, or was anyone idle? Reply *yes* if all productive, or tell us how many were idle and why — e.g. "2 idle, waiting for cement".` |
| 16 | `yes` | `✅ Evening check-in complete. Thanks — rest well!` — **evening done, no equipment-hours question, because step 4 above was "no"** |

**Evening's own row text above was not re-verified against `evening.ts`'s current
constants in this pass** — out of scope for the morning-flow renumbering fix; flag
separately if evening's copy is also suspected stale.

At 19:45 IST, generation runs against real data for the first time this build has ever
seen in production.
