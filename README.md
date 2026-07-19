# Claude Phone

Self-hosted **mobile chat UI** for [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI.

Drive a local Claude Code process from a phone or browser — without Anthropic’s official Remote Control (which needs a claude.ai subscription and does not work with API relays / custom `ANTHROPIC_BASE_URL`).

[中文说明](#中文)

## Features

- Chat UI (bubbles, streaming text, normal scroll history)
- Spawns `claude -p --output-format stream-json` per turn (no always-on heavy CLI)
- Background jobs: keep running after you close the tab (optional foreground auto-stop)
- Permission modes (plan / acceptEdits / bypassPermissions / …)
- In-app editor for `~/.claude/settings.json` (swap relay Base URL / token)
- Local slash commands: `/help`, `/rewind`, `/clear`, `/compact`, `/status`, `/mode`, `/cwd`
- Optional Caddy reverse proxy + Basic Auth + systemd unit

## Architecture

```
Phone / browser
    │  HTTPS (recommended) + Basic Auth
    ▼
Node server  (127.0.0.1:<PORT>, lightweight, long-running)
    │  spawn one process per message
    ▼
claude -p --output-format stream-json
    │  job state under ./data/jobs/
    ▼
Local filesystem + ~/.claude/settings.json
```

| Component | Lifecycle |
|-----------|-----------|
| Node web service | Stays up (systemd or process manager) |
| Claude CLI | Starts per task, exits when the turn ends |
| Background mode **on** | Closing the browser does **not** kill CLI |
| Background mode **off** | Last SSE disconnect ≈ **4s** later aborts the turn |
| Stop button | Cancels the current job immediately |
| Service / machine reboot | Running jobs → `interrupted` (partial output kept if possible) |

## Requirements

- Linux (or any host that can run Node + Claude Code CLI)
- [Node.js](https://nodejs.org/) **≥ 18**
- [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) installed and on `PATH` (or set `CLAUDE_BIN`)
- Claude Code configured for your account / relay under the **same OS user** that runs this app  
  (typically `~/.claude/settings.json` for that user)
- Reverse proxy with TLS recommended for internet exposure (Caddy / nginx / Traefik)

## Quick start

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git
cd claude-phone

cp config.env.example config.env
# Edit config.env: AUTH_PASS, WORK_DIR, PUBLIC_HOST (if using Caddy), etc.
chmod 600 config.env

# Run as the same user that owns your Claude Code config
node server/server.js
# → http://127.0.0.1:7681
```

Open the URL, log in with `AUTH_USER` / `AUTH_PASS`, and chat.

## Configuration (`config.env`)

| Variable | Description | Example |
|----------|-------------|---------|
| `AUTH_USER` / `AUTH_PASS` | HTTP Basic Auth for the web UI | `admin` / strong password |
| `BIND` | Listen address | `127.0.0.1` |
| `PORT` | Listen port | `7681` |
| `WORK_DIR` | Default cwd for Claude Code | `$HOME/projects` |
| `DEFAULT_PERMISSION_MODE` | New-session permission mode | `acceptEdits` |
| `DEFAULT_BACKGROUND` | `1` = background jobs by default | `1` |
| `MAX_CONCURRENT_TURNS` | Max parallel Claude processes | `1` (safe on small VPS) |
| `TURN_TIMEOUT_MS` | Max duration per turn | `600000` |
| `CLAUDE_BIN` | Path to `claude` binary | `/usr/local/bin/claude` |
| `PUBLIC_URL` / `PUBLIC_HOST` | Public URL / hostname (Caddy helper) | `https://claude.example.com` |

Copy from `config.env.example`. **Never commit `config.env`.**

## Production deploy (systemd + Caddy)

### 1. Install as a dedicated user (recommended)

Run the Node service as a **non-root** user that already has Claude Code configured (e.g. your normal login user). Do **not** assume a fixed home path like `/home/ubuntu` — use that user’s real `$HOME`.

### 2. Generate and install the unit

```bash
cd /path/to/claude-phone
cp config.env.example config.env
# edit config.env

./install-service.sh
```

`install-service.sh` will:

1. Render `systemd/claude-phone.service` from your current user / install path  
2. Optionally sync Caddy Basic Auth if `PUBLIC_HOST` is set and Caddy is available  
3. `systemctl enable --now claude-phone`

Manual unit template: see `systemd/claude-phone.service.example`.

### 3. Reverse proxy (Caddy example)

```caddyfile
claude.example.com {
	encode gzip zstd
	basic_auth {
		# generate: caddy hash-password
		YOUR_USER YOUR_BCRYPT_OR_BASE64_HASH
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

Helper script (optional): `./bin/sync-caddy-auth.sh` reads `AUTH_*` / `PUBLIC_HOST` from `config.env` and rewrites the host block in `/etc/caddy/Caddyfile` (requires passwordless `sudo`).

### 4. Ops commands

```bash
sudo systemctl status claude-phone
sudo systemctl restart claude-phone
sudo journalctl -u claude-phone -f

curl -s http://127.0.0.1:7681/api/health
```

## Usage

1. Open your public URL (or `http://127.0.0.1:PORT`)  
2. Basic Auth with `AUTH_USER` / `AUTH_PASS`  
3. Type and send; history scrolls normally  
4. **Background task** toggle:  
   - **On** — closing the tab keeps the job running  
   - **Off** — last client disconnect aborts after ~4s  
5. **■** — stop current job  
6. **⚙** — edit Claude settings (relay URL / token)  
7. **/** — command palette; permission chip ≈ desktop Shift+Tab  

### Chat-layer commands

| Command | Meaning |
|---------|---------|
| `/help` | List commands |
| `/rewind` / `/rewind 2` | Drop last N user turns |
| `/clear` | Clear conversation |
| `/compact` | Keep only recent turns |
| `/status` | Mode / cwd / resume info |
| `/mode acceptEdits` | Set permission mode |
| `/cwd /path` | Change working directory |

> Full interactive TUI slash UIs (visual pickers, etc.) are not available under `claude -p`. The table above covers the practical subset.

### Permission modes (non-interactive)

In print (`-p`) mode there is **no** approval popup:

| Mode | Behavior (approx.) |
|------|--------------------|
| `acceptEdits` | Auto-accept edits in the workspace |
| `plan` | Explore read-only; avoid source edits |
| `default` | Rely on allow/deny rules |
| `dontAsk` | Deny tools not pre-allowed |
| `bypassPermissions` | Skip most prompts (dangerous) |
| `auto` | CLI auto mode (may fail if unsupported) |

Rules in `~/.claude/settings.local.json` still apply and can override what you “feel” from the mode chip.

## Security

- Bind to `127.0.0.1` and put TLS + auth on a reverse proxy  
- Use a strong `AUTH_PASS`; rotate if leaked  
- Treat this as **full shell-level power** of the service user (same as that user running `claude` locally)  
- Do not expose without auth on the public internet  
- `config.env` and `./data/` must stay private  

## Project layout

```
claude-phone/
  public/                 # Web UI
  server/                 # Node backend
    lib/                  # runner, store, jobs, settings editor, commands
  data/                   # Runtime sessions/jobs (gitignored)
  config.env.example
  systemd/claude-phone.service.example
  install-service.sh
  bin/sync-caddy-auth.sh
  bin/healthcheck.sh
```

## License

MIT — see [LICENSE](./LICENSE).

---

## 中文

在手机/浏览器里用**聊天界面**驱动本机 Claude Code CLI 的自托管方案。

适合：没有 claude.ai 订阅、必须用中转 API、又不想用官方 Remote Control 的场景。

### 快速开始

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git
cd claude-phone
cp config.env.example config.env
# 编辑 AUTH_PASS、WORK_DIR 等
chmod 600 config.env
node server/server.js
```

浏览器打开 `http://127.0.0.1:7681`，用 `config.env` 里的账号密码登录。

### 部署注意

- 用**已配置好 Claude Code 的系统用户**跑服务（不要默认写死 `/home/xxx`）  
- 公网务必 HTTPS + 鉴权（Caddy/Nginx）  
- `config.env`、`data/` 不要提交到 Git  
- 小内存机器建议 `MAX_CONCURRENT_TURNS=1`  

### 后台任务

| 开关 | 关浏览器后 |
|------|------------|
| 勾选 | 任务继续，回来可看进度/结果 |
| 不勾选 | 最后一个页面断开约 4 秒后自动停止 |

点 **■** 可立即取消。

更细的架构与配置表见上文英文部分。
