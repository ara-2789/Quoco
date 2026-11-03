#!/usr/bin/env bash
# Prep for the PR #350 manual browser session (docs/plans/login-otp-ux-plan.md,
# section 17; review round 2, H1).
#
# WHY: the S2 probe (Run 4) did not record WHICH build the browser executed, and
# stale servers on :3000 were found twice in this work. This script makes the
# session start from a known state: it refuses to run if :3000 is occupied,
# builds the CURRENT clean HEAD, starts the server in the background, and proves
# the server answering on :3000 serves THAT build (served BUILD_ID == the file
# .next/BUILD_ID). Everything it learned goes to /tmp/quoco/manual-run-env.txt so
# it can be pasted into the run record.
#
# It LEAVES THE SERVER RUNNING on :3000 (that is the point: Aravind uses it).
# Stop it with:   kill "$(cat /tmp/quoco/manual-run-server.pid)"
#
# Usage:  scripts/login-manual-check.sh        (exits non-zero and stops the
#         server it started on any failure)
#
# Uses .env.local as is. It makes only signed-out GET /login requests itself: it
# calls no server action and sends no email.

set -u

PORT=3000
BASE="http://localhost:${PORT}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OUT_DIR="/tmp/quoco"
ENV_FILE="${OUT_DIR}/manual-run-env.txt"
PIDFILE="${OUT_DIR}/manual-run-server.pid"
SERVER_LOG="${OUT_DIR}/manual-run-server.log"
HTML="${OUT_DIR}/manual-run-login.html"
STARTED_NPM_PID=""

mkdir -p "${OUT_DIR}"
cd "${ROOT}" || exit 1

stop_started_server() {
  if [ -n "${STARTED_NPM_PID}" ]; then
    kill "${STARTED_NPM_PID}" 2>/dev/null
  fi
  stragglers="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
  if [ -n "${stragglers}" ]; then
    # shellcheck disable=SC2086
    kill ${stragglers} 2>/dev/null
  fi
  rm -f "${PIDFILE}"
}

fail() {
  echo "FAIL: $1"
  stop_started_server
  exit 1
}

# 1. Refuse to run if anything LISTENs on :3000 (never kill someone else's server).
existing="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
if [ -n "${existing}" ]; then
  echo "ABORT: something already listens on :${PORT}. Stop it first, then re-run."
  for pid in ${existing}; do
    ps -o pid=,lstart=,command= -p "${pid}" | cut -c1-200
  done
  exit 1
fi

# 2. The commit under test, and a clean tree.
HEAD_SHA="$(git rev-parse HEAD)"
STATUS="$(git status --short)"
echo "== HEAD ${HEAD_SHA}"
echo "== git status --short"
echo "${STATUS}"
echo "== [end status]"
if [ -n "${STATUS}" ]; then
  echo "ABORT: the working tree is not clean; the build would not be exactly HEAD."
  exit 1
fi

# 3. Build, and read the build id.
echo "== npm run build"
if ! npm run build >"${OUT_DIR}/manual-run-build.log" 2>&1; then
  echo "FAIL: npm run build exited non-zero; tail of ${OUT_DIR}/manual-run-build.log:"
  tail -20 "${OUT_DIR}/manual-run-build.log"
  exit 1
fi
BUILD_ID="$(cat .next/BUILD_ID)"
echo "== .next/BUILD_ID = ${BUILD_ID}"

# 4. Start the server in the background and wait until /login answers.
echo "== npm start -- -p ${PORT} (background)"
npm start -- -p "${PORT}" >"${SERVER_LOG}" 2>&1 &
STARTED_NPM_PID=$!
ready=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/login" 2>/dev/null)"
  if [ -n "${code}" ] && [ "${code}" != "000" ]; then
    ready=1
    break
  fi
  sleep 1
done
[ "${ready}" -eq 1 ] || { tail -20 "${SERVER_LOG}"; fail "server did not answer on ${BASE}/login within 60 s"; }

# The PID to kill is the process LISTENING on the port (npm is only a wrapper).
LISTEN_PID="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null | head -1)"
[ -n "${LISTEN_PID}" ] || fail "nothing listens on :${PORT} although /login answered"
echo "${LISTEN_PID}" >"${PIDFILE}"

# 5. Does the SERVED page belong to this build?
# Pattern (found by inspecting a real Next 16.2.11 response, 2 Nov 2026): the
# build id appears once in the HTML, inside the flight payload, as the escaped
# JSON field   \"b\":\"<BUILD_ID>\"   (e.g. ...\"d\":\"$undefined\",\"b\":\"EWSX...\"}\n"]).
# Not in a header, and not in a script URL for this app-router page.
PATTERN='\\"b\\":\\"([A-Za-z0-9_-]+)\\"'
curl -s "${BASE}/login" -o "${HTML}"
SERVED_ID="$(perl -ne "print \"\$1\n\" if /${PATTERN}/" "${HTML}" | head -1)"
MATCH_LINE="$(perl -ne 'if (/(.{0,60}\\"b\\":\\"[A-Za-z0-9_-]+\\".{0,12})/) { print "$1\n"; exit }' "${HTML}")"
echo "== pattern used (perl regex): ${PATTERN}"
echo "== matching text from the served HTML: ${MATCH_LINE}"
echo "== served build id = ${SERVED_ID}"
if [ -n "${SERVED_ID}" ] && [ "${SERVED_ID}" = "${BUILD_ID}" ]; then
  MATCH="MATCH"
else
  MATCH="MISMATCH"
fi
echo "== served BUILD_ID vs .next/BUILD_ID: ${MATCH}"

# 6. Record it.
{
  echo "manual-run environment, written by scripts/login-manual-check.sh"
  echo "when:            $(date '+%Y-%m-%d %H:%M:%S %z')"
  echo "HEAD:            ${HEAD_SHA}"
  echo "git status:      clean"
  echo ".next/BUILD_ID:  ${BUILD_ID}"
  echo "served BUILD_ID: ${SERVED_ID:-<not found>}"
  echo "served-match:    ${MATCH}"
  echo "server PID:      ${LISTEN_PID} (listening on :${PORT}; PID file ${PIDFILE})"
  echo "pattern:         ${PATTERN}"
} >"${ENV_FILE}"
echo "== wrote ${ENV_FILE}"

if [ "${MATCH}" != "MATCH" ]; then
  fail "the page served on :${PORT} does NOT carry the build id of the build just made (stale or foreign server?)"
fi

# 7. Hand over.
cat <<'EOF'

== READY. The server is running on http://localhost:3000 (this exact HEAD, build id matched).

Before the S2 probe, paste this into the DevTools Console of the /login tab:

window.__s2log=[];['click','submit'].forEach(t=>{document.addEventListener(t,e=>{const b=t==='click'?e.target.closest('button'):e.submitter;window.__s2log.push({t,phase:'capture',ms:Math.round(performance.now()),label:b&&b.textContent.trim(),disabled:b&&b.disabled,forms:document.querySelectorAll('form').length})},true);window.addEventListener(t,e=>{const b=t==='click'?e.target.closest('button'):e.submitter;window.__s2log.push({t,phase:'after-react',ms:Math.round(performance.now()),label:b&&b.textContent.trim(),prevented:e.defaultPrevented})})});console.log('s2 logger on')

After the probe, copy the log with:

copy(JSON.stringify(window.__s2log,null,1))

(The logger is lost on a full page load; paste it again after any reload.)

EOF
echo "== To stop the server when you are done:"
echo "   kill \"\$(cat ${PIDFILE})\""
echo "== Environment record: ${ENV_FILE}"
exit 0
