#!/usr/bin/env bash
# /login smoke gate (docs/plans/login-otp-ux-plan.md, section 13).
#
# WHY THIS EXISTS: vitest renders components in plain node and does NOT enforce
# the 'use client' boundary, so a server component calling a function exported
# from a 'use client' file passes every unit test and then crashes every real
# GET /login. Only a real `next build` + `next start` sees that.
#
# What it does: builds the app, starts it on port 3100 (background, PID file),
# waits for /login to answer, requests five /login URLs signed-out, and checks
# each for HTTP 200, no "Application error", and the expected heading. The
# server is ALWAYS stopped on exit (trap), including on failure or Ctrl-C.
#
# Safe by construction: signed-out GETs only. It sends no email and calls no
# server action. Uses .env.local as is (Supabase URL/anon key); a signed-out
# request makes no authenticated call.
#
# Usage:  scripts/smoke-login.sh        (run from anywhere; exits non-zero on any failure)

set -u

PORT=3100
BASE="http://localhost:${PORT}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/smoke-login.XXXXXX")"
PIDFILE="${WORK}/server.pid"
SERVER_LOG="${WORK}/server.log"
FAILED=0

stop_server() {
  if [ -f "${PIDFILE}" ]; then
    pid="$(cat "${PIDFILE}")"
    kill "${pid}" 2>/dev/null
  fi
  # `npm start` leaves a child next-server behind when only the npm PID is
  # killed: also stop whatever LISTENS on OUR port (never any other port).
  stragglers="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
  if [ -n "${stragglers}" ]; then
    # shellcheck disable=SC2086
    kill ${stragglers} 2>/dev/null
    sleep 1
    stragglers="$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)"
    # shellcheck disable=SC2086
    [ -n "${stragglers}" ] && kill -9 ${stragglers} 2>/dev/null
  fi
  rm -rf "${WORK}"
}
trap stop_server EXIT
trap 'exit 130' INT TERM

cd "${ROOT}" || exit 1

if [ -n "$(lsof -ti "tcp:${PORT}" -sTCP:LISTEN 2>/dev/null)" ]; then
  echo "ABORT: something already listens on port ${PORT}; refusing to start (and will not kill it)."
  trap - EXIT
  rm -rf "${WORK}"
  exit 1
fi

echo "== npm run build"
if ! npm run build; then
  echo "FAIL: npm run build exited non-zero"
  exit 1
fi

echo "== npm start -- -p ${PORT} (background)"
npm start -- -p "${PORT}" >"${SERVER_LOG}" 2>&1 &
echo $! >"${PIDFILE}"

echo "== waiting for ${BASE}/login (max 60 s)"
ready=0
for _ in $(seq 1 60); do
  code="$(curl -s -o /dev/null -w '%{http_code}' "${BASE}/login" 2>/dev/null)"
  if [ "${code}" != "000" ] && [ -n "${code}" ]; then
    ready=1
    break
  fi
  sleep 1
done
if [ "${ready}" -ne 1 ]; then
  echo "FAIL: server did not answer on ${BASE}/login within 60 s"
  echo "--- server log (last 20 lines)"
  tail -20 "${SERVER_LOG}"
  exit 1
fi

# check <path> <expected string> [absent string]
check() {
  path="$1"
  expect="$2"
  absent="${3:-}"
  body="${WORK}/body.html"
  status="$(curl -s -o "${body}" -w '%{http_code}' "${BASE}${path}")"
  echo "${status} ${BASE}${path}"
  if [ "${status}" != "200" ]; then
    FAILED=1
  fi
  if grep -q "Application error" "${body}"; then
    echo "    'Application error': FOUND  <-- FAIL"
    FAILED=1
  else
    echo "    'Application error': not found"
  fi
  if grep -q "${expect}" "${body}"; then
    echo "    '${expect}': found"
  else
    echo "    '${expect}': NOT FOUND  <-- FAIL"
    FAILED=1
  fi
  if [ -n "${absent}" ]; then
    # VISIBLE MARKUP ONLY: Next embeds the requested URL, query string and
    # segment key (e.g. __PAGE__?{"error":"..."}) in its own <script>
    # self.__next_f router payload on every page, whatever the page renders
    # (observed 2 Nov: 3 matches, all inside <script>, 0 outside). T-OTP-07's
    # rule is about what the page renders, so script blocks are stripped first.
    visible="${WORK}/visible.html"
    perl -0pe 's#<script\b.*?</script>##gs' "${body}" >"${visible}"
    if grep -q "${absent}" "${visible}"; then
      echo "    '${absent}' must be absent from visible markup: FOUND  <-- FAIL"
      FAILED=1
    else
      echo "    '${absent}' must be absent from visible markup: absent"
    fi
  fi
}

echo "== requests (signed-out GETs only; no action is called, no email is sent)"
check "/login" "Sign in to Quoco"
check "/login?error=RESEND_RATE_LIMITED" "Sign in to Quoco"
check "/login?error=NOT_A_REAL_KEY" "Sign in to Quoco" "NOT_A_REAL_KEY"
check "/login?step=code&email=smoke%40example.com" "Enter your code"
check "/login?step=code&email=smoke%40example.com&error=WRONG_CODE" "Enter your code"

if [ "${FAILED}" -ne 0 ]; then
  echo "== RESULT: FAIL"
  echo "--- server log (last 30 lines)"
  tail -30 "${SERVER_LOG}"
  exit 1
fi
echo "== RESULT: PASS"
exit 0
