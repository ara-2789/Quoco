#!/usr/bin/env python3
"""Red-variant generator for the 048 scaffold run (plan §7: 'shown to fail' = a captured red run).

usage: mutate.py <mutant> <path-to-048_engineer_registration.sql>   -> mutated SQL on stdout

Each mutant is a list of (old, new) exact-text edits, plus optional text appended AFTER the file.
Every `old` must occur EXACTLY ONCE in the file: a mutation that did not apply is an error, never a
silent green. Mutants run only against the disposable scaffold, never a real database.
"""
import sys

A_GATE_CALL = """  SELECT g.o_caller_id, g.o_tenant_id
    INTO v_caller_id, v_tenant_id
  FROM public.engineer_admin_gate(p_project_id) g;
"""
A_CONSENT_RAISE = """  IF p_consent_attested IS NULL THEN
    RAISE EXCEPTION 'add_engineers_to_project: p_consent_attested must be stated'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
"""
A_INSERT_VALUES = "      v_caller_id, now(), p_consent_attested\n"
A_PROJECT_NOT_FOUND = """  IF NOT FOUND OR v_project_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'engineer_admin_gate: project not found'
      USING ERRCODE = 'no_data_found';
  END IF;
"""

MUTANTS = {
    # T1 -- the precedent's NULL trap: '<>' instead of IS DISTINCT FROM.
    "lt_tenant": ([("IF NOT FOUND OR v_project_tenant IS DISTINCT FROM v_caller_tenant THEN",
                    "IF NOT FOUND OR v_project_tenant <> v_caller_tenant THEN")], ""),
    # T7 -- a dry run falls through to the writes.
    "dry_writes": ([("IF p_dry_run OR NOT v_all_ok THEN", "IF NOT v_all_ok THEN")], ""),
    # T8 -- authorisation is not enforced before the number lookups (statuses leak to an unauthorised caller).
    "gate_soft": ([(A_GATE_CALL, """  BEGIN
    SELECT g.o_caller_id, g.o_tenant_id
      INTO v_caller_id, v_tenant_id
    FROM public.engineer_admin_gate(p_project_id) g;
  EXCEPTION WHEN insufficient_privilege THEN
    SELECT pr.tenant_id INTO v_tenant_id FROM public.projects pr WHERE pr.id = p_project_id;
  END;
""")], ""),
    # T18 -- per-row EXCEPTION sub-blocks: earlier rows persist when a later one fails.
    "atomic_subblocks": ([("    INSERT INTO public.users (\n      tenant_id, role, status,",
                           "    BEGIN\n    INSERT INTO public.users (\n      tenant_id, role, status,"),
                          ("""      jsonb_build_object('idx', i - 1, 'status', 'added', 'user_id', v_user_id)
    );
  END LOOP;""", """      jsonb_build_object('idx', i - 1, 'status', 'added', 'user_id', v_user_id)
    );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
  END LOOP;""")], ""),
    # T20 -- the rev11 spec: NULL consent silently becomes false (the natural red against the S4 fix).
    "coalesce_consent": ([(A_CONSENT_RAISE, ""),
                          (A_INSERT_VALUES, "      v_caller_id, now(), coalesce(p_consent_attested, false)\n")], ""),
    # T10 -- registered_by not written.
    "drop_registered_by": ([(A_INSERT_VALUES, "      NULL, now(), p_consent_attested\n")], ""),
    # T5 (i) -- a cross-tenant row leaks a full name.
    "leak_name": ([("v_status := 'number_registered';",
                    "v_status := 'number_registered';\n      v_row := v_row || jsonb_build_object('full_name', (SELECT u2.full_name FROM public.users u2 WHERE u2.id = v_existing.id));")], ""),
    # T5 (ii) -- classify only within the caller's tenant: a cross-tenant number reads as free.
    "no_cross_tenant": ([("WHERE u.whatsapp_number = v_number;",
                          "WHERE u.whatsapp_number = v_number AND u.tenant_id IS NOT DISTINCT FROM v_tenant_id;")], ""),
    # T5 (iii) -- registered_no_project returned cross-tenant.
    "cross_no_project": ([("v_status := 'number_registered';", "v_status := 'registered_no_project';")], ""),
    # T17 -- a foreign project id is distinguishable from a nonexistent one.
    "foreign_42501": ([(A_PROJECT_NOT_FOUND, """  IF NOT FOUND THEN
    RAISE EXCEPTION 'engineer_admin_gate: project not found'
      USING ERRCODE = 'no_data_found';
  END IF;
  IF v_project_tenant IS DISTINCT FROM v_caller_tenant THEN
    RAISE EXCEPTION 'engineer_admin_gate: not permitted'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
""")], ""),
    # T47 -- a bare REFERENCES (confdeltype 'a'): (ii) alone cannot tell it from RESTRICT, (i) does.
    "fk_bare": ([("\n  ON UPDATE NO ACTION\n  ON DELETE RESTRICT;", ";")], ""),
    # T47 -- ON DELETE CASCADE: deleting the admin deletes every engineer they registered.
    "fk_cascade": ([("ON DELETE RESTRICT;", "ON DELETE CASCADE;")], ""),
    # T16 -- before the REVOKEs: the default privileges grant EXECUTE to anon / authenticated / service_role.
    "no_revokes": ([("REVOKE EXECUTE ON FUNCTION public.engineer_admin_gate(uuid)\n  FROM PUBLIC, anon, authenticated, service_role;\n", ""),
                    ("REVOKE EXECUTE ON FUNCTION public.add_engineers_to_project(uuid, jsonb, boolean, boolean)\n  FROM PUBLIC, anon, service_role;\n", "")], ""),
    # T48 -- slice 2's hazard: an argument-list change via CREATE OR REPLACE makes a SECOND overload.
    "overload5": ([], """
CREATE OR REPLACE FUNCTION public.add_engineers_to_project(
  p_project_id uuid, p_engineers jsonb, p_dry_run boolean, p_consent_attested boolean, p_extra boolean DEFAULT false)
RETURNS jsonb LANGUAGE sql AS $$ SELECT NULL::jsonb $$;
"""),
}

def main() -> int:
    if len(sys.argv) != 3 or sys.argv[1] not in MUTANTS:
        print("usage: mutate.py <" + "|".join(MUTANTS) + "> <file>", file=sys.stderr)
        return 2
    edits, append = MUTANTS[sys.argv[1]]
    text = open(sys.argv[2], encoding="utf-8").read()
    for old, new in edits:
        n = text.count(old)
        if n != 1:
            print(f"mutant {sys.argv[1]}: target text occurs {n} times, expected exactly 1: {old[:70]!r}", file=sys.stderr)
            return 1
        text = text.replace(old, new)
    sys.stdout.write(text + append)
    return 0

if __name__ == "__main__":
    sys.exit(main())
