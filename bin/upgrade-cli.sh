#!/usr/bin/env bash
# 一键升级 Claude Code CLI，带探针门禁与自动回滚。
# 用法: ./bin/upgrade-cli.sh [目标版本]     （默认 latest）
#
# 流程: 记录当前版本 → 安装目标版本 → 跑 bin/cli-probe.js 契约探针
#       → 通过则完成；失败则等 20s 重试一次（防中转瞬时故障误判）
#       → 仍失败则自动回滚到原版本并以非零退出。
# 服务按轮 spawn CLI，升级/回滚均无需重启 claude-phone。
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TARGET="${1:-latest}"

CUR="$(claude --version 2>/dev/null | awk '{print $1}')"
if [ -z "$CUR" ]; then
  echo "✗ 读不到当前 CLI 版本，中止（没有回滚锚点）" >&2
  exit 1
fi
echo "当前版本: $CUR → 目标: $TARGET"

sudo npm install -g "@anthropic-ai/claude-code@$TARGET"
NEW="$(claude --version 2>/dev/null | awk '{print $1}')"
echo "已安装: $NEW，运行探针门禁…"

probe() { node "$ROOT/bin/cli-probe.js"; }

if probe; then
  ok=1
else
  echo "探针失败——可能是中转瞬时故障，20s 后重试一次…"
  sleep 20
  if probe; then ok=1; else ok=0; fi
fi

if [ "$ok" = 1 ]; then
  echo ""
  echo "✓ 升级完成并通过探针: $CUR → $NEW"
  echo "  建议到网页发一条消息做最终冒烟。"
  echo "  回滚命令: sudo npm install -g @anthropic-ai/claude-code@$CUR"
  echo "  重录测试标本: node bin/cli-probe.js --record test/fixtures/stream-ping.jsonl"
else
  echo ""
  echo "✗ 探针两次失败，自动回滚 $NEW → $CUR" >&2
  sudo npm install -g "@anthropic-ai/claude-code@$CUR"
  echo "已回滚到: $(claude --version 2>/dev/null)" >&2
  echo "提示：若稍后单独跑 node bin/cli-probe.js 在旧版本上也失败，" >&2
  echo "则问题在中转而非 CLI 版本——等中转恢复后再升级。" >&2
  exit 1
fi
