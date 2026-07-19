#!/usr/bin/env bash
# systemd / 手动前台启动聊天服务
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"
export HOME="${HOME:-$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f6)}"
: "${HOME:=$(pwd)}"
export PATH="/usr/bin:/bin:/usr/local/bin:${PATH:-}"
export LANG="${LANG:-C.UTF-8}"
unset http_proxy https_proxy HTTP_PROXY HTTPS_PROXY ALL_PROXY all_proxy || true
exec /usr/bin/node "$ROOT/server/server.js"
