# 048 typo-repair runbook — a REQUIRED artefact of the 048 review package (review condition S1)

**Status: WRITTEN, NOT REHEARSED.** The rehearsal on test-db is owed and is a gate on deploy step (4), the merge
(`docs/reviews/048-review-package.md`, "Deploy order"). Nothing here has been run against any database. The statement
below is a **template**: it is filled from the pre-probe at the moment of use, never written ahead of time.

## Why this exists

Slice 1 ships with **no way to switch an engineer off** (`docs/plans/add-engineer-plan.md`, "Slice 1 ships with NO way
to switch an engineer off"). A correctly formatted number with one digit wrong is a stranger's live handset (plan §4.6),
and the only guard between it and the next send is this manual repair, used **inside the window**:

| Cron (`vercel.json`) | UTC | IST |
|---|---|---|
| `/api/cron/morning-trigger` | `0 3 * * *` | **08:30** |
| `/api/cron/evening-trigger` | `0 13 * * *` | **18:30** |

A typo'd paste noticed at 08:00 leaves **about thirty minutes**. That is not the moment to write a data change for the
first time. A check-in **already sent stays sent** (`outbound_sends` is a durable ledger) — this runbook promises no more
than stopping the *next* send.

## Why the fix works

`users.status = 'deactivated'` removes the engineer from both rosters. `fetchMorningRoster` and `fetchEveningRoster`
(`lib/whatsapp/outbound/roster.ts`) both go through `fetchActiveEngineers`, which selects `project_members` joined to
`users` with `project_id = <project>`, `users.role = 'engineer'`, **`users.status = 'active'`** and
`users.messaging_blocked = false`. No existing test pins the status filter, hence **T49** in the review package.

It is **not** a hard delete — and `RESTRICT` is **not** the reason. `ON DELETE RESTRICT` on `users_registered_by_fkey`
protects the **registering admin** from being deleted while engineers they registered stand; it does **not** stop the
engineer's own row from being deleted. The real reasons are (1) **the engineer row IS the attribution record**
(`registered_by`, `registered_at`, `consent_attested` live on it — delete it and the only record of who put that number on the
production sender is gone), and (2) **a deletion is irreversible against a sent-ledger** (`outbound_sends`) that may need to be
answered for later. The instruction stands: deactivate, never delete.

## Rules that apply to every step

- Target project ref is **named by Aravind in the same exchange**, and `supabase/.temp/project-ref` is **printed and
  compared to it before any write** (`CLAUDE.md` §0). Prod is `jvxwqignooseazzmwhvl`; test-db is `exfccwlrhoutkgrlikod`.
- One file, foreground, `supabase db query --linked -f <file>`. **Never `db push`; never backgrounded; never a command
  that can confirm itself** (`CLAUDE.md` §0).
- **Aravind's go-ahead in the same exchange** before the UPDATE is issued.
- **Do not print keys, tokens or a `PGPASSWORD`.** Redirect any unfamiliar output to a file and read only what is
  needed (`CLAUDE.md` §0).
- The pin is **re-derived at use time, every time** (`CLAUDE.md` §6, destructive-statement rule): the values below come
  from step 1's output for *this* incident, not from a prior run.

## Step 1 — Pre-probe (read-only)

Finds the row by the **mistyped** number, **within the tenant**. Fill `<MISTYPED_NUMBER>` (stored form, `+` and digits)
and `<TENANT_ID>`.

```sql
SELECT u.id, u.tenant_id, u.full_name, u.whatsapp_number, u.status,
       u.registered_by, u.registered_at, u.consent_attested,
       (SELECT jsonb_agg(jsonb_build_object('project_id', m.project_id, 'role', m.role) ORDER BY m.project_id)
          FROM public.project_members m WHERE m.user_id = u.id) AS memberships
FROM public.users u
WHERE u.whatsapp_number = '<MISTYPED_NUMBER>'
  AND u.tenant_id = '<TENANT_ID>';
```

**PROCEED only if exactly one row is returned.** Zero or more than one: **STOP**. Aravind confirms the identity of the row
**by reading it** — never by inference from a name (`CLAUDE.md` §0, the live-send rule: inference from a `users` row is not
confirmation).

## Step 2 — The statement, pinned to the pre-probe row

Fill `<ID>` and `<TENANT_ID>` **from step 1's output**. One row, enumerated by id, never a general `WHERE`. It asserts
the row count is exactly 1 and otherwise rolls back.

```sql
BEGIN;
DO $$
DECLARE n integer;
BEGIN
  UPDATE public.users
     SET status = 'deactivated'
   WHERE id = '<ID>'
     AND tenant_id = '<TENANT_ID>';
  GET DIAGNOSTICS n = ROW_COUNT;
  IF n <> 1 THEN
    RAISE EXCEPTION 'typo-repair: expected exactly 1 row, updated %', n;
  END IF;
END $$;
COMMIT;
```

## Step 3 — Post-readback (evidence it bites, not just that a column changed)

**3a. The same row, re-read** — the step 1 query, unchanged. Expected: `status = 'deactivated'`; every other column
identical to the pre-probe.

**3b. The roster predicate's own conditions** — must return **zero** rows for this engineer:

```sql
SELECT m.project_id
FROM public.project_members m
JOIN public.users u ON u.id = m.user_id
WHERE u.id = '<ID>'
  AND u.role = 'engineer'
  AND u.status = 'active'
  AND u.messaging_blocked = false;
```

Zero rows ⇒ the engineer is on neither roster. One or more rows ⇒ **the repair did not take effect; escalate before the
cron fires.**

## Step 4 — The number stays held

`UNIQUE (whatsapp_number)` (`001_core_schema.sql:44`) is **global**: the mistyped number **cannot be re-added — to any
project, any tenant — while this row exists**, and no slice-1 path frees it. The engineer's **correct** number is a
different number and is unaffected: add it through the add screen as usual. Freeing the mistyped number is slice 2's
concern and is **not** part of this runbook. Do not delete the row.

## Step 5 — Timing

- Next fire: whichever of **08:30 IST** / **18:30 IST** comes first after the paste.
- About **30 minutes** from a 08:00 paste. Steps 1–3 are three short statements; do not start them at 08:25.
- A check-in **already sent stays sent.**

## Rehearsal (OWED — not done)

Written **and rehearsed on test-db before the first real paste**, not when it is needed. The rehearsal runs on a
**neutralised** fixture — a project whose `status <> 'active'`, so the roster never loads it and no message can leave
(review package, boundary test) — with an engineer created **through `add_engineers_to_project`**, following steps 1–3
exactly. Its output goes into the 048 apply record, and the checklist line
**"typo-repair runbook rehearsed on test-db at `<path>`"** must be satisfied **before deploy step (4), the merge** —
the merge is what makes the add screen reachable.
