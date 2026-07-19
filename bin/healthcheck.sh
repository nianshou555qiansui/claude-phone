#!/usr/bin/env bash
# Local health check (exit 0 = healthy). Optional PUBLIC_URL check if set in config.env.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PORT=7681
PUBLIC_URL=""
AUTH_USER=""
AUTH_PASS=""

if [[ -f "$ROOT/config.env" ]]; then
  # shellcheck disable=SC1091
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/config.env"
  set +a
fi
PORT="${PORT:-7681}"

fail=0

code="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 5 "http://127.0.0.1:${PORT}/api/health" || echo 000)"
if [[ "$code" != "200" ]]; then
  echo "FAIL: local health HTTP $code (want 200)"
  fail=1
else
  echo "OK: local health $code"
fi

if [[ -n "${PUBLIC_URL:-}" ]]; then
  pub="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 10 "${PUBLIC_URL}/" || echo 000)"
  if [[ "$pub" != "401" && "$pub" != "200" ]]; then
    echo "FAIL: public HTTP $pub (want 401 with basic auth, or 200 if auth elsewhere)"
    fail=1
  else
    echo "OK: public $pub"
  fi
  if [[ -n "${AUTH_USER:-}" && -n "${AUTH_PASS:-}" && "$AUTH_PASS" != "change-me" ]]; then
    auth="$(curl --noproxy '*' -s -o /dev/null -w '%{http_code}' --max-time 10 -u "${AUTH_USER}:${AUTH_PASS}" "${PUBLIC_URL}/" || echo 000)"
    if [[ "$auth" != "200" ]]; then
      echo "FAIL: public auth HTTP $auth (want 200)"
      fail=1
    else
      echo "OK: public auth $auth"
    fi
  fi
fi

exit "$fail"
