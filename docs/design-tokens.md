# QUOCO — Design Tokens (implementation values for the visual system)
# Source of truth for the RULES: docs/design-principles.md §6 (VISUAL DESIGN SYSTEM).
# This file is the concrete-value layer under those rules — hex, Tailwind classes,
# sizes, weights, the icon library, and component/empty-state patterns.
# Created 2026-07-16, ahead of DASH-03 (first dashboard screen). Reviewed & approved
# before any component code was written.
#
# STATUS: WIRED IN DASH-03 (2026-07-18). The §1 @theme custom properties are now
# defined in app/globals.css and consumed by components/ui/status-chip.tsx (their
# first consumer). The pre-DASH-03 status of this file was: "PROPOSAL — not yet
# wired; none of the tokens exist in globals.css yet." That is no longer true —
# --color-status-* are live and may be referenced in code.

## Environment (verified against the repo, 2026-07-16)

- Tailwind **v4** (`^4.3.1`) — CSS-first config. Tokens live in `@theme` inside
  `app/globals.css`. There is **no `tailwind.config.js`**.
- Next 16.2.9 / React 19.2.4. Font: Geist Sans (`--font-geist-sans`, via `next/font`).
- shadcn/ui is NOT initialized — status chips/tokens don't need it (see CLAUDE.md §3
  dated note). Adopt shadcn only when a component needs accessibility primitives.
- Tailwind v4's default palette is OKLCH-based; the hex values below are the nominal
  sRGB equivalents and should be treated as ~approximate — the authoritative reference
  is the Tailwind class name, not the hex.

---

## 1. COLOR — §6 "4-color semantic system only"

Four semantic roles, each rendered as a **status chip** = light background + dark text +
subtle border. This extends the one convention already in the codebase (`bg-red-50` +
`text-red-700` in the existing error UI) to all four roles.

| Role (§6) | Meaning | bg | text | border | text-on-chip contrast | hex (approx: bg / text) |
|-----------|---------|----|------|--------|-----------------------|--------------------------|
| **Red**   | blocked / missing-critical | `bg-red-50`   | `text-red-700`   | `border-red-200`   | ~5.9:1 ✅ AA | #fef2f2 / #b91c1c |
| **Amber** | at-risk / legitimate-gap   | `bg-amber-50` | `text-amber-800` | `border-amber-200` | ~7:1  ✅ AA | #fffbeb / #92400e |
| **Green** | on-track                   | `bg-green-50` | `text-green-800` | `border-green-200` | ~7.4:1 ✅ AA | #f0fdf4 / #166534 |
| **Blue**  | informational              | `bg-blue-50`  | `text-blue-800`  | `border-blue-200`  | ~8:1  ✅ AA | #eff6ff / #1e40af |

**DATED REFINEMENT (2026-07-18, per DASH-03):** Amber's role is narrowed to
genuine open gaps; legitimately-excluded absences (holiday, messaging_blocked)
use Blue/informational instead, so Rule 5.3's accountability-fairness distinction
is visible at the chip level, not just in label text.

**DATED REFINEMENT (2026-07-18, per DASH-03):** `muted` is a neutral UI treatment
for "no status yet" (e.g., a half not yet due), NOT a 5th semantic role. It
uses standard neutral gray, not a `--color-status-*` token, and must never be
extended to represent an actual site-condition judgment. The semantic system
remains exactly 4 roles (§6).

Notes:
- **Amber uses `-800` text, not `-700`** — amber/yellow on light backgrounds is the
  classic contrast failure; `amber-800` on `amber-50` clears WCAG AA comfortably where
  `amber-700` would be borderline. Deliberate deviation from the uniform "-700 text".
- **No decorative color in status contexts** (§6). These four are the only status colors.
- A **solid-fill** variant (`bg-red-600 text-white`, etc.) is a *secondary* token for a
  hard alert banner — NOT the chip default. The chip default is always the light-bg form.

Proposed `@theme` semantic aliases in `app/globals.css` (intent-named, so components
reference meaning not raw color). The block below is the *proposed* definition to add to
`globals.css` in DASH-03 — it is **not present in the repo today**:

