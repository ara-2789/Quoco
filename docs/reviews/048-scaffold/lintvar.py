#!/usr/bin/env python3
"""Run the REAL scripts/lint-migrations.mjs against a scratch COPY of its inputs with ONE variation.

Nothing in the repo is touched: scripts/, supabase/migrations/ and the top-level docs/reviews/*.sql are
copied to a temp directory, one variation is applied to the copy, and the lint is run there. Every edit
asserts its anchor occurs exactly once, so a variation that did not apply is an error, not a silent green.

  usage: lintvar.py <variant>
  baseline                    the committed tree                                   -> expect clean
  no_reservation              Rule 8: 048's reservation names the released helper   -> expect FAIL
  no_coverage                 Rule 9: no registered_by coverage entry              -> expect FAIL
  no_postgres_grant           Rule 1: a SECURITY DEFINER function, REVOKE, no GRANT -> expect FAIL
  fwd_in_second_stmt          Rule 11: the wrong-column compare after a ';' inside a $$ body   -> expect FAIL
  rev_in_second_stmt          Rule 11: the reversed operand order                               -> expect FAIL
  col_in_second_stmt          Rule 11: the <x>_id form                                          -> expect FAIL
  auth_id_in_second_stmt      control: the CORRECT column in the same position                  -> expect clean
  block_comment_prose         prose in a block comment in a statement with no users mention    -> expect clean
  block_comment_in_users_stmt the same prose inside a statement that mentions users             -> expect FAIL
  string_literal_in_users_stmt the same text as a string literal in such a statement           -> expect FAIL
"""
import json, os, shutil, subprocess, sys, tempfile

REPO = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
variant = sys.argv[1] if len(sys.argv) > 1 else sys.exit(__doc__)
tmp = tempfile.mkdtemp(prefix="lintvar-")
shutil.copytree(f"{REPO}/scripts", f"{tmp}/scripts")
shutil.copytree(f"{REPO}/supabase/migrations", f"{tmp}/supabase/migrations")
os.makedirs(f"{tmp}/docs/reviews")
for f in os.listdir(f"{REPO}/docs/reviews"):
    p = f"{REPO}/docs/reviews/{f}"
    if f.endswith(".sql") and os.path.isfile(p):
        shutil.copy(p, f"{tmp}/docs/reviews/{f}")
sql_path = f"{tmp}/docs/reviews/048_engineer_registration.sql"
sql = open(sql_path).read()

def sub(old, new):
    global sql
    assert sql.count(old) == 1, (old, sql.count(old))
    sql = sql.replace(old, new)

SECOND_STMT = "    v_names   := v_names || v_name;\n"  # inside add_engineers_to_project's $$ body, after several ';'

if variant == "baseline":
    pass
elif variant == "no_reservation":
    r = json.load(open(f"{tmp}/scripts/migration-number-reservations.json"))
    for e in r:
        if e["number"] == "048":
            e["claimedBy"] = "docs/reviews/048_test_047_unused_rights_check.sql"
    json.dump(r, open(f"{tmp}/scripts/migration-number-reservations.json", "w"), indent=2)
elif variant == "no_coverage":
    c = json.load(open(f"{tmp}/scripts/shared-fixture-fk-coverage.json"))
    c = [e for e in c if not (e["table"] == "users" and e["column"] == "registered_by")]
    json.dump(c, open(f"{tmp}/scripts/shared-fixture-fk-coverage.json", "w"), indent=2)
elif variant == "no_postgres_grant":
    sub("GRANT EXECUTE ON FUNCTION public.engineer_admin_gate(uuid) TO postgres;\n", "")
elif variant == "fwd_in_second_stmt":
    sub(SECOND_STMT, "    PERFORM 1 FROM public.users u9 WHERE id = auth.uid();\n" + SECOND_STMT)
elif variant == "rev_in_second_stmt":
    sub(SECOND_STMT, "    PERFORM 1 FROM public.users u9 WHERE auth.uid() = u9.id;\n" + SECOND_STMT)
elif variant == "col_in_second_stmt":
    sub(SECOND_STMT, "    PERFORM 1 FROM public.project_members m9 WHERE m9.user_id = auth.uid();\n" + SECOND_STMT)
elif variant == "auth_id_in_second_stmt":
    sub(SECOND_STMT, "    PERFORM 1 FROM public.users u9 WHERE u9.auth_id = auth.uid();\n" + SECOND_STMT)
elif variant == "block_comment_prose":
    sub("\n\nBEGIN;\n", "\n\n/* never write: id = auth.uid() */\nBEGIN;\n")
elif variant == "block_comment_in_users_stmt":
    sub("  SELECT u.id, u.role, u.tenant_id\n", "  /* never write: id = auth.uid() */\n  SELECT u.id, u.role, u.tenant_id\n")
elif variant == "string_literal_in_users_stmt":
    sub("  WHERE u.auth_id = auth.uid();\n", "  WHERE u.auth_id = auth.uid() AND 'id = auth.uid()' <> '';\n")
else:
    sys.exit("unknown variant\n" + __doc__)
open(sql_path, "w").write(sql)

p = subprocess.run(["node", "scripts/lint-migrations.mjs"], cwd=tmp, capture_output=True, text=True)
out = (p.stdout + p.stderr).strip().splitlines()
print(f"variant={variant} exit={p.returncode}")
for line in out[-14:]:
    print("  " + line[:230])
shutil.rmtree(tmp)
