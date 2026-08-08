# 架构、HTTP API 与已知限制

> 给想深入理解或改代码的人。功能与配置见 [features.md](./features.md)，部署见 [deploy.md](./deploy.md)。

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

## 核心行为（务必理解）

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
| 重启不断任务 | CLI 子进程不接服务管道、事件流直写 `data/jobs/<id>.stream`；配合 unit 的 `KillMode=process`，`systemctl restart` 后服务自动接管仍在跑的回合（静默重放追平→继续直播）；停机期间自行跑完的按真实 result 收尾 |

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

1. **不是完整 Claude Code TUI**——无 `/context` 原生面板；模型选择 / `/resume` / 逐工具审批均已用网页等价实现
2. **手机审批需在线响应**——审批卡片靠页面或后台推送；无人处理则默认拒绝（超时 `APPROVAL_TIMEOUT_MS`，默认 120s）。`plan` / `bypassPermissions` 模式不触发审批（前者原生只读、后者全放行）。配 `NOTIFY_URL` 后**待审批会推送到手机**（ntfy / Bark），点开网页即可处理
3. **后台任务已与服务进程解耦**——`systemctl restart` 不再中断任务（CLI 子进程独立写事件流，重启后自动接管续播；停机期间跑完的按真实结果收尾）。机器重启仍会中断。**升级到此版本的老部署需给 unit 加 `KillMode=process`（见 example）**
4. **默认并发 1**——长任务会占住队列（小内存机的刻意取舍）
5. **工具时间线默认摘要**——步数上限约 80；点「加载全文」可拉完整 in/out（单步有上限）。无实时 diff / 无限日志
6. **导入是文本气泡，非完整事件回放**——跳过 thinking / 纯工具行；约 200 条、超大文件只读尾部 ~2MB；只扫服务用户
7. **每轮有 CLI 冷启动开销**——暂无 keep-warm 池
8. **单用户级鉴权，非多用户产品**——`/login` 表单 + HMAC Cookie 会话（30 天，HttpOnly + SameSite=Lax；改密自动失效旧 Cookie）；Basic Auth 仅作 curl/脚本兼容；登录有按 IP 限流（8 次/15 分钟→封 5 分钟）。无 2FA
9. **stream-json 形状随 CLI 版本可能漂移**——用 `./bin/upgrade-cli.sh` 升级（探针门禁+自动回滚），勿裸升；平时默认每 24h 自动巡检一次探针（`PROBE_INTERVAL_H`），失败页顶横幅 + 推送预警
10. **尚无完整 Telegram 对话桥**——但提醒场景（审批 / 回合结束 / 探针失败）已由推送通知覆盖，对话仍在网页（欢迎 PR）

---

## 贡献

欢迎 PR：多用户鉴权、消息渠道（Telegram 等）、CLI keep-warm 池、更丰富的工具时间线（diff / 完整日志）、导入增强。

请**不要**提交：`config.env`、`./data/`、真实 token、含个人路径的 systemd unit。
