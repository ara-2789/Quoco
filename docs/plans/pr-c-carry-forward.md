# PR-C carry-forward (from the 050 close-out)

Written 2026-10-26. Four items PR-C must not lose. Nothing here is implemented. Fixture fix: not in the close-out PR.

1. **Overload rule.** The 050 DOWN guard counts exactly seven functions by name (`v_n <> 7`). PR-C must not add overloads of those seven names, or it must update both 050 DOWN files in the same PR.
   Source: `docs/reviews/050-down-testdb.sql` and `docs/reviews/050-down-prod.sql`, the `DOWN_PRECONDITION_050` block; `docs/reviews/050-closeout-record.md` section 5.

2. **Fixed clock.** The capture fixtures use the real clock, so a CI run that crosses 18:30Z (IST midnight) can fail. Run 40217915047 attempt 1 did. Fixtures must pass a fixed `p_now`.
   Source: `docs/reviews/050-closeout-record.md` section 3; `test/helpers/capture-fixtures.ts` (`makeDoc`, `miTurn`).

3. **D1 and the IST midnight case.** The open D1 decision (what `1`, `2`, `3` do after expiry) must also cover a session that crosses midnight: a session started at 23:59 is wiped at 00:00 by the IST-date rule, and the stale ack question can still be answered afterwards.
   Source: `docs/plans/slice-1a-plan-v3.md` section 12 D1, Q5 (N3, T-A27-8); `docs/plans/pr-b-050-plan.md` lines 319 and 479.

4. **PITR is off until launch.** Every FULL-tier prod apply records "PITR substituted", with prod-captured bodies and a DOWN, until the switch trigger fires.
   Source: `docs/reviews/050-closeout-record.md` section 6 (per Aravind, 2026-10-26); CLAUDE.md section 0, "SWITCH TRIGGER".
