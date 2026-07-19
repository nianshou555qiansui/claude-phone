# Claude Phone

Self-hosted **mobile chat UI** for the [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

Use your phone or any browser to drive a **local** Claude Code process — file edits, shell tools, project work — without Anthropic’s official Remote Control.

**Why this exists**

| Official Remote Control | Claude Phone |
|-------------------------|--------------|
| Needs claude.ai Pro/Max (etc.) subscription | Works with API key / third-party **relay** (`ANTHROPIC_BASE_URL`) |
| Disabled when not on `api.anthropic.com` | Uses whatever you configured in `~/.claude/settings.json` |
| App / claude.ai UI | Simple chat UI you host yourself |
| Local CLI stays running for the session | CLI starts **per message**, exits when the turn ends (saves RAM on small VPS) |

[English](#claude-phone) · [中文](#中文)

---

## Features

### Chat experience

- Message bubbles, **streaming** assistant text (SSE)
- Normal browser scroll for history (not a full-screen TUI in a web terminal)
- Multiple conversations in a sidebar
- Stop button (**■**) to cancel the current run
- Mobile-friendly dark UI

### Process model

- Long-running **Node** server only (lightweight)
- Each user message **spawns** `claude -p --output-format stream-json`
- When the turn finishes, the CLI process **exits** (no always-on heavy agent)
- Concurrent runs limited by `MAX_CONCURRENT_TURNS` (default `1`, good for 1–2 GB RAM boxes)

### Background vs foreground jobs

| Toggle | Close browser / lose network | Use when |
|--------|------------------------------|----------|
| **Background ON** | Job **keeps running**; reopen the same chat to see progress / result | Long tasks, leave the phone |
| **Background OFF** | Last page connection gone ≈ **4 seconds** later → job **aborts** (refresh-safe grace period) | Short Q&A, save resources |
| **■ Stop** | Cancels immediately | Anytime |

Progress is stored under `./data/jobs/` so reconnect can restore partial text.

### Permission modes

Chip in the top bar (similar idea to desktop Shift+Tab). Modes are passed as `claude --permission-mode …`.

In **print / non-interactive** (`-p`) mode there is **no** approval popup:

| Mode | Rough behavior |
|------|----------------|
| `acceptEdits` | Auto-accept file edits / common FS commands in the workspace |
| `plan` | Prefer read-only exploration; avoid source edits |
| `default` | Follow allow/deny rules |
| `dontAsk` | Deny tools not pre-allowed |
| `bypassPermissions` | Skip most prompts (+ `--dangerously-skip-permissions`) — **dangerous** |
| `auto` | CLI auto mode (may fail if unsupported) |

`~/.claude/settings.local.json` **allow** rules still apply and can make modes feel “the same” if everything is already allowed.

### Settings editor (⚙)

Edit the **service user’s** Claude settings from the UI:

- `ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN` / API key, model mapping fields
- Secrets are **masked** when loaded; leave blank to keep; use `__CLEAR__` to delete a key
- Optional raw JSON overwrite
- Saves with a timestamped backup under `~/.claude/`

New turns pick up new settings; a **running** job still uses the old process environment.

### Chat-layer commands

Typed in the input or via **/** palette. Implemented by this app (not the full TUI slash UI):

| Command | Meaning |
|---------|---------|
| `/help` | List commands |
| `/rewind` / `/rewind N` | Drop last N user turns (+ following replies) |
| `/clear` | Clear conversation binding |
| `/compact` | Keep only recent turns |
| `/status` | Mode, cwd, resume id |
| `/mode <mode>` | Set permission mode |
| `/cwd` / `/cwd /path` | Show or set working directory |
| `/model <name>` | Hint model for next turn (if CLI supports) |

Message actions: “rewind this turn” on bubbles.

### Session continuity

- Local history: `./data/messages/*.jsonl` + `./data/sessions.json`
- When possible, next turn uses `claude --resume <session_id>`
- After `/rewind`, `/clear`, or cwd change: resume is cleared and history may be **injected into the prompt** instead

---

## Architecture

```
Phone / browser
    │  HTTPS (recommended) + HTTP Basic Auth
    ▼
Node server   127.0.0.1:<PORT>   (long-running, low RAM)
    │  one spawn per chat message
    ▼
claude -p --output-format stream-json [--permission-mode …] [--resume …]
    │  jobs: ./data/jobs/
    │  chats: ./data/messages/ + sessions.json
    ▼
Local filesystem + ~/.claude/settings.json  (of the OS user running Node)
```

**Important:** Run Node as the **same OS user** that already has Claude Code configured. Root vs `ubuntu` vs another account means **different** `~/.claude/` trees.

---

## Requirements

- Linux host (or any environment where Node + Claude Code CLI work)
- [Node.js](https://nodejs.org/) **≥ 18** (no npm dependencies required for the core server)
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed (`claude` on `PATH`, or set `CLAUDE_BIN`)
- Working Claude Code config for that user (official login **or** relay env in `settings.json`)
- For public internet: reverse proxy with TLS (Caddy / nginx / Traefik)

---

## Quick start

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git
cd claude-phone

cp config.env.example config.env
# Required: AUTH_PASS, preferably WORK_DIR (absolute path)
chmod 600 config.env

# Same user that owns Claude Code config
node server/server.js
# → http://127.0.0.1:7681
```

Log in with `AUTH_USER` / `AUTH_PASS` from `config.env`.

Health check:

```bash
curl -s http://127.0.0.1:7681/api/health
./bin/healthcheck.sh
```

---

## Configuration (`config.env`)

Copy from `config.env.example`. **Never commit `config.env`.**

| Variable | Description | Default / example |
|----------|-------------|-------------------|
| `AUTH_USER` / `AUTH_PASS` | Web UI Basic Auth | `admin` / strong password |
| `BIND` | Listen address | `127.0.0.1` |
| `PORT` | Listen port | `7681` |
| `WORK_DIR` | Default cwd for Claude | empty → `$HOME` / process default |
| `DEFAULT_PERMISSION_MODE` | New chats | `acceptEdits` |
| `DEFAULT_BACKGROUND` | `1` = background jobs by default | `1` |
| `MAX_CONCURRENT_TURNS` | Parallel CLI processes | `1` |
| `TURN_TIMEOUT_MS` | Max time per turn | `600000` (10 min) |
| `CLAUDE_BIN` | Claude binary | `claude` |
| `PUBLIC_URL` / `PUBLIC_HOST` | Public site (Caddy helper only) | `https://claude.example.com` |

---

## Production deploy

### systemd

```bash
cd /path/to/claude-phone
cp config.env.example config.env
# edit config.env

./install-service.sh
```

This script:

1. Renders `systemd/claude-phone.service` from `claude-phone.service.example` using **current user, `$HOME`, and install path**
2. Optionally runs `bin/sync-caddy-auth.sh` if `PUBLIC_HOST` is set and Caddy exists
3. `systemctl enable --now claude-phone`

Template only (placeholders `__USER__`, `__HOME__`, `__ROOT__`, …):  
`systemd/claude-phone.service.example`  
Do **not** commit a rendered unit with personal paths.

```bash
sudo systemctl status claude-phone
sudo systemctl restart claude-phone
sudo journalctl -u claude-phone -f
```

### Caddy example

```caddyfile
claude.example.com {
	encode gzip zstd
	basic_auth {
		# caddy hash-password
		YOUR_USER YOUR_HASH
	}
	reverse_proxy 127.0.0.1:7681 {
		transport http {
			read_timeout 0
			write_timeout 0
		}
		flush_interval -1
	}
}
```

Optional helper: `./bin/sync-caddy-auth.sh` (needs passwordless `sudo` and a real `AUTH_PASS`).

### nginx sketch

```nginx
location / {
  proxy_pass http://127.0.0.1:7681;
  proxy_http_version 1.1;
  proxy_set_header Connection '';
  proxy_buffering off;          # SSE
  proxy_read_timeout 3600s;
  proxy_set_header Host $host;
  proxy_set_header X-Real-IP $remote_addr;
  # Prefer terminating Basic Auth / OAuth at the proxy
}
```

---

## HTTP API (overview)

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/api/health` | Liveness + counters |
| `GET` | `/api/meta` | Modes, commands, runtime user, settings path |
| `GET/POST` | `/api/sessions` | List / create chats |
| `GET/PATCH/DELETE` | `/api/sessions/:id` | Chat detail / update / delete |
| `GET` | `/api/sessions/:id/events` | SSE stream |
| `POST` | `/api/sessions/:id/messages` | Send message (`background` bool) |
| `POST` | `/api/sessions/:id/abort` | Cancel run |
| `POST` | `/api/sessions/:id/rewind` | Rewind API |
| `GET` | `/api/jobs` | Job list |
| `GET` | `/api/jobs/:id` | Job detail / partial text |
| `POST` | `/api/jobs/:id/cancel` | Cancel job |
| `GET/PUT` | `/api/settings` | Read/update Claude settings (secrets masked on GET) |

Static UI is served from `public/`.

---

## Security

- Prefer **loopback bind** + reverse proxy TLS + auth  
- Strong `AUTH_PASS`; rotate if exposed  
- This app is effectively **the same power as that OS user running `claude` in a terminal** (tools, shell, files)  
- Do not expose unauthenticated on the public internet  
- Keep `config.env` and `./data/` private and gitignored  
- Settings editor can write tokens: protect the UI like production admin  

---

## Project layout

```
claude-phone/
  public/                      # Frontend (HTML/CSS/JS)
  server/
    server.js                  # HTTP + SSE API
    lib/
      claude-runner.js         # spawn + parse stream-json
      store.js                 # sessions / messages
      jobs.js                  # background job persistence
      commands.js              # local slash commands
      settings-editor.js       # ~/.claude/settings.json
      config.js                # env loading
  data/                        # runtime (gitignored)
  config.env.example
  install-service.sh
  systemd/claude-phone.service.example
  bin/sync-caddy-auth.sh
  bin/healthcheck.sh
  bin/run-foreground.sh
```

---

## Known issues & limitations

Honest list of current gaps (not a complete roadmap):

### Product / Claude Code parity

1. **Not a full Claude Code TUI**  
   No native visual `/rewind` picker, plugin menus, inline permission dialogs, image-heavy workflows as in the terminal UI. Chat + local slash commands only cover a subset.

2. **Permission UX is not “click Allow on the phone”**  
   `-p` is non-interactive. Modes change policy; they do **not** open desktop-style prompts. If a tool needs a human click, the turn may fail, hang until timeout, or be auto-denied/allowed by rules.

3. **`manual` mode is not real on this path**  
   Historically mapped away; use `default` / `dontAsk` / `plan` / `acceptEdits` / `bypassPermissions` instead.

4. **`settings.local.json` allow-lists can hide mode differences**  
   A large permanent `permissions.allow` list makes “strict” modes feel ineffective until you tighten those rules.

5. **Resume is best-effort**  
   `--resume` works when Claude still has that session. After rewind/clear/cwd change, context is reconstructed by injecting history into the next prompt (can grow long / lose some CLI-internal state).

6. **Cold start cost**  
   Every turn may pay CLI startup (hooks, MCP, plugins). There is **no** idle “keep CLI warm for N minutes” pool yet.

### Background jobs

7. **Jobs are not separate from the Node process**  
   Background = “don’t abort when the browser disconnects”. Restarting `claude-phone` / rebooting the machine still interrupts jobs (partial text may be saved as `interrupted`).

8. **Default concurrency is 1**  
   A long background job blocks other chats until it finishes or is cancelled (by design on small servers).

9. **Foreground grace is ~4s**  
   Slow networks or weird mobile tab discarding might rarely abort or fail to abort as expected; edge cases remain.

### Streaming & UI

10. **Stream parsing depends on CLI JSON shapes**  
    Claude Code version upgrades can change `stream-json` events; partial text may be coarse or late if formats shift.

11. **Tool activity is thin in the UI**  
    You get status chips / logs, not a full tool timeline like the desktop TUI.

12. **Markdown / code blocks**  
    Messages are largely plain text (escaped HTML). No rich markdown renderer yet.

13. **No multi-user accounts**  
    One Basic Auth pair for the whole app; not a multi-tenant product.

14. **No built-in Telegram / other channels yet**  
    Web UI only (by design for v1).

### Ops

15. **No Docker image in-repo**  
    Manual Node/systemd/Caddy documented; contribute a Dockerfile if you need it.

16. **Caddy helper assumes a writable system Caddyfile + sudo**  
    Won’t fit all hosts; treat as optional.

17. **Claude Code version skew**  
    Tested against recent CLI releases; flags like `--permission-mode`, `--include-partial-messages`, stream event types may differ on older builds.

---

## Troubleshooting

| Symptom | Things to check |
|---------|------------------|
| Blank / 502 behind proxy | Node up? `curl 127.0.0.1:PORT/api/health`; proxy SSE buffering off |
| 401 loops | `AUTH_*` vs proxy Basic Auth double-auth |
| “Claude” does nothing / instant fail | `which claude`; run `claude -p 'hi'` as **same user** as the service |
| Relay / model wrong | ⚙ settings or `~/.claude/settings.json` for that user |
| Mode “does nothing” | Compare plan vs bypass on a write test; review `settings.local.json` allows |
| OOM on small VPS | Keep `MAX_CONCURRENT_TURNS=1`; avoid huge contexts; stop runaway jobs |
| Job gone after reboot | Expected; see Known issues §7 |

---

## Contributing

PRs welcome: Docker, richer markdown, multi-user auth, channel bridges, CLI keep-warm pools, better tool timelines.

Please **do not** commit:

- `config.env`
- `./data/`
- real tokens or host-specific systemd units

---

## License

MIT — see [LICENSE](./LICENSE).

---

## 中文

### 是什么

在手机或浏览器里用**聊天界面**驱动**本机** Claude Code CLI 的自托管小项目。

适合：

- 没有 claude.ai 订阅，或必须用 **中转 API**（`ANTHROPIC_BASE_URL`）
- 官方 Remote Control 不可用或不想用
- 小内存机器：不希望 CLI 一直挂着占 RAM

### 怎么跑

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git
cd claude-phone
cp config.env.example config.env
# 修改 AUTH_PASS、WORK_DIR 等
chmod 600 config.env
node server/server.js
```

浏览器打开 `http://127.0.0.1:7681`，用 `config.env` 账号密码登录。

生产环境建议：同一用户已配置好 Claude Code → `./install-service.sh` → 反代 HTTPS。

### 核心行为（务必理解）

| 点 | 说明 |
|----|------|
| 常驻的是谁 | **Node 网页服务** |
| Claude CLI | **每条消息临时启动**，跑完退出 |
| 切换对话 | 换本地会话档案；发送时尽量 `--resume`，不是多个常驻窗口 |
| 后台任务开 | 关网页也继续 |
| 后台任务关 | 页面断开约 4 秒后自动停 |
| 运行用户 | systemd/进程的 OS 用户；配置读该用户的 `~/.claude/settings.json` |

### 后台任务

| 开关 | 关浏览器后 |
|------|------------|
| 勾选 | 继续跑，回来可看进度/结果 |
| 不勾选 | 约 4 秒后停止 |
| ■ | 立刻取消 |

### 权限模式

网页 **没有**电脑上的「点允许」弹窗。模式会传给 CLI，但体验与 TUI 不同。  
若 `settings.local.json` 白名单很大，模式差异会变弱。  
可用 **仅计划** vs **全部放行** 做写文件对比验证。

### 当前已知问题（摘要）

1. 不是完整 Claude Code TUI（无官方可视化 slash 面板等）  
2. 非交互模式无法手机点选确认工具  
3. 后台任务仍绑在 Node 进程上，重启服务/机器会中断  
4. 默认同时只跑 1 个 CLI  
5. 流式/工具展示较简陋；消息基本是纯文本  
6. 单机单密码，非多用户产品  
7. 尚无 Docker / Telegram 等（欢迎 PR）  

更完整列表见英文 [Known issues & limitations](#known-issues--limitations)。

### 安全

- 公网务必 HTTPS + 鉴权  
- 等同于该系统用户在服务器上开了 Claude Code  
- 勿提交 `config.env` 与 `data/`  

### 配置项

见英文 [Configuration](#configuration-configenv) 表；从 `config.env.example` 复制即可。

### 许可证

MIT
