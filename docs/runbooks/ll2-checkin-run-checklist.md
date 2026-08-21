# LL2 — check-in test checklist (tonight + tomorrow)

**Provenance:** written in chat during the 2026-08-20 session (LL2), never previously
saved to disk. Recovered and committed verbatim on 2026-08-21 per direct instruction —
content below is unchanged from the original, including the verbatim expected replies.

**Status as of 2026-08-21:** the "tonight" row was executed and verified by database
read-back (SS1) — confirmed correct. The "tomorrow — full run" table below has NOT yet
been executed.

---

**Tonight (deterministic — it's 22:51 IST now, well past the 19:45 refusal boundary):**

Send anything, e.g. `hi`. Expect back, verbatim:

> Today's report is ready. Send your update tomorrow morning.

Any mismatch — wrong wording, silence, or a question instead — is a real problem, not a
judgment call.

**Tomorrow — full run.** One correction to your framing first: evening's **Q6 was never
built** — `evening.ts`'s own header states it's explicitly out of scope. The real flow is
morning Q1–Q4, evening Q1, Q2, conditional Q3, Q4a, Q4b, plus an auto-skippable
equipment-hours question. Answering "no" to morning Q3 (below) makes that auto-skip fire
deterministically tomorrow, so the checklist below is fully pinned — no branch left to
chance except one, flagged where it occurs.

| # | Send | Expect back, verbatim |
|---|---|---|
| 1 | `hi` | `Good morning! 🌞 What's your *plan of action* for today?` |
| 2 | any plan, e.g. `Foundation work on block A` | `How many *workers* today? You can just send a number, or a breakdown like "12 mason 8 helper".` |
| 3 | `12` | `Any *equipment / machinery* on site? Send name + hire rate (e.g. "JCB 1500"), or reply "no" if none.` |
| 4 | `no` ← deliberate, makes step 12 below deterministic | `Got it. How will the work be carried out — your *execution method / sequence* for today?` |
| 5 | any plan, e.g. `Excavation first, then shuttering` | `✅ Morning check-in complete. Have a productive day on site!` — **morning done** |
| 6 | `hi` (any time after — no need to wait for 18:30) | `Evening check-in 🌇 What *work was completed* today? Add the quantity if you can — e.g. "slab concrete 120 sqm".` |
| 7 | e.g. `Foundation excavation completed 50 cum` | `Did you *meet today's plan*? Reply *yes* or *no*.` |
| 8 | **fork here:** `no` → | `Got it. What *stopped the plan* being met today?` |
| 8b | (if step 8 was `yes` instead) | jumps straight to the headcount question below — Q3 is skipped, not a bug |
| 9 | (only if step 8 was `no`) e.g. `Waited for cement delivery` | `How many *workers* are on site right now? Just send a number.` |
| 10 | `10` | `Were they *all productive*, or was anyone idle? Reply *yes* if all productive, or tell us how many were idle and why — e.g. "2 idle, waiting for cement".` |
| 11 | `yes` | `✅ Evening check-in complete. Thanks — rest well!` — **evening done, no equipment-hours question, because step 4 above was "no"** |

At 19:45 IST, generation runs against real data for the first time this build has ever
seen in production.
