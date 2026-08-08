# 功能与配置

完整能力清单和配置说明。想快速上手看 [README](../README.md)。

## 功能

| 能力 | 说明 |
|------|------|
| 长会话 | 消息列表只渲染最近 60 条，顶部「加载更早」按需展开（滚动位置不跳）；流式特别长时先只画尾部，结束后再出全文 |
| 状态栏 | 顶栏下方：模型 · 权限模式 · 会话时长 · Context 条（上一轮 CLI `usage`） |
| 工具时间线 | 助手气泡下可折叠「工具 · N 步」；默认摘要，点「加载全文」再拉完整 in/out（单步大约 48–96KB） |
| 模型选择 | 顶栏芯片或 `/model` 打开；本会话 / 全局默认两档；可搜、可分组，显示中转映射后的真实 id |
| 拉上游模型 | 模型 sheet →「添加自定义」→「从上游获取」：服务端打中转 `/v1/models`（Anthropic / OpenAI 风格都能认），点选即加；token 不出后端，60s 缓存 |
| 导入本机会话 | 侧栏「导入本机会话」或 `/resume`：扫 `~/.claude/projects`，把 Termius/SSH 里聊过的接到手机上继续 |
| 增量同步 | 打开已导入会话时自动补 CLI 新消息（去重）；`/sync` 强制刷新 |
| 后台任务 | 勾选 = 关网页继续跑，回来恢复 partial 文本 + 工具时间线；不勾选 = 断开约 4 秒后自动停；**■** 随时取消 |
| 权限模式 | 顶栏芯片 ≈ 桌面 Shift+Tab，把 `--permission-mode` 传给 CLI |
| 工具审批 | 有副作用的工具推手机卡片：允许 / 拒绝 / 本回合全允 / 本会话总是允许；白名单写在会话上，重启还在；只读工具自动过；超时默认拒 |
| 推送 | 配 `NOTIFY_URL`（ntfy / Bark / 自定义 webhook）：审批挂起、无人在看时回合结束、探针失败会推；默认不带内容预览 |
| 探针 | 默认每 24h 空闲时跑一次 CLI 契约探针（模型用网页最近在用的）；失败 → 页顶横幅（可关）+ 推送 |
| 设置 | ⚙ 直接改服务用户的 `~/.claude/settings.json`（中转 URL / token / 模型映射；密钥掩码，改前自动备份且 600） |
| 聊天命令 | `/help` `/rewind` `/clear` `/compact` `/status` `/mode` `/cwd` `/model` `/resume` `/sync`（详表见下） |

---

## 权限模式

`-p` 本身无原生弹窗，本项目用 PreToolUse hook 补了**手机审批**（见功能总览）；模式仍决定基础策略：

| 模式 | 行为 |
|------|------|
| `acceptEdits` | 自动接受工作区内文件编辑与常见文件系统命令（默认）；有副作用的 Bash/MCP 仍推手机审批 |
| `plan` | 只读探索，不改源码（不触发审批） |
| `default` | 有副作用的工具推手机审批卡片，只读工具自动放行 |
| `dontAsk` | 不在白名单的工具一律拒绝 |
| `bypassPermissions` | 跳过权限提示（附加 `--dangerously-skip-permissions`）——**危险，仅限自己服务器** |
| `auto` | CLI 自动模式（需 CLI 支持） |

`~/.claude/settings.local.json` 里的 `permissions.allow` 会叠加上去。白名单太宽时，各模式感觉上就差不多了。

CLI 的 `--permission-mode` 不会写进对话上下文，所以用户问「现在什么模式」时模型可能答错。每轮 prompt 前会加一小段运行环境说明来对齐。

---

## 聊天命令

输入框键入或 **/** 面板点选（应用层实现，非完整 TUI slash）：

| 命令 | 作用 |
|------|------|
| `/help` | 列出命令 |
| `/rewind` / `/rewind N` | 回退最近 N 个用户回合（含其回复） |
| `/clear` | 清空上下文（保留会话壳） |
| `/compact` | 只保留最近若干轮 |
| `/status` | 模式 / 目录 / resume id |
| `/mode <mode>` | 切权限模式 |
| `/cwd` / `/cwd /path` | 查看 / 切换工作目录 |
| `/model` · `/model <id>` | 打开选择器 / 直接设本会话模型 |
| `/resume` / `/import` · `/resume <uuid>` | 打开导入列表 / 按 id 导入 |
| `/sync` | 强制从 CLI transcript 增量同步（已导入会话） |

气泡上还有「回退到此之前 / 回退本轮」快捷操作。

---

## 配置（`config.env`）

从 `config.env.example` 复制。**别提交 `config.env`。**

| 变量 | 说明 | 默认 / 示例 |
|------|------|-------------|
| `AUTH_USER` / `AUTH_PASS` | 网页登录（`/login` 表单 + Cookie；curl 仍可用 `-u`） | `admin` / 强密码 |
| `BIND` / `PORT` | 监听地址 / 端口 | `127.0.0.1` / `7681` |
| `WORK_DIR` | Claude 默认工作目录 | 空 → `$HOME` |
| `DEFAULT_PERMISSION_MODE` | 新会话权限 | `acceptEdits` |
| `DEFAULT_BACKGROUND` | `1` = 默认后台任务 | `1` |
| `MAX_CONCURRENT_TURNS` | 同时跑的 CLI 进程数（跨会话并发，同会话仍串行）；内存够可调高 | `1` |
| `APPROVAL_TIMEOUT_MS` | 手机工具审批等待时限，超时默认拒绝 | `120000` |
| `TURN_TIMEOUT_MS` | 单轮超时 | `600000`（10 分钟） |
| `CLAUDE_BIN` | Claude 可执行文件 | `claude` |
| `PUBLIC_URL` / `PUBLIC_HOST` | 公网地址（仅 Caddy 辅助脚本用） | `https://claude.example.com` |
| `NOTIFY_URL` | 推送地址（空 = 关）：审批挂起、无人在看时回合结束、探针失败 | `https://ntfy.sh/私密主题` 或 `https://api.day.app/KEY` |
| `NOTIFY_KIND` | 推送格式：`ntfy` \| `bark` \| `json` | `ntfy` |
| `NOTIFY_PREVIEW` | `1` = 推送带内容预览（走第三方，默认关） | `0` |
| `PROBE_INTERVAL_H` | 探针间隔（小时），`0` = 关；失败 → 页顶横幅 + 推送 | `24` |
