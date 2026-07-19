#!/usr/bin/env bash
# Install / update systemd unit for Claude Phone (generic, any user/path).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ ! -f "$ROOT/config.env" ]]; then
  echo "Missing config.env. Run:"
  echo "  cp config.env.example config.env"
  echo "  # edit AUTH_PASS, WORK_DIR, ..."
  exit 1
fi

chmod +x "$ROOT/bin/"*.sh 2>/dev/null || true
chmod 600 "$ROOT/config.env" 2>/dev/null || true

if ! command -v node >/dev/null 2>&1; then
  echo "node not found in PATH" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemctl not found; install systemd or run: node server/server.js" >&2
  exit 1
fi
if ! sudo -n true 2>/dev/null; then
  echo "Passwordless sudo required to install the unit (or run the service manually)." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a
source "$ROOT/config.env"
set +a

SERVICE_USER="${SERVICE_USER:-$(id -un)}"
SERVICE_GROUP="${SERVICE_GROUP:-$(id -gn)}"
SERVICE_HOME="${SERVICE_HOME:-$HOME}"
NODE_BIN="$(command -v node)"
PORT="${PORT:-7681}"

# Default WORK_DIR if empty
if [[ -z "${WORK_DIR:-}" ]]; then
  WORK_DIR="$SERVICE_HOME"
  echo "WORK_DIR empty → using $WORK_DIR"
fi

TEMPLATE="$ROOT/systemd/claude-phone.service.example"
UNIT_OUT="$ROOT/systemd/claude-phone.service"
UNIT_DST=/etc/systemd/system/claude-phone.service

if [[ ! -f "$TEMPLATE" ]]; then
  echo "Missing $TEMPLATE" >&2
  exit 1
fi

# Render unit from template
sed \
  -e "s|__USER__|${SERVICE_USER}|g" \
  -e "s|__GROUP__|${SERVICE_GROUP}|g" \
  -e "s|__HOME__|${SERVICE_HOME}|g" \
  -e "s|__ROOT__|${ROOT}|g" \
  -e "s|__NODE__|${NODE_BIN}|g" \
  "$TEMPLATE" >"$UNIT_OUT"

echo "Rendered unit:"
echo "  User=$SERVICE_USER  Home=$SERVICE_HOME"
echo "  Root=$ROOT"
echo "  Node=$NODE_BIN"

# Optional Caddy auth sync
if [[ -n "${PUBLIC_HOST:-}" ]] && [[ -x "$ROOT/bin/sync-caddy-auth.sh" ]] && command -v caddy >/dev/null 2>&1; then
  echo "Syncing Caddy basic_auth for ${PUBLIC_HOST} ..."
  if ! "$ROOT/bin/sync-caddy-auth.sh"; then
    echo "Warning: Caddy sync failed; continuing with systemd install." >&2
  fi
else
  echo "Skip Caddy sync (set PUBLIC_HOST + install caddy to enable)."
fi

sudo cp "$UNIT_OUT" "$UNIT_DST"
sudo systemctl daemon-reload
sudo systemctl enable claude-phone.service
sudo systemctl restart claude-phone.service
sleep 0.8
sudo systemctl --no-pager --full status claude-phone.service | head -20 || true

for _ in $(seq 1 20); do
  if curl --noproxy '*' -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    echo "health OK → http://127.0.0.1:${PORT}"
    curl --noproxy '*' -s "http://127.0.0.1:${PORT}/api/health"
    echo
    exit 0
  fi
  sleep 0.3
done

echo "health check failed" >&2
sudo journalctl -u claude-phone -n 40 --no-pager >&2 || true
exit 1
