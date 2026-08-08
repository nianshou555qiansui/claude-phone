# 架构、HTTP API、已知限制

给要改代码或想搞清楚内部机制的人。功能配置见 [features.md](./features.md)，部署见 [deploy.md](./deploy.md)。

## 架构

```
手机 / 浏览器
    │  HTTPS（反代）+ 表单 /login（Cookie）/ Basic Auth（curl 兼容）
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

## 核心行为

| 点 | 说明 |
|----|------|
| 常驻的是谁 | 只有 Node 网页服务，没有 npm 运行时依赖 |
| Claude CLI | 每条消息临时 `claude -p --output-format stream-json`，跑完退出 |
| 会话延续 | 有有效 `claudeSessionId` 时下一条带 `--resume`；`/rewind`、`/clear`、换目录后改成历史注入（近 30 轮文本拼进 prompt） |
| 切换对话 ≠ resume | 侧栏切换只换网页档案；`--resume` 是在发送时才挂上 |
| 交互式 CLI 会话 | 终端 TUI 开的（`entrypoint: cli`）不能 `claude -p --resume`；导入后能看历史，续聊走历史注入 |
| 运行用户 | 读写的是该 OS 用户的 `~/.claude/`。Node 必须用已经配好 Claude Code 的同一用户跑（root 和普通用户是两套配置） |
| 数据落盘 | 会话 `./data/sessions.json` + `./data/messages/*.jsonl`；任务 `./data/jobs/`（运行中还有 `<id>.stream`，结束后清掉）；CLI 临时目录固定 `./data/cli-tmp`（配合 systemd PrivateTmp） |
| 工具审批 | `default`/`acceptEdits` 下有副作用的工具经 PreToolUse hook 报到服务，等手机决定后才执行 |
| 重启不断任务 | CLI 子进程不接服务管道，事件流直写 `data/jobs/<id>.stream`；unit 有 `KillMode=process` 时，`systemctl restart` 只杀 Node，CLI 接着写，新进程 attach 追平再继续推。停机期间自己跑完的按真实 result 收尾 |

---

## HTTP API（概览）

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
| `GET` | `/api/sessions/:id/messages/:mid/tools/:toolKey` | 工具步骤按需全文（id 或 clientKey 匹配） |
| `GET` | `/api/jobs` · `/api/jobs/:id` | 任务列表 / 详情（partial 文本） |
| `POST` | `/api/jobs/:id/cancel` | 取消任务 |
| `GET/PUT` | `/api/settings` | 读 / 写 Claude settings（GET 时密钥掩码） |
| `GET` | `/api/models` | 模型目录（别名 / 环境映射 / 自定义） |
| `GET` | `/api/models/upstream` | 服务端拉中转 `/v1/models`（60s 缓存，`?force=1` 强刷） |
| `POST` | `/api/models/select` | `{ model, scope: "session"\|"default", sessionId? }` |
| `POST/DELETE` | `/api/models/custom(/:id)` | 增 / 删自定义模型 |
| `POST` | `/api/login` · `/api/logout` | 表单登录 / 登出（发 / 清 Cookie） |
| `POST` | `/api/approvals/request` · `GET /:id/wait` · `POST /:id/decide` | 工具审批 hook 桥（内部令牌鉴权 / 长轮询 / 网页决定） |

静态页面由 `public/` 提供。

---

## 项目结构

```
claude-phone/
  public/                      # 前端（原生 HTML/CSS/JS，无构建步骤）
  server/
    server.js                  # HTTP + SSE API + 登录/限流 + 探针调度
    lib/
      claude-runner.js         # spawn + 解析 stream-json（含工具事件）
      store.js                 # 会话 / 消息落盘
      jobs.js                  # 后台任务持久化 + 清理
      commands.js              # 聊天层 slash 命令
      models.js                # 模型目录 + 上游 /v1/models
      dedupe.js                # 消息指纹 + 近重复折叠
      approvals.js             # 手机工具审批注册表（请求/决定/超时）
      session-import.js        # 扫描 ~/.claude/projects（/resume）
      settings-editor.js       # ~/.claude/settings.json 读写
      sessions-auth.js         # HMAC Cookie 会话签名/校验
      login-rate-limit.js      # 登录按 IP 限流 + 老化回收（纯逻辑）
      notify.js                # 手机推送（ntfy/bark/json）
      probe-schedule.js        # CLI 契约探针调度（纯逻辑）
      config.js                # config.env 加载
  test/                        # 单元测试（node --test，零依赖）
  data/                        # 运行时数据（gitignore）
  Dockerfile / docker-compose.yml / docker/
  systemd/claude-phone.service.example
  install-service.sh
  bin/                         # healthcheck / 备份 / CLI 探针与升级 / 审批 hook / caddy 辅助
```

---

## 已知限制

1. 不是完整 TUI。没有原生 `/context` 面板；模型选择、`/resume`、逐工具审批是网页侧的等价实现
2. 审批要有人响应。卡片靠页面或推送；没人处理就超时拒绝（`APPROVAL_TIMEOUT_MS`，默认 120s）。`plan` 和 `bypassPermissions` 不触发审批（一个只读，一个全放行）。配了 `NOTIFY_URL` 会推到手机
3. 后台任务和 Node 分开了。`systemctl restart` 不中断任务，但整机重启还是会断。老部署要给 unit 补 `KillMode=process`（见 example）
4. 并发默认 1，可调高。`MAX_CONCURRENT_TURNS` 控制同时跑的 CLI 进程数；并发是跨会话的（同一会话同一时间只有一条 turn）。设成 2+ 后多个会话能同时回复，代价是每个进程的内存，小机器保持 1 更稳。放开是安全的：同会话并发由 activeTurns 预占堵死，跨会话各写各的 jsonl，全局 sessions.json 的写是单线程同步快照
5. 工具时间线默认只存摘要。步数上限约 80，「加载全文」也有单步上限。没有实时 diff，也没有完整日志
6. 导入的是文本气泡，不是完整事件回放。跳过 thinking 和纯工具行；约 200 条，大文件只读尾部约 2MB；只扫服务用户自己的会话
7. 每轮都有 CLI 冷启动开销，没有 keep-warm 池
8. 单用户鉴权，不是多用户产品。表单 + Cookie（30 天，改密后旧 Cookie 失效），Basic 留给 curl，登录按 IP 限流，没有 2FA
9. `stream-json` 的形状可能随 CLI 版本变。用 `./bin/upgrade-cli.sh` 升级（探针门禁 + 自动回滚），别裸升；平时默认每 24h 跑一次探针（`PROBE_INTERVAL_H`），失败会在页顶横幅提醒
10. 没有完整的 Telegram 对话桥。审批、回合结束、探针失败这些提醒已经走推送，但对话还在网页里（欢迎 PR）

---

## 贡献

欢迎 PR：多用户鉴权、消息渠道（Telegram 等）、CLI keep-warm、更完整的工具时间线、导入增强。

别提交：`config.env`、`./data/`、真实 token、带个人路径的 systemd unit。
