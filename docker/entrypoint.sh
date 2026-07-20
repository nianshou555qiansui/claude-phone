#!/usr/bin/env bash
# Container entrypoint: prepare dirs, force bind, light self-check, then exec Node.
set -euo pipefail

export HOME="${HOME:-/home/claude}"
export BIND="${BIND:-0.0.0.0}"
export PORT="${PORT:-7681}"
export WORK_DIR="${WORK_DIR:-/workspace}"
export CLAUDE_BIN="${CLAUDE_BIN:-claude}"
export DOCKER="${DOCKER:-1}"

# Always listen inside the container (config.env may say 127.0.0.1 for bare-metal)
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

if [[ -z "${AUTH_PASS:-}" ]]; then
  # Also accept config.env mounted at /app/config.env (loaded by Node)
  if [[ ! -f /app/config.env ]] || ! grep -qE '^AUTH_PASS=.+' /app/config.env 2>/dev/null; then
    echo "[claude-phone] WARN: AUTH_PASS empty — set it in env or config.env (Basic Auth)" >&2
  fi
fi

echo "[claude-phone] listen ${BIND}:${PORT}  HOME=${HOME}  WORK_DIR=${WORK_DIR}"

exec "$@"
