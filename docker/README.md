# Docker

Run **Claude Phone** (Node UI + Claude Code CLI) in a container.

## What is inside

| Layer | Role |
|-------|------|
| Node 20 | Chat server (`server/server.js`) |
| `@anthropic-ai/claude-code` | `claude -p` per message |
| Volumes | Persist web data + Claude `~/.claude` + workspace |

This is **not** a multi-tenant SaaS image. One container ≈ one OS user with Claude Code powers.

## Quick start

```bash
cd claude-phone
cp config.env.example config.env
# edit AUTH_PASS=...  (required for Basic Auth)
mkdir -p data workspace
docker compose up -d --build
```

Open `http://127.0.0.1:7681` with `AUTH_USER` / `AUTH_PASS`.

Configure relay / model in the web **⚙** panel (writes into the `claude-home` volume under `~/.claude/settings.json`).

## Volumes

| Mount | Purpose |
|-------|---------|
| `./data` → `/app/data` | Web sessions / messages / jobs |
| `claude-home` → `/home/claude` | Claude settings, projects, transcripts, custom models |
| `./workspace` → `/workspace` | Default `WORK_DIR` for Claude tools |

Point workspace at a real project:

```bash
WORK_DIR_HOST=/path/to/your/repo docker compose up -d
```

## Environment

Compose sets `BIND=0.0.0.0` so the app is reachable on the published port even if `config.env` still says `127.0.0.1` (bare-metal default).

| Variable | Notes |
|----------|--------|
| `AUTH_USER` / `AUTH_PASS` | Basic Auth (or put in `config.env`) |
| `HOST_PORT` | Host port map (default `7681`) |
| `WORK_DIR_HOST` | Host path for `/workspace` |
| `MAX_CONCURRENT_TURNS` | Keep `1` on small VPS |
| `CLAUDE_BIN` | Default `claude` |

## Import host Claude sessions

CLI transcripts live under `$HOME/.claude/projects`. To import from the **host** CLI user, either:

1. Copy/sync host `~/.claude` into the volume, or  
2. Bind-mount host home config (advanced; uid must match `10001:10001` or fix ownership).

Example bind (same machine, care with permissions):

```yaml
# override in docker-compose.override.yml — use carefully
volumes:
  - /home/YOU/.claude:/home/claude/.claude
```

## Build only

```bash
docker build -t claude-phone:local .
docker run --rm -p 7681:7681 \
  -e AUTH_PASS=change-me \
  -e BIND=0.0.0.0 \
  -v claude-phone-data:/app/data \
  -v claude-phone-home:/home/claude \
  -v "$PWD/workspace:/workspace" \
  claude-phone:local
```

## Limits (same as bare metal)

- Not a full TUI; web chat + `-p` print mode
- Background jobs die if the **container** restarts
- Image size is larger than pure Node (CLI + git + tools)
- Update CLI: rebuild image (`docker compose build --no-cache`)

## Vs systemd on this VPS

| | Docker | systemd (this repo’s default) |
|--|--------|-------------------------------|
| Isolation | Process + deps in image | Host Node + host `claude` |
| Claude home | Volume | Host `~/.claude` |
| Best for | Portable deploy / other machines | Your current 2c2g host with existing CLI |

You do **not** need Docker if systemd is already healthy; this is optional packaging.
