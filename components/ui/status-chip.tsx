import { CircleAlert, CircleCheck, Clock, Info, TriangleAlert, type LucideIcon } from 'lucide-react'

// Status chip — the primary UI atom (docs/design-tokens.md §4).
// One inline-flex pill: [lucide icon] + [label]. Colour comes from exactly one
// of the four semantic token trios (§1); the text colour consumes the
// --color-status-* @theme aliases wired into app/globals.css (DASH-03 is their
// first consumer), while bg/border use the matching -50/-200 steps of the hue.
// Never icon-only, never a bare number — one chip states one status in words.

// 'muted' is neutral chrome (not a status colour) for the "not yet due" state —
// grey, so it never competes with the four semantic roles.
export type StatusVariant = 'blocked' | 'risk' | 'ok' | 'info' | 'muted'

// Full class strings (never interpolated) so Tailwind's JIT can see them.
const VARIANTS: Record<StatusVariant, { text: string; bg: string; border: string; Icon: LucideIcon }> = {
  blocked: { text: 'text-(--color-status-blocked)', bg: 'bg-red-50', border: 'border-red-200', Icon: CircleAlert },
  risk: { text: 'text-(--color-status-risk)', bg: 'bg-amber-50', border: 'border-amber-200', Icon: TriangleAlert },
  ok: { text: 'text-(--color-status-ok)', bg: 'bg-green-50', border: 'border-green-200', Icon: CircleCheck },
  info: { text: 'text-(--color-status-info)', bg: 'bg-blue-50', border: 'border-blue-200', Icon: Info },
  // UI shell restyle, slice 1 (Aravind, 2026-09-18): exact prototype hex —
  // #f3f4f6/#626964/#e5e7eb. blocked/risk/ok/info above already matched
  // the prototype's own equivalent hex values via the existing Tailwind
  // steps (red-50/700/200, amber-50/800/200, green-50/800/200, blue-50/
  // 800/200 — checked, not assumed), so only muted needed a real change.
  // #626964 has no exact Tailwind step, hence the arbitrary value; bg
  // moves from gray-50 to gray-100 (#f3f4f6); border (gray-200, #e5e7eb)
  // was already exact.
  muted: { text: 'text-[#626964]', bg: 'bg-gray-100', border: 'border-gray-200', Icon: Clock },
}

const SIZES = {
  sm: { pill: 'px-2 py-0.5 text-xs gap-1', icon: 'h-3 w-3' },
  default: { pill: 'px-2.5 py-1 text-sm gap-1.5', icon: 'h-4 w-4' },
} as const

export type StatusChipProps = {
  variant: StatusVariant
  label: string
  size?: keyof typeof SIZES
}

export function StatusChip({ variant, label, size = 'sm' }: StatusChipProps) {
  const { text, bg, border, Icon } = VARIANTS[variant]
  const s = SIZES[size]
  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${bg} ${border} ${text} ${s.pill}`}
    >
      <Icon className={s.icon} aria-hidden="true" />
      {label}
    </span>
  )
}
