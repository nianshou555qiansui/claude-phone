#!/usr/bin/env bash
# Container entrypoint: prepare dirs, force bind, light self-check, then exec Node.
set -euo pipefail

export HOME="${HOME:-/home/claude}"
export PORT="${PORT:-7681}"
export WORK_DIR="${WORK_DIR:-/workspace}"
export CLAUDE_BIN="${CLAUDE_BIN:-claude}"
export DOCKER="${DOCKER:-1}"

# Always listen inside the container (config.env may say 127.0.0.1 for bare-metal).
# Compose injects AUTH_* etc. as real process env via env_file — there is no
# mounted /app/config.env unless the operator adds one.
export BIND="0.0.0.0"

mkdir -p "${HOME}/.claude" /app/data "${WORK_DIR}" 2>/dev/null || true

# Optional: seed empty settings so the UI settings editor has a file to open
if [[ ! -f "${HOME}/.claude/settings.json" ]]; then
  printf '%s\n' '{}' > "${HOME}/.claude/settings.json" || true
fi

# Soft checks (do not hard-fail — user may mount claude later)
if ! command -v "${CLAUDE_BIN}" >/dev/null 2>&1; then
  echo "[claude-phone] WARN: CLAUDE_BIN='${CLAUDE_BIN}' not found on PATH" >&2
else
  echo "[claude-phone] claude: $(${CLAUDE_BIN} --version 2>/dev/null | head -1 || echo present)"
fi

# AUTH_PASS must come from process env (compose env_file) or optional /app/config.env mount
auth_ok=0
if [[ -n "${AUTH_PASS:-}" ]]; then
  auth_ok=1
elif [[ -f /app/config.env ]] && grep -qE '^AUTH_PASS=.+' /app/config.env 2>/dev/null; then
  auth_ok=1
fi
if [[ "$auth_ok" -eq 0 ]]; then
  echo "[claude-phone] WARN: AUTH_PASS empty — set it in config.env (compose env_file) or environment" >&2
fi

echo "[claude-phone] listen ${BIND}:${PORT}  HOME=${HOME}  WORK_DIR=${WORK_DIR}"

exec "$@"
