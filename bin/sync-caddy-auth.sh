#!/usr/bin/env bash
# Sync Caddy basic_auth for PUBLIC_HOST from config.env (generic).
# Requires: caddy, passwordless sudo, PUBLIC_HOST set.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck disable=SC1091
set -a
source "$ROOT/config.env"
set +a

CADDYFILE="${CADDYFILE:-/etc/caddy/Caddyfile}"
HOST="${PUBLIC_HOST:-}"
PORT="${PORT:-7681}"
USER_NAME="${AUTH_USER:-admin}"

if [[ -z "$HOST" ]]; then
  echo "PUBLIC_HOST is empty; set it in config.env" >&2
  exit 1
fi
if [[ -z "${AUTH_PASS:-}" || "$AUTH_PASS" == "change-me" ]]; then
  echo "Set a real AUTH_PASS in config.env first" >&2
  exit 1
fi
if ! command -v caddy >/dev/null 2>&1; then
  echo "caddy not found" >&2
  exit 1
fi
if ! sudo -n true 2>/dev/null; then
  echo "passwordless sudo required to edit $CADDYFILE" >&2
  exit 1
fi

RAW_HASH="$(caddy hash-password --plaintext "$AUTH_PASS")"
B64_HASH="$(printf '%s' "$RAW_HASH" | base64 -w0 2>/dev/null || printf '%s' "$RAW_HASH" | base64)"
TS="$(date +%Y%m%d-%H%M%S)"
sudo cp "$CADDYFILE" "${CADDYFILE}.bak.${TS}"

sudo python3 - "$CADDYFILE" "$HOST" "$PORT" "$USER_NAME" "$B64_HASH" <<'PY'
import sys, re, pathlib
path, host, port, user, b64 = sys.argv[1:6]
text = pathlib.Path(path).read_text(encoding="utf-8")
block = f'''{host} {{
	encode gzip zstd

	header {{
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		-Server
	}}

	basic_auth {{
		{user} {b64}
	}}

	reverse_proxy 127.0.0.1:{port} {{
		transport http {{
			read_timeout 0
			write_timeout 0
		}}
		flush_interval -1
	}}
}}
'''
pat = re.compile(rf"(?ms)^[ \t]*{re.escape(host)}[ \t]*\{{.*?\n\}}\s*")
if pat.search(text):
    new_text = pat.sub(block.rstrip() + "\n\n", text, count=1)
else:
    new_text = text.rstrip() + "\n\n" + block
pathlib.Path(path).write_text(new_text, encoding="utf-8")
print(f"updated {path} host={host}")
PY

if ! sudo caddy validate --config "$CADDYFILE" >/tmp/caddy-validate.out 2>&1; then
  cat /tmp/caddy-validate.out >&2
  sudo cp "${CADDYFILE}.bak.${TS}" "$CADDYFILE"
  exit 1
fi
sudo systemctl reload caddy 2>/dev/null || sudo systemctl reload caddy.service 2>/dev/null || true
echo "Caddy basic_auth synced for ${HOST} (backup ${CADDYFILE}.bak.${TS})"
