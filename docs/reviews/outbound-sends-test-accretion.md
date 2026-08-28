# `outbound_sends` test-suite accretion — finding, fix, and the rule

**Recorded 2026-08-28.** This document records a finding surfaced during
Pass 1's outbound-send-primitive work (item B, PR #120), caught during a
cross-session coordination checkpoint the same day, and fixed the same day
(PR #123, `88566bd`). It is a completed fix, not an open item — recorded
here so the mechanism, the numbers, and the rule survive past the chat
turn they were found in.

## The mechanism

`outbound_sends` (migration 031) has **no `DELETE` grant for any role**,
including `service_role`, and its `project_id`/`tenant_id`/
`recipient_user_id` foreign keys are all `ON DELETE RESTRICT` — deliberate,
per that migration's own header: a durable send ledger, not a queue to be
pruned, retention presumed indefinite.

The consequence for a test fixture: any test that writes a row into
`outbound_sends` permanently pins every row it references — the `users`
row it names as `recipient_user_id`, and transitively the `tenants` and
`projects` rows those chain to. `RESTRICT` blocks deleting the *parent*
while a referencing child exists, and nothing can delete the child in the
first place. Accretion climbs the FK graph: a fixture that mints a fresh
`users` row per test doesn't cost one throwaway row — it costs one row
that outlives the test run, the CI job, and the branch, forever.

## What already exists, quantified

Checked live, read-only, against test-db (`exfccwlrhoutkgrlikod`), as of
the last CI run before the fix below landed:

| Table | Rows under this suite | Removable by any code path |
|---|---|---|
| `users` | 35 | No — `outbound_sends`' RESTRICT FK blocks it |
| `outbound_sends` | 78 | No — no DELETE grant for any role |
| `whatsapp_sessions` | 15 | Yes (see the second hazard below) — but not touched here |

These rows are **not touched by the fix below and are not to be** —
removal was explicitly out of scope for this work, per the same
project-wide principle that blocked `outbound_sends` cleanup elsewhere
(CLAUDE.md's own ACCRETION, NAMED AND ACCEPTED framing): an operator
action under this project's breadcrumb discipline, if it is ever
warranted, never a code path reached for by a test file.

## The bug

`mintOutboundEngineer()` — the function that inserts a fresh `users` row
for a test engineer — was called from inside every `it()` block in
`test/outbound-trigger.test.ts`, not once per suite run. The file has 10
`it()` blocks; one (the evening-template-selection test) mints twice for
its two sub-scenarios, for 11 calls total. One full CI run therefore
permanently added **11 `users` rows**, not the 1-per-run the file's own
header comment claimed at the time.

This went undetected through the file's own review and merge (PR #120)
because nothing in that review checked the *call frequency* against the
*claimed* rate — the claim ("bounded, one extra row per CI run") was never
re-derived from the actual code, only carried forward as a stated
assumption. It surfaced only because a separate, unrelated coordination
checkpoint asked for an exact count of test-db objects created, and the
count didn't match the header's own claim.

**Fixed to 1 row per run — verified live, not asserted.** The fix (below)
was confirmed by checking the actual CI run it triggered: exactly 1 new
`users` row, timestamped to that run, not 11.

## The fix

`mintOutboundEngineer()` now runs once, in the `describe` block's own
`beforeAll`, and the resulting engineer is shared across every test. Per-
test uniqueness against `outbound_sends`' own
`UNIQUE(tenant_id, recipient_user_id, event_key)` constraint moved from
`recipient_user_id` (a fresh row per test) to the **date half of
`event_key`** (a fresh string per test) — eleven reserved `LOG_DATE_*`
constants, `2026-09-01` through `2026-09-11`, one per `it()` block plus one
extra for the template-selection test's second sub-scenario. That test
needed two dates, not two engineers — the same shared engineer works for
both halves once each half has its own date.

## The rule, so the next person does not reinvent it

**Carry per-test uniqueness on a string already part of the key — a date,
an event_key, a label — never on a newly minted `users`/engineer row,
whenever the table the constraint lives on sits downstream of a
no-DELETE-grant, `RESTRICT`-FK'd table.** A minted row is free to create
and permanent the instant anything references it; a string costs nothing
and leaves nothing behind. Recorded in `test/helpers/db.ts`, alongside the
reserved phone/prefix blocks (PR #122), where the next fixture author will
actually see it before writing a new one.

## The second hazard, found while implementing — the framing missed it

Sharing one engineer across every test introduces a hazard the
mint-per-test design never had: `whatsapp_sessions` is keyed by
`phone_number` **alone** — no `event_key` or date dimension at all, unlike
`outbound_sends`. With one shared engineer, every test in the file shares
one session row.

`apply_{morning,evening}_flow_turn`'s own `startFlow` branch (mirrored in
`dispatchMorningFlow`/`dispatchEveningFlow`) only produces outcome
`'start'` when `session.current_flow IS NULL` — otherwise it falls into
`'reask'` and leaves the row untouched. Left unhandled, the **first** test
in the file to reach a 2xx delivery would permanently set `current_flow`
to non-null, and every later test asserting either a genuine `'start'`
activation or `session === null` (no activation) would silently stop
testing what its own name claims — the test would keep **passing**, but
for a reason unrelated to what it exercises. A green suite would have
proven nothing about activation correctness past the first delivering
test.

**Fix:** a `beforeEach` deletes the shared engineer's `whatsapp_sessions`
row before every test (plus one extra reset mid-test, for the
template-selection test's two sequential deliveries), reproducing the
same "no row exists yet" starting state the old mint-per-test design got
for free. `whatsapp_sessions`, unlike `outbound_sends`, does carry a
`DELETE` grant — `test/unit/morning-cutoff-sweep.test.ts` already deletes
rows from this same table by `phone_number`, so this is an established
pattern in this suite, not a new capability introduced here.

## Where the fix lives

`test/outbound-trigger.test.ts` and `test/helpers/db.ts`, PR #123
(`88566bd`), merged to `main` via `c9679a2`. Test-file change only — no
schema, no migration, no §0 external-review-gate trigger.
