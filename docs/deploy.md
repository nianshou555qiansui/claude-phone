# 部署、迁移、排障与安全

> 生产部署、灾难恢复、常见问题与安全注意事项。功能与配置见 [features.md](./features.md)，架构与 API 见 [architecture.md](./architecture.md)。

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

模板见 `systemd/claude-phone.service.example`（占位符 `__USER__` `__HOME__` `__ROOT__`）；**不要提交**渲染后的个人 unit。

> **跨重启续跑**：unit 必须含 `KillMode=process`，`systemctl restart` 才不中断后台任务。pre-v1.2 的部署需手动补这一行（见 example）。

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

细节与限制见 [docker/README.md](../docker/README.md)。宿主机 systemd 已经跑得好就不必上 Docker。

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

换服务器、从每日备份灾难恢复、Docker 部署迁移，见 **[migration.md](./migration.md)**。
要点：每日备份只含 `data/` + `config.env`，**中转令牌在 `~/.claude/settings.json` 里，
需单独迁移**；恢复流程已于 2026-07 实际演练过，手册附季度复检命令。

---

## 排障

| 症状 | 排查 |
|------|------|
| 反代后空白 / 502 | `curl 127.0.0.1:PORT/api/health`；反代 SSE 缓冲要关 |
| 401 循环 | 应用与反代鉴权双层打架（上线表单登录后 Caddy 应去掉 `basic_auth`，用 `./bin/sync-caddy-auth.sh` 同步；要双层才设 `CADDY_BASIC_AUTH=1`） |
| 点了没反应 / 秒失败 | 以**服务同一用户**执行 `claude -p 'hi'` 验证 CLI 本身 |
| 模型/中转不对 | 模型芯片 + ⚙ 设置；或直接查该用户 `~/.claude/settings.json` |
| 切了模型没生效 | 看芯片档位（本会话 vs 默认）；下一条消息才生效；中转可能把多个别名映到同一上游 |
| 模式像没区别 | `settings.local.json` 白名单太宽；用 plan vs bypass 写文件对比验证 |
| 小内存 OOM | `MAX_CONCURRENT_TURNS=1`；及时停失控任务 |
| 重启后任务没了 | 预期行为，见 [architecture.md](./architecture.md) 已知限制 |
| 导入列表为空 | 服务用户没有 `~/.claude/projects` 会话；先以该用户跑一次 `claude` |
| 导入后 `--resume` 失败 | 会话已失效 / 用户不对 / 交互式会话（自动转历史注入） |

---

## 安全

- 默认只听 `127.0.0.1`；公网必须 **反代 TLS + 鉴权**，`AUTH_PASS` 用强密码
- 这个应用 ≈ **该 OS 用户在服务器上开着 Claude Code**（shell、文件、工具全有）——按生产管理后台对待
- 鉴权双通道：表单 `/login` 发 HMAC 签名 Cookie（`cp_session`，HttpOnly + SameSite=Lax），Basic Auth 仅作 curl/脚本兼容；均用常量时间比较；登录按 IP 限流（8 次/15 分钟→封 5 分钟）。`/api/health` 不泄露主机路径；settings 备份自动 `600` 权限
- `config.env`、`./data/` 保持私有且已 gitignore
