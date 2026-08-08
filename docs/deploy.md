# 部署、迁移、排障、安全

生产怎么装、怎么迁、出了问题怎么查。功能配置见 [features.md](./features.md)，架构见 [architecture.md](./architecture.md)。

## 生产部署

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

模板在 `systemd/claude-phone.service.example`（占位符 `__USER__` `__HOME__` `__ROOT__`）。渲染后的个人 unit 别提交。

unit 里要有 `KillMode=process`，否则 `systemctl restart` 会把后台任务一起带走。v1.2 以前的部署如果还没这行，补上。

### Caddy 反代

鉴权在应用的 `/login`，**反代别再套 `basic_auth`**，否则又弹系统账号窗。

```bash
./bin/sync-caddy-auth.sh          # 推荐：只 TLS + 反代
# CADDY_BASIC_AUTH=1 ./bin/sync-caddy-auth.sh  # 旧双层 Basic，一般别开
```

```caddyfile
claude.example.com {
	encode gzip zstd
	# 不要 basic_auth
	reverse_proxy 127.0.0.1:7681 {
		transport http {
			read_timeout 0
			write_timeout 0
		}
		flush_interval -1     # SSE 必须
	}
}
```

nginx：`proxy_buffering off`，`proxy_read_timeout` 拉长（SSE 会挂很久）。

### Docker（可选）

镜像里是 Node 20 + Claude Code CLI，卷挂网页数据 / `~/.claude` / 工作目录：

```bash
cp config.env.example config.env    # 设 AUTH_PASS
mkdir -p data workspace
docker compose up -d --build        # http://127.0.0.1:7681
```

细节见 [docker/README.md](../docker/README.md)。本机 systemd 已经跑得稳就不必上 Docker。

### 升级 Claude Code CLI

我们吃的是 CLI 的 `stream-json` 输出，裸升可能踩格式漂移。用带门禁的脚本：

```bash
./bin/upgrade-cli.sh            # latest；或 ./bin/upgrade-cli.sh 2.1.220
```

流程：记下当前版本 → 安装 → 跑 `bin/cli-probe.js`（检查 init/assistant/result/usage）→ 失败自动回滚（隔 20s 再试一次，防中转抖一下误判）。服务是按轮 spawn CLI 的，升 / 回滚不用重启服务。成功后建议网页发一条冒烟，并重录标本跑单测：

```bash
node bin/cli-probe.js --record test/fixtures/stream-ping.jsonl && npm test
```

有些中转**按模型分账号池**。探针默认用 CLI 默认模型，可能和网页实际用的池不是一个。指定网页在用的模型更靠谱：

```bash
CLI_PROBE_MODEL=<网页在用的模型id> ./bin/upgrade-cli.sh
```

`--record` 会自动脱敏（去 hook 行、抹掉 uuid 和本机路径），可以直接提交。

建议 Watch [anthropics/claude-code](https://github.com/anthropics/claude-code) 的 Releases，新版本先观望几天再升。

### 迁移与备份恢复

换机、从每日备份恢复、Docker 迁移，见 **[migration.md](./migration.md)**。

每日备份只有 `data/` + `config.env`。**中转令牌在 `~/.claude/settings.json`，不在备份里**，迁机时要单独带。恢复流程 2026-07 实操过，手册里有季度复检命令。

---

## 排障

| 症状 | 怎么查 |
|------|------|
| 反代后空白 / 502 | `curl 127.0.0.1:PORT/api/health`；SSE 缓冲关掉 |
| 401 循环 | 应用和反代鉴权叠了两层。表单登录后 Caddy 应去掉 `basic_auth`（`./bin/sync-caddy-auth.sh`；双层才设 `CADDY_BASIC_AUTH=1`） |
| 点了没反应 / 秒失败 | 用**跑服务的同一用户**执行 `claude -p 'hi'`，先确认 CLI 本身活着 |
| 模型 / 中转不对 | 顶栏模型芯片 + ⚙；或直接看该用户 `~/.claude/settings.json` |
| 切了模型没生效 | 看芯片是「本会话」还是「默认」；下一条消息才换；中转可能把多个别名映到同一上游 |
| 模式像没区别 | `settings.local.json` 白名单太宽；用 plan vs bypass 写文件对比 |
| 小内存 OOM | `MAX_CONCURRENT_TURNS=1`；失控任务及时停 |
| 重启后任务没了 | 见 [architecture.md](./architecture.md) 已知限制；unit 要有 `KillMode=process` |
| 导入列表空 | 服务用户没有 `~/.claude/projects`；先以该用户跑一次 `claude` |
| 导入后 `--resume` 失败 | 会话失效 / 用户不对 / 交互式会话（会自动改走历史注入） |

---

## 安全

- 默认只听 `127.0.0.1`。上公网必须反代 TLS + 强 `AUTH_PASS`
- 这个应用 ≈ 该 OS 用户在服务器上开着 Claude Code（shell、文件、工具全有），按生产管理后台对待
- 鉴权两条路：表单 `/login` 发 HMAC Cookie（`cp_session`，HttpOnly + SameSite=Lax）；Basic 只给 curl / 脚本。两边都是常量时间比较。登录按 IP 限流：15 分钟内 8 次失败 → 封 5 分钟
- `/api/health` 不带主机路径；settings 备份 `600`；`config.env` 和 `./data/` 私有且已 gitignore
