// Project lifecycle tag — DELIBERATELY separate from StatusChip
// (components/ui/status-chip.tsx). Do not "helpfully" merge these two.
//
// WHY: docs/design-tokens.md §1 defines exactly four semantic colour roles
// (red/amber/green/blue), each a SITE-CONDITION JUDGMENT — is this project
// on-track, at-risk, blocked, or merely informational right now. StatusChip's
// `StatusVariant` models those four roles plus `muted` ("no judgment yet"),
// and §1's 2026-07-18 dated refinement is explicit that `muted` must never be
// extended to represent an actual site-condition judgment.
//
// A project's LIFECYCLE STATE (active / on_hold / completed / in_bidding /
// bids_submitted) is not a site-condition judgment at all — it's contract
// workflow metadata. Mapping it onto StatusVariant would force a fifth
// judgment-shaped meaning into a type that's deliberately capped at four,
// and forcing `bids_submitted` or `in_bidding` into `muted` would be exactly
// the extension §1's refinement forbids. This component exists so lifecycle
// state never has to borrow a semantic-judgment colour it isn't one of.
//
// Single flat visual treatment, on purpose: no colour-per-state, no icon —
// this is inert metadata chrome, not a signal competing with the four real
// status colours anywhere it appears alongside a StatusChip.

const SIZES = {
  sm: { pill: 'px-2 py-0.5 text-xs' },
  default: { pill: 'px-3 py-1 text-sm' },
} as const

const LABELS: Record<string, string> = {
  active: 'Active',
  on_hold: 'On hold',
  completed: 'Completed',
  in_bidding: 'Bidding',
  bids_submitted: 'Bid submitted',
}

// Out-of-contract value degrades legibly instead of throwing or leaking a raw
// snake_case string: underscores to spaces, first letter capitalised.
function humanise(status: string): string {
  const spaced = status.replace(/_/g, ' ')
  return spaced.charAt(0).toUpperCase() + spaced.slice(1)
}

export type ProjectStatusTagProps = {
  status: string
  size?: keyof typeof SIZES
  className?: string
}

export function ProjectStatusTag({ status, size = 'sm', className = '' }: ProjectStatusTagProps) {
  const label = LABELS[status] ?? humanise(status)
  const s = SIZES[size]
  return (
    <span
      className={`inline-flex items-center rounded-full border bg-gray-100 text-gray-700 border-gray-200 font-medium ${s.pill} ${className}`}
    >
      {label}
    </span>
  )
}
