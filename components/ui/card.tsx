import type { HTMLAttributes } from 'react'

// UI shell restyle, slice 1 (Aravind, 2026-09-18; design reference: his
// prototype, not copied into this repo). White(ish) surface for content
// sitting on the new --brand-canvas page background: --brand-paper,
// 1px --brand-border, 9px radius, a subtle shadow. Presentation only — no
// data, no variants beyond what a caller's own className adds (padding,
// width, text-align, etc.), matching the shadcn-free "plain div" style
// this codebase already uses for every other card-shaped container.

export function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={`rounded-[9px] border border-brand-border bg-brand-paper shadow-sm ${className}`}
      {...props}
    />
  )
}
