# Claude Phone

> 在手机浏览器里，用聊天气泡驱动**你自己服务器上的 Claude Code CLI**。不依赖 claude.ai 订阅，第三方中转 API（`ANTHROPIC_BASE_URL`）直接可用。

[![CI](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml/badge.svg)](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg)](https://nodejs.org/)
[![Deps](https://img.shields.io/badge/runtime%20deps-0-success.svg)](./package.json)

**适合谁**：用中转 API 跑 Claude Code 的自托管用户；官方 Remote Control 用不了/不想用的人；1–2 GB 小内存 VPS（CLI **按消息临时启动**，不常驻吃内存）。

**30 秒跑起来：**

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git && cd claude-phone
cp config.env.example config.env    # 必改 AUTH_PASS；建议设 WORK_DIR
node server/server.js               # → http://127.0.0.1:7681
```

用 `config.env` 里的 `AUTH_USER` / `AUTH_PASS` 登录即可对话。生产部署（systemd + 反代 HTTPS / Docker）见下文。

[English ↓](#english)

---

## ✨ 为什么用它

| 官方 Remote Control | Claude Phone |
|---------------------|--------------|
| 需要 claude.ai Pro/Max 等订阅 | API key / **中转**（`ANTHROPIC_BASE_URL`）就能用 |
| 非 `api.anthropic.com` 直接禁用 | 用你 `~/.claude/settings.json` 里配的任何上游 |
| 官方 App / claude.ai 界面 | 自托管网页，聊天气泡 + 正常滚动（不是网页里嵌终端） |
| CLI 整段会话常驻 | **每条消息**起一个 `claude -p`，跑完即退（省内存） |

---

## 📱 功能总览

| 能力 | 说明 |
|------|------|
| 表单登录 | 真正的 `/login` 页面（非浏览器弹窗），Cookie 会话约 30 天；浏览器可记住账号密码；侧栏可退出 |
| 流式对话 | SSE 逐字输出；Markdown（GFM + 代码块一键复制）；多会话侧栏 |
| 长会话性能 | 消息列表**窗口化渲染**：默认只画最近 60 条，顶部「加载更早」按需展开（滚动位置锚定不跳动）；超长流式回合实时区只渲染尾部，完成后显示全文 |
| 界面 | 暖色纸感主题；**跟随系统 / 浅色 / 夜间** 循环切换；**中文 / EN** 界面语言（`localStorage` 记忆，服务端文案按 `Accept-Language` 对齐） |
| 状态 HUD | 顶栏下方：模型 · 权限模式 · 会话时长 · Context 条（来自上一轮 CLI `usage`） |
| 工具时间线 | 助手气泡下可折叠「工具 · N 步」；默认摘要，**点「加载全文」按需拉完整 in/out**（落盘上限约 48–96KB/步） |
| 模型选择器 | 顶栏芯片或 `/model` 打开；本会话 vs 全局默认两档；搜索、分组、显示中转映射后的真实模型名 |
| 上游模型获取 | 模型 sheet →「添加自定义模型」→「⇣ 从上游获取」：服务端拉中转 `/v1/models`（Anthropic / OpenAI 风格自动识别），点选即添加；**token 不出后端**，60s 缓存 |
| 导入本机会话 | 侧栏「导入本机会话」或 `/resume`：扫描 `~/.claude/projects`，把 Termius/SSH 里聊过的 CLI 会话接到手机上继续 |
| 增量同步 | 打开已导入会话自动追加 CLI 新消息（去重、防拆条重复）；`/sync` 强制刷新 |
| 后台任务 | 勾选 = 关网页继续跑，回来恢复 partial 文本 + 工具时间线；不勾选 = 断开约 4 秒后自动停；**■** 随时取消 |
| 权限模式 | 顶栏芯片 ≈ 桌面 Shift+Tab，透传 `--permission-mode` |
| 手机工具审批 | 有副作用工具推手机卡片：**允许 / 拒绝 / 本回合全允 / 本会话总是允许**；白名单落在会话上，重启仍有效；只读工具自动放行；超时默认拒绝 |
| 手机推送 | 配 `NOTIFY_URL`（ntfy / Bark / 自定义 webhook）后：**审批待决、回合在无人查看时结束、探针失败**会推到手机；正文默认不带内容预览 |
| 探针巡检 | 每 24h 空闲时自动跑一次 CLI 契约探针（模型取网页最近在用的）；失败→页顶横幅（可关，同次失败不重复打扰）+ 推送 |
| 设置编辑器 | ⚙ 直接改服务用户的 `~/.claude/settings.json`（中转 URL / token / 模型映射；密钥掩码显示，改动自动备份且备份 600 权限） |
| 聊天命令 | `/help` `/rewind` `/clear` `/compact` `/status` `/mode` `/cwd` `/model` `/resume` `/sync`（详表见下） |

---

## 🧠 核心行为（务必理解）

| 点 | 说明 |
|----|------|
| 常驻的是谁 | 只有 **Node 网页服务**（零 npm 运行时依赖） |
| Claude CLI | **每条消息**临时 `claude -p --output-format stream-json`，跑完退出 |
| 会话延续 | 有有效 `claudeSessionId` 时下一条消息带 `--resume`；`/rewind`、`/clear`、换目录后改为**历史注入**（把近 30 轮文本拼进 prompt） |
| 切换对话 ≠ resume | 侧栏切换只换网页档案；`--resume` 在**发送时**才附加 |
| 交互式 CLI 会话 | 终端 TUI 里开的会话（`entrypoint: cli`）**无法** `claude -p --resume`；导入后看得到历史气泡，续聊走历史注入 |
| 运行用户 | 一切读写该 OS 用户的 `~/.claude/`。**必须用已配好 Claude Code 的同一用户跑 Node**（root 和普通用户是两套 `~/.claude`） |
| 数据落盘 | 网页会话 `./data/sessions.json` + `./data/messages/*.jsonl`；任务进度 `./data/jobs/`（含运行中回合的 `<id>.stream` 事件流，终局自动清理）；CLI 临时目录固定在 `./data/cli-tmp`（配合 systemd PrivateTmp） |
| 工具审批 | `default`/`acceptEdits` 下有副作用的工具经 PreToolUse hook 回调服务，等手机决定才执行；决定权在你，不在 CLI 规则 |
| 重启不断任务 | CLI 子进程不接服务管道、事件流直写 `data/jobs/<id>.stream`；配合 unit 的 `KillMode=process`，`systemctl restart` 后服务自动接管仍在跑的回合（静默重放追平→继续直播） |

---

## 🔐 权限模式

`-p` 本身无原生弹窗，本项目用 PreToolUse hook 补了**手机审批**（见功能总览）；模式仍决定基础策略：

| 模式 | 行为 |
|------|------|
| `acceptEdits` | 自动接受工作区内文件编辑与常见文件系统命令（默认）；有副作用的 Bash/MCP 仍推手机审批 |
| `plan` | 只读探索，不改源码（不触发审批） |
| `default` | 有副作用的工具推手机审批卡片，只读工具自动放行 |
| `dontAsk` | 不在白名单的工具一律拒绝 |
| `bypassPermissions` | 跳过权限提示（附加 `--dangerously-skip-permissions`）——**危险，仅限自己服务器** |
| `auto` | CLI 自动模式（需 CLI 支持） |

`~/.claude/settings.local.json` 的 `permissions.allow` 白名单叠加生效——白名单很大时各模式体感会趋同。

---

## 🧰 聊天命令

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

## ⚙️ 配置（`config.env`）

从 `config.env.example` 复制；**不要提交 `config.env`**。

| 变量 | 说明 | 默认 / 示例 |
|------|------|-------------|
| `AUTH_USER` / `AUTH_PASS` | 网页登录（`/login` 表单 + Cookie；curl 仍可用 `-u`） | `admin` / 强密码 |
| `BIND` / `PORT` | 监听地址 / 端口 | `127.0.0.1` / `7681` |
| `WORK_DIR` | Claude 默认工作目录 | 空 → `$HOME` |
| `DEFAULT_PERMISSION_MODE` | 新会话权限 | `acceptEdits` |
| `DEFAULT_BACKGROUND` | `1` = 默认后台任务 | `1` |
| `MAX_CONCURRENT_TURNS` | 并发 CLI 进程数 | `1`（小内存机保持 1） |
| `APPROVAL_TIMEOUT_MS` | 手机工具审批等待时限，超时默认拒绝 | `120000` |
| `TURN_TIMEOUT_MS` | 单轮超时 | `600000`（10 分钟） |
| `CLAUDE_BIN` | Claude 可执行文件 | `claude` |
| `PUBLIC_URL` / `PUBLIC_HOST` | 公网地址（仅 Caddy 辅助脚本用） | `https://claude.example.com` |
| `NOTIFY_URL` | 手机推送地址（空 = 关）：审批待决 / 无人在看时回合结束 / 探针失败 | `https://ntfy.sh/私密主题` 或 `https://api.day.app/KEY` |
| `NOTIFY_KIND` | 推送格式：`ntfy` \| `bark` \| `json` | `ntfy` |
| `NOTIFY_PREVIEW` | `1` = 推送正文带内容预览（经第三方服务，默认不带） | `0` |
| `PROBE_INTERVAL_H` | CLI 契约探针巡检间隔（小时），`0` = 关；失败→页顶横幅+推送 | `24` |

---

## 🏭 生产部署

### systemd（推荐）

```bash
cd /path/to/claude-phone
cp config.env.example config.env && vim config.env
./install-service.sh        # 按当前用户/路径渲染 unit 并 enable --now
```

```bash
sudo systemctl status claude-phone
sudo journalctl -u claude-phone -f
```

模板见 `systemd/claude-phone.service.example`（占位符 `__USER__` `__HOME__` `__ROOT__`）；**不要提交**渲染后的个人 unit。

### Caddy 反代

应用自带 **`/login` 表单登录**（Cookie，浏览器可记住密码）。**反代不要再套 `basic_auth`**，否则仍弹系统账号窗。

```bash
./bin/sync-caddy-auth.sh          # 推荐：只 TLS + 反代
# CADDY_BASIC_AUTH=1 ./bin/sync-caddy-auth.sh  # 旧双层 Basic（不推荐）
```

```caddyfile
claude.example.com {
	encode gzip zstd
	# 不要 basic_auth — 鉴权由应用 /login 负责
	reverse_proxy 127.0.0.1:7681 {
		transport http {
			read_timeout 0
			write_timeout 0
		}
		flush_interval -1     # SSE 必须
	}
}
```

nginx 要点：`proxy_buffering off` + 长 `proxy_read_timeout`（SSE）。

### Docker（可选）

镜像内置 Node 20 + Claude Code CLI；卷挂 网页数据 / `~/.claude` / 工作目录：

```bash
cp config.env.example config.env    # 设 AUTH_PASS
mkdir -p data workspace
docker compose up -d --build        # → http://127.0.0.1:7681
```

细节与限制见 [docker/README.md](./docker/README.md)。宿主机 systemd 已经跑得好就不必上 Docker。

### 升级 Claude Code CLI

本项目依赖 CLI 的 `stream-json` 输出格式，升级 CLI 存在格式漂移风险。请用带门禁的升级脚本，不要裸升：

```bash
./bin/upgrade-cli.sh            # 升到 latest；或指定版本 ./bin/upgrade-cli.sh 2.1.220
```

流程：记录当前版本 → 安装 → 跑契约探针（`bin/cli-probe.js`，断言 init/assistant/result/usage 封套齐全）→ 失败自动回滚原版本（隔 20s 重试一次，防中转瞬时故障误判）。服务按轮 spawn CLI，升级/回滚都**无需重启**。升级成功后建议：网页发一条消息冒烟，并重录测试标本跑一遍单测：

```bash
node bin/cli-probe.js --record test/fixtures/stream-ping.jsonl && npm test
```

注意：部分中转**按模型分账号池**，探针默认用 CLI 默认模型，可能与网页实际在用的池子不同。用 `CLI_PROBE_MODEL` 指定网页在用的模型才有代表性：

```bash
CLI_PROBE_MODEL=<网页在用的模型id> ./bin/upgrade-cli.sh
```

`--record` 产物已自动脱敏（剔除 hook 行、抹平 uuid 与本机清单），可直接提交。

建议在 GitHub Watch [anthropics/claude-code](https://github.com/anthropics/claude-code) 的 Releases，新版本先观望几天再升。

### 迁移与备份恢复

换服务器、从每日备份灾难恢复、Docker 部署迁移，见 **[docs/migration.md](docs/migration.md)**。
要点：每日备份只含 `data/` + `config.env`，**中转令牌在 `~/.claude/settings.json` 里，
需单独迁移**；恢复流程已于 2026-07 实际演练过，手册附季度复检命令。

---

## 🧱 架构

```
手机 / 浏览器
    │  HTTPS（反代）+ Basic Auth
    ▼
Node 服务  127.0.0.1:<PORT>（常驻，低内存，零依赖）
    │  每条消息 spawn 一次
    ▼
claude -p --output-format stream-json [--permission-mode …] [--model …] [--resume …]
    │  任务: ./data/jobs/     会话: ./data/messages/ + sessions.json
    ▼
本机文件系统 + ~/.claude/settings.json（运行 Node 的那个 OS 用户）
```

---

## 🌐 HTTP API（概览）

| 方法 | 路径 | 用途 |
|------|------|------|
| `GET` | `/api/health` | 探活（免鉴权，仅计数器，无主机路径） |
| `GET` | `/api/meta` | 模式 / 命令 / 运行时信息（随 `Accept-Language` 本地化） |
| `GET/POST` | `/api/sessions` | 列表 / 新建会话 |
| `GET/PATCH/DELETE` | `/api/sessions/:id` | 详情（绑定 CLI 时自动增量同步）/ 更新 / 删除 |
| `GET` | `/api/sessions/:id/events` | SSE 流（重连回放 partial + 工具时间线） |
| `POST` | `/api/sessions/:id/messages` | 发消息（`background` 布尔） |
| `POST` | `/api/sessions/:id/abort` | 停止当前轮 |
| `POST` | `/api/sessions/:id/rewind` | 回退 |
| `GET/POST` | `/api/sessions/import` | 可导入 CLI 会话列表 / 执行导入 |
| `POST` | `/api/sessions/:id/sync` | 强制 CLI→网页 增量同步 |
| `GET` | `/api/jobs` · `/api/jobs/:id` | 任务列表 / 详情（partial 文本） |
| `POST` | `/api/jobs/:id/cancel` | 取消任务 |
| `GET/PUT` | `/api/settings` | 读 / 写 Claude settings（GET 时密钥掩码） |
| `GET` | `/api/models` | 模型目录（别名 / 环境映射 / 自定义） |
| `GET` | `/api/models/upstream` | 服务端拉中转 `/v1/models`（60s 缓存，`?force=1` 强刷） |
| `POST` | `/api/models/select` | `{ model, scope: "session"\|"default", sessionId? }` |
| `POST/DELETE` | `/api/models/custom(/:id)` | 增 / 删自定义模型 |

静态页面由 `public/` 提供。

---

## 🛡️ 安全

- 默认只听 `127.0.0.1`；公网必须 **反代 TLS + 鉴权**，`AUTH_PASS` 用强密码
- 这个应用 ≈ **该 OS 用户在服务器上开着 Claude Code**（shell、文件、工具全有）——按生产管理后台对待
- Basic Auth 采用常量时间比较；`/api/health` 不泄露主机路径；settings 备份自动 `600` 权限
- `config.env`、`./data/` 保持私有且已 gitignore

---

## 📁 项目结构

```
claude-phone/
  public/                      # 前端（原生 HTML/CSS/JS，无构建步骤）
  server/
    server.js                  # HTTP + SSE API
    lib/
      claude-runner.js         # spawn + 解析 stream-json（含工具事件）
      store.js                 # 会话 / 消息落盘
      jobs.js                  # 后台任务持久化 + 清理
      commands.js              # 聊天层 slash 命令
      models.js                # 模型目录 + 上游 /v1/models
      dedupe.js                  # 消息指纹 + 近重复折叠
      approvals.js               # 手机工具审批注册表（请求/决定/超时）
      session-import.js        # 扫描 ~/.claude/projects（/resume）
      settings-editor.js       # ~/.claude/settings.json 读写
      config.js                # config.env 加载
  test/                        # 单元测试（node --test，零依赖）
  data/                        # 运行时数据（gitignore）
  Dockerfile / docker-compose.yml / docker/
  systemd/claude-phone.service.example
  install-service.sh
  bin/                         # healthcheck / 备份 / CLI 探针与升级 / 审批 hook / caddy 辅助
```

---

## ⚠️ 已知限制

1. **不是完整 Claude Code TUI**——无 `/context` 原生面板；模型选择 / `/resume` / 逐工具审批均已用网页等价实现
2. **手机审批需在线响应**——审批卡片靠页面或后台推送；无人处理则默认拒绝（超时 `APPROVAL_TIMEOUT_MS`，默认 120s）。`plan` / `bypassPermissions` 模式不触发审批（前者原生只读、后者全放行）。配 `NOTIFY_URL` 后**待审批会推送到手机**（ntfy / Bark），点开网页即可处理
3. **后台任务已与服务进程解耦**——`systemctl restart` 不再中断任务（CLI 子进程独立写事件流，重启后自动接管续播；停机期间跑完的按真实结果收尾）。机器重启仍会中断。**升级到此版本的老部署需给 unit 加 `KillMode=process`（见 example）**
4. **默认并发 1**——长任务会占住队列（小内存机的刻意取舍）
5. **工具时间线默认摘要**——步数上限约 80；点「加载全文」可拉完整 in/out（单步有上限）。无实时 diff / 无限日志
6. **导入是文本气泡，非完整事件回放**——跳过 thinking / 纯工具行；约 200 条、超大文件只读尾部 ~2MB；只扫服务用户
7. **每轮有 CLI 冷启动开销**——暂无 keep-warm 池
8. **单 Basic Auth，非多用户产品**
9. **stream-json 形状随 CLI 版本可能漂移**——用 `./bin/upgrade-cli.sh` 升级（探针门禁+自动回滚），勿裸升；平时默认每 24h 自动巡检一次探针（`PROBE_INTERVAL_H`），失败页顶横幅 + 推送预警
10. **尚无完整 Telegram 对话桥**——但提醒场景（审批 / 回合结束 / 探针失败）已由推送通知覆盖，对话仍在网页（欢迎 PR）

---

## 🧯 排障

| 症状 | 排查 |
|------|------|
| 反代后空白 / 502 | `curl 127.0.0.1:PORT/api/health`；反代 SSE 缓冲要关 |
| 401 循环 | 应用与反代 Basic Auth 双层打架 |
| 点了没反应 / 秒失败 | 以**服务同一用户**执行 `claude -p 'hi'` 验证 CLI 本身 |
| 模型/中转不对 | 模型芯片 + ⚙ 设置；或直接查该用户 `~/.claude/settings.json` |
| 切了模型没生效 | 看芯片档位（本会话 vs 默认）；下一条消息才生效；中转可能把多个别名映到同一上游 |
| 模式像没区别 | `settings.local.json` 白名单太宽；用 plan vs bypass 写文件对比验证 |
| 小内存 OOM | `MAX_CONCURRENT_TURNS=1`；及时停失控任务 |
| 重启后任务没了 | 预期行为，见限制 §3 |
| 导入列表为空 | 服务用户没有 `~/.claude/projects` 会话；先以该用户跑一次 `claude` |
| 导入后 `--resume` 失败 | 会话已失效 / 用户不对 / 交互式会话（自动转历史注入） |

---

## 🤝 贡献

欢迎 PR：多用户鉴权、消息渠道（Telegram 等）、CLI keep-warm 池、更丰富的工具时间线（diff / 完整日志）、导入增强。

请**不要**提交：`config.env`、`./data/`、真实 token、含个人路径的 systemd unit。

## 📝 License

MIT — 见 [LICENSE](./LICENSE)。

---

# English

> Chat-bubble web UI on your phone driving the **Claude Code CLI on your own server**. No claude.ai subscription needed — third-party relays (`ANTHROPIC_BASE_URL`) work out of the box.

**Who it's for**: self-hosters running Claude Code through a relay API; people who can't/won't use official Remote Control; small 1–2 GB VPSes (the CLI is **spawned per message**, never resident).

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git && cd claude-phone
cp config.env.example config.env    # set AUTH_PASS (and ideally WORK_DIR)
node server/server.js               # → http://127.0.0.1:7681
```

Log in with `AUTH_USER` / `AUTH_PASS`. Zero npm runtime dependencies; Node ≥ 18.

### Why

| Official Remote Control | Claude Phone |
|-------------------------|--------------|
| Needs claude.ai Pro/Max subscription | Works with API key / relay (`ANTHROPIC_BASE_URL`) |
| Disabled off `api.anthropic.com` | Uses whatever `~/.claude/settings.json` says |
| Official app UI | Self-hosted chat page, normal scrolling |
| CLI resident per session | One `claude -p` per message, exits after the turn |

### Features

- **Streaming chat** (SSE) with Markdown + code-copy; multi-session sidebar
- **Long-session performance**: windowed rendering (last 60 messages + "load earlier" with scroll anchoring); very long streaming turns render only the tail live, full text on completion
- **Phone push notifications** (optional `NOTIFY_URL`, ntfy / Bark / generic JSON webhook): pending tool approvals, turns finishing while nobody watches, probe failures; body carries no content preview unless `NOTIFY_PREVIEW=1`
- **CLI contract watchdog**: a daily probe run (`PROBE_INTERVAL_H`, idle-time only, uses your recently-used model) plus a dismissable failure banner in the web UI
- **Parchment UI** with system/light/dark toggle and **中文 / EN** UI language (persisted; server strings follow `Accept-Language`)
- **Status HUD**: model · permission mode · session duration · context bar (last CLI `usage`)
- **Tool timeline**: collapsible per-turn list (name / status / truncated in·out), persisted and restored on reconnect
- **Model picker**: session vs default scope, search, resolved relay ids; **upstream fetch** pulls `{base}/v1/models` server-side (Anthropic or OpenAI style, token never reaches the browser) with one-tap add
- **Import local CLI sessions** (`/resume`): scan `~/.claude/projects`, continue SSH/Termius chats from the phone; incremental deduped sync on open or `/sync`
- **Background jobs**: survive tab close (toggle), restore partial text + tools on reconnect; foreground aborts ~4s after last client leaves; **■** cancels anytime
- **Permission modes** chip (≈ Shift+Tab) passed as `--permission-mode`; **settings editor** (⚙) for relay URL / token with masked secrets and 600-perm backups
- Chat-layer commands: `/help` `/rewind` `/clear` `/compact` `/status` `/mode` `/cwd` `/model` `/resume` `/sync`

### Key behaviors

- Only the **Node server** is long-running; every message spawns `claude -p --output-format stream-json`
- Next turn uses `--resume <id>` when the chat still holds a valid Claude session id; after `/rewind`, `/clear` or cwd change, context falls back to **history injection**
- Sessions started in the interactive TUI (`entrypoint: cli`) cannot be resumed via `-p`; imports still show history and continue via injection
- Run Node as the **same OS user** that owns the Claude Code config — different users mean different `~/.claude/` trees
- Web data lives in `./data/` (sessions, messages, job progress)

### Configuration

Copy `config.env.example` → `config.env` (never commit it): `AUTH_USER/AUTH_PASS`, `BIND`/`PORT` (default `127.0.0.1:7681`), `WORK_DIR`, `DEFAULT_PERMISSION_MODE` (`acceptEdits`), `DEFAULT_BACKGROUND` (`1`), `MAX_CONCURRENT_TURNS` (`1`), `TURN_TIMEOUT_MS` (`600000`), `CLAUDE_BIN`, `PUBLIC_URL`/`PUBLIC_HOST`.

### Deploy

- **systemd**: `./install-service.sh` renders `systemd/claude-phone.service.example` for the current user/path and enables the service
- **Reverse proxy**: terminate TLS + auth at Caddy/nginx; disable SSE buffering (`flush_interval -1` / `proxy_buffering off`)
- **Docker** (optional): image bundles Node 20 + Claude Code CLI; volumes for `./data`, Claude home, workspace — see [docker/README.md](./docker/README.md)
- **Migration & restore**: server moves, disaster recovery from daily backups, Docker moves — see [docs/migration.md](./docs/migration.md) (relay token lives in `~/.claude/settings.json`, not in the backup)

### HTTP API

Same table as the Chinese section above — sessions / messages / SSE events / abort / rewind / import / sync / jobs / settings / models (`/api/models/upstream` fetches relay `/v1/models` with a 60s cache). `/api/health` is unauthenticated and returns counters only.

### Known limitations

Not a full TUI, but per-tool approval is supported via a PreToolUse hook (side-effecting tools push a phone card: allow / deny / allow-all; read-only tools auto-pass; 120s default-deny — set `NOTIFY_URL` to get pending approvals pushed to your phone); background jobs **survive service restarts** (`KillMode=process` + on-disk event streams; add that line to pre-v1.2 units) though a machine reboot still kills them; default concurrency 1; tool timeline is summary-level (~80 steps, truncated payloads); imports are text bubbles, not full event replays; per-turn CLI cold start; single Basic Auth pair; `stream-json` shapes may drift across CLI versions; no full Telegram chat bridge yet — but push notifications already cover the alerting cases (PRs welcome).

### Security

Loopback bind + TLS reverse proxy + strong password. This app equals **that OS user running `claude` in a terminal** — treat it like a production admin panel. Constant-time auth compare; health endpoint leaks no host paths; settings backups are chmod 600.

### License

MIT — see [LICENSE](./LICENSE).
