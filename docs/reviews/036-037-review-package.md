# Migrations 036 + 037 — external review package (2026-09-03)

**Source of truth for the message Aravind sends to the external reviewer.** Generated
once here, committed, and read back from this file from now on — not reconstructed from
memory each time, which is what let two lines drift across separate hand-offs earlier the
same day. If this file's own text is ever wrong, fix it here first, then re-send.

**Message text starts below this line. Everything from here to the end of the file is the
literal message.**

---

Two migrations for external review before the prod apply — neither trips CLAUDE.md's own
gate conditions, so this isn't required by process; sending it anyway.

### 1. See the files — pinned commands, not PR links (GitHub cache issue)

```
git show 60b3cc3215b461726f22e41810b9ead09fdf965a:docs/reviews/036_hindrance_timing_column.sql
git show f7c729f4feca11fdbdc207e7f8b7800f2ae7b1fe:docs/reviews/037_hindrances_pm_notified_at.sql
```

(First on branch `worktree-adhoc-menu-item1-migration`, second on branch
`worktree-migration-037-pm-notified-at` — fetch the branch to make its commit reachable.)

PRs, for tracking and commenting only — **not** the source of truth for what the files say
(GitHub's own diff view can serve a stale cache; the `git show` commands above are the real
verification path):
- #180 — migration 036
- #182 — migration 037

### 2. sha256 — verify you're reading what was certified

```
036: f878057d2e608358373377f66f735d80a5583d62c6788e0a292cbf26af077ff4
037: c79cce26908ce0021a7e5d5bbf58a072b77a792963e9ac0de4f64ffca1dcf796
```

Reproduce it yourself:
```
git show <full-sha>:<path> | shasum -a 256
```

### 3. Context you don't have

- **`hindrances` has zero rows in production and no code writes to it today.** These are
  the first migrations that touch it at all.
- **What each column is for:**
  - `timing` — does this hindrance block work NOW (`active`) or MAY block work LATER
    (`potential`)? The one field the whole item exists to capture.
  - `timing_raw` — §42's own discipline (unmatched input is captured, never silently
    dropped): the engineer's literal answer when the pick doesn't resolve to
    `active`/`potential`, so his real words survive a failed classification instead of
    being thrown away.
  - `pm_notified_at` — send-once guard for the PM email notification. NULL = not yet
    notified; set once, after a successful send.
- **Why `submitted_via`'s DEFAULT was dropped:** its default (`'whatsapp'`) violated the
  column's own CHECK constraint — any INSERT that omitted the column failed outright.
  Found during 036's first rehearsal (a throwaway insert hit it immediately), folded into
  the same migration rather than deferred to a second one touching the same table.
  Consequence named honestly, not glossed over: dropping the default means an omission now
  succeeds *silently* as NULL instead of failing loudly — enforcement that a real write
  path must always supply this column is application-side only, not DB-enforced.
- **Both were rehearsed on the schema-complete test-db**, with executed teardowns,
  verified back to a byte-identical baseline column-for-column, migration ledger untouched
  (confirmed via `supabase migration list --linked` before and after — no `036`/`037`
  entry either way).
- **§0(a)-(e) reading: trips none of them** — no function logic, no grant/RLS/SECURITY
  DEFINER surface, no auth surface, fully reversible (zero rows on the table either way),
  no money surface. Tell me if you disagree — I want that question asked, not assumed
  away.

### 4. What I want attacked

- Is the three-value timing CHECK ('active', 'potential', 'unspecified') right, or should
  'unspecified' be a NULL-with-timing_raw instead of its own named value?
- Is dropping `submitted_via`'s DEFAULT the right fix, versus correcting it to
  `'whatsapp_adhoc'`?
- Does either DOWN block miss anything?
- Anything in either file that would be painful to change once the menu flow actually
  writes to this table?

### 5. DOWN blocks, verbatim

**036:**
```sql
ALTER TABLE hindrances
  DROP COLUMN timing,
  DROP COLUMN timing_raw,
  ALTER COLUMN submitted_via SET DEFAULT 'whatsapp';
```
Note: this deliberately restores submitted_via's DEFAULT to 'whatsapp' — the same value we
just established is broken (it violates the column's own CHECK). That's intentional: a
rollback restores the exact prior state, defects included, rather than half-fixing forward
on the way out.

**037:**
```sql
ALTER TABLE hindrances DROP COLUMN pm_notified_at;
```

---

**Message text ends above this line.**
