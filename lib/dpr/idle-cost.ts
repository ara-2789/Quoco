import type { CapturedNumber } from './schema'

// Pure arithmetic — the ONE place idle cost is computed, per bot-flows.md's
// "Compute IN CODE" rule. Deliberately dumb: this function does not decide
// whether a daily_hire_cost is trustworthy (CLAUDE.md §10's "A COUNT IN A
// MONEY FIELD" debt — daily_hire_cost can be a miscaptured count, not a real
// rate). That decision happens upstream, by whoever assembles Facts from
// daily_logs; this function's only contract is: if ANY input isn't cleanly
// 'reported', the result is 'not_captured' — it never computes off a partial
// or untrusted input, silently or otherwise. Suppressing idle_cost when the
// rate is untrusted is therefore just the caller setting daily_hire_cost's
// status to 'not_captured' before calling this — no separate trust parameter
// needed here.

export function computeIdleCost(
  available_hours: CapturedNumber,
  actual_hours: CapturedNumber,
  daily_hire_cost: CapturedNumber,
): CapturedNumber {
  if (
    available_hours.status !== 'reported' ||
    actual_hours.status !== 'reported' ||
    daily_hire_cost.status !== 'reported' ||
    available_hours.value === null ||
    actual_hours.value === null ||
    daily_hire_cost.value === null
  ) {
    return { status: 'not_captured', value: null }
  }

  // Defensive, not expected in practice: the Q5 parser's own ARITHMETIC
  // GUARDS (lib/whatsapp/flows/parsers/equipment-hours.ts) already reject
  // actual_hours > available_hours and available_hours > 24 at parse time,
  // so a Fact reaching here should never carry either. Guarded again anyway
  // — this function has no way to know a caller bypassed that parser (a
  // manually-constructed Fact, a future second source of equipment data),
  // and a negative or absurd idle-cost figure stated as fact in an owner
  // report is a worse failure than an extra branch here.
  if (available_hours.value <= 0 || available_hours.value > 24 || actual_hours.value > available_hours.value) {
    return { status: 'not_captured', value: null }
  }

  return {
    status: 'reported',
    value: daily_hire_cost.value * (1 - actual_hours.value / available_hours.value),
  }
}
