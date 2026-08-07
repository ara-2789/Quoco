-- =============================================================================
-- 023_dpr_reports.sql
-- ----------------------------------------------------------------------------
-- Creates public.dprs — the table docs/schema.md has documented as a DESIGN
-- since migration 007 but that no migration has ever actually created (007's
-- dprs/drop work was evicted at checkpoint-1 review and never executed; see
-- schema.md's own "DOES NOT EXIST ON PROD" banner on that section). Phase 0
-- of the Claude API / DPR generation build — this migration is schema only,
-- no generator code, no Anthropic SDK call, nothing that reads Claude's
-- output. The generator (Phase 1) cannot be built before this exists: DPR-23's
-- concurrent-regen claim and DPR-24's owner-send hold (docs/bot-flows.md)
-- both depend on generation_status/generator_job_id, which exist ONLY in this
-- table's design, nowhere on daily_logs.
--
-- WHAT THIS DOES
--   1. CREATE TABLE dprs — one row per (project_id, log_date), UPSERT target
--      for regeneration (bot-flows.md: "Regenerate via UPSERT. Silent
--      replace." — never a new version row).
--   2. RLS: SELECT only, project_members-scoped — NOT tenant-wide. See the
--      RLS SCOPING rationale below; this is a deliberate departure from
--      daily_logs' own (tenant-wide) policy shape.
--   3. Drops daily_logs.dpr_content, the interim per-engineer column DPR
--      content has lived in since no dprs table existed. See the DPR_CONTENT
--      DROP section below for the pre-apply probe this depends on.
--
-- RLS SCOPING — WHY project_members, NOT tenant-wide (read before "fixing"
--   this to match daily_logs). daily_logs' own SELECT policy is tenant-wide
--   (tenant_id = get_user_tenant_id()), with the dashboard narrowing further
--   at the app layer — and migration 019's own header names that exact gap:
--   correct_daily_log had to re-implement membership checking in its OWN body
--   because daily_logs_update's RLS policy (007:282) is broader than what a
--   PM can actually see on DASH-03. Scoping dprs tenant-wide here would
--   recreate that same gap on a brand-new table, on day one, for a document
--   more sensitive than a single daily_logs row: dprs is a SYNTHESIZED
--   project-level artifact with costs and accountability content in it, and
--   CLAUDE.md §4 states the stricter rule by name — "Owner DPR content is
--   strictly single-project scoped." Getting this right at creation costs one
--   EXISTS subquery; retrofitting it later costs another migration and
--   another review round, exactly like 019 had to. The policy shape below —
--   SELECT-only, project_members-scoped, no authenticated/anon write path —
--   mirrors daily_log_edits (019 §2) directly; that table solves the
--   identical problem (project-scoped read, service-role-only write).
--
--   PM-ONLY BY DESIGN, NOT AN OVERSIGHT (checked before writing this, not
--   assumed) — this policy grants NOTHING to the owner of the project it
--   scopes, and that is deliberate, confirmed three independent ways:
--     1. Owners are not associated via project_members at all. Project
--        creation (app/(dashboard)/projects/new/page.tsx) inserts exactly one
--        project_members row — the creating PM (role='pm'). Owner
--        association is a SEPARATE mechanism, projects.owner_user_id
--        (migration 016), per bot-flows.md ENG-07/DASH-02.
--     2. Moot beyond the policy anyway: owners have NO WEB LOGIN in Phase 1
--        at all. CLAUDE.md §5 — owner rows have auth_id = null. There is no
--        Supabase Auth session for an owner to reach this table (or any
--        dashboard route) through, whatever this policy said.
--     3. bot-flows.md places DASH-04 (the DPR Archive this table serves)
--        under "PM DASHBOARD — SPINE", not anywhere owner-facing. Owners
--        receive DPR content exclusively through the PUSH path
--        (delivered_owner_at / delivery_status, WhatsApp + email) — never a
--        dashboard read.
--   If a future author reads "owners get nothing here" as a gap and widens
--   this policy to include them, that is the bug this note exists to
--   prevent — three independent reasons, not one, so no single re-derivation
--   makes it look like an oversight worth "fixing."
--
-- WHY NO SECURITY DEFINER RPC (contrast with 019's correct_daily_log). 019
--   needed a definer RPC because a PM writes through it against RLS that is
--   deliberately broader than the PM's actual visible scope — a real
--   authorization problem that has to be re-solved in the function body.
--   Here, only service_role ever writes to dprs, from a cron-triggered job
--   handler — there is no user-facing write path to protect. A definer RPC
--   would add a parameter-trusting surface (the 020 incident class: a
--   function taking p_tenant_id/p_project_id as caller input with no
--   auth.uid() derivation) for zero authorization benefit, since service_role
--   already bypasses RLS by construction. Plain parameterized queries from
--   the job handler are the correct shape here, not a smaller version of
--   019's pattern.
--
-- generator_job_id IS NOT A FOREIGN KEY (departs from 017's composite-FK
--   discipline; recorded here so it doesn't read as an oversight). jobs rows
--   are a pruning candidate (CLAUDE.md §10's data-retention audit: succeeded
--   jobs get pruned, only failed ones are kept indefinitely). A hard FK —
--   even ON DELETE SET NULL — would either block the prune or silently erase
--   the breadcrumb the moment the referenced job is pruned; a dangling
--   plain UUID survives the prune and still tells an investigator which job
--   ran. This column is diagnostic, deliberately not referentially enforced
--   — the option not taken (FK + ON DELETE SET NULL) was considered and
--   rejected for exactly this reason.
--
-- DPR_CONTENT DROP — SEQUENCING (this PR only, not a follow-up). Dropping
--   daily_logs.dpr_content and repointing app/(dashboard)/dprs/page.tsx (which
--   reads it today) land in this SAME migration / SAME PR, not staged across
--   two — dropping the column first would 500 the page between merges. Safe
--   to drop: zero non-null rows on prod, confirmed by direct observation
--   immediately before drafting this migration:
--     SELECT count(*) AS total_rows,
--            count(*) FILTER (WHERE dpr_content IS NOT NULL) AS non_null_dpr_content
--     FROM public.daily_logs;
--     -> total_rows=1, non_null_dpr_content=0 (2026-08-07, service-role, read-only)
--   RE-RUN THIS PROBE AT APPLY TIME — do not trust this comment's numbers as
--   still current by the time this reaches prod. Same discipline as
--   migration 016, which dropped evening_dependencies_tomorrow under the
--   identical justification ("0 rows -> all TYPE/rename/drop below are
--   data-free").
--
-- RISK CLASS: mostly additive (new table), plus one small destructive-but-
--   data-free column drop backed by the probe above. Reversible without PITR
--   for the additive half; the drop is irreversible in the sense that no data
--   survives it, but there was none to begin with. Rehearse on the cleaned
--   existing test-db branch (CLAUDE.md §0's standing conditional rule, not a
--   fresh provision) and pass migration-023.test.ts BEFORE prod, same review
--   tier as 017-022. Regenerate types/database.ts after apply and commit the
--   diff (§6).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. dprs table.
-- -----------------------------------------------------------------------------
CREATE TABLE public.dprs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  tenant_id           UUID NOT NULL REFERENCES public.tenants(id),
  project_id          UUID NOT NULL REFERENCES public.projects(id),
  log_date            DATE NOT NULL,
  structured          JSONB,
  content             TEXT,
  generated_at        TIMESTAMPTZ,
  last_regenerated_at TIMESTAMPTZ,
  delivered_owner_at  TIMESTAMPTZ,
  delivery_status     TEXT NOT NULL DEFAULT 'pending'
                         CHECK (delivery_status IN (
                           'pending', 'delivered', 'paused', 'skipped_no_data', 'failed'
                         )),
  generation_status   TEXT NOT NULL DEFAULT 'idle'
                         CHECK (generation_status IN (
                           'idle', 'pending', 'running', 'stale'
                         )),
  -- Diagnostic correlation only — see the header note above for why this is
  -- deliberately not a foreign key.
  generator_job_id    UUID,
  UNIQUE (project_id, log_date)
);

COMMENT ON TABLE public.dprs IS
  'One row per (project_id, log_date) — the aggregated, Claude-generated Daily '
  'Progress Report. UPSERT target for regeneration (silent replace, never a '
  'new version row per bot-flows.md). generation_status and delivery_status '
  'are ORTHOGONAL lifecycles (one tracks the compute job, one tracks the '
  'owner-send state) — do not collapse them into one column or couple their '
  'transitions. See docs/bot-flows.md DPR GENERATION section.';

COMMENT ON COLUMN public.dprs.generator_job_id IS
  'Diagnostic correlation to jobs.id — DELIBERATELY NOT a foreign key. jobs '
  'rows are a pruning candidate (CLAUDE.md §10: succeeded jobs get pruned); a '
  'hard FK, even ON DELETE SET NULL, would either block the prune or erase '
  'this breadcrumb the moment the job is pruned. A dangling UUID survives the '
  'prune and still names which job ran.';

-- -----------------------------------------------------------------------------
-- 2. RLS: SELECT only, project_members-scoped (see the header rationale —
--    this is deliberately NOT daily_logs' tenant-wide shape). No
--    authenticated/anon write policy exists; the only writer is the
--    dpr_generate job handler via service_role, which bypasses RLS. Mirrors
--    daily_log_edits (019 §2) directly.
-- -----------------------------------------------------------------------------
ALTER TABLE public.dprs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "dprs_select" ON public.dprs
  FOR SELECT TO authenticated
  USING (
    tenant_id = get_user_tenant_id()
    AND EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = dprs.project_id
        AND pm.user_id = (SELECT id FROM public.users WHERE auth_id = auth.uid())
    )
  );

REVOKE INSERT, UPDATE, DELETE ON public.dprs FROM authenticated;
REVOKE INSERT, UPDATE, DELETE ON public.dprs FROM anon;

-- -----------------------------------------------------------------------------
-- 3. daily_logs.dpr_content — drop. See the DPR_CONTENT DROP header note for
--    the pre-apply probe this depends on (RE-RUN AT APPLY TIME).
--    app/(dashboard)/dprs/page.tsx is repointed at public.dprs in this same
--    PR — see the SEQUENCING note above.
-- -----------------------------------------------------------------------------
ALTER TABLE public.daily_logs DROP COLUMN dpr_content;

COMMIT;

-- =============================================================================
-- DOWN / ROLLBACK (reference)
-- -----------------------------------------------------------------------------
-- BEGIN;
--   DROP TABLE IF EXISTS public.dprs;                                -- drops its policy
--   ALTER TABLE public.daily_logs ADD COLUMN dpr_content TEXT;       -- data unrecoverable either way (0 rows pre-drop)
-- COMMIT;
-- =============================================================================
