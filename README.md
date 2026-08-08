# Claude Phone

> 在手机浏览器里，用聊天气泡驱动**你自己服务器上的 Claude Code CLI**。不依赖 claude.ai 订阅，第三方中转 API（`ANTHROPIC_BASE_URL`）直接可用。

[![CI](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml/badge.svg)](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nianshou555qiansui/claude-phone?include_prereleases)](https://github.com/nianshou555qiansui/claude-phone/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg)](https://nodejs.org/)
[![Deps](https://img.shields.io/badge/runtime%20deps-0-success.svg)](./package.json)

## 是什么

- **中转 API 就能用** —— 无需 claude.ai 订阅，读你 `~/.claude/settings.json` 配的上游
- **手机聊天气泡** —— 正常滚动、流式逐字、Markdown，不是网页里嵌终端
- **CLI 按消息起停** —— 不常驻吃内存，1–2 GB 小 VPS 也能跑
- **真正的 `/login` 页** —— 表单 + Cookie，浏览器能记住密码（不再弹系统账号窗）
- **手机逐工具审批 + 推送** —— 有副作用的操作先问你，关网页后台继续跑

## 30 秒跑起来

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git && cd claude-phone
cp config.env.example config.env    # 必改 AUTH_PASS；建议设 WORK_DIR
node server/server.js               # → http://127.0.0.1:7681
```

浏览器打开是 `/login` 表单页，用 `config.env` 里的 `AUTH_USER` / `AUTH_PASS` 登录即可。

## 能力速览

流式对话 · 表单登录 · 工具时间线（按需加载全文）· 逐工具审批 + 会话白名单 · 手机推送（ntfy/Bark）· CLI 契约探针巡检 · 跨重启续跑 · 模型选择器（拉中转 `/v1/models`）· 导入本机 CLI 会话 · 窗口化长会话渲染 · 中英双语

## 生产部署

systemd + 反代 HTTPS（Caddy / nginx），细节见 **[部署详解](docs/deploy.md)**。上线表单登录后**反代不要套 `basic_auth`**（鉴权由应用 `/login` 负责）。

## 详细文档

| 想了解 | 看 |
|--------|-----|
| 完整功能清单、权限模式、命令、全部配置项 | [docs/features.md](docs/features.md) |
| 部署、迁移与备份恢复、排障、安全 | [docs/deploy.md](docs/deploy.md) |
| 架构、HTTP API、项目结构、已知限制 | [docs/architecture.md](docs/architecture.md) |

---

<a name="english"></a>

# Claude Phone (EN)

> Drive **your own server's Claude Code CLI** from a mobile browser via chat bubbles. No claude.ai subscription needed — works with relay APIs (`ANTHROPIC_BASE_URL`).

[![CI](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml/badge.svg)](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nianshou555qiansui/claude-phone?include_prereleases)](https://github.com/nianshou555qiansui/claude-phone/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## What it is

- **Relay-API friendly** — no subscription; reads whatever upstream your `~/.claude/settings.json` points to
- **Chat bubbles on mobile** — normal scrolling, streaming, Markdown; not a terminal embedded in a page
- **CLI per-message** — spawned then exits; doesn't hog RAM, runs on 1–2 GB VPS
- **Real `/login` form** — Cookie session, browser can save the password (no OS Basic-auth popup)
- **Per-tool phone approval + push** — side-effecting tools ask first; background jobs keep running after tab close

## Run in 30s

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git && cd claude-phone
cp config.env.example config.env    # set AUTH_PASS; WORK_DIR recommended
node server/server.js               # → http://127.0.0.1:7681
```

Open `/login`, sign in with `AUTH_USER` / `AUTH_PASS` from `config.env`.

## At a glance

Streaming chat · form login · tool timeline (load full on demand) · per-tool approval + session allowlist · phone push (ntfy/Bark) · CLI contract probe · survive service restarts · model picker (fetch relay `/v1/models`) · import local CLI sessions · windowed long-session rendering · 中文 / EN

## Deploy

systemd + TLS reverse proxy (Caddy / nginx) — see **[deploy.md](docs/deploy.md)**. After enabling form login, **drop `basic_auth` at the proxy** (auth is the app's `/login`).

## Docs

| Want to know | Read |
|--------------|------|
| Full feature list, permission modes, commands, all config | [docs/features.md](docs/features.md) |
| Deploy, migration & backup recovery, troubleshooting, security | [docs/deploy.md](docs/deploy.md) |
| Architecture, HTTP API, project layout, known limits | [docs/architecture.md](docs/architecture.md) |

---

## License

MIT — see [LICENSE](./LICENSE).