```css
@theme inline {
  --color-status-blocked: var(--color-red-700);
  --color-status-risk:    var(--color-amber-800);
  --color-status-ok:      var(--color-green-800);
  --color-status-info:    var(--color-blue-800);
}
```
(Background/border shades come from the matching `-50`/`-200` steps of the same hue.)

---

## 2. TYPOGRAPHY — §6 "max 3 sizes, max 2 weights"

Three sizes, two weights. Holds for BOTH the PM dashboard and any future owner web
surface (the owner report is even more status-row-driven; same scale fits, no new sizes).

| Role | rem | Tailwind | Weight |
|------|-----|----------|--------|
| Heading | 1.25rem | `text-xl`  | Semibold (`font-semibold`, 600) |
| Body    | 0.875rem | `text-sm` | Regular (`font-normal`, 400) |
| Caption / meta ("as reported by Rajesh, 6:42 PM") | 0.75rem | `text-xs` | Regular (Medium only where genuine emphasis is needed) |

- **Two weights only: 400 (regular) + 600 (semibold).** `font-bold` and a third
  freeform weight are out.
- Font family: **Geist Sans** (already loaded). NB: `globals.css` currently overrides
  `body` to Arial/Helvetica — a separate cleanup so tokens actually render in Geist.

**Existing font-medium usage (34 sites, 7 files, pre-token-spec) migrates opportunistically
when each file is next touched for other work — not a scheduled cleanup. font-bold →
font-semibold (8 sites) is a pure mechanical swap and can be done now, in this same commit,
since it's zero-judgment.** (The bold→semibold swap IS done in this commit; the 34
font-medium sites are left to converge as files are worked.)

---

## 3. ICONOGRAPHY — §6 "one icon set, always with a text label"

- Library: **`lucide-react`** (added as a dependency in this commit — `^1.24.0`, the
  current `latest`). License **ISC** (permissive, commercial-safe). React 19 compatible
  (peerDeps include `^19.0.0`). Tree-shakeable — per-icon imports, no bundle bloat.
- **One set across all surfaces. Every icon is paired with a text label — never
  icon-only** (§6). Candidate status mappings:
  - blocked → `CircleAlert` · at-risk → `TriangleAlert` · on-track → `CircleCheck` ·
    info → `Info`.

---

## 4. COMPONENTS — §6 "status chips/badges are the primary UI atom; tables/detail behind drill-down"

Status chip (structure — described, not yet coded):

- A single inline-flex pill: `rounded-full`, `px-2 py-0.5`, `text-xs font-medium`,
  `border`, `gap-1`. Contents: **[lucide icon] + [label text]**.
- Colour comes from exactly ONE of the four semantic token trios (§1). No freeform colour.
- **One chip states ONE status in words** ("Not checked in", "At risk", "On track") —
  never a bare number or a raw enum value.
- **Drill-down discipline:** the chip is the only thing shown at list/summary level.
  Tapping the chip (or its row) reveals the underlying table/detail — the numbers plus
  the check-in trace (design-principles §2.5 trust chain). The dashboard home is
  chips-first; tables never render at the top level.
- Two size variants (sm inline / default on cards); four colour variants. One component.

---

## 5. EMPTY STATES — §6 "explain what's missing, who/what populates it, offer a nudge"

Canonical pattern: **[what's missing] → [who/what will populate it] → [one nudge action]**.
Never a bare "No data."

Concrete Quoco example — brand-new project, no engineer has checked in yet:

> **No check-ins yet today.**
> Check-ins appear here once your site engineers reply to the morning WhatsApp prompt
> (sent at 7:00 AM IST). Rajesh and 2 others are set up and opted in.
> **[Send check-in reminder]**   ·   *Added an engineer? [Manage engineers]*

- Satisfies §6 empty-state rule AND design-principles Rule 4.2 ("every alert carries its
  action" — the nudge is a real button, not read-only).
- Legitimately-empty variant (holiday) reads differently, so empty ≠ broken:
  > **Site closed today (holiday).** No check-ins expected.
  (per design-principles Rule 5.6 — silence is always explained.)
