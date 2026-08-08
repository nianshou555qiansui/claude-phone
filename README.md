# Claude Phone

手机上用聊天气泡操作本机 Claude Code。不走 claude.ai 订阅，中转 API（`ANTHROPIC_BASE_URL`）就能用。

[![CI](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml/badge.svg)](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nianshou555qiansui/claude-phone?include_prereleases)](https://github.com/nianshou555qiansui/claude-phone/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-339933.svg)](https://nodejs.org/)
[![Deps](https://img.shields.io/badge/runtime%20deps-0-success.svg)](./package.json)

## 这是什么

官方 Remote Control 要订阅，还认不下中转；手机上开 TUI 又难用。这个项目是个网页聊天界面，每条消息临时起一次 `claude -p`，跑完就退，1–2 GB 的小机器也跑得动。

它直接读本机 `~/.claude/settings.json`，中转地址、模型映射都原样生效。界面是普通聊天气泡、流式输出，不是在网页里嵌一个终端。有副作用的工具会推到手机上确认，关了网页也能后台继续跑。

## 跑起来

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git && cd claude-phone
cp config.env.example config.env   # 改 AUTH_PASS，建议再设 WORK_DIR
node server/server.js              # http://127.0.0.1:7681
```

打开后进 `/login`，用 `config.env` 里的账号密码登录。

生产环境用 systemd + 反代 HTTPS，见 [docs/deploy.md](docs/deploy.md)。开表单登录之后，Caddy 那层**不要套 `basic_auth`**，鉴权交给应用本身。

## 主要能力

- 流式对话、Markdown、多会话侧栏
- 工具时间线：默认摘要，点「加载全文」看完整 in/out
- 逐工具审批（允许 / 拒绝 / 本会话总是允许）
- ntfy / Bark 推送：审批挂起、回合结束、探针失败
- 每天空闲时跑一次 CLI 契约探针，失败在页顶横幅提醒
- `systemctl restart` 不打断后台任务
- 模型选择器，可从中转拉 `/v1/models`
- 导入本机 CLI 会话、长会话窗口化渲染、中英界面

完整清单（权限模式、命令、配置项）见 [docs/features.md](docs/features.md)。

## 文档

| 内容 | 文件 |
|------|------|
| 功能、权限模式、命令、配置 | [docs/features.md](docs/features.md) |
| 部署、迁移、排障、安全 | [docs/deploy.md](docs/deploy.md) |
| 架构、HTTP API、已知限制 | [docs/architecture.md](docs/architecture.md) |

---

<a name="english"></a>

# Claude Phone (EN)

A chat UI for driving your own server's Claude Code CLI from a phone. Works with relay APIs (`ANTHROPIC_BASE_URL`); no claude.ai subscription.

[![CI](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml/badge.svg)](https://github.com/nianshou555qiansui/claude-phone/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/nianshou555qiansui/claude-phone?include_prereleases)](https://github.com/nianshou555qiansui/claude-phone/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## What it is

Official Remote Control needs a subscription and rejects relays. A TUI on a phone is painful. This is a chat page that spawns `claude -p` per message and exits when the turn finishes — light enough for a 1–2 GB VPS.

It uses your local `~/.claude/settings.json` as-is, so the relay URL and model maps carry over. The UI is normal chat bubbles and streaming, not a terminal in a browser tab. Login is a `/login` form page, so a password manager can save it. Side-effecting tools ask for approval on the phone, and background jobs keep running after the tab closes.

## Run it

```bash
git clone https://github.com/nianshou555qiansui/claude-phone.git && cd claude-phone
cp config.env.example config.env   # set AUTH_PASS; WORK_DIR recommended
node server/server.js              # http://127.0.0.1:7681
```

Open `/login`, sign in with `AUTH_USER` / `AUTH_PASS` from `config.env`.

For production: systemd + TLS reverse proxy — [docs/deploy.md](docs/deploy.md). Once form login is on, **drop `basic_auth` at the proxy**; the app handles auth itself.

## Main features

- Streaming chat, Markdown, multi-session sidebar
- Tool timeline: summary by default, "load full" for complete in/out
- Per-tool approval (allow / deny / always-allow for this session)
- ntfy / Bark push: pending approvals, turn finished, probe failed
- A daily idle CLI contract probe with a banner on failure
- `systemctl restart` doesn't kill background jobs
- Model picker, can fetch relay `/v1/models`
- Import local CLI sessions, windowed rendering for long chats, 中文 / EN UI

Full list (permission modes, commands, config): [docs/features.md](docs/features.md).

## Docs

| Content | File |
|---------|------|
| Features, modes, commands, config | [docs/features.md](docs/features.md) |
| Deploy, migration, troubleshooting, security | [docs/deploy.md](docs/deploy.md) |
| Architecture, HTTP API, known limits | [docs/architecture.md](docs/architecture.md) |

## License

MIT — [LICENSE](./LICENSE).
