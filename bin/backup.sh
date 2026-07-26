#!/usr/bin/env bash
# Daily backup for claude-phone: data/ (sessions, messages, jobs) + config.env.
# Archives are plain tar.gz; config.env holds relay tokens, so the backup dir
# and archives are kept 700/600.
#
# Overridable via env:
#   CLAUDE_PHONE_DIR          app dir      (default: repo root above this script)
#   CLAUDE_PHONE_BACKUP_DIR   destination  (default: /var/backups/claude-phone)
#   CLAUDE_PHONE_BACKUP_KEEP  keep days    (default: 14)
set -euo pipefail

APP_DIR="${CLAUDE_PHONE_DIR:-$(cd "$(dirname "$0")/.." && pwd)}"
BACKUP_DIR="${CLAUDE_PHONE_BACKUP_DIR:-/var/backups/claude-phone}"
KEEP_DAYS="${CLAUDE_PHONE_BACKUP_KEEP:-14}"

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

members=()
[ -d "$APP_DIR/data" ] && members+=(data)
[ -f "$APP_DIR/config.env" ] && members+=(config.env)
if [ "${#members[@]}" -eq 0 ]; then
  echo "nothing to back up under $APP_DIR" >&2
  exit 0
fi

ts=$(date +%F-%H%M%S)
tmp="$BACKUP_DIR/.claude-phone-$ts.tar.gz.part"
out="$BACKUP_DIR/claude-phone-$ts.tar.gz"

# The server may append to message files mid-archive; tar exits 1 for
# "file changed as we read it" — tolerate that, fail on real errors (>=2).
rc=0
tar --warning=no-file-changed -czf "$tmp" -C "$APP_DIR" "${members[@]}" || rc=$?
if [ "$rc" -ge 2 ]; then
  rm -f "$tmp"
  echo "tar failed with exit $rc" >&2
  exit "$rc"
fi

mv "$tmp" "$out"
chmod 600 "$out"
echo "backup written: $out ($(du -h "$out" | cut -f1))"

find "$BACKUP_DIR" -name 'claude-phone-*.tar.gz' -type f -mtime "+$KEEP_DAYS" -delete
