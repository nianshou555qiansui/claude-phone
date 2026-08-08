#!/usr/bin/env bash
# 同步 Caddy 站点块（PUBLIC_HOST）与 config.env。
#
# 默认（表单登录，推荐）：
#   只做 TLS 反代，**不**写 basic_auth——鉴权由 Claude Phone 的 /login + Cookie 负责，
#   浏览器可记住密码，也不再弹原生 Basic 窗。
#
# 旧行为（边缘 Basic Auth 双层）：
#   CADDY_BASIC_AUTH=1 ./bin/sync-caddy-auth.sh
#
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
# 0/空 = 表单登录（默认）；1 = 在 Caddy 再套一层 basic_auth
WANT_BASIC="${CADDY_BASIC_AUTH:-0}"

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

BASIC_BLOCK=""
if [[ "$WANT_BASIC" == "1" ]]; then
  RAW_HASH="$(caddy hash-password --plaintext "$AUTH_PASS")"
  BASIC_BLOCK="$(printf '\n\tbasic_auth {\n\t\t%s %s\n\t}\n' "$USER_NAME" "$RAW_HASH")"
  echo "mode: Caddy basic_auth ON (double auth with app login)"
else
  echo "mode: form login only (no Caddy basic_auth)"
fi

TS="$(date +%Y%m%d-%H%M%S)"
sudo cp "$CADDYFILE" "${CADDYFILE}.bak.${TS}"

export CP_CADDY_HOST="$HOST"
export CP_CADDY_PORT="$PORT"
export CP_CADDY_BASIC_BLOCK="$BASIC_BLOCK"
export CP_CADDYFILE="$CADDYFILE"

sudo -E python3 <<'PY'
import os, re, pathlib
path = pathlib.Path(os.environ["CP_CADDYFILE"])
host = os.environ["CP_CADDY_HOST"]
port = os.environ["CP_CADDY_PORT"]
basic = os.environ.get("CP_CADDY_BASIC_BLOCK") or ""
text = path.read_text(encoding="utf-8")
block = f'''{host} {{
	encode gzip zstd

	header {{
		X-Content-Type-Options nosniff
		Referrer-Policy strict-origin-when-cross-origin
		Permissions-Policy "camera=(), microphone=(), geolocation=()"
		X-Frame-Options SAMEORIGIN
		Strict-Transport-Security "max-age=31536000; includeSubDomains"
		-Server
	}}
{basic}
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
path.write_text(new_text, encoding="utf-8")
print(f"updated {path} host={host}")
PY

if ! sudo caddy validate --config "$CADDYFILE" >/tmp/caddy-validate.out 2>&1; then
  cat /tmp/caddy-validate.out >&2
  sudo cp "${CADDYFILE}.bak.${TS}" "$CADDYFILE"
  exit 1
fi
sudo systemctl reload caddy 2>/dev/null || sudo systemctl reload caddy.service 2>/dev/null || true
echo "Caddy synced for ${HOST} (backup ${CADDYFILE}.bak.${TS})"
if [[ "$WANT_BASIC" != "1" ]]; then
  echo "提示: 边缘已无 basic_auth，请用网页 /login 登录（浏览器可记住密码）。"
fi
